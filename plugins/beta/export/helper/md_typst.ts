import { splitFrontmatter } from "./translate";
import { MARGINS, type Options } from "./helper";

const escapeTypstText = (s: string): string => s.replace(/([\\#*_$@<>\[\]])/g, "\\$1");
export const escapeTypstString = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
export const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
export const safeHref = (url: string): string => (/^\s*(?:javascript|vbscript|data:text\/html):/i.test(url) ? "#" : url.trim());

/** Reads one `{...}` argument starting at `start`; returns `[inner, endIndex]` or null. */
function readBraceGroup(s: string, start: number): [string, number] | null {
  let i = start;
  while (i < s.length && s[i] === " ") i++;
  if (s[i] !== "{") return null;
  let depth = 0;
  for (let k = i; k < s.length; k++) {
    if (s[k] === "\\" && k + 1 < s.length) { k++; continue; }
    if (s[k] === "{") depth++;
    else if (s[k] === "}") {
      depth--;
      if (depth === 0) return [s.slice(i + 1, k), k + 1];
    }
  }
  return null;
}

const TYPST_MATH_SYMS: [RegExp, string][] = [
  [/\\qquad/g, " wide "], [/\\quad/g, " quad "], [/\\[,;!]/g, " thin "], [/\\\\/g, " \\ "],
  [/\\\{/g, "lbrace "], [/\\\}/g, "rbrace "], [/\\\|/g, " || "],
  [/\\left\\langle\b/g, "angle.l "], [/\\right\\rangle\b/g, " angle.r"],
  [/\\left\b/g, ""], [/\\right\b/g, ""], [/\\langle\b/g, "angle.l "], [/\\rangle\b/g, "angle.r "],
  [/\\infty\b/g, "infinity"], [/\\partial\b/g, "diff"], [/\\nabla\b/g, "nabla"],
  [/\\cdot\b/g, "dot.op"], [/\\times\b/g, "times"], [/\\div\b/g, "div"], [/\\pm\b/g, "plus.minus"], [/\\mp\b/g, "minus.plus"],
  [/\\leq?\b/g, "<="], [/\\geq?\b/g, ">="], [/\\neq?\b/g, "!="], [/\\approx\b/g, "approx"], [/\\equiv\b/g, "equiv"], [/\\sim\b/g, "tilde.op"],
  [/\\subseteq\b/g, "subset.eq"], [/\\subset\b/g, "subset"], [/\\supseteq\b/g, "supset.eq"], [/\\supset\b/g, "supset"],
  [/\\notin\b/g, "in.not"], [/\\in\b/g, "in"], [/\\forall\b/g, "forall"], [/\\exists\b/g, "exists"],
  [/\\Leftrightarrow\b/g, "<=>"], [/\\Rightarrow\b/g, "=>"], [/\\Leftarrow\b/g, "<="],
  [/\\leftrightarrow\b/g, "<->"], [/\\rightarrow\b|\\to\b/g, "->"], [/\\leftarrow\b|\\gets\b/g, "<-"], [/\\mapsto\b/g, "|->"],
  [/\\sum\b/g, "sum"], [/\\prod\b/g, "product"], [/\\oint\b/g, "integral.cont"], [/\\iint\b/g, "integral.double"], [/\\int\b/g, "integral"],
  [/\\varepsilon\b/g, "epsilon.alt"], [/\\varphi\b/g, "phi.alt"], [/\\vartheta\b/g, "theta.alt"], [/\\ell\b/g, "ell"], [/\\hbar\b/g, "planck.reduce"],
];

const GREEK = "alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega";
const GREEK_RE = new RegExp(`\\\\(${GREEK})\\b`, "g");

/** Converts common LaTeX math commands into valid Typst math notation. */
export function latexMathToTypst(tex: string): string {
  let s = tex.trim()
    .replace(/\\begin\{aligned\*?\}/g, "").replace(/\\end\{aligned\*?\}/g, "")
    .replace(/\\begin\{cases\}([\s\S]*?)\\end\{cases\}/g, (_, body: string) => `cases(${body.replace(/\\\\/g, ", ")})`)
    .replace(/\\begin\{[pbvBV]?matrix\}([\s\S]*?)\\end\{[pbvBV]?matrix\}/g, (_, body: string) => `mat(${body.replace(/&/g, ",").replace(/\\\\/g, ";")})`);

  // Recursively expand structured TeX commands with brace groups (\frac, \sqrt, \ket, \bra, \text, accents).
  const expandCmds = (input: string): string => {
    let out = "";
    for (let i = 0; i < input.length; ) {
      if (input[i] === "\\") {
        const m = /^\\(frac|sqrt|ket|bra|braket|text|mathrm|mathbf|mathcal|mathbb|hat|tilde|bar|vec|dot|ddot)\b/.exec(input.slice(i));
        if (m) {
          const cmd = m[1];
          let pos = i + m[0].length;
          if (cmd === "sqrt" && input[pos] === "[") {
            const end = input.indexOf("]", pos + 1);
            if (end > pos) {
              const g = readBraceGroup(input, end + 1);
              if (g) { out += `root(${input.slice(pos + 1, end)}, ${expandCmds(g[0])})`; i = g[1]; continue; }
            }
          }
          const g1 = readBraceGroup(input, pos);
          if (g1) {
            if (cmd === "frac") {
              const g2 = readBraceGroup(input, g1[1]);
              if (g2) { out += `(${expandCmds(g1[0])})/(${expandCmds(g2[0])})`; i = g2[1]; continue; }
            }
            const inner = expandCmds(g1[0]);
            if (cmd === "sqrt") out += `sqrt(${inner})`;
            else if (cmd === "ket") out += `lr(|${inner} angle.r)`;
            else if (cmd === "bra") out += `lr(angle.l ${inner}|)`;
            else if (cmd === "braket") out += `lr(angle.l ${inner} angle.r)`;
            else if (cmd === "text") out += `"${escapeTypstString(inner)}"`;
            else if (cmd === "mathrm") out += `upright(${inner})`;
            else if (cmd === "mathbf") out += `bold(${inner})`;
            else if (cmd === "mathcal") out += `cal(${inner})`;
            else if (cmd === "mathbb") out += `bb(${inner})`;
            else if (cmd === "bar") out += `macron(${inner})`;
            else if (cmd === "vec") out += `arrow(${inner})`;
            else if (cmd === "ddot") out += `dot.double(${inner})`;
            else out += `${cmd}(${inner})`;
            i = g1[1];
            continue;
          }
        }
      }
      out += input[i++];
    }
    return out;
  };

  s = expandCmds(s);
  for (const [re, rep] of TYPST_MATH_SYMS) s = s.replace(re, rep);
  s = s.replace(GREEK_RE, "$1");
  // Convert TeX grouped sub/superscripts `_{...}` / `^{...}` to Typst `_(` / `^(` parentheses.
  let grouped = "";
  for (let i = 0; i < s.length; ) {
    if ((s[i] === "_" || s[i] === "^") && s[i + 1] === "{") {
      const g = readBraceGroup(s, i + 1);
      if (g) {
        const inner = g[0].trim();
        grouped += `${s[i]}${/^[A-Za-z0-9]$/.test(inner) ? inner : `(${inner})`}`;
        i = g[1];
        continue;
      }
    }
    grouped += s[i++];
  }
  return grouped.replace(/\\([A-Za-z]+)\b/g, "$1").replace(/[ \t]+/g, " ").trim();
}

function normalizeImagePath(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("<") && trimmed.endsWith(">") ? trimmed.slice(1, -1) : trimmed;
}

/** Converts one line of Markdown inline syntax for either `"typst"` or `"html"`. */
export function convertInline(text: string, target: "typst" | "html"): string {
  let out = "";
  for (let i = 0; i < text.length; ) {
    // 1. Inline code span
    if (text[i] === "`") {
      let ticks = 1;
      while (text[i + ticks] === "`") ticks++;
      const fence = "`".repeat(ticks);
      const end = text.indexOf(fence, i + ticks);
      if (end !== -1) {
        const code = text.slice(i + ticks, end);
        out += target === "typst" ? `${fence}${code}${fence}` : `<code>${escapeHtml(code)}</code>`;
        i = end + ticks;
        continue;
      }
    }
    // 2. Inline math `$...$` (not `$$`, and not currency like `$5 `)
    if (text[i] === "$" && text[i + 1] !== "$" && text[i + 1] && !/\s/.test(text[i + 1])) {
      let end = i + 1;
      while (end < text.length && !(text[end] === "$" && text[end - 1] !== "\\")) end++;
      if (end < text.length && end > i + 1 && !/\s/.test(text[end - 1])) {
        const tex = text.slice(i + 1, end);
        out += target === "typst" ? `$${latexMathToTypst(tex)}$` : `<span class="math inline">$${escapeHtml(tex)}$</span>`;
        i = end + 1;
        continue;
      }
    }
    // 3. Obsidian image/note embed `![[...]]`
    if (text.startsWith("![[", i)) {
      const end = text.indexOf("]]", i + 3);
      if (end !== -1) {
        const [rawPath, alias] = text.slice(i + 3, end).split("|");
        const p = rawPath.split("#")[0].trim();
        out += target === "typst"
          ? `#image("${escapeTypstString(p)}")`
          : `<img src="${escapeHtml(safeHref(p))}" alt="${escapeHtml((alias ?? p).trim())}">`;
        i = end + 2;
        continue;
      }
    }
    // 4. Markdown image `![alt](path)` with optional `{width=123pt}` attribute from fences()
    if (text.startsWith("![", i)) {
      const closeAlt = text.indexOf("]", i + 2);
      if (closeAlt !== -1 && text[closeAlt + 1] === "(") {
        const closeUrl = text.indexOf(")", closeAlt + 2);
        if (closeUrl !== -1) {
          const alt = text.slice(i + 2, closeAlt).trim();
          const url = normalizeImagePath(text.slice(closeAlt + 2, closeUrl));
          let nextIdx = closeUrl + 1;
          const wm = /^\{width=([\d.]+(?:pt|px|cm|mm|in|%))\}/.exec(text.slice(nextIdx));
          const width = wm ? wm[1] : "";
          if (wm) nextIdx += wm[0].length;
          if (target === "typst") {
            const imgCall = width ? `image("${escapeTypstString(url)}", width: ${width})` : `image("${escapeTypstString(url)}")`;
            out += alt ? `#figure(${imgCall}, caption: [${convertInline(alt, "typst")}])` : `#${imgCall}`;
          } else {
            const style = width ? ` style="width:${escapeHtml(width)}"` : "";
            out += alt
              ? `<figure><img src="${escapeHtml(safeHref(url))}" alt="${escapeHtml(alt)}"${style}><figcaption>${convertInline(alt, "html")}</figcaption></figure>`
              : `<img src="${escapeHtml(safeHref(url))}" alt=""${style}>`;
          }
          i = nextIdx;
          continue;
        }
      }
    }
    // 5. Citations `[@key]` / `[@a; @b]`
    if (text[i] === "[") {
      const citeM = /^\[(@[\w:-]+(?:\s*[;,]\s*@[\w:-]+)*)\]/.exec(text.slice(i));
      if (citeM) {
        const keys = citeM[1].split(/[;,]/).map((k) => k.trim().replace(/^@/, "")).filter(Boolean);
        out += target === "typst" ? keys.map((k) => `@${k}`).join(" ") : `<span class="cite">[${escapeHtml(keys.join(", "))}]</span>`;
        i += citeM[0].length;
        continue;
      }
      // Standard Markdown link `[text](url)`
      const closeLabel = text.indexOf("]", i + 1);
      if (closeLabel !== -1 && text[closeLabel + 1] === "(") {
        const closeUrl = text.indexOf(")", closeLabel + 2);
        if (closeUrl !== -1) {
          const label = text.slice(i + 1, closeLabel);
          const url = normalizeImagePath(text.slice(closeLabel + 2, closeUrl));
          out += target === "typst"
            ? `#link("${escapeTypstString(url)}")[${convertInline(label, "typst")}]`
            : `<a href="${escapeHtml(safeHref(url))}">${convertInline(label, "html")}</a>`;
          i = closeUrl + 1;
          continue;
        }
      }
    }
    // 6. Wikilink `[[note|alias]]`
    if (text.startsWith("[[", i)) {
      const end = text.indexOf("]]", i + 2);
      if (end !== -1) {
        const [rawTarget, alias] = text.slice(i + 2, end).split("|");
        const label = (alias ?? rawTarget.split("#")[0].split("/").pop() ?? rawTarget).trim();
        out += target === "typst" ? escapeTypstText(label) : `<span class="wikilink">${escapeHtml(label)}</span>`;
        i = end + 2;
        continue;
      }
    }
    // 7. Paired inline emphasis/decorations (`**`, `__`, `~~`, `==`, `*`, `_`)
    const deco = /^(\*\*|__|~~|==|\*|_)/.exec(text.slice(i));
    if (deco) {
      const marker = deco[1];
      if ((marker === "_" || marker === "*") && /\s/.test(text[i + marker.length] ?? " ")) {
        out += target === "typst" ? escapeTypstText(marker) : escapeHtml(marker);
        i += marker.length;
        continue;
      }
      const close = text.indexOf(marker, i + marker.length);
      if (close > i + marker.length && (marker.length > 1 || !/\s/.test(text[close - 1]))) {
        const inner = convertInline(text.slice(i + marker.length, close), target);
        if (marker === "**" || marker === "__") out += target === "typst" ? `*${inner}*` : `<strong>${inner}</strong>`;
        else if (marker === "~~") out += target === "typst" ? `#strike[${inner}]` : `<del>${inner}</del>`;
        else if (marker === "==") out += target === "typst" ? `#highlight[${inner}]` : `<mark>${inner}</mark>`;
        else out += target === "typst" ? `_${inner}_` : `<em>${inner}</em>`;
        i = close + marker.length;
        continue;
      }
    }
    // 8. Escaped markdown character
    if (text[i] === "\\" && i + 1 < text.length && /[\\`*_{}[\]()#+\-.!$>~|=]/.test(text[i + 1])) {
      const ch = text[i + 1];
      out += target === "typst" ? escapeTypstText(ch) : escapeHtml(ch);
      i += 2;
      continue;
    }
    const ch = text[i++];
    out += target === "typst" ? escapeTypstText(ch) : escapeHtml(ch);
  }
  return out;
}

export const CALLOUT_LABELS: Record<string, { label: string; color: string }> = {
  note: { label: "Note", color: "#3b82f6" }, info: { label: "Info", color: "#3b82f6" },
  tip: { label: "Tip", color: "#10b981" }, hint: { label: "Hint", color: "#10b981" },
  important: { label: "Important", color: "#8b5cf6" },
  warning: { label: "Warning", color: "#f59e0b" }, caution: { label: "Caution", color: "#ef4444" }, danger: { label: "Danger", color: "#ef4444" },
  abstract: { label: "Abstract", color: "#06b6d4" }, summary: { label: "Summary", color: "#06b6d4" },
  question: { label: "Question", color: "#f59e0b" }, example: { label: "Example", color: "#8b5cf6" }, quote: { label: "Quote", color: "#6b7280" },
};

export function parseTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim());
}

export function parseTableAligns(sep: string): ("left" | "center" | "right")[] | null {
  const cells = parseTableRow(sep);
  if (!cells.length || !cells.every((c) => /^:?-{2,}:?$/.test(c))) return null;
  return cells.map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left"));
}

/** Direct Markdown -> Typst converter used when Pandoc is not installed (and exported for tests). */
export function markdownToTypst(md: string, opts: Options & { typstPreambleText?: string } = {}): string {
  const [fm, rawBody] = splitFrontmatter(md);
  const title = opts.title ?? fm.title;
  const subtitle = opts.subtitle ?? fm.subtitle;
  const author = opts.author ?? fm.author;
  const date = opts.date ?? fm.date;
  const margin = MARGINS[opts.margins ?? "normal"] ?? MARGINS.normal;
  const paper = opts.paper === "letter" ? "us-letter" : "a4";
  const columns = Number(opts.columns) === 2 ? 2 : 1;
  const font = opts.font || "Libertinus Serif";
  const fontsize = opts.fontsize || "11pt";
  const lang = opts.lang || "en";

  const out: string[] = [
    `#set page(paper: "${paper}", margin: (x: ${margin}, y: ${margin}), columns: ${columns}, numbering: "1")`,
    `#set text(font: "${escapeTypstString(font)}", size: ${fontsize}, lang: "${escapeTypstString(lang)}")`,
    `#set par(leading: 0.65em)`,
  ];
  if (opts.numbered) out.push(`#set heading(numbering: "1.1")`);
  if (opts.typstPreambleText?.trim()) out.push(opts.typstPreambleText.trim());
  if (title || author || date) {
    const bits: string[] = [];
    if (title) bits.push(`#text(size: 18pt, weight: "bold")[${convertInline(title, "typst")}]`);
    if (subtitle) bits.push(`#text(size: 12pt)[${convertInline(subtitle, "typst")}]`);
    if (author) bits.push(convertInline(author, "typst"));
    if (date) bits.push(convertInline(date, "typst"));
    out.push(`#align(center)[\n  ${bits.join(" \\\n  ")}\n]\n#v(0.8em)`);
  }
  if (opts.toc) out.push(`#outline(indent: auto)\n#v(0.8em)`);

  const lines = rawBody.replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (!line.trim()) { out.push(""); i++; continue; }

    // Fenced code or raw `{=typst}` block
    const fmFence = /^\s*(`{3,}|~{3,})\s*(.*)$/.exec(line);
    if (fmFence) {
      const fence = fmFence[1], info = fmFence[2].trim();
      const bodyLines: string[] = [];
      i++;
      while (i < lines.length && !(lines[i].trim().startsWith(fence) && lines[i].trim().replaceAll(fence[0], "") === "")) {
        bodyLines.push(lines[i++]);
      }
      if (i < lines.length) i++;
      if (info === "{=typst}") out.push(bodyLines.join("\n"));
      else out.push(`${fence}${info.split(/\s+/)[0] || ""}\n${bodyLines.join("\n")}\n${fence}`);
      continue;
    }

    // Display math `$$ ... $$`
    if (line.trim().startsWith("$$")) {
      const single = /^\$\$(.+)\$\$$/.exec(line.trim());
      if (single) {
        out.push(`$\n  ${latexMathToTypst(single[1])}\n$`);
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
      out.push(`$\n  ${latexMathToTypst(mathLines.join("\n"))}\n$`);
      continue;
    }

    // Headings
    const hm = /^(#{1,6})\s+(.+?)(?:\s+#+)?$/.exec(line);
    if (hm) { out.push(`${"=".repeat(hm[1].length)} ${convertInline(hm[2], "typst")}`); i++; continue; }

    // Horizontal rule
    if (/^(?:---+|\*\*\*+|___+)\s*$/.test(line)) { out.push(`#line(length: 100%, stroke: 0.5pt + gray)`); i++; continue; }

    // Blockquote / Callout
    if (/^\s*>\s?/.test(line)) {
      const qLines: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) qLines.push(lines[i++].replace(/^\s*>\s?/, ""));
      const cm = /^\[!([\w-]+)\]([+-]?)\s*(.*)$/.exec(qLines[0] ?? "");
      if (cm) {
        const meta = CALLOUT_LABELS[cm[1].toLowerCase()] ?? { label: cm[1], color: "#6b7280" };
        const heading = cm[3].trim() || meta.label;
        const inner = qLines.slice(1).map((l) => (l.trim() ? convertInline(l, "typst") : "")).join("\n\n");
        out.push(`#block(fill: luma(246), stroke: (left: 3pt + rgb("${meta.color}")), inset: 8pt, width: 100%)[*${escapeTypstText(heading)}*${inner ? ` \\\n${inner}` : ""}]`);
      } else {
        const inner = qLines.map((l) => (l.trim() ? convertInline(l, "typst") : "")).join(" \\\n");
        out.push(`#quote(block: true)[${inner}]`);
      }
      continue;
    }

    // Pipe table
    if (line.includes("|") && i + 1 < lines.length) {
      const aligns = parseTableAligns(lines[i + 1]);
      if (aligns) {
        const header = parseTableRow(line);
        i += 2;
        const rows: string[][] = [];
        while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(parseTableRow(lines[i++]));
        const cols = aligns.length;
        const alignArg = aligns.join(", ");
        const hdrCells = Array.from({ length: cols }, (_, c) => `[${convertInline(header[c] ?? "", "typst")}]`).join(", ");
        const bodyCells = rows.flatMap((r) => Array.from({ length: cols }, (_, c) => `[${convertInline(r[c] ?? "", "typst")}]`)).join(", ");
        out.push(`#table(columns: ${cols}, align: (${alignArg}), table.header(${hdrCells})${bodyCells ? `, ${bodyCells}` : ""})`);
        continue;
      }
    }

    // Bullet / task / numbered list
    const lm = /^([ \t]*)(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (lm) {
      const pad = " ".repeat(lm[1].replace(/\t/g, "  ").length);
      const task = /^\[([ xX])\]\s+(.*)$/.exec(lm[4]);
      if (lm[2]) {
        const body = task ? `${task[1].toLowerCase() === "x" ? "\u2611" : "\u2610"} ${convertInline(task[2], "typst")}` : convertInline(lm[4], "typst");
        out.push(`${pad}- ${body}`);
      } else {
        out.push(`${pad}+ ${convertInline(lm[4], "typst")}`);
      }
      i++;
      continue;
    }

    out.push(convertInline(line, "typst"));
    i++;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
