//! Multi-format importers: Notion (`.zip`, `.md`, `.csv` → `.base`), NoteCraft (`_node.toml`), and OneNote (`.one`, `.html`).
pub mod notecraft_onenote;
pub mod notion;

use crate::api::{ImportBundleRequest, ImportFormat, ImportPathRequest, ImportReport};
use crate::{state_dir, vault_write, Error, Result, Workspace};
use base64::Engine;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Component, Path, PathBuf};

pub(crate) const MS_ONE_MAGIC: [u8; 16] = [
    0xE4, 0x52, 0x5C, 0x7B, 0x8C, 0xD8, 0xA7, 0x4D, 0xAE, 0xB1, 0x53, 0x78, 0xD0, 0x29, 0x96, 0xD3,
];
const MAX_ENTRY_BYTES: u64 = 256 * 1024 * 1024;

pub(crate) struct TempCacheDir(PathBuf);

impl TempCacheDir {
    pub(crate) fn new(ws: &Workspace, prefix: &str) -> Result<Self> {
        let dir = vault_write::cache::unique(&ws.cache_dir().join(prefix));
        let _ = vault_write::cache::remove_dir_all(&dir);
        vault_write::cache::mkdir(&dir)?;
        Ok(Self(dir))
    }
    pub(crate) fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempCacheDir {
    fn drop(&mut self) {
        let _ = vault_write::cache::remove_dir_all(&self.0);
    }
}

pub(crate) fn sanitize_component(raw: &str, fallback: &str) -> String {
    let mapped: String = raw
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '[' | ']' | '#' | '^') || c.is_control() { '_' } else { c })
        .collect();
    let collapsed = mapped.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed.trim().trim_start_matches('.').trim_end_matches(['.', ' ']);
    if trimmed.is_empty() {
        return fallback.to_string();
    }
    let upper = trimmed.to_ascii_uppercase();
    let reserved = matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (upper.len() == 4 && (upper.starts_with("COM") || upper.starts_with("LPT")) && upper.as_bytes()[3].is_ascii_digit());
    if reserved { format!("_{trimmed}") } else { trimmed.to_string() }
}

pub(crate) fn sanitize_filename(raw: &str, fallback: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or(raw).trim();
    match base.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() && !e.is_empty() && e.len() <= 12 && e.chars().all(|c| c.is_ascii_alphanumeric()) => {
            format!("{}.{}", sanitize_component(s, fallback), e.to_ascii_lowercase())
        }
        _ => sanitize_component(base, fallback),
    }
}

pub(crate) fn join_rel(base: &str, sub: &str) -> String {
    let (b, s) = (base.trim_matches('/'), sub.trim_matches('/'));
    if b.is_empty() { s.to_string() } else if s.is_empty() { b.to_string() } else { format!("{b}/{s}") }
}

fn normalize_target_dir(ws: &Workspace, target_dir: &str) -> Result<String> {
    let trimmed = target_dir.trim().replace('\\', "/");
    let trimmed = trimmed.trim_matches('/');
    if trimmed.is_empty() || trimmed == "." {
        return Ok(String::new());
    }
    if state_dir::is_state_rel(trimmed) {
        return Err(Error::BadPath(format!("cannot import into state folder: {target_dir}")));
    }
    Ok(ws.rel(&ws.resolve(trimmed)?))
}

pub(crate) fn enclosed_rel(raw: &str) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for part in raw.split(['/', '\\']) {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." || part == "__MACOSX" || part == ".DS_Store" || part.contains(':') {
            return None;
        }
        let clean = part.trim_end_matches(['.', ' ']);
        if clean.is_empty() {
            return None;
        }
        out.push(clean);
    }
    (!out.as_os_str().is_empty()).then_some(out)
}

pub(crate) fn percent_decode(input: &str) -> String {
    let b = input.as_bytes();
    let (mut out, mut i) = (Vec::with_capacity(b.len()), 0);
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(hi), Some(lo)) = ((b[i + 1] as char).to_digit(16), (b[i + 2] as char).to_digit(16)) {
                out.push(((hi << 4) | lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub(crate) fn resolve_inside(source_root: &Path, from_dir: &Path, raw_rel: &str) -> Option<PathBuf> {
    let mut stack: Vec<String> = from_dir
        .strip_prefix(source_root)
        .ok()?
        .components()
        .filter_map(|c| match c { Component::Normal(s) => Some(s.to_string_lossy().into_owned()), _ => None })
        .collect();
    for seg in raw_rel.split(['/', '\\']) {
        match seg {
            "" | "." => {}
            ".." => { stack.pop()?; }
            s => stack.push(s.to_string()),
        }
    }
    let candidate = stack.iter().fold(source_root.to_path_buf(), |acc, s| acc.join(s));
    let (root_real, cand_real) = (crate::paths::real(source_root).ok()?, crate::paths::real(&candidate).ok()?);
    (cand_real.starts_with(&root_real) && cand_real.is_file()).then_some(cand_real)
}

pub(crate) fn save_attachment(ws: &Workspace, filename: &str, bytes: &[u8], report: &mut ImportReport) -> Result<String> {
    let clean = sanitize_filename(filename, "attachment.bin");
    let (stem, ext) = match clean.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (clean.clone(), String::new()),
    };
    let z_dir = ws.resolve("zAttachments")?;
    let want_hash = Sha256::digest(bytes);
    for n in 0usize.. {
        let cand = if n == 0 { clean.clone() } else { format!("{stem} {n}{ext}") };
        let abs = z_dir.join(&cand);
        if vault_write::create(&abs, bytes)? == vault_write::Created::New {
            report.attachments_saved += 1;
            report.created_paths.push(format!("zAttachments/{cand}"));
            return Ok(cand);
        }
        if std::fs::read(&abs).is_ok_and(|existing| Sha256::digest(&existing) == want_hash) {
            return Ok(cand);
        }
    }
    unreachable!()
}

pub(crate) fn write_vault_doc(
    ws: &Workspace, rel_dir: &str, stem: &str, ext: &str, text: &str, is_base: bool, report: &mut ImportReport,
) -> Result<String> {
    let clean_stem = sanitize_component(stem, "Untitled");
    for n in 0usize.. {
        let file_name = if n == 0 { format!("{clean_stem}.{ext}") } else { format!("{clean_stem} {n}.{ext}") };
        let rel = join_rel(rel_dir, &file_name);
        if vault_write::create(&ws.resolve(&rel)?, text.as_bytes())? == vault_write::Created::New {
            if is_base { report.bases_created += 1 } else { report.notes_created += 1 }
            if report.first_open_path.is_none() || (is_base && !report.first_open_path.as_deref().is_some_and(|p| p.ends_with(".base"))) {
                report.first_open_path = Some(rel.clone());
            }
            report.created_paths.push(rel.clone());
            return Ok(rel);
        }
    }
    unreachable!()
}

fn extract_zip_bytes(bytes: &[u8], into: &Path, depth: u8) -> Result<()> {
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| Error::BadRequest(format!("invalid zip: {e}")))?;
    for i in 0..z.len() {
        let entry = z.by_index(i).map_err(|e| Error::BadRequest(format!("zip entry: {e}")))?;
        let Some(rel) = enclosed_rel(entry.name()) else { continue };
        let dest = into.join(&rel);
        if entry.is_dir() {
            vault_write::cache::mkdir(&dest)?;
            continue;
        }
        let mut buf = Vec::new();
        entry.take(MAX_ENTRY_BYTES).read_to_end(&mut buf)?;
        let nested = depth < 2 && rel.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("zip")) && buf.starts_with(b"PK\x03\x04");
        if nested {
            let parent = dest.parent().unwrap_or(into);
            vault_write::cache::mkdir(parent)?;
            extract_zip_bytes(&buf, parent, depth + 1)?;
        } else {
            vault_write::cache::write(&dest, &buf)?;
        }
    }
    Ok(())
}

fn detect_format(root: &Path) -> ImportFormat {
    let (mut notion_hex, mut has_csv, mut has_md, mut any_html, mut onenote_html) = (false, false, false, false, false);
    for entry in walkdir::WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        let (p, name) = (entry.path(), entry.file_name().to_string_lossy());
        if entry.file_type().is_file() {
            if name == "_node.toml" {
                return ImportFormat::Notecraft;
            }
            let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
            let mut head = [0u8; 16];
            if ext == "one" || std::fs::File::open(p).and_then(|mut f| f.read(&mut head)).is_ok_and(|n| n == 16 && head == MS_ONE_MAGIC) {
                return ImportFormat::Onenote;
            }
            match ext.as_str() {
                "csv" => has_csv = true,
                "md" => has_md = true,
                "html" | "htm" => {
                    any_html = true;
                    let mut buf = vec![0u8; 16384];
                    if let Ok(n) = std::fs::File::open(p).and_then(|mut f| f.read(&mut buf)) {
                        let s = String::from_utf8_lossy(&buf[..n]).to_ascii_lowercase();
                        onenote_html |= s.contains("onenote") || s.contains("data-tag=");
                    }
                }
                _ => {}
            }
        }
        notion_hex |= notion::has_notion_hex_id(&name);
    }
    if onenote_html || (any_html && !has_md && !notion_hex && !has_csv) { ImportFormat::Onenote } else { ImportFormat::Notion }
}

fn run_folder_import(ws: &Workspace, source_root: &Path, format: ImportFormat, target_dir: &str) -> Result<ImportReport> {
    let clean_target = normalize_target_dir(ws, target_dir)?;
    let actual = if format == ImportFormat::Auto { detect_format(source_root) } else { format };
    let detected_format = match actual {
        ImportFormat::Notecraft => "notecraft",
        ImportFormat::Onenote => "onenote",
        ImportFormat::Notion | ImportFormat::Auto => "notion",
    };
    let mut report = ImportReport { detected_format: detected_format.into(), target_dir: clean_target.clone(), ..Default::default() };
    match actual {
        ImportFormat::Notion | ImportFormat::Auto => notion::import_dir(ws, source_root, &clean_target, &mut report)?,
        ImportFormat::Notecraft => notecraft_onenote::import_notecraft_dir(ws, source_root, &clean_target, &mut report)?,
        ImportFormat::Onenote => notecraft_onenote::import_onenote_dir(ws, source_root, &clean_target, &mut report)?,
    }
    Ok(report)
}

pub fn import_archive_bytes(
    ws: &Workspace, bytes: &[u8], format: ImportFormat, target_dir: &str, filename: Option<&str>,
) -> Result<ImportReport> {
    let tmp = TempCacheDir::new(ws, "import-tmp")?;
    if bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(b"PK\x05\x06") || filename.is_some_and(|f| f.to_ascii_lowercase().ends_with(".zip")) {
        extract_zip_bytes(bytes, tmp.path(), 0)?;
    } else {
        let fallback = if bytes.starts_with(&MS_ONE_MAGIC) {
            "Imported.one"
        } else if bytes.iter().copied().find(|b| !b.is_ascii_whitespace()) == Some(b'<') {
            "Imported.html"
        } else {
            "Imported.md"
        };
        vault_write::cache::write(&tmp.path().join(sanitize_filename(filename.unwrap_or(fallback), "Imported")), bytes)?;
    }
    run_folder_import(ws, tmp.path(), format, target_dir)
}

pub fn import_bundle(ws: &Workspace, req: &ImportBundleRequest) -> Result<ImportReport> {
    if req.files.is_empty() {
        return Err(Error::BadRequest("import bundle contains no files".into()));
    }
    let tmp = TempCacheDir::new(ws, "import-tmp")?;
    for f in &req.files {
        let Some(rel) = enclosed_rel(&f.rel_path) else { continue };
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(f.data_base64.trim())
            .map_err(|e| Error::BadRequest(format!("invalid base64 for {}: {e}", f.rel_path)))?;
        if req.files.len() == 1 && (bytes.starts_with(b"PK\x03\x04") || rel.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("zip"))) {
            extract_zip_bytes(&bytes, tmp.path(), 0)?;
        } else {
            vault_write::cache::write(&tmp.path().join(rel), &bytes)?;
        }
    }
    run_folder_import(ws, tmp.path(), req.format, &req.target_dir)
}

pub fn import_local_path(ws: &Workspace, req: &ImportPathRequest) -> Result<ImportReport> {
    let src = Path::new(req.source_path.trim());
    if !src.exists() {
        return Err(Error::NotFound(req.source_path.clone()));
    }
    if src.is_dir() {
        run_folder_import(ws, src, req.format, &req.target_dir)
    } else {
        import_archive_bytes(ws, &std::fs::read(src)?, req.format, &req.target_dir, src.file_name().and_then(|n| n.to_str()))
    }
}
