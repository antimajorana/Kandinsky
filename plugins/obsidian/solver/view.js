// Solver app pane (view.js): docks Solver Agent inside Kandinsky with two-way postMessage handoff, KaTeX callout insertion, and context attachment support.

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const PREFILL_ACK_TIMEOUT_MS = 400;
const MAX_PREFILL_LOAD_RETRIES = 3;
const ATTACHMENT_MIME_BY_EXT = {
  ".pdf": "application/pdf",
  ".tex": "application/x-tex",
  ".md": "text/markdown",
  ".bib": "text/x-bibtex",
};
const CALLOUT_KIND_MAP = {
  "final-answer": "important",
  result: "important",
  verified: "important",
  important: "important",
  proof: "proof",
  theorem: "theorem",
  lemma: "lemma",
  proposition: "proposition",
  corollary: "corollary",
  definition: "definition",
  remark: "remark",
  summary: "summary",
  tip: "tip",
  warning: "warning",
  example: "example",
  note: "note",
};

function parseArg(raw) {
  if (!raw || typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch { return { prompt: raw }; }
  return null;
}

export function getSolverSettings(kandinsky) {
  const s = (kandinsky.plugin && kandinsky.plugin.settings) || {};
  return {
    url: String(s.url || "http://localhost:4200").trim().replace(/\/+$/, ""),
    apiUrl: String(s.api_url || "http://127.0.0.1:3000").trim().replace(/\/+$/, ""),
    launcherDir: String(s.launcher_dir || "~/Documents/GitHub/re-Solve").trim(),
    autoStart: s.auto_start !== false,
  };
}

/** Validate strictly against loopback origins (localhost / 127.0.0.1 on port 4200 or the configured Solver port). */
export function isAllowedSolverOrigin(origin, configuredUrl = "http://localhost:4200") {
  if (typeof origin !== "string" || !origin || origin === "null") return false;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.origin !== origin) return false;
  const isLoopback = (h) => h === "localhost" || h === "127.0.0.1";
  if (!isLoopback(parsed.hostname)) return false;

  const allowed = new Set(["http://localhost:4200", "http://127.0.0.1:4200"]);
  try {
    const cfg = new URL(String(configuredUrl || "http://localhost:4200").trim());
    if ((cfg.protocol === "http:" || cfg.protocol === "https:") && isLoopback(cfg.hostname)) {
      const portPart = cfg.port ? `:${cfg.port}` : "";
      allowed.add(cfg.origin);
      allowed.add(`${cfg.protocol}//localhost${portPart}`);
      allowed.add(`${cfg.protocol}//127.0.0.1${portPart}`);
    }
  } catch {}
  return allowed.has(parsed.origin);
}

function getSolverTargetOrigin(configuredUrl = "http://localhost:4200") {
  try {
    const u = new URL(String(configuredUrl || "http://localhost:4200").trim());
    if ((u.protocol === "http:" || u.protocol === "https:") && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) {
      return u.origin;
    }
  } catch {}
  return "http://localhost:4200";
}

function isValidSolverUrl(rawUrl) {
  const s = String(rawUrl || "").trim();
  if (!/^https?:\/\//i.test(s)) return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

const pad2 = (n) => String(n).padStart(2, "0");
function nowStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Convert LaTeX \[...\], \(...\), and standalone equation/align environments into clean KaTeX Markdown while preserving code fences. */
export function normalizeKatexMath(raw) {
  const src = String(raw || "").replace(/\r\n/g, "\n");
  return src
    .split(/(```[\s\S]*?```)/g)
    .map((seg, idx) => {
      if (idx % 2 === 1) return seg;
      let out = idx === 0 ? seg.replace(/^---\n[\s\S]*?\n---\n+/, "") : seg;
      out = out.replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner) => `\n$$\n${String(inner).trim()}\n$$\n`);
      out = out.replace(/\\\(([\s\S]*?)\\\)/g, (_m, inner) => {
        const clean = String(inner).trim();
        return clean.includes("\n") ? `\n$$\n${clean}\n$$\n` : `$${clean}$`;
      });
      out = out
        .split(/(\$\$[\s\S]*?\$\$)/g)
        .map((mSeg, mIdx) =>
          mIdx % 2 === 1
            ? mSeg
            : mSeg.replace(
                /\\begin\{(equation\*?|align\*?|aligned|gather\*?|multline\*?)\}([\s\S]*?)\\end\{\1\}/g,
                (full) => `\n$$\n${full.trim()}\n$$\n`,
              ),
        )
        .join("");
      return out.replace(/\n{3,}/g, "\n\n");
    })
    .join("")
    .trim();
}

function wrapRawLatexIfNeeded(rawTex) {
  const tex = String(rawTex || "").trim();
  if (!tex) return "";
  if (/(\$\$?|\\\[|\\\(|\\begin\{)/.test(tex)) return normalizeKatexMath(tex);
  return `$$\n${tex}\n$$`;
}

/** Wrap normalized KaTeX derivation prose, LaTeX, or { markdown, latex, title, kind } payloads inside an Obsidian callout with c_lint metadata. */
export function formatDerivationCallout(rawOrPayload, opts = {}) {
  const isObj = rawOrPayload !== null && typeof rawOrPayload === "object";
  const payload = isObj ? rawOrPayload : {};
  const merged = isObj ? { ...opts, ...payload } : opts;

  let bodySrc = "";
  if (isObj) {
    const md = typeof payload.markdown === "string" ? payload.markdown.trim() : "";
    const tex = typeof payload.latex === "string" ? payload.latex.trim() : "";
    if (md && tex) {
      const normMd = normalizeKatexMath(md);
      const compactMd = normMd.replace(/\s+/g, "");
      const compactTex = tex.replace(/\s+/g, "");
      const hasMathBlock = /\$\$[\s\S]*?\$\$/.test(normMd);
      const looksFullTexDoc = /\\(documentclass|begin\{document\}|section|chapter)/.test(tex);
      bodySrc = !compactMd.includes(compactTex) && !hasMathBlock && !looksFullTexDoc
        ? `${normMd}\n\n${wrapRawLatexIfNeeded(tex)}`
        : normMd;
    } else if (md) {
      bodySrc = normalizeKatexMath(md);
    } else if (tex) {
      bodySrc = wrapRawLatexIfNeeded(tex);
    }
  } else {
    bodySrc = normalizeKatexMath(rawOrPayload);
  }

  if (!bodySrc) return "";
  const stamp = merged.timestamp || nowStamp();
  const stepTitle = String(merged.title || merged.stepTitle || "").trim();
  const rawKind = String(merged.kind || "").trim();
  const kindKey = rawKind.toLowerCase().replace(/[\s_]+/g, "-");
  const calloutTag = isObj ? (CALLOUT_KIND_MAP[kindKey] || "note") : (merged.calloutType || "NOTE");
  const lineCount = bodySrc.split("\n").length;
  const fold = merged.collapsed === true ? "-" : merged.collapsed === false ? "+" : isObj && (kindKey === "derivation" || kindKey === "proof" || lineCount > 10) ? "-" : "";

  const titlePrefix = stepTitle && /^solver\b/i.test(stepTitle) ? stepTitle : stepTitle ? `Solver Derivation · ${stepTitle}` : "Solver Derivation";
  const label = `${titlePrefix} · ${stamp}`;
  const solverId = merged.solverId || merged.conversationId || "";
  const meta = [
    "source: solver-agent",
    ...(solverId ? [`solver_id: ${solverId}`] : []),
    ...(rawKind ? [`kind: ${rawKind}`] : []),
    "verified-pending: run c_lint",
  ];
  const quoted = bodySrc.split("\n").map((l) => (l.trim() ? `> ${l}` : ">")).join("\n");
  return `> [!${calloutTag}]${fold} ${label}\n> <!-- ${meta.join(", ")} -->\n${quoted}\n`;
}

export function openImportFallback(kandinsky, targetPath = "") {
  const active = targetPath || (kandinsky.context()?.active?.path ?? "");
  void kandinsky.openDialog(JSON.stringify({ targetPath: active }), {
    title: "Import Solver Derivation to Note", width: 680, height: 540, view: "import-dialog.js",
  });
}

function fallbackCopyAndNotice(formattedBlock, kandinsky, reason, opts = {}) {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      void navigator.clipboard.writeText(formattedBlock).catch(() => {});
    }
  } catch {}
  const msg = reason || "No active Markdown note is open.";
  kandinsky.toast("Copied derivation to clipboard", `${msg} Paste with Ctrl+V into any note, or save as a new note.`, "info", {
    label: "Save as Note…",
    run: () => openImportFallback(kandinsky),
  });
  if (opts.openImportOnMissing) openImportFallback(kandinsky);
}

/** Dispatch "kandinsky:insert-at-cursor" to insert formatted Markdown/KaTeX at the open note's cursor, copying/notifying if no note is open. */
export function dispatchInsertToNote(formattedBlock, kandinsky, opts = {}) {
  if (!formattedBlock || !formattedBlock.trim()) {
    kandinsky.toast("Nothing to insert", "Select an equation or complete a Solver step first.", "info");
    return false;
  }
  let handled = false;
  let succeeded = false;
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("kandinsky:insert-at-cursor", {
        detail: {
          text: formattedBlock,
          focus: true,
          onResult: (res) => {
            handled = true;
            if (res && res.ok) {
              succeeded = true;
              const leaf = res.path ? res.path.split("/").pop() : "active note";
              kandinsky.toast("Inserted into Active Note", `Added KaTeX derivation block at cursor in ${leaf}`, "success");
            } else {
              fallbackCopyAndNotice(formattedBlock, kandinsky, res && res.reason, opts);
            }
          },
        },
      }),
    );
    if (!handled) {
      const directFn = window.__kandinskyInsertIntoActiveNote;
      if (typeof directFn === "function") {
        const res = directFn(formattedBlock, { focus: true });
        if (res && res.ok) {
          kandinsky.toast("Inserted into Active Note", `Added KaTeX derivation block at cursor in ${(res.path || "note").split("/").pop()}`, "success");
          return true;
        }
      }
      fallbackCopyAndNotice(formattedBlock, kandinsky, "Open a Markdown note tab first.", opts);
    }
  } else {
    fallbackCopyAndNotice(formattedBlock, kandinsky, "No active note editor available.", opts);
  }
  return succeeded;
}

function getAttachmentMime(path) {
  const clean = String(path || "").trim();
  const dot = clean.lastIndexOf(".");
  if (dot < 0) return "";
  return ATTACHMENT_MIME_BY_EXT[clean.slice(dot).toLowerCase()] || "";
}

function normalizeRelPath(raw) {
  const parts = [];
  for (const seg of String(raw || "").replace(/\\/g, "/").split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join("/");
}

function dirOfPath(path) {
  const norm = normalizeRelPath(path) || "";
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(0, idx) : "";
}

function extractContextLinkTargets(text) {
  const targets = [];
  const src = String(text || "");
  for (const m of src.matchAll(/!?\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g)) {
    targets.push(m[1].trim());
  }
  for (const m of src.matchAll(/\[[^\]]*\]\(([^)\n]+)\)/g)) {
    const raw = m[1].trim().replace(/^<|>$/g, "").split(/\s+"/)[0].split("#")[0].trim();
    if (raw && !/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(raw)) {
      try { targets.push(decodeURI(raw)); } catch { targets.push(raw); }
    }
  }
  for (const m of src.matchAll(/\\(?:bibliography|addbibresource)\{([^}]+)\}/g)) {
    for (const item of m[1].split(",")) {
      const t = item.trim();
      if (t) targets.push(/\.[a-z0-9]+$/i.test(t) ? t : `${t}.bib`);
    }
  }
  for (const m of src.matchAll(/\\(?:input|include)\{([^}]+)\}/g)) {
    const t = m[1].trim();
    if (t) targets.push(/\.[a-z0-9]+$/i.test(t) ? t : `${t}.tex`);
  }
  return targets;
}

function collectFrontmatterTargets(props) {
  const out = [];
  const pushVal = (v) => {
    if (typeof v === "string") {
      const s = v.trim();
      const wiki = s.match(/^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/);
      if (wiki) out.push(wiki[1].trim());
      else if (getAttachmentMime(s)) out.push(s);
    } else if (Array.isArray(v)) {
      for (const item of v) pushVal(item);
    }
  };
  if (props && typeof props === "object") {
    for (const v of Object.values(props)) pushVal(v);
  }
  return out;
}

async function resolveVaultAttachmentPath(kandinsky, rawTarget, baseDir, openPaths) {
  const clean = String(rawTarget || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!clean || !getAttachmentMime(clean)) return null;
  const cands = [];
  if (baseDir) {
    const rel = normalizeRelPath(`${baseDir}/${clean}`);
    if (rel) cands.push(rel);
  }
  const root = normalizeRelPath(clean);
  if (root && !cands.includes(root)) cands.push(root);
  const leaf = clean.split("/").pop()?.toLowerCase() || "";
  for (const op of openPaths) {
    if (op.toLowerCase().endsWith(`/${leaf}`) || op.toLowerCase() === leaf) {
      if (!cands.includes(op)) cands.push(op);
    }
  }
  if (typeof kandinsky.exists !== "function") return cands[0] || null;
  for (const cand of cands) {
    try {
      if (await kandinsky.exists(cand)) return cand;
    } catch {}
  }
  return null;
}

async function getVaultFileSize(kandinsky, path) {
  if (typeof kandinsky.list !== "function") return null;
  const dir = dirOfPath(path);
  const name = path.split("/").pop();
  try {
    const entries = await kandinsky.list(dir);
    if (!Array.isArray(entries)) return null;
    const hit = entries.find((e) => e && !e.dir && (e.path === path || e.name === name));
    return hit && typeof hit.size === "number" ? hit.size : null;
  } catch {
    return null;
  }
}

async function readVaultFileBytes(kandinsky, path) {
  if (typeof kandinsky.readBytes === "function") {
    const raw = await kandinsky.readBytes(path);
    if (raw instanceof Uint8Array) return raw;
    if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  }
  if (typeof kandinsky.fileUrl === "function") {
    const url = await kandinsky.fileUrl(path);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return new Uint8Array(await resp.arrayBuffer());
  }
  if (/\.(tex|md|bib)$/i.test(path) && typeof kandinsky.readText === "function") {
    const text = await kandinsky.readText(path);
    return new TextEncoder().encode(String(text || ""));
  }
  return null;
}

function uint8ToBase64(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return "";
  const parts = [];
  const chunk = 0x4000;
  for (let i = 0; i < bytes.length; i += chunk) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + chunk)));
  }
  return btoa(parts.join(""));
}

/** Collect active and linked .pdf/.tex/.md/.bib context files <= 10 MiB via permitted Kandinsky plugin APIs. */
export async function collectContextAttachments(kandinsky, opts = {}) {
  if (!kandinsky) return [];
  const snap = typeof kandinsky.context === "function" ? kandinsky.context() : null;
  const openPaths = Array.isArray(snap && snap.open)
    ? snap.open.map((p) => p && p.path).filter((p) => typeof p === "string" && p.trim())
    : [];
  const primaryPath = String(opts.path || (snap && snap.selection && snap.selection.path) || (snap && snap.active && snap.active.path) || "").trim();
  const baseDir = primaryPath ? dirOfPath(primaryPath) : "";

  const resolvedSet = new Set();
  const addResolved = (p) => {
    if (p && getAttachmentMime(p) && resolvedSet.size < MAX_ATTACHMENTS) resolvedSet.add(p);
  };

  if (primaryPath && getAttachmentMime(primaryPath)) {
    const direct = await resolveVaultAttachmentPath(kandinsky, primaryPath, "", openPaths);
    addResolved(direct || normalizeRelPath(primaryPath));
  }

  const rawTargets = [...extractContextLinkTargets(opts.prompt || "")];
  if (primaryPath && /\.(md|tex)$/i.test(primaryPath) && typeof kandinsky.readText === "function") {
    try {
      const noteText = await kandinsky.readText(primaryPath);
      rawTargets.push(...extractContextLinkTargets(noteText));
    } catch {}
  }
  if (primaryPath && /\.md$/i.test(primaryPath) && typeof kandinsky.noteProps === "function") {
    try {
      const props = await kandinsky.noteProps(primaryPath);
      rawTargets.push(...collectFrontmatterTargets(props));
    } catch {}
  }
  if (primaryPath && /\.pdf$/i.test(primaryPath) && typeof kandinsky.companion === "function") {
    try {
      const comp = await kandinsky.companion(primaryPath, { find: true });
      if (comp) rawTargets.push(comp);
    } catch {}
  }

  for (const target of rawTargets) {
    if (resolvedSet.size >= MAX_ATTACHMENTS) break;
    const hit = await resolveVaultAttachmentPath(kandinsky, target, baseDir, openPaths);
    addResolved(hit);
  }

  const attachments = [];
  for (const path of resolvedSet) {
    const mimeType = getAttachmentMime(path);
    const name = path.split("/").pop() || path;
    if (!mimeType) continue;
    try {
      const knownSize = await getVaultFileSize(kandinsky, path);
      if (typeof knownSize === "number" && knownSize > MAX_ATTACHMENT_BYTES) {
        const mib = (knownSize / (1024 * 1024)).toFixed(1);
        console.warn(`[solver] Skipping attachment > 10 MiB: ${path} (${mib} MiB)`);
        kandinsky.toast?.("Skipped oversized attachment", `${name} (${mib} MiB) exceeds the 10 MiB handoff limit.`, "info");
        continue;
      }
      if (knownSize === 0) continue;

      const bytes = await readVaultFileBytes(kandinsky, path);
      if (!bytes || bytes.byteLength === 0) continue;
      if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
        const mib = (bytes.byteLength / (1024 * 1024)).toFixed(1);
        console.warn(`[solver] Skipping attachment > 10 MiB: ${path} (${mib} MiB)`);
        kandinsky.toast?.("Skipped oversized attachment", `${name} (${mib} MiB) exceeds the 10 MiB handoff limit.`, "info");
        continue;
      }
      attachments.push({ name, mimeType, base64: uint8ToBase64(bytes) });
    } catch (e) {
      console.warn(`[solver] Could not attach ${path}:`, e);
    }
  }
  return attachments;
}

function parseExportedSteps(exported) {
  const body = String((exported && exported.bodyOnly) || "").trim();
  if (!body) return { finalAnswer: "", steps: [] };
  const faMatch = body.match(/> \[!IMPORTANT\] Final Answer\n((?:>.*(?:\n|$))+)/);
  const finalAnswer = faMatch ? faMatch[1].split("\n").map((l) => l.replace(/^>\s?/, "")).join("\n").trim() : "";
  const steps = [];
  const parts = body.split(/^###\s+(?=\d+\.\s+)/m);
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i].trim();
    const nl = chunk.indexOf("\n");
    const heading = (nl >= 0 ? chunk.slice(0, nl) : chunk).trim();
    const rest = nl >= 0 ? chunk.slice(nl + 1).trim() : "";
    steps.push({
      title: heading,
      markdown: `### ${heading}\n\n${rest}`.trim(),
      preview: rest.replace(/<details>[\s\S]*?<\/details>/g, "").replace(/\s+/g, " ").trim().slice(0, 180),
    });
  }
  return { finalAnswer, steps };
}

/** Fetch the latest (or specified) Solver derivation and insert it directly into the active Kandinsky Markdown note. */
export async function insertLatestSolverDerivation(kandinsky, opts = {}) {
  const cfg = getSolverSettings(kandinsky);
  const list = await kandinsky.helper.call("listConversations", { url: cfg.url, apiUrl: cfg.apiUrl, scanDownloads: true }, { timeout: 15 });
  const convs = Array.isArray(list && list.conversations) ? list.conversations : [];
  const zips = Array.isArray(list && list.exports) ? list.exports : [];
  const conversationId = opts.conversationId || (convs[0] && convs[0].id) || "";
  const zipPath = !conversationId ? opts.zipPath || (zips[0] && zips[0].path) || "" : "";
  if (!conversationId && !zipPath) {
    kandinsky.toast("No Solver derivation ready yet", "Complete a problem in Solver (or select any equation/step in the Solver pane) to insert at cursor.", "info");
    return false;
  }
  const exp = await kandinsky.helper.call(
    "exportMarkdown",
    { apiUrl: cfg.apiUrl, conversationId, zipPath, includeCode: false, onlyVerified: true },
    { timeout: 20 },
  );
  if (!exp || !exp.ok || !exp.bodyOnly) {
    kandinsky.toast("Could not read Solver derivation", (exp && exp.error) || "Export returned empty content.", "error");
    return false;
  }
  const block = formatDerivationCallout(exp.bodyOnly, { stepTitle: exp.title || undefined, solverId: exp.solverId || conversationId || undefined });
  return dispatchInsertToNote(block, kandinsky);
}

function getSelectedTextInside(rootEl) {
  const sel = window.getSelection?.();
  if (!sel || sel.isCollapsed) return "";
  const txt = sel.toString().trim();
  const anchor = sel.anchorNode;
  if (!txt || !anchor || !rootEl.contains(anchor)) return "";
  const el = anchor.nodeType === 1 ? anchor : anchor.parentElement;
  if (el && el.closest?.(".solver-problem-textarea")) return "";
  return txt;
}

function mk(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "onclick" || k === "oninput" || k === "onchange") node[k] = v;
    else if (k === "disabled" || k === "selected") node[k] = Boolean(v);
    else node.setAttribute(k, String(v));
  }
  for (const ch of children) if (ch) node.append(ch);
  return node;
}

export default function mountSolver(host, kandinsky) {
  let disposed = false, starting = false, running = false, inserting = false, statusChecked = false;
  let statusDetail = "Checking local Solver services…", errorMsg = "", frameKey = 0;
  let showComposer = false, problemPrompt = "", prefillMeta = "", lastPrefillSig = "", lastPrefillAt = 0;
  let showLedger = false, loadingLedger = false, ledgerConvs = [], ledgerZips = [], activeSourceKey = "";
  let activeExport = null, parsedLedger = { finalAnswer: "", steps: [] };

  const cfg = getSolverSettings(kandinsky);
  Object.assign(host.style, { display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--bg)", color: "var(--text)" });

  const style = mk("style", {
    text: `
    .solver-shell { display: flex; flex-direction: column; height: 100%; width: 100%; overflow: hidden; background: var(--bg); }
    .solver-bar { display: flex; align-items: center; gap: 7px; padding: 6px 10px; border-bottom: 1px solid var(--border); background: var(--bg-alt, var(--bg-elev, var(--bg))); flex: none; flex-wrap: wrap; }
    .solver-brand { display: inline-flex; align-items: center; gap: 7px; font-weight: 650; font-size: 13px; color: var(--heading, var(--text)); }
    .solver-sigma { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 5px; background: var(--accent); color: var(--bg); font-weight: 700; font-size: 12px; font-family: Georgia, serif; }
    .solver-pill { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 999px; font-size: 11.5px; border: 1px solid var(--border-strong, var(--border)); color: var(--text-muted); }
    .solver-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-faint); }
    .solver-pill.ok { color: var(--text); border-color: color-mix(in srgb, var(--green, #3ca395) 55%, var(--border)); }
    .solver-pill.ok .solver-dot { background: var(--green, #3ca395); }
    .solver-pill.busy .solver-dot { background: var(--yellow, #dfab2e); }
    .solver-pill.err { color: var(--red, #d94e41); border-color: var(--red, #d94e41); }
    .solver-pill.err .solver-dot { background: var(--red, #d94e41); }
    .solver-spacer { flex: 1; }
    .solver-btn { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 6px; border: 1px solid var(--border-strong, var(--border)); background: var(--bg); color: var(--text); font-size: 12px; cursor: pointer; transition: background .12s, border-color .12s; }
    .solver-btn:hover { background: var(--bg-hover); }
    .solver-btn.on { border-color: var(--accent); color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--bg)); }
    .solver-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--bg); font-weight: 600; }
    .solver-btn.bauhaus-insert { background: color-mix(in srgb, var(--accent) 14%, var(--bg)); border-color: var(--accent); color: var(--accent); font-weight: 600; }
    .solver-btn.bauhaus-insert:hover { background: var(--accent); color: var(--bg); }
    .solver-btn:disabled { opacity: 0.5; pointer-events: none; }
    .solver-composer { display: flex; flex-direction: column; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--accent) 5%, var(--bg)); flex: none; }
    .solver-composer-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-size: 11.5px; color: var(--text-muted); }
    .solver-composer-badge { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; color: var(--heading, var(--text)); }
    .solver-problem-textarea { width: 100%; min-height: 62px; max-height: 150px; resize: vertical; padding: 7px 9px; border-radius: 6px; border: 1px solid var(--border-strong, var(--border)); background: var(--bg); color: var(--text); font-family: var(--font-mono, monospace); font-size: 12px; line-height: 1.45; }
    .solver-problem-textarea:focus { outline: none; border-color: var(--accent); }
    .solver-ledger { display: flex; flex-direction: column; gap: 8px; max-height: 44%; overflow: auto; padding: 10px 12px; border-bottom: 1px solid var(--border-strong, var(--border)); background: var(--bg-alt, var(--bg)); flex: none; }
    .solver-ledger-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
    .solver-select { flex: 1; min-width: 180px; max-width: 360px; padding: 3px 8px; border-radius: 6px; border: 1px solid var(--border-strong, var(--border)); background: var(--bg); color: var(--text); font-size: 12px; }
    .solver-step-card { display: flex; flex-direction: column; gap: 5px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border); border-left: 2px solid var(--accent); background: var(--bg); user-select: text; }
    .solver-step-card.final { border-left-color: var(--green, #3ca395); background: color-mix(in srgb, var(--green, #3ca395) 6%, var(--bg)); }
    .solver-step-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .solver-step-title { font-size: 12px; font-weight: 600; color: var(--heading, var(--text)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .solver-step-body { font-size: 12px; line-height: 1.45; color: var(--text-muted); white-space: pre-wrap; word-break: break-word; max-height: 96px; overflow: auto; }
    .solver-body { flex: 1; min-height: 0; position: relative; display: flex; flex-direction: column; }
    .solver-frame { flex: 1; width: 100%; height: 100%; border: 0; background: var(--bg); }
    .solver-card-wrap { flex: 1; display: grid; place-items: center; padding: 24px; overflow: auto; }
    .solver-card { max-width: 520px; width: 100%; padding: 22px 24px; border-radius: 10px; border: 1px solid var(--border-strong, var(--border)); background: var(--bg-elev, var(--bg)); display: flex; flex-direction: column; gap: 12px; }
    .solver-card h3 { margin: 0; font-size: 16px; }
    .solver-card p { margin: 0; font-size: 13px; line-height: 1.55; color: var(--text-muted); }
    .solver-err { padding: 10px 12px; border-radius: 6px; border: 1px solid var(--red, #d94e41); color: var(--red, #d94e41); font-size: 12.5px; white-space: pre-wrap; }
    .solver-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
    .solver-inline-row { display: inline-flex; gap: 6px; align-items: center; }
  `,
  });

  const bar = mk("div", { class: "solver-bar" });
  const composerBar = mk("div", { class: "solver-composer" });
  const ledgerDrawer = mk("div", { class: "solver-ledger" });
  const body = mk("div", { class: "solver-body" });
  composerBar.style.display = "none";
  ledgerDrawer.style.display = "none";
  host.replaceChildren(style, mk("div", { class: "solver-shell" }, bar, composerBar, ledgerDrawer, body));

  let iframeEl = null;
  let iframeLoaded = false;
  let problemTextarea = null;
  let pendingPrefill = null;
  let userPinnedComposer = false;
  let prefillSeq = 0;
  let activePrefillSeq = 0;

  function clearPendingAckTimer() {
    if (pendingPrefill && pendingPrefill.ackTimer !== null) {
      clearTimeout(pendingPrefill.ackTimer);
      pendingPrefill.ackTimer = null;
    }
  }

  function openComposerFallback(pending, notify = true) {
    if (disposed || !pending || pending !== pendingPrefill || pending.acked) return;
    showComposer = true;
    navigator.clipboard?.writeText(pending.prompt).catch(() => {});
    renderBar();
    renderComposer();
    if (problemTextarea) {
      problemTextarea.focus();
      problemTextarea.setSelectionRange(problemTextarea.value.length, problemTextarea.value.length);
    }
    if (notify && !pending.silent) {
      kandinsky.toast("Loaded into Solver Problem Box", `${pending.meta} — ready to solve or edit.`, "success");
    }
  }

  function schedulePrefillAckTimeout(pending) {
    clearPendingAckTimer();
    pending.ackTimer = setTimeout(() => {
      if (disposed || pending !== pendingPrefill || pending.acked) return;
      pending.ackTimer = null;
      openComposerFallback(pending, true);
    }, PREFILL_ACK_TIMEOUT_MS);
  }

  function postPrefillToIframe(pending) {
    if (disposed || !pending || pending.acked || !iframeEl || !iframeEl.contentWindow || !iframeLoaded) return false;
    const msg = {
      type: "solver:prefill",
      id: pending.id,
      requestId: pending.id,
      prompt: pending.prompt,
      ...(pending.path ? { path: pending.path } : {}),
      ...(pending.title ? { title: pending.title } : {}),
      ...(pending.page !== undefined ? { page: pending.page } : {}),
      ...(pending.arxivId ? { arxivId: pending.arxivId } : {}),
      ...(pending.attachments && pending.attachments.length ? { attachments: pending.attachments } : {}),
    };
    try {
      iframeEl.contentWindow.postMessage(msg, getSolverTargetOrigin(cfg.url));
      schedulePrefillAckTimeout(pending);
      return true;
    } catch {
      openComposerFallback(pending, true);
      return false;
    }
  }

  function handleIframeLoad() {
    if (disposed) return;
    iframeLoaded = true;
    if (pendingPrefill && !pendingPrefill.acked && pendingPrefill.retries < MAX_PREFILL_LOAD_RETRIES) {
      pendingPrefill.retries += 1;
      postPrefillToIframe(pendingPrefill);
    }
  }

  async function applyPrefill(payload, silent = false) {
    if (disposed || !payload) return;
    const rawText = String(payload.prompt || "").trim();
    const hasGivenAttachments = Array.isArray(payload.attachments);
    if (!rawText && !(hasGivenAttachments && payload.attachments.length) && !payload.path) return;

    const now = Date.now();
    const sig = payload.requestId ? `id:${payload.requestId}` : `${rawText}|${payload.path || ""}|${payload.page || ""}`;
    if (sig === lastPrefillSig && now - lastPrefillAt < 900) return;
    lastPrefillSig = sig;
    lastPrefillAt = now;

    const seq = ++activePrefillSeq;
    const attachments = hasGivenAttachments
      ? payload.attachments
      : await collectContextAttachments(kandinsky, { path: payload.path, prompt: rawText });
    if (disposed || seq !== activePrefillSeq) return;

    const text = rawText || (attachments.length ? `Analyze the attached file${attachments.length === 1 ? "" : "s"}: ${attachments.map((a) => a.name).join(", ")}.` : "");
    if (!text) return;

    problemPrompt = text;
    const parts = [];
    if (payload.arxivId) parts.push(`arXiv:${payload.arxivId}`);
    if (payload.path) parts.push(payload.path.split("/").pop());
    else if (payload.title) parts.push(payload.title);
    if (payload.page) parts.push(`p. ${payload.page}`);
    if (attachments.length) parts.push(`${attachments.length} file${attachments.length === 1 ? "" : "s"}`);
    prefillMeta = parts.join(" · ") || "Passage handoff";

    clearPendingAckTimer();
    const pending = {
      id: String(payload.requestId || `sol-${Date.now()}-${++prefillSeq}`),
      prompt: text,
      path: payload.path,
      title: payload.title,
      page: payload.page,
      arxivId: payload.arxivId ?? null,
      attachments,
      meta: prefillMeta,
      silent,
      acked: false,
      retries: 0,
      ackTimer: null,
    };
    pendingPrefill = pending;

    if (!userPinnedComposer) showComposer = false;
    renderBar();
    renderComposer();

    if (iframeEl && iframeEl.contentWindow && iframeLoaded) {
      postPrefillToIframe(pending);
    } else if (statusChecked && !running && !starting) {
      openComposerFallback(pending, true);
    }
  }

  async function loadLedgerForSource(sourceKey) {
    if (disposed) return;
    loadingLedger = true;
    renderLedger();
    try {
      if (!sourceKey) {
        const res = await kandinsky.helper.call("listConversations", { url: cfg.url, apiUrl: cfg.apiUrl, scanDownloads: true }, { timeout: 15 });
        if (disposed) return;
        ledgerConvs = Array.isArray(res && res.conversations) ? res.conversations : [];
        ledgerZips = Array.isArray(res && res.exports) ? res.exports : [];
        if (ledgerConvs.length) activeSourceKey = `conv:${ledgerConvs[0].id}`;
        else if (ledgerZips.length) activeSourceKey = `zip:${ledgerZips[0].path}`;
      } else activeSourceKey = sourceKey;

      if (activeSourceKey) {
        const isZip = activeSourceKey.startsWith("zip:");
        const val = activeSourceKey.slice(4);
        const exp = await kandinsky.helper.call(
          "exportMarkdown",
          { apiUrl: cfg.apiUrl, conversationId: isZip ? "" : val, zipPath: isZip ? val : "", includeCode: false, onlyVerified: true },
          { timeout: 20 },
        );
        if (!disposed && exp && exp.ok) {
          activeExport = exp;
          parsedLedger = parseExportedSteps(exp);
        }
      }
    } catch (e) {
      kandinsky.toast("Could not load Solver steps", String((e && e.message) || e), "error");
    } finally {
      loadingLedger = false;
      renderBar();
      renderLedger();
    }
  }

  async function handleInsertActiveNote() {
    if (inserting || disposed) return;
    const selected = getSelectedTextInside(host);
    if (selected) {
      dispatchInsertToNote(formatDerivationCallout(selected, { stepTitle: "Selected Excerpt", solverId: activeExport && activeExport.solverId }), kandinsky);
      return;
    }
    if (activeExport && activeExport.bodyOnly) {
      dispatchInsertToNote(formatDerivationCallout(activeExport.bodyOnly, { stepTitle: activeExport.title || undefined, solverId: activeExport.solverId || undefined }), kandinsky);
      return;
    }
    inserting = true;
    renderBar();
    try { await insertLatestSolverDerivation(kandinsky); }
    finally { inserting = false; renderBar(); }
  }

  function renderComposer() {
    if (!showComposer) { composerBar.style.display = "none"; problemTextarea = null; return; }
    composerBar.style.display = "flex";
    const copyBtn = mk("button", {
      class: "solver-btn primary", text: "Copy to Solver Clipboard",
      onclick: () => {
        if (!problemPrompt.trim()) return;
        navigator.clipboard?.writeText(problemPrompt).then(
          () => kandinsky.toast("Copied problem prompt", "Paste (Ctrl+V) into Solver's New Problem box below.", "success"),
          () => kandinsky.toast("Prompt ready", "Copy the prompt from the box above.", "info"),
        );
      },
    });
    const closeBtn = mk("button", { class: "solver-btn", text: "Hide", onclick: () => { showComposer = false; userPinnedComposer = false; renderBar(); renderComposer(); } });
    const top = mk("div", { class: "solver-composer-top" },
      mk("span", { class: "solver-composer-badge", text: `● Problem Input${prefillMeta ? ` · ${prefillMeta}` : ""}` }),
      mk("span", { class: "solver-inline-row" }, copyBtn, closeBtn),
    );
    const ta = mk("textarea", {
      class: "solver-problem-textarea", "data-testid": "solver-problem-input",
      placeholder: "Paste or send an equation / problem statement from any PDF or note…",
      oninput: (e) => { problemPrompt = e.target.value; },
    });
    ta.value = problemPrompt;
    problemTextarea = ta;
    composerBar.replaceChildren(top, ta);
  }

  function renderLedger() {
    if (!showLedger) { ledgerDrawer.style.display = "none"; return; }
    ledgerDrawer.style.display = "flex";
    const sel = mk("select", { class: "solver-select", onchange: () => void loadLedgerForSource(sel.value) });
    if (!ledgerConvs.length && !ledgerZips.length) {
      sel.append(mk("option", { value: "", text: loadingLedger ? "Loading Solver derivations…" : "No completed derivations found yet" }));
    } else {
      for (const c of ledgerConvs) {
        const val = `conv:${c.id}`;
        sel.append(mk("option", { value: val, selected: activeSourceKey === val, text: `${c.title || "Untitled"} (${c.stepCount ?? 0} steps · ${c.status || "active"})` }));
      }
      for (const z of ledgerZips) {
        const val = `zip:${z.path}`;
        sel.append(mk("option", { value: val, selected: activeSourceKey === val, text: `📦 ${z.name}` }));
      }
    }
    const rightActs = mk("span", { class: "solver-inline-row" });
    if (activeExport && activeExport.bodyOnly) {
      rightActs.append(mk("button", {
        class: "solver-btn bauhaus-insert", text: "● Insert Full Derivation",
        onclick: () => dispatchInsertToNote(formatDerivationCallout(activeExport.bodyOnly, { stepTitle: activeExport.title, solverId: activeExport.solverId }), kandinsky),
      }));
    }
    rightActs.append(mk("button", { class: "solver-btn", disabled: loadingLedger, text: loadingLedger ? "Syncing…" : "Refresh", onclick: () => void loadLedgerForSource("") }));

    const nodes = [mk("div", { class: "solver-ledger-head" }, sel, rightActs)];
    if (parsedLedger.finalAnswer) {
      nodes.push(mk("div", { class: "solver-step-card final" },
        mk("div", { class: "solver-step-top" },
          mk("span", { class: "solver-step-title", text: "◎ Final Answer" }),
          mk("button", {
            class: "solver-btn bauhaus-insert", text: "Insert Result → Note",
            onclick: () => dispatchInsertToNote(formatDerivationCallout(parsedLedger.finalAnswer, { stepTitle: (activeExport && activeExport.title) || "Final Answer", solverId: activeExport && activeExport.solverId }), kandinsky),
          }),
        ),
        mk("div", { class: "solver-step-body", text: parsedLedger.finalAnswer }),
      ));
    }
    for (const st of parsedLedger.steps) {
      nodes.push(mk("div", { class: "solver-step-card" },
        mk("div", { class: "solver-step-top" },
          mk("span", { class: "solver-step-title", text: `● ${st.title}` }),
          mk("button", {
            class: "solver-btn", text: "Insert Step → Note",
            onclick: () => dispatchInsertToNote(formatDerivationCallout(st.markdown, { stepTitle: st.title, solverId: activeExport && activeExport.solverId }), kandinsky),
          }),
        ),
        st.preview ? mk("div", { class: "solver-step-body", text: st.preview }) : null,
      ));
    }
    ledgerDrawer.replaceChildren(...nodes);
  }

  function renderBar() {
    const brand = mk("span", { class: "solver-brand" }, mk("span", { class: "solver-sigma", text: "Σ" }), mk("span", { text: "Solver" }));
    const pill = mk("span", { class: `solver-pill ${running ? "ok" : starting ? "busy" : errorMsg ? "err" : ""}` },
      mk("span", { class: "solver-dot" }),
      mk("span", { text: running ? "Connected" : starting ? "Starting…" : errorMsg ? "Needs attention" : "Offline" }),
    );
    const insertBtn = mk("button", {
      class: "solver-btn bauhaus-insert", disabled: inserting, "data-testid": "solver-insert-active-note",
      title: "Insert selected Solver text/equation or latest completed derivation at the cursor in your active Markdown note",
      text: inserting ? "Inserting…" : "● Insert into Active Note",
      onclick: () => void handleInsertActiveNote(),
    });
    const stepsBtn = mk("button", {
      class: `solver-btn ${showLedger ? "on" : ""}`,
      title: "Inspect individual completed derivation steps & insert any step into your active note",
      text: parsedLedger.steps.length ? `Steps (${parsedLedger.steps.length})` : "Steps ▾",
      onclick: () => { showLedger = !showLedger; renderBar(); renderLedger(); if (showLedger && !activeExport) void loadLedgerForSource(""); },
    });
    const promptBtn = mk("button", {
      class: `solver-btn ${showComposer ? "on" : ""}`,
      title: "Show/hide Solver problem input box (pre-filled by Send to Agent → Solver)",
      text: "Problem Box",
      onclick: () => {
        showComposer = !showComposer;
        userPinnedComposer = showComposer;
        renderBar();
        renderComposer();
        if (showComposer && problemTextarea) problemTextarea.focus();
      },
    });
    const importBtn = mk("button", {
      class: "solver-btn", title: "Save or append a Solver derivation as a Kandinsky Markdown note",
      text: "Save as Note…", onclick: () => openImportFallback(kandinsky),
    });
    const svcBtn = !running
      ? mk("button", { class: "solver-btn primary", disabled: starting, text: starting ? "Starting…" : "Start", onclick: () => void startSolver() })
      : mk("button", {
          class: "solver-btn", title: "Reload Solver workspace", text: "↻",
          onclick: () => {
            frameKey++;
            if (iframeEl) iframeEl.removeEventListener("load", handleIframeLoad);
            iframeEl = null;
            iframeLoaded = false;
            void refreshStatus(false);
          },
        });
    const cfgBtn = mk("button", { class: "solver-btn", title: "Solver plugin settings", text: "⚙", onclick: () => kandinsky.plugin.openSettings() });

    bar.replaceChildren(brand, pill, mk("span", { class: "solver-spacer" }), insertBtn, stepsBtn, promptBtn, importBtn, svcBtn, cfgBtn);
  }

  function renderBody() {
    if (running) {
      if (!isValidSolverUrl(cfg.url)) {
        if (iframeEl) iframeEl.removeEventListener("load", handleIframeLoad);
        iframeEl = null;
        iframeLoaded = false;
        const card = mk("div", { class: "solver-card" },
          mk("h3", { text: "Invalid Solver URL" }),
          mk("p", { text: "The configured Solver UI URL must start with http:// or https://." }),
          mk("div", { class: "solver-err", text: `Configured URL: ${cfg.url || "(empty)"}` }),
          mk("div", { class: "solver-actions" },
            mk("button", { class: "solver-btn primary", text: "Open Solver Settings", onclick: () => kandinsky.plugin.openSettings() }),
            mk("button", { class: "solver-btn bauhaus-insert", text: "● Insert into Active Note", onclick: () => void handleInsertActiveNote() }),
            mk("button", { class: "solver-btn", text: "Save .zip as Note…", onclick: () => openImportFallback(kandinsky) }),
          ),
        );
        body.replaceChildren(mk("div", { class: "solver-card-wrap" }, card));
        if (pendingPrefill && !pendingPrefill.acked && !showComposer) {
          openComposerFallback(pendingPrefill, false);
        }
        return;
      }
      if (!iframeEl) {
        iframeLoaded = false;
        iframeEl = mk("iframe", {
          class: "solver-frame", title: "Solver Agent Workspace", allow: "clipboard-read; clipboard-write",
          src: `${cfg.url}${cfg.url.includes("?") ? "&" : "?"}_k=${frameKey}`,
        });
        iframeEl.addEventListener("load", handleIframeLoad);
        body.replaceChildren(iframeEl);
      }
      return;
    }
    if (iframeEl) iframeEl.removeEventListener("load", handleIframeLoad);
    iframeEl = null;
    iframeLoaded = false;
    const card = mk("div", { class: "solver-card" },
      mk("h3", { text: starting ? "Starting Solver Agent…" : "Solver Agent Workspace" }),
      mk("p", { text: statusDetail }),
      errorMsg ? mk("div", { class: "solver-err", text: errorMsg }) : null,
      mk("div", { class: "solver-actions" },
        mk("button", { class: "solver-btn primary", disabled: starting, text: starting ? "Starting background services…" : "Start Solver Services", onclick: () => void startSolver() }),
        mk("button", { class: "solver-btn bauhaus-insert", text: "● Insert into Active Note", onclick: () => void handleInsertActiveNote() }),
        mk("button", { class: "solver-btn", text: "Save .zip as Note…", onclick: () => openImportFallback(kandinsky) }),
        mk("button", { class: "solver-btn", disabled: starting, text: "Check Again", onclick: () => void refreshStatus(false) }),
      ),
    );
    body.replaceChildren(mk("div", { class: "solver-card-wrap" }, card));
  }

  const syncUi = () => { if (!disposed) { renderBar(); renderComposer(); renderLedger(); renderBody(); } };

  async function startSolver() {
    if (starting || disposed) return;
    starting = true;
    errorMsg = "";
    statusDetail = "Checking WSL2 and the MongoDB service (mongod), then launching Solver services silently in the background…";
    syncUi();
    try {
      const res = await kandinsky.helper.call("start", { url: cfg.url, apiUrl: cfg.apiUrl, launcherDir: cfg.launcherDir }, { timeout: 310 });
      if (disposed) return;
      running = Boolean(res && res.ok);
      errorMsg = running ? "" : (res && res.error) || "Solver services did not finish starting.";
      statusDetail = running ? "Solver Agent is running." : "Solver could not start automatically. Make sure WSL2 is running and the mongod service is active in Ubuntu (sudo systemctl start mongod), then try again.";
    } catch (e) {
      if (disposed) return;
      running = false;
      errorMsg = String((e && e.message) || e);
      statusDetail = "Could not run the Solver background launcher.";
    } finally {
      starting = false;
      statusChecked = true;
      syncUi();
      if (!running && pendingPrefill && !pendingPrefill.acked && !showComposer) {
        openComposerFallback(pendingPrefill, false);
      }
    }
  }

  async function refreshStatus(allowAutoStart) {
    if (disposed) return;
    try {
      const st = await kandinsky.helper.call("status", { url: cfg.url, apiUrl: cfg.apiUrl }, { timeout: 15 });
      if (disposed) return;
      if (st && st.running) { running = true; statusChecked = true; errorMsg = ""; statusDetail = "Solver Agent is running."; syncUi(); return; }
      running = false;
      if (allowAutoStart && cfg.autoStart) { await startSolver(); return; }
      statusChecked = true;
      statusDetail = "Solver's local services are currently stopped. Click Start Solver Services to launch them inside Kandinsky.";
      syncUi();
      if (pendingPrefill && !pendingPrefill.acked && !showComposer) {
        openComposerFallback(pendingPrefill, true);
      }
    } catch (e) {
      if (disposed) return;
      running = false;
      statusChecked = true;
      errorMsg = String((e && e.message) || e);
      statusDetail = "Could not reach the Solver helper.";
      // a refused approval prompt is not a fault: say what to do instead of showing the raw refusal
      if (/execution denied|blocked untrusted binary/i.test(errorMsg)) {
        errorMsg = "";
        statusDetail = "Solver was not allowed to run its status check. Restart Kandinsky and choose Allow when it asks.";
      }
      syncUi();
      if (pendingPrefill && !pendingPrefill.acked && !showComposer) {
        openComposerFallback(pendingPrefill, false);
      }
    }
  }

  const onPrefillEvent = (ev) => {
    const detail = ev && ev.detail;
    if (detail && (detail.prompt || (Array.isArray(detail.attachments) && detail.attachments.length) || detail.path)) {
      window.__kandinskyPendingSolverPrompt = undefined;
      void applyPrefill(detail, false);
    }
  };
  window.addEventListener("kandinsky:solver-prefill", onPrefillEvent);

  const onWindowMessage = (ev) => {
    if (disposed || !ev || !ev.data || typeof ev.data !== "object") return;
    if (!isAllowedSolverOrigin(ev.origin, cfg.url)) return;
    if (ev.source && iframeEl && iframeEl.contentWindow && ev.source !== iframeEl.contentWindow) return;

    const msg = ev.data;
    if (msg.type === "solver:prefill-ack") {
      if (!iframeEl || !pendingPrefill || pendingPrefill.acked) return;
      const ackId = msg.id ?? msg.requestId;
      if (ackId && String(ackId) !== String(pendingPrefill.id)) return;
      pendingPrefill.acked = true;
      clearPendingAckTimer();
      if (!userPinnedComposer && showComposer) {
        showComposer = false;
        renderBar();
        renderComposer();
      }
      if (!pendingPrefill.silent) {
        kandinsky.toast("Sent to Solver", `${pendingPrefill.meta || "Problem"} loaded in Solver.`, "success");
      }
      return;
    }

    if (msg.type === "solver:insert-derivation") {
      const payload = msg.payload && typeof msg.payload === "object" ? msg.payload : msg;
      const block = formatDerivationCallout(payload);
      if (!block) {
        kandinsky.toast("Nothing to insert", "Solver derivation message had no Markdown or LaTeX content.", "info");
        return;
      }
      const ok = dispatchInsertToNote(block, kandinsky);
      try {
        if (ev.source && typeof ev.source.postMessage === "function") {
          ev.source.postMessage({ type: "solver:insert-derivation-ack", ok: Boolean(ok), id: payload.id || msg.id }, ev.origin);
        }
      } catch {}
    }
  };
  window.addEventListener("message", onWindowMessage);

  const initialArg = parseArg(kandinsky.arg);
  if (window.__kandinskyPendingSolverPrompt && (window.__kandinskyPendingSolverPrompt.prompt || (Array.isArray(window.__kandinskyPendingSolverPrompt.attachments) && window.__kandinskyPendingSolverPrompt.attachments.length))) {
    const pending = window.__kandinskyPendingSolverPrompt;
    window.__kandinskyPendingSolverPrompt = undefined;
    void applyPrefill(pending, false);
  } else if (initialArg && (initialArg.prompt || initialArg.path)) {
    void applyPrefill(initialArg, true);
  }

  syncUi();
  void refreshStatus(true);

  return () => {
    disposed = true;
    clearPendingAckTimer();
    if (iframeEl) iframeEl.removeEventListener("load", handleIframeLoad);
    window.removeEventListener("kandinsky:solver-prefill", onPrefillEvent);
    window.removeEventListener("message", onWindowMessage);
  };
}
