# PDF sources for papers — how a plugin finds a paper's PDF

A generic way to add PDF downloaders to papers. When a paper is added
(the catalog's `paper` kind: a DOI or an arXiv id captured anywhere, the Library's Add, an agent), the core's papers
feature first tries its own open-access sources — arXiv, OpenAlex, Unpaywall (with `[refs] email`). When none has a
PDF, **catalog-papers asks the PDF sources other plugins contribute**, one after the other, until one attaches a PDF.

## Writing a source

A plugin declares a tool as a PDF source for catalog-papers:

```toml
[permissions]
net = ["api.example.org", "*"]      # the index it asks, and the hosts it downloads from ("*": any; Settings shows it)

[[tool]]
name = "find_pdf"
description = "…"
input = { key = "string", doi = "string?", arxiv = "string?", title = "string?" }

[contributes.catalog-papers]
pdf_sources = [{ tool = "find_pdf", label = "my index" }]
```

The tool is called with `{ key, doi, arxiv, title, year, authors, settings }` and answers `{ "attached": true, "from":
"<where>" }` when it attached a PDF, else `{ "skipped": "<why>" }`. Attaching is one call of the Python SDK:

```python
kandinsky.attach_pdf(params["key"], url, "My index")   # True when the paper now has the PDF
```

It downloads `url` into the plugin's own cache through the core (the plugin's `net` permission applies), then
`POST /api/refs/attach { key, file, from }` moves it into the paper's folder (`refs/papers/<key>/<key>.pdf`), records
`pdfFrom: "<from>: <url>"` in `info.yaml` and rewrites refs.bib. The core keeps it only when the file is a PDF, comes from
a plugin's cache (`.kandinsky/cache/plugins/<id>/…`) and the paper has no PDF yet (`refs::attach_pdf`).

A source that fails (an exception, an index down) is noted and the next one asked; the add never fails because of a source.

## Order and switches (Settings → Catalog · Science)

- **Ask other plugins for a PDF** (`pdf_sources_on`, on by default).
- **Order of the PDF sources** (`pdf_order`): plugin ids, first asked first; `-<id>` switches one off; sources not named are
  asked after, by id. Each plugin's card in Settings → Plugins says "finds PDFs for catalog-papers".

The result shows in the capture's notice: "PDF from Europe PMC", or "No PDF found (more open access: no open copy in …)".

## Built in: the open-access, physics & book indexes

Before any plugin's source is asked, catalog-papers ("Catalog · Science", running on Linux, Windows, and macOS) tries arXiv (preserving exact `arXiv:XXXX.YYYYYvN` version provenance), **INSPIRE-HEP** (`inspirehep.net`), Crossref, OpenAlex, and Unpaywall, then the indexes of its `indexes` setting in order: Semantic Scholar (`openAccessPdf`), Europe PMC (full-text links that are open: `availabilityCode` OA or F, never subscription ones) and CORE (only with its free API key, the plugin's `core_key` secret, sent by the core as `Authorization: Bearer …`). For books and ISBNs (detected from user input or the first 8 pages of a PDF), `catalog-papers` queries **Open Library** (`openlibrary.org`), **Google Books** (`www.googleapis.com`), and Crossref/OpenAlex book DOIs to file first-class `@book` entries (`book` / `science_book`). Each paper PDF index is asked only when the copies before it failed (`remote::open_access_pdfs`, lazy; test `the_other_indexes_come_after_in_the_settings_order_and_only_when_the_ones_before_had_nothing`).

### Shared external PDF roots (`external_pdf_roots`), folder scanning, and arXiv LaTeX sources

- **Where downloaded PDFs land (`store_in_external`):** When `external_pdf_roots` is empty (the default), attached PDFs are stored inside the vault at `<dir>/<citekey>/<citekey>.pdf`. When `external_pdf_roots` is configured (for example `["../Library/Papers", "../Library/Books"]` on a synced cloud drive shared by multiple vaults) and `store_in_external` is enabled, newly downloaded PDFs, Zotero Connector uploads, and `watch_inbox` (`../Papers/Sort`) drops are named with `rename_format` (default `{Author}{Year} - {Title}.pdf`), placed into `external_pdf_roots[0]` without overwriting existing files, and referenced by relative path in `<citekey>.md` and `refs/refs.bib` — with zero vault copies and zero OS hard-links or symlinks.
- **Scanning existing external folders (`scan_external_roots` / `kandinsky scan-external-roots`):** When you already organize PDFs and books across folders in `external_pdf_roots`, **Scan folders** (`paper-tab-scan`), `kandinsky scan-external-roots`, or the MCP tool `catalog_papers_scan_external_roots` recursively scans those roots in place (ignoring non-PDF files like `.ipynb`), classifies papers and `@book` entries, derives `collections` from nested subfolders, tracks moved PDFs by SHA-256 to update their `pdf` reference and collection, and throttles remote lookups with `rate_limit_ms` and `max_lookups` (plus optional `root` filtering). Runs in `dry_run: true` preview mode by default unless `--apply` / `dry_run: false` is requested.
- **arXiv LaTeX source bundles (`fetch_arxiv_source`):** For any entry with an arXiv identifier, `fetch_arxiv_source` (Library row action, workflow modal, or agent tool) fetches `https://export.arxiv.org/e-print/<id>` under `[permissions] net` and extracts `.tex` / `.bib` / `.bbl` / figure files safely into `arxiv_source_dir/<id>/` (default `.kandinsky/cache/arxiv-src/<id>/`), rejecting path traversal or symlinks in archives.

These open-access sources replaced the standalone `papers-open-access` plugin (Python helper) when science became one subplugin of the catalog. A vault that had it installed removes it (`kandinsky plugin remove papers-open-access`); its settings were the defaults. A new source is still a plugin of its own, on the contract above.
