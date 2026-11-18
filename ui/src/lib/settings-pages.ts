// Settings categories: organized into 7 clear human-centered pages with server/plumbing tucked under Advanced.
import type { IconName } from "./panes";
import { keyText } from "./keys";
import type { BuiltinId } from "./builtin-plugins";

export type PageId =
  | "appearance"
  | "writing"
  | "calendar"
  | "files"
  | "papers"
  | "keyboard"
  | "plugins";

export type Panel =
  | "overview" | "device" | "preview" | "apps" | "snippets" | "keys" | "plugins"
  | "scripts" | "drafts" | "openwith" | "capturekey" | "server" | "agents" | "templates" | "file";

export type Group = "workspace" | "extensions";
export const GROUPS: { id: Group; title: string }[] = [
  { id: "workspace", title: "Workspace" },
  { id: "extensions", title: "Extensions" },
];

export interface NextRung {
  label: string;
  why: string;
  run: string;
}

export interface PageDef {
  id: PageId;
  title: string;
  group: Group;
  icon: IconName;
  blurb: string;
  fields: string[];
  advancedFields?: string[];
  features: string[];
  panels?: Panel[];
  next?: NextRung[];
  only?: SettingsHost[];
  plugin?: BuiltinId;
}

export type SettingsHost = "app" | "bridged" | "phone" | "browser";
export function hostOf(where: { server: boolean; phone: boolean; path: string }): SettingsHost {
  if (where.phone) return "phone";
  if (where.path.startsWith("/remote/")) return "bridged";
  return where.server ? "browser" : "app";
}

export const PAGES: PageDef[] = [
  {
    id: "appearance",
    title: "Appearance",
    group: "workspace",
    icon: "sun",
    blurb: keyText("Theme, accent palette, typography, reading measure, and optional Obsidian community themes."),
    fields: [
      "ui.theme", "ui.palette", "ui.palette_dark", "ui.contrast", "ui.shape", "ui.accent",
      "ui.font_size", "ui.ui_font", "ui.motion", "ui.notices", "ui.obsidian_theme",
      "editor.prose_font", "editor.prose_font_size", "editor.prose_line_height", "editor.prose_width",
      "editor.code_font", "editor.code_font_size", "editor.inline_title",
    ],
    advancedFields: ["ui.eink", "ui.eink_refresh", "ui.gpu_rendering", "ui.tabs", "ui.side_panel", "ui.restore_layout", "ui.tab_preview", "ui.tab_switcher", "ui.sleep_after_min", "ui.awake_tabs"],
    features: ["ui.theme", "ui.zoomIn", "ui.zoomOut", "ui.zoomReset", "ui.resetLayout"],
    panels: ["device", "preview", "snippets"],
    next: [{ label: "Custom CSS snippet", why: "Restyle any element in .kandinsky/snippets/.", run: "settings.newSnippet" }],
  },
  {
    id: "writing",
    title: "Editor & Writing",
    group: "workspace",
    icon: "edit",
    blurb: "Markdown writing behavior, links, citations, properties, templates, math preview, and focus mode.",
    fields: [
      "vim", "editor.vim_keys", "editor.format_bar", "editor.math_preview", "editor.link_preview",
      "editor.task_chips", "editor.task_suggest", "editor.task_short_forms",
      "editor.properties", "editor.properties_spec", "editor.link_completion", "editor.citation_completion",
      "editor.slash_menu", "editor.fold_headings", "editor.typewriter", "editor.live",
      "editor.backlinks", "editor.attachment_folder", "editor.date_names", "editor.strict_line_breaks",
      "editor.autosave_code", "editor.code_bar", "editor.git_gutter", "editor.line_numbers",
      "editor.wrap_code", "editor.indent_guides", "editor.minimap", "editor.breadcrumbs",
      "notes.*",
    ],
    features: ["ui.vim", "ui.new", "ui.note.new", "ui.outline", "ui.graph"],
    panels: ["templates"],
  },
  {
    id: "calendar",
    title: "Calendar & Daily Notes",
    group: "workspace",
    icon: "calendar",
    blurb: "Week start, default calendar view, standalone events folder, local ICS feeds, reminders, and Daily Note templates.",
    fields: [
      "calendar.*", "home", "focus", "log_dir", "log_folders", "log_template",
      "notifications.calendar_reminders",
    ],
    advancedFields: ["activity.*"],
    features: ["ui.calendar", "ui.today", "ui.capture", "ui.focusFile"],
    next: [{ label: "Edit Home layout", why: "Rearrange blocks and columns on your Home dashboard.", run: "settings.editHome" }],
  },
  {
    id: "files",
    title: "Files & Search",
    group: "workspace",
    icon: "files",
    blurb: "Folders, excluded paths, search indexing, web links, and default file openers.",
    fields: ["ignore", "editor.index_exclude", "files.*", "web.*"],
    features: ["ui.files", "ui.explorer", "ui.quickOpen", "ui.search", "ui.vault"],
    panels: ["openwith"],
  },
  {
    id: "papers",
    title: "References & PDF",
    group: "workspace",
    icon: "library",
    blurb: "PDF viewer preferences, handwriting/drawing canvas options, and academic LaTeX helpers.",
    fields: ["pdf.*", "draw.*", "latex.*"],
    features: ["ui.library", "ui.drawing"],
  },
  {
    id: "keyboard",
    title: "Keyboard Shortcuts",
    group: "workspace",
    icon: "command",
    blurb: "Customize shortcuts across the workspace and Quick Capture global hotkey.",
    fields: [],
    features: ["ui.commands"],
    panels: ["keys", "capturekey"],
  },
  {
    id: "plugins",
    title: "Extensions",
    group: "extensions",
    icon: "plugin",
    blurb: "Manage active workspace extensions, browse optional integrations, and review trusted external binaries.",
    fields: [],
    advancedFields: ["desktop.*", "terminal.*", "automation.*", "lsp.*", "notifications.*"],
    features: ["ui.commands"],
    panels: ["plugins", "apps", "server", "agents", "scripts", "drafts", "file"],
  },
];

export const HIDDEN = new Set([
  "ui.css_snippets_off", "ui.apps_order", "ui.apps_hidden", "ui.libraries", "plugins.off", "files.open_with",
  "plugins.oidc_issuer", "plugins.oidc_client_id", "plugins.oidc_redirect",
  "latex.snippets", "latex.snippets_file", "latex.variables_file",
]);

export interface Placed {
  page: string;
  title: string;
  group: Group;
  icon: IconName;
  blurb: string;
  fields: string[];
  advancedFields: string[];
  plugin?: BuiltinId;
}

export function placeFields(leaves: string[], host: SettingsHost = "app"): Placed[] {
  const shown = PAGES.filter((p) => !p.only || p.only.includes(host));
  const placed: Placed[] = shown.map((p) => ({
    page: p.id,
    title: p.title,
    group: p.group,
    icon: p.icon,
    blurb: p.blurb,
    fields: [],
    advancedFields: [],
    plugin: p.plugin,
  }));
  const byId = new Map(placed.map((p) => [p.page, p]));
  const taken = new Set<string>();

  const claim = (list: string[], specs: string[] | undefined) => {
    for (const f of specs ?? []) {
      if (f.endsWith(".*")) {
        const pre = f.slice(0, -1);
        for (const l of leaves) {
          if (l.startsWith(pre) && !taken.has(l) && !HIDDEN.has(l) && !(specs ?? []).includes(l)) {
            list.push(l);
            taken.add(l);
          }
        }
      } else if (leaves.includes(f) && !taken.has(f) && !HIDDEN.has(f)) {
        list.push(f);
        taken.add(f);
      }
    }
  };

  for (const def of shown) {
    const out = byId.get(def.id)!;
    claim(out.fields, def.fields);
    claim(out.advancedFields, def.advancedFields);
  }
  const extPage = byId.get("plugins");
  for (const l of leaves) {
    if (taken.has(l) || HIDDEN.has(l)) continue;
    extPage?.advancedFields.push(l);
    taken.add(l);
  }
  return placed;
}

export const pageDef = (id: string) => PAGES.find((p) => p.id === id);

/** Earlier page ids, mapped to the page that now holds their fields, so saved links and blocks still open. */
export const PAGE_ALIASES: Record<string, PageId> = {
  overview: "appearance",
  today: "calendar",
  editor: "writing",
  code: "writing",
  shortcuts: "keyboard",
  web: "files",
  draw: "papers",
  drawing: "papers",
  latex: "papers",
  extensions: "plugins",
  terminal: "plugins",
  desktop: "plugins",
  automation: "plugins",
  server: "plugins",
  agents: "plugins",
  // its fields are split now; the settings-file panel it was known for is on Extensions
  advanced: "plugins",
};
/** The current page for `id`; ids that are not aliases (current pages, `plugin:…`, `accounts`) pass through. */
export const canonicalPage = (id: string): string => PAGE_ALIASES[id] ?? id;
export type StringKind = "colour" | "folder" | "file" | "plain";
export function stringKind(path: string): StringKind {
  const key = path.split(".").pop() ?? "";
  if (/(^|_)(accent|colou?r)$/.test(key)) return "colour";
  if (/(^|_)(dir|folder)$/.test(key)) return "folder";
  if (/(^|_)(file|home|focus|bib|path|spec)$/.test(key)) return "file";
  return "plain";
}
