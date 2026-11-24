# Obsidian and Notion compatibility

Kandinsky is a file-based workspace. This table describes how common workflows translate and where the formats or services differ.

| Workflow | What Kandinsky supports | Limits |
| --- | --- | --- |
| Obsidian vaults | Open the same folder and edit Markdown, including wikilinks, callouts, properties, and task fields. Search and backlinks use the vault’s files. | Rendering and extension behavior can differ. [Markdown rendering](MD-RENDERING.md) · [Tasks](TASKS.md) |
| Obsidian extensions | Inspect Obsidian plugins and install Kandinsky equivalents for selected plugins. | Community plugins generally need a Kandinsky equivalent or a port to its plugin API. [Plugins](PLUGINS.md) |
| Notion pages and databases | Import Markdown and CSV exports. Imports rewrite internal links and turn exported database rows into notes and Bases. Compose pages from blocks and view notes in tables, lists, boards, cards, calendars, or timelines. | Exports carry a snapshot of the data. Rebuild formulas, relations, and automations where they depend on Notion’s own database model. [Import test](../../crates/kandinsky-core/src/importers/notion.rs) · [Bases](#bases-and-automations) |
| Collaboration | Edit a note live from connected windows, leave comments, and self-host a vault with sign-in. | The server controls access to vaults. Notion-style sharing permissions for individual pages and managed team workspaces are outside that model. [Live editing test](../../ui/tests/note-live.spec.ts) · [Server](SERVER.md) |
| Offline sync | Work on a local copy and use a vault mirror to coordinate writes. Compatible offline edits can merge. | Overlapping offline changes can leave a conflict copy for review. [Merge implementation](../../crates/kandinsky-core/src/sync_merge.rs) |
| Files and attachments | Open common file types alongside notes. Existing Excel workbooks open read-only. CSV and TSV are editable, and you can export a new workbook. | Companion notes and editing features depend on the file type. [Table tests](../../ui/tests/table-sheet.spec.ts) |
| Devices and integrations | Use the desktop, Android, or a browser connected to your server. Plugins declare which platforms they support. | Platform and plugin maturity varies. Some integrations need their own accounts or services. [Android](ANDROID.md) · [Plugin maturity](PLUGIN-MATURITY.md) |

## Bases and automations

To create a row, select **New**, enter a title, and choose a Markdown template or a blank note. Template questions appear in the same form. Each view can save a default template, and its filters supply the row’s initial property values. Bulk editing, per-Base property validation, and a visual editor for template rules remain open.

Bases has filters, sorting, groups, formulas, linked-note relations, and rollups. Rules run when a note is created, when a property changes, or when you select **Run on row** in **Automations**. You can set properties on the triggering row, append to the daily note, create a row in another Base with an optional link back, or update rows linked through a relation. Rules run their actions in order. The 50 most recent runs for each Base show which files changed and where a run stopped. Recurring templates can create notes on a daily, weekly, or monthly cadence. [Automation implementation](DEVELOPING.md#bases-automations)

Automatic rules fire on writes through Kandinsky. External file writes and dedicated webhook triggers remain unsupported. Authenticated integrations can run manual rules through the API. Notion formula expressions and automation definitions need to be translated when migrating.
