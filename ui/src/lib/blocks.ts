// The block registry (docs/refactor/REFACTOR-blocks.md): ONE map of everything Kandinsky can draw. A block mounts
// into any host — a ```view block in a note, a `.page`, or a tab of its own — so the Library, a PDF,
// a terminal or a calendar are the same kind of thing and go wherever the user puts them.
//   - built-in blocks: Today's parts, settings, saved search, tool drafts
//   - every pane kind (library, git, pdf, editor, terminal…), through one adapter
//   - plugin blocks (`kandinsky.registerBlock`)
//   - anything else is a row view (list, table, calendar: lib/views.ts) fed by the core's /api/view
import { errText } from "./text";
import { hydrateFences } from "./fences";
import "./pdf-marks-fence"; // the core's own fence: a PDF's marks in its note
import "./table-views-fence"; // the core's own fence: a table's saved views in its note
import "./tikz-fence"; // the core's own fence: a ```tikz picture drawn by TeX in the page
import "./ink-fence"; // the core's own fence: an Obsidian Ink block shown as a card for its file
import "./typst-fence"; // and a ```typst block drawn by the core's Typst
import "./mermaid-fence"; // dynamic SVG Mermaid diagrams (lazy-loaded)
import "./encrypted-fence"; // opt-in AES-GCM-256 encrypted block card (PBKDF2-SHA256 + WebCrypto)
import "./notebook-preview-fence"; // read-only .ipynb cell & output transclusion fence
import "./table-preview-fence"; // read-only .tsv / .csv / .dat tabular preview fence
import { mount, unmount, type Component } from "svelte";
import WidgetConfigureBar from "../components/widgets/WidgetConfigureBar.svelte";
import { parse as parseYaml } from "yaml";
import type { DockviewPanelApi } from "dockview-core";
import { api } from "./api";
import { open, type PaneProps } from "./dock";
import { iconSvg } from "./icons";
import { paneComponents } from "./pane-components";
import { librariesSpec } from "./libraries.svelte";
import { PANE_KINDS, blockType, paneIcon, paneId, paneTitle, specFromOptions, type IconName, type PaneKind, type PaneSpec } from "./panes";
import { renderView, rowViewTypes } from "./views";
import { BUILTIN_FIELDS, ROW_VIEW_FIELDS, type OptionField } from "./block-options";
import type { ViewRow } from "./gen/ViewRow";
import { lineOf, scopeAt, type Props } from "./section-props";
import TodayParts, { type TodayPart } from "../components/TodayParts.svelte";
import { IMAGE_RE } from "./paths";
import { reloadOnChange } from "./reload-on-change";
import { keepCapped } from "./capped";

/** Where a block is drawn: inside a note, on a page, alone in a tab, or in the sidebar. */
export type BlockHost = "note" | "page" | "tab" | "side";

export interface BlockCtx {
  /** The block's YAML, and the same parsed ({} when it does not parse). */
  src: string;
  options: Record<string, unknown>;
  /** The note or page holding the block: what "this section", `this.file` and frontmatter refer to. */
  doc: string;
  host: BlockHost;
  /** The block's title changed (an embedded pane names its file). */
  setTitle(title: string): void;
  /** What the block's place in its document knows: the note's frontmatter and the `key:: value`
   *  properties of the section around the block (lib/section-props.ts). {} outside a note. */
  props(): Promise<Props>;
}

export interface Block {
  /** What `type:` / `view:` says. */
  type: string;
  title: string;
  icon?: IconName;
  /** Height in px when embedded, for blocks that fill their box (panes). Others size to their content. */
  height?: number;
  /** Content that reads best on a card surface in a page (a note, a table); others bring their own look. */
  card?: boolean;
  /** The block shows a file: adding it asks which one (`true`: any file, or a pattern on the path). */
  file?: RegExp | true;
  /** The pane "Open as tab" opens instead of this block alone (an embedded PDF opens the PDF pane). */
  tab?(ctx: BlockCtx): PaneSpec | null;
  /** What it can be told, as form fields (lib/block-options.ts): the page's "Options…" form. */
  options?: OptionField[];
  /** A part of the shell (toolbar, tab list): never framed, no "open as a tab" button. */
  bare?: boolean;
  mount(host: HTMLElement, ctx: BlockCtx): void | (() => void);
}

const registry = new Map<string, Block>();
const watchers = new Map<string, Set<() => void>>();
const pending = new Set<string>();

/** Adds (or replaces) a block type; returns the undo. Blocks already on screen redraw. */
export function registerBlock(b: Block): () => void {
  registry.set(b.type, b);
  changed(b.type);
  return () => { if (registry.get(b.type) === b) { registry.delete(b.type); changed(b.type); } };
}
export const allBlocks = () => [...registry.values()];
export const getBlock = (type: string) => registry.get(type);
/** The form fields of a block type: its own, a built-in's, or the row views' shared ones. */
export const optionFields = (type: string): OptionField[] =>
  registry.get(type)?.options ?? BUILTIN_FIELDS[type] ?? (rowViewTypes().includes(type) ? ROW_VIEW_FIELDS : []);

// deferred: a plugin re-registering unregisters then registers in one go — draw once, with the new code
function changed(type: string): void {
  if (pending.has(type)) return;
  pending.add(type);
  queueMicrotask(() => { pending.delete(type); for (const f of [...(watchers.get(type) ?? [])]) f(); });
}
function onChange(type: string, f: () => void): () => void {
  const set = watchers.get(type) ?? new Set();
  watchers.set(type, set);
  set.add(f);
  return () => set.delete(f);
}

// --- built-in blocks ----------------------------------------------------------------------------

export const svelteBlock = (type: string, title: string, C: Component<never>, props: (ctx: BlockCtx) => Record<string, unknown>): Block => ({
  type, title,
  mount(host, ctx) {
    const app = mount(C as Component<Record<string, unknown>>, { target: host, props: props(ctx) });
    return () => void unmount(app);
  },
});

// Components that pull in the app's actions load on first use (and stay out of an import cycle).
const lazyBlock = (type: string, title: string, load: () => Promise<{ default: unknown }>, props: (ctx: BlockCtx) => Record<string, unknown>): Block => ({
  type, title,
  mount(host, ctx) {
    let app: ReturnType<typeof mount> | undefined;
    let gone = false;
    void load().then((m) => { if (!gone) app = mount(m.default as Component<Record<string, unknown>>, { target: host, props: props(ctx) }); });
    return () => { gone = true; if (app) void unmount(app); };
  },
});

const TODAY_PARTS: Record<TodayPart, string> = { greeting: "Greeting", capture: "Capture", focus: "Focus", log: "Today's log", tasks: "Open tasks", activity: "Activity" };
/** A day's log (its name or path has the day): its Activity block shows that day, as the old Obsidian log's base did. */
const dayOfDoc = (doc?: string) => /(\d{4}-\d{2}-\d{2})[^/]*\.md$/.exec(doc ?? "")?.[1];
for (const [p, title] of Object.entries(TODAY_PARTS)) registerBlock(svelteBlock(p, title, TodayParts as Component<never>, (c) => ({ parts: [p], day: p === "activity" ? dayOfDoc(c.doc) : undefined })));
registerBlock(lazyBlock("settings", "Settings page", () => import("../components/settings/SettingsBlock.svelte"), (c) => ({ src: c.src })));
registerBlock(lazyBlock("search", "Saved search", () => import("../components/views/SearchBlock.svelte"), (c) => ({ src: c.src, doc: c.doc })));
registerBlock({ ...lazyBlock("review", "Review (notes waiting, one at a time)", () => import("../components/views/Review.svelte"), (c) => ({ src: c.src, doc: c.doc })), icon: "check", card: true });
registerBlock({ ...lazyBlock("captures", "Captures (every capture, to triage)", () => import("../components/views/Captures.svelte"), (c) => ({ src: c.src })), icon: "inbox", card: true });
registerBlock(lazyBlock("tags", "Tags (every tag, its notes)", () => import("../components/views/Tags.svelte"), () => ({})));
registerBlock(lazyBlock("vaults", "Vaults (new, open, switch)", () => import("../components/views/VaultsBlock.svelte"), () => ({})));
registerBlock({ ...lazyBlock("welcome", "Getting started (where things are, plugins to add)", () => import("../components/views/Welcome.svelte"), (c) => ({ doc: c.doc })), icon: "home", card: true });
registerBlock(lazyBlock("suggestions", "Drafted for you", () => import("../components/ToolDrafts.svelte"), () => ({ compact: true })));

// --- every pane is a block ------------------------------------------------------------------------

// Four pane kinds share a name with an older, lighter block (a saved search's results, one settings
// page, a table of rows, the `calendar` row view of dated tasks): the block keeps the name that files
// already use, the pane gets its own.
const PANE_BLOCK_TYPE: Partial<Record<PaneKind, string>> = { search: "search-pane", settings: "settings-pane", table: "file-table", calendar: "calendar-pane" };
/** The block type a pane kind is embedded (and bookmarked) as. */
export const paneBlockType = (kind: PaneKind) => PANE_BLOCK_TYPE[kind] ?? kind;
// pane kinds that show a file, and which files (asked for when the block is added by hand)
const PANE_FILES: Partial<Record<PaneKind, RegExp | true>> = {
  editor: true, pdf: /\.pdf$/i, image: IMAGE_RE, table: /\.(tsv|csv|tab|dat|txt)$/i,
  page: /\.page$/i, notebook: /\.ipynb$/i, excalidraw: /\.excalidraw(\.md)?$/i, canvas: /\.canvas$/i,
};
const EMBED_HEIGHT = 420;
let embeds = 0;

/** What an embedded pane gets instead of its dockview tab: the few members panes use. */
function embedPanel(spec: PaneSpec, el: HTMLElement, setTitle: (t: string) => void): DockviewPanelApi {
  const id = `${paneId(spec)}@embed${++embeds}`; // unique: the same file may also be open in a tab
  const shim = {
    id,
    title: paneTitle(spec),
    /** "active" = the keyboard is inside it: an embedded editor never takes the focus on load */
    get isActive() { return el.contains(document.activeElement); },
    setTitle,
    updateParameters() { /* an embed's parameters are its YAML */ },
    onDidActiveChange: () => ({ dispose() {} }),
    close() { /* closing an embed = removing its block from the document */ },
  };
  return shim as unknown as DockviewPanelApi;
}

function paneBlock(kind: PaneKind, specOf = (ctx: BlockCtx): PaneSpec | string => specFromOptions(kind, ctx.options)): Block {
  const sample = { kind } as PaneSpec; // only for the generic title and icon of the kind
  return {
    type: paneBlockType(kind),
    title: kind[0].toUpperCase() + kind.slice(1),
    icon: kind === "plugin" || kind === "editor" ? "file-text" : paneIcon(sample),
    height: EMBED_HEIGHT,
    file: PANE_FILES[kind],
    tab: (ctx) => { const s = specOf(ctx); return typeof s === "string" ? null : s; },
    mount(host, ctx) {
      const spec = specOf(ctx);
      if (typeof spec === "string") { message(host, "view-error", spec); return; }
      host.classList.add("kandinsky-pane", `kandinsky-pane-${kind}`);
      ctx.setTitle(paneTitle(spec));
      let app: ReturnType<typeof mount> | undefined;
      let gone = false;
      (paneComponents[kind] as () => Promise<{ default: Component<PaneProps<PaneKind>> }>)().then(
        (m) => { if (!gone) app = mount(m.default, { target: host, props: { spec, panel: embedPanel(spec, host, ctx.setTitle) } as PaneProps<PaneKind> }); },
        (e) => message(host, "view-error", `Could not load the ${kind} block: ${errText(e)}`),
      );
      return () => { gone = true; if (app) void unmount(app); };
    },
  };
}
// the Calendar's start view is `mode:` (`view:` is a .page block's type); a fence's `view: month…` from before still reads
const calendarSpec = (c: BlockCtx) => specFromOptions("calendar", { ...c.options, view: c.options.mode ?? c.options.view });
for (const k of PANE_KINDS) if (k !== "block") registerBlock(k === "calendar" ? paneBlock(k, calendarSpec) : paneBlock(k));

// `calendar` named the Calendar pane for a while (now `calendar-pane`), so such blocks still open the pane: one with
// no row-view option and either a pane option (a start view, a day as `date`) or no note around it (a .page, a bookmark)
const ROW_VIEW_KEYS = ["from", "filters", "dated", "by", "columns", "args", "show", "tag", "path", "priority", "due", "completed", "started", "sort", "group", "limit"];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The block type `src` is drawn as, in document `doc` when it is known. */
export function drawnType(src: string, doc?: string): string {
  const type = blockType(src);
  if (type !== "calendar") return type;
  const o = parseOptions(src);
  const date = o.date === undefined ? undefined : String(o.date);
  if (ROW_VIEW_KEYS.some((k) => k in o) || (date !== undefined && !ISO_DAY.test(date))) return type; // `date:` a property
  const paneKey = ["month", "week", "agenda", "day"].includes(String(o.mode ?? o.view)) || date !== undefined;
  return paneKey || (doc !== undefined && !/\.(md|markdown)$/i.test(doc)) ? "calendar-pane" : type;
}

// --- content blocks: a note, some text, a database table — light, read in place ---------------------
const str = (v: unknown) => (typeof v === "string" ? v : "");
registerBlock({
  ...lazyBlock("note", "Note", () => import("../components/blocks/NoteBlock.svelte"), (c) => ({ path: str(c.options.path), section: str(c.options.section) })),
  icon: "file-text", card: true, file: /\.(md|markdown)$/i,
  tab: (c) => (str(c.options.path) ? { kind: "editor", path: str(c.options.path) } : null),
});
// the links to a file, as under a note ("Linked mentions"): the note it sits in, or `path` (a library's card)
registerBlock({ ...lazyBlock("backlinks", "Linked mentions", () => import("../components/Backlinks.svelte"), (c) => ({ path: str(c.options.path) || c.doc })), icon: "link", bare: true });
// `library` and `libraries` blocks written before the Libraries page became a plugin's pane: that pane (an old
// `library` at References), or the plugin's "switched off" where none gives it (libraries.svelte.ts)
for (const old of ["library", "libraries"]) {
  const at = (c: BlockCtx) => str(c.options.at) || (old === "library" ? "references" : undefined);
  registerBlock({ ...paneBlock("plugin", (c) => librariesSpec(at(c))), type: old, title: "Library", icon: "library" });
}
registerBlock({ ...lazyBlock("text", "Text", () => import("../components/blocks/NoteBlock.svelte"), (c) => ({ text: str(c.options.text), doc: c.doc })), icon: "edit", card: true });
// a Library entry with its PDF: the head of every reading note (`<citekey>.md`; docs/guides/ZOTERO.md)
registerBlock({
  ...lazyBlock("library.paper", "Paper (from the Library)", () => import("../components/blocks/PaperBlock.svelte"), (c) => ({ doc: c.doc, options: c.options, props: c.props })),
  icon: "library", card: true,
});
// `base` embedded is the table alone (the Base pane adds a header); as a tab it is the pane
registerBlock({
  ...lazyBlock("base", "Database", () => import("../components/BaseTable.svelte"), (c) => ({ path: str(c.options.path), view: str(c.options.table) || undefined, thisPath: c.doc, embedded: true })),
  icon: "table", card: true, file: /\.base$/i,
  tab: (c) => (str(c.options.path) ? { kind: "base", path: str(c.options.path), view: str(c.options.table) || undefined } : null),
});

// --- Nootion dashboard widgets (Page.svelte & ```view blocks in Markdown) -------------------------
registerBlock({
  ...lazyBlock("chart", "Chart", () => import("../components/widgets/ChartWidget.svelte"), (c) => ({ options: c.options, doc: c.doc })),
  icon: "chart", card: true,
  options: [
    { key: "path", label: "Source (.base or .csv)", kind: "text", hint: "vault path to a .base or .csv/.tsv file (blank: vault notes)" },
    { key: "view", label: "Base view", kind: "text", hint: "optional view name inside the .base" },
    { key: "chart", label: "Chart type", kind: "choice", choices: ["bar", "column", "donut", "line"], default: "bar" },
    { key: "group_by", label: "Group by", kind: "text", hint: "property or column name (e.g. status, priority, folder)" },
    { key: "metric", label: "Metric", kind: "choice", choices: ["count", "sum", "avg"], default: "count" },
    { key: "value_field", label: "Value column", kind: "text", when: { metric: ["sum", "avg"] }, hint: "numeric property for sum or average" },
    { key: "limit", label: "Max groups", kind: "number", default: 8 },
  ],
});
registerBlock({
  ...lazyBlock("progress", "Progress (year / month / goal)", () => import("../components/widgets/ProgressWidget.svelte"), (c) => ({ options: c.options, doc: c.doc, mode: "progress" })),
  icon: "sliders", card: true,
  options: [
    { key: "kind", label: "Show", kind: "choice", choices: ["time", "goal", "both"], default: "time" },
    { key: "label", label: "Goal label", kind: "text", hint: "optional goal name (e.g. Thesis chapters)" },
    { key: "property", label: "Frontmatter property", kind: "text", hint: "optional numeric property in this note to read/step" },
    { key: "current", label: "Current value", kind: "number", default: 0 },
    { key: "target", label: "Target value", kind: "number", default: 100 },
    { key: "unit", label: "Unit", kind: "text", hint: "%, pages, hrs…" },
  ],
});
registerBlock({
  ...lazyBlock("countdown", "Countdown (target date)", () => import("../components/widgets/ProgressWidget.svelte"), (c) => ({ options: c.options, doc: c.doc, mode: "countdown" })),
  icon: "flag", card: true,
  options: [
    { key: "label", label: "Event / milestone", kind: "text", default: "Milestone" },
    { key: "target_date", label: "Target date", kind: "text", hint: "YYYY-MM-DD (or YYYY-MM-DD HH:MM)" },
    { key: "start_date", label: "Start date", kind: "text", hint: "optional YYYY-MM-DD for elapsed progress bar" },
  ],
});
registerBlock({
  ...lazyBlock("pomodoro", "Pomodoro focus timer", () => import("../components/widgets/PomodoroWidget.svelte"), (c) => ({ options: c.options, doc: c.doc })),
  icon: "clock", card: true,
  options: [
    { key: "focus", label: "Focus minutes", kind: "number", default: 25 },
    { key: "short_break", label: "Short break minutes", kind: "number", default: 5 },
    { key: "long_break", label: "Long break minutes", kind: "number", default: 15 },
    { key: "goal_sessions", label: "Daily session target", kind: "number", default: 4 },
    { key: "sound", label: "Chime when done", kind: "toggle", default: true },
  ],
});
registerBlock({
  ...lazyBlock("habits", "Habit tracker", () => import("../components/widgets/HabitsWidget.svelte"), (c) => ({ options: c.options, doc: c.doc })),
  icon: "check", card: true,
  options: [
    { key: "path", label: "Habits Markdown file", kind: "text", default: "Habits.md", hint: "plain Markdown table in your vault (never localStorage)" },
    { key: "habits", label: "Default habits", kind: "list", hint: "comma-separated habit names used when creating the file" },
    { key: "days", label: "Days shown", kind: "number", default: 7 },
  ],
});
registerBlock({
  ...lazyBlock("clock", "Clock", () => import("../components/widgets/ClockWidget.svelte"), (c) => ({ options: c.options })),
  icon: "clock", card: true,
  options: [
    { key: "style", label: "Clock face", kind: "choice", choices: ["both", "digital", "analog"], default: "both" },
    { key: "format_24h", label: "24-hour time", kind: "toggle", default: true },
    { key: "seconds", label: "Show seconds", kind: "toggle", default: true },
    { key: "timezone", label: "Time zone", kind: "text", hint: "IANA zone like Europe/Paris or America/New_York (blank: local)" },
    { key: "label", label: "Caption", kind: "text" },
  ],
});
registerBlock({
  ...lazyBlock("weather", "Weather", () => import("../components/widgets/WeatherWidget.svelte"), (c) => ({ options: c.options })),
  icon: "sun", card: true,
  options: [
    { key: "city", label: "City", kind: "text", hint: "e.g. Zurich, Paris, Tokyo (blank or offline shows local daylight card)" },
    { key: "units", label: "Units", kind: "choice", choices: ["C", "F"], default: "C" },
    { key: "live_fetch", label: "Fetch live forecast when online", kind: "toggle", default: true },
  ],
});
registerBlock({
  ...lazyBlock("button", "Action button", () => import("../components/widgets/ActionButtonWidget.svelte"), (c) => ({ options: c.options, doc: c.doc, host: c.host })),
  icon: "plus", card: true,
  options: [
    { key: "label", label: "Button label", kind: "text", default: "New Note" },
    { key: "subtitle", label: "Subtitle / description", kind: "text", hint: "optional caption shown beside the button" },
    { key: "icon", label: "Icon glyph", kind: "text", hint: "e.g. +, ⚡, ✓, ●" },
    { key: "tone", label: "Button style", kind: "choice", choices: ["primary", "default", "green", "yellow", "red"], default: "primary" },
    { key: "action", label: "Action", kind: "choice", choices: ["create_note", "set_property", "toggle_property"], default: "create_note" },
    { key: "folder", label: "Target folder", kind: "text", when: { action: ["create_note"] }, hint: "vault folder for the new note (e.g. tasks)" },
    { key: "template", label: "Template", kind: "text", when: { action: ["create_note"] }, hint: "optional template name without .md" },
    { key: "title", label: "Note title pattern", kind: "text", when: { action: ["create_note"] }, hint: "supports {{date}}, {{this}}, or {{title}}" },
    { key: "base", label: "Target .base file", kind: "text", when: { action: ["set_property", "toggle_property"] }, hint: "blank: current note; or path/to/file.base to update matching rows" },
    { key: "view", label: "Base view", kind: "text", when: { action: ["set_property", "toggle_property"] }, hint: "optional view name inside the .base" },
    { key: "property", label: "Property key", kind: "text", when: { action: ["set_property", "toggle_property"] }, hint: "frontmatter key to set or toggle (e.g. status, done)" },
    { key: "value", label: "Property value", kind: "text", when: { action: ["set_property"] }, hint: "value to write (supports {{date}}, {{this}})" },
    { key: "preset_properties", label: "Preset properties (key=value)", kind: "text", hint: "comma-separated key=value pairs (e.g. status=To do, project=[[{{this}}]])" },
    { key: "prompt", label: "Ask with quick input form before running", kind: "toggle", default: false },
    { key: "prompt_fields", label: "Prompt form fields", kind: "text", hint: "comma-separated input keys (e.g. title, priority)" },
    { key: "open", label: "Open created note", kind: "toggle", when: { action: ["create_note"] }, default: true },
  ],
});
registerBlock({
  ...lazyBlock("notebook-preview", "Notebook preview (read-only)", () => import("../components/blocks/NotebookPreviewBlock.svelte"), (c) => ({ options: c.options, doc: c.doc })),
  icon: "sigma", card: true, file: /\.ipynb$/i,
  options: [
    { key: "path", label: "Notebook file", kind: "text", hint: "vault-relative .ipynb path (never executed on render)" },
    { key: "cells", label: "Cell range / indices", kind: "text", hint: "1-based index or range, e.g. 1-3 or 2, 5" },
    { key: "heading", label: "Markdown heading section", kind: "text", hint: "transclude cells under a matching notebook heading" },
    { key: "tag", label: "Cell tag", kind: "text", hint: "Jupyter metadata tag or # tag: name" },
    { key: "limit", label: "Max cells", kind: "number", default: 6 },
    { key: "show_input", label: "Show code input", kind: "toggle", default: true },
    { key: "show_output", label: "Show saved outputs", kind: "toggle", default: true },
  ],
});
registerBlock({
  ...lazyBlock("table-preview", "Table / TSV preview (read-only)", () => import("../components/blocks/TablePreviewBlock.svelte"), (c) => ({ options: c.options, doc: c.doc })),
  icon: "table", card: true, file: /\.(tsv|csv|dat)$/i,
  options: [
    { key: "path", label: "Table file", kind: "text", hint: "vault-relative .tsv, .csv or .dat file" },
    { key: "columns", label: "Columns", kind: "list", hint: "column names or 1-based indices (blank: all)" },
    { key: "slice", label: "Row slice", kind: "text", hint: "1-based range like 1-20" },
    { key: "limit", label: "Row limit", kind: "number", default: 25 },
    { key: "sort", label: "Sort column", kind: "text", hint: "e.g. energy asc or -gap" },
    { key: "format", label: "Number format", kind: "choice", choices: ["auto", "scientific", "fixed", "raw"], default: "auto" },
    { key: "precision", label: "Significant / decimal digits", kind: "number", default: 4 },
  ],
});
registerBlock({
  ...lazyBlock("properties-audit", "Properties schema audit", () => import("../components/widgets/PropertiesAuditWidget.svelte"), (c) => ({ options: c.options, doc: c.doc })),
  icon: "check", card: true,
  options: [
    { key: "strict", label: "Flag undeclared properties (strict)", kind: "toggle", default: false },
    { key: "path_prefix", label: "Folder prefix filter", kind: "text", hint: "optional folder prefix, e.g. notes/" },
  ],
});
registerBlock({
  ...lazyBlock("synced", "Synced block", () => import("../components/widgets/SyncedBlockEmbed.svelte"), (c) => ({ options: c.options, doc: c.doc })),
  icon: "link", card: false,
});
registerBlock({
  ...lazyBlock("embed", "Media / Web Embed", () => import("../components/widgets/EmbedBlock.svelte"), (c) => ({ options: c.options, doc: c.doc })),
  icon: "external-link", card: false,
});

// --- mounting -------------------------------------------------------------------------------------

function message(host: HTMLElement, cls: string, text: string): void {
  host.replaceChildren(Object.assign(document.createElement("p"), { className: cls, textContent: text }));
}

function parseOptions(src: string): Record<string, unknown> {
  try { const v = parseYaml(src); return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}; }
  catch { return {}; }
}

// the last rows of each row view (document + YAML): a remount (scrolling, re-render) draws at once; capped, as each
// edit of a block's YAML is a key of its own
const lastRows = new Map<string, { type: string; rows: ViewRow[] }>();
const ROWS_KEPT = 100;

/** A row view (list, table, calendar…): rows from the core, cached first, refreshed on file events. */
function mountRows(body: HTMLElement, doc: string, src: string): () => void {
  const key = `${doc}\n${src}`;
  let clean = () => {};
  let shown = ""; // what THIS element draws (the shared cache may be newer than it)
  const draw = (r: { type: string; rows: ViewRow[] }) => {
    shown = JSON.stringify(r);
    clean();
    body.replaceChildren();
    clean = renderView(body, { ...r, options: parseOptions(src), refresh: () => void load() });
  };
  const cached = lastRows.get(key);
  if (cached) draw(cached);
  const load = async () => {
    try {
      const r = await api.view(doc, src);
      const next = { type: r.kind, rows: r.rows };
      keepCapped(lastRows, key, next, ROWS_KEPT);
      if (JSON.stringify(next) !== shown) draw(next); // unchanged: keep the DOM
    } catch (e) { message(body, "view-error", errText(e)); }
  };
  void load();
  const off = reloadOnChange(() => void load(), { wait: 400, wants: (p) => p.endsWith(".md") || p.endsWith(".base"), host: () => body });
  return () => {
    off();
    clean();
  };
}

/** Draws one block (its YAML `src`, in the context of document `doc`) into `el`; returns the cleanup.
 *  A block is its own island: keys and clicks inside it never reach an editor around it. Embedded
 *  blocks get a quiet "open as tab" button; a block already in a tab does not. */
export function mountBlock(el: HTMLElement, doc: string, src: string, host: BlockHost = "note"): () => void {
  for (const ev of ["keydown", "keyup", "keypress", "beforeinput", "input", "mousedown", "paste", "cut", "copy"]) el.addEventListener(ev, (e) => e.stopPropagation());
  el.classList.add("kandinsky-block");
  const type = drawnType(src, doc);
  const body = document.createElement("div");
  body.className = "block-body";
  let title = "";
  const ctx: BlockCtx = { src, options: parseOptions(src), doc, host, setTitle: (t) => { title = t; }, props: () => docProps(doc, src) };
  const pop = host === "tab" || registry.get(type)?.bare ? null : popButton(() => open(blockTab(src, doc, title)));
  let cfgBar: Record<string, unknown> | undefined;
  let cfgSlot: HTMLDivElement | null = null;
  if (host !== "tab") {
    cfgSlot = document.createElement("div");
    cfgSlot.className = "block-cfg-slot";
  }
  el.replaceChildren(body, ...(cfgSlot ? [cfgSlot] : []), ...(pop ? [pop] : []));
  if (cfgSlot) {
    queueMicrotask(() => {
      // only a ```view fence that is itself the editor's rendered block: the bar rewrites the fence at that block's
      // place, so a block nested in an embed, a note block, columns or a callout would overwrite a different fence
      const own = el.matches(".view-block") && !!el.parentElement?.matches(".cm-rendered-block") && !!el.closest(".cm-editor");
      if (cfgSlot && own) {
        cfgBar = mount(WidgetConfigureBar, { target: cfgSlot, props: { blockEl: el, src } });
      } else {
        cfgSlot?.remove();
        cfgSlot = null;
      }
    });
  }

  let clean = () => {};
  const draw = () => {
    clean();
    clean = () => {};
    const b = registry.get(type);
    // a dotted type is a plugin's: wait for it to register, redraw when it re-registers (hot reload)
    if (!b && type.includes(".")) { el.classList.add("own"); message(body, "view-wait", `Waiting for the plugin that draws “${type}”…`); return; }
    if (!b) { el.classList.remove("own"); clean = mountRows(body, doc, src); return; }
    el.classList.add("own");
    el.classList.toggle("framed", !!b.height && host !== "tab");
    const h = Number(ctx.options.height) || b.height;
    body.style.height = h && host !== "tab" ? `${h}px` : host === "tab" && b.height ? "100%" : "";
    body.replaceChildren();
    body.className = "block-body";
    try { clean = b.mount(body, ctx) ?? (() => {}); } // a throwing block shows its error, never breaks the document
    catch (e) { message(body, "view-error", `${type}: ${errText(e)}`); }
  };
  draw();
  const off = onChange(type, draw);
  return () => {
    off();
    clean();
    if (cfgBar) void unmount(cfgBar);
    cfgSlot?.remove();
    cfgSlot = null;
  };
}

/** The tab a block opens as: its own pane when it has one (a PDF block → the PDF pane), else the
 *  block alone in a tab. */
export function blockTab(src: string, doc: string, title?: string): PaneSpec {
  const type = drawnType(src, doc);
  const b = registry.get(type);
  return b?.tab?.({ src, options: parseOptions(src), doc, host: "tab", setTitle() {}, props: () => docProps(doc, src) }) ?? { kind: "block", src, doc, title: title || b?.title || type };
}

/** A block finds itself in its note by its own YAML, and reads what that place knows. */
async function docProps(doc: string, src: string): Promise<Props> {
  if (!/\.(md|markdown)$/i.test(doc)) return {};
  try { const text = (await api.file(doc)).text; return scopeAt(text, lineOf(text, src)).props; }
  catch { return {}; }
}

function popButton(run: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "block-pop";
  b.title = "Open as a tab";
  b.setAttribute("aria-label", "Open this block as a tab");
  b.innerHTML = iconSvg("panel-right", 13);
  b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); run(); });
  return b;
}

/** Mounts every not-yet-mounted ```view block under `root` (a rendered piece of the note `doc`). → unmounts them,
 *  for the owner to call when that piece goes (a widget destroyed, a re-render). Not on `isConnected`: a hidden
 *  tab's DOM is detached (dockview `onlyWhenVisible`) and must come back with its views drawn. */
export function hydrateBlocks(root: HTMLElement, doc: string): () => void {
  const cleans: (() => void)[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(".view-block:not([data-mounted])")) {
    el.dataset.mounted = "1";
    const clean = mountBlock(el, doc, el.dataset.src ?? "");
    cleans.push(() => { clean(); delete el.dataset.mounted; });
  }
  hydrateFences(root, doc, (source) => docProps(doc, source), (clean) => cleans.push(clean)); // code fences a plugin draws (lib/fences.ts)
  return () => cleans.splice(0).forEach((c) => c());
}
