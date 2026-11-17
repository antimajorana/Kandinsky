//! Notion exporter importer: strips 32-hex IDs, rewrites internal links/embeds, and turns CSV databases into `.base` + typed notes.
use super::{join_rel, percent_decode, resolve_inside, sanitize_component, save_attachment, write_vault_doc};
use crate::api::ImportReport;
use crate::{Result, Workspace};
use kandinsky_text::frontmatter::set_property;
use serde_yaml::{Mapping, Value as Yaml};
use std::collections::{BTreeMap, HashSet};
use std::path::{Component, Path, PathBuf};

pub(crate) fn has_notion_hex_id(name: &str) -> bool {
    let is_csv = name.to_ascii_lowercase().ends_with(".csv");
    let stem = name.rsplit_once('.').map_or(name, |(s, _)| s);
    let stem = if is_csv { stem.strip_suffix("_all").unwrap_or(stem) } else { stem };
    has_trailing_32hex(stem)
}

fn has_trailing_32hex(s: &str) -> bool {
    let s = s.trim();
    if s.len() == 32 && s.bytes().all(|b| b.is_ascii_hexdigit()) {
        return true;
    }
    if s.len() >= 33 {
        let split = s.len() - 32;
        let sep = s.as_bytes()[split - 1];
        return matches!(sep, b' ' | b'_' | b'-') && s.as_bytes()[split..].iter().all(u8::is_ascii_hexdigit);
    }
    false
}

pub fn strip_notion_stem(raw_stem: &str, is_csv: bool) -> (String, bool) {
    let trimmed = raw_stem.trim();
    if is_csv {
        if let Some(before_all) = trimmed.strip_suffix("_all") {
            if has_trailing_32hex(before_all) {
                return (strip_32hex_core(before_all), true);
            }
        }
    }
    if has_trailing_32hex(trimmed) {
        (strip_32hex_core(trimmed), false)
    } else {
        (trimmed.to_string(), false)
    }
}

fn strip_32hex_core(s: &str) -> String {
    let s = s.trim();
    if s.len() == 32 && s.bytes().all(|b| b.is_ascii_hexdigit()) {
        return "Untitled".into();
    }
    if s.len() >= 33 {
        let prefix = s[..s.len() - 33].trim();
        if !prefix.is_empty() {
            return prefix.to_string();
        }
    }
    "Untitled".into()
}

fn clean_rel_dir(source_root: &Path, dir: &Path) -> String {
    let Ok(rel) = dir.strip_prefix(source_root) else { return String::new() };
    let mut parts = Vec::new();
    for (idx, comp) in rel.components().enumerate() {
        let Component::Normal(os) = comp else { continue };
        let raw = os.to_string_lossy();
        if idx == 0 && raw.starts_with("Export-") && raw.len() > 15 {
            continue;
        }
        let (stripped, _) = strip_notion_stem(&raw, false);
        parts.push(sanitize_component(&stripped, "Folder"));
    }
    parts.join("/")
}

fn clean_attachment_name(raw_name: &str) -> String {
    let base = raw_name.rsplit(['/', '\\']).next().unwrap_or(raw_name);
    match base.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() && !e.is_empty() => {
            let (clean_s, _) = strip_notion_stem(s, false);
            format!("{}.{}", sanitize_component(&clean_s, "image"), e.to_ascii_lowercase())
        }
        _ => sanitize_component(&strip_notion_stem(base, false).0, "attachment"),
    }
}

pub(crate) fn rewrite_notion_markdown(
    ws: &Workspace,
    source_root: &Path,
    md_dir: &Path,
    text: &str,
    report: &mut ImportReport,
) -> Result<String> {
    let mut out = String::with_capacity(text.len());
    let mut in_fence = false;
    for chunk in text.split_inclusive('\n') {
        let trimmed = chunk.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            out.push_str(chunk);
            continue;
        }
        if in_fence {
            out.push_str(chunk);
        } else {
            out.push_str(&rewrite_markdown_line(ws, source_root, md_dir, chunk, report)?);
        }
    }
    Ok(out)
}

fn rewrite_markdown_line(
    ws: &Workspace,
    source_root: &Path,
    md_dir: &Path,
    line: &str,
    report: &mut ImportReport,
) -> Result<String> {
    let bytes = line.as_bytes();
    let mut out = String::with_capacity(line.len());
    let mut i = 0;
    while i < bytes.len() {
        let is_bang = bytes[i] == b'!' && i + 1 < bytes.len() && bytes[i + 1] == b'[';
        let open_br = if is_bang {
            i + 1
        } else if bytes[i] == b'[' && (i == 0 || bytes[i - 1] != b'[') {
            i
        } else {
            let ch = line[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
            continue;
        };
        let Some(close_br) = find_unescaped_close(&line[open_br + 1..], b']').map(|o| open_br + 1 + o) else {
            let ch = line[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
            continue;
        };
        if close_br + 1 >= bytes.len() || bytes[close_br + 1] != b'(' {
            let ch = line[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
            continue;
        }
        let paren_start = close_br + 2;
        let Some(paren_end) = find_balanced_paren(&line[paren_start..]).map(|o| paren_start + o) else {
            let ch = line[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
            continue;
        };
        let label = &line[open_br + 1..close_br];
        let raw_target = line[paren_start..paren_end].trim().trim_start_matches('<').trim_end_matches('>');
        let raw_span = &line[i..=paren_end];
        let replaced = transform_md_link(ws, source_root, md_dir, is_bang, label, raw_target, raw_span, report)?;
        out.push_str(&replaced);
        i = paren_end + 1;
    }
    Ok(out)
}

fn find_unescaped_close(s: &str, target: u8) -> Option<usize> {
    let b = s.as_bytes();
    let mut j = 0;
    while j < b.len() {
        if b[j] == b'\\' {
            j += 2;
            continue;
        }
        if b[j] == target {
            return Some(j);
        }
        j += 1;
    }
    None
}

fn find_balanced_paren(s: &str) -> Option<usize> {
    let b = s.as_bytes();
    let (mut depth, mut j) = (1usize, 0usize);
    while j < b.len() {
        match b[j] {
            b'\\' => j += 1,
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(j);
                }
            }
            _ => {}
        }
        j += 1;
    }
    None
}

#[allow(clippy::too_many_arguments)]
fn transform_md_link(
    ws: &Workspace,
    source_root: &Path,
    md_dir: &Path,
    is_bang: bool,
    label: &str,
    raw_target: &str,
    fallback_span: &str,
    report: &mut ImportReport,
) -> Result<String> {
    let lower = raw_target.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:") || lower.starts_with('#') {
        return Ok(fallback_span.to_string());
    }
    let target_no_title = raw_target.split_whitespace().next().unwrap_or(raw_target);
    let (path_part, frag) = match raw_target.split_once('#') {
        Some((p, f)) => (p, Some(percent_decode(f))),
        None => (raw_target, None),
    };
    let path_clean = path_part.split('?').next().unwrap_or(path_part).trim();
    let decoded = percent_decode(path_clean);
    if decoded.is_empty() {
        let _ = target_no_title;
        return Ok(fallback_span.to_string());
    }

    let base_name = decoded.rsplit(['/', '\\']).next().unwrap_or(&decoded);
    let ext = base_name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    let is_note_target = !is_bang && matches!(ext.as_str(), "md" | "markdown" | "html" | "htm" | "csv");
    if is_note_target {
        let stem = base_name.rsplit_once('.').map_or(base_name, |(s, _)| s);
        let (clean_page, _) = strip_notion_stem(stem, ext == "csv");
        let page = sanitize_component(&clean_page, "Untitled");
        let clean_lbl = strip_notion_stem(label.trim().strip_suffix(".md").unwrap_or(label.trim()), false).0;
        let target_wiki = match frag.filter(|f| !f.is_empty()) {
            Some(f) => format!("{page}#{f}"),
            None => page.clone(),
        };
        if label.trim().is_empty() || clean_lbl == page || label.trim() == page {
            return Ok(format!("[[{target_wiki}]]"));
        }
        return Ok(format!("[[{target_wiki}|{}]]", label.trim()));
    }

    if let Some(asset_path) = resolve_inside(source_root, md_dir, &decoded) {
        let bytes = std::fs::read(&asset_path)?;
        let saved = save_attachment(ws, &clean_attachment_name(base_name), &bytes, report)?;
        if is_bang {
            return Ok(format!("![[{saved}]]"));
        }
        let lbl = label.trim();
        return Ok(if lbl.is_empty() || lbl == saved { format!("[[{saved}]]") } else { format!("[[{saved}|{lbl}]]") });
    }
    Ok(fallback_span.to_string())
}

#[derive(Clone, Debug)]
enum ColFormat {
    Auto,
    Status,
    Percent,
    Currency(String),
}

fn prop_key_of(header: &str, used: &mut HashSet<String>) -> String {
    let mut s = String::new();
    for c in header.trim().chars().flat_map(char::to_lowercase) {
        if c.is_ascii_alphanumeric() {
            s.push(c);
        } else if !s.ends_with('_') && !s.is_empty() {
            s.push('_');
        }
    }
    let mut base = s.trim_matches('_').to_string();
    if base.is_empty() || base.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        base = format!("col_{base}");
    }
    let mut key = base.clone();
    let mut n = 2usize;
    while !used.insert(key.clone()) {
        key = format!("{base}_{n}");
        n += 1;
    }
    key
}

fn parse_currency(s: &str) -> Option<(Yaml, &'static str)> {
    let t = s.trim();
    let (neg, rest) = match t.strip_prefix('-') {
        Some(r) => (true, r.trim_start()),
        None => (false, t),
    };
    let (code, num_str) = if let Some(r) = rest.strip_prefix('$').or_else(|| rest.strip_prefix("USD ")) {
        ("USD", r)
    } else if let Some(r) = rest.strip_prefix('€').or_else(|| rest.strip_prefix("EUR ")) {
        ("EUR", r)
    } else if let Some(r) = rest.strip_prefix('£').or_else(|| rest.strip_prefix("GBP ")) {
        ("GBP", r)
    } else if let Some(r) = rest.strip_prefix('¥').or_else(|| rest.strip_prefix("JPY ")) {
        ("JPY", r)
    } else {
        return None;
    };
    let cleaned = num_str.trim().replace(',', "");
    if cleaned.is_empty() {
        return None;
    }
    let val = cleaned.parse::<f64>().ok()?;
    let signed = if neg { -val } else { val };
    Some((number_yaml(signed), code))
}

fn number_yaml(v: f64) -> Yaml {
    if v.fract() == 0.0 && v >= i64::MIN as f64 && v <= i64::MAX as f64 {
        Yaml::from(v as i64)
    } else {
        Yaml::from(v)
    }
}

pub fn normalize_notion_date(raw: &str) -> Option<String> {
    let head = raw.split("→").next().unwrap_or(raw).split("->").next().unwrap_or(raw).trim();
    if head.len() >= 10 && head.as_bytes()[..10].is_ascii() {
        let iso = &head[..10];
        let sep = iso.as_bytes()[4];
        if (sep == b'-' || sep == b'/') && iso.as_bytes()[7] == sep {
            if let (Ok(y), Ok(m), Ok(d)) = (iso[..4].parse::<i32>(), iso[5..7].parse::<u32>(), iso[8..10].parse::<u32>()) {
                if chrono::NaiveDate::from_ymd_opt(y, m, d).is_some() {
                    return Some(format!("{y:04}-{m:02}-{d:02}"));
                }
            }
        }
    }
    let tokens: Vec<&str> = head.split(|c: char| c.is_whitespace() || c == ',').filter(|s| !s.is_empty()).collect();
    if tokens.len() >= 3 {
        if let (Some(m), Ok(d), Ok(y)) = (month_num(tokens[0]), tokens[1].parse::<u32>(), tokens[2].parse::<i32>()) {
            if chrono::NaiveDate::from_ymd_opt(y, m, d).is_some() {
                return Some(format!("{y:04}-{m:02}-{d:02}"));
            }
        }
        if let (Ok(d), Some(m), Ok(y)) = (tokens[0].parse::<u32>(), month_num(tokens[1]), tokens[2].parse::<i32>()) {
            if chrono::NaiveDate::from_ymd_opt(y, m, d).is_some() {
                return Some(format!("{y:04}-{m:02}-{d:02}"));
            }
        }
    }
    None
}

fn month_num(w: &str) -> Option<u32> {
    match w.to_ascii_lowercase().as_str() {
        "jan" | "january" => Some(1),
        "feb" | "february" => Some(2),
        "mar" | "march" => Some(3),
        "apr" | "april" => Some(4),
        "may" => Some(5),
        "jun" | "june" => Some(6),
        "jul" | "july" => Some(7),
        "aug" | "august" => Some(8),
        "sep" | "sept" | "september" => Some(9),
        "oct" | "october" => Some(10),
        "nov" | "november" => Some(11),
        "dec" | "december" => Some(12),
        _ => None,
    }
}

fn parse_relation_items(s: &str) -> Option<Vec<String>> {
    if !s.contains('(') || !s.ends_with(')') {
        return None;
    }
    let mut items = Vec::new();
    for part in s.split("),") {
        let part = part.trim();
        let with_close = if part.ends_with(')') { part.to_string() } else { format!("{part})") };
        let (title, paren) = with_close.rsplit_once('(')?;
        let inner = paren.strip_suffix(')')?.trim();
        let lower = inner.to_ascii_lowercase();
        let looks_notion_ref = lower.ends_with(".md")
            || lower.ends_with(".csv")
            || lower.contains("notion.so/")
            || has_notion_hex_id(&percent_decode(inner));
        if !looks_notion_ref {
            return None;
        }
        let target = if lower.ends_with(".md") || lower.ends_with(".csv") {
            let dec = percent_decode(inner);
            let base = dec.rsplit(['/', '\\']).next().unwrap_or(&dec);
            let stem = base.rsplit_once('.').map_or(base, |(st, _)| st);
            sanitize_component(&strip_notion_stem(stem, false).0, "Untitled")
        } else {
            sanitize_component(&strip_notion_stem(title.trim(), false).0, "Untitled")
        };
        items.push(format!("[[{target}]]"));
    }
    (!items.is_empty()).then_some(items)
}

fn parse_csv_cell(key: &str, raw: &str, fmt_seen: &mut ColFormat) -> Option<Yaml> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    if let Some(rels) = parse_relation_items(s) {
        return Some(if rels.len() == 1 {
            Yaml::String(rels.into_iter().next().unwrap())
        } else {
            Yaml::Sequence(rels.into_iter().map(Yaml::String).collect())
        });
    }
    if matches!(key, "tags" | "tag" | "labels" | "categories") {
        let tags: Vec<Yaml> = s
            .split(',')
            .map(|t| t.trim().trim_start_matches('#').to_string())
            .filter(|t| !t.is_empty())
            .map(Yaml::String)
            .collect();
        return (!tags.is_empty()).then_some(Yaml::Sequence(tags));
    }
    match s.to_ascii_lowercase().as_str() {
        "yes" | "true" => return Some(Yaml::Bool(true)),
        "no" | "false" => return Some(Yaml::Bool(false)),
        _ => {}
    }
    if let Some((num, cur)) = parse_currency(s) {
        *fmt_seen = ColFormat::Currency(cur.to_string());
        return Some(num);
    }
    if let Some(pct) = s.strip_suffix('%').and_then(|p| p.trim().replace(',', "").parse::<f64>().ok()) {
        *fmt_seen = ColFormat::Percent;
        return Some(number_yaml(pct));
    }
    if let Ok(i) = s.parse::<i64>() {
        return Some(Yaml::from(i));
    }
    if let Ok(f) = s.parse::<f64>() {
        if f.is_finite() {
            return Some(Yaml::from(f));
        }
    }
    if let Some(iso) = normalize_notion_date(s) {
        return Some(Yaml::String(iso));
    }
    if s.contains(", ") {
        let parts: Vec<&str> = s.split(',').map(str::trim).filter(|p| !p.is_empty()).collect();
        if parts.len() >= 2 && parts.iter().all(|p| p.len() <= 32 && !p.contains(['.', '!', '?', ':'])) {
            return Some(Yaml::Sequence(parts.into_iter().map(|p| Yaml::String(p.to_string())).collect()));
        }
    }
    Some(Yaml::String(s.to_string()))
}

fn is_status_column(key: &str, header: &str, values: &[Option<Yaml>]) -> bool {
    let h = header.trim().to_ascii_lowercase();
    if matches!(key, "status" | "state" | "stage" | "phase") || matches!(h.as_str(), "status" | "state" | "stage") {
        return true;
    }
    let strs: Vec<&str> = values.iter().filter_map(|v| v.as_ref()?.as_str()).collect();
    if strs.is_empty() {
        return false;
    }
    let status_hits = strs
        .iter()
        .filter(|s| {
            matches!(
                s.trim().to_ascii_lowercase().as_str(),
                "to do" | "todo" | "not started" | "backlog" | "in progress" | "doing"
                    | "in review" | "blocked" | "done" | "completed" | "complete" | "cancelled" | "canceled"
            )
        })
        .count();
    status_hits * 2 >= strs.len()
}

fn strip_notion_header_props(body: &str, headers: &[String]) -> String {
    let header_set: HashSet<String> = headers.iter().map(|h| h.trim().to_ascii_lowercase()).collect();
    let mut lines = body.lines().peekable();
    let mut out = Vec::new();
    if let Some(&first) = lines.peek() {
        if first.starts_with("# ") {
            out.push(lines.next().unwrap());
            while lines.peek().is_some_and(|l| l.trim().is_empty()) {
                lines.next();
            }
            let mut stripped_any = false;
            while let Some(&l) = lines.peek() {
                if l.trim().is_empty() {
                    if stripped_any {
                        lines.next();
                    }
                    break;
                }
                if let Some((k, _)) = l.split_once(':') {
                    if header_set.contains(&k.trim().to_ascii_lowercase()) {
                        stripped_any = true;
                        lines.next();
                        continue;
                    }
                }
                break;
            }
            if !out.is_empty() && lines.peek().is_some() {
                out.push("");
            }
        }
    }
    out.extend(lines);
    let joined = out.join("\n");
    if joined.ends_with('\n') { joined } else { format!("{joined}\n") }
}

fn build_base_yaml(folder: &str, cols: &[(String, String, ColFormat)]) -> Result<String> {
    let mut root = Mapping::new();
    root.insert(Yaml::from("filters"), Yaml::from(format!("file.inFolder(\"{}\")", folder.replace('"', "\\\""))));
    let mut props = Mapping::new();
    let mut status_col: Option<String> = None;
    for (key, display, fmt) in cols {
        let mut pm = Mapping::new();
        pm.insert(Yaml::from("displayName"), Yaml::from(display.clone()));
        match fmt {
            ColFormat::Status => {
                pm.insert(Yaml::from("format"), Yaml::from("status"));
                if status_col.is_none() {
                    status_col = Some(key.clone());
                }
            }
            ColFormat::Percent => {
                pm.insert(Yaml::from("format"), Yaml::from("percent"));
            }
            ColFormat::Currency(code) => {
                pm.insert(Yaml::from("format"), Yaml::from("currency"));
                pm.insert(Yaml::from("currency"), Yaml::from(code.clone()));
            }
            ColFormat::Auto => {}
        }
        props.insert(Yaml::from(key.clone()), Yaml::Mapping(pm));
    }
    if !props.is_empty() {
        root.insert(Yaml::from("properties"), Yaml::Mapping(props));
    }
    let mut table_order = vec![Yaml::from("file.name")];
    table_order.extend(cols.iter().map(|(k, _, _)| Yaml::from(k.clone())));
    let mut table = Mapping::new();
    table.insert(Yaml::from("type"), Yaml::from("table"));
    table.insert(Yaml::from("name"), Yaml::from("Table"));
    table.insert(Yaml::from("order"), Yaml::Sequence(table_order));
    let mut views = vec![Yaml::Mapping(table)];
    if let Some(sc) = status_col {
        let mut board_order = vec![Yaml::from("file.name")];
        board_order.extend(cols.iter().filter(|(k, _, _)| *k != sc).map(|(k, _, _)| Yaml::from(k.clone())));
        let mut board = Mapping::new();
        board.insert(Yaml::from("type"), Yaml::from("board"));
        board.insert(Yaml::from("name"), Yaml::from("Board"));
        board.insert(Yaml::from("groupBy"), Yaml::from(sc));
        board.insert(Yaml::from("order"), Yaml::Sequence(board_order));
        views.push(Yaml::Mapping(board));
    }
    root.insert(Yaml::from("views"), Yaml::Sequence(views));
    serde_yaml::to_string(&Yaml::Mapping(root)).map_err(|e| crate::Error::Other(e.into()))
}

pub(crate) fn import_dir(
    ws: &Workspace,
    source_root: &Path,
    target_dir: &str,
    report: &mut ImportReport,
) -> Result<()> {
    let mut csv_map: BTreeMap<String, (PathBuf, String, String, bool)> = BTreeMap::new();
    let mut md_entries: Vec<(String, String, String, PathBuf)> = Vec::new();
    let mut html_entries: Vec<(String, String, PathBuf)> = Vec::new();

    for entry in walkdir::WalkDir::new(source_root).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let p = entry.path().to_path_buf();
        let fname = entry.file_name().to_string_lossy();
        if fname.starts_with('.') {
            continue;
        }
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
        let raw_stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("Untitled");
        let parent_dir = clean_rel_dir(source_root, p.parent().unwrap_or(source_root));
        match ext.as_str() {
            "csv" => {
                let (clean_s, is_all) = strip_notion_stem(raw_stem, true);
                let db_name = sanitize_component(&clean_s, "Database");
                let key = join_rel(&parent_dir, &db_name).to_ascii_lowercase();
                let replace = csv_map.get(&key).is_none_or(|existing| is_all && !existing.3);
                if replace {
                    csv_map.insert(key, (p, parent_dir, db_name, is_all));
                }
            }
            "md" | "markdown" => {
                let (clean_s, _) = strip_notion_stem(raw_stem, false);
                let note_stem = sanitize_component(&clean_s, "Untitled");
                let lookup_key = join_rel(&parent_dir, &format!("{note_stem}.md")).to_ascii_lowercase();
                md_entries.push((lookup_key, parent_dir, note_stem, p));
            }
            "html" | "htm" => {
                let (clean_s, _) = strip_notion_stem(raw_stem, false);
                let note_stem = sanitize_component(&clean_s, "Untitled");
                html_entries.push((parent_dir, note_stem, p));
            }
            _ => {}
        }
    }

    let mut consumed_md: HashSet<PathBuf> = HashSet::new();
    for (_, (csv_path, rel_dir, db_name, _)) in csv_map {
        import_csv_db(ws, source_root, target_dir, &csv_path, &rel_dir, &db_name, &md_entries, &mut consumed_md, report)?;
    }

    for (_, rel_dir, stem, md_path) in md_entries {
        if consumed_md.contains(&md_path) {
            continue;
        }
        let raw = String::from_utf8_lossy(&std::fs::read(&md_path)?).into_owned();
        let rewritten = rewrite_notion_markdown(ws, source_root, md_path.parent().unwrap_or(source_root), &raw, report)?;
        write_vault_doc(ws, &join_rel(target_dir, &rel_dir), &stem, "md", &rewritten, false, report)?;
    }

    for (rel_dir, stem, html_path) in html_entries {
        let raw = String::from_utf8_lossy(&std::fs::read(&html_path)?).into_owned();
        let md = super::notecraft_onenote::html_to_markdown(
            ws,
            source_root,
            html_path.parent().unwrap_or(source_root),
            &raw,
            "notion",
            report,
        )?;
        write_vault_doc(ws, &join_rel(target_dir, &rel_dir), &stem, "md", &md, false, report)?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn import_csv_db(
    ws: &Workspace,
    source_root: &Path,
    target_dir: &str,
    csv_path: &Path,
    rel_dir: &str,
    db_name: &str,
    md_entries: &[(String, String, String, PathBuf)],
    consumed_md: &mut HashSet<PathBuf>,
    report: &mut ImportReport,
) -> Result<()> {
    let raw_bytes = std::fs::read(csv_path)?;
    let csv_str = String::from_utf8_lossy(&raw_bytes);
    let csv_str = csv_str.strip_prefix('\u{feff}').unwrap_or(&csv_str);
    let mut rdr = csv::ReaderBuilder::new().flexible(true).from_reader(csv_str.as_bytes());
    let headers: Vec<String> = match rdr.headers() {
        Ok(h) if !h.is_empty() => h.iter().map(|s| s.trim().trim_start_matches('\u{feff}').to_string()).collect(),
        _ => return Ok(()),
    };
    let mut used_keys = HashSet::new();
    let prop_headers: Vec<(usize, String, String)> = headers
        .iter()
        .enumerate()
        .skip(1)
        .filter(|(_, h)| !h.is_empty())
        .map(|(idx, h)| (idx, prop_key_of(h, &mut used_keys), h.clone()))
        .collect();

    let mut raw_rows: Vec<Vec<String>> = Vec::new();
    for rec in rdr.records().flatten() {
        if rec.iter().all(|c| c.trim().is_empty()) {
            continue;
        }
        raw_rows.push(rec.iter().map(str::to_string).collect());
    }

    let mut col_formats: Vec<ColFormat> = vec![ColFormat::Auto; prop_headers.len()];
    let mut typed_cols: Vec<Vec<Option<Yaml>>> = vec![Vec::with_capacity(raw_rows.len()); prop_headers.len()];
    for row in &raw_rows {
        for (ci, (col_idx, key, _)) in prop_headers.iter().enumerate() {
            let cell = row.get(*col_idx).map(String::as_str).unwrap_or("");
            let val = parse_csv_cell(key, cell, &mut col_formats[ci]);
            typed_cols[ci].push(val);
        }
    }
    for (ci, (_, key, hdr)) in prop_headers.iter().enumerate() {
        if matches!(col_formats[ci], ColFormat::Auto) && is_status_column(key, hdr, &typed_cols[ci]) {
            col_formats[ci] = ColFormat::Status;
        }
    }

    let db_parent_rel = join_rel(target_dir, rel_dir);
    let row_folder_rel = join_rel(&db_parent_rel, db_name);
    let base_cols: Vec<(String, String, ColFormat)> = prop_headers
        .iter()
        .enumerate()
        .map(|(ci, (_, k, h))| (k.clone(), h.clone(), col_formats[ci].clone()))
        .collect();
    let base_yaml = build_base_yaml(&row_folder_rel, &base_cols)?;
    write_vault_doc(ws, &db_parent_rel, db_name, "base", &base_yaml, true, report)?;

    let companion_prefix = join_rel(rel_dir, db_name);
    for (ri, row) in raw_rows.iter().enumerate() {
        let raw_title = row.first().map(|s| s.trim()).filter(|s| !s.is_empty()).unwrap_or("Untitled");
        let row_stem = sanitize_component(&strip_notion_stem(raw_title, false).0, "Untitled");
        let lookup = join_rel(&companion_prefix, &format!("{row_stem}.md")).to_ascii_lowercase();
        let companion = md_entries.iter().find(|(k, _, _, p)| *k == lookup && !consumed_md.contains(p));
        let mut note_text = if let Some((_, _, _, md_p)) = companion {
            consumed_md.insert(md_p.clone());
            let body_raw = String::from_utf8_lossy(&std::fs::read(md_p)?).into_owned();
            let rewritten = rewrite_notion_markdown(ws, source_root, md_p.parent().unwrap_or(source_root), &body_raw, report)?;
            strip_notion_header_props(&rewritten, &headers)
        } else {
            format!("# {row_stem}\n")
        };
        for (ci, (_, key, _)) in prop_headers.iter().enumerate() {
            if let Some(val) = &typed_cols[ci][ri] {
                note_text = set_property(&note_text, key, val);
            }
        }
        write_vault_doc(ws, &row_folder_rel, &row_stem, "md", &note_text, false, report)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::ImportFormat;
    use crate::importers::import_archive_bytes;
    use std::io::Write;

    #[test]
    fn notion_zip_strips_ids_rewrites_links_saves_attachments_and_builds_base() {
        let d = tempfile::tempdir().unwrap();
        let ws = Workspace::open(d.path()).unwrap();

        // Build an outer Notion Export zip containing an inner Export zip (nested zip handling!).
        let mut inner_buf = Vec::new();
        {
            let mut z = zip::ZipWriter::new(std::io::Cursor::new(&mut inner_buf));
            let opts = zip::write::SimpleFileOptions::default();
            z.start_file("Roadmap a1b2c3d4e5f60123456789abcdef0123.md", opts).unwrap();
            z.write_all(
                b"# Roadmap\n\nSee [Task Spec](Tasks%200123456789abcdef0123456789abcdef/Write%20spec%20fedcba9876543210fedcba9876543210.md) and ![arch](Roadmap%20a1b2c3d4e5f60123456789abcdef0123/diagram.png).\n",
            )
            .unwrap();
            z.start_file("Roadmap a1b2c3d4e5f60123456789abcdef0123/diagram.png", opts).unwrap();
            z.write_all(b"\x89PNG\r\n\x1a\nfake-png").unwrap();

            // Both filtered .csv and _all.csv: importer must deduplicate and prefer _all.csv!
            z.start_file("Tasks 0123456789abcdef0123456789abcdef.csv", opts).unwrap();
            z.write_all(b"\xEF\xBB\xBFName,Status\nOnlyOne,Todo\n").unwrap();
            z.start_file("Tasks 0123456789abcdef0123456789abcdef_all.csv", opts).unwrap();
            z.write_all(
                b"\xEF\xBB\xBFName,Status,Done,Budget,Progress,Due Date,Project,Tags\nWrite spec,In Progress,Yes,\"$1,250.50\",75%,\"November 16, 2026\",Roadmap (Roadmap%20a1b2c3d4e5f60123456789abcdef0123.md),\"backend, rust\"\nShip v1,Done,No,$500,100%,\"Nov 20, 2026\",,release\n",
            )
            .unwrap();
            // Companion .md body for "Write spec" row
            z.start_file(
                "Tasks 0123456789abcdef0123456789abcdef/Write spec fedcba9876543210fedcba9876543210.md",
                opts,
            )
            .unwrap();
            z.write_all(b"# Write spec\n\nStatus: In Progress\nDue Date: November 16, 2026\n\nDetailed specification body.\n").unwrap();
            z.finish().unwrap();
        }
        let mut outer_buf = Vec::new();
        {
            let mut z = zip::ZipWriter::new(std::io::Cursor::new(&mut outer_buf));
            z.start_file("Export-9999.zip", zip::write::SimpleFileOptions::default()).unwrap();
            z.write_all(&inner_buf).unwrap();
            z.finish().unwrap();
        }

        let rep = import_archive_bytes(&ws, &outer_buf, ImportFormat::Auto, "Imported", Some("Notion.zip")).unwrap();
        assert_eq!(rep.detected_format, "notion");
        assert_eq!(rep.bases_created, 1);
        assert_eq!(rep.notes_created, 3); // Roadmap.md + 2 CSV rows (companion merged, not duplicated!)
        assert_eq!(rep.attachments_saved, 1);
        assert!(d.path().join("zAttachments/diagram.png").is_file());

        let roadmap = std::fs::read_to_string(d.path().join("Imported/Roadmap.md")).unwrap();
        assert!(roadmap.contains("[[Write spec|Task Spec]]"), "{roadmap}");
        assert!(roadmap.contains("![[diagram.png]]"), "{roadmap}");

        let base_src = std::fs::read_to_string(d.path().join("Imported/Tasks.base")).unwrap();
        assert!(base_src.contains("file.inFolder(\"Imported/Tasks\")"), "{base_src}");
        assert!(base_src.contains("format: status") && base_src.contains("type: board"), "{base_src}");
        assert!(base_src.contains("format: currency") && base_src.contains("format: percent"), "{base_src}");

        let spec = std::fs::read_to_string(d.path().join("Imported/Tasks/Write spec.md")).unwrap();
        assert!(spec.contains("status: In Progress\n") && spec.contains("done: true\n"), "{spec}");
        assert!(spec.contains("budget: 1250.5\n") && spec.contains("progress: 75\n"), "{spec}");
        assert!(spec.contains("due_date: 2026-11-16\n"), "{spec}");
        assert!(spec.contains("[[Roadmap]]") && spec.contains("Detailed specification body."), "{spec}");
    }

    #[test]
    fn normalize_notion_date_handles_multibyte_utf8_without_panicking() {
        assert_eq!(normalize_notion_date("2026-01-€"), None);
        assert_eq!(normalize_notion_date("2026年01月01日"), None);
        assert_eq!(normalize_notion_date("2026/11/16 → 2026/11/20").as_deref(), Some("2026-11-16"));
    }
}
