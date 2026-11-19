// Convert pasted HTML from web pages, Google Docs, and Word into clean Obsidian/GFM Markdown.
// Sanitized with DOMPurify and parsed in a detached DOMParser document (never attached to live DOM).
import DOMPurify from "dompurify";
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { frontmatterClose } from "./live/live-preview.js";
import { notePlaceAt } from "./math-context";

const PURIFY_OPTS = {
  ADD_ATTR: ["style", "class", "start", "checked", "type", "colspan", "rowspan", "encoding", "display", "alttext", "data-tex"],
  ADD_TAGS: ["math", "semantics", "annotation"],
  FORBID_TAGS: ["style", "script", "noscript", "template", "svg", "title", "meta", "link", "xml", "iframe", "object", "embed"],
};

const DROP_SELECTORS = "style,script,noscript,template,svg,title,meta,link,xml,iframe,object,embed,head";

function parseSanitizedHtml(raw: string): Document {
  const clean = DOMPurify.sanitize(raw, PURIFY_OPTS);
  const doc = new DOMParser().parseFromString(clean, "text/html");
  doc.body.querySelectorAll(DROP_SELECTORS).forEach((el) => el.remove());
  return doc;
}

const BYPASS_NODES = new Set(["FencedCode", "CodeBlock", "InlineCode", "CodeText", "CodeMark", "InlineMath", "BlockMath"]);

function hasBypassNode(node: SyntaxNode | null): boolean {
  for (let cur = node; cur; cur = cur.parent) {
    if (BYPASS_NODES.has(cur.name)) return true;
  }
  return false;
}

/** Whether rich HTML paste must step aside so plain text, code, math, frontmatter, or Shift-paste works directly. */
export function shouldBypassRichPaste(
  state: EditorState,
  from: number,
  to: number,
  clipboardData: DataTransfer,
  shiftHeld: boolean,
): boolean {
  if (shiftHeld) return true;
  const types = [...clipboardData.types];
  if (types.includes("application/x-codemirror") || types.includes("vscode-editor-data")) return true;

  const fmClose = frontmatterClose(state.doc);
  if (fmClose > 0 && state.doc.lineAt(from).number <= fmClose) return true;

  const tree = syntaxTree(state);
  if (from === to) {
    if (hasBypassNode(tree.resolveInner(from, 0))) return true;
  } else if (hasBypassNode(tree.resolveInner(from, 1)) || hasBypassNode(tree.resolveInner(to, -1))) {
    return true;
  }
  if (notePlaceAt(state, from).kind !== "text") return true;
  if (to > from && notePlaceAt(state, to - 1).kind !== "text") return true;
  return false;
}

/** True when clipboard HTML is only a single image wrapper (e.g. screenshot or browser "Copy image") around attached files. */
export function isImageOnlyClipboardHtml(html: string): boolean {
  const trimmed = html.trim();
  if (!trimmed) return true;
  const doc = parseSanitizedHtml(trimmed);
  if ((doc.body.textContent ?? "").trim().length > 0) return false;
  const imgs = doc.body.querySelectorAll("img");
  return imgs.length === 1;
}

function isSafeUrl(raw: string): boolean {
  const stripped = raw.replace(/[\u0000-\u0020]+/g, "");
  return !/^(?:javascript|vbscript):/i.test(stripped) && !/^data:text\/html/i.test(stripped);
}

function parseStyle(el: Element): Record<string, string> {
  const raw = el.getAttribute("style");
  if (!raw) return {};
  const map: Record<string, string> = {};
  for (const decl of raw.split(";")) {
    const colon = decl.indexOf(":");
    if (colon < 0) continue;
    const key = decl.slice(0, colon).trim().toLowerCase();
    const val = decl.slice(colon + 1).trim().toLowerCase();
    if (key && val) map[key] = val;
  }
  return map;
}

function isBold(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  const fw = parseStyle(el)["font-weight"];
  if (fw) {
    if (fw === "normal" || fw === "lighter") return false;
    const num = Number(fw);
    if (Number.isFinite(num)) return num >= 600;
    if (fw === "bold" || fw === "bolder") return true;
  }
  return tag === "b" || tag === "strong";
}

function isItalic(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  const fs = parseStyle(el)["font-style"];
  if (fs === "normal") return false;
  if (fs === "italic" || fs === "oblique") return true;
  return tag === "i" || tag === "em";
}

function isStrike(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  const style = parseStyle(el);
  const td = style["text-decoration"] ?? style["text-decoration-line"] ?? "";
  if (td.includes("line-through")) return true;
  return tag === "s" || tag === "del" || tag === "strike";
}

function isHighlight(el: Element): boolean {
  return el.tagName.toLowerCase() === "mark";
}

function isInlineCode(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  return tag === "code" || tag === "kbd" || tag === "samp";
}

function isMsoListParagraph(el: Element): boolean {
  return el.tagName.toLowerCase() === "p" && /\bMsoListParagraph/i.test(el.getAttribute("class") ?? "");
}

function hasSemanticFormatting(root: Element): boolean {
  if (root.querySelector("h1,h2,h3,h4,h5,h6,blockquote,pre,code,kbd,samp,ul,ol,li,table,hr,a[href],mark,del,s,strike,em,i,strong,math,img[src]")) {
    return true;
  }
  if (root.querySelector('annotation[encoding="application/x-tex"]')) return true;
  if (root.querySelectorAll("p").length >= 2) return true;
  for (const el of root.querySelectorAll("*")) {
    if (isMsoListParagraph(el) || isBold(el) || isItalic(el) || isStrike(el)) return true;
  }
  return false;
}

function escapeMarkdownText(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/\$/g, "\\$")
    .replace(/==/g, "\\=\\=")
    .replace(/\[\[/g, "\\[\\[");
}

function wrapInline(mark: string, inner: string): string {
  if (!inner.trim()) return inner;
  const lead = /^\s*/.exec(inner)?.[0] ?? "";
  const trail = /\s*$/.exec(inner)?.[0] ?? "";
  const core = inner.slice(lead.length, inner.length - trail.length);
  return `${lead}${mark}${core}${mark}${trail}`;
}

function inlineCodeText(raw: string): string {
  const cleaned = raw.replace(/\u00a0/g, " ").replace(/\r?\n/g, " ");
  if (!cleaned) return "";
  let ticks = "`";
  while (cleaned.includes(ticks)) ticks += "`";
  const pad = cleaned.startsWith("`") || cleaned.endsWith("`") ? " " : "";
  return `${ticks}${pad}${cleaned}${pad}${ticks}`;
}

function texAnnotationOf(el: Element): { tex: string; display: boolean } | null {
  const tag = el.tagName.toLowerCase();
  const isMathHost =
    tag === "math" ||
    el.classList.contains("katex") ||
    el.classList.contains("katex-display") ||
    el.classList.contains("MathJax") ||
    el.hasAttribute("data-tex");
  if (!isMathHost) return null;
  const ann = el.querySelector('annotation[encoding="application/x-tex"]');
  const rawTex = ann?.textContent ?? el.getAttribute("data-tex") ?? el.getAttribute("alttext") ?? "";
  const tex = rawTex.trim();
  if (!tex) return null;
  const display = el.classList.contains("katex-display") || el.getAttribute("display") === "block" || !!el.closest(".katex-display");
  return { tex, display };
}

function isFormattedInlineEl(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const el = node as Element;
  if (isInlineCode(el) || texAnnotationOf(el) !== null) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "a" || tag === "img" || tag === "br" || tag === "input") return false;
  return isBold(el) || isStrike(el) || isHighlight(el);
}

function inlineChildren(el: Element): string {
  let out = "";
  let prevFormatted = false;
  for (const child of el.childNodes) {
    const seg = convertInline(child);
    if (!seg) continue;
    const curFormatted = isFormattedInlineEl(child);
    let merged = false;
    if (prevFormatted && curFormatted) {
      for (const mark of ["**", "~~", "=="]) {
        if (out.endsWith(mark) && seg.startsWith(mark) && out.length > mark.length * 2 && seg.length > mark.length * 2) {
          out = out.slice(0, -mark.length) + seg.slice(mark.length);
          merged = true;
          break;
        }
      }
    }
    if (!merged) out += seg;
    prevFormatted = curFormatted;
  }
  return out;
}

function isExternalHttpUrl(raw: string): boolean {
  const stripped = raw.replace(/[\u0000-\u0020]+/g, "");
  return /^https?:\/\/\S+$/i.test(stripped);
}

function convertInline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const collapsed = (node.textContent ?? "").replace(/[ \t\r\n]+/g, " ");
    return escapeMarkdownText(collapsed);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (tag === "br") return "\n";
  if (tag === "input" && el.getAttribute("type")?.toLowerCase() === "checkbox") return "";

  const math = texAnnotationOf(el);
  if (math) return math.display ? `\n$$\n${math.tex}\n$$\n` : `$${math.tex}$`;

  if (isInlineCode(el)) return inlineCodeText(el.textContent ?? "");

  if (tag === "a") {
    const href = (el.getAttribute("href") ?? "").trim();
    const label = inlineChildren(el).trim();
    if (!href || !isSafeUrl(href)) return label;
    if (!label || label === href) return `<${href}>`;
    return `[${label}](${href})`;
  }

  if (tag === "img") {
    const src = (el.getAttribute("src") ?? "").trim();
    const alt = (el.getAttribute("alt") ?? "").trim().replace(/[[\]]/g, "");
    if (!src || !isExternalHttpUrl(src)) return "";
    return `![${alt}](${src})`;
  }

  // Google Docs wraps entire documents in `<b style="font-weight:normal">` containing block children.
  if (el.querySelector("h1,h2,h3,h4,h5,h6,p,div,ul,ol,blockquote,pre,table,hr,section,article")) {
    return convertBlocks(el);
  }

  let text = inlineChildren(el);
  if (!text) return "";
  if (isHighlight(el)) text = wrapInline("==", text);
  if (isStrike(el)) text = wrapInline("~~", text);
  if (isItalic(el)) text = wrapInline("*", text);
  if (isBold(el)) text = wrapInline("**", text);
  return text;
}

function convertMsoListParagraph(el: Element): string {
  const style = parseStyle(el);
  const msoList = style["mso-list"] ?? "";
  const lvlMatch = /\blevel(\d+)/i.exec(msoList);
  const depth = lvlMatch ? Math.max(0, Number(lvlMatch[1]) - 1) : 0;

  let markerText = "";
  const clone = el.cloneNode(true) as Element;
  for (const span of clone.querySelectorAll("span")) {
    const spStyle = (span.getAttribute("style") ?? "").toLowerCase();
    if (spStyle.includes("mso-list:ignore") || spStyle.includes("mso-list: ignore")) {
      markerText += span.textContent ?? "";
      span.remove();
    }
  }
  let body = inlineChildren(clone).trim();
  if (!markerText) {
    const lead = /^([•·▪▫◦‣o\-–—]|\d+[.)]|[a-zA-Z][.)])\s+/.exec(body);
    if (lead) {
      markerText = lead[1];
      body = body.slice(lead[0].length).trim();
    }
  }
  const ordered = /^\d+[.)]?$|^[a-zA-Z][.)]$/.test(markerText.trim());
  const prefix = ordered ? "1. " : "- ";
  return `${"    ".repeat(depth)}${prefix}${body}\n`;
}

function convertList(listEl: Element, depth: number): string {
  const ordered = listEl.tagName.toLowerCase() === "ol";
  const startRaw = Number(listEl.getAttribute("start") ?? "1");
  let index = Number.isFinite(startRaw) && startRaw > 0 ? Math.floor(startRaw) : 1;
  let out = "";

  for (const child of listEl.children) {
    const cTag = child.tagName.toLowerCase();
    if (cTag === "ul" || cTag === "ol") {
      out += convertList(child, depth + 1);
      continue;
    }
    if (cTag !== "li") continue;
    const checkbox = child.querySelector('input[type="checkbox"]');
    const isTask = checkbox !== null && checkbox.closest("li") === child;
    const marker = isTask
      ? (checkbox.hasAttribute("checked") ? "- [x] " : "- [ ] ")
      : ordered
        ? `${index++}. `
        : "- ";

    let inlinePart = "";
    let nestedPart = "";
    for (const liChild of child.childNodes) {
      if (liChild.nodeType === Node.ELEMENT_NODE) {
        const tag = (liChild as Element).tagName.toLowerCase();
        if (tag === "ul" || tag === "ol") {
          nestedPart += convertList(liChild as Element, depth + 1);
          continue;
        }
        if (tag === "p") {
          const pText = inlineChildren(liChild as Element).trim();
          if (pText) inlinePart += (inlinePart ? " " : "") + pText;
          continue;
        }
      }
      inlinePart += convertInline(liChild);
    }
    const cleanLine = inlinePart.replace(/[ \t]*\n[ \t]*/g, " ").trim();
    out += `${"    ".repeat(depth)}${marker}${cleanLine}\n`;
    if (nestedPart) out += nestedPart;
  }
  return out;
}

function convertTable(tableEl: Element): string {
  const rows: string[][] = [];
  for (const tr of tableEl.querySelectorAll("tr")) {
    if (tr.closest("table") !== tableEl) continue;
    const row: string[] = [];
    for (const cell of tr.children) {
      const tag = cell.tagName.toLowerCase();
      if (tag !== "th" && tag !== "td") continue;
      const raw = convertBlocks(cell).trim();
      const collapsed = raw
        .replace(/\n{2,}/g, "<br>")
        .replace(/\n/g, "<br>")
        .replace(/(?<!\\)\|/g, "\\|")
        .trim();
      row.push(collapsed);
      const span = Math.max(1, Number(cell.getAttribute("colspan") ?? "1") || 1);
      for (let k = 1; k < span; k++) row.push("");
    }
    if (row.length) rows.push(row);
  }
  if (!rows.length) return "";
  const cols = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => Array.from({ length: cols }, (_, i) => r[i] ?? "");
  const head = pad(rows[0]);
  const sep = head.map(() => "---");
  const lines = [`| ${head.join(" | ")} |`, `| ${sep.join(" | ")} |`];
  for (let i = 1; i < rows.length; i++) {
    lines.push(`| ${pad(rows[i]).join(" | ")} |`);
  }
  return `\n\n${lines.join("\n")}\n\n`;
}

function convertPre(preEl: Element): string {
  const codeEl = preEl.querySelector("code");
  const cls = `${codeEl?.getAttribute("class") ?? ""} ${preEl.getAttribute("class") ?? ""}`;
  const langMatch = /(?:language|lang)-([a-zA-Z0-9_+-]+)/.exec(cls);
  const lang = langMatch?.[1] ?? "";
  const raw = (codeEl ?? preEl).textContent?.replace(/\r\n?/g, "\n").replace(/\n$/, "") ?? "";
  let fence = "```";
  while (raw.includes(fence)) fence += "`";
  return `\n\n${fence}${lang}\n${raw}\n${fence}\n\n`;
}

function convertBlockElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const math = texAnnotationOf(el);
  if (math) return math.display ? `\n\n$$\n${math.tex}\n$$\n\n` : `$${math.tex}$`;

  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag[1]);
    const text = inlineChildren(el).replace(/\s*\n\s*/g, " ").trim();
    return text ? `\n\n${"#".repeat(level)} ${text}\n\n` : "";
  }
  if (tag === "hr") return "\n\n---\n\n";
  if (tag === "pre") return convertPre(el);
  if (tag === "table") return convertTable(el);
  if (tag === "ul" || tag === "ol") return `\n\n${convertList(el, 0)}\n`;
  if (tag === "blockquote") {
    const inner = convertBlocks(el).trim();
    if (!inner) return "";
    const quoted = inner.split("\n").map((l) => (l.trim() ? `> ${l}` : ">")).join("\n");
    return `\n\n${quoted}\n\n`;
  }
  if (isMsoListParagraph(el)) return convertMsoListParagraph(el);
  if (tag === "p" || tag === "div" || tag === "section" || tag === "article" || tag === "header" || tag === "footer") {
    const hasBlockChild = [...el.children].some((c) =>
      /^(?:h[1-6]|p|div|ul|ol|blockquote|pre|table|hr|section|article|math)$/i.test(c.tagName) ||
      c.classList.contains("katex-display"),
    );
    if (hasBlockChild) return `\n\n${convertBlocks(el).trim()}\n\n`;
    const text = inlineChildren(el).trim();
    return text ? `\n\n${text}\n\n` : "";
  }
  return convertInline(el);
}

function convertBlocks(parent: Element): string {
  let out = "";
  let inlineBuf = "";
  const flushInline = () => {
    if (!inlineBuf) return;
    const trimmed = inlineBuf.replace(/^[ \t]+|[ \t]+$/g, "");
    if (trimmed) out += trimmed;
    inlineBuf = "";
  };

  for (const child of parent.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      const tag = el.tagName.toLowerCase();
      const isBlock =
        /^(?:h[1-6]|p|div|ul|ol|blockquote|pre|table|hr|section|article|header|footer)$/i.test(tag) ||
        el.classList.contains("katex-display") ||
        (tag === "math" && el.getAttribute("display") === "block");
      if (isBlock) {
        flushInline();
        out += convertBlockElement(el);
        continue;
      }
    }
    inlineBuf += convertInline(child);
  }
  flushInline();
  return out;
}

/** Convert rich HTML into clean Markdown, or `null` when it carries no semantic formatting/structure. */
export function htmlToMarkdown(html: string): string | null {
  const trimmed = html.trim();
  if (!trimmed) return null;

  const doc = parseSanitizedHtml(trimmed);
  if (!hasSemanticFormatting(doc.body)) return null;

  const rawMd = convertBlocks(doc.body);
  const normalized = rawMd
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return normalized || null;
}

/** Handle a rich HTML clipboard paste in the note editor, returning true when handled. */
export function handleRichHtmlPaste(e: ClipboardEvent, view: EditorView, shiftHeld: boolean): boolean {
  const cd = e.clipboardData;
  const html = cd?.getData("text/html") ?? "";
  if (!cd || !html.trim()) return false;
  if (cd.files.length > 0 && isImageOnlyClipboardHtml(html)) return false;

  const sel = view.state.selection.main;
  if (shouldBypassRichPaste(view.state, sel.from, sel.to, cd, shiftHeld)) return false;

  const md = htmlToMarkdown(html);
  if (md === null) return false;

  e.preventDefault();
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: md },
    selection: { anchor: sel.from + md.length },
    userEvent: "input.paste",
    scrollIntoView: true,
  });
  return true;
}
