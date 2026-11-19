//! PDF document metadata (`/Info` dictionary + XMP XML) and Unicode/PUA text normalization.
use crate::remote::{self, parse_arxiv_anywhere, parse_doi};
use pdf_oxide::extractors::xmp::{XmpExtractor, XmpMetadata};
use pdf_oxide::object::Object;
use pdf_oxide::PdfDocument;
use std::collections::BTreeSet;

const ID_PAGES: usize = 10;

/// Extracted structured metadata from a PDF's `/Info` dictionary and XMP stream.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct PdfDocMeta {
    pub title: Option<String>,
    pub authors: Vec<String>,
    pub year: Option<String>,
    pub abstract_text: Option<String>,
    pub keywords: Vec<String>,
    pub doi: Option<String>,
    pub arxiv: Option<String>,
    pub arxiv_version: Option<String>,
    pub isbn: Option<String>,
    pub venue: Option<String>,
}

/// Combined first-pages normalized text, page count, and `/Info` + XMP metadata.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct PdfDocExtract {
    pub text: String,
    pub pages: usize,
    pub meta: PdfDocMeta,
}

/// Normalizes PDF-extracted text: expands NFKC ligatures, maps Adobe Corporate Use PUA glyphs,
/// converts Unicode spaces to ASCII space, and strips mid-word soft hyphens.
pub fn normalize_pdf_unicode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\u{FB00}' => out.push_str("ff"),
            '\u{FB01}' => out.push_str("fi"),
            '\u{FB02}' => out.push_str("fl"),
            '\u{FB03}' => out.push_str("ffi"),
            '\u{FB04}' => out.push_str("ffl"),
            '\u{FB05}' => out.push_str("ft"),
            '\u{FB06}' => out.push_str("st"),
            '\u{F730}'..='\u{F739}' => {
                if let Some(d) = char::from_u32(c as u32 - 0xF730 + b'0' as u32) {
                    out.push(d);
                }
            }
            '\u{F761}'..='\u{F77A}' => {
                if let Some(a) = char::from_u32(c as u32 - 0xF761 + b'a' as u32) {
                    out.push(a);
                }
            }
            '\u{F721}' => out.push('!'),
            '\u{F724}' => out.push('$'),
            '\u{F726}' => out.push('&'),
            '\u{F73F}' => out.push('?'),
            '\u{00A0}' | '\u{2000}'..='\u{200A}' | '\u{202F}' => out.push(' '),
            '\u{00AD}' => {}
            _ => out.push(c),
        }
    }
    out
}

/// Lowercases and folds Latin-1 / Latin Extended-A/B diacritics to ASCII while stripping combining marks
/// and preserving non-Latin alphanumerics via `char::to_lowercase()`.
pub fn fold_diacritics(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if ('\u{0300}'..='\u{036F}').contains(&c) {
            continue;
        }
        for lc in c.to_lowercase() {
            if ('\u{0300}'..='\u{036F}').contains(&lc) {
                continue;
            }
            match lc {
                'á' | 'à' | 'ä' | 'â' | 'ã' | 'å' | 'ā' | 'ă' | 'ą' => out.push('a'),
                'ć' | 'č' | 'ç' | 'ĉ' | 'ċ' => out.push('c'),
                'ď' | 'đ' => out.push('d'),
                'é' | 'è' | 'ë' | 'ê' | 'ē' | 'ĕ' | 'ė' | 'ę' | 'ě' => out.push('e'),
                'ğ' | 'ĝ' | 'ġ' | 'ģ' => out.push('g'),
                'ħ' | 'ĥ' => out.push('h'),
                'í' | 'ì' | 'ï' | 'î' | 'ī' | 'ĭ' | 'į' | 'ı' => out.push('i'),
                'ĵ' => out.push('j'),
                'ķ' => out.push('k'),
                'ł' | 'ĺ' | 'ļ' | 'ľ' | 'ŀ' => out.push('l'),
                'ñ' | 'ń' | 'ņ' | 'ň' => out.push('n'),
                'ó' | 'ò' | 'ö' | 'ô' | 'õ' | 'ø' | 'ō' | 'ŏ' | 'ő' => out.push('o'),
                'ŕ' | 'ŗ' | 'ř' => out.push('r'),
                'ś' | 'ŝ' | 'ş' | 'š' => out.push('s'),
                'ţ' | 'ť' | 'ŧ' => out.push('t'),
                'ú' | 'ù' | 'ü' | 'û' | 'ũ' | 'ū' | 'ŭ' | 'ů' | 'ű' | 'ų' => out.push('u'),
                'ŵ' => out.push('w'),
                'ý' | 'ÿ' | 'ŷ' => out.push('y'),
                'ź' | 'ż' | 'ž' => out.push('z'),
                'ß' => out.push_str("ss"),
                'æ' => out.push_str("ae"),
                'œ' => out.push_str("oe"),
                'ð' => out.push('d'),
                'þ' => out.push_str("th"),
                _ => out.push(lc),
            }
        }
    }
    out
}

fn pdf_doc_char(b: u8) -> char {
    const MAP: [char; 31] = [
        '\u{2022}', '\u{2020}', '\u{2021}', '\u{2026}', '\u{2014}', '\u{2013}', '\u{0192}', '\u{2044}',
        '\u{2039}', '\u{203A}', '\u{2212}', '\u{2030}', '\u{201E}', '\u{201C}', '\u{201D}', '\u{2018}',
        '\u{2019}', '\u{201A}', '\u{2122}', '\u{FB01}', '\u{FB02}', '\u{0141}', '\u{0152}', '\u{0160}',
        '\u{0178}', '\u{017D}', '\u{0131}', '\u{0142}', '\u{0153}', '\u{0161}', '\u{017E}',
    ];
    if (0x80..=0x9E).contains(&b) {
        MAP[(b - 0x80) as usize]
    } else if b == 0xA0 {
        '\u{20AC}'
    } else {
        b as char
    }
}

pub(crate) fn decode_pdf_string(bytes: &[u8]) -> String {
    let raw = if bytes.starts_with(&[0xFE, 0xFF]) {
        let units: Vec<u16> = bytes[2..].as_chunks::<2>().0.iter().map(|&c| u16::from_be_bytes(c)).collect();
        String::from_utf16_lossy(&units)
    } else if bytes.starts_with(&[0xFF, 0xFE]) {
        let units: Vec<u16> = bytes[2..].as_chunks::<2>().0.iter().map(|&c| u16::from_le_bytes(c)).collect();
        String::from_utf16_lossy(&units)
    } else if let Ok(s) = std::str::from_utf8(bytes) {
        s.to_string()
    } else {
        bytes.iter().map(|&b| pdf_doc_char(b)).collect()
    };
    normalize_pdf_unicode(&raw).trim().to_string()
}

pub(crate) fn parse_pdf_date_year(raw: &str) -> Option<String> {
    let t = raw.trim();
    let s = t.strip_prefix("D:").or_else(|| t.strip_prefix("d:")).unwrap_or(t).trim();
    if s.len() >= 4 && s.is_char_boundary(4) {
        let y = &s[..4];
        if (y.starts_with("19") || y.starts_with("20")) && y.bytes().all(|b| b.is_ascii_digit()) {
            return Some(y.to_string());
        }
    }
    let b = s.as_bytes();
    (0..b.len().saturating_sub(3)).find_map(|i| {
        let y = s.get(i..i + 4)?;
        let prev_ok = i == 0 || !b[i - 1].is_ascii_digit();
        let next_ok = b.get(i + 4).is_none_or(|c| !c.is_ascii_digit());
        (prev_ok && next_ok && (y.starts_with("19") || y.starts_with("20")) && y.bytes().all(|c| c.is_ascii_digit()))
            .then(|| y.to_string())
    })
}

pub fn is_junk_pdf_title(raw: &str) -> bool {
    let t = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.chars().filter(|c| c.is_alphabetic()).count() < 2 {
        return true;
    }
    let low = t.to_ascii_lowercase();
    if [
        "microsoft word", "microsoft powerpoint", "microsoft excel",
        "powerpoint presentation", "dvips", "pdftex", "xelatex", "lualatex",
    ]
    .iter()
    .any(|p| low.starts_with(p))
    {
        return true;
    }
    if [
        ".tex", ".dvi", ".pdf", ".doc", ".docx", ".ps", ".eps", ".ppt", ".pptx", ".odt", ".rtf",
    ]
    .iter()
    .any(|ext| low.ends_with(ext))
    {
        return true;
    }
    if matches!(
        low.as_str(),
        "untitled" | "no title" | "latex" | "latex2e" | "tex" | "document" | "paper" | "thesis"
            | "dissertation" | "manuscript" | "preprint" | "article" | "book" | "report" | "notes"
            | "draft" | "abstract" | "summary" | "slides" | "poster" | "full text pdf"
    ) {
        return true;
    }
    if let Some((ax, ver)) = parse_arxiv_anywhere(&t) {
        let bare = format!("{ax}{}", ver.unwrap_or_default()).to_ascii_lowercase();
        let stripped = low.trim_start_matches("arxiv:").trim();
        if stripped == bare {
            return true;
        }
    }
    false
}

fn split_authors(raw: &str) -> Vec<String> {
    let norm = normalize_pdf_unicode(raw);
    let cleaned = norm.trim();
    if cleaned.is_empty() {
        return Vec::new();
    }
    if cleaned.contains(';') || cleaned.contains('&') || cleaned.to_ascii_lowercase().contains(" and ") {
        return crate::refs::parse_authors_segment(cleaned);
    }
    let commas: Vec<&str> = cleaned.split(',').map(str::trim).filter(|p| !p.is_empty()).collect();
    if commas.len() == 2 && commas[0].split_whitespace().count() == 1 {
        return vec![format!("{}, {}", commas[0], commas[1])];
    }
    crate::refs::parse_authors_segment(cleaned)
}

fn split_keywords(raw: &str) -> Vec<String> {
    normalize_pdf_unicode(raw)
        .split([',', ';'])
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.len() <= 80 && parse_doi(s).is_none() && parse_arxiv_anywhere(s).is_none())
        .map(String::from)
        .collect()
}

fn extract_ids_from_text(s: &str, meta: &mut PdfDocMeta) {
    if meta.doi.is_none() {
        if let Some(d) = parse_doi(s) {
            if !crate::refs::norm_doi(&d).starts_with("10.48550/arxiv.") {
                meta.doi = Some(d);
            }
        }
    }
    if meta.arxiv.is_none() {
        if let Some((a, v)) = parse_arxiv_anywhere(s) {
            meta.arxiv = Some(a);
            meta.arxiv_version = v;
        }
    }
    if meta.isbn.is_none() {
        if let Some(i) = crate::refs::parse_isbn(s) {
            meta.isbn = Some(i);
        }
    }
}

fn scan_raw_xml_ids(xml: &str, meta: &mut PdfDocMeta) {
    for chunk in xml.split(['<', '>', '"', '\'']).map(str::trim).filter(|s| !s.is_empty()) {
        if meta.doi.is_none() {
            if let Some(d) = parse_doi(chunk) {
                let reg = d.strip_prefix("10.").and_then(|r| r.split('/').next()).unwrap_or("");
                if reg.len() >= 4 && !crate::refs::norm_doi(&d).starts_with("10.48550/arxiv.") {
                    meta.doi = Some(d);
                }
            }
        }
        if meta.arxiv.is_none() && chunk.to_ascii_lowercase().contains("arxiv") {
            if let Some((a, v)) = parse_arxiv_anywhere(chunk) {
                meta.arxiv = Some(a);
                meta.arxiv_version = v;
            }
        }
        if meta.isbn.is_none() && chunk.to_ascii_lowercase().contains("isbn") {
            if let Some(i) = crate::refs::parse_isbn(chunk) {
                meta.isbn = Some(i);
            }
        }
    }
}

fn info_str(doc: &PdfDocument, info: &std::collections::HashMap<String, Object>, key: &str) -> Option<String> {
    let raw = info.get(key)?;
    let obj = doc.resolve_object(raw).ok()?;
    match obj {
        Object::String(bytes) => Some(decode_pdf_string(&bytes)).filter(|s| !s.is_empty()),
        _ => None,
    }
}

fn apply_xmp(xmp: &XmpMetadata, meta: &mut PdfDocMeta) {
    if let Some(t) = xmp.dc_title.as_deref().map(normalize_pdf_unicode) {
        let t = t.trim();
        if !t.is_empty() && !is_junk_pdf_title(t) {
            meta.title = Some(t.to_string());
        }
    }
    let creators: Vec<String> = xmp
        .dc_creator
        .iter()
        .flat_map(|c| split_authors(c))
        .filter(|c| !c.is_empty())
        .collect();
    if !creators.is_empty() {
        meta.authors = creators;
    }
    if let Some(d) = xmp.xmp_create_date.as_deref().and_then(parse_pdf_date_year) {
        meta.year = Some(d);
    }
    if let Some(desc) = xmp.dc_description.as_deref().map(normalize_pdf_unicode) {
        let desc = desc.trim();
        extract_ids_from_text(desc, meta);
        if desc.len() >= 25 && !desc.to_ascii_lowercase().starts_with("arxiv:") {
            meta.abstract_text = Some(desc.to_string());
        }
    }
    for subj in &xmp.dc_subject {
        for kw in split_keywords(subj) {
            if !meta.keywords.contains(&kw) {
                meta.keywords.push(kw);
            }
        }
    }
    if let Some(pk) = &xmp.pdf_keywords {
        extract_ids_from_text(pk, meta);
        for kw in split_keywords(pk) {
            if !meta.keywords.contains(&kw) {
                meta.keywords.push(kw);
            }
        }
    }
    let mut keys: Vec<(&String, &String)> = xmp.custom.iter().collect();
    keys.sort_by(|a, b| a.0.cmp(b.0));
    for (k, v) in keys {
        let kl = k.to_ascii_lowercase();
        let val = normalize_pdf_unicode(v);
        let vt = val.trim();
        if vt.is_empty() {
            continue;
        }
        if matches!(kl.as_str(), "prism:doi" | "crossmark:doi" | "pdfx:doi" | "dc:identifier") {
            extract_ids_from_text(vt, meta);
        } else if kl == "prism:isbn" {
            if meta.isbn.is_none() {
                meta.isbn = remote::normalize_isbn(vt).or_else(|| crate::refs::parse_isbn(vt));
            }
        } else if kl == "prism:publicationname" {
            if meta.venue.is_none() {
                meta.venue = Some(vt.to_string());
            }
        } else if kl.contains("arxiv") {
            extract_ids_from_text(vt, meta);
        }
    }
    if let Some(raw_xml) = &xmp.raw_xml {
        scan_raw_xml_ids(raw_xml, meta);
    }
}

/// Extracts normalized first-pages text, page count, and `/Info` + XMP metadata safely (panic-shielded).
pub fn extract_pdf_doc(bytes: &[u8]) -> PdfDocExtract {
    let read = || -> Option<PdfDocExtract> {
        let doc = PdfDocument::from_bytes(bytes.to_vec()).ok()?;
        let pages = doc.page_count().ok()?;
        let text = (0..pages.min(ID_PAGES))
            .map(|i| normalize_pdf_unicode(&doc.extract_text(i).unwrap_or_default()))
            .collect::<Vec<_>>()
            .join("\x0c");

        let mut meta = PdfDocMeta::default();
        if let Some(info_raw) = doc.trailer().as_dict().and_then(|d| d.get("Info")) {
            if let Ok(info_obj) = doc.resolve_object(info_raw) {
                if let Some(info) = info_obj.as_dict() {
                    if let Some(t) = info_str(&doc, info, "Title").filter(|t| !is_junk_pdf_title(t)) {
                        meta.title = Some(t);
                    }
                    if let Some(a) = info_str(&doc, info, "Author") {
                        meta.authors = split_authors(&a);
                    }
                    if let Some(d) = info_str(&doc, info, "CreationDate").and_then(|s| parse_pdf_date_year(&s)) {
                        meta.year = Some(d);
                    }
                    if let Some(subj) = info_str(&doc, info, "Subject") {
                        extract_ids_from_text(&subj, &mut meta);
                        if subj.len() >= 30 && !subj.to_ascii_lowercase().starts_with("arxiv:") {
                            meta.abstract_text = Some(subj);
                        }
                    }
                    if let Some(kw_raw) = info_str(&doc, info, "Keywords") {
                        extract_ids_from_text(&kw_raw, &mut meta);
                        let mut seen: BTreeSet<String> = meta.keywords.iter().cloned().collect();
                        for kw in split_keywords(&kw_raw) {
                            if seen.insert(kw.clone()) {
                                meta.keywords.push(kw);
                            }
                        }
                    }
                }
            }
        }
        if let Ok(Some(xmp)) = XmpExtractor::extract(&doc) {
            apply_xmp(&xmp, &mut meta);
        }
        Some(PdfDocExtract { text, pages, meta })
    };
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(read))
        .ok()
        .flatten()
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_ligatures_pua_spaces_and_diacritics() {
        assert_eq!(normalize_pdf_unicode("ﬁeld ﬂow ﬃ ﬄ ﬅ ﬆ ﬀ"), "field flow ffi ffl ft st ff");
        assert_eq!(normalize_pdf_unicode("\u{F731}\u{F739}\u{F761}\u{F77A}\u{F721}\u{F724}\u{F726}\u{F73F}"), "19az!$&?");
        assert_eq!(normalize_pdf_unicode("soft\u{00AD}hyphen\u{00A0}space\u{2009}thin\u{202F}nbsp"), "softhyphen space thin nbsp");
        assert_eq!(fold_diacritics("Cvetković Łukasiewicz Sørensen Différence İnce"), "cvetkovic lukasiewicz sorensen difference ince");
        assert_eq!(fold_diacritics("e\u{0301}tude Groß Æther Œuvre Þór ð"), "etude gross aether oeuvre thor d");
    }

    #[test]
    fn filters_junk_titles_and_parses_pdf_dates_and_utf16() {
        assert!(is_junk_pdf_title("Microsoft Word - paper.docx"));
        assert!(is_junk_pdf_title("PowerPoint Presentation"));
        assert!(is_junk_pdf_title("Untitled"));
        assert!(is_junk_pdf_title("dvips"));
        assert!(is_junk_pdf_title("LaTeX"));
        assert!(is_junk_pdf_title("main.tex"));
        assert!(is_junk_pdf_title("arXiv:2401.12345v1"));
        assert!(is_junk_pdf_title("Document"));
        assert!(!is_junk_pdf_title("Topological Phases of Matter"));

        assert_eq!(parse_pdf_date_year("D:20240115103000Z").as_deref(), Some("2024"));
        assert_eq!(parse_pdf_date_year("1998-05-01").as_deref(), Some("1998"));
        let mut be = vec![0xFE, 0xFF];
        for u in "Quantum Transport".encode_utf16() {
            be.extend_from_slice(&u.to_be_bytes());
        }
        assert_eq!(decode_pdf_string(&be), "Quantum Transport");
    }
}
