//! What the indexes say about a paper, all through [`Net`]: identifiers in text, Crossref and arXiv records as an
//! entry's Zotero-shaped fields, and where the open-access copies of a DOI's PDF are (OpenAlex, Unpaywall).
//! Moved from the core's refs.rs; arXiv's Atom is read once here for both the library and the catalog's lookup.
use crate::net::Net;
use serde_json::Value as Json;
use serde_yaml::{Mapping, Value};

// --- identifiers -----------------------------------------------------------------------------------------------

const ARXIV_ARCHIVES: &[&str] = &[
    "astro-ph", "cond-mat", "gr-qc", "hep-ex", "hep-lat", "hep-ph", "hep-th",
    "math-ph", "nlin", "nucl-ex", "nucl-th", "physics", "quant-ph",
    "math", "cs", "q-bio", "q-fin", "stat",
    "acc-phys", "adap-org", "alg-geom", "ao-sci", "atom-ph", "bayes-an",
    "chao-dyn", "chem-ph", "cmp-lg", "comp-gas", "dg-ga", "funct-an",
    "mtrl-th", "patt-sol", "plasm-ph", "q-alg", "solv-int", "supr-con",
];

fn valid_archive_name(arch: &str) -> bool {
    if arch.is_empty() || arch.starts_with('.') || arch.ends_with('.') || arch.starts_with('-') || arch.ends_with('-') {
        return false;
    }
    let mut parts = arch.split('.');
    let Some(base) = parts.next() else { return false };
    if !ARXIV_ARCHIVES.contains(&base.to_ascii_lowercase().as_str()) {
        return false;
    }
    match parts.next() {
        Some(sub) => !sub.is_empty() && sub.chars().all(|c| c.is_ascii_alphabetic() || c == '-') && parts.next().is_none(),
        None => true,
    }
}

fn valid_arxiv_end(rest: &str) -> bool {
    if rest.is_empty() {
        return true;
    }
    let low = rest.to_ascii_lowercase();
    for ext in [".pdf", ".tex", ".tar", ".gz", ".ps", ".html"] {
        if let Some(after) = low.strip_prefix(ext) {
            return after.is_empty() || !after.as_bytes()[0].is_ascii_alphanumeric();
        }
    }
    let b = rest.as_bytes();
    if b[0].is_ascii_alphanumeric() {
        return false;
    }
    if b[0] == b'.' && b.get(1).is_some_and(u8::is_ascii_digit) {
        return false;
    }
    true
}

fn parse_version_suffix(rest: &str) -> (Option<String>, usize) {
    let b = rest.as_bytes();
    if matches!(b.first(), Some(b'v' | b'V')) {
        let digits = b[1..].iter().take_while(|c| c.is_ascii_digit()).count();
        if digits > 0 {
            return (Some(format!("v{}", &rest[1..1 + digits])), 1 + digits);
        }
    }
    (None, 0)
}

fn parse_arxiv_at(slice: &str, strict: bool) -> Option<(String, Option<String>)> {
    let b = slice.as_bytes();
    // Modern format: YYMM.NNNN or YYMM.NNNNN + optional vK
    if b.len() >= 9 && b[..4].iter().all(u8::is_ascii_digit) && b[4] == b'.' {
        let post = b[5..].iter().take_while(|c| c.is_ascii_digit()).count();
        let yy: u8 = slice[..2].parse().ok()?;
        let mm: u8 = slice[2..4].parse().ok()?;
        let len_ok = if !strict {
            matches!(post, 4 | 5)
        } else {
            let ym_ok = (7..=99).contains(&yy) && (1..=12).contains(&mm) && !(yy == 7 && mm < 4);
            let digits_ok = if yy >= 15 { post == 5 } else { matches!(post, 4 | 5) };
            ym_ok && digits_ok
        };
        if len_ok {
            let id_end = 5 + post;
            let (ver, vlen) = parse_version_suffix(&slice[id_end..]);
            if valid_arxiv_end(&slice[id_end + vlen..]) {
                return Some((slice[..id_end].to_string(), ver));
            }
        }
    }
    // Legacy format: archive/YYMMNNN + optional vK
    let slash = b.iter().take(24).position(|&c| c == b'/')?;
    let arch = &slice[..slash];
    let after = &slice[slash + 1..];
    let ab = after.as_bytes();
    if valid_archive_name(arch) && ab.len() >= 7 && ab[..7].iter().all(u8::is_ascii_digit) && !ab.get(7).is_some_and(u8::is_ascii_digit) {
        let yy: u8 = after[..2].parse().ok()?;
        let mm: u8 = after[2..4].parse().ok()?;
        let ym_ok = !strict || ((yy >= 91 || yy <= 7) && (1..=12).contains(&mm) && !(yy == 91 && mm < 8) && !(yy == 7 && mm > 3));
        if ym_ok {
            let id_end = slash + 1 + 7;
            let (ver, vlen) = parse_version_suffix(&slice[id_end..]);
            if valid_arxiv_end(&slice[id_end + vlen..]) {
                return Some((slice[..id_end].to_string(), ver));
            }
        }
    }
    None
}

fn non_arxiv_doi_spans(text: &str) -> Vec<(usize, usize)> {
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
                if !text[i..end].to_ascii_lowercase().starts_with("10.48550/arxiv.") {
                    spans.push((i, end));
                }
                i = end;
                continue;
            }
        }
        i += 1;
    }
    spans
}

/// Extracts an arXiv ID and optional `vN` version suffix from arbitrary text, filenames (e.g. `2604.06107v1.pdf`),
/// URLs, or first-page headers (modern `YYMM.NNNNN(vK)` and legacy `archive/YYMMNNN(vK)`), avoiding false positives
/// on ISBNs, DOIs, and dates.
pub fn parse_arxiv_anywhere(text: &str) -> Option<(String, Option<String>)> {
    let normalized = crate::pdf_meta::normalize_pdf_unicode(text);
    let text = normalized.as_str();
    let low = text.to_ascii_lowercase(); // byte offsets preserved 1:1 for ASCII
    let b = text.as_bytes();
    for pat in ["arxiv.org/abs/", "arxiv.org/pdf/", "arxiv.org/e-print/", "arxiv.org/html/", "arxiv.org/src/", "10.48550/arxiv.", "arxiv:"] {
        for (idx, _) in low.match_indices(pat) {
            if pat == "arxiv:" && idx > 0 && b[idx - 1].is_ascii_alphanumeric() {
                continue;
            }
            let mut pos = idx + pat.len();
            if pat == "arxiv:" {
                while pos < b.len() && matches!(b[pos], b' ' | b'\t') {
                    pos += 1;
                }
            }
            if pos < text.len() {
                if let Some(found) = parse_arxiv_at(&text[pos..], false) {
                    return Some(found);
                }
            }
        }
    }
    let doi_spans = non_arxiv_doi_spans(text);
    for i in 0..b.len() {
        if !b[i].is_ascii_alphanumeric() {
            continue;
        }
        if doi_spans.iter().any(|&(s, e)| i >= s && i < e) {
            continue;
        }
        let prev_ok = if b[i].is_ascii_digit() {
            i == 0
                || (!b[i - 1].is_ascii_alphanumeric() && !(b[i - 1] == b'.' && i >= 2 && b[i - 2].is_ascii_digit()))
                || (i >= 5 && low[..i].ends_with("arxiv"))
        } else {
            i == 0 || (!b[i - 1].is_ascii_alphanumeric() && b[i - 1] != b'.' && b[i - 1] != b'-')
        };
        if !prev_ok {
            continue;
        }
        if let Some(found) = parse_arxiv_at(&text[i..], true) {
            return Some(found);
        }
    }
    None
}

/// An arXiv id in text alongside an explicit `vN` revision when given (`"2401.12345v3"` → `("2401.12345", Some("v3"))`).
pub fn parse_arxiv_versioned(text: &str) -> Option<(String, Option<String>)> {
    parse_arxiv_anywhere(text)
}

/// An arXiv id in text (new `2301.12345`, old `cond-mat/0101001`; a URL, `arXiv:`), without its version.
pub fn parse_arxiv(text: &str) -> Option<String> {
    parse_arxiv_versioned(text).map(|(id, _)| id)
}

/// `10.xxxx/...` from a bare DOI, `doi:` prefix or a doi.org URL.
pub fn parse_doi(text: &str) -> Option<String> {
    let normalized = crate::pdf_meta::normalize_pdf_unicode(text);
    let text = normalized.as_str();
    let i = text.find("10.")?;
    let doi: String = text[i..]
        .chars()
        .take_while(|c| !c.is_whitespace() && !matches!(c, '<' | '>' | '"' | '\''))
        .collect();
    let doi = doi.trim_end_matches(['.', ',', ';', ')', ']', '}']).to_string();
    (doi.contains('/') && doi[3..].split('/').next().is_some_and(|reg| reg.chars().all(|c| c.is_ascii_digit() || c == '.'))).then_some(doi)
}

/// Percent-encodes what goes into an address: all but the unreserved characters and `keep` (a DOI keeps its `/`).
pub fn enc(s: &str, keep: &str) -> String {
    s.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-._~".contains(&b) || keep.as_bytes().contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

// --- Crossref ------------------------------------------------------------------------------------------------------

fn json_first_str(x: &Json) -> Option<String> {
    x.as_str()
        .or_else(|| x.as_array()?.first()?.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
}

fn json_str_or_num(x: &Json) -> Option<String> {
    x.as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .or_else(|| x.as_u64().map(|n| n.to_string()))
}

fn crossref_people(arr: &Json) -> Vec<Value> {
    arr.as_array()
        .into_iter()
        .flatten()
        .map(|a| match (a["family"].as_str(), a["given"].as_str()) {
            (Some(f), Some(g)) => format!("{}, {}", f.trim(), g.trim()),
            (Some(f), None) => f.trim().to_string(),
            _ => norm_person(a["name"].as_str().unwrap_or("")),
        })
        .filter(|a| !a.is_empty())
        .map(Value::from)
        .collect()
}

/// A DOI's record at Crossref, as an entry's fields.
pub fn crossref(net: &dyn Net, doi: &str) -> Result<Mapping, String> {
    let v = net.json(&format!("https://api.crossref.org/works/{}", enc(doi, "/")))
        .map_err(|e| format!("Crossref: {e}"))?;
    Ok(crossref_fields(&v["message"], doi))
}

fn openalex_arxiv_id(w: &Json) -> Option<String> {
    let mut urls: Vec<&str> = Vec::new();
    for loc in w["locations"].as_array().into_iter().flatten() {
        if let Some(u) = loc["landing_page_url"].as_str() {
            urls.push(u);
        }
        if let Some(u) = loc["pdf_url"].as_str() {
            urls.push(u);
        }
    }
    for loc in [&w["best_oa_location"], &w["primary_location"]] {
        if let Some(u) = loc["landing_page_url"].as_str() {
            urls.push(u);
        }
        if let Some(u) = loc["pdf_url"].as_str() {
            urls.push(u);
        }
    }
    for u in urls {
        if let Some((_, rest)) = u.split_once("arxiv.org/") {
            let trimmed = rest.trim_start_matches("abs/").trim_start_matches("pdf/");
            if let Some(ax) = parse_arxiv(&format!("arxiv:{trimmed}")) {
                return Some(ax);
            }
        }
    }
    None
}

/// Fetches Crossref metadata for `doi` and backfills missing `abstractNote` / `archiveID` from OpenAlex (ignoring OpenAlex failures cleanly).
pub fn crossref_with_openalex(net: &dyn Net, doi: &str, email: &str) -> Result<Mapping, String> {
    let mut m = crossref(net, doi)?;
    let need_abs = m.get("abstractNote").and_then(Value::as_str).is_none_or(|s| s.trim().is_empty());
    let need_ax = m.get("archiveID").and_then(Value::as_str).is_none_or(|s| s.trim().is_empty());
    if !need_abs && !need_ax {
        return Ok(m);
    }
    let mailto = if email.is_empty() { String::new() } else { format!("?mailto={}", enc(email, "")) };
    let target_doi = doi.trim().to_lowercase();
    if let Ok(w) = net.json(&format!("https://api.openalex.org/works/doi:{}{mailto}", enc(&target_doi, "/"))) {
        if openalex_doi(&w) == target_doi {
            if need_abs {
                if let Some(abs) = openalex_abstract(&w["abstract_inverted_index"]).filter(|s| !s.trim().is_empty()) {
                    m.insert("abstractNote".into(), abs.into());
                }
            }
            if need_ax {
                if let Some(ax) = openalex_arxiv_id(&w) {
                    m.insert("archiveID".into(), format!("arXiv:{ax}").into());
                }
            }
        }
    }
    Ok(m)
}

pub(crate) fn crossref_fields(w: &Json, doi: &str) -> Mapping {
    let mut m = Mapping::new();
    let put = |m: &mut Mapping, k: &str, v: Option<String>| {
        if let Some(v) = v.filter(|x| !x.is_empty()) {
            m.insert(k.into(), v.into());
        }
    };
    let title = match (json_first_str(&w["title"]), json_first_str(&w["subtitle"])) {
        (Some(t), Some(sub)) if !t.to_ascii_lowercase().contains(&sub.to_ascii_lowercase()) => Some(format!("{t}: {sub}")),
        (t, _) => t,
    };
    put(&mut m, "title", title);
    let kind = match w["type"].as_str().unwrap_or("") {
        "journal-article" => "journalArticle",
        "book" | "monograph" | "edited-book" | "reference-book" | "book-series" => "book",
        "book-chapter" | "book-section" | "book-part" | "reference-entry" => "bookSection",
        "proceedings-article" => "conferencePaper",
        "posted-content" => "preprint",
        "dissertation" => "thesis",
        _ => "document",
    };
    m.insert("type".into(), kind.into());
    let authors = crossref_people(&w["author"]);
    m.insert("author".into(), Value::Sequence(authors));
    let editors = crossref_people(&w["editor"]);
    if !editors.is_empty() {
        m.insert("editor".into(), Value::Sequence(editors));
    }
    let parts = w["issued"]["date-parts"][0]
        .as_array()
        .or_else(|| w["published-print"]["date-parts"][0].as_array())
        .or_else(|| w["published-online"]["date-parts"][0].as_array())
        .cloned()
        .unwrap_or_default();
    let date: Vec<String> = parts.iter().filter_map(|p| p.as_u64()).map(|p| format!("{p:02}")).collect();
    put(&mut m, "date", Some(date.join("-")));
    if kind == "bookSection" {
        put(&mut m, "bookTitle", json_first_str(&w["container-title"]));
    } else if kind == "book" {
        put(&mut m, "series", json_first_str(&w["container-title"]));
    } else {
        put(&mut m, "publicationTitle", json_first_str(&w["container-title"]));
    }
    put(&mut m, "volume", json_str_or_num(&w["volume"]));
    put(&mut m, "issue", json_str_or_num(&w["issue"]));
    put(&mut m, "edition", json_str_or_num(&w["edition-number"]));
    put(&mut m, "pages", w["page"].as_str().map(String::from));
    put(&mut m, "publisher", w["publisher"].as_str().map(String::from));
    if let Some(isbn) = w["ISBN"].as_array().into_iter().flatten().filter_map(|v| v.as_str()).find_map(normalize_isbn) {
        put(&mut m, "ISBN", Some(isbn));
    }
    put(&mut m, "DOI", Some(doi.to_string()));
    put(&mut m, "url", w["URL"].as_str().map(String::from));
    // JATS abstracts carry <jats:p> tags
    put(&mut m, "abstractNote", w["abstract"].as_str().map(|a| strip_tags(a).trim().to_string()));
    m
}

/// Normalizes an ISBN-10 or ISBN-13 by stripping optional `ISBN` labels, hyphens, and spaces, uppercasing `X`.
pub fn normalize_isbn(raw: &str) -> Option<String> {
    let norm = crate::pdf_meta::normalize_pdf_unicode(raw);
    let mut s = norm.trim().trim_matches(|c: char| matches!(c, '(' | ')' | '[' | ']' | '.' | ',' | ';'));
    let low = s.to_ascii_lowercase();
    if let Some(after_urn) = low.strip_prefix("urn:isbn:") {
        s = s[s.len() - after_urn.len()..].trim();
    } else if low.starts_with("isbn") {
        let rest = &s[4..];
        let rlow = rest.to_ascii_lowercase();
        let skip = ["-13:", "-10:", "-13", "-10", "13:", "10:", "13", "10", ":"]
            .into_iter()
            .find(|p| rlow.trim_start().starts_with(p))
            .map_or(0, |p| rest.len() - rest.trim_start().len() + p.len());
        s = rest[skip..].trim_start_matches([':', ' ', '\t', '-', '\u{2010}', '\u{2011}', '\u{2012}', '\u{2013}', '\u{2014}']).trim();
    }
    let clean: String = s
        .chars()
        .filter(|c| !matches!(c, '-' | '\u{2010}' | '\u{2011}' | '\u{2012}' | '\u{2013}' | '\u{2014}' | '\u{2212}' | ' ' | '\t'))
        .map(|c| c.to_ascii_uppercase())
        .collect();
    let ok = match clean.len() {
        10 => clean[..9].bytes().all(|b| b.is_ascii_digit()) && clean[9..].bytes().all(|b| b.is_ascii_digit() || b == b'X'),
        13 => clean.bytes().all(|b| b.is_ascii_digit()),
        _ => false,
    };
    ok.then_some(clean)
}

/// An ISBN in text (a book's copyright page: `ISBN 978-3-540-32897-1`, `ISBN-10: 0-19-…`), as its digits, checked:
/// one marked `ISBN` first, else a bare 978/979 run; a number that fails its check digit is not one.
pub fn parse_isbn(text: &str) -> Option<String> {
    let low = text.to_ascii_lowercase(); // offsets kept: ASCII only
    let digits_at = |from: usize| -> String {
        text[from..].chars().skip_while(|c| !c.is_ascii_digit()).take_while(|c| c.is_ascii_digit() || matches!(c, '-' | 'X' | 'x')).filter(|c| *c != '-').collect::<String>().to_ascii_uppercase()
    };
    // the mark's own `-10` / `-13` / `13:` is a label, not the number
    let label = |at: usize| ["-10", "-13", "10", "13"].iter().find(|p| low[at..].starts_with(*p) && !low[at + p.len()..].starts_with(|c: char| c.is_ascii_digit() || c == '-')).map_or(0, |p| p.len());
    let marked = low.match_indices("isbn").map(|(i, _)| digits_at(i + 4 + label(i + 4))).map(|d| if d.len() > 13 { d[..13].to_string() } else { d });
    let bare = text.char_indices().filter(|(i, _)| low[*i..].starts_with("978") || low[*i..].starts_with("979")).filter(|(i, _)| *i == 0 || !text[..*i].ends_with(|c: char| c.is_ascii_digit())).map(|(i, _)| digits_at(i).chars().take(13).collect::<String>());
    marked.chain(bare).find(|d| isbn_valid(d))
}

/// ISBN-10's mod 11 or ISBN-13's mod 10 check.
fn isbn_valid(d: &str) -> bool {
    let v: Vec<u32> = d.chars().map(|c| if c == 'X' { 10 } else { c.to_digit(10).unwrap_or(99) }).collect();
    match v.len() {
        10 => v[..9].iter().all(|x| *x < 10) && v.iter().enumerate().map(|(i, x)| (10 - i as u32) * x).sum::<u32>() % 11 == 0,
        13 => v.iter().all(|x| *x < 10) && v.iter().enumerate().map(|(i, x)| if i % 2 == 0 { *x } else { 3 * x }).sum::<u32>() % 10 == 0,
        _ => false,
    }
}

fn norm_person(raw: &str) -> String {
    let t = raw.trim();
    if t.is_empty() {
        return String::new();
    }
    if t.contains(',') {
        t.to_string()
    } else {
        last_first(t)
    }
}

fn is_science_book(title: &str, series: Option<&str>, subjects: &[String]) -> bool {
    const TERMS: &[&str] = &[
        "physics", "mathematics", "mathematical", "quantum", "condensed matter", "statistical mechanics",
        "field theory", "chemistry", "biology", "computer science", "algorithm", "algorithms", "statistics",
        "probability", "geometry", "topology", "algebra", "analysis", "differential equation", "astrophysics",
        "astronomy", "neuroscience", "genetics", "optics", "thermodynamics", "electromagnetism", "relativity",
        "mechanics", "engineering", "computational", "machine learning", "textbook", "graduate texts",
        "lecture notes in", "electrodynamics", "spectroscopy", "semiconductor", "superconduct",
    ];
    let hay = std::iter::once(title)
        .chain(series)
        .chain(subjects.iter().map(String::as_str))
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();
    TERMS.iter().any(|t| hay.contains(t))
}

struct BookFields {
    title: String,
    authors: Vec<String>,
    editors: Vec<String>,
    date: Option<String>,
    year: Option<String>,
    publisher: Option<String>,
    isbn: Option<String>,
    edition: Option<String>,
    series: Option<String>,
    volume: Option<String>,
    doi: Option<String>,
    url: Option<String>,
    abstract_text: Option<String>,
    book_title: Option<String>,
    num_pages: Option<String>,
    is_section: bool,
    subjects: Vec<String>,
}

fn build_book_mapping(b: BookFields) -> Option<Mapping> {
    let title = b.title.trim().to_string();
    if title.is_empty() {
        return None;
    }
    let mut m = Mapping::new();
    let put = |m: &mut Mapping, k: &str, v: Option<String>| {
        if let Some(s) = v.map(|x| x.trim().to_string()).filter(|x| !x.is_empty()) {
            m.insert(k.into(), s.into());
        }
    };
    let year = b
        .year
        .as_deref()
        .and_then(year_in)
        .map(String::from)
        .or_else(|| b.date.as_deref().and_then(year_in).map(String::from));
    let date = b.date.filter(|d| !d.trim().is_empty()).or_else(|| year.clone());
    let kind = if is_science_book(&title, b.series.as_deref(), &b.subjects) { "science_book" } else { "book" };
    let ztype = if b.is_section { "bookSection" } else { "book" };
    let bibtex_type = if b.is_section { "incollection" } else { "book" };

    put(&mut m, "title", Some(title));
    m.insert("type".into(), ztype.into());
    m.insert("kind".into(), kind.into());
    m.insert("bibtexType".into(), bibtex_type.into());
    if !b.authors.is_empty() {
        let seq: Vec<Value> = b.authors.into_iter().map(Value::from).collect();
        m.insert("author".into(), Value::Sequence(seq.clone()));
        m.insert("authors".into(), Value::Sequence(seq));
    }
    if !b.editors.is_empty() {
        let seq: Vec<Value> = b.editors.into_iter().map(Value::from).collect();
        m.insert("editor".into(), Value::Sequence(seq.clone()));
        m.insert("editors".into(), Value::Sequence(seq));
    }
    put(&mut m, "date", date);
    put(&mut m, "year", year);
    put(&mut m, "publisher", b.publisher);
    if let Some(isbn) = b.isbn.and_then(|i| normalize_isbn(&i).or(Some(i))) {
        put(&mut m, "ISBN", Some(isbn.clone()));
        put(&mut m, "isbn", Some(isbn));
    }
    put(&mut m, "edition", b.edition);
    put(&mut m, "series", b.series);
    put(&mut m, "volume", b.volume);
    if let Some(doi) = b.doi.filter(|d| !d.trim().is_empty()) {
        put(&mut m, "DOI", Some(doi.clone()));
        put(&mut m, "doi", Some(doi));
    }
    put(&mut m, "url", b.url);
    if let Some(abs) = b.abstract_text.filter(|a| !a.trim().is_empty()) {
        put(&mut m, "abstractNote", Some(abs.clone()));
        put(&mut m, "abstract", Some(abs));
    }
    if b.is_section {
        put(&mut m, "bookTitle", b.book_title);
    }
    put(&mut m, "numPages", b.num_pages);
    Some(m)
}

fn is_crossref_book_type(t: &str) -> bool {
    matches!(t, "book" | "monograph" | "edited-book" | "reference-book" | "book-series" | "book-chapter" | "book-section" | "book-part" | "reference-entry")
}

fn crossref_book_mapping(w: &Json, fallback_isbn: Option<&str>, fallback_doi: Option<&str>) -> Option<Mapping> {
    let raw_type = w["type"].as_str().unwrap_or("");
    if !raw_type.is_empty() && !is_crossref_book_type(raw_type) {
        return None;
    }
    let title = match (json_first_str(&w["title"]), json_first_str(&w["subtitle"])) {
        (Some(t), Some(sub)) if !t.to_ascii_lowercase().contains(&sub.to_ascii_lowercase()) => format!("{t}: {sub}"),
        (Some(t), _) => t,
        (None, _) => return None,
    };
    let is_section = matches!(raw_type, "book-chapter" | "book-section" | "book-part" | "reference-entry");
    let people = |arr: &Json| -> Vec<String> {
        crossref_people(arr).into_iter().filter_map(|v| v.as_str().map(String::from)).collect()
    };
    let parts = w["issued"]["date-parts"][0]
        .as_array()
        .or_else(|| w["published-print"]["date-parts"][0].as_array())
        .or_else(|| w["published-online"]["date-parts"][0].as_array())
        .cloned()
        .unwrap_or_default();
    let date_parts: Vec<String> = parts.iter().filter_map(|p| p.as_u64()).map(|p| format!("{p:02}")).collect();
    let date = (!date_parts.is_empty()).then(|| date_parts.join("-"));
    let mut isbns: Vec<String> = w["ISBN"].as_array().into_iter().flatten().filter_map(|v| v.as_str()).filter_map(normalize_isbn).collect();
    if isbns.is_empty() {
        if let Some(arr) = w["isbn-type"].as_array() {
            isbns.extend(arr.iter().filter_map(|x| x["value"].as_str()).filter_map(normalize_isbn));
        }
    }
    let isbn = fallback_isbn
        .and_then(normalize_isbn)
        .filter(|fb| isbns.is_empty() || isbns.iter().any(|x| x == fb))
        .or_else(|| isbns.iter().find(|i| i.len() == 13).cloned().or_else(|| isbns.into_iter().next()))
        .or_else(|| fallback_isbn.and_then(normalize_isbn));
    let doi = w["DOI"].as_str().map(String::from).or_else(|| fallback_doi.map(String::from));
    let container = json_first_str(&w["container-title"]);
    let subjects: Vec<String> = w["subject"].as_array().into_iter().flatten().filter_map(|s| s.as_str().map(String::from)).collect();
    let url = w["URL"].as_str().map(String::from).or_else(|| doi.as_deref().map(|d| format!("https://doi.org/{d}")));
    build_book_mapping(BookFields {
        title,
        authors: people(&w["author"]),
        editors: people(&w["editor"]),
        date,
        year: None,
        publisher: w["publisher"].as_str().map(String::from),
        isbn,
        edition: json_str_or_num(&w["edition-number"]),
        series: if is_section { None } else { container.clone() },
        volume: json_str_or_num(&w["volume"]),
        doi,
        url,
        abstract_text: w["abstract"].as_str().map(|a| strip_tags(a).trim().to_string()),
        book_title: if is_section { container } else { None },
        num_pages: None,
        is_section,
        subjects,
    })
}

fn openalex_book_mapping(w: &Json, fallback_isbn: Option<&str>) -> Option<Mapping> {
    let raw_type = w["type"].as_str().unwrap_or("");
    if !raw_type.is_empty() && !matches!(raw_type, "book" | "monograph" | "edited-book" | "reference-book" | "book-chapter" | "reference-entry") {
        return None;
    }
    let title = w["display_name"].as_str().or_else(|| w["title"].as_str())?.trim().to_string();
    if title.is_empty() {
        return None;
    }
    let is_section = matches!(raw_type, "book-chapter" | "reference-entry");
    let authors: Vec<String> = w["authorships"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|a| a["author"]["display_name"].as_str())
        .map(norm_person)
        .filter(|n| !n.is_empty())
        .collect();
    let date = w["publication_date"]
        .as_str()
        .map(String::from)
        .or_else(|| json_str_or_num(&w["publication_year"]));
    let year = json_str_or_num(&w["publication_year"]);
    let publisher = w["primary_location"]["source"]["host_organization_name"]
        .as_str()
        .or_else(|| w["primary_location"]["source"]["display_name"].as_str())
        .or_else(|| w["host_venue"]["publisher"].as_str())
        .or_else(|| w["best_oa_location"]["source"]["host_organization_name"].as_str())
        .map(String::from);
    let raw_isbn = w["ids"]["isbn"]
        .as_str()
        .and_then(normalize_isbn)
        .or_else(|| w["ids"]["isbn"].as_array().into_iter().flatten().filter_map(|v| v.as_str()).find_map(normalize_isbn));
    let isbn = fallback_isbn.and_then(normalize_isbn).or(raw_isbn);
    let raw_doi = openalex_doi(w);
    let doi = (!raw_doi.is_empty() && !raw_doi.starts_with("10.48550/arxiv.")).then_some(raw_doi);
    let url = w["primary_location"]["landing_page_url"]
        .as_str()
        .or_else(|| w["id"].as_str())
        .map(String::from)
        .or_else(|| doi.as_deref().map(|d| format!("https://doi.org/{d}")));
    let mut subjects: Vec<String> = w["concepts"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|c| c["display_name"].as_str().map(String::from))
        .collect();
    subjects.extend(
        w["topics"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|t| t["display_name"].as_str().map(String::from)),
    );
    if let Some(pt) = w["primary_topic"]["display_name"].as_str() {
        subjects.push(pt.to_string());
    }
    build_book_mapping(BookFields {
        title,
        authors,
        editors: Vec::new(),
        date,
        year,
        publisher,
        isbn,
        edition: None,
        series: None,
        volume: json_str_or_num(&w["biblio"]["volume"]),
        doi,
        url,
        abstract_text: openalex_abstract(&w["abstract_inverted_index"]),
        book_title: if is_section { w["primary_location"]["source"]["display_name"].as_str().map(String::from) } else { None },
        num_pages: None,
        is_section,
        subjects,
    })
}

fn openlibrary_text(v: &Json) -> Option<String> {
    v.as_str()
        .or_else(|| v["value"].as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
}

fn openlibrary_data_mapping(b: &Json, isbn: &str) -> Option<Mapping> {
    let raw_title = b["title"].as_str()?.trim();
    if raw_title.is_empty() {
        return None;
    }
    let title = match b["subtitle"].as_str().map(str::trim).filter(|s| !s.is_empty()) {
        Some(sub) => format!("{raw_title}: {sub}"),
        None => raw_title.to_string(),
    };
    let people = |arr: &Json| -> Vec<String> {
        arr.as_array()
            .into_iter()
            .flatten()
            .filter_map(|x| x.as_str().or_else(|| x["name"].as_str()))
            .map(norm_person)
            .filter(|n| !n.is_empty())
            .collect()
    };
    let publisher = b["publishers"][0]["name"]
        .as_str()
        .or_else(|| b["publishers"][0].as_str())
        .map(String::from);
    let series = b["series"][0]["name"]
        .as_str()
        .or_else(|| b["series"][0].as_str())
        .map(String::from);
    let subjects: Vec<String> = b["subjects"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|s| s.as_str().or_else(|| s["name"].as_str()).map(String::from))
        .collect();
    let abstract_text = openlibrary_text(&b["notes"])
        .or_else(|| b["excerpts"].as_array().and_then(|a| a.first()).and_then(|e| openlibrary_text(&e["text"])));
    let resolved_isbn = normalize_isbn(isbn)
        .or_else(|| b["identifiers"]["isbn_13"].as_array().and_then(|a| a.first()).and_then(|v| v.as_str()).and_then(normalize_isbn))
        .or_else(|| b["identifiers"]["isbn_10"].as_array().and_then(|a| a.first()).and_then(|v| v.as_str()).and_then(normalize_isbn));
    build_book_mapping(BookFields {
        title,
        authors: people(&b["authors"]),
        editors: people(&b["editors"]),
        date: b["publish_date"].as_str().and_then(year_in).map(String::from),
        year: None,
        publisher,
        isbn: resolved_isbn,
        edition: b["edition_name"].as_str().map(String::from),
        series,
        volume: None,
        doi: None,
        url: b["url"].as_str().map(String::from),
        abstract_text,
        book_title: None,
        num_pages: b["number_of_pages"].as_u64().map(|n| n.to_string()),
        is_section: false,
        subjects,
    })
}

fn openlibrary_doc_mapping(doc: &Json, fallback_isbn: Option<&str>) -> Option<Mapping> {
    let raw_title = doc["title"].as_str()?.trim();
    if raw_title.is_empty() {
        return None;
    }
    let title = match doc["subtitle"].as_str().map(str::trim).filter(|s| !s.is_empty()) {
        Some(sub) => format!("{raw_title}: {sub}"),
        None => raw_title.to_string(),
    };
    let authors: Vec<String> = doc["author_name"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|a| a.as_str())
        .map(norm_person)
        .filter(|n| !n.is_empty())
        .collect();
    let year = doc["first_publish_year"]
        .as_u64()
        .map(|y| y.to_string())
        .or_else(|| doc["publish_year"].as_array().and_then(|a| a.first()).and_then(Json::as_u64).map(|y| y.to_string()))
        .or_else(|| doc["publish_date"].as_array().and_then(|a| a.first()).and_then(Json::as_str).and_then(year_in).map(String::from));
    let publisher = doc["publisher"].as_array().and_then(|a| a.first()).and_then(Json::as_str).map(String::from);
    let doc_isbns: Vec<String> = doc["isbn"].as_array().into_iter().flatten().filter_map(Json::as_str).filter_map(normalize_isbn).collect();
    let isbn = fallback_isbn
        .and_then(normalize_isbn)
        .filter(|fb| doc_isbns.is_empty() || doc_isbns.iter().any(|x| x == fb))
        .or_else(|| doc_isbns.iter().find(|i| i.len() == 13).cloned().or_else(|| doc_isbns.into_iter().next()))
        .or_else(|| fallback_isbn.and_then(normalize_isbn));
    let url = doc["key"].as_str().map(|k| {
        if k.starts_with("http") {
            k.to_string()
        } else if k.starts_with('/') {
            format!("https://openlibrary.org{k}")
        } else {
            format!("https://openlibrary.org/works/{k}")
        }
    });
    let subjects: Vec<String> = doc["subject"].as_array().into_iter().flatten().filter_map(Json::as_str).map(String::from).collect();
    let num_pages = doc["number_of_pages_median"].as_u64().map(|n| n.to_string());
    build_book_mapping(BookFields {
        title,
        authors,
        editors: Vec::new(),
        date: year.clone(),
        year,
        publisher,
        isbn,
        edition: doc["edition_name"].as_str().map(String::from),
        series: None,
        volume: None,
        doi: None,
        url,
        abstract_text: openlibrary_text(&doc["description"]),
        book_title: None,
        num_pages,
        is_section: false,
        subjects,
    })
}

fn norm_words(s: &str) -> Vec<String> {
    crate::pdf_meta::fold_diacritics(s)
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(String::from)
        .collect()
}

fn matches_book_query(m: &Mapping, wanted_title: &str, wanted_author: Option<&str>) -> bool {
    let Some(cand_title) = m.get("title").and_then(Value::as_str) else { return false };
    let w_norm = norm_words(wanted_title).join(" ");
    let c_norm = norm_words(cand_title).join(" ");
    let c_base = norm_words(cand_title.split(':').next().unwrap_or(cand_title)).join(" ");
    let title_ok = !w_norm.is_empty()
        && (c_norm == w_norm
            || c_base == w_norm
            || (w_norm.len() >= 8 && (c_norm.starts_with(&w_norm) || w_norm.starts_with(&c_norm))));
    if !title_ok {
        let w_set: Vec<String> = norm_words(wanted_title).into_iter().filter(|w| w.len() > 2).collect();
        let c_set: Vec<String> = norm_words(cand_title).into_iter().filter(|w| w.len() > 2).collect();
        let hits = w_set.iter().filter(|w| c_set.contains(w)).count();
        if w_set.is_empty() || hits * 4 < w_set.len() * 3 {
            return false;
        }
    }
    let Some(author) = wanted_author.map(str::trim).filter(|a| !a.is_empty()) else {
        return true;
    };
    let surname = crate::pdf_meta::fold_diacritics(
        author
            .split_once(',')
            .map_or_else(|| author.split_whitespace().last().unwrap_or(author), |(l, _)| l.trim()),
    );
    if surname.is_empty() {
        return true;
    }
    let cand_people: Vec<&str> = ["author", "editor"]
        .into_iter()
        .flat_map(|k| m.get(k).and_then(Value::as_sequence).into_iter().flatten())
        .filter_map(Value::as_str)
        .collect();
    if cand_people.is_empty() {
        return c_norm == w_norm || c_base == w_norm;
    }
    cand_people.iter().any(|p| norm_words(p).iter().any(|w| w.as_str() == surname))
}

/// Searches Open Library for books matching `query` (`search.json`).
pub fn openlibrary_search(net: &dyn Net, query: &str, limit: usize) -> Result<Vec<Mapping>, String> {
    let qstr = query.trim();
    if qstr.is_empty() {
        return Ok(Vec::new());
    }
    let v = net
        .json(&format!("https://openlibrary.org/search.json?q={}&limit={limit}", enc(qstr, "")))
        .map_err(|e| format!("OpenLibrary: {e}"))?;
    Ok(v["docs"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|doc| openlibrary_doc_mapping(doc, None))
        .collect())
}

fn google_books_mapping(item: &Json, fallback_isbn: Option<&str>) -> Option<Mapping> {
    let v = &item["volumeInfo"];
    let raw_title = v["title"].as_str()?.trim();
    if raw_title.is_empty() {
        return None;
    }
    let title = match v["subtitle"].as_str().map(str::trim).filter(|s| !s.is_empty()) {
        Some(sub) if !raw_title.to_ascii_lowercase().contains(&sub.to_ascii_lowercase()) => format!("{raw_title}: {sub}"),
        _ => raw_title.to_string(),
    };
    let authors: Vec<String> = v["authors"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Json::as_str)
        .map(norm_person)
        .filter(|n| !n.is_empty())
        .collect();
    let subjects: Vec<String> = v["categories"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Json::as_str)
        .map(String::from)
        .collect();
    let id_isbn = v["industryIdentifiers"].as_array().and_then(|arr| {
        arr.iter()
            .filter(|x| x["type"].as_str() == Some("ISBN_13"))
            .chain(arr.iter().filter(|x| x["type"].as_str() == Some("ISBN_10")))
            .filter_map(|x| x["identifier"].as_str())
            .find_map(normalize_isbn)
    });
    let isbn = fallback_isbn.and_then(normalize_isbn).or(id_isbn);
    build_book_mapping(BookFields {
        title,
        authors,
        editors: Vec::new(),
        date: v["publishedDate"].as_str().and_then(year_in).map(String::from),
        year: None,
        publisher: v["publisher"].as_str().map(String::from),
        isbn,
        edition: None,
        series: None,
        volume: None,
        doi: None,
        url: v["infoLink"].as_str().map(String::from),
        abstract_text: v["description"].as_str().map(String::from),
        book_title: None,
        num_pages: v["pageCount"].as_u64().map(|n| n.to_string()),
        is_section: false,
        subjects,
    })
}

fn has_non_empty_str(m: &Mapping, k: &str) -> bool {
    m.get(k).and_then(Value::as_str).is_some_and(|s| !s.trim().is_empty())
}

fn has_non_empty_seq(m: &Mapping, k: &str) -> bool {
    m.get(k).and_then(Value::as_sequence).is_some_and(|s| !s.is_empty())
}

fn book_is_complete(m: &Mapping) -> bool {
    has_non_empty_str(m, "title")
        && (has_non_empty_seq(m, "author") || has_non_empty_seq(m, "editor"))
        && (has_non_empty_str(m, "year") || has_non_empty_str(m, "date"))
        && has_non_empty_str(m, "publisher")
}

fn merge_book_fields(dst: &mut Mapping, src: &Mapping) {
    for (k, alt) in [("author", "authors"), ("editor", "editors")] {
        if !has_non_empty_seq(dst, k) && !has_non_empty_seq(dst, alt) {
            if let Some(seq) = src.get(k).and_then(Value::as_sequence).filter(|s| !s.is_empty()) {
                dst.insert(k.into(), Value::Sequence(seq.clone()));
                dst.insert(alt.into(), Value::Sequence(seq.clone()));
            }
        }
    }
    for k in [
        "date", "year", "publisher", "ISBN", "isbn", "DOI", "doi",
        "edition", "series", "volume", "numPages", "abstractNote", "abstract", "url", "bookTitle",
    ] {
        if !has_non_empty_str(dst, k) {
            if let Some(v) = src.get(k).and_then(Value::as_str).filter(|s| !s.trim().is_empty()) {
                dst.insert(k.into(), v.into());
            }
        }
    }
}

/// Looks up book metadata across Crossref, OpenAlex, OpenLibrary, and Google Books, merging missing fields
/// from secondary sources when the primary hit lacks author/editor, year/date, or publisher.
/// Returns `(mapping, source)` where `source` is `"crossref"`, `"openalex"`, `"openlibrary"`, or `"googlebooks"`.
pub fn lookup_book_metadata(
    net: &dyn Net,
    isbn: Option<&str>,
    doi: Option<&str>,
    title: Option<&str>,
    author: Option<&str>,
    email: &str,
) -> Option<(Mapping, &'static str)> {
    let norm_isbn = isbn.and_then(|s| normalize_isbn(s).or_else(|| parse_isbn(s)));
    let norm_doi = doi.and_then(|d| {
        parse_doi(d).or_else(|| {
            let t = d
                .trim()
                .trim_start_matches("https://doi.org/")
                .trim_start_matches("http://doi.org/")
                .trim_start_matches("doi:")
                .trim();
            (!t.is_empty()).then(|| t.to_string())
        })
    });
    let clean_title = title.map(str::trim).filter(|s| !s.is_empty());
    let clean_author = author.map(str::trim).filter(|s| !s.is_empty());
    let mailto_q = if email.is_empty() { String::new() } else { format!("?mailto={}", enc(email, "")) };
    let mailto_amp = if email.is_empty() { String::new() } else { format!("&mailto={}", enc(email, "")) };

    let mut primary: Option<(Mapping, &'static str)> = None;
    let record = |primary: &mut Option<(Mapping, &'static str)>, m: Mapping, src: &'static str| -> bool {
        match primary {
            None => *primary = Some((m, src)),
            Some((ref mut dst, _)) => merge_book_fields(dst, &m),
        }
        primary.as_ref().is_some_and(|(pm, _)| book_is_complete(pm))
    };

    if let Some(d) = norm_doi.as_deref() {
        if let Ok(v) = net.json(&format!("https://api.crossref.org/works/{}", enc(d, "/"))) {
            if let Some(m) = crossref_book_mapping(&v["message"], norm_isbn.as_deref(), Some(d)) {
                if record(&mut primary, m, "crossref") {
                    return primary;
                }
            }
        }
        if let Ok(w) = net.json(&format!("https://api.openalex.org/works/doi:{}{mailto_q}", enc(&d.to_lowercase(), "/"))) {
            let answered = openalex_doi(&w);
            if answered.is_empty() || answered == d.to_lowercase() {
                if let Some(m) = openalex_book_mapping(&w, norm_isbn.as_deref()) {
                    if record(&mut primary, m, "openalex") {
                        return primary;
                    }
                }
            }
        }
    }

    if let Some(i) = norm_isbn.as_deref() {
        if let Ok(v) = net.json(&format!("https://api.crossref.org/works?filter=isbn:{}&rows=5", enc(i, ""))) {
            for w in v["message"]["items"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|w| matches!(w["type"].as_str().unwrap_or(""), "book" | "monograph" | "edited-book" | "reference-book" | "book-series" | ""))
            {
                if let Some(m) = crossref_book_mapping(w, Some(i), norm_doi.as_deref()) {
                    if record(&mut primary, m, "crossref") {
                        return primary;
                    }
                    break;
                }
            }
        }
        if let Ok(v) = net.json(&format!("https://api.openalex.org/works?filter=ids.isbn:{}&per-page=5{mailto_amp}", enc(i, ""))) {
            let mut hit = false;
            for w in v["results"].as_array().into_iter().flatten() {
                if let Some(m) = openalex_book_mapping(w, Some(i)) {
                    hit = true;
                    if record(&mut primary, m, "openalex") {
                        return primary;
                    }
                    break;
                }
            }
            if !hit && v["id"].is_string() {
                if let Some(m) = openalex_book_mapping(&v, Some(i)) {
                    if record(&mut primary, m, "openalex") {
                        return primary;
                    }
                }
            }
        }
        if let Ok(ol) = net.json(&format!("https://openlibrary.org/api/books?bibkeys=ISBN:{i}&format=json&jscmd=data")) {
            let key = format!("ISBN:{i}");
            if let Some(m) = openlibrary_data_mapping(&ol[key.as_str()], i) {
                if record(&mut primary, m, "openlibrary") {
                    return primary;
                }
            }
        }
        if let Ok(v) = net.json(&format!("https://openlibrary.org/search.json?isbn={}&limit=5", enc(i, ""))) {
            for doc in v["docs"].as_array().into_iter().flatten() {
                if let Some(m) = openlibrary_doc_mapping(doc, Some(i)) {
                    if record(&mut primary, m, "openlibrary") {
                        return primary;
                    }
                    break;
                }
            }
        }
        if let Ok(g) = net.json(&format!("https://www.googleapis.com/books/v1/volumes?q=isbn:{i}")) {
            if let Some(item) = g["items"].as_array().and_then(|a| a.first()) {
                if let Some(m) = google_books_mapping(item, Some(i)) {
                    if record(&mut primary, m, "googlebooks") {
                        return primary;
                    }
                }
            }
        }
    }

    if let Some(t) = clean_title {
        let query = match clean_author {
            Some(a) => format!("{t} {a}"),
            None => t.to_string(),
        };
        if let Ok(v) = net.json(&format!("https://api.crossref.org/works?filter=type:book,type:monograph&rows=5&query.bibliographic={}", enc(&query, ""))) {
            for w in v["message"]["items"].as_array().into_iter().flatten() {
                if let Some(m) = crossref_book_mapping(w, norm_isbn.as_deref(), norm_doi.as_deref()).filter(|m| matches_book_query(m, t, clean_author)) {
                    if record(&mut primary, m, "crossref") {
                        return primary;
                    }
                    break;
                }
            }
        }
        if let Ok(v) = net.json(&format!("https://api.openalex.org/works?filter=type:book&per-page=5&search={}{mailto_amp}", enc(&query, ""))) {
            for w in v["results"].as_array().into_iter().flatten() {
                if let Some(m) = openalex_book_mapping(w, norm_isbn.as_deref()).filter(|m| matches_book_query(m, t, clean_author)) {
                    if record(&mut primary, m, "openalex") {
                        return primary;
                    }
                    break;
                }
            }
        }
        let author_q = clean_author.map(|a| format!("&author={}", enc(a, ""))).unwrap_or_default();
        if let Ok(v) = net.json(&format!("https://openlibrary.org/search.json?title={}{author_q}&limit=5", enc(t, ""))) {
            for doc in v["docs"].as_array().into_iter().flatten() {
                if let Some(m) = openlibrary_doc_mapping(doc, norm_isbn.as_deref()).filter(|m| matches_book_query(m, t, clean_author)) {
                    if record(&mut primary, m, "openlibrary") {
                        return primary;
                    }
                    break;
                }
            }
        }
        if let Ok(g) = net.json(&format!("https://www.googleapis.com/books/v1/volumes?q={}&maxResults=5", enc(&query, ""))) {
            for item in g["items"].as_array().into_iter().flatten() {
                if let Some(m) = google_books_mapping(item, norm_isbn.as_deref()).filter(|m| matches_book_query(m, t, clean_author)) {
                    if record(&mut primary, m, "googlebooks") {
                        return primary;
                    }
                    break;
                }
            }
        }
    }

    primary
}

/// A book by its ISBN, as an entry's fields (`type: book`): Open Library, else Google Books, else Crossref/OpenAlex.
pub fn isbn_book(net: &dyn Net, isbn: &str) -> Result<Mapping, String> {
    let norm = normalize_isbn(isbn).unwrap_or_else(|| isbn.to_string());
    let ol = net.json(&format!("https://openlibrary.org/api/books?bibkeys=ISBN:{norm}&format=json&jscmd=data")).ok();
    let b = ol.as_ref().map(|j| &j[format!("ISBN:{norm}").as_str()]).filter(|b| b["title"].is_string());
    if let Some(mut m) = b.and_then(|obj| openlibrary_data_mapping(obj, &norm)) {
        if !book_is_complete(&m) {
            if let Some((sec, _)) = lookup_book_metadata(net, Some(&norm), None, None, None, "") {
                merge_book_fields(&mut m, &sec);
            }
        }
        return Ok(m);
    }
    let g_res = net.json(&format!("https://www.googleapis.com/books/v1/volumes?q=isbn:{norm}"));
    if let Ok(g) = g_res {
        if let Some(mut m) = g["items"].as_array().and_then(|a| a.first()).and_then(|it| google_books_mapping(it, Some(&norm))) {
            if !book_is_complete(&m) {
                if let Some((sec, _)) = lookup_book_metadata(net, Some(&norm), None, None, None, "") {
                    merge_book_fields(&mut m, &sec);
                }
            }
            return Ok(m);
        }
    }
    if let Some((m, _)) = lookup_book_metadata(net, Some(&norm), None, None, None, "") {
        return Ok(m);
    }
    Err(format!("ISBN {norm}: neither Open Library nor Google Books knows it"))
}

/// The first four-digit year in a free-form date ("June 2010", "2010-06-01").
fn year_in(d: &str) -> Option<&str> {
    d.as_bytes().windows(4).position(|w| w.iter().all(u8::is_ascii_digit) && matches!(w[0], b'1' | b'2')).map(|i| &d[i..i + 4])
}

fn strip_tags(x: &str) -> String {
    let mut out = String::new();
    let mut tag = false;
    for c in x.chars() {
        match c {
            '<' => tag = true,
            '>' => tag = false,
            c if !tag => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

// --- arXiv -----------------------------------------------------------------------------------------------------

/// Text of every `<tag>…</tag>` inside an XML fragment (enough for arXiv's Atom feed).
fn xml_all<'a>(x: &'a str, tag: &str) -> Vec<&'a str> {
    let (open, close) = (format!("<{tag}"), format!("</{tag}>"));
    let mut out = Vec::new();
    let mut rest = x;
    while let Some(i) = rest.find(&open) {
        let after = &rest[i..];
        let Some(gt) = after.find('>') else { break };
        let Some(end) = after.find(&close) else { break };
        // `<tag` must end the name (`<title` is not `<titles`)
        let named = after[open.len()..].starts_with(['>', ' ', '/', '\n', '\t']);
        if gt < end && named {
            out.push(&after[gt + 1..end]);
        }
        rest = &after[end + close.len()..];
    }
    out
}

/// XML's five entities, and whitespace runs as one space.
fn xml_text(x: &str) -> String {
    let t = x.split_whitespace().collect::<Vec<_>>().join(" ");
    t.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

/// arXiv's own record of a paper (its Atom API).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ArxivRecord {
    pub title: String,
    /// "Last, First", as the notes keep authors.
    pub authors: Vec<String>,
    /// `YYYY-MM-DD`
    pub published: Option<String>,
    pub summary: Option<String>,
    pub doi: Option<String>,
    pub journal_ref: Option<String>,
}

/// "P. W. Anderson" → "Anderson, P. W."
pub fn last_first(name: &str) -> String {
    match name.trim().rsplit_once(' ') {
        Some((given, family)) => format!("{family}, {}", given.trim()),
        None => name.trim().to_string(),
    }
}

/// Every `<entry>` of an arXiv Atom feed, paired with its parsed arXiv base id when `<id>` carries one.
pub fn parse_atom_entries(xml: &str) -> Vec<(Option<String>, ArxivRecord)> {
    xml_all(xml, "entry")
        .into_iter()
        .filter_map(|entry| {
            let one = |t: &str| xml_all(entry, t).first().map(|v| xml_text(v)).filter(|v| !v.is_empty());
            let id = one("id").and_then(|u| parse_arxiv(&u));
            Some((
                id,
                ArxivRecord {
                    title: one("title")?,
                    authors: xml_all(entry, "author").iter().filter_map(|a| xml_all(a, "name").first().map(|n| last_first(&xml_text(n)))).collect(),
                    published: one("published").map(|d| d.chars().take(10).collect()),
                    summary: one("summary"),
                    doi: one("arxiv:doi"),
                    journal_ref: one("arxiv:journal_ref"),
                },
            ))
        })
        .collect()
}

/// The feed's first entry; None when arXiv has none (an unknown id answers an empty feed).
pub fn parse_atom(xml: &str) -> Option<ArxivRecord> {
    parse_atom_entries(xml).into_iter().next().map(|(_, r)| r)
}

/// The Atom record of an arXiv id.
pub fn arxiv_record(net: &dyn Net, id: &str) -> Result<ArxivRecord, String> {
    let xml = net.text(&format!("https://export.arxiv.org/api/query?id_list={}", enc(id, "/"))).map_err(|e| format!("arXiv: {e}"))?;
    parse_atom(&xml).ok_or_else(|| format!("arXiv has no entry {id}"))
}

/// An arXiv paper as an entry's fields, enriching with Crossref venue/pages when a non-arXiv DOI is present.
pub fn arxiv(net: &dyn Net, id: &str) -> Result<Mapping, String> {
    let rec = arxiv_record(net, id)?;
    let mut m = arxiv_fields(&rec, id);
    if let Some(doi) = rec.doi.as_deref().map(str::trim).filter(|d| !d.is_empty() && !d.to_ascii_lowercase().starts_with("10.48550/arxiv.")) {
        if let Ok(cm) = crossref(net, doi) {
            for k in ["publicationTitle", "volume", "issue", "pages", "publisher"] {
                if let Some(v) = cm.get(k).and_then(Value::as_str).filter(|s| !s.trim().is_empty()) {
                    m.insert(k.into(), v.into());
                }
            }
            if cm.get("type").and_then(Value::as_str) == Some("journalArticle") || m.contains_key("publicationTitle") {
                m.insert("type".into(), "journalArticle".into());
            }
            if !m.contains_key("abstractNote") {
                if let Some(a) = cm.get("abstractNote").and_then(Value::as_str).filter(|s| !s.trim().is_empty()) {
                    m.insert("abstractNote".into(), a.into());
                }
            }
        }
    }
    Ok(m)
}

fn arxiv_fields(r: &ArxivRecord, id: &str) -> Mapping {
    let mut m = Mapping::new();
    m.insert("title".into(), r.title.clone().into());
    m.insert("type".into(), "preprint".into());
    m.insert("author".into(), Value::Sequence(r.authors.iter().cloned().map(Value::from).collect()));
    if let Some(d) = &r.published {
        m.insert("date".into(), d.clone().into());
    }
    if let Some(j) = r.journal_ref.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        m.insert("publicationTitle".into(), j.into());
    }
    if let Some(a) = &r.summary {
        m.insert("abstractNote".into(), a.clone().into());
    }
    m.insert("url".into(), format!("https://arxiv.org/abs/{id}").into());
    m.insert("archiveID".into(), format!("arXiv:{id}").into());
    m.insert("repository".into(), "arXiv".into());
    if let Some(doi) = &r.doi {
        m.insert("DOI".into(), doi.clone().into());
    }
    m
}

fn validate_work_candidate(cand: &Mapping, target_title: &str, target_authors: &[String], target_year: Option<&str>) -> bool {
    let Some(cand_title) = cand.get("title").and_then(Value::as_str) else { return false };
    let t_words = norm_words(target_title);
    let c_words = norm_words(cand_title);
    if t_words.is_empty() || c_words.is_empty() {
        return false;
    }
    let t_main = norm_words(target_title.split(':').next().unwrap_or(target_title));
    let c_main = norm_words(cand_title.split(':').next().unwrap_or(cand_title));
    let exact = c_words == t_words;
    let min_main = if target_authors.is_empty() { 4 } else { 2 };
    let main_match = t_main.len() >= min_main && (c_main == t_main || c_words == t_main || c_main == t_words);
    let jaccard_ok = if t_words.len() >= 4 && c_words.len() >= 4 {
        let ts: std::collections::BTreeSet<&str> = t_words.iter().map(String::as_str).collect();
        let cs: std::collections::BTreeSet<&str> = c_words.iter().map(String::as_str).collect();
        let inter = ts.intersection(&cs).count() as f64;
        let union = ts.union(&cs).count() as f64;
        union > 0.0 && (inter / union) >= 0.85
    } else {
        false
    };
    if !(exact || main_match || jaccard_ok) {
        return false;
    }
    if !target_authors.is_empty() {
        let mut target_surnames: Vec<String> = Vec::new();
        for a in target_authors {
            let s = a.split_once(',').map_or_else(|| a.split_whitespace().last().unwrap_or(a), |(l, _)| l.trim());
            target_surnames.extend(norm_words(s));
        }
        let cand_words: Vec<String> = ["author", "authors", "editor", "editors"]
            .into_iter()
            .flat_map(|k| cand.get(k).and_then(Value::as_sequence).into_iter().flatten())
            .filter_map(Value::as_str)
            .flat_map(norm_words)
            .collect();
        if cand_words.is_empty() {
            if !exact {
                return false;
            }
        } else if !target_surnames.iter().any(|s| cand_words.contains(s)) {
            return false;
        }
    }
    if let Some(ty) = target_year.and_then(year_in).and_then(|y| y.parse::<i32>().ok()) {
        let cy = cand
            .get("date")
            .and_then(Value::as_str)
            .or_else(|| cand.get("year").and_then(Value::as_str))
            .and_then(year_in)
            .and_then(|y| y.parse::<i32>().ok());
        if let Some(cy) = cy {
            if (ty - cy).abs() > 5 {
                return false;
            }
        }
    }
    true
}

fn openalex_work_mapping(w: &Json) -> Option<Mapping> {
    let title = w["display_name"].as_str().or_else(|| w["title"].as_str())?.trim();
    if title.is_empty() {
        return None;
    }
    let mut m = Mapping::new();
    m.insert("title".into(), title.into());
    let ztype = match w["type"].as_str().unwrap_or("") {
        "article" | "journal-article" => "journalArticle",
        "book" | "monograph" | "edited-book" | "reference-book" => "book",
        "book-chapter" => "bookSection",
        "dissertation" => "thesis",
        "preprint" => "preprint",
        "proceedings-article" => "conferencePaper",
        _ => "document",
    };
    m.insert("type".into(), ztype.into());
    let authors: Vec<Value> = w["authorships"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|a| a["author"]["display_name"].as_str())
        .map(norm_person)
        .filter(|n| !n.is_empty())
        .map(Value::from)
        .collect();
    if !authors.is_empty() {
        m.insert("author".into(), Value::Sequence(authors));
    }
    if let Some(d) = w["publication_date"].as_str().map(String::from).or_else(|| json_str_or_num(&w["publication_year"])) {
        m.insert("date".into(), d.into());
    }
    if let Some(v) = w["primary_location"]["source"]["display_name"].as_str().filter(|s| !s.trim().is_empty()) {
        m.insert("publicationTitle".into(), v.into());
    }
    let raw_doi = openalex_doi(w);
    if let Some(ax) = raw_doi.strip_prefix("10.48550/arxiv.") {
        m.insert("archiveID".into(), format!("arXiv:{ax}").into());
        m.insert("repository".into(), "arXiv".into());
    } else if !raw_doi.is_empty() {
        m.insert("DOI".into(), raw_doi.into());
    }
    if !m.contains_key("archiveID") {
        if let Some(ax) = openalex_arxiv_id(w) {
            m.insert("archiveID".into(), format!("arXiv:{ax}").into());
        }
    }
    if let Some(abs) = openalex_abstract(&w["abstract_inverted_index"]).filter(|s| !s.trim().is_empty()) {
        m.insert("abstractNote".into(), abs.into());
    }
    if let Some(u) = w["primary_location"]["landing_page_url"].as_str().or_else(|| w["id"].as_str()) {
        m.insert("url".into(), u.into());
    }
    Some(m)
}

fn s2_work_mapping(item: &Json) -> Option<Mapping> {
    let title = item["title"].as_str()?.trim();
    if title.is_empty() {
        return None;
    }
    let mut m = Mapping::new();
    m.insert("title".into(), title.into());
    let authors: Vec<Value> = item["authors"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|a| a["name"].as_str())
        .map(norm_person)
        .filter(|n| !n.is_empty())
        .map(Value::from)
        .collect();
    if !authors.is_empty() {
        m.insert("author".into(), Value::Sequence(authors));
    }
    if let Some(y) = json_str_or_num(&item["year"]) {
        m.insert("date".into(), y.into());
    }
    if let Some(v) = item["venue"].as_str().map(str::trim).filter(|s| !s.is_empty()) {
        m.insert("publicationTitle".into(), v.into());
        m.insert("type".into(), "journalArticle".into());
    } else if item["externalIds"]["ArXiv"].is_string() {
        m.insert("type".into(), "preprint".into());
    } else {
        m.insert("type".into(), "document".into());
    }
    if let Some(d) = item["externalIds"]["DOI"].as_str().map(str::trim).filter(|s| !s.is_empty()) {
        m.insert("DOI".into(), d.into());
    }
    if let Some(ax) = item["externalIds"]["ArXiv"].as_str().map(str::trim).filter(|s| !s.is_empty()) {
        m.insert("archiveID".into(), format!("arXiv:{ax}").into());
        m.insert("repository".into(), "arXiv".into());
    }
    if let Some(abs) = item["abstract"].as_str().map(str::trim).filter(|s| !s.is_empty()) {
        m.insert("abstractNote".into(), abs.into());
    }
    if let Some(u) = item["url"].as_str().map(str::trim).filter(|s| !s.is_empty()) {
        m.insert("url".into(), u.into());
    }
    Some(m)
}

/// Looks up a paper, thesis, or manuscript across Crossref, OpenAlex, arXiv, INSPIRE-HEP, and Semantic Scholar
/// using title + authors + optional year, returning the first strictly validated hit.
pub fn lookup_work_by_title_author(
    net: &dyn Net,
    email: &str,
    title: &str,
    authors: &[String],
    year: Option<&str>,
) -> Option<(Mapping, &'static str)> {
    let clean_title = title.trim();
    if clean_title.is_empty() {
        return None;
    }
    let first_surname = authors
        .first()
        .map(|a| a.split_once(',').map_or_else(|| a.split_whitespace().last().unwrap_or(a), |(l, _)| l.trim()))
        .filter(|s| !s.is_empty());
    let query = match first_surname {
        Some(s) => format!("{clean_title} {s}"),
        None => clean_title.to_string(),
    };
    let mailto_amp = if email.is_empty() { String::new() } else { format!("&mailto={}", enc(email, "")) };

    if let Ok(v) = net.json(&format!("https://api.crossref.org/works?rows=5&query.bibliographic={}", enc(&query, ""))) {
        for w in v["message"]["items"].as_array().into_iter().flatten() {
            let doi = w["DOI"].as_str().unwrap_or("");
            let mut m = crossref_fields(w, doi);
            if validate_work_candidate(&m, clean_title, authors, year) {
                if !doi.is_empty() {
                    if let Ok(enriched) = crossref_with_openalex(net, doi, email) {
                        m = enriched;
                    }
                }
                return Some((m, "crossref"));
            }
        }
    }

    if let Ok(v) = net.json(&format!("https://api.openalex.org/works?per-page=5&search={}{mailto_amp}", enc(&query, ""))) {
        for w in v["results"].as_array().into_iter().flatten() {
            if let Some(m) = openalex_work_mapping(w).filter(|m| validate_work_candidate(m, clean_title, authors, year)) {
                return Some((m, "openalex"));
            }
        }
    }

    if let Ok(xml) = net.text(&format!("https://export.arxiv.org/api/query?max_results=5&search_query=all:{}", enc(&query, ""))) {
        for (ax, r) in parse_atom_entries(&xml) {
            let Some(id_str) = ax.filter(|s| !s.is_empty()) else { continue };
            let mut m = arxiv_fields(&r, &id_str);
            if validate_work_candidate(&m, clean_title, authors, year) {
                if let Some(doi) = r.doi.as_deref().map(str::trim).filter(|d| !d.is_empty() && !d.to_ascii_lowercase().starts_with("10.48550/arxiv.")) {
                    if let Ok(cm) = crossref(net, doi) {
                        for k in ["publicationTitle", "volume", "issue", "pages", "publisher"] {
                            if let Some(val) = cm.get(k).and_then(Value::as_str).filter(|s| !s.trim().is_empty()) {
                                m.insert(k.into(), val.into());
                            }
                        }
                        if cm.get("type").and_then(Value::as_str) == Some("journalArticle") || m.contains_key("publicationTitle") {
                            m.insert("type".into(), "journalArticle".into());
                        }
                    }
                }
                return Some((m, "arxiv"));
            }
        }
    }

    if let Ok(v) = net.json(&format!("https://inspirehep.net/api/literature?q={}&size=5", enc(&query, ""))) {
        for h in v["hits"]["hits"].as_array().into_iter().flatten() {
            let m = crate::enrich::inspire_fields(&h["metadata"]);
            if validate_work_candidate(&m, clean_title, authors, year) {
                return Some((m, "inspire"));
            }
        }
    }

    if let Ok(v) = net.json(&format!(
        "https://api.semanticscholar.org/graph/v1/paper/search?query={}&limit=5&fields=title,authors,year,venue,externalIds,abstract,url",
        enc(&query, "")
    )) {
        for item in v["data"].as_array().into_iter().flatten() {
            if let Some(m) = s2_work_mapping(item).filter(|m| validate_work_candidate(m, clean_title, authors, year)) {
                return Some((m, "semanticscholar"));
            }
        }
    }

    None
}

// --- open-access PDFs ------------------------------------------------------------------------------------------

/// The open-access indexes asked after OpenAlex and Unpaywall: the papers-open-access plugin's, folded in. CORE needs the plugin's `core_key` secret.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Index {
    SemanticScholar,
    EuropePmc,
    Core,
}

impl Index {
    const ALL: [Index; 3] = [Index::SemanticScholar, Index::EuropePmc, Index::Core];

    fn name(self) -> &'static str {
        match self {
            Index::SemanticScholar => "semanticscholar",
            Index::EuropePmc => "europepmc",
            Index::Core => "core",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Index::SemanticScholar => "Semantic Scholar",
            Index::EuropePmc => "Europe PMC",
            Index::Core => "CORE",
        }
    }

    /// The indexes a setting names, in its order (unknown names left out); all of them when it names none.
    pub fn order(setting: &str) -> Vec<Index> {
        let named: Vec<Index> = setting
            .to_lowercase()
            .split([',', ' ', '\t', '\n'])
            .filter_map(|n| Index::ALL.into_iter().find(|i| i.name() == n))
            .fold(Vec::new(), |mut v, i| {
                if !v.contains(&i) {
                    v.push(i);
                }
                v
            });
        if named.is_empty() {
            Index::ALL.to_vec()
        } else {
            named
        }
    }

    /// The open copies this index knows of a DOI's paper; an index that is down or has none gives nothing.
    fn pdf_urls(self, net: &dyn Net, doi: &str) -> Vec<String> {
        let q = enc(&doi.to_lowercase(), "/");
        match self {
            Index::SemanticScholar => net
                .json(&format!("https://api.semanticscholar.org/graph/v1/paper/DOI:{q}?fields=openAccessPdf"))
                .map(|v| v["openAccessPdf"]["url"].as_str().map(String::from).into_iter().collect())
                .unwrap_or_default(),
            Index::EuropePmc => {
                let query = enc(&format!("DOI:\"{}\"", doi.to_lowercase()), "");
                net.json(&format!("https://www.ebi.ac.uk/europepmc/webservices/rest/search?query={query}&resultType=core&format=json"))
                    .map(|v| europepmc_pdf_urls(&v))
                    .unwrap_or_default()
            }
            Index::Core => net
                .json_with_secret(&format!("https://api.core.ac.uk/v3/search/works?q=doi:%22{q}%22&limit=5"), "core_key", "Bearer ")
                .map(|v| v["results"].as_array().into_iter().flatten().filter_map(|r| r["downloadUrl"].as_str().map(String::from)).collect())
                .unwrap_or_default(),
        }
    }
}

/// Europe PMC's full texts that are PDFs and open (`OA`) or free (`F`).
fn europepmc_pdf_urls(v: &Json) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for r in v["resultList"]["result"].as_array().into_iter().flatten() {
        for f in r["fullTextUrlList"]["fullTextUrl"].as_array().into_iter().flatten() {
            let open = matches!(f["availabilityCode"].as_str(), Some("OA" | "F"));
            if let Some(u) = f["url"].as_str().filter(|u| open && f["documentStyle"] == "pdf" && !out.iter().any(|o| o == u)) {
                out.push(u.to_string());
            }
        }
    }
    out
}

/// Where open-access copies of a DOI's PDF are, best first, with who said so: OpenAlex's best location and its other
/// open ones, then Unpaywall's (only with an email, which it requires), then the `more` indexes in their order. Lazy:
/// an index is asked only when the copies before it failed.
pub fn open_access_pdfs<'a>(net: &'a dyn Net, doi: &'a str, email: &'a str, more: &'a [Index]) -> impl Iterator<Item = (String, &'static str)> + 'a {
    let openalex = std::iter::once(()).flat_map(move |_| {
        let mailto = if email.is_empty() { String::new() } else { format!("?mailto={}", enc(email, "")) };
        let v = net.json(&format!("https://api.openalex.org/works/doi:{}{mailto}", enc(doi, "/")));
        v.map(|v| openalex_pdf_urls(&v, doi)).unwrap_or_default().into_iter().map(|u| (u, "OpenAlex"))
    });
    let unpaywall = std::iter::once(()).filter(move |_| !email.is_empty()).flat_map(move |_| {
        let v = net.json(&format!("https://api.unpaywall.org/v2/{}?email={}", enc(doi, "/"), enc(email, ""))).unwrap_or_default();
        let direct = unpaywall_pdf_urls(&v);
        // then the repository copies Unpaywall knows only by their page: the PDF that page names, asked for lazily
        let pages = unpaywall_landing_pages(&v);
        let named = pages.into_iter().filter_map(move |page| net.text(&page).ok().and_then(|html| citation_pdf_url(&html, &page)));
        direct.into_iter().map(|u| (u, "Unpaywall")).chain(named.map(|u| (u, "Unpaywall (repository page)")))
    });
    let more = more.iter().flat_map(move |i| i.pdf_urls(net, doi).into_iter().map(move |u| (u, i.label())));
    openalex.chain(unpaywall).chain(more)
}

/// OpenAlex's abstract, kept as word → places.
pub(crate) fn openalex_abstract(inverted: &Json) -> Option<String> {
    let mut at: Vec<(u64, &str)> = Vec::new();
    for (word, places) in inverted.as_object()? {
        at.extend(places.as_array().into_iter().flatten().filter_map(Json::as_u64).map(|i| (i, word.as_str())));
    }
    at.sort_by_key(|(i, _)| *i);
    (!at.is_empty()).then(|| at.iter().map(|(_, w)| *w).collect::<Vec<_>>().join(" "))
}

/// The DOI OpenAlex answered about (it merges records now and then: an arXiv preprint was once answered
/// with another work), lower-case, without `https://doi.org/`.
pub fn openalex_doi(w: &Json) -> String {
    let d = w["ids"]["doi"].as_str().or_else(|| w["doi"].as_str()).unwrap_or_default();
    d.trim_start_matches("https://doi.org/").to_lowercase()
}

/// OpenAlex's open PDF addresses for a work — only when the work it answered is that DOI's.
pub fn openalex_pdf_urls(v: &Json, doi: &str) -> Vec<String> {
    if openalex_doi(v) != doi.to_lowercase() {
        return Vec::new();
    }
    let mut out: Vec<String> = Vec::new();
    let locations = std::iter::once(&v["best_oa_location"]).chain(v["locations"].as_array().into_iter().flatten());
    for l in locations.filter(|l| l["is_oa"].as_bool().unwrap_or(true)) {
        if let Some(u) = l["pdf_url"].as_str().filter(|u| !out.iter().any(|o| o == u)) {
            out.push(u.to_string());
        }
    }
    out
}

/// Unpaywall's locations, its best first, then the others by version: the published one before the accepted
/// manuscript before the preprint (a reader wants the journal's pages when an open copy of them exists).
fn unpaywall_locations(v: &Json) -> Vec<&Json> {
    let rank = |l: &Json| match l["version"].as_str() {
        Some("publishedVersion") => 0,
        Some("acceptedVersion") => 1,
        Some("submittedVersion") => 2,
        _ => 3,
    };
    let mut others: Vec<&Json> = v["oa_locations"].as_array().into_iter().flatten().collect();
    others.sort_by_key(|l| rank(l)); // stable: Unpaywall's own order within a version
    std::iter::once(&v["best_oa_location"]).chain(others).collect()
}

pub fn unpaywall_pdf_urls(v: &Json) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for l in unpaywall_locations(v) {
        if let Some(u) = l["url_for_pdf"].as_str().filter(|u| !out.iter().any(|o| o == u)) {
            out.push(u.to_string());
        }
    }
    out
}

/// The pages of Unpaywall's open copies that have no PDF address of their own (a repository's record page).
pub fn unpaywall_landing_pages(v: &Json) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for l in unpaywall_locations(v).into_iter().filter(|l| l["url_for_pdf"].is_null()) {
        if let Some(u) = l["url_for_landing_page"].as_str().filter(|u| !out.iter().any(|o| o == u)) {
            out.push(u.to_string());
        }
    }
    out
}

/// The PDF a scholarly page names in its `<meta name="citation_pdf_url" content="…">` (the Highwire tags Google
/// Scholar reads, which repositories and publishers write), made absolute against the page's address.
pub fn citation_pdf_url(html: &str, page: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let mut from = 0;
    while let Some(i) = lower[from..].find("<meta") {
        let start = from + i;
        let end = start + lower[start..].find('>')?;
        let tag = &html[start..end];
        from = end;
        let attr = |name: &str| -> Option<String> {
            let t = tag.to_ascii_lowercase();
            let at = t.find(&format!("{name}="))? + name.len() + 1;
            let rest = &tag[at..];
            let q = rest.chars().next().filter(|c| *c == '"' || *c == '\'')?;
            Some(rest[1..].split(q).next()?.to_string())
        };
        if attr("name").is_some_and(|n| n.eq_ignore_ascii_case("citation_pdf_url")) {
            let u = attr("content")?.replace("&amp;", "&");
            return Some(absolute(&u, page));
        }
    }
    None
}

/// `u` made absolute against `page` (`/x.pdf` → the page's site + `/x.pdf`; `x.pdf` → beside the page).
fn absolute(u: &str, page: &str) -> String {
    if u.starts_with("http://") || u.starts_with("https://") {
        return u.to_string();
    }
    let site_end = page.find("://").map_or(0, |i| i + 3);
    let site = &page[..site_end + page[site_end..].find('/').unwrap_or(page.len() - site_end)];
    if let Some(rest) = u.strip_prefix("//") {
        return format!("{}//{rest}", &page[..site_end.saturating_sub(2)]);
    }
    if u.starts_with('/') {
        return format!("{site}{u}");
    }
    format!("{}/{u}", page.rsplit_once('/').map_or(page, |(d, _)| d))
}

#[cfg(test)]
mod tests {
    #[test]
    fn an_isbn_is_found_on_a_copyright_page_and_checked() {
        let page = "Springer\nISBN 978-3-540-32897-1 e-ISBN 978-3-540-32899-8\nDOI 10.1007/978-3-540-32899-8\n";
        assert_eq!(super::parse_isbn(page).as_deref(), Some("9783540328971"));
        assert_eq!(super::parse_isbn("ISBN-10: 0-306-40615-2").as_deref(), Some("0306406152"));
        assert_eq!(super::parse_isbn("call 978-3-540-32897-2 now"), None, "a bad check digit");
        assert_eq!(super::parse_isbn("printed 9783540328971."), Some("9783540328971".into()), "bare, no mark");
        assert_eq!(super::parse_isbn("no number here"), None);
    }

    #[test]
    fn a_book_comes_from_open_library_else_google_books() {
        use crate::net::fake::{Answer, Table};
        let ol = serde_json::json!({ "ISBN:9783540328971": { "title": "Group Theory", "subtitle": "Application to the Physics of Condensed Matter",
            "authors": [{ "name": "Mildred S. Dresselhaus" }, { "name": "Gene Dresselhaus" }], "publish_date": "2008", "publishers": [{ "name": "Springer" }], "number_of_pages": 582 } });
        let net = Table::default().on("https://openlibrary.org/api/books?bibkeys=ISBN:9783540328971", Answer::Json(ol));
        let m = super::isbn_book(&net, "9783540328971").unwrap();
        let get = |k: &str| m.get(k).and_then(|v| v.as_str()).map(String::from);
        assert_eq!(get("title").as_deref(), Some("Group Theory: Application to the Physics of Condensed Matter"));
        assert_eq!((get("type").as_deref(), get("date").as_deref(), get("publisher").as_deref(), get("ISBN").as_deref()), (Some("book"), Some("2008"), Some("Springer"), Some("9783540328971")));
        assert_eq!(m.get("author").and_then(|a| a.as_sequence()).map(|a| a[0].as_str().unwrap().to_string()).as_deref(), Some("Dresselhaus, Mildred S."));
        let g = serde_json::json!({ "items": [{ "volumeInfo": { "title": "Some Book", "authors": ["Ada Lovelace"], "publishedDate": "1843-01-01", "pageCount": 120 } }] });
        let net = Table::default().on("https://openlibrary.org/", Answer::Json(serde_json::json!({}))).on("https://www.googleapis.com/books/v1/volumes?q=isbn:0306406152", Answer::Json(g));
        let m = super::isbn_book(&net, "0306406152").unwrap();
        assert_eq!(m.get("title").and_then(|v| v.as_str()), Some("Some Book"));
        assert_eq!(m.get("date").and_then(|v| v.as_str()), Some("1843"));
    }

    use super::*;
    use crate::net::fake::{Answer, Table};
    use serde_json::json;

    #[test]
    fn open_access_pdfs_are_read_best_first_and_only_for_the_doi_asked() {
        let work = json!({
            "doi": "https://doi.org/10.1103/revmodphys.77.1027",
            "best_oa_location": { "is_oa": true, "pdf_url": "https://arxiv.org/pdf/cond-mat/0404055" },
            "locations": [
                { "is_oa": false, "pdf_url": "https://publisher.example/paywalled.pdf" },
                { "is_oa": true, "pdf_url": "https://arxiv.org/pdf/cond-mat/0404055" },
                { "is_oa": true, "pdf_url": "https://repo.example/oa.pdf" }
            ]
        });
        assert_eq!(openalex_pdf_urls(&work, "10.1103/RevModPhys.77.1027"), ["https://arxiv.org/pdf/cond-mat/0404055", "https://repo.example/oa.pdf"]);
        assert!(openalex_pdf_urls(&work, "10.1/another").is_empty(), "an answer about another work is not used");
        let up = json!({ "best_oa_location": { "url_for_pdf": "https://a.example/x.pdf" }, "oa_locations": [{ "url_for_pdf": "https://a.example/x.pdf" }, { "url_for_pdf": null }, { "url_for_pdf": "https://b.example/y.pdf" }] });
        assert_eq!(unpaywall_pdf_urls(&up), ["https://a.example/x.pdf", "https://b.example/y.pdf"]);
        // lazily: Unpaywall only without an email is never asked
        let net = Table::default().on("https://api.openalex.org/", Answer::Json(work));
        let found: Vec<_> = open_access_pdfs(&net, "10.1103/revmodphys.77.1027", "", &[]).collect();
        assert_eq!(found.len(), 2);
        assert!(net.asked.borrow().iter().all(|u| !u.contains("unpaywall")));
    }

    #[test]
    fn unpaywall_prefers_the_published_version_and_follows_a_repository_page_to_its_pdf() {
        let up = json!({
            "best_oa_location": { "url_for_pdf": "https://best.example/b.pdf", "version": "acceptedVersion" },
            "oa_locations": [
                { "url_for_pdf": "https://arxiv.example/pre.pdf", "version": "submittedVersion" },
                { "url_for_pdf": null, "url_for_landing_page": "https://hal.example/record/42", "version": "publishedVersion" },
                { "url_for_pdf": "https://journal.example/pub.pdf", "version": "publishedVersion" }
            ]
        });
        assert_eq!(unpaywall_pdf_urls(&up), ["https://best.example/b.pdf", "https://journal.example/pub.pdf", "https://arxiv.example/pre.pdf"]);
        assert_eq!(unpaywall_landing_pages(&up), ["https://hal.example/record/42"]);
        let page = r#"<html><head><meta name="citation_title" content="X"><META NAME='citation_pdf_url' CONTENT='/record/42/file.pdf?a=1&amp;b=2'></head></html>"#;
        assert_eq!(citation_pdf_url(page, "https://hal.example/record/42").as_deref(), Some("https://hal.example/record/42/file.pdf?a=1&b=2"));
        assert_eq!(citation_pdf_url("<meta name=\"citation_pdf_url\" content=\"f.pdf\">", "https://r.example/a/b").as_deref(), Some("https://r.example/a/f.pdf"));
        assert_eq!(citation_pdf_url("<meta name=\"description\" content=\"x\">", "https://r.example/"), None);
        // the page is asked only after the direct copies, and its PDF comes last, said where it came from
        let net = Table::default()
            .on("https://api.openalex.org/", Answer::Json(json!({})))
            .on("https://api.unpaywall.org/", Answer::Json(up))
            .on("https://hal.example/record/42", Answer::Text(page.into()));
        let found: Vec<_> = open_access_pdfs(&net, "10.1/x", "me@example.org", &[]).collect();
        assert_eq!(found.last().unwrap(), &("https://hal.example/record/42/file.pdf?a=1&b=2".to_string(), "Unpaywall (repository page)"));
        assert_eq!(found.len(), 4);
    }

    #[test]
    fn the_other_indexes_come_after_in_the_settings_order_and_only_when_the_ones_before_had_nothing() {
        assert_eq!(Index::order(""), [Index::SemanticScholar, Index::EuropePmc, Index::Core]);
        assert_eq!(Index::order("core, europepmc, bogus, core"), [Index::Core, Index::EuropePmc]);
        let epmc = json!({ "resultList": { "result": [{ "fullTextUrlList": { "fullTextUrl": [
            { "documentStyle": "pdf", "availabilityCode": "OA", "url": "https://europepmc.org/a.pdf" },
            { "documentStyle": "html", "availabilityCode": "OA", "url": "https://europepmc.org/a.html" },
            { "documentStyle": "pdf", "availabilityCode": "S", "url": "https://publisher.example/paid.pdf" } ] } }] } });
        let net = Table::default()
            .on("https://api.semanticscholar.org/graph/v1/paper/DOI:10.1/x?fields=openAccessPdf", Answer::Json(json!({ "openAccessPdf": { "url": "https://s2.example/x.pdf" } })))
            .on("https://www.ebi.ac.uk/europepmc/", Answer::Json(epmc))
            .on("https://api.core.ac.uk/", Answer::Json(json!({ "results": [{ "downloadUrl": "https://core.example/x.pdf" }, { "downloadUrl": null }] })));
        let order = Index::order("");
        let mut found = open_access_pdfs(&net, "10.1/X", "", &order);
        assert_eq!(found.next(), Some(("https://s2.example/x.pdf".into(), "Semantic Scholar")));
        assert!(net.asked.borrow().iter().all(|u| !u.contains("ebi.ac.uk")), "Europe PMC waits until Semantic Scholar's copy failed");
        assert_eq!(found.collect::<Vec<_>>(), [("https://europepmc.org/a.pdf".into(), "Europe PMC"), ("https://core.example/x.pdf".into(), "CORE")]);
        assert!(net.asked.borrow().iter().any(|u| u.starts_with("https://api.core.ac.uk/") && u.ends_with("#secret=core_key")), "CORE with its key");
    }

    #[test]
    fn parses_identifier_shapes() {
        assert_eq!(parse_doi("https://doi.org/10.1103/PhysRevB.62.R9283").as_deref(), Some("10.1103/PhysRevB.62.R9283"));
        assert_eq!(parse_doi("doi:10.1017/9781108781244.").as_deref(), Some("10.1017/9781108781244"));
        assert_eq!(parse_doi("hello"), None);
        assert_eq!(parse_arxiv("https://arxiv.org/abs/2301.12345v2").as_deref(), Some("2301.12345"));
        assert_eq!(parse_arxiv_versioned("https://arxiv.org/abs/2301.12345v2"), Some(("2301.12345".into(), Some("v2".into()))));
        assert_eq!(parse_arxiv_versioned("arXiv:cond-mat/0101001"), Some(("cond-mat/0101001".into(), None)));
        assert_eq!(parse_arxiv("arXiv:cond-mat/0101001").as_deref(), Some("cond-mat/0101001"));
        assert_eq!(parse_arxiv("2409.01234").as_deref(), Some("2409.01234"));
        // a letter whose full lower case is longer, before the id, does not move where it is read
        assert_eq!(parse_arxiv("İnce, Kelvin K — arXiv:2409.01234").as_deref(), Some("2409.01234"));
        assert_eq!(parse_arxiv("10.1103/PhysRevB.62"), None);
    }

    #[test]
    fn crossref_and_arxiv_records_become_an_entrys_fields() {
        let w = json!({ "message": { "title": ["More Is Different"], "type": "journal-article", "author": [{ "family": "Anderson", "given": "P. W." }],
            "issued": { "date-parts": [[1972, 8, 4]] }, "container-title": ["Science"], "abstract": "<jats:p>The reductionist\n hypothesis</jats:p>" } });
        let net = Table::default().on("https://api.crossref.org/works/10.1126/science.177.4047.393", Answer::Json(w));
        let m = crossref(&net, "10.1126/science.177.4047.393").unwrap();
        assert_eq!((m["type"].as_str(), m["date"].as_str(), m["author"][0].as_str()), (Some("journalArticle"), Some("1972-08-04"), Some("Anderson, P. W.")));
        assert_eq!(m["abstractNote"].as_str(), Some("The reductionist hypothesis"));
        assert!(crossref(&net, "10.1/unknown").unwrap_err().starts_with("Crossref:"));
        let atom = "<feed><title>arXiv Query</title><entry><title>Attention &amp; You</title><published>2017-06-12T17:57:34Z</published>\
            <author><name>Ashish Vaswani</name></author><arxiv:doi xmlns:arxiv=\"x\">10.1/a</arxiv:doi></entry></feed>";
        let net = Table::default().on("https://export.arxiv.org/api/query?id_list=1706.03762", Answer::Text(atom.into()));
        let m = arxiv(&net, "1706.03762").unwrap();
        assert_eq!((m["title"].as_str(), m["date"].as_str(), m["DOI"].as_str()), (Some("Attention & You"), Some("2017-06-12"), Some("10.1/a")));
        assert_eq!(m["archiveID"].as_str(), Some("arXiv:1706.03762"));
        assert_eq!(parse_atom("<feed><title>none</title></feed>"), None, "no entry: arXiv does not know it");
    }

    #[test]
    fn parse_arxiv_anywhere_handles_filenames_headers_legacy_and_rejects_false_positives() {
        // Modern filenames, paths, headers, URLs, and arXiv DOIs
        assert_eq!(parse_arxiv_anywhere("2604.06107v1.pdf"), Some(("2604.06107".into(), Some("v1".into()))));
        assert_eq!(parse_arxiv_anywhere("papers/Author_2604.06107v1.pdf"), Some(("2604.06107".into(), Some("v1".into()))));
        assert_eq!(parse_arxiv_anywhere("Author.2604.06107v2.pdf"), Some(("2604.06107".into(), Some("v2".into()))));
        assert_eq!(parse_arxiv_anywhere("Header line\narXiv: 2604.06107v1 [hep-th] 7 Apr 2026"), Some(("2604.06107".into(), Some("v1".into()))));
        assert_eq!(parse_arxiv_anywhere("https://arxiv.org/pdf/2604.06107v1.pdf#page=2"), Some(("2604.06107".into(), Some("v1".into()))));
        assert_eq!(parse_arxiv_anywhere("10.48550/arXiv.2401.12345v2"), Some(("2401.12345".into(), Some("v2".into()))));
        assert_eq!(parse_arxiv_anywhere("1205.1234"), Some(("1205.1234".into(), None)));

        // Legacy archive/YYMMNNN(vK)
        assert_eq!(parse_arxiv_anywhere("notes/cond-mat/0101001v2.pdf"), Some(("cond-mat/0101001".into(), Some("v2".into()))));
        assert_eq!(parse_arxiv_anywhere("See hep-th/9905111v1 for proof."), Some(("hep-th/9905111".into(), Some("v1".into()))));
        assert_eq!(parse_arxiv_anywhere("arXiv:math.GT/0309136"), Some(("math.GT/0309136".into(), None)));

        // Avoid false positives on ISBNs, non-arXiv DOIs, URLs, and dates
        assert_eq!(parse_arxiv_anywhere("ISBN 978-0-306-40615-7"), None);
        assert_eq!(parse_arxiv_anywhere("ISBN-10: 0-306-40615-2"), None);
        assert_eq!(parse_arxiv_anywhere("doi:10.1016/j.nuclphysb.2012.01234"), None);
        assert_eq!(parse_arxiv_anywhere("https://doi.org/10.1007/978-0-306-40615-7"), None);
        assert_eq!(parse_arxiv_anywhere("https://inspirehep.net/literature/1234567"), None);
        assert_eq!(parse_arxiv_anywhere("Dated 2026-04-06, 2026.04.06, 06.04.2026, 2012.0406, 0703.1234"), None);
        assert_eq!(parse_arxiv_anywhere("2604.061071"), None);
        assert_eq!(parse_arxiv_anywhere("2024.12345"), None);
    }

    #[test]
    fn normalize_isbn_strips_prefixes_hyphens_and_spaces() {
        assert_eq!(normalize_isbn("ISBN-13: 978-0-306-40615-7").as_deref(), Some("9780306406157"));
        assert_eq!(normalize_isbn("isbn: 0-8044-2957-x").as_deref(), Some("080442957X"));
        assert_eq!(normalize_isbn("978 3 16 148410 0").as_deref(), Some("9783161484100"));
        assert_eq!(normalize_isbn("not-an-isbn"), None);
    }

    #[test]
    fn lookup_book_metadata_supports_crossref_openalex_and_openlibrary() {
        // 1. Crossref monograph by ISBN + edited-book / incollection shapes
        let cr_book = json!({
            "message": {
                "items": [{
                    "type": "monograph",
                    "title": ["Synthetic Quantum Mechanics"],
                    "subtitle": ["Foundations"],
                    "author": [{ "family": "Researcher", "given": "A." }],
                    "editor": [{ "family": "Editor", "given": "B." }],
                    "issued": { "date-parts": [[2021, 5]] },
                    "publisher": "Example University Press",
                    "container-title": ["Graduate Texts in Physics"],
                    "volume": "12",
                    "edition-number": "2",
                    "ISBN": ["978-0-306-40615-7"],
                    "DOI": "10.1000/book.example.1",
                    "URL": "https://example.org/book/1",
                    "abstract": "<jats:p>Synthetic textbook summary.</jats:p>"
                }]
            }
        });
        let net = Table::default().on("https://api.crossref.org/works?filter=isbn:9780306406157", Answer::Json(cr_book));
        let (m, src) = lookup_book_metadata(&net, Some("978-0-306-40615-7"), None, None, None, "me@example.org").unwrap();
        assert_eq!(src, "crossref");
        assert_eq!(m["title"].as_str(), Some("Synthetic Quantum Mechanics: Foundations"));
        assert_eq!(m["kind"].as_str(), Some("science_book"));
        assert_eq!(m["bibtexType"].as_str(), Some("book"));
        assert_eq!(m["type"].as_str(), Some("book"));
        assert_eq!(m["publisher"].as_str(), Some("Example University Press"));
        assert_eq!(m["series"].as_str(), Some("Graduate Texts in Physics"));
        assert_eq!(m["edition"].as_str(), Some("2"));
        assert_eq!(m["volume"].as_str(), Some("12"));
        assert_eq!(m["isbn"].as_str(), Some("9780306406157"));
        assert_eq!(m["ISBN"].as_str(), Some("9780306406157"));
        assert_eq!(m["year"].as_str(), Some("2021"));
        assert_eq!(m["authors"][0].as_str(), Some("Researcher, A."));
        assert_eq!(m["editors"][0].as_str(), Some("Editor, B."));
        assert_eq!(m["abstract"].as_str(), Some("Synthetic textbook summary."));

        // Crossref book-chapter by DOI -> incollection / bookSection
        let cr_chapter = json!({
            "message": {
                "type": "book-chapter",
                "title": ["Chapter One: Operators"],
                "author": [{ "family": "Writer", "given": "C." }],
                "container-title": ["Handbook of Synthetic Methods"],
                "issued": { "date-parts": [[2020]] },
                "publisher": "Example Press",
                "DOI": "10.1000/chapter.example.1"
            }
        });
        let net = Table::default().on("https://api.crossref.org/works/10.1000/chapter.example.1", Answer::Json(cr_chapter));
        let (m, src) = lookup_book_metadata(&net, None, Some("10.1000/chapter.example.1"), None, None, "").unwrap();
        assert_eq!((src, m["bibtexType"].as_str(), m["type"].as_str(), m["bookTitle"].as_str()), ("crossref", Some("incollection"), Some("bookSection"), Some("Handbook of Synthetic Methods")));

        // 2. OpenAlex book by ISBN when Crossref misses
        let oa_book = json!({
            "results": [{
                "id": "https://openalex.org/W999",
                "type": "book",
                "display_name": "Civic Architecture History",
                "publication_year": 2018,
                "publication_date": "2018-03-10",
                "ids": { "doi": "https://doi.org/10.1000/oa.book.1", "isbn": "9783161484100" },
                "authorships": [{ "author": { "display_name": "Dana Example" } }],
                "primary_location": { "landing_page_url": "https://example.org/oa-book", "source": { "host_organization_name": "Synthetic Academic Press" } },
                "abstract_inverted_index": { "Urban": [0], "design": [1], "monograph.": [2] }
            }]
        });
        let net = Table::default().on("https://api.openalex.org/works?filter=ids.isbn:9783161484100", Answer::Json(oa_book));
        let (m, src) = lookup_book_metadata(&net, Some("978-3-16-148410-0"), None, None, None, "me@example.org").unwrap();
        assert_eq!(src, "openalex");
        assert_eq!(m["kind"].as_str(), Some("book"));
        assert_eq!(m["bibtexType"].as_str(), Some("book"));
        assert_eq!(m["publisher"].as_str(), Some("Synthetic Academic Press"));
        assert_eq!(m["year"].as_str(), Some("2018"));
        assert_eq!(m["doi"].as_str(), Some("10.1000/oa.book.1"));
        assert_eq!(m["abstract"].as_str(), Some("Urban design monograph."));

        // 3. OpenLibrary ISBN lookup
        let ol_isbn = json!({
            "ISBN:080442957X": {
                "title": "Mathematical Logic",
                "authors": [{ "name": "Elena Example" }],
                "publish_date": "May 2015",
                "publishers": [{ "name": "Example House" }],
                "edition_name": "3rd ed.",
                "series": ["Logic Monograph Series"],
                "subjects": [{ "name": "Mathematics" }],
                "url": "https://openlibrary.org/books/OL1M"
            }
        });
        let net = Table::default().on("https://openlibrary.org/api/books?bibkeys=ISBN:080442957X", Answer::Json(ol_isbn));
        let (m, src) = lookup_book_metadata(&net, Some("0-8044-2957-x"), None, None, None, "").unwrap();
        assert_eq!(src, "openlibrary");
        assert_eq!(m["kind"].as_str(), Some("science_book"));
        assert_eq!(m["edition"].as_str(), Some("3rd ed."));
        assert_eq!(m["series"].as_str(), Some("Logic Monograph Series"));
        assert_eq!(m["isbn"].as_str(), Some("080442957X"));

        // 4. OpenLibrary search.json title+author fallback (rejecting non-matching entry)
        let ol_search = json!({
            "docs": [
                { "title": "Completely Unrelated Book", "author_name": ["Someone Else"], "first_publish_year": 2001 },
                { "title": "Synthetic Lattice Models", "author_name": ["Ada Example"], "first_publish_year": 2019, "publisher": ["Synthetic Press"], "isbn": ["9780306406157"], "key": "/works/OL42W" }
            ]
        });
        let net = Table::default().on("https://openlibrary.org/search.json?title=Synthetic%20Lattice%20Models&author=Ada%20Example", Answer::Json(ol_search));
        let (m, src) = lookup_book_metadata(&net, None, None, Some("Synthetic Lattice Models"), Some("Ada Example"), "").unwrap();
        assert_eq!(src, "openlibrary");
        assert_eq!(m["title"].as_str(), Some("Synthetic Lattice Models"));
        assert_eq!(m["isbn"].as_str(), Some("9780306406157"));
        assert_eq!(m["year"].as_str(), Some("2019"));
        assert_eq!(m["url"].as_str(), Some("https://openlibrary.org/works/OL42W"));

        // OpenLibrary search helper
        let ol_q = json!({ "docs": [{ "title": "Synthetic Lattice Models", "author_name": ["Ada Example"], "first_publish_year": 2019, "publisher": ["Synthetic Press"], "isbn": ["9780306406157"], "key": "/works/OL42W" }] });
        let net = Table::default().on("https://openlibrary.org/search.json?q=lattice", Answer::Json(ol_q));
        let hits = openlibrary_search(&net, "lattice", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0]["isbn"].as_str(), Some("9780306406157"));
    }

    #[test]
    fn merges_book_sources_handles_diacritics_and_backfills_crossref_arxiv_and_work_search() {
        // 1. 4-source book merging: Crossref lacks publisher/year, OpenLibrary & Google Books fill them in while keeping primary src.
        let cr_partial = json!({
            "message": {
                "items": [{
                    "type": "monograph",
                    "title": ["Écriture et Différence"],
                    "author": [{ "family": "Derrida", "given": "Jacques" }],
                    "ISBN": ["9780226143293"]
                }]
            }
        });
        let gbooks = json!({
            "items": [{
                "volumeInfo": {
                    "title": "Écriture et Différence",
                    "authors": ["Jacques Derrida"],
                    "publishedDate": "1967",
                    "publisher": "Éditions du Seuil",
                    "pageCount": 436,
                    "description": "Foundational essays."
                }
            }]
        });
        let net = Table::default()
            .on("https://api.crossref.org/works?filter=isbn:9780226143293", Answer::Json(cr_partial))
            .on("https://www.googleapis.com/books/v1/volumes?q=isbn:9780226143293", Answer::Json(gbooks));
        let (m, src) = lookup_book_metadata(&net, Some("9780226143293"), None, None, None, "").unwrap();
        assert_eq!(src, "crossref");
        assert_eq!(m["publisher"].as_str(), Some("Éditions du Seuil"));
        assert_eq!(m["year"].as_str(), Some("1967"));
        assert_eq!(m["numPages"].as_str(), Some("436"));

        // Diacritics in book title+author query match cleanly.
        let ol_dia = json!({
            "docs": [{
                "title": "Écriture et Différence",
                "author_name": ["Milica Cvetković"],
                "first_publish_year": 2010,
                "publisher": ["Academic Press"]
            }]
        });
        let net_dia = Table::default().on("https://openlibrary.org/search.json?title=", Answer::Json(ol_dia));
        let (mdia, _) = lookup_book_metadata(&net_dia, None, None, Some("Ecriture et Difference"), Some("Cvetkovic"), "").unwrap();
        assert_eq!(mdia["title"].as_str(), Some("Écriture et Différence"));

        // 2. arXiv with DOI merges Crossref venue/volume/pages + type = journalArticle while keeping archiveID & abstract.
        let atom = "<feed><entry><title>Topological Paper</title><published>2022-01-01T00:00:00Z</published><summary>ArXiv abstract</summary><author><name>Ada Example</name></author><arxiv:doi>10.1103/PhysRevB.105.010101</arxiv:doi></entry></feed>";
        let cr_j = json!({ "message": { "type": "journal-article", "title": ["Topological Paper"], "container-title": ["Physical Review B"], "volume": "105", "page": "010101", "publisher": "APS" } });
        let net_ax = Table::default()
            .on("https://export.arxiv.org/api/query?id_list=2201.00001", Answer::Text(atom.into()))
            .on("https://api.crossref.org/works/10.1103/PhysRevB.105.010101", Answer::Json(cr_j));
        let am = arxiv(&net_ax, "2201.00001").unwrap();
        assert_eq!(am["type"].as_str(), Some("journalArticle"));
        assert_eq!(am["publicationTitle"].as_str(), Some("Physical Review B"));
        assert_eq!(am["pages"].as_str(), Some("010101"));
        assert_eq!(am["archiveID"].as_str(), Some("arXiv:2201.00001"));
        assert_eq!(am["abstractNote"].as_str(), Some("ArXiv abstract"));

        // 3. crossref_with_openalex backfills abstractNote & arXiv archiveID when DOI matches.
        let cr_no_abs = json!({ "message": { "type": "journal-article", "title": ["Anyons"], "container-title": ["Nature"] } });
        let oa_backfill = json!({
            "ids": { "doi": "https://doi.org/10.1038/anyons.1" },
            "abstract_inverted_index": { "Quasiparticles": [0], "exist.": [1] },
            "locations": [{ "landing_page_url": "https://arxiv.org/abs/2305.01234" }]
        });
        let net_oa = Table::default()
            .on("https://api.crossref.org/works/10.1038/anyons.1", Answer::Json(cr_no_abs))
            .on("https://api.openalex.org/works/doi:10.1038/anyons.1", Answer::Json(oa_backfill));
        let cm = crossref_with_openalex(&net_oa, "10.1038/anyons.1", "").unwrap();
        assert_eq!(cm["abstractNote"].as_str(), Some("Quasiparticles exist."));
        assert_eq!(cm["archiveID"].as_str(), Some("arXiv:2305.01234"));

        // 4. lookup_work_by_title_author validates title/author/year and falls back across indexes.
        let s2_hit = json!({
            "data": [
                { "title": "Completely Different Paper", "authors": [{ "name": "Other" }], "year": 2021 },
                { "title": "Non-Equilibrium Quantum Criticality: A Survey", "authors": [{ "name": "Milica Cvetković" }], "year": 2021, "venue": "SciPost Phys.", "externalIds": { "DOI": "10.21468/scipost.1" } }
            ]
        });
        let net_s2 = Table::default().on("https://api.semanticscholar.org/graph/v1/paper/search", Answer::Json(s2_hit));
        let (wm, wsrc) = lookup_work_by_title_author(&net_s2, "", "Non-Equilibrium Quantum Criticality", &["Cvetkovic, Milica".into()], Some("2020")).unwrap();
        assert_eq!(wsrc, "semanticscholar");
        assert_eq!(wm["DOI"].as_str(), Some("10.21468/scipost.1"));
        assert!(lookup_work_by_title_author(&net_s2, "", "Non-Equilibrium Quantum Criticality", &["Wrongauthor".into()], Some("2020")).is_none());
        assert!(lookup_work_by_title_author(&net_s2, "", "Non-Equilibrium Quantum Criticality", &["Cvetkovic, Milica".into()], Some("2010")).is_none());

        // 5. normalize_isbn handles Adobe PUA digits & Unicode figure-dashes; lookup_work_by_title_author accepts 2-3 word main titles with author validation + OpenAlex backfill.
        assert_eq!(normalize_isbn("\u{F739}\u{F737}\u{F738}\u{2012}0\u{2011}306\u{2212}40615\u{2010}7").as_deref(), Some("9780306406157"));
        let cr_qsl = json!({
            "message": {
                "items": [{
                    "DOI": "10.1038/nature08917",
                    "type": "journal-article",
                    "title": ["Quantum spin liquids: a review"],
                    "author": [{ "family": "Balents", "given": "Leon" }],
                    "issued": { "date-parts": [[2010, 3, 11]] },
                    "container-title": ["Nature"]
                }]
            }
        });
        let cr_qsl_single = json!({
            "message": {
                "DOI": "10.1038/nature08917",
                "type": "journal-article",
                "title": ["Quantum spin liquids: a review"],
                "author": [{ "family": "Balents", "given": "Leon" }],
                "issued": { "date-parts": [[2010, 3, 11]] },
                "container-title": ["Nature"]
            }
        });
        let oa_qsl = json!({
            "ids": { "doi": "https://doi.org/10.1038/nature08917" },
            "abstract_inverted_index": { "Spin": [0], "liquids": [1], "fluctuate.": [2] }
        });
        let net_qsl = Table::default()
            .on("https://api.crossref.org/works?rows=5&query.bibliographic=", Answer::Json(cr_qsl))
            .on("https://api.crossref.org/works/10.1038/nature08917", Answer::Json(cr_qsl_single))
            .on("https://api.openalex.org/works/doi:10.1038/nature08917", Answer::Json(oa_qsl));
        let (qm, qsrc) = lookup_work_by_title_author(&net_qsl, "", "Quantum Spin Liquids", &["Balents, Leon".into()], None).unwrap();
        assert_eq!(qsrc, "crossref");
        assert_eq!(qm["DOI"].as_str(), Some("10.1038/nature08917"));
        assert_eq!(qm["abstractNote"].as_str(), Some("Spin liquids fluctuate."));
    }
}
