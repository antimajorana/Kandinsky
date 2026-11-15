// Dataview & DataviewJS plugin for Kandinsky (API v28)
// Live-renders ```dataview (TABLE, LIST, TASK) and ```dataviewjs code blocks inside Markdown notes.

import { executeDql } from "./dql.js";
import { injectDataviewStyles, renderDqlResult, runDataviewJs } from "./dv-runtime.js";
import { createVaultIndex } from "./index.js";

function showError(container, prefix, err) {
  const box = document.createElement("div");
  box.className = "dv-error";
  box.textContent = `${prefix}: ${err?.message ? err.message : String(err)}`;
  container.replaceChildren(box);
}

export function register(kandinsky) {
  const settings = kandinsky.plugin.settings ?? {};
  const getDefaultFmt = () => String(settings.date_format || "YYYY-MM-DD").trim() || "YYYY-MM-DD";
  const getMaxRows = () => Math.max(1, Number(settings.max_rows) || 500);

  const removeStyles = injectDataviewStyles();
  const index = createVaultIndex(kandinsky, getDefaultFmt);

  // Keep the Markdown metadata cache warm and incrementally updated on file events
  void index.ensureReady();
  kandinsky.onFilesChanged((paths) => {
    void index.refreshPaths(paths);
  });

  // Palette command to force a full vault metadata re-index if ever needed
  kandinsky.registerCommand({
    id: "refresh",
    title: "Dataview: Rebuild metadata index",
    run: async () => {
      const t0 = performance.now();
      await index.forceRescan();
      const ms = Math.round(performance.now() - t0);
      kandinsky.toast("Dataview", `Indexed ${index.allPages().length} notes in ${ms} ms`, "success", { timeout: 2500 });
    },
  });

  // ```dataview (DQL: TABLE, LIST, TASK)
  kandinsky.editor.registerFence("dataview", (host, fence) => {
    const root = document.createElement("div");
    root.className = "dv-fence-root";
    host.appendChild(root);

    let disposed = false;
    let renderSeq = 0;

    const draw = async () => {
      const mySeq = ++renderSeq;
      try {
        await index.ensureReady();
        if (disposed || mySeq !== renderSeq) return;
        const res = executeDql(fence.source, {
          index,
          currentPath: fence.path,
          getDefaultFmt,
          maxRows: getMaxRows(),
        });
        root.replaceChildren();
        renderDqlResult(root, res, {
          kandinsky,
          index,
          fromPath: fence.path,
          getDefaultFmt,
        });
      } catch (err) {
        if (!disposed && mySeq === renderSeq) showError(root, "Dataview error", err);
      }
    };

    void draw();
    const unsub = index.subscribe(() => void draw());
    return () => {
      disposed = true;
      unsub();
    };
  });

  // ```dataviewjs (JavaScript execution with `dv` and `app`)
  kandinsky.editor.registerFence("dataviewjs", (host, fence) => {
    const root = document.createElement("div");
    root.className = "dv-fence-root";
    host.appendChild(root);

    if (settings.enable_dataviewjs === false) {
      const msg = document.createElement("p");
      msg.className = "dv-empty";
      msg.textContent = "DataviewJS execution is turned off in Settings → Plugins → Dataview & DataviewJS.";
      root.appendChild(msg);
      return;
    }

    let disposed = false;
    let renderSeq = 0;

    const draw = async () => {
      const mySeq = ++renderSeq;
      try {
        const [, liveProps] = await Promise.all([
          index.ensureReady(),
          fence.props().catch(() => ({})),
        ]);
        if (disposed || mySeq !== renderSeq) return;

        root.replaceChildren();
        await runDataviewJs(fence.source, root, {
          kandinsky,
          index,
          currentPath: fence.path,
          liveProps,
          getDefaultFmt,
          maxRows: getMaxRows(),
        });
      } catch (err) {
        if (!disposed && mySeq === renderSeq) showError(root, "DataviewJS error", err);
      }
    };

    void draw();
    const unsub = index.subscribe(() => void draw());
    return () => {
      disposed = true;
      unsub();
    };
  });

  return () => {
    removeStyles();
  };
}
