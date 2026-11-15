// What the graph view draws, read in one Bases query over the vault's notes: each note's path, tags, outgoing links
// (to notes and to attachments, already resolved to files) and the properties the filter and the colour groups
// ask about. Links that lead to no file are not in the vault's index, so the graph has no "unresolved" notes.
import { api } from "../api";
import type { BaseCell } from "../gen/BaseCell";

export interface NoteData { path: string; name: string; tags: string[]; links: string[]; props: Record<string, string[]> }

/** A cell as text values: a list gives its items, a link its file (else its text). */
function values(c: BaseCell | undefined, linkPath = false): string[] {
  if (!c) return [];
  switch (c.t) {
    case "null": return [];
    case "list": return c.items.flatMap((i) => values(i, linkPath));
    case "link": return linkPath ? (c.path ? [c.path] : []) : [c.text];
    case "text": return c.value ? [c.value] : [];
    case "date": return [c.text];
    case "num": case "bool": return [String(c.value)];
  }
}

/** A property name a Bases `order` can hold as it is. */
const plainName = (p: string) => /^[\p{L}\p{N}_-][\p{L}\p{N}_ -]*$/u.test(p);

export async function loadNotes(props: string[]): Promise<NoteData[]> {
  const extra = [...new Set(props)].filter(plainName);
  const order = ["file.path", "file.tags", "file.links", ...extra].map((c) => `      - '${c.replace(/'/g, "''")}'`).join("\n");
  const src = `filters: 'file.ext == "md"'\nviews:\n  - type: table\n    name: graph\n    order:\n${order}\n`;
  const r = await api.baseQuery(src);
  if (r.error) throw new Error(r.error);
  const view = r.views[0];
  if (!view) return [];
  return view.rows.map((row) => {
    const path = row.path || values(row.cells[0])[0] || "";
    const p: Record<string, string[]> = {};
    extra.forEach((name, i) => { const v = values(row.cells[3 + i]); if (v.length) p[name.toLowerCase()] = v; });
    return {
      path,
      name: (path.split("/").pop() ?? path).replace(/\.md$/i, ""),
      tags: values(row.cells[1]).map((t) => t.replace(/^#/, "")),
      links: values(row.cells[2], true),
      props: p,
    };
  });
}
