// Live Preview decorations for Kandinsky rich writing blocks:
// - NoteCraft-style inline semantic badges ([!], [?], [*], [i], standalone TODO: / [TODO])
// - Bauhaus pigment inline spans (<span data-color="…"> & <mark data-bg="…">)
// - Interactive Table of Contents card ([[_TOC_]] / [TOC] on its own line)
// - Collapsible Notion-style <details><summary>…</summary>…</details> toggles
import { Prec, StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { fences } from "../fence-walk";
import { frontmatterClose } from "./live/live-preview.js";

export interface TocHeading {
  line: number;
  level: number;
  title: string;
}

interface DetailsSpan {
  openLine: number;
  openPos: number;
  summaryEndLine: number;
  closeLine: number;
  defaultOpen: boolean;
  multiBlock: boolean;
}

interface DocMeta {
  fmClose: number;
  fencedLines: Set<number>;
  headings: TocHeading[];
  detailsBlocks: DetailsSpan[];
}

const TOC_LINE_RE = /^[ \t]*(?:\[\[_TOC_\]\]|\[TOC\])[ \t]*$/i;
const ATX_HEADING_RE = /^ {0,3}(#{1,4})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const DETAILS_OPEN_RE = /^[ \t]*<details\b([^>]*)>/i;
const DETAILS_CLOSE_RE = /^[ \t]*<\/details\s*>[ \t]*$/i;
const PIGMENT_SPAN_RE = /<(span|mark)\s+data-(color|bg)="(cobalt|ochre|viridian|vermilion|mauve)"\s*>([^\n]*?)<\/\1\s*>/gi;
const SEM_LINE_RE = /(^|[\s(>—–-])(\[([!?*i])\]|\[TODO\]|TODO:(?=\s|$))(?=$|[\s.,;:!?)}\]])/g;
const LINE_CLAUSE_START_RE = /^(?:\s*(?:>\s*)*(?:(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?)?|.*[:;—–(]\s*)$/;

type SemKind = "important" | "question" | "idea" | "info" | "todo";
const SEM_SPECS: Record<string, { kind: SemKind; glyph: string; title: string }> = {
  "!": { kind: "important", glyph: "▲", title: "Important" },
  "?": { kind: "question", glyph: "?", title: "Question" },
  "*": { kind: "idea", glyph: "✦", title: "Idea" },
  i: { kind: "info", glyph: "■", title: "Remember" },
  TODO: { kind: "todo", glyph: "TODO", title: "To-do" },
};

const metaCache = new WeakMap<object, DocMeta>();

function cleanHeadingTitle(raw: string): string {
  return raw
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/<[^>]+>|[*_`~]|==/g, "")
    .trim();
}

function getDocMeta(state: EditorState): DocMeta {
  const hit = metaCache.get(state.doc);
  if (hit) return hit;
  const doc = state.doc;
  const fmClose = frontmatterClose(doc);
  const walk = fences();
  const fencedLines = new Set<number>();
  const headings: TocHeading[] = [];
  const detailsStack: { openLine: number; openPos: number; defaultOpen: boolean }[] = [];
  const detailsBlocks: DetailsSpan[] = [];

  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (n <= fmClose) continue;
    if (walk.code(line.text)) {
      fencedLines.add(n);
      continue;
    }
    const h = ATX_HEADING_RE.exec(line.text);
    if (h) {
      const title = cleanHeadingTitle(h[2]);
      if (title) headings.push({ line: n, level: h[1].length, title });
    }
    const dOpen = DETAILS_OPEN_RE.exec(line.text);
    if (dOpen && !/<\/details\s*>/i.test(line.text)) {
      detailsStack.push({ openLine: n, openPos: line.from, defaultOpen: /\bopen\b/i.test(dOpen[1]) });
      continue;
    }
    if (DETAILS_CLOSE_RE.test(line.text) && detailsStack.length > 0) {
      const top = detailsStack.pop()!;
      let summaryEndLine = top.openLine;
      for (let k = top.openLine; k < Math.min(n, top.openLine + 5); k++) {
        if (/<\/summary\s*>/i.test(doc.line(k).text)) {
          summaryEndLine = k;
          break;
        }
      }
      let multiBlock = false;
      for (let k = top.openLine; k < n; k++) {
        if (!doc.line(k).text.trim()) {
          multiBlock = true;
          break;
        }
      }
      detailsBlocks.push({
        openLine: top.openLine,
        openPos: top.openPos,
        summaryEndLine,
        closeLine: n,
        defaultOpen: top.defaultOpen,
        multiBlock,
      });
    }
  }

  const meta: DocMeta = { fmClose, fencedLines, headings, detailsBlocks };
  metaCache.set(doc, meta);
  return meta;
}

/** Extracts `#`..`####` headings in `state.doc`, skipping YAML frontmatter and fenced code blocks. */
export function extractTocHeadings(state: EditorState): TocHeading[] {
  return getDocMeta(state).headings;
}

function revealed(state: EditorState, from: number, to: number): boolean {
  for (const r of state.selection.ranges) {
    if (r.from <= to && r.to >= from) return true;
  }
  return false;
}

const BLOCKED_ALWAYS = new Set([
  "FencedCode", "CodeBlock", "InlineCode", "CodeText", "CodeMark",
  "InlineMath", "BlockMath", "MathMark", "HTMLBlock", "Table", "CommentBlock", "Comment",
]);
const BLOCKED_SEMANTIC = new Set([
  "Link", "URL", "Wikilink", "Embed", "TaskMarker", "HTMLTag", "Autolink",
]);

function isBlockedNode(state: EditorState, pos: number, allowHtmlSpan: boolean): boolean {
  for (let n: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (BLOCKED_ALWAYS.has(n.name)) return true;
    if (!allowHtmlSpan) {
      if (n.name === "Link") {
        if (n.getChild("URL") || n.getChild("LinkLabel")) return true;
      } else if (BLOCKED_SEMANTIC.has(n.name)) {
        return true;
      }
    }
  }
  return false;
}

const toggleDetailsEffect = StateEffect.define<{ pos: number; open: boolean }>();
const EMPTY_DETAILS_MAP: ReadonlyMap<number, boolean> = new Map();

const detailsStateField = StateField.define<ReadonlyMap<number, boolean>>({
  create: () => EMPTY_DETAILS_MAP,
  update(map, tr) {
    let next: Map<number, boolean> | null = null;
    if (tr.docChanged && map.size > 0) {
      next = new Map();
      for (const [pos, open] of map) {
        const mapped = tr.changes.mapPos(pos, 1);
        if (mapped >= 0 && mapped <= tr.state.doc.length) next.set(mapped, open);
      }
    }
    for (const e of tr.effects) {
      if (e.is(toggleDetailsEffect)) {
        next ??= new Map(map);
        next.set(e.value.pos, e.value.open);
      }
    }
    return next ?? map;
  },
});

class SemTagWidget extends WidgetType {
  constructor(readonly kind: SemKind, readonly glyph: string, readonly title: string) {
    super();
  }
  eq(other: SemTagWidget): boolean {
    return other.kind === this.kind;
  }
  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = `k-sem-tag k-sem-${this.kind}`;
    el.title = this.title;
    el.dataset.semKind = this.kind;
    el.textContent = this.glyph;
    return el;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

class TocCardWidget extends WidgetType {
  readonly key: string;
  constructor(
    readonly headings: readonly TocHeading[],
    readonly onOpenLink?: (target: string, opts?: { beside?: boolean }) => void,
  ) {
    super();
    this.key = headings.map((h) => `${h.line}:${h.level}:${h.title}`).join("\n");
  }
  eq(other: TocCardWidget): boolean {
    return other.key === this.key;
  }
  toDOM(view: EditorView): HTMLElement {
    const nav = document.createElement("nav");
    nav.className = "cm-toc-card md-toc";
    nav.setAttribute("aria-label", "Table of contents");
    nav.dataset.testid = "cm-toc-card";

    const head = document.createElement("div");
    head.className = "md-toc-head";
    const glyph = document.createElement("span");
    glyph.className = "md-toc-glyph";
    glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = "≡";
    const label = document.createElement("span");
    label.textContent = "Contents";
    const count = document.createElement("span");
    count.className = "md-toc-count";
    count.textContent = String(this.headings.length);
    head.append(glyph, label, count);
    nav.appendChild(head);

    if (!this.headings.length) {
      const empty = document.createElement("p");
      empty.className = "md-toc-empty";
      empty.textContent = "Add headings (# … ####) to populate contents";
      nav.appendChild(empty);
    } else {
      const minL = Math.min(...this.headings.map((h) => h.level));
      const ul = document.createElement("ul");
      ul.className = "md-toc-list";
      for (const h of this.headings) {
        const li = document.createElement("li");
        li.className = `md-toc-item md-toc-d${Math.min(3, h.level - minL)}`;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "md-toc-link";
        btn.dataset.tocLine = String(h.line);
        btn.textContent = h.title;
        btn.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if ((e.ctrlKey || e.metaKey) && this.onOpenLink) {
            this.onOpenLink(`#${h.title}`, { beside: true });
            return;
          }
          const clamped = Math.max(1, Math.min(h.line, view.state.doc.lines));
          const target = view.state.doc.line(clamped);
          view.dispatch({
            selection: { anchor: target.from },
            effects: EditorView.scrollIntoView(target.from, { y: "start", yMargin: 24 }),
          });
          view.focus();
        });
        li.appendChild(btn);
        ul.appendChild(li);
      }
      nav.appendChild(ul);
    }

    nav.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || (e.target as HTMLElement | null)?.closest("button, a")) return;
      const pos = view.posAtDOM(nav);
      if (pos == null) return;
      e.preventDefault();
      view.dispatch({ selection: { anchor: pos } });
      view.focus();
    });
    return nav;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

function detailsOpenNow(state: EditorState, d: DetailsSpan, map: ReadonlyMap<number, boolean>): boolean {
  if (revealed(state, state.doc.line(d.openLine).from, state.doc.line(d.closeLine).to)) return true;
  return map.get(d.openPos) ?? d.defaultOpen;
}

function buildRichDecorations(
  view: EditorView,
  onOpenLink?: (target: string, opts?: { beside?: boolean }) => void,
): DecorationSet {
  const { state } = view;
  const meta = getDocMeta(state);
  const detailsMap = state.field(detailsStateField, false) ?? EMPTY_DETAILS_MAP;
  const marksAndLines: Range<Decoration>[] = [];
  const replaces: { from: number; to: number; deco: Decoration }[] = [];

  for (const { from, to } of view.visibleRanges) {
    const startLineNum = state.doc.lineAt(from).number;
    const endLineNum = state.doc.lineAt(to).number;

    for (const d of meta.detailsBlocks) {
      if (!d.multiBlock || d.closeLine < startLineNum || d.summaryEndLine >= endLineNum) continue;
      const isOpen = detailsOpenNow(state, d, detailsMap);
      const lo = Math.max(d.summaryEndLine + 1, startLineNum);
      const hi = Math.min(d.closeLine, endLineNum);
      for (let n = lo; n <= hi; n++) {
        const l = state.doc.line(n);
        if (!isOpen) {
          marksAndLines.push(Decoration.line({ class: "cm-details-hidden" }).range(l.from));
        } else if (n < d.closeLine) {
          const cls = n === d.closeLine - 1 ? "cm-details-body cm-details-body-last" : "cm-details-body";
          marksAndLines.push(Decoration.line({ class: cls }).range(l.from));
        }
      }
    }

    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (line.number <= meta.fmClose || meta.fencedLines.has(line.number)) continue;

      if (TOC_LINE_RE.test(line.text)) {
        if (!revealed(state, line.from, line.to) && !isBlockedNode(state, line.from, true)) {
          marksAndLines.push(Decoration.line({ class: "cm-toc-line" }).range(line.from));
          replaces.push({
            from: line.from,
            to: line.to,
            deco: Decoration.replace({ widget: new TocCardWidget(meta.headings, onOpenLink) }),
          });
        }
        continue;
      }

      if (line.text.includes("data-color=") || line.text.includes("data-bg=")) {
        for (const m of line.text.matchAll(PIGMENT_SPAN_RE)) {
          const fullFrom = line.from + m.index!;
          const fullTo = fullFrom + m[0].length;
          if (isBlockedNode(state, fullFrom, true)) continue;
          const openTo = fullFrom + m[0].indexOf(">") + 1;
          const closeFrom = fullTo - m[0].slice(m[0].lastIndexOf("</")).length;
          const mode = m[2].toLowerCase();
          const pigment = m[3].toLowerCase();
          const cls = mode === "color" ? `cm-pigment-color-${pigment}` : `cm-pigment-bg-${pigment}`;
          if (closeFrom > openTo) marksAndLines.push(Decoration.mark({ class: cls }).range(openTo, closeFrom));
        }
      }

      if (line.text.includes("[") || line.text.includes("TODO:")) {
        for (const m of line.text.matchAll(SEM_LINE_RE)) {
          const prefixEnd = m.index! + m[1].length;
          if (m[2].startsWith("TODO:") && !LINE_CLAUSE_START_RE.test(line.text.slice(0, prefixEnd))) continue;
          const tagFrom = line.from + prefixEnd;
          const tagTo = tagFrom + m[2].length;
          if (revealed(state, tagFrom, tagTo) || isBlockedNode(state, tagFrom, false)) continue;
          const spec = SEM_SPECS[m[3] ?? "TODO"];
          if (!spec) continue;
          replaces.push({
            from: tagFrom,
            to: tagTo,
            deco: Decoration.replace({ widget: new SemTagWidget(spec.kind, spec.glyph, spec.title) }),
          });
        }
      }
    }
  }

  replaces.sort((a, b) => a.from - b.from || b.to - a.to);
  let guardTo = -1;
  for (const r of replaces) {
    if (r.from >= guardTo) {
      marksAndLines.push(r.deco.range(r.from, r.to));
      guardTo = r.to;
    }
  }
  return Decoration.set(marksAndLines, true);
}

function syncDetailsDom(view: EditorView): void {
  const { state } = view;
  const meta = getDocMeta(state);
  if (!meta.detailsBlocks.length) return;
  const map = state.field(detailsStateField, false) ?? EMPTY_DETAILS_MAP;
  let measureNeeded = false;

  view.dom.querySelectorAll<HTMLElement>(".cm-rendered-block").forEach((blockEl) => {
    let pos: number;
    try {
      pos = view.posAtDOM(blockEl);
    } catch {
      return;
    }
    const lineNum = state.doc.lineAt(Math.min(pos, state.doc.length)).number;
    const headSpan = meta.detailsBlocks.find((d) => d.multiBlock && lineNum >= d.openLine && lineNum <= d.summaryEndLine);
    if (headSpan) {
      const detailsEl = blockEl.querySelector<HTMLDetailsElement>("details:not(.callout)");
      if (detailsEl) {
        const isOpen = detailsOpenNow(state, headSpan, map);
        detailsEl.classList.add("cm-details-head");
        blockEl.classList.toggle("is-details-open", isOpen);
        if (detailsEl.open !== isOpen) {
          detailsEl.open = isOpen;
          measureNeeded = true;
        }
      }
      return;
    }
    const enclosingClosed = meta.detailsBlocks.some(
      (d) => d.multiBlock && lineNum > d.summaryEndLine && lineNum <= d.closeLine && !detailsOpenNow(state, d, map),
    );
    if (blockEl.classList.contains("cm-details-hidden") !== enclosingClosed) {
      blockEl.classList.toggle("cm-details-hidden", enclosingClosed);
      measureNeeded = true;
    }
  });

  if (measureNeeded) view.requestMeasure();
}

export function richBlocksExtension(
  onOpenLink?: (target: string, opts?: { beside?: boolean }) => void,
): Extension {
  const plugin = Prec.high(
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(readonly view: EditorView) {
          this.decorations = buildRichDecorations(view, onOpenLink);
          queueMicrotask(() => { if (view.dom.isConnected) syncDetailsDom(view); });
        }
        update(u: ViewUpdate) {
          const toggled = u.transactions.some((tr) => tr.effects.some((e) => e.is(toggleDetailsEffect)));
          if (u.docChanged || u.selectionSet || u.viewportChanged || toggled) {
            this.decorations = buildRichDecorations(u.view, onOpenLink);
            queueMicrotask(() => { if (u.view.dom.isConnected) syncDetailsDom(u.view); });
          }
        }
      },
      {
        decorations: (v) => v.decorations,
        eventHandlers: {
          click(e, view) {
            const summary = (e.target as HTMLElement | null)?.closest<HTMLElement>("details:not(.callout) > summary");
            const blockEl = summary?.closest<HTMLElement>(".cm-rendered-block");
            if (!summary || !blockEl) return false;
            let pos: number;
            try {
              pos = view.posAtDOM(blockEl);
            } catch {
              return false;
            }
            const lineNum = view.state.doc.lineAt(Math.min(pos, view.state.doc.length)).number;
            const meta = getDocMeta(view.state);
            const span = meta.detailsBlocks.find((d) => d.multiBlock && lineNum >= d.openLine && lineNum <= d.summaryEndLine);
            if (!span) {
              requestAnimationFrame(() => view.requestMeasure());
              return false;
            }
            e.preventDefault();
            e.stopPropagation();
            const map = view.state.field(detailsStateField, false) ?? EMPTY_DETAILS_MAP;
            const cur = detailsOpenNow(view.state, span, map);
            view.dispatch({ effects: toggleDetailsEffect.of({ pos: span.openPos, open: !cur }) });
            return true;
          },
        },
      },
    ),
  );
  return [detailsStateField, plugin];
}
