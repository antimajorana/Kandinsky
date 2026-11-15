// Solver app commands & context-menu integration (main.js).

async function sendToSolver(atlas, opts = {}) {
  const snap = atlas.context();
  const path = opts.path || (snap && snap.selection && snap.selection.path) || (snap && snap.active && snap.active.path) || "";
  let prompt = (opts.selection || (snap && snap.selection && snap.selection.text) || "").trim();

  if (!prompt && path && /\.(md|tex|txt)$/i.test(path)) {
    try {
      prompt = (await atlas.readText(path)).trim();
    } catch {
      prompt = "";
    }
  }

  if (!prompt) {
    atlas.openView(undefined, { beside: Boolean(opts.beside) });
    return;
  }

  const title = path ? path.split("/").pop().replace(/\.[^.]+$/, "") : "Selection";
  try {
    await navigator.clipboard?.writeText(prompt);
  } catch {}
  atlas.openView(JSON.stringify({ path, title, prompt }), { beside: true, title: "Solver" });
}

export function register(atlas) {
  atlas.registerCommand({
    id: "beside",
    title: "Solver: Open Solver side-by-side with current note",
    run: () => atlas.openView(undefined, { beside: true }),
  });

  atlas.registerCommand({
    id: "send-note",
    title: "Solver: Send current selection or note to Solver",
    run: () => sendToSolver(atlas, { beside: true }),
  });

  atlas.registerCommand({
    id: "status",
    title: "Solver: Check local Solver service status",
    run: async () => {
      const s = (atlas.plugin && atlas.plugin.settings) || {};
      const st = await atlas.helper.call("status", {
        url: s.url || "http://localhost:4200",
        apiUrl: s.api_url || "http://127.0.0.1:3000",
      });
      if (st && st.running) {
        atlas.toast("Solver is running", `Connected at ${st.url}`, "success", {
          label: "Open Solver",
          run: () => atlas.openView(),
        });
      } else {
        atlas.toast("Solver is currently offline", "Open the Solver app in Kandinsky to start its background services.", "info", {
          label: "Start in Kandinsky",
          run: () => atlas.openView(),
        });
      }
    },
  });

  atlas.shell.menu("editor", (target) => {
    const sel = target && typeof target.selection === "string" ? target.selection.trim() : "";
    return [
      {
        label: sel ? "Send selection to Solver" : "Send note to Solver",
        icon: "sigma",
        run: () => sendToSolver(atlas, { path: target?.path, selection: sel, beside: true }),
      },
    ];
  });

  atlas.shell.menu("file", (target) => {
    if (!target || target.dir || !/\.(md|tex)$/i.test(target.path || "")) return null;
    return [
      {
        label: "Open beside Solver",
        icon: "sigma",
        run: () => sendToSolver(atlas, { path: target.path, beside: true }),
      },
    ];
  });
}
