//! Kandinsky desktop shell: runs kandinsky-core in-process and points one webview at it. The window is
//! just another HTTP client, so the same UI also works in a browser against `kandinsky serve`.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod autostart;
mod background;
mod browser;
mod tray;
#[cfg(target_os = "linux")]
mod tablet;
#[cfg(target_os = "linux")]
mod tray_sni;
#[cfg(not(target_os = "linux"))]
mod tray_tauri;
#[cfg(target_os = "linux")]
mod web_filters;
#[cfg(target_os = "linux")]
mod webauthn;

use std::path::PathBuf;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// WebKitGTK's DMA-BUF renderer gives a blank window with the NVIDIA proprietary driver, but
/// turning it off everywhere makes scrolling sluggish (it did on an AMD 680M). Setting
/// `ui.gpu_rendering`; an explicit env var wins. Must run before any thread exists.
fn webkit_rendering(root: &std::path::Path) {
    if !cfg!(target_os = "linux") {
        return; // a WebKitGTK setting
    }
    use kandinsky_core::config::{Config, GpuRendering};
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some() {
        return;
    }
    let mode = Config::load(root).map(|c| c.ui.gpu_rendering).unwrap_or(GpuRendering::Auto);
    let compatible = match mode {
        GpuRendering::Compatible => true,
        GpuRendering::Accelerated => false,
        // DMA-BUF kept the window's main thread busy while idle (14–41 % of a core measured on
        // 2026-10-14, 0 % without it, ~50 MB less): auto is the efficient one everywhere now
        GpuRendering::Auto => true,
    };
    if compatible {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    eprintln!("kandinsky-app: rendering {mode:?} → {}", if compatible { "compatible (no DMA-BUF)" } else { "accelerated" });
}

/// The vault to show: the folder given on the command line, else the one opened most recently,
/// else (first run) a small welcome vault that explains how to open or create one.
fn vault_to_open(asked: Option<PathBuf>) -> anyhow::Result<PathBuf> {
    use kandinsky_core::vaults;
    if let Some(known) = vaults::to_open(asked, &vaults::list_file()) {
        return Ok(known);
    }
    let welcome = kandinsky_core::platform::dirs::app(kandinsky_core::platform::dirs::Base::Data).join("Welcome");
    std::fs::create_dir_all(&welcome)?;
    let home = welcome.join("Home.page");
    if !home.exists() {
        std::fs::write(&home, WELCOME_PAGE)?;
    }
    Ok(welcome)
}

const WELCOME_PAGE: &str = r#"# The first screen of a fresh Kandinsky. This folder is a vault like any other; yours go wherever you like.
title: Welcome
rows:
  - [greeting]
  - - view: vaults
      title: Start with a vault
  - - view: text
      title: What a vault is
      text: |
        Kandinsky works on **vaults**: plain folders of notes, papers, code and data. Each vault keeps its own
        settings, plugins and pages in its `.kandinsky/` folder, so a work vault and a personal one stay apart.
        An Obsidian vault opens as it is.

        **New vault…** makes a folder (for example `~/Notes`); **Open a folder…** takes one you have. Kandinsky
        remembers it and opens it the next time it starts. Later, **Ctrl+Alt+V** switches between vaults and
        **F1** lists every command.

        This Welcome vault is only a start page; what is written here stays in Kandinsky's own data folder.
"#;

/// The desktop's core for `root`: on this machine only, locked (local_lock.rs `Lock::desktop`). It serves every vault
/// of the vault list beside `root`, each at `/v/<name>/` and started when first opened, so switching is a page load in
/// this window (server_desktop.rs).
async fn desktop_core(root: PathBuf) -> anyhow::Result<kandinsky_core::server::ServerHandle> {
    // the guest folders of the last run forgotten before any is served (core guest.rs); here, not in the core, so a
    // test's desktop-style core never touches this machine's
    let swept = tokio::task::spawn_blocking(kandinsky_core::guest::sweep).await.unwrap_or(0);
    if swept > 0 {
        eprintln!("kandinsky: {swept} guest folder(s) of the last run forgotten");
    }
    let vaults = kandinsky_core::server::Vaults::Desktop { first: root, list: kandinsky_core::vaults::list_file() };
    let port = last_port().filter(|p| std::net::TcpListener::bind(("127.0.0.1", *p)).is_ok()).unwrap_or(0);
    let core = kandinsky_core::server::serve_vaults(vaults, kandinsky_core::server::Listen::Local(port, kandinsky_core::local_lock::Lock::desktop())).await?;
    keep_port(core.port());
    Ok(core)
}

/// Where the desktop core's last port is kept. The page's origin is its address with the port, and the browser keeps
/// IndexedDB and localStorage per origin: a new port at each start lost them all (TikZ pictures drawn again, every
/// remembered pane and choice). So the core asks for its last port first, and takes any free one when it is in use.
fn port_file() -> PathBuf {
    kandinsky_core::platform::dirs::app_entry(kandinsky_core::platform::dirs::Base::State, "desktop-port")
}

fn last_port() -> Option<u16> {
    std::fs::read_to_string(port_file()).ok()?.trim().parse().ok().filter(|p| *p >= 1024)
}

fn keep_port(port: u16) {
    let file = port_file();
    let _ = file.parent().map(std::fs::create_dir_all);
    if let Err(e) = std::fs::write(&file, port.to_string()) {
        eprintln!("kandinsky-app: the port is not kept for the next start ({}): {e}", file.display());
    }
}

/// The capture box's page at a core's address or one-time link (`…/?k=code` → `…/capture.html?k=code`).
/// capture.html: the box's own small page; `#capture` too, so an older core (whose UI has no capture.html and
/// answers with the app's page) still shows the box.
fn capture_page(link: &str) -> String {
    let (base, query) = link.split_once('?').map_or((link, None), |(b, q)| (b, Some(q)));
    let page = format!("{}/capture.html", base.trim_end_matches('/'));
    match query {
        Some(q) => format!("{page}?{q}#capture"),
        None => format!("{page}#capture"),
    }
}

/// `kandinsky-app --capture`: the native box (kandinsky-capture) when the package put one beside this program — an AppImage,
/// the macOS app and the Windows install, where a shortcut can only name the app — and `KANDINSKY_CAPTURE` does not ask
/// for the web box. Its exit code; None: no native box here, the web box below opens.
fn native_capture(folder: Option<&std::path::Path>) -> Option<i32> {
    if kandinsky_core::env::var("CAPTURE").is_some_and(|v| v == "webview") {
        return None;
    }
    let boxed = capture_box()?;
    let mut cmd = std::process::Command::new(&boxed);
    cmd.args(folder);
    match cmd.status() {
        Ok(s) => Some(s.code().unwrap_or(1)),
        Err(e) => {
            eprintln!("kandinsky-app: {} did not start ({e}); the web box instead", boxed.display());
            None
        }
    }
}

/// The native capture box the package put beside this program, if it did.
fn capture_box() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    exe.with_file_name(format!("kandinsky-capture{}", std::env::consts::EXE_SUFFIX)).is_file().then(|| exe.with_file_name(format!("kandinsky-capture{}", std::env::consts::EXE_SUFFIX))).or_else(|| Some(exe.with_file_name(format!("kandinsky-capture{}", std::env::consts::EXE_SUFFIX))).filter(|b| b.is_file()))
}

/// macOS: a global key for the capture box while Kandinsky runs — `KANDINSKY_CAPTURE_KEY` (Tauri's form, e.g.
/// "Control+Super+C"; "none" for no key), Ctrl+Cmd+C by default (Cmd+Shift+C is taken by browsers and Finder).
/// The box opens on the vault this window shows.
#[cfg(target_os = "macos")]
fn capture_key(vault: PathBuf) -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri_plugin_global_shortcut::{Builder, Shortcut, ShortcutState};
    let builder = Builder::new().with_handler(move |_app, _key, event| {
        if event.state == ShortcutState::Pressed {
            match capture_box() {
                Some(b) => {
                    if let Err(e) = std::process::Command::new(&b).arg(&vault).spawn() {
                        eprintln!("kandinsky-app: the capture box did not start: {e}");
                    }
                }
                None => eprintln!("kandinsky-app: no capture box beside the app"),
            }
        }
    });
    let key = kandinsky_core::env::var("CAPTURE_KEY").unwrap_or_else(|| "Control+Super+C".into());
    if key == "none" {
        return builder.build();
    }
    match key.parse::<Shortcut>().map_err(|e| e.to_string()).and_then(|k| builder.with_shortcut(k).map_err(|e| e.to_string())) {
        Ok(b) => b.build(),
        Err(e) => {
            eprintln!("kandinsky-app: no capture key ({key:?}: {e})");
            Builder::new().build()
        }
    }
}

/// `kandinsky-app --capture [folder]`: the quick-capture window (docs/guides/CAPTURE.md) — one small frameless
/// box above everything, showing the app's `/#capture` page. It talks to the Kandinsky already open on
/// that vault when there is one (two cores on one vault would run its schedules twice), and only
/// otherwise starts a core of its own for as long as the box is open. The page asks to be closed
/// by going to `/__kandinsky_close` (after Enter, or on Esc).
fn capture_window(root: PathBuf) -> anyhow::Result<()> {
    webkit_rendering(&root);
    let mut own = None;
    // the address to open: a locked core's one-time link (its cookie lets the box in), else the core's own
    let link = match kandinsky_core::vaults::running_server(&root) {
        Some(base) => tauri::async_runtime::block_on(post(&base, "/api/local/link", "{}"))
            .ok()
            .and_then(|answer| serde_json::from_str::<serde_json::Value>(&answer).ok()?["url"].as_str().map(String::from))
            .unwrap_or(base),
        None => {
            let s = tauri::async_runtime::block_on(desktop_core(root.clone()))?;
            let url = s.open_url();
            own = Some(s);
            url
        }
    };
    eprintln!("kandinsky-app: capture into {} ({})", root.display(), if own.is_some() { "its own core" } else { "the open Kandinsky" });
    let url: tauri::Url = capture_page(&link).parse()?;
    tauri::Builder::default()
        .setup(move |app| {
            let handle = app.handle().clone();
            window(app, "capture", WebviewUrl::External(url))
                .title("Kandinsky capture")
                // OS file drops reach the page's own `drop` (the editor, the explorer, the capture popup); Tauri's
                // handler would take them first (on Windows the page then never sees a dropped file)
                .disable_drag_drop_handler()
                .inner_size(620.0, 160.0) // the capture box of one line, and room under it for a list
                .resizable(false)
                .decorations(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .center()
                .focused(true)
                .on_navigation(move |to| {
                    if to.path() == "/__kandinsky_close" {
                        handle.exit(0);
                        return false;
                    }
                    true
                })
                .build()?;
            Ok(())
        })
        // a box left behind is in the way: it closes when another window takes the focus (once it had it)
        .on_window_event({
            let had_focus = std::sync::atomic::AtomicBool::new(false);
            move |window, event| {
                if let tauri::WindowEvent::Focused(focused) = event {
                    if *focused {
                        had_focus.store(true, std::sync::atomic::Ordering::Relaxed);
                    } else if had_focus.load(std::sync::atomic::Ordering::Relaxed) {
                        window.app_handle().exit(0);
                    }
                }
            }
        })
        .build(context())?
        .run(move |_app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(s) = own.take() {
                    let _ = tauri::async_runtime::block_on(s.shutdown());
                }
            }
        });
    Ok(())
}

/// `kandinsky-app --browse <url> [folder]`: that page in a browsing window of its own (browser.rs), ads blocked as the
/// vault's `[web]` settings say; no core, no main window. From a terminal, and how the blocking is checked.
/// A vault on a server (`kandinsky-app https://kandinsky.example.org/v/notes/`, from the vault picker): no core on this machine,
/// one window on the server's own page — the same app the server serves. Its sign-in in front (Authelia, a security key)
/// happens in this window and WebKit keeps the session, as a browser would; the window follows it to other hosts and
/// back. A link the page opens goes to the desktop's own handler (docs/design/DESIGN-desktop-remote.md).
fn remote_window(url: tauri::Url) -> anyhow::Result<()> {
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1"); // as `ui.gpu_rendering = auto` does for a local vault
    }
    let host = url.host_str().unwrap_or_default().to_string();
    eprintln!("kandinsky-app: a vault on a server, window → {url}");
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![webauthn_get])
        .setup(move |app| {
            webauthn_capability(app, "main"); // the server's gate signs in inside this window
            window(app, "main", WebviewUrl::External(url))
                .initialization_script(WEBAUTHN_SCRIPT)
                .title(format!("Kandinsky — {host}"))
                // OS file drops reach the page's own `drop` (the editor, the explorer, the capture popup); Tauri's
                // handler would take them first (on Windows the page then never sees a dropped file)
                .disable_drag_drop_handler()
                .inner_size(MAIN_SIZE.width, MAIN_SIZE.height)
                .on_new_window(|to, _| {
                    open_outside(to.as_str());
                    tauri::webview::NewWindowResponse::Deny
                })
                .build()
                .map(|w| fit_to_screen(&w))?;
            Ok(())
        })
        .build(context())?
        .run(|_, _| {});
    Ok(())
}

/// A window larger than its screen's free area (a 1366×768 laptop, a 1280×800 tablet) is shrunk into it and centred,
/// so no edge or title bar starts off screen. A screen with room keeps the size asked for.
/// The app's context, expanded once: on macOS each expansion embeds Info.plist under one symbol, so a second one fails
/// to link.
fn context() -> tauri::Context {
    tauri::generate_context!()
}

/// The main window's size, made smaller by `fit_to_screen` on a screen that cannot hold it.
const MAIN_SIZE: tauri::LogicalSize<f64> = tauri::LogicalSize::new(1400.0, 900.0);

/// Fits `MAIN_SIZE` into the monitor's work area (95 %). Compared with the size asked for: the window's own size is
/// 0×0 until it is mapped (Wayland), and a window bigger than the screen opens cut off there (a 1366×768 laptop).
fn fit_to_screen(window: &tauri::WebviewWindow) {
    let Ok(Some(monitor)) = window.current_monitor() else { return };
    let (size, area) = (MAIN_SIZE.to_physical::<u32>(monitor.scale_factor()), monitor.work_area().size);
    if size.width <= area.width && size.height <= area.height {
        return;
    }
    let fit = tauri::PhysicalSize::new(size.width.min(area.width * 95 / 100), size.height.min(area.height * 95 / 100));
    let _ = window.set_size(fit);
    let _ = window.center();
}

/// Windows: a touchpad pinch reaches the page as a Ctrl+wheel, which the graph, a PDF and pane-zoom.ts zoom with (and
/// stop, so WebView2 never scales the whole window). wry turns WebView2's pinch zoom off together with its zoom keys
/// (Tauri's `zoom_hotkeys_enabled`), and WebView2 then drops the gesture before the page sees it: a pinch did nothing.
/// Only the pinch is turned on: Ctrl+plus and Ctrl+minus stay the app's own (pane-zoom.ts).
#[cfg(windows)]
fn pinch_reaches_page(window: &tauri::WebviewWindow) {
    let _ = window.with_webview(|w| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings5;
        use windows_core::Interface;
        let Ok(core) = w.controller().CoreWebView2() else { return };
        let Ok(settings) = core.Settings() else { return };
        if let Ok(s5) = settings.cast::<ICoreWebView2Settings5>() {
            let _ = s5.SetIsPinchZoomEnabled(true);
        }
    });
}

/// The window in the theme's background (tokens.css `--bg-app`) until the page paints: no white flash at start.
fn paint_before_page(window: &tauri::WebviewWindow, vault: &std::path::Path) {
    use kandinsky_core::config::{Config, Theme};
    let ui = Config::load(vault).map(|c| c.ui).ok();
    let dark = match ui.as_ref().map_or(Theme::System, |u| u.theme) {
        Theme::Dark => true,
        Theme::Light => false,
        Theme::System => window.theme().map_or(true, |t| t == tauri::Theme::Dark),
    };
    let plain = ui.as_ref().is_some_and(|u| {
        let p = if dark { u.palette_dark.unwrap_or(u.palette) } else { u.palette };
        p == kandinsky_core::config::Palette::Plain
    });
    let (r, g, b) = page_background(dark, plain);
    let _ = window.set_background_color(Some(tauri::window::Color(r, g, b, 255)));
}

/// `--bg-app` of the palette (palettes.css `plain`, else tokens.css), as ui/index.html paints it before its styles load.
fn page_background(dark: bool, plain: bool) -> (u8, u8, u8) {
    match (dark, plain) {
        (true, true) => (0x20, 0x20, 0x20),
        (false, true) => (0xf7, 0xf7, 0xf5),
        (true, false) => (0x12, 0x13, 0x17),
        (false, false) => (0xea, 0xe6, 0xde),
    }
}

/// Web pages as tabs on Windows: WebView2 is Chromium, so an extension of the app's own (`webview2/frame-any`, its
/// declarativeNetRequest rules) removes X-Frame-Options and Content-Security-Policy from the pages Kandinsky's window frames
/// — and only those (`initiatorDomains`: the core's own address) — and every site shows in a plain iframe, as in
/// Obsidian. Written out under the cache at each start (WebView2 loads unpacked extensions from a folder). None: it
/// could not be written; sites that refuse framing then open in a window, as before.
///
/// The same extension carries the web tabs' page script (`frame_script`, this run's token in it) as its content
/// script: Chromium runs it in the extension's isolated world, the one isolated world WebView2 offers (its
/// `AddScriptToExecuteOnDocumentCreated`, wry's initialization scripts, run in the page's), so a framed site never sees
/// the token — as on Linux and macOS (`frame_script_isolated`).
#[cfg(windows)]
fn frame_any_extension() -> Option<PathBuf> {
    let root = kandinsky_core::platform::dirs::app(kandinsky_core::platform::dirs::Base::Cache).join("webview2-extensions");
    let dir = root.join("frame-any");
    let script = frame_script();
    let files = [("manifest.json", include_str!("../webview2/frame-any/manifest.json")), ("rules.json", include_str!("../webview2/frame-any/rules.json")), ("frame_page.js", script.as_str())];
    let written = std::fs::create_dir_all(&dir).and_then(|_| files.iter().try_for_each(|(name, text)| std::fs::write(dir.join(name), text)));
    match written {
        Ok(()) => Some(root),
        Err(e) => {
            eprintln!("kandinsky-app: web pages as tabs: the WebView2 extension was not written to {}: {e}", dir.display());
            None
        }
    }
}

/// Web pages as tabs on Linux: the libsoup hook (frames/frames.rs, built by build.rs) is written under the cache and
/// put in LD_PRELOAD before WebKit starts its processes; it acts in the network process only and takes itself out of
/// LD_PRELOAD in every process it is loaded into, so the shells and helpers Kandinsky starts never carry it on. False: it
/// could not be written (a web tab then shows only sites that let themselves be framed, lib/web-links.ts).
#[cfg(target_os = "linux")]
fn frames_preload() -> bool {
    const LIB: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/libkandinsky-webkit-frames.so"));
    let dir = kandinsky_core::platform::dirs::app(kandinsky_core::platform::dirs::Base::Cache);
    let path = dir.join("libkandinsky-webkit-frames.so");
    let current = std::fs::read(&path).is_ok_and(|b| b == LIB);
    // written beside and renamed: a running WebKit process may have the old one mapped
    let written = current || {
        let tmp = dir.join(format!("libkandinsky-webkit-frames.so.{}", std::process::id()));
        std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(&tmp, LIB)).and_then(|_| std::fs::rename(&tmp, &path)).map_err(|e| eprintln!("kandinsky-app: web pages as tabs: {} not written: {e}", path.display())).is_ok()
    };
    if written {
        let before = std::env::var("LD_PRELOAD").unwrap_or_default();
        let list = [path.to_string_lossy().into_owned()].into_iter().chain(before.split([':', ' ']).filter(|p| !p.is_empty() && !p.contains("kandinsky-webkit-frames")).map(str::to_owned));
        // SAFETY: main's first steps, before any thread exists
        unsafe { std::env::set_var("LD_PRELOAD", list.collect::<Vec<_>>().join(":")) };
    }
    written
}

/// Tells the page it is in the desktop app (in a plain browser, web links open the browser's own tabs), whether its
/// iframes can show any site (lib/web-links.ts: on Windows the extension above removes the headers that forbid it, on
/// Linux the libsoup hook, `frames_preload`), and the token its web tabs' page script signs its messages with.
fn frames_any_page(frames: bool) -> String {
    format!("window.__kandinskyDesktop = true; window.__kandinskyFramesAnything = {frames}; window.__kandinskyFrameToken = {:?};", frame_token())
}

/// A random token for this run: only Kandinsky's top page (`frames_any_page`) and the web tabs' page script
/// (`frame_script`) know it, so a framed site cannot pass its own messages off as the script's (Web.svelte).
fn frame_token() -> &'static str {
    static TOKEN: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    TOKEN.get_or_init(|| kandinsky_core::auth::random_hex(16))
}

/// The web tabs' page script (frame_page.js) with this run's token.
fn frame_script() -> String {
    include_str!("frame_page.js").replace("__KANDINSKY_FRAME_TOKEN__", frame_token())
}

/// On Linux and macOS the page script runs in a script world of its own (WebKit's isolated world, as a browser
/// extension's content script): a framed site's scripts share the page's DOM with it but not its variables, so they
/// never see the token, nor can they wrap the functions it calls. Added to the window's content manager for every
/// frame; wry's own scripts go into the page's world. Windows: the content script of `frame_any_extension`.
#[cfg(target_os = "linux")]
fn frame_script_isolated(view: &webkit2gtk::WebView) {
    use webkit2gtk::{UserContentInjectedFrames, UserContentManagerExt, UserScript, UserScriptInjectionTime, WebViewExt};
    if let Some(m) = view.user_content_manager() {
        m.add_script(&UserScript::for_world(&frame_script(), UserContentInjectedFrames::AllFrames, UserScriptInjectionTime::Start, "kandinsky-frame", &[], &[]));
    }
}

/// macOS: a named `WKContentWorld` (macOS 11, the bundle's minimum), the script for all frames at document start.
/// `view` is the window's WKWebView, as Tauri's `with_webview` hands it, on the main thread.
#[cfg(target_os = "macos")]
fn frame_script_isolated(view: *mut std::ffi::c_void) {
    use objc2::MainThreadMarker;
    use objc2_foundation::NSString;
    use objc2_web_kit::{WKContentWorld, WKUserScript, WKUserScriptInjectionTime, WKWebView};
    let Some(mtm) = MainThreadMarker::new() else {
        return eprintln!("kandinsky-app: web tabs: the page script not added (not on the main thread)");
    };
    if view.is_null() {
        return eprintln!("kandinsky-app: web tabs: the page script not added (no web view)");
    }
    // SAFETY: Tauri's pointer is the window's WKWebView, alive for this call, used on the main thread (checked above)
    let view: &WKWebView = unsafe { &*view.cast::<WKWebView>() };
    // SAFETY: plain WebKit calls with live, retained arguments, on the main thread
    unsafe {
        let world = WKContentWorld::worldWithName(&NSString::from_str("kandinsky-frame"), mtm);
        let script = WKUserScript::initWithSource_injectionTime_forMainFrameOnly_inContentWorld(mtm.alloc(), &NSString::from_str(&frame_script()), WKUserScriptInjectionTime::AtDocumentStart, false, &world);
        view.configuration().userContentController().addUserScript(&script);
    }
}

/// The core's "choose a folder" (the vault switcher's Choose…) is the system's own dialog, over this window: typing a whole
/// path was the only way, and on macOS nobody knows theirs.
fn folder_dialog(app: &tauri::AppHandle) {
    use kandinsky_core::vaults::PickPurpose;
    use tauri_plugin_dialog::DialogExt;
    let app = app.clone();
    kandinsky_core::vaults::on_pick_folder(move |purpose| {
        // the window of the moment: it is built again after its sleep (background.rs)
        let window = app.get_webview_window(MAIN_WINDOW)?;
        let title = match purpose {
            PickPurpose::Open => "Open a folder as a vault",
            PickPurpose::Create => "Where the new vault goes — make a new folder here, or choose an empty one",
            PickPurpose::Guest => "Open a folder as a guest — read-only until Edit is switched on, never added to the vaults",
        };
        let mut d = window.dialog().file().set_title(title).set_parent(&window).set_can_create_directories(true);
        if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
            d = d.set_directory(home);
        }
        d.blocking_pick_folder().and_then(|f| f.into_path().ok())
    });
}

fn browse_window(url: tauri::Url, root: PathBuf) -> anyhow::Result<()> {
    let web = kandinsky_core::config::Config::load(&root).map(|c| c.web).unwrap_or_default();
    tauri::Builder::default()
        .setup(move |app| {
            browser::prepare(app.handle(), web);
            browser::open(app.handle(), url, open_outside);
            Ok(())
        })
        .build(context())?
        .run(|_, _| {});
    Ok(())
}

/// An AppImage's runtime points Python (and Perl) at the libraries in its own mount; every program Kandinsky starts inherits
/// that, and the system's `python3` then fails ("Python path configuration") — every Python plugin with it. Kandinsky runs
/// no interpreter itself, so those variables go before anything starts. By shape: any `PYTHON*` / `PERL*` variable whose
/// value lies in `$APPDIR`; none outside an AppImage.
fn leave_appimage_interpreters() {
    let Some(dir) = std::env::var_os("APPDIR").filter(|d| !d.is_empty()) else { return };
    let dir = dir.to_string_lossy().into_owned();
    for (k, v) in std::env::vars_os() {
        let name = k.to_string_lossy();
        if (name.starts_with("PYTHON") || name.starts_with("PERL")) && v.to_string_lossy().contains(&dir) {
            // SAFETY: the first thing main does, before any thread exists
            unsafe { std::env::remove_var(&k) };
        }
    }
}

/// Whether a program argument is a `kandinsky:` link (any page can launch the app with one), never a folder.
fn is_deep_link(arg: &str) -> bool {
    arg.get(..10).is_some_and(|s| s.eq_ignore_ascii_case("kandinsky:"))
}

/// A paper-capture link (`kandinsky://capture-paper?url=…&title=…`, the bookmarklet's), else None: only its own
/// fields, a web address as its `url`, and something to know the paper by.
fn parse_paper_deep_link(uri: &str) -> Option<serde_json::Map<String, serde_json::Value>> {
    const FIELDS: [&str; 5] = ["doi", "arxiv", "url", "id", "title"];
    if !is_deep_link(uri) || uri.len() > 8192 {
        return None;
    }
    let u = uri.parse::<tauri::Url>().ok()?;
    if !matches!(u.host_str(), Some("capture-paper" | "paper")) || !matches!(u.path(), "" | "/") {
        return None;
    }
    let mut params = serde_json::Map::new();
    for (k, v) in u.query_pairs() {
        if !FIELDS.contains(&k.as_ref()) || v.trim().is_empty() || v.chars().any(char::is_control) {
            continue;
        }
        if k == "url" && !v.parse::<tauri::Url>().is_ok_and(|w| matches!(w.scheme(), "http" | "https")) {
            continue;
        }
        params.insert(k.into_owned(), serde_json::Value::String(v.into_owned()));
    }
    if let Some(best) = params
        .get("doi")
        .or_else(|| params.get("arxiv"))
        .or_else(|| params.get("url"))
        .or_else(|| params.get("id"))
        .or_else(|| params.get("title"))
        .cloned()
    {
        params.entry("id").or_insert(best);
    }
    params.contains_key("id").then_some(params)
}

fn capture_paper_note_path(raw: &str) -> Option<String> {
    let v = serde_json::from_str::<serde_json::Value>(raw).ok()?;
    if let (Some(dir), Some(key)) = (v["paper"]["dir"].as_str(), v["paper"]["key"].as_str()) {
        let dir = dir.trim_matches('/');
        let key = key.trim();
        if !key.is_empty() {
            return Some(if dir.is_empty() { format!("{key}.md") } else { format!("{dir}/{key}.md") });
        }
    }
    v["note"].as_str().or_else(|| v["key"].as_str()).map(String::from)
}

async fn add_and_open_paper(base: &str, params: serde_json::Map<String, serde_json::Value>, show_window: bool) {
    let body = serde_json::json!({ "method": "add", "params": params, "timeout_secs": 120 }).to_string();
    let added = post(base, "/api/plugins/@references/helper", &body).await;
    let note = added.as_deref().ok().and_then(capture_paper_note_path);
    let shown = if show_window {
        let show_body = serde_json::json!({ "open": note }).to_string();
        post(base, "/api/shell/show", &show_body).await.is_ok()
    } else {
        true
    };
    if let Some(path) = note {
        let open_body = serde_json::json!({ "args": { "path": path } }).to_string();
        let attempts = if show_window { if shown { 3 } else { 1 } } else { 20 };
        for _ in 0..attempts {
            if let Ok(resp) = post(base, "/api/cmd/open", &open_body).await {
                if serde_json::from_str::<serde_json::Value>(&resp).is_ok_and(|v| v["ok"].as_bool() == Some(true)) {
                    break;
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
    } else if let Err(e) = added {
        eprintln!("kandinsky-app: capture-paper failed: {e}");
        let notify_body = serde_json::json!({ "args": { "title": "Paper capture failed", "body": e.to_string() } }).to_string();
        let _ = post(base, "/api/cmd/notify", &notify_body).await;
    }
}

fn main() -> anyhow::Result<()> {
    leave_appimage_interpreters();
    // the Flatpak: `kandinsky` and `kandinsky-capture` callable from the host's terminals, agents and shortcuts (host.rs)
    kandinsky_core::platform::host::write_command_launchers();
    // GTK's Wayland app id (X11: WM_CLASS) is the program name; "kandinsky" makes KWin find kandinsky.desktop and its Icon=kandinsky,
    // where the binary's name "kandinsky-app" matched no desktop file and the window showed Wayland's generic icon.
    #[cfg(target_os = "linux")]
    gtk::glib::set_prgname(Some("kandinsky"));
    // The WebView's own file choosers (`<input type=file>`: attach, import, upload) are GTK's FileChooserNative, which
    // goes through the portal — the desktop's dialog — only in a sandbox or when asked; asked here, before GTK starts,
    // unless the person set it. Programs started from Kandinsky inherit it, which gives them the same dialog.
    #[cfg(target_os = "linux")]
    if std::env::var_os("GTK_USE_PORTAL").is_none() {
        std::env::set_var("GTK_USE_PORTAL", "1");
    }
    // `kandinsky-app [folder]` is the app; `kandinsky-app --capture [folder]` the quick-capture box
    let args: Vec<std::ffi::OsString> = std::env::args_os().skip(1).collect();
    #[cfg(target_os = "linux")]
    if args.first().is_some_and(|a| a == web_filters::CONVERT_FLAG) {
        let out = args.get(1).map(PathBuf::from).ok_or_else(|| anyhow::anyhow!("{} <rules.json>", web_filters::CONVERT_FLAG))?;
        return Ok(web_filters::convert_main(&out)?);
    }
    let mut folder = args.iter().find(|a| !a.to_string_lossy().starts_with("--")).map(PathBuf::from);
    let mut pending_paper: Option<serde_json::Map<String, serde_json::Value>> = None;
    // a link is acted on only as a paper capture: any other (a page's `kandinsky://anything`) does nothing at all, never
    // reaching the folder, one-instance and port code below
    if let Some(uri) = folder.as_ref().map(|f| f.to_string_lossy().into_owned()).filter(|s| is_deep_link(s)) {
        folder = None;
        let Some(params) = parse_paper_deep_link(&uri) else {
            eprintln!("kandinsky-app: ignored link: {uri}");
            return Ok(());
        };
        let root = vault_to_open(None)?;
        if let Some(base) = kandinsky_core::vaults::running_server(&root) {
            tauri::async_runtime::block_on(add_and_open_paper(&base, params, true));
            return Ok(());
        }
        pending_paper = Some(params);
    }
    if args.iter().any(|a| a == "--capture") {
        if let Some(code) = native_capture(folder.as_deref()) {
            std::process::exit(code);
        }
        return capture_window(vault_to_open(folder)?);
    }
    if let Some(i) = args.iter().position(|a| a == "--browse") {
        let url = args.get(i + 1).map(|u| u.to_string_lossy().into_owned()).unwrap_or_default();
        let rest = args.iter().skip(i + 2).find(|a| !a.to_string_lossy().starts_with("--")).map(PathBuf::from);
        return browse_window(url.parse().map_err(|e| anyhow::anyhow!("--browse {url:?}: {e}"))?, rest.unwrap_or_else(|| PathBuf::from(".")));
    }
    // the folders of a build from before the rename (`<base>/atlas`, the window's data under the old identifier) become
    // Kandinsky's before anything opens them; what cannot move stays in use (kandinsky-core platform/dirs_migrate.rs).
    // Only the app itself moves them: the capture box and a browsing window only look them up, so they never move
    // folders from under a window of this program that is starting or running.
    for line in kandinsky_core::platform::dirs_migrate::migrate() {
        eprintln!("kandinsky-app: {line}");
    }
    // a server's address instead of a folder: a window on that vault's page, no core here
    if let Some(url) = folder.as_ref().and_then(|f| kandinsky_core::vaults::server_address(&f.to_string_lossy())) {
        return remote_window(url.parse()?);
    }
    let root = vault_to_open(folder)?;
    // `--background`: the core and the tray, no window until asked (the session's autostart entry, autostart.rs)
    let background_start = args.iter().any(|a| a == autostart::BACKGROUND);
    // one Kandinsky per vault: a second launch brings the first one's window forward (it may be hidden in the tray)
    if let Some(base) = kandinsky_core::vaults::running_server(&root) {
        let asked = if background_start { Ok(String::new()) } else { tauri::async_runtime::block_on(post(&base, "/api/shell/show", "{}")) };
        match asked {
            Ok(_) => {
                eprintln!("kandinsky-app: Kandinsky already runs on {} ({base}): {}", root.display(), if background_start { "nothing to start" } else { "its window brought forward" });
                return Ok(());
            }
            Err(e) => eprintln!("kandinsky-app: the Kandinsky running on {} has no window to show ({e}); starting one", root.display()),
        }
    }
    webkit_rendering(&root);
    #[cfg(target_os = "linux")]
    let frames = frames_preload();
    #[cfg(not(target_os = "linux"))]
    let frames = cfg!(windows);
    // the installed UI (packaging/install.sh copies it): a new interface reloads into this window
    // without a new program (kandinsky-core ui_files.rs; the page watches /api/ui/build)
    if kandinsky_core::env::var_os("UI_DIR").is_none() {
        if let Some(d) = kandinsky_core::ui_files::installed() {
            for name in kandinsky_core::env::both("UI_DIR") {
                std::env::set_var(name, &d);
            }
        }
    }
    // Tauri's async runtime is tokio; the server task keeps running on it after block_on returns.
    let server = tauri::async_runtime::block_on(desktop_core(root.clone()))?;
    // the vault list (docs/guides/SHELL.md) is written here only: `kandinsky serve` on a throwaway folder leaves no trace
    if let Err(e) = kandinsky_core::vaults::remember_now(&server.info().root) {
        eprintln!("kandinsky-app: vault list not updated: {e}");
    }
    // KANDINSKY_DEV=1 (the "Kandinsky (dev)" launcher): the UI from this repository's Vite dev server, so a
    // saved .svelte / .ts / .css shows at once with no rebuild; the core stays the installed one
    let mut dev = kandinsky_core::env::var_os("DEV").is_some().then(|| dev_ui(&server.url(), server.key())).transpose()?;
    // the locked core is opened by a one-time link that leaves the key's cookie in this window
    let url = kandinsky_core::env::var("UI_URL").or_else(|| dev.as_ref().map(|d| d.url.clone())).unwrap_or_else(|| server.open_url());
    eprintln!("kandinsky-app: workspace {} served at {}; window → {url}", server.info().root.display(), server.url());
    watch_for_update(server.url());
    let url: tauri::Url = url.parse()?;
    let core = server.url();
    // macOS hands a kandinsky:// link to the running app as an Apple Event, not as an argument
    #[cfg(target_os = "macos")]
    let opened_core = core.clone();
    let server = Some(server);
    let vault = root.clone();

    let builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init()).invoke_handler(tauri::generate_handler![webauthn_get]);
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(capture_key(root.clone()));
    // the link a rebuilt window opens with: a locked core's one-time codes are spent, so a fresh one each time
    let server = std::sync::Arc::new(std::sync::Mutex::new(server));
    let fresh_link = {
        let (server, fixed) = (server.clone(), kandinsky_core::env::var("UI_URL").or_else(|| dev.as_ref().map(|d| d.url.clone())));
        move || fixed.clone().or_else(|| server.lock().unwrap().as_ref().map(|s| s.open_url()))
    };
    builder
        .setup(move |app| {
            let handle = app.handle().clone();
            webauthn_capability(app, "door-*");
            webauthn_capability(app, "signin-*");
            browser::prepare(&handle, kandinsky_core::config::Config::load(&vault).map(|c| c.web).unwrap_or_default());
            let spec = MainSpec { home: url.clone(), core: core.clone(), vault: vault.clone(), frames };
            let open_main: background::OpenMain = Box::new(move |app, open| {
                let mut to = fresh_link().and_then(|l| l.parse::<tauri::Url>().ok()).unwrap_or_else(|| spec.home.clone());
                if let Some(path) = open {
                    to.query_pairs_mut().append_pair("open", path);
                }
                spec.build(app, to)
            });
            let shell = background::Shell::new(handle.clone(), vault.clone(), core.clone(), open_main);
            let _ = SHELL.set(shell.clone());
            folder_dialog(&handle);
            #[cfg(target_os = "linux")]
            tablet::watch(handle.clone()); // KDE's tablet mode → the touch layout (tablet.rs)
            // a notification's click, a second launch, the tray: one way to bring the window forward (shell.rs)
            let s = shell.clone();
            kandinsky_core::shell::on_show(move |show| s.show(show.open));
            #[cfg(target_os = "linux")]
            {
                let h = handle.clone();
                kandinsky_core::shell::on_forget_web_data(move |done| forget_web_data(&h, done));
            }
            let s = shell.clone();
            kandinsky_core::notify::on_notice(move |heard| s.notice(heard));
            let start_vault = vault.clone();
            kandinsky_core::shell::on_config(move |root, cfg| {
                if same_folder(root, &start_vault) {
                    autostart::apply(cfg.desktop.start_at_login);
                }
            });
            autostart::apply(kandinsky_core::config::Config::load(&vault).map(|c| c.desktop.start_at_login).unwrap_or(false));
            if background_start {
                shell.start_asleep();
            } else {
                shell.show(None);
            }
            start_tray(&handle, &shell, background_start);
            shell.watch_sleep();
            if let Some(params) = pending_paper {
                let core = core.clone();
                tauri::async_runtime::spawn(async move {
                    add_and_open_paper(&core, params, false).await;
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| match (window.label(), event) {
            (MAIN_WINDOW, tauri::WindowEvent::CloseRequested { api, .. }) => {
                if SHELL.get().is_some_and(|s| s.close_requested()) {
                    api.prevent_close();
                }
            }
            // looking at Kandinsky, however it came forward (the taskbar, Alt+Tab, a click), is seeing its notices
            (MAIN_WINDOW, tauri::WindowEvent::Focused(true)) => {
                if let Some(s) = SHELL.get() {
                    s.looked_at();
                }
            }
            _ => {}
        })
        .build(context())?
        .run(move |_app, event| match event {
            // the window closed by its sleep (or never opened, `--background`): Kandinsky runs on in the tray
            tauri::RunEvent::ExitRequested { code: None, api, .. } if SHELL.get().is_some_and(|s| s.keeps_running()) => api.prevent_exit(),
            // macOS: a click on the Dock icon of a Kandinsky with no window shown
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { has_visible_windows: false, .. } => {
                if let Some(s) = SHELL.get() {
                    s.show(None);
                }
            }
            // macOS: a kandinsky://capture-paper link (the scheme tauri.conf.json registers), on a cold start too
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Opened { urls } => {
                for params in urls.iter().filter_map(|u| parse_paper_deep_link(u.as_str())) {
                    let core = opened_core.clone();
                    tauri::async_runtime::spawn(async move { add_and_open_paper(&core, params, true).await });
                }
            }
            tauri::RunEvent::Exit => {
                if let Some(mut d) = dev.take() {
                    let _ = d.vite.kill(); // the dev server goes with the window
                }
                // Graceful stop so `.kandinsky/cache/server.json` does not point at a dead port.
                if let Some(s) = server.lock().unwrap().take() {
                    let _ = tauri::async_runtime::block_on(s.shutdown());
                }
            }
            _ => {}
        });
    Ok(())
}

const MAIN_WINDOW: &str = "main";
static SHELL: std::sync::OnceLock<std::sync::Arc<background::Shell>> = std::sync::OnceLock::new();

fn same_folder(a: &std::path::Path, b: &std::path::Path) -> bool {
    a == b || matches!((a.canonicalize(), b.canonicalize()), (Ok(x), Ok(y)) if x == y)
}

/// The tray icon (tray_sni.rs on Linux, tray_tauri.rs elsewhere). Without one, closing quits, and a `--background`
/// start opens its window after all — a window hidden with no way back would look like a crash.
fn start_tray(app: &tauri::AppHandle, shell: &std::sync::Arc<background::Shell>, background_start: bool) {
    let (rgba, w, h) = tray_pixels();
    let model = shell.model();
    #[cfg(target_os = "linux")]
    {
        let _ = app; // ksni needs no handle: its own D-Bus connection
        let shell = shell.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = tray_sni::start(shell.clone(), tray_sni::Icons::from_rgba(&rgba, w, h), model).await {
                eprintln!("kandinsky-app: no tray icon ({e}): closing the window quits Kandinsky");
                if background_start {
                    shell.show(None);
                }
            }
        });
    }
    #[cfg(not(target_os = "linux"))]
    if let Err(e) = tray_tauri::start(app, shell.clone(), tray_tauri::Icons::from_rgba(&rgba, w, h), model) {
        eprintln!("kandinsky-app: no tray icon ({e}): closing the window quits Kandinsky");
        if background_start {
            shell.show(None);
        }
    }
}

/// The app's icon at 64 px, as RGBA (the tray scales it to its own size).
fn tray_pixels() -> (Vec<u8>, u32, u32) {
    let mut dec = png::Decoder::new(&include_bytes!("../icons/64x64.png")[..]);
    dec.set_transformations(png::Transformations::EXPAND | png::Transformations::ALPHA);
    let Ok(mut reader) = dec.read_info() else { return (vec![0; 64 * 64 * 4], 64, 64) };
    let mut buf = vec![0; reader.output_buffer_size()];
    let Ok(info) = reader.next_frame(&mut buf) else { return (vec![0; 64 * 64 * 4], 64, 64) };
    buf.truncate(info.buffer_size());
    let rgba = match info.color_type {
        png::ColorType::Rgba => buf,
        png::ColorType::Rgb => buf.as_chunks::<3>().0.iter().flat_map(|p| [p[0], p[1], p[2], 255]).collect(),
        png::ColorType::GrayscaleAlpha => buf.as_chunks::<2>().0.iter().flat_map(|p| [p[0], p[0], p[0], p[1]]).collect(),
        _ => buf.iter().flat_map(|&g| [g, g, g, 255]).collect(),
    };
    (rgba, info.width, info.height)
}

/// What the main window is built from — at start and again after its sleep (background.rs); a guest folder's window
/// (core guest.rs) is built from it too.
#[derive(Clone)]
struct MainSpec {
    home: tauri::Url,
    core: String,
    vault: PathBuf,
    frames: bool,
}

impl MainSpec {
    fn build(&self, app: &tauri::AppHandle, url: tauri::Url) -> tauri::Result<tauri::WebviewWindow> {
        self.window(app, MAIN_WINDOW, "Kandinsky", url)
    }

    /// A window of this core's page: the main one, or a guest folder's (`label` guest-<n>), which closes as any window.
    fn window(&self, app: &tauri::AppHandle, label: &str, title: &str, url: tauri::Url) -> tauri::Result<tauri::WebviewWindow> {
        let (handle, core, vault, vault_bg) = (app.clone(), self.core.clone(), self.vault.clone(), self.vault.clone());
        let off_app = OffApp { home: self.home.clone(), handle: handle.clone(), vault: vault.clone() };
        let spec = self.clone();
        let main = window(app, label, WebviewUrl::External(url))
            .title(title)
            .initialization_script(frames_any_page(self.frames));
        // a web tab's frame: its address, history, find and Kandinsky's keys (frame_page.js; inert elsewhere), in an
        // isolated world — Linux and macOS: a script world of the window's, below (`frame_script_isolated`);
        // Windows: the content script of the app's WebView2 extension, or in the page's world when the extension
        // could not be written (the script then keeps the functions it calls from before the site's scripts run)
        #[cfg(windows)]
        let main = match frame_any_extension() {
            Some(dir) => main.browser_extensions_enabled(true).extensions_path(dir),
            None => main.initialization_script_for_all_frames(frame_script()),
        };
        #[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
        let main = main.initialization_script_for_all_frames(frame_script());
        let main = main
            // OS file drops reach the page's own `drop` (the editor, the explorer, the capture popup); Tauri's
            // handler would take them first (on Windows the page then never sees a dropped file)
            .disable_drag_drop_handler()
            .inner_size(MAIN_SIZE.width, MAIN_SIZE.height);
        // each page load learns whether KDE is in tablet mode (tablet.rs tells it of changes after)
        #[cfg(target_os = "linux")]
        let main = main.on_page_load(|w, load| {
            if load.event() == tauri::webview::PageLoadEvent::Finished {
                let _ = w.eval(tablet::script());
            }
        });
        // the window's page never leaves Kandinsky (OffApp). WebKitGTK reports a frame's navigation as the page's, and
        // a web tab is a frame: there the guard watches the page's own loads instead (`load-changed` is the main
        // frame's alone), below; elsewhere the navigation hook is the main frame's.
        #[cfg(not(target_os = "linux"))]
        let main = main.on_navigation(move |to| off_app.stay(to));
        let main = main
            // window.open: WebKitGTK opens nothing without a handler. A sign-in page that returns to a
            // localhost address gets a window of ours (it catches that address); a web page a browsing window
            // (browser.rs) or the desktop's browser (`web.open_links`); anything else (mailto:) its desktop handler.
            .on_new_window(move |to, _| {
                if let Some(page) = door_target(&to) {
                    door_window(&handle, page, core.clone());
                    return tauri::webview::NewWindowResponse::Deny;
                }
                // the core's own address (the "Open Kandinsky in the browser" link) is for the desktop's browser
                let own = to.port_or_known_default() == tauri::Url::parse(&core).ok().and_then(|c| c.port()) && matches!(to.host_str(), Some("127.0.0.1" | "localhost"));
                match signin_return(&to) {
                    Some(back) => signin_window(&handle, to, back, core.clone()),
                    None if own && guest_page(&to) => guest_window(&handle, &spec, to),
                    None if own => open_outside(to.as_str()),
                    None => web_link(&handle, to, &vault),
                }
                tauri::webview::NewWindowResponse::Deny
            })
            .build()?;
        fit_to_screen(&main);
        paint_before_page(&main, &vault_bg);
        #[cfg(windows)]
        pinch_reaches_page(&main);
        // WebKitGTK silently drops a window.open that no fresh click started — and a plugin's sign-in
        // opens its page only after its helper has answered. Every request still goes through on_new_window.
        #[cfg(target_os = "linux")]
        main.with_webview(move |w| {
            use webkit2gtk::{SettingsExt, WebViewExt};
            if let Some(s) = w.inner().settings() {
                s.set_javascript_can_open_windows_automatically(true);
            }
            pinch_to_wheel(&w.inner());
            pen_as_pen(&w.inner());
            frame_script_isolated(&w.inner());
            // ads and trackers blocked in web tabs (every frame of this window), Kandinsky's own page spared (web_filters.rs)
            browser::filter::apply_to_kandinsky(&w.inner());
            stay_in_kandinsky(&w.inner(), off_app);
            // a document, not a browser: no back/forward page cache, small memory caches — Kandinsky is one page and never goes back to a page it left
            if let Some(c) = w.inner().context() {
                use webkit2gtk::WebContextExt;
                c.set_cache_model(webkit2gtk::CacheModel::DocumentViewer);
            }
        })?;
        #[cfg(target_os = "macos")]
        main.with_webview(|w| frame_script_isolated(w.inner()))?;
        Ok(main)
    }
}

/// Every website's data forgotten through the main window's WebContext (browser.rs `forget_site_data`), on GTK's thread.
/// No window: `done` is dropped unheard, and the asker hears that.
#[cfg(target_os = "linux")]
fn forget_web_data(app: &tauri::AppHandle, done: kandinsky_core::shell::Forgotten) {
    if let Some(w) = app.get_webview_window(MAIN_WINDOW) {
        let _ = w.with_webview(move |v| browser::forget_site_data(&v.inner(), done));
    }
}

/// The page leaving Kandinsky for an outside address (a sign-in, a stray link): the load is stopped before it commits
/// (the page stays as it was) and the address goes where OffApp sends it. Linux only: see where it is called.
#[cfg(target_os = "linux")]
fn stay_in_kandinsky(view: &webkit2gtk::WebView, off: OffApp) {
    use webkit2gtk::{LoadEvent, WebViewExt};
    view.connect_load_changed(move |v, ev| {
        if !matches!(ev, LoadEvent::Started | LoadEvent::Redirected) {
            return;
        }
        let Some(to) = v.uri().and_then(|u| tauri::Url::parse(&u).ok()) else { return };
        if !off.stay(&to) {
            v.stop_loading();
        }
    });
}

/// A touchpad pinch never zooms the whole page (WebKitGTK scales it on its own, before any script could stop it): the
/// GTK event is taken here and handed to the page as a Ctrl+wheel at the fingers, which a drawing, a PDF or a picture
/// zooms on, as they do for Ctrl+wheel.
#[cfg(target_os = "linux")]
fn pinch_to_wheel(view: &webkit2gtk::WebView) {
    use gtk::prelude::WidgetExt;
    use webkit2gtk::WebViewExt;
    let last = std::cell::Cell::new(1.0f64);
    view.connect_event(move |v, ev| {
        let Some(p) = ev.downcast_ref::<gtk::gdk::EventTouchpadPinch>() else { return gtk::glib::Propagation::Proceed };
        let scale = p.scale();
        if (scale - 1.0).abs() < 1e-6 {
            last.set(1.0); // a pinch begins (or ends) at scale 1
            return gtk::glib::Propagation::Stop;
        }
        let ratio = scale / last.replace(scale);
        let delta = -ratio.ln() * 400.0; // fingers apart: zoom in, as a Ctrl+wheel up
        if delta.abs() > 0.01 {
            let (x, y) = p.position();
            let js = format!(
                "(()=>{{const t=document.elementFromPoint({x},{y})||document.body;t.dispatchEvent(new WheelEvent('wheel',{{deltaY:{delta},ctrlKey:true,clientX:{x},clientY:{y},bubbles:true,cancelable:true}}))}})()"
            );
            #[allow(deprecated)] // evaluate_javascript needs WebKitGTK 2.40; this runs on every version the app supports
            v.run_javascript(&js, None::<&gtk::gio::Cancellable>, |_| {});
        }
        gtk::glib::Propagation::Stop
    });
}

/// A Wacom pen (or its eraser) reaches WebKitGTK as a mouse, without pressure: the drawings (draw-excalidraw.ts,
/// draw-notepad.ts) then take it for one. Before WebKit delivers a pen's event, the page is told its pressure and tilt
/// (ui/src/lib/pen-bridge.ts turns the mouse's pointer event into a pen's); the script and the event go to the page
/// over one connection, in that order. The first event of another device says the pen is gone.
#[cfg(target_os = "linux")]
fn pen_as_pen(view: &webkit2gtk::WebView) {
    use gtk::gdk::{AxisUse, InputSource};
    use gtk::prelude::WidgetExt;
    use webkit2gtk::WebViewExt;
    let was_pen = std::cell::Cell::new(false);
    view.connect_event(move |v, ev| {
        use gtk::gdk::EventType as T;
        if !matches!(ev.event_type(), T::MotionNotify | T::ButtonPress | T::ButtonRelease) {
            return gtk::glib::Propagation::Proceed;
        }
        let source = ev.source_device().map(|d| gtk::gdk::prelude::DeviceExt::source(&d));
        let js = match source {
            Some(s @ (InputSource::Pen | InputSource::Eraser)) => {
                was_pen.set(true);
                let axis = |a| ev.axis(a).unwrap_or(0.0);
                let tilt = |a| (axis(a).clamp(-1.0, 1.0) * 90.0).round();
                format!("window.kandinskyPen&&kandinskyPen({:.3},{},{},{})", axis(AxisUse::Pressure), tilt(AxisUse::Xtilt), tilt(AxisUse::Ytilt), s == InputSource::Eraser)
            }
            _ if was_pen.replace(false) => "window.kandinskyPen&&kandinskyPen(null)".to_string(),
            _ => return gtk::glib::Propagation::Proceed,
        };
        #[allow(deprecated)] // as pinch_to_wheel
        v.run_javascript(&js, None::<&gtk::gio::Cancellable>, |_| {});
        gtk::glib::Propagation::Proceed
    });
}

/// The address an OAuth sign-in page sends its answer to (its `redirect_uri`), when that is this computer
/// (`https://localhost`, `http://127.0.0.1:8400/…`): nothing listens there, so the page has to be caught on the way.
fn signin_return(page: &tauri::Url) -> Option<tauri::Url> {
    let back: tauri::Url = page.query_pairs().find(|(k, _)| k == "redirect_uri")?.1.parse().ok()?;
    let local = matches!(back.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    // an app's own address (`audiobookshelf://oauth`, a mobile client's redirect a server allows) is caught as well:
    // the window stops there, nothing outside ever sees it
    let app_scheme = !matches!(back.scheme(), "http" | "https" | "file" | "data" | "javascript" | "blob" | "about");
    ((local && matches!(back.scheme(), "http" | "https")) || app_scheme).then_some(back)
}

/// Whether `to` is the sign-in's return address (with its `?code=…`): same scheme, host and port, path under it.
fn returns_to(to: &tauri::Url, back: &tauri::Url) -> bool {
    to.scheme() == back.scheme()
        && to.host_str() == back.host_str()
        && to.port_or_known_default() == back.port_or_known_default()
        && to.path().starts_with(back.path())
}

/// A provider's sign-in page in a window of Kandinsky, as Thunderbird does it: the user signs in there, and when the
/// page heads for its return address the window closes and hands that address to the page that asked
/// (POST /api/signin → the "signin" event → `kandinsky.signIn`). If the window cannot be made, the browser.
fn signin_window(app: &tauri::AppHandle, page: tauri::Url, back: tauri::Url, core: String) {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let label = format!("signin-{}", N.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
    let (app2, label2) = (app.clone(), label.clone());
    let built = window(app, &label, WebviewUrl::External(page.clone()))
        .initialization_script(WEBAUTHN_SCRIPT) // the provider's page may ask for the security key (webauthn.rs)
        .title("Sign in — Kandinsky")
        .inner_size(520.0, 720.0)
        .center()
        .focused(true)
        .on_navigation(move |to| {
            if !returns_to(to, &back) {
                return true;
            }
            let (core, body, app, label) = (core.clone(), serde_json::json!({ "url": to.as_str() }).to_string(), app2.clone(), label2.clone());
            tauri::async_runtime::spawn(async move {
                if let Err(e) = post(&core, "/api/signin", &body).await {
                    eprintln!("kandinsky-app: sign-in answer not delivered: {e}");
                }
                if let Some(w) = app.get_webview_window(&label) {
                    let _ = w.close();
                }
            });
            false
        })
        .build();
    if let Err(e) = built {
        eprintln!("kandinsky-app: no sign-in window ({e}); the browser instead");
        open_outside(page.as_str());
    }
}

/// The page's ask for a service sign-in (core `/signin/door?url=…` on this computer): the service's address.
/// A page that opens in a window of Kandinsky, not the browser: a guest folder's (`/v/<name>/?guest=1`, core guest.rs), or
/// a vault of this core asked for in a window of its own (`/v/<name>/?window=1`: the vault switcher's "Open in a new
/// window").
fn guest_page(to: &tauri::Url) -> bool {
    to.path().starts_with("/v/") && to.query_pairs().any(|(k, v)| (k == "guest" || k == "window") && v == "1")
}

fn guest_window(app: &tauri::AppHandle, spec: &MainSpec, page: tauri::Url) {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let guest = page.query_pairs().any(|(k, v)| k == "guest" && v == "1");
    let label = format!("{}-{}", if guest { "guest" } else { "vault" }, N.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
    let name = page.path().trim_start_matches("/v/").split('/').next().unwrap_or("").to_string();
    let title = if guest { "Kandinsky — guest folder".to_string() } else { format!("Kandinsky — {}", urlencoding_decode(&name)) };
    if let Err(e) = spec.window(app, &label, &title, page) {
        eprintln!("kandinsky: the window did not open: {e}");
    }
}

/// A vault's name from its `/v/<name>/` path segment (percent-decoded; kept as is when it is not valid).
fn urlencoding_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 3 <= bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| s.to_string())
}

fn door_target(to: &tauri::Url) -> Option<tauri::Url> {
    let local = matches!(to.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if !local || to.path() != "/signin/door" {
        return None;
    }
    let page: tauri::Url = to.query_pairs().find(|(k, _)| k == "url")?.1.parse().ok()?;
    matches!(page.scheme(), "http" | "https").then_some(page)
}

/// What the sign-in windows run first: a security key for their pages on Linux (webauthn.js; elsewhere the webview
/// has its own WebAuthn, and the script leaves it alone).
#[cfg(target_os = "linux")]
const WEBAUTHN_SCRIPT: &str = webauthn::SCRIPT;
#[cfg(not(target_os = "linux"))]
const WEBAUTHN_SCRIPT: &str = "";

/// A sign-in page's `navigator.credentials.get` (webauthn.js), answered with a security key over USB for the page's own
/// origin — read from the window, never taken from the page.
#[tauri::command]
async fn webauthn_get(webview: tauri::Webview, request: serde_json::Value) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "linux")]
    {
        let origin = webview.url().map_err(|e| e.to_string())?.origin().ascii_serialization();
        let ask: webauthn::Ask = serde_json::from_value(request).map_err(|e| e.to_string())?;
        let signed = tauri::async_runtime::spawn_blocking(move || webauthn::get(&origin, &ask)).await.map_err(|e| e.to_string())??;
        serde_json::to_value(signed).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (webview, request);
        Err("this platform's webview answers security keys itself".into())
    }
}

/// `webauthn_get` granted to the windows labelled `windows` (`door-*`: the sign-in windows; `main` for a vault on a
/// server, whose gate signs in inside it) on any https page — the only command a page may call.
fn webauthn_capability(app: &tauri::App, windows: &str) {
    let cap = tauri::ipc::CapabilityBuilder::new(format!("webauthn-{}", windows.trim_end_matches("-*")))
        .window(windows)
        .remote("https://*".into())
        .permission("allow-webauthn-get");
    if let Err(e) = app.add_capability(cap) {
        eprintln!("kandinsky-app: no security keys in the sign-in windows ({e})");
    }
}

/// A service's gate (Authelia, Authentik…) in a window of Kandinsky: the user signs in on its page (a security key works
/// there), and once a page of the service itself has loaded, its cookies go to the core (POST /api/signin/door),
/// which sends them with the plugins' later requests to that site — then the window closes. A page of the service
/// with no cookie at all is not a gate's doing: the window stays for the user to finish or close.
fn door_window(app: &tauri::AppHandle, page: tauri::Url, core: String) {
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let label = format!("door-{}", N.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
    let host = page.host_str().unwrap_or_default().to_ascii_lowercase();
    let done = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let built = window(app, &label, WebviewUrl::External(page.clone()))
        .initialization_script(WEBAUTHN_SCRIPT) // the security key (webauthn.rs)
        .title(format!("Sign in to {host} — Kandinsky"))
        .inner_size(520.0, 720.0)
        .center()
        .focused(true)
        .on_page_load(move |w, load| {
            let back_home = load.url().host_str().is_some_and(|h| h.eq_ignore_ascii_case(&host));
            if load.event() != tauri::webview::PageLoadEvent::Finished || !back_home || done.load(std::sync::atomic::Ordering::SeqCst) {
                return;
            }
            let (core, host, done, at) = (core.clone(), host.clone(), done.clone(), load.url().clone());
            // cookies are read off the handler's thread (it would block the window's own loop)
            tauri::async_runtime::spawn(async move {
                let cookies: Vec<serde_json::Value> = match w.cookies_for_url(at) {
                    Ok(list) => list.iter().map(|c| door_cookie(c, &host)).collect(),
                    Err(e) => return eprintln!("kandinsky-app: the sign-in window's cookies could not be read: {e}"),
                };
                if cookies.is_empty() || done.swap(true, std::sync::atomic::Ordering::SeqCst) {
                    return;
                }
                let body = serde_json::json!({ "host": host, "cookies": cookies }).to_string();
                match post(&core, "/api/signin/door", &body).await {
                    Ok(_) => drop(w.close()),
                    Err(e) => eprintln!("kandinsky-app: sign-in to {host} not kept: {e}"),
                }
            });
        })
        .build();
    if let Err(e) = built {
        eprintln!("kandinsky-app: no sign-in window ({e})");
    }
}

/// A cookie as the core keeps it (`service_signin::Cookie`): a domain cookie carries its leading dot.
fn door_cookie(c: &tauri::webview::Cookie<'static>, host: &str) -> serde_json::Value {
    let domain = c.domain().map(str::to_string).unwrap_or_else(|| host.to_string());
    serde_json::json!({
        "name": c.name(), "value": c.value(), "host_only": !domain.starts_with('.'), "domain": domain,
        "path": c.path().unwrap_or("/"), "secure": c.secure().unwrap_or(false),
        "expires": c.expires_datetime().map(|t| t.unix_timestamp().max(0)),
    })
}

/// An address in the desktop's own handler (the browser for the web, the mail client for mailto:).
/// The main window on a core of this machine never leaves it: a link that would replace the app with a web page (a
/// PDF's link, a page's own) opens as `window.open` would — a browsing window or the desktop's browser. A window on a
/// remote server is left alone: its sign-in in front takes it to other hosts and back.
struct OffApp {
    home: tauri::Url,
    handle: tauri::AppHandle,
    vault: PathBuf,
}

impl OffApp {
    fn stay(&self, to: &tauri::Url) -> bool {
        let local = |u: &tauri::Url| matches!(u.host_str(), Some("127.0.0.1" | "localhost" | "tauri.localhost" | "[::1]"));
        if !local(&self.home) || !matches!(to.scheme(), "http" | "https") || local(to) {
            return true;
        }
        web_link(&self.handle, to.clone(), &self.vault);
        false
    }
}

/// A web page leaving the main window, as `[web] open_links` says: a Web tab of the app (the pane's
/// `__kandinskyOpenWeb`, ui/src/lib/web-links.ts), a browsing window, or the desktop's browser. Other schemes: their handler.
fn web_link(app: &tauri::AppHandle, to: tauri::Url, vault: &std::path::Path) {
    use kandinsky_core::config::WebLinks;
    if !matches!(to.scheme(), "http" | "https") {
        return open_outside(to.as_str());
    }
    match kandinsky_core::config::Config::load(vault).map(|c| c.web.open_links).unwrap_or_default() {
        WebLinks::Tab => match app.get_webview_window("main") {
            Some(main) => {
                let js = format!("window.__kandinskyOpenWeb ? window.__kandinskyOpenWeb({}) : void 0", serde_json::Value::from(to.as_str()));
                if main.eval(&js).is_err() {
                    browser::open(app, to, open_outside);
                }
            }
            None => browser::open(app, to, open_outside),
        },
        WebLinks::Window => browser::open(app, to, open_outside),
        WebLinks::Browser => open_outside(to.as_str()),
    }
}

fn open_outside(url: &str) {
    if let Err(e) = kandinsky_core::platform::open::url(url) {
        eprintln!("kandinsky-app: {e}");
    }
}

/// The installed program is replaced by every rebuild (docs/scripts/auto-install.sh), but a running
/// window keeps the old one: when the file on disk changes, say so once per new build — a toast
/// through the core's own `notify` command, so the UI needs nothing new.
fn watch_for_update(base: String) {
    let Ok(exe) = std::env::current_exe() else { return };
    let stamp = |p: &std::path::Path| std::fs::metadata(p).and_then(|m| m.modified()).ok();
    let mut seen = stamp(&exe);
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(20)).await;
            let now = stamp(&exe);
            if now.is_none() || now == seen {
                continue; // mid-install the file may be missing for a moment
            }
            seen = now;
            let body = r#"{"args":{"title":"Kandinsky was updated","body":"A new build is installed. Restart Kandinsky to use it."}}"#;
            if let Err(e) = post(&base, "/api/cmd/notify", body).await {
                eprintln!("kandinsky-app: update notice not shown: {e}");
            }
        }
    });
}

/// WebView2's arguments: wry's own (no mini menu, no SmartScreen, media may play unasked) and the proxy found by the
/// Windows WinHTTP service. Chromium's own discovery ("Automatically detect settings", WPAD) blocks the first request —
/// the core's page on 127.0.0.1 too — until it gives up, about 20 s where no proxy answers: the window stayed empty that
/// long at every start. WinHTTP's service finds the same proxy and remembers the answer, so proxies keep working.
#[cfg(any(windows, test))]
const WEBVIEW2_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required --winhttp-proxy-resolver";

/// A window's builder, on the WebView data folder every window of this run shares: the old identifier's while it holds
/// the only profile (dirs_migrate.rs `webview_dir`), else Tauri's default. Every window is made through this, or the
/// first one made otherwise would start an empty profile under the new identifier, which then wins at every start.
pub(crate) fn window<'a, R: tauri::Runtime, M: tauri::Manager<R>>(app: &'a M, label: impl Into<String>, url: WebviewUrl) -> WebviewWindowBuilder<'a, R, M> {
    let built = WebviewWindowBuilder::new(app, label, url);
    // the same arguments for every window: WebView2 will not open two with different ones on one data folder
    #[cfg(windows)]
    let built = built.additional_browser_args(WEBVIEW2_ARGS);
    match kandinsky_core::platform::dirs_migrate::webview_dir() {
        Some(dir) => built.data_directory(dir),
        None => built,
    }
}

/// A bare HTTP POST to the core on localhost (no HTTP client dependency for one request); with the core's key when it
/// left one (a locked core, local_lock.rs), as the `kandinsky` CLI does. → the answer's body when it succeeded.
async fn post(base: &str, path: &str, body: &str) -> std::io::Result<String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    // a vault of the desktop's core is served under its prefix (`http://127.0.0.1:port/v/name`)
    let (host, prefix) = split_base(base);
    let path = format!("{prefix}{path}");
    let key = kandinsky_core::auth::local_key_header(host);
    let mut s = tokio::net::TcpStream::connect(host).await?;
    // `x-atlas: 1` too: a core from before the rename (an earlier build still running) asks for that one
    let req = format!("POST {path} HTTP/1.1\r\nHost: {host}\r\nx-kandinsky: 1\r\nx-atlas: 1\r\n{key}content-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len());
    s.write_all(req.as_bytes()).await?;
    let mut answer = Vec::new();
    s.read_to_end(&mut answer).await?;
    let answer = String::from_utf8_lossy(&answer);
    let (head, body) = answer.split_once("\r\n\r\n").unwrap_or((&answer, ""));
    if !head.split(' ').nth(1).is_some_and(|code| code.starts_with('2')) {
        return Err(std::io::Error::other(head.lines().next().unwrap_or("no answer").to_string()));
    }
    Ok(body.to_string())
}

/// `http://host:port/v/name/` → (`host:port`, `/v/name`).
fn split_base(base: &str) -> (&str, &str) {
    let rest = base.trim_start_matches("http://").trim_end_matches('/');
    match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, ""),
    }
}

/// The Vite dev server of the repository Kandinsky was built from, proxying `/api` to this window's core.
struct DevUi {
    url: String,
    vite: std::process::Child,
}

fn dev_ui(core: &str, key: Option<&str>) -> anyhow::Result<DevUi> {
    // KANDINSKY_REPO (written by install.sh): auto-install builds from a temporary copy, so the build's own path is not the repo
    let repo = kandinsky_core::env::var_os("REPO").map(std::path::PathBuf::from).unwrap_or_else(|| std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(".."));
    let ui = repo.join("ui");
    anyhow::ensure!(ui.join("package.json").is_file(), "KANDINSKY_DEV: no UI sources at {} (this build came from elsewhere)", ui.display());
    let port = (5174..5200).find(|p| std::net::TcpListener::bind(("127.0.0.1", *p)).is_ok()).ok_or_else(|| anyhow::anyhow!("KANDINSKY_DEV: no free port for Vite"))?;
    eprintln!("kandinsky-app: dev mode: Vite on {port}, from {}", ui.display());
    let vite = std::process::Command::new("npm")
        // --host: "localhost" may resolve to ::1 only, and the window below waits on 127.0.0.1
        .args(["run", "dev", "--", "--host", "127.0.0.1", "--port", &port.to_string(), "--strictPort"])
        .current_dir(&ui)
        .envs(kandinsky_core::env::both("API").map(|n| (n, core)))
        .envs(kandinsky_core::env::both("API_KEY").map(|n| (n, key.unwrap_or_default()))) // vite.config.ts: the proxy signs its requests with it
        .spawn()?;
    // the window must not open on a server that is not listening yet
    for _ in 0..150 {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return Ok(DevUi { url: format!("http://127.0.0.1:{port}/"), vite });
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    anyhow::bail!("KANDINSKY_DEV: Vite did not start on port {port} in 15 s")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webview_finds_its_proxy_through_winhttp_and_keeps_wrys_defaults() {
        // Chromium's own proxy discovery held the first request (the core's page) ~20 s: the window stayed empty
        assert!(WEBVIEW2_ARGS.split(' ').any(|a| a == "--winhttp-proxy-resolver"));
        assert!(WEBVIEW2_ARGS.contains("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"));
        assert!(!WEBVIEW2_ARGS.contains("--no-proxy-server"), "a proxy the system names must keep working");
    }

    #[test]
    fn the_window_before_its_page_is_the_pages_background() {
        // palettes.css `plain` and tokens.css `--bg-app`, as ui/index.html paints them
        assert_eq!(page_background(true, true), (0x20, 0x20, 0x20));
        assert_eq!(page_background(false, true), (0xf7, 0xf7, 0xf5));
        assert_eq!(page_background(true, false), (0x12, 0x13, 0x17));
        assert_eq!(page_background(false, false), (0xea, 0xe6, 0xde));
    }

    #[test]
    fn a_vaults_address_splits_into_its_host_and_its_prefix() {
        assert_eq!(split_base("http://127.0.0.1:4000/v/notes/"), ("127.0.0.1:4000", "/v/notes"));
        assert_eq!(split_base("http://127.0.0.1:4000/"), ("127.0.0.1:4000", ""));
        assert_eq!(split_base("http://127.0.0.1:4000"), ("127.0.0.1:4000", ""));
    }

    #[test]
    fn the_welcome_page_parses_and_leads_to_a_vault() {
        let p = kandinsky_core::page::parse(WELCOME_PAGE).unwrap();
        assert_eq!(p.title.as_deref(), Some("Welcome"));
        let blocks: Vec<_> = p.rows.iter().flat_map(|r| r.columns.iter().flatten()).collect();
        assert!(blocks.iter().any(|b| matches!(b, kandinsky_core::api::PageBlock::View { view, .. } if view == "vaults")), "the buttons to a vault");
        // the keys it names are the app's (actions.ts / vaults.ts), not another program's
        assert!(WELCOME_PAGE.contains("Ctrl+Alt+V") && !WELCOME_PAGE.contains("Ctrl+K"));
    }

    #[test]
    fn the_capture_box_opens_through_the_one_time_link() {
        assert_eq!(capture_page("http://127.0.0.1:7700/?k=abc"), "http://127.0.0.1:7700/capture.html?k=abc#capture");
        assert_eq!(capture_page("http://127.0.0.1:7700/v/work/?k=abc"), "http://127.0.0.1:7700/v/work/capture.html?k=abc#capture");
        assert_eq!(capture_page("http://127.0.0.1:7700/"), "http://127.0.0.1:7700/capture.html#capture", "an open core");
    }

    #[test]
    fn a_sign_in_page_is_known_by_its_local_return_address() {
        let ms: tauri::Url = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x&redirect_uri=https%3A%2F%2Flocalhost&scope=a".parse().unwrap();
        let back = signin_return(&ms).expect("a localhost redirect_uri");
        assert_eq!(back.as_str(), "https://localhost/");
        assert!(returns_to(&"https://localhost/?code=abc&state=s".parse().unwrap(), &back));
        assert!(!returns_to(&"https://localhost.evil.example/?code=abc".parse().unwrap(), &back));
        assert!(!returns_to(&"http://localhost/?code=abc".parse().unwrap(), &back), "another scheme");
        assert!(!returns_to(&"https://login.microsoftonline.com/common/login".parse().unwrap(), &back));

        let loopback: tauri::Url = "https://accounts.example/auth?redirect_uri=http://127.0.0.1:8400/cb".parse().unwrap();
        let back = signin_return(&loopback).unwrap();
        assert!(returns_to(&"http://127.0.0.1:8400/cb?code=1".parse().unwrap(), &back));
        assert!(!returns_to(&"http://127.0.0.1:8401/cb?code=1".parse().unwrap(), &back), "another port");

        let door: tauri::Url = "http://127.0.0.1:7700/signin/door?url=https%3A%2F%2Flinks.example.org%2Fapi".parse().unwrap();
        assert_eq!(door_target(&door).unwrap().as_str(), "https://links.example.org/api");
        assert!(door_target(&"https://evil.example/signin/door?url=https://links.example.org".parse().unwrap()).is_none(), "only this computer's core asks");
        assert!(door_target(&"http://127.0.0.1:7700/signin/door?url=file:///etc/passwd".parse().unwrap()).is_none());

        for plain in ["https://example.org/page", "https://x.example/auth?redirect_uri=https://app.example/cb", "https://x.example/?redirect_uri=file:///etc"] {
            assert!(signin_return(&plain.parse().unwrap()).is_none(), "{plain} goes to the browser");
        }
        // a server's sign-in returning to an app's own address (Audiobookshelf's mobile redirect): caught here too
        let abs: tauri::Url = "https://abs.example.org/auth/openid?code_challenge=x&redirect_uri=audiobookshelf%3A%2F%2Foauth&client_id=Audiobookshelf-App".parse().unwrap();
        let back = signin_return(&abs).expect("an app scheme is caught");
        assert!(returns_to(&"audiobookshelf://oauth?code=1&state=s".parse().unwrap(), &back));
        assert!(!returns_to(&"https://abs.example.org/login".parse().unwrap(), &back));
    }

    #[test]
    fn capture_paper_deep_link_parses_id_including_title_and_extracts_note_path() {
        let with_title = parse_paper_deep_link("kandinsky://capture-paper?title=More%20Is%20Different").unwrap();
        assert_eq!(with_title.get("id").and_then(|v| v.as_str()), Some("More Is Different"));

        let with_doi = parse_paper_deep_link("kandinsky://paper?doi=10.1126/science.177&title=Ignored").unwrap();
        assert_eq!(with_doi.get("id").and_then(|v| v.as_str()), Some("10.1126/science.177"));

        assert!(parse_paper_deep_link("https://example.org").is_none());

        // any page can launch the app with a link: only a well-formed paper capture is acted on, the rest is ignored
        // (never taken for a folder to open)
        for arg in ["kandinsky://foo", "KANDINSKY://capture-paper?doi=1", "kandinsky:capture-paper"] {
            assert!(is_deep_link(arg), "{arg}");
        }
        assert!(!is_deep_link("C:/notes") && !is_deep_link("kandinsky") && !is_deep_link("./kandinsky:x"));
        for bad in [
            "kandinsky://foo",
            "kandinsky://capture-paper",
            "kandinsky://capture-paper?x=1",
            "kandinsky://capture-paper.example.org?doi=10.1/x",
            "kandinsky://paperwork?doi=10.1/x",
            "kandinsky://capture-paper/../x?doi=10.1/x",
            "kandinsky://capture-paper?url=file:///etc/passwd",
            "kandinsky://capture-paper?title=%0Aline",
        ] {
            assert!(parse_paper_deep_link(bad).is_none(), "{bad}");
        }
        let only_known = parse_paper_deep_link("kandinsky://capture-paper?url=https://example.org/p&title=T&path=/etc/passwd").unwrap();
        let mut keys: Vec<&str> = only_known.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["id", "title", "url"]);
        assert_eq!(parse_paper_deep_link("KANDINSKY://capture-paper?doi=10.1/x").unwrap()["id"], "10.1/x");

        // the installers register this scheme with the system (the bundler reads plugins.deep-link.desktop), so the
        // bookmarklet's link starts this program; without it the browser finds no app for the link
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let schemes = conf["plugins"]["deep-link"]["desktop"]["schemes"].as_array().expect("deep-link schemes in tauri.conf.json");
        assert!(schemes.iter().any(|s| s == "kandinsky"), "{schemes:?}");
        assert!(parse_paper_deep_link("kandinsky://capture-paper?doi=10.1000/xyz123").is_some());

        assert_eq!(
            capture_paper_note_path(r#"{"paper":{"dir":"refs/papers/anderson1972more","key":"anderson1972more"},"created":true}"#).as_deref(),
            Some("refs/papers/anderson1972more/anderson1972more.md")
        );
        assert_eq!(
            capture_paper_note_path(r#"{"paper":{"dir":"","key":"solo"}}"#).as_deref(),
            Some("solo.md")
        );
        assert_eq!(
            capture_paper_note_path(r#"{"note":"notes/fallback.md"}"#).as_deref(),
            Some("notes/fallback.md")
        );
        assert_eq!(capture_paper_note_path(r#"{"key":"k1"}"#).as_deref(), Some("k1"));
    }
}
