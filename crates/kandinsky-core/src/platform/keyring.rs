//! OS keyring storage for plugin secrets: Windows Credential Manager, macOS Keychain, Linux `secret-tool`.
//! Falls back gracefully (returns unsupported / false) on headless environments without a secret service daemon.
use std::collections::BTreeMap;

/// Maximum UTF-8 bytes per credential blob (below Windows Credential Manager's 2560-byte hard ceiling).
const CHUNK_BYTES: usize = 1800;

/// Whether keyring storage should be used for desktop vaults (`Store::for_vault`).
/// Disabled during `cargo test`, when file-based secret overrides are configured, or via `KANDINSKY_KEYRING=0`.
pub fn active_for_vault() -> bool {
    if cfg!(test) {
        return false;
    }
    if crate::env::var_os("SECRETS_DIR").is_some() || crate::env::var_os("SECRET_FILES").is_some() {
        return false;
    }
    if crate::env::var("KEYRING").as_deref() == Some("0") {
        return false;
    }
    is_backend_available()
}

#[cfg(target_os = "windows")]
fn is_backend_available() -> bool {
    true
}

#[cfg(target_os = "macos")]
fn is_backend_available() -> bool {
    std::path::Path::new("/usr/bin/security").is_file()
}

#[cfg(all(unix, not(target_os = "macos")))]
fn is_backend_available() -> bool {
    std::process::Command::new("secret-tool")
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

#[cfg(not(any(target_os = "windows", unix)))]
fn is_backend_available() -> bool {
    false
}

fn secret_target(vault_key: &str, plugin: &str, name: &str) -> String {
    format!("kandinsky:{vault_key}:{plugin}:{name}")
}

fn index_target(vault_key: &str) -> String {
    format!("kandinsky:{vault_key}:__index__")
}

pub fn get(vault_key: &str, plugin: &str, name: &str) -> Result<Option<String>, String> {
    let target = secret_target(vault_key, plugin, name);
    get_chunked(&target)
}

pub fn set(vault_key: &str, plugin: &str, name: &str, value: &str) -> Result<(), String> {
    let target = secret_target(vault_key, plugin, name);
    set_chunked(&target, value)?;
    update_index(vault_key, plugin, name, true)
}

pub fn delete(vault_key: &str, plugin: &str, name: &str) -> Result<bool, String> {
    let target = secret_target(vault_key, plugin, name);
    let existed = delete_chunked(&target)?;
    update_index(vault_key, plugin, name, false)?;
    Ok(existed)
}

pub fn list_names(vault_key: &str, plugin: &str) -> Result<Vec<String>, String> {
    let map = read_index(vault_key)?;
    Ok(map.get(plugin).cloned().unwrap_or_default())
}

fn read_index(vault_key: &str) -> Result<BTreeMap<String, Vec<String>>, String> {
    let Some(raw) = get_chunked(&index_target(vault_key))? else {
        return Ok(BTreeMap::new());
    };
    serde_json::from_str(&raw).map_err(|e| format!("keyring index: {e}"))
}

static INDEX_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn update_index(vault_key: &str, plugin: &str, name: &str, present: bool) -> Result<(), String> {
    let _guard = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut map = read_index(vault_key)?;
    let entry = map.entry(plugin.to_string()).or_default();
    if present {
        if !entry.iter().any(|x| x == name) {
            entry.push(name.to_string());
            entry.sort();
        }
    } else {
        entry.retain(|x| x != name);
        if entry.is_empty() {
            map.remove(plugin);
        }
    }
    let idx = index_target(vault_key);
    if map.is_empty() {
        let _ = delete_chunked(&idx);
        Ok(())
    } else {
        let json = serde_json::to_string(&map).map_err(|e| e.to_string())?;
        set_chunked(&idx, &json)
    }
}

fn get_chunked(target: &str) -> Result<Option<String>, String> {
    let Some(first) = raw_get(target)? else {
        return Ok(None);
    };
    if let Some(rest) = first.strip_prefix("kchunk:") {
        if let Some((count_s, head)) = rest.split_once(':') {
            if let Ok(count) = count_s.parse::<usize>() {
                let mut buf = Vec::from(head.as_bytes());
                for idx in 1..count {
                    let part = raw_get(&format!("{target}#{idx}"))?.ok_or_else(|| format!("missing keyring chunk {idx}"))?;
                    buf.extend_from_slice(part.as_bytes());
                }
                return String::from_utf8(buf).map(Some).map_err(|e| e.to_string());
            }
        }
    }
    Ok(Some(first))
}

fn existing_chunk_count(target: &str) -> usize {
    let Some(first) = raw_get(target).ok().flatten() else {
        return 0;
    };
    if let Some(rest) = first.strip_prefix("kchunk:") {
        if let Some((count_s, _)) = rest.split_once(':') {
            if let Ok(count) = count_s.parse::<usize>() {
                return count.max(1);
            }
        }
    }
    1
}

fn set_chunked(target: &str, value: &str) -> Result<(), String> {
    let old_count = existing_chunk_count(target);
    if value.len() <= CHUNK_BYTES && !value.starts_with("kchunk:") {
        raw_set(target, value)?;
        for i in 1..old_count {
            let _ = raw_delete(&format!("{target}#{i}"));
        }
        return Ok(());
    }
    // Split UTF-8 cleanly at codepoint boundaries inside CHUNK_BYTES.
    let mut chunks: Vec<&str> = Vec::new();
    let mut start = 0;
    let max_head = CHUNK_BYTES - 32;
    while start < value.len() {
        let mut end = (start + max_head).min(value.len());
        while !value.is_char_boundary(end) {
            end -= 1;
        }
        chunks.push(&value[start..end]);
        start = end;
    }
    if chunks.is_empty() {
        raw_set(target, "")?;
        for i in 1..old_count {
            let _ = raw_delete(&format!("{target}#{i}"));
        }
        return Ok(());
    }
    for (i, chunk) in chunks.iter().enumerate().skip(1) {
        raw_set(&format!("{target}#{i}"), chunk)?;
    }
    let head = format!("kchunk:{}:{}", chunks.len(), chunks[0]);
    raw_set(target, &head)?;
    for i in chunks.len()..old_count {
        let _ = raw_delete(&format!("{target}#{i}"));
    }
    Ok(())
}

fn delete_chunked(target: &str) -> Result<bool, String> {
    let first_val = raw_get(target).ok().flatten();
    let existed = raw_delete(target)?;
    if let Some(v) = first_val {
        if let Some(rest) = v.strip_prefix("kchunk:") {
            if let Some((count_s, _)) = rest.split_once(':') {
                if let Ok(count) = count_s.parse::<usize>() {
                    for i in 1..count {
                        let _ = raw_delete(&format!("{target}#{i}"));
                    }
                }
            }
        }
    }
    Ok(existed)
}

#[cfg(target_os = "windows")]
fn raw_get(target: &str) -> Result<Option<String>, String> {
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_NOT_FOUND};
    use windows_sys::Win32::Security::Credentials::{CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC};
    let mut wtarget: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();
    let mut ptr: *mut CREDENTIALW = std::ptr::null_mut();
    // SAFETY: `wtarget` is null-terminated UTF-16 for the duration of the FFI call and `ptr` receives an OS-allocated credential buffer freed below.
    let ok = unsafe { CredReadW(wtarget.as_mut_ptr(), CRED_TYPE_GENERIC, 0, &mut ptr) };
    if ok == 0 {
        // SAFETY: `GetLastError` reads the calling thread's last-error code set by `CredReadW`.
        let err = unsafe { GetLastError() };
        if err == ERROR_NOT_FOUND {
            return Ok(None);
        }
        return Err(format!("CredReadW failed ({err})"));
    }
    // SAFETY: `CredReadW` succeeded so `ptr` points to a valid `CREDENTIALW` with `CredentialBlobSize` bytes, copied before `CredFree`.
    let out = unsafe {
        let cred = &*ptr;
        let slice = if cred.CredentialBlob.is_null() || cred.CredentialBlobSize == 0 {
            &[]
        } else {
            std::slice::from_raw_parts(cred.CredentialBlob, cred.CredentialBlobSize as usize)
        };
        let res = String::from_utf8(slice.to_vec()).map_err(|e| e.to_string());
        CredFree(ptr.cast());
        res?
    };
    Ok(Some(out))
}

#[cfg(target_os = "windows")]
fn raw_set(target: &str, value: &str) -> Result<(), String> {
    use windows_sys::Win32::Foundation::GetLastError;
    use windows_sys::Win32::Security::Credentials::{CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC};
    let mut wtarget: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();
    let mut wuser: Vec<u16> = "kandinsky".encode_utf16().chain(std::iter::once(0)).collect();
    let mut blob = value.as_bytes().to_vec();
    let cred = CREDENTIALW {
        Flags: 0,
        Type: CRED_TYPE_GENERIC,
        TargetName: wtarget.as_mut_ptr(),
        Comment: std::ptr::null_mut(),
        LastWritten: unsafe { std::mem::zeroed() },
        CredentialBlobSize: blob.len() as u32,
        CredentialBlob: blob.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        AttributeCount: 0,
        Attributes: std::ptr::null_mut(),
        TargetAlias: std::ptr::null_mut(),
        UserName: wuser.as_mut_ptr(),
    };
    // SAFETY: all pointers inside `cred` live on the stack/heap until `CredWriteW` finishes.
    let ok = unsafe { CredWriteW(&cred, 0) };
    if ok == 0 {
        // SAFETY: reads thread-local Windows error code set by `CredWriteW`.
        return Err(format!("CredWriteW failed ({})", unsafe { GetLastError() }));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn raw_delete(target: &str) -> Result<bool, String> {
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_NOT_FOUND};
    use windows_sys::Win32::Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC};
    let mut wtarget: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();
    // SAFETY: `wtarget` is null-terminated UTF-16.
    let ok = unsafe { CredDeleteW(wtarget.as_mut_ptr(), CRED_TYPE_GENERIC, 0) };
    if ok == 0 {
        // SAFETY: reads thread-local Windows error code set by `CredDeleteW`.
        let err = unsafe { GetLastError() };
        if err == ERROR_NOT_FOUND {
            return Ok(false);
        }
        return Err(format!("CredDeleteW failed ({err})"));
    }
    Ok(true)
}

#[cfg(target_os = "macos")]
fn raw_get(target: &str) -> Result<Option<String>, String> {
    let out = std::process::Command::new("/usr/bin/security")
        .args(["find-generic-password", "-s", target, "-a", "kandinsky", "-w"])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Ok(None);
    }
    Ok(Some(String::from_utf8_lossy(&out.stdout).trim_end_matches(['\n', '\r']).to_string()))
}

#[cfg(target_os = "macos")]
fn quote_security_arg(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' | '\r' => {}
            _ => out.push(ch),
        }
    }
    out.push('"');
    out
}

#[cfg(target_os = "macos")]
fn raw_set(target: &str, value: &str) -> Result<(), String> {
    use std::io::Write;
    let cmd = format!(
        "add-generic-password -U -s {} -a kandinsky -w {}\n",
        quote_security_arg(target),
        quote_security_arg(value)
    );
    let mut child = std::process::Command::new("/usr/bin/security")
        .arg("-i")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(cmd.as_bytes());
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn raw_delete(target: &str) -> Result<bool, String> {
    let out = std::process::Command::new("/usr/bin/security")
        .args(["delete-generic-password", "-s", target, "-a", "kandinsky"])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(out.status.success())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn raw_get(target: &str) -> Result<Option<String>, String> {
    let out = std::process::Command::new("secret-tool")
        .args(["lookup", "kandinsky-target", target])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Ok(None);
    }
    let s = String::from_utf8_lossy(&out.stdout);
    Ok(Some(s.strip_suffix('\n').unwrap_or(&s).to_string()))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn raw_set(target: &str, value: &str) -> Result<(), String> {
    use std::io::Write;
    let mut child = std::process::Command::new("secret-tool")
        .args(["store", "--label", target, "kandinsky-target", target])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(value.as_bytes());
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn raw_delete(target: &str) -> Result<bool, String> {
    let out = std::process::Command::new("secret-tool")
        .args(["clear", "kandinsky-target", target])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(out.status.success())
}

#[cfg(not(any(target_os = "windows", unix)))]
fn raw_get(_target: &str) -> Result<Option<String>, String> { Ok(None) }
#[cfg(not(any(target_os = "windows", unix)))]
fn raw_set(_target: &str, _value: &str) -> Result<(), String> { Err("keyring unsupported".into()) }
#[cfg(not(any(target_os = "windows", unix)))]
fn raw_delete(_target: &str) -> Result<bool, String> { Ok(false) }
