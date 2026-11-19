// Obsidian's formatting keys for notes: bold, italic, link, to-do — on the note editor that has the keys
// (a tab or an embedded one). Each is a toggle on every selection range.
import { EditorSelection, type ChangeSpec, type EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { noteFormat, type MdFormat } from "../registry";
import { tickTaskLine } from "./task-tick";

export type PigmentColor = "cobalt" | "ochre" | "viridian" | "vermilion" | "mauve";

const MARK = { bold: "**", italic: "*" } as const;

/** How many `*` touch position `pos` on that side (`**bold**` and `*italic*` share the character). */
function stars(view: EditorView, pos: number, dir: -1 | 1): number {
  let n = 0;
  while (view.state.sliceDoc(dir < 0 ? pos - n - 1 : pos + n, dir < 0 ? pos - n : pos + n + 1) === "*") n++;
  return n;
}
/** Is the range already wrapped in this mark, just outside it? Italic is an odd run of stars, bold two or more. */
const wrapped = (view: EditorView, from: number, to: number, kind: "bold" | "italic"): boolean => {
  const n = Math.min(stars(view, from, -1), stars(view, to, 1));
  return kind === "bold" ? n >= 2 : n % 2 === 1;
};

function toggleMark(view: EditorView, kind: "bold" | "italic"): void {
  const mark = MARK[kind], len = mark.length;
  view.dispatch(view.state.changeByRange((r) => {
    const text = view.state.sliceDoc(r.from, r.to);
    // the marks are inside the selection: `**word**` selected whole
    if (text.length >= 2 * len && text.startsWith(mark) && text.endsWith(mark) && (kind === "bold" || !text.startsWith("**") || text.startsWith("***"))) {
      const inner = text.slice(len, -len);
      return { changes: { from: r.from, to: r.to, insert: inner }, range: EditorSelection.range(r.from, r.from + inner.length) };
    }
    if (wrapped(view, r.from, r.to, kind)) { // or just outside it (also the empty pair right after pressing the key)
      const changes: ChangeSpec = [{ from: r.from - len, to: r.from }, { from: r.to, to: r.to + len }];
      return { changes, range: EditorSelection.range(r.from - len, r.to - len) };
    }
    // typing inside `**word|**`: the key ends the bold — the caret steps over the closing mark
    const after = stars(view, r.to, 1);
    if (r.empty && (kind === "bold" ? after >= 2 : after % 2 === 1) && /\S/.test(view.state.sliceDoc(r.from - 1, r.from))) return { range: EditorSelection.cursor(r.to + len) };
    return { changes: [{ from: r.from, insert: mark }, { from: r.to, insert: mark }], range: EditorSelection.range(r.from + len, r.to + len) };
  }), { userEvent: "input.format", scrollIntoView: true });
}

/** `[selection](|)`; a selected URL becomes the target: `[|](url)`; nothing selected: `[|]()`. */
function insertLink(view: EditorView): void {
  view.dispatch(view.state.changeByRange((r) => {
    const text = view.state.sliceDoc(r.from, r.to);
    const url = /^(https?:\/\/|www\.)\S+$/.test(text);
    const insert = url ? `[](${text})` : `[${text}]()`;
    const caret = r.from + (url || !text ? 1 : insert.length - 1);
    return { changes: { from: r.from, to: r.to, insert }, range: EditorSelection.cursor(caret) };
  }), { userEvent: "input.format", scrollIntoView: true });
}

/** A list item's start: indentation, the bullet or number, the checkbox — any of them or none. */
const LIST_START = /^(\s*)(?:([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?)?/;

/** Each line of the selection once (blank lines only when the caret is on them): what `start` matches at its
 *  beginning is replaced by `head(match)` — the one loop behind every line-start command. */
function rewriteLineStarts(view: EditorView, start: RegExp, head: (m: RegExpExecArray) => string): void {
  const { state } = view, changes: ChangeSpec[] = [], seen = new Set<number>();
  for (const r of state.selection.ranges) {
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) {
      const line = state.doc.line(n);
      if (seen.has(n) || (!line.text.trim() && !r.empty)) continue;
      seen.add(n);
      const m = start.exec(line.text)!; // every pattern here can match empty
      changes.push({ from: line.from, to: line.from + m[0].length, insert: head(m) });
    }
  }
  view.dispatch({ changes, userEvent: "input.format" });
}

/** Each line of the selection: text → to-do → done → to-do… (a plain or bulleted line becomes `- [ ]`). */
function toggleTask(view: EditorView): void {
  const { state } = view;
  // one to-do under the caret: ticked as a box click ticks it (done date, next occurrence)
  const one = state.selection.ranges.length === 1 && state.selection.main.empty;
  if (one && tickTaskLine(view, state.doc.lineAt(state.selection.main.head).number)) return;
  rewriteLineStarts(view, LIST_START, ([, indent, bullet, box]) =>
    box === undefined ? `${indent}${bullet ?? "-"} [ ] ` : `${indent}${bullet} [${box === " " ? "x" : " "}] `);
}

/** Each line of the selection one step on: text → list item → to-do → text (Obsidian's "cycle bullet / checkbox").
 *  A done to-do also goes back to text; a numbered item keeps its number as a to-do. */
function cycleLine(view: EditorView): void {
  rewriteLineStarts(view, LIST_START, ([, indent, bullet, box]) =>
    bullet === undefined ? `${indent}- ` : box === undefined ? `${indent}${bullet} [ ] ` : indent);
}

/** What starts a line: indentation, then a heading, a quote, a list item (with its checkbox) — any of them or none. */
const LINE_START = /^(\s*)(#{1,6}\s+|>\s?|(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?/;
/** Each line of the selection gets the start `next` makes of its present one (the formatting bar's line buttons). */
function restart(view: EditorView, next: (now: string) => string): void {
  rewriteLineStarts(view, LINE_START, ([, indent, start = ""]) => indent + next(start));
}
const LINE: Record<"heading" | "bullet" | "number" | "quote", (now: string) => string> = {
  // text → # → ## → ### → text
  heading: (now) => { const h = /^#+/.exec(now)?.[0].length ?? 0; return h >= 3 ? "" : `${"#".repeat(h + 1)} `; },
  bullet: (now) => (/^[-*+]\s+$/.test(now) ? "" : "- "),
  number: (now) => (/^\d+[.)]\s+$/.test(now) ? "" : "1. "),
  quote: (now) => (now.startsWith(">") ? "" : "> "),
};

/** `code`: the selection between backticks (again: without them). */
function toggleCode(view: EditorView): void {
  view.dispatch(view.state.changeByRange((r) => {
    const text = view.state.sliceDoc(r.from, r.to);
    if (text.length >= 2 && text.startsWith("`") && text.endsWith("`") && !text.startsWith("``")) {
      return { changes: { from: r.from, to: r.to, insert: text.slice(1, -1) }, range: EditorSelection.range(r.from, r.to - 2) };
    }
    if (view.state.sliceDoc(r.from - 1, r.from) === "`" && view.state.sliceDoc(r.to, r.to + 1) === "`"
      && view.state.sliceDoc(r.from - 2, r.from - 1) !== "`" && view.state.sliceDoc(r.to + 1, r.to + 2) !== "`") {
      return { changes: [{ from: r.from - 1, to: r.from }, { from: r.to, to: r.to + 1 }], range: EditorSelection.range(r.from - 1, r.to - 1) };
    }
    return { changes: [{ from: r.from, insert: "`" }, { from: r.to, insert: "`" }], range: EditorSelection.range(r.from + 1, r.to + 1) };
  }), { userEvent: "input.format", scrollIntoView: true });
}

function toggleDoubleDelim(view: EditorView, delim: string, disallowTriple: boolean): boolean {
  const len = delim.length;
  const ch = delim[0];
  view.dispatch(view.state.changeByRange((r) => {
    const text = view.state.sliceDoc(r.from, r.to);
    if (text.length >= 2 * len && text.startsWith(delim) && text.endsWith(delim) && (!disallowTriple || !text.startsWith(delim + ch))) {
      const inner = text.slice(len, -len);
      return { changes: { from: r.from, to: r.to, insert: inner }, range: EditorSelection.range(r.from, r.from + inner.length) };
    }
    if (view.state.sliceDoc(r.from - len, r.from) === delim && view.state.sliceDoc(r.to, r.to + len) === delim
      && (!disallowTriple || (view.state.sliceDoc(r.from - len - 1, r.from - len) !== ch && view.state.sliceDoc(r.to + len, r.to + len + 1) !== ch))) {
      return { changes: [{ from: r.from - len, to: r.from }, { from: r.to, to: r.to + len }], range: EditorSelection.range(r.from - len, r.to - len) };
    }
    if (r.empty && view.state.sliceDoc(r.to, r.to + len) === delim && /\S/.test(view.state.sliceDoc(r.from - 1, r.from))) {
      return { range: EditorSelection.cursor(r.to + len) };
    }
    return { changes: [{ from: r.from, insert: delim }, { from: r.to, insert: delim }], range: EditorSelection.range(r.from + len, r.to + len) };
  }), { userEvent: "input.format", scrollIntoView: true });
  return true;
}

/** `**bold**`: toggle Markdown bold marks around each selection range. */
export function toggleBold(view: EditorView): boolean {
  toggleMark(view, "bold");
  return true;
}

/** `*italic*`: toggle Markdown italic marks around each selection range. */
export function toggleItalic(view: EditorView): boolean {
  toggleMark(view, "italic");
  return true;
}

/** `~~strike~~`: toggle GFM strikethrough marks around each selection range. */
export function toggleStrike(view: EditorView): boolean {
  return toggleDoubleDelim(view, "~~", false);
}

/** `` `code` ``: toggle inline code backticks around each selection range. */
export function toggleInlineCode(view: EditorView): boolean {
  toggleCode(view);
  return true;
}

/** `==highlight==`: toggle Obsidian-style highlight marks around each selection range. */
export function toggleHighlight(view: EditorView): boolean {
  return toggleDoubleDelim(view, "==", true);
}

export type BlockKind = "text" | "h1" | "h2" | "h3" | "bullet" | "number" | "todo" | "quote";

const BLOCK_LABELS: Record<BlockKind, string> = {
  text: "Text",
  h1: "H1",
  h2: "H2",
  h3: "H3",
  bullet: "List",
  number: "1. List",
  todo: "To-do",
  quote: "Quote",
};

/** Set each selected line's heading level (`0` strips heading/list/quote prefix back to plain text). */
export function setHeading(view: EditorView, level: 0 | 1 | 2 | 3): boolean {
  const prefix = level === 0 ? "" : `${"#".repeat(level)} `;
  rewriteLineStarts(view, LINE_START, ([, indent]) => `${indent}${prefix}`);
  return true;
}

/** Convert each selected line to the requested block kind. */
export function setBlockKind(view: EditorView, kind: BlockKind): boolean {
  if (kind === "text") return setHeading(view, 0);
  if (kind === "h1") return setHeading(view, 1);
  if (kind === "h2") return setHeading(view, 2);
  if (kind === "h3") return setHeading(view, 3);
  if (kind === "number") {
    let idx = 0;
    rewriteLineStarts(view, LINE_START, ([, indent]) => `${indent}${++idx}. `);
    return true;
  }
  const mark = kind === "bullet" ? "- " : kind === "todo" ? "- [ ] " : "> ";
  rewriteLineStarts(view, LINE_START, ([, indent]) => `${indent}${mark}`);
  return true;
}

/** Wrap the active selection as `[selected](url)` or `[[note|selected]]` when given a `[[note]]` or bare note name. */
export function wrapSelectionLink(view: EditorView, rawTarget: string): boolean {
  const target = rawTarget.trim();
  if (!target) return false;
  view.dispatch(view.state.changeByRange((r) => {
    const selected = view.state.sliceDoc(r.from, r.to);
    const linkMatch = /^\[([^\]]*)\]\([^)]*\)$/.exec(selected);
    const label = linkMatch ? linkMatch[1] : selected;
    let insert: string;
    if (target.startsWith("[[")) {
      const note = target.slice(2).replace(/\]\]$/, "").trim();
      if (!note) return { range: r };
      insert = !label || note === label ? `[[${note}]]` : `[[${note}|${label}]]`;
    } else if (/^(?:https?:\/\/|mailto:|tel:|\/|#|\.\.?\/)/i.test(target)) {
      insert = `[${label}](${target})`;
    } else if (/^www\./i.test(target) || /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(target)) {
      insert = `[${label}](https://${target})`;
    } else {
      insert = !label || target === label ? `[[${target}]]` : `[[${target}|${label}]]`;
    }
    return { changes: { from: r.from, to: r.to, insert }, range: EditorSelection.cursor(r.from + insert.length) };
  }), { userEvent: "input.format", scrollIntoView: true });
  return true;
}

export interface SelectionFormatState {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  highlight: boolean;
  link: boolean;
  block: BlockKind;
  blockLabel: string;
}

function starsInState(state: EditorState, pos: number, dir: -1 | 1): number {
  let n = 0;
  while (state.sliceDoc(dir < 0 ? pos - n - 1 : pos + n, dir < 0 ? pos - n : pos + n + 1) === "*") n++;
  return n;
}

function hasDoubleDelim(state: EditorState, from: number, to: number, delim: string, disallowTriple = false): boolean {
  const text = state.sliceDoc(from, to);
  const len = delim.length;
  const ch = delim[0];
  if (text.length >= 2 * len && text.startsWith(delim) && text.endsWith(delim) && (!disallowTriple || !text.startsWith(delim + ch))) {
    return true;
  }
  if (state.sliceDoc(from - len, from) === delim && state.sliceDoc(to, to + len) === delim) {
    if (!disallowTriple) return true;
    return state.sliceDoc(from - len - 1, from - len) !== ch && state.sliceDoc(to + len, to + len + 1) !== ch;
  }
  return false;
}

function detectBlockKind(lineText: string): BlockKind {
  const trimmed = lineText.replace(/^\s*/, "");
  if (/^#\s+/.test(trimmed)) return "h1";
  if (/^##\s+/.test(trimmed)) return "h2";
  if (/^#{3,6}\s+/.test(trimmed)) return "h3";
  if (/^(?:[-*+]|\d+[.)])\s+\[.\]\s+/.test(trimmed)) return "todo";
  if (/^[-*+]\s+/.test(trimmed)) return "bullet";
  if (/^\d+[.)]\s+/.test(trimmed)) return "number";
  if (/^>\s?/.test(trimmed)) return "quote";
  return "text";
}

/** Inspect active inline marks and line block type for the primary selection. */
export function getSelectionFormat(state: EditorState): SelectionFormatState {
  const sel = state.selection.main;
  let bold = false;
  let italic = false;
  let strike = false;
  let code = false;
  let highlight = false;
  let link = false;

  if (sel.from < sel.to) {
    syntaxTree(state).iterate({
      from: sel.from,
      to: sel.to,
      enter(node) {
        if (node.from > sel.from || node.to < sel.to) return;
        switch (node.name) {
          case "StrongEmphasis": bold = true; break;
          case "Emphasis": italic = true; break;
          case "Strikethrough": strike = true; break;
          case "InlineCode": code = true; break;
          case "Highlight": highlight = true; break;
          case "Link":
          case "Wikilink": link = true; break;
        }
      },
    });
  }

  const text = state.sliceDoc(sel.from, sel.to);
  const starSpan = Math.min(starsInState(state, sel.from, -1), starsInState(state, sel.to, 1));
  if (!bold && (starSpan >= 2 || (text.length >= 4 && text.startsWith("**") && text.endsWith("**")))) bold = true;
  if (!italic && (starSpan % 2 === 1 || (text.length >= 2 && text.startsWith("*") && text.endsWith("*") && (!text.startsWith("**") || text.startsWith("***"))))) italic = true;
  if (!strike && hasDoubleDelim(state, sel.from, sel.to, "~~")) strike = true;
  if (!highlight && hasDoubleDelim(state, sel.from, sel.to, "==", true)) highlight = true;
  if (!code && ((text.length >= 2 && text.startsWith("`") && text.endsWith("`") && !text.startsWith("``"))
    || (state.sliceDoc(sel.from - 1, sel.from) === "`" && state.sliceDoc(sel.to, sel.to + 1) === "`"))) {
    code = true;
  }
  if (!link && (/^\[[^\]]+\]\([^)]*\)$/.test(text) || /^\[\[[^\]\n]+\]\]$/.test(text))) link = true;

  const block = detectBlockKind(state.doc.lineAt(sel.from).text);
  return { bold, italic, strike, code, highlight, link, block, blockLabel: BLOCK_LABELS[block] };
}

/** A small table under the caret's line, the caret in its first cell. */
function insertTable(view: EditorView): void {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const lead = line.text.trim() ? "\n\n" : "";
  const table = "| Column | Column |\n| --- | --- |\n|  |  |\n";
  view.dispatch({ changes: { from: line.to, insert: lead + table }, selection: { anchor: line.to + lead.length + 2, head: line.to + lead.length + 8 }, userEvent: "input.format", scrollIntoView: true });
}

/** Notion-style collapsible `<details open>` toggle block, with the summary text selected. */
function insertToggle(view: EditorView): void {
  const { state } = view, sel = state.selection.main;
  const headOpen = "<details open>\n<summary>";
  const summary = "Toggle heading";
  if (!sel.empty) {
    const body = state.sliceDoc(sel.from, sel.to);
    const block = `${headOpen}${summary}</summary>\n\n${body}\n</details>\n`;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: block },
      selection: { anchor: sel.from + headOpen.length, head: sel.from + headOpen.length + summary.length },
      userEvent: "input.format",
      scrollIntoView: true,
    });
    return;
  }
  const line = state.doc.lineAt(sel.head);
  const blank = !line.text.trim();
  const from = blank ? line.from : line.to;
  const lead = blank ? "" : "\n\n";
  const block = `${headOpen}${summary}</summary>\n\n\n</details>\n`;
  const base = from + lead.length;
  view.dispatch({
    changes: { from, to: line.to, insert: lead + block },
    selection: { anchor: base + headOpen.length, head: base + headOpen.length + summary.length },
    userEvent: "input.format",
    scrollIntoView: true,
  });
}

/** Multi-column fenced `columns` block with 2 ready-to-edit columns. */
function insertColumns(view: EditorView): void {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const blank = !line.text.trim();
  const from = blank ? line.from : line.to;
  const lead = blank ? "" : "\n\n";
  const head = "```columns\n### Column 1\n";
  const placeholder = "Write here…";
  const block = `${head}${placeholder}\n\n---\n\n### Column 2\nWrite here…\n\`\`\`\n`;
  const base = from + lead.length;
  view.dispatch({
    changes: { from, to: line.to, insert: lead + block },
    selection: { anchor: base + head.length, head: base + head.length + placeholder.length },
    userEvent: "input.format",
    scrollIntoView: true,
  });
}

/** Standalone `[[_TOC_]]` Table of Contents line. */
function insertToc(view: EditorView): void {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const blank = !line.text.trim();
  const from = blank ? line.from : line.to;
  const lead = blank ? "" : "\n\n";
  const ins = `${lead}[[_TOC_]]\n`;
  view.dispatch({
    changes: { from, to: line.to, insert: ins },
    selection: { anchor: from + ins.length },
    userEvent: "input.format",
    scrollIntoView: true,
  });
}

interface SpanHit {
  kind: "color" | "bg";
  pigment: string;
  isEqualsMark: boolean;
  fullFrom: number;
  fullTo: number;
  innerFrom: number;
  innerTo: number;
}

function findEnclosingSpan(state: EditorState, from: number, to: number, prefer?: "color" | "bg"): SpanHit | null {
  const line = state.doc.lineAt(from);
  if (state.doc.lineAt(to).number !== line.number) return null;
  const hits: SpanHit[] = [];
  for (const m of line.text.matchAll(/<span\s+data-color="([^"]*)"\s*>([\s\S]*?)<\/span>/gi)) {
    const openLen = m[0].indexOf(">") + 1;
    const fullFrom = line.from + m.index!;
    const innerFrom = fullFrom + openLen;
    const innerTo = innerFrom + m[2].length;
    hits.push({ kind: "color", pigment: m[1].toLowerCase(), isEqualsMark: false, fullFrom, fullTo: fullFrom + m[0].length, innerFrom, innerTo });
  }
  for (const m of line.text.matchAll(/<mark(?:\s+data-bg="([^"]*)")?\s*>([\s\S]*?)<\/mark>/gi)) {
    const openLen = m[0].indexOf(">") + 1;
    const fullFrom = line.from + m.index!;
    const innerFrom = fullFrom + openLen;
    const innerTo = innerFrom + m[2].length;
    hits.push({ kind: "bg", pigment: (m[1] ?? "ochre").toLowerCase(), isEqualsMark: false, fullFrom, fullTo: fullFrom + m[0].length, innerFrom, innerTo });
  }
  for (const m of line.text.matchAll(/==([^=\n]+)==/g)) {
    const fullFrom = line.from + m.index!;
    hits.push({ kind: "bg", pigment: "ochre", isEqualsMark: true, fullFrom, fullTo: fullFrom + m[0].length, innerFrom: fullFrom + 2, innerTo: fullFrom + 2 + m[1].length });
  }
  const matching = hits.filter((h) =>
    (from === h.fullFrom && to === h.fullTo) ||
    (from === h.innerFrom && to === h.innerTo) ||
    (from === to && from >= h.innerFrom && to <= h.innerTo),
  );
  if (!matching.length) return null;
  if (prefer) {
    const preferred = matching.find((h) => h.kind === prefer);
    if (preferred) return preferred;
  }
  return matching[0];
}

/** Applies or clears an Obsidian-friendly Bauhaus pigment `<span data-color="…">` or `<mark data-bg="…">`. */
export function applyPigmentSpan(view: EditorView, mode: "color" | "bg", pigment: PigmentColor | null): void {
  view.dispatch(view.state.changeByRange((r) => {
    if (pigment === null) {
      const hit = findEnclosingSpan(view.state, r.from, r.to, mode);
      if (!hit) {
        const text = view.state.sliceDoc(r.from, r.to);
        const stripped = text
          .replace(/^<span\s+data-color="[^"]*"\s*>([\s\S]*?)<\/span>$/i, "$1")
          .replace(/^<mark(?:\s+data-bg="[^"]*")?\s*>([\s\S]*?)<\/mark>$/i, "$1")
          .replace(/^==([\s\S]+)==$/, "$1");
        if (stripped !== text) {
          return { changes: { from: r.from, to: r.to, insert: stripped }, range: EditorSelection.range(r.from, r.from + stripped.length) };
        }
        return { range: r };
      }
      const inner = view.state.sliceDoc(hit.innerFrom, hit.innerTo);
      const openLen = hit.innerFrom - hit.fullFrom;
      const nextFrom = Math.min(inner.length, Math.max(0, r.from - hit.fullFrom - openLen));
      const nextTo = r.from === hit.fullFrom && r.to === hit.fullTo
        ? inner.length
        : Math.min(inner.length, Math.max(nextFrom, r.to - hit.fullFrom - openLen));
      return {
        changes: { from: hit.fullFrom, to: hit.fullTo, insert: inner },
        range: EditorSelection.range(hit.fullFrom + nextFrom, hit.fullFrom + nextTo),
      };
    }

    const open = mode === "color" ? `<span data-color="${pigment}">` : `<mark data-bg="${pigment}">`;
    const close = mode === "color" ? "</span>" : "</mark>";
    const hit = findEnclosingSpan(view.state, r.from, r.to, mode);
    if (hit && hit.kind === mode) {
      const inner = view.state.sliceDoc(hit.innerFrom, hit.innerTo);
      if (hit.pigment === pigment && !hit.isEqualsMark) {
        return {
          changes: { from: hit.fullFrom, to: hit.fullTo, insert: inner },
          range: EditorSelection.range(hit.fullFrom, hit.fullFrom + inner.length),
        };
      }
      const next = `${open}${inner}${close}`;
      return {
        changes: { from: hit.fullFrom, to: hit.fullTo, insert: next },
        range: EditorSelection.range(hit.fullFrom + open.length, hit.fullFrom + open.length + inner.length),
      };
    }

    return {
      changes: [{ from: r.from, insert: open }, { from: r.to, insert: close }],
      range: EditorSelection.range(r.from + open.length, r.to + open.length),
    };
  }), { userEvent: "input.format", scrollIntoView: true });
}

const SEM_PREFIX = /^(\[!\]|\[\?\]|\[\*\]|\[i\]|TODO:)\s+/;

/** Inserts a NoteCraft-style inline semantic marker at line start (after list/indent) or at the cursor. */
export function insertSemanticTag(view: EditorView, marker: "[!]" | "[?]" | "[*]" | "[i]" | "TODO:"): void {
  view.dispatch(view.state.changeByRange((r) => {
    const line = view.state.doc.lineAt(r.from);
    const lead = /^(\s*(?:>\s*)*(?:(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?)?)/.exec(line.text)![0];
    const contentStart = line.from + lead.length;
    const rest = line.text.slice(lead.length);
    const existing = SEM_PREFIX.exec(rest);

    if (r.empty && r.from > contentStart && marker !== "TODO:" && !existing) {
      const prev = view.state.sliceDoc(r.from - 1, r.from);
      const pad = prev && !/\s/.test(prev) ? " " : "";
      const ins = `${pad}${marker} `;
      return { changes: { from: r.from, insert: ins }, range: EditorSelection.cursor(r.from + ins.length) };
    }
    if (existing) {
      const exEnd = contentStart + existing[0].length;
      if (existing[1] === marker) {
        const shift = existing[0].length;
        return {
          changes: { from: contentStart, to: exEnd, insert: "" },
          range: EditorSelection.range(Math.max(contentStart, r.from - shift), Math.max(contentStart, r.to - shift)),
        };
      }
      const ins = `${marker} `;
      const delta = ins.length - existing[0].length;
      return {
        changes: { from: contentStart, to: exEnd, insert: ins },
        range: EditorSelection.range(Math.max(contentStart + ins.length, r.from + delta), Math.max(contentStart + ins.length, r.to + delta)),
      };
    }
    const ins = `${marker} `;
    const shift = ins.length;
    const nextFrom = r.from <= contentStart ? contentStart + shift : r.from + shift;
    const nextTo = r.to <= contentStart ? contentStart + shift : r.to + shift;
    return { changes: { from: contentStart, insert: ins }, range: EditorSelection.range(nextFrom, nextTo) };
  }), { userEvent: "input.format", scrollIntoView: true });
}

/** The note editor the keyboard is in, if any (class `live-cm`: lib/editor/create.ts). */
const focusedNote = (): EditorView | null => {
  const el = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(".cm-editor.live-cm");
  return el ? EditorView.findFromDOM(el) : null;
};

export function formatNote(view: EditorView, kind: MdFormat): void {
  if (kind === "taskDialog") void import("./task-dialog").then((m) => m.editTask(view));
  else if (kind === "insertTemplate") void import("./insert-template").then((m) => m.insertTemplate(view));
  else if (kind === "highlight") toggleHighlight(view);
  else if (kind === "link") insertLink(view);
  else if (kind === "task") toggleTask(view);
  else if (kind === "cycle") cycleLine(view);
  else if (kind === "code") toggleCode(view);
  else if (kind === "table") insertTable(view);
  else if (kind === "toggle") insertToggle(view);
  else if (kind === "columns") insertColumns(view);
  else if (kind === "toc") insertToc(view);
  else if (kind === "rtl") window.dispatchEvent(new CustomEvent("kandinsky:toggle-bidi", { detail: { view } }));
  else if (kind === "heading" || kind === "bullet" || kind === "number" || kind === "quote") restart(view, LINE[kind]);
  else toggleMark(view, kind);
}
noteFormat.run = (kind: MdFormat): void => { const view = focusedNote(); if (view) formatNote(view, kind); };
