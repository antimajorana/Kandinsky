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
            if let Ok(mut s) = SESSION_ALLOW.lock() {
                s.insert((clean_cmd, info.sha256.clone()));
            }
        }
        BinaryApprovalChoice::AlwaysAllow => {
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

pub fn file_sha256(exe: &Path) -> String {
    let mut h = Sha256::new();
    match std::fs::File::open(exe) {
        Ok(mut f) => {
            use std::io::Read;
            let mut buf = [0u8; 64 * 1024];
            loop {
                match f.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => h.update(&buf[..n]),
                }
            }
        }
        Err(_) => h.update(exe.to_string_lossy().as_bytes()),
    }
    format!("{:x}", h.finalize())
}

fn resolve_exe(program: &Path, cwd: &Path) -> PathBuf {
    let cand = if program.is_absolute() {
        program.to_path_buf()
    } else if program.components().count() > 1 {
        cwd.join(program)
    } else {
        std::env::var_os("PATH")
            .and_then(|p| {
                std::env::split_paths(&p)
                    .find_map(|dir| crate::platform::run_line::executable(&dir.join(program)))
            })
            .unwrap_or_else(|| program.to_path_buf())
    };
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
        } else if p.is_file() && p.file_name() == Some(file_name) && file_sha256(&p) == target_sha {
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
    let target_sha = file_sha256(&canon_exe);
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

fn build_request(plugin: &str, exe: &Path, args: &[String]) -> (String, PendingBinaryApproval) {
    let cmd_str = clean_path(exe.to_path_buf()).to_string_lossy().to_string();
    let sha256 = file_sha256(exe);
    let id = format!("bin-{}", SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
    let info = PendingBinaryApproval {
        id: id.clone(),
        plugin: if plugin.is_empty() { "workspace".into() } else { plugin.to_string() },
        command: cmd_str,
        args: args.to_vec(),
        sha256,
        reason: "External OS executable requested by a workspace or community plugin".into(),
    };
    (id, info)
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
    let (id, info) = build_request(plugin, &exe, args);
    if is_already_allowed(&info.command, &info.sha256, &trust_file_path()) {
        return Ok(());
    }
    let Some(bus) = active_bus(root, bus) else {
        return Err(Error::BadRequest(format!(
            "blocked untrusted binary `{}` (sha256 {}): no active UI approval channel",
            info.command, info.sha256
        )));
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
        return Err(Error::BadRequest(format!(
            "blocked untrusted binary `{}` (sha256 {}): no active UI approval channel",
            info.command, info.sha256
        )));
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
    let (id, info) = build_request(plugin, &exe, args);
    if is_already_allowed(&info.command, &info.sha256, trust_file) {
        return Ok(());
    }
    let Some(bus) = active_bus(root, bus) else {
        return Err(Error::BadRequest(format!(
            "blocked untrusted binary `{}` (sha256 {}): no active UI approval channel",
            info.command, info.sha256
        )));
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
        return Err(Error::BadRequest(format!(
            "blocked untrusted binary `{}` (sha256 {}): no active UI approval channel",
            info.command, info.sha256
        )));
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
        assert_eq!(req.sha256, file_sha256(&exe));
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
        assert!(res.is_err());
        assert!(start.elapsed() < Duration::from_secs(2), "headless bus blocked for {:?}", start.elapsed());
    }

    #[test]
    fn expired_request_decision_still_persists_always_allow_without_404() {
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join("catalog.exe");
        std::fs::write(&exe, b"binary-bytes").unwrap();
        let trust = dir.path().join("trusted.json");
        let clean_exe = resolve_exe(&exe, dir.path());
        let (id, info) = build_request("catalog", &clean_exe, &[]);
        remember_expired(info);

        let decided = decide_with_file(&BinaryDecision { id, choice: BinaryApprovalChoice::AlwaysAllow }, &trust).unwrap();
        assert!(decided);
        assert!(authorize_blocking_inner(dir.path(), "catalog", &exe, &[], None, &trust, true).is_ok());
    }
}
