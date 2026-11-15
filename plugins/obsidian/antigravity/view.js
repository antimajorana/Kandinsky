// Antigravity control center (view.js): full Model Switcher, Live Subagent Monitor, and Kandinsky Vault MCP Bridge.

import { mountSwitcherWidget } from "./switcher-ui.js";

export default function mountAntigravityPane(host, atlas) {
  let disposed = false;
  let busy = false;
  let state = {
    checked: false,
    installed: false,
    kandinskyMcpConnected: false,
    mcpText: "",
    error: "",
  };

  host.style.padding = "22px 26px";
  host.style.overflow = "auto";
  host.style.color = "var(--text)";

  const style = document.createElement("style");
  style.textContent = `
    .agy-wrap { max-width: 780px; display: flex; flex-direction: column; gap: 16px; }
    .agy-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; border-bottom: 1px solid var(--border); padding-bottom: 12px; }
    .agy-title { display: flex; align-items: center; gap: 10px; }
    .agy-icon { width: 30px; height: 30px; border-radius: 7px; background: var(--accent); color: var(--bg); display: grid; place-items: center; font-weight: 700; font-size: 13px; }
    .agy-title h2 { margin: 0; font-size: 18px; }
    .agy-sub { margin: 2px 0 0; color: var(--text-muted); font-size: 12.5px; }
    .agy-card { padding: 14px 16px; border: 1px solid var(--border-strong, var(--border)); border-radius: 8px; background: var(--bg-elevated, var(--bg)); display: flex; flex-direction: column; gap: 10px; }
    .agy-card h3 { margin: 0; font-size: 14px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .agy-card p { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--text-muted); }
    .agy-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .agy-btn { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 5px; border: 1px solid var(--border-strong, var(--border)); background: var(--bg); color: var(--text); font-size: 12.5px; cursor: pointer; }
    .agy-btn:hover { background: var(--bg-hover); }
    .agy-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--bg); font-weight: 600; }
    .agy-btn:disabled { opacity: 0.5; pointer-events: none; }
    .agy-pill { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border-strong, var(--border)); color: var(--text-muted); }
    .agy-pill.ok { border-color: var(--accent); color: var(--accent); font-weight: 600; }
    .agy-pre { margin: 0; padding: 8px 10px; border-radius: 6px; background: var(--bg-hover); font-family: var(--font-mono, monospace); font-size: 11.5px; white-space: pre-wrap; color: var(--text-muted); max-height: 150px; overflow: auto; }
  `;

  const wrap = document.createElement("div");
  wrap.className = "agy-wrap";

  const head = document.createElement("div");
  head.className = "agy-head";
  const titleWrap = document.createElement("div");
  titleWrap.className = "agy-title";
  const icon = document.createElement("span");
  icon.className = "agy-icon";
  icon.textContent = "AGY";
  const textWrap = document.createElement("div");
  const h2 = document.createElement("h2");
  h2.textContent = "Google Antigravity Hub";
  const sub = document.createElement("p");
  sub.className = "agy-sub";
  sub.textContent = "Switch active models (Carbon, Argon, Hydrogen), monitor live subagents, launch terminal sessions, and connect Kandinsky's vault MCP server.";
  textWrap.append(h2, sub);
  titleWrap.append(icon, textWrap);

  const settingsBtn = document.createElement("button");
  settingsBtn.className = "agy-btn";
  settingsBtn.textContent = "Settings…";
  settingsBtn.onclick = () => atlas.plugin.openSettings();
  head.append(titleWrap, settingsBtn);

  const switcherMount = document.createElement("div");
  const mcpMount = document.createElement("div");

  wrap.append(head, switcherMount, mcpMount);
  host.replaceChildren(style, wrap);

  const cleanupSwitcher = mountSwitcherWidget(switcherMount, atlas, { compact: false });

  async function refreshMcp() {
    if (disposed) return;
    busy = true;
    renderMcp();
    try {
      const res = await atlas.helper.call("status", { includeModels: false }, { timeout: 15 });
      if (disposed) return;
      state = { checked: true, ...res, error: res.error || "" };
    } catch (e) {
      if (disposed) return;
      state = { ...state, checked: true, error: String((e && e.message) || e) };
    } finally {
      busy = false;
      renderMcp();
    }
  }

  async function connectMcp() {
    if (busy || disposed) return;
    busy = true;
    renderMcp();
    try {
      const res = await atlas.helper.call("connectMcp", {}, { timeout: 20 });
      if (disposed) return;
      if (res && res.ok) {
        atlas.toast("Connected Kandinsky MCP", "Antigravity can now search, read, and navigate your vault directly.", "success");
      } else {
        atlas.toast("Could not register MCP", (res && res.stderr) || "Check agy mcp list.", "error");
      }
      if (res && res.status) state = { checked: true, ...res.status, error: "" };
    } catch (e) {
      atlas.toast("MCP setup failed", String((e && e.message) || e), "error");
    } finally {
      busy = false;
      renderMcp();
    }
  }

  function renderMcp() {
    if (disposed) return;
    mcpMount.replaceChildren();

    const mcpCard = document.createElement("div");
    mcpCard.className = "agy-card";
    const mh = document.createElement("h3");
    mh.textContent = "CLI & Kandinsky Vault MCP Bridge ";
    const cliPill = document.createElement("span");
    cliPill.className = `agy-pill ${state.installed ? "ok" : ""}`;
    cliPill.textContent = !state.checked ? "Checking…" : state.installed ? "agy CLI detected" : "agy not found";
    const mcpPill = document.createElement("span");
    mcpPill.className = `agy-pill ${state.kandinskyMcpConnected ? "ok" : ""}`;
    mcpPill.textContent = state.kandinskyMcpConnected ? "Vault MCP connected" : "Vault MCP not registered yet";
    mh.append(cliPill, mcpPill);

    const mp = document.createElement("p");
    mp.textContent = "Registering Kandinsky's built-in MCP server (`kandinsky mcp`) lets Antigravity read your active note & selection, search notes, query Bases, and call plugin tools directly.";

    const mrow = document.createElement("div");
    mrow.className = "agy-row";
    const connectBtn = document.createElement("button");
    connectBtn.className = `agy-btn ${state.kandinskyMcpConnected ? "" : "primary"}`;
    connectBtn.disabled = busy;
    connectBtn.textContent = state.kandinskyMcpConnected ? "Refresh Kandinsky MCP Registration" : "Connect Kandinsky MCP to Antigravity";
    connectBtn.onclick = () => void connectMcp();

    const refreshBtn = document.createElement("button");
    refreshBtn.className = "agy-btn";
    refreshBtn.disabled = busy;
    refreshBtn.textContent = busy ? "Checking…" : "Refresh MCP Status";
    refreshBtn.onclick = () => void refreshMcp();

    mrow.append(connectBtn, refreshBtn);
    mcpCard.append(mh, mp, mrow);

    if (state.mcpText) {
      const pre = document.createElement("pre");
      pre.className = "agy-pre";
      pre.textContent = state.mcpText;
      mcpCard.append(pre);
    } else if (state.error) {
      const pre = document.createElement("pre");
      pre.className = "agy-pre";
      pre.textContent = state.error;
      mcpCard.append(pre);
    }

    mcpMount.append(mcpCard);
  }

  renderMcp();
  void refreshMcp();

  return () => {
    disposed = true;
    if (cleanupSwitcher) cleanupSwitcher();
  };
}
