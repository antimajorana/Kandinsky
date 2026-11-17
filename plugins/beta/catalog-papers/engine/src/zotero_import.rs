//! Lossless, read-only cross-platform Zotero 6/7/8 + Better BibTeX + ZotMoov importer.
use crate::entry;
use crate::external::{self, format_pdf_filename, path_in_external_roots, sanitize_pdf_filename, write_external_pdf};
use crate::refs::{citekey, year_of, Lib, Res};
use kandinsky_text::paths::{real, rel_path, safe_join};
use rusqlite::{types::ValueRef, Connection, OpenFlags};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{json, Value as Json};
use serde_yaml::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct DiscoveredZotero {
    pub found: bool, pub data_dir: Option<String>, pub sqlite_path: Option<String>, pub prefs_path: Option<String>,
    pub base_attachment_path: Option<String>, pub zotmoov_dst_dir: Option<String>, pub zotmoov_enable_subdir: bool,
    pub zotmoov_subdir_str: Option<String>, pub better_bibtex_path: Option<String>, pub candidates: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ZoteroImportOpts {
    pub data_dir: Option<String>, pub prefs_path: Option<String>, pub base_attachment_path: Option<String>,
    pub dry_run: bool, pub copy_storage_pdfs: bool,
}

impl Default for ZoteroImportOpts {
    fn default() -> Self { Self { data_dir: None, prefs_path: None, base_attachment_path: None, dry_run: true, copy_storage_pdfs: true } }
}

impl<'de> Deserialize<'de> for ZoteroImportOpts {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(Deserialize, Default)]
        #[serde(default)]
        struct Raw { data_dir: Option<String>, prefs_path: Option<String>, base_attachment_path: Option<String>, dry_run: Option<bool>, apply: Option<bool>, copy_storage_pdfs: Option<bool> }
        let r = Raw::deserialize(d)?;
        Ok(Self { data_dir: r.data_dir, prefs_path: r.prefs_path, base_attachment_path: r.base_attachment_path, dry_run: r.dry_run.unwrap_or_else(|| !r.apply.unwrap_or(false)), copy_storage_pdfs: r.copy_storage_pdfs.unwrap_or(true) })
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ZoteroImportReport {
    pub dry_run: bool, pub data_dir: String, pub base_attachment_path: Option<String>, pub used_snapshot: bool,
    pub total_items: usize, pub imported: usize, pub updated: usize, pub trash_skipped: usize,
    pub linked_in_place: usize, pub copied_pdfs: usize, pub missing_pdfs: Vec<String>, pub notes_imported: usize,
    pub annotations_imported: usize, pub collections_found: usize, pub relations_linked: usize, pub citekeys: Vec<String>,
}

#[derive(Default)]
struct PrefsVals { data_dir: Option<String>, base_att: Option<String>, zotmoov_dst: Option<String>, zotmoov_sub_on: bool, zotmoov_sub_str: Option<String> }

fn unescape_js(s: &str) -> String {
    let (mut out, mut chars) = (String::with_capacity(s.len()), s.chars());
    while let Some(c) = chars.next() {
        match (c, chars.clone().next()) {
            ('\\', Some(_)) => match chars.next().unwrap() { 'n' => out.push('\n'), 'r' => out.push('\r'), 't' => out.push('\t'), o => out.push(o) },
            _ => out.push(c),
        }
    }
    out
}

fn parse_prefs_js(text: &str) -> PrefsVals {
    let mut p = PrefsVals::default();
    for line in text.lines() {
        let Some((key, after)) = line.trim().strip_prefix("user_pref(\"").and_then(|r| r.split_once("\",")) else { continue };
        let val = after.trim().trim_end_matches(");").trim();
        let sv = || val.strip_prefix('"').and_then(|s| s.strip_suffix('"')).map(unescape_js).filter(|s| !s.trim().is_empty());
        match key {
            "extensions.zotero.dataDir" => p.data_dir = sv(),
            "extensions.zotero.baseAttachmentPath" => p.base_att = sv(),
            "extensions.zotmoov.dst_dir" => p.zotmoov_dst = sv(),
            "extensions.zotmoov.enable_subdir_move" => p.zotmoov_sub_on = val == "true",
            "extensions.zotmoov.subdir_str" => p.zotmoov_sub_str = sv(),
            _ => {}
        }
    }
    p
}

fn glob_prefs_in(profiles_dir: &Path, out: &mut Vec<PathBuf>) {
    if let Ok(entries) = std::fs::read_dir(profiles_dir) {
        let mut dirs: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.join("prefs.js").is_file()).collect();
        dirs.sort();
        out.extend(dirs.into_iter().map(|d| d.join("prefs.js")));
    }
}

pub fn discover_zotero(override_dir: Option<&str>, override_prefs: Option<&str>, override_base_att: Option<&str>) -> DiscoveredZotero {
    let mut prefs_files: Vec<PathBuf> = override_prefs.map(str::trim).filter(|s| !s.is_empty()).map(PathBuf::from).filter(|p| p.is_file()).into_iter().collect();
    let mut homes: Vec<PathBuf> = Vec::new();
    for v in ["KANDINSKY_TEST_ZOTERO_HOME", "USERPROFILE", "HOME"] {
        if let Some(h) = std::env::var_os(v).map(PathBuf::from).filter(|h| !homes.contains(h)) { homes.push(h); }
    }
    for v in ["APPDATA", "LOCALAPPDATA"] {
        if let Some(ad) = std::env::var_os(v).map(PathBuf::from) { glob_prefs_in(&ad.join("Zotero/Zotero/Profiles"), &mut prefs_files); }
    }
    for h in &homes {
        for sub in ["Library/Application Support/Zotero/Profiles", ".zotero/zotero", ".var/app/org.zotero.Zotero/.zotero/zotero"] {
            glob_prefs_in(&h.join(sub), &mut prefs_files);
        }
    }
    let (mut parsed, mut chosen_prefs) = (PrefsVals::default(), None);
    for pf in &prefs_files {
        if let Ok(txt) = std::fs::read_to_string(pf) {
            parsed = parse_prefs_js(&txt);
            chosen_prefs = Some(pf.to_string_lossy().into_owned());
            break;
        }
    }
    let mut candidates: Vec<PathBuf> = override_dir.map(str::trim).filter(|s| !s.is_empty()).map(PathBuf::from).into_iter().collect();
    candidates.extend(parsed.data_dir.iter().map(PathBuf::from));
    candidates.extend(homes.iter().map(|h| h.join("Zotero")));
    let candidate_strs: Vec<String> = candidates.iter().map(|c| c.to_string_lossy().into_owned()).collect();
    let chosen_dir = candidates.into_iter().find(|d| d.join("zotero.sqlite").is_file());
    let base_att = override_base_att.map(str::trim).filter(|s| !s.is_empty()).map(String::from).or(parsed.base_att).or_else(|| parsed.zotmoov_dst.clone());
    let bbt = chosen_dir.as_ref().and_then(|d| ["better-bibtex.sqlite", "better-bibtex-search.sqlite"].into_iter().map(|n| d.join(n)).find(|p| p.is_file()).map(|p| p.to_string_lossy().into_owned()));
    let sqlite_path = chosen_dir.as_ref().map(|d| d.join("zotero.sqlite").to_string_lossy().into_owned());
    DiscoveredZotero {
        found: chosen_dir.is_some(), data_dir: chosen_dir.map(|d| d.to_string_lossy().into_owned()), sqlite_path, prefs_path: chosen_prefs,
        base_attachment_path: base_att, zotmoov_dst_dir: parsed.zotmoov_dst, zotmoov_enable_subdir: parsed.zotmoov_sub_on, zotmoov_subdir_str: parsed.zotmoov_sub_str, better_bibtex_path: bbt, candidates: candidate_strs,
    }
}

struct SnapDir(PathBuf);
impl Drop for SnapDir { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }
struct OpenedDb { conn: Connection, _snap: Option<SnapDir>, used_snapshot: bool }

fn make_snap_dir() -> Res<SnapDir> {
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("kandinsky-zotero-{}-{stamp}-{n}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| format!("tempdir: {e}"))?;
    Ok(SnapDir(dir))
}

fn sqlite_ro_uri(path: &Path) -> String {
    let norm = path.to_string_lossy().replace('\\', "/");
    let lead = if norm.starts_with('/') { "" } else { "/" };
    let enc: String = norm.bytes().map(|b| if matches!(b, b'?' | b'#' | b'%' | b' ') { format!("%{b:02X}") } else { (b as char).to_string() }).collect();
    format!("file:{lead}{enc}?mode=ro&immutable=1")
}

fn open_readonly_or_snapshot(db_path: &Path) -> Res<OpenedDb> {
    if !db_path.is_file() { return Err(format!("{}: database file not found", db_path.display())); }
    let has_wal = PathBuf::from(format!("{}-wal", db_path.display())).metadata().is_ok_and(|m| m.len() > 0);
    if !has_wal {
        let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI | OpenFlags::SQLITE_OPEN_NO_MUTEX;
        if let Ok(conn) = Connection::open_with_flags(sqlite_ro_uri(db_path), flags) {
            if conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0)).is_ok() {
                return Ok(OpenedDb { conn, _snap: None, used_snapshot: false });
            }
        }
    }
    let snap = make_snap_dir()?;
    let dst = snap.0.join(db_path.file_name().and_then(|n| n.to_str()).unwrap_or("zotero.sqlite"));
    std::fs::copy(db_path, &dst).map_err(|e| format!("snapshot {}: {e}", db_path.display()))?;
    for ext in ["-wal", "-shm"] {
        let side = PathBuf::from(format!("{}{ext}", db_path.display()));
        if side.is_file() { let _ = std::fs::copy(&side, PathBuf::from(format!("{}{ext}", dst.display()))); }
    }
    let conn = Connection::open_with_flags(&dst, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).map_err(|e| format!("open {}: {e}", db_path.display()))?;
    let check: String = conn.query_row("PRAGMA quick_check(1)", [], |r| r.get(0)).map_err(|e| format!("corrupt sqlite {}: {e}", db_path.display()))?;
    if !check.eq_ignore_ascii_case("ok") { return Err(format!("{}: quick_check failed ({check})", db_path.display())); }
    Ok(OpenedDb { conn, _snap: Some(snap), used_snapshot: true })
}

fn qvec<T>(conn: &Connection, sql: &str, f: impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>) -> Res<Vec<T>> {
    let mut st = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = st.query_map([], f).map_err(|e| e.to_string())?;
    Ok(rows.flatten().collect())
}

fn table_cols(conn: &Connection, table: &str) -> HashSet<String> {
    qvec(conn, &format!("PRAGMA table_info({table})"), |r| r.get::<_, String>(1)).unwrap_or_default().into_iter().collect()
}

fn sanitize_citekey(raw: &str) -> String {
    raw.trim().chars().map(|c| if c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.') { c } else { '_' }).collect::<String>().trim_matches(['.', ' ', '_']).to_string()
}

fn extra_citekey(extra: &str) -> Option<String> {
    extra.lines().find_map(|l| {
        let (t, low) = (l.trim(), l.trim().to_ascii_lowercase());
        ["citation key:", "bibtex:"].into_iter().find_map(|p| Some(sanitize_citekey(t[t.len() - low.strip_prefix(p)?.len()..].split_whitespace().next()?)).filter(|c| !c.is_empty()))
    })
}

fn read_bbt_keys(data_dir: &Path) -> (HashMap<i64, String>, HashMap<String, String>) {
    let (mut by_id, mut by_key) = (HashMap::new(), HashMap::new());
    for fname in ["better-bibtex.sqlite", "better-bibtex-search.sqlite"] {
        let Ok(db) = open_readonly_or_snapshot(&data_dir.join(fname)) else { continue };
        let cols = table_cols(&db.conn, "citationkey");
        if cols.contains("itemID") && cols.contains("citationKey") {
            for (id, ck) in qvec(&db.conn, "SELECT itemID, citationKey FROM citationkey", |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))).unwrap_or_default() {
                let c = sanitize_citekey(&ck);
                if !c.is_empty() { by_id.insert(id, c); }
            }
        }
        if cols.contains("itemKey") && cols.contains("citationKey") {
            for (ik, ck) in qvec(&db.conn, "SELECT itemKey, citationKey FROM citationkey", |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))).unwrap_or_default() {
                let c = sanitize_citekey(&ck);
                if !c.is_empty() { by_key.insert(ik, c); }
            }
        }
    }
    (by_id, by_key)
}

pub fn html_to_markdown(html: &str) -> String {
    let mut s = html.replace("\r\n", "\n");
    for n in 1..=6 {
        s = s.replace(&format!("<h{n}>"), &format!("\n{} ", "#".repeat(n))).replace(&format!("</h{n}>"), "\n\n");
    }
    for (a, b) in [("<br>", "\n"), ("<br/>", "\n"), ("<br />", "\n"), ("</p>", "\n\n"), ("<p>", ""), ("<li>", "\n- "), ("</li>", ""), ("<ul>", "\n"), ("</ul>", "\n"), ("<ol>", "\n"), ("</ol>", "\n"), ("<strong>", "**"), ("</strong>", "**"), ("<b>", "**"), ("</b>", "**"), ("<em>", "*"), ("</em>", "*"), ("<i>", "*"), ("</i>", "*"), ("<code>", "`"), ("</code>", "`")] {
        s = s.replace(a, b);
    }
    while let Some(i) = s.find("<a ") {
        let Some((gt, cl)) = s[i..].find('>').zip(s[i..].find("</a>")).filter(|(g, c)| g < c) else { break };
        let href = s[i..i + gt].split("href=").nth(1).and_then(|r| r.chars().next().filter(|c| matches!(c, '"' | '\'' )).and_then(|q| r[1..].split(q).next()));
        let label = &s[i + gt + 1..i + cl];
        let rep = href.filter(|u| !u.is_empty()).map_or_else(|| label.to_string(), |u| format!("[{label}]({u})"));
        s = format!("{}{rep}{}", &s[..i], &s[i + cl + 4..]);
    }
    let (mut out, mut in_tag) = (String::with_capacity(s.len()), false);
    for ch in s.chars() {
        match ch { '<' => in_tag = true, '>' if in_tag => in_tag = false, _ if !in_tag => out.push(ch), _ => {} }
    }
    out.replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&apos;", "'").replace("&amp;", "&").lines().map(str::trim_end).collect::<Vec<_>>().join("\n").trim().to_string()
}

pub fn mark_id_for(seed: &str) -> String {
    const B36: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut n = u64::from_be_bytes(Sha256::digest(seed.as_bytes())[..8].try_into().unwrap());
    let mut chars = ['0'; 8];
    for slot in chars.iter_mut().rev() { *slot = B36[(n % 36) as usize] as char; n /= 36; }
    format!("m-{}", chars.into_iter().collect::<String>())
}

fn zotero_annotation_lines(ann_key: &str, kind_raw: &str, text: &str, comment: &str, color: &str, pos_json: &str) -> Vec<String> {
    let pos: Json = serde_json::from_str(pos_json).unwrap_or_else(|_| json!({}));
    let page = pos["pageIndex"].as_u64().unwrap_or(0) as u32 + 1;
    let rects: Vec<[f64; 4]> = pos["rects"].as_array().into_iter().flatten().filter_map(|r| {
        let a = r.as_array()?;
        Some([a.first()?.as_f64()?, a.get(1)?.as_f64()?, a.get(2)?.as_f64()?, a.get(3)?.as_f64()?])
    }).collect();
    let col = if color.trim().is_empty() { "#ffd400" } else { color.trim() };
    let id = mark_id_for(&format!("zot:{ann_key}"));
    let mut out = Vec::new();
    match kind_raw {
        "1" | "highlight" | "5" | "underline" | "7" | "strike" | "strikethrough" => {
            let k = if matches!(kind_raw, "5" | "underline") { "underline" } else if matches!(kind_raw, "7" | "strike" | "strikethrough") { "strike" } else { "highlight" };
            let mut body = json!({ "version": 1, "color": col, "quads": rects });
            if !text.trim().is_empty() { body["quote"] = json!({ "exact": text.trim() }); }
            out.push(format!("{id} {k} p{page} {body}"));
            if !comment.trim().is_empty() {
                let cid = mark_id_for(&format!("zot:comment:{ann_key}"));
                let at = rects.first().map_or([72.0, 720.0], |r| [r[0], r[3]]);
                out.push(format!("{cid} postit p{page} {}", json!({ "version": 1, "color": col, "at": at, "text": comment.trim(), "on": id })));
            }
        }
        "2" | "note" | "4" | "ink" => {
            let msg = if !comment.trim().is_empty() { comment.trim() } else { text.trim() };
            if !msg.is_empty() || matches!(kind_raw, "2" | "note") {
                let at = rects.first().map_or([72.0, 720.0], |r| [r[0], r[3]]);
                out.push(format!("{id} postit p{page} {}", json!({ "version": 1, "color": col, "at": at, "text": msg })));
            }
        }
        "6" | "text" => {
            let msg = if !comment.trim().is_empty() { comment.trim() } else { text.trim() };
            let line = match rects.first() {
                Some(&rect) => format!("{id} text-box p{page} {}", json!({ "version": 1, "color": col, "rect": rect, "text": msg, "size": 12.0 })),
                None => format!("{id} postit p{page} {}", json!({ "version": 1, "color": col, "at": [72.0, 720.0], "text": msg })),
            };
            out.push(line);
        }
        "3" | "image" => {
            let rect = rects.first().copied().unwrap_or([0.0, 0.0, 100.0, 100.0]);
            let title = if !comment.trim().is_empty() { comment.trim() } else { text.trim() };
            let mut body = json!({ "version": 1, "color": col, "rect": rect });
            if !title.is_empty() { body["title"] = json!(title); }
            out.push(format!("{id} clip p{page} {body}"));
        }
        _ => {}
    }
    out
}

pub fn import_zotero(lib: &Lib, opts: &ZoteroImportOpts) -> Res<ZoteroImportReport> {
    let disc = discover_zotero(opts.data_dir.as_deref(), opts.prefs_path.as_deref(), opts.base_attachment_path.as_deref());
    let data_dir_str = opts.data_dir.clone().or(disc.data_dir).ok_or_else(|| "Zotero data folder not found".to_string())?;
    let data_dir = PathBuf::from(&data_dir_str);
    let base_att_str = opts.base_attachment_path.clone().or(disc.base_attachment_path);
    let base_att = base_att_str.as_deref().and_then(|p| external::resolve_dir_from(&data_dir, p).or_else(|| Some(PathBuf::from(p))));
    let opened = open_readonly_or_snapshot(&data_dir.join("zotero.sqlite"))?;
    let conn = &opened.conn;
    let mut report = ZoteroImportReport { dry_run: opts.dry_run, data_dir: data_dir_str, base_attachment_path: base_att_str, used_snapshot: opened.used_snapshot, ..Default::default() };

    let deleted: HashSet<i64> = if !table_cols(conn, "deletedItems").is_empty() {
        qvec(conn, "SELECT itemID FROM deletedItems", |r| r.get::<_, i64>(0))?.into_iter().collect()
    } else { HashSet::new() };

    let raw_cols: HashMap<i64, (String, Option<i64>)> = if !table_cols(conn, "collections").is_empty() {
        qvec(conn, "SELECT collectionID, collectionName, parentCollectionID FROM collections", |r| Ok((r.get::<_, i64>(0)?, (r.get::<_, String>(1)?.trim().to_string(), r.get::<_, Option<i64>>(2)?))))?.into_iter().collect()
    } else { HashMap::new() };
    let mut col_paths: HashMap<i64, String> = HashMap::new();
    for &cid in raw_cols.keys() {
        let (mut segs, mut cur, mut seen) = (Vec::new(), Some(cid), HashSet::new());
        while let Some(id) = cur.filter(|id| seen.insert(*id)) {
            let Some((name, parent)) = raw_cols.get(&id) else { break };
            if !name.is_empty() { segs.push(name.clone()); }
            cur = *parent;
        }
        segs.reverse();
        if !segs.is_empty() { col_paths.insert(cid, segs.join("/")); }
    }
    report.collections_found = col_paths.len();

    let mut bib_items = Vec::new();
    for (iid, zkey, tname, added) in qvec(conn, "SELECT i.itemID, i.key, it.typeName, i.dateAdded FROM items i JOIN itemTypes it ON i.itemTypeID = it.itemTypeID ORDER BY i.itemID", |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, Option<String>>(3)?)))? {
        if matches!(tname.as_str(), "attachment" | "note" | "annotation") { continue; }
        if deleted.contains(&iid) { report.trash_skipped += 1; } else { bib_items.push((iid, zkey, tname, added)); }
    }
    report.total_items = bib_items.len();

    let fields_tbl = if !table_cols(conn, "fieldsCombined").is_empty() { "fieldsCombined" } else { "fields" };
    let mut item_fields: HashMap<i64, BTreeMap<String, String>> = HashMap::new();
    if !table_cols(conn, "itemData").is_empty() {
        let sql = format!("SELECT id.itemID, f.fieldName, idv.value FROM itemData id JOIN {fields_tbl} f ON id.fieldID = f.fieldID JOIN itemDataValues idv ON id.valueID = idv.valueID");
        for (iid, fname, val) in qvec(conn, &sql, |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))? {
            if !val.trim().is_empty() { item_fields.entry(iid).or_default().insert(fname, val); }
        }
    }
    let mut item_creators: HashMap<i64, BTreeMap<String, Vec<String>>> = HashMap::new();
    if !table_cols(conn, "itemCreators").is_empty() {
        let sql = "SELECT ic.itemID, ct.creatorType, c.firstName, c.lastName, c.fieldMode FROM itemCreators ic JOIN creators c ON ic.creatorID = c.creatorID JOIN creatorTypes ct ON ic.creatorTypeID = ct.creatorTypeID ORDER BY ic.itemID, ic.orderIndex";
        for (iid, role, first, last, mode) in qvec(conn, sql, |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, Option<String>>(3)?, r.get::<_, Option<i64>>(4)?)))? {
            let (f, l) = (first.unwrap_or_default(), last.unwrap_or_default());
            let name = if mode == Some(1) || f.trim().is_empty() { l.trim().to_string() } else { format!("{}, {}", l.trim(), f.trim()) };
            if !name.is_empty() { item_creators.entry(iid).or_default().entry(role).or_default().push(name); }
        }
    }
    let mut item_tags: HashMap<i64, Vec<String>> = HashMap::new();
    if !table_cols(conn, "itemTags").is_empty() {
        for (iid, tag) in qvec(conn, "SELECT it.itemID, t.name FROM itemTags it JOIN tags t ON it.tagID = t.tagID", |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))? {
            let (t, list) = (tag.trim().to_string(), item_tags.entry(iid).or_default());
            if !t.is_empty() && !list.contains(&t) { list.push(t); }
        }
    }
    let mut item_cols: HashMap<i64, Vec<String>> = HashMap::new();
    if !table_cols(conn, "collectionItems").is_empty() {
        for (cid, iid) in qvec(conn, "SELECT collectionID, itemID FROM collectionItems", |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))? {
            if let Some(p) = col_paths.get(&cid) {
                let list = item_cols.entry(iid).or_default();
                if !list.contains(p) { list.push(p.clone()); }
            }
        }
    }

    let (bbt_by_id, bbt_by_key) = read_bbt_keys(&data_dir);
    let refs_base = safe_join(lib.root, &lib.cfg.dir)?;
    let (mut assigned, mut zkey_to_ck, mut iid_to_ck) = (HashSet::new(), HashMap::new(), HashMap::new());
    for (iid, zkey, _, _) in &bib_items {
        let f = item_fields.get(iid);
        let pinned = f.and_then(|m| m.get("extra")).and_then(|e| extra_citekey(e)).or_else(|| bbt_by_id.get(iid).cloned()).or_else(|| bbt_by_key.get(zkey).cloned());
        let key = if let Some(pk) = pinned {
            if !assigned.contains(&pk) { pk } else { (2..).map(|n| format!("{pk}_{n}")).find(|k| !assigned.contains(k)).unwrap() }
        } else {
            let authors = item_creators.get(iid).and_then(|c| c.get("author")).cloned().unwrap_or_default();
            let year = f.and_then(|m| m.get("date")).and_then(|d| year_of(d));
            let title = f.and_then(|m| m.get("title")).map(String::as_str).unwrap_or("");
            citekey(&authors, year.as_deref(), title, &|k| {
                assigned.contains(k) || (refs_base.join(k).exists() && entry::read(&refs_base.join(k)).and_then(|em| em.get("zoteroKey").and_then(Value::as_str).map(|zk| zk != zkey)).unwrap_or(true))
            })
        };
        assigned.insert(key.clone());
        zkey_to_ck.insert(zkey.clone(), key.clone());
        iid_to_ck.insert(*iid, key);
    }

    let mut relations: HashMap<i64, Vec<String>> = HashMap::new();
    if !table_cols(conn, "itemRelations").is_empty() {
        for (iid, obj) in qvec(conn, "SELECT itemID, object FROM itemRelations", |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))? {
            if let Some(tck) = obj.split("/items/").nth(1).map(|s| s.split(['/', '?', '#']).next().unwrap_or(s)).and_then(|zk| zkey_to_ck.get(zk)) {
                let (link, list) = (format!("[[{tck}]]"), relations.entry(iid).or_default());
                if !list.contains(&link) { list.push(link); report.relations_linked += 1; }
            }
        }
    }

    let (mut att_to_parent, mut item_atts) = (HashMap::new(), HashMap::<i64, Vec<(String, String)>>::new());
    if !table_cols(conn, "itemAttachments").is_empty() {
        let sql = "SELECT ia.itemID, ia.parentItemID, i.key, COALESCE(ia.contentType, ''), COALESCE(ia.path, '') FROM itemAttachments ia JOIN items i ON ia.itemID = i.itemID";
        for (aid, pid, akey, ctype, path) in qvec(conn, sql, |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<i64>>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?)))? {
            if let Some(p) = pid.filter(|_| !deleted.contains(&aid)) {
                att_to_parent.insert(aid, p);
                if ctype.eq_ignore_ascii_case("application/pdf") || path.to_ascii_lowercase().ends_with(".pdf") { item_atts.entry(p).or_default().push((akey, path)); }
            }
        }
    }

    let mut item_notes: HashMap<i64, Vec<(String, String)>> = HashMap::new();
    if !table_cols(conn, "itemNotes").is_empty() {
        for (nid, pid, nkey, html) in qvec(conn, "SELECT ino.itemID, ino.parentItemID, i.key, ino.note FROM itemNotes ino JOIN items i ON ino.itemID = i.itemID", |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<i64>>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?)))? {
            if let Some(p) = pid.filter(|_| !deleted.contains(&nid)) {
                let md = html_to_markdown(&html);
                if !md.is_empty() { item_notes.entry(p).or_default().push((nkey, md)); }
            }
        }
    }

    let mut item_marks: HashMap<i64, Vec<String>> = HashMap::new();
    let ann_cols = table_cols(conn, "itemAnnotations");
    if !ann_cols.is_empty() {
        let pick = |a: &'static str, b: &'static str| -> &'static str { if ann_cols.contains(a) { a } else { b } };
        let sql = format!(
            "SELECT ann.itemID, ann.parentItemID, i.key, ann.{}, COALESCE(ann.{}, ''), COALESCE(ann.{}, ''), COALESCE(ann.{}, ''), COALESCE(ann.{}, '{{}}') FROM itemAnnotations ann JOIN items i ON ann.itemID = i.itemID",
            pick("type", "annotationType"), pick("text", "annotationText"), pick("comment", "annotationComment"), pick("color", "annotationColor"), pick("position", "annotationPosition")
        );
        for (aid, patt, akey, kraw, text, comm, col, pos) in qvec(conn, &sql, |r| {
            let ks = match r.get_ref(3)? { ValueRef::Integer(n) => n.to_string(), ValueRef::Text(b) => String::from_utf8_lossy(b).into_owned(), _ => String::new() };
            Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?, ks, r.get::<_, String>(4)?, r.get::<_, String>(5)?, r.get::<_, String>(6)?, r.get::<_, String>(7)?))
        })? {
            if !deleted.contains(&aid) {
                let bib_id = att_to_parent.get(&patt).copied().unwrap_or(patt);
                let lines = zotero_annotation_lines(&akey, &kraw, &text, &comm, &col, &pos);
                if !lines.is_empty() { report.annotations_imported += 1; item_marks.entry(bib_id).or_default().extend(lines); }
            }
        }
    }

    for (iid, zkey, tname, date_added) in bib_items {
        let key = iid_to_ck[&iid].clone();
        let entry_dir = refs_base.join(&key);
        let existed = entry::read(&entry_dir).is_some();
        let mut m = entry::read(&entry_dir).unwrap_or_default();
        m.insert("citekey".into(), key.clone().into());
        m.insert("type".into(), tname.into());
        m.insert("zoteroKey".into(), zkey.into());
        if let Some(da) = date_added.filter(|s| !s.is_empty()) { m.entry("dateAdded".into()).or_insert_with(|| da.into()); }
        for (fk, fv) in item_fields.get(&iid).into_iter().flatten() { m.insert(fk.as_str().into(), fv.as_str().into()); }
        for (role, names) in item_creators.get(&iid).into_iter().flatten() {
            m.insert(role.as_str().into(), Value::Sequence(names.iter().map(|s| Value::from(s.as_str())).collect()));
        }
        for (prop, src) in [("tags", item_tags.get(&iid)), ("collections", item_cols.get(&iid)), ("related", relations.get(&iid))] {
            if let Some(vals) = src { m.insert(prop.into(), Value::Sequence(vals.iter().map(|s| Value::from(s.as_str())).collect())); }
        }

        let mut files: Vec<String> = m.get("files").and_then(Value::as_sequence).map(|s| s.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default();
        let existing_external: Vec<String> = ["pdf", "external_pdf"].into_iter().filter_map(|k| m.get(k).and_then(Value::as_str).map(String::from)).collect();
        let add_file = |files: &mut Vec<String>, r: String| { if !files.contains(&r) && !existing_external.contains(&r) { files.push(r); } };
        for (akey, raw_path) in item_atts.remove(&iid).unwrap_or_default() {
            let norm = raw_path.trim().replace('\\', "/");
            let resolved: Option<(PathBuf, bool)> = if let Some(rel) = norm.strip_prefix("attachments:") {
                base_att.as_ref().and_then(|b| safe_join(b, rel.trim_start_matches('/')).ok()).map(|p| (p, true))
            } else if let Some(fname) = norm.strip_prefix("storage:") {
                safe_join(&data_dir.join("storage").join(&akey), fname.rsplit('/').next().unwrap_or(fname)).ok().map(|p| (p, false))
            } else if !norm.is_empty() && (Path::new(&raw_path).is_absolute() || Path::new(&norm).is_absolute()) {
                Some((PathBuf::from(&raw_path), true))
            } else { None };
            let Some((src_path, prefer_in_place)) = resolved else { continue };
            if !src_path.is_file() { report.missing_pdfs.push(raw_path); continue; }
            let real_src = real(&src_path).unwrap_or(src_path);
            if prefer_in_place {
                if let Some((portable, _)) = path_in_external_roots(lib.root, lib.cfg, &real_src).or_else(|| rel_path(lib.root, &real_src).map(|r| (r, real_src.clone()))) {
                    add_file(&mut files, portable);
                    report.linked_in_place += 1;
                    continue;
                }
            }
            if opts.copy_storage_pdfs {
                if !opts.dry_run {
                    let bytes = std::fs::read(&real_src).map_err(|e| format!("{}: {e}", real_src.display()))?;
                    if !lib.cfg.external_pdf_roots.is_empty() && lib.cfg.store_in_external {
                        let (portable, _) = write_external_pdf(lib.root, lib.cfg, None, &format_pdf_filename(&lib.cfg.rename_format, &m, &key), &bytes)?;
                        add_file(&mut files, portable);
                    } else {
                        std::fs::create_dir_all(&entry_dir).map_err(|e| format!("{}: {e}", entry_dir.display()))?;
                        let clean = sanitize_pdf_filename(real_src.file_name().and_then(|n| n.to_str()).unwrap_or("paper.pdf"), &key);
                        kandinsky_plugin::write_file(entry_dir.join(&clean), &bytes).map_err(|e| e.to_string())?;
                        add_file(&mut files, clean);
                    }
                }
                report.copied_pdfs += 1;
            }
        }
        if !files.is_empty() { m.insert("files".into(), Value::Sequence(files.into_iter().map(Value::from).collect())); }

        let notes_for = item_notes.remove(&iid).unwrap_or_default();
        report.notes_imported += notes_for.len();
        let marks_for = item_marks.remove(&iid).unwrap_or_default();
        if !opts.dry_run {
            std::fs::create_dir_all(&entry_dir).map_err(|e| format!("{}: {e}", entry_dir.display()))?;
            entry::write(lib.made, &entry_dir, &m)?;
            for (nkey, md) in &notes_for { entry::upsert_zotero_note(&entry_dir, nkey, md)?; }
            if !marks_for.is_empty() {
                let note_path = entry_dir.join(entry::note_file(&key));
                let cur = std::fs::read_to_string(&note_path).map_err(|e| format!("{}: {e}", note_path.display()))?;
                let merged = entry::merge_pdf_marks(&cur, &marks_for);
                if merged != cur { kandinsky_plugin::write_file(&note_path, merged.as_bytes()).map_err(|e| e.to_string())?; }
            }
        }
        if existed { report.updated += 1 } else { report.imported += 1 }
        report.citekeys.push(key);
    }
    if !opts.dry_run && (report.imported > 0 || report.updated > 0) { lib.write_bib()?; }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::refs::tests::Vault;

    #[test]
    fn imports_zotero_losslessly_with_zero_copy_links_bbt_relations_notes_and_marks() {
        let (mut v, ws) = (Vault::new(), tempfile::tempdir().unwrap());
        let ws_real = real(ws.path()).unwrap();
        let (vault_dir, pool_dir, zot_dir, prof_dir) = (ws_real.join("vault"), ws_real.join("Papers"), ws_real.join("ZoteroData"), ws_real.join("Profile/abc.default"));
        for d in [&vault_dir, &pool_dir.join("Quantum"), &zot_dir.join("storage/ATTKEY02"), &prof_dir] { std::fs::create_dir_all(d).unwrap(); }
        v.root = vault_dir;
        v.trash = crate::refs::tests::TempTrash(v.root.clone());
        v.cfg.external_pdf_roots = vec!["../Papers".into()];
        std::fs::write(pool_dir.join("Quantum/Anderson1972.pdf"), b"%PDF-1.4 linked-in-place").unwrap();
        std::fs::write(zot_dir.join("storage/ATTKEY02/stored.pdf"), b"%PDF-1.4 from-storage").unwrap();

        let prefs_path = prof_dir.join("prefs.js");
        std::fs::write(&prefs_path, format!(
            "user_pref(\"extensions.zotero.dataDir\", \"{}\");\nuser_pref(\"extensions.zotero.baseAttachmentPath\", \"{}\");\n",
            zot_dir.to_string_lossy().replace('\\', "\\\\"), pool_dir.to_string_lossy().replace('\\', "\\\\")
        )).unwrap();

        let zconn = Connection::open(zot_dir.join("zotero.sqlite")).unwrap();
        zconn.execute_batch(
            "CREATE TABLE itemTypes(itemTypeID INT PRIMARY KEY, typeName TEXT); INSERT INTO itemTypes VALUES(1,'journalArticle'),(2,'attachment'),(3,'note'),(4,'annotation');
             CREATE TABLE items(itemID INT PRIMARY KEY, itemTypeID INT, key TEXT, dateAdded TEXT);
             INSERT INTO items VALUES(10,1,'ZITEM001','2026-01-01'),(11,1,'ZITEM002','2026-01-02'),(12,1,'ZTRASH99','2026-01-03'),(20,2,'ATTKEY01','2026-01-01'),(21,2,'ATTKEY02','2026-01-02'),(30,3,'NOTEKY01','2026-01-01'),(40,4,'ANNKEY01','2026-01-01'),(41,4,'ANNKEY02','2026-01-01');
             CREATE TABLE deletedItems(itemID INT PRIMARY KEY); INSERT INTO deletedItems VALUES(12);
             CREATE TABLE fields(fieldID INT PRIMARY KEY, fieldName TEXT); INSERT INTO fields VALUES(1,'title'),(2,'date'),(3,'DOI'),(4,'extra'),(5,'publicationTitle');
             CREATE TABLE itemDataValues(valueID INT PRIMARY KEY, value TEXT); INSERT INTO itemDataValues VALUES(1,'More Is Different'),(2,'1972-08-04'),(3,'10.1126/science.177.4047.393'),(4,'Citation Key: anderson1972pinned'),(5,'Science'),(6,'Topological Quantum Computation'),(7,'2003');
             CREATE TABLE itemData(itemID INT, fieldID INT, valueID INT); INSERT INTO itemData VALUES(10,1,1),(10,2,2),(10,3,3),(10,4,4),(10,5,5),(11,1,6),(11,2,7);
             CREATE TABLE creatorTypes(creatorTypeID INT PRIMARY KEY, creatorType TEXT); INSERT INTO creatorTypes VALUES(1,'author');
             CREATE TABLE creators(creatorID INT PRIMARY KEY, firstName TEXT, lastName TEXT, fieldMode INT); INSERT INTO creators VALUES(1,'P. W.','Anderson',0),(2,'A.','Kitaev',0);
             CREATE TABLE itemCreators(itemID INT, creatorID INT, creatorTypeID INT, orderIndex INT); INSERT INTO itemCreators VALUES(10,1,1,0),(11,2,1,0);
             CREATE TABLE tags(tagID INT PRIMARY KEY, name TEXT); INSERT INTO tags VALUES(1,'emergence');
             CREATE TABLE itemTags(itemID INT, tagID INT); INSERT INTO itemTags VALUES(10,1);
             CREATE TABLE collections(collectionID INT PRIMARY KEY, collectionName TEXT, parentCollectionID INT); INSERT INTO collections VALUES(1,'Physics',NULL),(2,'Condensed Matter',1);
             CREATE TABLE collectionItems(collectionID INT, itemID INT); INSERT INTO collectionItems VALUES(2,10);
             CREATE TABLE itemRelations(itemID INT, object TEXT); INSERT INTO itemRelations VALUES(10,'http://zotero.org/users/local/alice/items/ZITEM002');
             CREATE TABLE itemAttachments(itemID INT PRIMARY KEY, parentItemID INT, contentType TEXT, path TEXT);
             INSERT INTO itemAttachments VALUES(20,10,'application/pdf','attachments:Quantum\\Anderson1972.pdf'),(21,11,'application/pdf','storage:stored.pdf');
             CREATE TABLE itemNotes(itemID INT PRIMARY KEY, parentItemID INT, note TEXT); INSERT INTO itemNotes VALUES(30,10,'<h2>Summary</h2><p>Broken <strong>symmetry</strong> &amp; scale.</p>');
             CREATE TABLE itemAnnotations(itemID INT PRIMARY KEY, parentItemID INT, type INT, text TEXT, comment TEXT, color TEXT, position TEXT);
             INSERT INTO itemAnnotations VALUES(40,20,1,'broken symmetry','Key insight','#ffd400','{\"pageIndex\":0,\"rects\":[[72.0,500.0,220.0,514.0]]}'),(41,20,3,'','Phase diagram','#2ea8e5','{\"pageIndex\":2,\"rects\":[[100.0,200.0,300.0,400.0]]}');",
        ).unwrap();
        drop(zconn);

        let bbt = Connection::open(zot_dir.join("better-bibtex.sqlite")).unwrap();
        bbt.execute_batch("CREATE TABLE citationkey(itemID INT, itemKey TEXT, citationKey TEXT); INSERT INTO citationkey VALUES(11,'ZITEM002','kitaev2003bbt');").unwrap();
        drop(bbt);

        let disc = discover_zotero(None, Some(prefs_path.to_str().unwrap()), None);
        assert!(disc.found && disc.better_bibtex_path.is_some());
        let dry: ZoteroImportOpts = serde_json::from_value(json!({ "prefs_path": prefs_path.to_str().unwrap() })).unwrap();
        let r_dry = import_zotero(&v.lib(), &dry).unwrap();
        assert_eq!((dry.dry_run, r_dry.imported, r_dry.trash_skipped, r_dry.linked_in_place, r_dry.copied_pdfs), (true, 2, 1, 1, 1));
        assert!(!v.root.join("refs/papers/anderson1972pinned").exists());

        let apply: ZoteroImportOpts = serde_json::from_value(json!({ "prefs_path": prefs_path.to_str().unwrap(), "apply": true })).unwrap();
        let r = import_zotero(&v.lib(), &apply).unwrap();
        assert!(!r.dry_run && r.imported == 2 && r.linked_in_place == 1 && r.copied_pdfs == 1);
        assert!(!v.root.join("refs/papers/anderson1972pinned/Anderson1972.pdf").exists());
        let papers = v.lib().list().unwrap();
        let anderson = papers.iter().find(|p| p.key == "anderson1972pinned").unwrap();
        assert_eq!((anderson.pdf.as_deref(), anderson.collections.clone()), (Some("../Papers/Quantum/Anderson1972.pdf"), vec!["Physics/Condensed Matter".to_string()]));

        let note = std::fs::read_to_string(v.root.join("refs/papers/anderson1972pinned/anderson1972pinned.md")).unwrap();
        assert!(note.contains("[[kitaev2003bbt]]") && note.contains("<!-- zotero:note NOTEKY01 -->") && note.contains("Broken **symmetry** & scale."));
        assert!(note.contains("```pdf-marks") && note.contains("highlight p1") && note.contains("postit p1") && note.contains("clip p3"));

        let r2 = import_zotero(&v.lib(), &apply).unwrap();
        assert_eq!((r2.imported, r2.updated, entry::split_pdf_marks(&std::fs::read_to_string(v.root.join("refs/papers/anderson1972pinned/anderson1972pinned.md")).unwrap()).1.len()), (0, 2, 3));
    }
}
