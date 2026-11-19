// References (Zotero-like) as a library source (plugin-api.ts `LibrarySource`, registered in core-libraries.ts): refs/<key>/<key>.md, whose properties are the
// entry's fields, read through the catalog-papers helper's endpoints. Keys: Enter opens the PDF, r reads, n notes,
// c copies the citekey.
import { api } from "./api";
import { on, touches } from "./bus";
import { openPath } from "./dock";
import { errText } from "./text";
import { openReadingNote, readPaper } from "./papers";
import { openPaperWorkflowModal, openZoteroImportModal } from "./paper-modals.svelte";
import { toast } from "./state.svelte";
import type { Paper, PaperAdded } from "./types";
import type { LibraryItem, LibrarySource } from "./plugin-api";

type ZoteroPaper = Paper & {
  isbn?: string | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  publisher?: string | null;
  edition?: string | null;
  series?: string | null;
};

const toGroup = (c: string) => c.split("/").map((s) => s.trim()).filter(Boolean).join(" › ");
const fromGroup = (g: string) => g.split(" › ").map((s) => s.trim()).filter(Boolean).join("/");

// Zotero's item types grouped as a reader thinks of them (2026-10-18: books, theses and lecture notes are references too)
const typeOf = (p: Paper) =>
  p.kind === "science_book" || p.kind === "book" || p.kind === "bookSection"
    ? "book"
    : p.kind === "thesis"
      ? "thesis"
      : p.kind === "manuscript" || p.kind === "report"
        ? "notes"
        : "paper";
/** Zotero's item type in words: `journalArticle` → `journal article`, `science_book` → `science book`. */
const typeWords = (kind: string) => kind.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
const lastNames = (p: Paper) => {
  const n = p.authors.map((a) => a.split(",")[0].trim());
  return n.length > 3 ? `${n[0]} et al.` : n.join(", ");
};
const split = (s: string, sep: RegExp) => s.split(sep).map((x) => x.trim()).filter(Boolean);

async function copy(text: string, what: string) {
  try { await navigator.clipboard.writeText(text); toast(`Copied ${what}`, text.length > 80 ? undefined : text); }
  catch (e) { toast("Copy failed", String(e), "error"); }
}

/** The References library. One per page: it keeps the papers it read, by citekey, for their actions. */
export function referencesSource(): LibrarySource {
  const papers = new Map<string, ZoteroPaper>();
  const paper = (i: LibraryItem) => papers.get(i.id)!;
  const openPdf = (p: ZoteroPaper) => (p.pdf ? openPath(p.pdf) : toast("No PDF yet", `Drop one into ${p.dir}/`));
  let dir = "refs/papers";

  const item = (p: ZoteroPaper): LibraryItem => ({
    id: p.key,
    note: `${p.dir}/${p.key}.md`,
    title: p.title,
    sub: [lastNames(p), p.year, p.venue].filter(Boolean).join(" · "),
    flags: [...(p.pdf ? [{ label: "PDF", tone: "red" as const }] : []), ...(p.has_notes ? [{ label: "notes" }] : [])],
    tab: typeOf(p),
    groups: p.collections.map(toGroup),
    tags: p.tags,
    text: `${p.key} ${p.title} ${p.authors.join(" ")} ${p.year ?? ""} ${p.venue ?? ""} ${p.doi ?? ""} ${p.arxiv ?? ""} ${p.isbn ?? ""} ${p.collections.join(" ")} ${p.tags.join(" ")}`,
    sort: {
      added: p.added ?? "",
      year: Number(p.year ?? 0),
      author: (p.authors[0] ?? "").split(",")[0].toLowerCase(),
      title: p.title,
      venue: (p.venue ?? "").toLowerCase(),
      kind: typeWords(p.kind),
      pdf: p.pdf ? 1 : 0,
    },
    columns: {
      creators: lastNames(p),
      year: p.year ?? "",
      venue: p.venue ?? "",
      kind: typeWords(p.kind),
      added: (p.added ?? "").slice(0, 10),
      hasPdf: Boolean(p.pdf),
      citekey: p.key,
    },
  });

  return {
    id: "references", title: "References", icon: "library", noun: "references",
    async load() {
      const all = (await api.refs()) as ZoteroPaper[];
      papers.clear();
      for (const p of all) papers.set(p.key, p);
      // the library's folder is catalog-papers' setting: read off the entries themselves (their folders' parent)
      dir = all[0]?.dir.replace(/\/[^/]*$/, "") || dir;
      return all.map(item);
    },
    tabs: [{ id: "paper", title: "Papers" }, { id: "book", title: "Books" }, { id: "thesis", title: "Theses" }, { id: "notes", title: "Notes" }],
    groupsTitle: "Collections",
    async regroup(items, group) {
      const col = fromGroup(group);
      if (!col) return;
      for (const i of items) {
        const p = paper(i);
        if (!p || p.collections.includes(col)) continue;
        await api.refsEdit({
          key: p.key,
          title: p.title,
          authors: p.authors,
          date: p.year ?? "",
          venue: p.venue ?? "",
          collections: [...p.collections, col],
          tags: p.tags,
        });
      }
      toast(`Filed in ${group}`, `${items.length} item${items.length === 1 ? "" : "s"}`, "success");
    },
    layouts: ["list", "table"],
    sorts: [
      { id: "added", label: "date added", desc: true },
      { id: "year", label: "year", desc: true },
      { id: "author", label: "first author" },
      { id: "title", label: "title" },
      { id: "venue", label: "venue" },
      { id: "kind", label: "type" },
    ],
    search: "Search title, author, year, key, tag…",
    empty: "No papers yet — add one by DOI or arXiv id.",
    detail(i) {
      const p = paper(i);
      const detailsLine = [
        p.volume ? `Vol. ${p.volume}` : "",
        p.issue ? `No. ${p.issue}` : "",
        p.pages ? `pp. ${p.pages}` : "",
      ].filter(Boolean).join(" · ");
      const fields = (
        [
          ["Citekey", p.key],
          ["Item type", typeWords(p.kind)],
          ["Year", p.year ?? ""],
          ["Venue", p.venue ?? ""],
          ["Publisher", p.publisher && p.publisher !== p.venue ? p.publisher : ""],
          ["Details", detailsLine],
          ["Edition", p.edition ?? ""],
          ["Series", p.series ?? ""],
          ["DOI", p.doi ?? ""],
          ["arXiv", p.arxiv ?? ""],
          ["ISBN", p.isbn ?? ""],
          ["PDF", p.pdf ?? ""],
          ["Added", (p.added ?? "").slice(0, 10)],
        ] as [string, string][]
      ).filter(([, v]) => Boolean(v));
      return {
        kind: `${typeWords(p.kind)}${p.year ? ` · ${p.year}` : ""}`,
        title: p.title,
        lines: [{ text: p.authors.join("; ") }, ...(p.venue ? [{ text: p.venue, muted: true }] : [])],
        fields,
        actions: [
          { label: "Read", icon: "pdf", primary: true, title: "Open the PDF (its note: “Note” in the PDF's bar) (R)", run: () => readPaper(p) },
          { label: "Open PDF", disabled: !p.pdf, title: "Only the PDF (Enter)", run: () => openPdf(p) },
          ...(p.pdf ? [{ label: "Reveal in Explorer", icon: "folder-open", title: "Show PDF in system file manager", run: () => api.revealOutside(p.pdf!) }] : []),
          { label: p.has_notes ? "Notes" : "New notes", icon: "edit", run: () => openReadingNote(p.key) },
          { label: p.key, icon: "copy", run: () => copy(p.key, "citekey") },
          { label: "\\cite", run: () => copy(`\\cite{${p.key}}`, "\\cite") },
          { label: "BibTeX", run: async () => copy(await api.refsBibtex(p.key), "BibTeX") },
          {
            label: "Retrieve Metadata",
            icon: "refresh",
            title: "Recognize metadata from the PDF and online scholarly/book indexes",
            run: async () => {
              const r = (await api.pluginHelper("catalog-papers", "enrich_entry", { key: p.key, rename_citekey: true }, 120)) as {
                key?: string;
                old_key?: string;
                upgraded?: boolean;
                source?: string;
                doi?: string;
                venue?: string;
              } | null;
              const nextKey = r?.key || p.key;
              toast(
                r?.upgraded ? `Retrieved metadata for ${nextKey}` : `${nextKey}: metadata up to date`,
                [r?.source, r?.venue, r?.doi ? `doi:${r.doi}` : ""].filter(Boolean).join(" · ") || "Metadata checked",
                r?.upgraded ? "success" : "info",
              );
              return nextKey;
            },
          },
          {
            label: "Check published", title: "Check Crossref / INSPIRE-HEP / OpenAlex for a published journal version while keeping arXiv version provenance",
            run: async () => {
              const r = (await api.pluginHelper("catalog-papers", "upgrade_preprint", { key: p.key }, 90)) as { upgraded?: boolean; doi?: string; venue?: string; message?: string };
              toast(r?.upgraded ? `Upgraded ${p.key}` : `${p.key}: no newer publication`, r?.message ?? (r?.venue ? `${r.venue}${r.doi ? ` · doi:${r.doi}` : ""}` : "Metadata checked"), r?.upgraded ? "success" : "info");
            },
          },
          ...(p.arxiv ? [{
            label: "arXiv LaTeX", title: "Download and unpack the arXiv e-print LaTeX (.tex / .bib) source",
            run: async () => {
              const r = (await api.pluginHelper("catalog-papers", "fetch_arxiv_source", { key: p.key }, 120)) as { dir?: string; main_tex?: string; files?: string[]; tex_files?: string[] };
              const mainTex = r?.main_tex ?? r?.tex_files?.[0];
              toast(`Fetched arXiv source for ${p.key}`, mainTex ?? r?.dir ?? `${r?.files?.length ?? 0} files`, "success", 7000,
                mainTex && !mainTex.startsWith(".kandinsky/cache/") ? [{ label: "Open .tex", run: () => openPath(mainTex) }] : undefined);
            },
          }] : []),
          ...(p.pdf && (p.pdf.startsWith("../") || p.pdf.startsWith("@ext/")) ? [
            {
              label: "Export marks sidecar", title: "Merge this vault's PDF highlights into a shared .kandinsky-marks sidecar beside the external PDF",
              run: async () => {
                const r = await api.pdfSidecar(p.pdf!, "export");
                toast("Shared sidecar written", `${r.marks} mark(s) → ${r.sidecar_path}`, "success");
              },
            },
            {
              label: "Import marks sidecar", title: "Merge highlights from the external PDF's shared .kandinsky-marks sidecar into this vault's reading note",
              run: async () => {
                const r = await api.pdfSidecar(p.pdf!, "import");
                toast("Shared sidecar imported", `${r.marks} mark(s) in ${r.note ?? p.key}`, "success");
              },
            },
          ] : []),
          { label: "Duplicates / merge…", title: "Compare and merge duplicate entries", run: () => openPaperWorkflowModal("duplicates", p.key) },
          {
            label: "Edit", title: "Edit title, authors, year, venue, collections, tags, and identifiers",
            edit: {
              fields: [
                { key: "title", label: "Title", value: p.title, rows: 2 },
                { key: "authors", label: "Authors", hint: "“Last, First”; separated by ;", value: p.authors.join("; "), rows: 2 },
                { key: "date", label: "Year / date", value: p.year ?? "", half: true },
                { key: "venue", label: "Venue", value: p.venue ?? "", half: true },
                { key: "doi", label: "DOI", value: p.doi ?? "", half: true },
                { key: "arxiv", label: "arXiv", value: p.arxiv ?? "", half: true },
                { key: "isbn", label: "ISBN", value: p.isbn ?? "", half: true },
                { key: "volume", label: "Volume", value: p.volume ?? "", half: true },
                { key: "issue", label: "Issue", value: p.issue ?? "", half: true },
                { key: "pages", label: "Pages", value: p.pages ?? "", half: true },
                { key: "collections", label: "Collections", hint: "comma-separated", value: p.collections.map(toGroup).join(", ") },
                { key: "tags", label: "Tags", hint: "comma-separated", value: p.tags.join(", ") },
              ],
              async save(v) {
                await api.pluginHelper("catalog-papers", "edit", {
                  key: p.key,
                  title: v.title,
                  authors: split(v.authors, /;|\n/),
                  date: v.date,
                  venue: v.venue,
                  collections: split(v.collections, /,/).map(fromGroup),
                  tags: split(v.tags, /,/),
                  doi: v.doi,
                  arxiv: v.arxiv,
                  isbn: v.isbn,
                  volume: v.volume,
                  issue: v.issue,
                  pages: v.pages,
                });
                toast("Saved", `${p.key} — refs.bib updated`, "success");
              },
            },
          },
          {
            label: "Delete…", danger: true, title: "Remove this entry (its folder goes to the Trash)",
            confirm: { title: `Remove “${p.title}” (${p.key}) from the library?`, hint: "Its folder (metadata, PDF, notes) goes to the Trash; refs.bib is rewritten.", button: "Move to Trash" },
            run: async () => {
              const r = await api.refsDelete(p.key);
              toast(`Removed ${p.key}`, `Moved to ${r.to}; refs.bib updated`, "success");
            },
          },
        ],
        choice: {
          label: "Type",
          options: [
            { label: "Article", kind: "journalArticle" },
            { label: "Preprint", kind: "preprint" },
            { label: "Book", kind: "book" },
            { label: "Thesis", kind: "thesis" },
            { label: "Notes", kind: "manuscript" },
          ].map((o) => ({
            label: o.label,
            on: o.kind === "book" ? (p.kind === "book" || p.kind === "science_book" || p.kind === "bookSection") : p.kind === o.kind,
            run: async () => {
              await api.pluginHelper("catalog-papers", "type", { key: p.key, kind: o.kind });
              toast(`Set type to ${o.label}`, p.key, "success");
              return p.key;
            },
          })),
        },
        links: [
          ...(p.doi ? [{ label: `doi:${p.doi}`, url: `https://doi.org/${p.doi}` }] : []),
          ...(p.arxiv ? [{ label: `arXiv:${p.arxiv}`, url: `https://arxiv.org/abs/${p.arxiv}` }] : []),
        ],
        body: p.abstract_text ? { title: "Abstract", text: p.abstract_text } : undefined,
      };
    },
    many(items) {
      return [
        {
          label: `Retrieve metadata (${items.length})`,
          icon: "refresh",
          title: "Recognize metadata from each PDF and online scholarly/book indexes",
          run: async () => {
            let upgraded = 0;
            for (const i of items) {
              try {
                const r = (await api.pluginHelper("catalog-papers", "enrich_entry", { key: i.id, rename_citekey: true }, 120)) as { upgraded?: boolean } | null;
                if (r?.upgraded) upgraded++;
              } catch { /* continue remaining items */ }
            }
            toast("Metadata check complete", `${upgraded} of ${items.length} upgraded`, upgraded ? "success" : "info");
          },
        },
        {
          label: "Copy \\cite{…}",
          icon: "copy",
          run: () => copy(`\\cite{${items.map((i) => i.id).join(", ")}}`, `${items.length} citations`),
        },
        {
          label: "Copy [[links]]",
          icon: "link",
          run: () => copy(items.map((i) => `[[${i.id}]]`).join(", "), `${items.length} links`),
        },
        {
          label: "Copy BibTeX",
          run: async () => {
            const entries = await Promise.all(items.map((i) => api.refsBibtex(i.id)));
            await copy(entries.join("\n\n"), `${items.length} BibTeX entries`);
          },
        },
        {
          label: `Delete ${items.length}…`,
          danger: true,
          confirm: {
            title: `Remove ${items.length} references from the library?`,
            hint: "Their folders (metadata, PDF, notes) go to the Trash; refs.bib is rewritten.",
            button: "Move to Trash",
          },
          run: async () => {
            for (const i of items) await api.refsDelete(i.id);
            toast(`Removed ${items.length} references`, "Moved to Trash; refs.bib updated", "success");
          },
        },
      ];
    },
    add: {
      placeholder: "DOI, arXiv id, ISBN, or title — or drop a PDF", busy: "Adding…",
      async run(text) {
        try {
          const r = await api.refsAdd(text);
          toast(r.created ? `Added ${r.paper.key}` : `Already in the library: ${r.paper.key}`, r.paper.title + (r.created && r.pdf ? " · PDF downloaded" : ""), r.created ? "success" : "info");
          return r.paper.key;
        } catch (err) {
          if (/not a DOI, arXiv id/i.test(errText(err))) {
            openPaperWorkflowModal("add", text);
            return;
          }
          throw err;
        }
      },
    },
    drop: {
      // metadata from a DOI / arXiv id inside, else the file name
      hint: "Drop PDFs to add them to the library", accept: /\.pdf$/i,
      async run(files, group) {
        let last: string | undefined;
        const col = group ? fromGroup(group) : "";
        for (const f of files) {
          try {
            let r: PaperAdded;
            if (col) {
              const safeName = f.name.replace(/[^\w.-]+/g, "_");
              const cachePath = `.kandinsky/cache/plugins/catalog-papers/import-${Date.now()}-${safeName}`;
              await api.upload(cachePath, f, true);
              r = (await api.pluginHelper("catalog-papers", "import", {
                path: cachePath,
                name: f.name,
                subfolder: col,
                collections: [col],
              })) as PaperAdded;
            } else {
              r = await api.refsPdf(f.name, f);
            }
            last = r.paper.key;
            const zp = r.paper as ZoteroPaper;
            const recognized = Boolean(zp.doi || zp.arxiv || zp.isbn || (zp.authors.length && zp.year));
            toast(r.created ? `Added ${r.paper.key}` : `Already in the library: ${r.paper.key}`,
              recognized ? r.paper.title : `${r.paper.title} — no DOI/arXiv id found: complete its fields in its note`, r.created ? "success" : "info", 7000);
          } catch (err) { toast(`Could not add ${f.name}`, errText(err), "error", 9000); }
        }
        return last;
      },
    },
    // Zotero → plain files through a command of the vault (Zotero is only read): any `refs.<verb>-zotero`, a sync first
    async tools() {
      let inboxLabel = "Drop inbox…";
      try {
        const inbox = (await api.pluginHelper("catalog-papers", "scan_inbox", {}, 15)) as { configured?: boolean; items?: unknown[]; files?: unknown[] } | null;
        const n = inbox?.configured === false ? 0 : (inbox?.items?.length ?? inbox?.files?.length ?? 0);
        if (n > 0) inboxLabel = `Drop inbox (${n})…`;
      } catch { /* helper optional until configured */ }
      const baseTools = [
        { label: "Add / search…", title: "Add by DOI, arXiv (with vN), ISBN, BibTeX/RIS paste, or search INSPIRE-HEP / Crossref / OpenAlex", run: () => openPaperWorkflowModal("add") },
        { label: inboxLabel, title: "Triage, rename and file dropped PDFs from watch_inbox into external_pdf_roots", run: () => openPaperWorkflowModal("inbox") },
        { label: "Scan external folders…", title: "Scan configured external PDF folders for papers and books, derive collections, and sync references", run: () => openPaperWorkflowModal("scan") },
        { label: "Duplicates…", title: "Detect and safely merge duplicate papers across DOI, arXiv, SHA-256, ISBN and title", run: () => openPaperWorkflowModal("duplicates") },
        { label: "Import from Zotero…", title: "Lossless one-time Zotero migration (SQLite, linked PDFs in place, collections, notes and highlights)", run: () => openZoteroImportModal() },
      ];
      const mine = (await api.commands()).filter((c) => /^refs\.[\w-]*zotero$/.test(c.id));
      const z = mine.find((c) => c.id.includes("sync")) ?? mine[0];
      if (!z) return baseTools;
      return [...baseTools, {
        label: "Sync from Zotero", title: `${z.title} — Zotero is only read; running it again brings only what changed`,
        run: async () => {
          const before = papers.size;
          const r = await api.cmd(z.id);
          if (!r.ok) throw new Error(`${r.error ?? "it failed"} — the command is .kandinsky/commands/${z.id}.toml`);
          const now = (await api.refs()).length;
          toast("Zotero: done", `${now - before} new · ${now} papers in the library`, "success");
        },
      }];
    },
    watch: (reload) => {
      const offFs = on("fs", (e) => { if (touches(e.paths, (p) => p.startsWith(dir))) reload(); });
      const offPlug = on("plugin", (e) => {
        if (e.plugin === "catalog-papers" && e.event === "papers:inbox") {
          const count = (e.data as { count?: number } | null)?.count ?? 1;
          toast("New PDF(s) in drop inbox", `${count} file(s) ready to file`, "info", 7000, [{ label: "Triage", run: () => openPaperWorkflowModal("inbox") }]);
          reload();
        } else if (e.plugin === "catalog-papers" && e.event === "papers:external-sync") {
          reload();
        }
      });
      const onChanged = () => reload();
      window.addEventListener("kandinsky:papers-changed", onChanged);
      return () => { offFs(); offPlug(); window.removeEventListener("kandinsky:papers-changed", onChanged); };
    },
    keys: { r: (i) => readPaper(paper(i)), n: (i) => void openReadingNote(i.id), c: (i) => void copy(i.id, "citekey") },
    open: (i) => openPdf(paper(i)),
  };
}
