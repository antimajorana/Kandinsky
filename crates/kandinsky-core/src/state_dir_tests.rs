//! The state folder's migration rules (`.atlas` → `.kandinsky`) and the lookups that follow the folder that is there,
//! each on a throwaway vault.
use super::*;
use std::fs;

fn vault() -> (tempfile::TempDir, PathBuf) {
    let d = tempfile::tempdir().unwrap();
    let root = crate::paths::real(d.path()).unwrap(); // as the core names it (no verbatim prefix on Windows)
    (d, root)
}

fn old_vault() -> (tempfile::TempDir, PathBuf) {
    let (d, root) = vault();
    fs::create_dir_all(root.join(".atlas/plugins/demo")).unwrap();
    fs::write(root.join(".atlas/config.toml"), "[plugins]\noff = []\n").unwrap();
    (d, root)
}

fn never_served(_: &Path, _: &Path) -> bool {
    false
}

#[test]
fn only_the_new_folder_is_used_as_it_is() {
    let (_d, root) = vault();
    fs::create_dir(root.join(".kandinsky")).unwrap();
    assert_eq!(migrate_with(&root, |_, _| panic!("no rename"), never_served), Migration::Current);
    assert_eq!(dir(&root), root.join(".kandinsky"));
}

#[test]
fn neither_folder_is_fresh_and_the_new_name_is_used() {
    let (_d, root) = vault();
    assert_eq!(migrate_with(&root, |_, _| panic!("no rename"), never_served), Migration::Fresh);
    assert_eq!(name(&root), ".kandinsky");
    assert!(!root.join(".kandinsky").exists(), "a lookup makes nothing");
}

#[test]
fn only_the_old_folder_is_renamed_with_everything_in_it() {
    let (_d, root) = old_vault();
    assert_eq!(migrate(&root), Migration::Renamed);
    assert!(!root.join(".atlas").exists());
    assert!(root.join(".kandinsky/plugins/demo").is_dir());
    assert_eq!(fs::read_to_string(root.join(".kandinsky/config.toml")).unwrap(), "[plugins]\noff = []\n");
}

#[test]
fn a_failed_rename_keeps_the_old_folder_in_use_and_makes_no_second_one() {
    let (_d, root) = old_vault();
    let m = migrate_with(&root, |_, _| Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "held open")), never_served);
    assert!(matches!(m, Migration::RenameFailed(ref e) if e.contains("held open")), "{m:?}");
    assert_eq!(name(&root), ".atlas");
    // every way the core names a state path lands in `.atlas`
    assert_eq!(join(&root, crate::config::CONFIG_FILE), root.join(".atlas/config.toml"));
    assert_eq!(crate::paths::safe_join(&root, ".kandinsky/plugins/demo").unwrap(), root.join(".atlas/plugins/demo"));
    assert_eq!(crate::Workspace::open(&root).unwrap().cache_dir(), root.join(".atlas/cache"));
    assert_eq!(crate::workspace::find_root(&root.join(".atlas/plugins")), Some(root.clone()));
    // and the config is read from there
    assert!(crate::config::Config::load(&root).is_ok());
    assert!(!root.join(".kandinsky").exists(), "nothing made a second folder");
}

#[test]
fn a_vault_left_on_the_old_folder_writes_its_state_there_and_makes_no_second_one() {
    let (_d, root) = old_vault();
    let m = migrate_with(&root, |_, _| Err(std::io::Error::other("held open")), never_served);
    assert!(matches!(m, Migration::RenameFailed(_)), "{m:?}");
    fs::create_dir_all(root.join("notes")).unwrap();
    fs::write(root.join("notes/a.md"), "a\n").unwrap();
    fs::write(root.join("notes/b.md"), "b\n").unwrap();
    // the vault's trash: a file, and lines taken out of a note
    let trashed = crate::files::to_vault_trash(&root, "notes/a.md").unwrap();
    assert!(trashed.starts_with(".kandinsky/trash/"), "told in the current spelling: {trashed}");
    assert!(crate::paths::safe_join(&root, &trashed).unwrap().starts_with(root.join(".atlas/trash")) && !root.join("notes/a.md").exists());
    let kept = crate::files::lines_to_vault_trash(&root, "notes/b.md", "- [ ] gone\n").unwrap();
    assert_eq!(fs::read_to_string(crate::paths::safe_join(&root, &kept).unwrap()).unwrap(), "- [ ] gone\n");
    // a PDF's original kept before its first overwrite
    let ws = crate::Workspace::open(&root).unwrap();
    fs::write(root.join("p.pdf"), b"%PDF-1.4 first").unwrap();
    crate::files::write_raw(&ws, "p.pdf", b"%PDF-1.4 second", None).unwrap();
    assert_eq!(fs::read(root.join(".atlas/originals/p.pdf")).unwrap(), b"%PDF-1.4 first");
    // shortcuts, captures waiting for their hooks, the plugins' cache, the merge bases
    crate::keys::set(&root, "ui.git", Some("Ctrl+Alt+G")).unwrap();
    assert!(root.join(".atlas/keys.toml").is_file());
    assert_eq!(join(&root, crate::capture::PENDING_DIR), root.join(".atlas/pending"));
    assert!(crate::mirror_guard::base_path(&root, "notes/b.md").starts_with(root.join(".atlas/cache")));
    assert!(ws.cache_dir().starts_with(root.join(".atlas")));
    assert!(!root.join(".kandinsky").exists(), "nothing made a second folder");
}

#[test]
fn both_folders_are_left_as_they_are_and_the_new_one_is_used() {
    let (_d, root) = old_vault();
    fs::create_dir_all(root.join(".kandinsky")).unwrap();
    assert_eq!(migrate_with(&root, |_, _| panic!("never merged or renamed"), never_served), Migration::Both);
    assert_eq!(name(&root), ".kandinsky");
    assert!(root.join(".atlas/config.toml").is_file(), "the old one is not deleted");
    assert_eq!(crate::paths::safe_join(&root, ".atlas/config.toml").unwrap(), root.join(".kandinsky/config.toml"));
}

#[test]
fn a_guests_old_link_is_left_alone() {
    let (_d, root) = vault();
    let elsewhere = tempfile::tempdir().unwrap();
    #[cfg(unix)]
    let linked = std::os::unix::fs::symlink(elsewhere.path(), root.join(".atlas"));
    #[cfg(windows)]
    let linked = std::os::windows::fs::symlink_dir(elsewhere.path(), root.join(".atlas"));
    if let Err(e) = linked {
        eprintln!("skipped: this system refused a directory link ({e})");
        return;
    }
    assert_eq!(migrate_with(&root, |_, _| panic!("a link is not renamed"), never_served), Migration::NotAFolder);
    assert!(root.join(".atlas").symlink_metadata().unwrap().file_type().is_symlink());
    assert!(!root.join(".kandinsky").exists());
}

/// Windows without the right to make symbolic links (the test above is then skipped): a junction, which needs none,
/// is a link too and left alone.
#[cfg(windows)]
#[test]
fn an_old_folder_that_is_a_junction_is_left_alone() {
    let (_d, root) = vault();
    let elsewhere = tempfile::tempdir().unwrap();
    let made = std::process::Command::new("cmd").arg("/C").arg("mklink").arg("/J").arg(root.join(".atlas")).arg(elsewhere.path()).output().unwrap();
    assert!(made.status.success(), "{}", String::from_utf8_lossy(&made.stderr));
    assert_eq!(migrate_with(&root, |_, _| panic!("a junction is not renamed"), never_served), Migration::NotAFolder);
    assert!(root.join(".atlas").symlink_metadata().is_ok() && !root.join(".kandinsky").exists());
    assert_eq!(name(&root), ".atlas", "the guest's link stays the state folder");
}

#[test]
fn an_old_folder_that_a_live_core_serves_is_kept_for_this_run() {
    let (_d, root) = old_vault();
    let file = |pid: u32| format!(r#"{{"port": 1, "pid": {pid}, "root": {:?}, "path": ""}}"#, root.to_string_lossy());
    fs::create_dir_all(root.join(".atlas/cache")).unwrap();
    // a live process (this one stands in for the older core) named in `.atlas/cache/server.json`
    fs::write(root.join(".atlas/cache/server.json"), file(std::process::id())).unwrap();
    let served = |r: &Path, s: &Path| crate::vaults::server_in(r, s).is_some();
    assert_eq!(migrate_with(&root, |_, _| panic!("not while served"), served), Migration::ServedByOlder);
    assert!(root.join(".atlas").is_dir());
    assert_eq!(crate::vaults::running_server(&root).as_deref(), Some("http://127.0.0.1:1"), "the older core is found");
    // a crash left the file behind: no live process, so the folder is renamed
    fs::write(root.join(".atlas/cache/server.json"), file(u32::MAX - 7)).unwrap();
    assert_eq!(migrate_with(&root, |a, b| fs::rename(a, b), served), Migration::Renamed);
}

#[test]
fn this_process_own_server_file_does_not_stop_the_rename() {
    let (_d, root) = old_vault();
    fs::create_dir_all(root.join(".atlas/cache")).unwrap();
    let text = format!(r#"{{"port": 1, "pid": {}, "root": {:?}, "path": ""}}"#, std::process::id(), root.to_string_lossy());
    fs::write(root.join(".atlas/cache/server.json"), text).unwrap();
    assert_eq!(migrate(&root), Migration::Renamed, "only another process counts as an older core");
}

#[test]
fn paths_name_the_folder_that_is_there_in_either_spelling() {
    let (_d, root) = old_vault();
    assert_eq!(live_rel(&root, ".kandinsky/config.toml"), ".atlas/config.toml");
    assert_eq!(live_rel(&root, ".atlas/config.toml"), ".atlas/config.toml");
    assert_eq!(live_rel(&root, ".Kandinsky\\plugins"), ".atlas\\plugins");
    assert_eq!(live_rel(&root, "./.kandinsky"), ".atlas");
    assert_eq!(live_rel(&root, "notes/.kandinsky/x"), "notes/.kandinsky/x", "only at the vault's top");
    assert_eq!(live_rel(&root, ".kandinskyish/x"), ".kandinskyish/x");
    assert_eq!(current_rel(".atlas/plugins/x"), ".kandinsky/plugins/x");
    assert_eq!(current_rel("notes/a.md"), "notes/a.md");
    assert!(is_state_rel(".atlas") && is_state_rel(".kandinsky/cache") && !is_state_rel("atlas/x"));
    assert!(is_name(".atlas") && is_name(".kandinsky") && !is_name(".obsidian"));
}

#[test]
fn walks_and_listings_take_the_old_folder_as_the_state_folder() {
    let cfg = crate::config::Config::default();
    assert!(crate::walk::keep(&cfg, ".atlas/pages/Inbox.page"));
    assert!(crate::walk::keep(&cfg, ".kandinsky/pages/Inbox.page"));
    assert!(!crate::walk::keep(&cfg, ".atlas/cache/x.md"));
    assert!(crate::files::is_write_tmp("notes/.a.md.atlas-tmp-1-2"));
    assert!(crate::files::is_write_tmp("notes/.a.md.kandinsky-tmp-1-2"));
    assert!(crate::vault_write::cache::is_cache(Path::new("/v/.atlas/cache/server.json")));
    assert!(crate::vault_write::cache::is_cache(Path::new("/v/.kandinsky/cache/server.json")));
}

/// Both folders (`.atlas` left beside `.kandinsky`): `.atlas/…` still means the folder in use, so the twin is neither
/// listed, walked, trashed nor moved (the live settings and plugins would go with it), and the captures an earlier
/// build queued in it are still taken.
#[test]
fn a_twin_left_beside_the_folder_in_use_is_hidden_and_never_trashed_or_moved() {
    let (_d, root) = old_vault();
    fs::create_dir_all(root.join(".kandinsky/pages")).unwrap();
    fs::write(root.join(".kandinsky/config.toml"), "# live").unwrap();
    fs::create_dir_all(root.join(".atlas/pages")).unwrap();
    fs::write(root.join(".atlas/pages/Inbox.page"), "stale").unwrap();
    fs::write(root.join(".kandinsky/pages/Inbox.page"), "live").unwrap();
    assert_eq!(stale_twin(&root), Some(".atlas"));
    assert!(names_stale_twin(&root, ".atlas") && names_stale_twin(&root, ".ATLAS/config.toml") && !names_stale_twin(&root, ".kandinsky/x"));
    let ws = crate::Workspace::open(&root).unwrap();
    let listed: Vec<String> = crate::files::tree(&ws, "", true).unwrap().into_iter().map(|e| e.name).collect();
    assert!(listed.contains(&".kandinsky".to_string()) && !listed.contains(&".atlas".to_string()), "{listed:?}");
    let cfg = crate::config::Config::default();
    let walked: Vec<String> = crate::walk::files(&root, &cfg).map(|(_, rel)| rel).collect();
    assert_eq!(walked, [".kandinsky/pages/Inbox.page"], "the twin's pages are not walked");
    assert!(crate::files::trash(&ws, ".atlas").is_err());
    assert!(crate::files::move_path(&ws, ".atlas", "old-state").is_err());
    assert!(crate::files::move_path(&ws, ".kandinsky/pages/Inbox.page", ".atlas/pages/x.page").is_err());
    assert_eq!(fs::read_to_string(root.join(".kandinsky/config.toml")).unwrap(), "# live", "the folder in use is untouched");
    assert!(root.join(".atlas/config.toml").is_file(), "and so is the twin");
    // an earlier build's queued capture, synced into the twin
    let c = crate::events::Captured::new("from an old phone".into(), "log/x.md".into(), 3);
    fs::create_dir_all(root.join(".atlas/pending")).unwrap();
    fs::write(root.join(".atlas/pending/phone.jsonl"), format!("{}\n", serde_json::to_string(&c).unwrap())).unwrap();
    assert_eq!(crate::capture::take_pending(&root), vec![c]);
    // one folder only: nothing is a twin
    let (_e, only_old) = old_vault();
    assert_eq!(stale_twin(&only_old), None);
    assert!(!names_stale_twin(&only_old, ".atlas/config.toml"));
}

/// What the page is told of a change: the folder in use with its current spelling (the UI listens for `.kandinsky/…`),
/// whatever it is called on disk; a twin left beside it keeps its own name (its paths are not the live files).
#[test]
fn changes_are_told_with_the_current_spelling_of_the_folder_in_use() {
    let (_d, root) = old_vault();
    assert_eq!(told_rel(&root, ".atlas/keys.toml"), ".kandinsky/keys.toml");
    assert_eq!(told_rel(&root, ".atlas"), ".kandinsky");
    assert_eq!(told_rel(&root, "notes/.atlas/x"), "notes/.atlas/x");
    assert_eq!(live_rel(&root, &told_rel(&root, ".atlas/keys.toml")), ".atlas/keys.toml", "and taken back to the same file");
    fs::create_dir(root.join(".kandinsky")).unwrap();
    assert_eq!(told_rel(&root, ".kandinsky/keys.toml"), ".kandinsky/keys.toml");
    assert_eq!(told_rel(&root, ".atlas/keys.toml"), ".atlas/keys.toml", "the twin's own change");
}
