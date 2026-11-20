// Mention entities (docs/guides/MALLEABLE.md R4): what `@id` in a note points at. Papers come from the
// Library; plugins add kinds by prefix (`@run:…`). Kept free of CodeMirror: plugins load at startup,
// the editor does not (editor/mentions.ts draws the chips).
import { api } from "./api";
import { on, touches } from "./bus";
import { open } from "./dock";
import { readDate, formatDate, dateTip } from "./dates";
import { openReadingNote } from "./papers";
import type { Paper } from "./gen/Paper";

export interface Entity { title: string; subtitle?: string; props?: Record<string, string>; open(): void }
export interface EntityProvider {
  /** What follows `@` (e.g. "run:"); "" is the Library's citekeys. */
  prefix: string;
  get(id: string): Promise<Entity | null>;
  /** For completion after `@<prefix>`. */
  list?(): Promise<{ id: string; title: string }[]>;
}

// --- the Library, cached until a reference's note changes (citation completion, chips) ------------
let papers: Promise<Paper[]> | null = null;
const listeners = new Set<() => void>();
let watching = false;
/** The cache dropped when a reference's note changes (subscribed lazily: this module is imported during startup). */
function watch(): void {
  if (watching) return;
  watching = true;
  on("fs", (e) => { if (touches(e.paths, (p) => /(?:^|\/)([^/]+)\/\1\.md$/.test(p) || /info\.yaml$/.test(p) || p.startsWith(".kandinsky/plugins/catalog-papers/"))) { papers = null; listeners.forEach((f) => f()); } });
}
/** Called when the Library changes. */
export function onLibraryChange(fn: () => void): () => void {
  listeners.add(fn);
  watch();
  return () => listeners.delete(fn);
}
// a failed ask (the references plugin still starting, or off) is not kept: the next one asks again
export const library = (): Promise<Paper[]> => { watch(); return (papers ??= api.refs().then((l) => (Array.isArray(l) ? l : []), () => { papers = null; return [] as Paper[]; })); };

const paperEntities: EntityProvider = {
  prefix: "",
  async get(key) {
    const p = (await library()).find((x) => x.key === key);
    if (!p) return null;
    const who = p.authors.length > 2 ? `${p.authors[0]} et al.` : p.authors.join(", ");
    return {
      title: p.title || p.key,
      subtitle: [who, p.year, p.venue].filter(Boolean).join(" · "),
      props: { key: p.key, ...(p.doi ? { doi: p.doi } : {}), ...(p.arxiv ? { arXiv: p.arxiv } : {}) },
      open: () => void openReadingNote(p.key), // <dir>/<citekey>.md, made on first use
    };
  },
};
export const providers: EntityProvider[] = [paperEntities];

/** Adds an entity kind (plugins: `kandinsky.registerEntities`). Longest prefix wins. */
export function registerEntities(p: EntityProvider): () => void {
  providers.push(p);
  providers.sort((a, b) => b.prefix.length - a.prefix.length);
  return () => { const i = providers.indexOf(p); if (i >= 0) providers.splice(i, 1); };
}
const DATE_MENTION_RE = /^(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?$/;

/** Resolves `@YYYY-MM-DD` and `@YYYY-MM-DD HH:MM` as built-in calendar date entities. */
export function resolveDateEntity(id: string): Entity | null {
  const m = DATE_MENTION_RE.exec(id.trim());
  if (!m) return null;
  const iso = m[1];
  const time = m[2];
  const when = readDate(time ? `${iso} ${time}` : iso);
  if (!when) return null;
  const dateLabel = formatDate(when.d, "MMM D, YYYY");
  const title = time ? `${dateLabel} · ${time}` : dateLabel;
  return {
    title,
    subtitle: dateTip(when.d),
    props: { date: iso, ...(time ? { time } : {}) },
    open: () => {
      open({ kind: "calendar", date: iso });
    },
  };
}

export async function resolveEntity(id: string): Promise<Entity | null> {
  const dateEnt = resolveDateEntity(id);
  if (dateEnt) return dateEnt;
  const p = providers.find((x) => id.startsWith(x.prefix));
  return p ? p.get(id.slice(p.prefix.length)) : null;
}
