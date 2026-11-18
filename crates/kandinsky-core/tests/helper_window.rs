//! A helper started with the vault (`start = "open"`) whose program awaits the user's approval, with no window open to
//! ask: the first window's events socket gets the prompt, an "Allow" starts the helper and a "Deny" is not asked again.
//! Its own test binary: the approval gate is the real one here (no `KANDINSKY_TRUST_TEST_BINARIES`), with a trust list
//! of its own (`KANDINSKY_TRUST_FILE`).
#![allow(clippy::disallowed_methods)] // a test writes its fixtures directly
use futures_util::StreamExt;
use kandinsky_core::api::{BinaryApprovalChoice, BinaryDecision, Event};
use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message};

type Socket = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// A helper answering every call, compiled into plugin `ids[0]` and copied to the others (`bin/<target>/helper`).
fn helpers(root: &Path, ids: &[&str]) {
    let exe = format!("helper{}", std::env::consts::EXE_SUFFIX);
    let built = root.join("build");
    std::fs::create_dir_all(&built).unwrap();
    let src = built.join("helper.rs");
    std::fs::write(
        &src,
        r#"use std::io::BufRead;
fn main() {
    for l in std::io::stdin().lock().lines() {
        let l = l.unwrap();
        let id: String = l.split("\"id\":").nth(1).unwrap().chars().take_while(|c| c.is_ascii_digit()).collect();
        println!("{{\"id\":{id},\"result\":true}}");
    }
}"#,
    )
    .unwrap();
    let ok = std::process::Command::new(std::env::var("RUSTC").unwrap_or("rustc".into())).arg("-o").arg(built.join(&exe)).arg(&src).status().unwrap();
    assert!(ok.success(), "rustc");
    for id in ids {
        let d = root.join(".kandinsky/plugins").join(id);
        let out = d.join("bin").join(kandinsky_core::plugins::target());
        std::fs::create_dir_all(&out).unwrap();
        std::fs::copy(built.join(&exe), out.join(&exe)).unwrap();
        std::fs::write(d.join("plugin.toml"), format!("title = \"{id}\"\n[helper]\nrun = \"\\\"$KANDINSKY_PLUGIN_DIR/bin/$KANDINSKY_PLUGIN_TARGET/helper\\\"\"\nstart = \"open\"\n")).unwrap();
    }
}

async fn events(port: u16) -> Socket {
    let req = format!("ws://127.0.0.1:{port}/api/events").into_client_request().unwrap();
    tokio_tungstenite::connect_async(req).await.unwrap().0
}

/// The next approval prompt on the socket, or None when none comes within `wait`.
async fn prompt(s: &mut Socket, wait: Duration) -> Option<kandinsky_core::api::PendingBinaryApproval> {
    tokio::time::timeout(wait, async {
        while let Some(Ok(m)) = s.next().await {
            if let Message::Text(t) = m {
                if let Ok(Event::BinaryApproval(p)) = serde_json::from_str::<Event>(&t) {
                    return Some(p);
                }
            }
        }
        None
    })
    .await
    .ok()
    .flatten()
}

/// The real approval gate, with a trust list of this test binary's own (shared by its tests, which run at once).
fn real_gate() {
    static CONF: std::sync::OnceLock<tempfile::TempDir> = std::sync::OnceLock::new();
    let conf = CONF.get_or_init(|| tempfile::tempdir().unwrap());
    std::env::remove_var("KANDINSKY_TRUST_TEST_BINARIES");
    std::env::set_var("KANDINSKY_TRUST_FILE", conf.path().join("trusted-binaries.json"));
}

async fn call(port: u16, method: reqwest::Method, path: &str, body: Value) -> Value {
    let req = reqwest::Client::new().request(method, format!("http://127.0.0.1:{port}{path}")).header("x-kandinsky", "1").json(&body);
    req.send().await.unwrap().json::<Value>().await.unwrap_or(Value::Null)
}

async fn state(port: u16, id: &str) -> String {
    call(port, reqwest::Method::GET, &format!("/api/plugins/{id}/helper"), Value::Null).await["state"].as_str().unwrap_or_default().to_string()
}

async fn running_soon(port: u16, id: &str, wait: Duration) -> String {
    let until = tokio::time::Instant::now() + wait;
    while tokio::time::Instant::now() < until && state(port, id).await != "running" {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    state(port, id).await
}

async fn decide(port: u16, id: String, choice: BinaryApprovalChoice) {
    call(port, reqwest::Method::POST, "/api/security/binaries/decide", json!(BinaryDecision { id, choice })).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_helper_waiting_for_approval_asks_the_first_window_that_connects() {
    real_gate();
    let vault = tempfile::tempdir().unwrap();
    helpers(vault.path(), &["allowed", "denied"]);
    let handle = kandinsky_core::serve(vault.path().to_path_buf(), 0).await.unwrap();
    let port = handle.port();
    // no window when the vault opened: nobody to ask, so neither started
    assert_eq!((state(port, "allowed").await, state(port, "denied").await), ("stopped".into(), "stopped".into()));

    // the first window's socket gets each prompt in turn
    let mut window = events(port).await;
    for _ in 0..2 {
        let p = prompt(&mut window, Duration::from_secs(20)).await.expect("an approval prompt on the window that connected");
        let choice = if p.plugin == "allowed" { BinaryApprovalChoice::AllowOnce } else { BinaryApprovalChoice::Deny };
        decide(port, p.id, choice).await;
    }
    assert_eq!(running_soon(port, "allowed", Duration::from_secs(5)).await, "running", "allowed: started");
    assert_eq!(state(port, "denied").await, "stopped");

    // the user's Deny holds for the session: the next window is not asked again
    let mut second = events(port).await;
    assert!(prompt(&mut second, Duration::from_millis(1500)).await.is_none(), "asked again after a Deny");
    assert_eq!(state(port, "denied").await, "stopped");

    call(port, reqwest::Method::POST, "/api/plugins/allowed/helper/stop", Value::Null).await;
    drop((window, second));
    handle.shutdown().await.unwrap();
}

/// The prompt ran out before the user answered (30 s): an "Allow" given there afterwards still starts the helper, with
/// no other window needed.
#[tokio::test(flavor = "multi_thread")]
async fn a_late_allow_after_the_prompt_ran_out_still_starts_the_helper() {
    real_gate();
    let vault = tempfile::tempdir().unwrap();
    helpers(vault.path(), &["late"]);
    let handle = kandinsky_core::serve(vault.path().to_path_buf(), 0).await.unwrap();
    let port = handle.port();
    let mut window = events(port).await;
    let p = prompt(&mut window, Duration::from_secs(20)).await.expect("an approval prompt on the window that connected");
    tokio::time::sleep(Duration::from_secs(31)).await;
    assert_eq!(state(port, "late").await, "stopped", "nobody answered in time");
    decide(port, p.id, BinaryApprovalChoice::AllowOnce).await;
    assert_eq!(running_soon(port, "late", Duration::from_secs(15)).await, "running", "the late Allow started it");

    call(port, reqwest::Method::POST, "/api/plugins/late/helper/stop", Value::Null).await;
    drop(window);
    handle.shutdown().await.unwrap();
}
