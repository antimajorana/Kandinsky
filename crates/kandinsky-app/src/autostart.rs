//! `[desktop] start_at_login`: the system's own entry that starts `kandinsky-app --background` with the session — an XDG
//! autostart file on Linux, the `Run` key on Windows, a LaunchAgent on macOS (DESIGN-tray-background.md, step 5).
//! Written or removed at each start and each save of the settings, so it always names the program running now.
use std::path::{Path, PathBuf};

/// The flag the entry starts Kandinsky with: core and tray, no window until asked.
pub const BACKGROUND: &str = "--background";

/// Makes the system's entry match `on`. Errors are said, never fatal.
pub fn apply(on: bool) {
    let Ok(exe) = std::env::current_exe() else { return };
    // an AppImage runs from a temporary mount: the entry must name the AppImage file itself
    let exe = std::env::var_os("APPIMAGE").map(PathBuf::from).unwrap_or(exe);
    if let Err(e) = write(on, &exe) {
        eprintln!("kandinsky-app: starting with the session not {}: {e}", if on { "set" } else { "removed" });
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn write(on: bool, exe: &Path) -> std::io::Result<()> {
    let dir = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")));
    let Some(dir) = dir else { return Ok(()) };
    let auto = dir.join("autostart");
    sync_entry(on, &auto.join("kandinsky.desktop"), &[auto.join(kandinsky_core::legacy::AUTOSTART_DESKTOP)], &desktop_entry(exe))
}

/// Makes `file` hold `text` when `on`, else removes it. The entries an earlier build wrote under the old names (`old`,
/// legacy.rs) are removed either way: they would start the app a second time, and turning the setting off would not
/// stop it starting.
#[cfg_attr(windows, allow(dead_code))]
fn sync_entry(on: bool, file: &Path, old: &[PathBuf], text: &str) -> std::io::Result<()> {
    let remove = |f: &Path| match std::fs::remove_file(f) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    };
    for f in old {
        remove(f)?;
    }
    if !on {
        return remove(file);
    }
    std::fs::create_dir_all(file.parent().unwrap_or(Path::new(".")))?;
    if std::fs::read_to_string(file).is_ok_and(|t| t == text) {
        return Ok(());
    }
    std::fs::write(file, text)
}

/// The XDG autostart entry (KDE, GNOME, XFCE, Cinnamon read `~/.config/autostart/`).
#[cfg_attr(any(windows, target_os = "macos"), allow(dead_code))]
fn desktop_entry(exe: &Path) -> String {
    let quoted = format!("\"{}\"", exe.display().to_string().replace('\\', "\\\\").replace('"', "\\\""));
    format!(
        "[Desktop Entry]\nType=Application\nName=Kandinsky\nComment=Kandinsky in the tray: schedules and notifications from the start of the session\nExec={quoted} {BACKGROUND}\nIcon=kandinsky\nTerminal=false\nX-GNOME-Autostart-enabled=true\nX-KDE-autostart-after=panel\n"
    )
}

/// The `reg` calls that make the `Run` key match `on`: the value "Kandinsky" written or deleted, and the value an
/// earlier build wrote under the old name (legacy.rs) deleted either way, so the app is never started twice.
#[cfg_attr(not(windows), allow(dead_code))]
fn run_key_calls(on: bool, exe: &Path) -> Vec<Vec<String>> {
    let key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run".to_string();
    let delete = |name: &str| ["delete", &key, "/v", name, "/f"].map(String::from).to_vec();
    let mut calls = vec![delete(kandinsky_core::legacy::AUTOSTART_VALUE)];
    if on {
        calls.push(["add", &key, "/v", "Kandinsky", "/t", "REG_SZ", "/f", "/d", &format!("\"{}\" {BACKGROUND}", exe.display())].map(String::from).to_vec());
    } else {
        calls.push(delete("Kandinsky"));
    }
    calls
}

#[cfg(windows)]
fn write(on: bool, exe: &Path) -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;
    const NO_WINDOW: u32 = 0x0800_0000;
    for args in run_key_calls(on, exe) {
        let adding = args[0] == "add";
        let out = std::process::Command::new("reg").args(&args).creation_flags(NO_WINDOW).output()?;
        // deleting a value that is not there fails: nothing to remove
        if adding && !out.status.success() {
            return Err(std::io::Error::other(String::from_utf8_lossy(&out.stderr).trim().to_string()));
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn write(on: bool, exe: &Path) -> std::io::Result<()> {
    let Some(home) = std::env::var_os("HOME") else { return Ok(()) };
    let agents = PathBuf::from(home).join("Library/LaunchAgents");
    let esc = |s: &str| s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
    let text = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\"><dict>\n  <key>Label</key><string>org.kandinsky.app</string>\n  <key>ProgramArguments</key><array><string>{}</string><string>{BACKGROUND}</string></array>\n  <key>RunAtLoad</key><true/>\n  <key>ProcessType</key><string>Interactive</string>\n</dict></plist>\n",
        esc(&exe.display().to_string())
    );
    sync_entry(on, &agents.join("org.kandinsky.app.plist"), &[agents.join(kandinsky_core::legacy::LAUNCH_AGENT)], &text)
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_autostart_entry_starts_this_program_in_the_background_quoted() {
        let e = super::desktop_entry(std::path::Path::new("/opt/My Apps/kandinsky-app"));
        assert!(e.contains("Exec=\"/opt/My Apps/kandinsky-app\" --background\n"), "{e}");
        assert!(e.starts_with("[Desktop Entry]\nType=Application\n"));
    }

    /// Linux's autostart file and macOS's LaunchAgent: the one an earlier build wrote goes, on and off.
    #[test]
    fn the_entry_of_an_earlier_build_is_removed_on_and_off() {
        let d = tempfile::tempdir().unwrap();
        let (new, old) = (d.path().join("autostart/kandinsky.desktop"), d.path().join("autostart/atlas.desktop"));
        std::fs::create_dir_all(old.parent().unwrap()).unwrap();
        std::fs::write(&old, "old").unwrap();
        super::sync_entry(true, &new, std::slice::from_ref(&old), "entry").unwrap();
        assert_eq!(std::fs::read_to_string(&new).unwrap(), "entry");
        assert!(!old.exists(), "never started twice");
        std::fs::write(&old, "old").unwrap();
        super::sync_entry(false, &new, std::slice::from_ref(&old), "entry").unwrap();
        assert!(!new.exists() && !old.exists(), "off is off");
        super::sync_entry(false, &new, &[old], "entry").unwrap();
    }

    #[test]
    fn the_run_key_gets_the_new_value_and_loses_the_old_one() {
        // the calls only, never run here: a test does not touch the registry
        let exe = std::path::Path::new(r"C:\Apps\Kandinsky\kandinsky-app.exe");
        let on = super::run_key_calls(true, exe);
        assert_eq!(on.len(), 2);
        assert_eq!(on[0][..4], ["delete".to_string(), r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run".into(), "/v".into(), "Atlas".into()]);
        assert_eq!((on[1][0].as_str(), on[1][3].as_str()), ("add", "Kandinsky"));
        assert_eq!(on[1].last().unwrap(), "\"C:\\Apps\\Kandinsky\\kandinsky-app.exe\" --background");
        let off = super::run_key_calls(false, exe);
        assert_eq!(off.iter().map(|c| (c[0].as_str(), c[3].as_str())).collect::<Vec<_>>(), [("delete", "Atlas"), ("delete", "Kandinsky")]);
    }
}
