// Reading a paper (docs/guides/NOTES-SYSTEM.md, "Reading"; docs/guides/ZOTERO.md, "The reading note"): its note,
// `<paper folder>/<citekey>.md`, beside its PDF. The core makes the note on first use (properties, the
// `library.paper` block, a place to write) and renames a legacy `notes.md`; this module only opens it.
import { errText } from "./text";
import type { Action } from "./actions";
import { api } from "./api";
import { context } from "./context.svelte";
import { open, openPath } from "./dock";
import type { Paper } from "./gen/Paper";
import { toast } from "./state.svelte";

/** The paper's reading note, made if it is not there yet: its path, or null (said in a toast). */
export async function readingNote(key: string): Promise<string | null> {
  try { return (await api.refsNote(key)).path; }
  catch (e) { toast(`No reading note for ${key}`, errText(e), "error"); return null; }
}

/** Opens the paper's reading note (a citation chip, the Library's "Notes"). */
export async function openReadingNote(key: string, opts: { beside?: boolean } = {}): Promise<void> {
  const path = await readingNote(key);
  if (path) open({ kind: "editor", path }, opts);
}

/** The PDF, and the notes in the split beside it with the caret in them (the Library's "Read"). */
/** Opens a paper: its PDF (the note is one button away there — "Note"), else its note. The PDF opens alone; its bar has a button for the note. */
export function readPaper(p: { key: string; pdf: string | null }): void {
  if (p.pdf) openPath(p.pdf);
  else void openReadingNote(p.key);
}

/** The Library entry whose folder holds `path` (its PDF, its note), if any. */
async function paperOf(path: string): Promise<Paper | undefined> {
  const norm = path.replaceAll("\\", "/");
  const dir = norm.includes("/") ? norm.slice(0, norm.lastIndexOf("/")) : "";
  const list = await api.refs().catch(() => [] as Paper[]);
  return list.find((p) => (dir !== "" && p.dir === dir) || p.pdf === norm);
}

/** Before something writes into the note of the paper holding `path` (the annotation export): the
 *  note made with its default content. Nothing outside the Library. */
export async function ensureNoteOf(path: string): Promise<void> {
  const paper = await paperOf(path);
  if (paper) await api.refsNote(paper.key).catch(() => undefined);
}

/** From any file of a paper (its PDF, usually): the paper's notes, beside. `path`: that file (default: the active one). */
export async function notesBeside(path = context.active?.path ?? ""): Promise<void> {
  const paper = await paperOf(path);
  let note = paper ? await readingNote(paper.key) : null;
  if (!note && path && /\.pdf$/i.test(path)) {
    const pm = await api.pdfMarks(path).catch(() => null);
    note = pm?.note ?? (await api.companion({ path, title: null, properties: {}, block: null, find: false }).catch(() => null))?.path ?? null;
  }
  if (!note) { toast("Not a paper", "Open a paper from the Library first: this opens its notes beside the PDF."); return; }
  open({ kind: "editor", path: note }, { beside: path !== note });
}

export const paperActions: Action[] = [
  { id: "ui.paper.notes", title: "Paper: its notes beside the PDF", keys: "Ctrl+Alt+L", run: () => void notesBeside() },
];
