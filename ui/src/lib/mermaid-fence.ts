// Dynamic Mermaid diagram fence renderer (`type: mermaid` / ```mermaid): imports `mermaid` lazily on first diagram so main bundle stays tiny.
import { registerFence } from "./fences";
import { errText } from "./text";

let mermaidSeq = 0;

const MERMAID_STYLE_ID = "kandinsky-mermaid-fence-css";
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

// Preserve previous valid SVGs per note path across Live Preview widget teardown/recreation when edits introduce syntax errors.
const validCacheByPath = new Map<string, Array<{ source: string; svg: string }>>();

function ensureMermaidStyles(): void {
  if (typeof document === "undefined" || document.getElementById(MERMAID_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = MERMAID_STYLE_ID;
  style.textContent = `
.mermaid-figure {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  overflow: hidden;
  padding: 10px;
  border-radius: var(--radius);
  background: var(--bg-side);
  border: 1px solid var(--border);
}
.mermaid-viewport {
  width: 100%;
  overflow: auto;
  display: flex;
  justify-content: center;
  align-items: flex-start;
}
.mermaid-stage {
  display: flex;
  justify-content: center;
  min-width: min-content;
}
.mermaid-zoom-bar {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-elev);
  box-shadow: var(--shadow-sm);
  font-family: var(--font-ui);
  font-size: calc(11px * var(--ui-scale, 1));
  color: var(--text-muted);
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
  user-select: none;
}
.mermaid-figure:hover .mermaid-zoom-bar,
.mermaid-figure:focus-within .mermaid-zoom-bar,
.mermaid-figure[data-zoomed="1"] .mermaid-zoom-bar,
:root[data-touch] .mermaid-figure .mermaid-zoom-bar {
  opacity: 1;
  pointer-events: auto;
}
.mermaid-zoom-btn {
  min-width: 22px;
  height: 22px;
  padding: 0 5px;
  border-radius: 4px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  line-height: 1;
  cursor: pointer;
}
.mermaid-zoom-btn:hover {
  background: var(--bg-hover);
  color: var(--heading);
  border-color: var(--border);
}
.mermaid-zoom-pct {
  min-width: 38px;
  text-align: center;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
  padding: 0 2px;
}
.mermaid-stale-wrap {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--border);
  display: flex;
  justify-content: center;
  overflow-x: auto;
  opacity: 0.42;
  pointer-events: none;
}
.mermaid-stale-wrap svg {
  max-width: 100%;
  height: auto;
}
`;
  document.head.append(style);
}

function isDarkTheme(): boolean {
  return document.documentElement.dataset.theme !== "light" && !document.documentElement.classList.contains("light");
}

function lineOverlap(a: string, b: string): number {
  const linesA = new Set(a.split("\n").map((l) => l.trim()).filter(Boolean));
  let score = 0;
  for (const line of b.split("\n")) {
    const t = line.trim();
    if (t && linesA.has(t)) score++;
  }
  return score;
}

function rememberValidSvg(path: string, source: string, svg: string): void {
  const list = validCacheByPath.get(path) ?? [];
  const idx = list.findIndex((item) => item.source === source);
  if (idx >= 0) list.splice(idx, 1);
  list.push({ source, svg });
  if (list.length > 20) list.shift();
  validCacheByPath.set(path, list);
}

function findFallbackSvg(path: string, brokenSource: string, container: Element | null): string | null {
  const list = validCacheByPath.get(path);
  if (!list?.length) return null;
  const activeSources = new Set<string>();
  if (container) {
    for (const fig of container.querySelectorAll<HTMLElement>('.mermaid-figure[data-state="done"]')) {
      if (fig.dataset.mermaidSource) activeSources.add(fig.dataset.mermaidSource);
    }
  }
  const candidates = list.filter((item) => !activeSources.has(item.source));
  const pool = candidates.length ? candidates : list;
  let best = pool[pool.length - 1];
  let bestScore = -1;
  for (const item of pool) {
    const score = lineOverlap(item.source, brokenSource);
    if (score >= bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best?.svg ?? null;
}

registerFence("kandinsky-mermaid", "mermaid", (host, fence) => {
  ensureMermaidStyles();
  let gone = false;
  let lastDark = isDarkTheme();
  let lastValidSvg: string | null = null;
  let zoom = 1;
  let baseWidth: number | null = null;
  let origSvgWidth = "";
  let origSvgMaxWidth = "";

  const box = document.createElement("div");
  box.className = "tikz-figure mermaid-figure";
  box.dataset.state = "drawing";
  box.dataset.zoom = "100";
  box.dataset.zoomed = "0";
  box.dataset.mermaidSource = fence.source;
  box.textContent = "Rendering diagram…";
  host.append(box);

  let stageEl: HTMLDivElement | null = null;
  let pctEl: HTMLSpanElement | null = null;

  const applyZoom = () => {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100));
    zoom = clamped;
    const pct = Math.round(zoom * 100);
    box.dataset.zoom = String(pct);
    box.dataset.zoomed = pct !== 100 ? "1" : "0";
    if (pctEl) pctEl.textContent = `${pct}%`;
    const svg = stageEl?.querySelector<SVGElement>("svg");
    if (!svg) return;
    if (pct === 100) {
      svg.style.width = origSvgWidth;
      svg.style.maxWidth = origSvgMaxWidth;
      baseWidth = null;
      return;
    }
    if (baseWidth === null) {
      const rectW = svg.getBoundingClientRect().width;
      const vbW = (svg as SVGSVGElement).viewBox?.baseVal?.width ?? 0;
      const maxW = parseFloat(origSvgMaxWidth || svg.style.maxWidth || "");
      const attrW = parseFloat(svg.getAttribute("width") ?? "");
      baseWidth = rectW > 0 ? rectW : vbW > 0 ? vbW : Number.isFinite(maxW) && maxW > 0 ? maxW : Number.isFinite(attrW) && attrW > 0 ? attrW : 480;
    }
    svg.style.maxWidth = "none";
    svg.style.width = `${Math.round(baseWidth * zoom)}px`;
    svg.style.height = "auto";
  };

  const buildToolbar = () => {
    const bar = document.createElement("div");
    bar.className = "mermaid-zoom-bar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Diagram zoom");

    const mkBtn = (text: string, label: string, action: string, onRun: () => void) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mermaid-zoom-btn";
      btn.dataset.zoomAction = action;
      btn.textContent = text;
      btn.title = label;
      btn.setAttribute("aria-label", label);
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onRun();
      });
      return btn;
    };

    const outBtn = mkBtn("−", "Zoom out", "out", () => {
      zoom = Math.max(MIN_ZOOM, zoom - ZOOM_STEP);
      applyZoom();
    });
    pctEl = document.createElement("span");
    pctEl.className = "mermaid-zoom-pct";
    pctEl.textContent = `${Math.round(zoom * 100)}%`;
    const inBtn = mkBtn("+", "Zoom in", "in", () => {
      zoom = Math.min(MAX_ZOOM, zoom + ZOOM_STEP);
      applyZoom();
    });
    const resetBtn = mkBtn("Reset", "Reset zoom", "reset", () => {
      zoom = 1;
      applyZoom();
    });

    bar.append(outBtn, pctEl, inBtn, resetBtn);
    return bar;
  };

  const onWheel = (e: WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey) || box.dataset.state !== "done") return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.deltaY < 0 ? 0.15 : -0.15;
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom + step));
    applyZoom();
  };
  box.addEventListener("wheel", onWheel, { passive: false });

  const draw = async () => {
    const dark = isDarkTheme();
    lastDark = dark;
    const id = `kdy-mmd-${++mermaidSeq}`;
    try {
      const { default: mermaid } = await import("mermaid");
      if (gone) return;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: dark ? "dark" : "default",
        // the fence shows its own error box; mermaid's error diagram would stay in a temp div on <body>
        suppressErrorRendering: true,
      });
      const { svg, bindFunctions } = await mermaid.render(id, fence.source);
      if (gone) return;
      lastValidSvg = svg;
      rememberValidSvg(fence.path, fence.source, svg);
      box.dataset.state = "done";

      const viewport = document.createElement("div");
      viewport.className = "mermaid-viewport";
      stageEl = document.createElement("div");
      stageEl.className = "mermaid-stage";
      // "strict" already runs DOMPurify with foreignObject as an HTML integration point; an SVG-only
      // second pass removed every foreignObject and with it the node and edge labels
      stageEl.innerHTML = svg;
      bindFunctions?.(stageEl);
      for (const el of stageEl.querySelectorAll("svg")) el.setAttribute("role", "img");
      const svgEl = stageEl.querySelector<SVGElement>("svg");
      origSvgWidth = svgEl?.style.width ?? "";
      origSvgMaxWidth = svgEl?.style.maxWidth ?? "";
      baseWidth = null;
      viewport.append(stageEl);
      box.replaceChildren(buildToolbar(), viewport);
      applyZoom();
    } catch (e) {
      document.getElementById(`d${id}`)?.remove(); // a temp div left by a failed render
      if (gone) return;
      stageEl = null;
      pctEl = null;
      box.dataset.state = "error";
      const title = Object.assign(document.createElement("div"), {
        className: "tikz-error-title",
        textContent: "Mermaid diagram syntax issue",
      });
      const why = Object.assign(document.createElement("pre"), {
        className: "tikz-error-log",
        textContent: errText(e),
      });
      const prevSvg = lastValidSvg ?? findFallbackSvg(fence.path, fence.source, box.closest(".cm-content, .markdown"));
      if (prevSvg) {
        const stale = document.createElement("div");
        stale.className = "mermaid-stale-wrap";
        stale.setAttribute("aria-label", "Last valid diagram preview");
        stale.innerHTML = prevSvg;
        for (const el of stale.querySelectorAll("svg")) el.setAttribute("role", "img");
        box.replaceChildren(title, why, stale);
      } else {
        box.replaceChildren(title, why);
      }
    }
  };

  void draw();

  let mo: MutationObserver | null = null;
  if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
    mo = new MutationObserver(() => {
      const dark = isDarkTheme();
      if (dark !== lastDark && box.dataset.state !== "drawing") void draw();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
  }

  return () => {
    gone = true;
    box.removeEventListener("wheel", onWheel);
    mo?.disconnect();
    mo = null;
    box.remove();
  };
});
