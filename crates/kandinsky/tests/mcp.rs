//! `kandinsky mcp` speaks JSON-RPC on stdio; file tools work without the window, UI tools fail loudly.
use serde_json::{json, Value};
use std::io::Write;
use std::process::{Command, Stdio};

fn session(ws: &std::path::Path, msgs: &[Value]) -> Vec<Value> {
    let mut child = Command::new(env!("CARGO_BIN_EXE_kandinsky"))
        .arg("--workspace")
        .arg(ws)
        .arg("mcp")
        .env("KANDINSKY_TRUST_TEST_BINARIES", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    for m in msgs {
        writeln!(stdin, "{m}").unwrap();
    }
    drop(stdin); // EOF ends the server
    let out = child.wait_with_output().unwrap();
    assert!(out.status.success(), "kandinsky mcp failed: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).lines().map(|l| serde_json::from_str(l).unwrap()).collect()
}

fn call(id: u32, name: &str, args: Value) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "method": "tools/call", "params": {"name": name, "arguments": args}})
}

#[test]
fn handshake_tools_and_offline_calls() {
    let d = tempfile::tempdir().unwrap();
    std::fs::write(d.path().join("FOCUS.md"), "# Focus\nMott transition\n").unwrap();
    std::fs::write(d.path().join("hubbard.md"), "the Hubbard model at half filling\n").unwrap();
    let replies = session(
        d.path(),
        &[
            json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}}),
            json!({"jsonrpc": "2.0", "method": "notifications/initialized"}),
            json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}),
            call(3, "kandinsky_capture", json!({"text": "IDEA: try the cumulant periodization"})),
            call(4, "kandinsky_today", json!({})),
            call(5, "kandinsky_search", json!({"query": "half filling"})),
            call(6, "kandinsky_context", json!({})),
            json!({"jsonrpc": "2.0", "id": 7, "method": "bogus"}),
        ],
    );
    assert_eq!(replies.len(), 7, "the notification gets no reply: {replies:?}");
    assert_eq!(replies[0]["result"]["serverInfo"]["name"], "kandinsky");
    let names: Vec<&str> = replies[1]["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
    assert!(
        names.contains(&"kandinsky_context")
            && names.contains(&"kandinsky_open")
            && names.contains(&"kandinsky_tasks")
            && names.contains(&"kandinsky_query")
            && names.contains(&"kandinsky_backlinks")
            && names.contains(&"kandinsky_set_property")
            && names.contains(&"kandinsky_properties_audit")
            && names.len() == 29,
        "{names:?}"
    );
    assert!(replies[2]["result"]["isError"].is_null(), "{}", replies[2]);
    let today = replies[3]["result"]["content"][0]["text"].as_str().unwrap();
    assert!(today.contains("cumulant periodization") && today.contains("Mott transition"), "{today}");
    assert!(replies[4]["result"]["content"][0]["text"].as_str().unwrap().contains("hubbard.md"));
    assert_eq!(replies[5]["result"]["isError"], true, "context needs the window");
    assert_eq!(replies[6]["error"]["code"], -32601);
}

#[test]
fn tasks_are_listed_filtered_and_ticked_through_the_one_tick() {
    let d = tempfile::tempdir().unwrap();
    std::fs::write(d.path().join("plan.md"), "# Plan\n- [ ] write the DMFT section #thesis 📅 2026-11-10\n- [ ] buy milk\n- [x] old one ✅ 2026-11-01\n").unwrap();
    let text = |r: &Value| serde_json::from_str::<Value>(r["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    let replies = session(
        d.path(),
        &[
            call(1, "kandinsky_tasks", json!({})),
            call(2, "kandinsky_tasks", json!({"query": "#thesis", "due_by": "2026-11-30"})),
            call(3, "kandinsky_tasks", json!({"status": "done"})),
            call(4, "kandinsky_task_done", json!({"path": "plan.md", "line": 2, "text": "write the DMFT section"})),
            call(5, "kandinsky_task_done", json!({"path": "plan.md", "line": 3, "text": "something else"})),
            call(6, "kandinsky_tasks", json!({"due_by": "soon"})),
        ],
    );
    let open = text(&replies[0]);
    assert_eq!(open["tasks"].as_array().unwrap().len(), 2, "{open}");
    let thesis = text(&replies[1]);
    assert_eq!(thesis["tasks"].as_array().unwrap().len(), 1, "{thesis}");
    assert_eq!((thesis["tasks"][0]["due"].as_str(), thesis["tasks"][0]["line"].as_u64()), (Some("2026-11-10"), Some(2)));
    assert_eq!(text(&replies[2])["tasks"].as_array().unwrap().len(), 1);
    assert!(replies[3]["result"]["isError"].is_null(), "{}", replies[3]);
    assert!(std::fs::read_to_string(d.path().join("plan.md")).unwrap().contains("- [x] write the DMFT section"), "ticked in the file");
    assert_eq!(replies[4]["result"]["isError"], true, "a line that changed is refused");
    assert_eq!(replies[5]["result"]["isError"], true, "a bad day is said");
}

#[test]
fn notes_from_the_vaults_templates_and_never_over_an_existing_one() {
    let d = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(d.path().join("templates")).unwrap();
    std::fs::write(d.path().join("templates/literature.md"), "---\ntype: Literature\ncreated: {{date}}\nsources:\ncreate_in: notes/papers\n---\n# {{title}}\n").unwrap();
    let new = |id, path: &str| call(id, "kandinsky_new_note", json!({"path": path, "template": "literature", "fields": {"sources": ["[[koch2008sum]]"]}, "text": "## What it says"}));
    let replies = session(
        d.path(),
        &[
            json!({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}),
            call(2, "kandinsky_templates", json!({})),
            new(3, "notes/papers/Sum rules"),
            new(4, "notes/papers/Sum rules.md"),
            call(5, "kandinsky_new_note", json!({"path": "notes/x.md", "fields": "type=idea"})),
        ],
    );
    let names: Vec<&str> = replies[0]["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
    assert!(names.contains(&"kandinsky_new_note") && names.contains(&"kandinsky_templates"), "{names:?}");
    let text = |i: usize| replies[i]["result"]["content"][0]["text"].as_str().unwrap().to_string();
    let templates: Value = serde_json::from_str(&text(1)).unwrap();
    assert_eq!(templates, json!([{"name": "literature", "default": false, "path": "templates/literature.md", "folder": "notes/papers", "properties": ["type", "created", "sources"], "prompts": [], "applies": ["the note of any file (the literature template)"], "asks": []}]));
    let made: Value = serde_json::from_str(&text(2)).unwrap();
    assert_eq!(made["path"], "notes/papers/Sum rules.md");
    let note = std::fs::read_to_string(d.path().join("notes/papers/Sum rules.md")).unwrap();
    assert!(note.starts_with("---\ntype: Literature\ncreated: 20") && note.contains("sources:\n  - '[[koch2008sum]]'\n---\n# Sum rules\n## What it says\n"), "{note}");
    assert_eq!(replies[3]["result"]["isError"], true, "the same path again is refused");
    assert!(text(3).contains("already exists"), "{}", text(3));
    assert_eq!(std::fs::read_to_string(d.path().join("notes/papers/Sum rules.md")).unwrap(), note, "and the note is untouched");
    assert_eq!(replies[4]["result"]["isError"], true, "fields must be an object");
    assert!(!d.path().join("notes/x.md").exists());
}

#[test]
fn a_plugins_word_to_agents_is_in_the_instructions_while_it_is_on() {
    let d = tempfile::tempdir().unwrap();
    for (id, words) in [("remote", "For a command on a host, use remote_run, never ssh in your own shell."), ("quiet", "Never shown: switched off.")] {
        std::fs::create_dir_all(d.path().join(format!(".kandinsky/plugins/{id}"))).unwrap();
        std::fs::write(d.path().join(format!(".kandinsky/plugins/{id}/plugin.toml")), format!("title = \"{id}\"\nfor_agents = \"{words}\"\n")).unwrap();
    }
    std::fs::write(d.path().join(".kandinsky/config.toml"), "[plugins]\noff = [\"quiet\"]\n").unwrap();
    let init = json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}});
    let text = session(d.path(), &[init])[0]["result"]["instructions"].as_str().unwrap().to_string();
    assert!(text.contains("- [plugin remote] For a command on a host, use remote_run, never ssh in your own shell."), "{text}");
    assert!(!text.contains("Never shown"), "{text}");
}

#[test]
fn part_b_tools_query_backlinks_set_property_and_audit_over_stdio() {
    let d = tempfile::tempdir().unwrap();
    let root = d.path();
    std::fs::create_dir_all(root.join(".kandinsky")).unwrap();
    std::fs::create_dir_all(root.join("templates")).unwrap();
    std::fs::create_dir_all(root.join("notes")).unwrap();
    std::fs::write(
        root.join("templates/properties.yaml"),
        "properties:\n  status:\n    kind: enum\n    values: [draft, active, accepted, stale]\n  up:\n    kind: link\ntypes:\n  concept:\n    required: [status]\n",
    )
    .unwrap();
    std::fs::write(root.join("notes/Conventions.md"), "---\ntype: concept\nstatus: accepted\n---\n# Conventions\n").unwrap();
    std::fs::write(root.join("notes/Derivation.md"), "---\ntype: concept\nup: \"[[Conventions]]\"\n---\n# Derivation\nSee [[Conventions]].\n").unwrap();
    std::fs::write(
        root.join("Research.base"),
        "filters:\n  and:\n    - file.inFolder(\"notes\")\nviews:\n  - type: table\n    name: All\n    order: [file.name, status]\n",
    )
    .unwrap();

    let replies = session(
        root,
        &[
            call(1, "kandinsky_properties_audit", json!({})),
            call(2, "kandinsky_set_property", json!({"path": "notes/Derivation.md", "key": "status", "value": "bogus"})),
            call(3, "kandinsky_set_property", json!({"path": "notes/Derivation.md", "key": "status", "value": "active"})),
            call(4, "kandinsky_backlinks", json!({"path": "notes/Conventions.md"})),
            call(5, "kandinsky_query", json!({"path": "Research.base"})),
        ],
    );
    let parse_text = |r: &Value| -> Value { serde_json::from_str(r["result"]["content"][0]["text"].as_str().unwrap()).unwrap() };

    let audit = parse_text(&replies[0]);
    assert_eq!(audit["issues"].as_array().unwrap().len(), 1, "{audit}");
    assert_eq!(audit["issues"][0]["path"], "notes/Derivation.md");
    assert_eq!(replies[1]["result"]["isError"], true, "invalid enum must fail: {}", replies[1]);
    assert!(replies[2]["result"]["isError"].is_null(), "{}", replies[2]);
    let bl = parse_text(&replies[3]);
    assert!(bl["links"].as_array().unwrap().iter().any(|l| l["relation"] == "up"), "{bl}");
    let q = parse_text(&replies[4]);
    assert_eq!(q["views"][0]["count"], 2, "{q}");
}

fn find_papers_bin() -> std::path::PathBuf {
    let exe_name = if cfg!(windows) { "papers.exe" } else { "papers" };
    let kandinsky_bin = std::path::Path::new(env!("CARGO_BIN_EXE_kandinsky"));
    let target_dir = format!("{}-{}", std::env::consts::ARCH, std::env::consts::OS);
    let mut candidates = Vec::new();
    if let Some(dir) = kandinsky_bin.parent() {
        candidates.push(dir.join(exe_name));
        if let Some(parent) = dir.parent() {
            candidates.push(parent.join(exe_name));
        }
    }
    let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    if let Some(repo_root) = manifest_dir.parent().and_then(|p| p.parent()) {
        candidates.push(repo_root.join("target/debug").join(exe_name));
        candidates.push(repo_root.join("target/release").join(exe_name));
        candidates.push(repo_root.join("plugins/beta/catalog-papers/bin").join(&target_dir).join(exe_name));
    }
    candidates.into_iter().find(|p| p.is_file()).unwrap_or_else(|| {
        panic!(
            "catalog-papers helper binary ({exe_name}) not found beside {} or in target/ / plugins/beta/catalog-papers/bin/{target_dir}/; build it first with `cargo build -p kandinsky-papers`",
            kandinsky_bin.display()
        )
    })
}

fn install_catalog_papers(vault: &std::path::Path, settings_toml: &str) {
    let papers_bin = find_papers_bin();
    let bin_str = papers_bin.to_string_lossy().replace('\\', "/").replace('"', "\\\"");
    let manifest_src = include_str!("../../../plugins/beta/catalog-papers/plugin.toml");
    let mut replaced = false;
    let mut manifest = String::new();
    for line in manifest_src.lines() {
        if line.trim_start().starts_with("run =") && !replaced {
            manifest.push_str(&format!("run = \"\\\"{bin_str}\\\"\"\n"));
            replaced = true;
        } else {
            manifest.push_str(line);
            manifest.push('\n');
        }
    }
    assert!(replaced, "expected `[helper] run =` line in catalog-papers plugin.toml");
    let pdir = vault.join(".kandinsky/plugins/catalog-papers");
    std::fs::create_dir_all(&pdir).unwrap();
    std::fs::write(pdir.join("plugin.toml"), manifest).unwrap();
    let sdir = vault.join(".kandinsky/plugin-settings");
    std::fs::create_dir_all(&sdir).unwrap();
    std::fs::write(sdir.join("catalog-papers.toml"), settings_toml).unwrap();
}

fn tiny_pdf(lines: &[&str], page_count: usize) -> Vec<u8> {
    assert!(page_count >= 1);
    let esc = |s: &str| s.replace('\\', "\\\\").replace('(', "\\(").replace(')', "\\)");
    let mut stream = String::from("BT /F1 14 Tf 40 700 Td ");
    for (i, line) in lines.iter().enumerate() {
        if i > 0 {
            stream.push_str("0 -24 Td ");
        }
        stream.push_str(&format!("({}) Tj ", esc(line)));
    }
    stream.push_str("ET");
    let kids: Vec<String> = (0..page_count).map(|i| format!("{} 0 R", 6 + i)).collect();
    let mut objs: Vec<String> = vec![
        "<< /Type /Catalog /Pages 2 0 R >>".into(),
        format!("<< /Type /Pages /Kids [{}] /Count {page_count} >>", kids.join(" ")),
        format!("<< /Length {} >>\nstream\n{stream}\nendstream", stream.len()),
        "<< /Length 0 >>\nstream\n\nendstream".into(),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".into(),
    ];
    for i in 0..page_count {
        let content_id = if i == 0 { 3 } else { 4 };
        objs.push(format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 800] /Contents {content_id} 0 R /Resources << /Font << /F1 5 0 R >> >> >>"
        ));
    }
    let mut out = String::from("%PDF-1.4\n");
    let mut offsets = Vec::with_capacity(objs.len());
    for (idx, obj) in objs.iter().enumerate() {
        offsets.push(out.len());
        out.push_str(&format!("{} 0 obj\n{obj}\nendobj\n", idx + 1));
    }
    let xref = out.len();
    out.push_str(&format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1));
    for off in offsets {
        out.push_str(&format!("{off:010} 00000 n \n"));
    }
    out.push_str(&format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objs.len() + 1));
    out.into_bytes()
}

fn has_any_pdf(dir: &std::path::Path) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else { return false };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() && has_any_pdf(&p) {
            return true;
        }
        if p.is_file() && p.extension().is_some_and(|x| x.eq_ignore_ascii_case("pdf")) {
            return true;
        }
    }
    false
}

#[test]
fn catalog_papers_scan_external_roots_and_search_item_type() {
    let d = tempfile::tempdir().unwrap();
    let vault = d.path().join("vault");
    let papers_root = d.path().join("Library/Papers");
    let books_root = d.path().join("Library/Books");
    std::fs::create_dir_all(papers_root.join("CondensedMatter/DMFT")).unwrap();
    std::fs::create_dir_all(books_root.join("Textbooks")).unwrap();

    let paper_pdf = papers_root.join("CondensedMatter/DMFT/Hubbard_1963.pdf");
    let book_pdf = books_root.join("Textbooks/Altland_2023_Condensed_Matter_Field_Theory.pdf");
    let notebook = papers_root.join("CondensedMatter/DMFT/analysis.ipynb");
    std::fs::write(&paper_pdf, tiny_pdf(&["Electron Correlations in Narrow Energy Bands", "John Hubbard", "(Dated: 1963)"], 2)).unwrap();
    std::fs::write(&book_pdf, tiny_pdf(&["Condensed Matter Field Theory", "Alexander Altland", "(Dated: 2023)"], 120)).unwrap();
    std::fs::write(&notebook, r#"{"nbformat":4,"cells":[]}"#).unwrap();

    install_catalog_papers(&vault, "external_pdf_roots = [\"../Library/Papers\", \"../Library/Books\"]\n");

    let parse_text = |r: &Value| -> Value {
        assert!(r["result"]["isError"].is_null(), "tool call failed: {r}");
        serde_json::from_str(r["result"]["content"][0]["text"].as_str().unwrap()).unwrap()
    };
    let count_of = |v: &Value, k: &str| -> u64 { v[k].as_u64().or_else(|| v[k].as_array().map(|a| a.len() as u64)).unwrap_or(0) };

    let dry_replies = session(
        &vault,
        &[
            json!({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}),
            call(2, "catalog_papers_scan_external_roots", json!({"max_lookups": 0})),
            call(3, "catalog_papers_scan_external_roots", json!({"dry_run": true, "root": "../Library/Books", "max_lookups": 0})),
        ],
    );

    // 1. Audit MCP tool listing for catalog_papers_* tools and schemas
    let listed = dry_replies[0]["result"]["tools"].as_array().unwrap();
    let names: Vec<&str> = listed.iter().map(|t| t["name"].as_str().unwrap()).collect();
    for expected in [
        "catalog_papers_search_papers",
        "catalog_papers_paper_annotations",
        "catalog_papers_bibtex",
        "catalog_papers_find_duplicates",
        "catalog_papers_upgrade_preprint",
        "catalog_papers_fetch_arxiv_source",
        "catalog_papers_scan_external_roots",
    ] {
        assert!(names.contains(&expected), "missing {expected} in {names:?}");
    }
    let scan_tool = listed.iter().find(|t| t["name"] == "catalog_papers_scan_external_roots").unwrap();
    for param in ["dry_run", "root", "rate_limit_ms", "max_lookups"] {
        assert!(scan_tool["inputSchema"]["properties"][param].is_object(), "missing {param} schema: {scan_tool}");
    }
    let search_tool = listed.iter().find(|t| t["name"] == "catalog_papers_search_papers").unwrap();
    assert!(search_tool["inputSchema"]["properties"]["item_type"].is_object(), "{search_tool}");

    // 2. Dry-run preview (default when dry_run omitted): finds 2 PDFs, ignores .ipynb, writes nothing
    let preview = parse_text(&dry_replies[1]);
    assert_eq!(preview["dry_run"], true, "{preview}");
    assert_eq!(count_of(&preview, "roots_scanned"), 2, "{preview}");
    assert_eq!(preview["total_pdfs"], 2, "{preview}");
    assert_eq!(preview["created"], 2, "{preview}");
    assert_eq!(count_of(&preview, "errors"), 0, "{preview}");
    assert!(!vault.join("refs/papers").exists(), "dry-run must not create notes");
    assert!(!vault.join("refs/refs.bib").exists(), "dry-run must not write refs.bib");

    // 3. Single root filter dry-run
    let books_only = parse_text(&dry_replies[2]);
    assert_eq!(books_only["dry_run"], true, "{books_only}");
    assert_eq!(books_only["total_pdfs"], 1, "{books_only}");
    assert_eq!(books_only["items"][0]["bibtex_type"], "book", "{books_only}");

    // 4. Apply sync: creates paper & @book entries in place, ignores .ipynb
    let apply_replies = session(
        &vault,
        &[
            call(1, "catalog_papers_scan_external_roots", json!({"dry_run": false, "max_lookups": 0})),
            call(2, "catalog_papers_search_papers", json!({"item_type": "book"})),
            call(3, "catalog_papers_search_papers", json!({"item_type": "paper"})),
        ],
    );

    let applied = parse_text(&apply_replies[0]);
    assert_eq!(applied["dry_run"], false, "{applied}");
    assert_eq!(applied["total_pdfs"], 2, "{applied}");
    assert_eq!(applied["created"], 2, "{applied}");
    assert_eq!(count_of(&applied, "errors"), 0, "{applied}");
    let items = applied["items"].as_array().unwrap();
    assert_eq!(items.len(), 2, "{applied}");
    assert!(!items.iter().any(|it| it["pdf_ref"].as_str().unwrap_or("").contains("analysis.ipynb")), "{applied}");
    let book_item = items.iter().find(|it| it["bibtex_type"] == "book").expect("expected @book item");
    let paper_item = items.iter().find(|it| it["bibtex_type"] != "book").expect("expected paper item");
    assert!(
        paper_item["collections"].as_array().unwrap().iter().any(|c| {
            let s = c.as_str().unwrap_or("");
            s.contains("DMFT") || s.contains("CondensedMatter")
        }),
        "expected nested topic collection on paper: {paper_item}"
    );
    assert!(
        book_item["collections"].as_array().unwrap().iter().any(|c| c.as_str().unwrap_or("").contains("Textbooks")),
        "expected folder collection on book: {book_item}"
    );

    // PDFs stay strictly in place outside the vault
    assert!(paper_pdf.is_file() && book_pdf.is_file() && notebook.is_file());
    assert!(!has_any_pdf(&vault.join("refs/papers")), "zero PDFs may be copied into the vault");
    let bib = std::fs::read_to_string(vault.join("refs/refs.bib")).unwrap();
    let book_key = book_item["citekey"].as_str().unwrap().to_string();
    assert!(bib.contains(&format!("@book{{{book_key},")), "expected @book in refs.bib:\n{bib}");
    assert!(!bib.contains("analysis"), "non-PDF .ipynb must be ignored:\n{bib}");

    // 5. search_papers filters cleanly by item_type ("book" vs "paper")
    let books_search = parse_text(&apply_replies[1]);
    let books_arr = books_search.as_array().unwrap();
    assert_eq!(books_arr.len(), 1, "{books_search}");
    assert_eq!(books_arr[0]["key"], book_key);
    assert_eq!(books_arr[0]["pdf"], "../Library/Books/Textbooks/Altland_2023_Condensed_Matter_Field_Theory.pdf");

    let papers_search = parse_text(&apply_replies[2]);
    let papers_arr = papers_search.as_array().unwrap();
    assert_eq!(papers_arr.len(), 1, "{papers_search}");
    assert_eq!(papers_arr[0]["pdf"], "../Library/Papers/CondensedMatter/DMFT/Hubbard_1963.pdf");

    // 6. Move the paper PDF to a new subfolder inside external_pdf_roots and rescan
    let moved_pdf = papers_root.join("QuantumInfo/Mott/Hubbard_1963.pdf");
    std::fs::create_dir_all(moved_pdf.parent().unwrap()).unwrap();
    std::fs::rename(&paper_pdf, &moved_pdf).unwrap();

    let rescan_replies = session(
        &vault,
        &[
            call(1, "catalog_papers_scan_external_roots", json!({"dry_run": false, "max_lookups": 0})),
            call(2, "catalog_papers_search_papers", json!({"item_type": "paper"})),
            call(3, "catalog_papers_bibtex", json!({"key": book_key})),
        ],
    );

    let rescan = parse_text(&rescan_replies[0]);
    assert_eq!(rescan["moved"], 1, "{rescan}");
    assert_eq!(rescan["unchanged"], 1, "{rescan}");
    assert_eq!(rescan["created"], 0, "{rescan}");

    let moved_search = parse_text(&rescan_replies[1]);
    let moved_papers = moved_search.as_array().unwrap();
    assert_eq!(moved_papers.len(), 1, "{moved_search}");
    assert_eq!(moved_papers[0]["pdf"], "../Library/Papers/QuantumInfo/Mott/Hubbard_1963.pdf");
    assert!(
        moved_papers[0]["collections"].as_array().unwrap().iter().any(|c| {
            let s = c.as_str().unwrap_or("");
            s.contains("Mott") || s.contains("QuantumInfo")
        }),
        "expected updated collection after move: {moved_search}"
    );
    let bib_single = rescan_replies[2]["result"]["content"][0]["text"].as_str().unwrap();
    assert!(bib_single.contains(&format!("@book{{{book_key},")), "{bib_single}");
}

#[tokio::test(flavor = "multi_thread")]
async fn set_property_with_live_server_syncs_back_relations_without_double_history_write() {
    let d = tempfile::tempdir().unwrap();
    let root = d.path();
    std::fs::create_dir_all(root.join(".kandinsky")).unwrap();
    std::fs::create_dir_all(root.join("templates")).unwrap();
    std::fs::create_dir_all(root.join("tasks")).unwrap();
    std::fs::create_dir_all(root.join("projects")).unwrap();
    std::fs::write(
        root.join("templates/properties.yaml"),
        "properties:\n  status:\n    kind: enum\n    values: [todo, done]\n",
    )
    .unwrap();
    std::fs::write(
        root.join("Tasks.base"),
        "properties:\n  note.project:\n    back_relation: tasks\nviews:\n  - type: table\n    name: All\n    order: [file.name, project]\n",
    )
    .unwrap();
    std::fs::write(root.join("tasks/Fix.md"), "---\nstatus: todo\n---\n# Fix\n").unwrap();
    std::fs::write(root.join("projects/Alpha.md"), "---\ntype: project\n---\n# Alpha\n").unwrap();

    let handle = kandinsky_core::server::serve_on(
        root.to_path_buf(),
        kandinsky_core::server::Listen::Local(0, kandinsky_core::local_lock::Lock::Open),
    )
    .await
    .unwrap();

    let root_owned = root.to_path_buf();
    let replies = tokio::task::spawn_blocking(move || {
        session(
            &root_owned,
            &[
                call(1, "kandinsky_set_property", json!({"path": "tasks/Fix.md", "key": "status", "value": "bogus"})),
                call(2, "kandinsky_set_property", json!({"path": "tasks/Fix.md", "key": "project", "value": "[[Alpha]]"})),
            ],
        )
    })
    .await
    .unwrap();

    assert_eq!(replies[0]["result"]["isError"], true, "schema rejection via server: {}", replies[0]);
    assert!(replies[1]["result"]["isError"].is_null(), "{}", replies[1]);
    let res: Value = serde_json::from_str(replies[1]["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(res["changed"], true);
    assert_eq!(res["synced_back_relations"], json!(["projects/Alpha.md"]));

    let alpha = std::fs::read_to_string(root.join("projects/Alpha.md")).unwrap();
    assert!(alpha.contains("tasks:") && alpha.contains("[[Fix]]"), "{alpha}");
    let ws = kandinsky_core::Workspace::open(root).unwrap();
    let hist = kandinsky_core::history::list(&ws, "tasks/Fix.md").unwrap();
    let snaps = hist.entries.iter().filter(|e| e.source == kandinsky_core::api::HistorySource::Snapshot).count();
    assert_eq!(snaps, 2, "single server-side edit writes Before edit + Auto-saved only: {hist:?}");

    handle.shutdown().await.unwrap();
}

#[test]
fn offline_mcp_helper_callbacks_succeed_and_stop_on_exit() {
    let d = tempfile::tempdir().unwrap();
    let root = d.path();
    let plug = root.join(".kandinsky/plugins/echo");
    let out = plug.join("bin").join(kandinsky_core::plugins::target());
    std::fs::create_dir_all(&out).unwrap();
    let src = plug.join("helper.rs");
    std::fs::write(
        &src,
        r#"use std::io::{BufRead, Write};
fn count_body_objects(resp: &str) -> usize {
    let Some(after) = resp.split("\"body\":[").nth(1) else { return 0; };
    let (mut depth, mut in_str, mut esc, mut count) = (0usize, false, false, 0usize);
    for ch in after.chars() {
        if esc { esc = false; continue; }
        if in_str {
            if ch == '\\' { esc = true; } else if ch == '"' { in_str = false; }
            continue;
        }
        match ch {
            '"' => in_str = true,
            '{' => { if depth == 0 { count += 1; } depth += 1; }
            '}' => depth = depth.saturating_sub(1),
            ']' if depth == 0 => break,
            _ => {}
        }
    }
    count
}
fn main() {
    let pid_file = std::path::Path::new(&std::env::var("KANDINSKY_ROOT").unwrap()).join("helper.pid");
    std::fs::write(pid_file, std::process::id().to_string()).unwrap();
    let stdin = std::io::stdin();
    let mut lines = stdin.lock().lines();
    let mut stdout = std::io::stdout().lock();
    while let Some(Ok(l)) = lines.next() {
        let id: String = l.split("\"id\":").nth(1).unwrap_or("").chars().take_while(|c| c.is_ascii_digit()).collect();
        if l.contains("\"method\":\"probe\"") {
            writeln!(stdout, "{{\"call\":1,\"verb\":\"GET\",\"path\":\"/api/plugins\"}}").unwrap();
            stdout.flush().unwrap();
            let resp = lines.next().unwrap().unwrap();
            let status: u16 = resp.split("\"status\":").nth(1).unwrap_or("0").chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().unwrap_or(0);
            let count = count_body_objects(&resp);
            writeln!(stdout, "{{\"id\":{id},\"result\":{{\"status\":{status},\"count\":{count}}}}}").unwrap();
            stdout.flush().unwrap();
        }
    }
}"#,
    )
    .unwrap();
    let built = Command::new(std::env::var("RUSTC").unwrap_or("rustc".into()))
        .arg("-o")
        .arg(out.join(format!("helper{}", std::env::consts::EXE_SUFFIX)))
        .arg(&src)
        .status()
        .unwrap();
    assert!(built.success(), "rustc");
    std::fs::write(
        plug.join("plugin.toml"),
        "title = \"Echo\"\n[helper]\nrun = \"\\\"$KANDINSKY_PLUGIN_DIR/bin/$KANDINSKY_PLUGIN_TARGET/helper\\\"\"\n[[tool]]\nname = \"probe\"\ndescription = \"calls /api/plugins back\"\n",
    )
    .unwrap();

    let replies = session(root, &[call(1, "echo_probe", json!({}))]);
    assert!(replies[0]["result"]["isError"].is_null(), "{}", replies[0]);
    let res: Value = serde_json::from_str(replies[0]["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(res["status"], 200, "{res}");
    assert_eq!(res["count"], 1, "{res}");

    let pid: u32 = std::fs::read_to_string(root.join("helper.pid")).unwrap().trim().parse().unwrap();
    for _ in 0..50 {
        if !kandinsky_core::platform::proc::pid_alive(pid) {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    assert!(!kandinsky_core::platform::proc::pid_alive(pid), "standalone helper {pid} leaked after mcp exit");
}

/// The vault's structure as Kandinsky reads it (links, tags, properties, Bases, views, sync) works without the window; the
/// window's commands need it, and say so.
#[test]
fn the_vaults_structure_is_read_and_a_property_set_without_the_window() {
    let d = tempfile::tempdir().unwrap();
    std::fs::write(d.path().join("mott.md"), "---\nstatus: draft\n---\n# Mott\nSee [[hubbard]]. #physics\n- [ ] write it up 📅 2026-12-01\n").unwrap();
    std::fs::write(d.path().join("hubbard.md"), "# Hubbard\n#physics #model\n").unwrap();
    let replies = session(
        d.path(),
        &[
            call(1, "kandinsky_backlinks", json!({"path": "hubbard.md"})),
            call(2, "kandinsky_tags", json!({})),
            call(3, "kandinsky_set_property", json!({"path": "hubbard.md", "key": "status", "value": "done"})),
            call(4, "kandinsky_properties", json!({})),
            call(5, "kandinsky_query", json!({"src": "views:\n  - type: table\n    name: All\n"})),
            call(6, "kandinsky_view", json!({"src": "from: tasks\n", "path": "mott.md"})),
            call(7, "kandinsky_sync", json!({})),
            call(8, "kandinsky_ui_commands", json!({})),
            call(9, "kandinsky_ui_command", json!({"id": "ui.theme"})),
            call(10, "kandinsky_query", json!({})),
            call(11, "kandinsky_set_property", json!({"path": "hubbard.md", "key": "# no", "value": 1})),
        ],
    );
    let text = |i: usize| replies[i]["result"]["content"][0]["text"].as_str().unwrap().to_string();
    let ok = |i: usize| -> Value {
        assert!(replies[i]["result"]["isError"].is_null(), "{}", replies[i]);
        serde_json::from_str(&text(i)).unwrap()
    };
    assert_eq!(ok(0)["links"][0]["source"], "mott.md", "{}", text(0));
    let tags = ok(1);
    assert!(tags.as_array().unwrap().iter().any(|t| t["tag"] == "physics" && t["notes"] == 2), "{tags}");
    ok(2);
    assert!(std::fs::read_to_string(d.path().join("hubbard.md")).unwrap().starts_with("---\nstatus: done\n---\n# Hubbard\n"));
    assert!(text(3).contains("status"), "{}", text(3));
    let base = ok(4);
    assert_eq!(base["views"][0]["rows"].as_array().map(Vec::len), Some(2), "{base}");
    let view = ok(5);
    assert!(view["rows"].as_array().unwrap().iter().any(|r| r["path"] == "mott.md"), "{view}");
    assert!(ok(6)["state"].is_object(), "{}", text(6));
    for i in [7, 8] {
        assert_eq!(replies[i]["result"]["isError"], true, "the window's commands need the window: {}", replies[i]);
        assert!(text(i).contains("not running"), "{}", text(i));
    }
    assert_eq!(replies[9]["result"]["isError"], true, "a base needs a file or its text");
    assert_eq!(replies[10]["result"]["isError"], true, "not a property name");
}

/// Captures triaged, a note moved with its links, the settings read — the core's own functions, without the window; the
/// notices are the running Kandinsky's, and say so without it.
#[test]
fn captures_are_triaged_a_move_takes_its_links_and_the_settings_are_read() {
    let d = tempfile::tempdir().unwrap();
    let log = "notes/log/2026-11-15.md";
    std::fs::create_dir_all(d.path().join("notes/log")).unwrap();
    std::fs::write(d.path().join(log), "# Saturday\n\n- 09:12 read the Hubbard paper\n- 10:00 buy milk\n").unwrap();
    std::fs::create_dir_all(d.path().join(".kandinsky")).unwrap();
    std::fs::write(d.path().join(".kandinsky/config.toml"), "[editor]\nminimap = true\n").unwrap();
    let triage = |id, line: u32, source: &str, action: &str, note: Option<&str>| call(id, "kandinsky_triage", json!({"path": log, "line": line, "source": source, "action": action, "note": note}));
    let replies = session(
        d.path(),
        &[
            call(1, "kandinsky_captures", json!({})),
            triage(2, 3, "- 09:12 read the Hubbard paper", "file", Some("notes/Hubbard")),
            triage(3, 4, "- 10:00 buy milk", "delete", None),
            triage(4, 3, "- 09:12 read the Hubbard paper", "dismiss", None),
            triage(5, 3, "- 09:12 read the Hubbard paper → [[Hubbard]]", "file", None),
            call(6, "kandinsky_move", json!({"from": "notes/Hubbard.md", "to": "physics/Hubbard model.md"})),
            call(7, "kandinsky_move", json!({"from": "physics/Hubbard model.md", "to": log})),
            call(8, "kandinsky_settings", json!({"section": "editor"})),
            call(9, "kandinsky_settings", json!({"section": "nope"})),
            call(10, "kandinsky_settings", json!({})),
            call(11, "kandinsky_notices", json!({})),
            call(12, "kandinsky_notice_withdraw", json!({"id": "mail:inbox"})),
        ],
    );
    let text = |i: usize| replies[i]["result"]["content"][0]["text"].as_str().unwrap().to_string();
    let ok = |i: usize| -> Value {
        assert!(replies[i]["result"]["isError"].is_null(), "{}", replies[i]);
        serde_json::from_str(&text(i)).unwrap()
    };
    let read = |p: &str| std::fs::read_to_string(d.path().join(p)).unwrap_or_default();
    let listed = ok(0);
    assert_eq!(listed["open"], 2, "{listed}");
    assert!(listed["items"].as_array().unwrap().iter().any(|c| c["source"] == "- 09:12 read the Hubbard paper" && c["line"] == 3), "{listed}");
    // the files are read after the whole session: the filed note has moved by then (call 6), its link with it
    ok(1);
    ok(2);
    assert_eq!(read("physics/Hubbard model.md"), "# Hubbard\n\n- read the Hubbard paper ([[2026-11-15]])\n", "filed into the note made for it");
    assert!(!d.path().join("notes/Hubbard.md").exists(), "and moved");
    assert_eq!(read(log), "# Saturday\n\n- 09:12 read the Hubbard paper → [[Hubbard model]]\n", "linked, the link following the move, and the deleted one gone");
    let trash = walk(&d.path().join(".kandinsky/trash"));
    assert!(trash.iter().any(|p| std::fs::read_to_string(p).unwrap() == "- 10:00 buy milk\n"), "the deleted capture kept in the trash: {trash:?}");
    assert_eq!(replies[3]["result"]["isError"], true, "a line changed since it was listed is refused");
    assert!(text(4).contains("need `note`"), "{}", text(4));
    let moved = ok(5);
    assert_eq!(moved["links"], 1, "{moved}");
    assert_eq!(replies[6]["result"]["isError"], true, "never over an existing file");
    assert!(read(log).starts_with("# Saturday"), "and that file untouched");
    let editor = ok(7);
    assert_eq!((editor["path"].as_str(), editor["settings"]["editor"]["minimap"].as_bool()), (Some(".kandinsky/config.toml"), Some(true)), "{editor}");
    assert!(text(8).contains("notifications"), "the sections are named: {}", text(8));
    let all = ok(9);
    assert!(all["settings"]["log_dir"].is_string() && all["settings"]["notifications"].is_object(), "merged with the defaults: {all}");
    for i in [10, 11] {
        assert_eq!(replies[i]["result"]["isError"], true, "the notices are the running Kandinsky's: {}", replies[i]);
        assert!(text(i).contains("not running"), "{}", text(i));
    }
}

fn walk(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut out = vec![];
    for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        if e.path().is_dir() {
            out.extend(walk(&e.path()))
        } else {
            out.push(e.path())
        }
    }
    out
}
