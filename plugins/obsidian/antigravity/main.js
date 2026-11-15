// Antigravity agent integration (main.js): live status-bar model switcher & subagent monitor, palette commands, and context-menu handoff.

import {
  FALLBACK_MODELS,
  applyModelSwitch,
  getActiveConfig,
  mountSwitcherWidget,
  openAgyTerminal,
  shortModelName,
} from "./switcher-ui.js";

function formatRef(path, selectionText) {
  if (!path) return selectionText ? `${selectionText}\n` : "";
  if (selectionText) return `@${path} — "${selectionText.replace(/\s+/g, " ").slice(0, 200)}" `;
  return `@${path} `;
}

export function register(atlas) {
  const s = (atlas.plugin && atlas.plugin.settings) || {};
  let cell = null;
  let pollTimer = null;

  async function syncStatusCell() {
    if (!cell) return;
    const cur = getActiveConfig(atlas);
    const shortM = shortModelName(cur.model);
    try {
      const live = await atlas.helper.call("liveStatus", {}, { timeout: 8 });
      if (!cell || !live || !live.ok) {
        if (cell) cell.set(`AGY · ${shortM}`, `Antigravity model: ${cur.model} — click to switch models or view subagents`);
        return;
      }
      const nSub = live.liveSubagentCount || 0;
      const nRoot = live.liveRootCount || 0;
      const text =
        nSub > 0
          ? `AGY · ${shortM} · ⚡ ${nSub} subagent${nSub === 1 ? "" : "s"}`
          : nRoot > 0
            ? `AGY · ${shortM} · ● ${nRoot} live`
            : `AGY · ${shortM}`;
      const title = `Google Antigravity (${cur.model}, mode: ${cur.mode}) — ${nRoot} active session(s), ${nSub} live subagent(s). Click to switch model or inspect subagents.`;
      cell.set(text, title);
    } catch {
      if (cell) cell.set(`AGY · ${shortM}`, "Google Antigravity — click to switch models or inspect subagents");
    }
  }

  if (s.status_bar !== false) {
    const cur = getActiveConfig(atlas);
    cell = atlas.shell.statusItem({
      id: "agy",
      text: `AGY · ${shortModelName(cur.model)}`,
      title: "Click to switch Antigravity model (Carbon / Argon / Hydrogen) & view live subagents",
      panelWidth: 440,
      panel: (host, close) => mountSwitcherWidget(host, atlas, { compact: true, onClose: close }),
      run: () => atlas.openView(),
    });
    void syncStatusCell();
    pollTimer = setInterval(() => void syncStatusCell(), 15000);
  }

  atlas.registerCommand({
    id: "switch-model",
    title: "Antigravity: Switch active model (Carbon / Argon / Hydrogen)…",
    run: () => {
      const cur = getActiveConfig(atlas);
      atlas.pick({
        placeholder: `Current model: ${shortModelName(cur.model)} — choose an Antigravity model…`,
        tag: "AGY Model",
        icon: "claude",
        items: async () => {
          let list = FALLBACK_MODELS;
          try {
            const fetched = await atlas.helper.call("models", { refresh: false }, { timeout: 10 });
            if (Array.isArray(fetched) && fetched.length) list = fetched;
          } catch {}
          return list.map((m) => ({
            value: m.value,
            title: m.label,
            detail: m.value === cur.model ? `${m.value} · Active` : m.value,
            section: m.family || "Models",
            icon: "claude",
          }));
        },
        onpick: async (val) => {
          const next = await applyModelSwitch(atlas, { model: val });
          atlas.toast("Switched Antigravity model", `Now using ${shortModelName(next.model)} (${next.command})`, "success");
        },
      });
    },
  });

  atlas.registerCommand({
    id: "new-session",
    title: "Antigravity: Start new terminal session",
    run: () => openAgyTerminal(atlas, [], "Antigravity"),
  });

  atlas.registerCommand({
    id: "continue-session",
    title: "Antigravity: Resume most recent conversation (--continue)",
    run: () => openAgyTerminal(atlas, ["--continue"], "Antigravity (Resume)"),
  });

  atlas.registerCommand({
    id: "plan-session",
    title: "Antigravity: Start session in Plan mode",
    run: () => openAgyTerminal(atlas, ["--mode", "plan"], "Antigravity (Plan)"),
  });

  atlas.registerCommand({
    id: "hub",
    title: "Antigravity: Open live subagent monitor, model switcher & MCP hub",
    run: () => atlas.openView(),
  });

  atlas.shell.menu("editor", (target) => {
    const sel = target && typeof target.selection === "string" ? target.selection.trim() : "";
    return [
      {
        label: sel ? "Ask Antigravity about selection" : "Open Antigravity on this note",
        icon: "claude",
        run: async () => {
          const prompt = formatRef(target?.path || "", sel);
          if (prompt) {
            try {
              await navigator.clipboard?.writeText(prompt);
            } catch {}
          }
          await openAgyTerminal(atlas, prompt ? ["-i", prompt] : [], "Antigravity");
        },
      },
    ];
  });

  atlas.shell.menu("file", (target) => {
    if (!target || target.dir || !target.path) return null;
    return [
      {
        label: "Open in Antigravity session",
        icon: "claude",
        run: () => openAgyTerminal(atlas, ["-i", `Inspect @${target.path}`], "Antigravity"),
      },
    ];
  });

  return () => {
    if (pollTimer) clearInterval(pollTimer);
    if (cell) cell.remove();
  };
}
