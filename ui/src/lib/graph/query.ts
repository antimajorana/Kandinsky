// The graph's search filter and colour groups, in Obsidian's search language (the part that reads a file's
// name, path, tags and properties): words and "quoted phrases", `path:`, `file:`, `tag:`, `[property:value]`,
// `[property]`, a leading `-` to leave out, `OR`, and ( ) to group; `path:(a OR b)` gives every word inside the
// operator. Content operators (`line:`, `content:`, `section:`…) read the name and path here, as plain words do:
// the graph does not search inside notes. No imports: tested on its own.

/** What a filter can see of a file. Property names lowercase; values as text. */
export interface Subject { path: string; name: string; tags: string[]; props: Record<string, string[]> }

type Node =
  | { k: "and" | "or"; parts: Node[] }
  | { k: "not"; part: Node }
  | { k: "term"; field: string; text: string }
  | { k: "prop"; name: string; value: string | null }
  | { k: "all" };

const unquote = (s: string) => (s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s);

/** Splits into tokens: ( ) [..] "…", and words (a word may end in `:"…"` or `:(`). */
function tokens(q: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < q.length) {
    const ch = q[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "(" || ch === ")") { out.push(ch); i++; continue; }
    if (ch === "[") { const j = q.indexOf("]", i); const e = j < 0 ? q.length : j + 1; out.push(q.slice(i, e)); i = e; continue; }
    if (ch === "-" && (q[i + 1] === "[" || q[i + 1] === "(" || q[i + 1] === '"')) { out.push("-"); i++; continue; }
    if (ch === '"') { const j = q.indexOf('"', i + 1); const e = j < 0 ? q.length : j + 1; out.push(q.slice(i, e)); i = e; continue; }
    let j = i;
    while (j < q.length && !/[\s()]/.test(q[j])) {
      if (q[j] === '"') { const e = q.indexOf('"', j + 1); j = e < 0 ? q.length : e + 1; continue; }
      j++;
    }
    let w = q.slice(i, j);
    if (w.endsWith(":") && q[j] === "(") { w += "("; j++; } // path:( … )
    out.push(w);
    i = j;
  }
  return out;
}

class Parser {
  private i = 0;
  private t: string[];
  constructor(t: string[]) { this.t = t; }
  parse(): Node {
    return this.or("");
  }
  private peek(): string | undefined { return this.t[this.i]; }
  private or(field: string): Node {
    const parts = [this.and(field)];
    while (this.peek() === "OR") { this.i++; parts.push(this.and(field)); }
    return parts.length === 1 ? parts[0] : { k: "or", parts };
  }
  private and(field: string): Node {
    const parts: Node[] = [];
    for (let p = this.peek(); p !== undefined && p !== ")" && p !== "OR"; p = this.peek()) parts.push(this.unary(field));
    return parts.length === 0 ? { k: "all" } : parts.length === 1 ? parts[0] : { k: "and", parts };
  }
  private unary(field: string): Node {
    const t = this.t[this.i++];
    if (t === "-") return { k: "not", part: this.unary(field) };
    if (t.length > 1 && t.startsWith("-")) { this.t[--this.i] = t.slice(1); return { k: "not", part: this.unary(field) }; }
    if (t === "(") { const n = this.or(field); if (this.peek() === ")") this.i++; return n; }
    if (t.startsWith("[")) {
      const body = t.replace(/^\[|\]$/g, ""), c = body.indexOf(":");
      return c < 0 ? { k: "prop", name: body.trim().toLowerCase(), value: null }
        : { k: "prop", name: body.slice(0, c).trim().toLowerCase(), value: unquote(body.slice(c + 1).trim()).toLowerCase() };
    }
    const m = /^([a-z-]+):(.*)$/i.exec(t);
    if (m && !t.startsWith('"')) {
      const f = m[1].toLowerCase();
      if (m[2] === "(") { const n = this.or(f); if (this.peek() === ")") this.i++; return n; }
      return { k: "term", field: f, text: unquote(m[2]).toLowerCase() };
    }
    return { k: "term", field, text: unquote(t).toLowerCase() };
  }
}

/** The filter `query` as a test on a file; an empty query keeps everything. */
export function compile(query: string): (s: Subject) => boolean {
  const tree = new Parser(tokens(query.trim())).parse();
  return (s) => test(tree, s);
}

function test(n: Node, s: Subject): boolean {
  switch (n.k) {
    case "all": return true;
    case "and": return n.parts.every((p) => test(p, s));
    case "or": return n.parts.some((p) => test(p, s));
    case "not": return !test(n.part, s);
    case "prop": {
      const vals = s.props[n.name];
      if (!vals || !vals.length) return false;
      return n.value === null || n.value === "" || vals.some((v) => v.toLowerCase().includes(n.value!));
    }
    case "term": {
      const x = n.text;
      if (!x) return true;
      switch (n.field) {
        case "path": return s.path.toLowerCase().includes(x);
        case "file": return s.name.toLowerCase().includes(x);
        case "tag": { const t = x.replace(/^#/, ""); return s.tags.some((g) => { const l = g.toLowerCase(); return l === t || l.startsWith(t + "/"); }); }
        default: return s.path.toLowerCase().includes(x) || s.name.toLowerCase().includes(x);
      }
    }
  }
}

/** The property names a query reads (`[type:meta]` → `type`), so the graph can ask for them. */
export function propertiesIn(query: string): string[] {
  const out = new Set<string>();
  for (const t of tokens(query)) {
    const m = /^-?\[([^:\]]+)/.exec(t);
    if (m) out.add(m[1].trim().toLowerCase());
  }
  return [...out];
}
