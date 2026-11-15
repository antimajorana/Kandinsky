// Shared Model Switcher & Live Subagent Monitor UI (switcher-ui.js) for both the status-bar popover and the Antigravity pane.

export const FALLBACK_MODELS = [
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
  { value: "claude-opus-4-6-thinking", label: "Claude Opus 4.6 (Thinking)", family: "Other" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", family: "Other" },
  { value: "gpt-oss-120b-medium", label: "GPT-OSS 120B (Medium)", family: "Other" },
];

export function shortModelName(slug) {
  const s = String(slug || "").trim();
  if (!s || s === "default" || s === "inherit") return "Default";
  const m = s.match(/^gemini-4-(carbon|argon|hydrogen)-(xhigh|high|medium|low)$/i);
  if (m) {
    const fam = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    const tier = m[2].toLowerCase() === "medium" ? "Med" : m[2].toLowerCase() === "xhigh" ? "XHigh" : m[2][0].toUpperCase() + m[2].slice(1).toLowerCase();
    return `${fam} (${tier})`;
  }
  if (s === "gemini-pro-orchestrator") return "Orch (Carbon)";
  if (s === "gemini-pro-orchestrator-argon") return "Orch (Argon)";
  if (s.startsWith("gemini-3.8-flash-")) return `Flash (${s.split("-").pop()})`;
  if (s.startsWith("claude-opus")) return "Opus 4.6";
  if (s.startsWith("claude-sonnet")) return "Sonnet 4.6";
  if (s.startsWith("gpt-oss")) return "GPT-OSS 120B";
  return s;
}

export function getActiveConfig(atlas) {
  const s = (atlas.plugin && atlas.plugin.settings) || {};
  let model = String(s.model || "").trim();
  const rawCmd = String(s.command || "agy").trim() || "agy";
  if (!model) {
    const mm = rawCmd.match(/--model\s+(\S+)/);
    model = mm ? mm[1] : "default";
  }
  const mode = String(s.default_mode || "interactive").trim();
  const effort = String(s.default_effort || "default").trim();
  return { model, mode, effort, rawCmd };
}

export function buildCommandLine(rawCmd, model, mode, effort) {
  const words = String(rawCmd || "agy").trim().split(/\s+/).filter(Boolean);
  const bin = words[0] || "agy";
  const kept = [];
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (w === "--model" || w === "-m" || w === "--mode" || w === "--effort") {
      i++;
      continue;
    }
    if (/^--(model|mode|effort)=/.test(w)) continue;
    kept.push(w);
  }
  if (model && model !== "default" && model !== "inherit") {
    kept.push("--model", model);
  }
  if (mode && mode !== "interactive") {
    kept.push("--mode", mode);
  }
  if (effort && effort !== "default") {
    kept.push("--effort", effort);
  }
  return [bin, ...kept].join(" ");
}

export async function applyModelSwitch(atlas, patch) {
  const cur = getActiveConfig(atlas);
  const nextModel = patch.model !== undefined ? patch.model : cur.model;
  const nextMode = patch.mode !== undefined ? patch.mode : cur.mode;
  const nextEffort = patch.effort !== undefined ? patch.effort : cur.effort;
  const nextCmd = buildCommandLine(cur.rawCmd, nextModel, nextMode, nextEffort);
  await atlas.plugin.saveSettings({
    model: nextModel,
    default_mode: nextMode,
    default_effort: nextEffort,
    command: nextCmd,
  });
  return { model: nextModel, mode: nextMode, effort: nextEffort, command: nextCmd };
}

export async function openAgyTerminal(atlas, extraArgs = [], title = "Antigravity") {
  const shell = await atlas.terminal.shell();
  const cur = getActiveConfig(atlas);
  const baseCmd = buildCommandLine(cur.rawCmd, cur.model, cur.mode, cur.effort);
  const parts = baseCmd.split(/\s+/).filter(Boolean);
  const prog = parts[0] || "agy";
  const fullArgs = [...parts.slice(1), ...extraArgs];
  const line = fullArgs.length ? atlas.terminal.line(shell, prog, ...fullArgs) : prog;
  await atlas.terminal.open(line, title);
}

export function mountSwitcherWidget(host, atlas, opts = {}) {
  const compact = Boolean(opts.compact);
  const onClose = typeof opts.onClose === "function" ? opts.onClose : null;
  let disposed = false;
  let saving = false;
  let loadingLive = true;
  let familyFilter = "All";
  let models = FALLBACK_MODELS;
  let live = { liveRootCount: 0, liveSubagentCount: 0, totalSubagentCount: 0, roots: [], subagents: [] };
  let cur = getActiveConfig(atlas);

  const style = document.createElement("style");
  style.textContent = `
    .agw-box { display: flex; flex-direction: column; gap: 10px; color: var(--text); font-size: 12px; ${compact ? "padding: 10px 12px; max-height: 500px; overflow: auto;" : ""} }
    .agw-sec { border: 1px solid var(--border-strong, var(--border)); border-radius: 8px; padding: 10px 12px; background: var(--bg-elevated, var(--bg)); display: flex; flex-direction: column; gap: 8px; }
    .agw-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
    .agw-h { font-weight: 650; font-size: 12.5px; display: inline-flex; align-items: center; gap: 6px; }
    .agw-fams { display: flex; gap: 4px; flex-wrap: wrap; }
    .agw-fam { padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border); background: transparent; color: var(--text-muted); font-size: 11px; cursor: pointer; }
    .agw-fam.on { border-color: var(--accent); color: var(--accent); font-weight: 600; background: var(--bg-hover); }
    .agw-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(158px, 1fr)); gap: 5px; max-height: ${compact ? "148px" : "210px"}; overflow: auto; }
    .agw-chip { padding: 5px 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: 11.5px; text-align: left; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 4px; }
    .agw-chip:hover { background: var(--bg-hover); }
    .agw-chip.active { border-color: var(--accent); background: var(--accent); color: var(--bg); font-weight: 600; }
    .agw-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .agw-sel { padding: 3px 7px; border-radius: 5px; border: 1px solid var(--border-strong, var(--border)); background: var(--bg); color: var(--text); font-size: 11.5px; }
    .agw-btn { display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border-radius: 5px; border: 1px solid var(--border-strong, var(--border)); background: var(--bg); color: var(--text); font-size: 11.5px; cursor: pointer; }
    .agw-btn:hover { background: var(--bg-hover); }
    .agw-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--bg); font-weight: 600; }
    .agw-list { display: flex; flex-direction: column; gap: 5px; max-height: ${compact ? "165px" : "260px"}; overflow: auto; }
    .agw-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); }
    .agw-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-faint); flex: none; }
    .agw-dot.live { background: #2ea043; box-shadow: 0 0 0 2px rgba(46,160,67,0.22); }
    .agw-title { font-size: 11.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .agw-meta { font-size: 10.5px; color: var(--text-muted); display: flex; gap: 6px; flex-wrap: wrap; margin-top: 1px; }
    .agw-tag { font-size: 10px; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--border-strong, var(--border)); color: var(--text-muted); }
    .agw-tag.live { border-color: #2ea043; color: #2ea043; font-weight: 600; }
  `;

  const box = document.createElement("div");
  box.className = "agw-box";
  host.replaceChildren(style, box);

  async function refreshAll(forceModels = false) {
    if (disposed) return;
    loadingLive = true;
    render();
    try {
      const [mRes, lRes] = await Promise.all([
        atlas.helper.call("models", { refresh: forceModels }, { timeout: 12 }).catch(() => FALLBACK_MODELS),
        atlas.helper.call("liveStatus", {}, { timeout: 10 }).catch(() => null),
      ]);
      if (disposed) return;
      if (Array.isArray(mRes) && mRes.length) models = mRes;
      if (lRes && lRes.ok) live = lRes;
    } finally {
      loadingLive = false;
      cur = getActiveConfig(atlas);
      render();
    }
  }

  async function handleSwitch(patch) {
    if (saving || disposed) return;
    saving = true;
    cur = {
      ...cur,
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
      ...(patch.effort !== undefined ? { effort: patch.effort } : {}),
    };
    render();
    try {
      const next = await applyModelSwitch(atlas, patch);
      atlas.toast("Antigravity updated", `Active: ${shortModelName(next.model)} · ${next.mode}`, "success");
      if (compact && patch.model !== undefined && onClose) onClose();
    } catch (e) {
      atlas.toast("Could not save model", String((e && e.message) || e), "error");
    } finally {
      saving = false;
      if (!disposed) render();
    }
  }

  function render() {
    if (disposed) return;
    box.replaceChildren();

    // Section 1: Model & Mode Switcher
    const mSec = document.createElement("div");
    mSec.className = "agw-sec";
    const mTop = document.createElement("div");
    mTop.className = "agw-top";
    const mHead = document.createElement("span");
    mHead.className = "agw-h";
    mHead.textContent = `Model Switcher · ${shortModelName(cur.model)}`;

    const newBtn = document.createElement("button");
    newBtn.className = "agw-btn primary";
    newBtn.textContent = "+ New Session";
    newBtn.onclick = () => {
      void openAgyTerminal(atlas, [], `AGY · ${shortModelName(cur.model)}`);
      if (onClose) onClose();
    };
    mTop.append(mHead, newBtn);

    const fams = document.createElement("div");
    fams.className = "agw-fams";
    for (const f of ["All", "Carbon", "Argon", "Hydrogen", "Orchestrator", "Other"]) {
      const b = document.createElement("button");
      b.className = `agw-fam ${familyFilter === f ? "on" : ""}`;
      b.textContent = f;
      b.onclick = () => {
        familyFilter = f;
        render();
      };
      fams.append(b);
    }

    const grid = document.createElement("div");
    grid.className = "agw-grid";
    const shownModels = models.filter((m) => familyFilter === "All" || m.family === familyFilter || (familyFilter === "All" && m.family === "Default"));
    for (const m of shownModels) {
      const c = document.createElement("button");
      const isAct = cur.model === m.value || (m.value === "default" && (!cur.model || cur.model === "default"));
      c.className = `agw-chip ${isAct ? "active" : ""}`;
      c.title = m.value;
      const lbl = document.createElement("span");
      lbl.textContent = m.value === "default" ? "Default (Inherit)" : shortModelName(m.value);
      c.append(lbl);
      c.onclick = () => void handleSwitch({ model: m.value });
      grid.append(c);
    }

    const ctrlRow = document.createElement("div");
    ctrlRow.className = "agw-row";
    const modeSel = document.createElement("select");
    modeSel.className = "agw-sel";
    modeSel.title = "Execution mode";
    for (const md of ["interactive", "plan", "accept-edits", "auto"]) {
      const o = document.createElement("option");
      o.value = md;
      o.textContent = `Mode: ${md}`;
      o.selected = cur.mode === md;
      modeSel.append(o);
    }
    modeSel.onchange = () => void handleSwitch({ mode: modeSel.value });

    const effSel = document.createElement("select");
    effSel.className = "agw-sel";
    effSel.title = "Reasoning effort";
    for (const ef of ["default", "low", "medium", "high", "xhigh", "max"]) {
      const o = document.createElement("option");
      o.value = ef;
      o.textContent = `Effort: ${ef}`;
      o.selected = cur.effort === ef;
      effSel.append(o);
    }
    effSel.onchange = () => void handleSwitch({ effort: effSel.value });

    const contBtn = document.createElement("button");
    contBtn.className = "agw-btn";
    contBtn.textContent = "Resume Last";
    contBtn.onclick = () => {
      void openAgyTerminal(atlas, ["--continue"], "Antigravity (Resume)");
      if (onClose) onClose();
    };
    ctrlRow.append(modeSel, effSel, contBtn);
    if (compact) {
      const hubBtn = document.createElement("button");
      hubBtn.className = "agw-btn";
      hubBtn.textContent = "Hub…";
      hubBtn.onclick = () => {
        atlas.openView();
        if (onClose) onClose();
      };
      ctrlRow.append(hubBtn);
    }
    mSec.append(mTop, fams, grid, ctrlRow);

    // Section 2: Live Subagents & Active Conversations
    const lSec = document.createElement("div");
    lSec.className = "agw-sec";
    const lTop = document.createElement("div");
    lTop.className = "agw-top";
    const lHead = document.createElement("span");
    lHead.className = "agw-h";
    const liveBadge = document.createElement("span");
    const nLiveSub = live.liveSubagentCount || 0;
    const nLiveRoot = live.liveRootCount || 0;
    liveBadge.className = `agw-tag ${nLiveSub + nLiveRoot > 0 ? "live" : ""}`;
    liveBadge.textContent =
      nLiveSub > 0
        ? `${nLiveSub} live subagent${nLiveSub === 1 ? "" : "s"}`
        : nLiveRoot > 0
          ? `${nLiveRoot} active session${nLiveRoot === 1 ? "" : "s"}`
          : `${live.totalSubagentCount || 0} subagents logged`;
    lHead.append(document.createTextNode("Subagents & Sessions "), liveBadge);

    const refBtn = document.createElement("button");
    refBtn.className = "agw-btn";
    refBtn.disabled = loadingLive;
    refBtn.textContent = loadingLive ? "Syncing…" : "Refresh";
    refBtn.onclick = () => void refreshAll(false);
    lTop.append(lHead, refBtn);

    const list = document.createElement("div");
    list.className = "agw-list";

    const items = [
      ...(live.subagents || []).filter((s) => s.isLive).map((s) => ({ ...s, kind: "subagent" })),
      ...(live.roots || []).slice(0, compact ? 3 : 5).map((r) => ({ ...r, kind: "root" })),
      ...(live.subagents || []).filter((s) => !s.isLive).slice(0, compact ? 4 : 8).map((s) => ({ ...s, kind: "subagent" })),
    ];

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.style.color = "var(--text-muted)";
      empty.style.padding = "8px 4px";
      empty.textContent = loadingLive ? "Reading Antigravity conversations…" : "No Antigravity sessions recorded yet.";
      list.append(empty);
    } else {
      for (const it of items) {
        const row = document.createElement("div");
        row.className = "agw-item";
        const left = document.createElement("div");
        left.style.minWidth = "0";
        left.style.flex = "1";
        left.style.display = "flex";
        left.style.alignItems = "center";
        left.style.gap = "7px";

        const dot = document.createElement("span");
        dot.className = `agw-dot ${it.isLive ? "live" : ""}`;
        dot.title = it.isLive ? "Actively running" : "Idle / completed";

        const info = document.createElement("div");
        info.style.minWidth = "0";
        info.style.flex = "1";
        const t = document.createElement("div");
        t.className = "agw-title";
        t.textContent = `${it.kind === "subagent" ? "↳ " : ""}${it.title}`;
        const meta = document.createElement("div");
        meta.className = "agw-meta";
        const parts = [];
        parts.push(it.kind === "subagent" ? `Subagent (${it.agentName || "self"})` : "Session");
        if (it.model) parts.push(shortModelName(it.model));
        parts.push(`${it.steps || 0} steps`);
        if (it.childCount > 0) parts.push(`${it.childCount} subagent${it.childCount === 1 ? "" : "s"}`);
        meta.textContent = parts.join(" · ");
        info.append(t, meta);
        left.append(dot, info);

        const resBtn = document.createElement("button");
        resBtn.className = "agw-btn";
        resBtn.textContent = "Resume";
        resBtn.title = `Open conversation ${it.id} in Kandinsky terminal`;
        resBtn.onclick = () => {
          void openAgyTerminal(atlas, ["--conversation", it.id], `AGY · ${it.id.slice(0, 8)}`);
          if (onClose) onClose();
        };
        row.append(left, resBtn);
        list.append(row);
      }
    }

    lSec.append(lTop, list);
    box.append(mSec, lSec);
  }

  render();
  void refreshAll(false);
  const timer = setInterval(() => {
    if (!disposed) void refreshAll(false);
  }, 8000);

  return () => {
    disposed = true;
    clearInterval(timer);
  };
}
