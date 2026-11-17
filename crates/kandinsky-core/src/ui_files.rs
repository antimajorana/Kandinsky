//! The UI from disk, so a new interface needs no new program: `packaging/install.sh` copies the
//! built UI to `~/.local/share/kandinsky/ui` (or `$KANDINSKY_UI_DIR`), the server serves it from there, and
//! an open window reloads itself when its build changes (`GET /api/ui/build`; ui/src/lib/ui-reload.ts).
//! Only when `$KANDINSKY_UI_DIR` names it: the desktop app sets it (to the installed folder, when there
//! is one); `kandinsky serve` and the tests keep the UI built into the program, the one being tested.
use std::path::{Component, Path, PathBuf};

/// The stamp of the types this core speaks (build.rs); an interface built against others is not served.
pub const CORE_TYPES: &str = env!("KANDINSKY_CORE_TYPES");

/// The folder `$KANDINSKY_UI_DIR` names, when it holds an `index.html` built for this core: an interface installed for a
/// newer (or older) core would misread its answers, so the window keeps the one built into the program until restarted.
pub fn dir() -> Option<PathBuf> {
    let d = PathBuf::from(crate::env::var_os("UI_DIR")?);
    let ok = if is_installed_dir(&d) { fits_installed(&d) } else { fits(&d) };
    (d.join("index.html").is_file() && ok).then_some(d)
}

/// Whether the interface in `d` was built against this core's types (`core-types`, written by its build). The Vite
/// dev server's folder has no stamp and is always taken.
fn fits(d: &Path) -> bool {
    std::fs::read_to_string(d.join("core-types")).map_or(true, |s| s.trim() == CORE_TYPES)
}

/// Installed UI (`%APPDATA%/kandinsky/ui`, `~/.local/share/kandinsky/ui`) must carry a matching `core-types` stamp so
/// stale unstamped builds never shadow the embedded UI.
fn fits_installed(d: &Path) -> bool {
    std::fs::read_to_string(d.join("core-types")).is_ok_and(|s| s.trim() == CORE_TYPES)
}

fn installed_dir() -> PathBuf {
    crate::platform::dirs::app(crate::platform::dirs::Base::Data).join("ui")
}

fn is_installed_dir(d: &Path) -> bool {
    let inst = installed_dir();
    d == inst || matches!((crate::paths::real(d), crate::paths::real(&inst)), (Ok(a), Ok(b)) if a == b)
}

/// Where `packaging/install.sh` puts the UI: `$XDG_DATA_HOME/kandinsky/ui` (`~/.local/share/kandinsky/ui`).
pub fn installed() -> Option<PathBuf> {
    let d = installed_dir();
    (d.join("index.html").is_file() && fits_installed(&d)).then_some(d)
}

/// A file of the installed UI: its bytes and content type. Only plain relative paths (no `..`).
pub fn get(dir: &Path, path: &str) -> Option<(Vec<u8>, String)> {
    let rel = Path::new(path);
    if !rel.components().all(|c| matches!(c, Component::Normal(_))) {
        return None;
    }
    let file = dir.join(rel);
    let bytes = std::fs::read(&file).ok()?;
    Some((bytes, mime_guess::from_path(&file).first_or_octet_stream().to_string()))
}

/// What identifies the UI being served: a hash of the installed `index.html` (it names every
/// bundle by its content hash), or "built-in". A window compares it with the one it loaded — by
/// content, not modification time, so reinstalling the same interface (a commit that changed only
/// Rust or docs) does not reload the window.
pub fn build() -> String {
    dir().and_then(|d| std::fs::read(d.join("index.html")).ok()).map_or_else(
        || "built-in".into(),
        |bytes| format!("{:016x}", bytes.iter().fold(0xcbf2_9ce4_8422_2325_u64, |h, b| (h ^ u64::from(*b)).wrapping_mul(0x0100_0000_01b3))),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn files_come_from_the_folder_and_nothing_outside_it() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("index.html"), "<p>new</p>").unwrap();
        std::fs::create_dir_all(d.path().join("assets")).unwrap();
        std::fs::write(d.path().join("assets/a.js"), "x").unwrap();
        assert_eq!(get(d.path(), "assets/a.js").unwrap().1, "text/javascript");
        assert!(get(d.path(), "../etc/passwd").is_none());
        assert!(get(d.path(), "/etc/passwd").is_none());
    }

    #[test]
    fn an_interface_built_for_other_core_types_is_not_taken() {
        let d = tempfile::tempdir().unwrap();
        assert!(fits(d.path()), "no stamp: taken for explicit/dev folders");
        assert!(!fits_installed(d.path()), "no stamp: refused for installed folder");
        std::fs::write(d.path().join("core-types"), format!("{CORE_TYPES}\n")).unwrap();
        assert!(fits(d.path()));
        assert!(fits_installed(d.path()));
        std::fs::write(d.path().join("core-types"), "0123456789abcdef").unwrap();
        assert!(!fits(d.path()));
        assert!(!fits_installed(d.path()));
    }
}
