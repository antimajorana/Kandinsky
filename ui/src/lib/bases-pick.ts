// The Bases button: a chooser of the vault's `.base` files (by folder) that also makes a new one, in the folder
// where the vault keeps its bases (the one with most of them), else `Bases/`.
import { api } from "./api";
import { openPath } from "./dock";
import { errText } from "./text";
import { pick } from "./palette.svelte";
import { toast } from "./state.svelte";

const NEW_BASE = `filters:
  and:
    - 'file.ext == "md"'
views:
  - type: table
    name: Table
    order:
      - file.name
      - file.mtime
`;

const folderOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

export async function pickBase(): Promise<void> {
  let bases: string[] = [];
  try { bases = (await api.files()).filter((p) => /\.base$/i.test(p)).sort((a, b) => a.localeCompare(b)); }
  catch (e) { toast("Bases", errText(e), "error"); return; }
  const counts = new Map<string, number>();
  for (const b of bases) counts.set(folderOf(b), (counts.get(folderOf(b)) ?? 0) + 1);
  const home = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Bases";
  pick({
    placeholder: bases.length ? "Open a base, or type a name for a new one…" : "Type a name for the vault's first base…",
    tag: "Bases", icon: "table",
    items: bases.map((p) => ({ value: p, title: (p.split("/").pop() ?? p).replace(/\.base$/i, ""), detail: folderOf(p) || "/", icon: "table" as const, section: "Bases" })),
    typed: (text) => { const t = text.trim().replace(/\.base$/i, ""); return t && !/[\\/:*?"<>|]/.test(t) ? `New base “${t}” in ${home || "/"}` : null; },
    typedAs: { section: "New", icon: "plus" },
    onpick: async (value, isNew) => {
      if (!isNew) { openPath(value); return; }
      const name = value.trim().replace(/\.base$/i, "");
      const path = `${home ? home + "/" : ""}${name}.base`;
      try {
        const r = await api.createFile(path, NEW_BASE);
        if (!r.written) toast("Already there", `${path} exists: opening it.`, "info");
        openPath(path);
      } catch (e) { toast("Base not made", errText(e), "error"); }
    },
  });
}
