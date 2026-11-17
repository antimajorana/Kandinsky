//! Zero-copy external PDF roots (`external_pdf_roots` on the `references` plugin, e.g. `../Papers` on a shared cloud
//! drive). Every external file access goes through [`resolve_external_file`], which demands an explicit configured root
//! prefix and validates the subpath inside that root with [`kandinsky_text::paths::safe_join`] — no arbitrary `..`
//! traversal, no OS symlinks or hard-links, and no `.md` notes written outside the vault.
use crate::config::Config;
use crate::{paths, pdf_marks, vault_write, Error, Result};
use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};
use std::path::{Path, PathBuf};

/// Effective external-pool settings read from the active `references` plugin (`catalog-papers`).
#[derive(Debug, Clone)]
pub struct Settings {
    pub roots: Vec<String>,
    pub annotations_mode: String,
    pub sidecar_dir: String,
    pub refs_dir: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            roots: Vec::new(),
            annotations_mode: "vault".into(),
            sidecar_dir: String::new(),
            refs_dir: "refs/papers".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SidecarSyncResult {
    pub sidecar_path: String,
    pub marks: usize,
    pub note: Option<String>,
}

/// Reads the `references` plugin's settings (falling back to `.kandinsky/plugin-settings/catalog-papers.toml` when
/// `catalog` UI peer is absent in headless/test runs, unless `catalog-papers` is switched off).
pub fn settings(root: &Path, cfg: &Config) -> Settings {
    let all = crate::plugins::list(root);
    let active = crate::plugins::provider(&all, &cfg.plugins.off, "references").or_else(|| {
        all.iter().find(|p| {
            p.provides.iter().any(|r| r == "references")
                && p.error.is_none()
                && !cfg.plugins.off.iter().any(|o| o == &p.id)
        })
    });
    if let Some(p) = active {
        return from_json(&p.settings);
    }
    if cfg.plugins.off.iter().any(|o| o == "catalog-papers") {
        return Settings::default();
    }
    let fallback = crate::state_dir::join(root, ".kandinsky/plugin-settings/catalog-papers.toml");
    let Ok(text) = std::fs::read_to_string(fallback) else { return Settings::default() };
    let Ok(tbl) = toml::from_str::<toml::Table>(&text) else { return Settings::default() };
    from_json(&serde_json::to_value(tbl).unwrap_or_default())
}

fn from_json(v: &serde_json::Value) -> Settings {
    let mut s = Settings::default();
    if let Some(arr) = v.get("external_pdf_roots").and_then(|x| x.as_array()) {
        s.roots = arr
            .iter()
            .filter_map(|i| i.as_str().map( clean_prefix ))
            .filter(|p| !p.is_empty())
            .collect();
    }
    if let Some(m) = v.get("annotations_mode").and_then(|x| x.as_str()).filter(|m| !m.trim().is_empty()) {
        s.annotations_mode = m.trim().to_string();
    }
    if let Some(d) = v.get("sidecar_dir").and_then(|x| x.as_str()) {
        s.sidecar_dir = d.trim().replace('\\', "/").trim_matches('/').to_string();
    }
    if let Some(d) = v.get("dir").and_then(|x| x.as_str()).filter(|d| !d.trim().is_empty()) {
        s.refs_dir = d.trim().replace('\\', "/").trim_matches('/').to_string();
    }
    s
}

fn clean_prefix(raw: &str) -> String {
    let s = raw.trim().replace('\\', "/");
    let s = s.trim_start_matches("./").trim_end_matches('/');
    s.to_string()
}

fn expand_root(vault_root: &Path, configured: &str) -> Result<(PathBuf, Vec<String>)> {
    let expanded = if let Some(rest) = configured.strip_prefix("~/") {
        let home = std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from)
            .ok_or_else(|| Error::BadPath("HOME is not set".into()))?;
        home.join(rest)
    } else {
        let p = Path::new(configured);
        if p.is_absolute() { p.to_path_buf() } else { vault_root.join(configured) }
    };
    let canon = paths::real(&expanded)
        .map_err(|e| Error::BadPath(format!("external root {configured}: {e}")))?;
    if !canon.is_dir() {
        return Err(Error::BadPath(format!("external root {configured} is not a directory")));
    }
    let mut prefixes = vec![clean_prefix(configured)];
    if let Some(rel) = relative_between(vault_root, &canon) {
        if !prefixes.contains(&rel) {
            prefixes.push(rel);
        }
    }
    let canon_slash = canon.to_string_lossy().replace('\\', "/").trim_end_matches('/').to_string();
    if !prefixes.contains(&canon_slash) {
        prefixes.push(canon_slash);
    }
    Ok((canon, prefixes))
}

/// Relative forward-slash path from `from_dir` to `to_dir` when they share a filesystem prefix.
pub fn relative_between(from_dir: &Path, to_dir: &Path) -> Option<String> {
    let a = paths::real(from_dir).ok()?;
    let b = paths::real(to_dir).ok()?;
    let ac: Vec<_> = a.components().collect();
    let bc: Vec<_> = b.components().collect();
    let common = ac.iter().zip(&bc).take_while(|(x, y)| x == y).count();
    if common == 0 {
        return None;
    }
    let mut parts: Vec<String> = vec!["..".into(); ac.len() - common];
    for c in &bc[common..] {
        parts.push(c.as_os_str().to_string_lossy().into_owned());
    }
    Some(parts.join("/"))
}

/// Resolves `rel` (e.g. `../Papers/Sub/Author2024.pdf`) strictly inside one of the vault's configured
/// `external_pdf_roots`. Returns `(canonical_root, sub_rel, resolved_abs)`.
pub fn resolve_in_roots(root: &Path, cfg: &Config, rel: &str) -> Result<(PathBuf, String, PathBuf)> {
    let s = settings(root, cfg);
    if s.roots.is_empty() {
        return Err(Error::BadPath(format!("path escapes workspace: {rel}")));
    }
    let norm = clean_prefix(rel);
    if norm.is_empty() {
        return Err(Error::BadPath("empty external path".into()));
    }
    for (idx, r) in s.roots.iter().enumerate() {
        let Ok((canon_root, mut prefixes)) = expand_root(root, r) else { continue };
        prefixes.push(format!("@ext/{idx}"));
        for pfx in prefixes {
            if norm == pfx {
                return Ok((canon_root.clone(), String::new(), canon_root));
            }
            if let Some(sub) = norm.strip_prefix(&format!("{pfx}/")) {
                let joined = paths::safe_join(&canon_root, sub)?;
                return Ok((canon_root, sub.to_string(), joined));
            }
        }
    }
    Err(Error::BadPath(format!("path {rel} is outside external_pdf_roots")))
}

/// Resolves an external file path strictly inside configured `external_pdf_roots`.
pub fn resolve_external_file(root: &Path, cfg: &Config, rel: &str) -> Result<PathBuf> {
    resolve_in_roots(root, cfg, rel).map(|(_, _, p)| p)
}

/// Whether `rel` resolves inside configured `external_pdf_roots`.
pub fn is_external_path(root: &Path, cfg: &Config, rel: &str) -> bool {
    resolve_in_roots(root, cfg, rel).is_ok()
}

fn unquote_wikilink(raw: &str) -> String {
    let t = raw.trim().trim_matches(['"', '\'']);
    let inner = t.strip_prefix("[[").and_then(|s| s.strip_suffix("]]")).unwrap_or(t);
    let target = inner.split('|').next().unwrap_or(inner).split('#').next().unwrap_or(inner);
    clean_prefix(target)
}

fn note_pdf_candidates(fm: &Mapping) -> Vec<String> {
    let mut out = Vec::new();
    for key in ["pdf", "external_pdf", "files"] {
        match fm.get(key) {
            Some(Value::String(s)) => {
                let p = unquote_wikilink(s);
                if !p.is_empty() && (key != "files" || p.to_ascii_lowercase().ends_with(".pdf")) && !out.contains(&p) {
                    out.push(p);
                }
            }
            Some(Value::Sequence(seq)) => {
                for item in seq.iter().filter_map(Value::as_str) {
                    let p = unquote_wikilink(item);
                    if !p.is_empty() && (key != "files" || p.to_ascii_lowercase().ends_with(".pdf")) && !out.contains(&p) {
                        out.push(p);
                    }
                }
            }
            _ => {}
        }
    }
    out
}

/// Finds an existing `<refs.dir>/<citekey>/<citekey>.md` note in the vault that owns `pdf_rel`.
pub fn owner_note_for_external_pdf(root: &Path, cfg: &Config, pdf_rel: &str) -> Option<String> {
    let (_, _, want_abs) = resolve_in_roots(root, cfg, pdf_rel).ok()?;
    let want_norm = clean_prefix(pdf_rel);
    let s = settings(root, cfg);
    let refs_abs = paths::safe_join(root, &s.refs_dir).ok()?;
    for entry in std::fs::read_dir(&refs_abs).ok()?.flatten() {
        if !entry.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        let key = entry.file_name().to_string_lossy().into_owned();
        let note_rel = format!("{}/{key}/{key}.md", s.refs_dir);
        let note_abs = entry.path().join(format!("{key}.md"));
        let Ok(head) = std::fs::read_to_string(&note_abs) else { continue };
        let Some(fm_str) = kandinsky_text::frontmatter::split(&head).0 else { continue };
        let Ok(fm) = serde_yaml::from_str::<Mapping>(fm_str) else { continue };
        for cand in note_pdf_candidates(&fm) {
            if cand == want_norm {
                return Some(note_rel);
            }
            if let Ok((_, _, cand_abs)) = resolve_in_roots(root, cfg, &cand) {
                if cand_abs == want_abs {
                    return Some(note_rel);
                }
            }
        }
    }
    None
}

/// Vault-internal fallback note path (`<refs.dir>/<slug>/<slug>.md`) when an uncataloged external PDF gets marks.
pub fn fallback_vault_note_for_external(root: &Path, cfg: &Config, pdf_rel: &str) -> String {
    let s = settings(root, cfg);
    let file = pdf_rel.replace('\\', "/");
    let stem = file.rsplit('/').next().unwrap_or(&file);
    let stem = stem.rsplit_once('.').map_or(stem, |(a, _)| a);
    let slug = paths::slugify(stem);
    let slug = if slug.is_empty() { "paper".to_string() } else { slug };
    format!("{}/{slug}/{slug}.md", s.refs_dir)
}

/// If `note_rel` has a `pdf:` or `files:` frontmatter entry pointing to an existing vault or external PDF, returns it.
pub fn pdf_from_note_frontmatter(root: &Path, cfg: &Config, note_rel: &str) -> Option<String> {
    let abs = paths::safe_join(root, note_rel).ok()?;
    let text = std::fs::read_to_string(abs).ok()?;
    let fm_str = kandinsky_text::frontmatter::split(&text).0?;
    let fm: Mapping = serde_yaml::from_str(fm_str).ok()?;
    for cand in note_pdf_candidates(&fm) {
        if paths::safe_join(root, &cand).is_ok_and(|p| p.is_file()) {
            return Some(cand);
        }
        if resolve_external_file(root, cfg, &cand).is_ok_and(|p| p.is_file()) {
            return Some(cand);
        }
    }
    None
}

/// Every external PDF currently linked from `<refs.dir>/*/<citekey>.md`, as `(abs_path, canonical_rel)`.
pub fn linked_external_pdfs(root: &Path, cfg: &Config) -> Vec<(PathBuf, String)> {
    let s = settings(root, cfg);
    if s.roots.is_empty() {
        return Vec::new();
    }
    let Ok(refs_abs) = paths::safe_join(root, &s.refs_dir) else { return Vec::new() };
    let Ok(entries) = std::fs::read_dir(refs_abs) else { return Vec::new() };
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for entry in entries.flatten() {
        if !entry.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        let key = entry.file_name().to_string_lossy().into_owned();
        let Ok(text) = std::fs::read_to_string(entry.path().join(format!("{key}.md"))) else { continue };
        let Some(fm_str) = kandinsky_text::frontmatter::split(&text).0 else { continue };
        let Ok(fm) = serde_yaml::from_str::<Mapping>(fm_str) else { continue };
        for cand in note_pdf_candidates(&fm) {
            if let Ok((_, _, abs)) = resolve_in_roots(root, cfg, &cand) {
                if abs.is_file() && seen.insert(abs.clone()) {
                    out.push((abs, cand));
                }
            }
        }
    }
    out
}

/// Path of the shared `.kandinsky-marks` sidecar for an external PDF `pdf_rel`.
pub fn sidecar_path_for(root: &Path, cfg: &Config, pdf_rel: &str) -> Result<PathBuf> {
    let s = settings(root, cfg);
    let (ext_root, sub, ext_abs) = resolve_in_roots(root, cfg, pdf_rel)?;
    if sub.is_empty() {
        return Err(Error::BadPath("cannot create sidecar for root folder".into()));
    }
    if s.sidecar_dir.is_empty() {
        let mut os = ext_abs.into_os_string();
        os.push(".kandinsky-marks");
        Ok(PathBuf::from(os))
    } else {
        let rel = format!("{}/{sub}.kandinsky-marks", s.sidecar_dir);
        paths::safe_join(&ext_root, &rel)
    }
}

pub fn read_sidecar_block(root: &Path, cfg: &Config, pdf_rel: &str) -> Option<pdf_marks::Block> {
    let path = sidecar_path_for(root, cfg, pdf_rel).ok()?;
    let text = std::fs::read_to_string(path).ok()?;
    Some(pdf_marks::read(&text))
}

pub fn write_sidecar_block(root: &Path, cfg: &Config, pdf_rel: &str, block: &pdf_marks::Block) -> Result<PathBuf> {
    let path = sidecar_path_for(root, cfg, pdf_rel)?;
    let merged = match std::fs::read_to_string(&path).ok() {
        Some(existing) => pdf_marks::merge(&pdf_marks::read(&existing), block),
        None => block.clone(),
    };
    let content = pdf_marks::write("", &merged);
    vault_write::outside::write(&path, content.as_bytes())?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, PathBuf, PathBuf, Config) {
        let parent = tempfile::tempdir().unwrap();
        let vault = parent.path().join("VaultA");
        let pool = parent.path().join("Papers");
        let secret = parent.path().join("Secret");
        std::fs::create_dir_all(vault.join(".kandinsky/plugin-settings")).unwrap();
        std::fs::create_dir_all(vault.join("refs/papers/maier2005")).unwrap();
        std::fs::create_dir_all(pool.join("CondMat")).unwrap();
        std::fs::create_dir_all(&secret).unwrap();
        std::fs::write(pool.join("CondMat/Maier2005.pdf"), b"%PDF-1.4").unwrap();
        std::fs::write(secret.join("private.pdf"), b"%PDF-1.4").unwrap();
        std::fs::write(
            vault.join(".kandinsky/plugin-settings/catalog-papers.toml"),
            "external_pdf_roots = [\"../Papers\"]\n",
        )
        .unwrap();
        (parent, paths::real(&vault).unwrap(), paths::real(&pool).unwrap(), Config::default())
    }

    #[test]
    fn resolves_configured_external_root_and_rejects_any_escape() {
        let (_d, vault, pool, cfg) = setup();
        let ok = resolve_external_file(&vault, &cfg, "../Papers/CondMat/Maier2005.pdf").unwrap();
        assert_eq!(ok, pool.join("CondMat/Maier2005.pdf"));
        assert!(resolve_external_file(&vault, &cfg, "../Secret/private.pdf").is_err(), "unconfigured sibling rejected");
        assert!(resolve_external_file(&vault, &cfg, "../Papers/../Secret/private.pdf").is_err(), "dotdot escape rejected");
        assert!(resolve_external_file(&vault, &cfg, "../Papers_evil/x.pdf").is_err(), "prefix collision rejected");
    }

    #[test]
    fn maps_external_pdf_to_vault_citekey_note_and_sidecar() {
        let (_d, vault, pool, cfg) = setup();
        std::fs::write(
            vault.join("refs/papers/maier2005/maier2005.md"),
            "---\ncitekey: maier2005\npdf: ../Papers/CondMat/Maier2005.pdf\n---\n# Maier\n",
        )
        .unwrap();
        assert_eq!(
            owner_note_for_external_pdf(&vault, &cfg, "../Papers/CondMat/Maier2005.pdf").as_deref(),
            Some("refs/papers/maier2005/maier2005.md")
        );
        assert_eq!(
            pdf_from_note_frontmatter(&vault, &cfg, "refs/papers/maier2005/maier2005.md").as_deref(),
            Some("../Papers/CondMat/Maier2005.pdf")
        );
        assert_eq!(linked_external_pdfs(&vault, &cfg).len(), 1);
        let mut b = pdf_marks::Block::default();
        let m = pdf_marks::Mark {
            id: pdf_marks::MarkId::parse("m-12345678").unwrap(),
            page: 1,
            version: 1,
            color: None,
            device: None,
            created: None,
            tags: vec![],
            body: pdf_marks::Body::Bookmark { title: "Intro".into() },
        };
        pdf_marks::apply(&mut b, vec![pdf_marks::Op::Put { mark: Box::new(m) }]);
        let sc = write_sidecar_block(&vault, &cfg, "../Papers/CondMat/Maier2005.pdf", &b).unwrap();
        assert_eq!(sc, pool.join("CondMat/Maier2005.pdf.kandinsky-marks"));
        assert_eq!(read_sidecar_block(&vault, &cfg, "../Papers/CondMat/Maier2005.pdf").unwrap().live().len(), 1);
    }

    #[test]
    fn maps_external_pdf_frontmatter_key_to_owner_note() {
        let (_d, vault, _pool, cfg) = setup();
        let note_dir = vault.join("refs/papers/maier2005ext");
        std::fs::create_dir_all(&note_dir).unwrap();
        std::fs::write(
            note_dir.join("maier2005ext.md"),
            "---\ncitekey: maier2005ext\nexternal_pdf: ../Papers/CondMat/Maier2005.pdf\n---\n# Maier\n",
        )
        .unwrap();
        assert_eq!(
            owner_note_for_external_pdf(&vault, &cfg, "../Papers/CondMat/Maier2005.pdf").as_deref(),
            Some("refs/papers/maier2005ext/maier2005ext.md")
        );
        assert_eq!(
            pdf_from_note_frontmatter(&vault, &cfg, "refs/papers/maier2005ext/maier2005ext.md").as_deref(),
            Some("../Papers/CondMat/Maier2005.pdf")
        );
        assert_eq!(linked_external_pdfs(&vault, &cfg).len(), 1);
    }
}
