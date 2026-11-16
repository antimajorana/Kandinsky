// "New canvas": tiny standalone helper (like draw-new.ts) so startup never pulls in Canvas.svelte.
import { api } from "./api";
import { context } from "./context.svelte";
import { open } from "./dock";
import { pick } from "./palette.svelte";
import { basename, dirOf } from "./paths";
import { settings } from "./settings.svelte";
import { toast } from "./state.svelte";
import { errText } from "./text";
import { listVault } from "./vault";

const EMPTY_CANVAS = '{\n  "nodes": [],\n  "edges": []\n}\n';
const stamp = (): string => new Date().toLocaleString("sv-SE").replace(" ", "-").replace(/:/g, "").slice(0, 17);

function cleanStem(raw: string): string | null {
  const t = raw.trim().replace(/\.canvas$/i, "").replace(/^\/+|\/+$/g, "");
  if (!t || /[\\:*?"<>|]/.test(t) || t.split("/").some((p) => !p || p === "." || p === "..")) return null;
  return t;
}

function targetFolder(dir?: string): string {
  if (dir !== undefined) return dir.replace(/^\/+|\/+$/g, "");
  const active = context.active?.path ?? "";
  if (active && !active.startsWith(".kandinsky/") && active.includes("/")) return dirOf(active);
  return (settings.config?.draw?.dir ?? "notes/drawings").replace(/^\/+|\/+$/g, "");
}

async function createAndOpen(path: string, done: (path: string) => void): Promise<void> {
  try {
    const r = await api.createFile(path, EMPTY_CANVAS);
    if (!r.written) toast("Already there", `${path} already exists — opening it.`, "info");
    open({ kind: "canvas", path });
    done(path);
  } catch (e) {
    toast("Canvas not created", errText(e), "error");
  }
}

/** Asks for a canvas name, creates `<folder>/<name>.canvas` via `api.createFile`, and opens `{ kind: "canvas", path }`. */
export async function newCanvas(dir?: string, done: (path: string) => void = () => {}): Promise<void> {
  const into = targetFolder(dir);
  const quick = `canvas-${stamp()}`;
  const existing = (await listVault().catch(() => [] as string[])).filter((p) => /\.canvas$/i.test(p)).sort((a, b) => a.localeCompare(b));
  pick({
    placeholder: "Name for the new canvas whiteboard…",
    tag: "New canvas",
    icon: "grid",
    items: [
      { value: `new:${quick}`, title: `Untitled (${quick})`, detail: into ? `into ${into}/` : "in vault root", icon: "plus", section: "New" },
      ...existing.map((p) => ({ value: `open:${p}`, title: basename(p).replace(/\.canvas$/i, ""), detail: dirOf(p) || "/", icon: "grid" as const, section: "Canvases" })),
    ],
    typed: (text) => {
      const stem = cleanStem(text);
      return stem ? `Create “${stem}.canvas”${stem.includes("/") || !into ? "" : ` in ${into}/`}` : null;
    },
    typedAs: { section: "New", icon: "plus" },
    onpick: async (value, isNew) => {
      if (!isNew && value.startsWith("open:")) { const p = value.slice(5); open({ kind: "canvas", path: p }); done(p); return; }
      const stem = cleanStem(isNew ? value : value.replace(/^new:/, ""));
      if (!stem) return;
      await createAndOpen(stem.includes("/") || !into ? `${stem}.canvas` : `${into}/${stem}.canvas`, done);
    },
  });
}
