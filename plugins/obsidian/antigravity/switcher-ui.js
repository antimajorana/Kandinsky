// Shared Model Switcher, Vault @specialist Selector & Live Subagent Monitor UI (switcher-ui.js)
// Synced bidirectionally with StatusBar.svelte via localStorage + CustomEvent("kandinsky:agy-config").

export const AGY_STORAGE_MODEL = "kandinsky.agy.model";
export const AGY_STORAGE_SLUG = "kandinsky.agy.modelSlug";
export const AGY_STORAGE_SPECIALIST = "kandinsky.agy.specialist";
export const AGY_CONFIG_EVENT = "kandinsky:agy-config";

export const PRIMARY_MODEL_PILLS = [
  { id: "gemini-4-carbon", slug: "gemini-4-carbon-high", label: "Gemini 4 Carbon", short: "Carbon", family: "Carbon" },
  { id: "gemini-4-argon", slug: "gemini-4-argon-high", label: "Gemini 4 Argon", short: "Argon", family: "Argon" },
  { id: "gemini-4-hydrogen", slug: "gemini-4-hydrogen-high", label: "Gemini 4 Hydrogen", short: "Hydrogen", family: "Hydrogen" },
  { id: "gemini-3-flash", slug: "gemini-3.8-flash-high", label: "Gemini 3 Flash", short: "Flash", family: "Flash" },
];

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
  { value: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)", family: "Flash" },
  { value: "gemini-3.8-flash-medium", label: "Gemini 3.8 Flash (Medium)", family: "Flash" },
  { value: "gemini-3.8-flash-low", label: "Gemini 3.8 Flash (Low)", family: "Flash" },
  { value: "gemini-pro-orchestrator", label: "Orchestrator (Carbon)", family: "Orchestrator" },
  { value: "gemini-pro-orchestrator-argon", label: "Orchestrator (Argon)", family: "Orchestrator" },
  { value: "claude-opus-4-6-thinking", label: "Claude Opus 4.6 (Thinking)", family: "Other" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", family: "Other" },
  { value: "gpt-oss-120b-medium", label: "GPT-OSS 120B (Medium)", family: "Other" },
];

export function normalizeSpecialist(raw) {
  const s = String(raw || "").trim();
  if (!s || s === "coordinator" || s === "none") return "";
  return s.startsWith("@") ? s : `@${s}`;
}

export function resolveModelPill(modelOrSlug) {
  const s = String(modelOrSlug || "").trim().toLowerCase();
  if (s.includes("argon")) return PRIMARY_MODEL_PILLS[1];
  if (s.includes("hydrogen")) return PRIMARY_MODEL_PILLS[2];
  if (s.includes("flash")) return PRIMARY_MODEL_PILLS[3];
  return PRIMARY_MODEL_PILLS[0];
}

export function resolveCliSlug(modelOrSlug) {
  const raw = String(modelOrSlug || "").trim();
  if (!raw || raw === "default" || raw === "inherit") return "gemini-4-carbon-high";
  const byPill = PRIMARY_MODEL_PILLS.find((p) => p.id === raw.toLowerCase() || p.short.toLowerCase() === raw.toLowerCase());
  if (byPill) return byPill.slug;
  if (raw === "gemini-3-flash") return "gemini-3.8-flash-high";
  return raw;
}

export function shortModelName(slug) {
  const s = String(slug || "").trim();
  if (!s || s === "default" || s === "inherit") return "Carbon";
  const exactPill = PRIMARY_MODEL_PILLS.find((p) => p.id === s || p.slug === s);
  if (exactPill && (s === exactPill.id || s.endsWith("-high"))) return exactPill.short;
  const m = s.match(/^gemini-4-(carbon|argon|hydrogen)-(xhigh|high|medium|low)$/i);
  if (m) {
    const fam = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    const tier = m[2].toLowerCase() === "medium" ? "Med" : m[2].toLowerCase() === "xhigh" ? "XHigh" : m[2][0].toUpperCase() + m[2].slice(1).toLowerCase();
    return tier === "High" ? fam : `${fam} (${tier})`;
  }
  if (s === "gemini-pro-orchestrator") return "Orch (Carbon)";
  if (s === "gemini-pro-orchestrator-argon") return "Orch (Argon)";
  if (s.startsWith("gemini-3.8-flash-") || s === "gemini-3-flash") {
    const tier = s.split("-").pop();
    return !tier || tier === "high" || tier === "flash" ? "Flash" : `Flash (${tier})`;
  }
  if (s.startsWith("claude-opus")) return "Opus 4.6";
  if (s.startsWith("claude-sonnet")) return "Sonnet 4.6";
  if (s.startsWith("gpt-oss")) return "GPT-OSS 120B";
  return s;
}

export function readStoredAgyState() {
  try {
    const storedModel = localStorage.getItem(AGY_STORAGE_MODEL) || "";
    const storedSlug = localStorage.getItem(AGY_STORAGE_SLUG) || "";
    const rawSpec = localStorage.getItem(AGY_STORAGE_SPECIALIST);
    const hasStoredSpecialist = rawSpec !== null;
    const pill = resolveModelPill(storedModel || storedSlug);
    const modelSlug = storedSlug ? resolveCliSlug(storedSlug) : pill.slug;
    return {
      pillId: pill.id,
      model: modelSlug,
      specialist: normalizeSpecialist(rawSpec || ""),
      hasStoredSpecialist,
    };
  } catch {
    return { pillId: "gemini-4-carbon", model: "gemini-4-carbon-high", specialist: "", hasStoredSpecialist: false };
  }
}

export function persistAndBroadcastAgyState(next, source = "plugin") {
  const pill = resolveModelPill(next.pillId || next.model);
  const slug = resolveCliSlug(next.model || pill.slug);
  const specialist = normalizeSpecialist(next.specialist);
  try {
    localStorage.setItem(AGY_STORAGE_MODEL, pill.id);
    localStorage.setItem(AGY_STORAGE_SLUG, slug);
    localStorage.setItem(AGY_STORAGE_SPECIALIST, specialist);
  } catch {}
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(AGY_CONFIG_EVENT, {
        detail: { model: pill.id, modelSlug: slug, specialist, source },
      }),
    );
  }
  return { pillId: pill.id, model: slug, specialist };
}

export function getActiveConfig(kandinsky) {
  const s = (kandinsky && kandinsky.plugin && kandinsky.plugin.settings) || {};
  const stored = readStoredAgyState();
  let model = stored.model || String(s.model || "").trim();
  const rawCmd = String(s.command || "agy").trim() || "agy";
  if (!model || model === "default") {
    const mm = rawCmd.match(/--model\s+(\S+)/);
    model = mm ? mm[1] : stored.model || "gemini-4-carbon-high";
  }
  const pill = resolveModelPill(model);
  const hasStoredSpec = Boolean(stored.hasStoredSpecialist) && typeof stored.specialist === "string";
  const specialist = hasStoredSpec ? stored.specialist : normalizeSpecialist(s.specialist || "");
  const mode = String(s.default_mode || "interactive").trim();
  const effort = String(s.default_effort || "default").trim();
  return { pillId: pill.id, model: resolveCliSlug(model), specialist, mode, effort, rawCmd };
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
  const slug = resolveCliSlug(model);
  if (slug && slug !== "default" && slug !== "inherit") {
    kept.push("--model", slug);
  }
  if (mode && mode !== "interactive") {
    kept.push("--mode", mode);
  }
  if (effort && effort !== "default") {
    kept.push("--effort", effort);
  }
  return [bin, ...kept].join(" ");
}

export async function applyModelSwitch(kandinsky, patch, source = "plugin") {
  const cur = getActiveConfig(kandinsky);
  const nextModel = patch.model !== undefined ? resolveCliSlug(patch.model) : cur.model;
  const nextSpecialist = patch.specialist !== undefined ? normalizeSpecialist(patch.specialist) : cur.specialist;
  const nextMode = patch.mode !== undefined ? patch.mode : cur.mode;
  const nextEffort = patch.effort !== undefined ? patch.effort : cur.effort;
  const nextCmd = buildCommandLine(cur.rawCmd, nextModel, nextMode, nextEffort);
  const synced = persistAndBroadcastAgyState(
    { pillId: patch.pillId || resolveModelPill(nextModel).id, model: nextModel, specialist: nextSpecialist },
    source,
  );
  if (kandinsky && kandinsky.plugin && typeof kandinsky.plugin.saveSettings === "function") {
    await kandinsky.plugin.saveSettings({
      model: synced.model,
      specialist: synced.specialist,
      default_mode: nextMode,
      default_effort: nextEffort,
      command: nextCmd,
    });
  }
  return { ...synced, mode: nextMode, effort: nextEffort, command: nextCmd };
}

export async function openAgyTerminal(kandinsky, extraArgs = [], customTitle = "") {
  const shell = await kandinsky.terminal.shell();
  const cur = getActiveConfig(kandinsky);
  const baseCmd = buildCommandLine(cur.rawCmd, cur.model, cur.mode, cur.effort);
  const parts = baseCmd.split(/\s+/).filter(Boolean);
  const prog = parts[0] || "agy";
  const fullArgs = [...parts.slice(1), ...extraArgs];
  const line = fullArgs.length ? kandinsky.terminal.line(shell, prog, ...fullArgs) : prog;
  const title = customTitle || (cur.specialist ? `agy · ${cur.specialist}` : "Antigravity");
  await kandinsky.terminal.open(line, title);
}

function parseSpecialistFrontmatterClient(raw, stem) {
  const text = String(raw || "");
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fields = {};
  if (fm) {
    let curKey = "";
    for (const ln of fm[1].split(/\r?\n/)) {
      const kv = ln.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
      if (kv) {
        curKey = kv[1];
        const rest = kv[2].trim();
        fields[curKey] = rest === ">" || rest === "|" ? "" : rest;
      } else if (curKey && /^\s+/.test(ln)) {
        fields[curKey] = `${fields[curKey] || ""} ${ln.trim()}`.trim();
      } else {
        curKey = "";
      }
    }
  }
  const unq = (v) => String(v || "").trim().replace(/^["']|["']$/g, "").replace(/\\"/g, '"').replace(/\s+/g, " ").trim();
  const id = unq(fields.name || stem).replace(/^@+/, "") || stem;
  if (!id) return null;
  const title =
    unq(fields.title || "") ||
    id.split(/[-_]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  return { id, handle: `@${id}`, title, description: unq(fields.description || "") };
}

export async function loadVaultSpecialists(kandinsky, force = false) {
  try {
    if (kandinsky && typeof kandinsky.exists === "function" && typeof kandinsky.list === "function") {
      const hasDir = await kandinsky.exists(".agents/agents");
      if (!hasDir) return [];
      const entries = await kandinsky.list(".agents/agents");
      const mdEntries = (Array.isArray(entries) ? entries : []).filter((e) => !e.dir && /\.md$/i.test(e.name));
      if (mdEntries.length > 0) {
        const parsed = await Promise.all(
          mdEntries.map(async (e) => {
            try {
              const txt = await kandinsky.readText(e.path);
              return parseSpecialistFrontmatterClient(txt, e.name.replace(/\.md$/i, ""));
            } catch {
              return null;
            }
          }),
        );
        return parsed.filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
      }
    }
  } catch {}
  try {
    const res = await kandinsky.helper.call("listVaultSpecialists", { refresh: force }, { timeout: 8 });
    if (Array.isArray(res)) return res;
  } catch {}
  return [];
}

export function mountSwitcherWidget(host, kandinsky, opts = {}) {
  const compact = Boolean(opts.compact);
  const onClose = typeof opts.onClose === "function" ? opts.onClose : null;
  const instanceId = `switcher-${Math.random().toString(36).slice(2, 8)}`;
  let disposed = false;
  let saving = false;
  let loadingLive = true;
  let showAdvancedTiers = false;
  let specFilter = "";
  let models = FALLBACK_MODELS;
  let specialists = [];
  let live = { liveRootCount: 0, liveSubagentCount: 0, totalSubagentCount: 0, roots: [], subagents: [] };
  let cur = getActiveConfig(kandinsky);

  const style = document.createElement("style");
  style.textContent = `
    .agw-box { display: flex; flex-direction: column; gap: 12px; color: var(--text); font-size: 12px; ${compact ? "padding: 8px 10px; max-height: 520px; overflow: auto;" : ""} }
    .agw-sec { border: 1px solid var(--border-strong, var(--border)); border-radius: 10px; padding: 12px 14px; background: var(--bg-elev, var(--bg)); display: flex; flex-direction: column; gap: 9px; }
    .agw-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
    .agw-h { font-weight: 650; font-size: 12.5px; color: var(--heading, var(--text)); display: inline-flex; align-items: center; gap: 6px; }
    .agw-pills { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
    .agw-pill { padding: 6px 9px; border-radius: 7px; border: 1px solid var(--border-strong, var(--border)); background: var(--bg); color: var(--text); font-size: 11.5px; font-weight: 500; text-align: left; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 5px; transition: background .12s, border-color .12s; }
    .agw-pill:hover { background: var(--bg-hover); }
    .agw-pill.active { border-color: var(--accent); background: var(--accent-soft, rgba(125,151,244,0.14)); color: var(--accent); font-weight: 650; }
    .agw-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(154px, 1fr)); gap: 5px; max-height: 150px; overflow: auto; padding-top: 2px; }
    .agw-chip { padding: 4px 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--text-muted); font-size: 11px; text-align: left; cursor: pointer; }
    .agw-chip:hover { background: var(--bg-hover); color: var(--text); }
    .agw-chip.active { border-color: var(--accent); color: var(--accent); font-weight: 600; background: var(--accent-soft, rgba(125,151,244,0.14)); }
    .agw-search { width: 100%; padding: 5px 9px; border-radius: 6px; border: 1px solid var(--border-strong, var(--border)); background: var(--bg); color: var(--text); font-size: 11.5px; outline: none; }
    .agw-search:focus { border-color: var(--accent); }
    .agw-specs { display: flex; flex-direction: column; gap: 3px; max-height: 210px; overflow: auto; }
    .agw-spec { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 6px; border: 1px solid transparent; background: transparent; color: var(--text); text-align: left; cursor: pointer; min-width: 0; }
    .agw-spec:hover { background: var(--bg-hover); }
    .agw-spec.active { border-color: var(--accent); background: var(--accent-soft, rgba(125,151,244,0.13)); }
    .agw-handle { font-family: var(--font-mono, monospace); font-size: 11.5px; font-weight: 600; color: var(--accent); flex: none; }
    .agw-sdesc { font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
    .agw-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .agw-sel { padding: 3px 7px; border-radius: 5px; border: 1px solid var(--border-strong, var(--border)); background: var(--bg); color: var(--text); font-size: 11.5px; }
    .agw-btn { display: inline-flex; align-items: center; gap: 5px; padding: 5px 10px; border-radius: 6px; border: 1px solid var(--border-strong, var(--border)); background: var(--bg); color: var(--text); font-size: 11.5px; cursor: pointer; }
    .agw-btn:hover { background: var(--bg-hover); }
    .agw-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg, var(--bg)); font-weight: 600; }
    .agw-btn:disabled { opacity: 0.5; cursor: default; }
    .agw-list { display: flex; flex-direction: column; gap: 5px; max-height: ${compact ? "160px" : "240px"}; overflow: auto; }
    .agw-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); }
    .agw-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-faint); flex: none; }
    .agw-dot.live { background: var(--green, #3ca395); box-shadow: 0 0 0 2px color-mix(in srgb, var(--green, #3ca395) 22%, transparent); }
    .agw-title { font-size: 11.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .agw-meta { font-size: 10.5px; color: var(--text-muted); display: flex; gap: 6px; flex-wrap: wrap; margin-top: 1px; }
    .agw-tag { font-size: 10px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--border-strong, var(--border)); color: var(--text-muted); }
    .agw-tag.live { border-color: var(--green, #3ca395); color: var(--green, #3ca395); font-weight: 600; }
  `;

  const box = document.createElement("div");
  box.className = "agw-box";
  host.replaceChildren(style, box);

  function currentSelectionRef() {
    const ctx = typeof kandinsky.context === "function" ? kandinsky.context() : null;
    const sel = ctx && ctx.selection && ctx.selection.text ? ctx.selection : null;
    const path = (sel && sel.path) || (ctx && ctx.active && ctx.active.path) || "";
    if (!path) return null;
    const base = path.split("/").pop() || path;
    const lines = sel && sel.path === path ? { from: sel.from_line, to: sel.to_line } : null;
    const ref = lines ? `@${path}#L${lines.from}-${lines.to} ` : `@${path} `;
    const badge = lines ? `@${base}#L${lines.from}-${lines.to}` : `@${base}`;
    const effSpec = specialists.length > 0 && specialists.some((s) => s.handle === cur.specialist) ? cur.specialist : "";
    return { path, prompt: `${effSpec ? `${effSpec} ` : ""}${ref}`, badge, effSpec };
  }

  async function refreshAll(force = false) {
    if (disposed) return;
    loadingLive = true;
    render();
    try {
      const [mRes, lRes, sRes] = await Promise.all([
        kandinsky.helper.call("models", { refresh: force }, { timeout: 12 }).catch(() => FALLBACK_MODELS),
        kandinsky.helper.call("liveStatus", {}, { timeout: 10 }).catch(() => null),
        loadVaultSpecialists(kandinsky, force),
      ]);
      if (disposed) return;
      if (Array.isArray(mRes) && mRes.length) models = mRes;
      if (lRes && lRes.ok) live = lRes;
      if (Array.isArray(sRes)) specialists = sRes;
    } finally {
      loadingLive = false;
      cur = getActiveConfig(kandinsky);
      render();
    }
  }

  async function handleSwitch(patch) {
    if (saving || disposed) return;
    saving = true;
    cur = {
      ...cur,
      ...(patch.pillId !== undefined ? { pillId: patch.pillId } : {}),
      ...(patch.model !== undefined ? { model: resolveCliSlug(patch.model), pillId: resolveModelPill(patch.model).id } : {}),
      ...(patch.specialist !== undefined ? { specialist: normalizeSpecialist(patch.specialist) } : {}),
      ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
      ...(patch.effort !== undefined ? { effort: patch.effort } : {}),
    };
    render();
    try {
      await applyModelSwitch(kandinsky, patch, instanceId);
    } catch (e) {
      kandinsky.toast("Could not save Antigravity config", String((e && e.message) || e), "error");
    } finally {
      saving = false;
      if (!disposed) render();
    }
  }

  function render() {
    if (disposed) return;
    box.replaceChildren();
    const effSpec = specialists.length > 0 && specialists.some((s) => s.handle === cur.specialist) ? cur.specialist : "";
    const activePill = resolveModelPill(cur.pillId || cur.model);

    // Section 1: Model Picker Pills & Launch/Handoff
    const mSec = document.createElement("div");
    mSec.className = "agw-sec";
    const mTop = document.createElement("div");
    mTop.className = "agw-top";
    const mHead = document.createElement("span");
    mHead.className = "agw-h";
    mHead.textContent = `Model & Handoff · ${effSpec ? `${effSpec} · ` : ""}${shortModelName(cur.model)}`;

    const actGroup = document.createElement("div");
    actGroup.className = "agw-row";
    const launchBtn = document.createElement("button");
    launchBtn.className = "agw-btn primary";
    launchBtn.textContent = effSpec ? `Launch agy (${effSpec})` : "Launch agy in Vault";
    launchBtn.onclick = () => {
      void openAgyTerminal(kandinsky, [], effSpec ? `agy · ${effSpec}` : "Antigravity");
      if (onClose) onClose();
    };
    const selTarget = currentSelectionRef();
    const sendBtn = document.createElement("button");
    sendBtn.className = "agw-btn";
    sendBtn.disabled = !selTarget;
    sendBtn.textContent = selTarget
      ? `Send ${selTarget.badge} → ${selTarget.effSpec || "agy"}`
      : "No active note open";
    sendBtn.onclick = async () => {
      const t = currentSelectionRef();
      if (!t) return;
      const sendBus = window.__kandinskySendPassageToAgent;
      if (typeof sendBus === "function") {
        await sendBus({ target: "antigravity", prompt: t.prompt, path: t.path });
      } else {
        await openAgyTerminal(kandinsky, ["-i", t.prompt], t.effSpec ? `agy · ${t.effSpec}` : "Antigravity");
      }
      if (onClose) onClose();
    };
    actGroup.append(launchBtn, sendBtn);
    mTop.append(mHead, actGroup);

    const pills = document.createElement("div");
    pills.className = "agw-pills";
    for (const p of PRIMARY_MODEL_PILLS) {
      const b = document.createElement("button");
      b.className = `agw-pill ${activePill.id === p.id ? "active" : ""}`;
      b.title = `${p.label} (${p.slug})`;
      const s1 = document.createElement("span");
      s1.textContent = p.label;
      const s2 = document.createElement("span");
      s2.style.fontSize = "10.5px";
      s2.style.opacity = "0.8";
      s2.textContent = activePill.id === p.id ? "●" : "";
      b.append(s1, s2);
      b.onclick = () => void handleSwitch({ pillId: p.id, model: p.slug });
      pills.append(b);
    }

    const ctrlRow = document.createElement("div");
    ctrlRow.className = "agw-row";
    const modeSel = document.createElement("select");
    modeSel.className = "agw-sel";
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
    for (const ef of ["default", "low", "medium", "high", "xhigh", "max"]) {
      const o = document.createElement("option");
      o.value = ef;
      o.textContent = `Effort: ${ef}`;
      o.selected = cur.effort === ef;
      effSel.append(o);
    }
    effSel.onchange = () => void handleSwitch({ effort: effSel.value });

    const advBtn = document.createElement("button");
    advBtn.className = "agw-btn";
    advBtn.textContent = showAdvancedTiers ? "Hide CLI tiers ▴" : "CLI tiers ▾";
    advBtn.onclick = () => { showAdvancedTiers = !showAdvancedTiers; render(); };

    const contBtn = document.createElement("button");
    contBtn.className = "agw-btn";
    contBtn.textContent = "Resume Last";
    contBtn.onclick = () => { void openAgyTerminal(kandinsky, ["--continue"], "Antigravity (Resume)"); if (onClose) onClose(); };
    ctrlRow.append(modeSel, effSel, advBtn, contBtn);
    mSec.append(mTop, pills, ctrlRow);

    if (showAdvancedTiers) {
      const grid = document.createElement("div");
      grid.className = "agw-grid";
      for (const m of models) {
        const c = document.createElement("button");
        const isAct = cur.model === m.value;
        c.className = `agw-chip ${isAct ? "active" : ""}`;
        c.title = m.value;
        c.textContent = m.value === "default" ? "Default (Inherit)" : shortModelName(m.value);
        c.onclick = () => void handleSwitch({ model: m.value });
        grid.append(c);
      }
      mSec.append(grid);
    }
    box.append(mSec);

    // Section 2: Vault @specialist Picker (when vault has .agents/agents/*.md)
    if (specialists.length > 0) {
      const sSec = document.createElement("div");
      sSec.className = "agw-sec";
      const sTop = document.createElement("div");
      sTop.className = "agw-top";
      const sHead = document.createElement("span");
      sHead.className = "agw-h";
      sHead.textContent = `Vault @specialists (${specialists.length})`;
      sTop.append(sHead);
      sSec.append(sTop);

      if (specialists.length > 6) {
        const inp = document.createElement("input");
        inp.type = "search";
        inp.className = "agw-search";
        inp.placeholder = `Filter ${specialists.length} vault @specialists…`;
        inp.value = specFilter;
        inp.oninput = () => { specFilter = inp.value; renderSpecsList(sList); };
        sSec.append(inp);
      }

      const sList = document.createElement("div");
      sList.className = "agw-specs";
      renderSpecsList(sList);
      sSec.append(sList);
      box.append(sSec);
    }

    // Section 3: Live Subagents & Active Conversations
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
        left.style.cssText = "min-width:0;flex:1;display:flex;align-items:center;gap:7px;";
        const dot = document.createElement("span");
        dot.className = `agw-dot ${it.isLive ? "live" : ""}`;
        const info = document.createElement("div");
        info.style.cssText = "min-width:0;flex:1;";
        const t = document.createElement("div");
        t.className = "agw-title";
        t.textContent = `${it.kind === "subagent" ? "↳ " : ""}${it.title}`;
        const meta = document.createElement("div");
        meta.className = "agw-meta";
        const parts = [it.kind === "subagent" ? `Subagent (${it.agentName || "self"})` : "Session"];
        if (it.model) parts.push(shortModelName(it.model));
        parts.push(`${it.steps || 0} steps`);
        if (it.childCount > 0) parts.push(`${it.childCount} subagent${it.childCount === 1 ? "" : "s"}`);
        meta.textContent = parts.join(" · ");
        info.append(t, meta);
        left.append(dot, info);

        const resBtn = document.createElement("button");
        resBtn.className = "agw-btn";
        resBtn.textContent = "Resume";
        resBtn.onclick = () => {
          void openAgyTerminal(kandinsky, ["--conversation", it.id], `AGY · ${it.id.slice(0, 8)}`);
          if (onClose) onClose();
        };
        row.append(left, resBtn);
        list.append(row);
      }
    }
    lSec.append(lTop, list);
    box.append(lSec);
  }

  function renderSpecsList(container) {
    container.replaceChildren();
    const q = specFilter.trim().toLowerCase();
    const effSpec = specialists.some((s) => s.handle === cur.specialist) ? cur.specialist : "";

    if (!q || "coordinator (no @specialist)".includes(q)) {
      const coord = document.createElement("button");
      coord.className = `agw-spec ${!effSpec ? "active" : ""}`;
      const h = document.createElement("span");
      h.className = "agw-handle";
      h.textContent = "● Coordinator";
      const d = document.createElement("span");
      d.className = "agw-sdesc";
      d.textContent = "Coordinator (no @specialist) — direct vault session";
      coord.append(h, d);
      coord.onclick = () => void handleSwitch({ specialist: "" });
      container.append(coord);
    }

    const filtered = specialists.filter(
      (s) => !q || s.handle.toLowerCase().includes(q) || s.title.toLowerCase().includes(q) || (s.description || "").toLowerCase().includes(q),
    );
    for (const sp of filtered) {
      const row = document.createElement("button");
      row.className = `agw-spec ${effSpec === sp.handle ? "active" : ""}`;
      row.title = sp.description || sp.title;
      const h = document.createElement("span");
      h.className = "agw-handle";
      h.textContent = sp.handle;
      const d = document.createElement("span");
      d.className = "agw-sdesc";
      d.textContent = sp.description || sp.title;
      row.append(h, d);
      row.onclick = () => void handleSwitch({ specialist: sp.handle });
      container.append(row);
    }
  }

  const onConfigSync = (ev) => {
    const detail = ev && ev.detail;
    if (!detail || detail.source === instanceId) return;
    cur = getActiveConfig(kandinsky);
    render();
  };
  if (typeof window !== "undefined") window.addEventListener(AGY_CONFIG_EVENT, onConfigSync);
  const offCtx = typeof kandinsky.onContext === "function" ? kandinsky.onContext(() => { if (!disposed) render(); }) : null;

  render();
  void refreshAll(false);
  const timer = setInterval(() => { if (!disposed) void refreshAll(false); }, 10000);

  return () => {
    disposed = true;
    clearInterval(timer);
    if (typeof window !== "undefined") window.removeEventListener(AGY_CONFIG_EVENT, onConfigSync);
    if (typeof offCtx === "function") offCtx();
  };
}
