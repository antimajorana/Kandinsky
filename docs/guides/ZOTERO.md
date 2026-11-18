# Zotero → Kandinsky: sync, and saving from the browser

The Zotero library syncs with Zotero automatically, aims to replace it in every regard, and
integrates with the Obsidian side. Of Zotero's jobs the ones needed are: **save from the browser**, **annotate PDFs and
see the annotations in notes**, **cite while writing**. This page covers sync + browser saving; the Library screen and
its right panel (PDF preview, notes) are documented with the Library.

## 1. Lossless one-time Zotero migration (`kandinsky import-zotero` & Library wizard)

To retire Zotero + Better BibTeX + ZotMoov + Zoplicate completely on Windows, macOS, and Linux, `catalog-papers` includes a cross-platform SQLite importer accessible from **Library → References → Import from Zotero…** (`ui/src/components/ZoteroImportModal.svelte`), the Command Palette, or the CLI:

```sh
kandinsky --workspace . import-zotero
kandinsky --workspace . import-zotero --apply
```

- **Auto-discovery across OSes:** Finds Zotero profiles on Windows (`%APPDATA%\Zotero\Zotero\Profiles\*\prefs.js`), macOS (`~/Library/Application Support/Zotero/Profiles/*/prefs.js`), and Linux (`~/.zotero/zotero/*/prefs.js`), or accepts explicit CLI `--zotero` / `--base-attachments` overrides (helper parameters `data_dir` / `base_attachment_path`). Reads `extensions.zotero.dataDir`, `extensions.zotero.baseAttachmentPath`, `better-bibtex.sqlite` (when present), and ZotMoov preferences (`extensions.zotmoov.dst_dir` and subfolder rules).
- **Safe read-only SQLite access:** Opens `zotero.sqlite` read-only (`?mode=ro&immutable=1`) and falls back to a temporary snapshot copy if Zotero currently holds a write lock.
- **Zero-copy linked PDFs & Better BibTeX citekeys:** Preserves pinned Better BibTeX citation keys (from `better-bibtex.sqlite` or `Extra:` `Citation Key:`) before falling back to `author+year+word`. Resolves both `storage:<KEY>:file.pdf` and `attachments:` relative paths against `baseAttachmentPath`; when a linked PDF already lives inside a configured `external_pdf_roots` folder (such as `../Papers`), it is linked **in place with zero copying and zero OS hard-links or symlinks**.
- **Nested collections, notes, relations, and `itemAnnotations`:** Preserves `parentCollectionID` hierarchies (`Parent/Child`), converts HTML `itemNotes` into clean Markdown sections on `<citekey>.md`, maps `itemRelations` into `related:` wikilinks, and imports Zotero `itemAnnotations` (highlight, underline, strike, note, and image/area boxes with `annotationPageLabel`, `annotationColor`, `annotationText`, and `annotationComment`) directly into native `pdf-marks` blocks (`PdfMarksNote.svelte`).
- **Dry-run report first:** Reports total items, citekeys, linked vs copied PDFs, annotations, notes, collections, and warnings before writing any files.

Legacy incremental sync (`scripts/vault/zotero_sync.py`, workspace command `refs.sync-zotero`) remains available for Linux vaults that still run Zotero alongside Kandinsky.

## 1b. Shared zero-copy external PDF roots (`external_pdf_roots`) & annotation modes

When multiple vaults live on the same synced cloud drive (for example `../VaultA`, `../VaultB`, and shared `../Library/Papers` and `../Library/Books` pools), OS hard-links and symlinks break across machines or create cloud-sync conflict copies. Configure **Settings → Plugins → Catalog · Science** (`catalog-papers`):

| setting | default | meaning |
|---|---|---|
| `dir` | `refs/papers` | Vault folder holding `<citekey>/<citekey>.md` |
| `bib` | `refs/refs.bib` | Derived BibTeX file rewritten after every change (`@article`, `@book`, `@phdthesis`…) |
| `external_pdf_roots` | `[]` | Shared PDF folders outside the vault (e.g. `["../Library/Papers", "../Library/Books"]`), resolved safely via `external_roots.rs` without allowing arbitrary `..` traversal outside listed roots |
| `store_in_external` | `true` | When `external_pdf_roots` is non-empty, newly downloaded, dropped, and browser-captured PDFs are filed into `external_pdf_roots[0]` using `rename_format` instead of copied into the vault |
| `annotations_mode` | `"vault"` | `"vault"` keeps `pdf-marks` strictly per-vault inside `<citekey>.md`; `"shared_sidecar"` also syncs CRDT marks to `<pdf>.kandinsky-marks` (or `sidecar_dir`) |
| `sidecar_dir` | `""` | Optional folder for `.kandinsky-marks` sidecars when sharing annotations without writing beside shared PDFs |
| `watch_inbox` | `""` | ZotMoov-style drop folder (e.g. `../Papers/Sort`) scanned for unfiled PDFs |
| `rename_format` | `"{Author}{Year} - {Title}.pdf"` | Target filename pattern when filing PDFs into `external_pdf_roots[0]` |
| `subfolder_presets` | `[]` | Optional target subfolders inside `external_pdf_roots[0]` (e.g. `["Condensed Matter", "Quantum Info"]`) |
| `arxiv_source_dir` | `""` | Optional folder for unpacked arXiv LaTeX `.tar.gz` bundles (blank uses `.kandinsky/cache/arxiv-src/<id>/`) |

With `external_pdf_roots = ["../Library/Papers", "../Library/Books"]`, `<citekey>.md`, the Library PDF reader, `library.paper` embeds, thumbnails, full-text PDF search (`_ext/` cache), and `refs/refs.bib` (`file = {../Library/Papers/...}`) read the shared PDF directly in place. You can also export or import `.kandinsky-marks` sidecars on demand from any paper or book row in **Library → References**.

## 1c. External folder scanning (`scan-external-roots`), first-class Books, and daily workflows

From **Library → References** (`ui/src/components/PaperWorkflowsModal.svelte`), the Command Palette, CLI, or `catalog-papers` MCP tools:

- **Scan External Folders (`Scan folders` tab, `kandinsky scan-external-roots`, `catalog_papers_scan_external_roots`):** Recursively scans configured `external_pdf_roots` (such as `../Library/Papers` and `../Library/Books`) for `.pdf` files while ignoring non-PDF files (`.ipynb`, `.md`, data files). Extracts DOI / arXiv / ISBN / first-page metadata, classifies papers and `@book` entries, derives `collections` from nested subfolder paths, and detects moved PDFs by SHA-256 to update their `pdf` path and collection without creating duplicate notes. Keeps PDFs strictly in place (zero copies into the vault) and defaults to a safe dry-run preview (`dry_run: true`) with optional `--root`, `--rate-limit-ms`, and `--max-lookups` controls:

  ```sh
  kandinsky --workspace . scan-external-roots --max-lookups 25 --rate-limit-ms 250
  kandinsky --workspace . scan-external-roots --root ../Library/Books --apply
  ```

- **First-Class Books (`book` / `science_book` / `@book`) & Filtered Search:** Books added by ISBN (Open Library + Google Books), book DOI (Crossref / OpenAlex), long-PDF heuristics (>100 pages), or book external roots emit `@book{...}` entries in `refs/refs.bib` and appear under the **Books** filter tab (`book`, `science_book`, `bookSection`) alongside **Papers**, **Theses**, and **Notes** in **Library → References**. In `catalog-papers`, `[contributes.catalog]` `instead` routes catalog-captured books to `science_book`, and `catalog_papers_search_papers` accepts `item_type` (`"paper"`, `"book"`, `"thesis"`, or `"notes"`).
- **Universal Add / Search (`Add or search`):** Add or query papers and books by arXiv ID/URL (preserving exact `arXiv:XXXX.YYYYYvN` version provenance), DOI, ISBN, pasted BibTeX/RIS, Crossref, OpenAlex, Open Library, Google Books, or **INSPIRE-HEP** (`inspirehep.net/api/literature`, e.g. `author: Witten` or TeX keys).
- **Drop Inbox (`Drop inbox`, ZotMoov replacement):** Scans `watch_inbox` (such as `../Papers/Sort`), extracts first-page DOI / arXiv / ISBN / title+authors, fetches metadata, renames via `rename_format`, moves into `external_pdf_roots[0]` (or an optional `subfolder_presets` subfolder) without overwriting existing files, creates `<citekey>/<citekey>.md`, and updates `refs/refs.bib`.
- **Duplicate Review & Safe Merge (`Duplicates`, Zoplicate replacement):** Finds duplicates across normalized DOI, base arXiv ID (matching `arXiv:2401.12345v1` with `v2` or its published journal record), PDF SHA-256, ISBN-10/13, and fuzzy title + first author + year. Merging keeps the primary citekey, records secondary citekeys under `aliases:`, unions `tags`, `collections`, `sources`, reading notes, and `pdf-marks`, optionally rewrites `[[old_citekey]]` and `\cite{old_citekey}` across the vault (`POST /api/refs/relink`), and regenerates `refs/refs.bib`.
- **Preprint upgrade & arXiv LaTeX source:** On any arXiv paper, **Check published** (`upgrade_preprint`) checks Crossref / INSPIRE-HEP / arXiv for a published journal DOI and upgrades metadata while keeping exact `eprint` / `archivePrefix` provenance; **arXiv LaTeX** (`fetch_arxiv_source`) downloads and safely unpacks the `.tar.gz` bundle from `export.arxiv.org/e-print/<id>` into `arxiv_source_dir/<id>/` so formulas and macros can be inspected locally.
- **Bookmarklet / URI capture fallback:** When a browser cannot run the Zotero Connector extension, `kandinsky://capture-paper?url=https://example.org/paper&doi=10.1000/xyz123` (or `kandinsky capture-paper <id-or-url>`) files the paper directly into the active vault. The link works with the Windows installer and the macOS app, which register the scheme (`plugins.deep-link` in `crates/kandinsky-app/tauri.conf.json`). On Linux it does not yet: the deb/rpm entry starts Kandinsky without the URL (no `%u`), and the AppImage, the Flatpak and `packaging/install.sh` do not register the scheme; nor does a dev or portable run. There, use `kandinsky capture-paper` (docs/guides/DEVELOPING.md, "What a desktop package carries").

## 2. Saving from the browser (`crates/kandinsky-core/src/connector.rs`)
Kandinsky speaks the **Zotero Connector protocol** (API v3), read from Zotero 10's own `server_connector.js` and
`saveSession.js` (inside its `app/omni.ja`), so the official Zotero browser extension — with its hundreds of
site translators — saves into the Kandinsky Library whenever Zotero itself is closed:

| endpoint | what Kandinsky does |
|---|---|
| `GET/POST /connector/ping` | "running", with the prefs the extension reads (`supportsAttachmentUpload: true` → it uploads PDFs itself, with the browser's cookies, so paywalled PDFs work) |
| `/connector/getSelectedCollection` | "Kandinsky Library" + the Library's collections as targets (`L1`, `C<n>`) |
| `/connector/saveItems` | each translated item → `refs/papers/<citekey>/info.yaml` (Zotero field names, creators as "Last, First", tags), notes → the reading note `<citekey>.md` (section 4); the same DOI reuses the existing entry; `refs.bib` rewritten; the Library refreshes (fs event) |
| `/connector/saveAttachment` | the PDF (body) for an item of the session (`X-Metadata`: sessionID, parentItemID) → `<citekey>.pdf` in the entry, added to `files` |
| `/connector/saveSnapshot`, `/saveSingleFile` | a page without a translator → a `webpage` entry; its HTML snapshot saved beside it |
| `/connector/updateSession` | the popup after saving: collection, tags, note → applied to the session's entries |
| `hasAttachmentResolvers`, `getClientHostnames`, `proxies`, `delaySync` | inert answers |

- **Guard (Zotero's own rule):** a request from a browser must carry `X-Zotero-Connector-API-Version` (or
  `Zotero-Allowed-Request`); a web page cannot add that header cross-origin without a CORS preflight, which is never
  granted — so pages cannot write into the Library. Only 127.0.0.1.
- **Port 23119, shared politely:** if Zotero (or another Kandinsky) holds it, Kandinsky says so once and retries every
  minute; with Zotero open, the extension keeps saving to Zotero (and the sync brings those items over).
- **Off by default** (`[refs] connector = false`): only the workspace you browse for should take the port — test
  and audit servers must never catch your saves. A research vault turns it on. `KANDINSKY_CONNECTOR_PORT` overrides the port.
- Checked: unit tests (guard; save → yaml/notes/bib; PDF upload; popup update; DOI dedupe) and a live server driven
  with curl (ping prefs, 403 for a page, 201 save → entry + refs.bib). Not yet seen with the real extension in a
  real browser — the first real save is that test.

## 3. Cite while writing
Already there: `@` / `\cite{` completion from the Library, `refs.bib` regenerated on every change
(now also after every sync and browser save).

## 4. The reading note: `<citekey>.md`, with the paper and its PDF on top
A paper's note shows a view from the plugin with the PDF embedded and the rest of the information, along with a place to write notes. Every note being called `notes.md` was bad for wikilinks. So a paper's note is **`<paper folder>/<citekey>.md`** — `refs/papers/maier2005quantum/maier2005quantum.md` — and `[[maier2005quantum]]` is unique and the same name as the citation `[@maier2005quantum]`.

**Made on first use, by one function** (the core's generic companion note, `crates/kandinsky-core/src/companion.rs`, `POST /api/companion`, asked by the catalog-papers plugin's `note` method with the paper's properties — the core knows nothing of references): a citation chip's click, the Library's *Notes* / *Read* (and its `n` / `r` keys), *Paper: its notes beside the PDF* (Ctrl+Alt+L), the browser connector (Zotero notes and the popup's note are appended), and *To notes* in the PDF pane (the UI asks for the note before the export runs, so the export lands under the head). An existing note is only found, never rewritten. A new note is:

````markdown
---
type: literature
citekey: maier2005quantum
title: Quantum cluster theories
authors:
  - Maier, Thomas
  - Jarrell, Mark
year: 2005
source: https://doi.org/10.1103/RevModPhys.77.1027
created: 2026-10-14
---
# Quantum cluster theories

```view
type: library.paper
```

### Every paper has its note

Everything is a file and everything can be linked — papers in the library included. A note was made only when a paper was first opened, so on a real vault 40 of 54 papers had none and `[[citekey]]` led nowhere. `reading_note::ensure_all` makes the missing ones (the same `ensure`, the vault's `literature` template, existing notes never touched) and **`kandinsky paper-notes`** runs it from the command line; it was run once on that vault (40 notes made, from its template: `type: Literature`, `status: [[to-read]]`). The vault's Zotero sync command should end with `&& kandinsky paper-notes` so a paper synced from Zotero gets its note at once — **to add after the next install** (the installed `kandinsky` does not know the command yet, and the scheduled sync would fail every 10 minutes). Test: `every_paper_gets_its_note_and_a_written_one_is_left_alone`.

## Notes
````

- **The vault's template shapes it.** When `<[notes] templates>/literature.md` exists (for example: `type / created / source / authors / year / up`, then *What it says*, *What I think*, *Quotes and pages*), the note is that template filled in (`{{title}}`, `{{date}}`, Templater tags): the paper's properties go into the keys the template leaves empty, the missing ones (`citekey`, `title`) are added after them, values the template sets itself are kept, and the block goes under the template's `# ` title. The template's sections then replace `## Notes`. No template: the built-in shape above. `source` is the DOI link, else the arXiv page, else the entry's `url`.
- **The block** `library.paper` (`ui/src/components/blocks/PaperBlock.svelte`, registered in `lib/blocks.ts`): kind and year, the title (with its `<i>`/`$…$`), authors, venue, DOI / arXiv / URL links, collections and tags, the abstract (folded), buttons (copy the citekey, open the PDF in a tab, the Library, `info.yaml`), and **the PDF embedded** — the PDF block itself (`mountBlock` with `type: pdf`), so it is the same viewer as a tab, annotations and Ctrl+S included. Options: `key:` (which paper; default the note's `citekey` property, else the paper whose folder holds the note — so the block works in any note), `hide_pdf: true`, `pdf_height:` (760). While the Library is switched off (`[plugins] off`) the block says so.
- **The old name is migrated on first use.** A paper with a `notes.md` and no `<citekey>.md`: the first ask renames it — byte for byte when it already has a frontmatter; otherwise the head (properties, title, block) is put above its text, which stays as it was; an empty one counts as none. The Library's *notes* flag counts either name. So old vaults need nothing done; a real vault's 14 were migrated through this same function.
- **The scripts** (`scripts/vault/zotero_sync.py`, `scripts/vault/pdf_annotations.py`) follow the same rule through `scripts/vault/reading_note.py` — the one second copy, because they run without Kandinsky. It does not read the template: a script makes a note only for a paper that has none yet (a new Zotero item with notes, an export run from a terminal), with the built-in head. Keep the two in step; tests on both sides (`reading_note::tests`, `scripts/vault/tests/`).


## Reading a paper, citing it, linking into it

- **Read** (the Library) opens the PDF alone (it used to open the note too, in another tab). The PDF's bar has **Note**: the paper's note (`<citekey>.md`) beside it (also Ctrl+Alt+L). **Highlights → note** (was "To notes") writes the highlights and their comments into that same note: one note per paper.
- **Citing is linking** (docs/PHILOSOPHY.md): a paper is cited as `[[citekey]]`, a link to its note. Typing `[[` finds papers by author, year or title words as well as by file name (`[[georges dmft` → `georges1996dynamical`, "Georges et al. 1996", the title on hover). The `@key` completion that wrote `[@key]` was removed (citing is linking); `[@key]` already in notes still draws as before. `\cite{` keeps completing citekeys in `.tex` files.
- **Places in a PDF, the Obsidian way**: `[[paper.pdf#page=3]]` opens page 3; `[[paper.pdf#page=3&selection=12,4,15,20|the words]]` (PDF++'s form: first and last text pieces of the page's text layer, offsets in them) opens the page and selects the passage. The PDF's **Copy link** button copies a link to the page in front — or, with text selected, to that passage, labelled with its words — ready to paste in a note (`lib/pdf-place.ts`).
- More in the PDF's bar: **Rotate**, **Two pages** (side by side), and the zoom label switches between fit width and the whole page.

## The browser's Zotero button saves more than papers

Kandinsky answers the Zotero Connector (connector.rs). A scholarly item (article, preprint, thesis, book, report…) is
filed in the papers library as before. An item Zotero types as something else — a web page, a film, a video or audio
recording, a podcast, a blog or forum post, a broadcast, an artwork, a program — is a **capture** instead: a line in
today's log with its title and address, then the capture hooks, so the catalog files it as what it is (a film in
Films, an album in Music, a page as a web clip). Its snapshot, if the connector sends one, is taken and dropped (the
catalog reads the page itself). Test: `a_film_from_the_browser_is_captured_for_the_catalog_not_filed_as_a_reference`.
