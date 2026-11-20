//! Typst in the core (docs/design/DESIGN-export.md §2.2): a ```typst fence drawn as SVG pages, a vault `.typ` compiled
//! into a PDF. The project root is the vault (a file names pictures beside it, `/x` from the vault's top, nothing
//! outside); fonts are Typst's embedded ones plus the machine's, scanned once; `@ns/name:ver` packages come from the
//! local Typst package folders only — nothing is downloaded while compiling.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use typst::diag::{FileError, FileResult, PackageError, SourceDiagnostic};
use typst::foundations::{Bytes, Datetime, Duration};
use typst_layout::PagedDocument;
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World, WorldExt};
use typst_kit::files::{FileLoader, FileStore};
use typst_kit::fonts::FontStore;

/// What a fence gets before its own text: a page as big as what it holds, transparent, so a formula or a diagram
/// sits in the note like a picture. One line, taken off the line numbers of errors.
const FENCE_PAGE: &str = "#set page(width: auto, height: auto, margin: 4pt, fill: none)\n";

fn fonts() -> &'static FontStore {
    static FONTS: OnceLock<FontStore> = OnceLock::new();
    FONTS.get_or_init(|| {
        let mut store = FontStore::new();
        store.extend(typst_kit::fonts::embedded());
        store.extend(typst_kit::fonts::system());
        store
    })
}

fn library() -> &'static LazyHash<Library> {
    static LIB: OnceLock<LazyHash<Library>> = OnceLock::new();
    LIB.get_or_init(|| LazyHash::new(Library::default()))
}

/// The local Typst package folders, as the `typst` program uses them: `{data,cache}/typst/packages/<ns>/<name>/<ver>`.
fn package_dirs() -> Vec<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let data = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).or_else(|| home.as_ref().map(|h| h.join(".local/share")));
    let cache = std::env::var_os("XDG_CACHE_HOME").map(PathBuf::from).or_else(|| home.as_ref().map(|h| h.join(".cache")));
    [data, cache].into_iter().flatten().map(|d| d.join("typst/packages")).collect()
}

/// Files for the compiler: the vault for the project, the local package folders for packages.
struct VaultFiles {
    root: PathBuf,
}

impl FileLoader for VaultFiles {
    fn load(&self, id: FileId) -> FileResult<Bytes> {
        let base = match id.root() {
            VirtualRoot::Project => self.root.clone(),
            VirtualRoot::Package(spec) => package_dirs()
                .into_iter()
                .map(|d| d.join(spec.namespace.as_str()).join(spec.name.as_str()).join(spec.version.to_string()))
                .find(|d| d.is_dir())
                .ok_or_else(|| FileError::Package(PackageError::NotFound(spec.clone())))?,
        };
        let path = id.vpath().realize(&base).map_err(FileError::Realize)?;
        if path.is_dir() {
            return Err(FileError::IsDirectory);
        }
        std::fs::read(&path).map(Bytes::new).map_err(|e| FileError::from_io(e, &path))
    }
}

struct VaultWorld {
    main: FileId,
    /// A fence's text, standing for `main` (it is in no file).
    text: Option<String>,
    files: FileStore<VaultFiles>,
}

impl VaultWorld {
    fn new(root: &Path, main: &str, text: Option<String>) -> Result<Self, String> {
        let vpath = VirtualPath::new(main).map_err(|e| format!("{main}: {e:?}"))?;
        Ok(Self {
            main: RootedPath::new(VirtualRoot::Project, vpath).intern(),
            text,
            files: FileStore::new(VaultFiles { root: root.to_path_buf() }),
        })
    }
}

impl World for VaultWorld {
    fn library(&self) -> &LazyHash<Library> {
        library()
    }
    fn book(&self) -> &LazyHash<FontBook> {
        fonts().book()
    }
    fn main(&self) -> FileId {
        self.main
    }
    fn source(&self, id: FileId) -> FileResult<Source> {
        match &self.text {
            Some(t) if id == self.main => Ok(Source::new(id, t.clone())),
            _ => self.files.source(id),
        }
    }
    fn file(&self, id: FileId) -> FileResult<Bytes> {
        self.files.file(id)
    }
    fn font(&self, index: usize) -> Option<Font> {
        fonts().font(index)
    }
    fn today(&self, offset: Option<Duration>) -> Option<Datetime> {
        use chrono::Datelike;
        let date = match offset {
            Some(o) => (chrono::Utc::now() + chrono::Duration::seconds(o.seconds() as i64)).date_naive(),
            None => chrono::Local::now().date_naive(),
        };
        Datetime::from_ymd(date.year(), date.month() as u8, date.day() as u8)
    }
}

/// Typst's errors as a person reads them: `line N: message` (the fence's own numbering), with Typst's hints.
fn explain(world: &VaultWorld, diags: &[SourceDiagnostic], shift: usize) -> String {
    let mut out = Vec::new();
    for d in diags.iter().filter(|d| d.severity == typst::diag::Severity::Error) {
        let at = d.span.id().and_then(|id| {
            let src = world.source(id).ok()?;
            let line = src.lines().byte_to_line(world.range(d.span)?.start)? + 1;
            let file = if id == world.main { String::new() } else { format!("{} ", id.vpath().get_without_slash()) };
            Some(format!("{file}line {}: ", line.saturating_sub(if id == world.main { shift } else { 0 })))
        });
        out.push(format!("{}{}", at.unwrap_or_default(), d.message));
        out.extend(d.hints.iter().map(|h| format!("  hint: {}", h.v)));
    }
    if out.is_empty() { "Typst could not compile this".into() } else { out.join("\n") }
}

fn compile(world: &VaultWorld, shift: usize) -> Result<PagedDocument, String> {
    typst::compile::<PagedDocument>(world).output.map_err(|e| explain(world, &e, shift))
}

/// A ```typst fence as the page gets it: its pages, or why Typst could not draw it.
#[derive(Debug, serde::Serialize, ts_rs::TS)]
#[serde(tag = "kind", rename_all = "lowercase")]
#[ts(export)]
pub enum TypstDrawn {
    Pages { svg: Vec<String> },
    Error { error: String },
}

/// The fence drawn for the page.
pub fn draw(root: &Path, note: &str, source: &str) -> TypstDrawn {
    match fence_svg(root, note, source) {
        Ok(svg) => TypstDrawn::Pages { svg },
        Err(error) => TypstDrawn::Error { error },
    }
}

/// Where a fence of the note at `note` stands for the compiler: beside the note, so it names pictures as the note does.
fn fence_main(note: &str) -> String {
    match Path::new(note).parent().map(|p| p.to_string_lossy().replace('\\', "/")).filter(|d| !d.is_empty()) {
        Some(dir) => format!("/{dir}/.fence.typ"),
        None => "/.fence.typ".into(),
    }
}

/// A ```typst fence of the note at `note` (a vault path): its pages as SVG, or Typst's errors.
pub fn fence_svg(root: &Path, note: &str, source: &str) -> Result<Vec<String>, String> {
    let world = VaultWorld::new(root, &fence_main(note), Some(format!("{FENCE_PAGE}{source}")))?;
    let doc = compile(&world, FENCE_PAGE.lines().count())?;
    let opts = typst_svg::SvgOptions::default();
    Ok(doc.pages().iter().map(|p| typst_svg::svg(p, &opts)).collect())
}

/// Typst compiled into a PDF at `pdf` (a vault path) → that path. The source is the vault's `.typ` at `typ`, or
/// `source` standing at that path (its pictures read beside it); `fence`: sized to what it holds, as a fence is drawn.
pub fn to_pdf(root: &Path, typ: &str, pdf: &str, source: Option<&str>, fence: bool) -> Result<String, String> {
    let (typ, pdf) = (typ.trim_start_matches('/'), pdf.trim_start_matches('/'));
    if !typ.to_lowercase().ends_with(".typ") || !pdf.to_lowercase().ends_with(".pdf") {
        return Err(format!("Typst compiles a .typ into a .pdf, not {typ} → {pdf}"));
    }
    crate::paths::safe_join(root, typ).map_err(|e| e.to_string())?;
    let out = crate::paths::safe_join(root, pdf).map_err(|e| e.to_string())?;
    let text = source.map(|s| if fence { format!("{FENCE_PAGE}{s}") } else { s.to_string() });
    let world = VaultWorld::new(root, &format!("/{typ}"), text)?;
    let shift = if fence { FENCE_PAGE.lines().count() } else { 0 };
    let doc = compile(&world, shift)?;
    let bytes = typst_pdf::pdf(&doc, &typst_pdf::PdfOptions::default()).map_err(|e| explain(&world, &e, shift))?;
    if let Some(dir) = out.parent() {
        crate::vault_write::mkdir(dir).map_err(|e| e.to_string())?;
    }
    crate::vault_write::write(&out, &bytes).map_err(|e| e.to_string())?;
    Ok(pdf.to_string())
}

/// Converts a vault Markdown note into valid Typst source and compiles it to PDF bytes.
/// Uses rich Markdown->Typst rendering (headings, bold/italic/code, wikilinks, lists, blockquotes,
/// fenced code blocks, simple pipe tables, and math) with automatic fallback to an escaped plain-block
/// Typst document so arbitrary Markdown notes always produce a valid PDF.
pub fn markdown_note_to_pdf(root: &Path, rel_path: &str, markdown: &str) -> anyhow::Result<Vec<u8>> {
    let rel = rel_path.trim_start_matches('/');
    let main_rel = match Path::new(rel).parent().map(|p| p.to_string_lossy().replace('\\', "/")).filter(|d| !d.is_empty()) {
        Some(dir) => format!("/{dir}/.note_export.typ"),
        None => "/.note_export.typ".into(),
    };
    let stem_title = Path::new(rel)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Note".to_string());

    let (fm_title, body) = split_note_frontmatter(markdown);
    let doc_title = fm_title.or_else(|| first_h1_title(body)).unwrap_or(stem_title);

    let rich = render_markdown_to_typst(&doc_title, body);
    if let Ok(bytes) = compile_typst_to_pdf_bytes(root, &main_rel, &rich) {
        return Ok(bytes);
    }

    // Automatic fallback: escaped plain blocks so quirky Markdown syntax can never fail export.
    let safe = render_fallback_typst(&doc_title, body);
    compile_typst_to_pdf_bytes(root, &main_rel, &safe).map_err(|e| anyhow::anyhow!("PDF export failed: {e}"))
}

fn compile_typst_to_pdf_bytes(root: &Path, main_rel: &str, source: &str) -> Result<Vec<u8>, String> {
    let world = VaultWorld::new(root, main_rel, Some(source.to_string()))?;
    let doc = compile(&world, 0)?;
    typst_pdf::pdf(&doc, &typst_pdf::PdfOptions::default()).map_err(|e| explain(&world, &e, 0))
}

fn split_note_frontmatter(markdown: &str) -> (Option<String>, &str) {
    let (fm, body) = kandinsky_text::frontmatter::split(markdown);
    let title = fm.and_then(|raw| {
        serde_yaml::from_str::<serde_yaml::Mapping>(raw)
            .ok()
            .and_then(|m| m.get(serde_yaml::Value::String("title".into())).and_then(|v| v.as_str()).map(|s| s.trim().to_string()))
            .filter(|s| !s.is_empty())
    });
    (title, body)
}

fn first_h1_title(body: &str) -> Option<String> {
    let mut fences = kandinsky_text::fence::Fences::default();
    for line in body.lines() {
        if fences.code(line) {
            continue;
        }
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("# ") {
            let clean = rest.trim();
            if !clean.is_empty() {
                return Some(clean.to_string());
            }
        }
    }
    None
}

fn typst_preamble(title: &str) -> String {
    let escaped = escape_typst_string(title);
    format!(
        "#set page(paper: \"a4\", margin: (x: 22mm, y: 20mm))\n\
         #set text(size: 10.5pt)\n\
         #set par(leading: 0.72em, justify: false)\n\
         #set document(title: \"{escaped}\")\n\n"
    )
}

fn escape_typst_string(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

fn escape_typst_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '#' => out.push_str("\\#"),
            '$' => out.push_str("\\$"),
            '*' => out.push_str("\\*"),
            '_' => out.push_str("\\_"),
            '`' => out.push_str("\\`"),
            '<' => out.push_str("\\<"),
            '>' => out.push_str("\\>"),
            '@' => out.push_str("\\@"),
            '[' => out.push_str("\\["),
            ']' => out.push_str("\\]"),
            '~' => out.push_str("\\~"),
            '=' => out.push_str("\\="),
            '/' => out.push_str("\\/"),
            _ => out.push(ch),
        }
    }
    out
}

fn render_fallback_typst(title: &str, body: &str) -> String {
    let mut out = typst_preamble(title);
    out.push_str(&format!("#heading[#text(\"{}\")]\n\n", escape_typst_string(title)));
    for line in body.lines() {
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            out.push('\n');
        } else {
            out.push_str(&format!("#text(\"{}\")\n\n", escape_typst_string(trimmed)));
        }
    }
    out
}

fn render_markdown_to_typst(title: &str, body: &str) -> String {
    let mut out = typst_preamble(title);
    let lines: Vec<&str> = body.lines().collect();
    let mut i = 0usize;
    let mut emitted_h1 = false;

    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();

        // Fenced code blocks (``` or ~~~)
        if let Some(fence_ch) = fence_marker(trimmed) {
            let lang = trimmed.trim_start_matches(fence_ch).trim();
            i += 1;
            let mut code_lines = Vec::new();
            while i < lines.len() {
                let l = lines[i];
                if l.trim_start().starts_with(&fence_ch.to_string().repeat(3)) {
                    i += 1;
                    break;
                }
                code_lines.push(l);
                i += 1;
            }
            let code_body = code_lines.join("\n");
            let safe_ticks = longest_backtick_run(&code_body) + 1;
            let ticks = "`".repeat(safe_ticks.max(3));
            let lang_tag = lang.split_whitespace().next().unwrap_or("");
            if lang_tag.is_empty() {
                out.push_str(&format!("{ticks}\n{code_body}\n{ticks}\n\n"));
            } else {
                out.push_str(&format!("{ticks}{lang_tag}\n{code_body}\n{ticks}\n\n"));
            }
            continue;
        }

        // Display math block $$ ... $$
        if trimmed.starts_with("$$") {
            if trimmed.len() > 4 && trimmed.ends_with("$$") {
                let expr = sanitize_math(&trimmed[2..trimmed.len() - 2]);
                out.push_str(&format!("$ {expr} $\n\n"));
                i += 1;
                continue;
            }
            i += 1;
            let mut math_lines = Vec::new();
            if let Some(after) = trimmed.strip_prefix("$$").map(str::trim).filter(|s| !s.is_empty()) {
                math_lines.push(after);
            }
            while i < lines.len() {
                let l = lines[i].trim();
                if let Some(before) = l.strip_suffix("$$") {
                    if !before.trim().is_empty() {
                        math_lines.push(before.trim());
                    }
                    i += 1;
                    break;
                }
                math_lines.push(l);
                i += 1;
            }
            let expr = sanitize_math(&math_lines.join(" "));
            if !expr.is_empty() {
                out.push_str(&format!("$ {expr} $\n\n"));
            }
            continue;
        }

        // Blank lines
        if trimmed.is_empty() {
            out.push('\n');
            i += 1;
            continue;
        }

        // Horizontal rule
        if is_hr(trimmed) {
            out.push_str("#line(length: 100%, stroke: 0.5pt + luma(190))\n\n");
            i += 1;
            continue;
        }

        // Headings #..######
        if let Some((level, text)) = parse_heading(trimmed) {
            if level == 1 && !emitted_h1 {
                emitted_h1 = true;
            }
            let eq = "=".repeat(level);
            out.push_str(&format!("{eq} {}\n\n", convert_inline(text)));
            i += 1;
            continue;
        }

        // Pipe table (header + separator + rows)
        if trimmed.contains('|') && i + 1 < lines.len() && is_table_sep(lines[i + 1].trim()) {
            let headers = split_table_row(trimmed);
            let cols = headers.len().max(1);
            i += 2;
            let mut rows = Vec::new();
            while i < lines.len() {
                let row_trim = lines[i].trim();
                if row_trim.is_empty() || !row_trim.contains('|') {
                    break;
                }
                rows.push(split_table_row(row_trim));
                i += 1;
            }
            out.push_str(&format!("#table(\n  columns: {cols},\n"));
            for h in headers {
                out.push_str(&format!("  [*{}*],\n", convert_inline(&h)));
            }
            for r in rows {
                for idx in 0..cols {
                    let cell = r.get(idx).map(String::as_str).unwrap_or("");
                    out.push_str(&format!("  [{}],\n", convert_inline(cell)));
                }
            }
            out.push_str(")\n\n");
            continue;
        }

        // Blockquotes >
        if trimmed.starts_with('>') {
            let mut quote_lines = Vec::new();
            while i < lines.len() {
                let t = lines[i].trim();
                if let Some(rest) = t.strip_prefix('>') {
                    quote_lines.push(rest.trim_start());
                    i += 1;
                } else {
                    break;
                }
            }
            let body_q = quote_lines
                .into_iter()
                .map(convert_inline)
                .collect::<Vec<_>>()
                .join("\n\n");
            out.push_str(&format!("#quote(block: true)[{body_q}]\n\n"));
            continue;
        }

        // Bullet / task / numbered lists
        if let Some(item) = parse_list_line(line) {
            let indent = "  ".repeat(item.depth);
            let marker = if item.ordered { "+" } else { "-" };
            let prefix = match item.checked {
                Some(true) => "☑ ",
                Some(false) => "☐ ",
                None => "",
            };
            out.push_str(&format!("{indent}{marker} {prefix}{}\n", convert_inline(item.text)));
            i += 1;
            continue;
        }

        // Regular paragraph line
        if !emitted_h1 && out.len() <= typst_preamble(title).len() + 2 {
            emitted_h1 = true;
            out.push_str(&format!("= {}\n\n", escape_typst_text(title)));
        }
        out.push_str(&convert_inline(line));
        out.push('\n');
        i += 1;
    }
    out
}

fn fence_marker(trimmed: &str) -> Option<char> {
    if trimmed.starts_with("```") {
        Some('`')
    } else if trimmed.starts_with("~~~") {
        Some('~')
    } else {
        None
    }
}

fn longest_backtick_run(s: &str) -> usize {
    let mut best = 0usize;
    let mut cur = 0usize;
    for ch in s.chars() {
        if ch == '`' {
            cur += 1;
            best = best.max(cur);
        } else {
            cur = 0;
        }
    }
    best
}

fn is_hr(trimmed: &str) -> bool {
    let clean: String = trimmed.chars().filter(|c| !c.is_whitespace()).collect();
    clean.len() >= 3 && (clean.chars().all(|c| c == '-') || clean.chars().all(|c| c == '*') || clean.chars().all(|c| c == '_'))
}

fn parse_heading(trimmed: &str) -> Option<(usize, &str)> {
    let hashes = trimmed.chars().take_while(|&c| c == '#').count();
    if (1..=6).contains(&hashes) && trimmed[hashes..].starts_with(' ') {
        Some((hashes, trimmed[hashes + 1..].trim()))
    } else {
        None
    }
}

fn is_table_sep(trimmed: &str) -> bool {
    if !trimmed.contains('|') {
        return false;
    }
    let cells = split_table_row(trimmed);
    !cells.is_empty()
        && cells.iter().all(|c| {
            let t = c.trim().trim_matches(':');
            !t.is_empty() && t.chars().all(|ch| ch == '-')
        })
}

fn split_table_row(trimmed: &str) -> Vec<String> {
    let s = trimmed.trim().trim_start_matches('|').trim_end_matches('|');
    s.split('|').map(|c| c.trim().to_string()).collect()
}

struct ListItem<'a> {
    depth: usize,
    ordered: bool,
    checked: Option<bool>,
    text: &'a str,
}

fn parse_list_line(line: &str) -> Option<ListItem<'_>> {
    let spaces = line.chars().take_while(|&c| c == ' ' || c == '\t').map(|c| if c == '\t' { 2 } else { 1 }).sum::<usize>();
    let depth = spaces / 2;
    let t = line.trim_start();
    let (ordered, rest) = if let Some(r) = t.strip_prefix("- ").or_else(|| t.strip_prefix("* ")).or_else(|| t.strip_prefix("+ ")) {
        (false, r)
    } else {
        let digits = t.chars().take_while(|c| c.is_ascii_digit()).count();
        if digits > 0 && t[digits..].starts_with(". ") {
            (true, &t[digits + 2..])
        } else {
            return None;
        }
    };
    let (checked, text) = if let Some(r) = rest.strip_prefix("[ ] ") {
        (Some(false), r)
    } else if let Some(r) = rest.strip_prefix("[x] ").or_else(|| rest.strip_prefix("[X] ")) {
        (Some(true), r)
    } else {
        (None, rest)
    };
    Some(ListItem { depth, ordered, checked, text })
}

fn sanitize_math(raw: &str) -> String {
    // Strip LaTeX delimiters/commands Typst rejects so inline/display math renders cleanly without syntax errors.
    raw.trim()
        .replace("\\frac", "frac")
        .replace("\\cdot", "dot")
        .replace("\\times", "times")
        .replace("\\alpha", "alpha")
        .replace("\\beta", "beta")
        .replace("\\gamma", "gamma")
        .replace("\\delta", "delta")
        .replace("\\lambda", "lambda")
        .replace("\\sigma", "sigma")
        .replace("\\omega", "omega")
        .replace("\\pi", "pi")
        .replace("\\infty", "infinity")
        .replace("\\sum", "sum")
        .replace("\\int", "integral")
}

/// Converts inline Markdown (`[[Target|Alias]]`, `[text](url)`, `` `code` ``, `$math$`, `**bold**`, `*italic*`)
/// into valid Typst markup.
fn convert_inline(input: &str) -> String {
    let mut out = String::with_capacity(input.len() + 16);
    let mut rest = input;
    while !rest.is_empty() {
        // Inline code `...`
        if let Some(after) = rest.strip_prefix('`') {
            if let Some(end) = after.find('`') {
                let code = &after[..end];
                out.push_str(&format!("#raw(\"{}\")", escape_typst_string(code)));
                rest = &after[end + 1..];
                continue;
            }
        }
        // Inline math $...$ (non-empty, single line)
        if rest.starts_with('$') && !rest.starts_with("$$") {
            if let Some(end) = rest[1..].find('$').filter(|&e| e > 0) {
                let expr = &rest[1..1 + end];
                out.push('$');
                out.push_str(&sanitize_math(expr));
                out.push('$');
                rest = &rest[1 + end + 1..];
                continue;
            }
        }
        // Embedded or normal wikilink ![[Target|Alias]] / [[Target|Alias]]
        if rest.starts_with("![[") || rest.starts_with("[[") {
            let is_embed = rest.starts_with("![[");
            let open_len = if is_embed { 3 } else { 2 };
            if let Some(end) = rest[open_len..].find("]]") {
                let inner = &rest[open_len..open_len + end];
                let shown = inner
                    .split_once('|')
                    .map(|(_, alias)| alias)
                    .unwrap_or_else(|| inner.split('#').next().unwrap_or(inner).rsplit('/').next().unwrap_or(inner));
                out.push_str(&escape_typst_text(shown.trim()));
                rest = &rest[open_len + end + 2..];
                continue;
            }
        }
        // Markdown link [label](url)
        if let Some(after) = rest.strip_prefix('[') {
            if let Some(close_br) = after.find(']') {
                let tail = &after[close_br + 1..];
                if let Some(after_paren) = tail.strip_prefix('(') {
                    if let Some(close_p) = after_paren.find(')') {
                        let label = &after[..close_br];
                        let href = &after_paren[..close_p];
                        let href_url = href.split_whitespace().next().unwrap_or(href);
                        if href_url.starts_with("http://") || href_url.starts_with("https://") {
                            out.push_str(&format!("#link(\"{}\")[{}]", escape_typst_string(href_url), escape_typst_text(label)));
                        } else {
                            out.push_str(&escape_typst_text(label));
                        }
                        rest = &after_paren[close_p + 1..];
                        continue;
                    }
                }
            }
        }
        // Bold **...**
        if let Some(after) = rest.strip_prefix("**") {
            if let Some(end) = after.find("**").filter(|&e| e > 0) {
                out.push_str(&format!("#strong[{}]", convert_inline(&after[..end])));
                rest = &after[end + 2..];
                continue;
            }
        }
        // Italic *...*
        if let Some(after) = rest.strip_prefix('*') {
            if let Some(end) = after.find('*').filter(|&e| e > 0 && !after[..e].starts_with(' ')) {
                out.push_str(&format!("#emph[{}]", convert_inline(&after[..end])));
                rest = &after[end + 1..];
                continue;
            }
        }
        let ch = rest.chars().next().unwrap();
        let mut buf = [0u8; 4];
        out.push_str(&escape_typst_text(ch.encode_utf8(&mut buf)));
        rest = &rest[ch.len_utf8()..];
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fence_draws_with_pictures_beside_its_note_and_says_where_it_is_wrong() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("notes")).unwrap();
        std::fs::write(dir.path().join("notes/data.csv"), "a,b\n1,2\n").unwrap();
        let svg = fence_svg(dir.path(), "notes/x.md", "$ E = m c^2 $ #csv(\"data.csv\").len()").unwrap();
        assert_eq!(svg.len(), 1);
        assert!(svg[0].starts_with("<svg") && svg[0].contains("<path"), "{}", &svg[0][..200.min(svg[0].len())]);
        let why = fence_svg(dir.path(), "notes/x.md", "fine\n#nope(1)").unwrap_err();
        assert!(why.starts_with("line 2: ") && why.contains("nope"), "{why}");
        let why = fence_svg(dir.path(), "notes/x.md", "#image(\"../../etc/passwd\")").unwrap_err();
        assert!(!why.is_empty(), "{why}");
        let why = fence_svg(dir.path(), "x.md", "#import \"@preview/not-here:0.0.1\": *").unwrap_err();
        assert!(why.contains("not-here"), "{why}");
    }

    #[test]
    fn a_typ_file_becomes_a_pdf() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("exports")).unwrap();
        std::fs::write(dir.path().join("exports/x.typ"), "= Title\nSome text with $integral_0^1 x dif x$.\n").unwrap();
        assert_eq!(to_pdf(dir.path(), "exports/x.typ", "exports/x.pdf", None, false).unwrap(), "exports/x.pdf");
        assert!(std::fs::read(dir.path().join("exports/x.pdf")).unwrap().starts_with(b"%PDF"));
        assert!(to_pdf(dir.path(), "exports/x.typ", "../x.pdf", None, false).is_err());
        // a text standing beside a note: its pictures read there, the PDF where asked
        std::fs::write(dir.path().join("exports/dot.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"4\" height=\"4\"/>").unwrap();
        to_pdf(dir.path(), "exports/.fence.typ", ".kandinsky/cache/f.pdf", Some("#image(\"dot.svg\")"), true).unwrap();
        assert!(dir.path().join(".kandinsky/cache/f.pdf").is_file());
    }

    #[test]
    fn markdown_note_exports_to_valid_pdf_with_frontmatter_wikilinks_code_and_math() {
        let dir = tempfile::tempdir().unwrap();
        let md = "---\ntitle: Quantum Notes\ntags: [physics]\n---\n# Quantum Notes\n\n\
            See [[Green Function|GF]] with **bold**, *italic*, and `inline_code()`.\n\n\
            - [ ] Verify $E = m c^2$\n\
            - [x] Done item\n\n\
            > A short blockquote with #tag and [link](https://example.org).\n\n\
            | Symbol | Meaning |\n| --- | --- |\n| H | Hamiltonian |\n\n\
            ```rust\nfn main() { println!(\"ok\"); }\n```\n\n\
            $$\nx^2 + y^2 = z^2\n$$\n";
        let pdf = markdown_note_to_pdf(dir.path(), "notes/quantum.md", md).unwrap();
        assert!(pdf.starts_with(b"%PDF-"), "expected PDF header");

        // Quirky syntax still exports cleanly via automatic fallback.
        let quirky = "# Broken #unclosed $math \\bad_cmd [[\n\nRaw line with # and @ and $ signs.\n";
        let quirky_pdf = markdown_note_to_pdf(dir.path(), "notes/quirky.md", quirky).unwrap();
        assert!(quirky_pdf.starts_with(b"%PDF-"), "expected fallback PDF header");
    }
}
