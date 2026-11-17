//! SHA-256 verification and interactive prompt before workspace or community plugins spawn external OS binaries.
use crate::api::{BinaryApprovalChoice, BinaryDecision, Event, PendingBinaryApproval, TrustedBinary};
use crate::events::EventBus;
use crate::{plugins, vault_write, Error, Result};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex, RwLock};
use std::time::Duration;

const APPROVAL_TIMEOUT: Duration = Duration::from_secs(30);

enum Waiter {
    Async(tokio::sync::oneshot::Sender<BinaryApprovalChoice>),
    Sync(std::sync::mpsc::Sender<BinaryApprovalChoice>),
}

struct PendingEntry {
    info: PendingBinaryApproval,
    waiter: Waiter,
}

static BUS: LazyLock<RwLock<Option<EventBus>>> = LazyLock::new(|| RwLock::new(None));
static PENDING: LazyLock<Mutex<HashMap<String, PendingEntry>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static SESSION_ALLOW: LazyLock<Mutex<HashSet<(String, String)>>> = LazyLock::new(|| Mutex::new(HashSet::new()));
static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

pub fn register_bus(bus: EventBus) {
    if let Ok(mut w) = BUS.write() {
        *w = Some(bus);
    }
}

fn active_bus(explicit: Option<&EventBus>) -> Option<EventBus> {
    explicit.cloned().or_else(|| BUS.read().ok().and_then(|g| g.clone()))
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
    let entry = {
        let mut pending = PENDING.lock().map_err(|_| Error::BadRequest("binary trust lock poisoned".into()))?;
        pending.remove(&dec.id)
    };
    let Some(entry) = entry else {
        return Err(Error::NotFound(format!("approval request `{}` expired or not found", dec.id)));
    };
    match dec.choice {
        BinaryApprovalChoice::AllowOnce => {
            if let Ok(mut s) = SESSION_ALLOW.lock() {
                s.insert((entry.info.command.clone(), entry.info.sha256.clone()));
            }
        }
        BinaryApprovalChoice::AlwaysAllow => {
            let file = trust_file_path();
            vault_write::outside::locked(&file, || {
                let mut list = load_trusted_from(&file);
                list.retain(|t| !(t.command == entry.info.command && t.sha256 == entry.info.sha256));
                list.push(TrustedBinary {
                    plugin: entry.info.plugin.clone(),
                    command: entry.info.command.clone(),
                    sha256: entry.info.sha256.clone(),
                    allowed_at: chrono::Local::now().format("%Y-%m-%d %H:%M").to_string(),
                });
                save_trusted_to(&file, &list)
            })?;
        }
        BinaryApprovalChoice::Deny => {}
    }
    match entry.waiter {
        Waiter::Async(tx) => {
            let _ = tx.send(dec.choice);
        }
        Waiter::Sync(tx) => {
            let _ = tx.send(dec.choice);
        }
    }
    Ok(true)
}

pub fn revoke(command: &str, sha256: Option<&str>) -> Result<Vec<TrustedBinary>> {
    if let Ok(mut s) = SESSION_ALLOW.lock() {
        s.retain(|(c, h)| !(c == command && sha256.is_none_or(|want| h == want)));
    }
    let file = trust_file_path();
    vault_write::outside::locked(&file, || {
        let mut list = load_trusted_from(&file);
        list.retain(|t| !(t.command == command && sha256.is_none_or(|want| t.sha256 == want)));
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
    cand.canonicalize().unwrap_or(cand)
}

fn is_bundled_plugin(root: &Path, plugin: &str) -> bool {
    if plugin.is_empty() {
        return false;
    }
    let src = crate::state_dir::join(root, plugins::PLUGINS_DIR).join(plugin).join(".source");
    let Ok(text) = std::fs::read_to_string(src) else { return false };
    toml::from_str::<toml::Table>(&text)
        .ok()
        .and_then(|t| t.get("kind")?.as_str().map(|k| k == "bundled"))
        .unwrap_or(false)
}

fn should_bypass(root: &Path, plugin: &str, exe: &Path, force_prompt: bool) -> bool {
    if force_prompt {
        return false;
    }
    if cfg!(test) || crate::env::var_os("TRUST_TEST_BINARIES").is_some() {
        return true;
    }
    let inside_vault = exe.starts_with(root);
    is_bundled_plugin(root, plugin) && !inside_vault
}

fn is_already_allowed(command: &str, sha256: &str, trust_file: &Path) -> bool {
    if SESSION_ALLOW.lock().is_ok_and(|s| s.contains(&(command.to_string(), sha256.to_string()))) {
        return true;
    }
    load_trusted_from(trust_file)
        .iter()
        .any(|t| t.command == command && t.sha256 == sha256)
}

fn build_request(plugin: &str, exe: &Path, args: &[String]) -> (String, PendingBinaryApproval) {
    let cmd_str = exe.to_string_lossy().to_string();
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
    let Some(bus) = active_bus(bus) else {
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
    bus.publish(Event::BinaryApproval(info.clone()));
    let decision = match tokio::time::timeout(APPROVAL_TIMEOUT, rx).await {
        Ok(Ok(choice)) => choice,
        _ => {
            if let Ok(mut p) = PENDING.lock() {
                p.remove(&id);
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
    let Some(bus) = active_bus(bus) else {
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
    bus.publish(Event::BinaryApproval(info.clone()));
    let decision = match rx.recv_timeout(APPROVAL_TIMEOUT) {
        Ok(choice) => choice,
        Err(_) => {
            if let Ok(mut p) = PENDING.lock() {
                p.remove(&id);
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
}
