//! ZotMoov-style watched PDF inbox (`scan_inbox`, `organize_inbox`, `start_inbox_watcher`) and Zoplicate-style
//! 5-signal duplicate detection & lossless safe merge (`find_duplicates`, `merge_entries`, `relink_vault_citations`).
use crate::core_api::CoreApi;
use crate::entry;
use crate::external::{self, format_pdf_filename, resolve_dir_from, resolve_pdf_ref, sanitize_pdf_filename, write_external_pdf};
use crate::firstpage;
use crate::refs::{arxiv_of, citekey, first_page_entry, list as ylist, now_stamp, pdf_text, s as ys, sha, year_of, Lib, Paper, Res};
use crate::remote::{self, parse_arxiv_versioned, parse_doi, parse_isbn};
use crate::settings::Settings;
use kandinsky_text::paths::safe_join;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as Json};
use serde_yaml::{Mapping, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InboxItem {
    pub file: String, pub size: u64, pub doi: Option<String>, pub arxiv: Option<String>, pub arxiv_version: Option<String>,
    pub isbn: Option<String>, pub title: String, pub authors: Vec<String>, pub year: Option<String>,
    pub suggested_filename: String, pub suggested_subfolder: String, pub existing_key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InboxScan { pub inbox_dir: String, pub items: Vec<InboxItem>, pub subfolder_presets: Vec<String> }

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct OrganizeInboxItemOpts { pub file: String, pub subfolder: Option<String>, pub filename: Option<String>, pub collections: Vec<String> }

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct OrganizeInboxReq { pub files: Vec<String>, pub items: Vec<OrganizeInboxItemOpts>, pub subfolder: Option<String>, pub dry_run: bool }

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct OrganizeInboxMoved { pub source_file: String, pub key: String, pub pdf_ref: String, pub created: bool }

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct OrganizeInboxResult { pub dry_run: bool, pub organized: Vec<OrganizeInboxMoved>, pub skipped: Vec<(String, String)> }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DuplicateGroup {
    pub id: String, pub reasons: Vec<String>, pub primary: String, pub members: Vec<Paper>,
    pub diffs: BTreeMap<String, Vec<(String, String)>>,
}

fn tr() -> bool { true }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MergeOpts {
    pub dup: String, pub into: String,
    #[serde(default = "tr")] pub relink_vault: bool,
    #[serde(default = "tr")] pub trash_duplicate_pdf: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MergeResult { #[serde(flatten)] pub paper: Paper, pub relinked_files: usize, pub trashed: String }

pub fn resolve_inbox_dir(vault_root: &Path, cfg: &Settings) -> Res<PathBuf> {
    let raw = cfg.watch_inbox.trim();
    if raw.is_empty() { return Err("watch_inbox is not configured".into()); }
    if let Some((_, abs)) = resolve_pdf_ref(vault_root, cfg, raw) { return Ok(abs); }
    if !raw.contains("..") && !Path::new(raw).is_absolute() {
        if let Ok(p) = safe_join(vault_root, raw) { return Ok(p); }
    }
    resolve_dir_from(vault_root, raw).ok_or_else(|| format!("invalid watch_inbox path: {raw:?}"))
}

fn suggest_subfolder(presets: &[String], hay: &str) -> String {
    let low = hay.to_lowercase();
    presets.iter().find(|p| {
        let leaf = p.rsplit('/').next().unwrap_or(p).trim().to_lowercase();
        !leaf.is_empty() && low.contains(&leaf)
    }).cloned().unwrap_or_default()
}

fn norm_doi(d: &str) -> String {
    d.trim().trim_start_matches("https://doi.org/").trim_start_matches("http://doi.org/").trim_start_matches("doi:").trim().to_lowercase()
}

fn isbn_core(raw: &str) -> Option<String> {
    let d: String = parse_isbn(raw).unwrap_or_else(|| raw.chars().filter(|c| c.is_ascii_digit() || matches!(c, 'X' | 'x')).collect()).to_ascii_uppercase();
    match d.len() { 10 => Some(d[..9].to_string()), 13 if d.starts_with("978") => Some(d[3..12].to_string()), 13 => Some(d[..12].to_string()), _ => None }
}

fn list_inbox_pdfs(inbox_dir: &Path) -> Res<Vec<PathBuf>> {
    if !inbox_dir.exists() { return Ok(Vec::new()); }
    let mut files: Vec<PathBuf> = std::fs::read_dir(inbox_dir).map_err(|e| format!("{}: {e}", inbox_dir.display()))?.flatten().map(|e| e.path()).filter(|p| p.is_file() && p.extension().is_some_and(|x| x.eq_ignore_ascii_case("pdf"))).collect();
    files.sort();
    Ok(files)
}

struct InspectedPdf {
    digest: [u8; 32], text: String, pages: usize, doi: Option<String>, arxiv: Option<String>, arxiv_ver: Option<String>,
    isbn: Option<String>, first: Option<firstpage::FirstPage>, existing_key: Option<String>,
}

fn inspect_pdf(lib: &Lib, existing: &[Paper], fname: &str, bytes: &[u8]) -> InspectedPdf {
    let digest = sha(bytes);
    let (text, pages) = pdf_text(bytes);
    let doi = parse_doi(&text);
    let (arxiv, arxiv_ver) = match parse_arxiv_versioned(&text) { Some((a, v)) => (Some(a), v), None => (None, None) };
    let isbn = parse_isbn(&text);
    let first = firstpage::read(text.split('\x0c').next().unwrap_or(""), fname);
    let existing_key = existing.iter().find(|p| {
        doi.as_deref().zip(p.doi.as_deref()).is_some_and(|(a, b)| norm_doi(a) == norm_doi(b))
            || (arxiv.is_some() && p.arxiv == arxiv)
            || isbn.as_deref().and_then(isbn_core).is_some_and(|ic| safe_join(lib.root, &p.dir).ok().and_then(|d| entry::read(&d)).and_then(|m| ys(&m, "ISBN")).and_then(|s| isbn_core(&s)).as_deref() == Some(ic.as_str()))
            || p.pdf.as_deref().and_then(|f| lib.pdf_abs_path(f)).is_some_and(|abs| abs.metadata().is_ok_and(|md| md.len() == bytes.len() as u64) && std::fs::read(&abs).is_ok_and(|b| sha(&b) == digest))
    }).map(|p| p.key.clone());
    InspectedPdf { digest, text, pages, doi, arxiv, arxiv_ver, isbn, first, existing_key }
}

fn fallback_stem_entry(fname: &str) -> Mapping {
    let stem = fname.trim_end_matches(".pdf").trim_end_matches(".PDF").replace(['_', '-'], " ");
    let mut m = Mapping::new();
    m.insert("title".into(), stem.split_whitespace().collect::<Vec<_>>().join(" ").into());
    m.insert("type".into(), "document".into());
    m
}

pub fn scan_inbox(lib: &Lib) -> Res<InboxScan> {
    let inbox_dir = resolve_inbox_dir(lib.root, lib.cfg)?;
    let existing = lib.list().unwrap_or_default();
    let mut items = Vec::new();
    for path in list_inbox_pdfs(&inbox_dir)? {
        let fname = path.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
        let bytes = std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        let info = inspect_pdf(lib, &existing, &fname, &bytes);
        let m = if let Some(ek) = &info.existing_key {
            safe_join(lib.root, &format!("{}/{ek}", lib.cfg.dir)).ok().and_then(|d| entry::read(&d)).unwrap_or_default()
        } else if let Some(fp) = &info.first { first_page_entry(fp, info.pages) } else { fallback_stem_entry(&fname) };
        let (title, authors, year) = (ys(&m, "title").unwrap_or_else(|| fname.clone()), ylist(&m, "author"), ys(&m, "date").and_then(|d| year_of(&d)));
        let key_hint = info.existing_key.clone().unwrap_or_else(|| citekey(&authors, year.as_deref(), &title, &|_| false));
        let suggested_filename = format_pdf_filename(&lib.cfg.rename_format, &m, &key_hint);
        let suggested_subfolder = suggest_subfolder(&lib.cfg.subfolder_presets, &format!("{title} {}", info.text.chars().take(600).collect::<String>()));
        items.push(InboxItem {
            file: fname, size: bytes.len() as u64, doi: info.doi, arxiv: info.arxiv, arxiv_version: info.arxiv_ver,
            isbn: info.isbn, title, authors, year, suggested_filename, suggested_subfolder, existing_key: info.existing_key,
        });
    }
    Ok(InboxScan { inbox_dir: lib.cfg.watch_inbox.clone(), items, subfolder_presets: lib.cfg.subfolder_presets.clone() })
}

pub fn organize_inbox(lib: &Lib, req: &OrganizeInboxReq) -> Res<OrganizeInboxResult> {
    let inbox_dir = resolve_inbox_dir(lib.root, lib.cfg)?;
    let refs_base = safe_join(lib.root, &lib.cfg.dir)?;
    let mut res = OrganizeInboxResult { dry_run: req.dry_run, ..Default::default() };
    let selected: HashSet<String> = req.files.iter().chain(req.items.iter().map(|i| &i.file)).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();

    for path in list_inbox_pdfs(&inbox_dir)? {
        let fname = path.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
        if !selected.is_empty() && !selected.contains(&fname) { continue; }
        let item_opt = req.items.iter().find(|i| i.file == fname);
        let bytes = match std::fs::read(&path) {
            Ok(b) if b.starts_with(b"%PDF") => b,
            Ok(_) => { res.skipped.push((fname, "not a PDF".into())); continue; }
            Err(e) => { res.skipped.push((fname, e.to_string())); continue; }
        };
        let info = inspect_pdf(lib, &lib.list().unwrap_or_default(), &fname, &bytes);
        let (key, mut m, created) = if let Some(ek) = info.existing_key {
            let m = entry::read(&refs_base.join(&ek)).unwrap_or_default();
            (ek, m, false)
        } else {
            let fetched = if let Some(d) = &info.doi { remote::crossref(lib.net, d).ok() } else if let Some(a) = &info.arxiv {
                let q = info.arxiv_ver.as_ref().map_or_else(|| a.clone(), |ver| format!("{a}{ver}"));
                remote::arxiv(lib.net, &q).or_else(|_| remote::arxiv(lib.net, a)).ok().map(|mut am| {
                    if let Some(ver) = &info.arxiv_ver {
                        am.insert("arxivVersion".into(), ver.clone().into());
                        am.insert("archiveID".into(), format!("arXiv:{a}{ver}").into());
                    }
                    am
                })
            } else {
                info.first.as_ref().and_then(|fp| firstpage::crossref_match(lib.net, fp)).and_then(|d| remote::crossref(lib.net, &d).ok())
                    .or_else(|| info.isbn.as_deref().and_then(|i| remote::isbn_book(lib.net, i).ok()))
            };
            let mut m = fetched.unwrap_or_else(|| info.first.as_ref().map_or_else(|| fallback_stem_entry(&fname), |fp| first_page_entry(fp, info.pages)));
            let (title, year) = (ys(&m, "title").unwrap_or_else(|| fname.clone()), ys(&m, "date").and_then(|d| year_of(&d)));
            let k = lib.next_citekey(&ylist(&m, "author"), year.as_deref(), &title)?;
            m.insert("citekey".into(), k.clone().into());
            m.insert("dateAdded".into(), now_stamp().into());
            (k, m, true)
        };

        let sub = item_opt.and_then(|o| o.subfolder.clone()).or_else(|| req.subfolder.clone()).unwrap_or_else(|| suggest_subfolder(&lib.cfg.subfolder_presets, &ys(&m, "title").unwrap_or_default()));
        let target_name = item_opt.and_then(|o| o.filename.as_deref()).map(|n| sanitize_pdf_filename(n, &key)).unwrap_or_else(|| format_pdf_filename(&lib.cfg.rename_format, &m, &key));
        if req.dry_run {
            let preview_ref = if !lib.cfg.external_pdf_roots.is_empty() {
                let pfx = lib.cfg.external_pdf_roots[0].trim_end_matches('/');
                if sub.trim().is_empty() { format!("{pfx}/{target_name}") } else { format!("{pfx}/{}/{target_name}", sub.trim_matches('/')) }
            } else { format!("{}/{key}/{target_name}", lib.cfg.dir) };
            res.organized.push(OrganizeInboxMoved { source_file: fname, key, pdf_ref: preview_ref, created });
            continue;
        }

        let entry_dir = refs_base.join(&key);
        std::fs::create_dir_all(&entry_dir).map_err(|e| format!("{}: {e}", entry_dir.display()))?;
        let (stored_entry, written_abs, pdf_ref) = if !lib.cfg.external_pdf_roots.is_empty() {
            let (portable, abs) = write_external_pdf(lib.root, lib.cfg, Some(&sub), &target_name, &bytes)?;
            (portable.clone(), abs, portable)
        } else {
            let (stem, mut chosen) = (target_name.strip_suffix(".pdf").unwrap_or(&target_name), target_name.clone());
            for n in 2usize.. {
                let p = entry_dir.join(&chosen);
                if !p.exists() || (p.metadata().is_ok_and(|md| md.len() == bytes.len() as u64) && std::fs::read(&p).is_ok_and(|b| sha(&b) == info.digest)) { break; }
                chosen = format!("{stem} - {n}.pdf");
            }
            let dest = entry_dir.join(&chosen);
            if !dest.exists() { kandinsky_plugin::write_file(&dest, &bytes).map_err(|e| e.to_string())?; }
            let rel = format!("{}/{key}/{chosen}", lib.cfg.dir);
            (chosen, dest, rel)
        };
        if !written_abs.is_file() || written_abs.metadata().map(|md| md.len()).unwrap_or(0) != bytes.len() as u64 {
            return Err(format!("failed to verify destination PDF {}", written_abs.display()));
        }
        let mut files = ylist(&m, "files");
        if !files.contains(&stored_entry) { files.insert(0, stored_entry); }
        m.insert("files".into(), Value::Sequence(files.into_iter().map(Value::from).collect()));
        if let Some(cols) = item_opt.map(|o| &o.collections).filter(|c| !c.is_empty()) {
            let mut have = ylist(&m, "collections");
            for c in cols { if !have.contains(c) { have.push(c.clone()); } }
            m.insert("collections".into(), Value::Sequence(have.into_iter().map(Value::from).collect()));
        }
        entry::write(lib.made, &entry_dir, &m)?;
        if written_abs != path { std::fs::remove_file(&path).map_err(|e| format!("{}: {e}", path.display()))?; }
        res.organized.push(OrganizeInboxMoved { source_file: fname, key, pdf_ref, created });
    }
    if !req.dry_run && !res.organized.is_empty() { lib.write_bib()?; }
    Ok(res)
}

pub fn start_inbox_watcher(plugin: String, root: PathBuf) {
    std::thread::spawn(move || {
        let core = CoreApi::new(plugin, root.clone());
        let mut last: Option<Vec<String>> = None;
        loop {
            std::thread::sleep(Duration::from_secs(5));
            let cfg = core.settings(&Json::Null);
            if cfg.watch_inbox.trim().is_empty() { continue; }
            let Ok(paths) = resolve_inbox_dir(&root, &cfg).and_then(|d| list_inbox_pdfs(&d)) else { continue };
            let names: Vec<String> = paths.iter().filter_map(|p| p.file_name().and_then(|n| n.to_str()).map(String::from)).collect();
            if last.as_ref() != Some(&names) {
                if !(last.is_none() && names.is_empty()) {
                    kandinsky_plugin::event("papers:inbox", json!({ "count": names.len(), "files": names }));
                }
                last = Some(names);
            }
        }
    });
}

fn norm_ascii_word(s: &str) -> String {
    s.chars().filter_map(|c| match c {
        'á' | 'à' | 'ä' | 'â' | 'ã' => Some('a'), 'é' | 'è' | 'ë' | 'ê' => Some('e'),
        'í' | 'ì' | 'ï' | 'î' => Some('i'), 'ó' | 'ò' | 'ö' | 'ô' | 'õ' => Some('o'),
        'ú' | 'ù' | 'ü' | 'û' => Some('u'), 'ñ' => Some('n'), 'ç' => Some('c'), 'ß' => Some('s'),
        c if c.is_ascii_alphanumeric() => Some(c.to_ascii_lowercase()),
        _ => None,
    }).collect()
}

fn title_tokens(t: &str) -> BTreeSet<String> {
    t.split(|c: char| !c.is_alphanumeric()).map(norm_ascii_word).filter(|w| !w.is_empty()).collect()
}

fn jaccard(a: &BTreeSet<String>, b: &BTreeSet<String>) -> f64 {
    if a.is_empty() || b.is_empty() { 0.0 } else { a.intersection(b).count() as f64 / a.union(b).count() as f64 }
}

fn first_surname(authors: &[String]) -> String {
    authors.first().map(|a| norm_ascii_word(a.split(',').next().unwrap_or(a).split_whitespace().last().unwrap_or(""))).unwrap_or_default()
}

pub fn find_duplicates(lib: &Lib) -> Res<Vec<DuplicateGroup>> {
    let papers = lib.list()?;
    let n = papers.len();
    if n < 2 { return Ok(Vec::new()); }
    let mappings: Vec<Mapping> = papers.iter().map(|p| safe_join(lib.root, &p.dir).ok().and_then(|d| entry::read(&d)).unwrap_or_default()).collect();
    let mut parent: Vec<usize> = (0..n).collect();
    let mut pair_reasons: Vec<(usize, usize, &'static str)> = Vec::new();
    fn root_of(parent: &mut [usize], mut x: usize) -> usize {
        while parent[x] != x { parent[x] = parent[parent[x]]; x = parent[x]; }
        x
    }
    let mut link = |a: usize, b: usize, why: &'static str| {
        let (ra, rb) = (root_of(&mut parent, a), root_of(&mut parent, b));
        if ra != rb { parent[rb] = ra; }
        pair_reasons.push((a, b, why));
    };

    let (mut by_doi, mut by_arxiv, mut by_isbn) = (HashMap::<String, usize>::new(), HashMap::<String, usize>::new(), HashMap::<String, usize>::new());
    for (i, (paper, mapping)) in papers.iter().zip(&mappings).enumerate() {
        if let Some(d) = paper.doi.as_deref().map(norm_doi).filter(|d| !d.is_empty()) {
            if let Some(ax) = d.strip_prefix("10.48550/arxiv.").and_then(remote::parse_arxiv) {
                if let Some(&prev) = by_arxiv.get(&ax) { link(prev, i, "arxiv"); } else { by_arxiv.insert(ax, i); }
            }
            if let Some(&prev) = by_doi.get(&d) { link(prev, i, "doi"); } else { by_doi.insert(d, i); }
        }
        if let Some(ax) = paper.arxiv.clone().or_else(|| arxiv_of(mapping)).map(|a| a.to_lowercase()) {
            if let Some(&prev) = by_arxiv.get(&ax) { link(prev, i, "arxiv"); } else { by_arxiv.insert(ax, i); }
        }
        if let Some(ic) = ys(mapping, "ISBN").and_then(|s| isbn_core(&s)) {
            if let Some(&prev) = by_isbn.get(&ic) { link(prev, i, "isbn"); } else { by_isbn.insert(ic, i); }
        }
    }

    let mut by_size: HashMap<u64, Vec<(usize, PathBuf)>> = HashMap::new();
    for (i, p) in papers.iter().enumerate() {
        if let Some(abs) = p.pdf.as_deref().and_then(|f| lib.pdf_abs_path(f)) {
            if let Some(md) = abs.metadata().ok().filter(|m| m.len() > 0) { by_size.entry(md.len()).or_default().push((i, abs)); }
        }
    }
    for (_, bucket) in by_size.into_iter().filter(|(_, b)| b.len() >= 2) {
        let mut by_hash: HashMap<[u8; 32], usize> = HashMap::new();
        for (idx, path) in bucket {
            if let Ok(bytes) = std::fs::read(&path) {
                let h = sha(&bytes);
                if let Some(&prev) = by_hash.get(&h) { link(prev, idx, "pdf_sha256"); } else { by_hash.insert(h, idx); }
            }
        }
    }

    let toks: Vec<BTreeSet<String>> = papers.iter().map(|p| title_tokens(&p.title)).collect();
    let surnames: Vec<String> = papers.iter().map(|p| first_surname(&p.authors)).collect();
    let years: Vec<Option<i32>> = papers.iter().map(|p| p.year.as_deref().and_then(|y| y.parse().ok())).collect();
    for i in 0..n {
        if toks[i].is_empty() || surnames[i].is_empty() { continue; }
        for j in (i + 1)..n {
            if surnames[i] != surnames[j] || jaccard(&toks[i], &toks[j]) < 0.88 { continue; }
            if (papers[i].kind == "preprint" && papers[j].kind == "journalArticle") || (papers[j].kind == "preprint" && papers[i].kind == "journalArticle") {
                link(i, j, "arxiv");
            }
            if years[i].zip(years[j]).is_some_and(|(yi, yj)| (yi - yj).abs() <= 1) { link(i, j, "title_author_year"); }
        }
    }

    let mut groups: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for i in 0..n { groups.entry(root_of(&mut parent, i)).or_default().push(i); }
    let mut out = Vec::new();
    for (_, mut idxs) in groups.into_iter().filter(|(_, v)| v.len() >= 2) {
        let set: HashSet<usize> = idxs.iter().copied().collect();
        let reasons: Vec<String> = pair_reasons.iter().filter(|(a, b, _)| set.contains(a) && set.contains(b)).map(|(_, _, w)| (*w).to_string()).collect::<BTreeSet<_>>().into_iter().collect();
        let score = |idx: usize| -> i32 {
            let p = &papers[idx];
            let kpts = match p.kind.as_str() { "journalArticle" | "book" | "thesis" | "conferencePaper" => 10, "preprint" => 4, _ => 1 };
            kpts + if p.doi.as_deref().is_some_and(|d| !norm_doi(d).starts_with("10.48550/arxiv.")) { 6 } else { 0 } + if p.pdf.is_some() { 4 } else { 0 } + if p.has_notes { 3 } else { 0 } + mappings[idx].len() as i32
        };
        idxs.sort_by(|&a, &b| score(b).cmp(&score(a)).then_with(|| papers[a].key.cmp(&papers[b].key)));
        let primary = papers[idxs[0]].key.clone();
        let mut diffs: BTreeMap<String, Vec<(String, String)>> = BTreeMap::new();
        for field in ["type", "title", "date", "publicationTitle", "volume", "issue", "pages", "DOI", "archiveID", "arxivVersion", "ISBN", "publisher", "url"] {
            let vals: Vec<(String, String)> = idxs.iter().filter_map(|&i| ys(&mappings[i], field).map(|v| (papers[i].key.clone(), v))).collect();
            let distinct: BTreeSet<&str> = vals.iter().map(|(_, v)| v.as_str()).collect();
            if distinct.len() > 1 || (!vals.is_empty() && vals.len() < idxs.len()) { diffs.insert(field.into(), vals); }
        }
        out.push(DuplicateGroup { id: format!("dup-{primary}"), reasons, primary, members: idxs.into_iter().map(|i| papers[i].clone()).collect(), diffs });
    }
    Ok(out)
}

pub fn merge_entries(lib: &Lib, opts: &MergeOpts, relink: &dyn Fn(&str, &str) -> usize) -> Res<MergeResult> {
    if opts.dup == opts.into { return Err("an entry is not merged into itself".into()); }
    let all = lib.list()?;
    let (Some(d), Some(i)) = (all.iter().find(|p| p.key == opts.dup), all.iter().find(|p| p.key == opts.into)) else {
        return Err(format!("no reference {} or {}", opts.dup, opts.into));
    };
    let (into_dir, dup_dir) = (safe_join(lib.root, &i.dir)?, safe_join(lib.root, &d.dir)?);
    let (mut m, from) = (entry::read(&into_dir).unwrap_or_default(), entry::read(&dup_dir).unwrap_or_default());

    let (into_type, from_type) = (ys(&m, "type").unwrap_or_default(), ys(&from, "type").unwrap_or_default());
    if (matches!(into_type.as_str(), "" | "document" | "preprint") && !matches!(from_type.as_str(), "" | "document"))
        || (into_type == "journalArticle" && !matches!(from_type.as_str(), "" | "document" | "preprint" | "journalArticle"))
    {
        m.insert("type".into(), from_type.into());
    }

    let mut aliases = ylist(&m, "aliases");
    for al in std::iter::once(opts.dup.clone()).chain(ylist(&from, "aliases")) {
        if al != opts.into && !al.is_empty() && !aliases.contains(&al) { aliases.push(al); }
    }
    if !aliases.is_empty() { m.insert("aliases".into(), Value::Sequence(aliases.into_iter().map(Value::from).collect())); }

    if ys(&m, "DOI").is_some_and(|x| norm_doi(&x).starts_with("10.48550/arxiv.")) {
        if let Some(real_doi) = ys(&from, "DOI").filter(|x| !norm_doi(x).starts_with("10.48550/arxiv.")) { m.insert("DOI".into(), real_doi.into()); }
    }
    for k in ["title", "author", "editor", "date", "publicationTitle", "proceedingsTitle", "bookTitle", "publisher", "university", "volume", "issue", "pages", "DOI", "archiveID", "arxivVersion", "repository", "ISBN", "ISSN", "abstractNote", "url", "extra", "series", "edition", "place", "numPages"] {
        let missing = match m.get(k) { None | Some(Value::Null) => true, Some(Value::String(s)) => s.trim().is_empty(), Some(Value::Sequence(seq)) => seq.is_empty(), _ => false };
        if missing { if let Some(v) = from.get(k) { m.insert(k.into(), v.clone()); } }
    }
    for key in ["collections", "tags", "sources", "related"] {
        let mut have = ylist(&m, key);
        for v in ylist(&from, key) { if !have.contains(&v) { have.push(v); } }
        if !have.is_empty() { m.insert(key.into(), Value::Sequence(have.into_iter().map(Value::from).collect())); }
    }

    let (mut files, into_had_pdf) = (ylist(&m, "files"), i.pdf.is_some());
    for f in ylist(&from, "files") {
        if files.contains(&f) || (into_had_pdf && opts.trash_duplicate_pdf) { continue; }
        if external::resolve_pdf_ref(lib.root, lib.cfg, &f).is_some() {
            files.push(f);
        } else if dup_dir.join(&f).is_file() {
            let dest_name = if into_dir.join(&f).exists() { format!("{}-{f}", opts.dup) } else { f.clone() };
            if let Ok(bytes) = std::fs::read(dup_dir.join(&f)) {
                let _ = kandinsky_plugin::write_file(into_dir.join(&dest_name), &bytes);
                files.push(dest_name);
            }
        }
    }
    if !files.is_empty() { m.insert("files".into(), Value::Sequence(files.into_iter().map(Value::from).collect())); }
    entry::write(lib.made, &into_dir, &m)?;

    if let Some(dnp) = [entry::note_file(&opts.dup), entry::LEGACY_NOTE.to_string()].into_iter().map(|n| dup_dir.join(n)).find(|p| p.is_file()) {
        if let Ok(dup_text) = std::fs::read_to_string(&dnp) {
            let prose = entry::extract_user_prose(&dup_text);
            let (_, dup_marks) = entry::split_pdf_marks(&dup_text);
            if !prose.is_empty() { entry::append_note(&into_dir, &prose)?; }
            if !dup_marks.is_empty() {
                let into_note = into_dir.join(entry::note_file(&i.key));
                let cur = std::fs::read_to_string(&into_note).map_err(|e| format!("{}: {e}", into_note.display()))?;
                let merged = entry::merge_pdf_marks(&cur, &dup_marks);
                if merged != cur { kandinsky_plugin::write_file(&into_note, merged.as_bytes()).map_err(|e| e.to_string())?; }
            }
        }
    }

    let relinked_files = if opts.relink_vault { relink(&opts.dup, &opts.into) } else { 0 };
    let trashed = lib.trash.trash(&d.dir)?;
    lib.write_bib()?;
    Ok(MergeResult { paper: lib.paper_of(&into_dir, &i.key, &m), relinked_files, trashed })
}

fn replace_cite_braces(text: &str, from: &str, to: &str) -> String {
    let (mut out, mut rest) = (String::with_capacity(text.len()), text);
    while let Some(idx) = rest.find("\\cite") {
        out.push_str(&rest[..idx]);
        let after_cmd = &rest[idx + 5..];
        let cmd_len = after_cmd.bytes().take_while(|b| b.is_ascii_alphabetic() || *b == b'*').count();
        let after_name = &after_cmd[cmd_len..];
        let mut opt_off = 0;
        while let Some(cb) = after_name[opt_off..].strip_prefix('[').and_then(|s| s.find(']')) { opt_off += cb + 2; }
        if let Some((brace_body, end_brace)) = after_name[opt_off..].strip_prefix('{').and_then(|b| b.find('}').map(|e| (b, e))) {
            out.push_str(&rest[idx..idx + 5 + cmd_len + opt_off + 1]);
            let replaced: Vec<String> = brace_body[..end_brace].split(',').map(|k| {
                let (lead, trail) = (k.len() - k.trim_start().len(), k.len() - k.trim_end().len());
                if k.trim() == from { format!("{}{to}{}", &k[..lead], &k[k.len() - trail..]) } else { k.to_string() }
            }).collect();
            out.push_str(&replaced.join(","));
            out.push('}');
            rest = &brace_body[end_brace + 1..];
            continue;
        }
        out.push_str("\\cite");
        rest = after_cmd;
    }
    out.push_str(rest);
    out
}

pub fn relink_vault_citations(vault_root: &Path, from: &str, to: &str) -> usize {
    if from.is_empty() || to.is_empty() || from == to { return 0; }
    let (mut changed, mut stack) = (0usize, vec![vault_root.to_path_buf()]);
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for e in entries.flatten() {
            let p = e.path();
            let Some(name) = p.file_name().and_then(|n| n.to_str()) else { continue };
            if name.starts_with('.') || matches!(name, "node_modules" | "target") { continue; }
            if e.file_type().is_ok_and(|t| t.is_dir()) { stack.push(p); continue; }
            if !p.extension().is_some_and(|x| x.eq_ignore_ascii_case("md") || x.eq_ignore_ascii_case("tex")) { continue; }
            let Ok(old) = std::fs::read_to_string(&p) else { continue };
            let mut next = replace_cite_braces(&old, from, to);
            if p.extension().is_some_and(|x| x.eq_ignore_ascii_case("md")) {
                for (pat, rep) in [(format!("[[{from}]]"), format!("[[{to}]]")), (format!("[[{from}|"), format!("[[{to}|")), (format!("[[{from}#"), format!("[[{to}#")), (format!("[@{from}]"), format!("[@{to}]")), (format!("@{from};"), format!("@{to};"))] {
                    if next.contains(&pat) { next = next.replace(&pat, &rep); }
                }
            }
            if next != old && kandinsky_plugin::write_file(&p, next.as_bytes()).is_ok() { changed += 1; }
        }
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::net::fake::{Answer, Table};
    use crate::refs::tests::{TempTrash, Vault};
    use kandinsky_text::paths::real;

    #[test]
    fn organizes_inbox_collision_free_and_merges_duplicates_preserving_notes_marks_and_links() {
        let (mut v, ws) = (Vault::new(), tempfile::tempdir().unwrap());
        let ws_real = real(ws.path()).unwrap();
        let (vault_dir, pool_dir, sort_dir) = (ws_real.join("vault"), ws_real.join("Papers"), ws_real.join("Papers/Sort"));
        std::fs::create_dir_all(&vault_dir).unwrap();
        std::fs::create_dir_all(&sort_dir).unwrap();
        v.root = vault_dir;
        v.trash = TempTrash(v.root.clone());
        v.cfg.external_pdf_roots = vec!["../Papers".into()];
        v.cfg.watch_inbox = "../Papers/Sort".into();
        v.cfg.subfolder_presets = vec!["Quantum".into()];
        v.net = Table::default().on(
            "https://api.crossref.org/works/10.1126/science.177.4047.393",
            Answer::Json(json!({ "message": { "title": ["More Is Different"], "type": "journal-article", "author": [{ "family": "Anderson", "given": "P. W." }], "issued": { "date-parts": [[1972, 8, 4]] }, "container-title": ["Science"] } })),
        );

        std::fs::write(sort_dir.join("Quantum_lecture_notes.pdf"), b"%PDF-1.4 inbox-one").unwrap();
        let scan = scan_inbox(&v.lib()).unwrap();
        assert_eq!((scan.items.len(), scan.items[0].suggested_subfolder.as_str()), (1, "Quantum"));
        let org = organize_inbox(&v.lib(), &OrganizeInboxReq::default()).unwrap();
        assert_eq!(org.organized.len(), 1);
        assert!(!sort_dir.join("Quantum_lecture_notes.pdf").exists() && pool_dir.join("Quantum").read_dir().unwrap().count() == 1);

        let (pre, pubd) = (v.root.join("refs/papers/anderson1972pre"), v.root.join("refs/papers/anderson1972more"));
        std::fs::create_dir_all(&pre).unwrap();
        std::fs::create_dir_all(&pubd).unwrap();
        std::fs::write(pre.join("anderson1972pre.md"), "---\ntype: literature\ncitekey: anderson1972pre\nitemType: preprint\ntitle: More Is Different\nauthors:\n  - Anderson, P. W.\npublished: 1971\narchiveID: arXiv:2401.12345v1\nkeywords:\n  - symmetry\n---\n# More Is Different\n\n## Notes\n\nPreprint derivation notes.\n\n```pdf-marks\nm-11111111 highlight p1 {\"version\":1,\"color\":\"#ffd400\",\"quads\":[[10.0,20.0,30.0,40.0]],\"quote\":{\"exact\":\"symmetry\"}}\n```\n").unwrap();
        std::fs::write(pubd.join("anderson1972more.md"), "---\ntype: literature\ncitekey: anderson1972more\nitemType: journalArticle\ntitle: More Is Different\nauthors:\n  - Anderson, P. W.\npublished: 1972-08-04\nDOI: 10.1126/science.177.4047.393\npublicationTitle: Science\narchiveID: arXiv:2401.12345\n---\n# More Is Different\n\n## Notes\n\nPublished commentary.\n").unwrap();
        std::fs::write(v.root.join("chapter1.md"), "See [[anderson1972pre]] and \\cite{anderson1972pre, kitaev2006}.\n").unwrap();

        let dups = find_duplicates(&v.lib()).unwrap();
        assert_eq!((dups.len(), dups[0].primary.as_str()), (1, "anderson1972more"));
        assert!(dups[0].reasons.contains(&"arxiv".to_string()) && dups[0].reasons.contains(&"title_author_year".to_string()));

        let merged = merge_entries(&v.lib(), &MergeOpts { dup: "anderson1972pre".into(), into: "anderson1972more".into(), relink_vault: true, trash_duplicate_pdf: true }, &|f, t| relink_vault_citations(&v.root, f, t)).unwrap();
        assert_eq!((merged.relinked_files, merged.paper.tags.clone()), (1, vec!["symmetry".to_string()]));
        let ch1 = std::fs::read_to_string(v.root.join("chapter1.md")).unwrap();
        assert!(ch1.contains("[[anderson1972more]]") && ch1.contains("\\cite{anderson1972more, kitaev2006}"));
        let final_note = std::fs::read_to_string(pubd.join("anderson1972more.md")).unwrap();
        assert!(final_note.contains("aliases:\n  - anderson1972pre") && final_note.contains("Preprint derivation notes.") && final_note.contains("m-11111111 highlight p1"));
    }
}
