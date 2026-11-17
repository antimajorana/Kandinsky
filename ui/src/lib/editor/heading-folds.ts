// Subtle hover fold chevrons on H1-H4 headings with "⋯ N lines hidden" pill when folded.
import { foldable, foldEffect, foldedRanges, unfoldEffect } from "@codemirror/language";
import { RangeSetBuilder, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { fences } from "../fence-walk";
import { frontmatterClose } from "./live/live-preview.js";

const HEADING_RE = /^\s{0,3}(#{1,4})\s+\S/;

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

class HeadingFoldWidget extends WidgetType {
  constructor(
    readonly lineNumber: number,
    readonly level: number,
    readonly foldedLines: number,
  ) {
    super();
  }

  eq(other: HeadingFoldWidget): boolean {
    return this.lineNumber === other.lineNumber && this.level === other.level && this.foldedLines === other.foldedLines;
  }

  toDOM(view: EditorView): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = this.foldedLines > 0 ? "cm-h-fold is-folded" : "cm-h-fold";
    btn.title = this.foldedLines > 0 ? `Unfold section (${this.foldedLines} lines)` : "Collapse heading section";
    btn.setAttribute("aria-label", btn.title);
    btn.textContent = this.foldedLines > 0 ? `▸ ⋯ ${this.foldedLines} lines hidden` : "▾";
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
  const doc = view.state.doc;
  const fmEnd = frontmatterClose(doc);
  const folded = foldedRanges(view.state);
  const walk = fences();

  for (let i = fmEnd + 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    if (walk.code(line.text)) continue;
    const hm = HEADING_RE.exec(line.text);
    if (!hm) continue;
    let hiddenLines = 0;
    folded.between(line.from, line.to + 1, (from, to) => {
      if (from >= line.from && from <= line.to) {
        hiddenLines = Math.max(1, doc.lineAt(to).number - line.number);
      }
    });
    const range = hiddenLines > 0 ? null : headingSectionRange(view.state, i, hm[1].length);
    if (!range && hiddenLines === 0) continue;
    b.add(line.to, line.to, Decoration.widget({ widget: new HeadingFoldWidget(i, hm[1].length, hiddenLines), side: 1 }));
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
