// Subtle Notion-style hover `+` and `⋮⋮` block handle gutter in the left margin of a note.
// Positioned cleanly via a `view.dom` overlay without perturbing text flow or document content.
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type BlockInfo, type ViewUpdate } from "@codemirror/view";
import type { MenuItem } from "../menu";
import { popMenu } from "../menu";
import { shownName } from "../paths";
import { toast } from "../state.svelte";
import { frontmatterClose } from "./live/live-preview.js";
import { openSlashMenuAtLine } from "./slash-menu";

interface LogicalSpan {
  from: number;
  to: number;
  kind: "fence" | "math" | "table" | "quote" | "list" | "line";
}

const TABLE_ROW = /^\s*\|/;
const QUOTE_ROW = /^\s*>/;
const LIST_ITEM_ROW = /^(\s*)(?:[-*+]|\d+[.)])\s/;
const TRAILING_BLOCK_ID = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/;

function indentCols(s: string): number {
  let n = 0;
  for (const ch of s) n += ch === "\t" ? 2 : 1;
  return n;
}

/** Resolves a hovered visual line/widget into its full Markdown block (fence, `$$` math, callout, table, or line). */
function resolveLogicalSpan(state: EditorState, from: number, to: number): LogicalSpan {
  const doc = state.doc;
  const fmEnd = frontmatterClose(doc);
  const minLine = fmEnd + 1;
  let startLine = doc.lineAt(Math.max(0, Math.min(from, doc.length))).number;
  let endLine = doc.lineAt(Math.max(0, Math.min(to, doc.length))).number;
  if (startLine < minLine) startLine = minLine;
  if (endLine < startLine) endLine = startLine;

  // Check if inside a fenced code block (CommonMark-compliant, including nested and unclosed EOF fences)
  let openFence: { char: string; len: number; start: number } | null = null;
  for (let i = minLine; i <= doc.lines; i++) {
    const text = doc.line(i).text;
    const t0 = text.replace(/^ +/, "");
    const indented = text.length - t0.length > 3;
    const trimmedRight = t0.replace(/[\r\n]+$/, "");
    if (!openFence) {
      if (!indented) {
        for (const ch of ["`", "~"] as const) {
          let run = 0;
          while (trimmedRight[run] === ch) run++;
          if (run >= 3 && (ch === "~" || !trimmedRight.slice(run).includes("`"))) {
            openFence = { char: ch, len: run, start: i };
            break;
          }
        }
      }
    } else {
      let run = 0;
      while (trimmedRight[run] === openFence.char) run++;
      if (!indented && run >= openFence.len && trimmedRight.slice(run).trim() === "") {
        if (startLine >= openFence.start && startLine <= i) {
          return { from: doc.line(openFence.start).from, to: doc.line(i).to, kind: "fence" };
        }
        openFence = null;
      }
    }
  }
  if (openFence && startLine >= openFence.start) {
    return { from: doc.line(openFence.start).from, to: doc.line(doc.lines).to, kind: "fence" };
  }

  // Check if inside a multi-line `$$ ... $$` display math block
  let inMath = false;
  let mathStart = -1;
  for (let i = minLine; i <= doc.lines; i++) {
    const text = doc.line(i).text;
    if (!inMath && /^\s*(?:>\s*)?\$\$/.test(text)) {
      const openIdx = text.indexOf("$$");
      const closedSameLine = text.indexOf("$$", openIdx + 2) >= 0;
      if (closedSameLine) {
        if (i === startLine) return { from: doc.line(i).from, to: doc.line(i).to, kind: "math" };
      } else {
        inMath = true;
        mathStart = i;
      }
    } else if (inMath && text.includes("$$")) {
      if (startLine >= mathStart && startLine <= i) {
        return { from: doc.line(mathStart).from, to: doc.line(i).to, kind: "math" };
      }
      inMath = false;
      mathStart = -1;
    }
  }

  const firstText = doc.line(startLine).text;
  if (TABLE_ROW.test(firstText)) {
    while (startLine > minLine && TABLE_ROW.test(doc.line(startLine - 1).text)) startLine--;
    while (endLine < doc.lines && TABLE_ROW.test(doc.line(endLine + 1).text)) endLine++;
    return { from: doc.line(startLine).from, to: doc.line(endLine).to, kind: "table" };
  }

  if (QUOTE_ROW.test(firstText)) {
    while (startLine > minLine && QUOTE_ROW.test(doc.line(startLine - 1).text)) startLine--;
    while (endLine < doc.lines && QUOTE_ROW.test(doc.line(endLine + 1).text)) endLine++;
    return { from: doc.line(startLine).from, to: doc.line(endLine).to, kind: "quote" };
  }

  const listMatch = LIST_ITEM_ROW.exec(firstText);
  if (listMatch) {
    const baseIndent = indentCols(listMatch[1]);
    let l = startLine + 1;
    while (l <= doc.lines) {
      const txt = doc.line(l).text;
      if (txt.trim() === "") {
        // Keep blank line only if a deeper-indented list line follows immediately
        if (l + 1 <= doc.lines) {
          const next = doc.line(l + 1).text;
          const nm = /^(\s*)\S/.exec(next);
          if (nm && indentCols(nm[1]) > baseIndent) { endLine = l; l++; continue; }
        }
        break;
      }
      const lm = /^(\s*)/.exec(txt);
      if (lm && indentCols(lm[1]) > baseIndent) { endLine = l; l++; continue; }
      break;
    }
    return { from: doc.line(startLine).from, to: doc.line(endLine).to, kind: "list" };
  }

  return { from: doc.line(startLine).from, to: doc.line(endLine).to, kind: "line" };
}

function makeBlockId(): string {
  return `blk-${Math.random().toString(36).slice(2, 8)}`;
}

function turnLineInto(view: EditorView, span: LogicalSpan, prefix: string): void {
  const line = view.state.doc.lineAt(span.from);
  const stripped = line.text.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[.\]\s+)?|\d+[.)]\s+)/, "");
  const insert = `${prefix}${stripped}`;
  view.focus();
  view.dispatch({
    changes: { from: line.from, to: line.to, insert },
    selection: { anchor: line.from + insert.length },
    userEvent: "input",
  });
}

function wrapInCallout(view: EditorView, span: LogicalSpan, kind: "TIP" | "NOTE" | "WARNING", title?: string): void {
  const raw = view.state.sliceDoc(span.from, span.to);
  const lines = raw.split("\n");
  const header = `> [!${kind}]${title ? ` ${title}` : ""}`;
  let insert: string;
  if (lines.length > 0 && /^\s*>\s*\[![^\]]+\]/.test(lines[0])) {
    insert = [header, ...lines.slice(1).map((l) => (/^\s*>/.test(l) ? l : `> ${l}`))].join("\n");
  } else {
    const quoted = lines.map((l) => (/^\s*>/.test(l) ? l : `> ${l}`));
    insert = [header, ...quoted].join("\n");
  }
  view.focus();
  view.dispatch({
    changes: { from: span.from, to: span.to, insert },
    selection: { anchor: span.from + insert.length },
    userEvent: "input",
  });
}

function duplicateBlock(view: EditorView, span: LogicalSpan): void {
  const raw = view.state.sliceDoc(span.from, span.to);
  const insert = `\n${raw}`;
  view.focus();
  view.dispatch({
    changes: { from: span.to, insert },
    selection: { anchor: span.to + insert.length },
    scrollIntoView: true,
    userEvent: "input",
  });
}

function ensureBlockId(view: EditorView, span: LogicalSpan): string {
  const doc = view.state.doc;
  const endLine = doc.lineAt(span.to);
  // a list item's ID sits on its own first line and covers its nested children, so read it where it is written
  const idLine = span.kind === "list" ? doc.lineAt(span.from) : endLine;

  let id = TRAILING_BLOCK_ID.exec(idLine.text)?.[1];
  // an item whose text wraps onto continuation lines may carry its ID at their end (as Obsidian writes it); a nested
  // item or a blank line ends the item's own text, so a child's ID is never read as the parent's
  for (let n = idLine.number + 1; !id && span.kind === "list" && n <= endLine.number; n++) {
    const text = doc.line(n).text;
    if (text.trim() === "" || LIST_ITEM_ROW.test(text)) break;
    id = TRAILING_BLOCK_ID.exec(text)?.[1];
  }

  // Check if a standalone `^blk-...` already sits on the line immediately below a table/fence/callout/math block
  if (!id && span.kind !== "list" && endLine.number < doc.lines) {
    const nextLine = doc.line(endLine.number + 1).text.trim();
    const standalone = /^\^([A-Za-z0-9-]+)$/.exec(nextLine);
    if (standalone) id = standalone[1];
  }

  if (!id) {
    id = makeBlockId();
    if (span.kind === "table" || span.kind === "fence" || span.kind === "quote" || span.kind === "math") {
      view.dispatch({
        changes: { from: span.to, insert: `\n^${id}` },
        userEvent: "input",
      });
    } else {
      const spacer = idLine.text.endsWith(" ") || idLine.text.length === 0 ? "" : " ";
      view.dispatch({
        changes: { from: idLine.to, insert: `${spacer}^${id}` },
        userEvent: "input",
      });
    }
  }
  return id;
}

function copyBlockReference(view: EditorView, span: LogicalSpan): void {
  const id = ensureBlockId(view, span);
  const notePath = view.dom.dataset.note ?? "";
  const noteName = notePath ? shownName(notePath) : "";
  const ref = noteName ? `[[${noteName}#^${id}]]` : `#^${id}`;
  void navigator.clipboard
    .writeText(ref)
    .then(() => toast("Copied block reference", ref))
    .catch(() => toast("Block ID added", `^${id}`));
}

function copySyncedBlock(view: EditorView, span: LogicalSpan): void {
  const id = ensureBlockId(view, span);
  const notePath = view.dom.dataset.note ?? "";
  const blockYaml = notePath
    ? `\`\`\`view\ntype: synced\npath: ${JSON.stringify(notePath)}\nblock: ${JSON.stringify(id)}\n\`\`\``
    : `\`\`\`view\ntype: synced\nsource: ${JSON.stringify(`#^${id}`)}\n\`\`\``;
  void navigator.clipboard
    .writeText(blockYaml)
    .then(() => toast("Copied synced block", notePath ? `${shownName(notePath)}#^${id}` : `#^${id}`))
    .catch(() => toast("Synced block ID added", `^${id}`));
}

function moveBlockToLine(view: EditorView, span: LogicalSpan, insertBeforeLine: number): void {
  const doc = view.state.doc;
  const minLine = frontmatterClose(doc) + 1;
  const clampedTarget = Math.max(minLine, Math.min(doc.lines + 1, insertBeforeLine));
  const srcStart = doc.lineAt(span.from).number;
  const srcEnd = doc.lineAt(span.to).number;
  if (srcStart < minLine || (clampedTarget >= srcStart && clampedTarget <= srcEnd + 1)) return;

  const text = view.state.sliceDoc(span.from, span.to);
  let delFrom = span.from;
  let delTo = span.to;
  if (srcEnd < doc.lines) {
    delTo = doc.line(srcEnd + 1).from;
  } else if (srcStart > minLine) {
    delFrom = doc.line(srcStart - 1).to;
  } else {
    return;
  }

  const insChange = clampedTarget <= doc.lines
    ? { from: doc.line(clampedTarget).from, to: doc.line(clampedTarget).from, insert: `${text}\n` }
    : { from: doc.length, to: doc.length, insert: `\n${text}` };
  const delChange = { from: delFrom, to: delTo, insert: "" };
  const changes = insChange.from <= delChange.from ? [insChange, delChange] : [delChange, insChange];

  view.focus();
  view.dispatch({ changes, userEvent: "move.block" });
}

function deleteBlock(view: EditorView, span: LogicalSpan): void {
  const doc = view.state.doc;
  let delFrom = span.from;
  let delTo = span.to;
  if (delTo < doc.length && doc.sliceString(delTo, delTo + 1) === "\n") {
    delTo += 1;
  } else if (delFrom > 0 && doc.sliceString(delFrom - 1, delFrom) === "\n") {
    delFrom -= 1;
  }
  view.focus();
  view.dispatch({
    changes: { from: delFrom, to: delTo, insert: "" },
    selection: { anchor: Math.min(delFrom, doc.length - (delTo - delFrom)) },
    userEvent: "delete",
  });
}

class BlockGutterOverlay {
  wrapEl: HTMLDivElement;
  dropLineEl: HTMLDivElement;
  plusBtn: HTMLButtonElement;
  dragBtn: HTMLButtonElement;
  hoveredBlock: BlockInfo | null = null;
  menuOpen = false;
  dragging = false;
  suppressNextClick = false;

  private onMouseMove: (e: MouseEvent) => void;
  private onMouseLeave: () => void;
  private onScroll: () => void;
  private dragCleanup: (() => void) | null = null;

  constructor(readonly view: EditorView) {
    this.wrapEl = document.createElement("div");
    this.wrapEl.className = "cm-block-gutter";
    this.wrapEl.dataset.testid = "block-gutter";
    this.wrapEl.setAttribute("aria-hidden", "false");

    this.dropLineEl = document.createElement("div");
    this.dropLineEl.className = "cm-block-drop-indicator";
    this.dropLineEl.hidden = true;
    this.view.dom.appendChild(this.dropLineEl);

    this.plusBtn = document.createElement("button");
    this.plusBtn.type = "button";
    this.plusBtn.className = "cm-block-gutter-btn cm-block-plus";
    this.plusBtn.title = "Insert block below (/)";
    this.plusBtn.setAttribute("aria-label", "Insert block");
    this.plusBtn.innerHTML = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round"><path d="M8 3.2v9.6M3.2 8h9.6"/></svg>`;

    this.dragBtn = document.createElement("button");
    this.dragBtn.type = "button";
    this.dragBtn.className = "cm-block-gutter-btn cm-block-handle";
    this.dragBtn.title = "Block actions";
    this.dragBtn.setAttribute("aria-label", "Block actions");
    this.dragBtn.innerHTML = `<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><circle cx="5.5" cy="3.5" r="1.2"/><circle cx="10.5" cy="3.5" r="1.2"/><circle cx="5.5" cy="8" r="1.2"/><circle cx="10.5" cy="8" r="1.2"/><circle cx="5.5" cy="12.5" r="1.2"/><circle cx="10.5" cy="12.5" r="1.2"/></svg>`;

    this.wrapEl.append(this.plusBtn, this.dragBtn);
    this.view.dom.appendChild(this.wrapEl);

    this.plusBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onPlusClick();
    });

    this.dragBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    this.dragBtn.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !this.hoveredBlock) return;
      e.preventDefault();
      e.stopPropagation();
      this.startDrag(e, resolveLogicalSpan(this.view.state, this.hoveredBlock.from, this.hoveredBlock.to));
    });

    this.dragBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.suppressNextClick) { this.suppressNextClick = false; return; }
      this.onHandleClick();
    });

    this.onMouseMove = (e: MouseEvent) => {
      if (this.menuOpen || this.dragging) return;
      if (window.innerWidth < 640 || document.documentElement.classList.contains("phone")) {
        this.hide();
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target && this.wrapEl.contains(target)) {
        this.wrapEl.classList.add("is-hovered");
        return;
      }
      this.wrapEl.classList.remove("is-hovered");
      if (target?.closest(".inline-title, .cm-properties, .cm-notion-props-slot, .cm-notion-inline-props, .cm-panels, .cm-slash-menu")) {
        this.hide();
        return;
      }

      const editorRect = this.view.dom.getBoundingClientRect();
      const contentRect = this.view.contentDOM.getBoundingClientRect();
      const padLeft = parseFloat(getComputedStyle(this.view.contentDOM).paddingLeft) || 0;
      const textLeft = contentRect.left + padLeft - editorRect.left;
      // Ensure enough margin room to place the handle cleanly without overlapping prose
      if (textLeft < 40) {
        this.hide();
        return;
      }

      const docY = e.clientY - this.view.documentTop;
      if (docY < 0) {
        this.hide();
        return;
      }
      const block = this.view.lineBlockAtHeight(docY);
      const doc = this.view.state.doc;
      const fmClose = frontmatterClose(doc);
      if (fmClose > 0 && block.to <= doc.line(Math.min(fmClose, doc.lines)).to) {
        this.hide();
        return;
      }
      if (doc.length > 0 && docY > block.bottom + 36) {
        this.hide();
        return;
      }

      this.hoveredBlock = block;
      const top = this.view.documentTop + block.top - editorRect.top + 2;
      const left = Math.max(4, Math.round(textLeft - 44));
      this.wrapEl.style.transform = `translate(${left}px, ${Math.round(top)}px)`;
      this.wrapEl.classList.add("is-visible");
    };

    this.onMouseLeave = () => {
      if (!this.menuOpen) this.hide();
    };

    this.onScroll = () => {
      if (!this.menuOpen) this.hide();
    };

    this.view.dom.addEventListener("mousemove", this.onMouseMove, { passive: true });
    this.view.dom.addEventListener("mouseleave", this.onMouseLeave);
    this.view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
  }

  update(u: ViewUpdate): void {
    // Hide smoothly when typing so the left margin stays completely quiet
    if (u.docChanged && !this.menuOpen) this.hide();
  }

  private hide(): void {
    this.hoveredBlock = null;
    this.wrapEl.classList.remove("is-visible", "is-hovered", "is-menu-open");
  }

  private onPlusClick(): void {
    const block = this.hoveredBlock;
    if (!block) return;
    const state = this.view.state;
    const span = resolveLogicalSpan(state, block.from, block.to);
    const line = state.doc.lineAt(span.from);
    this.hide();
    if (span.kind === "line" && span.from === line.from && span.to === line.to && line.text.trim() === "") {
      openSlashMenuAtLine(this.view, line.from);
      return;
    }
    const insertAt = span.to;
    this.view.dispatch({
      changes: { from: insertAt, insert: "\n" },
      selection: { anchor: insertAt + 1 },
    });
    openSlashMenuAtLine(this.view, insertAt + 1);
  }

  private onHandleClick(): void {
    const block = this.hoveredBlock;
    if (!block) return;
    const span = resolveLogicalSpan(this.view.state, block.from, block.to);
    const r = this.dragBtn.getBoundingClientRect();

    const items: MenuItem[] = [
      { label: "Turn into Heading 2", hint: "##", icon: "heading", run: () => turnLineInto(this.view, span, "## ") },
      { label: "Turn into Heading 3", hint: "###", icon: "heading", run: () => turnLineInto(this.view, span, "### ") },
      { label: "Turn into Bullet", hint: "-", icon: "list", run: () => turnLineInto(this.view, span, "- ") },
      "sep",
      { label: "Wrap in Theorem Callout", hint: "[!TIP]", icon: "circle", run: () => wrapInCallout(this.view, span, "TIP", "Theorem") },
      { label: "Wrap in Note Callout", hint: "[!NOTE]", icon: "quote", run: () => wrapInCallout(this.view, span, "NOTE") },
      { label: "Wrap in Warning Callout", hint: "[!WARNING]", icon: "warning", run: () => wrapInCallout(this.view, span, "WARNING") },
      "sep",
      { label: "Duplicate block", icon: "copy", run: () => duplicateBlock(this.view, span) },
      { label: "Copy #^block reference", icon: "link", run: () => copyBlockReference(this.view, span) },
      { label: "Copy as synced block", icon: "copy", run: () => copySyncedBlock(this.view, span) },
      "sep",
      { label: "Delete block", icon: "trash", danger: true, run: () => deleteBlock(this.view, span) },
    ];

    this.menuOpen = true;
    this.wrapEl.classList.add("is-menu-open");
    popMenu({ x: r.left, y: r.bottom + 4, items }, () => {
      this.menuOpen = false;
      this.hide();
    });
  }

  private startDrag(downEv: PointerEvent, span: LogicalSpan): void {
    this.dragCleanup?.();
    const startX = downEv.clientX;
    const startY = downEv.clientY;
    let targetLine: number | null = null;
    const doc = this.view.state.doc;
    const minLine = frontmatterClose(doc) + 1;

    const updateTarget = (clientY: number) => {
      const editorRect = this.view.dom.getBoundingClientRect();
      const contentRect = this.view.contentDOM.getBoundingClientRect();
      const padLeft = parseFloat(getComputedStyle(this.view.contentDOM).paddingLeft) || 0;
      const docY = Math.max(0, clientY - this.view.documentTop);
      const blk = this.view.lineBlockAtHeight(docY);
      const tSpan = resolveLogicalSpan(this.view.state, blk.from, blk.to);
      const spanTop = this.view.lineBlockAt(tSpan.from).top;
      const spanBottom = this.view.lineBlockAt(tSpan.to).bottom;
      const before = docY < (spanTop + spanBottom) / 2;
      const rawLine = before ? doc.lineAt(tSpan.from).number : doc.lineAt(tSpan.to).number + 1;
      targetLine = Math.max(minLine, Math.min(doc.lines + 1, rawLine));

      const indY = targetLine <= doc.lines
        ? this.view.lineBlockAt(doc.line(targetLine).from).top
        : this.view.lineBlockAt(doc.line(doc.lines).from).bottom;
      const left = Math.max(8, Math.round(contentRect.left + padLeft - editorRect.left));
      const width = Math.max(120, Math.round(contentRect.width - padLeft * 2));
      this.dropLineEl.style.left = `${left}px`;
      this.dropLineEl.style.width = `${width}px`;
      this.dropLineEl.style.top = `${Math.round(this.view.documentTop + indY - editorRect.top)}px`;
      this.dropLineEl.hidden = false;
    };

    const onMove = (ev: PointerEvent) => {
      if (!this.dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
      if (!this.dragging) {
        this.dragging = true;
        this.dragBtn.classList.add("is-dragging");
      }
      updateTarget(ev.clientY);
    };

    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      this.dragCleanup = null;
      this.dropLineEl.hidden = true;
      this.dragBtn.classList.remove("is-dragging");
      const wasDragging = this.dragging;
      this.dragging = false;
      if (wasDragging) {
        this.suppressNextClick = true;
        setTimeout(() => { this.suppressNextClick = false; }, 50);
        if (commit && targetLine !== null) moveBlockToLine(this.view, span, targetLine);
      }
    };

    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    this.dragCleanup = () => finish(false);
  }

  destroy(): void {
    this.dragCleanup?.();
    this.view.dom.removeEventListener("mousemove", this.onMouseMove);
    this.view.dom.removeEventListener("mouseleave", this.onMouseLeave);
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    this.dropLineEl.remove();
    this.wrapEl.remove();
  }
}

const blockGutterTheme = EditorView.baseTheme({
  "&": {
    position: "relative",
  },
  ".cm-block-gutter": {
    position: "absolute",
    top: "0",
    left: "0",
    zIndex: "6",
    display: "inline-flex",
    alignItems: "center",
    gap: "1px",
    opacity: "0",
    pointerEvents: "none",
    transition: "opacity 130ms ease, transform 70ms ease-out",
    userSelect: "none",
  },
  ".cm-block-gutter.is-visible": {
    opacity: "0.65",
    pointerEvents: "auto",
  },
  ".cm-block-gutter.is-hovered, .cm-block-gutter.is-menu-open": {
    opacity: "1",
    pointerEvents: "auto",
  },
  ".cm-block-gutter-btn": {
    width: "19px",
    height: "22px",
    padding: "0",
    margin: "0",
    border: "0",
    borderRadius: "5px",
    background: "transparent",
    color: "var(--text-faint)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    transition: "background 100ms ease, color 100ms ease",
  },
  ".cm-block-gutter-btn:hover, .cm-block-gutter.is-menu-open .cm-block-handle": {
    background: "color-mix(in srgb, var(--text) 8%, transparent)",
    color: "var(--text-muted)",
  },
  ".cm-block-gutter-btn.cm-block-handle": {
    cursor: "grab",
  },
  ".cm-block-gutter-btn.cm-block-handle.is-dragging": {
    cursor: "grabbing",
    color: "var(--accent)",
    background: "var(--accent-soft)",
  },
  ".cm-block-drop-indicator": {
    position: "absolute",
    height: "2px",
    background: "var(--accent)",
    borderRadius: "2px",
    pointerEvents: "none",
    zIndex: "8",
  },
  "@media (max-width: 639px)": {
    ".cm-block-gutter": {
      display: "none !important",
    },
  },
});

export function blockGutterExtension(): Extension {
  return [
    ViewPlugin.fromClass(BlockGutterOverlay),
    blockGutterTheme,
  ];
}
