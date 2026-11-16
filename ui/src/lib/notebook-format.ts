// Parsers and serializers for computational physics notebooks:
// 1. Jupyter (.ipynb, nbformat v4) with stream, display_data / execute_result (PNG, SVG, LaTeX, Markdown, plain), and error outputs
// 2. Legacy .wln read-only parsing supporting both `%---...---%Notebook%---...---%` banner format and JSON `.wln` format
import type { JupyterCellRunResult } from "./oracle-runner";

export type NotebookFormat = "ipynb" | "wln";
export type NotebookCellKind = "markdown" | "code" | "raw";

export type NotebookOutput =
  | { type: "stream"; stream: "stdout" | "stderr"; text: string }
  | {
      type: "display";
      executionCount?: number | null;
      png?: string;
      svg?: string;
      latex?: string;
      markdown?: string;
      plain?: string;
    }
  | { type: "error"; ename: string; evalue: string; traceback: string };

export interface NotebookCell {
  id: string;
  kind: NotebookCellKind;
  language: "python" | "wolfram" | "raw";
  source: string;
  executionCount: number | null;
  outputs: NotebookOutput[];
  runtimeMs?: number;
  rawMeta?: Record<string, unknown>;
}

export interface NotebookDoc {
  format: NotebookFormat;
  wlnSubtype?: "banner" | "json";
  cells: NotebookCell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformatMinor: number;
}

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

function joinLines(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map((x) => String(x ?? "")).join("");
  return "";
}

function splitLinesForIpynb(text: string): string[] {
  if (!text) return [];
  const parts = text.split("\n");
  return parts.map((line, idx) => (idx < parts.length - 1 ? `${line}\n` : line)).filter((s, idx) => idx < parts.length - 1 || s.length > 0);
}

let cellSeq = 0;
export function makeCellId(prefix = "cell"): string {
  cellSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${cellSeq}`;
}

function parseIpynbOutputs(rawOutputs: unknown): NotebookOutput[] {
  if (!Array.isArray(rawOutputs)) return [];
  const out: NotebookOutput[] = [];
  for (const item of rawOutputs) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const otype = String(o.output_type || "");
    if (otype === "stream") {
      const stream = o.name === "stderr" ? "stderr" : "stdout";
      out.push({ type: "stream", stream, text: stripAnsi(joinLines(o.text)) });
    } else if (otype === "execute_result" || otype === "display_data") {
      const data = (o.data && typeof o.data === "object" ? o.data : {}) as Record<string, unknown>;
      const png = joinLines(data["image/png"]).trim() || undefined;
      const svg = joinLines(data["image/svg+xml"]).trim() || undefined;
      const latex = joinLines(data["text/latex"]).trim() || undefined;
      const markdown = joinLines(data["text/markdown"]).trim() || undefined;
      const plain = joinLines(data["text/plain"]) || undefined;
      const execCount = typeof o.execution_count === "number" ? o.execution_count : null;
      out.push({ type: "display", executionCount: execCount, png, svg, latex, markdown, plain });
    } else if (otype === "error") {
      const ename = String(o.ename || "Error");
      const evalue = String(o.evalue || "");
      const tbLines = Array.isArray(o.traceback) ? o.traceback.map((x) => stripAnsi(String(x ?? ""))).join("\n") : stripAnsi(String(o.traceback || `${ename}: ${evalue}`));
      out.push({ type: "error", ename, evalue, traceback: tbLines });
    }
  }
  return out;
}

export function parseIpynb(rawText: string): NotebookDoc {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return {
      format: "ipynb",
      cells: [{ id: makeCellId("py"), kind: "code", language: "python", source: "", executionCount: null, outputs: [] }],
      metadata: {
        kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
        language_info: { name: "python" },
      },
      nbformat: 4,
      nbformatMinor: 5,
    };
  }
  const parsed = JSON.parse(trimmed) as Record<string, unknown>;
  const rawCells = Array.isArray(parsed.cells) ? parsed.cells : [];
  const cells: NotebookCell[] = rawCells.map((rc, idx) => {
    const c = (rc && typeof rc === "object" ? rc : {}) as Record<string, unknown>;
    const ctype = String(c.cell_type || "code");
    const kind: NotebookCellKind = ctype === "markdown" ? "markdown" : ctype === "raw" ? "raw" : "code";
    const id = typeof c.id === "string" && c.id ? c.id : makeCellId(`ipynb-${idx}`);
    return {
      id,
      kind,
      language: kind === "code" ? "python" : "raw",
      source: joinLines(c.source),
      executionCount: typeof c.execution_count === "number" ? c.execution_count : null,
      outputs: kind === "code" ? parseIpynbOutputs(c.outputs) : [],
      rawMeta: c.metadata && typeof c.metadata === "object" ? (c.metadata as Record<string, unknown>) : {},
    };
  });

  return {
    format: "ipynb",
    cells,
    metadata: parsed.metadata && typeof parsed.metadata === "object" ? (parsed.metadata as Record<string, unknown>) : {},
    nbformat: typeof parsed.nbformat === "number" ? parsed.nbformat : 4,
    nbformatMinor: typeof parsed.nbformat_minor === "number" ? parsed.nbformat_minor : 5,
  };
}

export function serializeIpynb(doc: NotebookDoc): string {
  const cells = doc.cells.map((cell) => {
    const base: Record<string, unknown> = {
      id: cell.id,
      cell_type: cell.kind,
      metadata: cell.rawMeta ?? {},
      source: splitLinesForIpynb(cell.source),
    };
    if (cell.kind === "code") {
      base.execution_count = cell.executionCount ?? null;
      base.outputs = cell.outputs.map((out) => {
        if (out.type === "stream") {
          return { output_type: "stream", name: out.stream, text: splitLinesForIpynb(out.text) };
        }
        if (out.type === "error") {
          return {
            output_type: "error",
            ename: out.ename,
            evalue: out.evalue,
            traceback: out.traceback.split("\n"),
          };
        }
        const data: Record<string, unknown> = {};
        if (out.png) data["image/png"] = out.png;
        if (out.svg) data["image/svg+xml"] = splitLinesForIpynb(out.svg);
        if (out.latex) data["text/latex"] = splitLinesForIpynb(out.latex);
        if (out.markdown) data["text/markdown"] = splitLinesForIpynb(out.markdown);
        if (out.plain !== undefined) data["text/plain"] = splitLinesForIpynb(out.plain);
        if (out.executionCount !== undefined && out.executionCount !== null) {
          return { output_type: "execute_result", execution_count: out.executionCount, data, metadata: {} };
        }
        return { output_type: "display_data", data, metadata: {} };
      });
    }
    return base;
  });

  const payload = {
    cells,
    metadata: Object.keys(doc.metadata).length
      ? doc.metadata
      : {
          kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
          language_info: { name: "python" },
        },
    nbformat: doc.nbformat || 4,
    nbformat_minor: doc.nbformatMinor ?? 5,
  };
  return `${JSON.stringify(payload, null, 1)}\n`;
}

interface RawWlnEntry {
  type: string;
  display: string;
  hidden: boolean;
  body: string;
}

function parseWlnHeader(hdr: string): { type: string; display: string; hidden: boolean } {
  let type = "Input";
  let display = "";
  let hidden = false;
  for (const rawLine of hdr.split(/\r?\n/)) {
    const line = rawLine.trim();
    const mType = /^Type:\s*(.+)$/i.exec(line);
    if (mType) type = mType[1].trim();
    const mDisp = /^Display:\s*(.+)$/i.exec(line);
    if (mDisp) display = mDisp[1].trim().toLowerCase();
    if (/^Hidden:\s*true$/i.test(line)) hidden = true;
  }
  return { type, display, hidden };
}

function foldWlnEntries(entries: RawWlnEntry[]): NotebookCell[] {
  const cells: NotebookCell[] = [];
  let codeCounter = 0;

  for (let i = 0; i < entries.length; i++) {
    const cur = entries[i];
    const tLow = cur.type.toLowerCase();
    const trimmedBody = cur.body.replace(/^\r?\n+|\r?\n+$/g, "");
    const isMdInput = tLow === "input" && (/^\.md(?:\r?\n|$)/i.test(trimmedBody) || cur.display === "markdown");

    if (isMdInput) {
      const next = entries[i + 1];
      if (next && next.type.toLowerCase() === "output" && next.display === "markdown") {
        // Skip hidden `.md` input cell when followed immediately by its rendered Display: markdown mirror cell.
        continue;
      }
      const mdSource = trimmedBody.replace(/^\.md\r?\n?/i, "").trim();
      if (mdSource) {
        cells.push({
          id: makeCellId("wln-md"),
          kind: "markdown",
          language: "raw",
          source: mdSource,
          executionCount: null,
          outputs: [],
        });
      }
      continue;
    }

    if (tLow === "output" && cur.display === "markdown") {
      const mdSource = trimmedBody.replace(/^\.md\r?\n?/i, "").trim();
      if (mdSource) {
        cells.push({
          id: makeCellId("wln-md"),
          kind: "markdown",
          language: "raw",
          source: mdSource,
          executionCount: null,
          outputs: [],
        });
      }
      continue;
    }

    if (tLow === "input") {
      codeCounter += 1;
      const cell: NotebookCell = {
        id: makeCellId("wln-code"),
        kind: "code",
        language: "wolfram",
        source: trimmedBody,
        executionCount: codeCounter,
        outputs: [],
      };
      while (i + 1 < entries.length) {
        const nxt = entries[i + 1];
        if (nxt.type.toLowerCase() !== "output" || nxt.display === "markdown") break;
        i += 1;
        const outBody = nxt.body.trim();
        if (!outBody) continue;
        if (nxt.display === "svg" || outBody.startsWith("<svg")) {
          cell.outputs.push({ type: "display", svg: outBody });
        } else {
          cell.outputs.push({ type: "display", executionCount: codeCounter, plain: outBody });
        }
      }
      cells.push(cell);
      continue;
    }

    // Standalone non-markdown output cell (attach to previous code cell if possible)
    const prev = cells[cells.length - 1];
    if (prev && prev.kind === "code" && trimmedBody) {
      prev.outputs.push({ type: "display", plain: trimmedBody });
    }
  }

  return cells;
}

export function parseWln(rawText: string): NotebookDoc {
  const normalized = rawText.replace(/\r\n/g, "\n");
  const cellsRegionMatch = /^%-+%Cells%-+%\n([\s\S]*?)^%-+%EndOfCells%-+%/m.exec(normalized);

  if (cellsRegionMatch || /^%-+%Notebook%-+%/m.test(normalized)) {
    const region = cellsRegionMatch ? cellsRegionMatch[1] : normalized;
    const parts = region.split(/^%-{20,}%[ \t]*$/m);
    const entries: RawWlnEntry[] = [];
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const hdr = parseWlnHeader(parts[i]);
      entries.push({ ...hdr, body: parts[i + 1] });
    }
    return {
      format: "wln",
      wlnSubtype: "banner",
      cells: foldWlnEntries(entries),
      metadata: {},
      nbformat: 4,
      nbformatMinor: 5,
    };
  }

  // Fallback JSON `.wln` format
  const parsed = JSON.parse(normalized.trim()) as Record<string, unknown>;
  const rawArr = (
    Array.isArray(parsed.cells)
      ? parsed.cells
      : Array.isArray(parsed.Cells)
        ? parsed.Cells
        : Array.isArray(parsed.notebook)
          ? parsed.notebook
          : []
  ) as Array<Record<string, unknown>>;

  const entries: RawWlnEntry[] = rawArr.map((item) => {
    const props = (item.props || item.Props || {}) as Record<string, unknown>;
    return {
      type: String(item.type || item.Type || "Input"),
      display: String(item.display || item.Display || "").toLowerCase(),
      hidden: Boolean(props.Hidden ?? props.hidden ?? item.hidden),
      body: joinLines(item.data ?? item.Data ?? item.source ?? item.content ?? ""),
    };
  });

  return {
    format: "wln",
    wlnSubtype: "json",
    cells: foldWlnEntries(entries),
    metadata: parsed,
    nbformat: 4,
    nbformatMinor: 5,
  };
}

export function parseNotebook(path: string, rawText: string): NotebookDoc {
  if (/\.wln$/i.test(path)) return parseWln(rawText);
  return parseIpynb(rawText);
}

/** Merge a helper cell run result onto an `.ipynb` cell. */
export function applyJupyterResultToCell(cell: NotebookCell, res: JupyterCellRunResult): NotebookCell {
  const outputs: NotebookOutput[] = [];
  if (res.stdout) outputs.push({ type: "stream", stream: "stdout", text: stripAnsi(res.stdout) });
  if (res.stderr) outputs.push({ type: "stream", stream: "stderr", text: stripAnsi(res.stderr) });
  for (const disp of res.displays || []) {
    if (disp.mime === "image/png") outputs.push({ type: "display", png: disp.data });
    else if (disp.mime === "image/svg+xml") outputs.push({ type: "display", svg: disp.data });
    else if (disp.mime === "text/latex") outputs.push({ type: "display", latex: disp.data });
    else if (disp.mime === "text/markdown") outputs.push({ type: "display", markdown: disp.data });
  }
  if (res.result_text !== null && res.result_text !== undefined) {
    outputs.push({
      type: "display",
      executionCount: res.execution_count,
      plain: stripAnsi(res.result_text),
    });
  }
  if (res.error) {
    outputs.push({
      type: "error",
      ename: res.error.ename,
      evalue: res.error.evalue,
      traceback: stripAnsi(res.error.traceback),
    });
  }
  return {
    ...cell,
    executionCount: res.execution_count ?? cell.executionCount,
    outputs,
    runtimeMs: res.ms,
  };
}
