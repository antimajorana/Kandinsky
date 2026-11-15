// Notion × Bauhaus `/` slash-command block menu for Markdown notes.
// Triggered when `/` is typed at the start of a line (with optional whitespace or blockquote `> `),
// outside frontmatter, fenced code blocks, and math blocks; or explicitly via `openSlashMenuAtLine`.
import { closeCompletion, startCompletion } from "@codemirror/autocomplete";
import { StateEffect, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { overlayOpened } from "../overlays";
import { settings } from "../settings.svelte";
import { frontmatterClose } from "./live/live-preview.js";
import { notePlaceAt } from "./math-context";

type BadgeTone = "accent" | "green" | "yellow" | "red" | "muted";

interface SlashBlock {
  id: string;
  badge: string;
  tone: BadgeTone;
  title: string;
  hint: string;
  keywords: string[];
  /** Template with `\0` marking where the caret lands after insertion. */
  template: string;
  isCallout?: boolean;
  openCompletion?: boolean;
}

const SLASH_LINE_RE = /^(\s*(?:>\s*)?)\/([a-zA-Z0-9_-]*)$/;

const SLASH_BLOCKS: SlashBlock[] = [
  {
    id: "display-math",
    badge: "∑",
    tone: "accent",
    title: "Display Math",
    hint: "$$",
    keywords: ["math", "display", "eq", "equation", "latex", "katex", "formula", "sum"],
    template: "$$\n\0\n$$",
  },
  {
    id: "aligned-math",
    badge: "∑",
    tone: "accent",
    title: "Aligned Equations",
    hint: "align",
    keywords: ["align", "aligned", "equations", "math", "system", "derivation"],
    template: "$$\n\\begin{aligned}\n  \0\n\\end{aligned}\n$$",
  },
  {
    id: "callout-theorem",
    badge: "●",
    tone: "accent",
    title: "Theorem Callout",
    hint: "> [!TIP]",
    keywords: ["thm", "theorem", "lemma", "proposition", "corollary", "tip", "callout"],
    template: "> [!TIP] Theorem\n> \0",
    isCallout: true,
  },
  {
    id: "callout-proof",
    badge: "◎",
    tone: "green",
    title: "Proof Callout",
    hint: "> [!NOTE]",
    keywords: ["proof", "pf", "note", "def", "definition", "result", "verified", "callout"],
    template: "> [!NOTE] Proof\n> \0",
    isCallout: true,
  },
  {
    id: "callout-warning",
    badge: "▲",
    tone: "yellow",
    title: "Warning Callout",
    hint: "> [!WARNING]",
    keywords: ["warn", "warning", "caution", "important", "alert", "lint", "callout"],
    template: "> [!WARNING]\n> \0",
    isCallout: true,
  },
  {
    id: "table-3x3",
    badge: "⊞",
    tone: "muted",
    title: "Table (3×3)",
    hint: "| a | b |",
    keywords: ["table", "grid", "3x3", "columns", "rows"],
    template: "| Col 1 | Col 2 | Col 3 |\n| --- | --- | --- |\n| \0 |  |  |\n|  |  |  |",
  },
  {
    id: "code-block",
    badge: "<>",
    tone: "muted",
    title: "Code Block",
    hint: "```python",
    keywords: ["code", "python", "py", "fence", "script", "snippet"],
    template: "```python\n\0\n```",
  },
  {
    id: "subpage-link",
    badge: "[[",
    tone: "accent",
    title: "Subpage Link",
    hint: "[[Wikilink]]",
    keywords: ["link", "wikilink", "subpage", "page", "note", "wiki"],
    template: "[[\0]]",
    openCompletion: true,
  },
  {
    id: "view-base",
    badge: "▤",
    tone: "yellow",
    title: "Database (.base)",
    hint: "base",
    keywords: ["base", "database", "db", "table", "board", "gallery", "view"],
    template: "```view\ntype: base\npath: \0\n```",
  },
  {
    id: "view-notebook",
    badge: "◈",
    tone: "green",
    title: "Notebook (.ipynb / .wln)",
    hint: "nb",
    keywords: ["nb", "notebook", "ipynb", "wln", "jupyter", "wolfram", "colab", "view"],
    template: "```view\ntype: notebook\npath: \0\n```",
  },
  {
    id: "heading-1",
    badge: "H1",
    tone: "muted",
    title: "Heading 1",
    hint: "#",
    keywords: ["h1", "heading1", "heading 1", "title", "header"],
    template: "# \0",
  },
  {
    id: "heading-2",
    badge: "H2",
    tone: "muted",
    title: "Heading 2",
    hint: "##",
    keywords: ["h2", "heading2", "heading 2", "section", "subtitle"],
    template: "## \0",
  },
  {
    id: "heading-3",
    badge: "H3",
    tone: "muted",
    title: "Heading 3",
    hint: "###",
    keywords: ["h3", "heading3", "heading 3", "subsection"],
    template: "### \0",
  },
];

const forceOpenEffect = StateEffect.define<{ slashPos: number; autoSlash: boolean }>();

function filterBlocks(query: string): SlashBlock[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_BLOCKS;
  const scored: { block: SlashBlock; rank: number }[] = [];
  for (const block of SLASH_BLOCKS) {
    const title = block.title.toLowerCase();
    const hint = block.hint.toLowerCase();
    if (block.keywords.some((k) => k === q) || title === q) scored.push({ block, rank: 0 });
    else if (block.keywords.some((k) => k.startsWith(q)) || title.startsWith(q)) scored.push({ block, rank: 1 });
    else if (title.includes(q) || hint.includes(q) || block.keywords.some((k) => k.includes(q))) scored.push({ block, rank: 2 });
  }
  return scored.sort((a, b) => a.rank - b.rank).map((s) => s.block);
}

interface ActiveMatch {
  lineFrom: number;
  slashPos: number;
  to: number;
  prefix: string;
  query: string;
}

function matchSlashAtCaret(state: EditorState, allowWhenDisabled: boolean): ActiveMatch | null {
  if (!allowWhenDisabled && settings.config?.editor.slash_menu === false) return null;
  const sel = state.selection.main;
  if (!sel.empty) return null;
  const line = state.doc.lineAt(sel.head);
  if (line.number <= frontmatterClose(state.doc)) return null;
  const before = line.text.slice(0, sel.head - line.from);
  const after = line.text.slice(sel.head - line.from);
  if (after.trim().length > 0) return null;
  const m = SLASH_LINE_RE.exec(before);
  if (!m) return null;
  const prefix = m[1];
  const slashPos = line.from + prefix.length;
  if (notePlaceAt(state, slashPos).kind !== "text") return null;
  return { lineFrom: line.from, slashPos, to: sel.head, prefix, query: m[2] };
}

/** Opens the `/` slash block menu at `linePos` (used by the hover `+` gutter button). */
export function openSlashMenuAtLine(view: EditorView, linePos: number): void {
  const doc = view.state.doc;
  const clamped = Math.max(0, Math.min(linePos, doc.length));
  const line = doc.lineAt(clamped);
  const existing = SLASH_LINE_RE.exec(line.text);
  view.focus();
  if (existing) {
    const slashPos = line.from + existing[1].length;
    view.dispatch({
      selection: { anchor: line.to },
      effects: forceOpenEffect.of({ slashPos, autoSlash: false }),
      scrollIntoView: true,
    });
    return;
  }
  if (/^\s*(?:>\s*)?$/.test(line.text)) {
    const needSpace = line.text.trimEnd().endsWith(">") && !line.text.endsWith(" ");
    const ins = needSpace ? " /" : "/";
    const slashPos = line.to + (needSpace ? 1 : 0);
    view.dispatch({
      changes: { from: line.to, insert: ins },
      selection: { anchor: line.to + ins.length },
      effects: forceOpenEffect.of({ slashPos, autoSlash: true }),
      scrollIntoView: true,
    });
    return;
  }
  const ins = "\n/";
  const slashPos = line.to + 1;
  view.dispatch({
    changes: { from: line.to, insert: ins },
    selection: { anchor: line.to + ins.length },
    effects: forceOpenEffect.of({ slashPos, autoSlash: true }),
    scrollIntoView: true,
  });
}

class SlashMenuController {
  menuEl: HTMLDivElement;
  listEl: HTMLDivElement;
  emptyEl: HTMLDivElement;
  active: ActiveMatch | null = null;
  items: SlashBlock[] = [];
  selectedIndex = 0;
  dismissedSlashPos: number | null = null;
  forcedSlashPos: number | null = null;
  autoSlashPos: number | null = null;
  closeOverlay: (() => void) | null = null;

  private onKeyDown: (e: KeyboardEvent) => void;
  private onDocMouseDown: (e: MouseEvent) => void;
  private onScrollOrResize: () => void;
  private onBlur: (e: FocusEvent) => void;

  constructor(readonly view: EditorView) {
    this.menuEl = document.createElement("div");
    this.menuEl.className = "cm-slash-menu";
    this.menuEl.setAttribute("role", "listbox");
    this.menuEl.setAttribute("aria-label", "Insert block");
    this.menuEl.dataset.testid = "slash-menu";
    this.menuEl.hidden = true;

    const header = document.createElement("div");
    header.className = "cm-slash-header";
    header.textContent = "Insert block";

    this.listEl = document.createElement("div");
    this.listEl.className = "cm-slash-list";

    this.emptyEl = document.createElement("div");
    this.emptyEl.className = "cm-slash-empty";
    this.emptyEl.textContent = "No matching blocks";
    this.emptyEl.hidden = true;

    this.menuEl.append(header, this.listEl, this.emptyEl);
    this.view.dom.appendChild(this.menuEl);

    this.onKeyDown = (e: KeyboardEvent) => {
      if (!this.active) return;
      if (e.key === "ArrowDown") {
        if (!this.items.length) return;
        e.preventDefault();
        e.stopPropagation();
        this.selectedIndex = (this.selectedIndex + 1) % this.items.length;
        this.paintSelection();
      } else if (e.key === "ArrowUp") {
        if (!this.items.length) return;
        e.preventDefault();
        e.stopPropagation();
        this.selectedIndex = (this.selectedIndex - 1 + this.items.length) % this.items.length;
        this.paintSelection();
      } else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!this.items.length) return;
        e.preventDefault();
        e.stopPropagation();
        this.applyBlock(this.items[this.selectedIndex] ?? this.items[0]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.dismiss(true);
      }
    };

    this.onDocMouseDown = (e: MouseEvent) => {
      if (!this.active) return;
      if (this.menuEl.contains(e.target as Node)) return;
      this.dismiss(false);
    };

    this.onScrollOrResize = () => {
      if (this.active) this.positionMenu();
    };

    this.onBlur = (e: FocusEvent) => {
      if (!this.active) return;
      const next = e.relatedTarget as Node | null;
      if (next && this.menuEl.contains(next)) return;
      requestAnimationFrame(() => {
        if (this.active && !this.view.hasFocus && !this.menuEl.contains(document.activeElement)) {
          this.dismiss(false);
        }
      });
    };

    this.view.dom.addEventListener("keydown", this.onKeyDown, true);
    document.addEventListener("mousedown", this.onDocMouseDown, true);
    this.view.scrollDOM.addEventListener("scroll", this.onScrollOrResize, { passive: true });
    window.addEventListener("resize", this.onScrollOrResize);
    this.view.contentDOM.addEventListener("blur", this.onBlur);
  }

  update(u: ViewUpdate): void {
    for (const tr of u.transactions) {
      for (const ef of tr.effects) {
        if (ef.is(forceOpenEffect)) {
          this.forcedSlashPos = ef.value.slashPos;
          this.autoSlashPos = ef.value.autoSlash ? ef.value.slashPos : null;
          this.dismissedSlashPos = null;
        }
      }
    }
    if (!u.docChanged && !u.selectionSet && !u.focusChanged && this.forcedSlashPos === null) return;

    const caretLine = u.state.doc.lineAt(u.state.selection.main.head);
    if (this.dismissedSlashPos !== null) {
      const dismissedLine = u.state.doc.lineAt(Math.min(this.dismissedSlashPos, u.state.doc.length));
      if (caretLine.from !== dismissedLine.from || !caretLine.text.includes("/")) {
        this.dismissedSlashPos = null;
      }
    }

    const match = matchSlashAtCaret(u.state, this.forcedSlashPos !== null);
    if (!match || (this.dismissedSlashPos !== null && match.slashPos === this.dismissedSlashPos)) {
      if (this.active) this.closeMenu();
      this.forcedSlashPos = null;
      return;
    }

    // Only auto-open when the user actually typed or edited on this line, or via `openSlashMenuAtLine`.
    if (!this.active && !u.docChanged && this.forcedSlashPos === null) return;
    this.forcedSlashPos = null;

    const prevQuery = this.active?.query;
    this.active = match;
    if (prevQuery !== match.query || this.menuEl.hidden) {
      this.items = filterBlocks(match.query);
      this.selectedIndex = 0;
      this.renderList();
    }
    this.openMenu();
    // Suppress CodeMirror's generic autocomplete popup while the Bauhaus slash popover is open.
    queueMicrotask(() => {
      if (this.active) closeCompletion(this.view);
    });
  }

  private openMenu(): void {
    if (this.menuEl.hidden) {
      this.menuEl.hidden = false;
      this.view.dom.classList.add("cm-slash-menu-active");
      this.closeOverlay ??= overlayOpened(this.menuEl);
    }
    requestAnimationFrame(() => {
      if (this.active) this.positionMenu();
    });
  }

  private closeMenu(): void {
    this.active = null;
    this.items = [];
    this.autoSlashPos = null;
    if (!this.menuEl.hidden) {
      this.menuEl.hidden = true;
      this.view.dom.classList.remove("cm-slash-menu-active");
    }
    this.closeOverlay?.();
    this.closeOverlay = null;
  }

  private dismiss(removeAutoSlash: boolean): void {
    const cur = this.active;
    const autoPos = this.autoSlashPos;
    if (cur) this.dismissedSlashPos = cur.slashPos;
    this.closeMenu();
    if (removeAutoSlash && cur && autoPos === cur.slashPos && cur.query === "") {
      const slice = this.view.state.sliceDoc(cur.slashPos, cur.slashPos + 1);
      if (slice === "/") {
        this.view.dispatch({ changes: { from: cur.slashPos, to: cur.slashPos + 1, insert: "" } });
      }
    }
  }

  private positionMenu(): void {
    if (!this.active) return;
    const coords = this.view.coordsAtPos(this.active.slashPos) ?? this.view.coordsAtPos(this.active.to);
    if (!coords) return;
    const margin = 8;
    const rect = this.menuEl.getBoundingClientRect();
    const menuW = rect.width || 284;
    const menuH = rect.height || 310;

    const left = Math.max(margin, Math.min(coords.left, window.innerWidth - menuW - margin));
    const spaceBelow = window.innerHeight - coords.bottom - 6 - margin;
    const top = spaceBelow < Math.min(menuH, 220) && coords.top > spaceBelow
      ? Math.max(margin, coords.top - menuH - 6)
      : coords.bottom + 6;

    this.menuEl.style.left = `${Math.round(left)}px`;
    this.menuEl.style.top = `${Math.round(top)}px`;
    this.menuEl.style.maxHeight = `${Math.max(160, Math.min(340, window.innerHeight - top - margin))}px`;
  }

  private renderList(): void {
    this.listEl.replaceChildren();
    if (!this.items.length) {
      this.listEl.hidden = true;
      this.emptyEl.hidden = false;
      return;
    }
    this.listEl.hidden = false;
    this.emptyEl.hidden = true;
    this.items.forEach((item, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cm-slash-item";
      btn.setAttribute("role", "option");
      btn.setAttribute("aria-selected", idx === this.selectedIndex ? "true" : "false");
      btn.dataset.blockId = item.id;

      const badge = document.createElement("span");
      badge.className = `cm-slash-badge tone-${item.tone}`;
      badge.textContent = item.badge;

      const title = document.createElement("span");
      title.className = "cm-slash-title";
      title.textContent = item.title;

      const hint = document.createElement("kbd");
      hint.className = "cm-slash-hint";
      hint.textContent = item.hint;

      btn.append(badge, title, hint);
      btn.addEventListener("mouseenter", () => {
        if (this.selectedIndex !== idx) {
          this.selectedIndex = idx;
          this.paintSelection(false);
        }
      });
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault(); // Keep CodeMirror focus cleanly
        e.stopPropagation();
        this.applyBlock(item);
      });
      this.listEl.appendChild(btn);
    });
  }

  private paintSelection(scroll = true): void {
    const children = this.listEl.querySelectorAll<HTMLElement>(".cm-slash-item");
    children.forEach((el, idx) => {
      const active = idx === this.selectedIndex;
      el.setAttribute("aria-selected", active ? "true" : "false");
      if (active && scroll) el.scrollIntoView({ block: "nearest" });
    });
  }

  private applyBlock(block: SlashBlock): void {
    const cur = this.active;
    if (!cur) return;
    this.closeMenu();

    // If the user typed `> /thm` and selected a callout (`> [!TIP]`), replace the leading `> ` too so it doesn't double-quote.
    const replaceQuotePrefix = !!block.isCallout && /^\s*>\s*$/.test(cur.prefix);
    const from = replaceQuotePrefix ? cur.lineFrom + (/^\s*/.exec(cur.prefix)?.[0].length ?? 0) : cur.slashPos;
    const lineIndent = replaceQuotePrefix ? (/^\s*/.exec(cur.prefix)?.[0] ?? "") : cur.prefix;

    const rawLines = block.template.split("\n");
    const indented = rawLines
      .map((line, i) => (i === 0 ? line : lineIndent + line))
      .join("\n");

    const markerIdx = indented.indexOf("\0");
    const insert = markerIdx >= 0 ? indented.slice(0, markerIdx) + indented.slice(markerIdx + 1) : indented;
    const caret = from + (markerIdx >= 0 ? markerIdx : insert.length);

    this.view.focus();
    this.view.dispatch({
      changes: { from, to: cur.to, insert },
      selection: { anchor: caret },
      scrollIntoView: true,
      userEvent: "input.complete",
    });

    if (block.openCompletion) {
      requestAnimationFrame(() => startCompletion(this.view));
    }
  }

  destroy(): void {
    this.closeMenu();
    this.view.dom.removeEventListener("keydown", this.onKeyDown, true);
    document.removeEventListener("mousedown", this.onDocMouseDown, true);
    this.view.scrollDOM.removeEventListener("scroll", this.onScrollOrResize);
    window.removeEventListener("resize", this.onScrollOrResize);
    this.view.contentDOM.removeEventListener("blur", this.onBlur);
    this.menuEl.remove();
  }
}

const slashMenuTheme = EditorView.baseTheme({
  "&.cm-slash-menu-active .cm-tooltip-autocomplete": {
    display: "none !important",
  },
  ".cm-slash-menu": {
    position: "fixed",
    zIndex: "95",
    width: "288px",
    maxWidth: "calc(100vw - 16px)",
    maxHeight: "332px",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-elev)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius, 8px)",
    boxShadow: "0 10px 30px rgba(0, 0, 0, 0.24), 0 2px 8px rgba(0, 0, 0, 0.12)",
    padding: "4px",
    fontFamily: "var(--font-ui, sans-serif)",
    color: "var(--text)",
    userSelect: "none",
    overflow: "hidden",
  },
  ".cm-slash-menu[hidden]": {
    display: "none !important",
  },
  ".cm-slash-header": {
    padding: "5px 9px 4px",
    fontSize: "10.5px",
    fontWeight: "600",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-faint)",
  },
  ".cm-slash-list": {
    display: "flex",
    flexDirection: "column",
    gap: "1px",
    overflowY: "auto",
    overscrollBehavior: "contain",
    paddingBottom: "2px",
  },
  ".cm-slash-item": {
    display: "flex",
    alignItems: "center",
    gap: "9px",
    width: "100%",
    padding: "5px 8px",
    border: "0",
    borderRadius: "6px",
    background: "transparent",
    color: "var(--text)",
    fontFamily: "var(--font-ui, sans-serif)",
    fontSize: "13px",
    lineHeight: "1.35",
    textAlign: "left",
    cursor: "pointer",
  },
  ".cm-slash-item[aria-selected='true']": {
    background: "color-mix(in srgb, var(--accent) 13%, transparent)",
    color: "var(--text)",
  },
  ".cm-slash-badge": {
    flex: "none",
    width: "22px",
    height: "22px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "5px",
    border: "1px solid var(--border)",
    background: "color-mix(in srgb, var(--text) 4%, transparent)",
    color: "var(--text-muted)",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: "11.5px",
    fontWeight: "600",
    letterSpacing: "-0.02em",
  },
  ".cm-slash-badge.tone-accent": {
    color: "var(--accent)",
    borderColor: "color-mix(in srgb, var(--accent) 28%, var(--border))",
    background: "color-mix(in srgb, var(--accent) 10%, transparent)",
  },
  ".cm-slash-badge.tone-green": {
    color: "var(--green)",
    borderColor: "color-mix(in srgb, var(--green) 28%, var(--border))",
    background: "color-mix(in srgb, var(--green) 10%, transparent)",
  },
  ".cm-slash-badge.tone-yellow": {
    color: "var(--yellow)",
    borderColor: "color-mix(in srgb, var(--yellow) 30%, var(--border))",
    background: "color-mix(in srgb, var(--yellow) 10%, transparent)",
  },
  ".cm-slash-badge.tone-red": {
    color: "var(--red)",
    borderColor: "color-mix(in srgb, var(--red) 28%, var(--border))",
    background: "color-mix(in srgb, var(--red) 10%, transparent)",
  },
  ".cm-slash-title": {
    flex: "1",
    minWidth: "0",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: "450",
  },
  ".cm-slash-hint": {
    flex: "none",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: "11px",
    color: "var(--text-faint)",
    background: "transparent",
    border: "0",
    padding: "0",
    marginLeft: "6px",
  },
  ".cm-slash-empty": {
    padding: "10px 10px 12px",
    fontSize: "12.5px",
    color: "var(--text-faint)",
    textAlign: "center",
  },
});

export function slashMenuExtension(): Extension {
  return [
    ViewPlugin.fromClass(SlashMenuController),
    slashMenuTheme,
  ];
}
