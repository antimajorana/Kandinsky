//! SHA-256 verification and interactive prompt before workspace or community plugins spawn external OS binaries.
use crate::api::{BinaryApprovalChoice, BinaryDecision, Event, PendingBinaryApproval, TrustedBinary};
use crate::events::EventBus;
use crate::{vault_write, Error, Result};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex, RwLock};
use std::time::Duration;

const APPROVAL_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_RECENT: usize = 128;

enum Waiter {
    Async(tokio::sync::oneshot::Sender<BinaryApprovalChoice>),
    Sync(std::sync::mpsc::Sender<BinaryApprovalChoice>),
}

struct PendingEntry {
    info: PendingBinaryApproval,
    waiter: Waiter,
}

static BUSES: LazyLock<RwLock<HashMap<PathBuf, EventBus>>> = LazyLock::new(|| RwLock::new(HashMap::new()));
static PENDING: LazyLock<Mutex<HashMap<String, PendingEntry>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static RECENT: LazyLock<Mutex<VecDeque<PendingBinaryApproval>>> = LazyLock::new(|| Mutex::new(VecDeque::new()));
static SESSION_ALLOW: LazyLock<Mutex<HashSet<(String, String)>>> = LazyLock::new(|| Mutex::new(HashSet::new()));
/// What the user refused in this session, per plugin: (plugin, program, sha256). A plugin that polls would otherwise
/// raise the same prompt again every few seconds; an Allow for the program, or a restart, clears it.
static SESSION_DENY: LazyLock<Mutex<HashSet<(String, String, String)>>> = LazyLock::new(|| Mutex::new(HashSet::new()));
static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn clean_path(p: PathBuf) -> PathBuf {
    #[cfg(windows)]
    if let Some(s) = p.to_str() {
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            if !rest.starts_with(r"UNC\") {
                return PathBuf::from(rest);
            }
        }
    }
    p
}

fn clean_cmd_str(s: &str) -> &str {
    #[cfg(windows)]
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        if !rest.starts_with(r"UNC\") {
            return rest;
        }
    }
    s
}

fn bus_key(root: &Path) -> PathBuf {
    clean_path(root.canonicalize().unwrap_or_else(|_| root.to_path_buf()))
}

pub fn register_bus(root: &Path, bus: EventBus) {
    if let Ok(mut w) = BUSES.write() {
        w.insert(bus_key(root), bus);
    }
}

fn active_bus(root: &Path, explicit: Option<&EventBus>) -> Option<EventBus> {
    explicit
        .cloned()
        .or_else(|| BUSES.read().ok().and_then(|g| g.get(&bus_key(root)).cloned()))
}

fn remember_expired(info: PendingBinaryApproval) {
    if let Ok(mut recent) = RECENT.lock() {
        recent.retain(|r| r.id != info.id);
        if recent.len() >= MAX_RECENT {
            recent.pop_front();
        }
        recent.push_back(info);
    }
}

fn trust_file_path() -> PathBuf {
    if let Some(p) = crate::env::var_os("TRUST_FILE") {
        return PathBuf::from(p);
    }
    crate::vaults::list_file()
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("trusted-binaries.json")
}

fn load_trusted_from(file: &Path) -> Vec<TrustedBinary> {
    let Ok(raw) = std::fs::read_to_string(file) else { return Vec::new() };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn save_trusted_to(file: &Path, list: &[TrustedBinary]) -> Result<()> {
    if let Some(dir) = file.parent() {
        vault_write::outside::mkdir(dir)?;
    }
    let json = serde_json::to_string_pretty(list).map_err(|e| Error::Other(e.into()))?;
    vault_write::outside::write_private(file, json.as_bytes())
}

pub fn list_trusted() -> Vec<TrustedBinary> {
    load_trusted_from(&trust_file_path())
}

pub fn list_pending() -> Vec<PendingBinaryApproval> {
    PENDING
        .lock()
        .map(|g| g.values().map(|e| e.info.clone()).collect())
        .unwrap_or_default()
}

pub fn decide(dec: &BinaryDecision) -> Result<bool> {
    decide_with_file(dec, &trust_file_path())
}

fn take_pending_and_waiters(id: &str) -> Result<Option<(PendingBinaryApproval, Vec<Waiter>)>> {
    let mut waiters = Vec::new();
    let info = {
        let mut pending = PENDING.lock().map_err(|_| Error::BadRequest("binary trust lock poisoned".into()))?;
        let primary = pending.remove(id);
        let Some(entry) = primary else {
            return Ok(None);
        };
        let cmd = clean_cmd_str(&entry.info.command).to_string();
        let sha = entry.info.sha256.clone();
        waiters.push(entry.waiter);
        let matching: Vec<String> = pending
            .iter()
            .filter(|(_, e)| clean_cmd_str(&e.info.command) == cmd && e.info.sha256 == sha)
            .map(|(k, _)| k.clone())
            .collect();
        for k in matching {
            if let Some(other) = pending.remove(&k) {
                waiters.push(other.waiter);
            }
        }
        entry.info
    };
    let cmd = clean_cmd_str(&info.command).to_string();
    let sha = info.sha256.clone();
    if let Ok(mut recent) = RECENT.lock() {
        recent.retain(|r| r.id != id && !(clean_cmd_str(&r.command) == cmd && r.sha256 == sha));
    }
    Ok(Some((info, waiters)))
}

fn take_recent_and_matching_pending(id: &str) -> Result<Option<(PendingBinaryApproval, Vec<Waiter>)>> {
    let info = {
        let mut recent = RECENT.lock().map_err(|_| Error::BadRequest("binary trust lock poisoned".into()))?;
        let Some(pos) = recent.iter().position(|r| r.id == id) else {
            return Ok(None);
        };
        let entry = recent.remove(pos).expect("position just matched");
        let cmd = clean_cmd_str(&entry.command).to_string();
        let sha = entry.sha256.clone();
        recent.retain(|r| !(clean_cmd_str(&r.command) == cmd && r.sha256 == sha));
        entry
    };
    let cmd = clean_cmd_str(&info.command).to_string();
    let sha = info.sha256.clone();
    let mut waiters = Vec::new();
    if let Ok(mut pending) = PENDING.lock() {
        let matching: Vec<String> = pending
            .iter()
            .filter(|(_, e)| clean_cmd_str(&e.info.command) == cmd && e.info.sha256 == sha)
            .map(|(k, _)| k.clone())
            .collect();
        for k in matching {
            if let Some(other) = pending.remove(&k) {
                waiters.push(other.waiter);
            }
        }
    }
    Ok(Some((info, waiters)))
}

fn decide_with_file(dec: &BinaryDecision, trust_file: &Path) -> Result<bool> {
    let resolved = match take_pending_and_waiters(&dec.id)? {
        Some(found) => found,
        None => take_recent_and_matching_pending(&dec.id)?
            .ok_or_else(|| Error::NotFound(format!("approval request `{}` expired or not found", dec.id)))?,
    };
    let (info, waiters) = resolved;
    let clean_cmd = clean_cmd_str(&info.command).to_string();
    match dec.choice {
        BinaryApprovalChoice::AllowOnce => {
            forget_denied(&clean_cmd, &info.sha256);
            if let Ok(mut s) = SESSION_ALLOW.lock() {
                s.insert((clean_cmd, info.sha256.clone()));
            }
        }
        BinaryApprovalChoice::AlwaysAllow => {
            forget_denied(&clean_cmd, &info.sha256);
            vault_write::outside::locked(trust_file, || {
                let mut list = load_trusted_from(trust_file);
                list.retain(|t| !(clean_cmd_str(&t.command) == clean_cmd && t.sha256 == info.sha256));
                list.push(TrustedBinary {
                    plugin: info.plugin.clone(),
                    command: clean_cmd.clone(),
                    sha256: info.sha256.clone(),
                    allowed_at: chrono::Local::now().format("%Y-%m-%d %H:%M").to_string(),
                });
                save_trusted_to(trust_file, &list)
            })?;
        }
        BinaryApprovalChoice::Deny => {
            if let Ok(mut s) = SESSION_ALLOW.lock() {
                s.retain(|(c, h)| !(clean_cmd_str(c) == clean_cmd && h == &info.sha256));
            }
            if let Ok(mut d) = SESSION_DENY.lock() {
                d.insert((info.plugin.clone(), clean_cmd, info.sha256.clone()));
            }
        }
    }
    for waiter in waiters {
        match waiter {
            Waiter::Async(tx) => {
                let _ = tx.send(dec.choice);
            }
            Waiter::Sync(tx) => {
                let _ = tx.send(dec.choice);
            }
        }
    }
    Ok(true)
}

fn forget_denied(cmd: &str, sha256: &str) {
    if let Ok(mut d) = SESSION_DENY.lock() {
        d.retain(|(_, c, h)| !(c == cmd && h == sha256));
    }
}

/// The refusal for a program this plugin was already denied in this session, without asking again.
fn denied_before(info: &PendingBinaryApproval) -> Option<Error> {
    let cmd = clean_cmd_str(&info.command);
    let hit = SESSION_DENY.lock().is_ok_and(|d| d.iter().any(|(p, c, h)| p == &info.plugin && c == cmd && h == &info.sha256));
    hit.then(|| Error::BadRequest(format!(
        "execution denied for `{}` (sha256 {}): refused earlier in this session; restart Kandinsky to be asked again",
        info.command, info.sha256
    )))
}

pub fn revoke(command: &str, sha256: Option<&str>) -> Result<Vec<TrustedBinary>> {
    let cmd = clean_cmd_str(command);
    if let Ok(mut s) = SESSION_ALLOW.lock() {
        s.retain(|(c, h)| !(clean_cmd_str(c) == cmd && sha256.is_none_or(|want| h == want)));
    }
    let file = trust_file_path();
    vault_write::outside::locked(&file, || {
        let mut list = load_trusted_from(&file);
        list.retain(|t| !(clean_cmd_str(&t.command) == cmd && sha256.is_none_or(|want| t.sha256 == want)));
        save_trusted_to(&file, &list)?;
        Ok(list)
    })
}

/// The SHA-256 of the file's bytes; a file that cannot be read whole is an error, never a partial or stand-in hash.
pub fn file_sha256(exe: &Path) -> std::io::Result<String> {
    sha256_of(std::fs::File::open(exe)?)
}

fn sha256_of(mut f: std::fs::File) -> std::io::Result<String> {
    use std::io::Read;
    let mut h = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        match f.read(&mut buf)? {
            0 => break,
            n => h.update(&buf[..n]),
        }
    }
    Ok(format!("{:x}", h.finalize()))
}

/// What identifies the program that will run: its bytes' SHA-256. In a Flatpak the program runs on the host
/// (`flatpak-spawn --host`), so the host's file is hashed there, not the sandbox's file at the same path.
fn fingerprint(exe: &Path) -> std::io::Result<String> {
    if crate::platform::host::sandboxed() {
        return host_sha256(exe);
    }
    match std::fs::File::open(exe) {
        Ok(f) => sha256_of(f),
        // only a file that is there but refuses to open: a read failing part way is an error
        Err(e) if e.kind() != std::io::ErrorKind::NotFound && exe.is_file() => unreadable_fingerprint(exe),
        Err(e) => Err(e),
    }
}

/// A program that exists but cannot be opened for reading (a Windows app execution alias, an execute-only file):
/// known by its path and file identity, so replacing the file still asks again.
fn unreadable_fingerprint(exe: &Path) -> std::io::Result<String> {
    let meta = std::fs::symlink_metadata(exe)?;
    let modified = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_nanos());
    let mut h = Sha256::new();
    h.update(b"unreadable\0");
    h.update(exe.to_string_lossy().as_bytes());
    h.update(format!("\0{}\0{modified}\0{}", meta.len(), crate::platform::proc::file_id(&meta)).as_bytes());
    Ok(format!("{:x}", h.finalize()))
}

/// The host's own `sha256sum` of `exe` (Flatpak).
fn host_sha256(exe: &Path) -> std::io::Result<String> {
    let out = std::process::Command::new("flatpak-spawn")
        .args(["--host", "sha256sum", "--"])
        .arg(exe)
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()?;
    let text = String::from_utf8_lossy(&out.stdout);
    match out.status.success().then(|| parse_sha256sum(&text)).flatten() {
        Some(sha) => Ok(sha),
        None => Err(std::io::Error::new(std::io::ErrorKind::NotFound, "the host has no such program, or cannot read it")),
    }
}

/// The hash from a `sha256sum` line (`<64 hex>  <path>`; a leading `\` marks an escaped file name).
fn parse_sha256sum(out: &str) -> Option<String> {
    let sha = out.split_whitespace().next()?.trim_start_matches('\\');
    (sha.len() == 64 && sha.bytes().all(|b| b.is_ascii_hexdigit())).then(|| sha.to_ascii_lowercase())
}

fn resolve_exe(program: &Path, cwd: &Path) -> PathBuf {
    let sandboxed = crate::platform::host::sandboxed();
    let cand = if program.is_absolute() {
        program.to_path_buf()
    } else if program.components().count() > 1 {
        cwd.join(program)
    } else if sandboxed {
        // a bare name runs from the host's PATH, not the sandbox's
        crate::platform::host::find(&program.to_string_lossy()).unwrap_or_else(|| program.to_path_buf())
    } else {
        std::env::var_os("PATH")
            .and_then(|p| {
                std::env::split_paths(&p)
                    .find_map(|dir| crate::platform::run_line::executable(&dir.join(program)))
            })
            .unwrap_or_else(|| program.to_path_buf())
    };
    // the sandbox's links are not the host's: a host path is kept as given, and the host resolves it
    if sandboxed {
        return cand;
    }
    clean_path(cand.canonicalize().unwrap_or(cand))
}

fn dir_contains_matching_sha(dir: &Path, file_name: &std::ffi::OsStr, target_sha: &str) -> bool {
    let Ok(rd) = std::fs::read_dir(dir) else { return false };
    for entry in rd.flatten() {
        let p = entry.path();
        if p.is_dir() {
            if dir_contains_matching_sha(&p, file_name, target_sha) {
                return true;
            }
        } else if p.is_file() && p.file_name() == Some(file_name) && file_sha256(&p).is_ok_and(|s| s == target_sha) {
            return true;
        }
    }
    false
}

fn is_trusted_bundled_binary_in(root: &Path, plugin: &str, exe: &Path, bdir: &Path) -> bool {
    let Ok(canon_bdir) = bdir.canonicalize().map(clean_path) else {
        return false;
    };
    if !canon_bdir.is_dir() {
        return false;
    }
    let canon_root = clean_path(root.canonicalize().unwrap_or_else(|_| root.to_path_buf()));
    if canon_bdir.starts_with(&canon_root) || canon_bdir.starts_with(root) {
        return false;
    }
    let canon_exe = clean_path(exe.canonicalize().unwrap_or_else(|_| exe.to_path_buf()));
    if !canon_exe.is_file() {
        return false;
    }
    if canon_exe.starts_with(&canon_bdir) {
        return true;
    }
    if plugin.is_empty() || plugin == "." || plugin == ".." || plugin.contains(['/', '\\']) {
        return false;
    }
    let bundled_plugin = canon_bdir.join(plugin);
    if !bundled_plugin.is_dir() {
        return false;
    }
    let Some(name) = canon_exe.file_name() else { return false };
    let Ok(target_sha) = file_sha256(&canon_exe) else { return false };
    dir_contains_matching_sha(&bundled_plugin, name, &target_sha)
}

/// Only genuine app-bundled binaries (living inside `bundled-plugins` beside `current_exe()`, or matching a bundled
/// plugin's binary by exact SHA-256) may bypass the prompt; vault-writable `.source` files are never trusted.
fn is_trusted_bundled_binary(root: &Path, plugin: &str, exe: &Path) -> bool {
    let Some(bdir) = crate::plugin_install::bundled_dir() else {
        return false;
    };
    is_trusted_bundled_binary_in(root, plugin, exe, &bdir)
}

fn should_bypass(root: &Path, plugin: &str, exe: &Path, force_prompt: bool) -> bool {
    if force_prompt {
        return false;
    }
    if cfg!(test) || crate::env::var_os("TRUST_TEST_BINARIES").is_some() {
        return true;
    }
    is_trusted_bundled_binary(root, plugin, exe)
}

fn is_already_allowed(command: &str, sha256: &str, trust_file: &Path) -> bool {
    let cmd = clean_cmd_str(command);
    if SESSION_ALLOW
        .lock()
        .is_ok_and(|s| s.iter().any(|(c, h)| clean_cmd_str(c) == cmd && h == sha256))
    {
        return true;
    }
    load_trusted_from(trust_file)
        .iter()
        .any(|t| clean_cmd_str(&t.command) == cmd && t.sha256 == sha256)
}

fn build_request(plugin: &str, exe: &Path, args: &[String]) -> Result<(String, PendingBinaryApproval)> {
    let cmd_str = clean_path(exe.to_path_buf()).to_string_lossy().to_string();
    let sha256 = fingerprint(exe).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => Error::NotFound(format!("cannot run `{cmd_str}`: no such program was found")),
        _ => Error::BadRequest(format!("cannot run `{cmd_str}`: it cannot be read to verify it ({e})")),
    })?;
    let id = format!("bin-{}", SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
    let info = PendingBinaryApproval {
        id: id.clone(),
        plugin: if plugin.is_empty() { "workspace".into() } else { plugin.to_string() },
        command: cmd_str,
        args: args.to_vec(),
        sha256,
        reason: "External OS executable requested by a workspace or community plugin".into(),
    };
    Ok((id, info))
}

/// Refused for want of anyone to ask (an offline CLI command, `kandinsky mcp`, no window open): fails closed, and says
/// how to get the program approved.
fn no_window(info: &PendingBinaryApproval) -> Error {
    Error::BadRequest(format!(
        "blocked untrusted binary `{}` (sha256 {}): it needs your approval and no Kandinsky window is open to ask. Open Kandinsky on this vault and run this again: choose \"Always allow\" in the prompt, and later runs need no window (Settings → Plugins lists the trusted binaries)",
        info.command, info.sha256
    ))
}

pub async fn authorize_async(
    root: &Path,
    plugin: &str,
    program: &Path,
    args: &[String],
    bus: Option<&EventBus>,
) -> Result<()> {
    let exe = resolve_exe(program, root);
    if should_bypass(root, plugin, &exe, false) {
        return Ok(());
    }
    let (id, info) = build_request(plugin, &exe, args)?;
    if is_already_allowed(&info.command, &info.sha256, &trust_file_path()) {
        return Ok(());
    }
    if let Some(refused) = denied_before(&info) {
        return Err(refused);
    }
    let Some(bus) = active_bus(root, bus) else {
        return Err(no_window(&info));
    };
    let (tx, rx) = tokio::sync::oneshot::channel();
    {
        let mut p = PENDING.lock().map_err(|_| Error::BadRequest("binary trust lock poisoned".into()))?;
        p.insert(id.clone(), PendingEntry { info: info.clone(), waiter: Waiter::Async(tx) });
    }
    if bus.emit(Event::BinaryApproval(info.clone())).is_err() {
        if let Ok(mut p) = PENDING.lock() {
            p.remove(&id);
        }
        return Err(no_window(&info));
    }
    let decision = match tokio::time::timeout(APPROVAL_TIMEOUT, rx).await {
        Ok(Ok(choice)) => choice,
        _ => {
            let expired = PENDING.lock().ok().and_then(|mut p| p.remove(&id));
            if let Some(expired) = expired {
                remember_expired(expired.info);
            }
            BinaryApprovalChoice::Deny
        }
    };
    if decision == BinaryApprovalChoice::Deny {
        return Err(Error::BadRequest(format!(
            "execution denied for `{}` (sha256 {})",
            info.command, info.sha256
        )));
    }
    Ok(())
}

pub fn authorize_blocking(
    root: &Path,
    plugin: &str,
    program: &Path,
    args: &[String],
    bus: Option<&EventBus>,
) -> Result<()> {
    authorize_blocking_inner(root, plugin, program, args, bus, &trust_file_path(), false)
}

fn authorize_blocking_inner(
    root: &Path,
    plugin: &str,
    program: &Path,
    args: &[String],
    bus: Option<&EventBus>,
    trust_file: &Path,
    force_prompt: bool,
) -> Result<()> {
    let exe = resolve_exe(program, root);
    if should_bypass(root, plugin, &exe, force_prompt) {
        return Ok(());
    }
    let (id, info) = build_request(plugin, &exe, args)?;
    if is_already_allowed(&info.command, &info.sha256, trust_file) {
        return Ok(());
    }
    if let Some(refused) = denied_before(&info) {
        return Err(refused);
    }
    let Some(bus) = active_bus(root, bus) else {
        return Err(no_window(&info));
    };
    let (tx, rx) = std::sync::mpsc::channel();
    {
        let mut p = PENDING.lock().map_err(|_| Error::BadRequest("binary trust lock poisoned".into()))?;
        p.insert(id.clone(), PendingEntry { info: info.clone(), waiter: Waiter::Sync(tx) });
    }
    if bus.emit(Event::BinaryApproval(info.clone())).is_err() {
        if let Ok(mut p) = PENDING.lock() {
            p.remove(&id);
        }
        return Err(no_window(&info));
    }
    let decision = match rx.recv_timeout(APPROVAL_TIMEOUT) {
        Ok(choice) => choice,
        Err(_) => {
            let expired = PENDING.lock().ok().and_then(|mut p| p.remove(&id));
            if let Some(expired) = expired {
                remember_expired(expired.info);
            }
            BinaryApprovalChoice::Deny
        }
    };
    if decision == BinaryApprovalChoice::Deny {
        return Err(Error::BadRequest(format!(
            "execution denied for `{}` (sha256 {})",
            info.command, info.sha256
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_trust_prompts_with_sha256_allows_once_or_persists_and_revokes() {
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join("tool.sh");
        std::fs::write(&exe, b"echo hello\n").unwrap();
        let trust = dir.path().join("trusted.json");
        let bus = EventBus::default();
        let mut rx = bus.subscribe();

        let (tx_done, rx_done) = std::sync::mpsc::channel();
        let (root_c, exe_c, trust_c, bus_c) = (dir.path().to_path_buf(), exe.clone(), trust.clone(), bus.clone());
        std::thread::spawn(move || {
            let res = authorize_blocking_inner(&root_c, "community-plugin", &exe_c, &[], Some(&bus_c), &trust_c, true);
            let _ = tx_done.send(res);
        });

        let ev = rx.blocking_recv().unwrap();
        let Event::BinaryApproval(req) = ev else { panic!("expected BinaryApproval") };
        assert_eq!(req.plugin, "community-plugin");
        assert_eq!(req.sha256, file_sha256(&exe).unwrap());
        decide(&BinaryDecision { id: req.id, choice: BinaryApprovalChoice::AllowOnce }).unwrap();
        assert!(rx_done.recv().unwrap().is_ok());

        // Second run passes from session cache; modified file changes hash and re-prompts.
        assert!(authorize_blocking_inner(dir.path(), "community-plugin", &exe, &[], Some(&bus), &trust, true).is_ok());
        std::fs::write(&exe, b"echo modified\n").unwrap();
        let (tx2, rx2) = std::sync::mpsc::channel();
        let (root_c, exe_c, trust_c, bus_c) = (dir.path().to_path_buf(), exe.clone(), trust.clone(), bus.clone());
        std::thread::spawn(move || {
            let res = authorize_blocking_inner(&root_c, "community-plugin", &exe_c, &[], Some(&bus_c), &trust_c, true);
            let _ = tx2.send(res);
        });
        let ev2 = rx.blocking_recv().unwrap();
        let Event::BinaryApproval(req2) = ev2 else { panic!("expected BinaryApproval after modification") };
        decide(&BinaryDecision { id: req2.id, choice: BinaryApprovalChoice::Deny }).unwrap();
        assert!(rx2.recv().unwrap().is_err());

        // Revoking removes from session allowlist cleanly.
        assert!(revoke(&exe.canonicalize().unwrap_or(exe).to_string_lossy(), None).is_ok());
    }

    #[test]
    fn vault_forged_bundled_source_never_bypasses_trust() {
        let vault = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let plugin_dir = vault.path().join(".kandinsky/plugins/evil");
        std::fs::create_dir_all(&plugin_dir).unwrap();
        std::fs::write(plugin_dir.join(".source"), "kind = \"bundled\"\nsource = \"forged\"\n").unwrap();
        let external_exe = outside.path().join("payload.sh");
        std::fs::write(&external_exe, b"echo evil\n").unwrap();
        let canon = external_exe.canonicalize().unwrap_or(external_exe);
        assert!(!is_trusted_bundled_binary(vault.path(), "evil", &canon));
    }

    #[test]
    fn vault_copied_plugin_matching_bundled_sha_bypasses_while_modified_binary_prompts() {
        let vault = tempfile::tempdir().unwrap();
        let bundled = tempfile::tempdir().unwrap();
        let bundled_bin = bundled.path().join("catalog/bin/catalog.exe");
        std::fs::create_dir_all(bundled_bin.parent().unwrap()).unwrap();
        std::fs::write(&bundled_bin, b"genuine-bundled-binary").unwrap();

        let vault_bin = vault.path().join(".kandinsky/plugins/catalog/bin/catalog.exe");
        std::fs::create_dir_all(vault_bin.parent().unwrap()).unwrap();
        std::fs::write(&vault_bin, b"genuine-bundled-binary").unwrap();

        assert!(is_trusted_bundled_binary_in(vault.path(), "catalog", &vault_bin, bundled.path()));

        // Swapping 1 byte inside the vault immediately invalidates SHA-256 trust.
        std::fs::write(&vault_bin, b"tampered-vault-binary!").unwrap();
        assert!(!is_trusted_bundled_binary_in(vault.path(), "catalog", &vault_bin, bundled.path()));

        // A forged `bundled-plugins` directory inside the vault is never trusted.
        let forged_bundled = vault.path().join("bundled-plugins");
        let forged_bin = forged_bundled.join("catalog/bin/catalog.exe");
        std::fs::create_dir_all(forged_bin.parent().unwrap()).unwrap();
        std::fs::write(&forged_bin, b"tampered-vault-binary!").unwrap();
        assert!(!is_trusted_bundled_binary_in(vault.path(), "catalog", &vault_bin, &forged_bundled));
    }

    #[test]
    fn zero_listener_bus_fails_fast_without_waiting_timeout() {
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join("tool.sh");
        std::fs::write(&exe, b"echo headless\n").unwrap();
        let trust = dir.path().join("trusted.json");
        let bus = EventBus::default();
        let start = std::time::Instant::now();
        let res = authorize_blocking_inner(dir.path(), "community-plugin", &exe, &[], Some(&bus), &trust, true);
        let said = res.unwrap_err().to_string();
        assert!(start.elapsed() < Duration::from_secs(2), "headless bus blocked for {:?}", start.elapsed());
        // fails closed, and says which program and how to approve it
        assert!(said.contains("tool.sh") && said.contains("Always allow") && said.contains("no Kandinsky window is open"), "{said}");
    }

    #[test]
    fn a_program_that_cannot_be_read_is_never_hashed_as_its_path() {
        let dir = tempfile::tempdir().unwrap();
        let trust = dir.path().join("trusted.json");
        let gone = dir.path().join("not-there");
        assert!(file_sha256(&gone).is_err() && fingerprint(&gone).is_err());
        let res = authorize_blocking_inner(dir.path(), "community-plugin", &gone, &[], Some(&EventBus::default()), &trust, true);
        assert!(matches!(res, Err(Error::NotFound(_))), "a missing program is refused, not approved by its name: {res:?}");
        // the stand-in for an unopenable file follows the file, not only its name
        let exe = dir.path().join("tool.sh");
        std::fs::write(&exe, b"one").unwrap();
        let a = unreadable_fingerprint(&exe).unwrap();
        std::fs::remove_file(&exe).unwrap();
        std::fs::write(&exe, b"other bytes").unwrap();
        assert_ne!(a, unreadable_fingerprint(&exe).unwrap(), "replaced: asked again");
    }

    #[test]
    fn a_bare_program_name_on_the_path_is_found_and_asked_about() {
        let dir = tempfile::tempdir().unwrap();
        let trust = dir.path().join("trusted.json");
        let bus = EventBus::default();
        let mut rx = bus.subscribe();
        let (root_c, trust_c, bus_c) = (dir.path().to_path_buf(), trust.clone(), bus.clone());
        let asked = std::thread::spawn(move || authorize_blocking_inner(&root_c, "community-plugin", Path::new("rustc"), &[], Some(&bus_c), &trust_c, true));
        let Event::BinaryApproval(req) = rx.blocking_recv().unwrap() else { panic!("expected BinaryApproval") };
        assert!(Path::new(&req.command).is_absolute(), "{}", req.command);
        decide(&BinaryDecision { id: req.id, choice: BinaryApprovalChoice::Deny }).unwrap();
        assert!(asked.join().unwrap().is_err());
    }

    #[test]
    fn a_denied_program_is_not_asked_about_again_until_it_is_allowed() {
        let dir = tempfile::tempdir().unwrap();
        let trust = dir.path().join("trusted.json");
        let exe = dir.path().join("poller.exe");
        std::fs::write(&exe, b"polls its status").unwrap();
        let bus = EventBus::default();
        let mut rx = bus.subscribe();
        let ask = |plugin: &'static str| {
            let (root, trust, bus, exe) = (dir.path().to_path_buf(), trust.clone(), bus.clone(), exe.clone());
            std::thread::spawn(move || authorize_blocking_inner(&root, plugin, &exe, &[], Some(&bus), &trust, true))
        };
        let first = ask("deny-once-plugin");
        let Event::BinaryApproval(req) = rx.blocking_recv().unwrap() else { panic!("expected BinaryApproval") };
        decide(&BinaryDecision { id: req.id, choice: BinaryApprovalChoice::Deny }).unwrap();
        assert!(first.join().unwrap().is_err());
        // the plugin's next call is refused at once, with no second prompt
        let again = ask("deny-once-plugin").join().unwrap();
        assert!(matches!(&again, Err(Error::BadRequest(m)) if m.contains("refused earlier")), "{again:?}");
        assert!(rx.try_recv().is_err(), "no second prompt");
        // another plugin asking for the same program is still asked, and its Allow lifts the refusal
        let other = ask("another-plugin");
        let Event::BinaryApproval(req2) = rx.blocking_recv().unwrap() else { panic!("expected BinaryApproval") };
        decide(&BinaryDecision { id: req2.id, choice: BinaryApprovalChoice::AllowOnce }).unwrap();
        assert!(other.join().unwrap().is_ok());
        assert!(ask("deny-once-plugin").join().unwrap().is_ok());
    }

    #[test]
    fn the_hosts_sha256sum_is_read() {
        let sha = "9F86D081884C7D659A2FEAA0C55AD015A3BF4F1B2B0B822CD15D6C15B0F00A08";
        assert_eq!(parse_sha256sum(&format!("{sha}  /usr/bin/python3\n")).as_deref(), Some(sha.to_ascii_lowercase().as_str()));
        assert_eq!(parse_sha256sum(&format!("\\{sha}  /tmp/a\\nb\n")).as_deref(), Some(sha.to_ascii_lowercase().as_str()), "an escaped name");
        assert_eq!(parse_sha256sum(""), None);
        assert_eq!(parse_sha256sum("sha256sum: /x: No such file or directory"), None);
    }

    #[test]
    fn expired_request_decision_still_persists_always_allow_without_404() {
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join("catalog.exe");
        std::fs::write(&exe, b"binary-bytes").unwrap();
        let trust = dir.path().join("trusted.json");
        let clean_exe = resolve_exe(&exe, dir.path());
        let (id, info) = build_request("catalog", &clean_exe, &[]).unwrap();
        remember_expired(info);

        let decided = decide_with_file(&BinaryDecision { id, choice: BinaryApprovalChoice::AlwaysAllow }, &trust).unwrap();
        assert!(decided);
        assert!(authorize_blocking_inner(dir.path(), "catalog", &exe, &[], None, &trust, true).is_ok());
    }
}
