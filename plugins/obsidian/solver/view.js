// Solver app pane (view.js): docks Solver Agent inside Kandinsky with direct KaTeX derivation cursor export & PDF/note prefill.

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
    launcherDir: String(s.launcher_dir || "C:/Users/antimajorana/Documents/GitHub/re-Solver-Agent").trim(),
    autoStart: s.auto_start !== false,
  };
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

/** Wrap normalized KaTeX derivation prose & equations inside a Bauhaus [!NOTE] callout with source metadata for c_lint. */
export function formatDerivationCallout(rawContent, opts = {}) {
  const normalized = normalizeKatexMath(rawContent);
  if (!normalized) return "";
  const stamp = opts.timestamp || nowStamp();
  const label = opts.stepTitle ? `Solver Derivation · ${opts.stepTitle} · ${stamp}` : `Solver Derivation · ${stamp}`;
  const meta = ["source: solver-agent", ...(opts.solverId ? [`solver_id: ${opts.solverId}`] : []), "verified-pending: run c_lint"];
  const quoted = normalized.split("\n").map((l) => (l.trim() ? `> ${l}` : ">")).join("\n");
  return `> [!NOTE] ${label}\n> <!-- ${meta.join(", ")} -->\n${quoted}\n`;
}

export function openImportFallback(kandinsky, targetPath = "") {
  const active = targetPath || (kandinsky.context()?.active?.path ?? "");
  void kandinsky.openDialog(JSON.stringify({ targetPath: active }), {
    title: "Import Solver Derivation to Note", width: 680, height: 540, view: "import-dialog.js",
  });
}

/** Dispatch "kandinsky:insert-at-cursor" to insert formatted Markdown/KaTeX at the open note's cursor, with graceful fallback. */
export function dispatchInsertToNote(formattedBlock, kandinsky) {
  if (!formattedBlock || !formattedBlock.trim()) {
    kandinsky.toast("Nothing to insert", "Select an equation or complete a Solver step first.", "info");
    return false;
  }
  let handled = false;
  let succeeded = false;
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
            const reason = (res && res.reason) || "No open Markdown note.";
            kandinsky.toast("No active Markdown note", `${reason} Opening Save / Import dialog instead…`, "info");
            openImportFallback(kandinsky);
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
    kandinsky.toast("No active Markdown note", "Open a Markdown note tab first, or save via Import dialog.", "info");
    openImportFallback(kandinsky);
  }
  return succeeded;
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
  let disposed = false, starting = false, running = false, inserting = false;
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
  let problemTextarea = null;

  function applyPrefill(payload, silent = false) {
    const text = String((payload && payload.prompt) || "").trim();
    if (!text) return;
    const now = Date.now();
    if (text === lastPrefillSig && now - lastPrefillAt < 900) return;
    lastPrefillSig = text;
    lastPrefillAt = now;
    problemPrompt = text;
    const parts = [];
    if (payload.arxivId) parts.push(`arXiv:${payload.arxivId}`);
    if (payload.path) parts.push(payload.path.split("/").pop());
    else if (payload.title) parts.push(payload.title);
    if (payload.page) parts.push(`p. ${payload.page}`);
    prefillMeta = parts.join(" · ") || "Passage handoff";
    showComposer = true;

    navigator.clipboard?.writeText(text).catch(() => {});
    try { iframeEl?.contentWindow?.postMessage({ type: "solver:prefill", prompt: text, path: payload.path, page: payload.page }, "*"); } catch {}
    renderBar();
    renderComposer();
    if (problemTextarea) {
      problemTextarea.focus();
      problemTextarea.setSelectionRange(problemTextarea.value.length, problemTextarea.value.length);
    }
    if (!silent) kandinsky.toast("Loaded into Solver Problem Box", `${prefillMeta} — ready to solve or edit.`, "success");
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
    const closeBtn = mk("button", { class: "solver-btn", text: "Hide", onclick: () => { showComposer = false; renderBar(); renderComposer(); } });
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
      onclick: () => { showComposer = !showComposer; renderBar(); renderComposer(); },
    });
    const importBtn = mk("button", {
      class: "solver-btn", title: "Save or append a Solver derivation as a Kandinsky Markdown note",
      text: "Save as Note…", onclick: () => openImportFallback(kandinsky),
    });
    const svcBtn = !running
      ? mk("button", { class: "solver-btn primary", disabled: starting, text: starting ? "Starting…" : "Start", onclick: () => void startSolver() })
      : mk("button", { class: "solver-btn", title: "Reload Solver workspace", text: "↻", onclick: () => { frameKey++; iframeEl = null; void refreshStatus(false); } });
    const cfgBtn = mk("button", { class: "solver-btn", title: "Solver plugin settings", text: "⚙", onclick: () => kandinsky.plugin.openSettings() });

    bar.replaceChildren(brand, pill, mk("span", { class: "solver-spacer" }), insertBtn, stepsBtn, promptBtn, importBtn, svcBtn, cfgBtn);
  }

  function renderBody() {
    if (running) {
      if (!iframeEl) {
        iframeEl = mk("iframe", {
          class: "solver-frame", title: "Solver Agent Workspace", allow: "clipboard-read; clipboard-write",
          src: `${cfg.url}${cfg.url.includes("?") ? "&" : "?"}_k=${frameKey}`,
        });
        body.replaceChildren(iframeEl);
      }
      return;
    }
    iframeEl = null;
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
      syncUi();
    }
  }

  async function refreshStatus(allowAutoStart) {
    if (disposed) return;
    try {
      const st = await kandinsky.helper.call("status", { url: cfg.url, apiUrl: cfg.apiUrl }, { timeout: 15 });
      if (disposed) return;
      if (st && st.running) { running = true; errorMsg = ""; statusDetail = "Solver Agent is running."; syncUi(); return; }
      running = false;
      if (allowAutoStart && cfg.autoStart) { await startSolver(); return; }
      statusDetail = "Solver's local services are currently stopped. Click Start Solver Services to launch them inside Kandinsky.";
      syncUi();
    } catch (e) {
      if (disposed) return;
      running = false;
      errorMsg = String((e && e.message) || e);
      statusDetail = "Could not reach the Solver helper.";
      syncUi();
    }
  }

  const onPrefillEvent = (ev) => {
    const detail = ev && ev.detail;
    if (detail && detail.prompt) {
      window.__kandinskyPendingSolverPrompt = undefined;
      applyPrefill(detail, false);
    }
  };
  window.addEventListener("kandinsky:solver-prefill", onPrefillEvent);

  const initialArg = parseArg(kandinsky.arg);
  if (window.__kandinskyPendingSolverPrompt && window.__kandinskyPendingSolverPrompt.prompt) {
    const pending = window.__kandinskyPendingSolverPrompt;
    window.__kandinskyPendingSolverPrompt = undefined;
    applyPrefill(pending, false);
  } else if (initialArg && initialArg.prompt) {
    applyPrefill(initialArg, true);
  }

  syncUi();
  void refreshStatus(true);

  return () => {
    disposed = true;
    window.removeEventListener("kandinsky:solver-prefill", onPrefillEvent);
  };
}
