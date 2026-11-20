// Hover & Ctrl-hover previews: resting the pointer on a link or tab — or holding Ctrl/Cmd while
// hovering ANY `[[wikilink]]`, `[[note#heading]]`, `[[note#^block]]`, `\eqref{label}`, or `(eq)`
// reference in rendered Markdown, KaTeX, or CodeMirror source/live-preview lines — opens a crisp
// Notion × Bauhaus `Popover.svelte` card with full `<Markdown>` + KaTeX rendering.
import { EditorView } from "@codemirror/view";
import { mount, unmount } from "svelte";
import Popover, { type HoverPreviewCard, type VirtualAnchor } from "../components/Popover.svelte";
import { api } from "./api";
import { paneElement } from "./dock-panels";
import { noteEquations, numberedTex, texKey } from "./equations";
import { fences } from "./fence-walk";
import { renderMarkdown, stripFrontmatter } from "./markdown";
import { renderMathInto } from "./math";
import { sectionOf } from "./note-anchor";
import { dirOf, IMAGE_RE, shownName } from "./paths";
import { thumbUrl } from "./raw";
import { terminals } from "./registry";
import { settings } from "./settings.svelte";
import { tabs } from "./tabs.svelte";
import { resolveLink } from "./vault";
import { wikilinksIn } from "./wikilink-syntax";

export type PreviewTarget =
  | { kind: "file"; path: string; title?: string; subpath?: string; page?: number }
  | { kind: "equation"; notePath: string; ref: string; tex?: string; label?: string; number?: string }
  | { kind: "url"; url: string }
  | { kind: "pane"; title: string; detail: string }
  /** a link to a file the vault does not have: opening it starts a new note there */
  | { kind: "missing"; path: string }
  /** an open tab: drawn from its own pane, else from its file */
  | { kind: "tab"; id: string; title: string; detail: string; path?: string };

const SHOW_MS = 420, CTRL_SHOW_MS = 60, HIDE_MS = 240, CARD_W = 460;
const TEXT = /\.(md|markdown|txt|py|rs|ts|js|svelte|tex|bib|toml|ya?ml|json|tsv|csv|sh|c|h|cpp|jl|m|lua|css|html|base)$/i;
const EQREF_RE = /\\(?:eq|c|C)?ref\{([^}\s]+)\}/g;
const PAREN_EQ_RE = /\(([A-Za-z0-9.:*-]{1,24})\)/g;

/** The note an element of a note belongs to: the editor or reading view around it says (`data-note`). */
const noteOf = (el: Element | null): string => el?.closest<HTMLElement>("[data-note]")?.dataset.note ?? "";

/** Reads the live CodeMirror buffer if `path` is currently mounted in the DOM, falling back to disk via `api.file`. */
function liveBufferOf(path: string): string | null {
  if (!path) return null;
  for (const cm of document.querySelectorAll<HTMLElement>(".cm-editor[data-note]")) {
    if (cm.dataset.note === path) {
      const view = EditorView.findFromDOM(cm);
      if (view) return view.state.doc.toString();
    }
  }
  return null;
}

async function readNoteText(path: string): Promise<string> {
  const live = liveBufferOf(path);
  if (live !== null) return live;
  return (await api.file(path)).text;
}

export interface MatchedEquation {
  tex: string;
  label?: string;
  number?: string;
}

/** Extracts a display equation matching `\label{ref}`, `$$ ^ref`, `\tag{ref}`, or auto-number `(ref)` from `md`. */
export function findEquationInDoc(md: string, rawRef: string): MatchedEquation | null {
  const cleanRef = rawRef.trim().replace(/^\^/, "");
  if (!cleanRef) return null;
  const eqs = noteEquations(md);
  const lines = md.split("\n");
  const code = fences();

  for (let i = 0; i < lines.length; i++) {
    if (code.code(lines[i])) continue;
    const openMatch = /^[\s>]*(\$\$|\\\[)/.exec(lines[i]);
    if (!openMatch) continue;
    const opener = openMatch[1];
    const closer = opener === "$$" ? "$$" : "\\]";
    let close = lines[i].indexOf(closer, openMatch[0].length) >= 0 ? i : -1;
    for (let k = i + 1; close < 0 && k < lines.length; k++) {
      if (lines[k].includes(closer)) close = k;
    }
    if (close < 0) break;

    const source = lines.slice(i, close + 1).join("\n");
    const labels = [...source.matchAll(/\\label\{([^}]+)\}/g)].map((m) => m[1].trim());
    const blockId = /\$\$[ \t]*\^([A-Za-z0-9-]+)[ \t]*$/.exec(lines[close])?.[1];
    const ownTag = /\\tag\*?\{([^}]*)\}/.exec(source)?.[1]?.trim();
    const texNums = eqs.byTex.get(texKey(source));
    const singleNum =
      (blockId ? eqs.byId.get(blockId) : undefined) ??
      labels.map((l) => eqs.byId.get(l)).find(Boolean);
    const displayNum = singleNum ?? texNums?.find((n): n is string => Boolean(n));

    const matched =
      labels.includes(cleanRef) ||
      blockId === cleanRef ||
      (ownTag !== undefined && ownTag === cleanRef) ||
      (singleNum !== undefined && singleNum === cleanRef) ||
      Boolean(texNums?.includes(cleanRef));

    if (matched) {
      const stripped = source
        .replace(/[ \t]*\^[A-Za-z0-9-]+[ \t]*$/, "")
        .split("\n")
        .map((l) => l.replace(/^[ \t>]*/, ""))
        .join("\n")
        .trim()
        .replace(/^(\$\$|\\\[)\s*/, "")
        .replace(/\s*(\$\$|\\\])$/, "")
        .trim();
      const displayTex = numberedTex(stripped, ownTag ? undefined : (texNums ?? singleNum));
      return {
        tex: displayTex,
        label: labels.includes(cleanRef) ? cleanRef : (labels[0] ?? blockId),
        number: ownTag ?? displayNum,
      };
    }
    i = close;
  }
  return null;
}

/** Resolves a raw `[[target#subpath|alias]]` string relative to `fromNote`. */
function resolveWikiString(raw: string, fromNote: string, includeMissing: boolean): PreviewTarget | null {
  const cleaned = raw.replace(/^!?\[\[|\]\]$/g, "").split("|")[0].trim();
  if (!cleaned) return null;
  const hashIdx = cleaned.indexOf("#");
  const notePart = (hashIdx >= 0 ? cleaned.slice(0, hashIdx) : cleaned).trim();
  const subpath = hashIdx >= 0 ? cleaned.slice(hashIdx + 1).trim() || undefined : undefined;

  if (!notePart) {
    if (!subpath || !fromNote) return null;
    return { kind: "file", path: fromNote, subpath };
  }
  const pageMatch = subpath ? /(?:^|&)page=(\d+)/i.exec(subpath) : null;
  const page = pageMatch ? Number(pageMatch[1]) : undefined;
  const path = resolveLink(notePart, dirOf(fromNote));
  if (path) return { kind: "file", path, subpath, ...(page ? { page } : {}) };
  const norm = notePart.replaceAll("\\", "/");
  if ((norm.startsWith("../") || norm.startsWith("@ext/")) && /\.[a-z0-9]+$/i.test(norm)) {
    return { kind: "file", path: norm, subpath, ...(page ? { page } : {}) };
  }
  return includeMissing ? { kind: "missing", path: notePart } : null;
}

/** What a hovered element points at, or null when it is not a link, equation ref, or tab. */
export function targetOf(el: Element, ctrlHeld = false): PreviewTarget | null {
  const on = (key: "link_preview" | "tab_preview") =>
    (key === "link_preview" ? settings.config?.editor.link_preview : settings.config?.ui.tab_preview) ?? true;

  const tab = el.closest<HTMLElement>("[data-tab-id]");
  if (tab) {
    if (!ctrlHeld && !on("tab_preview")) return null;
    const t = tabs.groups.flatMap((g) => g.tabs).find((x) => x.id === tab.dataset.tabId);
    return t ? { kind: "tab", id: t.id, title: t.title, detail: t.tip, path: t.path?.endsWith(".page") ? undefined : t.path } : null;
  }

  if (!ctrlHeld && !on("link_preview")) return null;

  const fromNote = noteOf(el);

  // Explicit equation link (`a[data-eq]`) or KaTeX `\eqref{...}` span
  const eqAnchor = el.closest<HTMLElement>("a[data-eq]");
  if (eqAnchor?.dataset.eq) {
    const rawHref = eqAnchor.dataset.href ?? "";
    const notePart = rawHref.split("#")[0].trim();
    const targetPath = notePart ? (resolveLink(notePart, dirOf(fromNote)) ?? fromNote) : fromNote;
    if (targetPath) return { kind: "equation", notePath: targetPath, ref: eqAnchor.dataset.eq };
  }

  const katexErr = el.closest<HTMLElement>(".katex-error, .cm-math");
  if (katexErr && fromNote) {
    EQREF_RE.lastIndex = 0;
    const m = EQREF_RE.exec(katexErr.textContent ?? "");
    if (m) return { kind: "equation", notePath: fromNote, ref: m[1] };
  }

  // Rendered or live-preview wikilinks (`a[data-wikilink]`, `.cm-wikilink`, `.cm-hmd-internal-link`, `a.internal-link[data-href]`, `[data-href]`)
  const wiki = el.closest<HTMLElement>(
    "a[data-wikilink], .cm-wikilink, .cm-hmd-internal-link, a.internal-link[data-href], .markdown [data-href], .live-cm [data-href]"
  );
  if (wiki) {
    const raw =
      wiki.dataset.wikilink ??
      wiki.dataset.target ??
      wiki.dataset.href ??
      wiki.textContent ??
      "";
    const resolved = resolveWikiString(raw, fromNote, ctrlHeld || wiki.classList.contains("is-unresolved"));
    if (resolved) return resolved;
  }

  // Standard Markdown links (`[text](url)` or `[text](other.md#heading)`)
  const md = el.closest<HTMLElement>(".cm-link[data-href], .markdown a[href]:not(.internal-link)");
  if (md) {
    const href = md.dataset.href ?? md.getAttribute("href") ?? "";
    if (/^https?:\/\//i.test(href)) return { kind: "url", url: href };
    if (href.startsWith("#") && href.length > 1 && fromNote) {
      return { kind: "file", path: fromNote, subpath: decodeURIComponent(href.slice(1)) };
    }
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
    const hashIdx = href.indexOf("#");
    const filePart = decodeURI(hashIdx >= 0 ? href.slice(0, hashIdx) : href);
    const subpath = hashIdx >= 0 ? decodeURIComponent(href.slice(hashIdx + 1)) || undefined : undefined;
    const path = resolveLink(filePart, dirOf(fromNote), false);
    return path ? { kind: "file", path, subpath } : null;
  }

  return null;
}

/** Inspects a single line of text at character `col` for `[[wikilink]]`, `[md](link)`, `\eqref{...}`, or `(eq)`. */
function matchTextSpanAtCol(
  lineText: string,
  col: number,
  notePath: string,
  docText: string | null
): { target: PreviewTarget; start: number; end: number } | null {
  // 1. `[[target#heading]]` / `[[target#^block]]`
  for (const w of wikilinksIn(lineText)) {
    if (col >= w.start && col <= w.end) {
      const resolved = resolveWikiString(w.target, notePath, true);
      if (resolved) return { target: resolved, start: w.start, end: w.end };
    }
  }

  // 2. `\eqref{label}` / `\ref{label}` / `\cref{label}`
  EQREF_RE.lastIndex = 0;
  for (let m = EQREF_RE.exec(lineText); m; m = EQREF_RE.exec(lineText)) {
    if (col >= m.index && col <= m.index + m[0].length && notePath) {
      const eq = docText ? findEquationInDoc(docText, m[1]) : null;
      return {
        target: { kind: "equation", notePath, ref: m[1], ...(eq ?? {}) },
        start: m.index,
        end: m.index + m[0].length,
      };
    }
  }

  // 3. Markdown links `[label](href)`
  const mdLinkRe = /\[([^\]]*)\]\(([^)\s]+)\)/g;
  for (let m = mdLinkRe.exec(lineText); m; m = mdLinkRe.exec(lineText)) {
    if (col >= m.index && col <= m.index + m[0].length) {
      const href = m[2];
      if (/^https?:\/\//i.test(href)) {
        return { target: { kind: "url", url: href }, start: m.index, end: m.index + m[0].length };
      }
      if (href.startsWith("#") && href.length > 1 && notePath) {
        return {
          target: { kind: "file", path: notePath, subpath: decodeURIComponent(href.slice(1)) },
          start: m.index,
          end: m.index + m[0].length,
        };
      }
      const hashIdx = href.indexOf("#");
      const filePart = decodeURI(hashIdx >= 0 ? href.slice(0, hashIdx) : href);
      const subpath = hashIdx >= 0 ? decodeURIComponent(href.slice(hashIdx + 1)) || undefined : undefined;
      const path = resolveLink(filePart, dirOf(notePath), false);
      if (path) return { target: { kind: "file", path, subpath }, start: m.index, end: m.index + m[0].length };
    }
  }

  // 4. Parenthesized `(eq)` equation references (e.g. `(1)`, `(2)`, `(A.1)`), verified against the document's equations
  if (docText && notePath) {
    PAREN_EQ_RE.lastIndex = 0;
    for (let m = PAREN_EQ_RE.exec(lineText); m; m = PAREN_EQ_RE.exec(lineText)) {
      if (col < m.index || col > m.index + m[0].length) continue;
      // Skip function calls like `f(1)` or LaTeX commands `\left(1`
      if (m.index > 0 && /[A-Za-z0-9_\\]/.test(lineText[m.index - 1])) continue;
      const eq = findEquationInDoc(docText, m[1]);
      if (eq) {
        return {
          target: { kind: "equation", notePath, ref: m[1], ...eq },
          start: m.index,
          end: m.index + m[0].length,
        };
      }
    }
  }

  return null;
}

/** Resolves Ctrl/Cmd-hover at viewport `(x, y)`, checking CodeMirror `posAtCoords`, DOM links, and rendered prose text. */
function resolveCtrlHover(x: number, y: number, el: Element | null): { target: PreviewTarget; anchor: Anchor } | null {
  if (!el) return null;
  // Ctrl over a picture shows it large (image-peek.ts): a card of its own link on top of that would cover it, and the
  // card's picture would then be taken for the one being looked at
  if (el.closest("img.cm-embed-image, .cm-img-frame")) return null;

  // 1. Raw or live-preview CodeMirror text via `posAtCoords`
  const cmDom = el.closest<HTMLElement>(".cm-editor");
  if (cmDom) {
    const view = EditorView.findFromDOM(cmDom);
    const pos = view?.posAtCoords({ x, y }) ?? null;
    if (view && pos !== null) {
      const line = view.state.doc.lineAt(pos);
      const col = pos - line.from;
      const notePath = cmDom.dataset.note ?? noteOf(cmDom);
      const docText = view.state.doc.toString();
      const hit = matchTextSpanAtCol(line.text, col, notePath, docText);
      if (hit) {
        const cStart = view.coordsAtPos(line.from + hit.start);
        const cEnd = view.coordsAtPos(line.from + hit.end);
        const rect = cStart
          ? new DOMRect(
              cStart.left,
              cStart.top,
              Math.max(12, (cEnd?.right ?? cStart.right) - cStart.left),
              Math.max(16, (cEnd?.bottom ?? cStart.bottom) - cStart.top)
            )
          : new DOMRect(x - 6, y - 8, 12, 18);
        return { target: hit.target, anchor: { rect: () => rect, inBar: false } };
      }
    }
  }

  // 2. DOM link / equation element
  const domTarget = targetOf(el, true);
  if (domTarget) {
    const anchorEl =
      el.closest("[data-tab-id], a[data-wikilink], .cm-wikilink, .cm-hmd-internal-link, a.internal-link, a[href], [data-href], .katex-error") ?? el;
    return {
      target: domTarget,
      anchor: { rect: () => anchorEl.getBoundingClientRect(), inBar: !!anchorEl.closest("[data-tab-id]") },
    };
  }

  // 3. Rendered Markdown prose text (`\eqref{label}` or `(eq)`) via caret range under pointer
  const mdRoot = el.closest<HTMLElement>(".markdown");
  const notePath = noteOf(el);
  if (mdRoot && notePath) {
    const textHit = caretTextAt(x, y);
    if (textHit) {
      const cachedDoc = liveBufferOf(notePath);
      // Match `\eqref{...}` even before async read, or `(eq)` when live/cached
      EQREF_RE.lastIndex = 0;
      for (let m = EQREF_RE.exec(textHit.text); m; m = EQREF_RE.exec(textHit.text)) {
        if (textHit.offset >= m.index && textHit.offset <= m.index + m[0].length) {
          return {
            target: { kind: "equation", notePath, ref: m[1] },
            anchor: { rect: () => textHit.rect(m.index, m.index + m[0].length), inBar: false },
          };
        }
      }
      PAREN_EQ_RE.lastIndex = 0;
      for (let m = PAREN_EQ_RE.exec(textHit.text); m; m = PAREN_EQ_RE.exec(textHit.text)) {
        if (textHit.offset < m.index || textHit.offset > m.index + m[0].length) continue;
        if (m.index > 0 && /[A-Za-z0-9_\\]/.test(textHit.text[m.index - 1])) continue;
        if (!cachedDoc || findEquationInDoc(cachedDoc, m[1])) {
          return {
            target: { kind: "equation", notePath, ref: m[1] },
            anchor: { rect: () => textHit.rect(m.index, m.index + m[0].length), inBar: false },
          };
        }
      }
    }
  }

  return null;
}

function caretTextAt(
  x: number,
  y: number
): { text: string; offset: number; rect: (start: number, end: number) => DOMRect } | null {
  const docAny = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let node: Node | null = null;
  let offset = 0;
  if (typeof docAny.caretPositionFromPoint === "function") {
    const pos = docAny.caretPositionFromPoint(x, y);
    if (pos) {
      node = pos.offsetNode;
      offset = pos.offset;
    }
  } else if (typeof docAny.caretRangeFromPoint === "function") {
    const range = docAny.caretRangeFromPoint(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.textContent ?? "";
  return {
    text,
    offset,
    rect: (start: number, end: number) => {
      const r = document.createRange();
      r.setStart(node!, Math.max(0, Math.min(start, text.length)));
      r.setEnd(node!, Math.max(0, Math.min(end, text.length)));
      return r.getBoundingClientRect();
    },
  };
}

const same = (a: PreviewTarget | null, b: PreviewTarget | null) => JSON.stringify(a) === JSON.stringify(b);

/** Builds the structured `HoverPreviewCard` data for `Popover.svelte`. */
async function buildCardData(t: PreviewTarget, width = CARD_W): Promise<HoverPreviewCard | null> {
  if (t.kind === "url") {
    const p = document.createElement("div");
    p.className = "preview-url";
    p.textContent = t.url;
    return { title: new URL(t.url).host, badge: "URL", badgeTone: "muted", htmlNode: p };
  }

  if (t.kind === "missing") {
    const p = document.createElement("div");
    p.className = "preview-url preview-missing";
    p.textContent = "Not in the vault yet — click to create this note.";
    return { title: shownName(t.path), subpath: dirOf(t.path) || undefined, badge: "New note", badgeTone: "red", htmlNode: p };
  }

  if (t.kind === "pane") {
    const p = document.createElement("div");
    p.className = "preview-url";
    p.textContent = t.detail;
    return { title: t.title, htmlNode: p };
  }

  if (t.kind === "tab") {
    const term = terminals.get(t.id);
    const el = paneElement(t.id);
    if (term) {
      const pre = document.createElement("pre");
      pre.className = "preview-term";
      pre.textContent = term.lines(24).join("\n").replace(/\s+$/, "");
      return { title: t.title, badge: "Terminal", badgeTone: "muted", htmlNode: pre };
    }
    if (t.path && /\.pdf$/i.test(t.path)) {
      const { pdfPosition } = await import("./pdf-position");
      return buildCardData({ kind: "file", path: t.path, title: t.title, page: pdfPosition(t.path).page ?? 1 }, width);
    }
    const readable = !!t.path && TEXT.test(t.path);
    const mini = !readable && el && miniature(el, width);
    if (mini) return { title: t.title, htmlNode: mini, mini: true };
    return buildCardData(
      t.path ? { kind: "file", path: t.path, title: t.title } : { kind: "pane", title: t.title, detail: t.detail },
      width
    );
  }

  if (t.kind === "equation") {
    let tex = t.tex;
    let label = t.label;
    let number = t.number;
    if (!tex) {
      const md = await readNoteText(t.notePath);
      const found = findEquationInDoc(md, t.ref);
      if (!found) return null;
      tex = found.tex;
      label = found.label;
      number = found.number;
    }
    const badge = number ? `Equation (${number})` : label ? `Equation · ${label}` : "Equation";
    return {
      title: shownName(t.notePath) || "Equation",
      subpath: dirOf(t.notePath) || undefined,
      badge,
      badgeTone: "accent",
      equationTex: tex,
      notePath: t.notePath,
    };
  }

  // `t.kind === "file"`
  const title = t.title ?? shownName(t.path);
  const folder = dirOf(t.path) || undefined;

  if (IMAGE_RE.test(t.path)) {
    const img = document.createElement("img");
    img.src = await thumbUrl(t.path, 400);
    img.alt = "";
    return { title, subpath: folder, badge: "Image", badgeTone: "muted", htmlNode: img };
  }

  if (/\.pdf$/i.test(t.path)) {
    const { pageBitmap, paint, dpr } = await import("./pdf-pages");
    const canvas = document.createElement("canvas");
    paint(canvas, await pageBitmap(t.path, t.page ?? 1, 380 * dpr()));
    canvas.style.width = "100%";
    const badge = t.page && t.page > 1 ? `PDF · p. ${t.page}` : "PDF";
    return { title, subpath: folder, badge, badgeTone: "muted", htmlNode: canvas };
  }

  if (/\.(md|markdown)$/i.test(t.path)) {
    const rawMd = await readNoteText(t.path);
    if (t.subpath) {
      // If `subpath` is `#^eq-id` pointing to a numbered/labelled display equation, render crisp KaTeX directly!
      if (t.subpath.startsWith("^")) {
        const eq = findEquationInDoc(rawMd, t.subpath.slice(1));
        if (eq) {
          return {
            title,
            subpath: folder,
            badge: eq.number ? `Equation (${eq.number})` : `#${t.subpath}`,
            badgeTone: "accent",
            equationTex: eq.tex,
            notePath: t.path,
          };
        }
      }
      const extracted = stripFrontmatter(sectionOf(rawMd, t.subpath)).slice(0, 4200);
      const isBlock = t.subpath.startsWith("^");
      return {
        title,
        subpath: folder,
        badge: isBlock ? `#${t.subpath}` : `#${t.subpath.split("#").pop()}`,
        badgeTone: isBlock ? "green" : "accent",
        markdown: extracted || "*(empty section)*",
        notePath: t.path,
      };
    }
    const body = stripFrontmatter(rawMd).slice(0, 4200);
    return {
      title,
      subpath: folder,
      markdown: body || "*(empty)*",
      notePath: t.path,
    };
  }

  if (TEXT.test(t.path)) {
    const pre = document.createElement("pre");
    pre.textContent = (await readNoteText(t.path)).split("\n").slice(0, 32).join("\n");
    return { title, subpath: folder, htmlNode: pre };
  }

  const p = document.createElement("div");
  p.className = "preview-url";
  p.textContent = t.path;
  return { title, subpath: folder, htmlNode: p };
}

/** Backwards-compatible DOM drawer: fills `card` directly with preview contents. */
export async function drawPreview(card: HTMLElement, t: PreviewTarget, width = CARD_W): Promise<void> {
  const data = await buildCardData(t, width);
  if (!data) throw new Error("Preview target not found");
  const head = document.createElement("div");
  head.className = "preview-head";
  head.textContent = data.badge ? `${data.title} · ${data.badge}` : data.title;
  const body = document.createElement("div");
  body.className = "preview-body";
  if (data.equationTex) {
    renderMathInto(body, data.equationTex, true);
  } else if (data.markdown !== undefined) {
    body.classList.add("markdown");
    body.innerHTML = renderMarkdown(data.markdown, { dir: dirOf(data.notePath ?? "") });
  } else if (data.htmlNode) {
    body.append(data.htmlNode);
  }
  card.replaceChildren(head, body);
}

/** the size each pane was last seen at: a background tab is detached and has none */
const seen = new WeakMap<HTMLElement, { w: number; h: number }>();

/** A scaled copy of a pane as it was last drawn: its DOM cloned (inert, no ids), canvases copied. */
function miniature(src: HTMLElement, width: number): HTMLElement | null {
  if (!src.childElementCount) return null;
  if (src.isConnected && src.offsetWidth > 0) seen.set(src, { w: src.offsetWidth, h: src.offsetHeight });
  const { w, h } = seen.get(src) ?? { w: 900, h: 640 };
  const scale = (width - 2) / w;
  const copy = src.cloneNode(true) as HTMLElement;
  for (const n of [copy, ...copy.querySelectorAll("*")]) {
    for (const a of ["id", "data-testid", "data-tab-id", "autofocus"]) n.removeAttribute(a);
  }
  const from = src.querySelectorAll("canvas");
  const to = copy.querySelectorAll("canvas");
  from.forEach((c, i) => {
    const d = to[i];
    if (!d || !c.width || !c.height) return;
    d.width = c.width;
    d.height = c.height;
    try {
      d.getContext("2d")?.drawImage(c, 0, 0);
    } catch {
      /* WebGL canvas without preserved buffer */
    }
  });
  Object.assign(copy.style, {
    width: `${w}px`,
    height: `${h}px`,
    transform: `scale(${scale})`,
    transformOrigin: "0 0",
    visibility: "visible",
    position: "relative",
    inset: "auto",
  });
  copy.inert = true;
  const frame = document.createElement("div");
  frame.className = "preview-frame";
  Object.assign(frame.style, { height: `${Math.min(h * scale, 266)}px` });
  frame.append(copy);
  return frame;
}

type Anchor = { rect: () => DOMRect; inBar: boolean; within?: Element };

let mountedPopover: Record<string, unknown> | null = null;
let shown: PreviewTarget | null = null;
let wanted: PreviewTarget | null = null;
let anchor: Anchor | null = null;
let showT: ReturnType<typeof setTimeout> | undefined;
let hideT: ReturnType<typeof setTimeout> | undefined;

const popoverEl = () => document.querySelector<HTMLElement>('.popover.hover-preview[data-testid="hover-preview"]');

function hide(): void {
  clearTimeout(hideT);
  if (mountedPopover) {
    const inst = mountedPopover;
    mountedPopover = null;
    void unmount(inst);
  }
  shown = null;
}

async function show(t: PreviewTarget, a: Anchor): Promise<void> {
  let data: HoverPreviewCard | null = null;
  try {
    data = await buildCardData(t, CARD_W);
  } catch {
    data = null;
  }
  if (!same(wanted, t)) return;
  if (!data) {
    hide();
    return;
  }

  hide();
  shown = t;
  const virtualAnchor: VirtualAnchor = {
    getBoundingClientRect: () => a.rect(),
    inBar: a.inBar,
    isConnected: false,
  };
  mountedPopover = mount(Popover, {
    target: document.body,
    props: {
      anchor: virtualAnchor,
      label: data.badge ? `${data.title} (${data.badge})` : data.title,
      width: CARD_W,
      preview: data,
      hoverMode: true,
      onclose: () => {
        wanted = null;
        hide();
      },
      onpointerenter: () => {
        clearTimeout(hideT);
      },
      onpointerleave: () => {
        clearTimeout(hideT);
        hideT = setTimeout(() => {
          wanted = null;
          hide();
        }, HIDE_MS);
      },
    },
  });
}

function want(t: PreviewTarget | null, a: Anchor | null, immediate = false): void {
  if (same(t, wanted) && t) {
    clearTimeout(hideT);
    return;
  }
  clearTimeout(showT);
  wanted = t;
  anchor = t ? a : null;
  if (!t) {
    clearTimeout(hideT);
    if (shown) hideT = setTimeout(hide, HIDE_MS);
    return;
  }
  const delay = immediate ? CTRL_SHOW_MS : shown ? 120 : SHOW_MS;
  showT = setTimeout(() => {
    if (anchor && same(wanted, t)) void show(t, anchor);
  }, delay);
}

/** For a source that is not an element (a terminal's cells, drawn inside `within`): the card of `t` beside `rect`. */
export function previewAt(t: PreviewTarget | null, rect?: DOMRect, within?: Element): void {
  want(t, rect ? { rect: () => rect, inBar: false, within } : null);
}

let installed = false;

export function installPreviews(): void {
  if (installed) return;
  installed = true;

  let lastX = 0;
  let lastY = 0;

  document.addEventListener("mousemove", (e) => {
    lastX = e.clientX;
    lastY = e.clientY;
    const pop = popoverEl();
    if (pop && pop.contains(e.target as Node)) {
      clearTimeout(hideT);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      const hit = resolveCtrlHover(e.clientX, e.clientY, e.target instanceof Element ? e.target : null);
      if (hit) {
        want(hit.target, hit.anchor, true);
        return;
      }
      if (!anchor?.within?.contains(e.target as Node)) want(null, null);
    }
  }, { passive: true });

  document.addEventListener("mouseover", (e) => {
    const el = e.target as Element;
    const pop = popoverEl();
    if (pop && pop.contains(el)) {
      clearTimeout(hideT);
      return;
    }
    if (e.ctrlKey || e.metaKey) return; // Handled with precision by `mousemove` + `posAtCoords`
    const t = el instanceof Element ? targetOf(el, false) : null;
    if (same(t, wanted) && t) {
      clearTimeout(hideT);
      return;
    }
    if (!t && anchor?.within?.contains(el)) return;
    const at = t ? (el.closest("[data-tab-id]") ?? el) : null;
    want(t, at && { rect: () => at.getBoundingClientRect(), inBar: !!at.closest("[data-tab-id]") });
  });

  const off = () => {
    clearTimeout(showT);
    wanted = null;
    hide();
  };

  document.addEventListener("mousedown", (e) => {
    const pop = popoverEl();
    if (!pop || !pop.contains(e.target as Node)) off();
  }, true);

  document.addEventListener("click", (e) => {
    const pop = popoverEl();
    if (pop && pop.contains(e.target as Node) && (e.target as HTMLElement).closest("a")) {
      // Navigating a link inside the hover card dismisses the preview after handling the click
      requestAnimationFrame(off);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Control" || e.key === "Meta") {
      if (e.repeat) return;
      const el = document.elementFromPoint(lastX, lastY);
      const hit = resolveCtrlHover(lastX, lastY, el);
      if (hit) want(hit.target, hit.anchor, true);
      return;
    }
    if (e.key === "Shift" || e.key === "Alt") return;
    off();
  }, true);

  window.addEventListener("blur", off);
}
