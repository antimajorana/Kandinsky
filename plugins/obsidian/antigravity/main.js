// Antigravity agent integration (main.js): model & vault @specialist sync with StatusBar.svelte,
// live subagent status broadcaster, palette commands, and @path#Lfrom-to selection handoff.

import {
  AGY_CONFIG_EVENT,
  FALLBACK_MODELS,
  applyModelSwitch,
  buildCommandLine,
  getActiveConfig,
  loadVaultSpecialists,
  normalizeSpecialist,
  openAgyTerminal,
  persistAndBroadcastAgyState,
  reconcileStoredSpecialist,
  resolveCliSlug,
  shortModelName,
} from "./switcher-ui.js";

function formatRef(path, selectionText, specialist, lines) {
  const prefix = specialist ? `${specialist} ` : "";
  if (!path) return selectionText ? `${prefix}${selectionText}\n` : prefix;
  if (lines && lines.from && lines.to) return `${prefix}@${path}#L${lines.from}-${lines.to} `;
  if (selectionText) return `${prefix}@${path} — "${selectionText.replace(/\s+/g, " ").slice(0, 200)}" `;
  return `${prefix}@${path} `;
}

export function register(kandinsky) {
  const s = (kandinsky.plugin && kandinsky.plugin.settings) || {};
  let pollTimer = null;
  let disposed = false;

  // Ensure initial localStorage & plugin settings stay synchronized: a changed @specialist setting replaces the cache
  reconcileStoredSpecialist(s);
  const initial = getActiveConfig(kandinsky);
  persistAndBroadcastAgyState(
    { pillId: initial.pillId, model: initial.model, specialist: initial.specialist },
    "main-init",
  );

  // Sync changes coming from StatusBar.svelte popover into plugin settings
  const onConfigEvent = (ev) => {
    if (disposed) return;
    const d = ev && ev.detail;
    // the pane (source "switcher-…") saves its own picks, as the palette commands do
    if (!d || d.source === "plugin" || d.source === "main-init" || String(d.source || "").startsWith("switcher-")) return;
    const cur = getActiveConfig(kandinsky);
    const nextModel = resolveCliSlug(d.modelSlug || d.model || cur.model);
    const nextSpec = normalizeSpecialist(d.specialist !== undefined ? d.specialist : cur.specialist);
    const nextCmd = buildCommandLine(cur.rawCmd, nextModel, cur.mode, cur.effort);
    if (kandinsky.plugin && typeof kandinsky.plugin.saveSettings === "function") {
      void kandinsky.plugin
        .saveSettings({
          model: nextModel,
          specialist: nextSpec,
          default_mode: cur.mode,
          default_effort: cur.effort,
          command: nextCmd,
        })
        // the pick stays in localStorage (it outranks the unchanged setting), so only the save is reported
        .catch((e) => kandinsky.toast("Could not save Antigravity config", String((e && e.message) || e), "error"));
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener(AGY_CONFIG_EVENT, onConfigEvent);
  }

  async function pollLiveStatus() {
    if (disposed) return;
    try {
      const live = await kandinsky.helper.call("liveStatus", {}, { timeout: 8 });
      if (!disposed && live && live.ok && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("kandinsky:agy-live", { detail: live }));
      }
    } catch {}
  }

  if (s.status_bar !== false) {
    void pollLiveStatus();
    pollTimer = setInterval(() => void pollLiveStatus(), 15000);
  }

  kandinsky.registerCommand({
    id: "switch-model",
    title: "Antigravity: Switch active model (Carbon / Argon / Hydrogen / Flash)…",
    run: () => {
      const cur = getActiveConfig(kandinsky);
      kandinsky.pick({
        placeholder: `Current model: ${shortModelName(cur.model)} — choose an Antigravity model…`,
        tag: "AGY Model",
        icon: "claude",
        items: async () => {
          let list = FALLBACK_MODELS;
          try {
            const fetched = await kandinsky.helper.call("models", { refresh: false }, { timeout: 10 });
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
          let next;
          try {
            next = await applyModelSwitch(kandinsky, { model: val }, "plugin");
          } catch (e) {
            kandinsky.toast("Could not save Antigravity config", String((e && e.message) || e), "error");
            return;
          }
          kandinsky.toast("Switched Antigravity model", `Now using ${shortModelName(next.model)} (${next.command})`, "success");
        },
      });
    },
  });

  kandinsky.registerCommand({
    id: "switch-specialist",
    title: "Antigravity: Switch vault @specialist (.agents/agents)…",
    run: () => {
      const cur = getActiveConfig(kandinsky);
      kandinsky.pick({
        placeholder: cur.specialist
          ? `Active specialist: ${cur.specialist} — choose a vault @specialist…`
          : "Coordinator active — choose a vault @specialist…",
        tag: "@specialist",
        icon: "claude",
        items: async () => {
          const specs = await loadVaultSpecialists(kandinsky, false);
          return [
            {
              value: "",
              title: "Coordinator (no @specialist)",
              detail: !cur.specialist ? "Active · Direct vault coordinator" : "Direct vault coordinator",
              section: "Coordinator",
              icon: "claude",
            },
            ...specs.map((sp) => ({
              value: sp.handle,
              title: `${sp.handle} · ${sp.title}`,
              detail: sp.description || sp.handle,
              section: "Vault @specialists",
              icon: "claude",
            })),
          ];
        },
        onpick: async (val) => {
          let next;
          try {
            next = await applyModelSwitch(kandinsky, { specialist: val }, "plugin");
          } catch (e) {
            kandinsky.toast("Could not save Antigravity config", String((e && e.message) || e), "error");
            return;
          }
          kandinsky.toast(
            "Updated Antigravity specialist",
            next.specialist ? `Active specialist: ${next.specialist}` : "Coordinator (no @specialist)",
            "success",
          );
        },
      });
    },
  });

  kandinsky.registerCommand({
    id: "new-session",
    title: "Antigravity: Start new terminal session",
    run: () => openAgyTerminal(kandinsky, []),
  });

  kandinsky.registerCommand({
    id: "continue-session",
    title: "Antigravity: Resume most recent conversation (--continue)",
    run: () => openAgyTerminal(kandinsky, ["--continue"], "Antigravity (Resume)"),
  });

  kandinsky.registerCommand({
    id: "plan-session",
    title: "Antigravity: Start session in Plan mode",
    run: () => openAgyTerminal(kandinsky, ["--mode", "plan"], "Antigravity (Plan)"),
  });

  kandinsky.registerCommand({
    id: "hub",
    title: "Antigravity: Open live subagent monitor, model switcher & MCP hub",
    run: () => kandinsky.openView(),
  });

  kandinsky.shell.menu("editor", (target) => {
    const sel = target && typeof target.selection === "string" ? target.selection.trim() : "";
    const cur = getActiveConfig(kandinsky);
    const labelTarget = cur.specialist ? `Antigravity (${cur.specialist})` : "Antigravity";
    return [
      {
        label: sel ? `Send selection to ${labelTarget}` : `Open ${labelTarget} on this note`,
        icon: "claude",
        run: async () => {
          const ctx = typeof kandinsky.context === "function" ? kandinsky.context() : null;
          const ctxSel = ctx && ctx.selection && ctx.selection.text && ctx.selection.path === target?.path
            ? { from: ctx.selection.from_line, to: ctx.selection.to_line }
            : null;
          const prompt = formatRef(target?.path || "", sel, cur.specialist, ctxSel);
          const sendBus = typeof window !== "undefined" ? window.__kandinskySendPassageToAgent : null;
          if (prompt && typeof sendBus === "function") {
            await sendBus({ target: "antigravity", prompt, path: target?.path });
            return;
          }
          if (prompt) {
            try { await navigator.clipboard?.writeText(prompt); } catch {}
          }
          await openAgyTerminal(kandinsky, prompt ? ["-i", prompt] : []);
        },
      },
    ];
  });

  kandinsky.shell.menu("file", (target) => {
    if (!target || target.dir || !target.path) return null;
    const cur = getActiveConfig(kandinsky);
    const prefix = cur.specialist ? `${cur.specialist} ` : "";
    return [
      {
        label: cur.specialist ? `Open in Antigravity (${cur.specialist})` : "Open in Antigravity session",
        icon: "claude",
        run: async () => {
          const prompt = `${prefix}@${target.path} `;
          const sendBus = typeof window !== "undefined" ? window.__kandinskySendPassageToAgent : null;
          if (typeof sendBus === "function") {
            await sendBus({ target: "antigravity", prompt, path: target.path });
            return;
          }
          await openAgyTerminal(kandinsky, ["-i", `Inspect @${target.path}`]);
        },
      },
    ];
  });

  return () => {
    disposed = true;
    if (pollTimer) clearInterval(pollTimer);
    if (typeof window !== "undefined") window.removeEventListener(AGY_CONFIG_EVENT, onConfigEvent);
  };
}
