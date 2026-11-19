//! Cross-platform external PDF roots (`external_pdf_roots`): shared folders (such as `../Papers`) read and linked in
//! place with zero copying and zero OS symlinks or hard-links, safe against `..` and symlink escapes, plus collision-free
//! ZotMoov-style filename formatting when filing new PDFs.
use crate::refs::year_of;
use crate::settings::Settings;
use kandinsky_text::paths::{plain, real, rel_path, safe_join};
use serde_yaml::{Mapping, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalRoot {
    /// Configured prefix normalized with forward slashes and no trailing `/` (e.g. `"../Papers"`).
    pub prefix: String,
    /// Canonical filesystem path without Windows `\\?\` verbatim prefix.
    pub root: PathBuf,
}

/// Strips optional `[[target#frag|alias]]` wikilink chrome from a stored `pdf` or `files` value.
pub fn clean_ref_token(raw: &str) -> &str {
    let t = raw.trim();
    let inner = t.strip_prefix("[[").and_then(|s| s.strip_suffix("]]")).unwrap_or(t);
    inner.split('|').next().unwrap_or(inner).split('#').next().unwrap_or(inner).trim()
}

/// Resolves `raw` (relative to `base` when relative) by folding `.`/`..` and canonicalizing the deepest existing
/// ancestor via [`real`] (no `\\?\`), rejecting NUL bytes, broken symlinks, and trailing dots/spaces.
pub fn resolve_dir_from(base: &Path, raw: &str) -> Option<PathBuf> {
    if raw.is_empty() || raw.contains('\0') {
        return None;
    }
    let clean = raw.replace('\\', "/");
    let raw_path = Path::new(&clean);
    let mut lexical = if raw_path.is_absolute() { PathBuf::new() } else { real(base).unwrap_or_else(|_| plain(base)) };
    for comp in raw_path.components() {
        match comp {
            Component::Prefix(p) => lexical.push(p.as_os_str()),
            Component::RootDir => lexical.push(comp.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                if !lexical.pop() {
                    return None;
                }
            }
            Component::Normal(c) => {
                let s = c.to_string_lossy();
                if s.is_empty() || s.ends_with(['.', ' ']) {
                    return None;
                }
                lexical.push(c);
            }
        }
    }
    canonical_or_ancestor(&lexical)
}

pub fn canonical_or_ancestor(p: &Path) -> Option<PathBuf> {
    let s = p.to_string_lossy();
    if s.is_empty() || s.contains('\0') {
        return None;
    }
    let (mut tail, mut probe) = (Vec::new(), p);
    loop {
        match real(probe) {
            Ok(mut resolved) => {
                tail.into_iter().rev().for_each(|seg| resolved.push(seg));
                return Some(resolved);
            }
            Err(_) => {
                if probe.symlink_metadata().is_ok() {
                    return None; // broken symlink or unreadable special node
                }
                let name = probe.file_name()?;
                let ns = name.to_string_lossy();
                if ns.is_empty() || ns == "." || ns == ".." || ns.ends_with(['.', ' ']) {
                    return None;
                }
                tail.push(name.to_os_string());
                probe = probe.parent()?;
            }
        }
    }
}

pub fn external_roots(vault_root: &Path, cfg: &Settings) -> Vec<ExternalRoot> {
    let mut out: Vec<ExternalRoot> = Vec::new();
    for entry in &cfg.external_pdf_roots {
        let prefix = entry.trim().replace('\\', "/").trim_end_matches('/').to_string();
        if let Some(root) = resolve_dir_from(vault_root, &prefix) {
            if !out.iter().any(|e| e.root == root) {
                out.push(ExternalRoot { prefix, root });
            }
        }
    }
    out
}

fn safe_sub_in_root(ext_root: &Path, sub: &str) -> Option<(String, PathBuf)> {
    if sub.contains('\0') {
        return None;
    }
    let mut parts = Vec::new();
    for comp in Path::new(sub).components() {
        match comp {
            Component::Normal(c) => {
                let s = c.to_string_lossy();
                if s.is_empty() || s.ends_with(['.', ' ']) {
                    return None;
                }
                parts.push(s.into_owned());
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    let normalized = (!parts.is_empty()).then(|| parts.join("/"))?;
    let joined = if ext_root.exists() {
        safe_join(ext_root, &normalized).ok()?
    } else {
        parts.iter().fold(ext_root.to_path_buf(), |mut p, seg| {
            p.push(seg);
            p
        })
    };
    Some((normalized, joined))
}

/// Maps an absolute path inside one of `cfg.external_pdf_roots` to `(portable_ref, real_path)` with zero copying.
pub fn path_in_external_roots(vault_root: &Path, cfg: &Settings, abs: &Path) -> Option<(String, PathBuf)> {
    if !abs.is_absolute() { return None; }
    let resolved = canonical_or_ancestor(abs)?;
    for ext in external_roots(vault_root, cfg) {
        if let Some(rel) = rel_path(&ext.root, &resolved) {
            if rel.is_empty() { return Some((ext.prefix, resolved)); }
            let (norm, checked) = safe_sub_in_root(&ext.root, &rel)?;
            return Some((format!("{}/{norm}", ext.prefix), checked));
        }
    }
    None
}

/// Resolves a portable external PDF reference (or absolute path inside an external root) safely against `ext.root`.
pub fn resolve_pdf_ref(vault_root: &Path, cfg: &Settings, raw_ref: &str) -> Option<(String, PathBuf)> {
    let cleaned = clean_ref_token(raw_ref);
    if cleaned.is_empty() || cleaned.contains('\0') { return None; }
    let norm = cleaned.replace('\\', "/");
    for ext in external_roots(vault_root, cfg) {
        if norm == ext.prefix { return Some((ext.prefix, ext.root)); }
        if let Some(sub) = norm.strip_prefix(&format!("{}/", ext.prefix)) {
            let (norm_sub, abs) = safe_sub_in_root(&ext.root, sub)?;
            return Some((format!("{}/{norm_sub}", ext.prefix), abs));
        }
    }
    if Path::new(cleaned).is_absolute() || Path::new(&norm).is_absolute() { path_in_external_roots(vault_root, cfg, Path::new(cleaned)) } else { None }
}

fn str_val(m: &Mapping, k: &str) -> Option<String> {
    match m.get(k)? {
        Value::String(s) => Some(s.trim().to_string()).filter(|x| !x.is_empty()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn surnames_of(m: &Mapping) -> Vec<String> {
    let items: Vec<&str> = match m.get("author") {
        Some(Value::Sequence(seq)) => seq.iter().filter_map(Value::as_str).collect(),
        Some(Value::String(s)) if !s.trim().is_empty() => vec![s.as_str()],
        _ => Vec::new(),
    };
    items
        .into_iter()
        .map(|a| a.split_once(',').map_or_else(|| a.split_whitespace().last().unwrap_or(""), |(l, _)| l.trim()).to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn truncate_clean(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        return s.to_string();
    }
    let cut: String = s.chars().take(max_chars).collect();
    let end = cut.rfind(' ').filter(|&i| i >= max_chars / 2).unwrap_or(cut.len());
    cut[..end].trim_end_matches([',', ';', ':', '-', ' ']).to_string()
}

pub fn sanitize_pdf_filename(raw: &str, fallback: &str) -> String {
    let base = raw.trim();
    let stem = base.strip_suffix(".pdf").or_else(|| base.strip_suffix(".PDF")).unwrap_or(base);
    let cleaned: String = stem
        .chars()
        .map(|c| if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') { ' ' } else { c })
        .collect();
    let mut trimmed = cleaned
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(|c: char| c.is_whitespace() || c == '.' || c == '-')
        .to_string();
    if trimmed.is_empty() {
        trimmed = fallback.chars().filter(|c| c.is_alphanumeric() || matches!(c, '_' | '-')).collect();
    }
    if trimmed.is_empty() {
        trimmed = "paper".into();
    }
    if matches!(trimmed.to_ascii_uppercase().as_str(), "CON" | "PRN" | "AUX" | "NUL" | "COM1" | "COM2" | "COM3" | "COM4" | "COM5" | "COM6" | "COM7" | "COM8" | "COM9" | "LPT1" | "LPT2" | "LPT3" | "LPT4" | "LPT5" | "LPT6" | "LPT7" | "LPT8" | "LPT9") {
        trimmed.push('_');
    }
    format!("{trimmed}.pdf")
}

pub fn format_pdf_filename(fmt: &str, m: &Mapping, fallback_key: &str) -> String {
    let names = surnames_of(m);
    let author = names.first().cloned().unwrap_or_default();
    let authors = match names.len() {
        0 => String::new(),
        1 => names[0].clone(),
        2 => format!("{}, {}", names[0], names[1]),
        _ => format!("{} et al.", names[0]),
    };
    let year = str_val(m, "date").and_then(|d| year_of(&d)).unwrap_or_default();
    let title = truncate_clean(&str_val(m, "title").unwrap_or_default(), 90);
    let key = str_val(m, "citekey").unwrap_or_else(|| fallback_key.to_string());
    let journal = str_val(m, "publicationTitle").unwrap_or_default();
    let tpl = if fmt.trim().is_empty() { "{Author}{Year} - {Title}.pdf" } else { fmt };
    let rendered = tpl.replace("{Author}", &author).replace("{Authors}", &authors).replace("{Year}", &year).replace("{Title}", &title).replace("{Citekey}", &key).replace("{Journal}", &journal);
    sanitize_pdf_filename(&rendered, &key)
}

/// Human-readable root name derived from the last meaningful segment of `ext.prefix` or `ext.root`.
pub fn root_name_for(ext: &ExternalRoot) -> String {
    let from_prefix = ext
        .prefix
        .split('/')
        .rev()
        .find(|seg| !seg.is_empty() && *seg != "." && *seg != "..")
        .map(str::to_string);
    from_prefix
        .or_else(|| ext.root.file_name().map(|n| n.to_string_lossy().into_owned()))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Papers".into())
}

fn is_pdf_file_name(name: &str) -> bool {
    name.len() > 4 && name.as_bytes()[name.len() - 4..].eq_ignore_ascii_case(b".pdf")
}

#[allow(clippy::too_many_arguments)]
fn walk_find_pdf(
    ext: &ExternalRoot,
    ext_real: &Path,
    dir: &Path,
    rel_dir: Option<&str>,
    inbox_real: Option<&Path>,
    visited: &mut HashSet<PathBuf>,
    target_len: u64,
    wanted: &[u8; 32],
) -> Option<(String, PathBuf)> {
    let dir_real = real(dir).ok()?;
    if !dir_real.starts_with(ext_real) || inbox_real.is_some_and(|ib| dir_real == ib || dir_real.starts_with(ib)) {
        return None;
    }
    if !visited.insert(dir_real) {
        return None;
    }
    let rd = std::fs::read_dir(dir).ok()?;
    let mut children: Vec<(String, PathBuf)> = rd
        .flatten()
        .map(|e| (e.file_name().to_string_lossy().into_owned(), e.path()))
        .collect();
    children.sort_by(|a, b| a.0.to_ascii_lowercase().cmp(&b.0.to_ascii_lowercase()).then_with(|| a.0.cmp(&b.0)));

    for (name, path) in children {
        if name.starts_with('.') {
            continue;
        }
        let Ok(resolved) = real(&path) else { continue };
        if !resolved.starts_with(ext_real) {
            continue;
        }
        if resolved.is_dir() {
            if name.eq_ignore_ascii_case("output") {
                continue;
            }
            let next_rel = match rel_dir {
                Some(d) => format!("{d}/{name}"),
                None => name,
            };
            if let Some(found) = walk_find_pdf(ext, ext_real, &resolved, Some(&next_rel), inbox_real, visited, target_len, wanted) {
                return Some(found);
            }
        } else if resolved.is_file()
            && is_pdf_file_name(&name)
            && resolved.metadata().is_ok_and(|md| md.len() == target_len)
            && std::fs::read(&resolved).is_ok_and(|b| <[u8; 32]>::from(Sha256::digest(&b)) == *wanted)
        {
            let rel_file = match rel_dir {
                Some(d) => format!("{d}/{name}"),
                None => name,
            };
            return Some((format!("{}/{rel_file}", ext.prefix), resolved));
        }
    }
    None
}

/// Searches all `external_pdf_roots` recursively (skipping `.`-dirs, `watch_inbox`, and `output` dirs)
/// for an existing byte-identical PDF (length pre-filter + SHA-256), returning `(portable_ref, abs_path)` with zero writes.
pub fn find_existing_external_pdf(vault_root: &Path, cfg: &Settings, bytes: &[u8]) -> Option<(String, PathBuf)> {
    let roots = external_roots(vault_root, cfg);
    if roots.is_empty() {
        return None;
    }
    let inbox_real = crate::inbox_dedupe::resolve_inbox_dir(vault_root, cfg)
        .ok()
        .map(|p| real(&p).unwrap_or(p));
    let target_len = bytes.len() as u64;
    let wanted: [u8; 32] = Sha256::digest(bytes).into();
    for ext in &roots {
        if !ext.root.is_dir() {
            continue;
        }
        let ext_real = real(&ext.root).unwrap_or_else(|_| ext.root.clone());
        let mut visited = HashSet::new();
        if let Some(found) = walk_find_pdf(ext, &ext_real, &ext_real, None, inbox_real.as_deref(), &mut visited, target_len, &wanted) {
            return Some(found);
        }
    }
    None
}

fn select_root_and_sub<'a>(roots: &'a [ExternalRoot], subfolder: Option<&str>) -> (&'a ExternalRoot, Option<String>) {
    let raw_sub = subfolder
        .map(|s| s.trim().replace('\\', "/").trim_matches('/').to_string())
        .filter(|s| !s.is_empty());
    if let Some(ref sub) = raw_sub {
        for ext in roots {
            let rname = root_name_for(ext);
            if sub.eq_ignore_ascii_case(&rname) {
                return (ext, None);
            }
            if let Some((head, tail)) = sub.split_once('/') {
                if head.eq_ignore_ascii_case(&rname) {
                    let rest = tail.trim_matches('/').to_string();
                    return (ext, (!rest.is_empty()).then_some(rest));
                }
            }
        }
    }
    (&roots[0], raw_sub)
}

/// Writes `bytes` into an external root (plus optional `subfolder`) with collision-free `Name - 2.pdf` naming,
/// reusing any existing byte-identical PDF across all `external_pdf_roots` with zero writes and avoiding `<RootName>` doubling.
pub fn write_external_pdf(vault_root: &Path, cfg: &Settings, subfolder: Option<&str>, filename: &str, bytes: &[u8]) -> Result<(String, PathBuf), String> {
    if let Some(existing) = find_existing_external_pdf(vault_root, cfg, bytes) {
        return Ok(existing);
    }
    let roots = external_roots(vault_root, cfg);
    if roots.is_empty() {
        return Err("no external_pdf_roots configured".to_string());
    }
    let (ext, effective_sub) = select_root_and_sub(&roots, subfolder);
    std::fs::create_dir_all(&ext.root).map_err(|e| format!("{}: {e}", ext.root.display()))?;
    let sub = match effective_sub {
        Some(raw_sub) => {
            let (norm_sub, sub_dir) = safe_sub_in_root(&ext.root, &raw_sub).ok_or_else(|| format!("invalid external subfolder: {raw_sub:?}"))?;
            std::fs::create_dir_all(&sub_dir).map_err(|e| format!("{}: {e}", sub_dir.display()))?;
            norm_sub
        }
        None => String::new(),
    };
    let clean_name = sanitize_pdf_filename(filename, "paper");
    let stem = clean_name.strip_suffix(".pdf").unwrap_or(&clean_name);
    let wanted: [u8; 32] = Sha256::digest(bytes).into();
    for n in 1usize.. {
        let cand = if n == 1 { format!("{stem}.pdf") } else { format!("{stem} - {n}.pdf") };
        let rel = if sub.is_empty() { cand } else { format!("{sub}/{cand}") };
        let dest = safe_join(&ext.root, &rel)?;
        if dest.exists() {
            if dest.is_file() && dest.metadata().is_ok_and(|md| md.len() == bytes.len() as u64) && std::fs::read(&dest).is_ok_and(|b| <[u8; 32]>::from(Sha256::digest(&b)) == wanted) {
                return Ok((format!("{}/{rel}", ext.prefix), dest));
            }
            continue;
        }
        kandinsky_plugin::write_file(&dest, bytes).map_err(|e| e.to_string())?;
        return Ok((format!("{}/{rel}", ext.prefix), dest));
    }
    unreachable!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_external_refs_rejects_traversal_and_writes_collision_free() {
        let tmp = tempfile::tempdir().unwrap();
        let ws = real(tmp.path()).unwrap();
        let (vault, pool) = (ws.join("vault"), ws.join("Papers"));
        std::fs::create_dir_all(&vault).unwrap();
        std::fs::create_dir_all(&pool).unwrap();
        std::fs::write(ws.join("secret.pdf"), b"%PDF-secret").unwrap();
        let cfg = Settings { external_pdf_roots: vec!["../Papers".into()], ..Settings::default() };
        assert!(resolve_pdf_ref(&vault, &cfg, "../Papers/../../secret.pdf").is_none());
        assert!(resolve_pdf_ref(&vault, &cfg, "../Papers/../secret.pdf").is_none());
        let m: Mapping = serde_yaml::from_str("title: \"More: Is <Different>?\"\nauthor:\n  - Anderson, P. W.\ndate: 1972-08-04\npublicationTitle: Science\n").unwrap();
        let name = format_pdf_filename("{Author}{Year} - {Title}.pdf", &m, "anderson1972more");
        assert_eq!(name, "Anderson1972 - More Is Different.pdf");
        let (r1, p1) = write_external_pdf(&vault, &cfg, Some("Physics"), &name, b"%PDF-1.4 one").unwrap();
        assert_eq!(r1, "../Papers/Physics/Anderson1972 - More Is Different.pdf");
        assert!(p1.is_file());
        assert_eq!(write_external_pdf(&vault, &cfg, Some("Physics"), &name, b"%PDF-1.4 one").unwrap().0, r1);
        assert_eq!(write_external_pdf(&vault, &cfg, Some("Physics"), &name, b"%PDF-1.4 two").unwrap().0, "../Papers/Physics/Anderson1972 - More Is Different - 2.pdf");
        assert_eq!(path_in_external_roots(&vault, &cfg, &p1).unwrap().0, r1);
        assert_eq!(resolve_pdf_ref(&vault, &cfg, &format!("[[{r1}#page=3]]")).unwrap().0, r1);
    }

    #[test]
    fn finds_existing_external_pdf_zero_copy_and_avoids_root_doubling() {
        let tmp = tempfile::tempdir().unwrap();
        let ws = real(tmp.path()).unwrap();
        let (vault, papers, books, inbox) = (
            ws.join("vault"),
            ws.join("Library/Papers"),
            ws.join("Library/Books"),
            ws.join("Library/Papers/Sort"),
        );
        std::fs::create_dir_all(&vault).unwrap();
        std::fs::create_dir_all(papers.join("Quantum")).unwrap();
        std::fs::create_dir_all(papers.join(".hidden")).unwrap();
        std::fs::create_dir_all(papers.join("output")).unwrap();
        std::fs::create_dir_all(&inbox).unwrap();
        std::fs::create_dir_all(&books).unwrap();

        let cfg = Settings {
            external_pdf_roots: vec!["../Library/Papers".into(), "../Library/Books".into()],
            watch_inbox: "../Library/Papers/Sort".into(),
            ..Settings::default()
        };

        let hidden_bytes = b"%PDF-1.4 hidden";
        let out_bytes = b"%PDF-1.4 build-output";
        let inbox_bytes = b"%PDF-1.4 inbox";
        let real_bytes = b"%PDF-1.4 existing-quantum";
        std::fs::write(papers.join(".hidden/h.pdf"), hidden_bytes).unwrap();
        std::fs::write(papers.join("output/main.pdf"), out_bytes).unwrap();
        std::fs::write(inbox.join("queued.pdf"), inbox_bytes).unwrap();
        std::fs::write(papers.join("Quantum/Existing.pdf"), real_bytes).unwrap();

        assert!(find_existing_external_pdf(&vault, &cfg, hidden_bytes).is_none());
        assert!(find_existing_external_pdf(&vault, &cfg, out_bytes).is_none());
        assert!(find_existing_external_pdf(&vault, &cfg, inbox_bytes).is_none());
        let (found_ref, _) = find_existing_external_pdf(&vault, &cfg, real_bytes).unwrap();
        assert_eq!(found_ref, "../Library/Papers/Quantum/Existing.pdf");

        // write_external_pdf returns existing file with zero writes, and strips matching <RootName> prefix.
        assert_eq!(write_external_pdf(&vault, &cfg, Some("Books"), "NewName.pdf", real_bytes).unwrap().0, found_ref);
        let (bref, bpath) = write_external_pdf(&vault, &cfg, Some("Books/Algebra"), "Artin.pdf", b"%PDF-1.4 artin").unwrap();
        assert_eq!(bref, "../Library/Books/Algebra/Artin.pdf");
        assert!(bpath.is_file() && !books.join("Books").exists());
        let (pref, _) = write_external_pdf(&vault, &cfg, Some("Papers/Field"), "Weinberg.pdf", b"%PDF-1.4 weinberg").unwrap();
        assert_eq!(pref, "../Library/Papers/Field/Weinberg.pdf");
    }
}
