//! Recursive external PDF folder sync (`scan_external_roots`): leaves PDFs untouched in place,
//! derives hierarchical collections (`<RootName>/<Topic>`), classifies Books alongside Papers,
//! and reconciles moves, duplicates, and metadata enrichment with `dry_run` preview support.
use crate::entry;
use crate::external::{self, clean_ref_token, ExternalRoot};
use crate::firstpage::{self, FirstPage};
use crate::inbox_dedupe;
use crate::refs::{
    arxiv_of, bibtex_type_of, build_local_entry_mapping, citekey, classify_pdf,
    extract_pdf_identifiers, isbn_core, list, lookup_pdf_remote, merge_local_fallbacks, norm_doi,
    normalized_kind, now_stamp, parse_filename, pdf_text, s, sha_hex, year_of, ClassifyInput,
    ItemClass, Lib, ParsedFilename, PdfIds, Res,
};
use kandinsky_text::paths::{real, safe_join};
use serde::{Deserialize, Deserializer, Serialize};
use serde_yaml::{Mapping, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
struct ScanRootsRaw {
    #[serde(default)]
    dry_run: Option<bool>,
    #[serde(default)]
    apply: Option<bool>,
    #[serde(default)]
    root: Option<String>,
    #[serde(default)]
    rate_limit_ms: Option<u64>,
    #[serde(default)]
    max_lookups: Option<usize>,
}

/// Request options for [`scan_external_roots`]; previews non-destructively (`dry_run: true`) when omitted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanRootsOpts {
    pub dry_run: bool,
    pub root: Option<String>,
    pub rate_limit_ms: Option<u64>,
    pub max_lookups: Option<usize>,
}

impl Default for ScanRootsOpts {
    fn default() -> Self {
        Self { dry_run: true, root: None, rate_limit_ms: None, max_lookups: None }
    }
}

impl<'de> Deserialize<'de> for ScanRootsOpts {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let opt = Option::<ScanRootsRaw>::deserialize(deserializer)?;
        let Some(raw) = opt else { return Ok(Self::default()) };
        let dry_run = raw.dry_run.unwrap_or_else(|| raw.apply.map(|a| !a).unwrap_or(default_true()));
        let root = raw.root.map(|r| r.trim().to_string()).filter(|r| !r.is_empty());
        Ok(Self { dry_run, root, rate_limit_ms: raw.rate_limit_ms, max_lookups: raw.max_lookups })
    }
}

/// One PDF's reconciliation outcome in [`ScanRootsReport`].
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ScanRootItem {
    pub action: String,
    pub citekey: String,
    pub title: String,
    pub kind: String,
    pub bibtex_type: String,
    pub pdf_path: String,
    pub pdf_ref: String,
    pub collections: Vec<String>,
    pub source: String,
    pub error: Option<String>,
}

/// Summary and per-file report returned by [`scan_external_roots`].
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ScanRootsReport {
    pub dry_run: bool,
    pub roots_scanned: Vec<String>,
    pub total_pdfs: usize,
    pub created: usize,
    pub updated: usize,
    pub moved: usize,
    pub unchanged: usize,
    pub enriched: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
    pub items: Vec<ScanRootItem>,
}

struct DiscoveredPdf {
    pdf_ref: String,
    pdf_path: String,
    real_path: PathBuf,
    file_name_lower: String,
    derived_collection: String,
    size: u64,
    sha256: String,
    pages: usize,
    parsed: ParsedFilename,
    first: Option<FirstPage>,
    ids: PdfIds,
    class: ItemClass,
    read_error: Option<String>,
}

impl DiscoveredPdf {
    fn can_query_remote(&self) -> bool {
        self.ids.doi.is_some()
            || self.ids.arxiv.is_some()
            || self.ids.isbn.is_some()
            || self.first.is_some()
            || (self.parsed.structured && !self.parsed.title.is_empty())
    }
}

struct EntryRecord {
    key: String,
    dir: PathBuf,
    mapping: Mapping,
    live_paths: Vec<PathBuf>,
    stale_refs: Vec<String>,
    stale_derived_cols: Vec<String>,
    missing_pdf_names: Vec<String>,
    stored_sha256: Option<String>,
    doi: Option<String>,
    arxiv: Option<String>,
    isbn_core: Option<String>,
    claimed: bool,
}

impl EntryRecord {
    fn has_live_pdf(&self) -> bool {
        !self.live_paths.is_empty()
    }
}

enum ScanMatch {
    Unmatched,
    Canonical(usize),
    Move { entry_idx: usize },
    Attach { entry_idx: usize },
    Duplicate { citekey: String },
}

fn is_pdf_name(name: &str) -> bool {
    name.len() > 4 && name.as_bytes()[name.len() - 4..].eq_ignore_ascii_case(b".pdf")
}

fn root_name_for(ext: &ExternalRoot) -> String {
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

fn derived_collection(ext: &ExternalRoot, rel_dir: Option<&str>) -> String {
    let root_name = root_name_for(ext);
    match rel_dir.map(str::trim).filter(|d| !d.is_empty()) {
        Some(sub) => format!("{root_name}/{sub}"),
        None => root_name,
    }
}

fn derived_collection_for_ref(roots: &[ExternalRoot], norm_ref: &str) -> Option<String> {
    for ext in roots {
        let pfx = format!("{}/", ext.prefix);
        if let Some(sub) = norm_ref.strip_prefix(&pfx) {
            let rel_dir = sub.rsplit_once('/').map(|(d, _)| d).filter(|d| !d.is_empty());
            return Some(derived_collection(ext, rel_dir));
        }
    }
    None
}

fn select_roots(lib: &Lib, filter: Option<&str>) -> Res<Vec<ExternalRoot>> {
    let all = external::external_roots(lib.root, lib.cfg);
    let Some(raw) = filter.map(str::trim).filter(|s| !s.is_empty()) else {
        if all.is_empty() {
            return Err("No external PDF folders configured in external_pdf_roots".into());
        }
        return Ok(all);
    };
    let norm = raw.replace('\\', "/").trim_end_matches('/').to_string();
    if let Some(found) = all.iter().find(|e| e.prefix == norm) {
        return Ok(vec![found.clone()]);
    }
    if let Some(resolved) = external::resolve_dir_from(lib.root, &norm) {
        if let Some(found) = all.iter().find(|e| e.root == resolved) {
            return Ok(vec![found.clone()]);
        }
        if resolved.is_dir() {
            return Ok(vec![ExternalRoot { prefix: norm, root: resolved }]);
        }
    }
    let named: Vec<ExternalRoot> =
        all.iter().filter(|e| root_name_for(e).eq_ignore_ascii_case(&norm)).cloned().collect();
    if named.len() == 1 {
        return Ok(named);
    }
    Err(format!("external PDF root not found: {raw}"))
}

fn discover_pdfs(lib: &Lib, roots: &[ExternalRoot], errors: &mut Vec<String>) -> Vec<DiscoveredPdf> {
    let inbox_real = inbox_dedupe::resolve_inbox_dir(lib.root, lib.cfg)
        .ok()
        .map(|p| real(&p).unwrap_or(p));
    let mut out = Vec::new();
    for ext in roots {
        if !ext.root.is_dir() {
            errors.push(format!("{}: directory does not exist", ext.prefix));
            continue;
        }
        let ext_real = real(&ext.root).unwrap_or_else(|_| ext.root.clone());
        let mut visited = HashSet::new();
        walk_dir(ext, &ext_real, &ext_real, None, inbox_real.as_deref(), &mut visited, &mut out, errors);
    }
    out
}

#[allow(clippy::too_many_arguments)]
fn walk_dir(
    ext: &ExternalRoot,
    ext_real: &Path,
    dir: &Path,
    rel_dir: Option<&str>,
    inbox_real: Option<&Path>,
    visited: &mut HashSet<PathBuf>,
    out: &mut Vec<DiscoveredPdf>,
    errors: &mut Vec<String>,
) {
    let Ok(dir_real) = real(dir) else { return };
    if !dir_real.starts_with(ext_real) || inbox_real.is_some_and(|ib| dir_real == ib || dir_real.starts_with(ib)) {
        return;
    }
    if !visited.insert(dir_real.clone()) {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else {
        errors.push(format!("{}: cannot read directory", dir.display()));
        return;
    };
    let mut children: Vec<(String, PathBuf)> = rd
        .flatten()
        .map(|e| (e.file_name().to_string_lossy().into_owned(), e.path()))
        .collect();
    children.sort_by(|a, b| a.0.to_ascii_lowercase().cmp(&b.0.to_ascii_lowercase()).then_with(|| a.0.cmp(&b.0)));

    for (name, path) in children {
        if name.starts_with('.') {
            continue;
        }
        let Ok(resolved) = real(&path) else {
            if is_pdf_name(&name) {
                let rel_file = match rel_dir {
                    Some(d) => format!("{d}/{name}"),
                    None => name.clone(),
                };
                errors.push(format!("{}/{rel_file}: unreadable file or broken symlink", ext.prefix));
            }
            continue;
        };
        if !resolved.starts_with(ext_real) {
            continue;
        }
        if resolved.is_dir() {
            let next_rel = match rel_dir {
                Some(d) => format!("{d}/{name}"),
                None => name,
            };
            walk_dir(ext, ext_real, &resolved, Some(&next_rel), inbox_real, visited, out, errors);
        } else if resolved.is_file() && is_pdf_name(&name) {
            let derived = derived_collection(ext, rel_dir);
            let rel_file = match rel_dir {
                Some(d) => format!("{d}/{name}"),
                None => name.clone(),
            };
            let pdf_ref = format!("{}/{}", ext.prefix, rel_file);
            out.push(inspect_discovered_pdf(name, pdf_ref, resolved, derived));
        }
    }
}

fn inspect_discovered_pdf(name: String, pdf_ref: String, real_path: PathBuf, derived_collection: String) -> DiscoveredPdf {
    let pdf_path = real_path.to_string_lossy().into_owned();
    let file_name_lower = name.to_ascii_lowercase();
    let parsed = parse_filename(&name);
    let bytes = match std::fs::read(&real_path) {
        Ok(b) => b,
        Err(e) => {
            return DiscoveredPdf {
                pdf_ref,
                pdf_path,
                real_path,
                file_name_lower,
                derived_collection,
                size: 0,
                sha256: String::new(),
                pages: 0,
                parsed,
                first: None,
                ids: PdfIds::default(),
                class: ItemClass::Paper,
                read_error: Some(e.to_string()),
            };
        }
    };
    let size = bytes.len() as u64;
    let sha256 = sha_hex(&bytes);
    let (text, pages) = if bytes.starts_with(b"%PDF") { pdf_text(&bytes) } else { (String::new(), 0) };
    let first = firstpage::read(text.split('\x0c').next().unwrap_or(""), &name);
    let ids = extract_pdf_identifiers(&text, pages, &name);
    let class = classify_pdf(&ClassifyInput {
        text: &text,
        pages,
        filename: &name,
        rel_dir: Some(&derived_collection),
        parsed: &parsed,
        isbn: ids.isbn.as_deref(),
        doi: ids.doi.as_deref(),
        arxiv: ids.arxiv.as_deref(),
        remote_type: None,
        explicit_kind: None,
    });
    DiscoveredPdf {
        pdf_ref,
        pdf_path,
        real_path,
        file_name_lower,
        derived_collection,
        size,
        sha256,
        pages,
        parsed,
        first,
        ids,
        class,
        read_error: (!bytes.starts_with(b"%PDF")).then(|| "not a valid PDF header".into()),
    }
}

fn load_entries(lib: &Lib, roots: &[ExternalRoot]) -> Res<(Vec<EntryRecord>, HashSet<String>)> {
    let base = lib.base()?;
    let mut records = Vec::new();
    let mut used_keys = HashSet::new();
    let Ok(rd) = std::fs::read_dir(&base) else {
        return Ok((records, used_keys));
    };
    let mut dirs: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    dirs.sort();
    for dir in dirs {
        let key = entry::key_of(&dir);
        if key.is_empty() {
            continue;
        }
        used_keys.insert(key.to_ascii_lowercase());
        let Some(m) = entry::read(&dir) else { continue };
        records.push(build_entry_record(lib, roots, key, dir, m));
    }
    Ok((records, used_keys))
}

fn build_entry_record(lib: &Lib, roots: &[ExternalRoot], key: String, dir: PathBuf, m: Mapping) -> EntryRecord {
    let mut live_paths = Vec::new();
    let mut stale_refs = Vec::new();
    let mut stale_derived_cols = Vec::new();
    let mut missing_pdf_names = Vec::new();

    for raw in list(&m, "pdf").into_iter().chain(list(&m, "external_pdf")).chain(list(&m, "files")) {
        let clean = clean_ref_token(&raw);
        if clean.is_empty() {
            continue;
        }
        let norm_clean = clean.replace('\\', "/");
        if let Some((portable, abs)) = external::resolve_pdf_ref(lib.root, lib.cfg, clean) {
            if abs.is_file() {
                live_paths.push(real(&abs).unwrap_or(abs));
            } else {
                stale_refs.push(norm_clean);
                if let Some(col) = derived_collection_for_ref(roots, &portable) {
                    stale_derived_cols.push(col);
                }
                if is_pdf_name(clean) {
                    if let Some(name) = clean.rsplit(['/', '\\']).next().filter(|n| !n.is_empty()) {
                        missing_pdf_names.push(name.to_ascii_lowercase());
                    }
                }
            }
        } else if is_pdf_name(clean) {
            let found = safe_join(&dir, clean)
                .ok()
                .filter(|p| p.is_file())
                .or_else(|| safe_join(lib.root, clean).ok().filter(|p| p.is_file()));
            if let Some(abs) = found {
                live_paths.push(real(&abs).unwrap_or(abs));
            } else {
                stale_refs.push(norm_clean);
                if let Some(name) = clean.rsplit(['/', '\\']).next().filter(|n| !n.is_empty()) {
                    missing_pdf_names.push(name.to_ascii_lowercase());
                }
            }
        }
    }
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for p in rd.flatten().map(|e| e.path()) {
            if p.is_file() && p.extension().is_some_and(|x| x.eq_ignore_ascii_case("pdf")) {
                let r = real(&p).unwrap_or(p);
                if !live_paths.contains(&r) {
                    live_paths.push(r);
                }
            }
        }
    }

    let doi = s(&m, "DOI").map(|d| norm_doi(&d)).filter(|d| !d.is_empty());
    let arxiv = arxiv_of(&m).map(|a| a.to_ascii_lowercase());
    let isbn_c = s(&m, "ISBN").or_else(|| s(&m, "isbn")).and_then(|x| isbn_core(&x));
    let stored_sha256 = s(&m, "pdfSha256").map(|h| h.to_ascii_lowercase());

    EntryRecord {
        key,
        dir,
        mapping: m,
        live_paths,
        stale_refs,
        stale_derived_cols,
        missing_pdf_names,
        stored_sha256,
        doi,
        arxiv,
        isbn_core: isbn_c,
        claimed: false,
    }
}

fn live_sha_cache_hit(
    entry: &EntryRecord,
    size: u64,
    target_sha: &str,
    hash_cache: &mut HashMap<PathBuf, (u64, String)>,
) -> bool {
    if entry.stored_sha256.as_deref() == Some(target_sha) {
        return true;
    }
    for p in &entry.live_paths {
        if let Some((len, h)) = hash_cache.get(p) {
            if *len == size && h == target_sha {
                return true;
            }
            continue;
        }
        let Ok(meta) = std::fs::metadata(p) else { continue };
        if meta.len() != size {
            continue;
        }
        if let Ok(bytes) = std::fs::read(p) {
            let h = sha_hex(&bytes);
            let hit = h == target_sha;
            hash_cache.insert(p.clone(), (meta.len(), h));
            if hit {
                return true;
            }
        }
    }
    false
}

fn ids_match(entry: &EntryRecord, ids: &PdfIds) -> bool {
    if let (Some(ed), Some(pd)) = (&entry.doi, &ids.doi) {
        if ed == &norm_doi(pd) {
            return true;
        }
    }
    if let (Some(ea), Some(pa)) = (&entry.arxiv, &ids.arxiv) {
        if ea == &pa.to_ascii_lowercase() {
            return true;
        }
    }
    if let (Some(ei), Some(pi)) = (&entry.isbn_core, &ids.isbn) {
        if isbn_core(pi).is_some_and(|pc| &pc == ei) {
            return true;
        }
    }
    false
}

fn reconcile_pdfs(discovered: &[DiscoveredPdf], entries: &mut [EntryRecord]) -> Vec<ScanMatch> {
    let mut matches: Vec<ScanMatch> = discovered.iter().map(|_| ScanMatch::Unmatched).collect();
    let mut hash_cache = HashMap::new();

    // Pass 1, Signal 1: canonical resolved PDF path.
    for (di, disc) in discovered.iter().enumerate() {
        if disc.read_error.is_some() {
            continue;
        }
        if let Some(ei) = entries.iter().position(|e| e.live_paths.contains(&disc.real_path)) {
            entries[ei].claimed = true;
            matches[di] = ScanMatch::Canonical(ei);
        }
    }

    // Pass 1, Signal 2: PDF SHA-256 (stored pdfSha256 or matching live bytes).
    for (di, disc) in discovered.iter().enumerate() {
        if disc.read_error.is_some() || !matches!(matches[di], ScanMatch::Unmatched) {
            continue;
        }
        if let Some(ei) = entries.iter().position(|e| {
            !e.claimed && !e.has_live_pdf() && e.stored_sha256.as_deref() == Some(disc.sha256.as_str())
        }) {
            entries[ei].claimed = true;
            matches[di] = if entries[ei].stale_refs.is_empty() && entries[ei].missing_pdf_names.is_empty() {
                ScanMatch::Attach { entry_idx: ei }
            } else {
                ScanMatch::Move { entry_idx: ei }
            };
        } else if let Some(ei) = entries.iter().position(|e| live_sha_cache_hit(e, disc.size, &disc.sha256, &mut hash_cache)) {
            matches[di] = ScanMatch::Duplicate { citekey: entries[ei].key.clone() };
        }
    }

    // Pass 1, Signal 3: normalized DOI / arXiv ID / ISBN.
    for (di, disc) in discovered.iter().enumerate() {
        if disc.read_error.is_some() || !matches!(matches[di], ScanMatch::Unmatched) || disc.ids.is_empty() {
            continue;
        }
        if let Some(ei) = entries.iter().position(|e| !e.claimed && !e.has_live_pdf() && ids_match(e, &disc.ids)) {
            entries[ei].claimed = true;
            matches[di] = if entries[ei].stale_refs.is_empty() && entries[ei].missing_pdf_names.is_empty() {
                ScanMatch::Attach { entry_idx: ei }
            } else {
                ScanMatch::Move { entry_idx: ei }
            };
        } else if let Some(ei) = entries.iter().position(|e| ids_match(e, &disc.ids)) {
            matches[di] = ScanMatch::Duplicate { citekey: entries[ei].key.clone() };
        }
    }

    // Pass 2, Signal 4: unique missing-on-disk attachment filename match.
    let mut entry_by_name: HashMap<String, Vec<usize>> = HashMap::new();
    for (ei, e) in entries.iter().enumerate() {
        if e.claimed || e.has_live_pdf() || e.missing_pdf_names.is_empty() {
            continue;
        }
        let unique: HashSet<&str> = e.missing_pdf_names.iter().map(String::as_str).collect();
        for name in unique {
            entry_by_name.entry(name.to_string()).or_default().push(ei);
        }
    }
    let mut disc_by_name: HashMap<String, Vec<usize>> = HashMap::new();
    for (di, disc) in discovered.iter().enumerate() {
        if disc.read_error.is_none() && matches!(matches[di], ScanMatch::Unmatched) {
            disc_by_name.entry(disc.file_name_lower.clone()).or_default().push(di);
        }
    }
    for (name, d_idxs) in disc_by_name {
        if d_idxs.len() != 1 {
            continue;
        }
        if let Some(e_idxs) = entry_by_name.get(&name).filter(|v| v.len() == 1) {
            let (di, ei) = (d_idxs[0], e_idxs[0]);
            if !entries[ei].claimed {
                entries[ei].claimed = true;
                matches[di] = ScanMatch::Move { entry_idx: ei };
            }
        }
    }
    matches
}

fn replace_stale_ref_field(m: &mut Mapping, key: &str, stale: &HashSet<String>, new_ref: &str) -> bool {
    let Some(cur) = m.get(key).cloned() else { return false };
    let matches_stale = |v: &str| stale.contains(&clean_ref_token(v).replace('\\', "/"));
    let updated = match cur {
        Value::String(ref sv) => {
            if !matches_stale(sv) {
                return false;
            }
            m.insert(key.into(), new_ref.into());
            true
        }
        Value::Sequence(seq) => {
            let mut changed = false;
            let mut next = Vec::with_capacity(seq.len().max(1));
            for item in seq {
                if item.as_str().is_some_and(matches_stale) {
                    changed = true;
                    if !next.iter().any(|x: &Value| x.as_str() == Some(new_ref)) {
                        next.push(Value::from(new_ref));
                    }
                } else if let Some(s) = item.as_str() {
                    if !next.iter().any(|x: &Value| x.as_str() == Some(s)) {
                        next.push(item);
                    }
                } else {
                    next.push(item);
                }
            }
            if changed {
                m.insert(key.into(), Value::Sequence(next));
            }
            changed
        }
        _ => false,
    };
    updated
}

fn update_collections_for_scan(m: &mut Mapping, stale_cols: &HashSet<String>, new_col: &str) -> bool {
    let existing = list(m, "collections");
    let mut next: Vec<String> = Vec::with_capacity(existing.len() + 1);
    let mut changed = false;
    for col in existing {
        if stale_cols.contains(&col) && col != new_col {
            changed = true;
            continue;
        }
        if !next.contains(&col) {
            next.push(col);
        }
    }
    if !next.iter().any(|c| c == new_col) {
        next.push(new_col.to_string());
        changed = true;
    }
    if changed {
        m.insert("collections".into(), Value::Sequence(next.into_iter().map(Value::from).collect()));
    }
    changed
}

fn needs_enrichment(m: &Mapping, disc: &DiscoveredPdf) -> bool {
    let missing_title = s(m, "title").is_none();
    let missing_author = list(m, "author").is_empty() && list(m, "authors").is_empty();
    let missing_year = s(m, "date").and_then(|d| year_of(&d)).is_none()
        && s(m, "published").and_then(|d| year_of(&d)).is_none();
    (missing_title || (missing_author && missing_year)) && disc.can_query_remote()
}

fn merge_missing_fields(dst: &mut Mapping, src: &Mapping) -> bool {
    let mut changed = false;
    for k in [
        "title", "date", "publisher", "publicationTitle", "DOI", "ISBN", "url", "abstractNote",
        "archiveID", "arxivVersion", "volume", "issue", "pages", "edition", "series", "numPages",
    ] {
        if s(dst, k).is_none() {
            if let Some(v) = s(src, k) {
                dst.insert(k.into(), v.into());
                changed = true;
            }
        }
    }
    for (k, alt) in [("author", "authors"), ("editor", "editors")] {
        if list(dst, k).is_empty() && list(dst, alt).is_empty() {
            let v = list(src, k);
            if !v.is_empty() {
                dst.insert(k.into(), Value::Sequence(v.into_iter().map(Value::from).collect()));
                changed = true;
            }
        }
    }
    if s(dst, "type").is_none_or(|t| t == "document") {
        if let Some(t) = s(src, "type") {
            if dst.get("type").and_then(Value::as_str) != Some(t.as_str()) {
                dst.insert("type".into(), t.into());
                changed = true;
            }
        }
    }
    changed
}

fn id_keys_of(m: &Mapping, ids: Option<&PdfIds>) -> Vec<String> {
    let mut keys = Vec::new();
    if let Some(d) = s(m, "DOI").or_else(|| ids.and_then(|i| i.doi.clone())) {
        let nd = norm_doi(&d);
        if !nd.is_empty() {
            keys.push(format!("doi:{nd}"));
        }
    }
    if let Some(a) = arxiv_of(m).or_else(|| ids.and_then(|i| i.arxiv.clone())) {
        keys.push(format!("ax:{}", a.to_ascii_lowercase()));
    }
    if let Some(ic) = s(m, "ISBN").or_else(|| ids.and_then(|i| i.isbn.clone())).and_then(|x| isbn_core(&x)) {
        keys.push(format!("isbn:{ic}"));
    }
    keys
}

fn mapping_kind_and_bib(m: &Mapping, class: ItemClass) -> (String, String) {
    let raw_type = s(m, "type").unwrap_or_else(|| class.default_item_type(false).into());
    (normalized_kind(&raw_type).to_string(), bibtex_type_of(m).to_string())
}

#[allow(clippy::too_many_arguments)]
fn push_error_item(
    report: &mut ScanRootsReport,
    citekey: String,
    title: String,
    kind: String,
    bibtex_type: String,
    disc: &DiscoveredPdf,
    collections: Vec<String>,
    err: String,
) {
    report.errors.push(format!("{}: {err}", disc.pdf_ref));
    report.items.push(ScanRootItem {
        action: "error".into(),
        citekey,
        title,
        kind,
        bibtex_type,
        pdf_path: disc.pdf_path.clone(),
        pdf_ref: disc.pdf_ref.clone(),
        collections,
        source: "error".into(),
        error: Some(err),
    });
}

fn push_duplicate_item(report: &mut ScanRootsReport, dup_key: String, disc: &DiscoveredPdf, entries: &[EntryRecord]) {
    report.skipped += 1;
    let (title, kind, bibtex_type, collections) = entries
        .iter()
        .find(|e| e.key == dup_key)
        .map(|e| {
            let (k, b) = mapping_kind_and_bib(&e.mapping, disc.class);
            (s(&e.mapping, "title").unwrap_or_else(|| dup_key.clone()), k, b, list(&e.mapping, "collections"))
        })
        .unwrap_or_else(|| {
            (
                disc.parsed.title.clone(),
                disc.class.as_kind().into(),
                "misc".into(),
                vec![disc.derived_collection.clone()],
            )
        });
    report.items.push(ScanRootItem {
        action: "skip".into(),
        citekey: dup_key,
        title,
        kind,
        bibtex_type,
        pdf_path: disc.pdf_path.clone(),
        pdf_ref: disc.pdf_ref.clone(),
        collections,
        source: "duplicate".into(),
        error: None,
    });
}

fn maybe_remote_lookup(
    lib: &Lib,
    opts: &ScanRootsOpts,
    lookups_used: &mut usize,
    disc: &DiscoveredPdf,
) -> Option<(Mapping, &'static str)> {
    if !disc.can_query_remote() || opts.max_lookups.is_some_and(|cap| *lookups_used >= cap) {
        return None;
    }
    if *lookups_used > 0 {
        if let Some(ms) = opts.rate_limit_ms.filter(|ms| *ms > 0) {
            std::thread::sleep(Duration::from_millis(ms));
        }
    }
    *lookups_used += 1;
    lookup_pdf_remote(lib.net, &lib.cfg.email, disc.class, &disc.ids, &disc.parsed, disc.first.as_ref())
}

#[allow(clippy::too_many_arguments)]
fn resolve_unmatched(
    lib: &Lib,
    opts: &ScanRootsOpts,
    disc: &DiscoveredPdf,
    entries: &mut [EntryRecord],
    created_by_sha: &HashMap<String, String>,
    created_by_id: &HashMap<String, String>,
    lookups_used: &mut usize,
) -> (ScanMatch, Option<(Mapping, &'static str)>) {
    let empty_map = Mapping::new();
    if let Some(dup_key) = created_by_sha
        .get(&disc.sha256)
        .cloned()
        .or_else(|| id_keys_of(&empty_map, Some(&disc.ids)).into_iter().find_map(|k| created_by_id.get(&k).cloned()))
    {
        return (ScanMatch::Duplicate { citekey: dup_key }, None);
    }
    let pre_fetched = maybe_remote_lookup(lib, opts, lookups_used, disc);
    if let Some((ref rm, _)) = pre_fetched {
        let r_ids = PdfIds { doi: s(rm, "DOI"), arxiv: arxiv_of(rm), arxiv_version: None, isbn: s(rm, "ISBN") };
        if let Some(ei) = entries.iter().position(|e| ids_match(e, &r_ids)) {
            if !entries[ei].claimed && !entries[ei].has_live_pdf() {
                entries[ei].claimed = true;
                let m = if entries[ei].stale_refs.is_empty() && entries[ei].missing_pdf_names.is_empty() {
                    ScanMatch::Attach { entry_idx: ei }
                } else {
                    ScanMatch::Move { entry_idx: ei }
                };
                return (m, pre_fetched);
            }
            return (ScanMatch::Duplicate { citekey: entries[ei].key.clone() }, None);
        }
        if let Some(dup_key) = id_keys_of(rm, Some(&disc.ids)).into_iter().find_map(|k| created_by_id.get(&k).cloned()) {
            return (ScanMatch::Duplicate { citekey: dup_key }, None);
        }
    }
    (ScanMatch::Unmatched, pre_fetched)
}

#[allow(clippy::too_many_arguments)]
fn process_matched_entry(
    lib: &Lib,
    opts: &ScanRootsOpts,
    disc: &DiscoveredPdf,
    entry: &mut EntryRecord,
    is_move: bool,
    is_attach: bool,
    pre_fetched: Option<(Mapping, &'static str)>,
    lookups_used: &mut usize,
    report: &mut ScanRootsReport,
) {
    let mut m = entry.mapping.clone();
    let mut dirty = false;
    let mut source = if is_move { "moved" } else { "existing" };

    if is_move {
        let stale_refs: HashSet<String> = entry.stale_refs.iter().cloned().collect();
        let stale_cols: HashSet<String> = entry.stale_derived_cols.iter().cloned().collect();
        let mut ref_replaced = replace_stale_ref_field(&mut m, "pdf", &stale_refs, &disc.pdf_ref);
        ref_replaced |= replace_stale_ref_field(&mut m, "external_pdf", &stale_refs, &disc.pdf_ref);
        ref_replaced |= replace_stale_ref_field(&mut m, "files", &stale_refs, &disc.pdf_ref);
        if !ref_replaced {
            let mut files = list(&m, "files");
            if !files.iter().any(|f| f == &disc.pdf_ref) {
                files.insert(0, disc.pdf_ref.clone());
                m.insert("files".into(), Value::Sequence(files.into_iter().map(Value::from).collect()));
            }
        }
        update_collections_for_scan(&mut m, &stale_cols, &disc.derived_collection);
        dirty = true;
    } else if is_attach {
        let has_pdf_ref = list(&m, "pdf")
            .into_iter()
            .chain(list(&m, "external_pdf"))
            .chain(list(&m, "files"))
            .any(|f| clean_ref_token(&f).replace('\\', "/") == disc.pdf_ref);
        if !has_pdf_ref {
            let mut files = list(&m, "files");
            files.insert(0, disc.pdf_ref.clone());
            m.insert("files".into(), Value::Sequence(files.into_iter().map(Value::from).collect()));
            dirty = true;
        }
        dirty |= update_collections_for_scan(&mut m, &HashSet::new(), &disc.derived_collection);
    } else {
        dirty |= update_collections_for_scan(&mut m, &HashSet::new(), &disc.derived_collection);
    }

    let mut enriched_here = false;
    if needs_enrichment(&m, disc) {
        if let Some((ref rm, rsrc)) = pre_fetched.or_else(|| maybe_remote_lookup(lib, opts, lookups_used, disc)) {
            if merge_missing_fields(&mut m, rm) {
                dirty = true;
                enriched_here = true;
                source = rsrc;
            }
        }
    }
    if (dirty || is_attach || is_move) && s(&m, "pdfSha256").as_deref() != Some(disc.sha256.as_str()) {
        m.insert("pdfSha256".into(), disc.sha256.clone().into());
    }

    let (action, write_ok) = if is_move {
        ("move", true)
    } else if dirty || is_attach {
        ("update", true)
    } else {
        ("unchanged", false)
    };
    let (kind, bibtex_type) = mapping_kind_and_bib(&m, disc.class);
    let item_cols = list(&m, "collections");
    let item_title = s(&m, "title").unwrap_or_else(|| entry.key.clone());
    if write_ok && !opts.dry_run {
        if let Err(e) = entry::write(lib.made, &entry.dir, &m) {
            push_error_item(report, entry.key.clone(), item_title, kind, bibtex_type, disc, item_cols, e);
            return;
        }
    }
    match action {
        "move" => report.moved += 1,
        "update" => report.updated += 1,
        _ => report.unchanged += 1,
    }
    if enriched_here {
        report.enriched += 1;
    }
    entry.mapping = m;
    report.items.push(ScanRootItem {
        action: action.into(),
        citekey: entry.key.clone(),
        title: item_title,
        kind,
        bibtex_type,
        pdf_path: disc.pdf_path.clone(),
        pdf_ref: disc.pdf_ref.clone(),
        collections: item_cols,
        source: source.into(),
        error: None,
    });
}

#[allow(clippy::too_many_arguments)]
fn process_new_entry(
    lib: &Lib,
    opts: &ScanRootsOpts,
    base: &Path,
    disc: &DiscoveredPdf,
    pre_fetched: Option<(Mapping, &'static str)>,
    used_keys: &mut HashSet<String>,
    created_by_sha: &mut HashMap<String, String>,
    created_by_id: &mut HashMap<String, String>,
    report: &mut ScanRootsReport,
) {
    let (mut m, source, did_enrich) = match pre_fetched {
        Some((mut rm, rsrc)) => {
            merge_local_fallbacks(&mut rm, &disc.parsed, disc.first.as_ref(), &disc.ids, disc.pages, disc.class);
            (rm, rsrc, true)
        }
        None => {
            let (lm, lsrc) = build_local_entry_mapping(&disc.parsed, disc.first.as_ref(), &disc.ids, disc.pages, disc.class);
            (lm, lsrc, false)
        }
    };
    let title = s(&m, "title").unwrap_or_else(|| disc.parsed.title.clone());
    let authors = list(&m, "author");
    let year = s(&m, "date").and_then(|d| year_of(&d));
    let key = citekey(&authors, year.as_deref(), &title, &|k| {
        used_keys.contains(&k.to_ascii_lowercase()) || base.join(k).exists()
    });
    used_keys.insert(key.to_ascii_lowercase());
    m.insert("citekey".into(), key.clone().into());
    m.insert("dateAdded".into(), now_stamp().into());
    m.insert("files".into(), Value::Sequence(vec![Value::from(disc.pdf_ref.clone())]));
    m.insert("pdfSha256".into(), disc.sha256.clone().into());
    m.insert("collections".into(), Value::Sequence(vec![Value::from(disc.derived_collection.clone())]));

    let (kind, bibtex_type) = mapping_kind_and_bib(&m, disc.class);
    if !opts.dry_run {
        let dir = base.join(&key);
        if let Err(e) = std::fs::create_dir_all(&dir)
            .map_err(|e| format!("{}: {e}", dir.display()))
            .and_then(|()| entry::write(lib.made, &dir, &m))
        {
            push_error_item(report, key, title, kind, bibtex_type, disc, vec![disc.derived_collection.clone()], e);
            return;
        }
    }
    created_by_sha.insert(disc.sha256.clone(), key.clone());
    for id_k in id_keys_of(&m, Some(&disc.ids)) {
        created_by_id.entry(id_k).or_insert_with(|| key.clone());
    }
    report.created += 1;
    if did_enrich {
        report.enriched += 1;
    }
    report.items.push(ScanRootItem {
        action: "create".into(),
        citekey: key,
        title,
        kind,
        bibtex_type,
        pdf_path: disc.pdf_path.clone(),
        pdf_ref: disc.pdf_ref.clone(),
        collections: vec![disc.derived_collection.clone()],
        source: source.into(),
        error: None,
    });
}

/// Recursively scans `external_pdf_roots`, leaves all PDFs in place, derives hierarchical collections,
/// reconciles existing/moved/duplicate entries, and supports `dry_run` preview, `rate_limit_ms`, and `max_lookups`.
pub fn scan_external_roots(lib: &Lib, opts: &ScanRootsOpts) -> Res<ScanRootsReport> {
    let roots = select_roots(lib, opts.root.as_deref())?;
    let roots_scanned: Vec<String> = roots.iter().map(|r| r.prefix.clone()).collect();
    let mut errors = Vec::new();
    let discovered = discover_pdfs(lib, &roots, &mut errors);
    let total_pdfs = discovered.len();
    let base = lib.base()?;
    let (mut entries, mut used_keys) = load_entries(lib, &roots)?;
    let matches = reconcile_pdfs(&discovered, &mut entries);

    let mut report = ScanRootsReport {
        dry_run: opts.dry_run,
        roots_scanned,
        total_pdfs,
        created: 0,
        updated: 0,
        moved: 0,
        unchanged: 0,
        enriched: 0,
        skipped: 0,
        errors,
        items: Vec::with_capacity(total_pdfs),
    };

    let mut lookups_used: usize = 0;
    let mut created_by_sha: HashMap<String, String> = HashMap::new();
    let mut created_by_id: HashMap<String, String> = HashMap::new();

    for (idx, (disc, scan_match)) in discovered.iter().zip(matches).enumerate() {
        kandinsky_plugin::event(
            "papers:scan-progress",
            serde_json::json!({
                "current": idx + 1,
                "total": total_pdfs,
                "pdf_ref": disc.pdf_ref,
                "dry_run": opts.dry_run,
            }),
        );
        if let Some(err) = &disc.read_error {
            let lm = build_local_entry_mapping(&disc.parsed, None, &disc.ids, disc.pages, disc.class).0;
            push_error_item(
                &mut report,
                String::new(),
                disc.parsed.title.clone(),
                disc.class.as_kind().into(),
                bibtex_type_of(&lm).into(),
                disc,
                vec![disc.derived_collection.clone()],
                err.clone(),
            );
            continue;
        }
        let (target_match, pre_fetched) = if matches!(scan_match, ScanMatch::Unmatched) {
            resolve_unmatched(lib, opts, disc, &mut entries, &created_by_sha, &created_by_id, &mut lookups_used)
        } else {
            (scan_match, None)
        };
        match target_match {
            ScanMatch::Duplicate { citekey: dup_key } => push_duplicate_item(&mut report, dup_key, disc, &entries),
            ScanMatch::Canonical(ei) => {
                process_matched_entry(lib, opts, disc, &mut entries[ei], false, false, pre_fetched, &mut lookups_used, &mut report)
            }
            ScanMatch::Move { entry_idx: ei } => {
                process_matched_entry(lib, opts, disc, &mut entries[ei], true, false, pre_fetched, &mut lookups_used, &mut report)
            }
            ScanMatch::Attach { entry_idx: ei } => {
                process_matched_entry(lib, opts, disc, &mut entries[ei], false, true, pre_fetched, &mut lookups_used, &mut report)
            }
            ScanMatch::Unmatched => {
                process_new_entry(lib, opts, &base, disc, pre_fetched, &mut used_keys, &mut created_by_sha, &mut created_by_id, &mut report)
            }
        }
    }

    if !opts.dry_run && (report.created > 0 || report.updated > 0 || report.moved > 0) {
        lib.write_bib()?;
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entry::tests::Plain;
    use crate::net::fake::{Answer, Table};
    use crate::refs::tests::{tiny_pdf, TempTrash, Vault};

    fn ext_vault() -> (tempfile::TempDir, Vault, PathBuf, PathBuf) {
        let ws = tempfile::tempdir().unwrap();
        let ws_real = real(ws.path()).unwrap();
        let vault_dir = ws_real.join("vault");
        let papers_dir = ws_real.join("Library/Papers");
        let books_dir = ws_real.join("Library/Books");
        std::fs::create_dir_all(&vault_dir).unwrap();
        std::fs::create_dir_all(&papers_dir).unwrap();
        std::fs::create_dir_all(&books_dir).unwrap();
        let mut v = Vault::new();
        v.root = vault_dir.clone();
        v.trash = TempTrash(vault_dir);
        v.cfg.external_pdf_roots = vec!["../Library/Papers".into(), "../Library/Books".into()];
        (ws, v, papers_dir, books_dir)
    }

    #[test]
    fn dry_run_then_apply_leaves_pdfs_in_place_ignores_non_pdfs_and_derives_collections() {
        let (_ws, mut v, papers_dir, books_dir) = ext_vault();
        v.cfg.watch_inbox = "../Library/Papers/Sort".into();
        let q_dir = papers_dir.join("Quantum/Many-Body");
        let inbox_dir = papers_dir.join("Sort");
        let dot_dir = papers_dir.join(".hidden");
        std::fs::create_dir_all(&q_dir).unwrap();
        std::fs::create_dir_all(&inbox_dir).unwrap();
        std::fs::create_dir_all(&dot_dir).unwrap();

        let ax_pdf = tiny_pdf(&["Quantum Spin Models\narXiv:2401.12345v1 [cond-mat.str-el]\nAda Example"]);
        let book_pdf = tiny_pdf(&["Header", "Preface", "ISBN 978-3-540-32897-1\nExample Press"]);
        std::fs::write(q_dir.join("2401.12345v1.pdf"), &ax_pdf).unwrap();
        std::fs::write(q_dir.join("notes.ipynb"), b"{}").unwrap();
        std::fs::write(q_dir.join("README.md"), b"# Notes").unwrap();
        std::fs::write(q_dir.join(".DS_Store"), b"ignored").unwrap();
        std::fs::write(dot_dir.join("secret.pdf"), tiny_pdf(&["Hidden"])).unwrap();
        std::fs::write(inbox_dir.join("queued.pdf"), tiny_pdf(&["Inbox"])).unwrap();
        std::fs::write(books_dir.join("Dresselhaus - Group Theory (2008).pdf"), &book_pdf).unwrap();

        let atom = "<feed><entry><title>Quantum Spin Models</title><published>2024-01-22T00:00:00Z</published><author><name>Ada Example</name></author></entry></feed>";
        let ol = serde_json::json!({
            "ISBN:9783540328971": {
                "title": "Group Theory",
                "authors": [{ "name": "Mildred Dresselhaus" }],
                "publish_date": "2008",
                "publishers": [{ "name": "Springer" }]
            }
        });
        v.net = Table::default()
            .on("https://export.arxiv.org/api/query?id_list=2401.12345v1", Answer::Text(atom.into()))
            .on("https://openlibrary.org/api/books?bibkeys=ISBN:9783540328971", Answer::Json(ol));

        // Default deserialization sets dry_run = true.
        let opts: ScanRootsOpts = serde_json::from_str("{}").unwrap();
        assert!(opts.dry_run);
        let preview = scan_external_roots(&v.lib(), &opts).unwrap();
        assert!(preview.dry_run);
        assert_eq!(preview.roots_scanned, vec!["../Library/Papers", "../Library/Books"]);
        assert_eq!((preview.total_pdfs, preview.created, preview.enriched), (2, 2, 2));
        assert!(v.lib().list().unwrap().is_empty(), "dry_run must not write vault entries");

        let applied = scan_external_roots(&v.lib(), &ScanRootsOpts { dry_run: false, ..Default::default() }).unwrap();
        assert_eq!((applied.created, applied.enriched), (2, 2));
        assert!(q_dir.join("2401.12345v1.pdf").is_file(), "PDF never renamed or moved");
        assert!(books_dir.join("Dresselhaus - Group Theory (2008).pdf").is_file());

        let paper_item = applied.items.iter().find(|i| i.pdf_ref.ends_with("2401.12345v1.pdf")).unwrap();
        assert_eq!(paper_item.kind, "paper");
        assert_eq!(paper_item.collections, vec!["Papers/Quantum/Many-Body"]);
        let book_item = applied.items.iter().find(|i| i.kind == "book").unwrap();
        assert_eq!(book_item.bibtex_type, "book");
        assert_eq!(book_item.collections, vec!["Books"]);

        // Second scan is cleanly idempotent.
        let again = scan_external_roots(&v.lib(), &ScanRootsOpts { dry_run: false, ..Default::default() }).unwrap();
        assert_eq!((again.created, again.updated, again.moved, again.unchanged), (0, 0, 0, 2));
    }

    #[test]
    fn moved_pdf_replaces_stale_ref_and_derived_collection_while_preserving_notes_and_marks() {
        let (_ws, v, papers_dir, _) = ext_vault();
        let old_dir = papers_dir.join("OldTopic");
        let new_dir = papers_dir.join("NewTopic/Sub");
        std::fs::create_dir_all(&old_dir).unwrap();
        std::fs::create_dir_all(&new_dir).unwrap();
        let pdf = tiny_pdf(&["Topological Insulators\nAuthor: Ada Example"]);
        std::fs::write(old_dir.join("Example - Topological Insulators - 2021.pdf"), &pdf).unwrap();

        let _ = scan_external_roots(&v.lib(), &ScanRootsOpts { dry_run: false, ..Default::default() }).unwrap();
        let key = v.lib().list().unwrap()[0].key.clone();
        let note_path = v.root.join("refs/papers").join(&key).join(format!("{key}.md"));

        // Add manual frontmatter, manual collection, note prose, and pdf-marks.
        let cur = std::fs::read_to_string(&note_path).unwrap();
        let mut edited = kandinsky_text::frontmatter::set_property(&cur, "status", &Value::from("reading-now"));
        edited = kandinsky_text::frontmatter::set_property(
            &edited,
            "collections",
            &Value::Sequence(vec!["Favorites".into(), "Papers/OldTopic".into()]),
        );
        let with_marks = crate::entry::merge_pdf_marks(
            &format!("{edited}\nKey proof on page 3.\n"),
            &["m-11111111 highlight p3 {\"version\":1,\"color\":\"#ffd400\",\"quads\":[[0,0,1,1]],\"quote\":{\"exact\":\"gap\"}}".into()],
        );
        std::fs::write(&note_path, with_marks).unwrap();

        // User moves the PDF on disk to NewTopic/Sub and leaves a duplicate copy in ZCopies/.
        std::fs::rename(
            old_dir.join("Example - Topological Insulators - 2021.pdf"),
            new_dir.join("Topological_Moved.pdf"),
        )
        .unwrap();
        let dup_dir = papers_dir.join("ZCopies");
        std::fs::create_dir_all(&dup_dir).unwrap();
        std::fs::write(dup_dir.join("DuplicateCopy.pdf"), &pdf).unwrap();

        let res = scan_external_roots(
            &v.lib(),
            &ScanRootsOpts { dry_run: false, root: Some("../Library/Papers".into()), ..Default::default() },
        )
        .unwrap();
        assert_eq!((res.moved, res.skipped), (1, 1), "{res:?}");

        let note_after = std::fs::read_to_string(&note_path).unwrap();
        assert!(note_after.contains("status: reading-now"), "manual frontmatter kept: {note_after}");
        assert!(note_after.contains("Favorites"), "manual collection kept: {note_after}");
        assert!(note_after.contains("Papers/NewTopic/Sub"), "new collection added: {note_after}");
        assert!(!note_after.contains("Papers/OldTopic"), "stale derived collection replaced: {note_after}");
        assert!(note_after.contains("../Library/Papers/NewTopic/Sub/Topological_Moved.pdf"), "new ref updated: {note_after}");
        assert!(!note_after.contains("OldTopic/Example"), "stale PDF ref removed: {note_after}");
        assert!(note_after.contains("Key proof on page 3."), "note body kept");
        assert!(note_after.contains("m-11111111 highlight p3"), "pdf-marks kept");
    }

    #[test]
    fn max_lookups_falls_back_to_filename_and_unique_missing_filename_reconciles() {
        let (_ws, mut v, papers_dir, _) = ext_vault();
        let p1 = papers_dir.join("Condensed");
        std::fs::create_dir_all(&p1).unwrap();
        std::fs::write(p1.join("Altland2023 - Field Theory - 2023.pdf"), tiny_pdf(&["doi:10.1000/a1"])).unwrap();
        std::fs::write(p1.join("Sakurai - Quantum Mechanics (2020).pdf"), tiny_pdf(&["doi:10.1000/b2"])).unwrap();

        v.net = Table::default().on(
            "https://api.crossref.org/works/10.1000/a1",
            Answer::Json(serde_json::json!({ "message": { "title": ["Remote Field Theory"], "type": "journal-article", "author": [{ "family": "Altland", "given": "Alexander" }], "issued": { "date-parts": [[2023]] } } })),
        );

        let res = scan_external_roots(
            &v.lib(),
            &ScanRootsOpts { dry_run: false, max_lookups: Some(1), rate_limit_ms: Some(1), ..Default::default() },
        )
        .unwrap();
        assert_eq!((res.created, res.enriched), (2, 1));
        assert_eq!(res.items[0].source, "crossref");
        assert_eq!(res.items[1].source, "filename");
        assert_eq!(res.items[1].title, "Quantum Mechanics");

        // Create Zotero-style missing-PDF entry without pdfSha256 and match uniquely by missing filename.
        let orphan_dir = v.root.join("refs/papers/zoteroitem");
        std::fs::create_dir_all(&orphan_dir).unwrap();
        let mut zm = Mapping::new();
        zm.insert("citekey".into(), "zoteroitem".into());
        zm.insert("type".into(), "journalArticle".into());
        zm.insert("title".into(), "Zotero Moved Entry".into());
        zm.insert("files".into(), Value::Sequence(vec!["../Library/Papers/OldSub/UniqueFile.pdf".into()]));
        crate::entry::write(&Plain, &orphan_dir, &zm).unwrap();

        let target_dir = papers_dir.join("NewSub");
        std::fs::create_dir_all(&target_dir).unwrap();
        std::fs::write(target_dir.join("UniqueFile.pdf"), tiny_pdf(&["No IDs"])).unwrap();

        let move_res = scan_external_roots(&v.lib(), &ScanRootsOpts { dry_run: false, ..Default::default() }).unwrap();
        assert_eq!(move_res.moved, 1);
        let mv = move_res.items.iter().find(|i| i.citekey == "zoteroitem").unwrap();
        assert_eq!(mv.action, "move");
        assert_eq!(mv.pdf_ref, "../Library/Papers/NewSub/UniqueFile.pdf");
    }

    #[test]
    fn reconciles_existing_entry_using_external_pdf_property() {
        let (_ws, v, papers_dir, _) = ext_vault();
        let topic = papers_dir.join("Topic");
        std::fs::create_dir_all(&topic).unwrap();
        std::fs::write(topic.join("ExistingPaper.pdf"), tiny_pdf(&["No embedded IDs"])).unwrap();

        let note_dir = v.root.join("refs/papers/customkey2025");
        std::fs::create_dir_all(&note_dir).unwrap();
        let mut fm = Mapping::new();
        fm.insert("citekey".into(), "customkey2025".into());
        fm.insert("type".into(), "journalArticle".into());
        fm.insert("title".into(), "Completely Different Title".into());
        fm.insert("external_pdf".into(), "../Library/Papers/Topic/ExistingPaper.pdf".into());
        crate::entry::write(&Plain, &note_dir, &fm).unwrap();

        let res = scan_external_roots(&v.lib(), &ScanRootsOpts { dry_run: true, max_lookups: Some(0), ..Default::default() }).unwrap();
        assert_eq!((res.created, res.updated, res.skipped), (0, 1, 0), "{res:?}");
        assert_eq!(res.items[0].citekey, "customkey2025");
        assert_eq!(res.items[0].action, "update");
    }
}
