// Notecraft-inspired custom folder colors (`.kandinsky/folder-colors.json`) + lightweight per-note `icon:`
// frontmatter cache for the unified Notion-style vault page tree. Keeps Markdown syntax 100% untouched.
import { SvelteMap } from "svelte/reactivity";
import { api } from "./api";
import { folderTint, type FolderTint } from "./oracle-explorer.svelte";
import { reloadOnChange } from "./reload-on-change";
import { readText } from "./vault-files";
import { on, touches } from "./bus";

export const FOLDER_COLORS_FILE = ".kandinsky/folder-colors.json";

export type FolderColorId =
  | "cobalt"
  | "viridian"
  | "ochre"
  | "vermilion"
  | "amber"
  | "mauve"
  | "cyan";

export interface FolderColorChoice {
  id: FolderColorId;
  label: string;
  cssVar: string;
}

export const FOLDER_COLOR_PALETTE: readonly FolderColorChoice[] = [
  { id: "cobalt", label: "Ultramarine Cobalt", cssVar: "var(--accent)" },
  { id: "viridian", label: "Viridian Teal", cssVar: "var(--green)" },
  { id: "ochre", label: "Cadmium Ochre", cssVar: "var(--yellow)" },
  { id: "vermilion", label: "Vermilion Red", cssVar: "var(--red)" },
  { id: "amber", label: "Weimar Amber", cssVar: "var(--orange)" },
  { id: "mauve", label: "Cosmic Mauve", cssVar: "var(--purple)" },
  { id: "cyan", label: "Horizon Cyan", cssVar: "var(--cyan)" },
];

const COLOR_MAP = new Map<string, string>(FOLDER_COLOR_PALETTE.map((c) => [c.id, c.cssVar]));

const customColors = new SvelteMap<string, FolderColorId>();
let knownJson = "";
let initialized = false;

function normPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

async function loadFolderColors(): Promise<void> {
  try {
    const text = await readText(FOLDER_COLORS_FILE);
    if (text === null) {
      if (knownJson !== "") {
        knownJson = "";
        customColors.clear();
      }
      return;
    }
    if (text === knownJson) return;
    const parsed = JSON.parse(text) as Record<string, unknown>;
    knownJson = text;
    customColors.clear();
    if (parsed && typeof parsed === "object") {
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string" && COLOR_MAP.has(v)) {
          customColors.set(normPath(k), v as FolderColorId);
        }
      }
    }
  } catch {
    /* ignore malformed file */
  }
}

export function initFolderColors(): () => void {
  if (!initialized) {
    initialized = true;
    void loadFolderColors();
  }
  const offReload = reloadOnChange(() => void loadFolderColors(), {
    wait: 100,
    wants: (p) => normPath(p) === FOLDER_COLORS_FILE,
  });
  const offFs = on("fs", (e) => {
    if (!e.paths.length) {
      noteIcons.clear();
      pendingIcons.clear();
      return;
    }
    for (const p of e.paths) {
      const np = normPath(p);
      if (touches([np], (x) => /\.(md|markdown)$/i.test(x))) {
        noteIcons.delete(np);
      }
    }
  });
  return () => {
    offReload();
    offFs();
  };
}

export function getCustomFolderColor(path: string): FolderColorId | null {
  return customColors.get(normPath(path)) ?? null;
}

export async function setCustomFolderColor(path: string, color: FolderColorId | null): Promise<void> {
  const np = normPath(path);
  if (!np) return;
  if (color) customColors.set(np, color);
  else customColors.delete(np);
  const obj: Record<string, FolderColorId> = {};
  for (const [k, v] of [...customColors.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    obj[k] = v;
  }
  const next = JSON.stringify(obj, null, 2) + "\n";
  knownJson = next;
  await api.putFile(FOLDER_COLORS_FILE, next);
}

/** Custom folder tint (exact folder or closest ancestor in `.kandinsky/folder-colors.json`), else semantic Bauhaus default. */
export function resolveFolderTint(path: string | undefined): FolderTint | null {
  if (!path) return null;
  const np = normPath(path);
  let cur = np;
  while (cur) {
    const id = customColors.get(cur);
    if (id) {
      const css = COLOR_MAP.get(id);
      if (css) return { color: css, dot: css };
    }
    const slash = cur.lastIndexOf("/");
    cur = slash > 0 ? cur.slice(0, slash) : "";
  }
  return folderTint(np);
}

// --- Lightweight per-note `icon:` frontmatter cache ------------------------------------------------

const noteIcons = new SvelteMap<string, string>(); // "" means checked & none
const pendingIcons = new Set<string>();

export function extractFrontmatterIcon(text: string): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(text);
  if (!m) return "";
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^icon\s*:\s*(.+)$/.exec(line);
    if (kv) {
      return kv[1].trim().replace(/^["']|["']$/g, "").trim().slice(0, 12);
    }
  }
  return "";
}

export function setCachedNoteIcon(path: string, icon: string | null | undefined): void {
  const np = normPath(path);
  if (!np) return;
  noteIcons.set(np, (icon ?? "").trim());
}

/** Reactive lookup of a Markdown note's `icon:` frontmatter property for tree rows. */
export function getNoteIcon(path: string): string | null {
  if (!/\.(md|markdown)$/i.test(path)) return null;
  const np = normPath(path);
  const cached = noteIcons.get(np);
  if (cached !== undefined) return cached || null;
  if (!pendingIcons.has(np) && pendingIcons.size < 64) {
    pendingIcons.add(np);
    void readText(np)
      .then((txt) => {
        noteIcons.set(np, txt ? extractFrontmatterIcon(txt) : "");
      })
      .catch(() => {
        noteIcons.set(np, "");
      })
      .finally(() => {
        pendingIcons.delete(np);
      });
  }
  return null;
}
