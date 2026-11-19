//! The references library over plain files: `<dir>/<citekey>/<citekey>.md`, whose properties are the entry's
//! Zotero-shaped fields (entry.rs) + PDFs beside it. Add by DOI / arXiv id / URL (remote.rs), import a PDF, edit,
//! merge, type, delete; `refs.bib` is derived and rewritten after every change. Moved from the core
//! (docs/refactor/REFACTOR-references-plugin.md); everything outside the vault's files goes through a seam — the
//! network ([`Net`]), a new entry's note ([`Companion`]), the Trash ([`Trash`]) — so tests run on a temp folder.
use crate::entry::{self, Companion};
use crate::net::{Miss, Net};
use crate::remote::{self, parse_arxiv, parse_doi};
use crate::settings::Settings;
use kandinsky_text::paths::{rel_path, safe_join};
use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};
use std::path::{Path, PathBuf};

pub type Res<T> = Result<T, String>;

/// Moves a vault path to the Trash (recoverable): the helper's asks the core (`POST /api/fs/trash`); tests move it
/// into the temp vault's `.kandinsky/trash/`. → where it went.
pub trait Trash {
    fn trash(&self, rel: &str) -> Res<String>;
}

// The UI's types (the core's api.rs `Paper`, `PaperAdded`, `PaperEdit`): the same JSON field names.

/// One library entry, summarised from its note's properties (all fields stay there).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Paper {
    pub key: String,
    /// Workspace-relative folder of the entry.
    pub dir: String,
    pub title: String,
    /// Zotero item type (journalArticle, book, preprint, …).
    pub kind: String,
    /// "Last, First" as stored.
    pub authors: Vec<String>,
    pub year: Option<String>,
    pub venue: Option<String>,
    pub doi: Option<String>,
    pub arxiv: Option<String>,
    pub url: Option<String>,
    pub abstract_text: Option<String>,
    pub collections: Vec<String>,
    pub tags: Vec<String>,
    /// Workspace-relative PDF, when there is one.
    pub pdf: Option<String>,
    /// `dateAdded`, "YYYY-MM-DD hh:mm:ss", for sorting.
    pub added: Option<String>,
    pub has_notes: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub isbn: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volume: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issue: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pages: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub publisher: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edition: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub series: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PaperAdded {
    pub paper: Paper,
    /// false when the DOI / arXiv id (or the same PDF) was already in the library.
    pub created: bool,
    pub pdf: bool,
    /// No PDF came and a copy stood behind a sign-in (a publisher's): its address, offered only if no PDF source
    /// finds one either.
    pub gate: Option<String>,
}

/// The fields the References view edits in place (the note's other properties are kept).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct PaperEdit {
    pub key: String,
    pub title: String,
    pub authors: Vec<String>,
    /// A year or a full date.
    pub date: String,
    pub venue: String,
    pub collections: Vec<String>,
    pub tags: Vec<String>,
    pub kind: Option<String>,
    pub doi: Option<String>,
    pub arxiv: Option<String>,
    pub isbn: Option<String>,
    pub volume: Option<String>,
    pub issue: Option<String>,
    pub pages: Option<String>,
    pub publisher: Option<String>,
}

/// How a PDF is filed by `import_pdf_with` (`import`, the References move): its type (`book`, `thesis`, `manuscript`
/// for lecture notes; a paper's comes from its DOI), the collections it joins, and whether the file keeps its own
/// name — so `[[its name.pdf]]` links in the notes still find it.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(default)]
pub struct ImportOpts {
    pub kind: Option<String>,
    pub collections: Vec<String>,
    pub keep_name: bool,
    /// Where the PDF was fetched from (a captured link), kept as the entry's `url`.
    pub url: Option<String>,
    pub subfolder: Option<String>,
}

/// What `fold_all` did (or would do): the entries with an `info.yaml` and how many fields each has, and where the
/// files were copied first.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Folded {
    pub entries: Vec<(String, usize)>,
    pub snapshot: Option<String>,
}

pub(crate) fn s(m: &Mapping, k: &str) -> Option<String> {
    match m.get(k)? {
        Value::String(v) => Some(v.clone()).filter(|v| !v.trim().is_empty()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

pub(crate) fn list(m: &Mapping, k: &str) -> Vec<String> {
    match m.get(k) {
        Some(Value::Sequence(v)) => v.iter().filter_map(|x| x.as_str().map(String::from)).collect(),
        Some(Value::String(v)) => vec![v.clone()],
        _ => Vec::new(),
    }
}

/// The first four-digit run of a date ("1963-11-26", "Nov 1963").
pub fn year_of(date: &str) -> Option<String> {
    date.split(|c: char| !c.is_ascii_digit()).find(|p| p.len() == 4).map(String::from)
}

/// arXiv id from an explicit field, the URL or `extra`.
pub(crate) fn arxiv_of(m: &Mapping) -> Option<String> {
    let hay = [s(m, "arxiv"), s(m, "archiveID"), s(m, "url"), s(m, "extra")].into_iter().flatten().collect::<Vec<_>>().join(" ");
    parse_arxiv(&hay)
}

pub(crate) fn now_stamp() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn io(path: &Path) -> impl Fn(std::io::Error) -> String + '_ {
    move |e| format!("{}: {e}", path.display())
}

/// Better-BibTeX-style key: first author's last name + year + first significant title word; `taken` keys get a letter.
pub fn citekey(authors: &[String], year: Option<&str>, title: &str, taken: &dyn Fn(&str) -> bool) -> String {
    const STOP: &[&str] = &["a", "an", "the", "on", "of", "in", "for", "and", "to", "with", "from", "at", "by", "is", "are"];
    let ascii = |x: &str| -> String {
        crate::pdf_meta::fold_diacritics(x)
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .collect()
    };
    let last = authors.first().map(|a| a.split(',').next().unwrap_or(a).split_whitespace().last().unwrap_or("")).unwrap_or_default();
    let folded_title = crate::pdf_meta::fold_diacritics(title);
    let word = folded_title
        .split(|c: char| !c.is_alphanumeric())
        .find(|w| w.len() > 2 && !STOP.contains(w))
        .unwrap_or_default();
    let base = format!("{}{}{}", ascii(last), year.unwrap_or(""), ascii(word));
    let base = if base.is_empty() { "ref".to_string() } else { base };
    if !taken(&base) {
        return base;
    }
    // past z a number: a taken key would put this paper in another's folder
    ('a'..='z').map(|c| format!("{base}{c}")).chain((2..).map(|n| format!("{base}_{n}"))).find(|k| !taken(k)).expect("an endless list of keys")
}

// --- BibTeX (same mapping as tools/refs_bib.py) -------------------------------------------------------------------

const KIND: &[(&str, &str)] = &[
    ("journalArticle", "article"),
    ("article", "article"),
    ("paper", "article"),
    ("book", "book"),
    ("science_book", "book"),
    ("science-book", "book"),
    ("monograph", "book"),
    ("bookSection", "incollection"),
    ("incollection", "incollection"),
    ("inbook", "incollection"),
    ("thesis", "phdthesis"),
    ("phdthesis", "phdthesis"),
    ("mastersthesis", "mastersthesis"),
    ("conferencePaper", "inproceedings"),
    ("inproceedings", "inproceedings"),
    ("conference", "inproceedings"),
    ("preprint", "misc"),
    ("report", "techreport"),
    ("techreport", "techreport"),
    ("manuscript", "unpublished"),
    ("unpublished", "unpublished"),
    ("notes", "unpublished"),
];
const FIELD: &[(&str, &str)] = &[
    ("title", "title"),
    ("publicationTitle", "journal"),
    ("volume", "volume"),
    ("issue", "number"),
    ("pages", "pages"),
    ("publisher", "publisher"),
    ("place", "address"),
    ("DOI", "doi"),
    ("url", "url"),
    ("ISBN", "isbn"),
    ("ISSN", "issn"),
    ("university", "school"),
    ("series", "series"),
    ("edition", "edition"),
    ("bookTitle", "booktitle"),
    ("proceedingsTitle", "booktitle"),
    ("archiveID", "eprint"),
    ("repository", "publisher"),
];

/// Maps a stored `itemType` / `kind` (Zotero, catalog, or BibTeX alias) to its BibTeX entry type.
pub fn bibtex_kind(item_type: &str) -> &'static str {
    let t = item_type.trim().trim_start_matches('@');
    if let Some((_, b)) = KIND.iter().find(|(z, _)| *z == t) {
        return b;
    }
    let low = t.to_ascii_lowercase();
    KIND.iter()
        .find(|(z, _)| z.to_ascii_lowercase() == low)
        .map(|(_, b)| *b)
        .unwrap_or("misc")
}

/// BibTeX entry type (`article`, `book`, `incollection`, …) for an entry mapping.
pub fn bibtex_type_of(m: &Mapping) -> &'static str {
    s(m, "type").map(|t| bibtex_kind(&t)).unwrap_or("misc")
}

/// High-level library category (`"paper"`, `"book"`, `"thesis"`, `"notes"`) matching UI tabs and `search`.
pub fn normalized_kind(kind: &str) -> &'static str {
    match kind.trim().trim_start_matches('@').to_ascii_lowercase().as_str() {
        "book" | "science_book" | "science-book" | "booksection" | "incollection" | "inbook" | "monograph" => "book",
        "thesis" | "phdthesis" | "mastersthesis" | "dissertation" => "thesis",
        "manuscript" | "unpublished" | "report" | "techreport" | "notes" | "note" => "notes",
        _ => "paper",
    }
}

/// Whether `kind` satisfies a search `item_type` filter (`"paper"`, `"book"`, `"thesis"`, `"notes"`, or an explicit type).
pub fn matches_item_type(kind: &str, filter: &str) -> bool {
    let f = filter.trim().trim_start_matches('@').to_ascii_lowercase();
    if f.is_empty() || f == "all" {
        return true;
    }
    let k = kind.trim().trim_start_matches('@').to_ascii_lowercase();
    match f.as_str() {
        "book" | "books" => normalized_kind(&k) == "book",
        "paper" | "papers" => normalized_kind(&k) == "paper",
        "thesis" | "theses" => normalized_kind(&k) == "thesis",
        "notes" | "note" => normalized_kind(&k) == "notes",
        _ => k == f || bibtex_kind(kind) == f,
    }
}

fn esc(v: &str) -> String {
    v.replace('&', r"\&").replace('%', r"\%").replace('#', r"\#")
}

pub fn bibtex_entry(key: &str, m: &Mapping) -> String {
    let kind = bibtex_type_of(m);
    let mut lines = vec![format!("@{kind}{{{key},")];
    for (role, alt) in [("author", "authors"), ("editor", "editors")] {
        let mut v = list(m, role);
        if v.is_empty() {
            v = list(m, alt);
        }
        if !v.is_empty() {
            lines.push(format!("  {role} = {{{}}},", v.join(" and ")));
        }
    }
    if let Some(y) = s(m, "date").and_then(|d| year_of(&d)).or_else(|| s(m, "year").and_then(|y| year_of(&y))) {
        lines.push(format!("  year = {{{y}}},"));
    }
    let ax_ver = s(m, "arxivVersion").map(|v| if v.starts_with('v') { v } else { format!("v{v}") });
    let mut seen_bib: std::collections::HashSet<&'static str> = std::collections::HashSet::new();
    fn emit_bib(lines: &mut Vec<String>, seen: &mut std::collections::HashSet<&'static str>, bib_field: &'static str, val: &str) {
        let trimmed = val.trim();
        if !trimmed.is_empty() && seen.insert(bib_field) {
            lines.push(format!("  {bib_field} = {{{}}},", esc(trimmed)));
        }
    }
    let mut had_eprint = false;
    for (z, b) in FIELD {
        // `journal` is invalid inside @book, @incollection, @inproceedings, @phdthesis, etc.
        if *z == "publicationTitle" && kind != "article" {
            continue;
        }
        // `repository` (e.g. "arXiv") must not emit `publisher` on books or overwrite an explicit `publisher`.
        if *z == "repository" && (matches!(kind, "book" | "incollection") || seen_bib.contains("publisher")) {
            continue;
        }
        let val = match *z {
            "ISBN" => s(m, "ISBN").or_else(|| s(m, "isbn")),
            _ => s(m, z),
        };
        if *z == "pages" && kind == "book" {
            if let Some(ref p) = val {
                if !p.contains('-') && p.trim().chars().all(|c| c.is_ascii_digit()) {
                    continue;
                }
            }
        }
        if let Some(mut v) = val {
            if *z == "archiveID" {
                had_eprint = true;
                if let Some(ver) = &ax_ver {
                    if !v.ends_with(ver.as_str()) {
                        v = format!("{v}{ver}");
                    }
                }
            }
            emit_bib(&mut lines, &mut seen_bib, b, &v);
        }
    }
    if matches!(kind, "incollection" | "inproceedings") && !seen_bib.contains("booktitle") {
        if let Some(v) = s(m, "publicationTitle") {
            emit_bib(&mut lines, &mut seen_bib, "booktitle", &v);
        }
    }
    if matches!(kind, "phdthesis" | "mastersthesis") && !seen_bib.contains("school") {
        if let Some(v) = s(m, "publisher") {
            emit_bib(&mut lines, &mut seen_bib, "school", &v);
        }
    }
    if !had_eprint && !seen_bib.contains("eprint") {
        if let (Some(ax), Some(ver)) = (s(m, "arxiv"), &ax_ver) {
            emit_bib(&mut lines, &mut seen_bib, "eprint", &format!("arXiv:{ax}{ver}"));
        } else if let Some(ax) = s(m, "arxiv") {
            emit_bib(&mut lines, &mut seen_bib, "eprint", &format!("arXiv:{ax}"));
        }
    }
    lines.push("}".into());
    lines.join("\n")
}

/// Where a plugin's PDF source may leave a download for `attach_pdf`: a plugin's cache (the core's fetch `save_to`).
const PLUGIN_CACHE: &str = ".kandinsky/cache/plugins/";

/// The library of one vault, with its seams.
pub struct Lib<'a> {
    pub root: &'a Path,
    pub cfg: &'a Settings,
    pub net: &'a dyn Net,
    pub made: &'a dyn Companion,
    pub trash: &'a dyn Trash,
}

impl Lib<'_> {
    pub(crate) fn base(&self) -> Res<PathBuf> {
        safe_join(self.root, &self.cfg.dir)
    }

    fn rel(&self, p: &Path) -> String {
        rel_path(self.root, p).unwrap_or_default()
    }

    pub fn pdf_abs_path(&self, raw_ref: &str) -> Option<PathBuf> {
        if let Some((_, abs)) = crate::external::resolve_pdf_ref(self.root, self.cfg, raw_ref) {
            if abs.is_file() {
                return Some(abs);
            }
        }
        let cleaned = crate::external::clean_ref_token(raw_ref);
        safe_join(self.root, cleaned).ok().filter(|p| p.is_file())
    }

    pub fn paper_of(&self, dir: &Path, key: &str, m: &Mapping) -> Paper {
        let key = s(m, "citekey").unwrap_or_else(|| key.to_string());
        let pdf = list(m, "pdf")
            .into_iter()
            .chain(list(m, "external_pdf"))
            .chain(list(m, "files"))
            .find_map(|raw| {
                let f = crate::external::clean_ref_token(&raw);
                if !f.to_ascii_lowercase().ends_with(".pdf") {
                    return None;
                }
                if let Some((portable, abs)) = crate::external::resolve_pdf_ref(self.root, self.cfg, f) {
                    if abs.is_file() {
                        return Some(portable);
                    }
                }
                if !f.contains("..") && !Path::new(f).is_absolute() {
                    let local = dir.join(f);
                    if local.is_file() {
                        return rel_path(self.root, &local);
                    }
                    if let Ok(vp) = safe_join(self.root, f) {
                        if vp.is_file() {
                            return rel_path(self.root, &vp);
                        }
                    }
                }
                None
            })
            .or_else(|| {
                std::fs::read_dir(dir)
                    .ok()?
                    .flatten()
                    .map(|e| e.path())
                    .find(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("pdf")))
                    .and_then(|p| rel_path(self.root, &p))
            });
        let authors = {
            let a = list(m, "author");
            if a.is_empty() { list(m, "authors") } else { a }
        };
        let year = s(m, "date").and_then(|d| year_of(&d)).or_else(|| s(m, "year").and_then(|y| year_of(&y)));
        Paper {
            has_notes: entry::has_note(dir, &key),
            dir: self.rel(dir),
            title: s(m, "title").unwrap_or_else(|| key.to_string()),
            kind: s(m, "type").unwrap_or_else(|| "document".into()),
            authors,
            year,
            venue: s(m, "publicationTitle").or_else(|| s(m, "proceedingsTitle")).or_else(|| s(m, "bookTitle")).or_else(|| s(m, "publisher")).or_else(|| s(m, "university")),
            doi: s(m, "DOI"),
            arxiv: arxiv_of(m),
            url: s(m, "url"),
            abstract_text: s(m, "abstractNote"),
            collections: list(m, "collections"),
            tags: list(m, "tags"),
            pdf,
            added: s(m, "dateAdded"),
            key,
            isbn: s(m, "ISBN").or_else(|| s(m, "isbn")),
            volume: s(m, "volume"),
            issue: s(m, "issue"),
            pages: s(m, "pages"),
            publisher: s(m, "publisher"),
            edition: s(m, "edition"),
            series: s(m, "series"),
        }
    }

    /// The entry of one folder (None: no entry there).
    pub fn paper_in(&self, dir: &Path) -> Option<Paper> {
        let m = entry::read(dir)?;
        Some(self.paper_of(dir, &entry::key_of(dir), &m))
    }

    /// Every entry, newest year first. No folder yet: an empty library (the view says how to add one).
    pub fn list(&self) -> Res<Vec<Paper>> {
        let base = self.base()?;
        let entries = match std::fs::read_dir(&base) {
            Ok(e) => e,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(io(&base)(e)),
        };
        let mut out: Vec<Paper> = entries.flatten().filter_map(|e| self.paper_in(&e.path())).collect();
        out.sort_by(|a, b| b.year.cmp(&a.year).then_with(|| a.key.cmp(&b.key)));
        Ok(out)
    }

    fn find(&self, key: &str) -> Res<Paper> {
        self.list()?.into_iter().find(|p| p.key == key).ok_or_else(|| format!("no reference {key}"))
    }

    /// Writes an entry into its note (entry.rs), then refs.bib.
    fn save(&self, dir: &Path, m: &Mapping) -> Res<()> {
        entry::write(self.made, dir, m)
    }

    fn saved(&self, dir: &Path, key: &str, m: &Mapping) -> Res<Paper> {
        self.save(dir, m)?;
        self.write_bib()?;
        Ok(self.paper_of(dir, key, m))
    }

    /// The entry's note (made when an older entry has none yet: the fold) → its vault path.
    pub fn note(&self, key: &str) -> Res<String> {
        let p = self.find(key)?;
        let dir = safe_join(self.root, &p.dir)?;
        let file = entry::note_file(&entry::key_of(&dir));
        if !dir.join(&file).is_file() {
            self.save(&dir, &entry::read(&dir).unwrap_or_default())?;
        }
        Ok(format!("{}/{file}", p.dir))
    }

    /// Every entry's note made where it is missing (`kandinsky paper-notes`), so `[[citekey]]` always links → the notes made.
    pub fn notes(&self) -> Res<Vec<String>> {
        let mut made = Vec::new();
        for p in self.list()? {
            let dir = safe_join(self.root, &p.dir)?;
            if !dir.join(entry::note_file(&entry::key_of(&dir))).is_file() {
                made.push(self.note(&p.key)?);
            }
        }
        Ok(made)
    }

    /// refs.bib from every entry → how many it holds.
    pub fn write_bib(&self) -> Res<usize> {
        let base = self.base()?;
        let mut dirs: Vec<_> = std::fs::read_dir(&base).map_err(io(&base))?.flatten().map(|e| e.path()).collect();
        dirs.sort();
        let entries: Vec<String> = dirs
            .iter()
            .filter_map(|d| {
                let m = entry::read(d)?;
                Some(bibtex_entry(&s(&m, "citekey").unwrap_or_else(|| entry::key_of(d)), &m))
            })
            .collect();
        let text = format!("% Generated by Kandinsky from the notes of {}/* — do not edit.\n\n{}\n", self.cfg.dir, entries.join("\n\n"));
        let bib = safe_join(self.root, &self.cfg.bib)?;
        kandinsky_plugin::write_file(&bib, text.as_bytes()).map_err(|e| e.to_string())?;
        Ok(entries.len())
    }

    /// One entry as BibTeX ("copy BibTeX").
    pub fn bibtex(&self, key: &str) -> Res<String> {
        let dir = safe_join(self.root, &format!("{}/{key}", self.cfg.dir))?;
        let m = entry::read(&dir).ok_or_else(|| format!("no reference {key}"))?;
        Ok(bibtex_entry(&s(&m, "citekey").unwrap_or_else(|| key.into()), &m))
    }

    /// Every entry as BibTeX (when `key` is omitted on the MCP `bibtex` tool).
    pub fn bibtex_all(&self) -> Res<String> {
        let base = self.base()?;
        let entries = match std::fs::read_dir(&base) {
            Ok(e) => e,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(String::new()),
            Err(e) => return Err(io(&base)(e)),
        };
        let mut dirs: Vec<_> = entries.flatten().map(|e| e.path()).collect();
        dirs.sort();
        let blocks: Vec<String> = dirs
            .iter()
            .filter_map(|d| {
                let m = entry::read(d)?;
                Some(bibtex_entry(&s(&m, "citekey").unwrap_or_else(|| entry::key_of(d)), &m))
            })
            .collect();
        Ok(blocks.join("\n\n"))
    }

    /// Searches the local library across title, authors, citekey, year, venue, DOI, arXiv id, abstract, collections, tags, and item_type.
    pub fn search(
        &self,
        query: Option<&str>,
        collection: Option<&str>,
        tag: Option<&str>,
        item_type: Option<&str>,
        limit: Option<usize>,
    ) -> Res<Vec<Paper>> {
        let col_filter = collection.map(str::trim).filter(|c| !c.is_empty()).map(str::to_lowercase);
        let tag_filter = tag.map(str::trim).filter(|t| !t.is_empty()).map(str::to_lowercase);
        let type_filter = item_type.map(str::trim).filter(|t| !t.is_empty());
        let words: Vec<String> = query.unwrap_or("").split_whitespace().map(str::to_lowercase).collect();
        let cap = limit.unwrap_or(50);
        let mut out = Vec::new();
        for p in self.list()? {
            if let Some(tf) = type_filter {
                if !matches_item_type(&p.kind, tf) {
                    continue;
                }
            }
            if let Some(cf) = &col_filter {
                if !p.collections.iter().any(|c| {
                    let cl = c.to_lowercase();
                    cl == *cf || cl.starts_with(&format!("{cf}/"))
                }) {
                    continue;
                }
            }
            if let Some(tf) = &tag_filter {
                if !p.tags.iter().any(|t| t.to_lowercase() == *tf) {
                    continue;
                }
            }
            if !words.is_empty() {
                let hay = [
                    p.key.as_str(),
                    p.title.as_str(),
                    p.year.as_deref().unwrap_or(""),
                    p.venue.as_deref().unwrap_or(""),
                    p.doi.as_deref().unwrap_or(""),
                    p.arxiv.as_deref().unwrap_or(""),
                    p.abstract_text.as_deref().unwrap_or(""),
                ]
                .join(" ")
                .to_lowercase()
                    + " "
                    + &p.authors.join(" ").to_lowercase()
                    + " "
                    + &p.collections.join(" ").to_lowercase()
                    + " "
                    + &p.tags.join(" ").to_lowercase();
                if !words.iter().all(|w| hay.contains(w.as_str())) {
                    continue;
                }
            }
            out.push(p);
            if out.len() >= cap {
                break;
            }
        }
        Ok(out)
    }

    /// Structured reading notes and `pdf-marks` annotations for a citekey (`paper_annotations` MCP tool).
    pub fn annotations(&self, key: &str) -> Res<serde_json::Value> {
        let p = self.find(key)?;
        let dir = safe_join(self.root, &p.dir)?;
        let note_rel = format!("{}/{}", p.dir, entry::note_file(&p.key));
        let note_text = [entry::note_file(&p.key), entry::LEGACY_NOTE.to_string()]
            .into_iter()
            .map(|n| dir.join(n))
            .find(|f| f.is_file())
            .and_then(|f| std::fs::read_to_string(f).ok())
            .unwrap_or_default();
        let prose = entry::extract_user_prose(&note_text);
        let (_, mut mark_lines) = entry::split_pdf_marks(&note_text);
        if self.cfg.annotations_mode == "shared_sidecar" {
            if let Some(pdf_abs) = p.pdf.as_deref().and_then(|r| self.pdf_abs_path(r)) {
                let sidecar = if self.cfg.sidecar_dir.trim().is_empty() {
                    PathBuf::from(format!("{}.kandinsky-marks", pdf_abs.display()))
                } else {
                    crate::external::resolve_pdf_ref(self.root, self.cfg, &self.cfg.sidecar_dir)
                        .map(|(_, d)| d)
                        .or_else(|| safe_join(self.root, &self.cfg.sidecar_dir).ok())
                        .map(|d| d.join(format!("{}.kandinsky-marks", pdf_abs.file_name().unwrap_or_default().to_string_lossy())))
                        .unwrap_or_else(|| PathBuf::from(format!("{}.kandinsky-marks", pdf_abs.display())))
                };
                if let Ok(sc_text) = std::fs::read_to_string(&sidecar) {
                    let merged = entry::merge_pdf_marks(&entry::attach_pdf_marks("", &mark_lines), &sc_text.lines().map(String::from).collect::<Vec<_>>());
                    mark_lines = entry::split_pdf_marks(&merged).1;
                }
            }
        }
        let annotations: Vec<serde_json::Value> = mark_lines.iter().filter_map(|l| entry::parse_mark_line(l)).collect();
        Ok(serde_json::json!({
            "key": p.key,
            "title": p.title,
            "pdf": p.pdf,
            "note_path": note_rel,
            "notes": prose,
            "annotations": annotations,
            "count": annotations.len(),
        }))
    }

    /// The key a paper gets in this vault: [`citekey`], unique against the entries already there.
    pub fn next_citekey(&self, authors: &[String], year: Option<&str>, title: &str) -> Res<String> {
        let base = self.base()?;
        Ok(citekey(authors, year, title, &|k| base.join(k).exists()))
    }

    // --- adding ------------------------------------------------------------------------------------------------

    fn file_fetched_entry(&self, mut m: Mapping, pinned_key: Option<String>, ax: Option<&str>) -> Res<PaperAdded> {
        let base = self.base()?;
        let title = s(&m, "title").unwrap_or_default();
        let year = s(&m, "date").and_then(|d| year_of(&d));
        let key = match pinned_key.filter(|pk| !pk.is_empty() && !base.join(pk).exists()) {
            Some(pk) => pk,
            None => self.next_citekey(&list(&m, "author"), year.as_deref(), &title)?,
        };
        let dir = base.join(&key);
        std::fs::create_dir_all(&dir).map_err(io(&dir))?;
        m.insert("citekey".into(), key.clone().into());
        m.insert("dateAdded".into(), now_stamp().into());
        let ax_id = ax.map(String::from).or_else(|| arxiv_of(&m));
        let got = if self.cfg.download_pdfs { self.fetch_pdf(&dir, &key, ax_id.as_deref(), &mut m)? } else { Err(None) };
        let paper = self.saved(&dir, &key, &m)?;
        Ok(PaperAdded { paper, created: true, pdf: got.is_ok(), gate: got.err().flatten() })
    }

    /// Add a reference from a DOI, arXiv id/URL (preserving `vN`), ISBN, INSPIRE-HEP URL, BibTeX, or RIS entry.
    pub fn add(&self, input: &str) -> Res<PaperAdded> {
        let existing = self.list().unwrap_or_default();
        let find_dup = |doi: Option<&str>, ax: Option<&str>| -> Option<&Paper> {
            existing.iter().find(|p| {
                (doi.is_some() && p.doi.as_deref().map(str::to_lowercase) == doi.map(str::to_lowercase))
                    || (ax.is_some() && p.arxiv.as_deref() == ax)
            })
        };
        if let Some((pinned, m)) = crate::enrich::parse_bibtex(input) {
            if let Some(p) = find_dup(s(&m, "DOI").as_deref(), arxiv_of(&m).as_deref()) {
                return Ok(PaperAdded { paper: p.clone(), created: false, pdf: p.pdf.is_some(), gate: None });
            }
            return self.file_fetched_entry(m, pinned, None);
        }
        if let Some(m) = crate::enrich::parse_ris(input) {
            if let Some(p) = find_dup(s(&m, "DOI").as_deref(), arxiv_of(&m).as_deref()) {
                return Ok(PaperAdded { paper: p.clone(), created: false, pdf: p.pdf.is_some(), gate: None });
            }
            return self.file_fetched_entry(m, None, None);
        }
        if let Some(recid) = crate::enrich::parse_inspire_id(input) {
            let m = crate::enrich::inspire_by_id(self.net, &recid)?;
            if let Some(p) = find_dup(s(&m, "DOI").as_deref(), arxiv_of(&m).as_deref()) {
                return Ok(PaperAdded { paper: p.clone(), created: false, pdf: p.pdf.is_some(), gate: None });
            }
            return self.file_fetched_entry(m, None, None);
        }
        let ax_ver = remote::parse_arxiv_versioned(input).filter(|_| input.to_lowercase().contains("arxiv") || parse_doi(input).is_none());
        let ax = ax_ver.as_ref().map(|(a, _)| a.clone());
        let doi = if ax.is_none() { parse_doi(input) } else { None };
        if let Some(p) = find_dup(doi.as_deref(), ax.as_deref()) {
            return Ok(PaperAdded { paper: p.clone(), created: false, pdf: false, gate: None });
        }
        if let Some((a, ver)) = ax_ver {
            let mut m = match &ver {
                Some(v) => remote::arxiv(self.net, &format!("{a}{v}")).or_else(|_| remote::arxiv(self.net, &a))?,
                None => remote::arxiv(self.net, &a)?,
            };
            let fetch_ax = match ver {
                Some(v) => {
                    m.insert("arxivVersion".into(), v.clone().into());
                    m.insert("archiveID".into(), format!("arXiv:{a}{v}").into());
                    m.insert("url".into(), format!("https://arxiv.org/abs/{a}{v}").into());
                    format!("{a}{v}")
                }
                None => a,
            };
            return self.file_fetched_entry(m, None, Some(&fetch_ax));
        }
        if let Some(d) = doi {
            let m = remote::crossref_with_openalex(self.net, &d, &self.cfg.email)?;
            return self.file_fetched_entry(m, None, None);
        }
        if let Some(isbn) = parse_isbn(input) {
            if let Some(p) = existing.iter().find(|p| {
                safe_join(self.root, &p.dir)
                    .ok()
                    .and_then(|d| entry::read(&d))
                    .and_then(|em| s(&em, "ISBN"))
                    .and_then(|v| parse_isbn(&v))
                    .as_deref()
                    == Some(isbn.as_str())
            }) {
                return Ok(PaperAdded { paper: p.clone(), created: false, pdf: p.pdf.is_some(), gate: None });
            }
            return self.new_entry(remote::isbn_book(self.net, &isbn)?);
        }
        Err(format!("not a DOI, arXiv id, ISBN, INSPIRE record, BibTeX or RIS entry: {input}"))
    }

    /// The PDF: arXiv's, else an open-access copy the indexes know; a publisher's paywalled PDF is left to the user
    /// (or to the PDF sources other plugins add). → saved, or not and the first copy behind a sign-in.
    fn fetch_pdf(&self, dir: &Path, key: &str, ax: Option<&str>, m: &mut Mapping) -> Res<Result<(), Option<String>>> {
        let from_entry = m.get("archiveID").and_then(Value::as_str).and_then(|v| v.strip_prefix("arXiv:")).map(String::from);
        let arxiv_pdf = ax.map(String::from).or(from_entry).map(|a| (format!("https://arxiv.org/pdf/{a}"), "arXiv"));
        let doi = s(m, "DOI");
        let more = remote::Index::order(&self.cfg.indexes);
        let tries = arxiv_pdf.into_iter().chain(doi.iter().flat_map(|d| remote::open_access_pdfs(self.net, d, &self.cfg.email, &more)));
        let mut gate = None;
        for (url, from) in tries {
            match self.net.pdf(&url) {
                Ok(b) => {
                    let stored = if let Some((portable, _)) = crate::external::find_existing_external_pdf(self.root, self.cfg, &b) {
                        portable
                    } else if !self.cfg.external_pdf_roots.is_empty() && self.cfg.store_in_external {
                        let fname = crate::external::format_pdf_filename(&self.cfg.rename_format, m, key);
                        crate::external::write_external_pdf(self.root, self.cfg, None, &fname, &b)?.0
                    } else {
                        let name = format!("{key}.pdf");
                        kandinsky_plugin::write_file(dir.join(&name), &b).map_err(|e| e.to_string())?;
                        name
                    };
                    m.insert("files".into(), Value::Sequence(vec![stored.into()]));
                    m.insert("pdfSha256".into(), sha_hex(&b).into());
                    m.insert("pdfFrom".into(), format!("{from}: {url}").into());
                    return Ok(Ok(()));
                }
                Err(Miss::Gate(u)) => gate = gate.or(Some(u)),
                Err(Miss::Other(_)) => {}
            }
        }
        Ok(Err(gate))
    }

    fn find_existing_by_ids(&self, doi: Option<&str>, ax: Option<&str>, isbn: Option<&str>) -> Option<Paper> {
        let ndoi = doi.map(norm_doi).filter(|d| !d.is_empty());
        let nax = ax.map(|a| a.trim().to_ascii_lowercase()).filter(|a| !a.is_empty());
        let nisbn = isbn.and_then(isbn_core);
        if ndoi.is_none() && nax.is_none() && nisbn.is_none() {
            return None;
        }
        self.list().ok()?.into_iter().find(|p| {
            ndoi.as_ref().is_some_and(|d| p.doi.as_deref().map(norm_doi).as_deref() == Some(d.as_str()))
                || nax.as_ref().is_some_and(|a| p.arxiv.as_deref().map(str::to_ascii_lowercase).as_deref() == Some(a.as_str()))
                || nisbn.as_ref().is_some_and(|ic| {
                    safe_join(self.root, &p.dir)
                        .ok()
                        .and_then(|d| entry::read(&d))
                        .and_then(|em| s(&em, "ISBN").or_else(|| s(&em, "isbn")))
                        .and_then(|v| isbn_core(&v))
                        .as_deref()
                        == Some(ic.as_str())
                })
        })
    }

    pub(crate) fn find_existing_by_sha(&self, digest: &[u8; 32], bytes_len: usize, existing_ref: Option<&str>) -> Option<Paper> {
        let hex = bytes_sha_hex(digest);
        self.list().ok()?.into_iter().find(|p| {
            if let Some(er) = existing_ref {
                if p.pdf.as_deref() == Some(er) {
                    return true;
                }
            }
            let stored_match = safe_join(self.root, &p.dir)
                .ok()
                .and_then(|d| entry::read(&d))
                .and_then(|em| s(&em, "pdfSha256"))
                .is_some_and(|h| h.eq_ignore_ascii_case(&hex));
            stored_match
                || p.pdf
                    .as_deref()
                    .and_then(|f| self.pdf_abs_path(f))
                    .is_some_and(|abs| abs.metadata().is_ok_and(|md| md.len() == bytes_len as u64) && std::fs::read(&abs).is_ok_and(|b| sha(&b) == *digest))
        })
    }

    /// A PDF dropped on the library: a DOI, arXiv id, or ISBN on its first pages gives the metadata (or a book
    /// lookup for books); without one (or offline), structured filename or first-page metadata names the entry.
    pub fn import_pdf(&self, name: &str, bytes: &[u8]) -> Res<PaperAdded> {
        self.import_pdf_with(name, bytes, &ImportOpts::default())
    }

    pub fn import_pdf_with(&self, name: &str, bytes: &[u8], opts: &ImportOpts) -> Res<PaperAdded> {
        if !bytes.starts_with(b"%PDF") {
            return Err(format!("{name} is not a PDF"));
        }
        let file = name.rsplit(['/', '\\']).next().unwrap_or(name).to_string();
        let digest = sha(bytes);
        let existing_external = crate::external::find_existing_external_pdf(self.root, self.cfg, bytes);

        if let Some((ref portable_ref, _)) = existing_external {
            if let Some(p) = self.find_existing_by_sha(&digest, bytes.len(), Some(portable_ref.as_str())) {
                return Ok(PaperAdded { paper: p, created: false, pdf: true, gate: None });
            }
        }

        let extract = crate::pdf_meta::extract_pdf_doc(bytes);
        let (text, pages, doc_meta) = (&extract.text, extract.pages, &extract.meta);

        // Deduplicate by filename (when keep_name) or SHA-256 (whenever keep_name, external_pdf_roots, or non-empty PDF).
        if opts.keep_name {
            let same = |p: &Paper| {
                p.pdf.as_deref().is_some_and(|f| f.rsplit(['/', '\\']).next() == Some(file.as_str()))
                    || p.pdf.as_deref().and_then(|f| self.pdf_abs_path(f)).and_then(|abs| std::fs::read(abs).ok()).is_some_and(|b| b.len() == bytes.len() && sha(&b) == digest)
            };
            if let Some(p) = self.list()?.into_iter().find(|p| same(p)) {
                return Ok(PaperAdded { paper: p, created: false, pdf: true, gate: None });
            }
        } else if !self.cfg.external_pdf_roots.is_empty() || pages > 0 {
            if let Some(p) = self.find_existing_by_sha(&digest, bytes.len(), None) {
                return Ok(PaperAdded { paper: p, created: false, pdf: true, gate: None });
            }
        }

        let parsed = parse_filename(name);
        let first = crate::firstpage::read_pages(text, name);
        let ids = extract_pdf_identifiers_with_meta(text, pages, name, Some(doc_meta));
        let class = classify_pdf(&ClassifyInput {
            text,
            pages,
            filename: name,
            rel_dir: None,
            parsed: &parsed,
            isbn: ids.isbn.as_deref(),
            doi: ids.doi.as_deref(),
            arxiv: ids.arxiv.as_deref(),
            remote_type: None,
            explicit_kind: opts.kind.as_deref(),
        });

        let mut added = if let Some(p) = self.find_existing_by_ids(ids.doi.as_deref(), ids.arxiv.as_deref(), ids.isbn.as_deref()) {
            let has_pdf = p.pdf.is_some();
            PaperAdded { paper: p, created: false, pdf: has_pdf, gate: None }
        } else {
            let remote = lookup_pdf_remote_with_meta(
                self.net,
                &self.cfg.email,
                class,
                &ids,
                &parsed,
                first.as_ref(),
                Some(doc_meta),
            );
            match remote {
                Some((mut m, _src)) => {
                    let r_doi = s(&m, "DOI");
                    let r_ax = arxiv_of(&m);
                    let r_isbn = s(&m, "ISBN");
                    if let Some(p) = self.find_existing_by_ids(r_doi.as_deref(), r_ax.as_deref(), r_isbn.as_deref()) {
                        let has_pdf = p.pdf.is_some();
                        PaperAdded { paper: p, created: false, pdf: has_pdf, gate: None }
                    } else {
                        merge_local_fallbacks_with_meta(&mut m, &parsed, first.as_ref(), Some(doc_meta), &ids, pages, class);
                        self.new_entry(m)?
                    }
                }
                None => {
                    if first.is_some()
                        || parsed.structured
                        || !ids.is_empty()
                        || doc_meta.title.is_some()
                        || split_trailing_paren_author(&parsed.title).is_some()
                    {
                        let (m, _) = build_local_entry_mapping_with_meta(&parsed, first.as_ref(), Some(doc_meta), &ids, pages, class);
                        self.new_entry(m)?
                    } else {
                        self.entry_named_after(name, pages)?
                    }
                }
            }
        };

        // Link existing external PDF in place (zero writes), else write to external root or entry dir.
        let dir = safe_join(self.root, &added.paper.dir)?;
        let mut m = entry::read(&dir).unwrap_or_default();
        let mut changed = false;
        if let Some((portable_ref, _)) = existing_external {
            if added.paper.pdf.is_none() {
                let mut files: Vec<Value> = m.get("files").and_then(Value::as_sequence).cloned().unwrap_or_default();
                if !files.iter().any(|f| f.as_str() == Some(portable_ref.as_str())) {
                    files.insert(0, portable_ref.into());
                }
                m.insert("files".into(), Value::Sequence(files));
                m.insert("pdfSha256".into(), bytes_sha_hex(&digest).into());
                changed = true;
            }
        } else if opts.keep_name || added.paper.pdf.is_none() {
            let stored = if !self.cfg.external_pdf_roots.is_empty() && (self.cfg.store_in_external || opts.subfolder.is_some()) {
                let target_name = if opts.keep_name { file } else { crate::external::format_pdf_filename(&self.cfg.rename_format, &m, &added.paper.key) };
                crate::external::write_external_pdf(self.root, self.cfg, opts.subfolder.as_deref(), &target_name, bytes)?.0
            } else {
                let file = if opts.keep_name { file } else { format!("{}.pdf", added.paper.key) };
                if !dir.join(&file).exists() {
                    kandinsky_plugin::write_file(dir.join(&file), bytes).map_err(|e| e.to_string())?;
                }
                file
            };
            let mut files: Vec<Value> = m.get("files").and_then(Value::as_sequence).cloned().unwrap_or_default();
            if !files.iter().any(|f| f.as_str() == Some(stored.as_str())) {
                files.insert(0, stored.into());
            }
            m.insert("files".into(), Value::Sequence(files));
            m.insert("pdfSha256".into(), bytes_sha_hex(&digest).into());
            changed = true;
        }
        if let Some(kind) = opts.kind.as_deref().filter(|k| !k.is_empty()) {
            m.insert("type".into(), kind.into());
            changed = true;
        }
        if let Some(url) = opts.url.as_deref().filter(|u| !u.is_empty() && !m.contains_key("url")) {
            m.insert("url".into(), url.into());
            changed = true;
        }
        if !opts.collections.is_empty() {
            join_all(&mut m, "collections", opts.collections.iter().map(|c| Value::from(c.as_str())));
            changed = true;
        }
        if changed {
            self.save(&dir, &m)?;
            added.paper = self.paper_of(&dir, &added.paper.key, &m);
            added.pdf = added.paper.pdf.is_some();
        }
        self.write_bib()?;
        Ok(added)
    }

    /// A new entry from an index's fields (a book by its ISBN): its citekey, folder and note, as `add` makes them.
    fn new_entry(&self, mut m: Mapping) -> Res<PaperAdded> {
        let title = s(&m, "title").unwrap_or_default();
        let year = s(&m, "date").and_then(|d| year_of(&d));
        let key = self.next_citekey(&list(&m, "author"), year.as_deref(), &title)?;
        let dir = self.base()?.join(&key);
        std::fs::create_dir_all(&dir).map_err(io(&dir))?;
        m.insert("citekey".into(), key.clone().into());
        m.insert("dateAdded".into(), now_stamp().into());
        let paper = self.saved(&dir, &key, &m)?;
        Ok(PaperAdded { paper, created: true, pdf: false, gate: None })
    }

    /// An entry for a PDF without identifiers: its title from the file's name (percent-decoded, as a link names it),
    /// using structured filename fields when present and falling back to unstructured stem words otherwise.
    fn entry_named_after(&self, name: &str, pages: usize) -> Res<PaperAdded> {
        let parsed = parse_filename(name);
        let ids = PdfIds {
            isbn: parsed.isbn.clone(),
            arxiv: parsed.arxiv.clone(),
            arxiv_version: parsed.arxiv_version.clone(),
            doi: None,
        };
        let class = classify_pdf(&ClassifyInput {
            text: "",
            pages,
            filename: name,
            rel_dir: None,
            parsed: &parsed,
            isbn: ids.isbn.as_deref(),
            doi: None,
            arxiv: ids.arxiv.as_deref(),
            remote_type: None,
            explicit_kind: None,
        });
        let (mut m, _) = build_local_entry_mapping(&parsed, None, &ids, pages, class);
        let title = s(&m, "title").unwrap_or_default();
        let authors = list(&m, "author");
        let year = s(&m, "date").and_then(|d| year_of(&d));
        let base = self.base()?;
        let key = citekey(&authors, year.as_deref(), &title, &|k| base.join(k).exists());
        let dir = base.join(&key);
        std::fs::create_dir_all(&dir).map_err(io(&dir))?;
        m.insert("citekey".into(), key.clone().into());
        m.insert("dateAdded".into(), now_stamp().into());
        self.save(&dir, &m)?;
        Ok(PaperAdded { paper: self.paper_of(&dir, &key, &m), created: true, pdf: false, gate: None })
    }

    /// A PDF a plugin found (the PDF sources, docs/guides/PLUGIN-API.md) becomes the paper's: `file` is a download in a
    /// plugin's cache, `from` says where it came from (kept as `pdfFrom`). Only a real PDF, only from a plugin's
    /// cache, and never over a PDF the paper already has.
    pub fn attach_pdf(&self, key: &str, file: &str, from: &str) -> Res<Paper> {
        let paper = self.find(key)?;
        // either spelling of the state folder (a vault not migrated yet keeps `.atlas`), read where the vault has it
        if !kandinsky_plugin::current_rel(file).starts_with(PLUGIN_CACHE) || file.contains("..") {
            return Err(format!("{file}: a PDF to attach comes from a plugin's cache ({PLUGIN_CACHE}<id>/…)"));
        }
        let file = &kandinsky_plugin::live_rel(self.root, file);
        let dir = safe_join(self.root, &paper.dir)?;
        let mut m = entry::read(&dir).unwrap_or_default();
        if m.get("files").and_then(Value::as_sequence).is_some_and(|f| !f.is_empty()) {
            return Err(format!("{key} has a PDF already"));
        }
        let src = safe_join(self.root, file)?;
        let bytes = std::fs::read(&src).map_err(io(&src))?;
        if !bytes.starts_with(b"%PDF") {
            return Err(format!("{file} is not a PDF"));
        }
        let stored = if let Some((portable, _)) = crate::external::find_existing_external_pdf(self.root, self.cfg, &bytes) {
            portable
        } else if !self.cfg.external_pdf_roots.is_empty() && self.cfg.store_in_external {
            let fname = crate::external::format_pdf_filename(&self.cfg.rename_format, &m, &paper.key);
            crate::external::write_external_pdf(self.root, self.cfg, None, &fname, &bytes)?.0
        } else {
            let name = format!("{key}.pdf");
            kandinsky_plugin::write_file(dir.join(&name), &bytes).map_err(|e| e.to_string())?;
            name
        };
        let _ = std::fs::remove_file(&src); // moved, not copied: the cache keeps no second one
        m.insert("files".into(), Value::Sequence(vec![stored.into()]));
        m.insert("pdfSha256".into(), sha_hex(&bytes).into());
        m.insert("pdfFrom".into(), from.trim().to_string().into());
        self.saved(&dir, &paper.key, &m)
    }

    // --- changing ----------------------------------------------------------------------------------------------

    /// The edited fields into the entry's note (everything else kept), then refs.bib.
    pub fn edit(&self, e: &PaperEdit) -> Res<Paper> {
        let paper = self.find(&e.key)?;
        let dir = safe_join(self.root, &paper.dir)?;
        let mut m = entry::read(&dir).unwrap_or_default();
        // the venue lives in the field the item type uses (journal, proceedings, book, publisher)
        let venue_key = ["publicationTitle", "proceedingsTitle", "bookTitle", "publisher"].into_iter().find(|k| m.contains_key(*k)).unwrap_or("publicationTitle");
        let seq = |xs: &[String]| Value::Sequence(xs.iter().map(|x| x.trim()).filter(|x| !x.is_empty()).map(Value::from).collect());
        for (k, v) in [
            ("title", Value::from(e.title.trim())),
            ("author", seq(&e.authors)),
            ("date", Value::from(e.date.trim())),
            (venue_key, Value::from(e.venue.trim())),
            ("collections", seq(&e.collections)),
            ("tags", seq(&e.tags)),
        ] {
            let empty = matches!(&v, Value::String(x) if x.is_empty()) || matches!(&v, Value::Sequence(x) if x.is_empty());
            if empty {
                m.remove(k);
            } else {
                m.insert(k.into(), v);
            }
        }
        let set_opt = |m: &mut Mapping, field: &str, opt: Option<&str>| {
            if let Some(raw) = opt {
                let t = raw.trim();
                if t.is_empty() {
                    m.remove(field);
                } else {
                    m.insert(field.into(), t.into());
                }
            }
        };
        if let Some(ref k) = e.kind {
            if !k.trim().is_empty() {
                m.insert("type".into(), k.trim().into());
            }
        }
        if let Some(ref d) = e.doi {
            let clean = norm_doi(d);
            if clean.is_empty() {
                m.remove("DOI");
            } else {
                m.insert("DOI".into(), clean.into());
            }
        }
        if let Some(ref ax) = e.arxiv {
            let t = ax.trim();
            if t.is_empty() {
                m.remove("archiveID");
                m.remove("arxiv");
                m.remove("arxivVersion");
            } else if let Some((base, ver)) = remote::parse_arxiv_versioned(t) {
                let full = format!("arXiv:{base}{}", ver.as_deref().unwrap_or(""));
                m.insert("archiveID".into(), full.into());
                if let Some(v) = ver {
                    m.insert("arxivVersion".into(), v.into());
                }
            } else {
                m.insert("archiveID".into(), t.into());
            }
        }
        if let Some(ref i) = e.isbn {
            let t = i.trim();
            if t.is_empty() {
                m.remove("ISBN");
                m.remove("isbn");
            } else {
                let norm = remote::normalize_isbn(t).unwrap_or_else(|| t.to_string());
                m.insert("ISBN".into(), norm.into());
            }
        }
        set_opt(&mut m, "volume", e.volume.as_deref());
        set_opt(&mut m, "issue", e.issue.as_deref());
        set_opt(&mut m, "pages", e.pages.as_deref());
        set_opt(&mut m, "publisher", e.publisher.as_deref());
        self.saved(&dir, &paper.key, &m)
    }

    /// An entry's type (`book`, `thesis`, `manuscript`…), as its note (`itemType`) and refs.bib say it.
    pub fn set_type(&self, key: &str, kind: &str) -> Res<Paper> {
        let paper = self.find(key)?;
        let dir = safe_join(self.root, &paper.dir)?;
        let mut m = entry::read(&dir).unwrap_or_default();
        m.insert("type".into(), kind.trim().into());
        self.saved(&dir, &paper.key, &m)
    }

    /// Two entries that are one reference (the same PDF filed twice): `into` keeps its metadata and gains `dup`'s type
    /// when it has none of its own beyond the default, its collections, tags, aliases, notes and marks; `dup` goes to the Trash.
    pub fn merge(&self, dup: &str, into: &str) -> Res<Paper> {
        let opts = crate::inbox_dedupe::MergeOpts {
            dup: dup.to_string(),
            into: into.to_string(),
            relink_vault: false,
            trash_duplicate_pdf: true,
        };
        crate::inbox_dedupe::merge_entries(self, &opts, &|_, _| 0).map(|r| r.paper)
    }

    /// Removes an entry: its folder goes to the Trash (recoverable), refs.bib is rewritten. → where it went.
    pub fn delete(&self, key: &str) -> Res<String> {
        let paper = self.find(key)?;
        let to = self.trash.trash(&paper.dir)?;
        self.write_bib()?;
        Ok(to)
    }

    /// Every entry's `info.yaml` folded into its note (entry.rs). A dry run (`apply` false) only lists them; applied,
    /// each `info.yaml` and note is first copied to `.kandinsky/trash/<time>-refs-before-fold/<key>/`, then refs.bib rewritten.
    pub fn fold_all(&self, apply: bool) -> Res<Folded> {
        let base = self.base()?;
        let mut dirs: Vec<_> = match std::fs::read_dir(&base) {
            Ok(r) => r.flatten().map(|e| e.path()).filter(|d| d.join(entry::LEGACY).is_file()).collect(),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(io(&base)(e)),
        };
        dirs.sort();
        let entries: Vec<(String, usize)> = dirs.iter().map(|d| (entry::key_of(d), entry::read(d).map_or(0, |m| m.len()))).collect();
        if !apply || dirs.is_empty() {
            return Ok(Folded { entries, snapshot: None });
        }
        // in the vault's own state folder: a vault not migrated yet keeps `.atlas`, and a `.kandinsky` made beside it
        // would be taken for the state folder at the next start
        let snap = kandinsky_plugin::live_rel(self.root, &format!(".kandinsky/trash/{}-refs-before-fold", chrono::Local::now().format("%Y%m%d-%H%M%S")));
        for d in &dirs {
            let key = entry::key_of(d);
            let to = self.root.join(&snap).join(&key);
            std::fs::create_dir_all(&to).map_err(io(&to))?;
            for f in [entry::LEGACY.to_string(), entry::note_file(&key), entry::LEGACY_NOTE.to_string()] {
                if d.join(&f).is_file() {
                    std::fs::copy(d.join(&f), to.join(&f)).map_err(io(&to))?;
                }
            }
        }
        for d in &dirs {
            entry::fold(self.made, d)?;
        }
        self.write_bib()?;
        Ok(Folded { entries, snapshot: Some(snap) })
    }
}

/// `values` added to the list under `key`, each once; the key stays absent when the list would be empty.
fn join_all(m: &mut Mapping, key: &str, values: impl Iterator<Item = Value>) {
    let mut have: Vec<Value> = m.get(key).and_then(Value::as_sequence).cloned().unwrap_or_default();
    for v in values {
        if !have.contains(&v) {
            have.push(v);
        }
    }
    if !have.is_empty() {
        m.insert(key.into(), Value::Sequence(have));
    }
}

pub(crate) fn sha(bytes: &[u8]) -> [u8; 32] {
    use sha2::Digest;
    sha2::Sha256::digest(bytes).into()
}

pub(crate) fn bytes_sha_hex(digest: &[u8; 32]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(64);
    for &b in digest {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

pub(crate) fn sha_hex(bytes: &[u8]) -> String {
    bytes_sha_hex(&sha(bytes))
}

pub fn norm_doi(d: &str) -> String {
    let low = d.trim().to_ascii_lowercase();
    for pfx in ["https://doi.org/", "http://doi.org/", "https://dx.doi.org/", "http://dx.doi.org/", "doi:"] {
        if let Some(rest) = low.strip_prefix(pfx) {
            return rest.trim().to_string();
        }
    }
    low
}

/// Validates an uppercase normalized ISBN-10 (mod 11) or ISBN-13 (mod 10, `978`/`979` prefix) digit string.
pub fn is_valid_isbn(d: &str) -> bool {
    let v: Vec<u32> = d
        .chars()
        .map(|c| if c == 'X' { 10 } else { c.to_digit(10).unwrap_or(99) })
        .collect();
    match v.len() {
        10 => {
            v[..9].iter().all(|x| *x < 10)
                && v.get(9).is_some_and(|x| *x <= 10)
                && v.iter().enumerate().map(|(i, x)| (10 - i as u32) * x).sum::<u32>() % 11 == 0
        }
        13 => {
            (d.starts_with("978") || d.starts_with("979"))
                && v.iter().all(|x| *x < 10)
                && v.iter().enumerate().map(|(i, x)| if i % 2 == 0 { *x } else { 3 * x }).sum::<u32>() % 10 == 0
        }
        _ => false,
    }
}

fn extract_isbn_digits_at(text: &str, start: usize) -> Option<String> {
    let rest = text.get(start..)?;
    let mut digits = String::with_capacity(14);
    let mut chars = rest.chars().peekable();
    let mut snap10: Option<(String, bool)> = None;
    let mut snap13: Option<(String, bool)> = None;
    let mut prev_space = false;

    while let Some(c) = chars.next() {
        if c.is_ascii_digit() {
            prev_space = false;
            digits.push(c);
        } else if (c == 'X' || c == 'x') && digits.len() == 9 {
            prev_space = false;
            digits.push('X');
        } else if matches!(c, '-' | '\u{2013}' | '\u{2014}') {
            prev_space = false;
            continue;
        } else if c == ' ' && !digits.is_empty() && !prev_space {
            let next_ok = chars.peek().is_some_and(|nc| {
                nc.is_ascii_digit() || ((*nc == 'X' || *nc == 'x') && digits.len() == 9)
            });
            if !next_ok {
                break;
            }
            prev_space = true;
            continue;
        } else {
            break;
        }

        if digits.len() == 10 && snap10.is_none() {
            let adj = chars.peek().is_some_and(|nc| nc.is_ascii_digit());
            snap10 = Some((digits.clone(), adj));
            if digits.ends_with('X') {
                break;
            }
        } else if digits.len() == 13 && snap13.is_none() {
            let adj = chars.peek().is_some_and(|nc| nc.is_ascii_digit());
            snap13 = Some((digits.clone(), adj));
            break;
        } else if digits.len() > 13 {
            break;
        }
    }

    if let Some((d13, adj)) = snap13 {
        if !adj && is_valid_isbn(&d13) {
            return Some(d13);
        }
    }
    if let Some((d10, adj)) = snap10 {
        if !adj && is_valid_isbn(&d10) {
            return Some(d10);
        }
    }
    None
}

fn doi_spans_in(text: &str) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let b = text.as_bytes();
    let mut i = 0;
    while i + 8 < b.len() {
        if &b[i..i + 3] == b"10." && (i == 0 || !b[i - 1].is_ascii_alphanumeric()) {
            let reg = b[i + 3..].iter().take_while(|c| c.is_ascii_digit()).count();
            if (4..=9).contains(&reg) && b.get(i + 3 + reg) == Some(&b'/') {
                let mut end = i + 3 + reg + 1;
                while end < b.len() && !b[end].is_ascii_whitespace() && !matches!(b[end], b'"' | b'\'' | b'<' | b'>' | b')' | b']' | b'}') {
                    end += 1;
                }
                spans.push((i, end));
                i = end;
                continue;
            }
        }
        i += 1;
    }
    spans
}

/// Extracts and validates an ISBN-10 or ISBN-13 from copyright-page text or a filename.
/// Marked `ISBN` labels (including `ISBN-10`, `ISBN-13`, `e-ISBN`, `ISBN (13)`, spaces/dashes) take precedence
/// over bare `978`/`979` 13-digit numbers.
pub fn parse_isbn(text: &str) -> Option<String> {
    let normalized = crate::pdf_meta::normalize_pdf_unicode(text);
    let text = normalized.as_str();
    let low = text.to_ascii_lowercase();
    for (idx, _) in low.match_indices("isbn") {
        if idx > 0 {
            let prev = low.as_bytes()[idx - 1];
            if prev.is_ascii_alphabetic() && prev != b'e' {
                continue;
            }
        }
        let after = idx + 4;
        let mut win_end = low[after..]
            .find(['\n', '\r'])
            .map_or((after + 28).min(low.len()), |nl| (after + nl).min(after + 28));
        while !low.is_char_boundary(win_end) {
            win_end -= 1;
        }
        let win = &low[after..win_end];
        let mut try_offsets: Vec<usize> = Vec::new();
        for lbl in ["-13", "-10", "(13)", "(10)", " (13)", " (10)", " 13", " 10", "13", "10"] {
            if let Some(rest) = win.strip_prefix(lbl) {
                let is_sep = rest.is_empty() || !rest.starts_with(|c: char| c.is_ascii_digit());
                if is_sep {
                    if let Some(d_off) = rest.find(|c: char| c.is_ascii_digit()) {
                        try_offsets.push(after + lbl.len() + d_off);
                    }
                }
            }
        }
        if let Some(d_off) = win.find(|c: char| c.is_ascii_digit()) {
            let pos = after + d_off;
            if !try_offsets.contains(&pos) {
                try_offsets.push(pos);
            }
        }
        for pos in try_offsets {
            if let Some(isbn) = extract_isbn_digits_at(text, pos) {
                return Some(isbn);
            }
        }
    }

    let doi_spans = doi_spans_in(text);
    for (i, _) in text.char_indices() {
        if !(low[i..].starts_with("978") || low[i..].starts_with("979")) {
            continue;
        }
        if doi_spans.iter().any(|&(s, e)| i >= s && i < e) {
            continue;
        }
        if i > 0 && text[..i].ends_with(|c: char| c.is_ascii_digit()) {
            continue;
        }
        if let Some(isbn) = extract_isbn_digits_at(text, i) {
            if isbn.len() == 13 {
                return Some(isbn);
            }
        }
    }
    None
}

/// 9-digit ISBN core without check digit or `978` prefix (matching `inbox_dedupe::isbn_core` for 10/13 equivalence).
pub fn isbn_core(raw: &str) -> Option<String> {
    let d: String = parse_isbn(raw)
        .unwrap_or_else(|| raw.chars().filter(|c| c.is_ascii_digit() || matches!(c, 'X' | 'x')).collect())
        .to_ascii_uppercase();
    match d.len() {
        10 => Some(d[..9].to_string()),
        13 if d.starts_with("978") => Some(d[3..12].to_string()),
        13 => Some(d[..12].to_string()),
        _ => None,
    }
}

fn parse_isbn_for_pdf(text: &str, pages: usize) -> Option<String> {
    let page_slices: Vec<&str> = text.split('\x0c').collect();
    for p in page_slices.iter().take(6) {
        if let Some(isbn) = parse_isbn(p) {
            return Some(isbn);
        }
    }
    let first_has_paper_id = page_slices
        .first()
        .is_some_and(|p| remote::parse_arxiv_anywhere(p).is_some() || parse_doi(p).is_some());
    for p in page_slices.iter().skip(6) {
        let low = p.to_ascii_lowercase();
        let has_bib_heading = low.contains("\nreferences") || low.contains("\nbibliography") || low.starts_with("references\n");
        if (pages == 0 || pages > 30 || !first_has_paper_id) && !(pages > 0 && pages <= 40 && has_bib_heading) {
            if let Some(isbn) = parse_isbn(p) {
                return Some(isbn);
            }
        }
    }
    None
}

/// Pages read for identifiers: a book's ISBN and DOI sit on its copyright page, past the title pages (up to p. 10).
#[cfg(test)]
const ID_PAGES: usize = 10;
/// A PDF with no journal/arXiv identifiers and more pages than this is filed as a book.
const BOOK_PAGES: usize = 100;
/// A PDF with at least this many pages plus edition/volume markers (and no paper indicators) is filed as a book.
const EDITION_BOOK_PAGES: usize = 70;

/// Metadata parsed from a PDF filename. Unstructured names keep `structured = false` and fall back to
/// `stem.replace(['_', '-'], " ")` for full backward compatibility.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ParsedFilename {
    pub structured: bool,
    pub title: String,
    pub authors: Vec<String>,
    pub year: Option<String>,
    pub volume: Option<String>,
    pub edition: Option<String>,
    pub isbn: Option<String>,
    pub arxiv: Option<String>,
    pub arxiv_version: Option<String>,
}

fn is_year_token(s: &str) -> bool {
    let t = s.trim();
    t.len() == 4 && t.bytes().all(|b| b.is_ascii_digit()) && matches!(&t[..2], "18" | "19" | "20")
}

fn split_spaced_dashes(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut start = 0;
    let seps = [" - ", " \u{2013} ", " \u{2014} "];
    while start <= s.len() {
        let next = seps
            .iter()
            .filter_map(|sep| s[start..].find(sep).map(|idx| (start + idx, sep.len())))
            .min_by_key(|(idx, _)| *idx);
        match next {
            Some((pos, len)) => {
                out.push(s[start..pos].trim().to_string());
                start = pos + len;
            }
            None => {
                out.push(s[start..].trim().to_string());
                break;
            }
        }
    }
    out.into_iter().filter(|p| !p.is_empty()).collect()
}

fn is_surname_particle(word: &str) -> bool {
    matches!(
        word.to_ascii_lowercase().as_str(),
        "de" | "van" | "von" | "der" | "den" | "da" | "di" | "du" | "la" | "le" | "del" | "dos" | "st" | "st."
    )
}

fn format_author_token(raw: &str) -> String {
    let mut t = raw.trim().trim_matches([',', ';']).trim().to_string();
    let low = t.to_ascii_lowercase();
    for suf in [" et al.", " et al"] {
        if low.ends_with(suf) {
            t.truncate(t.len() - suf.len());
            t = t.trim().trim_matches([',', ';']).trim().to_string();
            break;
        }
    }
    if t.is_empty() {
        return String::new();
    }
    if let Some((l, r)) = t.split_once(',') {
        let (l, r) = (l.trim(), r.trim());
        return if r.is_empty() { l.to_string() } else { format!("{l}, {r}") };
    }
    let words: Vec<&str> = t.split_whitespace().collect();
    if words.len() <= 1 || (words.len() == 2 && is_surname_particle(words[0])) {
        return t;
    }
    if words.len() >= 3 && is_surname_particle(words[words.len() - 2]) {
        return format!("{} {}, {}", words[words.len() - 2], words[words.len() - 1], words[..words.len() - 2].join(" "));
    }
    remote::last_first(&t)
}

fn split_case_insensitive_and(s: &str) -> Vec<&str> {
    let low = s.to_ascii_lowercase();
    let mut out = Vec::new();
    let mut start = 0;
    while let Some(pos) = low[start..].find(" and ") {
        out.push(&s[start..start + pos]);
        start += pos + 5;
    }
    out.push(&s[start..]);
    out
}

pub(crate) fn parse_authors_segment(raw: &str) -> Vec<String> {
    let mut cleaned = raw.replace('_', " ");
    let low = cleaned.to_ascii_lowercase();
    for suf in [" et al.", " et al"] {
        if low.ends_with(suf) {
            cleaned.truncate(cleaned.len() - suf.len());
            break;
        }
    }
    let mut out = Vec::new();
    for chunk in cleaned.split([';', '&']).flat_map(split_case_insensitive_and) {
        let piece = chunk.trim();
        if piece.is_empty() {
            continue;
        }
        let comma_parts: Vec<&str> = piece.split(',').map(str::trim).filter(|p| !p.is_empty()).collect();
        match comma_parts.len() {
            0 => {}
            1 => {
                let f = format_author_token(comma_parts[0]);
                if !f.is_empty() {
                    out.push(f);
                }
            }
            2 => {
                let left_words: Vec<&str> = comma_parts[0].split_whitespace().collect();
                if left_words.len() >= 2 && !is_surname_particle(left_words[0]) {
                    for part in comma_parts {
                        let f = format_author_token(part);
                        if !f.is_empty() {
                            out.push(f);
                        }
                    }
                } else {
                    let f = format_author_token(piece);
                    if !f.is_empty() {
                        out.push(f);
                    }
                }
            }
            _ => {
                let paired = comma_parts.len().is_multiple_of(2)
                    && comma_parts.iter().enumerate().all(|(idx, p)| {
                        if idx.is_multiple_of(2) {
                            !p.contains(' ')
                        } else {
                            p.contains('.') || p.split_whitespace().count() <= 2
                        }
                    });
                if paired {
                    for pair in comma_parts.chunks(2) {
                        let f = format_author_token(&format!("{}, {}", pair[0], pair[1]));
                        if !f.is_empty() {
                            out.push(f);
                        }
                    }
                } else {
                    for part in comma_parts {
                        let f = format_author_token(part);
                        if !f.is_empty() {
                            out.push(f);
                        }
                    }
                }
            }
        }
    }
    out
}

fn find_paren_year(s: &str) -> Option<(usize, usize, String)> {
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'(' {
            if let Some(rel_end) = s[i + 1..].find(')') {
                let end = i + 1 + rel_end;
                let inner = &s[i + 1..end];
                if !inner.contains('(') {
                    if let Some(y) = inner
                        .split(|c: char| !c.is_ascii_alphanumeric())
                        .find(|tok| is_year_token(tok))
                    {
                        return Some((i, end + 1, y.to_string()));
                    }
                }
                i = end + 1;
                continue;
            }
        }
        i += 1;
    }
    None
}

fn parse_edition_phrase(inner: &str) -> Option<String> {
    let t = inner.trim().trim_matches([',', ';']).trim();
    let low = t.to_ascii_lowercase();
    let ord_prefix = [
        "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th",
        "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "revised", "rev.", "expanded",
    ];
    for suf in [" edition", " ed.", " ed"] {
        if low.ends_with(suf) && ord_prefix.iter().any(|p| low.starts_with(p)) {
            let stripped = t[..t.len() - suf.len()].trim();
            if !stripped.is_empty() {
                return Some(stripped.to_string());
            }
        }
    }
    if low == "ed." {
        return Some(t.to_string());
    }
    if let Some(rest) = low.strip_prefix("ed.") {
        let rest_t = rest.trim();
        if !rest_t.is_empty() && rest_t.chars().all(|c| c.is_ascii_digit()) {
            return Some(rest_t.to_string());
        }
    }
    None
}

fn strip_trailing_edition(s: &str) -> (String, Option<String>) {
    let mut cur = s.trim().to_string();
    let mut edition = None;
    for sep in [", ", " "] {
        if let Some((before, tail)) = cur.rsplit_once(sep) {
            if let Some(ed) = parse_edition_phrase(tail) {
                edition = Some(ed);
                cur = before.trim().trim_end_matches(',').trim().to_string();
                break;
            }
            // Check 2-word tails like ", 2nd ed." or ", Second Edition".
            if let Some((b2, mid)) = before.rsplit_once(sep) {
                let combined = format!("{mid}{sep}{tail}");
                if let Some(ed) = parse_edition_phrase(&combined) {
                    edition = Some(ed);
                    cur = b2.trim().trim_end_matches(',').trim().to_string();
                    break;
                }
            }
        }
    }
    (cur, edition)
}

fn is_valid_volume_token(tok: &str) -> Option<String> {
    let t = tok.trim().trim_end_matches(['.', ',', ';', ')']);
    if t.is_empty() {
        return None;
    }
    let digits_or_range = t
        .split('-')
        .all(|p| !p.is_empty() && p.len() <= 4 && p.chars().all(|c| c.is_ascii_digit()));
    let roman = matches!(
        t.to_ascii_uppercase().as_str(),
        "I" | "II" | "III" | "IV" | "V" | "VI" | "VII" | "VIII" | "IX" | "X" | "XI" | "XII"
    );
    (digits_or_range || roman).then(|| t.to_string())
}

fn extract_volume_from_str(s: &str) -> (String, Option<String>) {
    let low = s.to_ascii_lowercase();
    for pat in [", vol.", ", vol ", ", volume ", "(vol.", "(vol ", "(volume ", " vol.", " volume "] {
        if let Some(idx) = low.find(pat) {
            let after_pat = idx + pat.len();
            let rest = s[after_pat..].trim_start();
            let tok_end = rest.find(|c: char| c.is_whitespace() || matches!(c, ')' | ',' | ';')).unwrap_or(rest.len());
            if let Some(vol) = is_valid_volume_token(&rest[..tok_end]) {
                let mut end = after_pat + (s[after_pat..].len() - rest.len()) + tok_end;
                if pat.starts_with('(') && s[end..].starts_with(')') {
                    end += 1;
                }
                let mut out = format!("{} {}", s[..idx].trim_end(), s[end..].trim_start());
                out = out.trim().trim_matches(',').split_whitespace().collect::<Vec<_>>().join(" ");
                return (out, Some(vol));
            }
        }
    }
    (s.to_string(), None)
}

fn extract_paren_tags(s: &str) -> (String, Option<String>, Option<String>) {
    let mut cur = s.to_string();
    let mut year = None;
    let mut edition = None;
    let mut changed = true;
    while changed {
        changed = false;
        let bytes = cur.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'(' || bytes[i] == b'[' {
                let close = if bytes[i] == b'(' { ')' } else { ']' };
                if let Some(rel_end) = cur[i + 1..].find(close) {
                    let end = i + 1 + rel_end;
                    let inner = cur[i + 1..end].trim().to_string();
                    let inner_low = inner.to_ascii_lowercase();
                    let is_isbn = inner_low.contains("isbn") && parse_isbn(&inner).is_some();
                    let inner_year = inner
                        .split(|c: char| !c.is_ascii_alphanumeric())
                        .find(|tok| is_year_token(tok))
                        .map(String::from);
                    let only_year_or_ed = if is_isbn {
                        true
                    } else if let Some(ed) = parse_edition_phrase(&inner) {
                        if edition.is_none() {
                            edition = Some(ed);
                        }
                        true
                    } else if is_year_token(&inner) {
                        if year.is_none() {
                            year = Some(inner.clone());
                        }
                        true
                    } else if let Some(y) = inner_year {
                        // e.g. "(2nd ed., 2020)" or "(Springer, 2008)" or "(1967, Editions de Minuit)"
                        let without_y = inner.replace(&y, "");
                        let without_y_trim = without_y.trim().trim_matches([',', ';']).trim();
                        let starts_or_ends_with_year = inner
                            .strip_prefix(y.as_str())
                            .is_some_and(|r| r.trim_start().starts_with(','))
                            || inner
                                .strip_suffix(y.as_str())
                                .is_some_and(|r| r.trim_end().ends_with(','));
                        if let Some(ed) = parse_edition_phrase(without_y_trim) {
                            if edition.is_none() {
                                edition = Some(ed);
                            }
                            if year.is_none() {
                                year = Some(y);
                            }
                            true
                        } else if without_y_trim.is_empty() || starts_or_ends_with_year {
                            if year.is_none() {
                                year = Some(y);
                            }
                            true
                        } else {
                            false
                        }
                    } else {
                        false
                    };
                    if only_year_or_ed {
                        cur = format!("{} {}", cur[..i].trim_end(), cur[end + 1..].trim_start())
                            .trim()
                            .to_string();
                        changed = true;
                        break;
                    }
                    i = end + 1;
                    continue;
                }
            }
            i += 1;
        }
    }
    (cur.split_whitespace().collect::<Vec<_>>().join(" "), year, edition)
}

fn extract_author_year(seg: &str) -> (String, Option<String>) {
    let (cleaned, paren_y, _) = extract_paren_tags(seg);
    if paren_y.is_some() {
        return (cleaned.trim_matches([',', ' ']).to_string(), paren_y);
    }
    let t = cleaned.trim();
    if t.len() >= 4 && t.is_char_boundary(t.len() - 4) {
        let tail = &t[t.len() - 4..];
        if is_year_token(tail) {
            let before = &t[..t.len() - 4];
            if before.is_empty() || !before.ends_with(|c: char| c.is_ascii_digit()) {
                return (before.trim().trim_end_matches([',', ';', ' ']).to_string(), Some(tail.to_string()));
            }
        }
    }
    (t.to_string(), None)
}

fn strip_mirror_tags(stem: &str) -> String {
    let is_mirror_token = |raw: &str| -> bool {
        let low = raw.trim().to_ascii_lowercase();
        matches!(
            low.as_str(),
            "z-library" | "z-lib" | "z-lib.org" | "zlibrary" | "libgen" | "libgen.li" | "libgen.lc" | "libgen.rs" | "libgen.is"
        )
    };
    let mut cur = stem.to_string();
    let mut stripped = true;
    while stripped {
        stripped = false;
        let low = cur.to_ascii_lowercase();
        for suf in [" - libgen.li", " - libgen.lc", " - libgen.rs", " - libgen.is", " - libgen", " - z-lib.org", " - z-library", " - z-lib"] {
            if low.ends_with(suf) {
                cur.truncate(cur.len() - suf.len());
                cur = cur.trim_end().to_string();
                stripped = true;
                break;
            }
        }
    }
    let mut out = String::with_capacity(cur.len());
    let mut i = 0;
    while i < cur.len() {
        let ch = cur[i..].chars().next().unwrap();
        if ch == '(' || ch == '[' {
            let close = if ch == '(' { ')' } else { ']' };
            if let Some(rel_end) = cur[i + 1..].find(close) {
                let inner = &cur[i + 1..i + 1 + rel_end];
                if is_mirror_token(inner) {
                    i += 1 + rel_end + 1;
                    continue;
                }
            }
        }
        out.push(ch);
        i += ch.len_utf8();
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

const PUBLISHER_SUFFIXES: &[&str] = &[
    "cambridge university press", "oxford university press", "princeton university press",
    "harvard university press", "yale university press", "stanford university press",
    "university of chicago press", "mit press", "springer-verlag", "springer verlag",
    "springer", "routledge", "john wiley & sons", "wiley", "dover publications", "dover",
    "elsevier", "academic press", "addison-wesley", "addison wesley", "world scientific",
    "prentice hall", "crc press", "taylor & francis", "birkhäuser", "birkhauser",
    "walter de gruyter", "de gruyter", "american mathematical society", "siam", "pearson",
    "mcgraw-hill", "macmillan", "basic books",
];

fn strip_publisher_suffix(stem: &str) -> (String, Option<String>) {
    let t = stem.trim();
    let mut year_out: Option<String> = None;
    let body = if let Some(stripped) = t.strip_suffix(')') {
        if let Some((before, inner)) = stripped.rsplit_once('(') {
            let trimmed_inner = inner.trim();
            if is_year_token(trimmed_inner) {
                year_out = Some(trimmed_inner.to_string());
                before.trim_end()
            } else {
                t
            }
        } else {
            t
        }
    } else {
        t
    };
    let low = body.to_lowercase();
    for pub_name in PUBLISHER_SUFFIXES {
        let pat = format!("-{pub_name}");
        if low.ends_with(&pat) {
            let cut = body.len().saturating_sub(pat.len());
            if body.is_char_boundary(cut) {
                let prefix = body[..cut].trim_end();
                if !prefix.is_empty() {
                    return (prefix.to_string(), year_out);
                }
            }
        }
    }
    (stem.to_string(), None)
}

fn strip_sort_prefix(stem: &str) -> &str {
    let bytes = stem.as_bytes();
    if bytes.len() >= 4 && matches!(bytes[0], b'z' | b'Z') && matches!(bytes[1], b'_' | b'-') {
        let rest = &stem[2..];
        if rest.chars().next().is_some_and(|c| c.is_uppercase())
            && (split_spaced_dashes(rest).len() >= 2
                || find_paren_year(rest).is_some()
                || extract_volume_from_str(rest).1.is_some())
        {
            return rest;
        }
    }
    if bytes.len() >= 5 && bytes[0] == b'z' && bytes[1].is_ascii_uppercase() && bytes[2].is_ascii_lowercase() {
        let rest = &stem[1..];
        if split_spaced_dashes(rest).len() >= 2 {
            return rest;
        }
    }
    stem
}

fn looks_like_title_segment(seg: &str) -> bool {
    let t = seg.trim();
    let words: Vec<&str> = t.split_whitespace().collect();
    if t.contains(':') && words.len() >= 3 && !t.split(':').next().unwrap_or("").contains(',') {
        return true;
    }
    if words.len() >= 4 {
        let low = t.to_ascii_lowercase();
        if ["the ", "an ", "a ", "on ", "introduction to ", "lectures on "]
            .iter()
            .any(|p| low.starts_with(p))
        {
            return true;
        }
    }
    false
}

fn looks_like_clean_person(seg: &str) -> bool {
    let t = seg.trim();
    if t.is_empty()
        || t.chars().any(|c| c.is_ascii_digit() || matches!(c, ',' | ';' | ':' | '(' | ')' | '[' | ']' | '&'))
    {
        return false;
    }
    let low = t.to_ascii_lowercase();
    if ["edition", "ed.", "vol.", "volume"].iter().any(|w| low.contains(w)) {
        return false;
    }
    let words: Vec<&str> = t.split_whitespace().collect();
    (2..=3).contains(&words.len())
        && words.iter().all(|w| is_surname_particle(w) || w.chars().next().is_some_and(char::is_uppercase))
        && words.last().is_some_and(|w| w.chars().filter(|c| c.is_alphabetic()).count() >= 2)
}

/// Extracts `(clean_title, authors)` from an unstructured title ending with `(First Last)`
/// when the title has `>= 2` words and the trailing `(...)` is a 2-4 word personal name.
pub fn split_trailing_paren_author(title: &str) -> Option<(String, Vec<String>)> {
    const NON_NAMES: &[&str] = &[
        "notes", "draft", "part", "vol", "volume", "edition", "ed", "revised", "expanded",
        "pdf", "scan", "ebook", "book", "press", "university", "publishing", "publications",
        "springer", "wiley", "elsevier", "cambridge", "oxford", "mit", "lecture", "lectures",
        "course", "solution", "solutions", "manual", "preprint", "reprint", "translation",
        "translated", "annotated",
    ];
    let t = title.trim();
    if !t.ends_with(')') {
        return None;
    }
    let (before, inner_raw) = t[..t.len() - 1].rsplit_once('(')?;
    let clean_title = before.trim();
    if clean_title.split_whitespace().count() < 2 {
        return None;
    }
    let inner = inner_raw.trim();
    if inner.is_empty() || inner.chars().any(|c| c.is_ascii_digit()) {
        return None;
    }
    let words: Vec<&str> = inner.split_whitespace().collect();
    if !(2..=4).contains(&words.len()) {
        return None;
    }
    for w in &words {
        let low = w.trim_matches(|c: char| !c.is_alphanumeric()).to_ascii_lowercase();
        if low.is_empty() || NON_NAMES.contains(&low.as_str()) {
            return None;
        }
        if !(is_surname_particle(w) || w.chars().next().is_some_and(char::is_uppercase)) {
            return None;
        }
    }
    if words.last().is_none_or(|w| w.chars().filter(|c| c.is_alphabetic()).count() < 2) {
        return None;
    }
    let authors = parse_authors_segment(inner);
    (!authors.is_empty()).then(|| (clean_title.to_string(), authors))
}

/// Parses structured PDF filenames (`Author - Title - Year.pdf`, `Author - Title (Year).pdf`,
/// `{Author}{Year} - {Title}.pdf`, `Author - Title, Vol. N.pdf`, `Title - Author.pdf`) while preserving
/// unstructured filename behavior (`stem.replace(['_', '-'], " ")` with `structured = false`).
pub fn parse_filename(name: &str) -> ParsedFilename {
    let decoded = kandinsky_text::links::percent_decoded(name);
    let fname = decoded.rsplit(['/', '\\']).next().unwrap_or(&decoded);
    let raw_stem = if fname.len() > 4 && fname.as_bytes()[fname.len() - 4..].eq_ignore_ascii_case(b".pdf") {
        &fname[..fname.len() - 4]
    } else {
        fname
    };
    let clean_stem = strip_mirror_tags(raw_stem);
    let stem0 = if clean_stem.is_empty() { raw_stem } else { clean_stem.as_str() };
    let stem1 = strip_sort_prefix(stem0);
    let (stem_after_pub, pub_year) = strip_publisher_suffix(stem1);
    let stem = stem_after_pub.as_str();
    let isbn = parse_isbn(stem);
    let ax = remote::parse_arxiv_anywhere(stem);
    let arxiv = ax.as_ref().map(|(a, _)| a.clone());
    let arxiv_version = ax.and_then(|(_, v)| v);

    let segs = split_spaced_dashes(stem);
    let has_spaced_dash = segs.len() >= 2;
    let has_paren_year = find_paren_year(stem).is_some() || pub_year.is_some();
    let has_vol = extract_volume_from_str(stem).1.is_some();
    let structured = has_spaced_dash || has_paren_year || has_vol;

    if !structured {
        let title = stem.replace(['_', '-'], " ").split_whitespace().collect::<Vec<_>>().join(" ");
        return ParsedFilename {
            structured: false,
            title,
            authors: Vec::new(),
            year: None,
            volume: None,
            edition: None,
            isbn,
            arxiv,
            arxiv_version,
        };
    }

    let mut year: Option<String> = pub_year;
    let mut volume: Option<String> = None;
    let mut edition: Option<String> = None;
    let mut authors: Vec<String> = Vec::new();

    let title_raw = if segs.len() >= 2 {
        let mut work = segs;
        if work.len() >= 2 && is_year_token(&work[work.len() - 1]) {
            let y = work.pop();
            if year.is_none() {
                year = y;
            }
        }
        if work.len() >= 2 && is_year_token(&work[0]) {
            if year.is_none() {
                year = Some(work.remove(0));
            } else {
                work.remove(0);
            }
        }
        if work.len() == 2 && looks_like_title_segment(&work[0]) && looks_like_clean_person(&work[1]) {
            authors = parse_authors_segment(&work[1]);
            work.remove(0)
        } else if work.len() >= 2 {
            let first_seg = work.remove(0);
            let (author_part, ay) = extract_author_year(&first_seg);
            if year.is_none() {
                year = ay;
            }
            authors = parse_authors_segment(&author_part);
            let mut clean_parts = Vec::new();
            for part in work {
                let (p1, py, pe) = extract_paren_tags(&part);
                if year.is_none() {
                    year = py;
                }
                if edition.is_none() {
                    edition = pe;
                }
                let (p2, pv) = extract_volume_from_str(&p1);
                if volume.is_none() {
                    volume = pv;
                }
                let (p3, pe2) = strip_trailing_edition(&p2);
                if edition.is_none() {
                    edition = pe2;
                }
                if !p3.is_empty() {
                    clean_parts.push(p3);
                }
            }
            clean_parts.join(" - ")
        } else {
            work.into_iter().next().unwrap_or_default()
        }
    } else {
        stem.to_string()
    };

    let (t1, py, pe) = extract_paren_tags(&title_raw);
    if year.is_none() {
        year = py;
    }
    if edition.is_none() {
        edition = pe;
    }
    let (t2, pv) = extract_volume_from_str(&t1);
    if volume.is_none() {
        volume = pv;
    }
    let (t3, pe2) = strip_trailing_edition(&t2);
    if edition.is_none() {
        edition = pe2;
    }
    let title = t3
        .replace('_', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let title = if title.is_empty() {
        stem.replace(['_', '-'], " ").split_whitespace().collect::<Vec<_>>().join(" ")
    } else {
        title
    };

    ParsedFilename {
        structured: true,
        title,
        authors,
        year,
        volume,
        edition,
        isbn,
        arxiv,
        arxiv_version,
    }
}

/// High-level reference category for classifying PDFs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ItemClass {
    Paper,
    Book,
    Thesis,
    Notes,
}

impl ItemClass {
    pub fn as_kind(self) -> &'static str {
        match self {
            ItemClass::Paper => "paper",
            ItemClass::Book => "book",
            ItemClass::Thesis => "thesis",
            ItemClass::Notes => "notes",
        }
    }

    pub fn default_item_type(self, has_arxiv: bool) -> &'static str {
        match self {
            ItemClass::Book => "book",
            ItemClass::Thesis => "thesis",
            ItemClass::Notes => "manuscript",
            ItemClass::Paper => {
                if has_arxiv {
                    "preprint"
                } else {
                    "document"
                }
            }
        }
    }
}

static EMPTY_PARSED_FILENAME: ParsedFilename = ParsedFilename {
    structured: false,
    title: String::new(),
    authors: Vec::new(),
    year: None,
    volume: None,
    edition: None,
    isbn: None,
    arxiv: None,
    arxiv_version: None,
};

pub struct ClassifyInput<'a> {
    pub text: &'a str,
    pub pages: usize,
    pub filename: &'a str,
    pub rel_dir: Option<&'a str>,
    pub parsed: &'a ParsedFilename,
    pub isbn: Option<&'a str>,
    pub doi: Option<&'a str>,
    pub arxiv: Option<&'a str>,
    pub remote_type: Option<&'a str>,
    pub explicit_kind: Option<&'a str>,
}

impl<'a> Default for ClassifyInput<'a> {
    fn default() -> Self {
        Self {
            text: "",
            pages: 0,
            filename: "",
            rel_dir: None,
            parsed: &EMPTY_PARSED_FILENAME,
            isbn: None,
            doi: None,
            arxiv: None,
            remote_type: None,
            explicit_kind: None,
        }
    }
}

fn has_book_edition_or_volume_marker(parsed: &ParsedFilename, text: &str) -> bool {
    if parsed.edition.is_some() || parsed.volume.is_some() {
        return true;
    }
    let head: String = text
        .split('\x0c')
        .take(5)
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();
    let markers = [
        "second edition",
        "third edition",
        "fourth edition",
        "fifth edition",
        "revised edition",
        "student edition",
        "international edition",
        "2nd edition",
        "3rd edition",
        "4th edition",
        "2nd ed.",
        "3rd ed.",
        "4th ed.",
        "volume 1",
        "volume 2",
        "volume i",
        "volume ii",
        "vol. 1",
        "vol. 2",
        "vol. i",
        "vol. ii",
        "library of congress cataloging",
        "all rights reserved",
        "cambridge university press",
        "oxford university press",
        "springer",
    ];
    markers.iter().any(|m| head.contains(m))
}

fn folder_hint(rel_dir: Option<&str>) -> Option<ItemClass> {
    let dir = rel_dir?;
    for raw_seg in dir.split(['/', '\\']).rev() {
        let seg = raw_seg.trim().to_ascii_lowercase().replace(['_', '-'], " ");
        let seg = seg.split_whitespace().collect::<Vec<_>>().join(" ");
        if matches!(seg.as_str(), "theses" | "thesis" | "dissertations" | "dissertation" | "phd theses") {
            return Some(ItemClass::Thesis);
        }
        if matches!(seg.as_str(), "lecture notes" | "course notes" | "lecturenotes" | "handouts" | "notes") {
            return Some(ItemClass::Notes);
        }
        if matches!(
            seg.as_str(),
            "books" | "book" | "textbooks" | "textbook" | "monographs" | "monograph" | "handbooks" | "handbook" | "reference books"
        ) {
            return Some(ItemClass::Book);
        }
    }
    None
}

fn looks_like_book_doi(doi: &str) -> bool {
    let d = norm_doi(doi);
    d.contains("/978") || d.contains("/979") || d.contains("/cbo") || d.contains("/acprof:")
}

/// Classifies a PDF as `Book`, `Thesis`, `Notes`, or `Paper` using copyright-page ISBN detection,
/// page counts (`> 100` pages, or `>= 70` pages with edition/volume markers), folder context hints,
/// and presence/absence of journal/arXiv/DOI indicators.
pub fn classify_pdf(input: &ClassifyInput<'_>) -> ItemClass {
    if let Some(k) = input.explicit_kind.map(str::trim).filter(|k| !k.is_empty()) {
        return match normalized_kind(k) {
            "book" => ItemClass::Book,
            "thesis" => ItemClass::Thesis,
            "notes" => ItemClass::Notes,
            _ => ItemClass::Paper,
        };
    }
    if let Some(rt) = input.remote_type.map(str::trim).filter(|t| !t.is_empty() && *t != "document") {
        return match normalized_kind(rt) {
            "book" => ItemClass::Book,
            "thesis" => ItemClass::Thesis,
            "notes" => ItemClass::Notes,
            _ => ItemClass::Paper,
        };
    }

    if input.isbn.is_some() {
        return ItemClass::Book;
    }

    let hint = folder_hint(input.rel_dir);
    if matches!(hint, Some(ItemClass::Thesis | ItemClass::Notes)) {
        return hint.unwrap();
    }
    if hint == Some(ItemClass::Book) && input.arxiv.is_none() && !input.doi.is_some_and(|d| !looks_like_book_doi(d)) {
        return ItemClass::Book;
    }

    let front_low = crate::pdf_meta::normalize_pdf_unicode(
        &input.text.split('\x0c').take(3).collect::<Vec<_>>().join("\n"),
    )
    .to_ascii_lowercase();
    let name_low = crate::pdf_meta::normalize_pdf_unicode(input.filename).to_ascii_lowercase();
    if front_low.contains("phd thesis")
        || front_low.contains("ph.d. thesis")
        || front_low.contains("doctoral dissertation")
        || front_low.contains("doctoral thesis")
        || front_low.contains("master's thesis")
        || front_low.contains("submitted in partial fulfillment")
        || front_low.contains("submitted in partial fulfilment")
        || front_low.contains("in fulfilment of")
        || front_low.contains("a thesis submitted for the degree of")
        || front_low.contains("submitted for the degree of doctor")
        || front_low.contains("a dissertation presented")
        || front_low.contains("diplomarbeit")
        || front_low.contains("masterarbeit")
        || front_low.contains("habilitation")
        || front_low.contains("thèse de doctorat")
        || front_low.contains("these de doctorat")
        || name_low.starts_with("these de ")
        || name_low.starts_with("thèse de ")
    {
        return ItemClass::Thesis;
    }

    if input.arxiv.is_some() {
        return ItemClass::Paper;
    }
    if input.doi.is_some_and(|d| !looks_like_book_doi(d)) && input.pages <= BOOK_PAGES {
        return ItemClass::Paper;
    }

    if input.pages <= BOOK_PAGES
        && input.doi.is_none()
        && (front_low.contains("lecture notes") || front_low.contains("course notes"))
        && hint != Some(ItemClass::Book)
    {
        return ItemClass::Notes;
    }

    if input.pages > BOOK_PAGES {
        return ItemClass::Book;
    }
    if input.pages >= EDITION_BOOK_PAGES && has_book_edition_or_volume_marker(input.parsed, input.text) {
        return ItemClass::Book;
    }
    if hint == Some(ItemClass::Book) && !name_low.contains("arxiv") {
        return ItemClass::Book;
    }

    ItemClass::Paper
}

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct PdfIds {
    pub doi: Option<String>,
    pub arxiv: Option<String>,
    pub arxiv_version: Option<String>,
    pub isbn: Option<String>,
}

impl PdfIds {
    pub fn is_empty(&self) -> bool {
        self.doi.is_none() && self.arxiv.is_none() && self.isbn.is_none()
    }
}

#[cfg(test)]
pub(crate) fn extract_pdf_identifiers(text: &str, pages: usize, name: &str) -> PdfIds {
    extract_pdf_identifiers_with_meta(text, pages, name, None)
}

pub(crate) fn extract_pdf_identifiers_with_meta(
    text: &str,
    pages: usize,
    name: &str,
    meta: Option<&crate::pdf_meta::PdfDocMeta>,
) -> PdfIds {
    let parsed_name = parse_filename(name);
    let page_slices: Vec<&str> = text.split('\x0c').collect();
    let first_page = page_slices.first().copied().unwrap_or("");
    let isbn = parse_isbn_for_pdf(text, pages)
        .or_else(|| meta.and_then(|mt| mt.isbn.clone()))
        .or(parsed_name.isbn);

    let ax_pair = remote::parse_arxiv_anywhere(first_page)
        .or_else(|| parsed_name.arxiv.clone().map(|a| (a, parsed_name.arxiv_version.clone())))
        .or_else(|| meta.and_then(|mt| mt.arxiv.clone().map(|a| (a, mt.arxiv_version.clone()))))
        .or_else(|| {
            page_slices
                .iter()
                .skip(1)
                .take(2)
                .filter(|p| p.to_ascii_lowercase().contains("arxiv"))
                .find_map(|p| remote::parse_arxiv_versioned(p))
        });

    let mut doi = page_slices.iter().take(6).find_map(|p| parse_doi(p));
    if doi.is_none() {
        doi = meta.and_then(|mt| mt.doi.clone());
    }
    if doi.is_none() && isbn.is_none() {
        doi = parse_doi(text);
    }

    let (mut arxiv, arxiv_version) = match ax_pair {
        Some((a, v)) => (Some(a), v),
        None => (None, None),
    };
    if arxiv.is_none() {
        if let Some(ax_from_doi) = doi
            .as_deref()
            .filter(|d| norm_doi(d).starts_with("10.48550/arxiv."))
            .and_then(remote::parse_arxiv_anywhere)
        {
            arxiv = Some(ax_from_doi.0);
        }
    }

    PdfIds { doi, arxiv, arxiv_version, isbn }
}

pub(crate) fn fetch_arxiv_mapping(net: &dyn Net, base_id: &str, ver: Option<&str>) -> Option<Mapping> {
    let mut m = match ver {
        Some(v) => remote::arxiv(net, &format!("{base_id}{v}")).or_else(|_| remote::arxiv(net, base_id)).ok()?,
        None => remote::arxiv(net, base_id).ok()?,
    };
    if let Some(v) = ver {
        m.insert("arxivVersion".into(), v.to_string().into());
        m.insert("archiveID".into(), format!("arXiv:{base_id}{v}").into());
        m.insert("url".into(), format!("https://arxiv.org/abs/{base_id}{v}").into());
    }
    Some(m)
}

fn pick_local_authors(
    parsed: &ParsedFilename,
    first: Option<&crate::firstpage::FirstPage>,
    meta: Option<&crate::pdf_meta::PdfDocMeta>,
) -> Vec<String> {
    let fp_authors: Vec<String> = first
        .map(|f| f.authors.iter().map(|a| format_author_token(a)).filter(|a| !a.is_empty()).collect())
        .unwrap_or_default();
    let meta_authors: Vec<String> = meta
        .map(|mt| mt.authors.iter().map(|a| format_author_token(a)).filter(|a| !a.is_empty()).collect())
        .unwrap_or_default();
    if parsed.authors.len() >= 2 {
        return parsed.authors.clone();
    }
    if fp_authors.len() >= 2 {
        return fp_authors;
    }
    if meta_authors.len() >= 2 {
        return meta_authors;
    }
    if !parsed.authors.is_empty() {
        return parsed.authors.clone();
    }
    if !fp_authors.is_empty() {
        return fp_authors;
    }
    if !meta_authors.is_empty() {
        return meta_authors;
    }
    if !parsed.structured && first.is_none() {
        if let Some((_, inferred)) = split_trailing_paren_author(&parsed.title) {
            return inferred;
        }
    }
    Vec::new()
}

pub(crate) fn lookup_pdf_remote_with_meta(
    net: &dyn Net,
    email: &str,
    class: ItemClass,
    ids: &PdfIds,
    parsed: &ParsedFilename,
    first: Option<&crate::firstpage::FirstPage>,
    meta: Option<&crate::pdf_meta::PdfDocMeta>,
) -> Option<(Mapping, &'static str)> {
    let inferred = if !parsed.structured && first.is_none() {
        split_trailing_paren_author(&parsed.title)
    } else {
        None
    };
    let local_authors = pick_local_authors(parsed, first, meta);

    if class == ItemClass::Book {
        let title_hint = if parsed.structured && !parsed.title.is_empty() {
            Some(parsed.title.clone())
        } else {
            first
                .map(|f| f.title.clone())
                .or_else(|| meta.and_then(|mt| mt.title.clone()))
                .or_else(|| inferred.as_ref().map(|(t, _)| t.clone()))
        };
        let author_hint = local_authors.first().map(String::as_str);
        if ids.isbn.is_some() || ids.doi.is_some() || title_hint.is_some() {
            if let Some((m, src)) = remote::lookup_book_metadata(
                net,
                ids.isbn.as_deref(),
                ids.doi.as_deref(),
                title_hint.as_deref(),
                author_hint,
                email,
            ) {
                return Some((m, src));
            }
        }
        return None;
    }

    if let Some(d) = ids.doi.as_deref() {
        if let Ok(m) = remote::crossref_with_openalex(net, d, email) {
            return Some((m, "crossref"));
        }
    }
    if let Some(a) = ids.arxiv.as_deref() {
        if let Some(m) = fetch_arxiv_mapping(net, a, ids.arxiv_version.as_deref()) {
            return Some((m, "arxiv"));
        }
    }
    if class == ItemClass::Paper {
        if let Some(fp) = first {
            if let Some(d) = crate::firstpage::crossref_match(net, fp) {
                if let Ok(m) = remote::crossref_with_openalex(net, &d, email) {
                    return Some((m, "crossref"));
                }
            }
        }
    }
    if matches!(class, ItemClass::Paper | ItemClass::Thesis | ItemClass::Notes) {
        let title_hint = first
            .map(|f| f.title.clone())
            .or_else(|| meta.and_then(|mt| mt.title.clone()))
            .or_else(|| (parsed.structured && !parsed.title.is_empty()).then(|| parsed.title.clone()))
            .or_else(|| inferred.as_ref().map(|(t, _)| t.clone()));
        if let Some(t) = title_hint {
            let year_hint = parsed
                .year
                .as_deref()
                .or_else(|| first.and_then(|f| f.year.as_deref()))
                .or_else(|| meta.and_then(|mt| mt.year.as_deref()));
            if let Some(hit) = remote::lookup_work_by_title_author(net, email, &t, &local_authors, year_hint) {
                return Some(hit);
            }
        }
    }
    if let Some(i) = ids.isbn.as_deref() {
        if let Some((m, src)) = remote::lookup_book_metadata(net, Some(i), None, None, None, email) {
            return Some((m, src));
        }
    }
    None
}

pub(crate) fn merge_local_fallbacks_with_meta(
    m: &mut Mapping,
    parsed: &ParsedFilename,
    first: Option<&crate::firstpage::FirstPage>,
    meta: Option<&crate::pdf_meta::PdfDocMeta>,
    ids: &PdfIds,
    pages: usize,
    class: ItemClass,
) {
    if s(m, "type").as_deref().is_none_or(|t| t == "document") {
        m.insert("type".into(), class.default_item_type(ids.arxiv.is_some()).into());
    }
    if s(m, "title").is_none() {
        let inferred_t = if !parsed.structured && first.is_none() {
            split_trailing_paren_author(&parsed.title).map(|(t, _)| t)
        } else {
            None
        };
        let fallback_title = if parsed.structured && !parsed.title.is_empty() {
            parsed.title.clone()
        } else if let Some(fp) = first {
            fp.title.clone()
        } else if let Some(t) = meta.and_then(|mt| mt.title.as_deref()) {
            t.to_string()
        } else if let Some(t) = inferred_t {
            t
        } else {
            parsed.title.clone()
        };
        if !fallback_title.is_empty() {
            m.insert("title".into(), fallback_title.into());
        }
    }
    if list(m, "author").is_empty() {
        let authors: Vec<Value> = pick_local_authors(parsed, first, meta).into_iter().map(Value::from).collect();
        if !authors.is_empty() {
            m.insert("author".into(), Value::Sequence(authors));
        }
    }
    if s(m, "date").is_none() {
        if let Some(y) = parsed
            .year
            .as_deref()
            .or_else(|| first.and_then(|fp| fp.year.as_deref()))
            .or_else(|| meta.and_then(|mt| mt.year.as_deref()))
        {
            m.insert("date".into(), y.to_string().into());
        }
    }
    if s(m, "DOI").is_none() {
        if let Some(d) = &ids.doi {
            m.insert("DOI".into(), d.clone().into());
        }
    }
    if s(m, "ISBN").is_none() {
        if let Some(i) = &ids.isbn {
            m.insert("ISBN".into(), i.clone().into());
        }
    }
    if s(m, "archiveID").is_none() {
        if let Some(ax) = &ids.arxiv {
            let ver = ids.arxiv_version.as_deref().unwrap_or("");
            m.insert("archiveID".into(), format!("arXiv:{ax}{ver}").into());
            if !ver.is_empty() && s(m, "arxivVersion").is_none() {
                m.insert("arxivVersion".into(), ver.to_string().into());
            }
            if s(m, "url").is_none() {
                m.insert("url".into(), format!("https://arxiv.org/abs/{ax}{ver}").into());
            }
        }
    }
    if s(m, "abstractNote").is_none() {
        if let Some(abs) = meta.and_then(|mt| mt.abstract_text.as_deref()) {
            m.insert("abstractNote".into(), abs.into());
        }
    }
    if list(m, "tags").is_empty() {
        if let Some(kws) = meta.map(|mt| &mt.keywords).filter(|k| !k.is_empty()) {
            m.insert("tags".into(), Value::Sequence(kws.iter().cloned().map(Value::from).collect()));
        }
    }
    if class != ItemClass::Book && s(m, "publicationTitle").is_none() {
        if let Some(v) = meta.and_then(|mt| mt.venue.as_deref()) {
            m.insert("publicationTitle".into(), v.into());
        }
    }
    if s(m, "volume").is_none() {
        if let Some(v) = &parsed.volume {
            m.insert("volume".into(), v.clone().into());
        }
    }
    if s(m, "edition").is_none() {
        if let Some(ed) = &parsed.edition {
            m.insert("edition".into(), ed.clone().into());
        }
    }
    if pages > 0 && s(m, "numPages").is_none() {
        m.insert("numPages".into(), pages.to_string().into());
    }
}

pub(crate) fn build_local_entry_mapping(
    parsed: &ParsedFilename,
    first: Option<&crate::firstpage::FirstPage>,
    ids: &PdfIds,
    pages: usize,
    class: ItemClass,
) -> (Mapping, &'static str) {
    build_local_entry_mapping_with_meta(parsed, first, None, ids, pages, class)
}

pub(crate) fn build_local_entry_mapping_with_meta(
    parsed: &ParsedFilename,
    first: Option<&crate::firstpage::FirstPage>,
    meta: Option<&crate::pdf_meta::PdfDocMeta>,
    ids: &PdfIds,
    pages: usize,
    class: ItemClass,
) -> (Mapping, &'static str) {
    let mut m = Mapping::new();
    let authors = pick_local_authors(parsed, first, meta);
    let (title, year, source) = if parsed.structured {
        let t = if !parsed.title.is_empty() {
            parsed.title.clone()
        } else {
            first
                .map(|f| f.title.clone())
                .or_else(|| meta.and_then(|mt| mt.title.clone()))
                .unwrap_or_default()
        };
        let y = parsed
            .year
            .clone()
            .or_else(|| first.and_then(|f| f.year.clone()))
            .or_else(|| meta.and_then(|mt| mt.year.clone()));
        (t, y, "filename")
    } else if let Some(fp) = first {
        (fp.title.clone(), fp.year.clone().or_else(|| meta.and_then(|mt| mt.year.clone())), "firstpage")
    } else if let Some(mt_title) = meta.and_then(|mt| mt.title.clone()) {
        (mt_title, meta.and_then(|mt| mt.year.clone()), "pdf_meta")
    } else if let Some((inf_t, _)) = split_trailing_paren_author(&parsed.title) {
        (inf_t, None, "filename")
    } else {
        (parsed.title.clone(), None, "filename")
    };

    m.insert("type".into(), class.default_item_type(ids.arxiv.is_some()).into());
    if !title.is_empty() {
        m.insert("title".into(), title.into());
    }
    if !authors.is_empty() {
        m.insert("author".into(), Value::Sequence(authors.into_iter().map(Value::from).collect()));
    }
    if let Some(y) = year {
        m.insert("date".into(), y.into());
    }
    merge_local_fallbacks_with_meta(&mut m, parsed, first, meta, ids, pages, class);
    (m, source)
}

/// An entry's fields from what a PDF's first page says (firstpage.rs); a long one is a book.
pub(crate) fn first_page_entry(p: &crate::firstpage::FirstPage, pages: usize) -> Mapping {
    let mut m = Mapping::new();
    let is_book = pages > BOOK_PAGES || (pages >= EDITION_BOOK_PAGES && has_book_edition_or_volume_marker(&ParsedFilename::default(), &p.title));
    m.insert("type".into(), if is_book { "book" } else { "document" }.into());
    m.insert("title".into(), p.title.clone().into());
    m.insert("author".into(), Value::Sequence(p.authors.iter().map(|a| Value::from(remote::last_first(a))).collect()));
    if let Some(y) = &p.year {
        m.insert("date".into(), y.clone().into());
    }
    if pages > 0 {
        m.insert("numPages".into(), pages.to_string().into());
    }
    m
}

#[cfg(test)]
pub(crate) fn pdf_text(bytes: &[u8]) -> (String, usize) {
    let ext = crate::pdf_meta::extract_pdf_doc(bytes);
    (ext.text, ext.pages)
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::entry::tests::Plain;
    use crate::net::fake::{Answer, Table};

    /// A real PDF's first page through the PDF reader the import uses (its line breaks are what firstpage.rs reads):
    /// `KANDINSKY_TEST_FIRSTPAGE_PDF=<file.pdf>`; skipped without it.
    #[test]
    fn a_real_pdf_s_first_page() {
        let Ok(path) = std::env::var("KANDINSKY_TEST_FIRSTPAGE_PDF") else { return eprintln!("skipped: KANDINSKY_TEST_FIRSTPAGE_PDF unset") };
        let (text, pages) = pdf_text(&std::fs::read(&path).unwrap());
        let first = text.split('\x0c').next().unwrap_or("");
        eprintln!("{pages} pages; first page:\n{}\n→ {:?}", first.chars().take(400).collect::<String>(), crate::firstpage::read(first, &path));
    }

    /// The Trash of a temp vault: `.kandinsky/trash/<n>/<path>`.
    pub struct TempTrash(pub PathBuf);
    impl Trash for TempTrash {
        fn trash(&self, rel: &str) -> Res<String> {
            let from = safe_join(&self.0, rel)?;
            if !from.exists() || rel.trim_matches('/').is_empty() {
                return Err(format!("{rel}: not there"));
            }
            let to = self.0.join(".kandinsky/trash/1").join(rel);
            std::fs::create_dir_all(to.parent().unwrap()).map_err(|e| e.to_string())?;
            std::fs::rename(&from, &to).map_err(|e| e.to_string())?;
            Ok(".kandinsky/trash/1".into())
        }
    }

    /// A temp vault and what a library over it needs (no network unless a test gives a table).
    pub struct Vault {
        pub d: tempfile::TempDir,
        pub root: PathBuf,
        pub cfg: Settings,
        pub net: Table,
        pub trash: TempTrash,
    }

    impl Default for Vault {
        fn default() -> Self {
            Self::new()
        }
    }

    impl Vault {
        pub fn new() -> Vault {
            let d = tempfile::tempdir().unwrap();
            let root = kandinsky_text::paths::real(d.path()).unwrap();
            Vault { d, trash: TempTrash(root.clone()), root, cfg: Settings::default(), net: Table::default() }
        }
        pub fn lib(&self) -> Lib<'_> {
            Lib { root: &self.root, cfg: &self.cfg, net: &self.net, made: &Plain, trash: &self.trash }
        }
    }

    /// A plugin's PDF source left a download in its cache: it becomes the paper's PDF, once, and only a real PDF from
    /// a plugin's cache does.
    #[test]
    fn a_pdf_a_plugin_found_is_attached_from_its_cache_only() {
        let v = Vault::new();
        let lib = v.lib();
        let root = &v.root;
        std::fs::create_dir_all(root.join("refs/papers/kitaev2006")).unwrap();
        std::fs::write(root.join("refs/papers/kitaev2006/info.yaml"), "citekey: kitaev2006\ntitle: Anyons\nDOI: 10.1016/j.aop.2005.10.005\n").unwrap();
        let cache = root.join(".kandinsky/cache/plugins/oa");
        std::fs::create_dir_all(&cache).unwrap();
        std::fs::write(cache.join("x.pdf"), b"%PDF-1.4\n%%EOF\n").unwrap();
        std::fs::write(cache.join("page.html"), b"<html>paywall</html>").unwrap();
        std::fs::write(root.join("notes.pdf"), b"%PDF-1.4\n").unwrap();
        assert!(lib.attach_pdf("kitaev2006", "notes.pdf", "x").is_err(), "not from a plugin's cache");
        assert!(lib.attach_pdf("kitaev2006", ".kandinsky/cache/plugins/oa/page.html", "x").is_err(), "not a PDF");
        assert!(lib.attach_pdf("nope", ".kandinsky/cache/plugins/oa/x.pdf", "x").is_err());
        let p = lib.attach_pdf("kitaev2006", ".kandinsky/cache/plugins/oa/x.pdf", "Semantic Scholar: https://s.example/x.pdf").unwrap();
        assert_eq!(p.pdf.as_deref(), Some("refs/papers/kitaev2006/kitaev2006.pdf"));
        assert!(!cache.join("x.pdf").exists(), "moved out of the cache");
        let info = std::fs::read_to_string(root.join("refs/papers/kitaev2006/kitaev2006.md")).unwrap();
        assert!(!root.join("refs/papers/kitaev2006/info.yaml").exists(), "folded into the note");
        assert!(info.contains("pdfFrom: 'Semantic Scholar: https://s.example/x.pdf'") || info.contains("pdfFrom: \"Semantic Scholar"), "{info}");
        std::fs::write(cache.join("y.pdf"), b"%PDF-1.4\n").unwrap();
        assert!(lib.attach_pdf("kitaev2006", ".kandinsky/cache/plugins/oa/y.pdf", "x").is_err(), "never over a PDF it has");
    }

    /// The References move: a book's PDF filed with its type and collection, under its own file name (links keep
    /// finding it); refs.bib says @book; the type of an entry can be set after.
    #[test]
    fn a_pdf_is_filed_with_its_type_collection_and_own_name() {
        let v = Vault::new();
        let lib = v.lib();
        let opts = ImportOpts { kind: Some("book".into()), collections: vec!["Many-body".into()], keep_name: true, ..Default::default() };
        let a = lib.import_pdf_with("Coleman - Introduction to Many-Body Physics.pdf", b"%PDF-1.4\n%%EOF\n", &opts).unwrap();
        assert_eq!(a.paper.pdf.as_deref(), Some(format!("{}/Coleman - Introduction to Many-Body Physics.pdf", a.paper.dir).as_str()));
        let info = std::fs::read_to_string(v.root.join(&a.paper.dir).join(format!("{}.md", a.paper.key))).unwrap();
        assert!(info.contains("itemType: book") && info.contains("- Many-body"), "{info}");
        assert!(std::fs::read_to_string(v.root.join("refs/refs.bib")).unwrap().contains(&format!("@book{{{}", a.paper.key)));
        let again = lib.import_pdf_with("Coleman - Introduction to Many-Body Physics.pdf", b"%PDF-1.4\n", &opts).unwrap();
        assert_eq!((again.created, again.paper.key.as_str()), (false, a.paper.key.as_str()), "the same file again: that entry");
        // the same bytes under another name: that entry, nothing added
        let renamed = lib.import_pdf_with("Coleman 2015.pdf", b"%PDF-1.4\n%%EOF\n", &opts).unwrap();
        assert_eq!((renamed.created, renamed.paper.key.as_str()), (false, a.paper.key.as_str()));
        // two entries that are one: merged, the type and collections kept, the copy to the Trash
        let other = lib.import_pdf_with("Other.pdf", b"%PDF-1.4\nother\n", &ImportOpts { collections: vec!["DCA".into()], keep_name: true, ..Default::default() }).unwrap();
        let m = lib.merge(&other.paper.key, &a.paper.key).unwrap();
        assert_eq!(m.collections, vec!["Many-body".to_string(), "DCA".into()]);
        assert!(!v.root.join(&other.paper.dir).exists(), "the copy is in the Trash");
        assert!(v.root.join(".kandinsky/trash/1").join(&other.paper.dir).is_dir());
        assert!(lib.merge(&a.paper.key, &a.paper.key).is_err());
        lib.set_type(&a.paper.key, "manuscript").unwrap();
        assert!(std::fs::read_to_string(v.root.join("refs/refs.bib")).unwrap().contains(&format!("@unpublished{{{}", a.paper.key)));
    }

    #[test]
    fn a_dropped_pdf_without_ids_becomes_an_entry_named_after_the_file() {
        let v = Vault::new();
        let lib = v.lib();
        assert!(lib.import_pdf("x.pdf", b"not a pdf").is_err());
        let pdf = b"%PDF-1.4\n%%EOF\n"; // no text, no DOI: offline-safe
        let a = lib.import_pdf("Spectral_functions-notes.pdf", pdf).unwrap();
        assert_eq!(a.paper.title, "Spectral functions notes");
        assert_eq!(a.paper.key, "spectral");
        assert!(a.created && a.pdf);
        assert_eq!(a.paper.pdf.as_deref(), Some("refs/papers/spectral/spectral.pdf"));
        assert_eq!(std::fs::read(v.root.join("refs/papers/spectral/spectral.pdf")).unwrap(), pdf);
        let again = lib.import_pdf("Spectral_functions-notes.pdf", pdf).unwrap();
        assert_eq!(again.paper.key, "spectrala", "a second drop never overwrites");
        assert!(std::fs::read_to_string(v.root.join("refs/refs.bib")).unwrap().contains("spectrala"));
        let ed = PaperEdit {
            key: "spectral".into(),
            title: "Spectral functions".into(),
            authors: vec!["Mahan, Gerald".into(), " ".into()],
            date: "2000".into(),
            venue: "Plenum".into(),
            collections: vec!["Books".into()],
            tags: vec![],
            ..Default::default()
        };
        let p = lib.edit(&ed).unwrap();
        assert_eq!((p.title.as_str(), p.year.as_deref(), p.collections.clone()), ("Spectral functions", Some("2000"), vec!["Books".to_string()]));
        assert_eq!(p.authors, vec!["Mahan, Gerald"]);
        let info = std::fs::read_to_string(v.root.join("refs/papers/spectral/spectral.md")).unwrap();
        assert!(info.contains("citekey: spectral") && info.contains("files:") && !info.contains("keywords:"), "other fields kept, empty dropped: {info}");
        assert_eq!(lib.delete("spectrala").unwrap(), ".kandinsky/trash/1");
        assert!(!v.root.join("refs/papers/spectrala").exists());
        assert!(!std::fs::read_to_string(v.root.join("refs/refs.bib")).unwrap().contains("spectrala"));
        assert!(lib.delete("nope").is_err());
    }

    #[test]
    fn citekey_matches_existing_style_and_dedupes() {
        let a = vec!["Altland, Alexander".to_string()];
        assert_eq!(citekey(&a, Some("2023"), "Condensed Matter Field Theory", &|_| false), "altland2023condensed");
        assert_eq!(citekey(&["Sénéchal, David".into()], Some("2008"), "The Theory of...", &|_| false), "senechal2008theory");
        assert_eq!(citekey(&a, Some("2023"), "Condensed", &|k| k == "altland2023condensed"), "altland2023condenseda");
        let all_letters = |k: &str| k.len() <= "altland2023condensed".len() + 1;
        assert_eq!(citekey(&a, Some("2023"), "Condensed", &all_letters), "altland2023condensed_2");
    }

    #[test]
    fn lists_library_and_writes_bib_like_refs_bib_py() {
        let v = Vault::new();
        let lib = v.lib();
        assert!(lib.list().unwrap().is_empty(), "no folder yet: an empty library");
        let p = v.root.join("refs/papers/anderson1972more");
        std::fs::create_dir_all(&p).unwrap();
        std::fs::write(p.join("info.yaml"), "title: More Is Different\ntype: journalArticle\nauthor:\n- Anderson, P. W.\ndate: 1972-08-04\npublicationTitle: Science\nDOI: 10.1126/science.177.4047.393\ncitekey: anderson1972more\ncollections: [Philosophy]\nfiles: [a.pdf]\n").unwrap();
        std::fs::write(p.join("a.pdf"), "%PDF").unwrap();
        let l = lib.list().unwrap();
        assert_eq!((l[0].key.as_str(), l[0].year.as_deref(), l[0].pdf.as_deref()), ("anderson1972more", Some("1972"), Some("refs/papers/anderson1972more/a.pdf")));
        assert_eq!(l[0].collections, vec!["Philosophy"]);
        assert!(l[0].tags.is_empty());
        assert_eq!(lib.write_bib().unwrap(), 1);
        let bib = std::fs::read_to_string(v.root.join("refs/refs.bib")).unwrap();
        assert!(bib.contains("@article{anderson1972more,") && bib.contains("journal = {Science}") && bib.contains("year = {1972}"), "{bib}");
        assert!(lib.bibtex("anderson1972more").unwrap().starts_with("@article{anderson1972more,"));
        // the fold: listed on a dry run, the files copied to the Trash first, then folded
        let dry = lib.fold_all(false).unwrap();
        assert_eq!((dry.entries.len(), dry.snapshot), (1, None));
        let done = lib.fold_all(true).unwrap();
        let snap = done.snapshot.unwrap();
        assert!(v.root.join(&snap).join("anderson1972more/info.yaml").is_file() && !p.join("info.yaml").exists());
        assert_eq!(lib.list().unwrap()[0].collections, vec!["Philosophy"], "read back from the note");
    }

    /// A vault the core has not migrated yet keeps `.atlas`: the fold's copies go there, and no `.kandinsky` is made
    /// beside it (it would be taken for the state folder at the next start, hiding the settings and plugins).
    #[test]
    fn the_fold_keeps_its_copies_in_the_state_folder_the_vault_has() {
        let v = Vault::new();
        std::fs::create_dir_all(v.root.join(".atlas/plugins")).unwrap();
        let p = v.root.join("refs/papers/anderson1972more");
        std::fs::create_dir_all(&p).unwrap();
        std::fs::write(p.join("info.yaml"), "title: More Is Different\ntype: journalArticle\ncitekey: anderson1972more\n").unwrap();
        let snap = v.lib().fold_all(true).unwrap().snapshot.unwrap();
        assert!(snap.starts_with(".atlas/trash/") && v.root.join(&snap).join("anderson1972more/info.yaml").is_file(), "{snap}");
        assert!(!v.root.join(".kandinsky").exists(), "no second state folder");
        // a download in a plugin's cache, named with the current spelling, is read where the vault keeps it
        std::fs::create_dir_all(v.root.join(".atlas/cache/plugins/oa")).unwrap();
        std::fs::write(v.root.join(".atlas/cache/plugins/oa/k.pdf"), b"%PDF-1.4 found").unwrap();
        v.lib().attach_pdf("anderson1972more", ".kandinsky/cache/plugins/oa/k.pdf", "a mirror").unwrap();
        assert!(!v.root.join(".kandinsky").exists());
    }

    /// Adding by DOI and by arXiv id on recorded answers: Crossref's or arXiv's metadata, the PDF from arXiv or an
    /// open-access copy, the same paper again not added twice.
    #[test]
    fn adds_from_crossref_and_arxiv_through_the_net() {
        let mut v = Vault::new();
        let work = serde_json::json!({ "message": { "title": ["More Is Different"], "type": "journal-article",
            "author": [{ "family": "Anderson", "given": "P. W." }], "issued": { "date-parts": [[1972, 8, 4]] } } });
        let oa = serde_json::json!({ "doi": "https://doi.org/10.1126/science.177.4047.393", "best_oa_location": { "is_oa": true, "pdf_url": "https://repo.example/more.pdf" } });
        let atom = "<feed><entry><title>Quantum spin liquids</title><published>2000-05-12T00:00:00Z</published><author><name>Leon Balents</name></author></entry></feed>";
        v.net = Table::default()
            .on("https://api.crossref.org/works/10.1126/science.177.4047.393", Answer::Json(work))
            .on("https://api.openalex.org/works/doi:10.1126/science.177.4047.393", Answer::Json(oa))
            .on("https://repo.example/more.pdf", Answer::Bytes(b"%PDF-1.5 more".to_vec()))
            .on("https://export.arxiv.org/api/query?id_list=cond-mat/0005226", Answer::Text(atom.into()))
            .on("https://arxiv.org/pdf/cond-mat/0005226", Answer::Bytes(b"<html>busy</html>".to_vec()));
        let lib = v.lib();
        let a = lib.add("10.1126/science.177.4047.393").unwrap();
        assert!(a.created && a.pdf && a.paper.key == "anderson1972more", "{:?}", a.paper);
        let note = std::fs::read_to_string(v.root.join("refs/papers/anderson1972more/anderson1972more.md")).unwrap();
        assert!(note.contains("pdfFrom: 'OpenAlex: https://repo.example/more.pdf'") && note.contains("library.paper"), "{note}");
        let b = lib.add("arXiv:cond-mat/0005226").unwrap();
        assert!(b.created && !b.pdf, "arXiv answered a page, not a PDF: {:?}", b.paper);
        assert_eq!(b.paper.arxiv.as_deref(), Some("cond-mat/0005226"));
        assert!(!lib.add("https://doi.org/10.1126/science.177.4047.393").unwrap().created, "dedup");
        assert!(lib.add("hello").is_err());
        assert!(lib.add("10.1/unknown").unwrap_err().contains("Crossref"));
    }

    #[test]
    fn files_into_external_pdf_roots_searches_reads_annotations_and_adds_bibtex_or_isbn() {
        let ws = tempfile::tempdir().unwrap();
        let ws_real = kandinsky_text::paths::real(ws.path()).unwrap();
        let vault_dir = ws_real.join("vault");
        let pool_dir = ws_real.join("Papers");
        std::fs::create_dir_all(&vault_dir).unwrap();
        std::fs::create_dir_all(&pool_dir).unwrap();
        let mut v = Vault::new();
        v.root = vault_dir;
        v.trash = TempTrash(v.root.clone());
        v.cfg.external_pdf_roots = vec!["../Papers".into()];
        let ol = serde_json::json!({ "ISBN:9783540328971": { "title": "Group Theory", "authors": [{ "name": "Mildred Dresselhaus" }], "publish_date": "2008", "publishers": [{ "name": "Springer" }] } });
        v.net = Table::default()
            .on("https://openlibrary.org/api/books?bibkeys=ISBN:9783540328971", Answer::Json(ol))
            .on("https://api.openalex.org/works/doi:10.1126/science.177.4047.393", Answer::Json(serde_json::json!({ "doi": "https://doi.org/10.1126/science.177.4047.393", "best_oa_location": { "is_oa": true, "pdf_url": "https://repo.example/more.pdf" } })))
            .on("https://repo.example/more.pdf", Answer::Bytes(b"%PDF-1.5 external-more".to_vec()));

        let bib_in = "@article{anderson1972custom,\n  title = {More Is Different},\n  author = {Anderson, P. W.},\n  year = {1972},\n  journal = {Science},\n  doi = {10.1126/science.177.4047.393}\n}";
        let a = v.lib().add(bib_in).unwrap();
        assert_eq!((a.paper.key.as_str(), a.paper.pdf.as_deref()), ("anderson1972custom", Some("../Papers/Anderson1972 - More Is Different.pdf")));
        assert!(pool_dir.join("Anderson1972 - More Is Different.pdf").is_file());
        assert!(!v.root.join("refs/papers/anderson1972custom/anderson1972custom.pdf").exists(), "stored in external pool, not vault");

        let book = v.lib().add("ISBN 978-3-540-32897-1").unwrap();
        assert_eq!(book.paper.kind, "book");
        assert_eq!(v.lib().search(Some("Anderson Science"), None, None, None, None).unwrap().len(), 1);
        assert!(v.lib().bibtex_all().unwrap().contains("@book{"));

        let note_path = v.root.join("refs/papers/anderson1972custom/anderson1972custom.md");
        let cur = std::fs::read_to_string(&note_path).unwrap();
        let with_mark = entry::merge_pdf_marks(&format!("{cur}\nImportant scale argument.\n"), &["m-abcd1234 highlight p2 {\"version\":1,\"color\":\"#ffd400\",\"quads\":[[1.0,2.0,3.0,4.0]],\"quote\":{\"exact\":\"broken symmetry\"}}".into()]);
        std::fs::write(&note_path, with_mark).unwrap();
        let ann = v.lib().annotations("anderson1972custom").unwrap();
        assert_eq!((ann["count"].as_u64(), ann["annotations"][0]["page"].as_u64()), (Some(1), Some(2)));
        assert!(ann["notes"].as_str().unwrap().contains("Important scale argument."));
    }

    pub(crate) fn tiny_pdf(pages: &[&str]) -> Vec<u8> {
        let pages = if pages.is_empty() { vec![""] } else { pages.to_vec() };
        let count = pages.len();
        let mut objs = vec![
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            format!(
                "<< /Type /Pages /Kids [{}] /Count {} >>",
                (0..count).map(|i| format!("{} 0 R", 4 + i * 2)).collect::<Vec<_>>().join(" "),
                count
            ),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
        ];
        for (i, page_text) in pages.iter().enumerate() {
            let page_id = 4 + i * 2;
            let content_id = page_id + 1;
            objs.push(format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {content_id} 0 R /Resources << /Font << /F1 3 0 R >> >> >>"
            ));
            let mut stream = String::from("BT /F1 12 Tf 72 736 Td\n");
            for line in page_text.lines() {
                let esc_line = line.replace('\\', r"\\").replace('(', r"\(").replace(')', r"\)");
                stream.push_str(&format!("0 -16 Td ({esc_line}) Tj\n"));
            }
            stream.push_str("ET");
            objs.push(format!("<< /Length {} >>\nstream\n{}\nendstream", stream.len(), stream));
        }
        let mut out = String::from("%PDF-1.4\n");
        let mut offsets = Vec::with_capacity(objs.len());
        for (i, obj) in objs.iter().enumerate() {
            offsets.push(out.len());
            out.push_str(&format!("{} 0 obj\n{obj}\nendobj\n", i + 1));
        }
        let xref = out.len();
        out.push_str(&format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1));
        for off in offsets {
            out.push_str(&format!("{off:010} 00000 n \n"));
        }
        out.push_str(&format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objs.len() + 1));
        out.into_bytes()
    }

    #[test]
    fn isbn_extraction_validates_isbn10_and_isbn13_including_page9_and_rejects_bad_digits() {
        assert_eq!(parse_isbn("ISBN-13: 978-0-306-40615-7"), Some("9780306406157".into()));
        assert_eq!(parse_isbn("ISBN (13): 978\u{2013}3\u{2013}540\u{2013}32897\u{2013}1"), Some("9783540328971".into()));
        assert_eq!(parse_isbn("ISBN (10): 0-8044-2957-x"), Some("080442957X".into()));
        assert_eq!(parse_isbn("ISBN-10: 0 306 40615 2"), Some("0306406152".into()));
        assert_eq!(parse_isbn("ISBN 978-0-306-40615-8"), None, "bad ISBN-13 check digit");
        assert_eq!(parse_isbn("ISBN-10: 0-8044-2957-1"), None, "bad ISBN-10 check digit");
        assert_eq!(parse_isbn("https://doi.org/10.1007/978-0-306-40615-7"), None, "DOI segment ignored");
        assert_eq!(isbn_core("978-0-306-40615-7"), isbn_core("0-306-40615-2"));

        // Copyright page sitting on page 9 (index 8) requires ID_PAGES = 10.
        assert_eq!(ID_PAGES, 10);
        let pages = [
            "Quantum Transport",
            "Title Page",
            "Dedication",
            "Preface",
            "Notation",
            "Contents",
            "Part I",
            "Acknowledgements",
            "Copyright 2019 Example Press\nISBN 978-0-306-40615-7",
            "Chapter 1",
        ];
        let pdf = tiny_pdf(&pages);
        let (text, n) = pdf_text(&pdf);
        assert_eq!(n, 10);
        let ids = extract_pdf_identifiers(&text, n, "Unknown.pdf");
        assert_eq!(ids.isbn.as_deref(), Some("9780306406157"));
    }

    #[test]
    fn structured_filename_parsing_handles_formats_and_keeps_unstructured_compatibility() {
        for raw in ["Spectral_functions-notes.pdf", "Dropped_lecture-notes.pdf", "Throwaway_entry.pdf"] {
            let p = parse_filename(raw);
            assert!(!p.structured, "{raw} must stay unstructured");
            assert!(p.authors.is_empty());
        }
        assert_eq!(parse_filename("Spectral_functions-notes.pdf").title, "Spectral functions notes");
        assert_eq!(parse_filename("Dropped_lecture-notes.pdf").title, "Dropped lecture notes");

        let a = parse_filename("Sakurai, J. J. - Modern Quantum Mechanics (2nd ed., 2020).pdf");
        assert!(a.structured);
        assert_eq!(a.title, "Modern Quantum Mechanics");
        assert_eq!(a.authors, vec!["Sakurai, J. J."]);
        assert_eq!(a.year.as_deref(), Some("2020"));
        assert_eq!(a.edition.as_deref(), Some("2nd"));

        let b = parse_filename("Altland2023 - Condensed Matter Field Theory - 2023.pdf");
        assert!(b.structured);
        assert_eq!(b.title, "Condensed Matter Field Theory");
        assert_eq!(b.authors, vec!["Altland"]);
        assert_eq!(b.year.as_deref(), Some("2023"));

        let c = parse_filename("Landau, L. D., Lifshitz, E. M. - Quantum Mechanics, Vol. 3 (3rd ed.).pdf");
        assert!(c.structured);
        assert_eq!(c.title, "Quantum Mechanics");
        assert_eq!(c.authors, vec!["Landau, L. D.", "Lifshitz, E. M."]);
        assert_eq!(c.volume.as_deref(), Some("3"));
        assert_eq!(c.edition.as_deref(), Some("3rd"));

        let d = parse_filename("Author_2604.06107v1.pdf");
        assert!(!d.structured);
        assert_eq!(d.arxiv.as_deref(), Some("2604.06107"));
        assert_eq!(d.arxiv_version.as_deref(), Some("v1"));

        let e = parse_filename("Différence et Répétition (Gilles Deleuze) (Z-Library).pdf");
        assert!(!e.structured);
        assert_eq!(e.title, "Différence et Répétition (Gilles Deleuze)");

        let f = parse_filename("Jacques Derrida - De La Grammatologie (1967, Editions de Minuit) - libgen.li.pdf");
        assert!(f.structured);
        assert_eq!(f.authors, vec!["Derrida, Jacques"]);
        assert_eq!(f.title, "De La Grammatologie");
        assert_eq!(f.year.as_deref(), Some("1967"));

        let g = parse_filename("Roland Barthes - Mythologies (Editions du Seuil, 1957).pdf");
        assert!(g.structured);
        assert_eq!(g.authors, vec!["Barthes, Roland"]);
        assert_eq!(g.title, "Mythologies");
        assert_eq!(g.year.as_deref(), Some("1957"));

        assert_eq!(
            classify_pdf(&ClassifyInput {
                text: "Thèse de doctorat en physique théorique",
                pages: 199,
                filename: "These de Pierre Clavier - Analytical and Geometric approaches.pdf",
                rel_dir: Some("The Beyond/Quantum gravity/papers"),
                parsed: &ParsedFilename::default(),
                ..Default::default()
            }),
            ItemClass::Thesis
        );
    }

    #[test]
    fn classifies_books_papers_theses_and_notes_from_isbn_pages_and_folders() {
        let p_blank = ParsedFilename::default();
        assert_eq!(
            classify_pdf(&ClassifyInput {
                text: "Preface",
                pages: 12,
                filename: "Book.pdf",
                rel_dir: None,
                parsed: &p_blank,
                isbn: Some("9780306406157"),
                ..Default::default()
            }),
            ItemClass::Book
        );
        assert_eq!(
            classify_pdf(&ClassifyInput {
                text: "",
                pages: 105,
                filename: "LongMonograph.pdf",
                rel_dir: None,
                parsed: &p_blank,
                ..Default::default()
            }),
            ItemClass::Book
        );
        let p_ed = parse_filename("Sakurai - Modern Quantum Mechanics (2nd ed., 2020).pdf");
        assert_eq!(
            classify_pdf(&ClassifyInput {
                text: "",
                pages: 75,
                filename: "Sakurai - Modern Quantum Mechanics (2nd ed., 2020).pdf",
                rel_dir: None,
                parsed: &p_ed,
                ..Default::default()
            }),
            ItemClass::Book
        );
        assert_eq!(
            classify_pdf(&ClassifyInput {
                text: "Monograph",
                pages: 45,
                filename: "Primer.pdf",
                rel_dir: Some("Books/Quantum"),
                parsed: &p_blank,
                ..Default::default()
            }),
            ItemClass::Book
        );
        assert_eq!(
            classify_pdf(&ClassifyInput {
                text: "Book chapter",
                pages: 25,
                filename: "2401.12345v1.pdf",
                rel_dir: Some("Books/Quantum"),
                parsed: &p_blank,
                arxiv: Some("2401.12345"),
                ..Default::default()
            }),
            ItemClass::Paper
        );
        assert_eq!(
            classify_pdf(&ClassifyInput {
                text: "",
                pages: 180,
                filename: "Disorder.pdf",
                rel_dir: Some("Theses/2022"),
                parsed: &p_blank,
                ..Default::default()
            }),
            ItemClass::Thesis
        );
        assert_eq!(
            classify_pdf(&ClassifyInput {
                text: "Lecture notes on Field Theory",
                pages: 42,
                filename: "Notes.pdf",
                rel_dir: Some("Lecture notes"),
                parsed: &p_blank,
                ..Default::default()
            }),
            ItemClass::Notes
        );
    }

    #[test]
    fn bibtex_for_book_and_incollection_emits_clean_fields_without_journal() {
        let mut book = Mapping::new();
        book.insert("type".into(), "science_book".into());
        book.insert("title".into(), "Condensed Matter Field Theory".into());
        book.insert("author".into(), Value::Sequence(vec!["Altland, Alexander".into(), "Simons, Ben".into()]));
        book.insert("date".into(), "2010".into());
        book.insert("publisher".into(), "Cambridge University Press".into());
        book.insert("edition".into(), "2nd".into());
        book.insert("series".into(), "Graduate Texts".into());
        book.insert("volume".into(), "1".into());
        book.insert("ISBN".into(), "978-0-521-76975-4".into());
        book.insert("publicationTitle".into(), "Should Never Appear As Journal".into());
        book.insert("repository".into(), "arXiv".into());
        let bib = bibtex_entry("altland2010condensed", &book);
        assert!(bib.starts_with("@book{altland2010condensed,"), "{bib}");
        assert!(!bib.contains("journal ="), "@book must never emit journal =: {bib}");
        assert!(bib.contains("publisher = {Cambridge University Press}"));
        assert!(bib.contains("edition = {2nd}"));
        assert!(bib.contains("series = {Graduate Texts}"));
        assert!(bib.contains("volume = {1}"));
        assert!(bib.contains("isbn = {978-0-521-76975-4}"));

        let mut chapter = Mapping::new();
        chapter.insert("type".into(), "bookSection".into());
        chapter.insert("title".into(), "Renormalization Group Methods".into());
        chapter.insert("author".into(), Value::Sequence(vec!["Example, Ada".into()]));
        chapter.insert("date".into(), "2021".into());
        chapter.insert("publicationTitle".into(), "Handbook of Quantum Matter".into());
        chapter.insert("publisher".into(), "Example Academic Press".into());
        let ch_bib = bibtex_entry("example2021rg", &chapter);
        assert!(ch_bib.starts_with("@incollection{example2021rg,"), "{ch_bib}");
        assert!(!ch_bib.contains("journal ="), "@incollection must not emit journal =: {ch_bib}");
        assert!(ch_bib.contains("booktitle = {Handbook of Quantum Matter}"), "{ch_bib}");
    }

    #[test]
    fn search_filters_by_item_type_for_books_papers_theses_and_notes() {
        let v = Vault::new();
        let lib = v.lib();
        let write_note = |key: &str, kind: &str, title: &str| {
            let dir = v.root.join("refs/papers").join(key);
            std::fs::create_dir_all(&dir).unwrap();
            let mut m = Mapping::new();
            m.insert("citekey".into(), key.into());
            m.insert("type".into(), kind.into());
            m.insert("title".into(), title.into());
            entry::write(&crate::entry::tests::Plain, &dir, &m).unwrap();
        };
        write_note("b1", "book", "Standard Textbook");
        write_note("b2", "science_book", "Quantum Field Theory Monograph");
        write_note("b3", "bookSection", "Collected Chapter");
        write_note("p1", "journalArticle", "Lattice Paper");
        write_note("p2", "preprint", "ArXiv Preprint");
        write_note("t1", "thesis", "PhD Dissertation");
        write_note("n1", "manuscript", "Lecture Notes");

        let books = lib.search(None, None, None, Some("book"), None).unwrap();
        let book_keys: Vec<_> = books.iter().map(|p| p.key.as_str()).collect();
        assert_eq!(book_keys, vec!["b1", "b2", "b3"]);

        let papers = lib.search(None, None, None, Some("paper"), None).unwrap();
        let paper_keys: Vec<_> = papers.iter().map(|p| p.key.as_str()).collect();
        assert_eq!(paper_keys, vec!["p1", "p2"]);

        let theses = lib.search(None, None, None, Some("thesis"), None).unwrap();
        assert_eq!(theses.iter().map(|p| p.key.as_str()).collect::<Vec<_>>(), vec!["t1"]);

        let notes = lib.search(None, None, None, Some("notes"), None).unwrap();
        assert_eq!(notes.iter().map(|p| p.key.as_str()).collect::<Vec<_>>(), vec!["n1"]);
    }

    #[test]
    fn import_pdf_classifies_book_with_page9_isbn_and_looks_up_book_metadata() {
        let mut v = Vault::new();
        let ol = serde_json::json!({
            "ISBN:9783540328971": {
                "title": "Group Theory Applications",
                "authors": [{ "name": "Mildred Dresselhaus" }],
                "publish_date": "2008",
                "publishers": [{ "name": "Springer" }],
                "number_of_pages": 582
            }
        });
        v.net = Table::default()
            .on("https://openlibrary.org/api/books?bibkeys=ISBN:9783540328971", Answer::Json(ol));
        let pdf = tiny_pdf(&[
            "Title", "Half title", "Series", "Dedication", "Foreword",
            "Contents", "Notation", "Preface", "ISBN 978-3-540-32897-1", "Ch 1",
        ]);
        let added = v.lib().import_pdf("Dresselhaus - Unknown.pdf", &pdf).unwrap();
        assert!(added.created);
        assert_eq!(added.paper.kind, "book");
        assert_eq!(added.paper.title, "Group Theory Applications");
        let md = std::fs::read_to_string(v.root.join(&added.paper.dir).join(format!("{}.md", added.paper.key))).unwrap();
        assert!(md.contains("pdfSha256:"), "{md}");
    }

    fn pdf_with_info_and_xmp(info_title_hex: &str, info_author: &str, xmp_xml: &str, page_text: &str) -> Vec<u8> {
        let mut objs = vec![
            "<< /Type /Catalog /Pages 2 0 R /Metadata 6 0 R >>".to_string(),
            "<< /Type /Pages /Kids [4 0 R] /Count 1 >>".to_string(),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 3 0 R >> >> >>".to_string(),
        ];
        let mut stream = String::from("BT /F1 12 Tf 72 736 Td\n");
        for line in page_text.lines() {
            let esc_line = line.replace('\\', r"\\").replace('(', r"\(").replace(')', r"\)");
            stream.push_str(&format!("0 -16 Td ({esc_line}) Tj\n"));
        }
        stream.push_str("ET");
        objs.push(format!("<< /Length {} >>\nstream\n{}\nendstream", stream.len(), stream));
        objs.push(format!("<< /Type /Metadata /Subtype /XML /Length {} >>\nstream\n{}\nendstream", xmp_xml.len(), xmp_xml));
        objs.push(format!("<< /Title <{info_title_hex}> /Author ({info_author}) /CreationDate (D:20230501120000Z) >>"));
        let mut out = String::from("%PDF-1.4\n");
        let mut offsets = Vec::with_capacity(objs.len());
        for (i, obj) in objs.iter().enumerate() {
            offsets.push(out.len());
            out.push_str(&format!("{} 0 obj\n{obj}\nendobj\n", i + 1));
        }
        let xref = out.len();
        out.push_str(&format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1));
        for off in offsets {
            out.push_str(&format!("{off:010} 00000 n \n"));
        }
        out.push_str(&format!("trailer\n<< /Size {} /Root 1 0 R /Info 7 0 R >>\nstartxref\n{xref}\n%%EOF\n", objs.len() + 1));
        out.into_bytes()
    }

    #[test]
    fn zotero_parity_pdf_meta_isbn_filenames_bibtex_and_zero_copy_imports() {
        // 1. Citekeys fold Slavic/Nordic/Turkish diacritics cleanly.
        assert_eq!(citekey(&["Cvetković, M.".into()], Some("2024"), "Quantum Spin", &|_| false), "cvetkovic2024quantum");
        assert_eq!(citekey(&["Łukasiewicz, J.".into()], Some("1951"), "Modal Logic", &|_| false), "lukasiewicz1951modal");
        assert_eq!(citekey(&["Sørensen, A.".into()], Some("2000"), "Entanglement", &|_| false), "sorensen2000entanglement");

        // 2. Publisher URL ISBNs work while DOI 978 segments are rejected; thesis phrases match.
        assert_eq!(parse_isbn("https://cambridge.org/9780521843096").as_deref(), Some("9780521843096"));
        assert_eq!(parse_isbn("https://doi.org/10.1007/978-0-306-40615-7"), None);
        assert_eq!(parse_isbn("ISBN \u{F739}\u{F737}\u{F738}-0-306-40615-7").as_deref(), Some("9780306406157"));
        assert_eq!(classify_pdf(&ClassifyInput { text: "A thesis submitted for the degree of Doctor of Philosophy", pages: 120, ..Default::default() }), ItemClass::Thesis);
        assert_eq!(classify_pdf(&ClassifyInput { text: "Diplomarbeit an der Fakultät", pages: 80, ..Default::default() }), ItemClass::Thesis);

        // 3. Filename parsing enhancements + split_trailing_paren_author.
        let zpref = parse_filename("z_Sakurai - Quantum Mechanics (2020).pdf");
        assert!(zpref.structured && zpref.authors == vec!["Sakurai"] && zpref.title == "Quantum Mechanics" && zpref.year.as_deref() == Some("2020"));
        assert!(!parse_filename("z_notes.pdf").structured);

        let pub_suf = parse_filename("Altland - Condensed Matter-Cambridge University Press (2011).pdf");
        assert!(pub_suf.structured && pub_suf.title == "Condensed Matter" && pub_suf.year.as_deref() == Some("2011"));

        let t_first = parse_filename("The Principles of Quantum Mechanics - Paul Dirac.pdf");
        assert!(t_first.structured && t_first.title == "The Principles of Quantum Mechanics" && t_first.authors == vec!["Dirac, Paul"]);

        assert_eq!(split_trailing_paren_author("Différence et Répétition (Gilles Deleuze)"), Some(("Différence et Répétition".into(), vec!["Deleuze, Gilles".into()])));
        assert_eq!(split_trailing_paren_author("Lecture Notes (draft)"), None);
        assert_eq!(split_trailing_paren_author("Lecture Notes (part 1)"), None);

        // 4. Multi-author firstpage is never overwritten by 1-author filename.
        let parsed_one = parse_filename("Georges - Quantum Paper.pdf");
        let fp_three = crate::firstpage::FirstPage {
            title: "Dynamical Mean-Field Theory".into(),
            authors: vec!["A. Georges".into(), "G. Kotliar".into(), "W. Krauth".into()],
            year: Some("1996".into()),
        };
        let (local_m, _) = build_local_entry_mapping(&parsed_one, Some(&fp_three), &PdfIds::default(), 12, ItemClass::Paper);
        assert_eq!(list(&local_m, "author"), vec!["Georges, A.", "Kotliar, G.", "Krauth, W."]);

        // 5. Real PDF with UTF-16BE junk /Info Title + XMP metadata feeds into extract_pdf_doc and import_pdf_with.
        let junk_utf16_hex = "FEFF0055006E007400690074006C00650064"; // "Untitled"
        let xmp = r#"<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:prism="http://prismstandard.org/namespaces/basic/2.0/"><rdf:Description rdf:about=""><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Anyons and Braid Groups</rdf:li></rdf:Alt></dc:title><dc:creator><rdf:Seq><rdf:li>Alice Smith</rdf:li><rdf:li>Bob Jones</rdf:li></rdf:Seq></dc:creator><dc:description>A comprehensive study of topological braiding statistics.</dc:description><dc:subject><rdf:Bag><rdf:li>anyons</rdf:li><rdf:li>braiding</rdf:li></rdf:Bag></dc:subject><prism:doi>10.1000/anyons.xmp</prism:doi><prism:publicationName>J. Math. Phys.</prism:publicationName></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>"#;
        let xmp_pdf = pdf_with_info_and_xmp(junk_utf16_hex, "Fallback Author", xmp, "Page 1 body text");
        let ext = crate::pdf_meta::extract_pdf_doc(&xmp_pdf);
        assert_eq!(ext.meta.title.as_deref(), Some("Anyons and Braid Groups"));
        assert_eq!(ext.meta.authors, vec!["Smith, Alice", "Jones, Bob"]);
        assert_eq!(ext.meta.doi.as_deref(), Some("10.1000/anyons.xmp"));
        assert_eq!(ext.meta.venue.as_deref(), Some("J. Math. Phys."));

        // 6. Zero-duplication import_pdf_with with external_pdf_roots & store_in_external=false, plus extended Paper/PaperEdit & BibTeX.
        let ws = tempfile::tempdir().unwrap();
        let ws_real = kandinsky_text::paths::real(ws.path()).unwrap();
        let (vault_dir, pool_dir) = (ws_real.join("vault"), ws_real.join("Library/Papers"));
        std::fs::create_dir_all(&vault_dir).unwrap();
        std::fs::create_dir_all(&pool_dir).unwrap();
        std::fs::write(pool_dir.join("Anyons.pdf"), &xmp_pdf).unwrap();

        let mut v = Vault::new();
        v.root = vault_dir;
        v.trash = TempTrash(v.root.clone());
        v.cfg.external_pdf_roots = vec!["../Library/Papers".into()];
        v.cfg.store_in_external = false;
        let lib = v.lib();
        let imp = lib.import_pdf("DropCopy.pdf", &xmp_pdf).unwrap();
        assert!(imp.created);
        assert_eq!(imp.paper.pdf.as_deref(), Some("../Library/Papers/Anyons.pdf"));
        assert!(!v.root.join(&imp.paper.dir).join("DropCopy.pdf").exists(), "zero copy into vault");
        let imp2 = lib.import_pdf("AnotherCopy.pdf", &xmp_pdf).unwrap();
        assert!(!imp2.created && imp2.paper.key == imp.paper.key);

        let edited = lib.edit(&PaperEdit {
            key: imp.paper.key.clone(),
            title: "Anyons and Braid Groups".into(),
            authors: vec!["Smith, Alice".into()],
            date: String::new(),
            venue: "J. Math. Phys.".into(),
            collections: vec![],
            tags: vec![],
            kind: Some("book".into()),
            volume: Some("4".into()),
            pages: Some("582".into()),
            publisher: Some("Cambridge University Press".into()),
            ..Default::default()
        }).unwrap();
        assert_eq!((edited.kind.as_str(), edited.volume.as_deref(), edited.publisher.as_deref()), ("book", Some("4"), Some("Cambridge University Press")));
        let bib = lib.bibtex(&imp.paper.key).unwrap();
        assert!(bib.starts_with("@book{") && !bib.contains("pages = {582}"), "{bib}");
    }
}
