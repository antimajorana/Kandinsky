# Catalog · Science (References)

The references library: papers, books (`book` / `science_book` / `@book`), theses and lecture notes as one folder each, with their metadata, the
open-access PDF, a `refs.bib` kept up to date, shared external PDF pools (`external_pdf_roots`) with in-place folder scanning (`scan_external_roots`), lossless Zotero import,
inbox organization, Zoplicate-style deduplication, preprint journal upgrades, arXiv LaTeX source unpacking, and an
answer to the Zotero browser extension. Its helper serves the **References** tab of the Libraries page (including **Papers**, **Books**, **Theses**, and **Notes** filter tabs), the PDF
reader's paper actions, and the catalog's source for `paper` and `science_book`.

## What it adds

- **Universal Add & First-Class Books**: DOIs (`doi:` or `doi.org` links), arXiv IDs and URLs (preserving explicit `vN` revision provenance
  in `arxivVersion` and `archiveID`), ISBNs (Open Library + Google Books) and book DOIs (Crossref / OpenAlex), INSPIRE-HEP URLs, pasted **BibTeX**
  (preserving the entry's citekey when free), pasted **RIS**, and direct links to PDFs. Books are filed as first-class `@book` entries (`book` / `science_book`) shown under the **Books** tab in **Library → References** (and `[contributes.catalog]` `instead` routes catalog-captured books to `science_book`).
- **A PDF without identifiers** (lecture notes, a thesis, an old paper, or a >100-page book) is read on its first pages for title, authors,
  year, DOI, arXiv ID, or ISBN, matched against Crossref when an exact work exists, or filed cleanly from its page/filename metadata.
- **Zero-copy shared external PDF folders (`external_pdf_roots`)**: configure one or more shared pools such as `../Library/Papers` and `../Library/Books` so
  multiple vaults reference and read the same PDFs in place with zero copying and zero OS symlinks or hard-links.
  Path traversal (`..`) and symlink escapes out of configured roots are strictly rejected. When `store_in_external` is
  on, downloaded, dropped, and browser-captured PDFs are filed into the primary external folder using `rename_format`
  (`{Author}{Year} - {Title}.pdf`) with collision-free `- 2.pdf` naming (reusing exact SHA-256 matches without
  duplicating bytes).
- **In-place External Folder Scanner (`scan_external_roots`, `kandinsky scan-external-roots`, **Scan folders** modal tab)**: recursively scans configured `external_pdf_roots` for `.pdf` files (ignoring non-PDF files such as `.ipynb` or `.md`), extracts identifiers and first-page metadata, classifies `@book` entries vs papers, derives `collections` from nested subfolders, detects moved PDFs by SHA-256 (updating their `pdf` path and derived collection without duplicating notes), and previews changes safely (`dry_run = true` by default) with optional `root` filtering and `rate_limit_ms` / `max_lookups` controls before writing `<citekey>.md` notes and `refs/refs.bib`.
- **Lossless Zotero 6/7/8 + Better BibTeX + ZotMoov Importer (`discover_zotero`, `import_zotero`)**:
  discovers `prefs.js` across Windows (`%APPDATA%\Zotero\Zotero\Profiles\*\prefs.js`), macOS, and Linux; opens
  `zotero.sqlite` strictly read-only (with automatic temporary `-wal`/`-shm` snapshot fallback + `PRAGMA quick_check`
  when Zotero is open); skips `deletedItems`; preserves pinned Better BibTeX citekeys (`Extra` and
  `better-bibtex.sqlite`); builds full `Parent/Child` collection paths; links `attachments:` PDFs in place with zero
  copying when inside `external_pdf_roots` or the vault; converts HTML `itemNotes` to Markdown blocks; maps
  `itemRelations` to `related: ["[[citekey]]"]`; and imports `itemAnnotations` (highlights, underlines, strikes,
  comments, sticky notes, image/area clips) as deterministic, idempotent `pdf-marks` blocks.
- **Watched PDF Inbox (`watch_inbox`, `scan_inbox`, `organize_inbox`)**: ZotMoov-style staging folder (for example
  `../Papers/Sort`) polled cross-platform without OS-specific watchers, suggesting formatted filenames and
  `subfolder_presets`, filing collision-safely into `external_pdf_roots[0]`, and removing the staging file only after
  the destination PDF and `<citekey>.md` are verified on disk.
- **Zoplicate Multi-Signal Deduplication & Safe Merge (`find_duplicates`, `merge`)**: detects duplicates across five
  signals — normalized DOI, base arXiv ID (linking `preprint` entries to published `journalArticle` versions), size-gated
  PDF SHA-256, normalized ISBN core, and fuzzy title + first-author + year — and merges duplicates losslessly (recording
  merged citekeys in `aliases`, unioning collections/tags/relations, preserving reading note prose and `pdf-marks`
  highlights, and relinking `[[citekey]]` and `\cite{citekey}` across vault `.md`/`.tex` files).
- **INSPIRE-HEP Search, Preprint Upgrade & arXiv LaTeX Source (`search_remote`, `upgrade_preprint`, `fetch_arxiv_source`)**:
  queries INSPIRE-HEP, arXiv, Crossref, and OpenAlex; upgrades arXiv preprints to published journal metadata while
  preserving `citekey`, `archiveID`, and `arxivVersion`; and unpacks `.tar.gz`/`.gz` e-print archives safely to index
  `.tex` files, `\label{...}` equation labels, and `\newcommand` / `\DeclareMathOperator` macros.
- **The open-access PDF**: arXiv's, else OpenAlex's and Unpaywall's, then Semantic Scholar, Europe PMC, CORE, and
  plugin-contributed PDF sources (`[contributes.catalog-papers] pdf_sources`).
- **The Zotero Connector**: listens on `127.0.0.1:23119` when switched on while Zotero is closed.
- **MCP & Catalog Tools**: `catalog_papers_search_papers` (filterable by `query`, `collection`, `tag`, `item_type`: `"paper" | "book" | "thesis" | "notes"`, `limit`), `catalog_papers_scan_external_roots` (`dry_run` defaulting to `true`, `root`, `rate_limit_ms`, `max_lookups`), `catalog_papers_paper_annotations`, `catalog_papers_bibtex` (single key or full library), `catalog_papers_find_duplicates`, `catalog_papers_upgrade_preprint`, `catalog_papers_fetch_arxiv_source`, plus catalog integration (`lookup`, `add`).

## Settings

- **Folder of your references** (`refs/papers`) and **BibTeX file** (`refs/refs.bib`).
- **Download the PDF when adding a paper** (on), **Your email, for OpenAlex and Unpaywall**, **Answer the Zotero browser extension** (off).
- **Ask other plugins for a PDF** (on), **Order of the PDF sources**, **More open-access indexes** (`semanticscholar, europepmc, core`), **CORE API key** (secret).
- **Shared external PDF folders** (`external_pdf_roots`, e.g. `["../Library/Papers", "../Library/Books"]`), **File new PDFs into primary external folder** (`store_in_external`),
  **Watched PDF drop inbox** (`watch_inbox`), **PDF file name format** (`rename_format`), **Destination subfolder presets** (`subfolder_presets`),
  **PDF highlights storage mode** (`vault` or `shared_sidecar` + `sidecar_dir`), and **arXiv LaTeX source folder** (`arxiv_source_dir`).

## Platforms

Linux, macOS, and Windows (`[platforms]` `linux = "works"`, `macos = "works"`, `windows = "works"`; Windows verbatim
`\\?\` prefixes stripped and `\`/`/` path separators normalized throughout); not in the phone app.

## Status

Beta. Tests: `cargo test -p kandinsky-papers`, `crates/kandinsky/tests/mcp.rs`, `ui/tests/library.spec.ts`, and `ui/tests/research-papers.spec.ts`. Vault files inside `KANDINSKY_ROOT` are
written through `kandinsky_plugin::write_file` (Kandinsky's live file API when running under Kandinsky, atomic temp-file
rename otherwise), and the catalog's `paper` kind uses `folder = "{setting:dir}"` dynamically.
