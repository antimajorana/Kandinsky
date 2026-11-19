//! Universal paper ingestion (BibTeX, RIS, INSPIRE-HEP), multi-index remote search (`search_remote`), arXiv-to-journal
//! preprint upgrade (`upgrade_preprint`), and arXiv LaTeX e-print source unpacking & label/macro indexing (`fetch_arxiv_source`).
use crate::entry;
use crate::external::{path_in_external_roots, resolve_pdf_ref};
use crate::firstpage::{self, FirstPage};
use crate::net::Net;
use crate::pdf_meta::{extract_pdf_doc, is_junk_pdf_title, PdfDocExtract};
use crate::refs::{
    arxiv_of, citekey, classify_pdf, extract_pdf_identifiers_with_meta, fetch_arxiv_mapping,
    list as ylist, merge_local_fallbacks_with_meta, norm_doi, parse_filename, s as ys, year_of,
    ClassifyInput, ItemClass, Lib, Paper, ParsedFilename, PdfIds, Res,
};
use crate::remote::{self, enc, last_first, openalex_doi, parse_arxiv_versioned};
use flate2::read::GzDecoder;
use kandinsky_plugin::{q, Kandinsky};
use kandinsky_text::paths::{rel_path, safe_join};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as Json};
use serde_yaml::{Mapping, Value};
use std::io::Read;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RemoteCandidate {
    pub title: String, pub authors: Vec<String>, pub year: Option<String>, pub venue: Option<String>,
    pub doi: Option<String>, pub arxiv: Option<String>, pub isbn: Option<String>, pub source: String, pub citekey_hint: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PreprintUpgrade {
    pub key: String, pub upgraded: bool, pub dry_run: bool, pub source: Option<String>,
    pub doi: Option<String>, pub venue: Option<String>, pub paper: Paper,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct EnrichEntryOpts {
    pub key: String,
    pub dry_run: bool,
    pub rename_citekey: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EnrichEntryResult {
    pub key: String,
    pub old_key: String,
    pub upgraded: bool,
    pub dry_run: bool,
    pub source: Option<String>,
    pub doi: Option<String>,
    pub venue: Option<String>,
    pub paper: Paper,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ArxivSourceFetched {
    pub arxiv_id: String, pub dir: String, pub tex_files: Vec<String>, pub equation_labels: Vec<String>, pub macros: Vec<String>,
}

fn put(m: &mut Mapping, k: &str, v: Option<String>) {
    if let Some(s) = v.map(|x| x.trim().to_string()).filter(|x| !x.is_empty()) { m.insert(k.into(), s.into()); }
}

fn norm_author(raw: &str) -> String {
    let t = raw.trim().trim_matches(['{', '}']);
    if t.contains(',') { t.to_string() } else { last_first(t) }
}

pub fn parse_inspire_id(text: &str) -> Option<String> {
    let low = text.trim().to_ascii_lowercase();
    let rest = ["inspirehep.net/literature/", "inspirehep.net/api/literature/", "inspire:"].into_iter().find_map(|p| low.find(p).map(|i| &text.trim()[i + p.len()..]))?;
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    (!digits.is_empty()).then_some(digits)
}

pub fn inspire_fields(meta: &Json) -> Mapping {
    let mut m = Mapping::new();
    put(&mut m, "title", meta["titles"][0]["title"].as_str().map(String::from));
    let pub_info = &meta["publication_info"][0];
    let journal = pub_info["journal_title"].as_str().map(String::from);
    let doc_type = meta["document_type"][0].as_str().unwrap_or("");
    let kind = if journal.is_some() { "journalArticle" } else if doc_type == "book" { "book" } else if doc_type == "thesis" { "thesis" } else if meta["arxiv_eprints"][0]["value"].is_string() { "preprint" } else { "document" };
    m.insert("type".into(), kind.into());
    let authors: Vec<Value> = meta["authors"].as_array().into_iter().flatten().filter_map(|a| a["full_name"].as_str().map(|s| Value::from(norm_author(s)))).collect();
    if !authors.is_empty() { m.insert("author".into(), Value::Sequence(authors)); }
    let date = meta["imprints"][0]["date"].as_str().map(String::from).or_else(|| pub_info["year"].as_u64().map(|y| y.to_string())).or_else(|| meta["preprint_date"].as_str().map(String::from));
    put(&mut m, "date", date);
    put(&mut m, "publicationTitle", journal);
    put(&mut m, "volume", pub_info["journal_volume"].as_str().map(String::from));
    put(&mut m, "issue", pub_info["journal_issue"].as_str().map(String::from));
    let pages = match (pub_info["page_start"].as_str(), pub_info["page_end"].as_str()) {
        (Some(s), Some(e)) if s != e => Some(format!("{s}-{e}")),
        (Some(s), _) => Some(s.to_string()),
        _ => pub_info["artid"].as_str().map(String::from),
    };
    put(&mut m, "pages", pages);
    if let Some(doi) = meta["dois"].as_array().into_iter().flatten().filter_map(|d| d["value"].as_str()).find(|d| !d.to_lowercase().starts_with("10.48550/arxiv.")) {
        put(&mut m, "DOI", Some(doi.to_string()));
    }
    if let Some(ax) = meta["arxiv_eprints"][0]["value"].as_str() {
        put(&mut m, "archiveID", Some(format!("arXiv:{ax}")));
        m.entry("url".into()).or_insert_with(|| format!("https://arxiv.org/abs/{ax}").into());
    }
    put(&mut m, "ISBN", meta["isbns"][0]["value"].as_str().map(String::from));
    put(&mut m, "abstractNote", meta["abstracts"][0]["value"].as_str().map(String::from));
    if let Some(cn) = meta["control_number"].as_u64() {
        m.entry("url".into()).or_insert_with(|| format!("https://inspirehep.net/literature/{cn}").into());
    }
    m
}

pub fn inspire_by_id(net: &dyn Net, recid: &str) -> Res<Mapping> {
    let v = net.json(&format!("https://inspirehep.net/api/literature/{recid}")).map_err(|e| format!("INSPIRE-HEP: {e}"))?;
    let m = inspire_fields(&v["metadata"]);
    if m.contains_key("title") { Ok(m) } else { Err(format!("INSPIRE-HEP has no record {recid}")) }
}

pub fn parse_bibtex(input: &str) -> Option<(Option<String>, Mapping)> {
    let rest = input.trim().strip_prefix('@')?;
    let brace = rest.find('{')?;
    let entry_kind = rest[..brace].trim().to_ascii_lowercase();
    let inner = rest[brace + 1..].strip_suffix('}').unwrap_or(&rest[brace + 1..]);
    let comma = inner.find(',')?;
    let ck: String = inner[..comma].trim().chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.')).collect();
    let (mut fields, bytes, mut i) = (Vec::new(), &inner.as_bytes()[comma + 1..], 0usize);
    while i < bytes.len() {
        while i < bytes.len() && (bytes[i].is_ascii_whitespace() || bytes[i] == b',') { i += 1; }
        let ks = i;
        while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || matches!(bytes[i], b'_' | b'-')) { i += 1; }
        if ks == i { i += 1; continue; }
        let fname = String::from_utf8_lossy(&bytes[ks..i]).to_ascii_lowercase();
        while i < bytes.len() && bytes[i].is_ascii_whitespace() { i += 1; }
        if i >= bytes.len() || bytes[i] != b'=' { continue; }
        i += 1;
        while i < bytes.len() && bytes[i].is_ascii_whitespace() { i += 1; }
        if i >= bytes.len() { break; }
        let val = if bytes[i] == b'{' {
            i += 1;
            let (vs, mut depth) = (i, 1i32);
            while i < bytes.len() && depth > 0 {
                if bytes[i] == b'{' { depth += 1; } else if bytes[i] == b'}' { depth -= 1; }
                i += 1;
            }
            String::from_utf8_lossy(&bytes[vs..i.saturating_sub(1)]).into_owned()
        } else if bytes[i] == b'"' {
            i += 1;
            let vs = i;
            while i < bytes.len() && bytes[i] != b'"' { if bytes[i] == b'\\' { i += 1; } i += 1; }
            let s = String::from_utf8_lossy(&bytes[vs..i.min(bytes.len())]).into_owned();
            i += 1;
            s
        } else {
            let vs = i;
            while i < bytes.len() && !matches!(bytes[i], b',' | b'\n' | b'}') { i += 1; }
            String::from_utf8_lossy(&bytes[vs..i]).trim().to_string()
        };
        let cleaned = val.replace(['{', '}'], "").split_whitespace().collect::<Vec<_>>().join(" ");
        if !cleaned.is_empty() { fields.push((fname, cleaned)); }
    }
    if fields.is_empty() { return None; }
    let mut m = Mapping::new();
    let ztype = match entry_kind.as_str() {
        "article" => "journalArticle", "book" | "mvbook" => "book", "incollection" | "inbook" => "bookSection",
        "inproceedings" | "conference" => "conferencePaper", "phdthesis" | "mastersthesis" | "thesis" => "thesis",
        "techreport" | "report" => "report", "unpublished" => "manuscript",
        _ if fields.iter().any(|(k, v)| k == "eprint" || v.to_lowercase().contains("arxiv")) => "preprint",
        _ => "document",
    };
    m.insert("type".into(), ztype.into());
    for (k, v) in fields {
        match k.as_str() {
            "title" => put(&mut m, "title", Some(v)),
            "author" | "editor" => {
                let list: Vec<Value> = v.split(" and ").map(norm_author).filter(|s| !s.is_empty()).map(Value::from).collect();
                if !list.is_empty() { m.insert(k.as_str().into(), Value::Sequence(list)); }
            }
            "year" | "date" => put(&mut m, "date", Some(v)),
            "journal" | "journaltitle" => put(&mut m, "publicationTitle", Some(v)),
            "booktitle" => put(&mut m, "bookTitle", Some(v)),
            "volume" => put(&mut m, "volume", Some(v)),
            "number" | "issue" => put(&mut m, "issue", Some(v)),
            "pages" => put(&mut m, "pages", Some(v.replace("--", "-"))),
            "publisher" => put(&mut m, "publisher", Some(v)),
            "edition" => put(&mut m, "edition", Some(v)),
            "series" => put(&mut m, "series", Some(v)),
            "address" | "location" => put(&mut m, "place", Some(v)),
            "school" | "institution" => put(&mut m, "university", Some(v)),
            "doi" => put(&mut m, "DOI", Some(remote::parse_doi(&v).unwrap_or(v))),
            "isbn" => put(&mut m, "ISBN", Some(v)),
            "issn" => put(&mut m, "ISSN", Some(v)),
            "url" => put(&mut m, "url", Some(v)),
            "abstract" => put(&mut m, "abstractNote", Some(v)),
            "eprint" => match parse_arxiv_versioned(&v) {
                Some((ax, ver)) => {
                    put(&mut m, "archiveID", Some(format!("arXiv:{ax}{}", ver.clone().unwrap_or_default())));
                    if let Some(vr) = ver { put(&mut m, "arxivVersion", Some(vr)); }
                }
                None => put(&mut m, "archiveID", Some(v)),
            },
            "keywords" => {
                let tags: Vec<Value> = v.split([',', ';']).map(str::trim).filter(|s| !s.is_empty()).map(Value::from).collect();
                if !tags.is_empty() { m.insert("tags".into(), Value::Sequence(tags)); }
            }
            _ => {}
        }
    }
    m.contains_key("title").then(|| ((!ck.is_empty()).then_some(ck), m))
}

pub fn parse_ris(input: &str) -> Option<Mapping> {
    if !input.lines().any(|l| l.trim_start().starts_with("TY  -")) { return None; }
    let (mut m, mut authors, mut tags, mut sp, mut ep) = (Mapping::new(), Vec::new(), Vec::new(), None::<String>, None::<String>);
    m.insert("type".into(), "document".into());
    for line in input.lines() {
        let l = line.trim();
        if l.starts_with("ER  -") { break; }
        let Some((tag, val)) = l.split_once("  - ").map(|(k, v)| (k.trim(), v.trim())).filter(|(_, v)| !v.is_empty()) else { continue };
        match tag {
            "TY" => drop(m.insert("type".into(), match val { "JOUR" | "MGZN" => "journalArticle", "BOOK" => "book", "CHAP" => "bookSection", "CONF" | "CPAPER" => "conferencePaper", "THES" => "thesis", "RPRT" => "report", "UNPB" => "manuscript", _ => "document" }.into())),
            "TI" | "T1" => put(&mut m, "title", Some(val.into())),
            "AU" | "A1" => authors.push(Value::from(norm_author(val))),
            "PY" | "Y1" | "DA" => put(&mut m, "date", Some(year_of(val).unwrap_or_else(|| val.into()))),
            "JO" | "JF" | "T2" => put(&mut m, "publicationTitle", Some(val.into())),
            "VL" => put(&mut m, "volume", Some(val.into())),
            "IS" => put(&mut m, "issue", Some(val.into())),
            "SP" => sp = Some(val.into()),
            "EP" => ep = Some(val.into()),
            "PB" => put(&mut m, "publisher", Some(val.into())),
            "DO" => put(&mut m, "DOI", Some(remote::parse_doi(val).unwrap_or_else(|| val.into()))),
            "SN" => put(&mut m, "ISBN", Some(remote::parse_isbn(val).unwrap_or_else(|| val.into()))),
            "UR" => put(&mut m, "url", Some(val.into())),
            "AB" | "N2" => put(&mut m, "abstractNote", Some(val.into())),
            "KW" => tags.push(Value::from(val)),
            _ => {}
        }
    }
    if !authors.is_empty() { m.insert("author".into(), Value::Sequence(authors)); }
    if !tags.is_empty() { m.insert("tags".into(), Value::Sequence(tags)); }
    match (sp, ep) { (Some(s), Some(e)) => put(&mut m, "pages", Some(format!("{s}-{e}"))), (Some(s), None) => put(&mut m, "pages", Some(s)), _ => {} }
    m.contains_key("title").then_some(m)
}

fn candidate_from_mapping(m: &Mapping, source: &str) -> Option<RemoteCandidate> {
    let title = ys(m, "title")?;
    let authors = {
        let a = ylist(m, "author");
        if a.is_empty() { ylist(m, "authors") } else { a }
    };
    let year = ys(m, "date").and_then(|d| year_of(&d)).or_else(|| ys(m, "year").and_then(|d| year_of(&d)));
    let venue = ys(m, "publicationTitle").or_else(|| ys(m, "bookTitle")).or_else(|| ys(m, "publisher"));
    let citekey_hint = citekey(&authors, year.as_deref(), &title, &|_| false);
    Some(RemoteCandidate {
        title,
        authors,
        year,
        venue,
        doi: ys(m, "DOI").or_else(|| ys(m, "doi")),
        arxiv: arxiv_of(m),
        isbn: ys(m, "ISBN").or_else(|| ys(m, "isbn")),
        source: source.into(),
        citekey_hint,
    })
}

pub fn search_remote(net: &dyn Net, query: &str, source: &str, email: &str) -> Res<Vec<RemoteCandidate>> {
    let qstr = query.trim();
    if qstr.is_empty() { return Ok(Vec::new()); }
    let src = source.trim().to_ascii_lowercase();
    let (mut out, mut errs) = (Vec::new(), Vec::new());

    if matches!(src.as_str(), "" | "all" | "inspire" | "inspirehep") {
        match net.json(&format!("https://inspirehep.net/api/literature?q={}&size=10", enc(qstr, ""))) {
            Ok(v) => out.extend(v["hits"]["hits"].as_array().into_iter().flatten().filter_map(|h| candidate_from_mapping(&inspire_fields(&h["metadata"]), "inspire"))),
            Err(e) => errs.push(format!("inspire: {e}")),
        }
    }
    if matches!(src.as_str(), "all" | "arxiv") {
        match net.text(&format!("https://export.arxiv.org/api/query?max_results=10&search_query=all:{}", enc(qstr, ""))) {
            Ok(xml) => {
                for (ax, r) in remote::parse_atom_entries(&xml) {
                    let year = r.published.as_deref().and_then(year_of);
                    let citekey_hint = citekey(&r.authors, year.as_deref(), &r.title, &|_| false);
                    out.push(RemoteCandidate { title: r.title, authors: r.authors, year, venue: r.journal_ref, doi: r.doi, arxiv: ax, isbn: None, source: "arxiv".into(), citekey_hint });
                }
            }
            Err(e) => errs.push(format!("arxiv: {e}")),
        }
    }
    if matches!(src.as_str(), "all" | "crossref") {
        match net.json(&format!("https://api.crossref.org/works?rows=10&query.bibliographic={}", enc(qstr, ""))) {
            Ok(v) => out.extend(v["message"]["items"].as_array().into_iter().flatten().filter_map(|w| candidate_from_mapping(&remote::crossref_fields(w, w["DOI"].as_str().unwrap_or("")), "crossref"))),
            Err(e) => errs.push(format!("crossref: {e}")),
        }
    }
    if matches!(src.as_str(), "all" | "openalex") {
        let mail = if email.is_empty() { String::new() } else { format!("&mailto={}", enc(email, "")) };
        match net.json(&format!("https://api.openalex.org/works?per-page=10&search={}{mail}", enc(qstr, ""))) {
            Ok(v) => {
                for w in v["results"].as_array().into_iter().flatten() {
                    let Some(title) = w["display_name"].as_str().or_else(|| w["title"].as_str()).map(String::from) else { continue };
                    let authors: Vec<String> = w["authorships"].as_array().into_iter().flatten().filter_map(|a| a["author"]["display_name"].as_str().map(last_first)).collect();
                    let year = w["publication_year"].as_u64().map(|y| y.to_string());
                    let venue = w["primary_location"]["source"]["display_name"].as_str().map(String::from);
                    let raw_doi = openalex_doi(w);
                    let (doi, arxiv) = match raw_doi.strip_prefix("10.48550/arxiv.") { Some(a) => (None, Some(a.to_string())), None => ((!raw_doi.is_empty()).then_some(raw_doi), None) };
                    let citekey_hint = citekey(&authors, year.as_deref(), &title, &|_| false);
                    out.push(RemoteCandidate { title, authors, year, venue, doi, arxiv, isbn: None, source: "openalex".into(), citekey_hint });
                }
            }
            Err(e) => errs.push(format!("openalex: {e}")),
        }
    }
    if matches!(src.as_str(), "all" | "openlibrary" | "ol" | "open_library") {
        match remote::openlibrary_search(net, qstr, 10) {
            Ok(items) => out.extend(items.iter().filter_map(|m| candidate_from_mapping(m, "openlibrary"))),
            Err(e) => errs.push(format!("openlibrary: {e}")),
        }
    }
    if out.is_empty() && !errs.is_empty() { Err(errs.join("; ")) } else { Ok(out) }
}

/// Whether `m` represents a book or book section (`book`, `science_book`, `bookSection`, `incollection`, or has an ISBN).
pub fn is_book_entry(m: &Mapping) -> bool {
    let is_book_kind = |v: &str| {
        matches!(
            v.trim().to_ascii_lowercase().as_str(),
            "book" | "science_book" | "booksection" | "incollection" | "inbook" | "mvbook" | "monograph" | "edited-book" | "reference-book"
        )
    };
    ys(m, "type").as_deref().is_some_and(is_book_kind)
        || ys(m, "kind").as_deref().is_some_and(is_book_kind)
        || ys(m, "bibtexType").as_deref().is_some_and(is_book_kind)
        || ys(m, "ISBN").is_some()
        || ys(m, "isbn").is_some()
}

/// Enriches a book `Mapping` via [`remote::lookup_book_metadata`] without overwriting book kind/bibtexType into article types.
pub fn enrich_book_mapping(net: &dyn Net, m: &mut Mapping, email: &str) -> Option<&'static str> {
    let isbn = ys(m, "ISBN").or_else(|| ys(m, "isbn"));
    let doi = ys(m, "DOI").or_else(|| ys(m, "doi"));
    let title = ys(m, "title");
    let author = ylist(m, "author").into_iter().chain(ylist(m, "authors")).next();
    let (found, src) = remote::lookup_book_metadata(net, isbn.as_deref(), doi.as_deref(), title.as_deref(), author.as_deref(), email)?;

    let existing_type = ys(m, "type");
    let existing_kind = ys(m, "kind");
    let existing_bib = ys(m, "bibtexType");
    let is_section = existing_type.as_deref().is_some_and(|t| t.eq_ignore_ascii_case("booksection"))
        || existing_kind.as_deref().is_some_and(|k| k.eq_ignore_ascii_case("booksection"))
        || existing_bib.as_deref().is_some_and(|b| matches!(b.to_ascii_lowercase().as_str(), "incollection" | "inbook"));

    if existing_type.as_deref().is_none_or(|t| matches!(t, "" | "document" | "preprint")) {
        let target_type = if is_section { "bookSection".to_string() } else { ys(&found, "type").unwrap_or_else(|| "book".into()) };
        m.insert("type".into(), target_type.into());
    }
    if existing_kind.is_none() {
        let target_kind = ys(&found, "kind").unwrap_or_else(|| "book".into());
        m.insert("kind".into(), target_kind.into());
    }
    if existing_bib.is_none() {
        let target_bib = if is_section { "incollection".into() } else { ys(&found, "bibtexType").unwrap_or_else(|| "book".into()) };
        m.insert("bibtexType".into(), target_bib.into());
    }

    if ylist(m, "author").is_empty() && ylist(m, "authors").is_empty() {
        if let Some(seq) = found.get("author").and_then(Value::as_sequence).filter(|a| !a.is_empty()) {
            m.insert("author".into(), Value::Sequence(seq.clone()));
            if m.contains_key("authors") {
                m.insert("authors".into(), Value::Sequence(seq.clone()));
            }
        }
    }
    if ylist(m, "editor").is_empty() && ylist(m, "editors").is_empty() {
        if let Some(seq) = found.get("editor").and_then(Value::as_sequence).filter(|a| !a.is_empty()) {
            m.insert("editor".into(), Value::Sequence(seq.clone()));
            if m.contains_key("editors") {
                m.insert("editors".into(), Value::Sequence(seq.clone()));
            }
        }
    }

    if ys(m, "date").is_none() {
        put(m, "date", ys(&found, "date"));
    }
    if ys(m, "year").is_none() {
        put(m, "year", ys(&found, "year").or_else(|| ys(m, "date").and_then(|d| year_of(&d))));
    }
    if ys(m, "ISBN").is_none() {
        put(m, "ISBN", ys(m, "isbn").or_else(|| ys(&found, "ISBN")));
    }
    if m.contains_key("isbn") && ys(m, "isbn").is_none() {
        put(m, "isbn", ys(&found, "isbn"));
    }
    if ys(m, "DOI").is_none() && ys(m, "doi").is_none() {
        put(m, "DOI", ys(&found, "DOI"));
    }
    if ys(m, "abstractNote").is_none() && ys(m, "abstract").is_none() {
        put(m, "abstractNote", ys(&found, "abstractNote"));
    }
    for k in ["title", "publisher", "edition", "series", "volume", "url", "bookTitle", "numPages"] {
        if ys(m, k).is_none() {
            put(m, k, ys(&found, k));
        }
    }
    Some(src)
}

fn enrich_book_with_entry(lib: &Lib, cur_paper: Paper, dir: &Path, mut m: Mapping, dry_run: bool) -> Res<PreprintUpgrade> {
    let before = m.clone();
    let src = enrich_book_mapping(lib.net, &mut m, &lib.cfg.email);
    let upgraded = src.is_some() && m != before;
    let doi = ys(&m, "DOI").or_else(|| ys(&m, "doi"));
    let venue = ys(&m, "publisher").or_else(|| ys(&m, "bookTitle")).or_else(|| ys(&m, "series"));
    if upgraded && !dry_run {
        entry::write(lib.made, dir, &m)?;
        lib.write_bib()?;
    }
    let paper = if upgraded { lib.paper_of(dir, &cur_paper.key, &m) } else { cur_paper };
    Ok(PreprintUpgrade { key: paper.key.clone(), upgraded, dry_run, source: src.map(String::from), doi, venue, paper })
}

/// Enriches a book entry in the library via Crossref, OpenAlex, and OpenLibrary without overwriting its book kind.
pub fn enrich_book(lib: &Lib, key: &str, dry_run: bool) -> Res<PreprintUpgrade> {
    let cur_paper = lib.list()?.into_iter().find(|p| p.key == key).ok_or_else(|| format!("no reference {key}"))?;
    let dir = safe_join(lib.root, &cur_paper.dir)?;
    let m = entry::read(&dir).ok_or_else(|| format!("no reference {key}"))?;
    enrich_book_with_entry(lib, cur_paper, &dir, m, dry_run)
}

pub fn upgrade_preprint(lib: &Lib, key: &str, dry_run: bool) -> Res<PreprintUpgrade> {
    let cur_paper = lib.list()?.into_iter().find(|p| p.key == key).ok_or_else(|| format!("no reference {key}"))?;
    let dir = safe_join(lib.root, &cur_paper.dir)?;
    let mut m = entry::read(&dir).ok_or_else(|| format!("no reference {key}"))?;
    if is_book_entry(&m) {
        return enrich_book_with_entry(lib, cur_paper, &dir, m, dry_run);
    }
    let ax = arxiv_of(&m).ok_or_else(|| format!("{key} has no arXiv id"))?;
    let is_jdoi = |d: &str| !d.trim().is_empty() && !d.to_lowercase().contains("10.48550/arxiv.");

    let mut found: Option<(Mapping, &'static str)> = None;
    if let Ok(v) = lib.net.json(&format!("https://inspirehep.net/api/literature?q=arxiv:{}", enc(&ax, "/"))) {
        if let Some(hit) = v["hits"]["hits"].as_array().and_then(|a| a.first()) {
            let im = inspire_fields(&hit["metadata"]);
            if ys(&im, "DOI").as_deref().is_some_and(is_jdoi) || ys(&im, "publicationTitle").is_some() { found = Some((im, "INSPIRE-HEP")); }
        }
    }
    if found.is_none() {
        if let Ok(rec) = remote::arxiv_record(lib.net, &ax) {
            if let Some(doi) = rec.doi.filter(|d| is_jdoi(d)) {
                found = Some(match remote::crossref(lib.net, &doi) {
                    Ok(cm) => (cm, "Crossref (via arXiv)"),
                    Err(_) => { let mut am = Mapping::new(); put(&mut am, "DOI", Some(doi)); put(&mut am, "publicationTitle", rec.journal_ref); (am, "arXiv") }
                });
            }
        }
    }
    if found.is_none() {
        let mail = if lib.cfg.email.is_empty() { String::new() } else { format!("?mailto={}", enc(&lib.cfg.email, "")) };
        if let Ok(w) = lib.net.json(&format!("https://api.openalex.org/works/doi:10.48550/arxiv.{}{mail}", enc(&ax.to_lowercase(), "/"))) {
            let odoi = openalex_doi(&w);
            if is_jdoi(&odoi) {
                let cm = remote::crossref(lib.net, &odoi).unwrap_or_else(|_| {
                    let mut om = Mapping::new();
                    put(&mut om, "DOI", Some(odoi));
                    put(&mut om, "publicationTitle", w["primary_location"]["source"]["display_name"].as_str().map(String::from));
                    put(&mut om, "volume", w["biblio"]["volume"].as_str().map(String::from));
                    put(&mut om, "issue", w["biblio"]["issue"].as_str().map(String::from));
                    put(&mut om, "date", w["publication_date"].as_str().map(String::from));
                    om
                });
                found = Some((cm, "OpenAlex"));
            }
        }
    }
    if found.is_none() {
        if let Some(title) = ys(&m, "title") {
            let fp = FirstPage { title, authors: ylist(&m, "author"), year: ys(&m, "date").and_then(|d| year_of(&d)) };
            if let Some(cm) = firstpage::crossref_match(lib.net, &fp).filter(|d| is_jdoi(d)).and_then(|d| remote::crossref(lib.net, &d).ok()) {
                found = Some((cm, "Crossref"));
            }
        }
    }

    let Some((mut pub_m, src)) = found else {
        return Ok(PreprintUpgrade { key: key.into(), upgraded: false, dry_run, source: None, doi: None, venue: None, paper: cur_paper });
    };
    if let Some(d) = ys(&pub_m, "DOI").filter(|d| is_jdoi(d) && ys(&pub_m, "publicationTitle").is_none()) {
        if let Ok(cm) = remote::crossref(lib.net, &d) { for (ck, cv) in cm { pub_m.entry(ck).or_insert(cv); } }
    }
    let next_type = match ys(&pub_m, "type").as_deref() {
        Some(t @ ("book" | "bookSection" | "science_book")) => t.to_string(),
        _ => "journalArticle".to_string(),
    };
    m.insert("type".into(), next_type.into());
    for fk in ["DOI", "publicationTitle", "volume", "issue", "pages", "publisher", "date"] {
        if let Some(val) = ys(&pub_m, fk) { m.insert(fk.into(), val.into()); }
    }
    let (doi, venue) = (ys(&m, "DOI"), ys(&m, "publicationTitle"));
    if !dry_run { entry::write(lib.made, &dir, &m)?; lib.write_bib()?; }
    Ok(PreprintUpgrade { key: key.into(), upgraded: true, dry_run, source: Some(src.into()), doi, venue, paper: lib.paper_of(&dir, key, &m) })
}

fn is_placeholder_title(cur: Option<&str>, pdf_stem: Option<&str>, key: &str) -> bool {
    let Some(t) = cur.map(str::trim).filter(|s| !s.is_empty()) else {
        return true;
    };
    if is_junk_pdf_title(t) || t.eq_ignore_ascii_case(key) {
        return true;
    };
    let norm = |s: &str| {
        s.replace(['_', '-'], " ")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_ascii_lowercase()
    };
    let nt = norm(t);
    let nkey = norm(key);
    if !nkey.is_empty() && !key.chars().any(|c| c.is_ascii_digit()) && (nt == nkey || nt.starts_with(&format!("{nkey} "))) {
        return true;
    }
    pdf_stem.is_some_and(|st| {
        let nst = norm(st);
        !nst.is_empty() && nt == nst
    })
}

fn merge_enriched_remote(m: &mut Mapping, rm: &Mapping, pdf_stem: Option<&str>, key: &str) {
    let unverified_local = ylist(m, "author").is_empty()
        && ylist(m, "authors").is_empty()
        && ys(m, "publicationTitle").is_none()
        && ys(m, "publisher").is_none();
    if unverified_local || is_placeholder_title(ys(m, "title").as_deref(), pdf_stem, key) {
        if let Some(rt) = ys(rm, "title").filter(|t| !is_junk_pdf_title(t)) {
            m.insert("title".into(), rt.into());
        }
    }
    let cur_type = ys(m, "type").unwrap_or_default();
    if matches!(cur_type.as_str(), "" | "document" | "preprint") {
        if let Some(rt) = ys(rm, "type").filter(|t| !matches!(t.as_str(), "" | "document")) {
            if cur_type != "preprint" || rt == "journalArticle" {
                m.insert("type".into(), rt.into());
            }
        }
    }
    if ylist(m, "author").is_empty() && ylist(m, "authors").is_empty() {
        let ra = ylist(rm, "author");
        if !ra.is_empty() {
            m.insert("author".into(), Value::Sequence(ra.into_iter().map(Value::from).collect()));
        }
    }
    if ylist(m, "editor").is_empty() && ylist(rm, "editors").is_empty() {
        let re = ylist(rm, "editor");
        if !re.is_empty() {
            m.insert("editor".into(), Value::Sequence(re.into_iter().map(Value::from).collect()));
        }
    }
    for k in [
        "title", "date", "publicationTitle", "proceedingsTitle", "bookTitle", "publisher",
        "university", "volume", "issue", "pages", "DOI", "archiveID", "arxivVersion",
        "repository", "ISBN", "ISSN", "abstractNote", "url", "edition", "series", "numPages",
    ] {
        if ys(m, k).is_none() {
            if let Some(v) = ys(rm, k) {
                m.insert(k.into(), v.into());
            }
        }
    }
    if ylist(m, "tags").is_empty() {
        let tags = ylist(rm, "tags");
        if !tags.is_empty() {
            m.insert("tags".into(), Value::Sequence(tags.into_iter().map(Value::from).collect()));
        }
    }
}

/// Re-reads an entry's linked PDF (`/Info`, XMP, multi-page `firstpage`) and queries remote indexes
/// to backfill missing or raw-filename metadata, optionally renaming the citekey and relinking citations.
pub fn enrich_entry(lib: &Lib, opts: &EnrichEntryOpts) -> Res<EnrichEntryResult> {
    let old_key = opts.key.trim().to_string();
    let cur_paper = lib.list()?.into_iter().find(|p| p.key == old_key).ok_or_else(|| format!("no reference {old_key}"))?;
    let dir = safe_join(lib.root, &cur_paper.dir)?;
    let mut m = entry::read(&dir).ok_or_else(|| format!("no reference {old_key}"))?;
    let before = m.clone();

    let mut pdf_extract = PdfDocExtract::default();
    let mut parsed = ParsedFilename::default();
    let mut first: Option<FirstPage> = None;
    let mut pdf_stem: Option<String> = None;
    if let Some(abs) = cur_paper.pdf.as_deref().and_then(|r| lib.pdf_abs_path(r)) {
        if let Ok(bytes) = std::fs::read(&abs) {
            if bytes.starts_with(b"%PDF") {
                let fname = abs.file_name().and_then(|n| n.to_str()).unwrap_or("paper.pdf");
                pdf_stem = abs.file_stem().and_then(|n| n.to_str()).map(String::from);
                parsed = parse_filename(fname);
                pdf_extract = extract_pdf_doc(&bytes);
                first = firstpage::read_pages(&pdf_extract.text, fname);
            }
        }
    }

    let pdf_ids = extract_pdf_identifiers_with_meta(
        &pdf_extract.text,
        pdf_extract.pages,
        pdf_stem.as_deref().unwrap_or(""),
        Some(&pdf_extract.meta),
    );
    let ids = PdfIds {
        doi: ys(&m, "DOI").or_else(|| ys(&m, "doi")).or(pdf_ids.doi),
        arxiv: arxiv_of(&m).or(pdf_ids.arxiv),
        arxiv_version: ys(&m, "arxivVersion").or(pdf_ids.arxiv_version),
        isbn: ys(&m, "ISBN").or_else(|| ys(&m, "isbn")).or(pdf_ids.isbn),
    };
    let class = classify_pdf(&ClassifyInput {
        text: &pdf_extract.text,
        pages: pdf_extract.pages,
        filename: pdf_stem.as_deref().unwrap_or(""),
        rel_dir: None,
        parsed: &parsed,
        isbn: ids.isbn.as_deref(),
        doi: ids.doi.as_deref(),
        arxiv: ids.arxiv.as_deref(),
        remote_type: ys(&m, "type").as_deref(),
        explicit_kind: None,
    });

    if is_book_entry(&m) || class == ItemClass::Book {
        merge_local_fallbacks_with_meta(&mut m, &parsed, first.as_ref(), Some(&pdf_extract.meta), &ids, pdf_extract.pages, ItemClass::Book);
        let src = enrich_book_mapping(lib.net, &mut m, &lib.cfg.email).map(String::from);
        if is_placeholder_title(ys(&before, "title").as_deref(), pdf_stem.as_deref(), &old_key) {
            if let Some((found, _)) = remote::lookup_book_metadata(
                lib.net,
                ids.isbn.as_deref(),
                ids.doi.as_deref(),
                ys(&m, "title").as_deref(),
                ylist(&m, "author").first().map(String::as_str),
                &lib.cfg.email,
            ) {
                if let Some(rt) = ys(&found, "title").filter(|t| !is_junk_pdf_title(t)) {
                    m.insert("title".into(), rt.into());
                }
            }
        }
        return finish_enrich_entry(lib, &dir, &old_key, before, m, src, opts);
    }

    let mut remote_hit: Option<(Mapping, &'static str)> = None;
    if let Some(ref d) = ids.doi {
        if !norm_doi(d).starts_with("10.48550/arxiv.") {
            if let Ok(cm) = remote::crossref_with_openalex(lib.net, d, &lib.cfg.email) {
                remote_hit = Some((cm, "crossref"));
            }
        }
    }
    if remote_hit.is_none() {
        if let Some(ref ax) = ids.arxiv {
            if let Some(am) = fetch_arxiv_mapping(lib.net, ax, ids.arxiv_version.as_deref()) {
                remote_hit = Some((am, "arxiv"));
            }
        }
    }
    if remote_hit.is_none() {
        let title_hint = first
            .as_ref()
            .map(|f| f.title.clone())
            .or_else(|| pdf_extract.meta.title.clone())
            .or_else(|| ys(&m, "title").filter(|t| !is_junk_pdf_title(t)))
            .or_else(|| (parsed.structured && !parsed.title.is_empty()).then(|| parsed.title.clone()));
        let mut authors_hint = ylist(&m, "author");
        if authors_hint.is_empty() {
            if let Some(fp) = &first {
                authors_hint = fp.authors.clone();
            } else if !pdf_extract.meta.authors.is_empty() {
                authors_hint = pdf_extract.meta.authors.clone();
            } else {
                authors_hint = parsed.authors.clone();
            }
        }
        let year_hint = ys(&m, "date")
            .and_then(|d| year_of(&d))
            .or_else(|| first.as_ref().and_then(|f| f.year.clone()))
            .or_else(|| parsed.year.clone())
            .or_else(|| pdf_extract.meta.year.clone());
        if let Some(t) = title_hint {
            remote_hit = remote::lookup_work_by_title_author(lib.net, &lib.cfg.email, &t, &authors_hint, year_hint.as_deref());
        }
    }

    let source = remote_hit.as_ref().map(|(_, s)| (*s).to_string());
    if let Some((rm, _)) = remote_hit {
        merge_enriched_remote(&mut m, &rm, pdf_stem.as_deref(), &old_key);
    }
    merge_local_fallbacks_with_meta(&mut m, &parsed, first.as_ref(), Some(&pdf_extract.meta), &ids, pdf_extract.pages, class);
    finish_enrich_entry(lib, &dir, &old_key, before, m, source, opts)
}

fn finish_enrich_entry(
    lib: &Lib,
    dir: &Path,
    old_key: &str,
    before: Mapping,
    mut m: Mapping,
    source: Option<String>,
    opts: &EnrichEntryOpts,
) -> Res<EnrichEntryResult> {
    let mut final_dir = dir.to_path_buf();
    let mut final_key = old_key.to_string();
    let mut renamed = false;

    if opts.rename_citekey && !opts.dry_run {
        let title = ys(&m, "title").unwrap_or_default();
        let authors = ylist(&m, "author");
        let year = ys(&m, "date").and_then(|d| year_of(&d));
        let base = safe_join(lib.root, &lib.cfg.dir)?;
        let cand_key = citekey(&authors, year.as_deref(), &title, &|k| k != old_key && base.join(k).exists());
        if !cand_key.is_empty() && cand_key != old_key && !base.join(&cand_key).exists() {
            let mut aliases = ylist(&m, "aliases");
            if !aliases.iter().any(|a| a == old_key) {
                aliases.push(old_key.to_string());
                m.insert("aliases".into(), Value::Sequence(aliases.into_iter().map(Value::from).collect()));
            }
            m.insert("citekey".into(), cand_key.clone().into());
            let old_pdf_name = format!("{old_key}.pdf");
            let new_pdf_name = format!("{cand_key}.pdf");
            let old_pdf_in_dir = dir.join(&old_pdf_name);
            let new_pdf_in_dir = dir.join(&new_pdf_name);
            if old_pdf_in_dir.is_file() && !new_pdf_in_dir.exists() {
                kandinsky_plugin::move_path(&old_pdf_in_dir, &new_pdf_in_dir).map_err(|e| e.to_string())?;
                if let Some(Value::Sequence(files)) = m.get_mut("files") {
                    for f in files.iter_mut() {
                        if f.as_str() == Some(old_pdf_name.as_str()) {
                            *f = Value::from(new_pdf_name.clone());
                        }
                    }
                }
            }
            let old_note = dir.join(entry::note_file(old_key));
            let new_note_in_old = dir.join(entry::note_file(&cand_key));
            if old_note.is_file() && !new_note_in_old.exists() {
                kandinsky_plugin::move_path(&old_note, &new_note_in_old).map_err(|e| e.to_string())?;
            }
            let new_dir = base.join(&cand_key);
            kandinsky_plugin::move_path(dir, &new_dir).map_err(|e| e.to_string())?;
            final_dir = new_dir;
            final_key = cand_key;
            renamed = true;
        }
    }

    let upgraded = m != before || renamed;
    if upgraded && !opts.dry_run {
        entry::write(lib.made, &final_dir, &m)?;
        if renamed {
            crate::inbox_dedupe::relink_vault_citations(lib.root, old_key, &final_key);
        }
        lib.write_bib()?;
    }
    let doi = ys(&m, "DOI").or_else(|| ys(&m, "doi"));
    let venue = ys(&m, "publicationTitle").or_else(|| ys(&m, "publisher")).or_else(|| ys(&m, "bookTitle"));
    let paper = lib.paper_of(&final_dir, &final_key, &m);
    Ok(EnrichEntryResult {
        key: final_key,
        old_key: old_key.to_string(),
        upgraded,
        dry_run: opts.dry_run,
        source,
        doi,
        venue,
        paper,
    })
}

fn fetch_eprint_bytes(lib: &Lib, plugin_id: &str, url: &str, safe_id: &str) -> Res<Vec<u8>> {
    match lib.net.raw_bytes(url) {
        Ok(b) => return Ok(b),
        Err(e) if e != "not supported" => return Err(e),
        Err(_) => {}
    }
    let req = json!({ "url": url, "timeout_secs": 90, "save_to": format!("eprint-{safe_id}.bin"), "headers": { "user-agent": "Kandinsky/0.1 (research workspace)" } });
    let r = Kandinsky::new().post(&format!("/api/plugins/{}/fetch", q(plugin_id)), &req).map_err(|e| e.why)?;
    if r["ok"].as_bool() != Some(true) {
        return Err(format!("{url}: {}", r["status"].as_u64().map_or("no answer".into(), |s| format!("HTTP {s}"))));
    }
    let saved = r["saved"].as_str().ok_or_else(|| format!("{url}: nothing saved"))?;
    let path = safe_join(lib.root, saved)?;
    let bytes = std::fs::read(&path).map_err(|e| format!("{saved}: {e}"))?;
    let _ = std::fs::remove_file(&path);
    Ok(bytes)
}

fn looks_like_tar(bytes: &[u8]) -> bool {
    bytes.len() >= 512 && (&bytes[257..262] == b"ustar" || (bytes[..100].iter().any(|&b| b != 0) && bytes[148..156].iter().any(|&b| b.is_ascii_digit())))
}

fn unpack_tar_safely(tar_bytes: &[u8], dest_dir: &Path) -> Res<()> {
    for item in tar::Archive::new(tar_bytes).entries().map_err(|e| format!("tar entries: {e}"))? {
        let mut entry = item.map_err(|e| format!("tar entry: {e}"))?;
        let et = entry.header().entry_type();
        if et.is_symlink() || et.is_hard_link() { return Err("tar archive contains disallowed symlink or hard-link".into()); }
        let path = entry.path().map_err(|e| format!("tar path: {e}"))?.into_owned();
        let mut parts = Vec::new();
        for comp in path.components() {
            match comp {
                Component::Normal(c) => parts.push(c.to_string_lossy().into_owned()),
                Component::CurDir => {}
                Component::ParentDir | Component::RootDir | Component::Prefix(_) => return Err(format!("unsafe path in tar: {}", path.display())),
            }
        }
        if parts.is_empty() { continue; }
        let target = safe_join(dest_dir, &parts.join("/"))?;
        if et.is_dir() {
            std::fs::create_dir_all(&target).map_err(|e| format!("{}: {e}", target.display()))?;
        } else if et.is_file() || et == tar::EntryType::Continuous {
            let mut buf = Vec::new();
            entry.by_ref().take(64 * 1024 * 1024).read_to_end(&mut buf).map_err(|e| format!("read tar entry: {e}"))?;
            kandinsky_plugin::write_file(&target, &buf).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn strip_tex_comment(line: &str) -> &str {
    let b = line.as_bytes();
    (0..b.len()).find(|&i| b[i] == b'%' && (i == 0 || b[i - 1] != b'\\')).map_or(line, |i| &line[..i])
}

fn scan_tex_tree(dest_dir: &Path) -> (Vec<String>, Vec<String>, Vec<String>) {
    let (mut tex_files, mut labels, mut macros, mut stack) = (Vec::new(), Vec::new(), Vec::new(), vec![dest_dir.to_path_buf()]);
    while let Some(d) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for p in rd.flatten().map(|e| e.path()) {
            if p.is_dir() { stack.push(p); continue; }
            let ext = p.extension().and_then(|x| x.to_str()).unwrap_or("");
            if !ext.eq_ignore_ascii_case("tex") && !ext.eq_ignore_ascii_case("sty") { continue; }
            if ext.eq_ignore_ascii_case("tex") { if let Some(r) = rel_path(dest_dir, &p) { tex_files.push(r); } }
            let Ok(content) = std::fs::read_to_string(&p) else { continue };
            for raw_line in content.lines() {
                let line = strip_tex_comment(raw_line).trim();
                let mut rest = line;
                while let Some(idx) = rest.find("\\label{") {
                    let after = &rest[idx + 7..];
                    let Some(end) = after.find('}') else { break };
                    let lbl = after[..end].trim().to_string();
                    if !lbl.is_empty() && !labels.contains(&lbl) { labels.push(lbl); }
                    rest = &after[end + 1..];
                }
                if ["\\newcommand", "\\renewcommand", "\\providecommand", "\\DeclareMathOperator"].iter().any(|m| line.contains(m)) && !macros.contains(&line.to_string()) {
                    macros.push(line.to_string());
                }
            }
        }
    }
    tex_files.sort();
    (tex_files, labels, macros)
}

pub fn fetch_arxiv_source(lib: &Lib, plugin_id: &str, id_or_key: &str) -> Res<ArxivSourceFetched> {
    let target = id_or_key.trim();
    if target.is_empty() { return Err("an arXiv id or citekey is needed".into()); }
    let full_id = if let Ok(p) = lib.list().and_then(|all| all.into_iter().find(|p| p.key == target).ok_or_else(String::new)) {
        let m = entry::read(&safe_join(lib.root, &p.dir)?).unwrap_or_default();
        format!("{}{}", arxiv_of(&m).ok_or_else(|| format!("{target} has no arXiv id"))?, ys(&m, "arxivVersion").unwrap_or_default())
    } else {
        let (base, ver) = parse_arxiv_versioned(target).ok_or_else(|| format!("not a citekey or arXiv id: {target}"))?;
        format!("{base}{}", ver.unwrap_or_default())
    };

    let safe_id: String = full_id.chars().map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { '_' }).collect();
    let dest_dir: PathBuf = if !lib.cfg.arxiv_source_dir.trim().is_empty() {
        let base_dir = resolve_pdf_ref(lib.root, lib.cfg, &lib.cfg.arxiv_source_dir).map(|(_, abs)| abs).or_else(|| safe_join(lib.root, &lib.cfg.arxiv_source_dir).ok()).ok_or_else(|| format!("invalid arxiv_source_dir: {:?}", lib.cfg.arxiv_source_dir))?;
        std::fs::create_dir_all(&base_dir).map_err(|e| format!("{}: {e}", base_dir.display()))?;
        safe_join(&base_dir, &safe_id)?
    } else {
        safe_join(lib.root, &kandinsky_plugin::live_rel(lib.root, &format!(".kandinsky/cache/arxiv-src/{safe_id}")))?
    };
    std::fs::create_dir_all(&dest_dir).map_err(|e| format!("{}: {e}", dest_dir.display()))?;

    let raw = fetch_eprint_bytes(lib, plugin_id, &format!("https://arxiv.org/e-print/{}", enc(&full_id, "/")), &safe_id)?;
    if raw.starts_with(&[0x1f, 0x8b]) {
        let mut dec = Vec::new();
        GzDecoder::new(raw.as_slice()).take(128 * 1024 * 1024).read_to_end(&mut dec).map_err(|e| format!("gunzip {full_id}: {e}"))?;
        if looks_like_tar(&dec) { unpack_tar_safely(&dec, &dest_dir)?; } else { kandinsky_plugin::write_file(dest_dir.join("main.tex"), &dec).map_err(|e| e.to_string())?; }
    } else if looks_like_tar(&raw) {
        unpack_tar_safely(&raw, &dest_dir)?;
    } else if !raw.starts_with(b"%PDF") && std::str::from_utf8(&raw).is_ok_and(|t| !t.trim_start().starts_with("<!DOCTYPE") && !t.trim_start().starts_with("<html")) {
        kandinsky_plugin::write_file(dest_dir.join("main.tex"), &raw).map_err(|e| e.to_string())?;
    } else {
        return Err(format!("arXiv e-print {full_id}: unsupported payload (PDF-only or HTML error)"));
    }

    let (tex_files, equation_labels, macros) = scan_tex_tree(&dest_dir);
    let dir_str = path_in_external_roots(lib.root, lib.cfg, &dest_dir).map(|(p, _)| p).or_else(|| rel_path(lib.root, &dest_dir)).unwrap_or_else(|| dest_dir.to_string_lossy().into_owned());
    Ok(ArxivSourceFetched { arxiv_id: full_id, dir: dir_str, tex_files, equation_labels, macros })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::net::fake::{Answer, Table};
    use crate::refs::tests::Vault;
    use flate2::{write::GzEncoder, Compression};
    use std::io::Write;

    #[test]
    fn parses_bibtex_ris_upgrades_preprints_and_unpacks_arxiv_tar_gz_safely() {
        let (ck, bm) = parse_bibtex("@article{kitaev2006anyons,\n  title = {Anyons in an exactly solved model},\n  author = {Kitaev, Alexei},\n  year = {2006},\n  journal = {Annals of Physics},\n  doi = {10.1016/j.aop.2005.10.005}\n}").unwrap();
        assert_eq!((ck.as_deref(), ys(&bm, "type").as_deref(), ys(&bm, "publicationTitle").as_deref()), (Some("kitaev2006anyons"), Some("journalArticle"), Some("Annals of Physics")));
        let rm = parse_ris("TY  - JOUR\nTI  - Quantum Spin Liquids\nAU  - Balents, Leon\nPY  - 2010\nJO  - Nature\nDO  - 10.1038/nature08917\nER  - \n").unwrap();
        assert_eq!((ys(&rm, "title").as_deref(), ys(&rm, "DOI").as_deref()), (Some("Quantum Spin Liquids"), Some("10.1038/nature08917")));

        let mut v = Vault::new();
        let inspire_json = json!({ "hits": { "hits": [{ "metadata": {
            "titles": [{ "title": "Anyons in an exactly solved model" }], "authors": [{ "full_name": "Kitaev, Alexei" }],
            "dois": [{ "value": "10.1016/j.aop.2005.10.005" }], "arxiv_eprints": [{ "value": "cond-mat/0506438" }],
            "publication_info": [{ "journal_title": "Annals Phys.", "journal_volume": "321", "page_start": "2", "page_end": "111", "year": 2006 }]
        } }] } });

        let mut tar_buf = Vec::new();
        {
            let mut builder = tar::Builder::new(&mut tar_buf);
            let tex = b"\\documentclass{article}\n\\newcommand{\\Hhat}{\\hat{H}}\n\\DeclareMathOperator{\\Tr}{Tr}\n\\begin{document}\n\\begin{equation}\\label{eq:hamiltonian} H = 0 \\end{equation}\n\\end{document}\n";
            let mut hdr = tar::Header::new_gnu();
            hdr.set_size(tex.len() as u64);
            hdr.set_mode(0o644);
            hdr.set_cksum();
            builder.append_data(&mut hdr, "paper.tex", &tex[..]).unwrap();
            builder.finish().unwrap();
        }
        let mut gz = GzEncoder::new(Vec::new(), Compression::default());
        gz.write_all(&tar_buf).unwrap();
        let tgz_bytes = gz.finish().unwrap();

        let atom = "<feed><entry><title>Anyons</title><published>2005-06-17T00:00:00Z</published><author><name>Alexei Kitaev</name></author></entry></feed>";
        v.net = Table::default()
            .on("https://export.arxiv.org/api/query?id_list=2401.12345v3", Answer::Text(atom.into()))
            .on("https://inspirehep.net/api/literature?q=arxiv:2401.12345", Answer::Json(inspire_json.clone()))
            .on("https://inspirehep.net/api/literature?q=kitaev", Answer::Json(inspire_json))
            .on("https://arxiv.org/e-print/2401.12345v3", Answer::Bytes(tgz_bytes));
        v.cfg.download_pdfs = false;

        let cands = search_remote(&v.net, "kitaev", "inspire", "").unwrap();
        assert_eq!((cands.len(), cands[0].doi.as_deref()), (1, Some("10.1016/j.aop.2005.10.005")));
        let added = v.lib().add("https://arxiv.org/abs/2401.12345v3").unwrap();
        let key = added.paper.key;
        let up = upgrade_preprint(&v.lib(), &key, false).unwrap();
        assert!(up.upgraded && up.paper.kind == "journalArticle" && up.doi.as_deref() == Some("10.1016/j.aop.2005.10.005"));
        let after_m = entry::read(&v.root.join(&up.paper.dir)).unwrap();
        assert_eq!((ys(&after_m, "arxivVersion").as_deref(), ys(&after_m, "archiveID").as_deref()), (Some("v3"), Some("arXiv:2401.12345v3")));

        let src = fetch_arxiv_source(&v.lib(), "catalog-papers", &key).unwrap();
        assert_eq!((src.arxiv_id.as_str(), src.tex_files.clone(), src.equation_labels.clone(), src.macros.len()), ("2401.12345v3", vec!["paper.tex".to_string()], vec!["eq:hamiltonian".to_string()], 2));
    }

    #[test]
    fn searches_openlibrary_and_enriches_books_without_overwriting_book_kind() {
        let ol_q = json!({
            "docs": [{
                "title": "Synthetic Lattice Models",
                "author_name": ["Ada Example"],
                "first_publish_year": 2019,
                "publisher": ["Example Press"],
                "isbn": ["978-0-306-40615-7"],
                "key": "/works/OL42W"
            }]
        });
        let net = Table::default().on("https://openlibrary.org/search.json?q=lattice", Answer::Json(ol_q));
        let hits = search_remote(&net, "lattice", "openlibrary", "").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!((hits[0].source.as_str(), hits[0].isbn.as_deref(), hits[0].venue.as_deref(), hits[0].year.as_deref()), ("openlibrary", Some("9780306406157"), Some("Example Press"), Some("2019")));

        // Parse book BibTeX with edition & series
        let (_, bm) = parse_bibtex("@book{example2021quantum,\n  title = {Synthetic Quantum Mechanics},\n  author = {Example, Ada},\n  year = {2021},\n  edition = {2nd},\n  series = {Graduate Texts in Physics},\n  publisher = {Example Press},\n  isbn = {978-0-306-40615-7}\n}").unwrap();
        assert_eq!((ys(&bm, "type").as_deref(), ys(&bm, "edition").as_deref(), ys(&bm, "series").as_deref()), (Some("book"), Some("2nd"), Some("Graduate Texts in Physics")));

        // Enrich a science_book entry (even if it carries an arXiv ID) -> keeps book / science_book, never becomes @article
        let mut v = Vault::new();
        let dir = v.root.join("refs/papers/example2021quantum");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("example2021quantum.md"),
            "---\ntype: literature\ncitekey: example2021quantum\nitemType: book\nkind: science_book\nbibtexType: book\ntitle: Synthetic Quantum Mechanics\nISBN: 978-0-306-40615-7\narchiveID: arXiv:2101.00001\n---\n# Synthetic Quantum Mechanics\n",
        ).unwrap();
        let cr_book = json!({
            "message": {
                "items": [{
                    "type": "monograph",
                    "title": ["Synthetic Quantum Mechanics"],
                    "author": [{ "family": "Example", "given": "Ada" }],
                    "issued": { "date-parts": [[2021]] },
                    "publisher": "Example University Press",
                    "edition-number": "2",
                    "container-title": ["Graduate Texts in Physics"],
                    "ISBN": ["9780306406157"],
                    "DOI": "10.1000/book.example.1"
                }]
            }
        });
        v.net = Table::default().on("https://api.crossref.org/works?filter=isbn:9780306406157", Answer::Json(cr_book));
        let up = upgrade_preprint(&v.lib(), "example2021quantum", false).unwrap();
        assert!(up.upgraded);
        assert_eq!(up.source.as_deref(), Some("crossref"));
        assert_eq!(up.paper.kind, "book");
        assert_eq!(up.paper.year.as_deref(), Some("2021"));
        assert_eq!(up.paper.authors, vec!["Example, Ada"]);
        let after = entry::read(&dir).unwrap();
        assert_eq!((ys(&after, "type").as_deref(), ys(&after, "kind").as_deref(), ys(&after, "bibtexType").as_deref()), (Some("book"), Some("science_book"), Some("book")));
        assert_eq!((ys(&after, "publisher").as_deref(), ys(&after, "edition").as_deref(), ys(&after, "series").as_deref()), (Some("Example University Press"), Some("2"), Some("Graduate Texts in Physics")));
        let bib = v.lib().bibtex("example2021quantum").unwrap();
        assert!(bib.starts_with("@book{example2021quantum,") && !bib.contains("@article"), "{bib}");

        // Book section (`bibtexType: incollection`) preserves incollection / bookSection
        let mut sec = Mapping::new();
        sec.insert("title".into(), "Chapter One: Operators".into());
        sec.insert("bibtexType".into(), "incollection".into());
        sec.insert("DOI".into(), "10.1000/chapter.example.1".into());
        let cr_chap = json!({
            "message": {
                "type": "book-chapter",
                "title": ["Chapter One: Operators"],
                "author": [{ "family": "Writer", "given": "B." }],
                "container-title": ["Handbook of Synthetic Methods"],
                "issued": { "date-parts": [[2020]] },
                "publisher": "Example House",
                "DOI": "10.1000/chapter.example.1"
            }
        });
        let net = Table::default().on("https://api.crossref.org/works/10.1000/chapter.example.1", Answer::Json(cr_chap));
        let src = enrich_book_mapping(&net, &mut sec, "").unwrap();
        assert_eq!(src, "crossref");
        assert_eq!((ys(&sec, "type").as_deref(), ys(&sec, "bibtexType").as_deref(), ys(&sec, "publisher").as_deref(), ys(&sec, "bookTitle").as_deref()), (Some("bookSection"), Some("incollection"), Some("Example House"), Some("Handbook of Synthetic Methods")));
    }

    #[test]
    fn enrich_entry_upgrades_raw_filename_entry_renames_citekey_and_relinks_vault() {
        let mut v = Vault::new();
        let pdf = crate::refs::tests::tiny_pdf(&["Topological Superconductors\nAda Lovelace\nDOI: 10.1000/topo.2024"]);
        let imp = v.lib().import_pdf("raw_draft_scan.pdf", &pdf).unwrap();
        assert_eq!(imp.paper.key, "raw");

        std::fs::write(v.root.join("notes.md"), "See [[raw]] and \\cite{raw}.\n").unwrap();
        v.net = Table::default().on(
            "https://api.crossref.org/works/10.1000/topo.2024",
            Answer::Json(json!({
                "message": {
                    "type": "journal-article",
                    "title": ["Topological Superconductors"],
                    "author": [{ "family": "Lovelace", "given": "Ada" }],
                    "issued": { "date-parts": [[2024]] },
                    "container-title": ["Nature Physics"]
                }
            })),
        );

        let dry = enrich_entry(&v.lib(), &EnrichEntryOpts { key: "raw".into(), dry_run: true, rename_citekey: true }).unwrap();
        assert!(dry.upgraded && dry.dry_run && dry.key == "raw");

        let res = enrich_entry(&v.lib(), &EnrichEntryOpts { key: "raw".into(), dry_run: false, rename_citekey: true }).unwrap();
        assert!(res.upgraded && res.old_key == "raw" && res.key == "lovelace2024topological");
        assert_eq!(res.venue.as_deref(), Some("Nature Physics"));
        assert!(!v.root.join("refs/papers/raw").exists());
        assert!(v.root.join("refs/papers/lovelace2024topological/lovelace2024topological.md").is_file());
        let note_text = std::fs::read_to_string(v.root.join("refs/papers/lovelace2024topological/lovelace2024topological.md")).unwrap();
        assert!(note_text.contains("aliases:\n  - raw"), "{note_text}");
        let linked = std::fs::read_to_string(v.root.join("notes.md")).unwrap();
        assert!(linked.contains("[[lovelace2024topological]]") && linked.contains("\\cite{lovelace2024topological}"), "{linked}");
        assert!(std::fs::read_to_string(v.root.join("refs/refs.bib")).unwrap().contains("lovelace2024topological"));
    }
}
