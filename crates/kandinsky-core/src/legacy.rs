//! The names Kandinsky had before the project was renamed (it is based on Atlas), kept in one place: data written
//! by an earlier build (a vault's state folder, the app's folders, notes, calendars) and programs built against it
//! (installed plugins, the phone app, an older core) still use them, so they are read, accepted or migrated, never
//! written anew.

/// A vault's state folder before the rename; now [`crate::state_dir::STATE_DIR`].
pub const STATE_DIR: &str = ".atlas";
/// The temporary twin of a file being saved (`.<name>.atlas-tmp-<pid>-<nanos>`), still written by older helpers.
pub const WRITE_TMP: &str = ".atlas-tmp-";
/// The app's own sub-folder in the per-user folders (`%APPDATA%\atlas`, `~/.config/atlas`…).
pub const APP_DIR: &str = "atlas";
/// The desktop program's name before the rename, looked for beside the running one.
pub const APP_EXE: &str = "atlas-app";
/// The prefix of the environment variables before the rename (`ATLAS_ROOT`…).
pub const ENV_PREFIX: &str = "ATLAS_";
/// The request header a browser page cannot set (CSRF guard), and the token and client headers.
pub const HEADER: &str = "x-atlas";
pub const TOKEN_HEADER: &str = "x-atlas-token";
pub const CLIENT_HEADER: &str = "x-atlas-client";
/// The desktop app's identifier (WebView data folder, Windows notification identity).
pub const APP_ID: &str = "dev.atlas.app";
/// The file-name prefix of plugin archives in upstream's releases.
pub const RELEASE_PREFIX: &str = "atlas-plugin-";
/// The `app=` an installed phone app sends when it signs in, and its return-scheme prefix.
pub const PHONE_APP: &str = "atlas";
pub const PHONE_APP_SCHEME: &str = "org.atlas.app";
/// The return schemes of the capture-only and Boox editions installed before the rename: they sign in with `app=capture`
/// and `app=boox` (the renamed editions send `kandinsky-capture` and `kandinsky-boox`).
pub const PHONE_CAPTURE_SCHEME: &str = "org.atlas.capture";
pub const PHONE_BOOX_SCHEME: &str = "org.atlas.boox";
/// The start of the comment markers written into notes (`<!-- atlas:no-tasks -->`, `<!-- atlas:drawing …`), and of
/// a closing one (`<!-- /atlas:drawing -->`).
pub const MARKER: &str = "<!-- atlas:";
pub const MARKER_END: &str = "<!-- /atlas:";
/// The value of the stroke-recogniser setting before the rename (`shapes = "atlas"`).
pub const SHAPES: &str = "atlas";
/// The Windows `Run` value that started the app with the session.
pub const AUTOSTART_VALUE: &str = "Atlas";
/// The same on Linux (an XDG autostart file) and macOS (a LaunchAgent): removed when the setting is applied.
pub const AUTOSTART_DESKTOP: &str = "atlas.desktop";
pub const LAUNCH_AGENT: &str = "org.atlas.app.plist";
/// The capture box's global key as an earlier build bound it: KDE's entry in `kglobalshortcutsrc` and GNOME's custom
/// keybinding path; removed when the key is set, or it would keep claiming the key.
pub const CAPTURE_KDE_ENTRY: &str = "atlas-capture.desktop";
pub const CAPTURE_GNOME_PATH: &str = "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/atlas-capture/";

/// `text` with every legacy marker rewritten to the current one (`<!-- atlas:` → `<!-- kandinsky:`, `<!-- /atlas:` →
/// `<!-- /kandinsky:`), for readers that look for the current marker: a note written by an earlier build reads the
/// same, and is written back with the current markers.
pub fn current_markers(text: &str) -> std::borrow::Cow<'_, str> {
    if text.contains(MARKER) || text.contains(MARKER_END) {
        std::borrow::Cow::Owned(text.replace(MARKER, "<!-- kandinsky:").replace(MARKER_END, "<!-- /kandinsky:"))
    } else {
        std::borrow::Cow::Borrowed(text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markers_read_both_spellings() {
        assert_eq!(current_markers("a <!-- atlas:no-tasks --> b"), "a <!-- kandinsky:no-tasks --> b");
        assert!(matches!(current_markers("<!-- kandinsky:no-tasks -->"), std::borrow::Cow::Borrowed(_)));
        assert_eq!(current_markers("an atlas of maps"), "an atlas of maps");
        assert_eq!(current_markers("<!-- atlas:drawing x -->\nbody\n<!-- /atlas:drawing -->"), "<!-- kandinsky:drawing x -->\nbody\n<!-- /kandinsky:drawing -->");
    }
}
