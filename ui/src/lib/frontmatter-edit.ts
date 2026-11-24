// A properties-panel edit, applied to the open note as ONE editor change: the core rewrites only the
// frontmatter (frontmatter.rs: key order, comments and unknown keys kept), and the difference is
// dispatched into the editor, so undo, the dirty mark and the autosave are the editor's own.
import { Annotation } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { api } from "./api";
import type { FrontmatterEdit } from "./types";

/** The smallest change turning `a` into `b` (common prefix and suffix kept). */
export function diff(a: string, b: string): { from: number; to: number; insert: string } | null {
  if (a === b) return null;
  let p = 0;
  const n = Math.min(a.length, b.length);
  while (p < n && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  let s = 0;
  while (s < n - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  return { from: p, to: a.length - s, insert: b.slice(p, b.length - s) };
}

/** Apply `edit` to the note in `view`. A note edited meanwhile (typing during the request) wins:
 *  the edit is dropped rather than overwrite what was typed, and the caller is told. */
export async function editFrontmatter(view: EditorView, edit: FrontmatterEdit): Promise<boolean> {
  return applyFrontmatterEdit(view, edit, false);
}

/** The explicit page lock toggle can remove the lock from an otherwise read-only editor. */
export const pageLockChange = Annotation.define<boolean>();

export function setPageLock(view: EditorView, locked: boolean): Promise<boolean> {
  const edit: FrontmatterEdit = locked ? { op: "set", key: "locked", value: true } : { op: "remove", key: "locked" };
  return applyFrontmatterEdit(view, edit, !locked);
}

async function applyFrontmatterEdit(view: EditorView, edit: FrontmatterEdit, unlock: boolean): Promise<boolean> {
  if (view.state.readOnly && !unlock) return false;
  const before = view.state.doc.toString();
  const { text } = await api.editFrontmatter(before, edit);
  if (view.state.doc.toString() !== before || (view.state.readOnly && !unlock)) return false;
  const change = diff(before, text);
  if (change) view.dispatch({ changes: change, userEvent: "input.properties", annotations: unlock ? pageLockChange.of(true) : [] });
  return true;
}
