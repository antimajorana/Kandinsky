// Arabic / Hebrew RTL & per-line Unicode BiDi for CodeMirror 6, plus manual document RTL/LTR override (Ctrl+Shift+X
// and `kandinsky:toggle-bidi`) and YAML frontmatter `direction: rtl` / `dir: rtl`. Pure LTR / English notes get zero
// extra attributes or DOM changes.
import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { getDock } from "../dock-instance";
import { fences } from "../fence-walk";
import { toast } from "../state.svelte";
import { frontmatterClose } from "./live/live-preview.js";

// Hebrew (\u0590-\u05FF, \uFB1D-\uFB4F) + Arabic/Syriac/Thaana (\u0600-\u08FF, \uFB50-\uFDFF, \uFE70-\uFEFF) + RLM/ALM
const RTL_CHAR_RE = /[\u0590-\u05FF\u0600-\u08FF\uFB1D-\uFB4F\uFB50-\uFDFF\uFE70-\uFEFF\u200F\u061C]/;
const LTR_CHAR_RE = /\p{L}|\u200E/u;
const MD_PREFIX_RE = /^(?:\s+|#{1,6}(?:\s+|$)|>\s*|\[![A-Za-z0-9_-]+\][+-]?\s*|(?:[-*+]|\d+[.)])\s+|\[[ xX/-]\]\s*|!?\[\[)/;

const rtlLineDeco = Decoration.line({ attributes: { dir: "rtl", class: "cm-rtl-line" } });
const setBidiOverride = StateEffect.define<"rtl" | "ltr" | null>();

export function firstStrongDirection(text: string): "rtl" | "ltr" | null {
  let rest = text;
  while (rest.length > 0) {
    const m = MD_PREFIX_RE.exec(rest);
    if (!m || !m[0].length) break;
    rest = rest.slice(m[0].length);
  }
  for (const ch of rest) {
    if (RTL_CHAR_RE.test(ch)) return "rtl";
    if (LTR_CHAR_RE.test(ch)) return "ltr";
  }
  return null;
}

interface DocBidiMeta { fmClose: number; fmDir: "rtl" | "ltr" | null; excluded: Set<number> | null }
const metaCache = new WeakMap<Text, DocBidiMeta>();

function getDocMeta(doc: Text): DocBidiMeta {
  const hit = metaCache.get(doc);
  if (hit) return hit;
  const fmClose = frontmatterClose(doc);
  let fmDir: "rtl" | "ltr" | null = null;
  for (let n = 2; n < fmClose; n++) {
    const m = /^[ \t]*(?:direction|dir)[ \t]*:[ \t]*["']?(rtl|ltr)["']?[ \t]*$/i.exec(doc.line(n).text);
    if (m) { fmDir = m[1].toLowerCase() as "rtl" | "ltr"; break; }
  }
  const meta: DocBidiMeta = { fmClose, fmDir, excluded: null };
  metaCache.set(doc, meta);
  return meta;
}

function getExcludedLines(doc: Text): Set<number> {
  const meta = getDocMeta(doc);
  if (meta.excluded) return meta.excluded;
  const ex = new Set<number>();
  for (let n = 1; n <= meta.fmClose; n++) ex.add(n);
  const codeWalk = fences();
  let mathCloser: string | null = null;
  for (let n = meta.fmClose + 1; n <= doc.lines; n++) {
    const raw = doc.line(n).text;
    if (codeWalk.code(raw)) { ex.add(n); continue; }
    if (mathCloser !== null) {
      ex.add(n);
      if (raw.includes(mathCloser)) mathCloser = null;
      continue;
    }
    const trimmed = raw.replace(/^[ \t>]+/, "");
    if (trimmed.startsWith("$$")) {
      ex.add(n);
      if (trimmed.indexOf("$$", 2) < 0) mathCloser = "$$";
    } else if (trimmed.startsWith("\\[")) {
      ex.add(n);
      if (!trimmed.includes("\\]")) mathCloser = "\\]";
    } else {
      const env = /^\\begin\{(equation|align|gather|multline|eqnarray)(\*?)\}/.exec(trimmed);
      if (env) {
        ex.add(n);
        const closer = `\\end{${env[1]}${env[2]}}`;
        if (!trimmed.includes(closer)) mathCloser = closer;
      }
    }
  }
  meta.excluded = ex;
  return ex;
}

const bidiOverrideField = StateField.define<"rtl" | "ltr" | null>({
  create: () => null,
  update(val, tr) {
    for (const e of tr.effects) if (e.is(setBidiOverride)) val = e.value;
    return val;
  },
});

const effectiveDocDir = (state: EditorState): "rtl" | "ltr" | null =>
  state.field(bidiOverrideField, false) ?? getDocMeta(state.doc).fmDir;

function syncInlineTitleDir(root: HTMLElement, dir: "rtl" | "ltr" | null): void {
  for (const el of root.querySelectorAll<HTMLElement>(".inline-title")) {
    if (dir) el.setAttribute("dir", dir);
    else if (el.hasAttribute("dir")) el.removeAttribute("dir");
  }
}

function buildLineBidiDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  if (effectiveDocDir(state) === "ltr") return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  let excluded: Set<number> | null = null;
  let lastLine = 0;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (line.number <= lastLine || !RTL_CHAR_RE.test(line.text)) continue;
      lastLine = line.number;
      excluded ??= getExcludedLines(state.doc);
      if (!excluded.has(line.number) && firstStrongDirection(line.text) === "rtl") {
        builder.add(line.from, line.from, rtlLineDeco);
      }
    }
  }
  return builder.finish();
}

function findActiveEditorView(): EditorView | null {
  if (typeof document === "undefined") return null;
  const activeEl = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(".cm-editor");
  if (activeEl) { const v = EditorView.findFromDOM(activeEl); if (v) return v; }
  const panelEl = getDock()?.activePanel?.view.content.element.querySelector<HTMLElement>(".cm-editor");
  if (panelEl) { const v = EditorView.findFromDOM(panelEl); if (v) return v; }
  for (const el of document.querySelectorAll<HTMLElement>(".cm-editor.live-cm, .cm-editor")) {
    if (el.getClientRects().length > 0) { const v = EditorView.findFromDOM(el); if (v) return v; }
  }
  return null;
}

export function toggleEditorRtl(view?: EditorView | null): "rtl" | "ltr" {
  const target = view ?? findActiveEditorView();
  const cur = target ? (effectiveDocDir(target.state) ?? (target.contentDOM.getAttribute("dir") === "rtl" ? "rtl" : "ltr")) : "ltr";
  const next: "rtl" | "ltr" = cur === "rtl" ? "ltr" : "rtl";
  if (target) {
    if (target.state.field(bidiOverrideField, false) !== undefined) target.dispatch({ effects: setBidiOverride.of(next) });
    target.dom.classList.toggle("is-rtl-override", next === "rtl");
    target.contentDOM.setAttribute("dir", next);
    syncInlineTitleDir(target.dom, next);
  }
  toast(next === "rtl" ? "Text direction: Right-to-Left (RTL)" : "Text direction: Left-to-Right (LTR)");
  return next;
}

let bidiWindowBound = false;
function ensureWindowBidiListener(): void {
  if (bidiWindowBound || typeof window === "undefined") return;
  bidiWindowBound = true;
  window.addEventListener("kandinsky:toggle-bidi", (e: Event) => {
    toggleEditorRtl((e as CustomEvent<{ view?: EditorView | null }>).detail?.view ?? null);
  });
}
ensureWindowBidiListener();

const bidiPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  private appliedDir: "rtl" | "ltr" | null = null;
  constructor(view: EditorView) {
    ensureWindowBidiListener();
    this.decorations = buildLineBidiDecorations(view);
    this.syncTitle(view);
  }
  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged || u.transactions.some((tr) => tr.effects.some((e) => e.is(setBidiOverride)))) {
      this.decorations = buildLineBidiDecorations(u.view);
    }
    this.syncTitle(u.view);
  }
  private syncTitle(view: EditorView) {
    const dir = effectiveDocDir(view.state);
    if (dir !== this.appliedDir || dir !== null) {
      this.appliedDir = dir;
      syncInlineTitleDir(view.dom, dir);
    }
  }
}, { decorations: (v) => v.decorations });

const EMPTY_ATTRS: Record<string, string> = {};

export function bidiExtension(): Extension {
  ensureWindowBidiListener();
  return [
    bidiOverrideField,
    EditorView.editorAttributes.compute(["doc", bidiOverrideField], (s): Record<string, string> => (effectiveDocDir(s) === "rtl" ? { class: "is-rtl-override" } : EMPTY_ATTRS)),
    EditorView.contentAttributes.compute(["doc", bidiOverrideField], (s): Record<string, string> => { const d = effectiveDocDir(s); return d ? { dir: d } : EMPTY_ATTRS; }),
    keymap.of([{ key: "Mod-Shift-x", run: (v) => (toggleEditorRtl(v), true) }]),
    bidiPlugin,
  ];
}
