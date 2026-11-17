// The Predictor's helper (docs/design/DESIGN-spelling-predictor.md): each note's sentences as plain words, with its
// language, a chunk of notes per call so no call nears the helper's time limit; and a Hunspell dictionary's word list,
// for finishing words the vault does not write often. Nothing is written; the page keeps the model in memory.
import type { Params } from "kandinsky-helper";
import { frontMatterEnd, guessLanguage, plainProse, withoutLongRuns, wordsOf } from "../../../../ui/src/lib/editor/prose";
import { chooseDictionaries, installedDictionaries, machineFiles, vaultFiles, type Exec } from "../../../../ui/src/lib/editor/dictionaries";
import { packSentences, sentences } from "../ui/src/model";

const exec: Exec = (cmd, args, opts) => kandinsky.exec(cmd, args, opts) as unknown as ReturnType<Exec>;
const vault = vaultFiles(kandinsky), machine = machineFiles(exec);

const ASCII_LOWER_WORD = /^[a-z][a-z'-]*$/;
const UNICODE_LOWER_WORD = /^\p{Ll}[\p{Ll}\p{M}'’-]*$/u;
const NON_ASCII = /[^\x20-\x7e]/;
const dicStemCache = new Map<string, string[]>();

/** Parse and cache a `.dic` file's lower-case stems (ASCII fast-path before Unicode `\p{Ll}`). */
function cachedDicStems(name: string, dic: string): string[] {
  const key = `${name}:${dic.length}:${dic.slice(0, 64)}`;
  const cached = dicStemCache.get(key);
  if (cached) return cached;

  const out = new Set<string>();
  const firstNl = dic.indexOf("\n");
  if (firstNl >= 0) {
    const len = dic.length;
    let pos = firstNl + 1;
    while (pos < len) {
      let nl = dic.indexOf("\n", pos);
      if (nl < 0) nl = len;
      let end = nl;
      if (end > pos && dic.charCodeAt(end - 1) === 13) end--;
      const slash = dic.indexOf("/", pos);
      if (slash >= pos && slash < end) end = slash;
      for (let i = pos; i < end; i++) {
        const c = dic.charCodeAt(i);
        if (c <= 32 || c === 160) { end = i; break; }
      }
      if (end > pos) {
        const raw = dic.slice(pos, end);
        if (ASCII_LOWER_WORD.test(raw)) {
          out.add(raw);
        } else if (NON_ASCII.test(raw)) {
          const w = raw.split(/\s/)[0];
          if (UNICODE_LOWER_WORD.test(w)) out.add(w);
        }
      }
      pos = nl + 1;
    }
  }
  const stems = [...out].sort();
  dicStemCache.set(key, stems);
  return stems;
}

/** The notes to count, in order (the page asks for them in chunks). */
async function notes() {
  return (await kandinsky.files(true)).filter((p) => /\.md$/i.test(p) && !p.startsWith(".kandinsky/"));
}

/** path → { lang, text: its sentences packed }; a note that is not the owner's writing (a kept mail) left out. */
async function count(p: Params) {
  const langs = (p.langs as string[]) ?? ["en"];
  const fallback = String(p.fallback ?? langs[0] ?? "en");
  const out: Record<string, { lang: string; text: string }> = {};
  for (const path of (p.paths as string[]) ?? []) {
    let text: string;
    try { text = withoutLongRuns(await kandinsky.read(path), false); } catch { continue; } // gone since the list
    const fmEnd = frontMatterEnd(text);
    const fm = fmEnd ? text.slice(0, fmEnd) : "";
    if (fm && /^message_id:/m.test(fm)) continue;
    const langProp = fm ? /^lang:\s*([\w-]+)/m.exec(fm)?.[1] : undefined;
    const lang = guessLanguage(text, langs, fallback, langProp);
    out[path] = { lang, text: packSentences(sentences(plainProse(text), wordsOf)) };
  }
  return out;
}

/** A language's dictionary words (lower case, without affixes), one per line; "" when none is installed. */
async function lexicon(p: Params) {
  const found = await installedDictionaries(vault, machine, p.folder);
  const names = chooseDictionaries([...found.keys()], p.dictionaries).get(String(p.lang ?? "en")) ?? [];
  if (names.length === 1) {
    const at = found.get(names[0]);
    if (!at) return "";
    return cachedDicStems(names[0], await at.files.read(`${at.dir}/${names[0]}.dic`)).join("\n");
  }
  const words = new Set<string>();
  for (const name of names) {
    const at = found.get(name);
    if (!at) continue;
    for (const w of cachedDicStems(name, await at.files.read(`${at.dir}/${name}.dic`))) words.add(w);
  }
  return [...words].join("\n");
}

kandinsky.methods({ notes, count, lexicon });
