// Delimited text (CSV, TSV, whitespace-aligned run output) → a Sheet that remembers how the file was written, so
// write.ts gives back the same bytes for every row that was not edited. Quote-aware (RFC 4180: "" inside quotes, line
// breaks inside a quoted field); the delimiter, the header and the comment lines are found by the shape of the text.

/** How the file is written: what writing an edited row must reproduce. */
export interface Layout {
  /** "," ";" "\t" "|" — or " " for whitespace-aligned columns (no quoting there) */
  delimiter: string;
  eol: RecordEnding;
  /** every field was quoted ("a","b"): edited rows are quoted the same way */
  quoteAll: boolean;
  /** "a, b": one space after each delimiter */
  spaceAfter: boolean;
  bom: boolean;
  trailingEol: boolean;
  /** "#" or "%" when the file starts with comment lines; such lines anywhere are kept as comments */
  comment: string | null;
  /** whitespace columns aligned on fixed right edges (run output): where each column ends, so an edited row lines up */
  columnEnds: number[] | null;
}

/** Where the column names come from: a first row, the last comment line before the data, or nowhere. */
export type HeaderSource = "row" | "comment" | "none";

export type RecordEnding = "\n" | "\r\n" | "\r";
/** A record's original text, with an explicit ending only where it differs from the file's default. */
export type RawRecord = string | { text: string | null; ending: RecordEnding | "" } | null;

export interface Sheet {
  layout: Layout;
  header: string[];
  headerSource: HeaderSource;
  rows: string[][];
  /** each row's text as read (null: edited, write it anew); the header row's at `headerRaw` */
  raw: RawRecord[];
  headerRaw: RawRecord;
  /** Comments and blank lines before data row `at` (-1: before the header row; rows.length: after the last). */
  comments: { at: number; text: string; blank?: true; ending?: RecordEnding | "" }[];
  numeric: boolean[];
  delimiterName: string;
  /** an Excel sheet's formulas behind its values, "row,col" of `rows` → the formula without `=` (shown, not run) */
  formulas?: Map<string, string>;
}

const NUM = /^[-+]?(\d+\.?\d*|\.\d+)([eEdD][-+]?\d+)?$|^[-+]?(inf|infinity|nan)$/i;
export const isNum = (s: string) => NUM.test(s.trim());
/** A cell's number as [`isNum`] reads it: a Fortran exponent (`1.5D3`, which `parseFloat` reads as 1.5) and `inf` /
 *  `nan` in any case too; NaN for a cell that is not one. */
export function toNum(s: string): number {
  const t = s.trim();
  if (!NUM.test(t)) return NaN;
  if (/inf/i.test(t)) return t.startsWith("-") ? -Infinity : Infinity;
  return /nan/i.test(t) ? NaN : Number(t.replace(/[dD]/, "e"));
}
const NAMES: Record<string, string> = { ",": "comma-separated", ";": "semicolon-separated", "\t": "tab-separated", "|": "pipe-separated", " ": "whitespace-separated" };

/** A record: its fields and the text it spans. */
interface Rec { fields: string[]; raw: string; quoted: boolean[]; ending: RecordEnding | "" }

/** The records of `text` split on `d` (quotes honoured), or on runs of blanks for " ". */
function records(text: string, d: string, limit = Infinity, progress?: (done: number) => void, keepBlank = false): Rec[] {
  const out: Rec[] = [];
  if (d === " ") {
    for (const m of text.matchAll(/([^\r\n]*)(\r\n|[\r\n]|$)/g)) {
      if (!m[0] || out.length >= limit) break;
      const raw = m[1], trimmed = raw.trim();
      if (trimmed || keepBlank) out.push({ fields: trimmed ? trimmed.split(/\s+/) : [], raw, quoted: [], ending: m[2] as Rec["ending"] });
    }
    return out;
  }
  let i = 0, start = 0, field = "", fields: string[] = [], quoted: boolean[] = [], inQ = false, wasQ = false;
  const endField = () => { fields.push(field); quoted.push(wasQ); field = ""; wasQ = false; };
  const endRec = (end: number, ending: Rec["ending"]) => {
    endField();
    const raw = text.slice(start, end);
    if (keepBlank || raw.trim()) {
      out.push({ fields, raw, quoted, ending });
      if (progress && out.length % 50_000 === 0) progress(end / text.length);
    }
    fields = []; quoted = [];
  };
  for (; i < text.length && out.length < limit; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"' && field.trim() === "") { inQ = true; wasQ = true; field = ""; }
    else if (ch === d) endField();
    else if (ch === "\n" || ch === "\r") {
      const ending = ch === "\r" && text[i + 1] === "\n" ? "\r\n" : ch;
      endRec(i, ending);
      i += ending.length - 1;
      start = i + 1;
    } else field += ch;
  }
  if (out.length < limit && start < text.length) endRec(text.length, "");
  return out;
}

/** The delimiter whose field count is above one and the most constant over the first lines; ties go to the extension's. */
function sniff(sample: string, path: string): string {
  const preferred = /\.csv$/i.test(path) ? "," : /\.tsv$/i.test(path) ? "\t" : "";
  let best = " ", bestScore = -1;
  for (const d of [",", "\t", ";", "|", " "]) {
    const counts = records(sample, d, 50).map((r) => r.fields.length);
    if (!counts.length) continue;
    const freq = new Map<number, number>();
    for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
    const [mode, n] = [...freq].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    if (mode < 2) continue;
    // whitespace splits prose too: it wins only when nothing else fits
    const score = n / counts.length + (d === preferred ? 0.01 : 0) - (d === " " ? 0.05 : 0);
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

/** Is the first row a header? Distinct non-empty labels, mostly not numbers — over numbers, or over text alike. */
function looksLikeHeader(first: string[], below: string[][]): boolean {
  if (!first.length || first.some((c) => !c.trim()) || new Set(first).size !== first.length) return false;
  if (first.filter(isNum).length > 0) return false;
  if (!below.length) return true;
  const numericUnder = first.some((_, k) => below.filter((r) => isNum(r[k] ?? "")).length >= below.length / 2);
  // a text-only table: labels that never come back as values below
  return numericUnder || first.every((h, k) => !below.some((r) => r[k] === h));
}

/** `progress`: called now and then with the share of the text read (0–1), for a big file parsed in a worker. */
export function parseSheet(input: string, path = "", progress?: (done: number) => void): Sheet {
  const bom = input.charCodeAt(0) === 0xfeff;
  const text = bom ? input.slice(1) : input;
  // leading comment lines decide the comment marker
  const firstLine = text.slice(0, text.search(/[\r\n]|$/)).trimStart();
  const comment = /^[#%]/.test(firstLine) ? firstLine[0] : null;
  const isComment = (raw: string) => !!comment && raw.trimStart().startsWith(comment);
  const dataSample = text.split(/\r\n|[\r\n]/).filter((l) => l.trim() && !isComment(l)).slice(0, 60).join("\n");
  const d = sniff(dataSample, path);
  const all = records(text, d, Infinity, progress, true);
  const eol = all.find((r) => r.ending)?.ending || "\n";
  const trailingEol = !!all.at(-1)?.ending;

  const comments: Sheet["comments"] = [];
  const data: Rec[] = [];
  for (const r of all) {
    const blank = !r.raw.trim();
    if (blank || (isComment(r.raw) && !r.quoted.some(Boolean))) comments.push({ at: data.length, text: r.raw, ...(blank ? { blank: true } : {}), ...(r.ending === eol ? {} : { ending: r.ending }) });
    else data.push(r);
  }
  const sample = data.slice(0, 200);
  const spaceAfter = d !== " " && sample.length > 0 &&
    sample.flatMap((r) => r.fields.slice(1)).filter((f) => f.startsWith(" ")).length >= 0.8 * sample.reduce((n, r) => n + r.fields.length - 1, 0) &&
    sample.some((r) => r.fields.length > 1);
  const clean = (f: string) => (spaceAfter && f.startsWith(" ") ? f.slice(1) : f);
  const quoteAll = sample.length > 0 && sample.every((r) => r.quoted.length > 0 && r.quoted.every(Boolean));
  // a quoted field's spaces are its own: the one after the delimiter was dropped before its quote
  let rows = data.map((r) => r.fields.map((f, k) => (r.quoted[k] ? f : clean(f))));
  let raw: RawRecord[] = data.map((r) => r.ending === eol ? r.raw : { text: r.raw, ending: r.ending });
  const width = Math.max(1, ...rows.slice(0, 500).map((r) => r.length));

  let header: string[], headerSource: HeaderSource = "none", headerRaw: RawRecord = null;
  const lead = comments.filter((c) => c.at <= 0 && !c.blank);
  const fromComment = lead.length ? records(lead[lead.length - 1].text.trimStart().slice(1).trim(), d)[0]?.fields.map(clean) ?? [] : [];
  if (looksLikeHeader(rows[0] ?? [], rows.slice(1, 40))) {
    header = rows[0]; headerSource = "row"; headerRaw = raw[0];
    rows = rows.slice(1); raw = raw.slice(1);
    for (const c of comments) c.at = c.at === 0 ? -1 : c.at - 1; // -1: before the header row
  } else if (fromComment.length === width && !fromComment.some(isNum)) {
    header = fromComment; headerSource = "comment";
  } else header = [];
  while (header.length < width) header.push(`col ${header.length + 1}`);

  const layout: Layout = { delimiter: d, eol, quoteAll, spaceAfter, bom, trailingEol, comment, columnEnds: d === " " ? alignedEnds(raw) : null };
  return { layout, header, headerSource, rows, raw, headerRaw, comments, numeric: numericColumns(header.length, rows), delimiterName: NAMES[d] };
}

/** A column is numeric when nine in ten of its filled cells (first thousand rows) are numbers. */
export function numericColumns(width: number, rows: string[][]): boolean[] {
  return Array.from({ length: width }, (_, k) => {
    let filled = 0, nums = 0;
    for (const r of rows.slice(0, 1000)) {
      const v = (r[k] ?? "").trim();
      if (!v) continue;
      filled++;
      if (isNum(v)) nums++;
    }
    return filled > 0 && nums / filled >= 0.9;
  });
}

/** The right edge of each column when every sampled line ends its fields at the same places; else null. */
function alignedEnds(raw: RawRecord[]): number[] | null {
  let ends: number[] | null = null;
  for (const record of raw.slice(0, 50)) {
    const line = typeof record === "string" ? record : record?.text ?? null;
    if (line === null) continue;
    const here = [...line.matchAll(/\S+/g)].map((m) => m.index! + m[0].length);
    if (ends && (here.length !== ends.length || here.some((e, k) => e !== ends![k]))) return null;
    ends = here;
  }
  return ends && ends.length > 1 ? ends : null;
}

/** A sheet from rows that come without a text of their own (an Excel workbook's): the header found by shape, as in a
 *  text table; written back, it is a comma-separated file. `kind`: what the pane says it is. */
export function sheetFromRows(input: string[][], kind: string, formulas?: Map<string, string>): Sheet {
  let rows = input.map((r) => [...r]);
  const width = Math.max(1, ...rows.slice(0, 500).map((r) => r.length));
  let header: string[] = [], headerSource: HeaderSource = "none", shift = 0;
  if (rows.length > 1 && looksLikeHeader(rows[0], rows.slice(1, 40))) { header = rows[0]; headerSource = "row"; rows = rows.slice(1); shift = 1; }
  while (header.length < width) header.push(`col ${header.length + 1}`);
  const layout: Layout = { delimiter: ",", eol: "\n", quoteAll: false, spaceAfter: false, bom: false, trailingEol: true, comment: null, columnEnds: null };
  const moved = formulas && new Map([...formulas].flatMap(([k, f]) => { const [r, c] = k.split(",").map(Number); return r >= shift ? [[`${r - shift},${c}`, f] as [string, string]] : []; }));
  return { layout, header, headerSource, rows, raw: rows.map(() => null), headerRaw: null, comments: [], numeric: numericColumns(header.length, rows), delimiterName: kind, ...(moved?.size ? { formulas: moved } : {}) };
}
