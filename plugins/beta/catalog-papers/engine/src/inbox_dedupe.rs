//! ZotMoov-style watched PDF inbox (`scan_inbox`, `organize_inbox`, `start_inbox_watcher`) and Zoplicate-style
//! 5-signal duplicate detection & lossless safe merge (`find_duplicates`, `merge_entries`, `relink_vault_citations`).
use crate::core_api::CoreApi;
use crate::entry;
use crate::external::{self, format_pdf_filename, resolve_dir_from, resolve_pdf_ref, sanitize_pdf_filename, write_external_pdf};
use crate::firstpage;
use crate::pdf_meta::{extract_pdf_doc, PdfDocMeta};
use crate::refs::{
    arxiv_of, build_local_entry_mapping_with_meta, bytes_sha_hex, citekey, classify_pdf,
    extract_pdf_identifiers_with_meta, isbn_core, list as ylist, lookup_pdf_remote_with_meta,
    merge_local_fallbacks_with_meta, norm_doi, now_stamp, parse_filename, s as ys, sha, year_of,
    ClassifyInput, ItemClass, Lib, Paper, ParsedFilename, PdfIds, Res,
};
use crate::remote;
use crate::scan_roots::{self, ScanRootsOpts};
use crate::settings::Settings;
use kandinsky_text::paths::{real, safe_join};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as Json};
use serde_yaml::{Mapping, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InboxItem {
    pub file: String, pub size: u64, pub doi: Option<String>, pub arxiv: Option<String>, pub arxiv_version: Option<String>,
    pub isbn: Option<String>, pub title: String, pub authors: Vec<String>, pub year: Option<String>,
    pub suggested_filename: String, pub suggested_subfolder: String, pub existing_key: Option<String>,
    /// Where organizing files it with the suggested name and subfolder, as `organize_inbox`'s preview gives it.
    pub target_path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InboxScan {
    pub configured: bool,
    pub inbox_dir: String,
    /// The shared folder PDFs are filed into; empty when none is set.
    pub external_root: String,
    /// No shared folder: PDFs go into the entry's own folder in the vault, and a subfolder is not used.
    pub files_into_vault: bool,
    pub rename_format: String,
    pub items: Vec<InboxItem>,
    pub subfolder_presets: Vec<String>,
}

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

fn list_inbox_pdfs(inbox_dir: &Path) -> Res<Vec<PathBuf>> {
    if !inbox_dir.exists() { return Ok(Vec::new()); }
    let mut files: Vec<PathBuf> = std::fs::read_dir(inbox_dir).map_err(|e| format!("{}: {e}", inbox_dir.display()))?.flatten().map(|e| e.path()).filter(|p| p.is_file() && p.extension().is_some_and(|x| x.eq_ignore_ascii_case("pdf"))).collect();
    files.sort();
    Ok(files)
}

struct InspectedPdf {
    digest: [u8; 32],
    text: String,
    pages: usize,
    doc_meta: PdfDocMeta,
    parsed: ParsedFilename,
    ids: PdfIds,
    class: ItemClass,
    first: Option<firstpage::FirstPage>,
    existing_key: Option<String>,
}

fn inspect_pdf(lib: &Lib, existing: &[Paper], fname: &str, bytes: &[u8]) -> InspectedPdf {
    let digest = sha(bytes);
    let hex = bytes_sha_hex(&digest);
    let extract = extract_pdf_doc(bytes);
    let (text, pages, doc_meta) = (extract.text, extract.pages, extract.meta);
    let parsed = parse_filename(fname);
    let ids = extract_pdf_identifiers_with_meta(&text, pages, fname, Some(&doc_meta));
    let first = firstpage::read_pages(&text, fname);
    let class = classify_pdf(&ClassifyInput {
        text: &text,
        pages,
        filename: fname,
        rel_dir: None,
        parsed: &parsed,
        isbn: ids.isbn.as_deref(),
        doi: ids.doi.as_deref(),
        arxiv: ids.arxiv.as_deref(),
        remote_type: None,
        explicit_kind: None,
    });
    let existing_key = existing.iter().find(|p| {
        ids.doi.as_deref().zip(p.doi.as_deref()).is_some_and(|(a, b)| norm_doi(a) == norm_doi(b))
            || ids.arxiv.as_deref().zip(p.arxiv.as_deref()).is_some_and(|(a, b)| a.eq_ignore_ascii_case(b))
            || ids.isbn.as_deref().and_then(isbn_core).is_some_and(|ic| safe_join(lib.root, &p.dir).ok().and_then(|d| entry::read(&d)).and_then(|m| ys(&m, "ISBN").or_else(|| ys(&m, "isbn"))).and_then(|s| isbn_core(&s)).as_deref() == Some(ic.as_str()))
            || safe_join(lib.root, &p.dir).ok().and_then(|d| entry::read(&d)).and_then(|m| ys(&m, "pdfSha256")).is_some_and(|h| h.eq_ignore_ascii_case(&hex))
            || p.pdf.as_deref().and_then(|f| lib.pdf_abs_path(f)).is_some_and(|abs| abs.metadata().is_ok_and(|md| md.len() == bytes.len() as u64) && std::fs::read(&abs).is_ok_and(|b| sha(&b) == digest))
    }).map(|p| p.key.clone());
    InspectedPdf { digest, text, pages, doc_meta, parsed, ids, class, first, existing_key }
}

/// Where a PDF named `name` is filed for entry `key`: the shared folder (and `sub`) when one is set, else the entry's folder.
fn filed_path(cfg: &Settings, key: &str, sub: &str, name: &str) -> String {
    match cfg.external_pdf_roots.first() {
        Some(root) => {
            let (pfx, sub) = (root.trim_end_matches('/'), sub.trim().trim_matches('/'));
            if sub.is_empty() { format!("{pfx}/{name}") } else { format!("{pfx}/{sub}/{name}") }
        }
        None => format!("{}/{key}/{name}", cfg.dir),
    }
}

pub fn scan_inbox(lib: &Lib) -> Res<InboxScan> {
    let external_root = lib.cfg.external_pdf_roots.first().cloned().unwrap_or_default();
    let files_into_vault = lib.cfg.external_pdf_roots.is_empty();
    let rename_format = lib.cfg.rename_format.clone();
    let subfolder_presets = lib.cfg.subfolder_presets.clone();
    let watch_inbox = lib.cfg.watch_inbox.trim();
    if watch_inbox.is_empty() {
        return Ok(InboxScan {
            configured: false,
            inbox_dir: String::new(),
            external_root,
            files_into_vault,
            rename_format,
            items: Vec::new(),
            subfolder_presets,
        });
    }
    let inbox_dir = resolve_inbox_dir(lib.root, lib.cfg)?;
    let existing = lib.list().unwrap_or_default();
    let mut items = Vec::new();
    for path in list_inbox_pdfs(&inbox_dir)? {
        let fname = path.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
        let bytes = std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        let info = inspect_pdf(lib, &existing, &fname, &bytes);
        let m = if let Some(ek) = &info.existing_key {
            safe_join(lib.root, &format!("{}/{ek}", lib.cfg.dir)).ok().and_then(|d| entry::read(&d)).unwrap_or_default()
        } else {
            build_local_entry_mapping_with_meta(
                &info.parsed,
                info.first.as_ref(),
                Some(&info.doc_meta),
                &info.ids,
                info.pages,
                info.class,
            )
            .0
        };
        let (title, authors, year) = (ys(&m, "title").unwrap_or_else(|| fname.clone()), ylist(&m, "author"), ys(&m, "date").and_then(|d| year_of(&d)));
        let key_hint = info.existing_key.clone().unwrap_or_else(|| citekey(&authors, year.as_deref(), &title, &|_| false));
        let suggested_filename = format_pdf_filename(&lib.cfg.rename_format, &m, &key_hint);
        let suggested_subfolder = suggest_subfolder(&lib.cfg.subfolder_presets, &format!("{title} {}", info.text.chars().take(600).collect::<String>()));
        let target_path = filed_path(lib.cfg, &key_hint, &suggested_subfolder, &suggested_filename);
        items.push(InboxItem {
            file: fname, size: bytes.len() as u64, doi: info.ids.doi, arxiv: info.ids.arxiv, arxiv_version: info.ids.arxiv_version,
            isbn: info.ids.isbn, title, authors, year, suggested_filename, suggested_subfolder, existing_key: info.existing_key, target_path,
        });
    }
    Ok(InboxScan {
        configured: true,
        inbox_dir: watch_inbox.to_string(),
        external_root,
        files_into_vault,
        rename_format,
        items,
        subfolder_presets,
    })
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
            let mut m = if let Some((mut rm, _)) = lookup_pdf_remote_with_meta(
                lib.net,
                &lib.cfg.email,
                info.class,
                &info.ids,
                &info.parsed,
                info.first.as_ref(),
                Some(&info.doc_meta),
            ) {
                merge_local_fallbacks_with_meta(
                    &mut rm,
                    &info.parsed,
                    info.first.as_ref(),
                    Some(&info.doc_meta),
                    &info.ids,
                    info.pages,
                    info.class,
                );
                rm
            } else {
                build_local_entry_mapping_with_meta(
                    &info.parsed,
                    info.first.as_ref(),
                    Some(&info.doc_meta),
                    &info.ids,
                    info.pages,
                    info.class,
                )
                .0
            };
            if let Some(ep) = lib.find_existing_by_ids(
                ys(&m, "DOI").as_deref(),
                arxiv_of(&m).as_deref(),
                ys(&m, "ISBN").or_else(|| ys(&m, "isbn")).as_deref(),
            ) {
                let em = entry::read(&refs_base.join(&ep.key)).unwrap_or_default();
                (ep.key, em, false)
            } else {
                let (title, year) = (ys(&m, "title").unwrap_or_else(|| fname.clone()), ys(&m, "date").and_then(|d| year_of(&d)));
                let k = lib.next_citekey(&ylist(&m, "author"), year.as_deref(), &title)?;
                m.insert("citekey".into(), k.clone().into());
                m.insert("dateAdded".into(), now_stamp().into());
                (k, m, true)
            }
        };

        let sub = item_opt.and_then(|o| o.subfolder.clone()).or_else(|| req.subfolder.clone()).unwrap_or_else(|| suggest_subfolder(&lib.cfg.subfolder_presets, &ys(&m, "title").unwrap_or_default()));
        let target_name = item_opt.and_then(|o| o.filename.as_deref()).map(|n| sanitize_pdf_filename(n, &key)).unwrap_or_else(|| format_pdf_filename(&lib.cfg.rename_format, &m, &key));
        if req.dry_run {
            let preview_ref = filed_path(lib.cfg, &key, &sub, &target_name);
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
        m.insert("pdfSha256".into(), bytes_sha_hex(&info.digest).into());
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

/// Background handle for the `watch_inbox` poller; wakes and exits cleanly when dropped or stopped.
pub struct InboxWatcher {
    stop: Arc<(Mutex<bool>, Condvar)>,
}

impl InboxWatcher {
    pub fn start(plugin: String, root: PathBuf) -> Self {
        let stop = Arc::new((Mutex::new(false), Condvar::new()));
        spawn_inbox_watcher(plugin, root, stop.clone());
        Self { stop }
    }

    pub fn stop(&self) {
        let (lock, cv) = &*self.stop;
        *lock.lock().unwrap_or_else(|e| e.into_inner()) = true;
        cv.notify_all();
    }
}

impl Drop for InboxWatcher {
    fn drop(&mut self) {
        self.stop();
    }
}

fn wait_or_stop(stop: &(Mutex<bool>, Condvar), dur: Duration) -> bool {
    let (lock, cv) = stop;
    let mut stopped = lock.lock().unwrap_or_else(|e| e.into_inner());
    let deadline = Instant::now() + dur;
    while !*stopped {
        let rem = deadline.saturating_duration_since(Instant::now());
        if rem.is_zero() {
            return false;
        }
        let (guard, _) = cv.wait_timeout(stopped, rem).unwrap_or_else(|e| e.into_inner());
        stopped = guard;
    }
    true
}

pub fn collect_external_pdf_snapshot(root: &Path, cfg: &Settings, now: std::time::SystemTime) -> Vec<(String, u64, u64)> {
    let roots = external::external_roots(root, cfg);
    if roots.is_empty() {
        return Vec::new();
    }
    let inbox_real = resolve_inbox_dir(root, cfg).ok().map(|p| real(&p).unwrap_or(p));
    let mut out = Vec::new();
    let mut visited = HashSet::new();
    for ext in &roots {
        if !ext.root.is_dir() {
            continue;
        }
        let ext_real = real(&ext.root).unwrap_or_else(|_| ext.root.clone());
        let mut stack: Vec<(PathBuf, Option<String>)> = vec![(ext_real.clone(), None)];
        while let Some((dir, rel_dir)) = stack.pop() {
            let Ok(dir_real) = real(&dir) else { continue };
            if !dir_real.starts_with(&ext_real) || inbox_real.as_deref().is_some_and(|ib| dir_real == ib || dir_real.starts_with(ib)) {
                continue;
            }
            if !visited.insert(dir_real) {
                continue;
            }
            let Ok(rd) = std::fs::read_dir(&dir) else { continue };
            for e in rd.flatten() {
                let name = e.file_name().to_string_lossy().into_owned();
                if name.starts_with('.') {
                    continue;
                }
                let Ok(resolved) = real(&e.path()) else { continue };
                if !resolved.starts_with(&ext_real) {
                    continue;
                }
                if resolved.is_dir() {
                    if name.eq_ignore_ascii_case("output") {
                        continue;
                    }
                    let next_rel = match &rel_dir {
                        Some(d) => format!("{d}/{name}"),
                        None => name,
                    };
                    stack.push((resolved, Some(next_rel)));
                } else if resolved.is_file() && name.len() > 4 && name.as_bytes()[name.len() - 4..].eq_ignore_ascii_case(b".pdf") {
                    let Ok(md) = resolved.metadata() else { continue };
                    let Ok(mtime) = md.modified() else { continue };
                    if now.duration_since(mtime).ok().is_some_and(|d| d < Duration::from_secs(2)) {
                        continue; // ignore newly written unstable files (< 2s)
                    }
                    let mtime_secs = mtime.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
                    let rel_file = match &rel_dir {
                        Some(d) => format!("{d}/{name}"),
                        None => name,
                    };
                    out.push((format!("{}/{rel_file}", ext.prefix), md.len(), mtime_secs));
                }
            }
        }
    }
    out.sort();
    out
}

fn spawn_inbox_watcher(plugin: String, root: PathBuf, stop: Arc<(Mutex<bool>, Condvar)>) {
    std::thread::spawn(move || {
        let core = CoreApi::new(plugin, root.clone());
        let mut last: Option<Vec<String>> = None;
        let mut last_ext: Option<Vec<(String, u64, u64)>> = None;
        let mut last_ext_poll = Instant::now() - Duration::from_secs(10);
        while !wait_or_stop(&stop, Duration::from_secs(5)) {
            let cfg = match core.kandinsky.get("/api/plugins") {
                Ok(all) => {
                    let mine = all.as_array().into_iter().flatten().find(|p| p["id"].as_str() == Some(core.plugin.as_str()));
                    Settings::from_value(mine.map_or(&Json::Null, |p| &p["settings"]))
                }
                Err(e) if e.status.is_none() => break,
                Err(_) => continue,
            };
            if cfg.watch_inbox.trim().is_empty() {
                last = None;
            } else if let Ok(paths) = resolve_inbox_dir(&root, &cfg).and_then(|d| list_inbox_pdfs(&d)) {
                let names: Vec<String> = paths.iter().filter_map(|p| p.file_name().and_then(|n| n.to_str()).map(String::from)).collect();
                if last.as_ref() != Some(&names) {
                    if !(last.is_none() && names.is_empty()) {
                        kandinsky_plugin::event("papers:inbox", json!({ "count": names.len(), "files": names }));
                    }
                    last = Some(names);
                }
            }

            if cfg.external_pdf_roots.is_empty() {
                last_ext = None;
            } else if last_ext_poll.elapsed() >= Duration::from_secs(10) {
                last_ext_poll = Instant::now();
                let snap = collect_external_pdf_snapshot(&root, &cfg, std::time::SystemTime::now());
                let changed_or_new = last_ext
                    .as_ref()
                    .is_some_and(|prev| snap != *prev && snap.iter().any(|item| !prev.contains(item)));
                if changed_or_new {
                    let lib = Lib { root: &root, cfg: &cfg, net: &core, made: &core, trash: &core };
                    if let Ok(report) = scan_roots::scan_external_roots(
                        &lib,
                        &ScanRootsOpts { dry_run: false, root: None, rate_limit_ms: Some(250), max_lookups: None },
                    ) {
                        if report.created > 0 || report.updated > 0 || report.moved > 0 {
                            kandinsky_plugin::event(
                                "papers:external-sync",
                                json!({
                                    "created": report.created,
                                    "updated": report.updated,
                                    "moved": report.moved,
                                    "enriched": report.enriched,
                                    "total_pdfs": report.total_pdfs,
                                }),
                            );
                            let mut changed_paths: Vec<String> = report
                                .items
                                .iter()
                                .filter(|it| matches!(it.action.as_str(), "create" | "update" | "move") && !it.citekey.is_empty())
                                .map(|it| format!("{}/{}/{}", cfg.dir, it.citekey, entry::note_file(&it.citekey)))
                                .collect();
                            changed_paths.push(cfg.bib.clone());
                            core.changed(changed_paths);
                        }
                        let errored_refs: HashSet<&str> = report
                            .items
                            .iter()
                            .filter(|it| it.error.is_some())
                            .map(|it| it.pdf_ref.as_str())
                            .collect();
                        let committed: Vec<(String, u64, u64)> = snap
                            .into_iter()
                            .filter(|(pref, _, _)| !errored_refs.contains(pref.as_str()))
                            .collect();
                        last_ext = Some(committed);
                    }
                } else {
                    last_ext = Some(snap);
                }
            }
        }
    });
}

pub fn start_inbox_watcher(plugin: String, root: PathBuf) {
    let stop = Arc::new((Mutex::new(false), Condvar::new()));
    spawn_inbox_watcher(plugin, root, stop);
}

fn norm_ascii_word(s: &str) -> String {
    crate::pdf_meta::fold_diacritics(s)
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect()
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
    let existing_refs: Vec<String> = ylist(&m, "files").into_iter().chain(ylist(&m, "pdf")).chain(ylist(&m, "external_pdf")).collect();
    for f in ylist(&from, "files").into_iter().chain(ylist(&from, "pdf")).chain(ylist(&from, "external_pdf")) {
        if existing_refs.contains(&f) || files.contains(&f) || (into_had_pdf && opts.trash_duplicate_pdf) { continue; }
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
        assert!(scan.configured);
        assert_eq!((scan.external_root.as_str(), scan.files_into_vault, scan.items.len(), scan.items[0].suggested_subfolder.as_str()), ("../Papers", false, 1, "Quantum"));
        assert!(scan.items[0].target_path.starts_with("../Papers/Quantum/"), "{}", scan.items[0].target_path);
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

    #[test]
    fn scan_inbox_returns_unconfigured_state_when_watch_inbox_is_empty() {
        let mut v = Vault::new();
        let def_scan = scan_inbox(&v.lib()).unwrap();
        assert!(!def_scan.configured);
        assert!(def_scan.inbox_dir.is_empty());
        assert!(def_scan.items.is_empty());
        assert_eq!((def_scan.external_root.as_str(), def_scan.files_into_vault), ("", true));
        assert_eq!(def_scan.rename_format, "{Author}{Year} - {Title}.pdf");

        v.cfg.watch_inbox = "   ".into();
        v.cfg.external_pdf_roots = vec!["../Library/Papers".into()];
        v.cfg.rename_format = "{Citekey}.pdf".into();
        v.cfg.subfolder_presets = vec!["Condensed".into()];
        let custom_scan = scan_inbox(&v.lib()).unwrap();
        assert!(!custom_scan.configured);
        assert!(custom_scan.inbox_dir.is_empty());
        assert!(custom_scan.items.is_empty());
        assert_eq!((custom_scan.external_root.as_str(), custom_scan.files_into_vault), ("../Library/Papers", false));
        assert_eq!(custom_scan.rename_format, "{Citekey}.pdf");
        assert_eq!(custom_scan.subfolder_presets, vec!["Condensed".to_string()]);
    }

    #[test]
    fn scan_inbox_without_a_shared_folder_previews_the_entry_folder() {
        let (mut v, ws) = (Vault::new(), tempfile::tempdir().unwrap());
        let ws_real = real(ws.path()).unwrap();
        let (vault_dir, sort_dir) = (ws_real.join("vault"), ws_real.join("Sort"));
        std::fs::create_dir_all(&vault_dir).unwrap();
        std::fs::create_dir_all(&sort_dir).unwrap();
        v.root = vault_dir;
        v.trash = TempTrash(v.root.clone());
        v.cfg.watch_inbox = "../Sort".into();
        v.cfg.subfolder_presets = vec!["Quantum".into()];
        std::fs::write(sort_dir.join("Quantum_lecture_notes.pdf"), b"%PDF-1.4 inbox-one").unwrap();

        let scan = scan_inbox(&v.lib()).unwrap();
        assert_eq!((scan.external_root.as_str(), scan.files_into_vault, scan.items.len()), ("", true, 1));
        let target = scan.items[0].target_path.clone();
        assert!(target.starts_with("refs/papers/") && !target.contains("Quantum/"), "{target}");
        let dry = organize_inbox(&v.lib(), &OrganizeInboxReq { dry_run: true, ..Default::default() }).unwrap();
        assert_eq!(dry.organized[0].pdf_ref, target);
    }

    #[test]
    fn norm_ascii_word_folds_diacritics_and_external_snapshot_skips_unstable_and_ignored_dirs() {
        assert_eq!(norm_ascii_word("Cvetković"), "cvetkovic");
        assert_eq!(norm_ascii_word("Łukasiewicz"), "lukasiewicz");
        assert_eq!(norm_ascii_word("Sørensen"), "sorensen");

        let ws = tempfile::tempdir().unwrap();
        let ws_real = real(ws.path()).unwrap();
        let (vault, pool, inbox, out_dir, dot_dir) = (
            ws_real.join("vault"),
            ws_real.join("Papers"),
            ws_real.join("Papers/Sort"),
            ws_real.join("Papers/output"),
            ws_real.join("Papers/.hidden"),
        );
        std::fs::create_dir_all(&vault).unwrap();
        std::fs::create_dir_all(&inbox).unwrap();
        std::fs::create_dir_all(&out_dir).unwrap();
        std::fs::create_dir_all(&dot_dir).unwrap();
        std::fs::write(pool.join("stable.pdf"), b"%PDF-1.4 stable").unwrap();
        std::fs::write(inbox.join("in.pdf"), b"%PDF-1.4 inbox").unwrap();
        std::fs::write(out_dir.join("out.pdf"), b"%PDF-1.4 out").unwrap();
        std::fs::write(dot_dir.join("dot.pdf"), b"%PDF-1.4 dot").unwrap();

        let cfg = Settings {
            external_pdf_roots: vec!["../Papers".into()],
            watch_inbox: "../Papers/Sort".into(),
            ..Settings::default()
        };
        // Immediately (mtime < 2s ago): ignored as unstable; 5s later: included!
        let now = std::time::SystemTime::now();
        assert!(collect_external_pdf_snapshot(&vault, &cfg, now).is_empty());
        let snap = collect_external_pdf_snapshot(&vault, &cfg, now + Duration::from_secs(5));
        assert_eq!(snap.len(), 1);
        assert_eq!(snap[0].0, "../Papers/stable.pdf");
    }

    #[test]
    fn scan_and_organize_inbox_extract_pdf_info_xmp_and_title_author_filenames() {
        let (mut v, ws) = (Vault::new(), tempfile::tempdir().unwrap());
        let ws_real = real(ws.path()).unwrap();
        let (vault_dir, pool_dir, sort_dir) = (ws_real.join("vault"), ws_real.join("Papers"), ws_real.join("Papers/Sort"));
        std::fs::create_dir_all(&vault_dir).unwrap();
        std::fs::create_dir_all(&sort_dir).unwrap();
        v.root = vault_dir;
        v.trash = TempTrash(v.root.clone());
        v.cfg.external_pdf_roots = vec!["../Papers".into()];
        v.cfg.watch_inbox = "../Papers/Sort".into();

        let xmp = r#"<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:prism="http://prismstandard.org/namespaces/basic/2.0/"><rdf:Description rdf:about=""><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Topological Phases in Driven Matter</rdf:li></rdf:Alt></dc:title><dc:creator><rdf:Seq><rdf:li>Milica Cvetković</rdf:li></rdf:Seq></dc:creator><prism:coverDate>2022-04-10</prism:coverDate><prism:doi>10.1000/inbox.xmp</prism:doi></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>"#;
        let xmp_pdf = crate::refs::tests::pdf_with_info_and_xmp("FEFF0055006E007400690074006C00650064", "", xmp, "Body without header");
        std::fs::write(sort_dir.join("raw_scan.pdf"), &xmp_pdf).unwrap();
        std::fs::write(sort_dir.join("Quantum Field Theory - Mark Srednicki (2007).pdf"), b"%PDF-1.4 qft").unwrap();

        let scan = scan_inbox(&v.lib()).unwrap();
        assert_eq!(scan.items.len(), 2);
        let qft = scan.items.iter().find(|i| i.file.starts_with("Quantum Field Theory")).unwrap();
        assert_eq!(qft.title, "Quantum Field Theory");
        assert_eq!(qft.authors, vec!["Srednicki, Mark"]);
        assert_eq!(qft.year.as_deref(), Some("2007"));
        assert_eq!(qft.suggested_filename, "Srednicki2007 - Quantum Field Theory.pdf");

        let raw = scan.items.iter().find(|i| i.file == "raw_scan.pdf").unwrap();
        assert_eq!(raw.title, "Topological Phases in Driven Matter");
        assert_eq!(raw.authors, vec!["Cvetković, Milica"]);
        assert_eq!(raw.year.as_deref(), Some("2022"));
        assert_eq!(raw.doi.as_deref(), Some("10.1000/inbox.xmp"));

        let org = organize_inbox(&v.lib(), &OrganizeInboxReq::default()).unwrap();
        assert_eq!(org.organized.len(), 2);
        assert!(pool_dir.join("Srednicki2007 - Quantum Field Theory.pdf").is_file());
        assert!(pool_dir.join("Cvetković2022 - Topological Phases in Driven Matter.pdf").is_file());
    }
}
