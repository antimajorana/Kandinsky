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

fn skip_comment(bytes: &[u8], i: usize) -> usize {
    let mut j = i + 2;
    while j < bytes.len() {
        if bytes[j] == b'*' && bytes.get(j + 1) == Some(&b'/') {
            return j + 2;
        }
        j += 1;
    }
    bytes.len()
}

fn skip_string(bytes: &[u8], i: usize) -> usize {
    let quote = bytes[i];
    let mut j = i + 1;
    while j < bytes.len() {
        if bytes[j] == b'\\' {
            j += 2;
            continue;
        }
        if bytes[j] == quote {
            return j + 1;
        }
        j += 1;
    }
    bytes.len()
}

fn find_url_end(bytes: &[u8], open_paren: usize) -> usize {
    let mut j = open_paren + 1;
    let mut depth = 1usize;
    while j < bytes.len() {
        if bytes[j] == b'\'' || bytes[j] == b'"' {
            j = skip_string(bytes, j);
            continue;
        }
        if bytes[j] == b'\\' {
            j += 2;
            continue;
        }
        if bytes[j] == b'(' {
            depth += 1;
        } else if bytes[j] == b')' {
            depth -= 1;
            if depth == 0 {
                return j + 1;
            }
        }
        j += 1;
    }
    bytes.len()
}

fn is_url_call(bytes: &[u8], i: usize) -> bool {
    if i + 4 > bytes.len() {
        return false;
    }
    if i > 0 && (bytes[i - 1].is_ascii_alphanumeric() || bytes[i - 1] == b'-' || bytes[i - 1] == b'_') {
        return false;
    }
    bytes[i..i + 4].eq_ignore_ascii_case(b"url(")
}

fn is_at_import(bytes: &[u8], i: usize) -> bool {
    if i + 7 > bytes.len() || !bytes[i..i + 7].eq_ignore_ascii_case(b"@import") {
        return false;
    }
    matches!(bytes.get(i + 7), Some(b' ' | b'\t' | b'\r' | b'\n' | b'\'' | b'"' | b'('))
}

fn skip_at_import(bytes: &[u8], i: usize) -> usize {
    let mut j = i + 7;
    let mut paren_depth = 0usize;
    while j < bytes.len() {
        if bytes[j] == b'/' && bytes.get(j + 1) == Some(&b'*') {
            j = skip_comment(bytes, j);
            continue;
        }
        if bytes[j] == b'\'' || bytes[j] == b'"' {
            j = skip_string(bytes, j);
            continue;
        }
        if bytes[j] == b'\\' {
            j += 2;
            continue;
        }
        if bytes[j] == b'(' {
            paren_depth += 1;
        } else if bytes[j] == b')' && paren_depth > 0 {
            paren_depth -= 1;
        } else if bytes[j] == b';' && paren_depth == 0 {
            return j + 1;
        } else if bytes[j] == b'\n' && paren_depth == 0 {
            // Stop before next rule if someone omitted `;` before `{`.
            if bytes[j + 1..].iter().copied().find(|b| !b.is_ascii_whitespace()).is_none_or(|b| b != b'u') {
                return j + 1;
            }
        } else if bytes[j] == b'{' && paren_depth == 0 {
            return j;
        }
        j += 1;
    }
    bytes.len()
}

fn is_dangerous_url(raw_inner: &str) -> bool {
    let mut s = raw_inner.trim();
    if (s.starts_with('"') && s.ends_with('"') && s.len() >= 2)
        || (s.starts_with('\'') && s.ends_with('\'') && s.len() >= 2)
    {
        s = s[1..s.len() - 1].trim();
    }
    let normalized: String = s
        .chars()
        .filter(|c| !c.is_control() && !c.is_whitespace())
        .collect::<String>()
        .to_ascii_lowercase();
    normalized.starts_with("http:")
        || normalized.starts_with("https:")
        || normalized.starts_with("//")
        || normalized.starts_with("javascript:")
        || normalized.starts_with("vbscript:")
}

fn sanitize_theme_css(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = String::with_capacity(raw.len());
    let mut i = 0;
    let mut copy_from = 0;
    while i < bytes.len() {
        if bytes[i] == b'/' && bytes.get(i + 1) == Some(&b'*') {
            i = skip_comment(bytes, i);
            continue;
        }
        if bytes[i] == b'\'' || bytes[i] == b'"' {
            i = skip_string(bytes, i);
            continue;
        }
        if bytes[i] == b'\\' {
            i = (i + 2).min(bytes.len());
            continue;
        }
        if is_at_import(bytes, i) {
            out.push_str(&raw[copy_from..i]);
            i = skip_at_import(bytes, i);
            copy_from = i;
            continue;
        }
        if is_url_call(bytes, i) {
            let end = find_url_end(bytes, i + 3);
            let inner_end = if end > i + 4 && bytes[end - 1] == b')' { end - 1 } else { end };
            if is_dangerous_url(&raw[i + 4..inner_end]) {
                out.push_str(&raw[copy_from..i]);
                out.push_str("url(\"about:invalid\")");
                i = end;
                copy_from = i;
                continue;
            }
            i = end;
            continue;
        }
        i += 1;
    }
    out.push_str(&raw[copy_from..]);
    out
}

fn validate_theme_css(raw: &str) -> std::result::Result<(), String> {
    if raw.contains('\0') {
        return Err("theme CSS contains binary null bytes".into());
    }
    let mut depth: i32 = 0;
    let bytes = raw.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'/' && bytes.get(i + 1) == Some(&b'*') {
            i = skip_comment(bytes, i);
            continue;
        }
        if bytes[i] == b'\'' || bytes[i] == b'"' {
            i = skip_string(bytes, i);
            continue;
        }
        if bytes[i] == b'\\' {
            i = (i + 2).min(bytes.len());
            continue;
        }
        if is_url_call(bytes, i) {
            i = find_url_end(bytes, i + 3);
            continue;
        }
        if bytes[i] == b'{' {
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
    Ok(sanitize_theme_css(&css))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scans_valid_and_reports_corrupt_obsidian_themes() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join(".obsidian/themes/Minimal")).unwrap();
        std::fs::write(d.path().join(".obsidian/themes/Minimal/manifest.json"), r#"{"name":"Minimal","version":"7.0"}"#).unwrap();
        std::fs::write(
            d.path().join(".obsidian/themes/Minimal/theme.css"),
            ".theme-dark { --background-primary: #111; } .quoted::before { content: \"}{not-a-brace\"; background: url(\"data:image/svg+xml,{}\"); }",
        )
        .unwrap();

        std::fs::create_dir_all(d.path().join(".obsidian/themes/Broken")).unwrap();
        std::fs::write(d.path().join(".obsidian/themes/Broken/theme.css"), ".theme-dark { color: red;").unwrap();

        let themes = list(d.path());
        assert_eq!(themes.len(), 2);
        let broken = themes.iter().find(|t| t.id == "Broken").unwrap();
        assert!(!broken.valid && broken.error.is_some());
        let minimal = themes.iter().find(|t| t.id == "Minimal").unwrap();
        assert!(minimal.valid, "quoted braces should stay valid: {:?}", minimal.error);
        assert!(read_css(d.path(), "Minimal").unwrap().contains("--background-primary"));
        assert!(read_css(d.path(), "Broken").is_err());
    }

    #[test]
    fn strips_external_imports_and_remote_urls() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join(".obsidian/themes/Remote")).unwrap();
        std::fs::write(
            d.path().join(".obsidian/themes/Remote/theme.css"),
            "@import url(\"https://evil.example/a.css\");\n.x { background: url(https://evil.example/leak); mask: url('data:image/svg+xml,<svg/>'); }",
        )
        .unwrap();
        let cleaned = read_css(d.path(), "Remote").unwrap();
        assert!(!cleaned.contains("@import") && !cleaned.contains("https://evil.example"), "{cleaned}");
        assert!(cleaned.contains("url(\"about:invalid\")") && cleaned.contains("data:image/svg+xml"), "{cleaned}");
    }
}
