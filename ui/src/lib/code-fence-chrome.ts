// Quiet Notion header chrome (language pill + 1-click Copy button) for rendered fenced code blocks & CM Live Preview.
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";

const STYLE_ID = "kandinsky-code-fence-chrome-css";

function ensureStyles(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.markdown pre:has(> .code-fence-bar),
pre:has(> .code-fence-bar) {
  position: relative;
  padding-top: 14px;
}
.markdown pre > .code-fence-bar,
pre > .code-fence-bar {
  position: absolute;
  top: 6px;
  right: 8px;
  left: auto;
  height: auto;
  width: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px 2px 8px;
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
  z-index: 2;
}
.markdown pre:hover > .code-fence-bar,
.markdown pre:focus-within > .code-fence-bar,
.markdown pre > .code-fence-bar[data-copied="1"],
pre:hover > .code-fence-bar,
pre:focus-within > .code-fence-bar,
pre > .code-fence-bar[data-copied="1"],
:root[data-touch] .markdown pre > .code-fence-bar,
:root[data-touch] pre > .code-fence-bar {
  opacity: 1;
  pointer-events: auto;
}
.markdown pre > .code-fence-bar .code-fence-lang,
pre > .code-fence-bar .code-fence-lang {
  text-transform: lowercase;
  font-family: var(--font-mono);
  letter-spacing: .02em;
  user-select: none;
}
.markdown pre > .code-fence-bar .code-fence-copy,
pre > .code-fence-bar .code-fence-copy {
  padding: 1px 7px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-muted);
  font-size: calc(11px * var(--ui-scale, 1));
  cursor: pointer;
}
.markdown pre > .code-fence-bar .code-fence-copy:hover,
pre > .code-fence-bar .code-fence-copy:hover {
  background: var(--bg-hover);
  color: var(--heading);
  border-color: var(--border-strong);
}
`;
  document.head.append(style);
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fallback below */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function enhanceCodeBlocks(root: HTMLElement): () => void {
  ensureStyles();
  const cleanups: (() => void)[] = [];
  for (const pre of root.querySelectorAll<HTMLPreElement>("pre:not([data-code-chrome])")) {
    if (pre.hidden || pre.classList.contains("tikz-error-log") || pre.closest(".tikz-figure, .mermaid-figure, .email-html, .base, .cm-math-block")) continue;
    const code = pre.querySelector<HTMLElement>("code");
    if (!code) continue;
    pre.dataset.codeChrome = "1";

    const langNodes = [...pre.querySelectorAll<HTMLElement>(":scope > .code-lang")];
    const langFromSpan = langNodes[0]?.textContent?.trim();
    const m = /language-([^\s]+)/.exec(code.className);
    const lang = langFromSpan || m?.[1]?.trim() || "text";
    for (const el of langNodes) el.remove();

    const bar = document.createElement("div");
    bar.className = "code-fence-bar";
    const lbl = document.createElement("span");
    lbl.className = "code-fence-lang";
    lbl.textContent = lang;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "code-fence-copy";
    btn.textContent = "Copy";
    btn.setAttribute("aria-label", `Copy ${lang} code`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const raw = (code.textContent ?? "").replace(/\n$/, "");
      void copyText(raw).then((ok) => {
        if (!ok) return;
        btn.textContent = "Copied";
        bar.dataset.copied = "1";
        clearTimeout(timer);
        timer = setTimeout(() => {
          btn.textContent = "Copy";
          delete bar.dataset.copied;
        }, 1400);
      });
    };
    bar.addEventListener("mousedown", onMouseDown);
    btn.addEventListener("mousedown", onMouseDown);
    btn.addEventListener("click", onClick);
    bar.append(lbl, btn);
    pre.prepend(bar);

    cleanups.push(() => {
      clearTimeout(timer);
      bar.removeEventListener("mousedown", onMouseDown);
      btn.removeEventListener("mousedown", onMouseDown);
      btn.removeEventListener("click", onClick);
      bar.remove();
      delete pre.dataset.codeChrome;
    });
  }
  return () => { for (const c of cleanups) c(); };
}

class CodeFenceChromeWidget extends WidgetType {
  constructor(readonly lang: string, readonly from: number, readonly to: number) { super(); }
  eq(o: CodeFenceChromeWidget): boolean { return o.lang === this.lang && o.from === this.from && o.to === this.to; }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-code-fence-chrome";
    const lbl = document.createElement("span");
    lbl.className = "code-fence-lang";
    lbl.textContent = this.lang || "text";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "code-fence-copy";
    btn.textContent = "Copy";
    btn.setAttribute("aria-label", `Copy ${this.lang || "text"} code`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    btn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const code = view.state.sliceDoc(this.from, this.to);
      void copyText(code).then((ok) => {
        if (!ok) return;
        btn.textContent = "Copied";
        clearTimeout(timer);
        timer = setTimeout(() => { btn.textContent = "Copy"; }, 1400);
      });
    });
    wrap.append(lbl, btn);
    return wrap;
  }
  ignoreEvent(): boolean { return true; }
}

function buildFenceDecos(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  syntaxTree(view.state).iterate({
    enter(node) {
      if (node.name !== "FencedCode") return;
      const openLine = doc.lineAt(node.from);
      const info = node.node.getChild("CodeInfo");
      const text = node.node.getChild("CodeText");
      const lang = info ? doc.sliceString(info.from, info.to).trim().split(/\s+/)[0] : "text";
      const from = text ? text.from : openLine.to;
      const to = text ? text.to : openLine.to;
      b.add(openLine.to, openLine.to, Decoration.widget({ widget: new CodeFenceChromeWidget(lang, from, to), side: 1 }));
    },
  });
  return b.finish();
}

export function codeFenceChromeExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) { this.decorations = buildFenceDecos(view); }
      update(u: ViewUpdate): void {
        if (u.docChanged || u.viewportChanged) this.decorations = buildFenceDecos(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
}
