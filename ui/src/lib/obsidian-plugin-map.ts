// Maps Obsidian community plugin IDs (from `<vault>/.obsidian/plugins/`) to either:
// 1. A bundled Kandinsky plugin needed for active workflow parity (`kind: "plugin"`), or
// 2. An unnecessary Obsidian plugin (`kind: "unnecessary"`) that is already built into Kandinsky
//    or unused in the vault (hidden from the active list, with optional 1-click move to Trash).

export type ObsidianBridge =
  | { kind: "plugin"; targetId: string; summary: string; recommended?: boolean }
  | { kind: "unnecessary"; reason: "builtin" | "unused"; summary: string; settingsPage?: string };

export const OBSIDIAN_BRIDGE: Record<string, ObsidianBridge> = {
  // --- Needed plugins backed by bundled Kandinsky plugins (1-click install & enable) ---
  "templater-obsidian": {
    kind: "plugin",
    targetId: "templater",
    recommended: true,
    summary: "Covered by Kandinsky's Templater & Folder Templates plugin (templates/ rules, Alt+E insert template, <% tp.* %> variables).",
  },
  "dataview": {
    kind: "plugin",
    targetId: "dataview",
    recommended: true,
    summary: "Covered by Kandinsky's Dataview & DataviewJS plugin (renders TABLE, LIST, TASK and dv.* blocks live; .base tables also built in).",
  },
  "obsidian-latex-suite": {
    kind: "plugin",
    targetId: "snippets",
    recommended: true,
    summary: "Covered by Kandinsky's Snippets plugin (natively reads Obsidian LaTeX Suite snippet files plus built-in math shortcuts).",
  },
  "obsidian-paste-image-rename": {
    kind: "plugin",
    targetId: "paste-image-rename",
    recommended: true,
    summary: "Covered by Kandinsky's Paste Image Rename plugin (saves pasted/dropped images into attachments/ named after the note).",
  },
  "pseudocode-in-obs": {
    kind: "plugin",
    targetId: "pseudocode",
    recommended: true,
    summary: "Covered by Kandinsky's Pseudocode Algorithms plugin (renders ```pseudo and ```pseudocode LaTeX blocks with math).",
  },
  "tag-wrangler": {
    kind: "plugin",
    targetId: "tag-wrangler",
    recommended: true,
    summary: "Covered by Kandinsky's Tag Wrangler & Tactician plugin (hierarchical tag browser, filter, and bulk tag rename/merge).",
  },
  "tag-tactician": {
    kind: "plugin",
    targetId: "tag-wrangler",
    recommended: true,
    summary: "Covered by Kandinsky's Tag Wrangler & Tactician plugin (tag hierarchy, counts, and multi-note tag management).",
  },
  "folder-notes": {
    kind: "plugin",
    targetId: "folder-notes",
    recommended: true,
    summary: "Covered by Kandinsky's Folder Notes & Genkan plugin (opens/creates folder overview notes and renders folder card grids).",
  },
  "genkan": {
    kind: "plugin",
    targetId: "folder-notes",
    recommended: true,
    summary: "Covered by Kandinsky's Folder Notes & Genkan plugin (renders Genkan-style subfolder and child-note MOC cards).",
  },
  "obsidian-footnotes": {
    kind: "plugin",
    targetId: "footnotes",
    recommended: true,
    summary: "Covered by Kandinsky's Footnotes & FakeLink plugin (Alt+Shift+F numbered [^n] footnotes and hover previews).",
  },
  "fakelink": {
    kind: "plugin",
    targetId: "footnotes",
    recommended: true,
    summary: "Covered by Kandinsky's Footnotes & FakeLink plugin (highlights [placeholder] links and converts them to [[wikilinks]]).",
  },
  "external-attachments": {
    kind: "plugin",
    targetId: "external-files",
    recommended: true,
    summary: "Covered by Kandinsky's External Attachments & Embeds plugin (links and opens external files in your cloud folder).",
  },
  "external-file-embed-and-link": {
    kind: "plugin",
    targetId: "external-files",
    recommended: false,
    summary: "Covered by Kandinsky's External Attachments & Embeds plugin (embeds external file cards and opens them natively).",
  },
  "obsidian-pandoc": {
    kind: "plugin",
    targetId: "export",
    recommended: false,
    summary: "Covered by Kandinsky's Export plugin (built-in Typst PDF plus Pandoc / LaTeX export).",
  },
  "obsidian-enhancing-export": {
    kind: "plugin",
    targetId: "export",
    recommended: false,
    summary: "Covered by Kandinsky's Export plugin (PDF, Word, HTML, and LaTeX export).",
  },
  "calendar": {
    kind: "plugin",
    targetId: "today",
    recommended: false,
    summary: "Covered by Kandinsky's Today & Calendar plugins.",
  },
  "periodic-notes": {
    kind: "plugin",
    targetId: "today",
    recommended: false,
    summary: "Covered by Kandinsky's Today plugin and Home & Today daily logs.",
  },
  "better-word-count": {
    kind: "unnecessary",
    reason: "builtin",
    summary: "Live word and character count is built into the status bar.",
  },

  // --- Unnecessary: already built natively into Kandinsky core (8) ---
  "homepage": {
    kind: "unnecessary",
    reason: "builtin",
    settingsPage: "today",
    summary: "Already built into Kandinsky (Settings → Home & Today).",
  },
  "obsidian-zotero-desktop-connector": {
    kind: "unnecessary",
    reason: "builtin",
    settingsPage: "papers",
    summary: "Already built into Kandinsky (Library, refs.bib, Zotero Connector, PDFs, and \\cite / [[citekey]]).",
  },
  "pdf-plus": {
    kind: "unnecessary",
    reason: "builtin",
    settingsPage: "papers",
    summary: "Already built into Kandinsky (native PDF reader, pdf-marks highlights, and legacy PDF++ links).",
  },
  "text-finder": {
    kind: "unnecessary",
    reason: "builtin",
    settingsPage: "files",
    summary: "Already built into Kandinsky (Ctrl+F find, Ctrl+H replace, and Ctrl+Shift+F vault search).",
  },
  "quickadd": {
    kind: "unnecessary",
    reason: "builtin",
    settingsPage: "writing",
    summary: "Already built into Kandinsky (Super+C Quick Capture and built-in templates).",
  },
  "recent-files-obsidian": {
    kind: "unnecessary",
    reason: "builtin",
    settingsPage: "files",
    summary: "Already built into Kandinsky (Ctrl+O / Ctrl+P Quick Open recent files).",
  },
  "darlal-switcher-plus": {
    kind: "unnecessary",
    reason: "builtin",
    settingsPage: "keyboard",
    summary: "Already built into Kandinsky (Ctrl+P / Ctrl+O searches notes, headings, symbols, tabs, and commands).",
  },
  "surfing": {
    kind: "unnecessary",
    reason: "builtin",
    settingsPage: "web",
    summary: "Already built into Kandinsky (built-in web tabs and ad-blocked browsing windows).",
  },
  "obsidian-excalidraw-plugin": {
    kind: "unnecessary",
    reason: "builtin",
    settingsPage: "drawing",
    summary: "Already built into Kandinsky (Settings → Drawing).",
  },

  // --- Unnecessary: already covered by core features or optional extras (4) ---
  "obsidian-linter": {
    kind: "unnecessary",
    reason: "unused",
    summary: "Kandinsky keeps Markdown clean on save; formatting rules and frontmatter tools are built in.",
  },
  "obsidian-kanban": {
    kind: "unnecessary",
    reason: "unused",
    summary: "Built-in .base views include drag-and-drop Kanban boards without an extra plugin.",
  },
  "obsidian-icon-folder": {
    kind: "unnecessary",
    reason: "unused",
    summary: "Folder colors and custom note icons are built directly into the Pages sidebar.",
  },
  "auto-card-link": {
    kind: "unnecessary",
    reason: "unused",
    summary: "Link previews and rich bookmarks are built into Kandinsky notes without cardlink blocks.",
  },
};
