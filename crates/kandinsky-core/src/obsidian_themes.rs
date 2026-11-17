//! Loads optional `.obsidian/themes/<Name>/theme.css` community themes with broken-theme validation.
use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;
use ts_rs::TS;

const MAX_THEME_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ObsidianThemeInfo {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub author: String,
    pub valid: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct Manifest {
    #[serde(default)]
    name: String,
    #[serde(default)]
    version: String,
    #[serde(default)]
    author: String,
}

fn validate_theme_css(raw: &str) -> std::result::Result<(), String> {
    if raw.contains('\0') {
        return Err("theme CSS contains binary null bytes".into());
    }
    let mut depth: i32 = 0;
    let mut in_comment = false;
    let bytes = raw.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if in_comment {
            if bytes[i] == b'*' && bytes.get(i + 1) == Some(&b'/') {
                in_comment = false;
                i += 2;
                continue;
            }
        } else if bytes[i] == b'/' && bytes.get(i + 1) == Some(&b'*') {
            in_comment = true;
            i += 2;
            continue;
        } else if bytes[i] == b'{' {
            depth += 1;
        } else if bytes[i] == b'}' {
            depth -= 1;
            if depth < 0 {
                return Err("unmatched `}` brace in theme CSS".into());
            }
        }
        i += 1;
    }
    if depth != 0 {
        return Err("unclosed `{` brace in theme CSS".into());
    }
    Ok(())
}

pub fn list(root: &Path) -> Vec<ObsidianThemeInfo> {
    let dir = root.join(".obsidian/themes");
    let Ok(rd) = std::fs::read_dir(&dir) else { return Vec::new() };
    let mut out = Vec::new();
    for entry in rd.flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let Some(id) = entry.file_name().to_str().map(str::to_string) else { continue };
        if id.starts_with('.') {
            continue;
        }
        let css_path = p.join("theme.css");
        if !css_path.is_file() {
            continue;
        }
        let manifest: Manifest = std::fs::read_to_string(p.join("manifest.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        let name = if manifest.name.trim().is_empty() { id.clone() } else { manifest.name };
        let validation = match std::fs::metadata(&css_path) {
            Ok(m) if m.len() > MAX_THEME_BYTES => Err("theme.css exceeds 2 MB limit".to_string()),
            Ok(_) => match std::fs::read_to_string(&css_path) {
                Ok(s) => validate_theme_css(&s),
                Err(e) => Err(format!("could not read theme.css: {e}")),
            },
            Err(e) => Err(e.to_string()),
        };
        out.push(ObsidianThemeInfo {
            id,
            name,
            version: manifest.version,
            author: manifest.author,
            valid: validation.is_ok(),
            error: validation.err(),
        });
    }
    out.sort_by_key(|a| a.name.to_lowercase());
    out
}

pub fn read_css(root: &Path, id: &str) -> Result<String> {
    let clean = id.trim();
    if clean.is_empty() || clean == "." || clean == ".." || clean.contains(['/', '\\']) {
        return Err(Error::BadRequest(format!("invalid theme id `{id}`")));
    }
    let css_path = root.join(".obsidian/themes").join(clean).join("theme.css");
    let meta = std::fs::metadata(&css_path).map_err(|_| Error::NotFound(format!("theme `{clean}` not found")))?;
    if meta.len() > MAX_THEME_BYTES {
        return Err(Error::TooLarge(format!("theme `{clean}` exceeds 2 MB")));
    }
    let css = std::fs::read_to_string(&css_path)?;
    validate_theme_css(&css).map_err(Error::BadRequest)?;
    Ok(css)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scans_valid_and_reports_corrupt_obsidian_themes() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join(".obsidian/themes/Minimal")).unwrap();
        std::fs::write(d.path().join(".obsidian/themes/Minimal/manifest.json"), r#"{"name":"Minimal","version":"7.0"}"#).unwrap();
        std::fs::write(d.path().join(".obsidian/themes/Minimal/theme.css"), ".theme-dark { --background-primary: #111; }").unwrap();

        std::fs::create_dir_all(d.path().join(".obsidian/themes/Broken")).unwrap();
        std::fs::write(d.path().join(".obsidian/themes/Broken/theme.css"), ".theme-dark { color: red;").unwrap();

        let themes = list(d.path());
        assert_eq!(themes.len(), 2);
        let broken = themes.iter().find(|t| t.id == "Broken").unwrap();
        assert!(!broken.valid && broken.error.is_some());
        let minimal = themes.iter().find(|t| t.id == "Minimal").unwrap();
        assert!(minimal.valid);
        assert!(read_css(d.path(), "Minimal").unwrap().contains("--background-primary"));
        assert!(read_css(d.path(), "Broken").is_err());
    }
}
