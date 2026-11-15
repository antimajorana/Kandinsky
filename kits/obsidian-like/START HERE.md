# Atlas, made more like Obsidian: start here

*Prepared 14 November 2026 for Atlas 0.2.10 and your vault "The Oracle".*

## Update: Atlas rebuilt from its source code (14 November 2026)

- **The flashing windows are fixed.** They were `git` checks Atlas runs in the background (whether or not the vault is a
  git project): on Windows each one briefly opened a terminal window. Before the fix, 30 seconds of Atlas on The Oracle
  opened 8 of them; the rebuilt Atlas ran the same checks with none. The fix covers every background program Atlas
  starts (git, PDF tools, language servers, vault commands).
- **Obsidian-style defaults in the program itself:** tabs in a row above each pane, and a note's properties shown at
  its top.
- The rebuilt program replaced `atlas-app.exe`; the original is kept beside it as `atlas-app.0.2.10-original.exe`
  (to go back: close Atlas, delete `atlas-app.exe`, rename the original back). Installing an official Atlas update
  will bring back the original behaviour until the fix is in Atlas itself.
- The source code with the changes is in `atlas-source` in the Atlas folder; Rust and Microsoft's C++ build tools are
  now installed to rebuild it.

- **Renamed Kandinsky, with its own icon** (later the same day): window titles, taskbar, tray, notifications, Settings
  and help texts, the capture box and the Start-menu entries now say Kandinsky.
- **Every Atlas file name in the app changed to Kandinsky** (evening update): the main program, capture box, command-line
  tool, saved backups, and source-code folders/files are now named `kandinsky-app.exe`, `kandinsky-capture.exe`,
  `kandinsky.exe`, and `kandinsky-source` (with your Start-menu, Taskbar, and Desktop shortcuts updated to match). Only
  each vault's hidden `.atlas` settings folder keeps its dot-folder name so your vaults and settings keep working without
  moving anything in The Oracle.
- **Full Obsidian Plugin & GitHub Plan added:** open `KANDINSKY-PLUGINS-PLAN.md` in this folder for the complete review
  of all 25 of your installed Obsidian plugins, Kandinsky's own Windows-ready plugins, similar open-source projects on
  GitHub, and a shortlist of plugins to choose from before finalizing.

The sections below were written before the rebuild; where they say the code could not be changed, read the update above.

## The short version

- **Atlas is open source** (licence AGPL-3.0, made by "alneb", home page github.com/Alneb/atlas). Only the finished
  program is on your computer, not its code, and the tool needed to rebuild it (Rust) is not installed. So I did not
  change Atlas's program itself. The last section says what changing the code would take.
- **Good news: most of the Obsidian feel is already a setting in Atlas.** A tab row above each pane, the file list in its
  own column, flat panes, properties at the top of the note, the file name as a title, your accent colour, your
  folders for new notes and templates. This kit switches those on for The Oracle, with one double-click, and can undo it.
- **Your Obsidian plugins do not run in Atlas** (Atlas has its own, different kind of plugins). But Atlas already has its
  own version of about two thirds of what your plugins do; the table below goes through them one by one.
- **The random windows:** I could not see them happen (I did not start Atlas), so I list the possible causes, most
  likely first, and made a small "window catcher" that writes down exactly which program opened a window and when.

## What is in this folder

| File | What it does |
|---|---|
| `Apply to The Oracle.cmd` | Double-click: copies the Obsidian-like settings and styling into The Oracle's `.atlas` folder. Your current Atlas settings are kept as a copy first. |
| `Undo.cmd` | Double-click: puts your previous settings back and switches the styling off. |
| `Catch stray windows.cmd` | Double-click, then use Atlas as usual: it writes down every program and window Atlas opens, for an hour. It changes nothing. |
| `copy-into-vault\.atlas\config.toml` | The settings themselves, each line explained in plain words. |
| `copy-into-vault\.atlas\snippets\obsidian-look.css` | Styling: hides the agent material (zAI, zMeta, AGENTS.md...) from Atlas's file list, as your Obsidian snippet "oracle-explorer" does. |

This folder sits inside Atlas's program folder, so an Atlas update or uninstall may delete it: copy it somewhere else
if you want to keep it. Obsidian ignores the `.atlas` folder, so none of this changes anything in Obsidian.

### What the settings change (and what Atlas does by default)

| Setting | Like Obsidian | Atlas's default |
|---|---|---|
| Tabs | a row of tabs above each pane | a vertical list of tabs on the left |
| Side panel (files, search, outline) | its own column on the left | its own column (unchanged) |
| Pane shape | flat, thin lines between panes | rounded floating cards |
| Properties | at the top of the note | hidden behind a "Properties" line |
| File name as a title | on | off |
| Accent colour | your `#889eea` | the colour scheme's own |
| Slash `/` menu | off (you had it off in Obsidian) | on |
| New notes go to | `inbox` | `notes` |
| Templates folder | `zMeta/Templates` + 6 of your 7 folder templates (books, papers, Journal...) | `templates` |
| Daily notes | `Journal`, from your `daily` template | `notes/log` |
| Excluded from search, graph and links | zMeta, .raw, .vault-meta, zAI, zArchive (your Obsidian list) | nothing |
| Closing the window | quits Atlas | Atlas keeps running in the tray |

Two differences the settings cannot remove:
- Atlas names daily notes `2026-11-14.md`; your Obsidian names them `14-11-2026.md`. Your Journal has no daily notes
  yet, so nothing clashes; if you will use both apps, switching Obsidian's daily-note format to `YYYY-MM-DD` keeps them
  on one file per day.
- Pasted pictures go next to the note (or a folder named relative to it), not to one `zAttachments` folder.

## Your Obsidian features, one by one

**In Atlas?** Yes = built in. Partly = there, but different or smaller. No = I found nothing like it.
"Not found" means I searched the text inside Atlas's program and its documentation and found nothing: that is a strong
sign it is missing, not a proof.

### Obsidian's own features (the ones you have switched on)

| Obsidian | In Atlas? | Notes |
|---|---|---|
| File explorer | Yes | Also shows other vaults, SSH hosts and servers beside the vault. Folders with their own note get a note icon. |
| Search | Yes | "Search in workspace" and "Replace in files". |
| Quick switcher | Yes | "Open file"; also "Find a tab" and "Go to a symbol". |
| Command palette | Yes | F1 (keys are listed and changeable in Settings > Keyboard). |
| Graph view | Yes | "Graph of notes". |
| Backlinks | Yes | "Linked mentions" under each note, plus "Unlinked mentions" with a Link button. |
| Outgoing links | Not found | No separate outgoing-links pane found. |
| Tags view | Partly | A tag can be renamed in every note at once (right-click it); a separate tag pane like Obsidian's was not found. |
| Properties | Yes | Hidden, at the top of the note, or in a side panel with one control per property. |
| Page preview | Yes | Rest the pointer on a link. |
| Outline | Yes | |
| Bookmarks | Yes | |
| Workspaces | Yes | "Workspace: save the current tabs as". |
| Daily notes | Yes | The Today page and a daily log; quick capture lands there. |
| Templates | Yes | Its own template language (`{{title}}`, `{{date:...}}`, `{{prompt:...}}`). |
| Footnotes | Yes | Shown in notes and insertable from the `/` menu. |
| Bases | Yes | Reads Obsidian's `.base` files (tables and cards). |
| Canvas | Partly | Atlas has drawings (Excalidraw) with an "infinite canvas" page; Obsidian's `.canvas` files were not found. |
| Web viewer | Partly | A web page opens as a tab when the site allows it, otherwise in a separate Atlas window. Atlas's README calls web tabs Linux-only for now, though this Windows version ships a helper for them. |
| Note composer | Not found | |
| Word count | Not found | |
| File recovery | Partly | Unsaved code files keep a recovery copy; deleted files go to `.atlas/trash/`. No snapshot history of notes found. |
| Sync | Partly | Not Obsidian Sync: Atlas has a Syncthing plugin, "mirrors" to a server, and live editing between devices. |

### Your community plugins (the 23 switched on)

| Plugin | In Atlas? | Notes |
|---|---|---|
| Templater | Partly | Atlas has its own template language and also understands the Templater tags your templates use (today's date, the note's title, the cursor), so they keep working. Templater scripts (`<%* ... %>`) never run: your MOC template starts with one, so the kit carries over your other 6 folder templates and leaves MOC notes plain (its Dataview list would not work in Atlas either). |
| Quick Switcher++ | Partly | Open file, Find a tab, Go to symbol, command palette; not every ++ mode. |
| Linter | No | Nothing that reformats notes found. |
| Tag Wrangler | Partly | Rename a tag in every note (right-click it). Merging and tag pages not found. |
| Folder notes | Partly | Built in: a folder with its own note shows a note icon in the file list; whether a click on the folder opens that note was not checked. |
| Recent Files | Yes | "History" of tabs visited, recently opened files, and the Activity card on Today. |
| Homepage | Yes | Atlas opens your Home page first (The Oracle already has one, `Home.page`). |
| Iconize | No | No icons for files or folders found. |
| QuickAdd | Partly | Quick capture (a pop-up in Atlas, a capture bar, and a capture box anywhere on Windows with Ctrl+Alt+Shift+C) and new notes from templates; QuickAdd's macros not found. |
| Paste image rename | No | |
| Dataview | Partly | Bases (tables and cards over your notes' properties) covers many of the same uses; Dataview's own query language not found. |
| Pseudocode | No | LaTeX maths, TikZ pictures and Mermaid diagrams are built in, but not pseudocode blocks. |
| Latex Suite | Yes | Built in, and it reads your Obsidian Latex Suite snippets directly. |
| Kanban | No | Only Mermaid's "kanban" diagram type, not Kanban boards. |
| fakelink | Partly | "Unlinked mentions" under each note, with a button to turn one into a link. |
| Footnote Shortcut | Partly | Footnotes show and can be inserted; jumping between them and tidying them not found. |
| Auto Card Link | No | |
| Surfing | Partly | Web pages as tabs (see Web viewer above). |
| Zotero Integration | Partly | Atlas has a References library: add papers by DOI or arXiv id, a `refs.bib` kept current, Zotero's browser button answered, `@key` citations, and a one-way import from Zotero. |
| PDF++ | Yes | PDF reader with highlights, underlines and ink kept in the PDF's note, export with marks, the paper's notes beside it. |
| External Attachments | Not found | Atlas can show other folders and servers in its file list, but embeds from outside the vault were not found. |
| Tag Tactician | No | |
| Text Finder | Partly | "Replace in files" across the vault, and a find / replace bar on code files; its options (regular expressions, case) not checked. |
| Genkan | Yes | The Today / Home page: greeting, capture, focus, tasks, daily log, activity, calendar. |

Atlas also has things Obsidian does not: terminals and AI-agent panes beside your notes, a code editor with language
servers, git changes and history, spreadsheets for CSV and Excel files, drawings, mail and calendars (as plugins).

## Atlas's own plugins

The Oracle now has two installed: **Calendar** and **OCR**. Built in: the **Library / References** page and the
**LaTeX** plugin.
Atlas's public catalogue (the list "Install a plugin" offers) has 32 plugins; **9 of them run on Windows today**:

| Plugin | | Plugin | |
|---|---|---|---|
| Calendar (CalDAV) | 1.5.2 | Claude | 0.7.1, beta |
| Email | 1.7.0 | Finance | 0.1.4, beta |
| SSH | 0.9.1 | OCR | 0.2.4, beta |
| Catalog | 0.9.0, beta | Syncthing | 0.2.0, beta |
| Catalog · Science | 0.6.0, beta | | |

The other 23 (Books, Manga, Weather, Today, Print, Export, Spelling, Snippets, Rnote, Kiwix, Downloader, more
catalogue sources...) are listed only for Linux and macOS for now.

## The random windows

What I could check: Atlas's own browsing history since 26 October shows only Atlas's own pages and one window per
session, never an outside web page. So the stray windows are probably **not** web pages popping up. The likely causes,
most likely first:

1. **The quick-capture box.** The Start-menu shortcut "Atlas Capture" has the key **Ctrl+Alt+Shift+C**, and Windows
   honours that key everywhere, even when Atlas is closed. If you, or another program, press that combination, the
   capture box opens. *To stop it:* Start menu, right-click "Atlas Capture", "Open file location", right-click the
   shortcut, Properties, set "Shortcut key" to None.
2. **Black windows that flash and vanish.** Atlas starts helper programs (its own command-line program, which is a
   console program; on Windows its plugins run commands through Git for Windows; language servers; the AI agent). When a
   program forgets to tell Windows to keep those hidden, each one flashes a black window. Atlas's README says the
   Windows version is "less tried". Not proven here: the window catcher will show it if this is it.
3. **A second Atlas window.** Atlas opens one window per vault (choosing a vault on the Welcome page or in the vault
   switcher starts another window), and "Open a folder as a guest" opens its own window. A web link to a site that
   refuses to be shown inside Atlas also opens a separate Atlas window. *If this is it:* Settings > Web > "Web links
   open in" > your browser.
4. **Atlas staying alive in the tray** after you close it (its default), with its notices and schedules. The kit sets
   "closing the window quits Atlas", as in Obsidian.

**To find out for sure:** double-click `Catch stray windows.cmd`, use Atlas until a stray window appears, then open
`stray-windows-log.txt` in this folder. Each line says which program started, what started it, its exact command and,
in green, what it most likely is. That log is also exactly what Atlas's developer needs in a bug report
(github.com/Alneb/atlas, "Issues").

## Changing Atlas's code later

What it takes:
1. **Get the code**: github.com/Alneb/atlas. The AGPL licence lets you change it; if you give your changed Atlas to
   others (or run it as a service for them), you must share your changed code too.
2. **Install Rust** (Node.js, the other tool it needs, is already on your computer) and build with the project's own
   instructions. Expect a long first build: Atlas uses several hundred code libraries.
3. **Where to start**, from what this study found:
   - make the Obsidian-like choices above Atlas's defaults (they are single values in Atlas's settings code);
   - add what is missing for you: Kanban boards, file icons, a note linter, pasted-image renaming, outgoing links,
     word count;
   - if the window catcher shows flashing console windows, the fix is to start those helper programs hidden (Windows
     has a "no window" option for exactly this).

Projects you mentioned, for ideas (ideas, not code to copy without checking its licence):
- **Opensidian** (github.com/jpzk/opensidian, GPL-3.0): built on the same base as Atlas (Rust and Tauri) and described by
  its authors as a "clean-room functional clone" of Obsidian's behaviour, so the closest model for Obsidian's look and
  feel. GPL-3.0 code may be combined into an AGPL-3.0 program like Atlas. A second, smaller project with the same name
  (markusbegerow/opensidian) is also Rust and Tauri, with wikilinks, backlinks, a graph and local AI chat.
- **CapsuleCraft** (github.com/kostyk348/CapsuleCraft, MIT): ideas for friendliness: eight complete themes, an accent
  colour and interface scale, a 12-step guided tour on first launch and a built-in FAQ.
- **Quartz** (github.com/jackyzha0/quartz): turns an Obsidian vault into a website; ideas for a clean reading view,
  link previews and the graph.
- **Shard**: I could not tell which project you meant (searching found "shardnote", a phone-friendly web view of an
  Obsidian vault, and a small "shard" notes app). A link would settle it.

## Still open

- The cause of the stray windows (the window catcher settles it).
- The styling file's way of finding rows in the file list was read from Atlas 0.2.10's code, not tried on a running
  Atlas. If the agent folders still show after applying, tell me and I will adjust it.
- Every feature marked "Not found" was searched for in Atlas's program text and documentation; a quick look in the
  running Atlas would confirm it.
