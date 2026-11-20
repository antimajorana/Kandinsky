// Built-in plugins: parts of Kandinsky that are not for every vault (the Library is for science, not for
// a personal vault). Each one is switched like a vault plugin — its id in `[plugins] off` — and while
// off it has no toolbar button, no commands, no completions, and its native part in the core is not
// started. The native code stays in the core (it has to be fast: PDF import, the browser connector);
// what makes it a plugin is that nothing of it exists in a vault that switched it off.
// docs/guides/PLUGINS.md ("Built-in plugins").
import type { IconName, PaneSpec } from "./panes";
import type { PageId } from "./settings-pages";
import { settings } from "./settings.svelte";
import { plugins } from "./plugin-registry.svelte";
import { librariesPage, librariesPlugin, librariesSpec } from "./libraries.svelte";

/** The built-in plugins' ids — the core's `BuiltinPlugin` (config.rs) has the same; a typo is a type error. */
export type BuiltinId = "library" | "latex" | "graph" | "bases";

export interface Builtin {
  id: BuiltinId;
  title: string;
  description: string;
  icon: IconName;
  /** A button at the top of the left bar (lib/apps.svelte.ts) running `command` (an action marked `plugin: id`),
   *  which opens `pane` — none while there is nothing to open. A plugin that only adds to the editor has none.
   *  Without `pane` the button only runs the command (a chooser, as Bases' is): no tab is its own. */
  button?: { command: string; pane?: () => PaneSpec | null };
  /** Its own page in Settings (lib/settings-pages.ts, a page with `plugin: id`), listed under Plugins. */
  page?: PageId;
  /** What it adds, for Settings → Plugins. */
  parts: string;
}

export const BUILTINS: Builtin[] = [
  {
    // id "library" kept: vaults switch it off by that name. Its button opens the Libraries page (the Catalog plugin's
    // pane, libraries.svelte.ts) at References, the library it adds; never hides while plugins load or while the
    // built-in library or a libraries plugin exists.
    id: "library", title: "Library", icon: "library", button: { command: "ui.library", pane: () => (!plugins.loaded || librariesPage() || librariesPlugin() || builtinOn("library") ? librariesSpec(builtinOn("library") ? "references" : undefined) : null) },
    description: "References (your papers, books, theses and lecture notes) as the first library of the Library page — the Catalog plugin's — \\cite completion and the PDF reader's paper actions. The references themselves — their notes, refs.bib, the Zotero connector, PDF sources — are the Catalog · Science plugin's.",
    parts: "References in the Library page · commands · \\cite completion",
  },
  {
    // Obsidian's core "Graph view": a button on the left bar, as Obsidian's ribbon has
    id: "graph", title: "Graph view", icon: "graph", button: { command: "ui.graph", pane: () => ({ kind: "graph" }) },
    description: "The notes and the links between them as a graph, with Obsidian's settings: filters (search, tags, attachments, orphans), colour groups, display and forces. The first time, the graph starts from the vault's Obsidian graph settings (.obsidian/graph.json); changes are kept in .kandinsky/graph.json.",
    parts: "Graph view · its button · the graph command",
  },
  {
    // Obsidian's core "Bases": its `.base` files open as tables wherever they are; this adds the way in
    id: "bases", title: "Bases", icon: "table", button: { command: "ui.bases" },
    description: "Obsidian's databases: every .base file of the vault opens as tables of notes (filters, formulas, views). Its button lists the vault's bases and makes a new one.",
    parts: "Its button: the vault's bases · New base",
  },
  {
    // the core keeps rendering $…$ in notes (Obsidian fidelity); everything about typing LaTeX is this plugin's
    id: "latex", title: "LaTeX", icon: "sigma",
    description: "Typing LaTeX: symbol completions and .tex files. Snippets, the old LaTeX Suite file among them, are the Snippets plugin's. Math in notes is rendered either way.",
    parts: "LaTeX completions",
  },
];

export const builtinOn = (id: BuiltinId): boolean => !(settings.config?.plugins.off ?? []).includes(id);
