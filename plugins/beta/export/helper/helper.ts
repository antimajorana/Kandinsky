// The Export plugin's helper (docs/design/DESIGN-export.md): a note → PDF (through Typst in the core, or LaTeX),
// LaTeX or Typst source, or Word. translate.ts makes the note pandoc Markdown; pandoc writes each format; the core's
// Typst compiles the Typst road's PDF; latexmk the LaTeX road's. Results go under the exports folder at the note's own
// path (`notes/a/x.md` → `exports/notes/a/x.pdf`), a preview into the plugin's cache. The note is only read.
import type { Params } from "kandinsky-helper";
import { macroDefinitions } from "../../../../ui/src/lib/tex-portable";
import { bibKeys, dirname, relative, splitFrontmatter, translate, type Translated } from "./translate";

export type Format = "pdf-typst" | "pdf-latex" | "tex" | "typ" | "html" | "docx";
const FORMATS: Format[] = ["pdf-typst", "pdf-latex", "tex", "typ", "html", "docx"];
const EXT: Record<Format, string> = { "pdf-typst": "pdf", "pdf-latex": "pdf", tex: "tex", typ: "typ", html: "html", docx: "docx" };
const ENGINES: Record<string, string> = { lualatex: "-lualatex", xelatex: "-xelatex", pdflatex: "-pdf" };
const MARGINS: Record<string, string> = { narrow: "1.5cm", normal: "2.4cm", wide: "3.2cm" };
/** The citation styles offered, in each road's own names. */
const STYLES: Record<string, { biblatex: string; typst: string }> = {
  numeric: { biblatex: "numeric-comp", typst: "ieee" },
  "author-year": { biblatex: "authoryear", typst: "chicago-author-date" },
  alphabetic: { biblatex: "alphabetic", typst: "alphanumeric" },
  physics: { biblatex: "phys", typst: "american-physics-society" },
};
const CACHE = ".kandinsky/cache/plugins/export";
/** Where the dialog leaves a ```tikz picture drawn by the page's TeX (`kandinsky.tikz.png`), by its key. */
export const tikzPng = (key: string) => `${CACHE}/figures/${key}.png`;
/** A fence's key: the hash of its source, the same for the dialog (from `describe`) and the road. */
const keyOf = (source: string) => kandinsky.hash.sha256(source).slice(0, 16);
const PLUGIN = ".kandinsky/plugins/export";

/** The dialog's choices; any left out come from the plugin's settings, then these defaults. */
export interface Options {
  title?: string; subtitle?: string; author?: string; date?: string;
  toc?: boolean; numbered?: boolean;
  paper?: "a4" | "letter"; fontsize?: string; margins?: string; columns?: number; lang?: string; font?: string;
  bibliography?: string; style?: string;
  engine?: string; preamble?: string; typstPreamble?: string; layout?: string;
  folder?: string;
}

/** The LaTeX road's layouts: `plain` is pandoc's article; `article` a KOMA article set for reading (microtype, a
 *  little more leading, dark-coloured links, paragraphs spaced, not indented); `chapter` a KOMA report whose top
 *  headings are chapters, numbered, with a table of contents. */
export const LAYOUTS: Record<string, { meta: Record<string, unknown>; header: string[]; args: string[] }> = {
  plain: { meta: {}, header: [], args: [] },
  article: {
    meta: { documentclass: "scrartcl", classoption: ["parskip=half"], linestretch: 1.1, linkcolor: "blue!40!black", urlcolor: "blue!40!black", citecolor: "green!30!black" },
    header: ["\\usepackage{microtype}", "\\addtokomafont{disposition}{\\rmfamily}"],
    args: [],
  },
  chapter: {
    meta: { documentclass: "scrreprt", classoption: ["parskip=half", "open=any"], linestretch: 1.1, numbersections: true, toc: true, "toc-depth": 2, linkcolor: "blue!40!black", urlcolor: "blue!40!black", citecolor: "green!30!black" },
    header: ["\\usepackage{microtype}", "\\addtokomafont{disposition}{\\rmfamily}"],
    args: ["--top-level-division=chapter"],
  },
};
export const layoutOf = (o: Options) => LAYOUTS[o.layout ?? "plain"] ?? LAYOUTS.plain;

const progress = (stage: string, text: string) => kandinsky.event("progress", { stage, text });

/** Runs a program the manifest names; its output, or why not (with its last error lines). */
async function run(program: "pandoc" | "latexmk", args: string[], opts: { cwd?: string; stdin?: string; timeout?: number } = {}) {
  const r = await kandinsky.exec(program, args, { ...opts, timeout: opts.timeout ?? 120 }).catch((e: Error) => {
    throw new Error(/not installed/.test(e.message) ? `${program} is not installed on the machine running Kandinsky` : e.message);
  });
  return r;
}

/** Whether an external CLI tool is available on PATH. */
async function hasProgram(program: "pandoc" | "latexmk", flag: string): Promise<boolean> {
  return run(program, [flag], { timeout: 20 }).then((r) => r.status === 0, () => false);
}

const PANDOC_HINT = "Requires Pandoc 3.0+ (https://pandoc.org/installing.html)";

/** Which formats work here: PDF (Typst), Typst source, and Standalone HTML work without Pandoc. */
async function formats() {
  const [pandoc, latexmk] = await Promise.all([hasProgram("pandoc", "--version"), hasProgram("latexmk", "-v")]);
  return [
    { id: "pdf-typst", label: "PDF (Typst)", ok: true },
    { id: "pdf-latex", label: "PDF (LaTeX)", ok: pandoc && latexmk, ...(pandoc && latexmk ? {} : { needs: pandoc ? "latexmk (a TeX distribution)" : PANDOC_HINT }) },
    { id: "tex", label: "LaTeX source (.tex)", ok: pandoc, ...(pandoc ? {} : { needs: PANDOC_HINT }) },
    { id: "typ", label: "Typst source (.typ)", ok: true },
    { id: "html", label: "Standalone HTML", ok: true },
    { id: "docx", label: "Word (.docx)", ok: pandoc, ...(pandoc ? {} : { needs: PANDOC_HINT }) },
  ];
}

/** The .bib the citations come from: the setting's, else refs/refs.bib, else the first at the top or in refs/. */
function findBib(files: string[], setting: string): string | null {
  const s = setting.trim().replace(/^\/+/, "");
  if (s) return files.includes(s) ? s : null;
  const bibs = files.filter((f) => f.endsWith(".bib")).sort();
  return bibs.find((f) => f === "refs/refs.bib") ?? bibs.find((f) => !f.includes("/")) ?? bibs.find((f) => /^refs\/[^/]+$/.test(f)) ?? null;
}

/** `figures`: the tikz pictures the dialog drew, key → width in points. */
interface Job { rel: string; outDir: string; stem: string; o: Options; files: string[]; bib: string | null; t: Translated; figures: Record<string, number> }

async function prepare(params: Params, preview: boolean): Promise<Job> {
  const rel = String(params.path ?? "").trim().replace(/^\/+/, "");
  if (!/\.md$/i.test(rel)) throw new Error(`not a note: ${rel}`);
  const o: Options = { ...(params.settings ?? {}), ...(params.options ?? {}) };
  const folder = String(o.folder ?? "exports").trim().replace(/^\/+|\/+$/g, "") || "exports";
  const outDir = [preview ? `${CACHE}/preview` : folder, dirname(rel)].filter(Boolean).join("/");
  const files: string[] = await kandinsky.files();
  const bib = findBib(files, String(o.bibliography ?? ""));
  const keys = bib ? bibKeys(await kandinsky.read(bib)) : new Set<string>();
  progress("translate", `reading ${rel}`);
  const t = await translate({ files, read: (p) => kandinsky.read(p) }, rel, outDir, keys);
  if (t.cited.length && !bib) t.warnings.push("papers are cited but no .bib was found (the Bibliography option)");
  const stem = rel.slice(rel.lastIndexOf("/") + 1).replace(/\.md$/i, "");
  const figures: Record<string, number> = {};
  for (const [k, w] of Object.entries((params.figures ?? {}) as Record<string, unknown>)) if (/^[0-9a-f]{16}$/.test(k) && Number(w) > 0) figures[k] = Number(w);
  return { rel, outDir, stem, o, files, bib, t, figures };
}

/** The pandoc metadata block every road starts from: the title block, the page, the bibliography. */
function metadata(j: Job, road: "latex" | "typst" | "docx", header: string[]): string {
  const { o, t } = j;
  const m: Record<string, unknown> = { ...t.meta };
  for (const k of ["title", "subtitle", "author", "date"] as const) if (o[k] !== undefined) m[k] = o[k] || undefined;
  m.lang = o.lang || "en";
  if (o.font) m.mainfont = o.font;
  const margin = MARGINS[o.margins ?? "normal"] ?? MARGINS.normal;
  const paper = o.paper === "letter" ? "letter" : "a4";
  if (road === "latex") {
    Object.assign(m, { papersize: paper, fontsize: o.fontsize || "11pt", geometry: `margin=${margin}`, colorlinks: true }, layoutOf(o).meta);
    if (Number(o.columns) === 2) m.classoption = [...((m.classoption as string[] | undefined) ?? []), "twocolumn"];
  } else if (road === "typst") {
    // pandoc's Typst template sets `font: ()` when no main font is named, which Typst 0.15 refuses: the bundled one
    m.mainfont ??= "Libertinus Serif";
    Object.assign(m, { papersize: paper === "letter" ? "us-letter" : "a4", fontsize: o.fontsize || "11pt", margin: { x: margin, y: margin }, columns: Number(o.columns) === 2 ? 2 : 1, "page-numbering": "1" });
  }
  if (o.toc) Object.assign(m, { toc: true, "toc-depth": 3 });
  if (o.numbered) m[road === "typst" ? "section-numbering" : "numbersections"] = road === "typst" ? "1.1" : true;
  if (j.bib && t.cited.length) {
    m.bibliography = road === "docx" ? j.bib : relative(j.outDir, j.bib); // pandoc reads it itself for Word
    const style = STYLES[o.style ?? "numeric"] ?? STYLES.numeric;
    if (road === "latex") m["biblio-style"] = style.biblatex;
    if (road === "typst") m.bibliographystyle = style.typst;
  }
  if (header.length) m["header-includes"] = header;
  const yaml = Object.entries(m).filter(([, v]) => v !== undefined).map(([k, v]) => yamlEntry(k, v)).join("\n");
  // Kandinsky's own macros (\ket…): pandoc applies these to every formula for Typst and Word; LaTeX gets them in its header
  return `---\n${yaml}\n---\n\n${road === "latex" ? "" : `${macroDefinitions("newcommand")}\n\n`}`;
}

/** One metadata line. JSON is YAML (every value quoted as it is), except text of several lines: pandoc reads a quoted
 *  scalar as inline Markdown, which turns a ```{=latex} block (the preamble's header-includes) into inline code before
 *  \begin{document}. Those go as literal block scalars, which pandoc reads as blocks. */
export function yamlEntry(k: string, v: unknown): string {
  const block = (t: string, pad: string) => `|\n${t.split("\n").map((l) => pad + l).join("\n")}`;
  if (typeof v === "string" && v.includes("\n")) return `${k}: ${block(v, "  ")}`;
  if (Array.isArray(v) && v.some((x) => typeof x === "string" && x.includes("\n")))
    return `${k}:\n${v.map((x) => `- ${typeof x === "string" && x.includes("\n") ? block(x, "    ") : JSON.stringify(x)}`).join("\n")}`;
  return `${k}: ${JSON.stringify(v)}`;
}

/** The fences put back for a road: raw source, a compiled picture, or the code with a warning. */
async function fences(j: Job, road: "latex" | "typst" | "docx" | "html"): Promise<string> {
  const out: string[] = [];
  for (const [i, f] of j.t.fences.entries()) {
    if (f.lang === "typst" && road === "typst") out[i] = "```{=typst}\n" + f.source + "\n```";
    else if (f.lang === "tikz" && road === "latex") out[i] = "```tikz\n" + f.source + "\n```"; // tikz.lua draws it
    else if (f.lang === "typst" && road === "latex") {
      // drawn by the core's Typst into a PDF picture the LaTeX includes
      const pdf = `${CACHE}/figures/${keyOf(f.source)}.pdf`;
      kandinsky.convert.typstPdf(`${dirname(j.rel) || "."}/.fence.typ`, pdf, { source: f.source, fence: true });
      out[i] = `![](<${relative(j.outDir, pdf)}>)`;
    } else if (f.lang === "tikz" && j.figures[keyOf(f.source)]) {
      // drawn by the page's TeX as a PNG (the web fonts inside), at the width TeX gave it
      out[i] = `![](<${relative(j.outDir, tikzPng(keyOf(f.source)))}>){width=${j.figures[keyOf(f.source)].toFixed(1)}pt}`;
    } else {
      j.t.warnings.push(`a ${f.lang} picture is left as code: ${f.lang === "tikz" ? "the TeX in the page did not draw it" : `${road === "html" ? "HTML" : "Word"} has no Typst`}`);
      out[i] = "```" + f.lang + "\n" + f.source + "\n```";
    }
  }
  // an equation's number: LaTeX keeps `\tag`; pandoc's Typst and Word writers drop it, so there it is written beside it
  const tagged = road === "latex" ? j.t.markdown : j.t.markdown.replace(/\\tag\*?\{([^}]*)\}/g, (_, n: string) => `\\qquad\\text{(${n})}`);
  const md = tagged.replace(/<!--fence:(\d+)-->/g, (_, n: string) => out[Number(n)]);
  // a note whose sections start at ## gets them one level up
  return /^# /m.test(md) || !/^## /m.test(md) ? md : md.replace(/^#(#+ )/gm, "$1");
}

const MD = "markdown+mark-implicit_figures+implicit_figures";

// run at the vault's top (the output folder may not exist yet): paths it reads itself are vault paths
async function pandoc(j: Job, to: string, input: string, extra: string[] = [], output?: string): Promise<string> {
  progress("pandoc", `writing ${output ?? to}`);
  const r = await run("pandoc", ["-f", MD, "-t", to, "-s", ...extra, ...(output ? ["-o", output] : [])], { stdin: input });
  if (r.status !== 0) throw new Error(`pandoc failed: ${(r.stderr || r.stdout).trim().slice(-2000)}`);
  return r.stdout;
}

/** The lines LaTeX marks as errors, with the two after each. */
export function latexErrors(log: string): string {
  const lines = log.split("\n");
  const picked = lines.flatMap((l, i) => (l.startsWith("!") || /^\S+\.tex:\d+:/.test(l) ? [i] : []));
  const keep = [...new Set(picked.flatMap((i) => [i, i + 1, i + 2].filter((k) => k < lines.length)))].sort((a, b) => a - b);
  return keep.map((k) => lines[k]).join("\n").slice(-3000) || lines.slice(-30).join("\n");
}

const escapeTypstText = (s: string): string => s.replace(/([\\#*_$@<>\[\]])/g, "\\$1");
const escapeTypstString = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const safeHref = (url: string): string => (/^\s*(?:javascript|vbscript|data:text\/html):/i.test(url) ? "#" : url.trim());

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
function convertInline(text: string, target: "typst" | "html"): string {
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

const CALLOUT_LABELS: Record<string, { label: string; color: string }> = {
  note: { label: "Note", color: "#3b82f6" }, info: { label: "Info", color: "#3b82f6" },
  tip: { label: "Tip", color: "#10b981" }, hint: { label: "Hint", color: "#10b981" },
  important: { label: "Important", color: "#8b5cf6" },
  warning: { label: "Warning", color: "#f59e0b" }, caution: { label: "Caution", color: "#ef4444" }, danger: { label: "Danger", color: "#ef4444" },
  abstract: { label: "Abstract", color: "#06b6d4" }, summary: { label: "Summary", color: "#06b6d4" },
  question: { label: "Question", color: "#f59e0b" }, example: { label: "Example", color: "#8b5cf6" }, quote: { label: "Quote", color: "#6b7280" },
};

function parseTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim());
}

function parseTableAligns(sep: string): ("left" | "center" | "right")[] | null {
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

async function typstRoad(j: Job, format: "pdf-typst" | "typ"): Promise<string> {
  const preamble = j.o.typstPreamble
    ? await kandinsky.read(j.o.typstPreamble).catch(() => { j.t.warnings.push(`Typst preamble not found: ${j.o.typstPreamble}`); return ""; })
    : "";
  const md = await fences(j, "typst");
  const header2 = preamble ? ["```{=typst}\n" + preamble + "\n```"] : [];
  let typ: string;
  try {
    typ = await pandoc(j, "typst", metadata(j, "typst", header2) + md);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/not installed/i.test(msg)) throw e;
    progress("typst", "translating Markdown to Typst");
    typ = markdownToTypst(md, { ...j.t.meta, ...j.o, typstPreambleText: preamble });
    if (j.bib && j.t.cited.length) {
      const style = (STYLES[j.o.style ?? "numeric"] ?? STYLES.numeric).typst;
      typ += `\n#bibliography("${escapeTypstString(relative(j.outDir, j.bib))}", style: "${style}")\n`;
    }
  }
  const at = `${j.outDir}/${j.stem}.typ`;
  if (format === "typ") { await kandinsky.write(at, typ); return at; }
  progress("typst", "compiling the PDF with Typst");
  return kandinsky.convert.typstPdf(at, `${j.outDir}/${j.stem}.pdf`, { source: typ });
}

async function htmlRoad(j: Job): Promise<string> {
  progress("html", "building standalone HTML");
  const md = await fences(j, "html");
  const html = markdownToHtml(md, { ...j.t.meta, ...j.o });
  const at = `${j.outDir}/${j.stem}.html`;
  await kandinsky.write(at, html);
  return at;
}

async function latexRoad(j: Job, format: "pdf-latex" | "tex"): Promise<string[]> {
  const header = ["```{=latex}\n" + ["\\usepackage{soul}", ...layoutOf(j.o).header].join("\n") + "\n```"];
  if (j.o.preamble) {
    if (j.files.includes(j.o.preamble)) header.push("```{=latex}\n\\input{" + relative(j.outDir, j.o.preamble) + "}\n```");
    else j.t.warnings.push(`LaTeX preamble not found: ${j.o.preamble}`);
  }
  // after the preamble, so a \ket it (or a package) defines is the one used
  header.push("```{=latex}\n" + macroDefinitions("providecommand") + "\n```");
  const extra = ["--lua-filter", `${PLUGIN}/tikz.lua`, ...layoutOf(j.o).args, ...(j.t.cited.length && j.bib ? ["--biblatex"] : [])];
  const tex = await pandoc(j, "latex", metadata(j, "latex", header) + (await fences(j, "latex")), extra);
  const at = `${j.outDir}/${j.stem}.tex`;
  await kandinsky.write(at, tex);
  if (format === "tex") return [at];
  const engine = String(j.o.engine || "lualatex");
  const buildDir = `${CACHE}/build/${j.rel.replace(/[^\w.-]+/g, "_")}`;
  const build = relative(j.outDir, buildDir);
  progress("latex", `compiling with ${engine} (latexmk; biber for the references)`);
  const r = await run("latexmk", [ENGINES[engine] ?? "-lualatex", "-interaction=nonstopmode", "-halt-on-error", "-file-line-error",
    "-emulate-aux-dir", `-auxdir=${build}`, "-outdir=.", `./${j.stem}.tex`], { cwd: j.outDir, timeout: 600 }); // `./`: a note named "-x" is no option
  if (r.status !== 0) {
    const log = await kandinsky.read(`${buildDir}/${j.stem}.log`).catch(() => r.stdout);
    throw new Error(`LaTeX failed on ${at}:\n${latexErrors(log)}`);
  }
  return [at, `${j.outDir}/${j.stem}.pdf`];
}

async function docxRoad(j: Job): Promise<string> {
  const out = `${j.outDir}/${j.stem}.docx`;
  await kandinsky.write(out, ""); // makes its folder; pandoc writes over it
  const cite = j.t.cited.length && j.bib ? ["--citeproc"] : [];
  await pandoc(j, "docx", metadata(j, "docx", []) + (await fences(j, "docx")), [...cite, `--resource-path=${j.outDir}`], out);
  return out;
}

/** Old callers (Print) say `to: "pdf" | "tex"`: the PDF road the settings chose, or LaTeX source. */
function formatOf(params: Params): Format {
  const f = String(params.format ?? "");
  if ((FORMATS as string[]).includes(f)) return f as Format;
  if (params.to === "tex") return "tex";
  const set = String(params.settings?.format ?? "");
  if (set === "pdf-latex") return "pdf-latex";
  if (set === "html") return "html";
  return "pdf-typst";
}

async function exportNote(params: Params) {
  const format = formatOf(params);
  const preview = params.preview === true;
  const j = await prepare(params, preview);
  let written: string[];
  if (format === "pdf-typst" || format === "typ") written = [await typstRoad(j, format)];
  else if (format === "pdf-latex" || format === "tex") written = await latexRoad(j, format);
  else if (format === "html") written = [await htmlRoad(j)];
  else written = [await docxRoad(j)];
  progress("done", written.join(", "));
  return { written, format, pdf: written.find((w) => w.endsWith(".pdf")) ?? null, cited: j.t.cited, warnings: j.t.warnings };
}

/** What the dialog shows before anything is made: the title block, whether papers are cited, which pictures. */
async function describe(params: Params) {
  const j = await prepare({ ...params, options: {} }, true);
  const tikz = j.t.fences.filter((f) => f.lang === "tikz").map((f) => ({ key: keyOf(f.source), source: f.source, png: tikzPng(keyOf(f.source)) }));
  return { meta: j.t.meta, cited: j.t.cited, bib: j.bib, fences: j.t.fences.map((f) => f.lang), tikz, warnings: j.t.warnings, ext: EXT };
}

kandinsky.methods({ formats, describe, export: exportNote });
