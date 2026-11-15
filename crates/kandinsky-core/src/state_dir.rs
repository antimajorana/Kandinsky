//! A vault's state folder: `.kandinsky` (settings, plugins, caches, trash), `.atlas` in a vault last opened by a build
//! from before the rename ([`crate::legacy::STATE_DIR`]).
//!
//! [`migrate`] renames `.atlas` to `.kandinsky` when a vault is opened, before anything else touches the folder. It
//! never copies, merges or deletes: when it cannot rename (the folder is a guest's link, an older core still serves the
//! vault, the rename fails), the vault keeps `.atlas`, and [`dir`] names that one, so nothing creates a second folder
//! beside it. Paths that reach the core as text (`.kandinsky/…` or `.atlas/…`, from the UI or a plugin) are mapped to
//! the folder that is there by [`live_rel`], which `paths::safe_join` applies to every vault path.
use std::borrow::Cow;
use std::path::{Path, PathBuf};

/// The state folder's name.
pub const STATE_DIR: &str = ".kandinsky";

/// Is `name` (one path component) a state folder's name, current or legacy?
pub fn is_name(name: &str) -> bool {
    name == STATE_DIR || name == crate::legacy::STATE_DIR
}

/// The name of `root`'s state folder: `.kandinsky` when it exists (as anything, a guest's link too), else `.atlas`
/// when that exists, else `.kandinsky` (a vault that has none yet gets the current one).
pub fn name(root: &Path) -> &'static str {
    if root.join(STATE_DIR).symlink_metadata().is_ok() {
        STATE_DIR
    } else if root.join(crate::legacy::STATE_DIR).symlink_metadata().is_ok() {
        crate::legacy::STATE_DIR
    } else {
        STATE_DIR
    }
}

/// `root`'s state folder ([`name`]).
pub fn dir(root: &Path) -> PathBuf {
    root.join(name(root))
}

/// `rel` under the vault with a leading state folder (either spelling, any case) turned into the one `root` has.
pub fn live_rel<'a>(root: &Path, rel: &'a str) -> Cow<'a, str> {
    match split_state(rel) {
        Some((first, rest)) => {
            let live = name(root);
            if first == live {
                Cow::Borrowed(rel)
            } else {
                Cow::Owned(format!("{live}{rest}"))
            }
        }
        None => Cow::Borrowed(rel),
    }
}

/// `rel` with a leading legacy state folder written as the current one: for comparing paths and for what the UI is
/// told, so `.atlas/plugins/x` and `.kandinsky/plugins/x` are the same file.
pub fn current_rel(rel: &str) -> Cow<'_, str> {
    match split_state(rel) {
        Some((first, rest)) if first != STATE_DIR => Cow::Owned(format!("{STATE_DIR}{rest}")),
        _ => Cow::Borrowed(rel),
    }
}

/// `rel` as found on disk under `root`, written as the page names it: inside the state folder in use, with the current
/// spelling (`.atlas/keys.toml` in a vault not yet migrated is `.kandinsky/keys.toml`, the path the UI listens for and
/// that [`live_rel`] takes back to the same file); anything else, the stale twin's files too, as it is.
pub fn told_rel<'a>(root: &Path, rel: &'a str) -> Cow<'a, str> {
    match split_state(rel) {
        Some((first, rest)) if first != STATE_DIR && first == name(root) => Cow::Owned(format!("{STATE_DIR}{rest}")),
        _ => Cow::Borrowed(rel),
    }
}

/// Is `rel` the state folder or inside it (either spelling)?
pub fn is_state_rel(rel: &str) -> bool {
    split_state(rel).is_some()
}

/// The legacy state folder's name when it is there beside `.kandinsky` ([`Migration::Both`]: `.kandinsky` is used, the
/// other left untouched). A path naming it means the folder in use ([`live_rel`]), so listings and walks leave the
/// twin out (its files would be shown under paths that open the other folder's) and nothing trashes or moves it.
pub fn stale_twin(root: &Path) -> Option<&'static str> {
    (name(root) == STATE_DIR && root.join(crate::legacy::STATE_DIR).symlink_metadata().is_ok()).then_some(crate::legacy::STATE_DIR)
}

/// Whether `rel` starts with the name of `root`'s [`stale_twin`] (either case), so it means the folder in use.
pub fn names_stale_twin(root: &Path, rel: &str) -> bool {
    split_state(rel).is_some_and(|(first, _)| stale_twin(root) == Some(first))
}

/// `root.join(rel)` with [`live_rel`] applied: for a path constant such as `config::CONFIG_FILE`.
pub fn join(root: impl AsRef<Path>, rel: &str) -> PathBuf {
    let root = root.as_ref();
    root.join(&*live_rel(root, rel))
}

/// The first component of `rel` (after `./`, `/` or `\` separated) when it is a state folder's name, ignoring case
/// (a case-insensitive disk takes `.Kandinsky` for the same folder), and the rest from its separator on.
fn split_state(rel: &str) -> Option<(&str, &str)> {
    let rel = rel.trim_start_matches("./");
    let end = rel.find(['/', '\\']).unwrap_or(rel.len());
    let (first, rest) = rel.split_at(end);
    [STATE_DIR, crate::legacy::STATE_DIR].into_iter().find(|n| first.eq_ignore_ascii_case(n)).map(|n| (n, rest))
}

/// What [`migrate`] found and did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Migration {
    /// Neither folder: nothing to do (the vault gets `.kandinsky` when something is written).
    Fresh,
    /// `.kandinsky` is there and `.atlas` is not.
    Current,
    /// Both are there: `.kandinsky` is used, `.atlas` is left as it is (never merged or deleted).
    Both,
    /// `.atlas` was renamed to `.kandinsky`.
    Renamed,
    /// `.atlas` is a link (a guest folder's, into this machine's cache) or not a folder: left alone.
    NotAFolder,
    /// An older core is serving the vault (its `.atlas/cache/server.json` names a live process): left for this run.
    ServedByOlder,
    /// The rename failed (a file held open, a read-only disk): `.atlas` is used for this run.
    RenameFailed(String),
}

/// Renames `root/.atlas` to `root/.kandinsky` when only the old one is there; see [`Migration`] for when it does not.
// the state folder itself, renamed whole before the vault is served (no guard yet, nothing written inside it)
#[allow(clippy::disallowed_methods)]
pub fn migrate(root: &Path) -> Migration {
    migrate_with(root, |from, to| std::fs::rename(from, to), served_by_other)
}

/// [`migrate`] with the rename and the "is an older core serving it" check given (tests make them fail).
pub fn migrate_with(root: &Path, rename: impl FnOnce(&Path, &Path) -> std::io::Result<()>, served: impl FnOnce(&Path, &Path) -> bool) -> Migration {
    let (new, old) = (root.join(STATE_DIR), root.join(crate::legacy::STATE_DIR));
    let old_meta = old.symlink_metadata();
    if new.symlink_metadata().is_ok() {
        return if old_meta.is_ok() { Migration::Both } else { Migration::Current };
    }
    let Ok(meta) = old_meta else { return Migration::Fresh };
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return Migration::NotAFolder;
    }
    if served(root, &old) {
        return Migration::ServedByOlder;
    }
    match rename(&old, &new) {
        Ok(()) => Migration::Renamed,
        Err(e) => Migration::RenameFailed(e.to_string()),
    }
}

/// Whether another process serves `root` from the state folder `state` (its `cache/server.json`, a live pid).
fn served_by_other(root: &Path, state: &Path) -> bool {
    crate::vaults::server_in(root, state).is_some_and(|f| f.pid != std::process::id())
}

/// [`migrate`] for a vault about to be opened, its outcome logged when there was something to say.
pub fn migrate_logged(root: &Path) -> Migration {
    let m = migrate(root);
    let shown = root.display();
    match &m {
        Migration::Renamed => eprintln!("kandinsky: {shown}: its state folder .atlas is now .kandinsky"),
        Migration::Both => eprintln!("kandinsky: {shown}: both .kandinsky and .atlas are there; .kandinsky is used and .atlas is left untouched"),
        Migration::ServedByOlder => eprintln!("kandinsky: {shown}: an older Kandinsky serves it, so .atlas is kept until that one stops"),
        Migration::RenameFailed(e) => eprintln!("kandinsky: {shown}: .atlas could not be renamed to .kandinsky ({e}); .atlas is used for now"),
        Migration::Fresh | Migration::Current | Migration::NotAFolder => {}
    }
    m
}

#[cfg(test)]
#[path = "state_dir_tests.rs"]
mod tests;
