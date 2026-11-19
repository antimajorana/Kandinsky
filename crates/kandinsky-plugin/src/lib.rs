//! Kandinsky from a plugin's compiled helper (docs/guides/PLUGIN-API.md, "Calling Kandinsky back") — the twin of a JavaScript
//! helper's `kandinsky.*` (crates/kandinsky-core/sdk/js/prelude.js). A helper talks to the core over its own pipe: requests in on
//! stdin, answers out on stdout, and its calls back the same way (`{"call": n, "verb", "path", "body"}` out,
//! `{"reply": n, "status", "body"}` in); the core runs each through the vault's API in-process
//! (crates/kandinsky-core/src/helper_api.rs). No socket, no port, no key — and only std and serde_json, so a helper built
//! static (x86_64-unknown-linux-musl) runs on the desktop and in the server's container alike.
//!
//! ```no_run
//! use kandinsky_plugin::{serve, Kandinsky, Methods};
//! use serde_json::json;
//!
//! let mut m = Methods::new();
//! m.add("count_notes", |_params| {
//!     let n = Kandinsky::new().files(true)?.iter().filter(|p| p.ends_with(".md")).count();
//!     Ok(json!({ "notes": n }))
//! });
//! serve(m); // until Kandinsky closes stdin
//! ```
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::io::{BufRead, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Condvar, Mutex};

/// Why a call did not give an answer: the core's own reason, or why it could not be reached.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error {
    /// the HTTP status the core answered with (none: no answer at all)
    pub status: Option<u16>,
    pub why: String,
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.why)
    }
}

impl std::error::Error for Error {}

pub type Result<T> = std::result::Result<T, Error>;

fn fail<T>(why: impl Into<String>) -> Result<T> {
    Err(Error { status: None, why: why.into() })
}

/// The HTTP verbs the API uses: a closed set, so a typo is a compile error.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verb {
    Get,
    Post,
    Put,
    Delete,
}

impl Verb {
    fn as_str(self) -> &'static str {
        match self {
            Verb::Get => "GET",
            Verb::Post => "POST",
            Verb::Put => "PUT",
            Verb::Delete => "DELETE",
        }
    }
}

/// The core serving this plugin's vault, reached over the helper's pipe. Cheap to make: it holds only the plugin's id.
#[derive(Debug, Clone, Default)]
pub struct Kandinsky {
    plugin: Option<String>,
}

static NEXT: AtomicU64 = AtomicU64::new(0);
/// The helper's stdin, shared by [`serve`] and every thread that calls the core.
static PIPE: Pipe = Pipe::new();

/// What a thread waits for on stdin: the core's next request ([`serve`]) or the reply to its own call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Want {
    Request,
    Reply(u64),
}

/// Lines read but not yet taken: requests in order, replies by call number.
#[derive(Default)]
struct Inbox {
    requests: VecDeque<String>,
    replies: BTreeMap<u64, String>,
    /// a thread is blocked reading stdin; the others wait for what it files
    reading: bool,
    closed: bool,
}

impl Inbox {
    fn take(&mut self, want: Want) -> Option<String> {
        match want {
            Want::Request => self.requests.pop_front(),
            Want::Reply(n) => self.replies.remove(&n),
        }
    }

    /// A reply goes to its caller; anything else is a request for [`serve`] (which also says what is not JSON).
    fn file(&mut self, line: String) {
        match serde_json::from_str::<Value>(&line).ok().and_then(|m| m.get("reply").and_then(Value::as_u64)) {
            Some(n) => drop(self.replies.insert(n, line)),
            None => self.requests.push_back(line),
        }
    }
}

/// One reader at a time: a thread whose line has not come reads stdin itself when nobody does, files what it read
/// and wakes the others — so a helper may call the core from several threads (a listener beside [`serve`]).
struct Pipe {
    inbox: Mutex<Inbox>,
    arrived: Condvar,
}

impl Pipe {
    const fn new() -> Pipe {
        Pipe {
            inbox: Mutex::new(Inbox { requests: VecDeque::new(), replies: BTreeMap::new(), reading: false, closed: false }),
            arrived: Condvar::new(),
        }
    }

    /// The line `want`ed, read with `read` (one line; None at the end); None once the pipe is closed.
    fn next(&self, want: Want, read: &dyn Fn() -> Option<String>) -> Option<String> {
        let mut inbox = self.inbox.lock().unwrap_or_else(|e| e.into_inner());
        loop {
            if let Some(line) = inbox.take(want) {
                return Some(line);
            }
            if inbox.closed {
                return None;
            }
            if inbox.reading {
                inbox = self.arrived.wait(inbox).unwrap_or_else(|e| e.into_inner());
                continue;
            }
            inbox.reading = true;
            drop(inbox);
            let line = read();
            inbox = self.inbox.lock().unwrap_or_else(|e| e.into_inner());
            inbox.reading = false;
            match line {
                Some(l) => inbox.file(l),
                None => inbox.closed = true,
            }
            self.arrived.notify_all();
        }
    }
}

fn stdin_line() -> Option<String> {
    let mut l = String::new();
    (std::io::stdin().lock().read_line(&mut l).unwrap_or(0) > 0).then_some(l)
}

impl Kandinsky {
    pub fn new() -> Kandinsky {
        Kandinsky { plugin: env_var("PLUGIN_ID").filter(|k| !k.is_empty()) }
    }

    /// One call to the API: `path` as the pages use it (`/api/file?path=…`); the JSON answer (`Null` when empty).
    pub fn call(&self, verb: Verb, path: &str, body: Option<&Value>) -> Result<Value> {
        self.exchange(verb, path, ("body", json!(body)))
    }

    /// A call whose body is a file's bytes (`PUT /api/raw`), base64 on the pipe.
    fn call_bytes(&self, verb: Verb, path: &str, bytes: &[u8]) -> Result<Value> {
        self.exchange(verb, path, ("bytes", Value::String(base64(bytes))))
    }

    fn exchange(&self, verb: Verb, path: &str, (key, body): (&str, Value)) -> Result<Value> {
        let n = NEXT.fetch_add(1, Ordering::Relaxed) + 1;
        let mut msg = json!({ "call": n, "verb": verb.as_str(), "path": path });
        msg[key] = body;
        send(&msg);
        // the core's requests read meanwhile are kept for `serve`
        let Some(line) = PIPE.next(Want::Reply(n), &stdin_line) else { return fail("Kandinsky closed the pipe") };
        let msg: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
        let status = msg.get("status").and_then(Value::as_u64).unwrap_or(500) as u16;
        // an answer that is not text (a picture) comes as base64 `bytes`: handed on as `{"bytes": "<base64>"}`
        let value = match msg.get("bytes") {
            Some(b) => json!({ "bytes": b }),
            None => msg.get("body").cloned().unwrap_or(Value::Null),
        };
        if !(200..300).contains(&status) {
            let why = value.get("error").and_then(Value::as_str).map_or_else(|| value.to_string(), str::to_string);
            return Err(Error { status: Some(status), why: format!("{} {path}: {why}", verb.as_str()) });
        }
        Ok(value)
    }

    pub fn get(&self, path: &str) -> Result<Value> {
        self.call(Verb::Get, path, None)
    }

    /// A call answered with bytes (`/api/thumb`, `/api/raw`): the bytes; a JSON or text answer is not bytes.
    pub fn get_bytes(&self, path: &str) -> Result<Vec<u8>> {
        let v = self.get(path)?;
        match v.get("bytes").and_then(Value::as_str).and_then(unbase64) {
            Some(b) => Ok(b),
            None => fail(format!("GET {path}: answered no bytes")),
        }
    }

    pub fn post(&self, path: &str, body: &Value) -> Result<Value> {
        self.call(Verb::Post, path, Some(body))
    }

    pub fn put(&self, path: &str, body: &Value) -> Result<Value> {
        self.call(Verb::Put, path, Some(body))
    }

    // ---- files and notes ----------------------------------------------------------------------------------------

    /// A text file of the vault (a path from its top).
    pub fn read(&self, path: &str) -> Result<String> {
        let v = self.get(&format!("/api/file?path={}", q(path)))?;
        Ok(v["text"].as_str().unwrap_or_default().to_string())
    }

    /// Writes a text file of the vault (made with its folders when new); the open tabs follow.
    pub fn write(&self, path: &str, text: &str) -> Result<()> {
        self.put("/api/file", &json!({ "path": path, "text": text })).map(drop)
    }

    /// Writes any file of the vault as its bytes (a PDF, an attachment, a picture), made with its folders when new.
    pub fn write_bytes(&self, path: &str, bytes: &[u8]) -> Result<()> {
        self.call_bytes(Verb::Put, &format!("/api/raw?path={}", q(path)), bytes).map(drop)
    }

    /// Every file's path; `index`: only what search indexes.
    pub fn files(&self, index: bool) -> Result<Vec<String>> {
        let v = self.get(if index { "/api/files?index=true" } else { "/api/files" })?;
        Ok(v.as_array().map(|a| a.iter().filter_map(|p| p.as_str().map(str::to_string)).collect()).unwrap_or_default())
    }

    /// One folder's entries (`{name, path, kind: "dir" | "file", …}`).
    pub fn tree(&self, folder: &str) -> Result<Value> {
        self.get(&format!("/api/tree?path={}", q(folder)))
    }

    /// Full-text search: `{"files": […], "lines": [{path, line, text}]}`.
    pub fn search(&self, query: &str) -> Result<Value> {
        self.get(&format!("/api/search?q={}", q(query)))
    }

    /// A capture, as the capture box makes it (`[] …` a to-do, `@tomorrow` a date).
    pub fn capture(&self, text: &str) -> Result<Value> {
        self.post("/api/capture", &json!({ "text": text }))
    }

    // ---- this plugin's secrets (outside the vault; a program reads only its own plugin's) -----------------------

    fn secret_path(&self, name: &str) -> Result<String> {
        let Some(id) = &self.plugin else { return fail("KANDINSKY_PLUGIN_ID is not set: this program was not started by Kandinsky") };
        Ok(format!("/api/plugins/{}/secrets/{}", q(id), q(name)))
    }

    /// This plugin's secret `name` (None: not set).
    pub fn secret(&self, name: &str) -> Result<Option<String>> {
        Ok(self.get(&self.secret_path(name)?)?["value"].as_str().map(str::to_string))
    }

    pub fn set_secret(&self, name: &str, value: &str) -> Result<()> {
        self.put(&self.secret_path(name)?, &json!({ "value": value })).map(drop)
    }
}

// ---- writing the vault's files (PLUGIN-MATURITY.md, criterion 11) ----------------------------------------------

fn strip_verbatim(p: &std::path::Path) -> std::path::PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        std::path::PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        std::path::PathBuf::from(rest)
    } else {
        p.to_path_buf()
    }
}

/// `path` from the vault's top when a helper Kandinsky started writes it: inside KANDINSKY_ROOT and not a cache. Through Kandinsky
/// the search index, the mirror and the open tabs follow; anything else (a test, a run by hand, a cache) is written
/// straight to the disk.
fn through_kandinsky(path: &std::path::Path) -> Option<String> {
    env_var("PLUGIN_ID").filter(|id| !id.is_empty())?;
    let root = strip_verbatim(&std::path::PathBuf::from(env_var_os("ROOT")?));
    let clean = strip_verbatim(path);
    let rel = clean
        .strip_prefix(&root)
        .ok()
        .map(std::path::Path::to_path_buf)
        .or_else(|| {
            let root_real = root.canonicalize().ok().map(|p| strip_verbatim(&p))?;
            let anc = clean.ancestors().find(|a| a.exists())?;
            let anc_real = anc.canonicalize().ok().map(|p| strip_verbatim(&p))?;
            let full = anc_real.join(clean.strip_prefix(anc).ok()?);
            full.strip_prefix(&root_real).ok().map(std::path::Path::to_path_buf)
        })?;
    let rel = rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/");
    (!rel.is_empty() && !STATE_DIRS.iter().any(|d| rel.starts_with(&format!("{d}/cache/")))).then_some(rel)
}

/// A vault's state folder, current name first, then the one from before the rename (Kandinsky is based on Atlas).
const STATE_DIRS: [&str; 2] = [".kandinsky", ".atlas"];

/// The vault's state folder under `root`: `.kandinsky`, or `.atlas` in a vault the core has not migrated (it renames
/// the folder when it opens the vault, and keeps `.atlas` when it cannot); a program never makes a second one beside it.
pub fn state_dir(root: &std::path::Path) -> std::path::PathBuf {
    let [new, old] = STATE_DIRS;
    if root.join(new).symlink_metadata().is_err() && root.join(old).symlink_metadata().is_ok() {
        root.join(old)
    } else {
        root.join(new)
    }
}

/// `rel` (a vault path) with a leading state folder in either spelling turned into the one `root` has ([`state_dir`]):
/// what a path the page or another plugin wrote as `.kandinsky/…` names on disk in a vault not migrated yet.
pub fn live_rel(root: &std::path::Path, rel: &str) -> String {
    let live = state_dir(root);
    let live = live.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    match split_state(rel) {
        Some(rest) => format!("{live}{rest}"),
        None => rel.to_string(),
    }
}

/// `rel` with a leading state folder in either spelling written as `.kandinsky`: for comparing paths.
pub fn current_rel(rel: &str) -> String {
    match split_state(rel) {
        Some(rest) => format!("{}{rest}", STATE_DIRS[0]),
        None => rel.to_string(),
    }
}

/// The rest of `rel` after a leading state folder (either spelling), from its `/` on.
fn split_state(rel: &str) -> Option<&str> {
    let rel = rel.trim_start_matches("./");
    let end = rel.find(['/', '\\']).unwrap_or(rel.len());
    STATE_DIRS.iter().any(|n| rel[..end].eq_ignore_ascii_case(n)).then(|| &rel[end..])
}

/// `KANDINSKY_<name>`, else the name from before the rename (`ATLAS_<name>`), as the core sets both.
pub fn env_var_os(name: &str) -> Option<std::ffi::OsString> {
    std::env::var_os(format!("KANDINSKY_{name}")).or_else(|| std::env::var_os(format!("ATLAS_{name}")))
}

/// [`env_var_os`] as text.
pub fn env_var(name: &str) -> Option<String> {
    env_var_os(name).and_then(|v| v.into_string().ok())
}

/// Writes a file of the vault (an absolute path; its folders made when new), through Kandinsky when Kandinsky started this
/// program — and straight to the disk when Kandinsky answers that it is not serving the vault (`kandinsky mcp`).
pub fn write_file(path: impl AsRef<std::path::Path>, bytes: &[u8]) -> Result<()> {
    let path = path.as_ref();
    if let Some(rel) = through_kandinsky(path) {
        let call = match std::str::from_utf8(bytes) {
            Ok(text) if [".md", ".base", ".page", ".bib"].iter().any(|ext| rel.ends_with(ext)) => Kandinsky::new().write(&rel, text),
            _ => Kandinsky::new().write_bytes(&rel, bytes),
        };
        match call {
            Err(e) if e.status == Some(503) => {}
            done => return done,
        }
    }
    let io = |e: std::io::Error| error(format!("cannot write {}: {e}", path.display()));
    let dir = path.parent().ok_or_else(|| error(format!("cannot write {}: no folder", path.display())))?;
    std::fs::create_dir_all(dir).map_err(io)?;
    // beside it, then renamed over it: a note is never left half written (a crash, a full disk), as the core writes
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    // named as the core names its own (`.<name>.kandinsky-tmp-<pid>-<nanos>`), which the watcher passes over
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos());
    let tmp = dir.join(format!(".{name}.kandinsky-tmp-{}-{nanos}", std::process::id()));
    std::fs::write(&tmp, bytes).and_then(|()| std::fs::rename(&tmp, path)).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        io(e)
    })
}

/// Moves a file or folder of the vault (absolute paths), through Kandinsky as [`write_file`] does: the links to it follow.
pub fn move_path(from: impl AsRef<std::path::Path>, to: impl AsRef<std::path::Path>) -> Result<()> {
    let (from, to) = (from.as_ref(), to.as_ref());
    if let (Some(a), Some(b)) = (through_kandinsky(from), through_kandinsky(to)) {
        match Kandinsky::new().post("/api/fs/move", &json!({ "from": a, "to": b })) {
            Err(e) if e.status == Some(503) => {}
            done => return done.map(drop),
        }
    }
    let io = |e: std::io::Error| error(format!("cannot move {}: {e}", from.display()));
    if let Some(dir) = to.parent() {
        std::fs::create_dir_all(dir).map_err(io)?;
    }
    std::fs::rename(from, to).map_err(io)
}

/// Standard base64 with padding (the pipe is JSON lines).
fn base64(b: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(b.len().div_ceil(3) * 4);
    for c in b.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            out.push(if i <= c.len() { A[(n >> (18 - 6 * i) & 63) as usize] as char } else { '=' });
        }
    }
    out
}

/// Standard base64 back to bytes; None when it is not base64.
fn unbase64(s: &str) -> Option<Vec<u8>> {
    let val = |c: u8| match c {
        b'A'..=b'Z' => Some(c - b'A'),
        b'a'..=b'z' => Some(c - b'a' + 26),
        b'0'..=b'9' => Some(c - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    };
    let s = s.trim_end_matches('=').as_bytes();
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    for c in s.chunks(4) {
        let mut n = 0u32;
        for (i, &b) in c.iter().enumerate() {
            n |= u32::from(val(b)?) << (18 - 6 * i);
        }
        out.extend_from_slice(&n.to_be_bytes()[1..c.len()]);
    }
    Some(out)
}

/// Percent-encodes a query or path part.
pub fn q(s: &str) -> String {
    s.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-._~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

// ---- the helper's side of the protocol --------------------------------------------------------------------------

type Method = Box<dyn FnMut(Value) -> Result<Value>>;

/// A helper's methods by name, for [`serve`].
#[derive(Default)]
pub struct Methods(HashMap<String, Method>);

impl Methods {
    pub fn new() -> Self {
        Self::default()
    }

    /// `f(params)` answers the method `name` (a tool's arguments arrive with `settings` and `secrets` beside them).
    pub fn add(&mut self, name: &str, f: impl FnMut(Value) -> Result<Value> + 'static) -> &mut Self {
        self.0.insert(name.to_string(), Box::new(f));
        self
    }
}

/// An event for the page's `kandinsky.helper.on(name, …)`.
pub fn event(name: &str, data: Value) {
    send(&json!({ "event": name, "data": data }));
}

fn send(v: &Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{v}");
    let _ = out.flush();
}

/// The helper's loop: one request per line on stdin, its answer on stdout, until stdin closes.
pub fn serve(mut methods: Methods) {
    // until Kandinsky closes stdin
    while let Some(line) = PIPE.next(Want::Request, &stdin_line) {
        if let Some(answer) = answer(&mut methods, line.trim()) {
            send(&answer);
        }
    }
}

/// The answer to one line (None: an empty line). Kept apart from the loop so it can be tested.
fn answer(methods: &mut Methods, line: &str) -> Option<Value> {
    let (id, name, params) = request(line)?;
    let outcome = methods.0.get_mut(&name).map(|f| f(params));
    Some(reply(id, &name, outcome, || methods.0.keys().cloned().collect()))
}

/// A request line's id, method and params (None: empty, or not JSON — said on stderr).
fn request(line: &str) -> Option<(Value, String, Value)> {
    if line.is_empty() {
        return None;
    }
    let Ok(req) = serde_json::from_str::<Value>(line) else {
        eprintln!("kandinsky-plugin: not JSON: {}", line.chars().take(200).collect::<String>());
        return None;
    };
    let id = req.get("id").cloned().unwrap_or(Value::Null);
    let name = req.get("method").and_then(Value::as_str).unwrap_or_default().to_string();
    Some((id, name, req.get("params").cloned().unwrap_or_else(|| json!({}))))
}

/// The answer line: the result, the method's reason, or (no such method) the ones there are.
fn reply(id: Value, name: &str, outcome: Option<Result<Value>>, names: impl FnOnce() -> Vec<String>) -> Value {
    match outcome {
        None => {
            let mut has = names();
            has.sort_unstable();
            json!({ "id": id, "error": format!("no method {name:?} (has: {})", if has.is_empty() { "none".into() } else { has.join(", ") }) })
        }
        Some(Ok(result)) => json!({ "id": id, "result": result }),
        Some(Err(e)) => json!({ "id": id, "error": e.why }),
    }
}

type SharedMethod = std::sync::Arc<dyn Fn(Value) -> Result<Value> + Send + Sync>;

/// A helper's methods for [`serve_threads`]: each may run beside the others, so they share their state themselves.
#[derive(Default, Clone)]
pub struct SharedMethods(HashMap<String, SharedMethod>);

impl SharedMethods {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add(&mut self, name: &str, f: impl Fn(Value) -> Result<Value> + Send + Sync + 'static) -> &mut Self {
        self.0.insert(name.to_string(), std::sync::Arc::new(f));
        self
    }
}

/// [`serve`], each request answered in a thread of its own: a long call (a command on a host) holds up no other, and a
/// call may wait for another one (the page saying a tab it was asked for is open).
pub fn serve_threads(methods: SharedMethods) {
    let methods = std::sync::Arc::new(methods);
    while let Some(line) = PIPE.next(Want::Request, &stdin_line) {
        let Some((id, name, params)) = request(line.trim()) else { continue };
        let m = methods.clone();
        std::thread::spawn(move || {
            let outcome = m.0.get(&name).map(|f| f(params));
            send(&reply(id, &name, outcome, || m.0.keys().cloned().collect()));
        });
    }
}

/// A failure with this reason, for a method's answer.
pub fn error(why: impl Into<String>) -> Error {
    Error { status: None, why: why.into() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn without_kandinsky_a_file_is_written_to_the_disk_with_its_folders() {
        // no KANDINSKY_PLUGIN_ID in a test: the disk, as in a run by hand
        let d = std::env::temp_dir().join(format!("kandinsky-plugin-test-{}", std::process::id()));
        write_file(d.join("a/b/x.md"), b"hi").unwrap();
        assert_eq!(std::fs::read(d.join("a/b/x.md")).unwrap(), b"hi");
        move_path(d.join("a/b"), d.join("c/b")).unwrap();
        assert!(d.join("c/b/x.md").is_file());
        assert_eq!(through_kandinsky(&d.join("c/b/x.md")), None);
        std::fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn the_state_folder_is_the_one_the_vault_has() {
        let d = std::env::temp_dir().join(format!("kandinsky-plugin-state-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        assert_eq!(state_dir(&d), d.join(".kandinsky"), "neither: the current name, and nothing is made");
        assert!(!d.join(".kandinsky").exists());
        std::fs::create_dir(d.join(".atlas")).unwrap();
        assert_eq!(state_dir(&d), d.join(".atlas"), "a vault the core has not migrated");
        std::fs::create_dir(d.join(".kandinsky")).unwrap();
        assert_eq!(state_dir(&d), d.join(".kandinsky"), "both: the current one");
        std::fs::remove_dir(d.join(".kandinsky")).unwrap();
        assert_eq!(live_rel(&d, ".kandinsky/trash/x"), ".atlas/trash/x", "the folder the vault has");
        assert_eq!(live_rel(&d, "notes/.kandinsky/x"), "notes/.kandinsky/x");
        assert_eq!(current_rel(".atlas/cache/plugins/oa/k.pdf"), ".kandinsky/cache/plugins/oa/k.pdf");
        assert_eq!(current_rel(".atlasx/y"), ".atlasx/y");
        std::fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn an_environment_variable_is_read_under_either_name() {
        // names no other test sets: the environment is the process's
        std::env::set_var("ATLAS_SDK_TEST_ONLY_OLD", "old");
        assert_eq!(env_var("SDK_TEST_ONLY_OLD").as_deref(), Some("old"));
        std::env::set_var("KANDINSKY_SDK_TEST_BOTH", "new");
        std::env::set_var("ATLAS_SDK_TEST_BOTH", "old");
        assert_eq!(env_var("SDK_TEST_BOTH").as_deref(), Some("new"));
        assert_eq!(env_var_os("SDK_TEST_NEITHER"), None);
    }

    #[test]
    fn base64_back_to_bytes() {
        for b in [&b""[..], b"a", b"ab", b"abc", b"abcd", &[0xff, 0xd8, 0xff, 0x00, 0x10]] {
            assert_eq!(unbase64(&base64(b)).as_deref(), Some(b));
        }
        assert_eq!(unbase64("!!"), None);
    }

    #[test]
    fn base64_as_the_core_reads_it() {
        assert_eq!(base64(b"%PDF"), "JVBERg==");
        assert_eq!(base64(b"ab"), "YWI=");
        assert_eq!(base64(b"abc"), "YWJj");
        assert_eq!(base64(b""), "");
    }

    #[test]
    fn a_request_line_gets_its_answer_or_the_reason() {
        let mut m = Methods::new();
        m.add("twice", |p| Ok(json!(p["n"].as_i64().unwrap_or(0) * 2)));
        m.add("fails", |_| fail("no luck"));
        assert_eq!(answer(&mut m, r#"{"id":1,"method":"twice","params":{"n":21}}"#), Some(json!({"id":1,"result":42})));
        assert_eq!(answer(&mut m, r#"{"id":2,"method":"fails"}"#), Some(json!({"id":2,"error":"no luck"})));
        let none = answer(&mut m, r#"{"id":3,"method":"nope"}"#).unwrap();
        assert!(none["error"].as_str().unwrap().contains("has: fails, twice"));
        assert_eq!(answer(&mut m, ""), None);
    }

    /// A listener thread's call and `serve` share stdin: whoever reads files the line for whoever waits for it.
    #[test]
    fn replies_reach_their_caller_and_requests_wait_for_serve_whichever_thread_reads() {
        let pipe = std::sync::Arc::new(Pipe::new());
        let lines = std::sync::Arc::new(Mutex::new(VecDeque::from([
            r#"{"id":1,"method":"list"}"#.to_string(),
            r#"{"reply":7,"status":200,"body":{"ok":true}}"#.to_string(),
            r#"{"id":2,"method":"add"}"#.to_string(),
        ])));
        let src = lines.clone();
        let read = move || src.lock().unwrap().pop_front();
        let (p, r) = (pipe.clone(), read.clone());
        let caller = std::thread::spawn(move || p.next(Want::Reply(7), &r));
        let first = pipe.next(Want::Request, &read).unwrap();
        assert!(first.contains(r#""id":1"#), "{first}");
        assert!(caller.join().unwrap().unwrap().contains(r#""reply":7"#));
        assert!(pipe.next(Want::Request, &read).unwrap().contains(r#""id":2"#));
        assert_eq!(pipe.next(Want::Request, &read), None, "closed");
        assert_eq!(pipe.next(Want::Reply(8), &read), None, "a call after the end fails at once");
    }
}
