// Subtle Notion-style hover `+` and `⋮⋮` block handle gutter in the left margin of a note.
// Positioned cleanly via a `view.dom` overlay without perturbing text flow or document content.
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type BlockInfo, type ViewUpdate } from "@codemirror/view";
import type { MenuItem } from "../../components/ContextMenu.svelte";
import { popMenu } from "../menu";
import { shownName } from "../paths";
import { toast } from "../state.svelte";
import { frontmatterClose } from "./live/live-preview.js";
import { openSlashMenuAtLine } from "./slash-menu";

interface LogicalSpan {
  from: number;
  to: number;
  kind: "fence" | "math" | "table" | "quote" | "line";
}

const FENCE_OPEN = /^\s*(`{3,}|~{3,})/;
const TABLE_ROW = /^\s*\|/;
const QUOTE_ROW = /^\s*>/;
const TRAILING_BLOCK_ID = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/;
const LABEL_IN_MATH = /\\label\{([A-Za-z0-9:_-]+)\}/;

/** Resolves a hovered visual line/widget into its full Markdown block (fence, `$$` math, callout, table, or line). */
function resolveLogicalSpan(state: EditorState, from: number, to: number): LogicalSpan {
  const doc = state.doc;
  const fmEnd = frontmatterClose(doc);
  const minLine = fmEnd + 1;
  let startLine = doc.lineAt(Math.max(0, Math.min(from, doc.length))).number;
  let endLine = doc.lineAt(Math.max(0, Math.min(to, doc.length))).number;
  if (startLine < minLine) startLine = minLine;
  if (endLine < startLine) endLine = startLine;

  // Check if inside a fenced code block
  let inFence: string | null = null;
  let fenceStart = -1;
  for (let i = minLine; i <= doc.lines; i++) {
    const text = doc.line(i).text;
    const m = FENCE_OPEN.exec(text);
    if (!inFence && m) {
      inFence = m[1][0].repeat(m[1].length);
      fenceStart = i;
    } else if (inFence && text.trimStart().startsWith(inFence)) {
      if (startLine >= fenceStart && startLine <= i) {
        return { from: doc.line(fenceStart).from, to: doc.line(i).to, kind: "fence" };
      }
      inFence = null;
      fenceStart = -1;
    }
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

function copyBlockReference(view: EditorView, span: LogicalSpan): void {
  const doc = view.state.doc;
  const raw = view.state.sliceDoc(span.from, span.to);
  const endLine = doc.lineAt(span.to);

  let id =
    (span.kind === "math" ? LABEL_IN_MATH.exec(raw)?.[1] : undefined) ??
    TRAILING_BLOCK_ID.exec(endLine.text)?.[1];

  // Check if a standalone `^blk-...` already sits on the line immediately below a table/fence/callout
  if (!id && endLine.number < doc.lines) {
    const nextLine = doc.line(endLine.number + 1).text.trim();
    const standalone = /^\^([A-Za-z0-9-]+)$/.exec(nextLine);
    if (standalone) id = standalone[1];
  }

  if (!id) {
    id = makeBlockId();
    if (span.kind === "table" || span.kind === "fence" || span.kind === "quote") {
      view.dispatch({
        changes: { from: span.to, insert: `\n^${id}` },
        userEvent: "input",
      });
    } else {
      const spacer = endLine.text.endsWith(" ") || endLine.text.length === 0 ? "" : " ";
      view.dispatch({
        changes: { from: endLine.to, insert: `${spacer}^${id}` },
        userEvent: "input",
      });
    }
  }

  const notePath = view.dom.dataset.note ?? "";
  const noteName = notePath ? shownName(notePath) : "";
  const ref = noteName ? `[[${noteName}#^${id}]]` : `#^${id}`;
  void navigator.clipboard
    .writeText(ref)
    .then(() => toast("Copied block reference", ref))
    .catch(() => toast("Block ID added", `^${id}`));
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
  plusBtn: HTMLButtonElement;
  dragBtn: HTMLButtonElement;
  hoveredBlock: BlockInfo | null = null;
  menuOpen = false;

  private onMouseMove: (e: MouseEvent) => void;
  private onMouseLeave: () => void;
  private onScroll: () => void;

  constructor(readonly view: EditorView) {
    this.wrapEl = document.createElement("div");
    this.wrapEl.className = "cm-block-gutter";
    this.wrapEl.dataset.testid = "block-gutter";
    this.wrapEl.setAttribute("aria-hidden", "false");

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

    this.dragBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onHandleClick();
    });

    this.onMouseMove = (e: MouseEvent) => {
      if (this.menuOpen) return;
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
      if (target?.closest(".inline-title, .cm-properties, .cm-panels, .cm-slash-menu")) {
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

  destroy(): void {
    this.view.dom.removeEventListener("mousemove", this.onMouseMove);
    this.view.dom.removeEventListener("mouseleave", this.onMouseLeave);
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
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
