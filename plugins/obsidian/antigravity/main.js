// Antigravity agent integration (main.js): status bar launcher, palette commands, and editor/file context-menu handoff.

function formatRef(path, selectionText) {
  if (!path) return selectionText ? `${selectionText}\n` : "";
  if (selectionText) return `@${path} — "${selectionText.replace(/\s+/g, " ").slice(0, 200)}" `;
  return `@${path} `;
}

async function openAntigravityTerminal(atlas, extraArgs = [], title = "Antigravity") {
  const shell = await atlas.terminal.shell();
  const s = (atlas.plugin && atlas.plugin.settings) || {};
  const baseCmd = String(s.command || "agy").trim() || "agy";
  const args = [...extraArgs];
  if (s.default_mode && s.default_mode !== "interactive" && !args.includes("--mode")) {
    args.push("--mode", String(s.default_mode));
  }
  if (s.default_effort && s.default_effort !== "default" && !args.includes("--effort")) {
    args.push("--effort", String(s.default_effort));
  }
  const line = args.length ? atlas.terminal.line(shell, baseCmd, ...args) : baseCmd;
  await atlas.terminal.open(line, title);
}

export function register(atlas) {
  const s = (atlas.plugin && atlas.plugin.settings) || {};
  let cell = null;

  if (s.status_bar !== false) {
    cell = atlas.shell.statusItem({
      id: "agy",
      text: "Antigravity",
      title: "Google Antigravity (click for quick actions & sessions)",
      run: () => atlas.openView(),
    });
    void atlas.helper
      .call("status", { includeModels: false }, { timeout: 12 })
      .then((st) => {
        if (!cell || !st) return;
        if (st.installed) {
          cell.set(
            st.kandinskyMcpConnected ? "Antigravity · MCP" : "Antigravity",
            st.kandinskyMcpConnected
              ? "Google Antigravity ready (Kandinsky Vault MCP connected) — click to launch or manage"
              : "Google Antigravity CLI ready — click to launch a session or connect Kandinsky MCP",
          );
        } else {
          cell.set("Antigravity ?", "agy CLI not detected on PATH — click to check settings");
        }
      })
      .catch(() => {});
  }

  atlas.registerCommand({
    id: "new-session",
    title: "Antigravity: Start new terminal session",
    run: () => openAntigravityTerminal(atlas, [], "Antigravity"),
  });

  atlas.registerCommand({
    id: "continue-session",
    title: "Antigravity: Resume most recent conversation (--continue)",
    run: () => openAntigravityTerminal(atlas, ["--continue"], "Antigravity (Resume)"),
  });

  atlas.registerCommand({
    id: "plan-session",
    title: "Antigravity: Start session in Plan mode",
    run: () => openAntigravityTerminal(atlas, ["--mode", "plan"], "Antigravity (Plan)"),
  });

  atlas.registerCommand({
    id: "hub",
    title: "Antigravity: Open Antigravity control & MCP setup",
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
          await openAntigravityTerminal(
            atlas,
            prompt ? ["-i", prompt] : [],
            "Antigravity",
          );
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
        run: () => openAntigravityTerminal(atlas, ["-i", `Inspect @${target.path}`], "Antigravity"),
      },
    ];
  });

  return () => {
    if (cell) cell.remove();
  };
}
