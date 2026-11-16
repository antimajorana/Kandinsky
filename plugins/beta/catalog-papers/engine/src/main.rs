//! The catalog-papers helper (`papers`): the references library served over the helper pipe
//! (docs/guides/PLUGIN-API.md, "Calling Kandinsky back"), the core reached back through the same pipe (core_api.rs).
use kandinsky_papers::catalog;
use kandinsky_papers::connector::{self, Connector, Listener};
use kandinsky_papers::core_api::{ConnectorHost, CoreApi};
use kandinsky_papers::enrich;
use kandinsky_papers::inbox_dedupe::{self, MergeOpts, OrganizeInboxReq};
use kandinsky_papers::refs::{ImportOpts, Lib, PaperEdit, Res};
use kandinsky_papers::scan_roots::{self, ScanRootsOpts};
use kandinsky_papers::settings::Settings;
use kandinsky_papers::zotero_import::{self, ZoteroImportOpts};
use kandinsky_plugin::{serve, Methods};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::rc::Rc;

type Answer = kandinsky_plugin::Result<Value>;

fn fail(why: impl Into<String>) -> kandinsky_plugin::Error {
    kandinsky_plugin::Error { status: None, why: why.into() }
}

fn answer<T: serde::Serialize>(r: Res<T>) -> Answer {
    r.and_then(|v| serde_json::to_value(v).map_err(|e| format!("the answer could not be written as JSON: {e}"))).map_err(fail)
}

fn text(p: &Value, key: &str) -> kandinsky_plugin::Result<String> {
    p[key].as_str().map(str::to_string).ok_or_else(|| fail(format!("{key:?} is needed")))
}

fn parse<T: DeserializeOwned>(p: &Value) -> kandinsky_plugin::Result<T> {
    serde_json::from_value(p.clone()).map_err(|e| fail(format!("params: {e}")))
}

/// The vault: `KANDINSKY_ROOT` (set by the core), canonical without Windows `\\?\` prefix so every path check holds.
fn vault() -> PathBuf {
    let root = std::env::var_os("KANDINSKY_ROOT").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
    kandinsky_text::paths::real(&root).unwrap_or(root)
}

/// One method: the library with this call's settings.
fn with_lib<T: serde::Serialize>(core: &CoreApi, p: &Value, f: impl FnOnce(&Lib) -> Res<T>) -> Answer {
    let cfg = core.settings(p);
    answer(f(&Lib { root: &core.root, cfg: &cfg, net: core, made: core, trash: core }))
}

/// The Connector's listener as the settings want it: started when on (and not running), stopped when off.
fn sync_connector(slot: &RefCell<Option<Listener>>, cfg: &Settings, plugin: &str, root: &Path) -> Value {
    let mut l = slot.borrow_mut();
    match (cfg.connector, l.is_some()) {
        (true, false) => {
            let host = ConnectorHost(CoreApi::new(plugin.to_string(), root.to_path_buf()));
            *l = Some(Listener::start(Connector::new(host, root.to_path_buf()), connector::port()));
        }
        (false, true) => *l = None, // dropped: stopped
        _ => {}
    }
    json!({ "on": cfg.connector, "port": l.as_ref().map(|l| l.port), "listening": l.as_ref().is_some_and(|l| l.listening()) })
}

fn ensure_inbox_watcher(started: &RefCell<bool>, cfg: &Settings, plugin: &str, root: &Path) {
    if !*started.borrow() && !cfg.watch_inbox.trim().is_empty() {
        *started.borrow_mut() = true;
        inbox_dedupe::start_inbox_watcher(plugin.to_string(), root.to_path_buf());
    }
}

fn main() {
    let plugin = std::env::var("KANDINSKY_PLUGIN_ID").ok().filter(|p| !p.is_empty()).unwrap_or_else(|| "catalog-papers".into());
    let root = vault();
    let core = Rc::new(CoreApi::new(plugin.clone(), root.clone()));
    let listener = Rc::new(RefCell::new(None));
    let inbox_watching = Rc::new(RefCell::new(false));
    let initial_cfg = core.settings(&Value::Null);
    sync_connector(&listener, &initial_cfg, &plugin, &root);
    ensure_inbox_watcher(&inbox_watching, &initial_cfg, &plugin, &root);

    let mut m = Methods::new();
    let c = core.clone();
    m.add("list", move |p| with_lib(&c, &p, |lib| lib.list()));
    let c = core.clone();
    m.add("add", move |p| {
        let id = p["id"].as_str().or_else(|| p["input"].as_str()).map(str::to_string).ok_or_else(|| fail("\"id\" is needed"))?;
        with_lib(&c, &p, |lib| lib.add(&id))
    });
    // a PDF the page uploaded into the vault (best: this plugin's cache, which is emptied after) filed as an entry
    let c = core.clone();
    m.add("import", move |p| {
        let path = text(&p, "path")?;
        let name = p["name"].as_str().map(String::from).unwrap_or_else(|| path.rsplit(['/', '\\']).next().unwrap_or(&path).to_string());
        let opts: ImportOpts = parse(&p)?;
        let file = kandinsky_text::paths::safe_join(&c.root, &kandinsky_plugin::live_rel(&c.root, &path)).map_err(fail)?;
        let bytes = std::fs::read(&file).map_err(|e| fail(format!("{path}: {e}")))?;
        let r = with_lib(&c, &p, |lib| lib.import_pdf_with(&name, &bytes, &opts));
        if r.is_ok() && kandinsky_plugin::current_rel(&path).starts_with(&format!(".kandinsky/cache/plugins/{}/", c.plugin)) {
            let _ = std::fs::remove_file(&file); // filed: the upload is not kept twice
        }
        r
    });
    let c = core.clone();
    m.add("attach", move |p| {
        let (key, file, from) = (text(&p, "key")?, text(&p, "file")?, text(&p, "from")?);
        with_lib(&c, &p, |lib| lib.attach_pdf(&key, &file, &from))
    });
    let c = core.clone();
    m.add("edit", move |p| {
        let e: PaperEdit = parse(&p)?;
        with_lib(&c, &p, |lib| lib.edit(&e))
    });
    let c = core.clone();
    m.add("merge", move |p| {
        let opts: MergeOpts = parse(&p)?;
        with_lib(&c, &p, |lib| {
            inbox_dedupe::merge_entries(lib, &opts, &|from, to| inbox_dedupe::relink_vault_citations(&c.root, from, to))
        })
    });
    let c = core.clone();
    m.add("type", move |p| {
        let (key, kind) = (text(&p, "key")?, text(&p, "kind")?);
        with_lib(&c, &p, |lib| lib.set_type(&key, &kind))
    });
    let c = core.clone();
    m.add("delete", move |p| {
        let key = text(&p, "key")?;
        with_lib(&c, &p, |lib| lib.delete(&key).map(|to| json!({ "path": key, "to": to })))
    });
    let c = core.clone();
    m.add("bibtex", move |p| {
        let key = p["key"].as_str().map(str::trim).unwrap_or("").to_string();
        with_lib(&c, &p, |lib| if key.is_empty() { lib.bibtex_all() } else { lib.bibtex(&key) })
    });
    let c = core.clone();
    m.add("bib", move |p| with_lib(&c, &p, |lib| lib.write_bib().map(|n| json!({ "entries": n }))));
    let c = core.clone();
    m.add("citekey", move |p| {
        let title = text(&p, "title")?;
        let authors: Vec<String> = match &p["authors"] {
            Value::Array(a) => a.iter().filter_map(Value::as_str).map(String::from).collect(),
            Value::String(s) => s.split("; ").map(str::trim).filter(|a| !a.is_empty()).map(String::from).collect(),
            _ => vec![],
        };
        let year = p["year"].as_str().map(String::from).or_else(|| p["year"].as_u64().map(|y| y.to_string()));
        with_lib(&c, &p, |lib| lib.next_citekey(&authors, year.as_deref(), &title).map(|key| json!({ "key": key })))
    });
    let c = core.clone();
    m.add("note", move |p| {
        let key = text(&p, "key")?;
        with_lib(&c, &p, |lib| lib.note(&key).map(|path| json!({ "path": path })))
    });
    let c = core.clone();
    m.add("notes", move |p| with_lib(&c, &p, |lib| lib.notes().map(|made| json!({ "made": made }))));
    let c = core.clone();
    m.add("fold", move |p| {
        let apply = p["apply"].as_bool().unwrap_or(false);
        with_lib(&c, &p, |lib| lib.fold_all(apply))
    });

    // Zotero read-only importer, watched inbox, Zoplicate deduplication, remote search, preprint upgrade & arXiv source
    m.add("discover_zotero", move |p| {
        answer(Ok(zotero_import::discover_zotero(
            p["data_dir"].as_str(),
            p["prefs_path"].as_str(),
            p["base_attachment_path"].as_str(),
        )))
    });
    let c = core.clone();
    m.add("import_zotero", move |p| {
        let opts: ZoteroImportOpts = parse(&p)?;
        with_lib(&c, &p, |lib| zotero_import::import_zotero(lib, &opts))
    });
    let (c, iw) = (core.clone(), inbox_watching.clone());
    m.add("scan_inbox", move |p| {
        ensure_inbox_watcher(&iw, &c.settings(&p), &c.plugin, &c.root);
        with_lib(&c, &p, inbox_dedupe::scan_inbox)
    });
    let (c, iw) = (core.clone(), inbox_watching.clone());
    m.add("organize_inbox", move |p| {
        ensure_inbox_watcher(&iw, &c.settings(&p), &c.plugin, &c.root);
        let req: OrganizeInboxReq = parse(&p)?;
        with_lib(&c, &p, |lib| inbox_dedupe::organize_inbox(lib, &req))
    });
    let c = core.clone();
    m.add("find_duplicates", move |p| with_lib(&c, &p, inbox_dedupe::find_duplicates));
    let c = core.clone();
    m.add("scan_external_roots", move |p| {
        let opts: ScanRootsOpts = if p.is_null() { ScanRootsOpts::default() } else { parse(&p)? };
        with_lib(&c, &p, |lib| scan_roots::scan_external_roots(lib, &opts))
    });
    let c = core.clone();
    m.add("search_remote", move |p| {
        let query = text(&p, "query")?;
        let source = p["source"].as_str().unwrap_or("inspire");
        let cfg = c.settings(&p);
        answer(enrich::search_remote(&*c, &query, source, &cfg.email))
    });
    let c = core.clone();
    m.add("upgrade_preprint", move |p| {
        let key = text(&p, "key")?;
        let dry_run = p["dry_run"].as_bool().unwrap_or(false);
        with_lib(&c, &p, |lib| enrich::upgrade_preprint(lib, &key, dry_run))
    });
    let c = core.clone();
    m.add("fetch_arxiv_source", move |p| {
        let target = p["id"]
            .as_str()
            .or_else(|| p["key"].as_str())
            .or_else(|| p["id_or_key"].as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| fail("\"id\" or \"key\" is needed"))?
            .to_string();
        with_lib(&c, &p, |lib| enrich::fetch_arxiv_source(lib, &c.plugin, &target))
    });

    // Agent MCP tools (plugin.toml [[tool]] search_papers, paper_annotations, lookup, add -> catalog_add)
    let c = core.clone();
    m.add("search_papers", move |p| {
        let query = p["query"].as_str();
        let collection = p["collection"].as_str();
        let tag = p["tag"].as_str();
        let item_type = p["item_type"].as_str().or_else(|| p["itemType"].as_str());
        let limit = p["limit"].as_u64().map(|n| n as usize);
        with_lib(&c, &p, |lib| lib.search(query, collection, tag, item_type, limit))
    });
    let c = core.clone();
    m.add("paper_annotations", move |p| {
        let key = p["key"].as_str().or_else(|| p["citekey"].as_str()).ok_or_else(|| fail("\"key\" is needed"))?.to_string();
        with_lib(&c, &p, |lib| lib.annotations(&key))
    });
    let c = core.clone();
    m.add("lookup", move |p| {
        let cfg = c.settings(&p);
        let lib = Lib { root: &c.root, cfg: &cfg, net: &*c, made: &*c, trash: &*c };
        let key_of = |title: &str, year: Option<String>, authors: &[String]| lib.next_citekey(authors, year.as_deref(), title).ok();
        Ok(catalog::lookup(&*c, &p, &cfg.email, &key_of))
    });
    let c = core.clone();
    m.add("catalog_add", move |p| {
        let sources = || c.contributions();
        let ask = |s: &catalog::Source, paper: &Value| c.tool(&s.plugin, &s.tool, paper);
        with_lib(&c, &p, |lib| catalog::add(lib, &p, &sources, &ask))
    });
    let (c, l, iw) = (core.clone(), listener.clone(), inbox_watching.clone());
    m.add("connector", move |p| {
        let cfg = c.settings(&p);
        ensure_inbox_watcher(&iw, &cfg, &c.plugin, &c.root);
        Ok(sync_connector(&l, &cfg, &c.plugin, &c.root))
    });
    serve(m);
}
