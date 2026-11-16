// Solver Agent helper (QuickJS): service health, silent background startup, conversation discovery, and Solver-to-Markdown note formatter.

const DEFAULT_UI = "http://localhost:4200";
const DEFAULT_API = "http://127.0.0.1:3000";
const DEFAULT_DIR = "~/Documents/GitHub/re-Solve";

async function resolveLauncherPaths(dirPath) {
  const raw = String(dirPath || DEFAULT_DIR).trim().replace(/\\/g, "/").replace(/\/+$/, "");
  const nodeCode = [
    "const fs = require('node:fs'), os = require('node:os'), path = require('node:path');",
    "let d = process.argv[1] || '';",
    "const home = os.homedir().replace(/\\\\/g, '/').replace(/\\/+$/, '');",
    "if (d === '~') d = home;",
    "else if (d.startsWith('~/')) d = home + '/' + d.slice(2);",
    "if (!fs.existsSync(d) && /\\/re-Solver-Agent$/i.test(d)) {",
    "  const alt = d.replace(/\\/re-Solver-Agent$/i, '/re-Solve');",
    "  if (fs.existsSync(alt)) d = alt;",
    "}",
    "const s1 = d + '/local-launcher/Start-re-Solve.ps1';",
    "const s2 = d + '/local-launcher/Start-SolverAgent.ps1';",
    "const scriptPath = fs.existsSync(s1) ? s1 : (fs.existsSync(s2) ? s2 : s1);",
    "process.stdout.write(JSON.stringify({ baseDir: d, scriptPath }));",
  ].join(" ");
  try {
    const r = await kandinsky.exec("node", ["-e", nodeCode, raw], { timeout: 5 });
    if (r.status === 0 && r.stdout) return JSON.parse(String(r.stdout).trim());
  } catch {}
  return { baseDir: raw, scriptPath: `${raw}/local-launcher/Start-re-Solve.ps1` };
}

// Solver's MongoDB runs natively in WSL Ubuntu as the systemd service mongod (no Docker).
// serverSelectionTimeoutMS makes a stopped mongod fail in about 3 s instead of hanging.
const MONGO_URI = "mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=3000";

function cleanUrl(u, fallback) {
  const s = String(u || fallback).trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(s) ? s : fallback;
}

function toLoopbackProbeUrl(u) {
  return String(u || "").replace(/^http:\/\/localhost(?=:|\/|$)/i, "http://127.0.0.1");
}

async function probeWithNode(uiUrl, apiUrl) {
  const script = `
    const ui = process.argv[1], api = process.argv[2];
    const get = async (u) => {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 1800);
      try {
        const r = await fetch(u, { signal: c.signal, headers: { Accept: "application/json" } });
        const txt = await r.text();
        let json = null;
        try { json = JSON.parse(txt); } catch {}
        return { ok: r.ok, status: r.status, json };
      } catch (e) {
        return { ok: false, status: 0, error: String(e && e.message || e) };
      } finally { clearTimeout(t); }
    };
    (async () => {
      const [fe, be] = await Promise.all([
        get(ui + "/.solver-launcher/identity"),
        get(api + "/api/health"),
      ]);
      const feFallback = fe.ok ? fe : await get(ui + "/");
      const frontend = Boolean(feFallback.ok);
      const backend = Boolean(be.ok && (!be.json || be.json.status === "ok" || be.json.application));
      process.stdout.write(JSON.stringify({
        running: frontend && backend,
        frontend,
        backend,
        buildId: (fe.json && fe.json.buildId) || (be.json && be.json.buildId) || null,
      }));
    })();
  `;
  const r = await kandinsky.exec("node", ["-e", script, toLoopbackProbeUrl(uiUrl), toLoopbackProbeUrl(apiUrl)], { timeout: 6 });
  if (r.status === 0 && r.stdout) return JSON.parse(r.stdout.trim());
  throw new Error(r.stderr || "node probe failed");
}

async function probeWithPowerShell(uiUrl, apiUrl) {
  const probeUi = toLoopbackProbeUrl(uiUrl);
  const probeApi = toLoopbackProbeUrl(apiUrl);
  const ps = `
    $ErrorActionPreference = 'SilentlyContinue'
    $fe = $false; $be = $false; $bid = $null
    try {
      $r1 = Invoke-WebRequest -Uri '${probeUi.replace(/'/g, "''")}/.solver-launcher/identity' -UseBasicParsing -TimeoutSec 2
      if ($r1.StatusCode -ge 200 -and $r1.StatusCode -lt 400) {
        $fe = $true
        $j1 = $r1.Content | ConvertFrom-Json
        if ($j1.buildId) { $bid = $j1.buildId }
      }
    } catch {}
    if (-not $fe) {
      try {
        $r1b = Invoke-WebRequest -Uri '${probeUi.replace(/'/g, "''")}/' -UseBasicParsing -TimeoutSec 2
        if ($r1b.StatusCode -ge 200 -and $r1b.StatusCode -lt 400) { $fe = $true }
      } catch {}
    }
    try {
      $r2 = Invoke-WebRequest -Uri '${probeApi.replace(/'/g, "''")}/api/health' -UseBasicParsing -TimeoutSec 2
      if ($r2.StatusCode -ge 200 -and $r2.StatusCode -lt 400) { $be = $true }
    } catch {}
    @{ running = ($fe -and $be); frontend = $fe; backend = $be; buildId = $bid } | ConvertTo-Json -Compress
  `;
  const r = await kandinsky.exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { timeout: 10 });
  if (r.status === 0 && r.stdout) return JSON.parse(r.stdout.trim());
  return { running: false, frontend: false, backend: false, buildId: null };
}

async function checkStatus(params = {}) {
  const uiUrl = cleanUrl(params.url, DEFAULT_UI);
  const apiUrl = cleanUrl(params.apiUrl, DEFAULT_API);
  try {
    const res = await probeWithNode(uiUrl, apiUrl);
    return { ...res, url: uiUrl, apiUrl };
  } catch {
    const res = await probeWithPowerShell(uiUrl, apiUrl);
    return { ...res, url: uiUrl, apiUrl };
  }
}

async function startServices(params = {}) {
  const uiUrl = cleanUrl(params.url, DEFAULT_UI);
  const apiUrl = cleanUrl(params.apiUrl, DEFAULT_API);
  const current = await checkStatus({ url: uiUrl, apiUrl });
  if (current.running) {
    return { ok: true, alreadyRunning: true, url: uiUrl, status: current };
  }

  const { scriptPath } = await resolveLauncherPaths(params.launcherDir || DEFAULT_DIR);

  const run = await kandinsky.exec(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-NoBrowser", "-JsonProgress"],
    { timeout: 300 },
  );

  const events = [];
  for (const raw of String(run.stdout || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    try { events.push(JSON.parse(line)); } catch { events.push({ phase: "log", message: line }); }
  }

  const lastError = [...events].reverse().find((e) => e.phase === "error");
  const readyEvent = [...events].reverse().find((e) => e.phase === "ready");
  const after = await checkStatus({ url: uiUrl, apiUrl });

  if (after.running || (run.status === 0 && readyEvent)) {
    return { ok: true, url: (readyEvent && readyEvent.url) || uiUrl, events, status: after };
  }

  const why =
    (lastError && lastError.message) ||
    (run.timedOut ? "Solver startup timed out after 5 minutes." : "") ||
    String(run.stderr || "").trim() ||
    `Launcher exited with status ${run.status ?? "unknown"}.`;

  return { ok: false, url: uiUrl, error: why, events, status: after };
}

function safeFileStem(title) {
  const cleaned = String(title || "Solver Derivation")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "Solver Derivation";
}

function formatEntryMarkdown(entry, idx, opts = {}) {
  const type = String(entry.type || "step");
  const tool = String(entry.tool || "solver");
  const status = String(entry.status || "pending");
  const content = entry.content || {};
  const details = content.details || (entry.extraDetails || {});
  const summary = String(content.summary || entry.summary || type).trim();
  const body = String(details.body || entry.body || "").trim();
  const comp = entry.computation || {};
  const artifacts = entry.artifacts || {};
  const ver = entry.verification || {};

  const lines = [];
  const badge = status === "accepted" || status === "verified" ? "✓" : status === "rejected" ? "✗" : "•";
  lines.push(`### ${idx}. ${badge} ${summary}`);
  lines.push(`*Type:* \`${type}\` · *Agent:* \`${tool}\` · *Status:* \`${status}\``);
  lines.push("");

  if (body) {
    lines.push(body);
    lines.push("");
  }

  const task = details.task || comp.task || (entry.advisory && entry.advisory.task);
  if (task && String(task).trim() && String(task).trim() !== summary) {
    lines.push(`**Task:** ${String(task).trim()}`);
    lines.push("");
  }

  const resText = details.result || comp.result || (entry.advisory && entry.advisory.result);
  if (resText && String(resText).trim() && String(resText).trim() !== body) {
    lines.push(`**Result:**\n${String(resText).trim()}`);
    lines.push("");
  }

  const verdict = content.verdict || ver.verdict;
  const justification = content.justification || ver.justification;
  if (verdict || justification) {
    if (verdict) lines.push(`**Verification verdict:** \`${verdict}\``);
    if (justification) lines.push("", String(justification).trim());
    lines.push("");
  }

  const cand = details.candidateAnswer || ver.candidateAnswer;
  if (cand) {
    lines.push(`**Candidate answer:** ${String(cand).trim()}`);
    lines.push("");
  }

  if (opts.includeCode !== false) {
    const code = artifacts.code || comp.code;
    const stdout = artifacts.stdout || comp.stdout;
    if (code && String(code).trim()) {
      const lang = tool === "lean_prover" || tool === "lean_formalizer" ? "lean" : "python";
      lines.push(`<details><summary>Verification script (${lang})</summary>`, "");
      lines.push("```" + lang, String(code).trim(), "```");
      if (stdout && String(stdout).trim()) {
        lines.push("", "**Output:**", "```text", String(stdout).trim().slice(0, 4000), "```");
      }
      lines.push("", "</details>", "");
    }
  }

  return lines.join("\n").trim();
}

function buildSolverMarkdown(payload, opts = {}) {
  const conv = payload.conversation || payload.header || {};
  const ledger = payload.ledger || {};
  const rawEntries = Array.isArray(payload.entries) ? payload.entries : [];
  const messages = Array.isArray(payload.messages) ? payload.messages : [];

  const title = String(conv.title || "Solver Derivation").trim();
  const id = String(conv._id || conv.conversationId || "").trim();
  const status = String(ledger.status || conv.status || conv.ledgerStatus || "active").trim();
  const created = String(conv.createdAt || ledger.createdAt || new Date().toISOString());
  const problem = String(
    ledger.problemStatement ||
      (payload.prompts && payload.prompts[0] && payload.prompts[0].content) ||
      (messages.find((m) => m.role === "user") || {}).content ||
      "",
  ).trim();

  const onlyVerified = opts.onlyVerified !== false;
  const entries = rawEntries.filter((e) => {
    if (!onlyVerified) return true;
    const st = String(e.status || "");
    return st !== "rejected" && st !== "superseded";
  });

  const finalEntry = [...entries].reverse().find((e) => e.type === "final_answer");
  const finalAnswer = String(
    ledger.finalAnswer ||
      (finalEntry && ((finalEntry.content && finalEntry.content.finalAnswer) || finalEntry.finalAnswer || (finalEntry.content && finalEntry.content.details && finalEntry.content.details.body) || finalEntry.body || (finalEntry.content && finalEntry.content.summary) || finalEntry.summary)) ||
      "",
  ).trim();
  const narrative = String(ledger.narrative || payload.narrative || "").trim();

  const fmTitle = title.replace(/"/g, '\\"');
  const fm = [
    "---",
    `title: "${fmTitle}"`,
    "source: solver-agent",
    ...(id ? [`solver_id: "${id}"`] : []),
    `status: "${status}"`,
    `created: "${created.slice(0, 10)}"`,
    "tags:",
    "  - solver",
    "---",
    "",
  ].join("\n");

  const bodyParts = [`# ${title}`, ""];

  if (problem) {
    bodyParts.push("## Problem Statement", "", problem, "");
  }

  if (finalAnswer) {
    const quoted = finalAnswer
      .split(/\r?\n/)
      .map((l) => `> ${l}`)
      .join("\n");
    bodyParts.push("> [!IMPORTANT] Final Answer", quoted, "");
  }

  if (narrative) {
    bodyParts.push("## Proof Walkthrough", "", narrative, "");
  }

  if (entries.length > 0) {
    bodyParts.push("## Verified Derivation Ledger", "");
    entries.forEach((e, i) => {
      bodyParts.push(formatEntryMarkdown(e, i + 1, opts), "");
    });
  } else if (messages.length > 0) {
    const assistantMsgs = messages.filter((m) => m.role === "assistant" && String(m.content || "").trim());
    if (assistantMsgs.length > 0) {
      bodyParts.push("## Solver Output", "");
      for (const m of assistantMsgs) {
        bodyParts.push(String(m.content).trim(), "");
      }
    }
  }

  const bodyOnly = bodyParts.join("\n").trim() + "\n";
  return {
    ok: true,
    title,
    suggestedFileName: `${safeFileStem(title)}.md`,
    solverId: id,
    status,
    stepCount: entries.length,
    totalSteps: rawEntries.length,
    markdown: fm + bodyOnly,
    bodyOnly,
  };
}

async function listConversations(params = {}) {
  const uiUrl = cleanUrl(params.url, DEFAULT_UI);
  const apiUrl = cleanUrl(params.apiUrl, DEFAULT_API);
  const st = await checkStatus({ url: uiUrl, apiUrl });
  const conversations = [];
  const seen = new Set();

  // When the Solver backend is running, WSL and the native mongod service are awake: list conversations across ALL browser profiles.
  if (st.backend || params.forceMongo) {
    const mongoEval = `
      const dbs = db.adminCommand({listDatabases:1}).databases.map(d=>d.name).filter(n=>!['admin','config','local'].includes(n));
      const out = [];
      for (const n of dbs) {
        const d = db.getSiblingDB(n);
        const cs = d.conversations.find({}, {_id:1, title:1, status:1, createdAt:1, updatedAt:1, ledgerId:1}).sort({updatedAt:-1}).limit(50).toArray();
        for (const c of cs) {
          const steps = c.ledgerId ? d.ledgerEntries.countDocuments({ledgerId: c.ledgerId}) : 0;
          out.push({ id: String(c._id), title: c.title || "Untitled problem", status: c.status || "active", createdAt: c.createdAt, updatedAt: c.updatedAt, stepCount: steps });
        }
      }
      print(JSON.stringify(out));
    `.replace(/\s+/g, " ").trim();
    try {
      const mr = await kandinsky.exec(
        "wsl",
        ["-d", "Ubuntu", "--exec", "mongosh", "--quiet", "--norc", MONGO_URI, "--eval", mongoEval],
        // mongosh itself takes about 5 s to start inside WSL, so 6 s was too tight.
        { timeout: 20 },
      );
      if (mr.status === 0 && mr.stdout) {
        const lines = String(mr.stdout).trim().split(/\r?\n/);
        const last = lines[lines.length - 1];
        const parsed = JSON.parse(last);
        if (Array.isArray(parsed)) {
          for (const c of parsed) {
            if (c && c.id && !seen.has(c.id)) {
              seen.add(c.id);
              conversations.push(c);
            }
          }
        }
      }
    } catch {}
  }

  let exports = [];
  if (params.scanDownloads) {
    const scanScript = `
      const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
      const dir = path.join(os.homedir(), "Downloads");
      const out = [];
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith(".zip"));
        for (const f of files) {
          const fp = path.join(dir, f);
          try {
            const st = fs.statSync(fp);
            if (st.size > 200 * 1024 * 1024) continue;
            const tailLen = Math.min(st.size, 65536);
            const fd = fs.openSync(fp, "r");
            const buf = Buffer.alloc(tailLen);
            fs.readSync(fd, buf, 0, tailLen, st.size - tailLen);
            fs.closeSync(fd);
            if (buf.includes(Buffer.from("ledger.json"))) {
              out.push({ path: fp, name: f, mtimeMs: st.mtimeMs, size: st.size });
            }
          } catch {}
        }
      }
      out.sort((a, b) => b.mtimeMs - a.mtimeMs);
      process.stdout.write(JSON.stringify(out.slice(0, 20)));
    `;
    try {
      const zr = await kandinsky.exec("node", ["-e", scanScript], { timeout: 6 });
      if (zr.status === 0 && zr.stdout) exports = JSON.parse(zr.stdout.trim());
    } catch {}
  }

  return {
    backendOnline: Boolean(st.backend),
    running: Boolean(st.running),
    conversations,
    exports,
  };
}

function extractConversationId(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0] : s;
}

async function exportMarkdown(params = {}) {
  const apiUrl = cleanUrl(params.apiUrl, DEFAULT_API);
  const opts = {
    includeCode: params.includeCode !== false,
    onlyVerified: params.onlyVerified !== false,
  };

  if (params.ledgerJson && typeof params.ledgerJson === "object") {
    return buildSolverMarkdown(params.ledgerJson, opts);
  }

  if (params.zipPath) {
    const zipScript = `
      const fs = require("node:fs"), zlib = require("node:zlib");
      const buf = fs.readFileSync(process.argv[1]);
      let eocd = -1;
      for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
      }
      if (eocd < 0) throw new Error("Invalid ZIP archive");
      const cdOffset = buf.readUInt32LE(eocd + 16);
      const cdCount = buf.readUInt16LE(eocd + 10);
      let ptr = cdOffset;
      for (let idx = 0; idx < cdCount; idx++) {
        if (buf.readUInt32LE(ptr) !== 0x02014b50) break;
        const method = buf.readUInt16LE(ptr + 10);
        const compSize = buf.readUInt32LE(ptr + 20);
        const nameLen = buf.readUInt16LE(ptr + 28);
        const extraLen = buf.readUInt16LE(ptr + 30);
        const commentLen = buf.readUInt16LE(ptr + 32);
        const lfhOffset = buf.readUInt32LE(ptr + 42);
        const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf8");
        if (name === "ledger.json" || name.endsWith("/ledger.json")) {
          const lNameLen = buf.readUInt16LE(lfhOffset + 26);
          const lExtraLen = buf.readUInt16LE(lfhOffset + 28);
          const dataStart = lfhOffset + 30 + lNameLen + lExtraLen;
          const slice = buf.subarray(dataStart, dataStart + compSize);
          const raw = method === 0 ? slice : zlib.inflateRawSync(slice);
          process.stdout.write(raw.toString("utf8"));
          process.exit(0);
        }
        ptr += 46 + nameLen + extraLen + commentLen;
      }
      throw new Error("No ledger.json found in ZIP bundle");
    `;
    const zr = await kandinsky.exec("node", ["-e", zipScript, String(params.zipPath)], { timeout: 15 });
    if (zr.status !== 0 || !zr.stdout) {
      return { ok: false, error: String(zr.stderr || "Could not read ledger.json from ZIP archive.").trim() };
    }
    return buildSolverMarkdown(JSON.parse(zr.stdout), opts);
  }

  const cid = extractConversationId(params.conversationId);
  if (!cid) {
    return { ok: false, error: "Choose a Solver conversation or enter a conversation ID." };
  }

  const fetchScript = `
    const api = process.argv[1], id = encodeURIComponent(process.argv[2]);
    const getJson = async (p) => {
      const r = await fetch(api + p, { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(p + " returned HTTP " + r.status);
      return await r.json();
    };
    (async () => {
      const [c, l, e, m] = await Promise.all([
        getJson("/api/conversations/" + id),
        getJson("/api/conversations/" + id + "/ledger").catch(() => ({ ledger: null })),
        getJson("/api/conversations/" + id + "/ledger/entries").catch(() => ({ entries: [] })),
        getJson("/api/conversations/" + id + "/messages").catch(() => ({ messages: [] })),
      ]);
      process.stdout.write(JSON.stringify({
        conversation: c.conversation || c,
        ledger: l.ledger || {},
        entries: e.entries || [],
        messages: m.messages || [],
      }));
    })();
  `;
  const fr = await kandinsky.exec("node", ["-e", fetchScript, apiUrl, cid], { timeout: 15 });
  if (fr.status !== 0 || !fr.stdout) {
    return { ok: false, error: String(fr.stderr || "Could not fetch conversation from Solver API. Make sure Solver is running.").trim() };
  }
  return buildSolverMarkdown(JSON.parse(fr.stdout), opts);
}

kandinsky.methods({
  status: checkStatus,
  start: startServices,
  listConversations,
  exportMarkdown,
});
