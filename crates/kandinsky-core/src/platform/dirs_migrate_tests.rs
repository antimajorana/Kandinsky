//! The app folders' migration rules, each on throwaway folders (never the user's: every path is given in the plan).
use super::*;
use std::fs;

fn real_rename(from: &Path, to: &Path) -> io::Result<()> {
    fs::rename(from, to)
}

fn refuse(_: &Path, _: &Path) -> io::Result<()> {
    Err(io::Error::new(io::ErrorKind::PermissionDenied, "held open"))
}

/// A roaming folder of an earlier build: its vault list naming the welcome vault inside it and a vault elsewhere,
/// the welcome vault's secrets named by its path.
fn roaming(top: &Path) -> (Plan, PathBuf) {
    let (old, new) = (top.join("atlas"), top.join("kandinsky"));
    fs::create_dir_all(old.join("Welcome/.atlas")).unwrap();
    let welcome = old.join("Welcome");
    let elsewhere = top.join("Notes");
    fs::create_dir_all(&elsewhere).unwrap();
    let list = format!(
        "# Vaults Kandinsky has opened (most recent first). Removing an entry only forgets it.\n[[vault]]\nname = \"Notes\"\npath = {:?}\nlast_opened = 2\n\n[[vault]]\nname = \"Welcome\"\npath = {:?}\nlast_opened = 1\n",
        elsewhere.to_string_lossy(),
        welcome.to_string_lossy()
    );
    fs::write(old.join("vaults.toml"), list).unwrap();
    let secret = crate::secrets::Store::in_dir(&old.join("secrets"), &welcome).file().to_path_buf();
    fs::create_dir_all(secret.parent().unwrap()).unwrap();
    fs::write(&secret, "{\"p\":{\"token\":\"fake\"}}").unwrap();
    let plan = Plan {
        whole: vec![(old.clone(), new.clone())],
        list: (old.join("vaults.toml"), new.join("vaults.toml")),
        secrets: (old.join("secrets"), new.join("secrets")),
        ..Plan::default()
    };
    (plan, elsewhere)
}

#[test]
fn only_the_old_folder_is_renamed_and_its_vault_and_secrets_follow() {
    let d = tempfile::tempdir().unwrap();
    let top = d.path().canonicalize().unwrap();
    let (plan, elsewhere) = roaming(&top);
    let said = run(&plan, &real_rename);
    let new = top.join("kandinsky");
    assert!(!top.join("atlas").exists() && new.join("Welcome/.atlas").is_dir(), "{said:?}");
    let list = fs::read_to_string(new.join("vaults.toml")).unwrap();
    assert!(list.starts_with("# Vaults Kandinsky has opened"), "the comment is kept: {list}");
    let t: toml::Table = toml::from_str(&list).unwrap();
    let paths: Vec<&str> = t["vault"].as_array().unwrap().iter().map(|v| v["path"].as_str().unwrap()).collect();
    assert_eq!(paths, [elsewhere.to_string_lossy(), new.join("Welcome").to_string_lossy()], "a vault elsewhere keeps its path");
    let secret = crate::secrets::Store::in_dir(&new.join("secrets"), &new.join("Welcome")).file().to_path_buf();
    assert_eq!(fs::read_to_string(&secret).unwrap(), "{\"p\":{\"token\":\"fake\"}}", "{said:?}");
    assert_eq!(fs::read_dir(new.join("secrets")).unwrap().count(), 1, "renamed, not copied");
    assert_eq!(super::super::dirs::resolve(&top), new);
}

#[test]
fn a_new_folder_that_holds_files_wins_and_both_are_reported() {
    let d = tempfile::tempdir().unwrap();
    let top = d.path().canonicalize().unwrap();
    let (plan, _) = roaming(&top);
    fs::create_dir_all(top.join("kandinsky/Welcome")).unwrap();
    let said = run(&plan, &|_, _| panic!("nothing is renamed when both hold files"));
    let both = top.join("atlas").display().to_string();
    assert!(said.iter().any(|s| s.starts_with("both") && s.contains(&both) && s.contains(&top.join("kandinsky").display().to_string())), "said, with both paths: {said:?}");
    assert!(top.join("atlas/vaults.toml").is_file(), "the old folder is not deleted");
    assert!(!top.join("kandinsky/vaults.toml").exists(), "nor merged into the new one");
    assert_eq!(super::super::dirs::resolve(&top), top.join("kandinsky"));
}

/// Something that did not migrate made the new folder and left it empty: it does not hide the old one for good.
#[test]
fn an_empty_new_folder_counts_as_missing() {
    let d = tempfile::tempdir().unwrap();
    let top = d.path().canonicalize().unwrap();
    let (plan, _) = roaming(&top);
    fs::create_dir_all(top.join("kandinsky")).unwrap();
    let said = run(&plan, &real_rename);
    assert!(!top.join("atlas").exists() && top.join("kandinsky/vaults.toml").is_file(), "{said:?}");
    let t: toml::Table = toml::from_str(&fs::read_to_string(top.join("kandinsky/vaults.toml")).unwrap()).unwrap();
    assert_eq!(t["vault"][1]["path"].as_str().unwrap(), top.join("kandinsky").join("Welcome").to_string_lossy(), "the welcome vault follows: {said:?}");
    assert_eq!(rename_whole(&top.join("gone"), &top.join("kandinsky"), &|_, _| panic!("no old folder")).unwrap(), Whole::Nothing);
}

#[test]
fn nothing_moves_while_an_earlier_build_serves_a_vault_of_the_list() {
    let d = tempfile::tempdir().unwrap();
    let top = d.path().canonicalize().unwrap();
    let (plan, elsewhere) = roaming(&top);
    assert_eq!(older_build_serves(&plan, &|_| false), None);
    assert_eq!(older_build_serves(&plan, &|p| p == elsewhere), Some(elsewhere.clone()));
    // the same check on the list once it moved (a build from before the rename started after the move)
    let moved = Plan { list: (top.join("none.toml"), plan.list.0.clone()), ..plan.clone() };
    assert_eq!(older_build_serves(&moved, &|p| p == elsewhere), Some(elsewhere));
}

#[test]
fn a_failed_rename_keeps_the_old_folder_in_use() {
    let d = tempfile::tempdir().unwrap();
    let top = d.path().canonicalize().unwrap();
    let (plan, _) = roaming(&top);
    let said = run(&plan, &refuse);
    assert!(said.iter().any(|s| s.contains("stays in use") && s.contains("held open")), "{said:?}");
    assert!(top.join("atlas/vaults.toml").is_file() && !top.join("kandinsky").exists());
    assert_eq!(super::super::dirs::resolve(&top), top.join("atlas"), "the app keeps using the old folder");
}

/// Linux: the vault list (config) and the welcome vault (data) are in two folders. The config folder cannot move, the
/// data folder does: the list where it stayed follows the welcome vault, and so do its secrets.
#[test]
fn a_vault_list_left_behind_still_follows_a_vault_that_moved() {
    let d = tempfile::tempdir().unwrap();
    let top = d.path().canonicalize().unwrap();
    let (config, data) = (top.join("config"), top.join("share"));
    let welcome = data.join("atlas/Welcome");
    fs::create_dir_all(welcome.join(".atlas")).unwrap();
    fs::create_dir_all(config.join("atlas")).unwrap();
    fs::write(config.join("atlas/vaults.toml"), format!("[[vault]]\nname = \"Welcome\"\npath = {:?}\n", welcome.to_string_lossy())).unwrap();
    let secret = crate::secrets::Store::in_dir(&config.join("atlas/secrets"), &welcome).file().to_path_buf();
    fs::create_dir_all(secret.parent().unwrap()).unwrap();
    fs::write(&secret, "{}").unwrap();
    let plan = Plan {
        whole: vec![(config.join("atlas"), config.join("kandinsky")), (data.join("atlas"), data.join("kandinsky"))],
        list: (config.join("atlas/vaults.toml"), config.join("kandinsky/vaults.toml")),
        secrets: (config.join("atlas/secrets"), config.join("kandinsky/secrets")),
        ..Plan::default()
    };
    let rename = |from: &Path, to: &Path| if from == config.join("atlas") { refuse(from, to) } else { real_rename(from, to) };
    let said = run(&plan, &rename);
    let moved = data.join("kandinsky/Welcome");
    assert!(moved.join(".atlas").is_dir() && config.join("atlas/vaults.toml").is_file(), "{said:?}");
    let t: toml::Table = toml::from_str(&fs::read_to_string(config.join("atlas/vaults.toml")).unwrap()).unwrap();
    assert_eq!(t["vault"][0]["path"].as_str().unwrap(), moved.to_string_lossy(), "{said:?}");
    let now = crate::secrets::Store::in_dir(&config.join("atlas/secrets"), &moved).file().to_path_buf();
    assert!(now.is_file() && !secret.is_file(), "the secrets take the new path's name: {said:?}");
}

#[test]
fn an_old_folder_that_is_a_link_is_not_renamed() {
    let d = tempfile::tempdir().unwrap();
    let top = d.path().canonicalize().unwrap();
    let target = top.join("real");
    fs::create_dir_all(&target).unwrap();
    #[cfg(unix)]
    let linked = std::os::unix::fs::symlink(&target, top.join("atlas"));
    #[cfg(windows)]
    let linked = std::os::windows::fs::symlink_dir(&target, top.join("atlas"));
    if let Err(e) = linked {
        eprintln!("skipped: this system refused a directory link ({e})");
        return;
    }
    assert_eq!(rename_whole(&top.join("atlas"), &top.join("kandinsky"), &|_, _| panic!("a link is left")).unwrap(), Whole::Nothing);
}

#[test]
fn the_local_folder_gives_up_only_its_state_entries() {
    let d = tempfile::tempdir().unwrap();
    let local = d.path().canonicalize().unwrap();
    let (old, new) = (local.join("atlas"), local.join("kandinsky"));
    fs::create_dir_all(old.join("guests/0123/.atlas")).unwrap();
    fs::create_dir_all(old.join("webview2-extensions")).unwrap();
    for f in ["desktop-port", "device-id", "server.json", "kandinsky-app.exe", "toast-icon.png"] {
        fs::write(old.join(f), f).unwrap();
    }
    // already moved by an earlier start: the new one is kept
    fs::create_dir_all(&new).unwrap();
    fs::write(new.join("device-id"), "newer").unwrap();
    let plan = Plan { entries: vec![(old.clone(), new.clone())], ..Plan::default() };
    let said = run(&plan, &real_rename);
    for f in ["desktop-port", "server.json", "guests/0123/.atlas"] {
        assert!(new.join(f).exists() && !old.join(f).exists(), "{f} moved: {said:?}");
    }
    assert_eq!(fs::read_to_string(new.join("device-id")).unwrap(), "newer");
    assert_eq!(fs::read_to_string(old.join("device-id")).unwrap(), "device-id", "the old one is left, not merged");
    for f in ["kandinsky-app.exe", "toast-icon.png", "webview2-extensions"] {
        assert!(old.join(f).exists() && !new.join(f).exists(), "{f} stays (the program, and caches made again)");
    }
}

#[test]
fn a_local_entry_that_cannot_move_stays_and_the_rest_go_on() {
    let d = tempfile::tempdir().unwrap();
    let local = d.path().canonicalize().unwrap();
    let (old, new) = (local.join("atlas"), local.join("kandinsky"));
    fs::create_dir_all(&old).unwrap();
    fs::write(old.join("desktop-port"), "4567").unwrap();
    fs::write(old.join("server.json"), "{}").unwrap();
    let rename = |from: &Path, to: &Path| if from.ends_with("desktop-port") { refuse(from, to) } else { real_rename(from, to) };
    let mut said = vec![];
    move_entries(&old, &new, &LOCAL_ENTRIES, &rename, &mut said);
    assert!(old.join("desktop-port").is_file() && new.join("server.json").is_file(), "{said:?}");
    assert!(said.iter().any(|s| s.contains("desktop-port") && s.contains("held open")));
    // each entry is looked up on its own: the one that stayed is still used where it is, the moved one where it went
    let entry = |name| super::super::dirs::resolve_entry(&local, name);
    assert_eq!(entry("desktop-port"), old.join("desktop-port"), "not a fresh port beside the old one");
    assert_eq!(entry("server.json"), new.join("server.json"));
    assert_eq!(entry("device-id"), new.join("device-id"), "in neither: made in the new folder");
}

/// The installer makes `%LOCALAPPDATA%\kandinsky` (the program's own folder) before anything migrated: a program run
/// before the desktop app still finds the state the earlier build left in the old folder.
#[test]
fn the_install_folder_does_not_hide_the_old_state_entries() {
    let d = tempfile::tempdir().unwrap();
    let local = d.path().canonicalize().unwrap();
    let (old, new) = (local.join("atlas"), local.join("kandinsky"));
    fs::create_dir_all(old.join("capture-drafts")).unwrap();
    fs::write(old.join("device-id"), "old-device").unwrap();
    fs::create_dir_all(&new).unwrap();
    fs::write(new.join("kandinsky-app.exe"), "").unwrap();
    assert_eq!(super::super::dirs::resolve(&local), new, "the folder as a whole is the new one");
    let entry = |name| super::super::dirs::resolve_entry(&local, name);
    assert_eq!(entry("device-id"), old.join("device-id"));
    assert_eq!(entry("capture-drafts"), old.join("capture-drafts"));
    let plan = Plan { entries: vec![(old.clone(), new.clone())], ..Plan::default() };
    run(&plan, &real_rename);
    assert_eq!(entry("device-id"), new.join("device-id"));
    assert_eq!(fs::read_to_string(new.join("device-id")).unwrap(), "old-device", "the same id, moved");
}

#[test]
fn the_window_data_moves_once_and_a_failure_is_reported() {
    let d = tempfile::tempdir().unwrap();
    let local = d.path().canonicalize().unwrap();
    let (old, new) = (local.join("dev.atlas.app"), local.join("dev.kandinsky.app"));
    let m = Some("EBWebView");
    assert!(!move_webview(&old, &new, m, &real_rename).unwrap(), "nothing there: nothing to do");
    fs::create_dir_all(old.join("EBWebView/Default/Local Storage")).unwrap();
    assert!(move_webview(&old, &new, m, &refuse).is_err());
    assert!(old.join("EBWebView").is_dir());
    // a window opened without the old folder made an empty one under the new name: it does not win
    fs::create_dir_all(&new).unwrap();
    assert!(move_webview(&old, &new, m, &real_rename).unwrap());
    assert!(new.join("EBWebView/Default/Local Storage").is_dir() && !old.exists());
    fs::create_dir_all(old.join("EBWebView")).unwrap();
    assert!(!move_webview(&old, &new, m, &|_, _| panic!("the new one wins")).unwrap());
}

#[test]
fn a_new_window_folder_holding_other_files_keeps_the_old_profile_in_use() {
    let d = tempfile::tempdir().unwrap();
    let local = d.path().canonicalize().unwrap();
    let (old, new) = (local.join("dev.atlas.app"), local.join("dev.kandinsky.app"));
    fs::create_dir_all(old.join("EBWebView")).unwrap();
    fs::create_dir_all(&new).unwrap();
    fs::write(new.join("other"), "").unwrap();
    assert!(move_webview(&old, &new, Some("EBWebView"), &real_rename).is_err(), "never moved over other files");
    assert!(holds_profile(&old, Some("EBWebView")) && !holds_profile(&new, Some("EBWebView")));
    // Linux: no marker, any entry is the profile (WebKitGTK's folders)
    let (lo, ln) = (local.join("share/dev.atlas.app"), local.join("share/dev.kandinsky.app"));
    fs::create_dir_all(lo.join("localstorage")).unwrap();
    assert!(move_webview(&lo, &ln, None, &real_rename).unwrap());
    assert!(ln.join("localstorage").is_dir() && !lo.exists());
}
