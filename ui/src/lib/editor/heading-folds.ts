// Subtle hover fold chevrons on H1-H6 headings with "▸ ⋯ N blocks hidden" pill when folded.
import { foldable, foldEffect, foldedRanges, unfoldEffect } from "@codemirror/language";
import { RangeSetBuilder, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { fences } from "../fence-walk";
import { settings } from "../settings.svelte";
import { frontmatterClose } from "./live/live-preview.js";

const HEADING_RE = /^\s{0,3}(#{1,6})\s+\S/;
const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s+/;
const BLOCKQUOTE_RE = /^\s*>/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const HR_RE = /^\s{0,3}(?:([-*_])(?:\s*\1){2,})\s*$/;
const MATH_OPEN_RE = /^\s*(?:\$\$|\\\[|\\begin\{(?:equation|align|gather|multline|eqnarray)\*?\})/;

function headingSectionRange(state: EditorState, lineNumber: number, level: number): { from: number; to: number } | null {
  const f = foldable(state, state.doc.line(lineNumber).from, state.doc.line(lineNumber).to);
  if (f && f.to > f.from) return f;

  const doc = state.doc;
  const openLine = doc.line(lineNumber);
  let endLine = lineNumber;
  const walk = fences();
  for (let i = lineNumber + 1; i <= doc.lines; i++) {
    const txt = doc.line(i).text;
    if (!walk.code(txt)) {
      const hm = HEADING_RE.exec(txt);
      if (hm && hm[1].length <= level) break;
    }
    endLine = i;
  }
  while (endLine > lineNumber && doc.line(endLine).text.trim() === "") endLine--;
  if (endLine <= lineNumber) return null;
  return { from: openLine.to, to: doc.line(endLine).to };
}

/** Counts logical Markdown blocks between line `fromLine` and `toLine` (inclusive). */
function countLogicalBlocks(state: EditorState, fromLine: number, toLine: number): number {
  const doc = state.doc;
  const lo = Math.max(1, fromLine);
  const hi = Math.min(doc.lines, toLine);
  if (hi < lo) return 0;

  let blocks = 0;
  const walk = fences();
  let inFence = false;
  let inMath = false;
  let mathCloser = "";
  let curKind: "none" | "para" | "quote" | "table" = "none";

  const flush = () => {
    curKind = "none";
  };

  for (let i = lo; i <= hi; i++) {
    const txt = doc.line(i).text;
    const trimmed = txt.trim();

    // Fenced code blocks count as 1 block from opening fence to closing fence.
    const isCodeLine = walk.code(txt);
    if (isCodeLine) {
      if (!inFence) {
        flush();
        blocks++;
        inFence = true;
      }
      continue;
    }
    if (inFence) {
      inFence = false;
    }

    // Display math blocks (`$$...$$`, `\[...\]`, `\begin{...}...\end{...}`).
    if (inMath) {
      if (mathCloser && txt.includes(mathCloser)) {
        inMath = false;
        mathCloser = "";
      }
      continue;
    }
    if (MATH_OPEN_RE.test(txt)) {
      flush();
      blocks++;
      const t = txt.trimStart();
      if (t.startsWith("$$")) {
        if (t.indexOf("$$", 2) < 0) {
          inMath = true;
          mathCloser = "$$";
        }
      } else if (t.startsWith("\\[")) {
        if (!t.includes("\\]")) {
          inMath = true;
          mathCloser = "\\]";
        }
      } else {
        const bm = /^\\begin\{([a-zA-Z]+\*?)\}/.exec(t);
        if (bm && !t.includes(`\\end{${bm[1]}}`)) {
          inMath = true;
          mathCloser = `\\end{${bm[1]}}`;
        }
      }
      continue;
    }

    if (!trimmed) {
      flush();
      continue;
    }

    if (HEADING_RE.test(txt) || HR_RE.test(txt)) {
      flush();
      blocks++;
      continue;
    }

    if (LIST_ITEM_RE.test(txt)) {
      flush();
      blocks++;
      continue;
    }

    if (BLOCKQUOTE_RE.test(txt)) {
      if (curKind !== "quote") {
        blocks++;
        curKind = "quote";
      }
      continue;
    }

    if (TABLE_ROW_RE.test(txt)) {
      if (curKind !== "table") {
        blocks++;
        curKind = "table";
      }
      continue;
    }

    if (curKind !== "para") {
      blocks++;
      curKind = "para";
    }
  }

  return Math.max(1, blocks);
}

class HeadingFoldWidget extends WidgetType {
  constructor(
    readonly lineNumber: number,
    readonly level: number,
    readonly foldedBlocks: number,
  ) {
    super();
  }

  eq(other: HeadingFoldWidget): boolean {
    return this.lineNumber === other.lineNumber && this.level === other.level && this.foldedBlocks === other.foldedBlocks;
  }

  toDOM(view: EditorView): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = this.foldedBlocks > 0 ? "cm-h-fold is-folded" : "cm-h-fold";
    const blockWord = this.foldedBlocks === 1 ? "block" : "blocks";
    btn.title = this.foldedBlocks > 0 ? `Unfold section (${this.foldedBlocks} ${blockWord})` : "Collapse heading section";
    btn.setAttribute("aria-label", btn.title);
    btn.textContent = this.foldedBlocks > 0 ? `▸ ⋯ ${this.foldedBlocks} ${blockWord} hidden` : "▾";
    btn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const doc = view.state.doc;
      if (this.lineNumber > doc.lines) return;
      const line = doc.line(this.lineNumber);
      const folded = foldedRanges(view.state);
      let hit: { from: number; to: number } | null = null;
      folded.between(line.from, line.to + 1, (from, to) => {
        if (!hit && from >= line.from && from <= line.to) hit = { from, to };
      });
      if (hit) {
        view.dispatch({ effects: unfoldEffect.of(hit) });
        return;
      }
      const range = headingSectionRange(view.state, this.lineNumber, this.level);
      if (range && range.to > range.from) view.dispatch({ effects: foldEffect.of(range) });
    });
    return btn;
  }

  ignoreEvent(): boolean { return true; }
}

function buildDecorations(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  if (settings.config?.editor.fold_headings === false) return b.finish();
  const doc = view.state.doc;
  const fmEnd = frontmatterClose(doc);
  const folded = foldedRanges(view.state);
  const walk = fences();

  for (let i = fmEnd + 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    if (walk.code(line.text)) continue;
    const hm = HEADING_RE.exec(line.text);
    if (!hm) continue;
    let hiddenBlocks = 0;
    folded.between(line.from, line.to + 1, (from, to) => {
      if (from >= line.from && from <= line.to) {
        const endLine = doc.lineAt(to).number;
        hiddenBlocks = countLogicalBlocks(view.state, line.number + 1, endLine);
      }
    });
    const range = hiddenBlocks > 0 ? null : headingSectionRange(view.state, i, hm[1].length);
    if (!range && hiddenBlocks === 0) continue;
    b.add(line.to, line.to, Decoration.widget({ widget: new HeadingFoldWidget(i, hm[1].length, hiddenBlocks), side: 1 }));
  }
  return b.finish();
}

const headingFoldsTheme = EditorView.baseTheme({
  ".cm-h-fold": {
    display: "inline-flex",
    alignItems: "center",
    marginLeft: "8px",
    padding: "1px 6px",
    border: "1px solid transparent",
    borderRadius: "999px",
    background: "transparent",
    color: "var(--text-faint)",
    fontSize: "11px",
    lineHeight: "1.3",
    cursor: "pointer",
    opacity: "0",
    transition: "opacity 120ms ease, background 120ms ease, color 120ms ease",
    verticalAlign: "middle",
  },
  ".cm-line:hover .cm-h-fold, .cm-activeLine .cm-h-fold, .cm-h-fold:focus-visible": {
    opacity: "0.85",
  },
  ".cm-h-fold.is-folded": {
    opacity: "1",
    background: "var(--bg-side)",
    borderColor: "var(--border)",
    color: "var(--text-muted)",
  },
  ".cm-h-fold:hover": {
    opacity: "1",
    background: "var(--accent-soft)",
    borderColor: "var(--accent)",
    color: "var(--accent)",
  },
});

export function headingFoldsExtension(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) { this.decorations = buildDecorations(view); }
        update(u: ViewUpdate): void {
          if (u.docChanged || u.viewportChanged || u.transactions.some((t) => t.effects.length > 0)) {
            this.decorations = buildDecorations(u.view);
          }
        }
      },
      { decorations: (v) => v.decorations },
    ),
    headingFoldsTheme,
  ];
}
