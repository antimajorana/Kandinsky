//! The user's folders per operating system. `XDG_*` variables win everywhere when set (tests point them at a
//! throwaway folder on every OS); otherwise Linux uses the XDG defaults, macOS `~/Library/…`, Windows the known
//! folders from the environment (`%APPDATA%`, `%LOCALAPPDATA%`).
use std::path::{Path, PathBuf};

/// The kinds of per-user folder Kandinsky keeps things in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Base {
    /// Settings the user may edit (`vaults.toml`, `server.toml`).
    Config,
    /// Things kept across runs that are not settings (sessions, the device id).
    State,
    /// Installed data (the UI, the welcome vault).
    Data,
    /// Re-creatable downloads (filter lists).
    Cache,
    /// Per-login secrets that must not outlive it or be synced (the local key).
    Runtime,
}

/// The home folder: `$HOME`, else `%USERPROFILE%` (Windows sets only the latter).
pub fn home() -> Option<PathBuf> {
    [std::env::var_os("HOME"), std::env::var_os("USERPROFILE")].into_iter().flatten().find(|h| !h.is_empty()).map(PathBuf::from)
}

/// The OS folder for `base`, without Kandinsky's own sub-folder.
pub fn base(base: Base) -> PathBuf {
    let var = |name: &str| std::env::var_os(name).filter(|v| !v.is_empty()).map(PathBuf::from);
    let xdg = match base {
        Base::Config => "XDG_CONFIG_HOME",
        Base::State => "XDG_STATE_HOME",
        Base::Data => "XDG_DATA_HOME",
        Base::Cache => "XDG_CACHE_HOME",
        Base::Runtime => "XDG_RUNTIME_DIR",
    };
    // inside the Flatpak the XDG variables name the sandbox's own folders (`~/.var/app/<id>/…`): Kandinsky keeps to the
    // user's, the same the installed binaries use (the vault list, the secrets, the device id — one Kandinsky either way);
    // the sandbox may write them (`--filesystem=home`, `xdg-run/kandinsky`)
    if let Some(p) = var(xdg).filter(|p| !flatpak_own(p)) {
        return p;
    }
    let home = home().unwrap_or_default();
    if cfg!(windows) {
        // roaming for what the user would want on another machine, local for the rest
        let roaming = || var("APPDATA").unwrap_or_else(|| home.join("AppData/Roaming"));
        let local = || var("LOCALAPPDATA").unwrap_or_else(|| home.join("AppData/Local"));
        match base {
            Base::Config | Base::Data => roaming(),
            Base::State | Base::Cache => local(),
            Base::Runtime => std::env::temp_dir(),
        }
    } else if cfg!(target_os = "macos") {
        match base {
            Base::Config | Base::Data | Base::State => home.join("Library/Application Support"),
            Base::Cache => home.join("Library/Caches"),
            Base::Runtime => std::env::temp_dir(),
        }
    } else {
        match base {
            Base::Config => home.join(".config"),
            Base::State => home.join(".local/state"),
            Base::Data => home.join(".local/share"),
            Base::Cache => home.join(".cache"),
            Base::Runtime => std::env::temp_dir(),
        }
    }
}

/// A folder the Flatpak gave this app as its own (`~/.var/app/<FLATPAK_ID>/…`), not the user's.
fn flatpak_own(p: &Path) -> bool {
    sandbox_own(p, std::env::var_os("FLATPAK_ID").as_deref(), home().as_deref())
}

fn sandbox_own(p: &Path, id: Option<&std::ffi::OsStr>, home: Option<&Path>) -> bool {
    match (id, home) {
        (Some(id), Some(h)) => p.starts_with(h.join(".var/app").join(id)),
        _ => false,
    }
}

/// Kandinsky's folder of `kind`: [`base`]`/kandinsky`. Until the desktop app has migrated the folder of a build from
/// before the rename ([`super::dirs_migrate`]), the old one (`<base>/atlas`) when only that one is there, so its
/// settings, sessions and vault list stay in use and nothing new is made beside them. Only a lookup: nothing is moved.
pub fn app(kind: Base) -> PathBuf {
    resolve(&base(kind))
}

/// `<base>/kandinsky` when it exists or `<base>/atlas` does not, else `<base>/atlas`.
pub fn resolve(base: &Path) -> PathBuf {
    let (new, old) = (base.join(APP_DIR), base.join(crate::legacy::APP_DIR));
    if new.symlink_metadata().is_err() && old.is_dir() {
        old
    } else {
        new
    }
}

/// The file or folder `name` in Kandinsky's folder of `kind`. On Windows the local folder of a build from before the
/// rename is never moved whole (it is also where the program is installed, so `%LOCALAPPDATA%\kandinsky` exists from the
/// install on): its state entries move one by one (`dirs_migrate::LOCAL_ENTRIES`), and each is looked up on its own
/// ([`resolve_entry`]), so one that has not moved yet, or could not, stays in use where it is.
pub fn app_entry(kind: Base, name: &str) -> PathBuf {
    if cfg!(windows) && matches!(kind, Base::State | Base::Cache) {
        resolve_entry(&base(kind), name)
    } else {
        app(kind).join(name)
    }
}

/// `<base>/kandinsky/<name>` when it exists, else `<base>/atlas/<name>` when that exists, else the new one.
pub fn resolve_entry(base: &Path, name: &str) -> PathBuf {
    let (new, old) = (base.join(APP_DIR).join(name), base.join(crate::legacy::APP_DIR).join(name));
    if new.symlink_metadata().is_err() && old.symlink_metadata().is_ok() {
        old
    } else {
        new
    }
}

/// Kandinsky's sub-folder in each per-user folder.
pub const APP_DIR: &str = "kandinsky";

/// `~/x` → the home folder joined with `x`; anything else unchanged. (`~\x` too on Windows.)
pub fn expand_tilde(p: &str) -> PathBuf {
    let rest = p.strip_prefix("~/").or_else(|| if cfg!(windows) { p.strip_prefix("~\\") } else { None });
    match (rest, home()) {
        (Some(rest), Some(h)) => h.join(rest),
        _ => PathBuf::from(p),
    }
}

/// The reverse of [`expand_tilde`], for showing a path: under home → `~/…`.
pub fn tilde(p: &Path) -> String {
    match home().and_then(|h| p.strip_prefix(h).ok().map(Path::to_path_buf)) {
        Some(rest) => format!("~/{}", rest.display()),
        None => p.display().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_folder_is_the_new_one_unless_only_the_old_one_is_there() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(resolve(d.path()), d.path().join("kandinsky"), "neither: the new one");
        std::fs::create_dir(d.path().join("atlas")).unwrap();
        assert_eq!(resolve(d.path()), d.path().join("atlas"), "only the old one: still used");
        std::fs::create_dir(d.path().join("kandinsky")).unwrap();
        assert_eq!(resolve(d.path()), d.path().join("kandinsky"), "both: the new one");
    }

    #[test]
    fn tilde_round_trips_under_home() {
        let Some(h) = home() else { return };
        let p = expand_tilde("~/notes/a.md");
        assert_eq!(p, h.join("notes/a.md"));
        assert_eq!(tilde(&p), "~/notes/a.md");
        assert_eq!(expand_tilde("/abs/x"), PathBuf::from("/abs/x"));
        assert_eq!(expand_tilde("rel/x"), PathBuf::from("rel/x"));
    }

    #[test]
    fn inside_the_flatpak_its_own_folders_are_not_kandinskys() {
        let (h, id) = (Path::new("/home/u"), Some(std::ffi::OsStr::new("io.github.alneb.Kandinsky")));
        assert!(sandbox_own(Path::new("/home/u/.var/app/io.github.alneb.Kandinsky/config"), id, Some(h)), "the sandbox's config: not used");
        assert!(!sandbox_own(Path::new("/home/u/.config"), id, Some(h)), "the user's own");
        assert!(!sandbox_own(Path::new("/home/u/.var/app/io.github.alneb.Kandinsky/config"), None, Some(h)), "outside a Flatpak nothing changes");
        assert!(!sandbox_own(Path::new("/home/u/.var/app/org.other.App/config"), id, Some(h)), "another app's is not ours to judge");
    }
}
