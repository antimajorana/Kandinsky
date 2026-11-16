//! The plugin's settings (`[[setting]]` in plugin.toml; values in `.kandinsky/plugin-settings/catalog-papers.toml`): what
//! the core's `[refs]` table was (config.rs `RefsConfig`), plus shared external PDF roots, inbox organization, and PDF sources.
use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
pub struct Settings {
    /// The references' folder: one folder per entry, `<key>/<key>.md` and its PDF (when kept inside the vault).
    pub dir: String,
    /// The BibTeX file rewritten after every change.
    pub bib: String,
    /// Fetch the open-access PDF when adding by DOI or arXiv id.
    pub download_pdfs: bool,
    /// Sent with the open-access lookups (OpenAlex, Unpaywall), as they ask; Unpaywall only with it.
    pub email: String,
    /// Answer the Zotero browser extension on 127.0.0.1:23119 while the plugin is on.
    pub connector: bool,
    /// Ask the PDF sources other plugins add when the built-in ones found none.
    pub pdf_sources_on: bool,
    /// Their order: plugin ids, `-id` switches one off.
    pub pdf_order: String,
    /// The open-access indexes asked after OpenAlex and Unpaywall, in order (remote::Index); empty: all of them.
    pub indexes: String,
    /// Shared external PDF roots (e.g. `["../Papers"]`), linked in place with zero copying and zero OS symlinks/hard-links.
    pub external_pdf_roots: Vec<String>,
    /// File newly downloaded, dropped, or browser-captured PDFs into `external_pdf_roots[0]` using `rename_format`.
    pub store_in_external: bool,
    /// Optional watched folder for newly dropped PDFs (e.g. `"../Papers/Sort"`).
    pub watch_inbox: String,
    /// Filename template when filing into an external root or organizing `watch_inbox`.
    pub rename_format: String,
    /// Optional destination subfolder presets inside `external_pdf_roots[0]`.
    pub subfolder_presets: Vec<String>,
    /// `"vault"` (default) or `"shared_sidecar"`.
    pub annotations_mode: String,
    /// Optional sidecar folder when `annotations_mode == "shared_sidecar"`.
    pub sidecar_dir: String,
    /// Optional folder for unpacked arXiv LaTeX sources (blank -> `.kandinsky/cache/arxiv-src`).
    pub arxiv_source_dir: String,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            dir: "refs/papers".into(),
            bib: "refs/refs.bib".into(),
            download_pdfs: true,
            email: String::new(),
            connector: false,
            pdf_sources_on: true,
            pdf_order: String::new(),
            indexes: String::new(),
            external_pdf_roots: Vec::new(),
            store_in_external: true,
            watch_inbox: String::new(),
            rename_format: "{Author}{Year} - {Title}.pdf".into(),
            subfolder_presets: Vec::new(),
            annotations_mode: "vault".into(),
            sidecar_dir: String::new(),
            arxiv_source_dir: String::new(),
        }
    }
}

fn clean_rel(raw: &str) -> String {
    raw.trim().replace('\\', "/").trim_end_matches('/').to_string()
}

fn list_of(o: &serde_json::Map<String, Value>, key: &str) -> Vec<String> {
    match o.get(key) {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(Value::as_str)
            .map(clean_rel)
            .filter(|s| !s.is_empty())
            .collect(),
        Some(Value::String(s)) => s
            .lines()
            .flat_map(|l| l.split(','))
            .map(clean_rel)
            .filter(|x| !x.is_empty())
            .collect(),
        _ => Vec::new(),
    }
}

impl Settings {
    /// From the form's values; a field missing or of the wrong shape keeps its default, a blank folder too.
    pub fn from_value(v: &Value) -> Settings {
        let mut s = Settings::default();
        let Some(o) = v.as_object() else { return s };
        let text = |k: &str| o.get(k).and_then(Value::as_str).map(|t| t.trim().to_string());
        let flag = |k: &str| o.get(k).and_then(Value::as_bool);
        if let Some(d) = text("dir").map(|d| clean_rel(&d).trim_matches('/').to_string()).filter(|d| !d.is_empty()) {
            s.dir = d;
        }
        if let Some(b) = text("bib").map(|b| clean_rel(&b).trim_start_matches('/').to_string()).filter(|b| !b.is_empty()) {
            s.bib = b;
        }
        s.email = text("email").unwrap_or_default();
        s.pdf_order = text("pdf_order").unwrap_or_default();
        s.indexes = text("indexes").unwrap_or_default();
        s.download_pdfs = flag("download_pdfs").unwrap_or(s.download_pdfs);
        s.connector = flag("connector").unwrap_or(s.connector);
        s.pdf_sources_on = flag("pdf_sources_on").unwrap_or(s.pdf_sources_on);
        s.external_pdf_roots = list_of(o, "external_pdf_roots");
        s.store_in_external = flag("store_in_external").unwrap_or(s.store_in_external);
        if let Some(w) = text("watch_inbox") {
            s.watch_inbox = clean_rel(&w);
        }
        if let Some(fmt) = text("rename_format").filter(|f| !f.is_empty()) {
            s.rename_format = fmt;
        }
        s.subfolder_presets = list_of(o, "subfolder_presets");
        if let Some(mode) = text("annotations_mode").filter(|m| matches!(m.as_str(), "vault" | "shared_sidecar")) {
            s.annotations_mode = mode;
        }
        if let Some(sd) = text("sidecar_dir") {
            s.sidecar_dir = clean_rel(&sd);
        }
        if let Some(ad) = text("arxiv_source_dir") {
            s.arxiv_source_dir = clean_rel(&ad);
        }
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_forms_values_with_defaults_where_missing_or_blank() {
        let s = Settings::from_value(&serde_json::json!({
            "dir": "/library/",
            "bib": "",
            "connector": true,
            "download_pdfs": "yes",
            "external_pdf_roots": ["..\\Papers\\", " ../Archive "],
            "watch_inbox": "..\\Papers\\Sort\\",
            "subfolder_presets": ["Physics", "Math"],
        }));
        assert_eq!((s.dir.as_str(), s.bib.as_str(), s.connector, s.download_pdfs), ("library", "refs/refs.bib", true, true));
        assert_eq!(s.external_pdf_roots, vec!["../Papers", "../Archive"]);
        assert_eq!(s.watch_inbox, "../Papers/Sort");
        assert_eq!(s.subfolder_presets, vec!["Physics", "Math"]);
        assert_eq!(Settings::from_value(&Value::Null), Settings::default());
    }
}
