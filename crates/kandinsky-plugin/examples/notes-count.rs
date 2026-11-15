//! A whole compiled helper: `notes_count` counts the vault's notes, `stamp` appends a line to one, both through the
//! core over the pipe. Build it static for a plugin's `bin/<target>/helper` (docs/guides/PLUGIN-API.md, "Calling Kandinsky back"):
//!   cargo build --release --example notes-count --target x86_64-unknown-linux-musl
use kandinsky_plugin::{serve, Kandinsky, Methods};
use serde_json::json;

fn main() {
    let mut m = Methods::new();
    m.add("notes_count", |_| {
        let n = Kandinsky::new().files(true)?.iter().filter(|p| p.ends_with(".md")).count();
        Ok(json!({ "notes": n }))
    });
    m.add("stamp", |p| {
        let kandinsky = Kandinsky::new();
        let path = p["path"].as_str().unwrap_or("Inbox.md");
        let text = kandinsky.read(path).unwrap_or_default();
        kandinsky.write(path, &format!("{text}- stamped by a compiled helper\n"))?;
        Ok(json!({ "ok": true }))
    });
    serve(m);
}
