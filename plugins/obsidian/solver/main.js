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

export function register(kandinsky) {
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
      const s = (kandinsky.plugin && kandinsky.plugin.settings) || {};
      const st = await kandinsky.helper.call("status", {
        url: s.url || "http://localhost:4200",
        apiUrl: s.api_url || "http://127.0.0.1:3000",
      });
      if (st && st.running) {
        kandinsky.toast("Solver is running", `Connected at ${st.url}`, "success", {
          label: "Open Solver",
          run: () => kandinsky.openView(),
        });
      } else {
        kandinsky.toast("Solver is currently offline", "Open the Solver app in Kandinsky to start its background services.", "info", {
          label: "Start in Kandinsky",
          run: () => kandinsky.openView(),
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
}
