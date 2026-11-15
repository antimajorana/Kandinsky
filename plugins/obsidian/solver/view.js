// Solver app pane (view.js): docks Solver Agent directly inside Kandinsky with silent background startup & note handoff.

function parseArg(raw) {
  if (!raw || typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    return { prompt: raw };
  }
  return null;
}

function getSettings(atlas) {
  const s = (atlas.plugin && atlas.plugin.settings) || {};
  return {
    url: String(s.url || "http://localhost:4200").trim().replace(/\/+$/, ""),
    apiUrl: String(s.api_url || "http://127.0.0.1:3000").trim().replace(/\/+$/, ""),
    launcherDir: String(s.launcher_dir || "C:/Users/antimajorana/Documents/GitHub/re-Solver-Agent").trim(),
    autoStart: s.auto_start !== false,
  };
}

export default function mountSolver(host, atlas) {
  let disposed = false;
  let starting = false;
  let running = false;
  let statusDetail = "Checking local Solver services…";
  let errorMsg = "";
  let frameKey = 0;

  const cfg = getSettings(atlas);
  let handoff = parseArg(atlas.arg);

  host.style.display = "flex";
  host.style.flexDirection = "column";
  host.style.height = "100%";
  host.style.overflow = "hidden";
  host.style.background = "var(--bg)";
  host.style.color = "var(--text)";

  const style = document.createElement("style");
  style.textContent = `
    .solver-shell { display: flex; flex-direction: column; height: 100%; width: 100%; overflow: hidden; background: var(--bg); }
    .solver-bar { display: flex; align-items: center; gap: 8px; padding: 5px 10px; border-bottom: 1px solid var(--border); background: var(--bg-elevated, var(--bg)); flex: none; flex-wrap: wrap; }
    .solver-brand { display: inline-flex; align-items: center; gap: 7px; font-weight: 650; font-size: 13px; color: var(--text); }
    .solver-sigma { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 5px; background: var(--accent); color: var(--bg); font-weight: 700; font-size: 12px; font-family: Georgia, serif; }
    .solver-pill { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 999px; font-size: 11.5px; border: 1px solid var(--border-strong, var(--border)); color: var(--text-muted); }
    .solver-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-faint); }
    .solver-pill.ok { color: var(--text); border-color: var(--accent); }
    .solver-pill.ok .solver-dot { background: #2ea043; }
    .solver-pill.busy .solver-dot { background: #d29922; }
    .solver-pill.err { color: var(--red, #e5534b); border-color: var(--red, #e5534b); }
    .solver-pill.err .solver-dot { background: var(--red, #e5534b); }
    .solver-spacer { flex: 1; }
    .solver-btn { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: var(--radius-sm, 5px); border: 1px solid var(--border-strong, var(--border)); background: var(--bg); color: var(--text); font-size: 12px; cursor: pointer; }
    .solver-btn:hover { background: var(--bg-hover); }
    .solver-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--bg); font-weight: 600; }
    .solver-btn:disabled { opacity: 0.5; pointer-events: none; }
    .solver-handoff { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 12px; border-bottom: 1px solid var(--border); background: var(--bg-hover); font-size: 12px; flex: none; flex-wrap: wrap; }
    .solver-handoff-text { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
    .solver-body { flex: 1; min-height: 0; position: relative; display: flex; flex-direction: column; }
    .solver-frame { flex: 1; width: 100%; height: 100%; border: 0; background: var(--bg); }
    .solver-card-wrap { flex: 1; display: grid; place-items: center; padding: 24px; overflow: auto; }
    .solver-card { max-width: 520px; width: 100%; padding: 22px 24px; border-radius: 10px; border: 1px solid var(--border-strong, var(--border)); background: var(--bg-elevated, var(--bg)); display: flex; flex-direction: column; gap: 12px; }
    .solver-card h3 { margin: 0; font-size: 16px; display: flex; align-items: center; gap: 8px; }
    .solver-card p { margin: 0; font-size: 13px; line-height: 1.55; color: var(--text-muted); }
    .solver-err { padding: 10px 12px; border-radius: 6px; border: 1px solid var(--red, #e5534b); color: var(--red, #e5534b); font-size: 12.5px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
    .solver-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
  `;

  const shell = document.createElement("div");
  shell.className = "solver-shell";
  const bar = document.createElement("div");
  bar.className = "solver-bar";
  const handoffBar = document.createElement("div");
  handoffBar.className = "solver-handoff";
  handoffBar.style.display = "none";
  const body = document.createElement("div");
  body.className = "solver-body";

  shell.append(bar, handoffBar, body);
  host.replaceChildren(style, shell);

  let iframeEl = null;

  function copyPrompt(text) {
    if (!text) return;
    navigator.clipboard?.writeText(text).then(
      () => atlas.toast("Copied problem prompt", "Paste directly into Solver's New Problem box.", "success"),
      () => atlas.toast("Prompt ready", "Select and copy the note text into Solver.", "info"),
    );
  }

  function renderHandoff() {
    if (!handoff || !handoff.prompt) {
      handoffBar.style.display = "none";
      return;
    }
    handoffBar.style.display = "flex";
    handoffBar.replaceChildren();

    const label = document.createElement("span");
    label.className = "solver-handoff-text";
    label.textContent = `Ready from ${handoff.title || handoff.path || "note"}: "${String(handoff.prompt).replace(/\s+/g, " ").slice(0, 110)}…"`;

    const acts = document.createElement("span");
    acts.style.display = "inline-flex";
    acts.style.gap = "6px";

    const copyBtn = document.createElement("button");
    copyBtn.className = "solver-btn primary";
    copyBtn.textContent = "Copy Prompt";
    copyBtn.onclick = () => copyPrompt(handoff.prompt);

    acts.append(copyBtn);

    if (handoff.path) {
      const noteBtn = document.createElement("button");
      noteBtn.className = "solver-btn";
      noteBtn.textContent = "Open Note Beside";
      noteBtn.onclick = () => atlas.open(handoff.path, undefined, { beside: true });
      acts.append(noteBtn);
    }

    const dismissBtn = document.createElement("button");
    dismissBtn.className = "solver-btn";
    dismissBtn.textContent = "Dismiss";
    dismissBtn.onclick = () => {
      handoff = null;
      renderHandoff();
    };
    acts.append(dismissBtn);

    handoffBar.append(label, acts);
  }

  function renderBar() {
    bar.replaceChildren();

    const brand = document.createElement("span");
    brand.className = "solver-brand";
    const sigma = document.createElement("span");
    sigma.className = "solver-sigma";
    sigma.textContent = "Σ";
    const title = document.createElement("span");
    title.textContent = "Solver Agent";
    brand.append(sigma, title);

    const pill = document.createElement("span");
    pill.className = `solver-pill ${running ? "ok" : starting ? "busy" : errorMsg ? "err" : ""}`;
    const dot = document.createElement("span");
    dot.className = "solver-dot";
    const pillText = document.createElement("span");
    pillText.textContent = running ? "Connected" : starting ? "Starting…" : errorMsg ? "Needs attention" : "Offline";
    pill.append(dot, pillText);

    const spacer = document.createElement("span");
    spacer.className = "solver-spacer";

    bar.append(brand, pill, spacer);

    if (!running) {
      const startBtn = document.createElement("button");
      startBtn.className = "solver-btn primary";
      startBtn.disabled = starting;
      startBtn.textContent = starting ? "Starting…" : "Start Solver";
      startBtn.onclick = () => void startSolver();
      bar.append(startBtn);
    } else {
      const reloadBtn = document.createElement("button");
      reloadBtn.className = "solver-btn";
      reloadBtn.textContent = "Reload";
      reloadBtn.onclick = () => {
        frameKey++;
        iframeEl = null;
        void refreshStatus(false);
      };
      bar.append(reloadBtn);
    }

    const splitBtn = document.createElement("button");
    splitBtn.className = "solver-btn";
    splitBtn.title = "Open a note beside Solver or dock Solver beside your active note";
    splitBtn.textContent = "Split View";
    splitBtn.onclick = () => {
      const snap = atlas.context();
      const notePath = snap && snap.active && snap.active.path ? snap.active.path : null;
      if (notePath) atlas.open(notePath, undefined, { beside: true });
      else atlas.openView(undefined, { beside: true });
    };

    const browserBtn = document.createElement("button");
    browserBtn.className = "solver-btn";
    browserBtn.title = "Open Solver in your external browser";
    browserBtn.textContent = "Browser ↗";
    browserBtn.onclick = () => atlas.openLink(cfg.url, { outside: true });

    const settingsBtn = document.createElement("button");
    settingsBtn.className = "solver-btn";
    settingsBtn.textContent = "Settings";
    settingsBtn.onclick = () => atlas.plugin.openSettings();

    bar.append(splitBtn, browserBtn, settingsBtn);
  }

  function renderBody() {
    if (running) {
      if (!iframeEl) {
        iframeEl = document.createElement("iframe");
        iframeEl.className = "solver-frame";
        iframeEl.title = "Solver Agent Workspace";
        iframeEl.allow = "clipboard-read; clipboard-write";
        iframeEl.src = `${cfg.url}${cfg.url.includes("?") ? "&" : "?"}_k=${frameKey}`;
        body.replaceChildren(iframeEl);
      }
      return;
    }

    iframeEl = null;
    const wrap = document.createElement("div");
    wrap.className = "solver-card-wrap";
    const card = document.createElement("div");
    card.className = "solver-card";

    const h3 = document.createElement("h3");
    h3.textContent = starting ? "Starting Solver Agent…" : "Solver Agent Workspace";

    const p = document.createElement("p");
    p.textContent = statusDetail;

    card.append(h3, p);

    if (errorMsg) {
      const err = document.createElement("div");
      err.className = "solver-err";
      err.textContent = errorMsg;
      card.append(err);
    }

    const actions = document.createElement("div");
    actions.className = "solver-actions";

    const startBtn = document.createElement("button");
    startBtn.className = "solver-btn primary";
    startBtn.disabled = starting;
    startBtn.textContent = starting ? "Starting background services…" : "Start Solver Services";
    startBtn.onclick = () => void startSolver();

    const checkBtn = document.createElement("button");
    checkBtn.className = "solver-btn";
    checkBtn.disabled = starting;
    checkBtn.textContent = "Check Again";
    checkBtn.onclick = () => void refreshStatus(false);

    const cfgBtn = document.createElement("button");
    cfgBtn.className = "solver-btn";
    cfgBtn.textContent = "Configure Paths…";
    cfgBtn.onclick = () => atlas.plugin.openSettings();

    actions.append(startBtn, checkBtn, cfgBtn);
    card.append(actions);
    wrap.append(card);
    body.replaceChildren(wrap);
  }

  function syncUi() {
    if (disposed) return;
    renderBar();
    renderHandoff();
    renderBody();
  }

  async function startSolver() {
    if (starting || disposed) return;
    starting = true;
    errorMsg = "";
    statusDetail = "Checking WSL2, Docker & MongoDB, then launching Solver services silently in the background (no extra browser or console windows)…";
    syncUi();
    try {
      const res = await atlas.helper.call(
        "start",
        { url: cfg.url, apiUrl: cfg.apiUrl, launcherDir: cfg.launcherDir },
        { timeout: 310 },
      );
      if (disposed) return;
      if (res && res.ok) {
        running = true;
        errorMsg = "";
        statusDetail = "Solver Agent is running.";
      } else {
        running = false;
        errorMsg = (res && res.error) || "Solver services did not finish starting.";
        statusDetail = "Solver could not start automatically. Make sure Docker Desktop and WSL2 are ready, then try again.";
      }
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
      const st = await atlas.helper.call("status", { url: cfg.url, apiUrl: cfg.apiUrl }, { timeout: 15 });
      if (disposed) return;
      if (st && st.running) {
        running = true;
        errorMsg = "";
        statusDetail = "Solver Agent is running.";
        syncUi();
        return;
      }
      running = false;
      if (allowAutoStart && cfg.autoStart) {
        await startSolver();
        return;
      }
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

  if (handoff && handoff.prompt) {
    copyPrompt(handoff.prompt);
  }
  syncUi();
  void refreshStatus(true);

  return () => {
    disposed = true;
  };
}
