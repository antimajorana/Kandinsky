// "preview latex formulas while i write them": while the caret is inside a formula, the formula is drawn
// as it will look, updated at every key. Display math (`$$…$$` in a note; `\[…\]`, `$$…$$` and the equation
// environments in a .tex file) is drawn as a block under the formula, in the text — as an image shows under
// its link while the link is edited, never floating over the next lines. Inline math (`$…$`, `\(…\)`) floats
// in a small box above its line, so the completion list (snippets, commands), which opens below the caret,
// never covers it. A formula that does not parse yet shows the last good drawing dimmed, with KaTeX's
// message — so the drawing does not flicker while typing.
import { errText } from "../text";
import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, showTooltip, type DecorationSet, type Tooltip } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { katexNow, loadMath, renderMathInto } from "../math";

interface Formula { from: number; to: number; source: string; block: boolean; label?: string }

const isMath = (name: string) => name === "InlineMath" || name === "BlockMath";

function normalizePreviewTex(raw: string, block: boolean): { source: string; label?: string } {
  let s = raw;
  if (block) {
    s = s.replace(/[ \t]*\^[A-Za-z0-9:_-]+[ \t]*$/, "");
    s = s.replace(/^\s*(\$\$|\\\[)|(\$\$|\\\])\s*$/g, "");
  } else if (s.startsWith("$") && s.endsWith("$") && s.length >= 2) {
    s = s.slice(1, -1);
  }
  const label = /\\label\{([^}]+)\}/.exec(s)?.[1]?.trim();
  s = s.replace(/\\label\{[^}]*\}/g, "");
  if (block) {
    s = s.replace(/\\(begin|end)\{(equation|align|gather|multline|eqnarray)(\*?)\}/g, (_m, be: string, env: string) =>
      env === "equation" || env === "multline" ? "" : `\\${be}{${env === "align" || env === "eqnarray" ? "aligned" : "gathered"}}`);
  }
  return { source: s.trim(), label };
}

function formulaOf(state: EditorState, n: { name: string; from: number; to: number }): Formula | null {
  const block = n.name === "BlockMath";
  const { source, label } = normalizePreviewTex(state.sliceDoc(n.from, n.to), block);
  return source ? { from: n.from, to: n.to, source, block, label } : null;
}

/** In a note: the formula whose source the editor shows — the one the caret touches, its dollars included, the rule the
 *  live preview reveals by (live-preview.js `revealed`) — from the markdown tree; else an unclosed environment / inline
 *  formula still being typed. */
function noteFormulaAt(state: EditorState): Formula | null {
  const sel = state.selection.main;
  if (!sel.empty) return null;
  const pos = sel.head;
  let found: Formula | null = null;
  syntaxTree(state).iterate({
    from: pos, to: pos,
    enter: (n) => {
      if (found) return false;
      if (!isMath(n.name)) return;
      if (n.from <= pos && pos <= n.to) found = formulaOf(state, n);
      return false;
    },
  });
  return found ?? texFormulaAt(state) ?? typedInline(state, pos);
}

function typedInline(state: EditorState, pos: number): Formula | null {
  // an inline formula being typed: an odd number of `$` before the caret on this line, none closing it yet
  const line = state.doc.lineAt(pos), before = line.text.slice(0, pos - line.from);
  const dollars = [...before.matchAll(/(?<!\\)\$/g)];
  if (dollars.length % 2 === 0 || before.endsWith("$$")) return null;
  const open = dollars[dollars.length - 1].index;
  const rest = line.text.slice(pos - line.from), close = rest.search(/(?<!\\)\$/);
  const source = (before.slice(open + 1) + (close >= 0 ? rest.slice(0, close) : "")).trim();
  return source ? { from: line.from + open, to: pos + Math.max(close, 0), source, block: false } : null;
}

// .tex delimiters. Environments KaTeX knows only in their inner form (align → aligned) are wrapped;
// equation's body is a plain display formula.
type Delim = { open: RegExp; close: (m: RegExpMatchArray) => string; block: boolean; wrap: (body: string, m: RegExpMatchArray) => string };
const ENV = "(equation|align|gather|multline|eqnarray|displaymath)(\\*?)";
const TEX: Delim[] = [
  { open: /\\\[/g, close: () => "\\]", block: true, wrap: (b) => b },
  { open: /(?<!\\)\$\$/g, close: () => "$$", block: true, wrap: (b) => b },
  {
    open: new RegExp(`\\\\begin\\{${ENV}\\}`, "g"), close: (m) => `\\end{${m[1]}${m[2]}}`, block: true,
    wrap: (b, m) => (m[1] === "align" || m[1] === "eqnarray" ? `\\begin{aligned}${b}\\end{aligned}` : m[1] === "gather" ? `\\begin{gathered}${b}\\end{gathered}` : b),
  },
  { open: /\\\(/g, close: () => "\\)", block: false, wrap: (b) => b },
  { open: /(?<![\\$])\$(?!\$)/g, close: () => "$", block: false, wrap: (b) => b },
];

/** In a .tex file: the innermost formula around the caret — the latest opener before it not closed before it. */
function texFormulaAt(state: EditorState): Formula | null {
  const sel = state.selection.main;
  if (!sel.empty) return null;
  const pos = sel.head, start = Math.max(0, pos - 4000);
  const before = state.sliceDoc(start, pos), after = state.sliceDoc(pos, Math.min(state.doc.length, pos + 4000));
  let best: Formula | null = null, bestAt = -1;
  for (const d of TEX) {
    for (const m of before.matchAll(d.open)) {
      const at = m.index ?? 0, closer = d.close(m), body = at + m[0].length;
      // a single `$` opens only after an even number of them (else it closes one)
      if (closer === "$" && (before.slice(0, at).match(/(?<![\\$])\$(?!\$)/g)?.length ?? 0) % 2 === 1) continue;
      if (before.indexOf(closer, body) >= 0) continue; // closed before the caret
      const end = after.indexOf(closer);
      const inner = (before.slice(body) + (end >= 0 ? after.slice(0, end) : after.split("\n")[0])).trim();
      if (at > bestAt && inner) {
        bestAt = at;
        const { source, label } = normalizePreviewTex(d.wrap(inner, m), d.block);
        if (source) best = { from: start + at, to: end >= 0 ? pos + end + closer.length : pos, source, block: d.block, label };
      }
    }
  }
  return best;
}

// one drawing per editor state would redraw (and flicker) at every key: the last good one is kept here
let lastGood = "";
const refreshMathPreview = StateEffect.define<null>();

function draw(f: Formula, view?: EditorView): HTMLElement {
  const dom = document.createElement("div");
  dom.className = "cm-math-preview";
  const card = f.block ? dom.appendChild(document.createElement("div")) : dom;
  if (f.block) card.className = "cm-math-preview-card";
  if (f.block && f.label) {
    const meta = card.appendChild(document.createElement("div"));
    meta.className = "cm-math-preview-meta";
    meta.textContent = `\\label{${f.label}}`;
  }
  const body = card.appendChild(document.createElement("div"));
  body.className = "cm-math-preview-body";
  const resolved = f.source.replace(/\\eqref\{([^}]+)\}/g, (_m, id: string) => `\\text{(${id.trim()})}`);
  let failed: string | null = null;
  try {
    renderMathInto(body, resolved, f.block);
    if (!katexNow()) {
      void loadMath().then(() => {
        renderMathInto(body, resolved, f.block);
        view?.dispatch({ effects: refreshMathPreview.of(null) });
      });
    }
    // the renderer does not throw on a formula it cannot read: it draws the source in red, with the reason as its title
    failed = body.querySelector<HTMLElement>(".katex-error")?.title ?? null;
  } catch (e) { failed = errText(e); }
  if (failed === null) { lastGood = body.innerHTML; return dom; }
  body.innerHTML = lastGood; // what it looked like before this keystroke broke it
  body.classList.add("stale");
  const why = card.appendChild(document.createElement("div"));
  why.className = "why";
  why.textContent = failed.replace(/^(KaTeX parse error|ParseError):\s*/, "");
  return dom;
}

/** A display formula's drawing, in the text under its last line. */
class BlockPreview extends WidgetType {
  constructor(readonly f: Formula) { super(); }
  eq(o: BlockPreview) { return o.f.source === this.f.source && o.f.label === this.f.label && Boolean(katexNow()); }
  toDOM(view: EditorView) { const d = draw(this.f, view); d.classList.add("cm-math-preview-block"); return d; }
  ignoreEvent() { return true; }
}

interface Shown { tip: Tooltip | null; block: DecorationSet }
const NONE: Shown = { tip: null, block: Decoration.none };

function shown(state: EditorState, at: (s: EditorState) => Formula | null, on: () => boolean): Shown {
  if (!on()) return NONE;
  const f = at(state);
  if (!f) return NONE;
  if (f.block) {
    const end = state.doc.lineAt(f.to).to;
    return { tip: null, block: Decoration.set([Decoration.widget({ widget: new BlockPreview(f), block: true, side: 1 }).range(end)]) };
  }
  return { tip: { pos: f.from, above: true, arrow: false, create: (view) => ({ dom: draw(f, view) }) }, block: Decoration.none };
}

/** `tex`: a .tex file (its own delimiters); otherwise a note. */
export function mathPreview(on: () => boolean, tex = false): Extension {
  const at = tex ? texFormulaAt : noteFormulaAt;
  return StateField.define<Shown>({
    create: (state) => shown(state, at, on),
    update: (value, tr) => (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(refreshMathPreview)) ? shown(tr.state, at, on) : value),
    provide: (f) => [showTooltip.from(f, (v) => v.tip), EditorView.decorations.from(f, (v) => v.block)],
  });
}
