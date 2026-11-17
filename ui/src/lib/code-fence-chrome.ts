// Quiet Notion header chrome (language pill + 1-click Copy button) for rendered fenced code blocks & CM Live Preview.
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";

export function enhanceCodeBlocks(root: HTMLElement): () => void {
  const cleanups: (() => void)[] = [];
  for (const pre of root.querySelectorAll<HTMLPreElement>("pre:not([data-code-chrome])")) {
    if (pre.classList.contains("tikz-error-log") || pre.closest(".cm-editor")) continue;
    const code = pre.querySelector<HTMLElement>("code");
    if (!code) continue;
    pre.dataset.codeChrome = "1";

    const m = /language-([^\s]+)/.exec(code.className);
    const lang = m?.[1]?.trim() || "text";

    const bar = document.createElement("div");
    bar.className = "code-fence-bar";
    const lbl = document.createElement("span");
    lbl.className = "code-fence-lang";
    lbl.textContent = lang;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "code-fence-copy";
    btn.textContent = "Copy";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const raw = code.textContent ?? "";
      void navigator.clipboard?.writeText(raw).then(() => {
        btn.textContent = "Copied";
        clearTimeout(timer);
        timer = setTimeout(() => { btn.textContent = "Copy"; }, 1400);
      });
    };
    btn.addEventListener("click", onClick);
    bar.append(lbl, btn);
    pre.prepend(bar);

    cleanups.push(() => {
      clearTimeout(timer);
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
    btn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const code = view.state.sliceDoc(this.from, this.to);
      void navigator.clipboard?.writeText(code).then(() => {
        btn.textContent = "Copied";
        setTimeout(() => { btn.textContent = "Copy"; }, 1400);
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
