// The names data had before the project was renamed (it is based on Atlas; the core's list is
// crates/kandinsky-core/src/legacy.rs). A drawing saved by an earlier build or an older phone app still carries them, so
// they are read as the current ones and written back under the current names.

/** A key of a drawing element's `customData` before the rename (`atlasPage`, `atlasTemplate`, `atlasPen`…). */
const OLD_KEY = /^atlas(?=[A-Z])/;

/** `customData` with every old key under its current name (`atlasPage` → `kandinskyPage`); a current key already
 *  there wins. The same object when there is nothing to rename. */
export function currentCustomData<T extends Record<string, unknown>>(data: T): T {
  if (!Object.keys(data).some((k) => OLD_KEY.test(k))) return data;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (!OLD_KEY.test(k)) out[k] = v;
  for (const [k, v] of Object.entries(data)) {
    const now = k.replace(OLD_KEY, "kandinsky");
    if (now !== k && !(now in out)) out[now] = v;
  }
  return out as T;
}

/** A `JSON.parse` reviver for a drawing (`.excalidraw`): every element's `customData` under the current names. */
export function drawingKeys(key: string, value: unknown): unknown {
  return key === "customData" && value && typeof value === "object" && !Array.isArray(value) ? currentCustomData(value as Record<string, unknown>) : value;
}

/** A drawing's JSON text parsed (typed as `JSON.parse` is), its elements' `customData` under the current names; a
 *  drawing without an old key (`"atlas…"`) is parsed as is, with no reviver over its every point. */
export const parseDrawing = (json: string): ReturnType<typeof JSON.parse> => (json.includes('"atlas') ? JSON.parse(json, drawingKeys) : JSON.parse(json));

/** The file id the phone gives a PDF page it draws on the fly, before the rename (`atlas-page-<hash>-<n>`). */
export const OLD_PAGE_FILE = "atlas-page-";

/** `paths` and, for each in the state folder, the same path under its name from before the rename (`.kandinsky/x` →
 *  `.atlas/x`): what a plugin written then is told of a change, since it compares paths with `.atlas/` (the core takes
 *  either spelling back to the same file). */
export const withOldStatePaths = (paths: string[]): string[] =>
  paths.flatMap((p) => (p === ".kandinsky" || p.startsWith(".kandinsky/") ? [p, `.atlas${p.slice(".kandinsky".length)}`] : [p]));

/** Whether a plugin's code (its main.js or view.js text) compares paths with the state folder's old name. */
export const comparesOldStatePaths = (code: string): boolean => code.includes(".atlas/") || code.includes('".atlas"');
