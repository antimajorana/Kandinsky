// The graph view's settings, in Obsidian's graph.json shape (the same names, ranges and defaults), so a vault
// that comes from Obsidian opens its graph as it was there: read from `.kandinsky/graph.json`, or the first time from
// `.obsidian/graph.json`. Changes are kept in `.kandinsky/graph.json` only — Obsidian's own file is never written.
import { api } from "../api";

export interface ColorGroup { query: string; color: { a: number; rgb: number } }

export interface GraphSettings {
  // Filters
  search: string;
  showTags: boolean;
  showAttachments: boolean;
  showOrphans: boolean;
  // Groups
  colorGroups: ColorGroup[];
  // Display
  showArrow: boolean;
  textFadeMultiplier: number;
  nodeSizeMultiplier: number;
  lineSizeMultiplier: number;
  // Forces
  centerStrength: number;
  repelStrength: number;
  linkStrength: number;
  linkDistance: number;
  // the settings card: shut, and each section folded
  close: boolean;
  "collapse-filter": boolean;
  "collapse-color-groups": boolean;
  "collapse-display": boolean;
  "collapse-forces": boolean;
}

/** Obsidian's own defaults. */
export const DEFAULTS: GraphSettings = {
  search: "", showTags: false, showAttachments: false, showOrphans: true, colorGroups: [],
  showArrow: false, textFadeMultiplier: 0, nodeSizeMultiplier: 1, lineSizeMultiplier: 1,
  centerStrength: 0.518713248970312, repelStrength: 10, linkStrength: 1, linkDistance: 250,
  close: true, "collapse-filter": true, "collapse-color-groups": true, "collapse-display": true, "collapse-forces": true,
};

/** Slider ranges, as Obsidian draws them. */
export const RANGES: Record<"textFadeMultiplier" | "nodeSizeMultiplier" | "lineSizeMultiplier" | "centerStrength" | "repelStrength" | "linkStrength" | "linkDistance", [number, number, number]> = {
  textFadeMultiplier: [-3, 3, 0.1], nodeSizeMultiplier: [0.1, 5, 0.01], lineSizeMultiplier: [0.1, 5, 0.01],
  centerStrength: [0, 1, 0.01], repelStrength: [0, 20, 0.1], linkStrength: [0, 1, 0.01], linkDistance: [30, 500, 1],
};

const OWN = ".kandinsky/graph.json", OBSIDIAN = ".obsidian/graph.json";

/** Only the keys it knows, each of the right kind, numbers kept in their range. */
export function clean(raw: unknown): GraphSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s: GraphSettings = { ...DEFAULTS, colorGroups: [] };
  for (const k of Object.keys(DEFAULTS) as (keyof GraphSettings)[]) {
    const v = o[k], d = DEFAULTS[k];
    if (k === "colorGroups") continue;
    if (typeof d === "boolean" && typeof v === "boolean") (s as unknown as Record<string, unknown>)[k] = v;
    else if (typeof d === "string" && typeof v === "string") (s as unknown as Record<string, unknown>)[k] = v;
    else if (typeof d === "number" && typeof v === "number" && Number.isFinite(v)) {
      const r = RANGES[k as keyof typeof RANGES];
      (s as unknown as Record<string, unknown>)[k] = r ? Math.min(r[1], Math.max(r[0], v)) : v;
    }
  }
  if (Array.isArray(o.colorGroups)) {
    s.colorGroups = o.colorGroups.flatMap((g): ColorGroup[] => {
      const q = (g as { query?: unknown })?.query, c = (g as { color?: { rgb?: unknown; a?: unknown } })?.color;
      return typeof q === "string" && c && typeof c.rgb === "number" ? [{ query: q, color: { a: typeof c.a === "number" ? c.a : 1, rgb: c.rgb } }] : [];
    });
  }
  return s;
}

/** Where the settings came from: Kandinsky's own file, Obsidian's (the first time), or neither. */
export type GraphSettingsSource = "own" | "obsidian" | "defaults";

export async function loadGraphSettings(): Promise<{ settings: GraphSettings; from: GraphSettingsSource }> {
  for (const [path, from] of [[OWN, "own"], [OBSIDIAN, "obsidian"]] as const) {
    try {
      const f = await api.file(path);
      return { settings: clean(JSON.parse(f.text)), from };
    } catch { /* not there, or not JSON: the next one */ }
  }
  return { settings: clean({}), from: "defaults" };
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** Saves to `.kandinsky/graph.json` a moment after the last change (a slider sends many). */
export function saveGraphSettings(s: GraphSettings): void {
  if (timer) clearTimeout(timer);
  const text = JSON.stringify(s, null, 2) + "\n";
  timer = setTimeout(() => { void api.putFile(OWN, text).catch(() => { /* kept in this window; the next change tries again */ }); }, 700);
}

/** `#rrggbb` ⇄ graph.json's colour (a 24-bit number). */
export const hexOf = (rgb: number): string => "#" + (rgb & 0xffffff).toString(16).padStart(6, "0");
export const rgbOf = (hex: string): number => parseInt(hex.replace("#", ""), 16) & 0xffffff;
