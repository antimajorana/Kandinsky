//! The catalog's tools (plugin.toml `[[tool]]`, ported from the Python helper.py): `lookup` — a paper's metadata from
//! OpenAlex (any DOI) or arXiv itself (an arXiv id), in the catalog's terms — and `add` — the paper into the library
//! (refs.rs `add`: metadata, citekey, note, open-access PDF, refs.bib), the PDF sources other plugins contribute asked
//! when the built-in ones found none (docs/guides/PAPERS-PDF-SOURCES.md), answering the entry's note.
use crate::entry;
use crate::net::Net;
use crate::refs::{Lib, PaperAdded, Res};
use crate::remote::{self, enc, last_first, openalex_abstract, openalex_doi, ArxivRecord};
use kandinsky_text::paths::safe_join;
use serde_json::{json, Map, Value};
use serde_yaml::{Mapping, Value as Yaml};

/// The identifiers the catalog recognised (`params.ids`).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Ids {
    pub doi: Option<String>,
    pub arxiv: Option<String>,
    pub isbn: Option<String>,
    /// A link straight to a PDF (a captured `….pdf`): downloaded and read for its identifiers.
    pub pdf: Option<String>,
}

fn isbn_from_param(raw: &str) -> Option<String> {
    let t = raw.trim();
    if t.is_empty() {
        return None;
    }
    if t.to_ascii_lowercase().starts_with("isbn") {
        remote::normalize_isbn(t).or_else(|| remote::parse_isbn(t))
    } else if !t.contains("://") {
        remote::normalize_isbn(t)
    } else {
        None
    }
}

impl Ids {
    pub fn of(params: &Value) -> Ids {
        let one = |k: &str| params["ids"][k].as_str().map(str::trim).filter(|v| !v.is_empty()).map(String::from);
        let isbn = one("isbn")
            .or_else(|| params["isbn"].as_str().map(str::trim).filter(|v| !v.is_empty()).map(String::from))
            .and_then(|s| remote::normalize_isbn(&s).or_else(|| remote::parse_isbn(&s)))
            .or_else(|| params["url"].as_str().and_then(isbn_from_param))
            .or_else(|| params["id"].as_str().and_then(isbn_from_param));
        Ids { doi: one("doi"), arxiv: one("arxiv"), isbn, pdf: one("pdf") }
    }

    /// The DOI to ask OpenAlex about: the paper's own, else its arXiv DOI.
    pub fn doi_for_openalex(&self) -> Option<String> {
        self.doi.as_deref().map(str::to_lowercase).or_else(|| self.arxiv.as_ref().map(|a| format!("10.48550/arxiv.{}", a.to_lowercase())))
    }
}

/// `{ids, fields}` without the empty fields.
fn found(ids: Map<String, Value>, fields: Vec<(&str, Value)>) -> Value {
    let fields: Map<String, Value> = fields
        .into_iter()
        .filter(|(_, v)| !(v.is_null() || v.as_str() == Some("") || v.as_array().is_some_and(Vec::is_empty)))
        .map(|(k, v)| (k.to_string(), v))
        .collect();
    json!({ "ids": ids, "fields": fields })
}

/// An OpenAlex work in the catalog's terms: its IDs and the fields a paper note shows.
pub fn from_openalex(w: &Value) -> Value {
    let mut ids = Map::new();
    let doi = openalex_doi(w);
    match doi.strip_prefix("10.48550/arxiv.") {
        Some(a) => drop(ids.insert("arxiv".into(), a.into())),
        None if !doi.is_empty() => drop(ids.insert("doi".into(), doi.clone().into())),
        None => {}
    }
    if let Some(isbn) = w["ids"]["isbn"]
        .as_str()
        .and_then(remote::normalize_isbn)
        .or_else(|| w["ids"]["isbn"].as_array().into_iter().flatten().filter_map(Value::as_str).find_map(remote::normalize_isbn))
    {
        ids.insert("isbn".into(), isbn.into());
    }
    for loc in w["locations"].as_array().into_iter().flatten() {
        let page = loc["landing_page_url"].as_str().unwrap_or_default();
        if let Some(a) = page.split_once("arxiv.org/").and_then(|(_, r)| remote::parse_arxiv(&format!("arxiv:{}", r.trim_start_matches("abs/").trim_start_matches("pdf/")))) {
            ids.entry("arxiv").or_insert(a.into());
        }
    }
    let authors: Vec<Value> = w["authorships"].as_array().into_iter().flatten().filter_map(|a| a["author"]["display_name"].as_str()).filter(|n| !n.is_empty()).map(|n| last_first(n).into()).collect();
    let pdf = w["best_oa_location"]["pdf_url"].as_str().or_else(|| w["open_access"]["oa_url"].as_str());
    found(
        ids,
        vec![
            ("title", w["display_name"].as_str().or_else(|| w["title"].as_str()).into()),
            ("authors", authors.into()),
            ("year", w["publication_year"].clone()),
            ("journal", w["primary_location"]["source"]["display_name"].clone()),
            ("abstract", openalex_abstract(&w["abstract_inverted_index"]).into()),
            ("openalex", w["id"].clone()),
            ("pdf", pdf.into()),
        ],
    )
}

fn yaml_str(m: &Mapping, k: &str) -> Option<String> {
    match m.get(k)? {
        Yaml::String(s) => Some(s.trim().to_string()).filter(|x| !x.is_empty()),
        Yaml::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// Converts a book metadata YAML mapping (from [`remote::lookup_book_metadata`]) into the catalog's `{ ids, fields }`.
pub fn from_book_mapping(m: &Mapping, fallback_isbn: Option<&str>) -> Value {
    let get_s = |k: &str| yaml_str(m, k);
    let get_seq = |k: &str| -> Vec<Value> {
        m.get(k)
            .and_then(Yaml::as_sequence)
            .into_iter()
            .flatten()
            .filter_map(Yaml::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(Value::from)
            .collect()
    };
    let mut ids = Map::new();
    let isbn = get_s("ISBN").or_else(|| get_s("isbn")).or_else(|| fallback_isbn.map(String::from)).and_then(|s| remote::normalize_isbn(&s).or(Some(s)));
    if let Some(ref i) = isbn {
        ids.insert("isbn".into(), i.clone().into());
    }
    let doi = get_s("DOI").or_else(|| get_s("doi")).map(|d| d.to_lowercase());
    if let Some(ref d) = doi {
        ids.insert("doi".into(), d.clone().into());
    }
    let authors = {
        let a = get_seq("author");
        if a.is_empty() { get_seq("authors") } else { a }
    };
    let editors = {
        let e = get_seq("editor");
        if e.is_empty() { get_seq("editors") } else { e }
    };
    let year_str = get_s("year").or_else(|| get_s("date").and_then(|d| crate::refs::year_of(&d)));
    let year_val = year_str
        .as_deref()
        .and_then(|y| y.parse::<u64>().ok())
        .map(Value::from)
        .or_else(|| year_str.map(Value::from))
        .unwrap_or(Value::Null);
    let pages_val = get_s("numPages")
        .and_then(|p| p.parse::<u64>().ok())
        .map(Value::from)
        .unwrap_or(Value::Null);
    found(
        ids,
        vec![
            ("title", get_s("title").into()),
            ("authors", authors.into()),
            ("editors", editors.into()),
            ("year", year_val),
            ("publisher", get_s("publisher").into()),
            ("isbn", isbn.into()),
            ("edition", get_s("edition").into()),
            ("series", get_s("series").into()),
            ("volume", get_s("volume").into()),
            ("pages", pages_val),
            ("abstract", get_s("abstractNote").or_else(|| get_s("abstract")).into()),
            ("url", get_s("url").into()),
            ("kind", get_s("kind").into()),
            ("bibtexType", get_s("bibtexType").into()),
        ],
    )
}

/// arXiv's own record in the catalog's terms: the authority for an arXiv paper.
pub fn from_arxiv(r: &ArxivRecord, id: &str) -> Value {
    let mut ids = Map::new();
    ids.insert("arxiv".into(), id.into());
    if let Some(d) = &r.doi {
        ids.insert("doi".into(), d.to_lowercase().into());
    }
    let year = r.published.as_deref().and_then(|p| p.get(..4)).and_then(|y| y.parse::<u64>().ok());
    found(
        ids,
        vec![
            ("title", r.title.clone().into()),
            ("authors", r.authors.clone().into()),
            ("year", year.into()),
            ("journal", r.journal_ref.clone().into()),
            ("abstract", r.summary.clone().into()),
            ("pdf", format!("https://arxiv.org/pdf/{id}").into()),
        ],
    )
}

/// The citekey the library would give a paper (title, year, authors) — none when it cannot say.
pub type KeyOf<'a> = &'a dyn Fn(&str, Option<String>, &[String]) -> Option<String>;

/// What `lookup` answers when it has nothing: empty fields and why.
fn skipped(why: String) -> Value {
    json!({ "fields": {}, "skipped": why })
}

/// The `lookup` tool. arXiv ids are asked of arXiv itself (OpenAlex sometimes merges a preprint with another work:
/// 1706.03762 was once answered with a 2025 record); DOIs of OpenAlex, whose answer about another work is
/// refused; ISBNs (and book hints) via Crossref, OpenAlex, and OpenLibrary. `key_of(title, year, authors)`:
/// the citekey the library would give it, so a preview names the real file.
pub fn lookup(net: &dyn Net, params: &Value, email: &str, key_of: KeyOf) -> Value {
    let ids = Ids::of(params);
    let hint_title = params["hints"]["title"]
        .as_str()
        .or_else(|| params["title"].as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let hint_author = params["hints"]["author"]
        .as_str()
        .or_else(|| params["hints"]["authors"].as_array().and_then(|a| a.first()).and_then(Value::as_str))
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let is_book_kind = matches!(params["kind"].as_str(), Some("book" | "science_book"));

    let openalex_by_doi = |doi: &str| -> Value {
        let mailto = if email.is_empty() { String::new() } else { format!("?mailto={}", enc(email, "")) };
        let w = match net.json(&format!("https://api.openalex.org/works/doi:{}{mailto}", enc(doi, "/"))) {
            Ok(w) if w["id"].is_string() => w,
            _ => return skipped(format!("OpenAlex does not know {doi}")),
        };
        let answered = openalex_doi(&w);
        if !answered.is_empty() && answered != doi {
            return skipped(format!("OpenAlex answered {answered} for {doi}; not used"));
        }
        from_openalex(&w)
    };

    let mut got = if let Some(ref isbn) = ids.isbn {
        if let Some((m, _)) = remote::lookup_book_metadata(net, Some(isbn), ids.doi.as_deref(), hint_title, hint_author, email) {
            from_book_mapping(&m, Some(isbn))
        } else if let Some(doi) = ids.doi_for_openalex() {
            openalex_by_doi(&doi)
        } else {
            return skipped(format!("no book found for ISBN {isbn}"));
        }
    } else {
        match (&ids.arxiv, &ids.doi) {
            (Some(a), None) => match remote::arxiv_record(net, a) {
                Ok(r) => from_arxiv(&r, a),
                Err(_) => return skipped(format!("arXiv does not know {a}")),
            },
            _ if is_book_kind && ids.doi.is_some() => {
                if let Some((m, _)) = remote::lookup_book_metadata(net, None, ids.doi.as_deref(), hint_title, hint_author, email) {
                    from_book_mapping(&m, None)
                } else {
                    openalex_by_doi(&ids.doi_for_openalex().unwrap_or_default())
                }
            }
            _ => match ids.doi_for_openalex() {
                Some(doi) => openalex_by_doi(&doi),
                None if is_book_kind && hint_title.is_some() => {
                    match remote::lookup_book_metadata(net, None, None, hint_title, hint_author, email) {
                        Some((m, _)) => from_book_mapping(&m, None),
                        None => return skipped("no book found".into()),
                    }
                }
                None => return skipped("no DOI or arXiv id".into()),
            },
        }
    };
    let f = &got["fields"];
    if let Some(title) = f["title"].as_str() {
        let authors: Vec<String> = f["authors"].as_array().into_iter().flatten().filter_map(Value::as_str).map(String::from).collect();
        let year = f["year"].as_u64().map(|y| y.to_string()).or_else(|| f["year"].as_str().map(String::from));
        if let Some(key) = key_of(title, year, &authors) {
            got["fields"]["citekey"] = key.into();
        }
    }
    got
}

/// A PDF source another plugin contributes (`[contributes.catalog-papers] pdf_sources = [{ tool, label }]`).
#[derive(Debug, Clone, PartialEq)]
pub struct Source {
    pub plugin: String,
    pub tool: String,
    pub label: String,
}

/// The PDF sources, in the setting's order: plugins named there first, `-<id>` switches one off, the rest after, by id.
pub fn pdf_sources(contributions: &Map<String, Value>, order: &str) -> Vec<Source> {
    let mut found = Vec::new();
    let mut ids: Vec<&String> = contributions.keys().collect();
    ids.sort();
    for pid in ids {
        for src in contributions[pid]["pdf_sources"].as_array().into_iter().flatten() {
            if let Some(tool) = src["tool"].as_str().filter(|t| !t.is_empty()) {
                let label = src["label"].as_str().filter(|l| !l.is_empty()).unwrap_or(pid);
                found.push(Source { plugin: pid.clone(), tool: tool.into(), label: label.into() });
            }
        }
    }
    let names: Vec<&str> = order.split([',', ' ', '\t', '\n']).filter(|n| !n.is_empty()).collect();
    let off: Vec<&str> = names.iter().filter_map(|n| n.strip_prefix('-')).collect();
    let first: Vec<&str> = names.iter().copied().filter(|n| !n.starts_with('-')).collect();
    let rank = |s: &Source| (first.iter().position(|f| *f == s.plugin).unwrap_or(first.len()), s.plugin.clone());
    found.retain(|s| !off.contains(&s.plugin.as_str()));
    found.sort_by_key(rank); // stable: one plugin's sources keep their order
    found
}

/// What asking the sources came to.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct FoundPdf {
    pub pdf: bool,
    pub from: Option<String>,
    pub tried: Vec<String>,
}

/// The SDK's file name for a paper's download: the key with anything but letters, digits, `.`, `-`, `_` as `_`.
fn sdk_name(key: &str) -> String {
    key.chars().map(|c| if c.is_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { '_' }).collect()
}

/// Each source in turn until one gave a PDF. A source answers `{ file, from }` (a download in its cache, attached
/// here through `attach`) or `{ attached: true }` (the SDK's `attach_pdf` left it at `pdf/<key>.pdf` in the source's
/// cache, attached from there), else `{ skipped }`. A source that fails
/// is noted and the next one asked: one broken plugin never stops the others.
pub fn find_pdf(ask: &dyn Fn(&Source, &Value) -> Res<Value>, attach: &dyn Fn(&str, &str) -> Res<()>, sources: &[Source], paper: &Value) -> FoundPdf {
    let mut tried = Vec::new();
    for src in sources {
        let r = match ask(src, paper) {
            Ok(r) => r,
            Err(e) => {
                tried.push(format!("{}: {e}", src.label));
                continue;
            }
        };
        let from = r["from"].as_str().filter(|f| !f.is_empty()).unwrap_or(&src.label).to_string();
        // `{ attached: true }` without a file: a source on the SDK's `attach_pdf`, which downloads to its fixed place in
        // the source's cache (`pdf/<key>.pdf`) and no longer attaches itself (the helper would wait on itself)
        let file = r["file"].as_str().map(String::from).or_else(|| {
            (r["attached"].as_bool() == Some(true)).then(|| format!(".kandinsky/cache/plugins/{}/pdf/{}.pdf", src.plugin, sdk_name(paper["key"].as_str().unwrap_or_default())))
        });
        let attached = match file {
            Some(file) => attach(&file, &from).map_err(|e| tried.push(format!("{}: {e}", src.label))).is_ok(),
            None => false,
        };
        if attached {
            return FoundPdf { pdf: true, from: Some(from), tried };
        }
        if r["file"].is_null() {
            tried.push(format!("{}: {}", src.label, r["skipped"].as_str().unwrap_or("no PDF")));
        }
    }
    FoundPdf { pdf: false, from: None, tried }
}

fn find_existing_by_isbn(lib: &Lib, norm_isbn: &str) -> Option<crate::refs::Paper> {
    lib.list().ok()?.into_iter().find(|p| {
        safe_join(lib.root, &p.dir)
            .ok()
            .and_then(|d| entry::read(&d))
            .and_then(|em| yaml_str(&em, "ISBN").or_else(|| yaml_str(&em, "isbn")))
            .and_then(|raw| remote::normalize_isbn(&raw))
            .as_deref()
            == Some(norm_isbn)
    })
}

fn mapping_from_catalog_fields(fields: &Map<String, Value>, isbn: &str) -> Option<Mapping> {
    let title = fields.get("title").and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty())?;
    let mut m = Mapping::new();
    m.insert("title".into(), title.into());
    for (fk, mk) in [("authors", "author"), ("editors", "editor")] {
        if let Some(arr) = fields.get(fk).and_then(Value::as_array) {
            let seq: Vec<Yaml> = arr.iter().filter_map(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(Yaml::from).collect();
            if !seq.is_empty() {
                m.insert(mk.into(), Yaml::Sequence(seq));
            }
        }
    }
    if let Some(y) = fields.get("year").and_then(|v| v.as_u64().map(|n| n.to_string()).or_else(|| v.as_str().map(String::from))) {
        m.insert("date".into(), y.into());
    }
    for (fk, mk) in [
        ("publisher", "publisher"),
        ("edition", "edition"),
        ("series", "series"),
        ("volume", "volume"),
        ("url", "url"),
        ("abstract", "abstractNote"),
        ("bibtexType", "bibtexType"),
    ] {
        if let Some(s) = fields.get(fk).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()) {
            m.insert(mk.into(), s.into());
        }
    }
    m.insert("ISBN".into(), isbn.into());
    Some(m)
}

fn bibtex_from_book_mapping(m: &Mapping, fallback_isbn: &str) -> Option<String> {
    let title = yaml_str(m, "title")?;
    let clean = |v: &str| v.replace(['{', '}'], "").split_whitespace().collect::<Vec<_>>().join(" ");
    let bib_kind = match yaml_str(m, "bibtexType").as_deref() {
        Some("incollection" | "inbook") => "incollection",
        _ if yaml_str(m, "type").as_deref() == Some("bookSection") => "incollection",
        _ => "book",
    };
    let mut lines = vec![format!("@{bib_kind}{{,")];
    lines.push(format!("  title = {{{}}},", clean(&title)));
    for (mk, bk) in [("author", "author"), ("authors", "author"), ("editor", "editor"), ("editors", "editor")] {
        if bk == "author" && mk == "authors" && m.contains_key("author") {
            continue;
        }
        if bk == "editor" && mk == "editors" && m.contains_key("editor") {
            continue;
        }
        let people: Vec<String> = m
            .get(mk)
            .and_then(Yaml::as_sequence)
            .into_iter()
            .flatten()
            .filter_map(Yaml::as_str)
            .map(clean)
            .filter(|s| !s.is_empty())
            .collect();
        if !people.is_empty() {
            lines.push(format!("  {bk} = {{{}}},", people.join(" and ")));
        }
    }
    if let Some(y) = yaml_str(m, "year").or_else(|| yaml_str(m, "date").and_then(|d| crate::refs::year_of(&d))) {
        lines.push(format!("  year = {{{}}},", clean(&y)));
    }
    let isbn = yaml_str(m, "ISBN").or_else(|| yaml_str(m, "isbn")).unwrap_or_else(|| fallback_isbn.to_string());
    lines.push(format!("  isbn = {{{}}},", clean(&isbn)));
    for (mk, bk) in [
        ("publisher", "publisher"),
        ("edition", "edition"),
        ("series", "series"),
        ("volume", "volume"),
        ("bookTitle", "booktitle"),
        ("DOI", "doi"),
        ("doi", "doi"),
        ("url", "url"),
        ("abstractNote", "abstract"),
        ("abstract", "abstract"),
    ] {
        if (mk == "doi" && m.contains_key("DOI")) || (mk == "abstract" && m.contains_key("abstractNote")) {
            continue;
        }
        if let Some(val) = yaml_str(m, mk).map(|v| clean(&v)).filter(|v| !v.is_empty()) {
            lines.push(format!("  {bk} = {{{val}}},"));
        }
    }
    lines.push("}".into());
    Some(lines.join("\n"))
}

fn add_book_by_isbn(lib: &Lib, isbn: &str, params: &Value) -> Res<PaperAdded> {
    let norm = remote::normalize_isbn(isbn).unwrap_or_else(|| isbn.to_string());
    if let Some(existing) = find_existing_by_isbn(lib, &norm) {
        let pdf = existing.pdf.is_some();
        return Ok(PaperAdded { paper: existing, created: false, pdf, gate: None });
    }
    let tagged = format!("ISBN {norm}");
    if remote::parse_isbn(&tagged).is_some() {
        if let Ok(added) = lib.add(&tagged) {
            return Ok(added);
        }
    }
    let hint_title = params["hints"]["title"].as_str().or_else(|| params["fields"]["title"].as_str());
    let hint_author = params["hints"]["author"].as_str().or_else(|| params["fields"]["authors"].as_array().and_then(|a| a.first()).and_then(Value::as_str));
    let mapped = remote::lookup_book_metadata(lib.net, Some(&norm), None, hint_title, hint_author, &lib.cfg.email)
        .map(|(m, _)| m)
        .or_else(|| params["fields"].as_object().and_then(|f| mapping_from_catalog_fields(f, &norm)));
    let Some(m) = mapped else {
        return Err(format!("ISBN {norm}: no book metadata found"));
    };
    let bib = bibtex_from_book_mapping(&m, &norm).ok_or_else(|| format!("ISBN {norm}: book metadata has no title"))?;
    lib.add(&bib)
}

/// The `add` tool: through the library (the entry, its note, the PDF, refs.bib), then the PDF sources when the
/// built-in ones found none; answers `{ path, created, pdf, notice? }` (`exists`: the note the catalog found already).
pub fn add(lib: &Lib, params: &Value, sources_of: &dyn Fn() -> Res<Map<String, Value>>, ask: &dyn Fn(&Source, &Value) -> Res<Value>) -> Res<Value> {
    if let Some(path) = params["exists"].as_str().filter(|p| !p.is_empty()) {
        return Ok(json!({ "path": path }));
    }
    let ids = Ids::of(params);
    let url_param = params["url"].as_str().map(str::trim).filter(|u| !u.is_empty());
    let added = match (&ids.arxiv, &ids.doi, &ids.isbn, &ids.pdf) {
        (Some(a), None, _, _) => {
            let ver = url_param.and_then(remote::parse_arxiv_versioned).filter(|(base, _)| base == a).and_then(|(_, v)| v).unwrap_or_default();
            lib.add(&format!("arXiv:{a}{ver}"))?
        }
        (_, Some(d), Some(isbn), _) => match lib.add(d) {
            Ok(a) => a,
            Err(_) => add_book_by_isbn(lib, isbn, params)?,
        },
        (_, Some(d), None, _) => lib.add(d)?,
        (None, None, Some(isbn), _) => add_book_by_isbn(lib, isbn, params)?,
        (None, None, None, Some(url)) => return add_pdf_link(lib, url),
        (None, None, None, None) => match url_param {
            Some(u) if u.split(['?', '#']).next().unwrap_or(u).to_ascii_lowercase().ends_with(".pdf") => return add_pdf_link(lib, u),
            Some(u) => lib.add(u)?,
            None => return Err("a paper needs a DOI, an arXiv id, an ISBN or a link to its PDF".into()),
        },
    };
    let key = added.paper.key.clone();
    let mut found = FoundPdf { pdf: added.pdf, ..Default::default() };
    if !added.pdf && added.created && lib.cfg.pdf_sources_on {
        let p = &added.paper;
        let paper = json!({ "key": key, "doi": ids.doi.clone().or(p.doi.clone()), "arxiv": ids.arxiv, "isbn": ids.isbn, "title": p.title, "year": p.year, "authors": p.authors });
        let sources = pdf_sources(&sources_of().unwrap_or_default(), &lib.cfg.pdf_order);
        found = find_pdf(ask, &|file, from| lib.attach_pdf(&key, file, from).map(drop), &sources, &paper);
    }
    // a publisher's copy behind its login is offered only now, when nothing else had the PDF
    if let Some(u) = added.gate.as_deref().filter(|_| !found.pdf) {
        lib.net.offer_signin(u);
    }
    let mut out = json!({ "path": lib.note(&key)?, "created": added.created, "pdf": found.pdf });
    if let Some(from) = &found.from {
        out["notice"] = format!("PDF from {from}").into();
    } else if !found.pdf && !found.tried.is_empty() {
        // one short line: which sources were asked, not each one's error
        let asked: Vec<&str> = found.tried.iter().map(|t| t.split(':').next().unwrap_or(t).trim()).collect();
        out["notice"] = format!("No PDF found (asked {})", asked.join(", ")).into();
    }
    Ok(out)
}

/// A link to a PDF: the file fetched and imported as a dropped one is (its first pages read for a DOI, arXiv id or
/// ISBN; else named after the file), keeping its own name and the link as `url`.
fn add_pdf_link(lib: &Lib, url: &str) -> Res<Value> {
    let bytes = lib.net.pdf(url).map_err(|e| e.to_string())?;
    let name = url.split(['?', '#']).next().unwrap_or(url).rsplit(['/', '\\']).next().filter(|n| !n.is_empty()).unwrap_or("document.pdf");
    let name = kandinsky_text::links::percent_decoded(name);
    let opts = crate::refs::ImportOpts { keep_name: true, url: Some(url.to_string()), ..Default::default() };
    let added = lib.import_pdf_with(&name, &bytes, &opts)?;
    Ok(json!({ "path": lib.note(&added.paper.key)?, "created": added.created, "pdf": true }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::net::fake::{Answer, Table, GATE};
    use crate::refs::tests::Vault;
    use std::cell::RefCell;

    fn work() -> Value {
        // "More Is Different", cut down to what the helper reads
        json!({
            "id": "https://openalex.org/W2045313424",
            "display_name": "More Is Different",
            "ids": { "doi": "https://doi.org/10.1126/science.177.4047.393" },
            "publication_year": 1972,
            "authorships": [{ "author": { "display_name": "P. W. Anderson" } }],
            "primary_location": { "source": { "display_name": "Science" } },
            "abstract_inverted_index": { "The": [0], "reductionist": [1], "hypothesis": [2] },
        })
    }
    const NO_KEY: KeyOf<'static> = &|_, _, _| None;

    #[test]
    fn a_doi_brings_title_authors_as_the_notes_keep_them_venue_and_abstract() {
        let net = Table::default().on("https://api.openalex.org/works/doi:10.1126/science.177.4047.393", Answer::Json(work()));
        let r = lookup(&net, &json!({ "ids": { "doi": "10.1126/Science.177.4047.393" } }), "me@example.org", NO_KEY);
        assert_eq!(*net.asked.borrow(), ["https://api.openalex.org/works/doi:10.1126/science.177.4047.393?mailto=me%40example.org"]);
        assert_eq!(r["ids"], json!({ "doi": "10.1126/science.177.4047.393" }));
        assert_eq!(r["fields"]["authors"], json!(["Anderson, P. W."]));
        assert_eq!((&r["fields"]["year"], &r["fields"]["journal"], &r["fields"]["abstract"]), (&json!(1972), &json!("Science"), &json!("The reductionist hypothesis")));
    }

    #[test]
    fn the_citekey_is_the_one_the_library_gives_so_a_preview_names_the_real_file() {
        let net = Table::default().on("https://api.openalex.org/", Answer::Json(work()));
        let asked = RefCell::new(Vec::new());
        let key_of = |t: &str, y: Option<String>, a: &[String]| {
            asked.borrow_mut().push((t.to_string(), y, a.to_vec()));
            Some("anderson1972more".to_string())
        };
        let r = lookup(&net, &json!({ "ids": { "doi": "10.1126/science.177.4047.393" } }), "", &key_of);
        assert_eq!(r["fields"]["citekey"], "anderson1972more");
        assert_eq!(*asked.borrow(), [("More Is Different".to_string(), Some("1972".to_string()), vec!["Anderson, P. W.".to_string()])]);
    }

    #[test]
    fn an_arxiv_doi_answered_by_openalex_keeps_its_arxiv_id_and_pdf() {
        let preprint = json!({ "id": "https://openalex.org/W1", "display_name": "Attention Is All You Need",
            "ids": { "doi": "https://doi.org/10.48550/arxiv.1706.03762" }, "publication_year": 2017,
            "authorships": [{ "author": { "display_name": "Ashish Vaswani" } }], "best_oa_location": { "pdf_url": "https://arxiv.org/pdf/1706.03762" } });
        let net = Table::default().on("https://api.openalex.org/works/doi:10.48550/arxiv.1706.03762", Answer::Json(preprint));
        let r = lookup(&net, &json!({ "ids": { "doi": "10.48550/arXiv.1706.03762" } }), "", NO_KEY);
        assert_eq!(r["ids"], json!({ "arxiv": "1706.03762" }));
        assert_eq!(r["fields"]["pdf"], "https://arxiv.org/pdf/1706.03762");
    }

    #[test]
    fn an_arxiv_id_is_asked_from_arxiv_itself_and_a_mismatched_openalex_answer_is_refused() {
        let atom = r#"<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom"><entry>
          <title>Attention Is All
            You Need</title><published>2017-06-12T17:57:34Z</published><summary> The dominant models </summary>
          <author><name>Ashish Vaswani</name></author><author><name>Noam Shazeer</name></author></entry></feed>"#;
        let net = Table::default().on("https://export.arxiv.org/", Answer::Text(atom.into()));
        let r = lookup(&net, &json!({ "ids": { "arxiv": "1706.03762" } }), "", NO_KEY);
        assert!(net.asked.borrow().iter().all(|u| !u.contains("openalex")), "not OpenAlex");
        assert_eq!(r["ids"], json!({ "arxiv": "1706.03762" }));
        assert_eq!((&r["fields"]["title"], &r["fields"]["year"]), (&json!("Attention Is All You Need"), &json!(2017)));
        assert_eq!(r["fields"]["authors"], json!(["Vaswani, Ashish", "Shazeer, Noam"]));
        let mut merged = work();
        merged["ids"]["doi"] = "https://doi.org/10.65215/2q58a426".into();
        let net = Table::default().on("https://api.openalex.org/", Answer::Json(merged));
        let r = lookup(&net, &json!({ "ids": { "doi": "10.1126/science.177.4047.393" } }), "", NO_KEY);
        assert!(r["skipped"].as_str().unwrap().contains("not used"), "{r}");
        assert!(lookup(&Table::default(), &json!({ "ids": { "arxiv": "9999.99999" } }), "", NO_KEY)["skipped"].as_str().unwrap().contains("arXiv does not know"));
        assert_eq!(lookup(&Table::default(), &json!({}), "", NO_KEY)["skipped"], "no DOI or arXiv id");
    }

    #[test]
    fn pdf_sources_follow_the_setting_and_one_can_be_switched_off() {
        let c = json!({ "zz": { "pdf_sources": [{ "tool": "find", "label": "Z" }] }, "oa": { "pdf_sources": [{ "tool": "find_pdf" }] },
            "mine": { "pdf_sources": [{ "tool": "get" }] }, "other": { "kinds": [] } });
        let c = c.as_object().unwrap();
        let ids = |order: &str| pdf_sources(c, order).into_iter().map(|s| s.plugin).collect::<Vec<_>>();
        assert_eq!(ids(""), ["mine", "oa", "zz"]);
        assert_eq!(ids("zz, mine"), ["zz", "mine", "oa"]);
        assert_eq!(ids("-oa"), ["mine", "zz"]);
        assert_eq!(pdf_sources(c, "")[2].label, "Z");
    }

    #[test]
    fn a_broken_source_is_noted_and_the_next_one_asked() {
        let srcs = pdf_sources(json!({ "a": { "pdf_sources": [{ "tool": "t" }] }, "b": { "pdf_sources": [{ "tool": "t" }] } }).as_object().unwrap(), "");
        let ask = |s: &Source, _: &Value| if s.plugin == "a" { Err("down".to_string()) } else { Ok(json!({ "attached": true, "from": "B's index" })) };
        let r = find_pdf(&ask, &|_, _| Ok(()), &srcs, &json!({ "key": "k" }));
        assert_eq!(r, FoundPdf { pdf: true, from: Some("B's index".into()), tried: vec!["a: down".into()] });
    }

    /// The catalog's `add`: the library's entry and note; the sources asked only when no PDF came, and only when on;
    /// a source's download (`file`) is attached here.
    #[test]
    fn add_files_the_paper_and_asks_the_sources_only_when_no_pdf_came() {
        let mut v = Vault::new();
        v.net = Table::default().on("https://api.crossref.org/works/10.1/x", Answer::Json(json!({ "message": { "title": ["Kinks"], "type": "journal-article" } })));
        let cache = v.root.join(".kandinsky/cache/plugins/oa");
        std::fs::create_dir_all(&cache).unwrap();
        std::fs::write(cache.join("k.pdf"), b"%PDF-1.4 found").unwrap();
        let lib = v.lib();
        let asked = RefCell::new(Vec::new());
        let ask = |s: &Source, paper: &Value| -> Res<Value> {
            asked.borrow_mut().push(paper.clone());
            Ok(json!({ "file": ".kandinsky/cache/plugins/oa/k.pdf", "from": format!("a mirror via {}", s.plugin) }))
        };
        let sources = || -> Res<Map<String, Value>> { Ok(json!({ "another-source": { "pdf_sources": [{ "tool": "find_pdf" }] } }).as_object().unwrap().clone()) };
        let r = add(&lib, &json!({ "ids": { "doi": "10.1/x" } }), &sources, &ask).unwrap();
        assert_eq!((&r["pdf"], &r["notice"], &r["created"]), (&json!(true), &json!("PDF from a mirror via another-source"), &json!(true)));
        assert_eq!(r["path"], "refs/papers/kinks/kinks.md");
        assert!(v.root.join("refs/papers/kinks/kinks.pdf").is_file() && !cache.join("k.pdf").exists());
        assert_eq!((&asked.borrow()[0]["key"], &asked.borrow()[0]["doi"]), (&json!("kinks"), &json!("10.1/x")));
        // the same paper again: not created, the sources not asked
        asked.borrow_mut().clear();
        let again = add(&lib, &json!({ "ids": { "doi": "10.1/x" } }), &sources, &ask).unwrap();
        assert_eq!((again["created"].as_bool(), asked.borrow().len()), (Some(false), 0));
        assert_eq!(add(&lib, &json!({ "ids": { "doi": "10.1/x" }, "exists": "refs/papers/a/a.md" }), &sources, &ask).unwrap(), json!({ "path": "refs/papers/a/a.md" }));
        assert!(add(&lib, &json!({ "ids": {} }), &sources, &ask).is_err());
    }

    #[test]
    fn switched_off_the_sources_are_not_asked() {
        let mut v = Vault::new();
        v.net = Table::default().on("https://api.crossref.org/", Answer::Json(json!({ "message": { "title": ["Kinks"] } })));
        v.cfg.pdf_sources_on = false;
        let lib = v.lib();
        let r = add(&lib, &json!({ "ids": { "doi": "10.1/x" } }), &|| Ok(Map::new()), &|_, _| panic!("not asked")).unwrap();
        assert_eq!((r["pdf"].as_bool(), r.get("notice")), (Some(false), None));
    }

    /// A PRL paper: PRL's copy stood behind its login, OpenAlex's open copy came — no sign-in
    /// offered. With only the publisher's copy, its sign-in is offered once, after every try.
    #[test]
    fn a_publishers_sign_in_is_offered_only_when_no_copy_came() {
        let work = |locations: Value| json!({ "ids": { "doi": "https://doi.org/10.1/x" }, "locations": locations });
        let gated = json!({ "pdf_url": "https://journals.aps.org/prl/pdf/x" });
        for (locations, pdf, offered) in [
            (json!([gated, { "pdf_url": "https://repo.org/x.pdf" }]), true, vec![]),
            (json!([gated]), false, vec!["https://journals.aps.org/prl/pdf/x".to_string()]),
        ] {
            let mut v = Vault::new();
            v.net = Table::default()
                .on("https://api.crossref.org/", Answer::Json(json!({ "message": { "title": ["Kinks"] } })))
                .on("https://api.openalex.org/", Answer::Json(work(locations)))
                .on("https://journals.aps.org/", Answer::Text(GATE.into()))
                .on("https://repo.org/", Answer::Bytes(b"%PDF-1.4 open".to_vec()));
            let r = add(&v.lib(), &json!({ "ids": { "doi": "10.1/x" } }), &|| Ok(Map::new()), &|_, _| panic!("no sources")).unwrap();
            assert_eq!(r["pdf"].as_bool(), Some(pdf));
            assert_eq!(*v.net.offered.borrow(), offered);
        }
    }

    #[test]
    fn isbn_identifiers_normalize_lookup_and_add_books_cleanly() {
        let cr_book = json!({
            "message": {
                "items": [{
                    "type": "monograph",
                    "title": ["Synthetic Quantum Mechanics"],
                    "author": [{ "family": "Example", "given": "Ada" }],
                    "issued": { "date-parts": [[2021]] },
                    "publisher": "Example University Press",
                    "container-title": ["Graduate Texts in Physics"],
                    "edition-number": "2",
                    "ISBN": ["978-0-306-40615-7"],
                    "DOI": "10.1000/book.example.1"
                }]
            }
        });
        let net = Table::default().on("https://api.crossref.org/works?filter=isbn:9780306406157", Answer::Json(cr_book.clone()));
        let looked = lookup(&net, &json!({ "kind": "science_book", "ids": { "isbn": "isbn:978-0-306-40615-7" } }), "", NO_KEY);
        assert_eq!(looked["ids"], json!({ "isbn": "9780306406157", "doi": "10.1000/book.example.1" }));
        assert_eq!(looked["fields"]["title"], "Synthetic Quantum Mechanics");
        assert_eq!(looked["fields"]["authors"], json!(["Example, Ada"]));
        assert_eq!(looked["fields"]["year"], json!(2021));
        assert_eq!(looked["fields"]["publisher"], "Example University Press");
        assert_eq!(looked["fields"]["edition"], "2");
        assert_eq!(looked["fields"]["kind"], "science_book");
        assert_eq!(looked["fields"]["bibtexType"], "book");

        let ol_isbn = json!({
            "ISBN:080442957X": {
                "title": "Introduction to Synthetic Logic",
                "authors": [{ "name": "B. Researcher" }],
                "publish_date": "2015",
                "publishers": [{ "name": "Synthetic Press" }],
                "number_of_pages": 320
            }
        });
        let net_ol = Table::default().on("https://openlibrary.org/api/books?bibkeys=ISBN:080442957X", Answer::Json(ol_isbn));
        let looked_ol = lookup(&net_ol, &json!({ "ids": { "isbn": "0-8044-2957-x" } }), "", NO_KEY);
        assert_eq!(looked_ol["ids"], json!({ "isbn": "080442957X" }));
        assert_eq!(looked_ol["fields"]["pages"], json!(320));
        assert!(lookup(&Table::default(), &json!({ "ids": { "isbn": "9780306406157" } }), "", NO_KEY)["skipped"].as_str().unwrap().contains("9780306406157"));

        // catalog::add with valid-check-digit ISBN via Crossref fallback + deduplication
        let mut v = Vault::new();
        v.net = Table::default().on("https://api.crossref.org/works?filter=isbn:9780306406157", Answer::Json(cr_book));
        v.cfg.pdf_sources_on = false;
        let added = add(&v.lib(), &json!({ "ids": { "isbn": "isbn:978-0-306-40615-7" } }), &|| Ok(Map::new()), &|_, _| panic!("no pdf sources")).unwrap();
        assert_eq!(added["created"], json!(true));
        let note_path = added["path"].as_str().unwrap();
        let note = std::fs::read_to_string(v.root.join(note_path)).unwrap();
        assert!(note.contains("itemType: book") && (note.contains("ISBN: '9780306406157'") || note.contains("ISBN: \"9780306406157\"") || note.contains("ISBN: 9780306406157")), "{note}");
        assert!(std::fs::read_to_string(v.root.join("refs/refs.bib")).unwrap().contains("@book{"));
        let again = add(&v.lib(), &json!({ "url": "isbn:9780306406157" }), &|| Ok(Map::new()), &|_, _| panic!("no pdf sources")).unwrap();
        assert_eq!(again["created"], json!(false));

        // catalog::add with synthetic ISBN-13 (not passing mod-10 check digit) still resolves via lookup_book_metadata
        let mut v2 = Vault::new();
        let ol_syn = json!({
            "ISBN:9780123456789": {
                "title": "Synthetic Workbook",
                "authors": [{ "name": "C. Author" }],
                "publish_date": "2022",
                "publishers": [{ "name": "Example House" }]
            }
        });
        v2.net = Table::default().on("https://openlibrary.org/api/books?bibkeys=ISBN:9780123456789", Answer::Json(ol_syn));
        v2.cfg.pdf_sources_on = false;
        let syn = add(&v2.lib(), &json!({ "ids": { "isbn": "978-0-12-345678-9" } }), &|| Ok(Map::new()), &|_, _| panic!("no pdf sources")).unwrap();
        assert_eq!(syn["created"], json!(true));
        let syn_again = add(&v2.lib(), &json!({ "ids": { "isbn": "9780123456789" } }), &|| Ok(Map::new()), &|_, _| panic!("no pdf sources")).unwrap();
        assert_eq!(syn_again["created"], json!(false));
    }
}
