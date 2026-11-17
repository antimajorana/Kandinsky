//! NoteCraft (`_node.toml` + `index.md`/`index.html` + `assets/`) and OneNote (`.html` + pure-Rust `.one` binary) importers.
use super::{
    join_rel, percent_decode, resolve_inside, sanitize_component, save_attachment, write_vault_doc,
    TempCacheDir, MS_ONE_MAGIC,
};
use crate::api::ImportReport;
use crate::{Result, Workspace};
use base64::Engine;
use kandinsky_text::frontmatter::set_property;
use scraper::{ElementRef, Html, Selector};
use serde_yaml::Value as Yaml;
use std::collections::HashMap;
use std::path::Path;
use std::sync::LazyLock;

static MD_ASSET_RE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"(!?)\[([^\]]*)\]\(([^)\r\n]+)\)").expect("valid regex"));

pub(crate) fn import_notecraft_dir(
    ws: &Workspace,
    source_root: &Path,
    target_dir: &str,
    report: &mut ImportReport,
) -> Result<()> {
    walk_notecraft(ws, source_root, source_root, target_dir, "", report)
}

fn walk_notecraft(
    ws: &Workspace,
    source_root: &Path,
    dir: &Path,
    target_dir: &str,
    rel_section: &str,
    report: &mut ImportReport,
) -> Result<()> {
    let toml_path = dir.join("_node.toml");
    let node_tbl = std::fs::read_to_string(&toml_path).ok().and_then(|s| s.parse::<toml::Table>().ok());
    let fallback_name = dir
        .file_name()
        .filter(|_| dir != source_root)
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Note".into());
    let title = node_tbl
        .as_ref()
        .and_then(|t| t.get("title").and_then(toml::Value::as_str))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or(fallback_name);

    // Copy node-local assets/* into zAttachments/
    let mut asset_map: HashMap<String, String> = HashMap::new();
    let assets_dir = dir.join("assets");
    if assets_dir.is_dir() {
        for entry in walkdir::WalkDir::new(&assets_dir).into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                let fname = entry.file_name().to_string_lossy().into_owned();
                if fname.starts_with('.') {
                    continue;
                }
                let bytes = std::fs::read(entry.path())?;
                let saved = save_attachment(ws, &fname, &bytes, report)?;
                asset_map.insert(fname, saved);
            }
        }
    }

    let mut subdirs = Vec::new();
    let mut extra_files = Vec::new();
    for entry in std::fs::read_dir(dir)?.flatten() {
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || name == "assets" || name == "_node.toml" {
            continue;
        }
        if p.is_dir() {
            subdirs.push(p);
        } else if name != "index.md" && name != "index.html" {
            extra_files.push(p);
        }
    }
    subdirs.sort();
    extra_files.sort();

    let idx_md = dir.join("index.md");
    let idx_html = dir.join("index.html");
    let has_body = idx_md.is_file() || idx_html.is_file();
    if has_body || (node_tbl.is_some() && subdirs.is_empty()) {
        let mut text = if idx_md.is_file() {
            let raw = String::from_utf8_lossy(&std::fs::read(&idx_md)?).into_owned();
            rewrite_notecraft_links(ws, source_root, dir, &raw, &asset_map, report)?
        } else if idx_html.is_file() {
            let raw = String::from_utf8_lossy(&std::fs::read(&idx_html)?).into_owned();
            html_to_markdown(ws, source_root, dir, &raw, "notecraft", report)?
        } else {
            format!("# {title}\n")
        };
        if let Some(tbl) = &node_tbl {
            text = apply_notecraft_toml(&text, tbl);
        }
        write_vault_doc(ws, &join_rel(target_dir, rel_section), &title, "md", &text, false, report)?;
    }

    let child_section = if dir == source_root && node_tbl.is_none() {
        rel_section.to_string()
    } else {
        join_rel(rel_section, &sanitize_component(&title, "Section"))
    };

    for f in extra_files {
        let ext = f.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
        let stem = f.file_stem().and_then(|s| s.to_str()).unwrap_or("Note");
        if ext == "md" {
            let raw = String::from_utf8_lossy(&std::fs::read(&f)?).into_owned();
            let md = rewrite_notecraft_links(ws, source_root, dir, &raw, &asset_map, report)?;
            write_vault_doc(ws, &join_rel(target_dir, &child_section), stem, "md", &md, false, report)?;
        } else if ext == "html" || ext == "htm" {
            let raw = String::from_utf8_lossy(&std::fs::read(&f)?).into_owned();
            let md = html_to_markdown(ws, source_root, dir, &raw, "notecraft", report)?;
            write_vault_doc(ws, &join_rel(target_dir, &child_section), stem, "md", &md, false, report)?;
        }
    }

    for sub in subdirs {
        walk_notecraft(ws, source_root, &sub, target_dir, &child_section, report)?;
    }
    Ok(())
}

fn rewrite_notecraft_links(
    ws: &Workspace,
    source_root: &Path,
    dir: &Path,
    text: &str,
    asset_map: &HashMap<String, String>,
    report: &mut ImportReport,
) -> Result<String> {
    let mut err: Option<crate::Error> = None;
    let out = MD_ASSET_RE.replace_all(text, |caps: &regex::Captures<'_>| {
        let bang = &caps[1];
        let label = caps[2].trim();
        let target = caps[3].trim();
        if target.starts_with("http://") || target.starts_with("https://") || target.starts_with('#') {
            return caps[0].to_string();
        }
        let dec = percent_decode(target.split('?').next().unwrap_or(target));
        let clean = dec.trim_start_matches("./");
        if let Some(rest) = clean.strip_prefix("assets/") {
            let fname = rest.rsplit('/').next().unwrap_or(rest);
            if let Some(saved) = asset_map.get(fname) {
                return if !bang.is_empty() || is_img_ext(saved) {
                    format!("![[{saved}]]")
                } else if label.is_empty() || label == saved {
                    format!("[[{saved}]]")
                } else {
                    format!("[[{saved}|{label}]]")
                };
            }
        }
        if let Some(abs) = resolve_inside(source_root, dir, &dec) {
            let fname = abs.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            match std::fs::read(&abs).and_then(|b| save_attachment(ws, &fname, &b, report).map_err(std::io::Error::other)) {
                Ok(saved) => {
                    return if !bang.is_empty() || is_img_ext(&saved) {
                        format!("![[{saved}]]")
                    } else if label.is_empty() {
                        format!("[[{saved}]]")
                    } else {
                        format!("[[{saved}|{label}]]")
                    };
                }
                Err(e) => err = Some(e.into()),
            }
        }
        caps[0].to_string()
    });
    if let Some(e) = err {
        return Err(e);
    }
    Ok(out.into_owned())
}

fn is_img_ext(name: &str) -> bool {
    name.rsplit_once('.').is_some_and(|(_, e)| {
        matches!(e.to_ascii_lowercase().as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp")
    })
}

fn apply_notecraft_toml(text: &str, tbl: &toml::Table) -> String {
    let mut out = text.to_string();
    let ordered = ["title", "tags", "created", "created_at", "updated", "updated_at", "icon", "author"];
    for k in ordered {
        if let Some(v) = tbl.get(k) {
            let target_key = match k {
                "created_at" => "created",
                "updated_at" => "updated",
                other => other,
            };
            if let Some(yv) = toml_to_yaml(v) {
                out = set_property(&out, target_key, &yv);
            }
        }
    }
    for (k, v) in tbl {
        if ordered.contains(&k.as_str()) || matches!(k.as_str(), "id" | "uuid" | "order" | "children" | "kind" | "node_type") {
            continue;
        }
        if !k.contains(':') {
            if let Some(yv) = toml_to_yaml(v) {
                out = set_property(&out, k, &yv);
            }
        }
    }
    out
}

fn toml_to_yaml(v: &toml::Value) -> Option<Yaml> {
    match v {
        toml::Value::String(s) => (!s.trim().is_empty()).then(|| Yaml::String(s.trim().to_string())),
        toml::Value::Integer(i) => Some(Yaml::from(*i)),
        toml::Value::Float(f) => f.is_finite().then(|| Yaml::from(*f)),
        toml::Value::Boolean(b) => Some(Yaml::Bool(*b)),
        toml::Value::Datetime(dt) => Some(Yaml::String(dt.to_string())),
        toml::Value::Array(arr) => {
            let seq: Vec<Yaml> = arr.iter().filter_map(toml_to_yaml).collect();
            (!seq.is_empty()).then_some(Yaml::Sequence(seq))
        }
        toml::Value::Table(_) => None,
    }
}

// --- OneNote & HTML Conversion -------------------------------------------------------------------

pub(crate) fn import_onenote_dir(
    ws: &Workspace,
    source_root: &Path,
    target_dir: &str,
    report: &mut ImportReport,
) -> Result<()> {
    for entry in walkdir::WalkDir::new(source_root).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let p = entry.path();
        let fname = entry.file_name().to_string_lossy();
        if fname.starts_with('.') {
            continue;
        }
        let rel_parent = p
            .parent()
            .and_then(|d| d.strip_prefix(source_root).ok())
            .map(|r| {
                r.components()
                    .filter_map(|c| match c {
                        std::path::Component::Normal(s) => {
                            let s = s.to_string_lossy();
                            (!s.ends_with("_files")).then(|| sanitize_component(&s, "Section"))
                        }
                        _ => None,
                    })
                    .collect::<Vec<_>>()
                    .join("/")
            })
            .unwrap_or_default();
        if p.parent().and_then(|d| d.file_name()).is_some_and(|n| n.to_string_lossy().ends_with("_files")) {
            continue;
        }
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
        let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("OneNote Page");
        let dest_dir = join_rel(target_dir, &rel_parent);

        let bytes = std::fs::read(p)?;
        if ext == "one" || bytes.starts_with(&MS_ONE_MAGIC) {
            if !try_notecraft_cli(ws, p, &dest_dir, report)? {
                import_one_binary(ws, stem, &bytes, &dest_dir, report)?;
            }
        } else if matches!(ext.as_str(), "html" | "htm") {
            let html = String::from_utf8_lossy(&bytes);
            let md = html_to_markdown(ws, source_root, p.parent().unwrap_or(source_root), &html, "onenote", report)?;
            write_vault_doc(ws, &dest_dir, stem, "md", &md, false, report)?;
        } else if ext == "md" {
            let raw = String::from_utf8_lossy(&bytes);
            let md = rewrite_notecraft_links(ws, source_root, p.parent().unwrap_or(source_root), &raw, &HashMap::new(), report)?;
            write_vault_doc(ws, &dest_dir, stem, "md", &md, false, report)?;
        }
    }
    Ok(())
}

fn try_notecraft_cli(ws: &Workspace, one_path: &Path, dest_dir: &str, report: &mut ImportReport) -> Result<bool> {
    let tmp = TempCacheDir::new(ws, "notecraft-cli")?;
    let mut cmd = std::process::Command::new("notecraft-cli");
    cmd.args(["import", "onenote"])
        .arg(one_path)
        .arg(tmp.path());
    crate::platform::proc::no_window(&mut cmd);
    let status = cmd.output();
    let Ok(out) = status else { return Ok(false) };
    if !out.status.success() {
        return Ok(false);
    }
    let has_files = walkdir::WalkDir::new(tmp.path())
        .into_iter()
        .filter_map(|e| e.ok())
        .any(|e| e.file_type().is_file());
    if !has_files {
        return Ok(false);
    }
    let before = report.notes_created;
    import_notecraft_dir(ws, tmp.path(), dest_dir, report)?;
    Ok(report.notes_created > before)
}

pub(crate) fn html_to_markdown(
    ws: &Workspace,
    source_root: &Path,
    html_dir: &Path,
    html: &str,
    source_kind: &str,
    report: &mut ImportReport,
) -> Result<String> {
    let doc = Html::parse_document(html);
    let title = Selector::parse("title")
        .ok()
        .and_then(|s| doc.select(&s).next())
        .map(|e| e.text().collect::<String>().trim().to_string())
        .filter(|t| !t.is_empty());
    let created = Selector::parse("meta[name='created'], meta[name='Created']")
        .ok()
        .and_then(|s| doc.select(&s).next())
        .and_then(|e| e.attr("content"))
        .map(|c| c.split('T').next().unwrap_or(c).trim().to_string())
        .filter(|c| !c.is_empty());

    let root_el = Selector::parse("body")
        .ok()
        .and_then(|s| doc.select(&s).next())
        .unwrap_or_else(|| doc.root_element());
    let mut ctx = HtmlCtx { ws, source_root, html_dir, report, img_seq: 0 };
    let mut body = String::new();
    render_children(root_el, &mut ctx, 0, &mut body)?;
    let mut cleaned = collapse_blank_lines(&body);
    if let Some(t) = &title {
        if !cleaned.trim_start().starts_with("# ") {
            cleaned = format!("# {t}\n\n{}", cleaned.trim_start());
        }
    }
    if !cleaned.ends_with('\n') {
        cleaned.push('\n');
    }
    if source_kind == "onenote" {
        if let Some(c) = created {
            cleaned = set_property(&cleaned, "created", &Yaml::String(c));
        }
        cleaned = set_property(&cleaned, "source", &Yaml::String("onenote".into()));
    }
    Ok(cleaned)
}

struct HtmlCtx<'a> {
    ws: &'a Workspace,
    source_root: &'a Path,
    html_dir: &'a Path,
    report: &'a mut ImportReport,
    img_seq: usize,
}

fn onenote_tag_prefix(data_tag: Option<&str>) -> String {
    let Some(raw) = data_tag else { return String::new() };
    let mut out = String::new();
    for part in raw.split(',').map(|s| s.trim().to_ascii_lowercase()) {
        match part.as_str() {
            "to-do:completed" | "to-do-completed" => out.push_str("- [x] "),
            "to-do" => out.push_str("- [ ] "),
            "important" => out.push_str("[!] "),
            "question" => out.push_str("[?] "),
            "idea" => out.push_str("[*] "),
            _ => {}
        }
    }
    out
}

fn render_children(el: ElementRef<'_>, ctx: &mut HtmlCtx<'_>, list_depth: usize, out: &mut String) -> Result<()> {
    for node in el.children() {
        if let Some(t) = node.value().as_text() {
            let s = (**t).replace(['\r', '\n'], " ");
            if !s.trim().is_empty() || (!out.ends_with(' ') && !out.ends_with('\n') && !out.is_empty()) {
                out.push_str(&s);
            }
        } else if let Some(child) = ElementRef::wrap(node) {
            render_element(child, ctx, list_depth, out)?;
        }
    }
    Ok(())
}

fn render_inline(el: ElementRef<'_>, ctx: &mut HtmlCtx<'_>) -> Result<String> {
    let mut s = String::new();
    render_children(el, ctx, 0, &mut s)?;
    Ok(s)
}

fn render_element(el: ElementRef<'_>, ctx: &mut HtmlCtx<'_>, list_depth: usize, out: &mut String) -> Result<()> {
    let tag = el.value().name();
    if matches!(tag, "script" | "style" | "head" | "meta" | "link" | "noscript" | "title") {
        return Ok(());
    }
    let tag_prefix = onenote_tag_prefix(el.attr("data-tag"));
    match tag {
        "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
            let lvl = tag[1..].parse::<usize>().unwrap_or(1);
            let inner = render_inline(el, ctx)?;
            if !inner.trim().is_empty() {
                out.push_str(&format!("\n\n{} {}{}\n\n", "#".repeat(lvl), tag_prefix, inner.trim()));
            }
        }
        "p" => {
            let inner = render_inline(el, ctx)?;
            if !inner.trim().is_empty() || !tag_prefix.is_empty() {
                out.push_str(&format!("\n\n{}{}\n\n", tag_prefix, inner.trim()));
            }
        }
        "br" => out.push('\n'),
        "hr" => out.push_str("\n\n---\n\n"),
        "strong" | "b" => {
            let inner = render_inline(el, ctx)?;
            if !inner.trim().is_empty() {
                out.push_str(&format!("**{}**", inner.trim()));
            }
        }
        "em" | "i" => {
            let inner = render_inline(el, ctx)?;
            if !inner.trim().is_empty() {
                out.push_str(&format!("*{}*", inner.trim()));
            }
        }
        "u" | "ins" => {
            let inner = render_inline(el, ctx)?;
            if !inner.trim().is_empty() {
                out.push_str(&format!("<u>{}</u>", inner.trim()));
            }
        }
        "mark" => {
            let inner = render_inline(el, ctx)?;
            if !inner.trim().is_empty() {
                out.push_str(&format!("=={}==", inner.trim()));
            }
        }
        "code" if el.parent().and_then(ElementRef::wrap).is_none_or(|p| p.value().name() != "pre") => {
            let inner = el.text().collect::<String>();
            out.push_str(&format!("`{}`", inner.trim()));
        }
        "pre" => {
            let inner = el.text().collect::<String>();
            out.push_str(&format!("\n\n```\n{}\n```\n\n", inner.trim_end()));
        }
        "blockquote" => {
            let inner = render_inline(el, ctx)?;
            for line in inner.trim().lines() {
                out.push_str(&format!("\n> {}", line.trim()));
            }
            out.push('\n');
        }
        "a" => {
            let inner = render_inline(el, ctx)?;
            let label = inner.trim();
            if let Some(href) = el.attr("href").map(str::trim).filter(|h| !h.is_empty()) {
                out.push_str(&format!("[{}]({href})", if label.is_empty() { href } else { label }));
            } else {
                out.push_str(label);
            }
        }
        "img" => {
            if let Some(embed) = convert_img_el(el, ctx)? {
                out.push_str(&embed);
            }
        }
        "ul" | "ol" => {
            let ordered = tag == "ol";
            out.push('\n');
            let mut idx = 1usize;
            for child in el.children().filter_map(ElementRef::wrap) {
                if child.value().name() == "li" {
                    let indent = "  ".repeat(list_depth);
                    let li_tag = onenote_tag_prefix(child.attr("data-tag"));
                    let mut inner = String::new();
                    render_children(child, ctx, list_depth + 1, &mut inner)?;
                    let trimmed = inner.trim();
                    let bullet = if li_tag.starts_with("- [") || trimmed.starts_with("- [") {
                        String::new()
                    } else if ordered {
                        let b = format!("{idx}. ");
                        idx += 1;
                        b
                    } else {
                        "- ".into()
                    };
                    out.push_str(&format!("{indent}{bullet}{li_tag}{trimmed}\n"));
                } else {
                    render_element(child, ctx, list_depth + 1, out)?;
                }
            }
            out.push('\n');
        }
        "table" => render_table(el, ctx, out)?,
        _ => {
            if !tag_prefix.is_empty() {
                out.push_str(&format!("\n{tag_prefix}"));
            }
            render_children(el, ctx, list_depth, out)?;
        }
    }
    Ok(())
}

fn render_table(table_el: ElementRef<'_>, ctx: &mut HtmlCtx<'_>, out: &mut String) -> Result<()> {
    let tr_sel = Selector::parse("tr").expect("valid");
    let cell_sel = Selector::parse("th, td").expect("valid");
    let mut rows: Vec<Vec<String>> = Vec::new();
    for tr in table_el.select(&tr_sel) {
        let row: Vec<String> = tr
            .select(&cell_sel)
            .map(|c| {
                render_inline(c, ctx).map(|s| {
                    s.split_whitespace().collect::<Vec<_>>().join(" ").replace('|', "\\|")
                })
            })
            .collect::<Result<Vec<_>>>()?;
        if !row.is_empty() {
            rows.push(row);
        }
    }
    let Some(cols) = rows.iter().map(Vec::len).max().filter(|&n| n > 0) else { return Ok(()) };
    out.push_str("\n\n");
    for (ri, r) in rows.iter().enumerate() {
        out.push('|');
        for ci in 0..cols {
            out.push_str(&format!(" {} |", r.get(ci).map(String::as_str).unwrap_or("")));
        }
        out.push('\n');
        if ri == 0 {
            out.push('|');
            for _ in 0..cols {
                out.push_str(" --- |");
            }
            out.push('\n');
        }
    }
    out.push('\n');
    Ok(())
}

fn convert_img_el(el: ElementRef<'_>, ctx: &mut HtmlCtx<'_>) -> Result<Option<String>> {
    let Some(src) = el.attr("src").map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    if let Some(rest) = src.strip_prefix("data:image/") {
        if let Some((meta, b64)) = rest.split_once(";base64,") {
            let ext = match meta.split(';').next().unwrap_or("png").to_ascii_lowercase().as_str() {
                "jpeg" | "jpg" => "jpg",
                "gif" => "gif",
                "webp" => "webp",
                "svg+xml" => "svg",
                _ => "png",
            };
            let clean_b64: String = b64.chars().filter(|c| !c.is_ascii_whitespace()).collect();
            if let Ok(bytes) = base64::engine::general_purpose::STANDARD
                .decode(&clean_b64)
                .or_else(|_| base64::engine::general_purpose::STANDARD_NO_PAD.decode(&clean_b64))
            {
                ctx.img_seq += 1;
                let saved = save_attachment(ctx.ws, &format!("onenote-image-{}.{ext}", ctx.img_seq), &bytes, ctx.report)?;
                return Ok(Some(format!("![[{saved}]]")));
            }
        }
    }
    if src.starts_with("http://") || src.starts_with("https://") {
        let alt = el.attr("alt").unwrap_or("");
        return Ok(Some(format!("![{alt}]({src})")));
    }
    let decoded = percent_decode(src.split('?').next().unwrap_or(src));
    if let Some(abs) = resolve_inside(ctx.source_root, ctx.html_dir, &decoded) {
        let fname = abs.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "image.png".into());
        let bytes = std::fs::read(&abs)?;
        let saved = save_attachment(ctx.ws, &fname, &bytes, ctx.report)?;
        return Ok(Some(format!("![[{saved}]]")));
    }
    Ok(None)
}

fn collapse_blank_lines(s: &str) -> String {
    let mut out = String::new();
    let mut blanks = 0usize;
    for line in s.lines() {
        if line.trim().is_empty() {
            blanks += 1;
            if blanks <= 1 && !out.is_empty() {
                out.push('\n');
            }
        } else {
            blanks = 0;
            out.push_str(line.trim_end());
            out.push('\n');
        }
    }
    out.trim().to_string()
}

// --- Pure-Rust OneNote `.one` Binary Extractor ---------------------------------------------------

enum OneItem {
    Text(String),
    Image(String),
}

fn import_one_binary(
    ws: &Workspace,
    stem: &str,
    data: &[u8],
    dest_dir: &str,
    report: &mut ImportReport,
) -> Result<()> {
    let clean_stem = sanitize_component(stem, "OneNote Page");
    let mut consumed = vec![false; data.len()];
    if data.starts_with(&MS_ONE_MAGIC) {
        consumed[..16].fill(true);
    }
    let mut items: Vec<(usize, OneItem)> = Vec::new();
    let mut img_idx = 0usize;

    let mut pos = 0usize;
    while pos < data.len() {
        if let Some(end) = scan_png(data, pos) {
            img_idx += 1;
            let saved = save_attachment(ws, &format!("{clean_stem}-{img_idx}.png"), &data[pos..end], report)?;
            consumed[pos..end].fill(true);
            items.push((pos, OneItem::Image(saved)));
            pos = end;
            continue;
        }
        if let Some(end) = scan_jpeg(data, pos) {
            img_idx += 1;
            let saved = save_attachment(ws, &format!("{clean_stem}-{img_idx}.jpg"), &data[pos..end], report)?;
            consumed[pos..end].fill(true);
            items.push((pos, OneItem::Image(saved)));
            pos = end;
            continue;
        }
        pos += 1;
    }

    extract_utf16le_runs(data, &mut consumed, &mut items);
    extract_utf8_runs(data, &consumed, &mut items);
    items.sort_by_key(|(off, _)| *off);

    let mut blocks: Vec<String> = Vec::new();
    let mut last_text = String::new();
    for (_, item) in items {
        match item {
            OneItem::Image(saved) => blocks.push(format!("![[{saved}]]")),
            OneItem::Text(t) => {
                for para in t.lines().map(str::trim).filter(|l| is_clean_onenote_text(l)) {
                    if para != last_text {
                        last_text = para.to_string();
                        blocks.push(para.to_string());
                    }
                }
            }
        }
    }

    let mut md = format!("# {clean_stem}\n");
    if !blocks.is_empty() {
        md.push('\n');
        md.push_str(&blocks.join("\n\n"));
        md.push('\n');
    }
    md = set_property(&md, "source", &Yaml::String("onenote".into()));
    write_vault_doc(ws, dest_dir, &clean_stem, "md", &md, false, report)?;
    Ok(())
}

fn scan_png(data: &[u8], start: usize) -> Option<usize> {
    if !data.get(start..)?.starts_with(b"\x89PNG\r\n\x1a\n") {
        return None;
    }
    let mut pos = start + 8;
    for _ in 0..100_000 {
        let hdr = data.get(pos..pos + 8)?;
        let len = u32::from_be_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]) as usize;
        let kind = &hdr[4..8];
        if !kind.iter().all(u8::is_ascii_alphabetic) {
            return None;
        }
        pos = pos.checked_add(12)?.checked_add(len)?;
        if pos > data.len() {
            return None;
        }
        if kind == b"IEND" {
            return Some(pos);
        }
    }
    None
}

fn scan_jpeg(data: &[u8], start: usize) -> Option<usize> {
    let head = data.get(start..start + 4)?;
    if head[0] != 0xFF || head[1] != 0xD8 || head[2] != 0xFF || matches!(head[3], 0x00 | 0xFF | 0xD8 | 0xD9) {
        return None;
    }
    let mut pos = start + 2;
    for _ in 0..100_000 {
        if *data.get(pos)? != 0xFF {
            return None;
        }
        while pos < data.len() && data[pos] == 0xFF {
            pos += 1;
        }
        let marker = *data.get(pos)?;
        pos += 1;
        match marker {
            0xD9 => return Some(pos),
            0x00 => return None,
            0x01 | 0xD0..=0xD8 => continue,
            _ => {
                let seg = u16::from_be_bytes([*data.get(pos)?, *data.get(pos + 1)?]) as usize;
                if seg < 2 || pos + seg > data.len() {
                    return None;
                }
                pos += seg;
                if marker == 0xDA {
                    while pos < data.len() {
                        if data[pos] != 0xFF {
                            pos += 1;
                            continue;
                        }
                        let ff_pos = pos;
                        while pos < data.len() && data[pos] == 0xFF {
                            pos += 1;
                        }
                        let next_m = *data.get(pos)?;
                        if next_m == 0x00 || (0xD0..=0xD7).contains(&next_m) {
                            pos += 1;
                            continue;
                        }
                        if next_m == 0xD9 {
                            return Some(pos + 1);
                        }
                        pos = ff_pos;
                        break;
                    }
                }
            }
        }
    }
    None
}

fn extract_utf16le_runs(data: &[u8], consumed: &mut [bool], items: &mut Vec<(usize, OneItem)>) {
    let mut i = 0usize;
    while i + 8 <= data.len() {
        if consumed[i] || consumed[i + 1] {
            i += 1;
            continue;
        }
        let mut units = Vec::new();
        let mut high_zero_or_ctrl = 0usize;
        let mut j = i;
        while j + 2 <= data.len() && !consumed[j] && !consumed[j + 1] {
            let u = u16::from_le_bytes([data[j], data[j + 1]]);
            if (0xD800..=0xDBFF).contains(&u) && j + 4 <= data.len() && !consumed[j + 2] && !consumed[j + 3] {
                let lo = u16::from_le_bytes([data[j + 2], data[j + 3]]);
                if (0xDC00..=0xDFFF).contains(&lo) {
                    units.push(u);
                    units.push(lo);
                    high_zero_or_ctrl += 2;
                    j += 4;
                    continue;
                }
            }
            if is_valid_utf16_unit(u) {
                if data[j + 1] < 0x20 {
                    high_zero_or_ctrl += 1;
                }
                units.push(u);
                j += 2;
            } else {
                break;
            }
        }
        if units.len() >= 4 && high_zero_or_ctrl * 2 >= units.len() {
            let decoded: String = char::decode_utf16(units.iter().copied())
                .filter_map(|r| r.ok())
                .collect();
            if is_clean_onenote_text(&decoded) {
                consumed[i..j].fill(true);
                items.push((i, OneItem::Text(decoded)));
                i = j;
                continue;
            }
        }
        i += 1;
    }
}

fn is_valid_utf16_unit(u: u16) -> bool {
    matches!(u, 0x0009 | 0x000A | 0x000D | 0x0020..=0x007E | 0x00A0..=0x024F | 0x0370..=0x04FF | 0x2010..=0x2027)
}

fn extract_utf8_runs(data: &[u8], consumed: &[bool], items: &mut Vec<(usize, OneItem)>) {
    let mut i = 0usize;
    while i < data.len() {
        if consumed[i] || !is_ascii_text_byte(data[i]) {
            i += 1;
            continue;
        }
        let start = i;
        while i < data.len() && !consumed[i] && is_ascii_text_byte(data[i]) {
            i += 1;
        }
        if i - start >= 4 {
            if let Ok(s) = std::str::from_utf8(&data[start..i]) {
                if is_clean_onenote_text(s) {
                    items.push((start, OneItem::Text(s.to_string())));
                }
            }
        }
    }
}

fn is_ascii_text_byte(b: u8) -> bool {
    matches!(b, b'\t' | b'\n' | b'\r' | 0x20..=0x7E)
}

fn is_clean_onenote_text(raw: &str) -> bool {
    let s = raw.trim();
    if s.len() < 4 || s.contains('\u{FFFD}') {
        return false;
    }
    let lower = s.to_ascii_lowercase();
    const NOISE_EXACT: &[&str] = &[
        "calibri", "calibri light", "segoe ui", "segoe ui light", "times new roman",
        "arial", "consolas", "cambria", "cambria math", "courier new", "verdana",
        "tahoma", "georgia", "onenote", "microsoft office onenote", "microsoft onenote",
        "normal", "default", "page", "title", "cite", "en-us", "hyperlink",
    ];
    if NOISE_EXACT.contains(&lower.as_str())
        || lower.starts_with("http://schemas.microsoft.com")
        || lower.starts_with("font-family:")
        || lower.starts_with("<meta ")
        || lower.starts_with("xmlns:")
    {
        return false;
    }
    let (mut total, mut alpha, mut odd) = (0usize, 0usize, 0usize);
    for c in s.chars() {
        total += 1;
        if c.is_alphabetic() {
            alpha += 1;
        } else if !c.is_ascii_digit()
            && !c.is_whitespace()
            && !matches!(c, '.' | ',' | ';' | ':' | '!' | '?' | '\'' | '"' | '(' | ')' | '-' | '_' | '/' | '+' | '=' | '$' | '%' | '&' | '@' | '#' | '[' | ']' | '*')
        {
            odd += 1;
        }
    }
    alpha >= 2 && odd * 8 <= total && alpha * 4 >= total
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::{ImportFormat, ImportPathRequest};
    use crate::importers::{import_archive_bytes, import_local_path};

    #[test]
    fn notecraft_onenote_html_and_pure_rust_one_binary_imports() {
        let src = tempfile::tempdir().unwrap();
        let sec = src.path().join("Physics");
        std::fs::create_dir_all(sec.join("assets")).unwrap();
        std::fs::write(sec.join("_node.toml"), "title = \"Quantum Field Theory\"\ntags = [\"physics\", \"qft\"]\ncreated = \"2026-11-16\"\nicon = \"atom\"\n").unwrap();
        std::fs::write(sec.join("index.md"), "# QFT\nDiagram: ![feynman](./assets/feynman.png)\n").unwrap();
        std::fs::write(sec.join("assets/feynman.png"), b"\x89PNG\r\n\x1a\nfeynman").unwrap();

        let v1 = tempfile::tempdir().unwrap();
        let ws1 = Workspace::open(v1.path()).unwrap();
        let r1 = import_local_path(&ws1, &ImportPathRequest { source_path: src.path().display().to_string(), format: ImportFormat::Auto, target_dir: "Imported".into() }).unwrap();
        assert_eq!((r1.detected_format.as_str(), r1.notes_created, r1.attachments_saved), ("notecraft", 1, 1));
        let qft = std::fs::read_to_string(v1.path().join("Imported/Quantum Field Theory.md")).unwrap();
        assert!(qft.contains("title: Quantum Field Theory") && qft.contains("- qft") && qft.contains("![[feynman.png]]"), "{qft}");

        // OneNote HTML with data-tag, pipe table, and base64 image
        let html = br#"<html><head><title>Lab Meeting</title><meta name="ProgId" content="OneNote.File"><meta name="created" content="2026-11-16T09:00:00"/></head>
        <body><p data-tag="to-do">Calibrate laser</p><p data-tag="to-do:completed">Order mirrors</p>
        <p data-tag="important">Safety goggles required</p>
        <table><tr><th>Run</th><th>Power</th></tr><tr><td>1</td><td>12 mW</td></tr></table>
        <p><img src="data:image/png;base64,iVBORw0KGgo="/></p></body></html>"#;
        let r2 = import_archive_bytes(&ws1, html, ImportFormat::Auto, "OneNote", Some("Meeting.html")).unwrap();
        assert_eq!((r2.detected_format.as_str(), r2.notes_created, r2.attachments_saved), ("onenote", 1, 1));
        let mtg = std::fs::read_to_string(v1.path().join("OneNote/Meeting.md")).unwrap();
        assert!(mtg.contains("- [ ] Calibrate laser") && mtg.contains("- [x] Order mirrors") && mtg.contains("[!] Safety goggles required"), "{mtg}");
        assert!(mtg.contains("| Run | Power |") && mtg.contains("![[onenote-image-1.png]]"), "{mtg}");

        // Pure-Rust .one binary with MS-ONE header, UTF-16LE + UTF-8 runs, font noise, embedded PNG + JPEG
        let mut one = Vec::from(MS_ONE_MAGIC);
        one.extend_from_slice(&[0x00, 0xFF, 0x02, 0x81]);
        for u in "Calibri".encode_utf16() { one.extend_from_slice(&u.to_le_bytes()); }
        one.extend_from_slice(&[0x00, 0x00, 0x01, 0x00]);
        for _ in 0..2 {
            for u in "Hamiltonian simulation notes".encode_utf16() { one.extend_from_slice(&u.to_le_bytes()); }
            one.extend_from_slice(&[0x00, 0x00]);
        }
        one.extend_from_slice(b"\x00\x03 Trotter error bounds hold at second order.\x00\x00");
        // Valid chunked PNG (IHDR 1B + IEND 0B)
        one.extend_from_slice(b"\x89PNG\r\n\x1a\n\x00\x00\x00\x01IHDR\x2a\x00\x00\x00\x00\x00\x00\x00\x00IEND\xae\x42\x60\x82");
        // Valid marker-walked JPEG (SOI + APP0 + SOS + stuffed FF 00 + EOI)
        one.extend_from_slice(&[0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x11, 0x22, 0xFF, 0xDA, 0x00, 0x03, 0x01, 0x99, 0xFF, 0x00, 0x44, 0xFF, 0xD9]);

        let r3 = import_archive_bytes(&ws1, &one, ImportFormat::Auto, "OneNote", Some("Quantum.one")).unwrap();
        assert_eq!(r3.detected_format, "onenote");
        let q_md = std::fs::read_to_string(v1.path().join("OneNote/Quantum.md")).unwrap();
        assert!(q_md.contains("source: onenote") && !q_md.contains("Calibri"), "{q_md}");
        assert_eq!(q_md.matches("Hamiltonian simulation notes").count(), 1, "deduplicated: {q_md}");
        assert!(q_md.contains("Trotter error bounds hold at second order."), "{q_md}");
        assert!(q_md.contains("![[Quantum-1.png]]") && q_md.contains("![[Quantum-2.jpg]]"), "{q_md}");
    }
}
