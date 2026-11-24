// A Sheet back to text in the file's own layout: rows never edited keep their bytes as read, edited ones are written
// with the same delimiter, quoting and spacing, and comment lines stay where they were.
import type { Layout, RawRecord, RecordEnding, Sheet } from "./parse";

/** One field as the layout writes it: quoted when it must be (or when the file quotes everything). `first`: it starts
 *  the line, where the comment marker unquoted would make the row a comment when read back. */
function field(v: string, l: Layout, first = false): string {
  if (l.delimiter === " ") return v.replace(/\s+/g, "_") || "-"; // whitespace columns cannot hold a blank
  const comment = first && !!l.comment && v.trimStart().startsWith(l.comment);
  const must = comment || v.includes(l.delimiter) || v.includes('"') || /[\r\n]/.test(v) || v !== v.trim();
  return l.quoteAll || must ? `"${v.replace(/"/g, '""')}"` : v;
}

export function rowText(cells: string[], l: Layout): string {
  if (l.columnEnds && cells.length === l.columnEnds.length) {
    // right-aligned on the file's column edges, a field too wide pushing the rest along by one space
    let out = "";
    cells.forEach((v, k) => { const f = field(v, l); out += " ".repeat(Math.max(k ? 1 : 0, l.columnEnds![k] - out.length - f.length)) + f; });
    return out;
  }
  return cells.map((v, k) => field(v, l, k === 0)).join(l.delimiter === " " ? " " : l.spaceAfter ? `${l.delimiter} ` : l.delimiter);
}

export function writeSheet(s: Sheet): string {
  const l = s.layout;
  const lines: (string | { text: string; ending?: RecordEnding | "" })[] = [];
  const before = new Map<number, Sheet["comments"]>();
  for (const comment of s.comments) {
    let group = before.get(comment.at);
    if (!group) before.set(comment.at, group = []);
    group.push(comment);
  }
  const comments = (at: number) => { for (const comment of before.get(at) ?? []) lines.push(comment); };
  const row = (raw: RawRecord | undefined, cells: string[]) => {
    if (raw !== null && typeof raw === "object") lines.push({ text: raw.text ?? rowText(cells, l), ending: raw.ending });
    else lines.push(raw ?? rowText(cells, l));
  };
  comments(-1);
  if (s.headerSource === "row") row(s.headerRaw, s.header);
  s.rows.forEach((r, i) => {
    comments(i);
    row(s.raw[i], r);
  });
  comments(s.rows.length);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ending = i < lines.length - 1 || l.trailingEol ? (typeof line === "string" ? l.eol : line.ending || l.eol) : "";
    lines[i] = (typeof line === "string" ? line : line.text) + ending;
  }
  return (l.bom ? "\ufeff" : "") + lines.join("");
}

/** Drop the original field formatting while keeping any non-default record ending. */
export function rewriteRecord(raw: RawRecord): RawRecord {
  return raw !== null && typeof raw === "object" ? { text: null, ending: raw.ending } : null;
}
