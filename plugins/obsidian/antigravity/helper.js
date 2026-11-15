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
  { value: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)", family: "Other" },
  { value: "gemini-3.8-flash-medium", label: "Gemini 3.8 Flash (Medium)", family: "Other" },
  { value: "gemini-3.8-flash-low", label: "Gemini 3.8 Flash (Low)", family: "Other" },
  { value: "claude-opus-4-6-thinking", label: "Claude Opus 4.6 (Thinking)", family: "Other" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", family: "Other" },
  { value: "gpt-oss-120b-medium", label: "GPT-OSS 120B (Medium)", family: "Other" },
];

let cachedModels = null;
let cachedModelsAt = 0;

function inferFamily(slug, label) {
  const s = `${slug} ${label}`.toLowerCase();
  if (s.includes("orchestrator")) return "Orchestrator";
  if (s.includes("carbon")) return "Carbon";
  if (s.includes("argon")) return "Argon";
  if (s.includes("hydrogen")) return "Hydrogen";
  return "Other";
}

async function listModels(params = {}) {
  const now = Date.now();
  if (!params.refresh && cachedModels && now - cachedModelsAt < 300000) {
    return cachedModels;
  }
  try {
    const mRes = await atlas.exec("agy", ["models"], { timeout: 10 });
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
    const mcpRes = await atlas.exec("agy", ["mcp", "list"], { timeout: 10 });
    installed = mcpRes.status === 0 || Boolean(mcpRes.stdout || mcpRes.stderr);
    mcpText = String(mcpRes.stdout || "").trim();
    kandinskyMcpConnected = /\b(kandinsky|atlas)\b/i.test(mcpText);
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
    const r = await atlas.exec("node", ["-e", nodeScript], { timeout: 8 });
    if (r.status === 0 && r.stdout) {
      return JSON.parse(r.stdout.trim());
    }
    return { ok: false, error: String(r.stderr || "Could not read Antigravity session database.").trim(), roots: [], subagents: [], liveRootCount: 0, liveSubagentCount: 0 };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), roots: [], subagents: [], liveRootCount: 0, liveSubagentCount: 0 };
  }
}

async function connectKandinskyMcp(params = {}) {
  const cliPath = String(
    params.kandinskyExe || "C:/Users/antimajorana/AppData/Local/Atlas/kandinsky.exe",
  ).trim();

  try {
    await atlas.exec("agy", ["mcp", "remove", "kandinsky"], { timeout: 8 });
  } catch {}

  const addRes = await atlas.exec("agy", ["mcp", "add", "kandinsky", cliPath, "mcp"], {
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

atlas.methods({
  status: inspectAgy,
  liveStatus,
  models: listModels,
  connectMcp: connectKandinskyMcp,
  commands: async () => [
    { value: "agy", label: "agy (default model & interactive mode)" },
    { value: "agy --model gemini-4-carbon-high", label: "agy --model gemini-4-carbon-high" },
    { value: "agy --model gemini-4-argon-high", label: "agy --model gemini-4-argon-high" },
    { value: "agy --model gemini-4-hydrogen-high", label: "agy --model gemini-4-hydrogen-high" },
    { value: "agy --mode auto", label: "agy --mode auto" },
    { value: "agy --mode plan", label: "agy --mode plan" },
  ],
});
