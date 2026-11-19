import { splitFrontmatter } from "./translate";
import { MARGINS, type Options } from "./helper";
import { CALLOUT_LABELS, convertInline, escapeHtml, parseTableAligns, parseTableRow, safeHref } from "./md_typst";

/** Direct Markdown -> standalone self-contained HTML5 converter. */
export function markdownToHtml(md: string, opts: Options = {}): string {
  const [fm, rawBody] = splitFrontmatter(md);
  const title = opts.title ?? fm.title;
  const docTitle = title || "Document";
  const subtitle = opts.subtitle ?? fm.subtitle;
  const author = opts.author ?? fm.author;
  const date = opts.date ?? fm.date;
  const lang = opts.lang || "en";
  const margin = MARGINS[opts.margins ?? "normal"] ?? MARGINS.normal;
  const fontsize = opts.fontsize || "11pt";
  const paper = opts.paper === "letter" ? "letter" : "A4";
  const twoCol = Number(opts.columns) === 2;

  const headings: { level: number; id: string; html: string }[] = [];
  const counters = [0, 0, 0, 0, 0, 0];
  const blocks: string[] = [];
  const lines = rawBody.replace(/\r\n/g, "\n").split("\n");

  const nextHeadingId = (level: number, raw: string) => {
    counters[level - 1]++;
    for (let k = level; k < 6; k++) counters[k] = 0;
    const slug = raw.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-") || "sec";
    const num = counters.slice(0, level).join(".");
    return { id: `h-${headings.length + 1}-${slug}`, num };
  };

  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    // Fenced code
    const fmFence = /^\s*(`{3,}|~{3,})\s*(.*)$/.exec(line);
    if (fmFence) {
      const fence = fmFence[1], codeLang = fmFence[2].trim().split(/\s+/)[0] || "";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !(lines[i].trim().startsWith(fence) && lines[i].trim().replaceAll(fence[0], "") === "")) {
        codeLines.push(lines[i++]);
      }
      if (i < lines.length) i++;
      if (codeLang !== "{=typst}") {
        const cls = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : "";
        blocks.push(`<pre><code${cls}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      }
      continue;
    }

    // Display math `$$ ... $$`
    if (line.trim().startsWith("$$")) {
      const single = /^\$\$(.+)\$\$$/.exec(line.trim());
      if (single) {
        blocks.push(`<div class="math display">$$${escapeHtml(single[1].trim())}$$</div>`);
        i++;
        continue;
      }
      const mathLines: string[] = [line.trim().slice(2)];
      i++;
      while (i < lines.length && !lines[i].includes("$$")) mathLines.push(lines[i++]);
      if (i < lines.length) {
        const tail = lines[i++];
        mathLines.push(tail.slice(0, tail.indexOf("$$")));
      }
      blocks.push(`<div class="math display">$$${escapeHtml(mathLines.join("\n").trim())}$$</div>`);
      continue;
    }

    // Headings
    const hm = /^(#{1,6})\s+(.+?)(?:\s+#+)?$/.exec(line);
    if (hm) {
      const level = hm[1].length;
      const { id, num } = nextHeadingId(level, hm[2]);
      const inner = convertInline(hm[2], "html");
      const prefix = opts.numbered ? `<span class="secnum">${num}</span> ` : "";
      headings.push({ level, id, html: `${prefix}${inner}` });
      blocks.push(`<h${level} id="${id}">${prefix}${inner}</h${level}>`);
      i++;
      continue;
    }

    // Rule
    if (/^(?:---+|\*\*\*+|___+)\s*$/.test(line)) { blocks.push("<hr>"); i++; continue; }

    // Blockquote / Callout
    if (/^\s*>\s?/.test(line)) {
      const qLines: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) qLines.push(lines[i++].replace(/^\s*>\s?/, ""));
      const cm = /^\[!([\w-]+)\]([+-]?)\s*(.*)$/.exec(qLines[0] ?? "");
      if (cm) {
        const meta = CALLOUT_LABELS[cm[1].toLowerCase()] ?? { label: cm[1], color: "#6b7280" };
        const heading = cm[3].trim() || meta.label;
        const inner = qLines.slice(1).map((l) => (l.trim() ? `<p>${convertInline(l, "html")}</p>` : "")).join("");
        blocks.push(`<aside class="callout" style="border-left-color:${meta.color}"><div class="callout-title">${escapeHtml(heading)}</div>${inner}</aside>`);
      } else {
        const inner = qLines.map((l) => (l.trim() ? `<p>${convertInline(l, "html")}</p>` : "")).join("");
        blocks.push(`<blockquote>${inner}</blockquote>`);
      }
      continue;
    }

    // Table
    if (line.includes("|") && i + 1 < lines.length) {
      const aligns = parseTableAligns(lines[i + 1]);
      if (aligns) {
        const header = parseTableRow(line);
        i += 2;
        const rows: string[][] = [];
        while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(parseTableRow(lines[i++]));
        const ths = aligns.map((a, c) => `<th style="text-align:${a}">${convertInline(header[c] ?? "", "html")}</th>`).join("");
        const trs = rows.map((r) => `<tr>${aligns.map((a, c) => `<td style="text-align:${a}">${convertInline(r[c] ?? "", "html")}</td>`).join("")}</tr>`).join("");
        blocks.push(`<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`);
        continue;
      }
    }

    // Nested list (bullet / task / numbered)
    const parseList = (minIndent: number): string => {
      const first = /^([ \t]*)(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(lines[i] ?? "");
      if (!first) return "";
      const tag = first[2] ? "ul" : "ol";
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^([ \t]*)(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(lines[i]);
        if (!m) break;
        const ind = m[1].replace(/\t/g, "  ").length;
        if (ind < minIndent) break;
        if (ind > minIndent) {
          const nested = parseList(ind);
          if (items.length) items[items.length - 1] = items[items.length - 1].replace(/<\/li>$/, `${nested}</li>`);
          else items.push(`<li>${nested}</li>`);
          continue;
        }
        if ((m[2] ? "ul" : "ol") !== tag) break;
        i++;
        const task = m[2] ? /^\[([ xX])\]\s+(.*)$/.exec(m[4]) : null;
        const content = task
          ? `<input type="checkbox" disabled${task[1].toLowerCase() === "x" ? " checked" : ""}> ${convertInline(task[2], "html")}`
          : convertInline(m[4], "html");
        items.push(`<li>${content}</li>`);
      }
      return `<${tag}>${items.join("")}</${tag}>`;
    };
    const lm = /^([ \t]*)(?:([-*+])|(\d+)[.)])\s+/.exec(line);
    if (lm) { blocks.push(parseList(lm[1].replace(/\t/g, "  ").length)); continue; }

    // Paragraph (consecutive non-blank, non-block lines)
    const pLines: string[] = [];
    while (
      i < lines.length && lines[i].trim() &&
      !/^(?:#{1,6}\s|>|`{3,}|~{3,}|\$\$|---+|\*\*\*+|___+|[ \t]*(?:[-*+]|\d+[.)])\s)/.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && parseTableAligns(lines[i + 1]))
    ) {
      pLines.push(convertInline(lines[i++], "html"));
    }
    if (pLines.length) blocks.push(`<p>${pLines.join(" ")}</p>`);
  }

  const tocHtml = opts.toc && headings.length
    ? `<nav class="toc"><h2>Contents</h2><ul>${headings.map((h) => `<li class="toc-l${h.level}"><a href="#${h.id}">${h.html}</a></li>`).join("")}</ul></nav>`
    : "";
  const headerHtml = (title ?? subtitle ?? author ?? date)
    ? `<header class="doc-header">${title ? `<h1>${escapeHtml(title)}</h1>` : ""}${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ""}${[author, date].filter(Boolean).length ? `<p class="meta">${[author, date].filter((x): x is string => Boolean(x)).map(escapeHtml).join(" · ")}</p>` : ""}</header>`
    : "";

  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(docTitle)}</title>
<style>
@page { size: ${paper}; margin: ${margin}; }
:root { color-scheme: light dark; --fg: #1c1917; --bg: #ffffff; --muted: #57534e; --border: #e7e5e4; --code-bg: #f5f5f4; --accent: #2563eb; }
@media (prefers-color-scheme: dark) { :root { --fg: #e7e5e4; --bg: #18181b; --muted: #a8a29e; --border: #3f3f46; --code-bg: #27272a; --accent: #60a5fa; } }
body { font-family: ${opts.font ? `"${escapeHtml(opts.font)}", ` : ""}Georgia, "Times New Roman", serif; font-size: ${escapeHtml(fontsize)}; line-height: 1.65; color: var(--fg); background: var(--bg); max-width: ${twoCol ? "68rem" : "46rem"}; margin: 0 auto; padding: 2.5rem ${escapeHtml(margin)}; }
main { ${twoCol ? "column-count: 2; column-gap: 2.2rem;" : ""} }
.doc-header { text-align: center; margin-bottom: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 1rem; }
.doc-header h1 { margin: 0 0 0.35rem; font-size: 1.9em; }
.doc-header .subtitle, .doc-header .meta { margin: 0.2rem 0; color: var(--muted); }
.toc { border: 1px solid var(--border); border-radius: 6px; padding: 0.85rem 1.2rem; margin-bottom: 1.6rem; font-size: 0.92em; }
.toc h2 { margin: 0 0 0.5rem; font-size: 1em; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
.toc ul { list-style: none; margin: 0; padding: 0; }
.toc li.toc-l2 { padding-left: 1rem; } .toc li.toc-l3 { padding-left: 2rem; }
h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 1.4em 0 0.5em; break-after: avoid; }
.secnum { color: var(--muted); font-weight: normal; }
a { color: var(--accent); }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; background: var(--code-bg); border-radius: 4px; }
code { padding: 0.12em 0.32em; }
pre { padding: 0.85rem 1rem; overflow-x: auto; } pre code { padding: 0; background: none; }
blockquote, .callout { margin: 1rem 0; padding: 0.65rem 1rem; border-left: 3px solid var(--border); background: var(--code-bg); border-radius: 0 4px 4px 0; }
.callout-title { font-weight: 600; margin-bottom: 0.25rem; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
th, td { border: 1px solid var(--border); padding: 0.4rem 0.65rem; } th { background: var(--code-bg); }
figure { margin: 1.2rem 0; text-align: center; } figcaption { color: var(--muted); font-size: 0.88em; margin-top: 0.35rem; }
img { max-width: 100%; height: auto; }
mark { background: #fef08a; color: #1c1917; padding: 0 0.2em; border-radius: 2px; }
.math.display { overflow-x: auto; text-align: center; margin: 0.9rem 0; }
hr { border: none; border-top: 1px solid var(--border); margin: 1.8rem 0; }
</style>
</head>
<body>
${headerHtml}${tocHtml}<main>
${blocks.join("\n")}
</main>
</body>
</html>
`;
}
