// Antigravity helper (QuickJS): CLI & MCP bridge, cached `agy models` catalog, and read-only SQLite/transcript live subagent monitor.

const DEFAULT_MODELS = [
  { value: "default", label: "CLI Default (Inherit)", family: "Default" },
  { value: "gemini-4-carbon-high", label: "Gemini 4 Carbon (High)", family: "Carbon" },
  { value: "gemini-4-carbon-medium", label: "Gemini 4 Carbon (Medium)", family: "Carbon" },
  { value: "gemini-4-carbon-low", label: "Gemini 4 Carbon (Low)", family: "Carbon" },
  { value: "gemini-4-argon-high", label: "Gemini 4 Argon (High)", family: "Argon" },
  { value: "gemini-4-argon-medium", label: "Gemini 4 Argon (Medium)", family: "Argon" },
  { value: "gemini-4-argon-low", label: "Gemini 4 Argon (Low)", family: "Argon" },
  { value: "gemini-4-hydrogen-xhigh", label: "Gemini 4 Hydrogen (XHigh)", family: "Hydrogen" },
  { value: "gemini-4-hydrogen-high", label: "Gemini 4 Hydrogen (High)", family: "Hydrogen" },
  { value: "gemini-4-hydrogen-medium", label: "Gemini 4 Hydrogen (Medium)", family: "Hydrogen" },
  { value: "gemini-4-hydrogen-low", label: "Gemini 4 Hydrogen (Low)", family: "Hydrogen" },
  { value: "gemini-pro-orchestrator", label: "Orchestrator (Carbon)", family: "Orchestrator" },
  { value: "gemini-pro-orchestrator-argon", label: "Orchestrator (Argon)", family: "Orchestrator" },
  { value: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)", family: "Flash" },
  { value: "gemini-3.8-flash-medium", label: "Gemini 3.8 Flash (Medium)", family: "Flash" },
  { value: "gemini-3.8-flash-low", label: "Gemini 3.8 Flash (Low)", family: "Flash" },
  { value: "claude-opus-4-6-thinking", label: "Claude Opus 4.6 (Thinking)", family: "Other" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", family: "Other" },
  { value: "gpt-oss-120b-medium", label: "GPT-OSS 120B (Medium)", family: "Other" },
];

let cachedModels = null;
let cachedModelsAt = 0;
let cachedSpecialists = null;
let cachedSpecialistsAt = 0;

function inferFamily(slug, label) {
  const s = `${slug} ${label}`.toLowerCase();
  if (s.includes("orchestrator")) return "Orchestrator";
  if (s.includes("carbon")) return "Carbon";
  if (s.includes("argon")) return "Argon";
  if (s.includes("hydrogen")) return "Hydrogen";
  if (s.includes("flash")) return "Flash";
  return "Other";
}

function humanizeSpecialistTitle(id) {
  return String(id || "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function unquoteYaml(val) {
  let s = String(val || "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
    s = s.replace(/\\"/g, '"').replace(/\\n/g, " ");
  }
  return s.replace(/\s+/g, " ").trim();
}

function parseSpecialistMarkdown(raw, fileStem) {
  const text = String(raw || "");
  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fields = {};
  if (fmMatch) {
    const lines = fmMatch[1].split(/\r?\n/);
    let currentKey = "";
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const kv = ln.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
      if (kv) {
        currentKey = kv[1];
        const rest = kv[2].trim();
        if (rest === ">" || rest === "|") {
          fields[currentKey] = "";
        } else {
          fields[currentKey] = rest;
        }
      } else if (currentKey && /^\s+/.test(ln)) {
        fields[currentKey] = `${fields[currentKey] || ""} ${ln.trim()}`.trim();
      } else {
        currentKey = "";
      }
    }
  }
  const rawName = unquoteYaml(fields.name || fileStem).replace(/^@+/, "");
  const id = rawName || String(fileStem || "").trim();
  if (!id) return null;
  const title = unquoteYaml(fields.title || "") || humanizeSpecialistTitle(id);
  const description = unquoteYaml(fields.description || "");
  const model = unquoteYaml(fields.model || "");
  return {
    id,
    handle: `@${id}`,
    title,
    description,
    ...(model ? { model } : {}),
  };
}

async function listVaultSpecialists(params = {}) {
  const now = Date.now();
  if (!params.refresh && cachedSpecialists && now - cachedSpecialistsAt < 10000) {
    return cachedSpecialists;
  }

  const nodeScript = `
    const fs = require("node:fs");
    const path = require("node:path");

    function unquote(val) {
      let s = String(val || "").trim();
      if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        s = s.slice(1, -1).replace(/\\\\"/g, '"').replace(/\\\\n/g, " ");
      }
      return s.replace(/\\s+/g, " ").trim();
    }

    function titleOf(id) {
      return String(id || "")
        .split(/[-_]+/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    }

    const dir = path.join(process.cwd(), ".agents", "agents");
    if (!fs.existsSync(dir)) {
      process.stdout.write("[]");
      process.exit(0);
    }

    const out = [];
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isFile() || !/\\.md$/i.test(ent.name)) continue;
      const stem = ent.name.replace(/\\.md$/i, "");
      let raw = "";
      try { raw = fs.readFileSync(path.join(dir, ent.name), "utf8"); } catch { continue; }
      const fm = raw.match(/^---\\r?\\n([\\s\\S]*?)\\r?\\n---/);
      const fields = {};
      if (fm) {
        let curKey = "";
        for (const ln of fm[1].split(/\\r?\\n/)) {
          const kv = ln.match(/^([A-Za-z0-9_-]+)\\s*:\\s*(.*)$/);
          if (kv) {
            curKey = kv[1];
            const rest = kv[2].trim();
            fields[curKey] = (rest === ">" || rest === "|") ? "" : rest;
          } else if (curKey && /^\\s+/.test(ln)) {
            fields[curKey] = ((fields[curKey] || "") + " " + ln.trim()).trim();
          } else {
            curKey = "";
          }
        }
      }
      const id = unquote(fields.name || stem).replace(/^@+/, "") || stem;
      if (!id) continue;
      const title = unquote(fields.title || "") || titleOf(id);
      const description = unquote(fields.description || "");
      const model = unquote(fields.model || "");
      const item = { id, handle: "@" + id, title, description };
      if (model) item.model = model;
      out.push(item);
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    process.stdout.write(JSON.stringify(out));
  `;

  try {
    const r = await kandinsky.exec("node", ["-e", nodeScript], { timeout: 6 });
    if (r.status === 0 && r.stdout) {
      const parsed = JSON.parse(String(r.stdout).trim() || "[]");
      if (Array.isArray(parsed)) {
        cachedSpecialists = parsed;
        cachedSpecialistsAt = now;
        return parsed;
      }
    }
  } catch {}

  // Fallback via Kandinsky vault API if node exec was unavailable
  try {
    const exists = await kandinsky.get("/api/exists", { path: ".agents/agents" });
    if (!exists) {
      cachedSpecialists = [];
      cachedSpecialistsAt = now;
      return [];
    }
    const entries = await kandinsky.get("/api/tree", { path: ".agents/agents", hidden: "true" });
    const mdFiles = (Array.isArray(entries) ? entries : []).filter(
      (e) => e && e.kind === "file" && /\.md$/i.test(String(e.name || "")),
    );
    const items = await Promise.all(
      mdFiles.map(async (e) => {
        try {
          const text = await kandinsky.read(e.path);
          const stem = String(e.name || "").replace(/\.md$/i, "");
          return parseSpecialistMarkdown(text, stem);
        } catch {
          return null;
        }
      }),
    );
    const sorted = items.filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
    cachedSpecialists = sorted;
    cachedSpecialistsAt = now;
    return sorted;
  } catch {
    return [];
  }
}

async function listModels(params = {}) {
  const now = Date.now();
  if (!params.refresh && cachedModels && now - cachedModelsAt < 300000) {
    return cachedModels;
  }
  try {
    const mRes = await kandinsky.exec("agy", ["models"], { timeout: 10 });
    const raw = String(mRes.stdout || "").trim();
    const parsed = [{ value: "default", label: "CLI Default (Inherit)", family: "Default" }];
    const seen = new Set(["default"]);
    for (const ln of raw.split(/\r?\n/)) {
      const line = ln.trim();
      if (!line || /^fetching/i.test(line) || /^available/i.test(line) || /^[-=]+$/.test(line)) continue;
      const parts = line.split(/\t+|\s{2,}/);
      const slug = (parts[0] || "").trim();
      if (!slug || slug.includes(" ") || seen.has(slug)) continue;
      const label = (parts[1] || slug).trim();
      seen.add(slug);
      parsed.push({ value: slug, label, family: inferFamily(slug, label) });
    }
    if (parsed.length > 3) {
      cachedModels = parsed;
      cachedModelsAt = now;
      return parsed;
    }
  } catch {}
  return DEFAULT_MODELS;
}

async function inspectAgy(params = {}) {
  let installed = false;
  let mcpText = "";
  let kandinskyMcpConnected = false;

  try {
    const mcpRes = await kandinsky.exec("agy", ["mcp", "list"], { timeout: 10 });
    installed = mcpRes.status === 0 || Boolean(mcpRes.stdout || mcpRes.stderr);
    mcpText = String(mcpRes.stdout || "").trim();
    kandinskyMcpConnected = /\b(kandinsky|kandinsky)\b/i.test(mcpText);
  } catch (e) {
    return {
      installed: false,
      kandinskyMcpConnected: false,
      mcpText: "",
      models: DEFAULT_MODELS,
      error: String((e && e.message) || e),
    };
  }

  const models = params.includeModels ? await listModels({ refresh: false }) : DEFAULT_MODELS;
  return { installed, kandinskyMcpConnected, mcpText, models };
}

async function liveStatus() {
  const nodeScript = `
    const fs = require("node:fs");
    const path = require("node:path");
    const os = require("node:os");
    const { DatabaseSync } = require("node:sqlite");

    const base = path.join(os.homedir(), ".gemini", "antigravity-cli");
    const dbPath = path.join(base, "conversation_summaries.db");
    const brainDir = path.join(base, "brain");

    function cleanSummary(raw) {
      if (!raw) return "";
      let s = String(raw);
      const ur = s.match(/<USER_REQUEST>([\\s\\S]*?)<\\/USER_REQUEST>/i);
      if (ur) s = ur[1];
      else {
        const cm = s.match(/content=([\\s\\S]*)/);
        if (cm) s = cm[1];
      }
      s = s.replace(/<[^>]+>/g, " ").replace(/\\s+/g, " ").trim();
      return s.slice(0, 110);
    }

    function inspectTranscript(id, needHead) {
      const tp = path.join(brainDir, id, ".system_generated", "logs", "transcript.jsonl");
      if (!fs.existsSync(tp)) return { model: "", headTitle: "", mtimeMs: 0 };
      try {
        const st = fs.statSync(tp);
        const fd = fs.openSync(tp, "r");
        let headTitle = "";
        if (needHead && st.size > 0) {
          const hLen = Math.min(st.size, 3072);
          const hBuf = Buffer.alloc(hLen);
          fs.readSync(fd, hBuf, 0, hLen, 0);
          const hLines = hBuf.toString("utf8").split(/\\r?\\n/).filter(Boolean);
          for (let i = 0; i < Math.min(hLines.length, 4); i++) {
            try {
              const o = JSON.parse(hLines[i]);
              if (o.content && (o.type === "USER_INPUT" || o.type === "SYSTEM_MESSAGE")) {
                const c = cleanSummary(o.content);
                if (c && !c.startsWith("The following is a")) { headTitle = c; break; }
              }
            } catch {}
          }
        }
        let model = "";
        if (st.size > 0) {
          const tLen = Math.min(st.size, 24576);
          const tBuf = Buffer.alloc(tLen);
          fs.readSync(fd, tBuf, 0, tLen, st.size - tLen);
          const tLines = tBuf.toString("utf8").split(/\\r?\\n/).filter(Boolean);
          for (let i = tLines.length - 1; i >= 0; i--) {
            const ln = tLines[i];
            if (!ln.startsWith("{")) continue;
            try {
              const o = JSON.parse(ln);
              if (o.model) { model = String(o.model); break; }
            } catch {}
          }
        }
        fs.closeSync(fd);
        return { model, headTitle, mtimeMs: st.mtimeMs || 0 };
      } catch {
        return { model: "", headTitle: "", mtimeMs: 0 };
      }
    }

    let rows = [];
    if (fs.existsSync(dbPath)) {
      const db = new DatabaseSync(dbPath, { open: true, readOnly: true });
      rows = db.prepare(\`
        SELECT conversation_id, title, step_count, last_modified_time, status,
               agent_name, parent_conversation_id, nesting_depth, not_fully_idle, killed
        FROM conversation_summaries
        ORDER BY last_modified_time DESC
        LIMIT 50
      \`).all();
      db.close();
    }

    const childCounts = {};
    for (const r of rows) {
      const p = r.parent_conversation_id || "";
      if (p) childCounts[p] = (childCounts[p] || 0) + 1;
    }

    const nowMs = Date.now();
    const enriched = rows.map((r, idx) => {
      const rawTitle = String(r.title || "").trim();
      const genericTitle = !rawTitle || rawTitle === "self" || rawTitle === "research";
      const inspect = idx < 18 || Boolean(r.not_fully_idle);
      const tr = inspect ? inspectTranscript(r.conversation_id, genericTitle) : { model: "", headTitle: "", mtimeMs: 0 };
      const recentTouch = tr.mtimeMs > 0 && (nowMs - tr.mtimeMs) < 25000;
      const isLive = !r.killed && (Boolean(r.not_fully_idle) || recentTouch);
      return {
        id: r.conversation_id,
        title: (!genericTitle ? rawTitle : tr.headTitle) || (r.parent_conversation_id ? (r.agent_name || "Subagent") : "Antigravity session"),
        steps: r.step_count || 0,
        updatedAt: r.last_modified_time || "",
        agentName: r.agent_name || "",
        parentId: r.parent_conversation_id || "",
        depth: r.nesting_depth || 0,
        isLive,
        model: tr.model || "",
        childCount: childCounts[r.conversation_id] || 0,
      };
    });

    const roots = enriched.filter((r) => !r.parentId && r.depth === 0);
    const subagents = enriched.filter((r) => Boolean(r.parentId) || r.depth > 0);
    process.stdout.write(JSON.stringify({
      ok: true,
      liveRootCount: roots.filter((r) => r.isLive).length,
      liveSubagentCount: subagents.filter((r) => r.isLive).length,
      totalSubagentCount: subagents.length,
      roots: roots.slice(0, 8),
      subagents: subagents.slice(0, 14),
    }));
  `;

  try {
    const r = await kandinsky.exec("node", ["-e", nodeScript], { timeout: 8 });
    if (r.status === 0 && r.stdout) {
      return JSON.parse(r.stdout.trim());
    }
    return { ok: false, error: String(r.stderr || "Could not read Antigravity session database.").trim(), roots: [], subagents: [], liveRootCount: 0, liveSubagentCount: 0 };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), roots: [], subagents: [], liveRootCount: 0, liveSubagentCount: 0 };
  }
}

async function connectKandinskyMcp(params = {}) {
  let cliPath = String(params.kandinskyExe || "").trim();
  if (!cliPath) {
    const r = await kandinsky.exec(
      "node",
      [
        "-e",
        [
          "const fs = require('node:fs'), os = require('node:os'), path = require('node:path');",
          "const home = os.homedir();",
          "const cands = [",
          "  process.env.KANDINSKY_EXE,",
          "  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Kandinsky', 'kandinsky.exe'),",
          "  path.join(home, 'AppData', 'Local', 'Kandinsky', 'kandinsky.exe'),",
          "  path.join(home, '.local', 'bin', 'kandinsky'),",
          "  '/usr/local/bin/kandinsky',",
          "].filter(Boolean);",
          "process.stdout.write(cands.find((p) => fs.existsSync(p)) || 'kandinsky');",
        ].join(" "),
      ],
      { timeout: 6 },
    );
    cliPath = String(r.stdout || "").trim() || "kandinsky";
  }

  try {
    await kandinsky.exec("agy", ["mcp", "remove", "kandinsky"], { timeout: 8 });
  } catch {}

  const addRes = await kandinsky.exec("agy", ["mcp", "add", "kandinsky", cliPath, "mcp"], {
    timeout: 15,
  });
  const after = await inspectAgy({ includeModels: false });
  return {
    ok: addRes.status === 0 || after.kandinskyMcpConnected,
    stdout: String(addRes.stdout || "").trim(),
    stderr: String(addRes.stderr || "").trim(),
    status: after,
  };
}

kandinsky.methods({
  status: inspectAgy,
  liveStatus,
  models: listModels,
  listVaultSpecialists,
  specialists: async () => {
    const specs = await listVaultSpecialists({ refresh: false });
    return [
      { value: "", label: "Coordinator (no @specialist)" },
      ...specs.map((s) => ({
        value: s.handle,
        label: s.description ? `${s.handle} — ${s.description.slice(0, 72)}` : s.handle,
      })),
    ];
  },
  connectMcp: connectKandinskyMcp,
  commands: async () => [
    { value: "agy", label: "agy (default model & interactive mode)" },
    { value: "agy --model gemini-4-carbon-high", label: "agy --model gemini-4-carbon-high" },
    { value: "agy --model gemini-4-argon-high", label: "agy --model gemini-4-argon-high" },
    { value: "agy --model gemini-4-hydrogen-high", label: "agy --model gemini-4-hydrogen-high" },
    { value: "agy --model gemini-3.8-flash-high", label: "agy --model gemini-3.8-flash-high" },
    { value: "agy --mode auto", label: "agy --mode auto" },
    { value: "agy --mode plan", label: "agy --mode plan" },
  ],
});
