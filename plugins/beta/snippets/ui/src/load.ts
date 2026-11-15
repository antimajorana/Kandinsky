// Reading what a vault says: its modules in .kandinsky/snippets/ (the one place snippets come from), the old file until it is
// converted, and what Settings switched off or on. A vault with neither gets the LaTeX set written as its first file.
import type { PluginApi } from "../../../../../ui/src/lib/plugin-api";
import { builders, compileAll, readLegacy, type Entry, type Loaded, type Problem } from "./format";
import { options } from "./options";
import * as std from "./std";

export const FOLDER = ".kandinsky/snippets";
export const CONVERTED = `${FOLDER}/converted.js`;
export const STARTER = `${FOLDER}/latex.js`;
const dsl = { ...builders, std, options };

/** The keys Settings turned the other way from what the files say (a JSON list in the plugin's `switched` setting). */
export function switchedOf(saved: unknown): Set<string> {
  try { const v = JSON.parse(String(saved ?? "[]")); return new Set(Array.isArray(v) ? v.map(String) : []); }
  catch { return new Set(); }
}

/** A file's text as a module the browser can import, its relative imports pointing at their own. */
async function moduleUrl(kandinsky: PluginApi, path: string, seen: Map<string, Promise<string>>): Promise<string> {
  const known = seen.get(path);
  if (known) return known;
  const made = (async () => {
    const text = await kandinsky.readText(path);
    const dir = path.slice(0, path.lastIndexOf("/"));
    const parts: string[] = [];
    let at = 0;
    for (const m of text.matchAll(/(\bfrom\s*|\bimport\s*\(?\s*)(["'])(\.\.?\/[^"']+)\2/g)) {
      const target = new URL(m[3], `file:///${dir}/`).pathname.slice(1);
      parts.push(text.slice(at, m.index), m[1], JSON.stringify(await moduleUrl(kandinsky, decodeURI(target), seen)));
      at = m.index + m[0].length;
    }
    parts.push(text.slice(at));
    return URL.createObjectURL(new Blob(parts, { type: "text/javascript" }));
  })();
  seen.set(path, made);
  return made;
}

/** One module's entries; a list, or a function given the builders. */
async function readModule(kandinsky: PluginApi, path: string, seen: Map<string, Promise<string>>): Promise<Entry[]> {
  const url = await moduleUrl(kandinsky, path, seen);
  const mod = await import(/* @vite-ignore */ url);
  const made = typeof mod.default === "function" ? mod.default(dsl) : mod.default;
  if (!Array.isArray(made)) throw new Error("its default export gives no list of snippets");
  return made.flat(Infinity) as Entry[];
}

export interface Read extends Loaded { fromOldFile: boolean; modules: string[]; oldFile: { sources: string[]; variables: string } | null; wroteStarter: boolean }

/** Keeps the vault's copy of the plugin's LaTeX set (starter.js) equal to the plugin's: written when missing, replaced
 *  when the plugin's differs (the copy replaced to .kandinsky/trash, so nothing is lost). True when it wrote. The set is
 *  the plugin's, not the vault's: switches live in Settings, a vault's own snippets in other files. */
async function keepStarter(kandinsky: PluginApi): Promise<boolean> {
  const answer = await fetch(kandinsky.assetUrl("starter.js"));
  if (!answer.ok) throw new Error(`starter.js: ${answer.status}`);
  const shipped = await answer.text();
  const there = (await kandinsky.exists(STARTER)) ? await kandinsky.readText(STARTER) : null;
  if (there === shipped) return false;
  if (there !== null) await kandinsky.trash(STARTER);
  await kandinsky.writeText(STARTER, shipped);
  return true;
}

export async function loadAll(kandinsky: PluginApi, starter = true): Promise<Read> {
  const files: { source: string; entries: Entry[] }[] = [], problems: Problem[] = [];
  let names: string[] = [];
  // asked first: listing a folder that is not there is a 404 in the page's console
  if (await kandinsky.exists(FOLDER).catch(() => false)) names = (await kandinsky.list(FOLDER).catch(() => [])).filter((f) => !f.dir && f.name.endsWith(".js")).map((f) => f.path).sort();
  const seen = new Map<string, Promise<string>>(), modules: string[] = [];
  for (const path of names) {
    // a file with no `export default` is not of this format: an old array of snippets kept in the same folder
    if (!/\bexport\s+default\b/.test(await kandinsky.readText(path).catch(() => ""))) continue;
    modules.push(path);
    try { files.push({ source: path, entries: await readModule(kandinsky, path, seen) }); }
    catch (e) { problems.push({ source: path, what: `could not be read: ${String((e as Error).message ?? e)}` }); }
  }
  // the old file until the vault has converted it or takes the plugin's set; route gone or nothing set: none
  const oldFile = await kandinsky.editor.legacySnippets().catch(() => null);
  const hasOld = !!oldFile?.sources.some((s) => s.trim());
  // converting or the plugin's set ends it; a module of your own beside it does not
  const fromOldFile = hasOld && !modules.includes(CONVERTED) && !modules.includes(STARTER);
  if (fromOldFile) {
    const legacy = readLegacy(oldFile!);
    files.push({ source: legacy.source, entries: legacy.entries });
    problems.push(...legacy.problems);
  }
  // the plugin's LaTeX set kept current, unless an old file not yet converted still holds the vault's snippets. Not
  // when the old file could not be asked for (LaTeX switched off: the route is gone): writing the set then would end
  // an old file for good that is only out of reach for now
  if (starter && !fromOldFile && oldFile !== null) {
    try { if (await keepStarter(kandinsky)) return { ...(await loadAll(kandinsky, false)), wroteStarter: true }; }
    catch (e) { problems.push({ source: STARTER, what: `could not be written: ${String((e as Error).message ?? e)}` }); }
  }
  const compiled = compileAll(files, switchedOf(kandinsky.plugin.settings.switched));
  return { ...compiled, problems: [...problems, ...compiled.problems], fromOldFile, modules, oldFile: hasOld ? oldFile : null, wroteStarter: false };
}
