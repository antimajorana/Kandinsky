//! `kandinsky mcp`: a stdio MCP server so Claude Code drives Kandinsky with the same commands as the user.
//! Hand-rolled JSON-RPC (tools only) — small enough that an SDK dependency would cost more than it saves.
use crate::Server;
use anyhow::{anyhow, Result};
use kandinsky_core::{commands, notes, plugin_tools, search, today, Workspace};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

const PROTOCOL: &str = "2025-06-18";
const INSTRUCTIONS: &str = "Kandinsky is the user's workspace app. Use these tools BEFORE touching the vault's files directly: \
search with kandinsky_search, query structured .base views with kandinsky_query, inspect incoming body and typed frontmatter links with kandinsky_backlinks, \
edit frontmatter safely against the vault schema with kandinsky_set_property, validate vault properties and links with kandinsky_properties_audit, \
create notes with kandinsky_new_note, read mail with email_*, run the vault's commands with kandinsky_run — \
a tool keeps the vault's templates, properties, indexes and the open editors right; edit a file directly only for what no tool does. \
Use kandinsky_context to see the file/selection they are looking at, kandinsky_open to show them a file, kandinsky_notify when a long task finishes. \
To create a note, use kandinsky_new_note with a template from kandinsky_templates rather than writing the file yourself: the note then has the properties the vault's templates define. \
Tools marked [plugin x] come from the vault's plugins and run in the same helper the user's Kandinsky window uses (a signed-in \
mailbox, an ssh connection the user already logged in to): prefer them to doing the same thing yourself.";

/// The instructions, with what each switched-on plugin tells agents (`for_agents` in its plugin.toml).
fn instructions(ws: &Workspace) -> String {
    let words = ws.config().map(|cfg| plugin_tools::guidance(ws.root(), &cfg)).unwrap_or_default();
    let mut out = INSTRUCTIONS.to_string();
    if !words.is_empty() {
        out.push_str("\n\nFrom the vault's plugins:");
        for (id, text) in words {
            out.push_str(&format!("\n- [plugin {id}] {text}"));
        }
    }
    out
}

/// The built-in tools, then every switched-on plugin's `[[tool]]` (plugin_tools.rs).
fn tools(ws: &Workspace) -> Value {
    let mut all = builtin_tools();
    let plugins = ws.config().map(|cfg| plugin_tools::list(ws.root(), &cfg)).unwrap_or_default();
    if let Some(a) = all.as_array_mut() {
        a.extend(plugins.iter().map(|t| json!({"name": t.mcp_name(), "description": format!("[plugin {}] {}", t.plugin, t.description), "inputSchema": t.schema})));
    }
    all
}

fn builtin_tools() -> Value {
    let s = |props: Value, req: &[&str]| json!({"type": "object", "properties": props, "required": req});
    json!([
        {"name": "kandinsky_context", "description": "What the user is looking at in Kandinsky right now: active pane, open panes, and the current editor selection (path, 1-based lines, text). Needs the Kandinsky window.", "inputSchema": s(json!({}), &[])},
        {"name": "kandinsky_open", "description": "Open a workspace file in the user's Kandinsky window, optionally at a line. Use it to show the user what you changed or found.", "inputSchema": s(json!({"path": {"type": "string", "description": "workspace-relative"}, "line": {"type": "integer"}}), &["path"])},
        {"name": "kandinsky_notify", "description": "Show a toast in the Kandinsky window (e.g. a long job finished).", "inputSchema": s(json!({"title": {"type": "string"}, "body": {"type": "string"}}), &["title"])},
        {"name": "kandinsky_capture", "description": "Append a timestamped line to today's log (the user's capture inbox). Only when the user asks.", "inputSchema": s(json!({"text": {"type": "string"}}), &["text"])},
        {"name": "kandinsky_today", "description": "Today's focus file, log, open tasks and recent activity (commits, changed files).", "inputSchema": s(json!({}), &[])},
        {"name": "kandinsky_tasks", "description": "The vault's tasks (Markdown `- [ ]` lines in every note, the Obsidian Tasks plugin's fields read): each one's path, line, text, title, due/scheduled/start dates, priority, tags. Open ones by default.", "inputSchema": s(json!({
            "status": {"type": "string", "enum": ["open", "done", "all"], "description": "default: open"},
            "query": {"type": "string", "description": "words the task must contain (case-insensitive), e.g. a #tag or a name"},
            "due_by": {"type": "string", "description": "YYYY-MM-DD: only tasks due (or scheduled) on or before that day"},
            "limit": {"type": "integer", "description": "default 200"}
        }), &[])},
        {"name": "kandinsky_task_done", "description": "Tick one task as done, as the user's checkbox does (the Tasks plugin's ✅ date; a recurring task gets its next occurrence). Give path, line and text as kandinsky_tasks listed them; a line that changed since is refused. To add a task, use kandinsky_capture with `[] text @date`.", "inputSchema": s(json!({
            "path": {"type": "string"}, "line": {"type": "integer", "description": "1-based, from kandinsky_tasks"}, "text": {"type": "string", "description": "the task's text from kandinsky_tasks"}
        }), &["path", "line", "text"])},
        {"name": "kandinsky_search", "description": "Search workspace file names and contents (ripgrep, honors the Kandinsky ignore list).", "inputSchema": s(json!({"query": {"type": "string"}}), &["query"])},
        {"name": "kandinsky_commands", "description": "List Kandinsky commands (built-ins and the workspace's .kandinsky/commands scripts).", "inputSchema": s(json!({}), &[])},
        {"name": "kandinsky_run", "description": "Run an Kandinsky command by id with JSON args (see kandinsky_commands).", "inputSchema": s(json!({"id": {"type": "string"}, "args": {"type": "object"}}), &["id"])},
        {"name": "kandinsky_templates", "description": "The vault's note templates (what kandinsky_new_note takes): each one's name, the folder its notes are filed in, the properties its frontmatter defines, and the questions it asks (`prompts`, answered through kandinsky_new_note's `fields`).", "inputSchema": s(json!({}), &[])},
        {"name": "kandinsky_new_note", "description": "Create a note from one of the vault's templates (see kandinsky_templates), the way the user's \"New note from a template\" does: its {{…}} filled in (docs/guides/TEMPLATES.md: dates, values, prompts, includes, if/each), the template's properties there, `fields` set (they also answer its {{prompt:…}} questions). Prefer this to writing a new note by hand. Refuses a path that exists (never overwrites); returns the path, the caret line, and `added`: fields the template does not define.", "inputSchema": s(json!({
            "path": {"type": "string", "description": "workspace-relative file path, e.g. notes/physics/Mott.md (.md added when missing); use the template's folder unless the user said otherwise"},
            "template": {"type": "string", "description": "a template name from kandinsky_templates; without it the note starts empty"},
            "title": {"type": "string", "description": "{{title}} in the template; default: the file name"},
            "fields": {"type": "object", "description": "properties to set: {name: text | number | boolean | list | null}", "additionalProperties": true},
            "text": {"type": "string", "description": "the body, appended after the template's text"}
        }), &["path"])},
        {"name": "kandinsky_query", "description": "Evaluate an Obsidian .base database view (from a vault .base `path` or inline `yaml`), including formulas, rollups and file.upstreamStatus.", "inputSchema": s(json!({
            "path": {"type": "string", "description": "workspace-relative .base file path (provide `path` or `yaml`)"},
            "yaml": {"type": "string", "description": "inline .base YAML query source (provide `yaml` or `path`)"},
            "this": {"type": "string", "description": "optional note path bound to `this.*`"},
            "view": {"type": "string", "description": "optional view name to narrow the returned views"}
        }), &[])},
        {"name": "kandinsky_backlinks", "description": "List incoming links to a vault file (`path`): both Markdown body links/embeds and typed frontmatter property links (with `relation`), plus unlinked mentions.", "inputSchema": s(json!({
            "path": {"type": "string", "description": "workspace-relative target file path, e.g. notes/Concept.md"}
        }), &["path"])},
        {"name": "kandinsky_set_property", "description": "Atomically set or remove (`remove: true`) one frontmatter property on a Markdown note, validated against the vault's properties.yaml schema and triggering bidirectional .base back-relations.", "inputSchema": s(json!({
            "path": {"type": "string", "description": "workspace-relative .md note path"},
            "key": {"type": "string", "description": "frontmatter property key"},
            "value": {"description": "new scalar/list value (string, number, boolean, array, or null)"},
            "remove": {"type": "boolean", "description": "true to delete the property key from frontmatter"},
            "force": {"type": "boolean", "description": "skip schema validation when setting an out-of-spec value"}
        }), &["path", "key"])},
        {"name": "kandinsky_properties_audit", "description": "Validate every indexed Markdown note's frontmatter against the vault's properties.yaml schema and link index (missing required properties, invalid enum/date/datetime/number/bool values, broken wikilinks, and optional `strict` unknown keys).", "inputSchema": s(json!({
            "strict": {"type": "boolean", "description": "also flag properties not declared in properties.yaml"},
            "path_prefix": {"type": "string", "description": "optional folder/file prefix filter on reported issues"}
        }), &[])},
    ])
}

async fn call(ws: &Workspace, local: &kandinsky_core::helper::Helpers, server: Option<&Server>, name: &str, a: &Value) -> Result<Value> {
    let need = || server.ok_or_else(|| anyhow!("the Kandinsky window is not running for {}", ws.root().display()));
    let str_arg = |k: &str| a[k].as_str().map(str::to_owned).ok_or_else(|| anyhow!("missing argument `{k}`"));
    Ok(match name {
        "kandinsky_context" => need()?.get("/api/ui/state").await?,
        "kandinsky_open" => need()?.cmd("open", json!({"path": str_arg("path")?, "line": a.get("line")})).await?,
        "kandinsky_notify" => need()?.cmd("notify", json!({"title": str_arg("title")?, "body": a.get("body")})).await?,
        "kandinsky_capture" => run(ws, server, "capture", json!({"text": str_arg("text")?})).await?,
        "kandinsky_today" => match server {
            Some(s) => s.get("/api/today").await?,
            None => serde_json::to_value(today::today(ws.root(), &ws.config()?)?)?,
        },
        "kandinsky_tasks" => tasks_listed(ws, a)?,
        "kandinsky_task_done" => {
            let line = a["line"].as_u64().and_then(|l| u32::try_from(l).ok()).ok_or_else(|| anyhow!("missing argument `line`"))?;
            let t = kandinsky_core::api::TaskRef { path: str_arg("path")?, line, text: Some(str_arg("text")?) };
            match server {
                Some(s) => s.post("/api/task/tick", &serde_json::to_value(&t)?, std::time::Duration::from_secs(30)).await?,
                None => {
                    today::tick_ref(ws, &t)?;
                    json!({})
                }
            }
        }
        "kandinsky_search" => serde_json::to_value(search::search(ws.root(), &ws.config()?, &str_arg("query")?))?,
        "kandinsky_commands" => serde_json::to_value(commands::list(ws.root()))?,
        "kandinsky_run" => run(ws, server, &str_arg("id")?, a.get("args").cloned().unwrap_or(json!({}))).await?,
        "kandinsky_templates" => serde_json::to_value(notes::templates(ws.root(), &ws.config()?)?)?,
        "kandinsky_new_note" => {
            let fields = match a.get("fields") {
                None | Some(Value::Null) => Default::default(),
                Some(Value::Object(m)) => m.clone(),
                Some(_) => return Err(anyhow!("`fields` is an object: {{property: value}}")),
            };
            let path = str_arg("path")?;
            let req = notes::NoteFile { path: &path, template: a["template"].as_str(), title: a["title"].as_str(), fields, text: a["text"].as_str() };
            serde_json::to_value(notes::new_note_file(ws.root(), &ws.config()?, &req)?)?
        }
        "kandinsky_query" => query_base(ws, a)?,
        "kandinsky_backlinks" => {
            let path = str_arg("path")?;
            serde_json::to_value(kandinsky_core::links::backlinks(ws.root(), &ws.config()?, &path))?
        }
        "kandinsky_set_property" => set_note_property(ws, server, a).await?,
        "kandinsky_properties_audit" => {
            let strict = a["strict"].as_bool().unwrap_or(false);
            let mut report = kandinsky_core::properties_audit::audit(ws.root(), &ws.config()?, strict);
            if let Some(pfx) = a["path_prefix"].as_str().map(str::trim).filter(|s| !s.is_empty()) {
                let norm = pfx.trim_matches('/').replace('\\', "/");
                report.issues.retain(|i| i.path == norm || i.path.starts_with(&format!("{norm}/")) || i.path.starts_with(&norm));
            }
            serde_json::to_value(report)?
        }
        other => return plugin_tool(ws, local, server, other, a).await,
    })
}

fn query_base(ws: &Workspace, a: &Value) -> Result<Value> {
    let cfg = ws.config()?;
    let src = match (a["yaml"].as_str().or_else(|| a["query"].as_str()), a["path"].as_str()) {
        (Some(y), _) => y.to_string(),
        (None, Some(p)) => std::fs::read_to_string(ws.resolve(p)?)?,
        (None, None) => return Err(anyhow!("provide `path` (a .base file) or `yaml` (inline .base query)")),
    };
    let mut res = kandinsky_core::bases::evaluate(ws.root(), &cfg, &src, a["this"].as_str());
    if let Some(view_name) = a["view"].as_str().filter(|s| !s.trim().is_empty()) {
        res.views.retain(|v| v.name.eq_ignore_ascii_case(view_name.trim()));
    }
    Ok(serde_json::to_value(res)?)
}

async fn set_note_property(ws: &Workspace, server: Option<&Server>, a: &Value) -> Result<Value> {
    let path = a["path"].as_str().ok_or_else(|| anyhow!("missing argument `path`"))?;
    let key = a["key"].as_str().map(str::trim).filter(|k| !k.is_empty()).ok_or_else(|| anyhow!("missing argument `key`"))?;
    if !path.to_ascii_lowercase().ends_with(".md") {
        return Err(anyhow!("`path` must be a Markdown (.md) note"));
    }
    if key.contains([':', '\n', '\r']) || key.contains(" #") || key.starts_with(['-', '#', '"', '\'', '[', ']', '{', '}', ',', '&', '*', '!', '|', '>', '%', '@', '`', '?']) {
        return Err(anyhow!("`{key}` is not a valid frontmatter property name"));
    }
    let remove = a["remove"].as_bool().unwrap_or(false);
    let force = a["force"].as_bool().unwrap_or(false);
    let val = a.get("value").cloned().unwrap_or(Value::Null);
    if let Some(s) = server {
        return s
            .post(
                "/api/property",
                &json!({ "path": path, "key": key, "value": val, "remove": remove, "force": force }),
                std::time::Duration::from_secs(30),
            )
            .await;
    }
    let abs = ws.resolve(path)?;
    if !abs.is_file() {
        return Err(anyhow!("note not found: {path}"));
    }
    let cfg = ws.config()?;
    let specs = kandinsky_core::property_spec::load(ws.root(), &cfg.editor.properties_spec);
    if !remove && !val.is_null() && !force {
        if let Some(spec) = specs.properties.get(key) {
            if let Err(why) = kandinsky_core::properties_audit::validate_property_json_value(spec, &val) {
                return Err(anyhow!("invalid value for `{key}`: {why}"));
            }
        }
    }
    let mut before_buf = String::new();
    let mut after_buf = String::new();
    let edit = if remove {
        kandinsky_core::api::FrontmatterEdit::Remove { key: key.to_string() }
    } else {
        kandinsky_core::api::FrontmatterEdit::Set { key: key.to_string(), value: val }
    };
    kandinsky_core::vault_write::modify(&abs, |text| {
        before_buf = text.to_string();
        let next = kandinsky_core::frontmatter::apply(text, &edit)?;
        after_buf = next.clone();
        Ok(next)
    })?;
    let mut synced = Vec::new();
    if before_buf != after_buf {
        let _ = kandinsky_core::history::record_edit(ws, path, Some(&before_buf), &after_buf);
        if let Ok(extra) = kandinsky_core::bases::sync_back_relations(ws.root(), &cfg, path, &before_buf, &after_buf) {
            synced = extra;
        }
    }
    Ok(json!({ "path": path, "key": key, "changed": before_buf != after_buf, "synced_back_relations": synced }))
}

/// `kandinsky_tasks`: the vault's tasks, read from the files (the same scan as Home's), filtered as asked.
fn tasks_listed(ws: &Workspace, a: &Value) -> Result<Value> {
    let status = a["status"].as_str().unwrap_or("open");
    let words: Vec<String> = a["query"].as_str().unwrap_or("").to_lowercase().split_whitespace().map(String::from).collect();
    let by = match a["due_by"].as_str() {
        Some(d) => Some(chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").map_err(|_| anyhow!("`due_by` is YYYY-MM-DD"))?),
        None => None,
    };
    let limit = a["limit"].as_u64().unwrap_or(200) as usize;
    let out: Vec<Value> = today::all_tasks(ws.root(), &ws.config()?)
        .into_iter()
        .filter(|(_, done)| match status {
            "done" => *done,
            "all" => true,
            _ => !*done,
        })
        .filter(|(h, _)| {
            let low = h.text.to_lowercase();
            words.iter().all(|w| low.contains(w.as_str()))
        })
        .map(|(h, done)| (kandinsky_core::tasks::parse(&h.text), h, done))
        .filter(|(t, _, _)| by.is_none_or(|by| t.due.or(t.scheduled).is_some_and(|d| d <= by)))
        .take(limit)
        .map(|(t, h, done)| {
            let day = |d: Option<chrono::NaiveDate>| d.map(|d| d.to_string());
            json!({ "path": h.path, "line": h.line, "text": h.text, "done": done, "title": t.title, "due": day(t.due), "scheduled": day(t.scheduled),
                    "start": day(t.start), "priority": format!("{:?}", t.priority).to_lowercase(), "tags": t.tags, "recurrence": t.recurrence })
        })
        .collect();
    Ok(json!({ "tasks": out }))
}

/// A plugin's tool: in the window's helper when the window is open (the session the user sees),
/// else in this process's own helper, which lives as long as the agent's MCP connection.
async fn plugin_tool(ws: &Workspace, local: &kandinsky_core::helper::Helpers, server: Option<&Server>, name: &str, a: &Value) -> Result<Value> {
    let cfg = ws.config()?;
    let t = plugin_tools::list(ws.root(), &cfg).into_iter().find(|t| t.mcp_name() == name).ok_or_else(|| anyhow!("unknown tool {name}"))?;
    let args = if a.is_null() { json!({}) } else { a.clone() };
    match server {
        // the tool's own timeout, plus a margin so the core's timeout error arrives before ours
        Some(s) => s.post(&format!("/api/plugins/{}/tools/{}", t.plugin, t.name), &args, t.timeout + std::time::Duration::from_secs(5)).await,
        None => {
            let store = kandinsky_core::secrets::Store::for_vault(ws.root());
            Ok(plugin_tools::call(ws.root(), &cfg, local, &store, &t.plugin, &t.name, args).await?)
        }
    }
}

/// Through the live server when there is one (so the UI updates), else locally.
async fn run(ws: &Workspace, server: Option<&Server>, id: &str, args: Value) -> Result<Value> {
    match server {
        Some(s) => s.cmd(id, args).await,
        None => {
            let bus = kandinsky_core::events::EventBus::default();
            Ok(commands::run(ws, &bus, commands::Command::resolve(ws.root(), id, args)?).await?)
        }
    }
}

async fn handle(ws: &Workspace, local: &kandinsky_core::helper::Helpers, msg: &Value) -> Option<Value> {
    let id = msg.get("id")?.clone(); // notifications (no id) get no reply
    let result = match msg["method"].as_str().unwrap_or("") {
        "initialize" => Ok(json!({
            "protocolVersion": msg["params"]["protocolVersion"].as_str().unwrap_or(PROTOCOL),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "kandinsky", "version": env!("CARGO_PKG_VERSION")},
            "instructions": instructions(ws)
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({"tools": tools(ws)})),
        "tools/call" => {
            let p = &msg["params"];
            // Re-discover per call: the window may have been opened or closed since the last one.
            let server = Server::find(ws).await;
            let out = call(ws, local, server.as_ref(), p["name"].as_str().unwrap_or(""), &p["arguments"]).await;
            Ok(match out {
                Ok(v) => json!({"content": [{"type": "text", "text": serde_json::to_string_pretty(&v).unwrap_or_default()}]}),
                Err(e) => json!({"content": [{"type": "text", "text": e.to_string()}], "isError": true}),
            })
        }
        m => Err(json!({"code": -32601, "message": format!("method not found: {m}")})),
    };
    Some(match result {
        Ok(r) => json!({"jsonrpc": "2.0", "id": id, "result": r}),
        Err(e) => json!({"jsonrpc": "2.0", "id": id, "error": e}),
    })
}

pub async fn serve(ws: Workspace) -> Result<()> {
    let _ = crate::CLIENT.set("mcp");
    // a core that keeps this agent out (agents off on a server, a locked desktop without this agent's token) says so
    // at once — never a quiet fallback to the files behind the user's back
    if let crate::Reach::Refused(why) = Server::reach(&ws).await {
        anyhow::bail!("the Kandinsky serving this vault turned this agent away: {why}");
    }
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    let mut out = tokio::io::stdout();
    let (local, _guard) = crate::standalone_helpers(&ws);
    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(msg) => handle(&ws, &local, &msg).await,
            Err(e) => Some(json!({"jsonrpc": "2.0", "id": null, "error": {"code": -32700, "message": e.to_string()}})),
        };
        if let Some(r) = reply {
            out.write_all(format!("{r}\n").as_bytes()).await?;
            out.flush().await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn mcp_tools_query_backlinks_set_property_and_audit() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path();
        std::fs::create_dir_all(root.join(".kandinsky")).unwrap();
        std::fs::create_dir_all(root.join("templates")).unwrap();
        std::fs::create_dir_all(root.join("notes")).unwrap();
        std::fs::write(
            root.join("templates/properties.yaml"),
            "properties:\n  status:\n    kind: enum\n    values: [draft, active, accepted, stale]\n  updated:\n    kind: date\n  up:\n    kind: link\ntypes:\n  concept:\n    required: [status]\n",
        )
        .unwrap();
        std::fs::write(root.join("notes/Conventions.md"), "---\ntype: concept\nstatus: accepted\nupdated: 2026-10-10\n---\n# Conventions\n").unwrap();
        std::fs::write(root.join("notes/Derivation.md"), "---\ntype: concept\nup: \"[[Conventions]]\"\n---\n# Derivation\nSee [[Conventions]].\n").unwrap();
        std::fs::write(
            root.join("Research.base"),
            "filters:\n  and:\n    - file.inFolder(\"notes\")\nviews:\n  - type: table\n    name: All\n    order: [file.name, status, file.upstreamStatus]\n",
        )
        .unwrap();

        let ws = Workspace::open(root).unwrap();
        let local = kandinsky_core::helper::Helpers::new(ws.root(), kandinsky_core::events::EventBus::default());

        // 1. tools/list exposes all 4 new tools
        let listed = handle(&ws, &local, &json!({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})).await.unwrap();
        let names: Vec<String> = listed["result"]["tools"].as_array().unwrap().iter().filter_map(|t| t["name"].as_str().map(String::from)).collect();
        for expected in ["kandinsky_query", "kandinsky_backlinks", "kandinsky_set_property", "kandinsky_properties_audit"] {
            assert!(names.iter().any(|n| n == expected), "missing {expected} in {names:?}");
        }

        // 2. kandinsky_properties_audit catches missing required `status` on Derivation.md
        let audit = handle(&ws, &local, &json!({"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "kandinsky_properties_audit", "arguments": {}}})).await.unwrap();
        let report: Value = serde_json::from_str(audit["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(report["issues"].as_array().unwrap().len(), 1);
        assert_eq!(report["issues"][0]["path"], "notes/Derivation.md");

        // 3. kandinsky_set_property rejects invalid enum values and accepts valid ones
        let bad = handle(&ws, &local, &json!({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "kandinsky_set_property", "arguments": {"path": "notes/Derivation.md", "key": "status", "value": "bogus"}}})).await.unwrap();
        assert_eq!(bad["result"]["isError"], true);
        let ok = handle(&ws, &local, &json!({"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "kandinsky_set_property", "arguments": {"path": "notes/Derivation.md", "key": "status", "value": "active"}}})).await.unwrap();
        assert!(ok["result"].get("isError").is_none(), "{ok}");

        // 4. kandinsky_backlinks reports both typed frontmatter (`up`) and body links
        let bl = handle(&ws, &local, &json!({"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {"name": "kandinsky_backlinks", "arguments": {"path": "notes/Conventions.md"}}})).await.unwrap();
        let bl_val: Value = serde_json::from_str(bl["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
        let links = bl_val["links"].as_array().unwrap();
        assert!(links.len() >= 2, "{bl_val}");
        assert!(links.iter().any(|l| l["relation"] == "up"), "{bl_val}");

        // 5. kandinsky_query evaluates Research.base
        let q = handle(&ws, &local, &json!({"jsonrpc": "2.0", "id": 6, "method": "tools/call", "params": {"name": "kandinsky_query", "arguments": {"path": "Research.base"}}})).await.unwrap();
        let q_val: Value = serde_json::from_str(q["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(q_val["views"][0]["count"], 2);
    }
}
