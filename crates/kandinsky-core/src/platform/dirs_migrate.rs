//! Moving the per-user folders of a build from before the rename (`<base>/atlas`, legacy.rs) to `<base>/kandinsky`.
//! Only the desktop app runs it ([`migrate`]), once at its start, before anything opens those folders; everything else
//! only looks them up ([`super::dirs::app`] uses the old folder while it is the only one).
//!
//! The rule for each folder: the new one exists → it is used; only the old one → it is renamed; the rename fails → the
//! old one stays in use this run. Nothing is copied, merged or deleted (an empty new folder, made by something that
//! did not migrate, counts as missing and is removed first; both holding something is reported and left alone). On
//! Windows the local folder (`%LOCALAPPDATA%\atlas`) is also where the program is installed, so it is never moved
//! whole: only the entries that hold state ([`LOCAL_ENTRIES`]) go to `%LOCALAPPDATA%\kandinsky`, each looked up on its
//! own until it has moved ([`super::dirs::app_entry`]); caches there are made again. Nothing moves while a build from
//! before the rename still serves a vault (it would write its folders again, beside the moved ones).
use super::dirs::{base, Base, APP_DIR};
use std::io;
use std::path::{Path, PathBuf};

/// What the Windows local folder holds that is not made again: the desktop window's port (its page's storage is kept
/// per port), the device id (leases), sessions and tokens, agents' tokens, capture drafts, guest folders' state.
pub const LOCAL_ENTRIES: [&str; 6] = ["desktop-port", "device-id", "server.json", "agents.json", "capture-drafts", "guests"];

/// The folders to move and the files that name paths inside them.
#[derive(Debug, Clone, Default)]
pub struct Plan {
    /// Folders renamed whole: (old, new).
    pub whole: Vec<(PathBuf, PathBuf)>,
    /// Folders whose [`LOCAL_ENTRIES`] move one by one: (old, new).
    pub entries: Vec<(PathBuf, PathBuf)>,
    /// The vault list where it is now, and where it is once the folders moved.
    pub list: (PathBuf, PathBuf),
    /// The secrets folder now, and once the folders moved.
    pub secrets: (PathBuf, PathBuf),
    /// The windows' WebView data, named by the app's identifier (Windows, Linux): (old, new).
    pub webview: Option<(PathBuf, PathBuf)>,
    /// The sub-folder that shows a WebView data folder holds a profile (WebView2's `EBWebView`); none: any entry.
    pub webview_marker: Option<&'static str>,
}

/// This machine's plan, from the environment (the `XDG_*` folders, `KANDINSKY_VAULTS`, `KANDINSKY_SECRETS_DIR`…).
pub fn plan() -> Plan {
    let mut plan = Plan::default();
    for kind in [Base::Config, Base::Data, Base::State, Base::Cache] {
        let b = base(kind);
        let pair = (b.join(crate::legacy::APP_DIR), b.join(APP_DIR));
        if plan.whole.contains(&pair) || plan.entries.contains(&pair) {
            continue; // one folder for several kinds (Windows, macOS)
        }
        if cfg!(windows) && matches!(kind, Base::State | Base::Cache) {
            plan.entries.push(pair);
        } else {
            plan.whole.push(pair);
        }
    }
    let config = base(Base::Config);
    let list_at = |dir: PathBuf| crate::env::var_os("VAULTS").map(PathBuf::from).unwrap_or_else(|| dir.join("vaults.toml"));
    plan.list = (list_at(super::dirs::resolve(&config)), list_at(config.join(APP_DIR)));
    let secrets_at = |list: &Path| crate::env::var_os("SECRETS_DIR").map(PathBuf::from).unwrap_or_else(|| list.parent().map(Path::to_path_buf).unwrap_or_default().join("secrets"));
    plan.secrets = (secrets_at(&plan.list.0), secrets_at(&plan.list.1));
    if let Some((old, new, marker)) = webview_pair() {
        plan.webview = Some((old, new));
        plan.webview_marker = marker;
    }
    plan
}

/// Where the windows' WebView data is kept under the identifier before the rename and the current one, and what shows
/// a profile is there. Windows: WebView2 in `%LOCALAPPDATA%\<identifier>\EBWebView`. Linux: Tauri gives WebKitGTK
/// `$XDG_DATA_HOME/<identifier>`. (macOS keeps it by bundle id elsewhere; not moved here.)
fn webview_pair() -> Option<(PathBuf, PathBuf, Option<&'static str>)> {
    let (old, new) = (crate::legacy::APP_ID, crate::notify::APP_ID);
    if cfg!(windows) {
        let local = std::env::var_os("LOCALAPPDATA").filter(|v| !v.is_empty()).map(PathBuf::from)?;
        Some((local.join(old), local.join(new), Some("EBWebView")))
    } else if cfg!(target_os = "linux") {
        let data = base(Base::Data);
        Some((data.join(old), data.join(new), None))
    } else {
        None
    }
}

/// Runs [`plan`]: what was done, one line each (for the log). Nothing is moved while a build from before the rename
/// serves a vault of the old vault list (its `.atlas/cache/server.json` names a live process other than this one).
#[allow(clippy::disallowed_methods)] // the app's own folders, outside every vault, renamed whole
pub fn migrate() -> Vec<String> {
    let plan = plan();
    let served = |root: &Path| crate::vaults::server_in(root, &root.join(crate::legacy::STATE_DIR)).is_some_and(|f| f.pid != std::process::id());
    if let Some(vault) = older_build_serves(&plan, &served) {
        return vec![format!("an earlier build still serves {}: the app's folders are moved at a start after it stopped", vault.display())];
    }
    run(&plan, &|from, to| std::fs::rename(from, to))
}

/// A vault of the vault list (where it is now, or already moved) that `served` says an earlier build serves.
pub fn older_build_serves(plan: &Plan, served: &dyn Fn(&Path) -> bool) -> Option<PathBuf> {
    let mut paths = vault_paths(&plan.list.0);
    paths.extend(vault_paths(&plan.list.1));
    paths.into_iter().map(PathBuf::from).find(|p| served(p))
}

/// The WebView data folder every window uses this run: the old identifier's while it holds the only profile (it could
/// not be moved, or this process did not move it), else none (Tauri's default, the current identifier's). Every
/// window is given the same: one left on the default would start an empty profile under the new name, which then wins
/// at every later start.
pub fn webview_dir() -> Option<PathBuf> {
    let (old, new, marker) = webview_pair()?;
    (holds_profile(&old, marker) && !holds_profile(&new, marker)).then_some(old)
}

/// Whether `dir` holds a WebView profile: `marker` is a folder in it, or (no marker) it has any entry.
fn holds_profile(dir: &Path, marker: Option<&str>) -> bool {
    match marker {
        Some(m) => dir.join(m).is_dir(),
        None => std::fs::read_dir(dir).is_ok_and(|mut d| d.next().is_some()),
    }
}

/// What [`rename_whole`] found and did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Whole {
    /// The old folder was renamed to the new name.
    Renamed,
    /// Nothing to do: no old folder (or it is a link).
    Nothing,
    /// Both hold something: the new one is used, the old one is left as it is.
    Both,
}

/// [`migrate`] with the plan and the rename given (tests make it fail).
pub fn run(plan: &Plan, rename: &dyn Fn(&Path, &Path) -> io::Result<()>) -> Vec<String> {
    let mut said = Vec::new();
    // the secrets files are named by the vault's path: their old names are read while the old paths exist
    let vaults: Vec<String> = vault_paths(&plan.list.0).into_iter().filter(|p| plan.whole.iter().any(|(old, _)| moved_path(p, old, old).is_some())).collect();
    let olds: Vec<(String, PathBuf)> = vaults.iter().map(|p| (p.clone(), crate::secrets::Store::in_dir(&plan.secrets.0, Path::new(p)).file().to_path_buf())).collect();
    for (old, new) in &plan.entries {
        move_entries(old, new, &LOCAL_ENTRIES, rename, &mut said);
    }
    let mut renamed = Vec::new();
    for (old, new) in &plan.whole {
        match rename_whole(old, new, rename) {
            Ok(Whole::Renamed) => {
                said.push(format!("{} is now {}", old.display(), new.display()));
                renamed.push((old.clone(), new.clone()));
            }
            Ok(Whole::Nothing) => {}
            Ok(Whole::Both) => said.push(format!(
                "both {} and {} hold files: the second is used and the first is left as it is (nothing is merged; move what it holds by hand)",
                old.display(),
                new.display()
            )),
            Err(e) => said.push(format!("{} stays in use: it could not be renamed to {} ({e})", old.display(), new.display())),
        }
    }
    if !renamed.is_empty() {
        repoint(plan, &renamed, &olds, rename, &mut said);
    }
    if let Some((old, new)) = &plan.webview {
        match move_webview(old, new, plan.webview_marker, rename) {
            Ok(true) => said.push(format!("the window's data {} is now {}", old.display(), new.display())),
            Ok(false) => {}
            Err(e) => said.push(format!("the window's data stays in {} this run: it could not be renamed ({e})", old.display())),
        }
    }
    said
}

/// Whether `dir` is a folder (not a link) with nothing in it.
fn empty_dir(dir: &Path) -> bool {
    dir.symlink_metadata().is_ok_and(|m| m.is_dir()) && std::fs::read_dir(dir).is_ok_and(|mut d| d.next().is_none())
}

/// Renames `old` to `new` when `old` is a folder (not a link) and `new` is missing, or an empty folder (removed first:
/// something that did not migrate made it, and it would hide the old one for good).
#[allow(clippy::disallowed_methods)] // the parent of an app folder, outside every vault
pub fn rename_whole(old: &Path, new: &Path, rename: &dyn Fn(&Path, &Path) -> io::Result<()>) -> io::Result<Whole> {
    if !old.symlink_metadata().is_ok_and(|m| m.is_dir()) {
        return Ok(Whole::Nothing);
    }
    if new.symlink_metadata().is_ok() {
        if !empty_dir(new) {
            return Ok(Whole::Both);
        }
        std::fs::remove_dir(new)?; // only an empty folder is removed; nothing moves if that fails
    }
    if let Some(parent) = new.parent() {
        std::fs::create_dir_all(parent)?;
    }
    rename(old, new).map(|()| Whole::Renamed)
}

/// Moves each of `names` from `old` to `new` that is in `old` and not yet in `new`; `new` is made when `old` exists,
/// so the app uses it from now on.
#[allow(clippy::disallowed_methods)] // the app's local folder, outside every vault
pub fn move_entries(old: &Path, new: &Path, names: &[&str], rename: &dyn Fn(&Path, &Path) -> io::Result<()>, said: &mut Vec<String>) {
    if !old.is_dir() || old == new {
        return;
    }
    if let Err(e) = std::fs::create_dir_all(new) {
        return said.push(format!("{} stays in use: {} could not be made ({e})", old.display(), new.display()));
    }
    for name in names {
        let (from, to) = (old.join(name), new.join(name));
        if from.symlink_metadata().is_err() || to.symlink_metadata().is_ok() {
            continue;
        }
        match rename(&from, &to) {
            Ok(()) => said.push(format!("{} moved to {}", from.display(), new.display())),
            Err(e) => said.push(format!("{} stays where it is: it could not be moved ({e})", from.display())),
        }
    }
}

/// Renames the WebView data folder `old` to `new` when `old` holds a profile ([`holds_profile`]) and `new` does not. A
/// `new` with nothing in it (Tauri makes the folder for a window) is removed first; one holding other files is an
/// error, and the windows keep using `old` ([`webview_dir`]).
#[allow(clippy::disallowed_methods)] // the app's own WebView folder, outside every vault
pub fn move_webview(old: &Path, new: &Path, marker: Option<&str>, rename: &dyn Fn(&Path, &Path) -> io::Result<()>) -> io::Result<bool> {
    if !holds_profile(old, marker) || holds_profile(new, marker) {
        return Ok(false);
    }
    if new.symlink_metadata().is_ok() {
        if !empty_dir(new) {
            return Err(io::Error::new(io::ErrorKind::AlreadyExists, format!("{} holds other files", new.display())));
        }
        std::fs::remove_dir(new)?;
    }
    rename(old, new).map(|()| true)
}

/// The vault paths in the list at `list`.
fn vault_paths(list: &Path) -> Vec<String> {
    let Ok(text) = std::fs::read_to_string(list) else { return vec![] };
    let Ok(doc) = text.parse::<toml_edit::DocumentMut>() else { return vec![] };
    let Some(arr) = doc.get("vault").and_then(|v| v.as_array_of_tables()) else { return vec![] };
    arr.iter().filter_map(|t| t.get("path")?.as_str().map(str::to_string)).collect()
}

/// `p` with the folder `old` at its start replaced by `new` (compared without case on Windows), `None` when `p` is
/// not inside `old`.
fn moved_path(p: &str, old: &Path, new: &Path) -> Option<PathBuf> {
    let path = Path::new(p);
    if let Ok(rest) = path.strip_prefix(old) {
        return Some(new.join(rest));
    }
    if !cfg!(windows) {
        return None;
    }
    let (lp, lo) = (p.to_lowercase().replace('/', "\\"), old.to_string_lossy().to_lowercase().replace('/', "\\"));
    let rest = lp.strip_prefix(&lo)?;
    (rest.is_empty() || rest.starts_with('\\')).then(|| new.join(p.replace('/', "\\")[lo.len()..].trim_start_matches('\\')))
}

/// After folders moved: the vault list's paths into them follow, and those vaults' secrets files take the names of the
/// new paths (never over a file already there).
fn repoint(plan: &Plan, renamed: &[(PathBuf, PathBuf)], olds: &[(String, PathBuf)], rename: &dyn Fn(&Path, &Path) -> io::Result<()>, said: &mut Vec<String>) {
    // the list where it is now: moved with its folder, or still in the old one when that folder stayed (on Linux the
    // vault list and the welcome vault are in two folders, and one may move while the other cannot)
    let (list, secrets) = if plan.list.1.is_file() { (&plan.list.1, &plan.secrets.1) } else { (&plan.list.0, &plan.secrets.0) };
    let Ok(text) = std::fs::read_to_string(list) else { return };
    let Ok(mut doc) = text.parse::<toml_edit::DocumentMut>() else {
        return said.push(format!("{}: not read, so its paths were not changed", list.display()));
    };
    let mut moved = Vec::new();
    if let Some(arr) = doc.get_mut("vault").and_then(|v| v.as_array_of_tables_mut()) {
        for t in arr.iter_mut() {
            let Some(p) = t.get("path").and_then(|v| v.as_str()).map(str::to_string) else { continue };
            if let Some(np) = renamed.iter().find_map(|(old, new)| moved_path(&p, old, new)) {
                t["path"] = toml_edit::value(np.to_string_lossy().into_owned());
                moved.push((p, np));
            }
        }
    }
    if moved.is_empty() {
        return;
    }
    if let Err(e) = crate::vault_write::outside::write(list, doc.to_string().as_bytes()) {
        return said.push(format!("{}: the moved vaults' paths were not written ({e})", list.display()));
    }
    for (old_path, new_path) in moved {
        said.push(format!("vault {old_path} is now {}", new_path.display()));
        let Some((_, old_file)) = olds.iter().find(|(p, _)| *p == old_path) else { continue };
        let Some(old_name) = old_file.file_name() else { continue };
        // where that file is now: moved with the folder that held it, or where it was (a secrets folder set apart)
        let from = [old_file.clone(), secrets.join(old_name)].into_iter().find(|f| f.is_file());
        let to = crate::secrets::Store::in_dir(secrets, &new_path).file().to_path_buf();
        if let Some(from) = from.filter(|f| *f != to && !to.exists()) {
            match rename(&from, &to) {
                Ok(()) => said.push(format!("its secrets {} are now {}", from.display(), to.display())),
                Err(e) => said.push(format!("its secrets {} were not renamed to {} ({e})", from.display(), to.display())),
            }
        }
    }
}

#[cfg(test)]
#[path = "dirs_migrate_tests.rs"]
mod tests;
