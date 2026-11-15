//! AI agents on a locked local core (agents.rs, DESIGN-local-lock.md step 3), over HTTP: `kandinsky mcp` gets in only with
//! its own agent's token — not with this machine's key — an agent cannot allow agents, and a revoke shuts it out at once.
//! Its own test binary: `KANDINSKY_AGENTS_FILE` is this process's.
#![allow(clippy::disallowed_methods)] // a test writes its fixtures directly
use kandinsky_core::local_lock::Lock;
use kandinsky_core::server::{serve_on, Listen};
use reqwest::StatusCode;

#[tokio::test]
async fn an_agent_comes_in_with_its_own_token_until_revoked() {
    let state = tempfile::tempdir().unwrap();
    std::env::set_var("KANDINSKY_AGENTS_FILE", state.path().join("agents.json"));
    let vault = tempfile::tempdir().unwrap();
    std::fs::write(vault.path().join("note.md"), "# Note\n").unwrap();
    let srv = serve_on(vault.path().to_path_buf(), Listen::Local(0, Lock::Locked { fixed: None })).await.unwrap();
    let base = format!("http://127.0.0.1:{}", srv.port());
    let key = srv.key().unwrap().to_string();
    let http = reqwest::Client::new();
    let as_owner = |m: reqwest::Method, p: &str| http.request(m, format!("{base}{p}")).header("x-kandinsky", "1").header("authorization", format!("Bearer {key}"));
    let as_mcp = |t: &str| http.get(format!("{base}/api/file?path=note.md")).header("x-kandinsky", "1").header("x-kandinsky-client", "mcp").header("authorization", format!("Bearer {t}"));

    // the owner (this machine's key) allows an agent: its token and the MCP server entry that carries it, once
    let made: serde_json::Value = as_owner(reqwest::Method::POST, "/api/agents").json(&serde_json::json!({ "name": "Claude Code" })).send().await.unwrap().json().await.unwrap();
    let token = made["token"].as_str().unwrap().to_string();
    assert_eq!(made["mcp"]["mcpServers"]["kandinsky"]["env"]["KANDINSKY_AGENT_TOKEN"], token.as_str(), "{made}");
    assert_eq!(made["mcp"]["mcpServers"]["kandinsky"]["args"][0], "mcp");
    let list: serde_json::Value = as_owner(reqwest::Method::GET, "/api/agents").send().await.unwrap().json().await.unwrap();
    assert_eq!(list["agents"][0]["name"], "Claude Code");
    assert_eq!(list["locked"], true);
    assert!(!list.to_string().contains(&token), "the token is never listed");

    // `kandinsky mcp` with the machine's key alone is turned away, with the way in; with its token it gets in
    let r = as_mcp(&key).send().await.unwrap();
    assert_eq!(r.status(), StatusCode::UNAUTHORIZED);
    assert!(r.text().await.unwrap().contains("Settings → Agents"));
    assert_eq!(as_mcp(&token).send().await.unwrap().status(), StatusCode::OK);

    // an agent may not allow agents (nor revoke them)
    let mint = http.post(format!("{base}/api/agents")).header("x-kandinsky", "1").header("authorization", format!("Bearer {token}")).json(&serde_json::json!({ "name": "another" })).send().await.unwrap();
    assert_eq!(mint.status(), StatusCode::FORBIDDEN);

    // revoked: out at its next request
    assert_eq!(as_owner(reqwest::Method::DELETE, "/api/agents/Claude%20Code").send().await.unwrap().status(), StatusCode::NO_CONTENT);
    assert_eq!(as_mcp(&token).send().await.unwrap().status(), StatusCode::UNAUTHORIZED);
    let port = srv.port();
    srv.shutdown().await.unwrap();
    std::fs::remove_file(kandinsky_core::auth::local_key_file(port)).ok();
}
