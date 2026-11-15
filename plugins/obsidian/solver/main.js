// Solver app commands & context-menu integration (main.js): note-to-Solver handoff and direct Solver-to-note cursor export.

import { insertLatestSolverDerivation } from "./view.js";

async function sendToSolver(kandinsky, opts = {}) {
  const snap = kandinsky.context();
  const path = opts.path || (snap && snap.selection && snap.selection.path) || (snap && snap.active && snap.active.path) || "";
  let prompt = (opts.selection || (snap && snap.selection && snap.selection.text) || "").trim();

  if (!prompt && path && /\.(md|tex|txt)$/i.test(path)) {
    try {
      prompt = (await kandinsky.readText(path)).trim();
    } catch {
      prompt = "";
    }
  }

  if (!prompt) {
    kandinsky.openView(undefined, { beside: Boolean(opts.beside) });
    return;
  }

  const title = path ? path.split("/").pop().replace(/\.[^.]+$/, "") : "Selection";
  try {
    await navigator.clipboard?.writeText(prompt);
  } catch {}
  const payload = { target: "solver", path, title, prompt };
  if (typeof window !== "undefined") {
    window.__kandinskyPendingSolverPrompt = payload;
  }
  kandinsky.openView(JSON.stringify({ path, title, prompt }), { beside: true, title: "Solver" });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("kandinsky:solver-prefill", { detail: payload }));
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("kandinsky:solver-prefill", { detail: payload }));
    }, 220);
  }
}

function openImportDialog(kandinsky, targetPath = "") {
  const active = targetPath || (kandinsky.context()?.active?.path ?? "");
  void kandinsky.openDialog(JSON.stringify({ targetPath: active }), {
    title: "Import Solver Derivation to Note",
    width: 680,
    height: 540,
    view: "import-dialog.js",
  });
}

function isSolverTabOpen() {
  if (typeof document === "undefined") return false;
  if (document.querySelector(".solver-shell")) return true;
  for (const el of document.querySelectorAll(".kandinsky-tab-title")) {
    if ((el.textContent || "").trim() === "Solver") return true;
  }
  return false;
}

export function register(kandinsky) {
  let disposed = false;
  let probing = false;
  let lastTabOpen = isSolverTabOpen();
  let ctxTimer = null;

  const statusItem = kandinsky.shell.statusItem({
    id: "solver",
    text: "Σ Solver: ready",
    title: "Solver — Click to open side-by-side with current note",
    run: () => kandinsky.openView(undefined, { beside: true }),
  });

  async function refreshSolverStatus(explicitOffline = false) {
    if (disposed) return null;
    if (probing && !explicitOffline) return null;
    probing = true;
    const s = (kandinsky.plugin && kandinsky.plugin.settings) || {};
    const url = String(s.url || "http://localhost:4200").trim().replace(/\/+$/, "");
    const apiUrl = String(s.api_url || "http://127.0.0.1:3000").trim().replace(/\/+$/, "");
    try {
      const st = await kandinsky.helper.call("status", { url, apiUrl }, { timeout: 10 });
      if (disposed) return st;
      const tabOpen = isSolverTabOpen();
      lastTabOpen = tabOpen;
      if (st && st.running) {
        statusItem.set("Σ Solver: open", `Solver connected at ${st.url || url} — Click to open beside note`);
      } else if (tabOpen) {
        statusItem.set("Σ Solver: open", `Solver workspace open (${url}) — Click to open beside note`);
      } else if (explicitOffline) {
        statusItem.set("Σ Solver: offline", "Solver services offline — Click to launch Solver beside current note");
      } else {
        statusItem.set("Σ Solver: ready", "Solver installed (idle) — Click to launch Solver beside current note");
      }
      return st;
    } catch {
      if (!disposed) {
        const tabOpen = isSolverTabOpen();
        lastTabOpen = tabOpen;
        if (tabOpen) {
          statusItem.set("Σ Solver: open", `Solver workspace open (${url}) — Click to open beside note`);
        } else if (explicitOffline) {
          statusItem.set("Σ Solver: offline", "Solver helper unreachable — Click to launch Solver beside current note");
        } else {
          statusItem.set("Σ Solver: ready", "Solver installed (idle) — Click to launch Solver beside current note");
        }
      }
      return null;
    } finally {
      probing = false;
    }
  }

  const offContext =
    typeof kandinsky.onContext === "function"
      ? kandinsky.onContext(() => {
          if (disposed) return;
          if (ctxTimer) clearTimeout(ctxTimer);
          ctxTimer = setTimeout(() => {
            if (disposed) return;
            const nowOpen = isSolverTabOpen();
            if (nowOpen !== lastTabOpen) {
              lastTabOpen = nowOpen;
              if (nowOpen) {
                statusItem.set("Σ Solver: open", "Solver workspace open — Click to open beside note");
              }
              void refreshSolverStatus(false);
            }
          }, 120);
        })
      : null;

  const initTimer = setTimeout(() => void refreshSolverStatus(false), 600);
  const pollTimer = setInterval(() => void refreshSolverStatus(false), 30000);

  kandinsky.registerCommand({
    id: "beside",
    title: "Solver: Open Solver side-by-side with current note",
    run: () => kandinsky.openView(undefined, { beside: true }),
  });

  kandinsky.registerCommand({
    id: "send-note",
    title: "Solver: Send current selection or note to Solver",
    run: () => sendToSolver(kandinsky, { beside: true }),
  });

  kandinsky.registerCommand({
    id: "insert-active-note",
    title: "Solver: Insert latest derivation into active note at cursor",
    run: () => insertLatestSolverDerivation(kandinsky),
  });

  kandinsky.registerCommand({
    id: "import-note",
    title: "Solver: Import Solver derivation into a Kandinsky note…",
    run: () => openImportDialog(kandinsky),
  });

  kandinsky.registerCommand({
    id: "status",
    title: "Solver: Check local Solver service status",
    run: async () => {
      const st = await refreshSolverStatus(true);
      if (st && st.running) {
        statusItem.set("Σ Solver: open", `Solver connected at ${st.url} — Click to open beside note`);
        kandinsky.toast("Solver is running", `Connected at ${st.url}`, "success", {
          label: "Open Solver",
          run: () => kandinsky.openView(undefined, { beside: true }),
        });
      } else {
        statusItem.set("Σ Solver: offline", "Solver services offline — Click to launch Solver beside current note");
        kandinsky.toast("Solver is currently offline", "Open the Solver app in Kandinsky to start its background services.", "info", {
          label: "Start in Kandinsky",
          run: () => kandinsky.openView(undefined, { beside: true }),
        });
      }
    },
  });

  kandinsky.shell.menu("editor", (target) => {
    const sel = target && typeof target.selection === "string" ? target.selection.trim() : "";
    return [
      {
        label: sel ? "Send selection to Solver" : "Send note to Solver",
        icon: "sigma",
        run: () => sendToSolver(kandinsky, { path: target?.path, selection: sel, beside: true }),
      },
      {
        label: "Insert Solver derivation at cursor",
        icon: "sigma",
        run: () => insertLatestSolverDerivation(kandinsky),
      },
      {
        label: "Import Solver derivation into note…",
        icon: "sigma",
        run: () => openImportDialog(kandinsky, target?.path || ""),
      },
    ];
  });

  kandinsky.shell.menu("file", (target) => {
    if (!target || target.dir || !/\.(md|tex)$/i.test(target.path || "")) return null;
    return [
      {
        label: "Open beside Solver",
        icon: "sigma",
        run: () => sendToSolver(kandinsky, { path: target.path, beside: true }),
      },
    ];
  });

  return () => {
    disposed = true;
    clearTimeout(initTimer);
    clearInterval(pollTimer);
    if (ctxTimer) clearTimeout(ctxTimer);
    if (typeof offContext === "function") offContext();
    statusItem.remove();
  };
}
