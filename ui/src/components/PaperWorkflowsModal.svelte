<script lang="ts">
  // References tools modal: Universal add / live index search, PDF drop inbox organizer, duplicate merge, and external folder scan.
  import Dialog from "./Dialog.svelte";
  import Icon from "./Icon.svelte";
  import { api } from "../lib/api";
  import { on } from "../lib/bus";
  import { openPath } from "../lib/dock";
  import { openReadingNote } from "../lib/papers";
  import { closePaperWorkflowModal, paperWorkflowModal, type PaperWorkflowTab } from "../lib/paper-modals.svelte";
  import { toast } from "../lib/state.svelte";
  import { errReason } from "../lib/text";
  import { refreshVault } from "../lib/vault";

  let { onclose }: { onclose?: () => void } = $props();

  const BOOKMARKLET = "javascript:void(open('kandinsky://capture-paper?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title)))";
  const SOURCES = [
    { id: "inspire", label: "INSPIRE-HEP" }, { id: "crossref", label: "Crossref" },
    { id: "openalex", label: "OpenAlex" }, { id: "arxiv", label: "arXiv" },
  ] as const;
  const COMPARE_FIELDS = [
    { key: "title", label: "Title" }, { key: "authors", label: "Authors" }, { key: "year", label: "Year" },
    { key: "venue", label: "Venue" }, { key: "doi", label: "DOI" }, { key: "arxiv", label: "arXiv" },
    { key: "pdf", label: "PDF" }, { key: "collections", label: "Collections" }, { key: "tags", label: "Tags" },
  ] as const;

  const TAB_ORDER: PaperWorkflowTab[] = ["add", "inbox", "duplicates", "scan"];

  interface AddedSummary { key: string; title: string; pdf: string | null; count: number }
  interface RemoteHit { uid: string; addId: string; title: string; authors: string; year: string; venue: string; doi: string; arxiv: string }
  interface InboxItem { id: string; name: string; title: string; authors: string; year: string; doi: string; arxiv: string; targetPath: string; duplicateKey: string }
  interface DupEntry { key: string; title: string; authors: string; year: string; venue: string; doi: string; arxiv: string; pdf: string; collections: string; tags: string }
  interface DupGroup { id: string; signals: string[]; entries: DupEntry[] }
  interface ScanProgress { current: number; total: number; pdf_ref: string; dry_run: boolean }
  interface ScanItem {
    uid: string; action: string; citekey: string; title: string; kind: string; bibtex_type: string;
    pdf_path: string; pdf_ref: string; collections: string[]; source: string; error: string | null;
  }
  interface ScanReport {
    dry_run: boolean; roots_scanned: string[]; total_pdfs: number;
    created: number; updated: number; moved: number; unchanged: number; enriched: number; skipped: number;
    errors: string[]; items: ScanItem[];
  }

  let addInput = $state(""), addingRef = $state(false), addedSummary = $state<AddedSummary | null>(null);
  let remoteSource = $state<string>("inspire"), remoteQuery = $state(""), searchingRemote = $state(false);
  let remoteHits = $state<RemoteHit[]>([]), remoteSearched = $state(false), addingHitUid = $state("");
  let addedHitKeys = $state<Record<string, string>>({});

  let inboxLoading = $state(false), inboxOrganizing = $state(false), inboxConfigured = $state(false);
  let watchInbox = $state(""), renameFormat = $state("{Author}{Year} - {Title}.pdf"), externalRoot = $state("../Papers");
  let subfolderPresets = $state<string[]>([]), inboxSubfolder = $state("");
  let inboxItems = $state<InboxItem[]>([]), inboxSelected = $state<Record<string, boolean>>({});
  let inboxDoneCount = $state<number | null>(null);

  let dupsLoading = $state(false), mergingGroupId = $state("");
  let dupGroups = $state<DupGroup[]>([]), primaryByGroup = $state<Record<string, string>>({});
  let relinkVault = $state(true), trashDuplicatePdf = $state(false);

  let scanRoot = $state("");
  let scanMaxLookups = $state<number | null>(50);
  let scanRateLimitMs = $state<number | null>(250);
  let scanBusy = $state(false), scanMode = $state<"preview" | "sync" | "">("");
  let scanProgress = $state<ScanProgress | null>(null);
  let scanResult = $state<ScanReport | null>(null);

  let errorMsg = $state(""), wasOpen = false, loadedTab = "";

  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
  const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : []);
  const joinArr = (v: unknown, sep = "; "): string => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean).join(sep) : str(v));
  const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const parseOptInt = (v: number | string | null | undefined): number | undefined => {
    if (v === "" || v === null || v === undefined) return undefined;
    const n = typeof v === "number" ? v : Number(String(v).trim());
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
  };

  function notifyChanged(): void {
    window.dispatchEvent(new CustomEvent("kandinsky:papers-changed"));
    void refreshVault().catch(() => {});
  }

  function parseAdded(raw: unknown): AddedSummary | null {
    const o = asRecord(raw);
    const list = Array.isArray(raw) ? raw : Array.isArray(o.added) ? o.added : raw ? [raw] : [];
    if (!list.length) return null;
    const first = asRecord(list[0]);
    const p = first.paper && typeof first.paper === "object" ? asRecord(first.paper) : first;
    const key = str(p.key ?? first.key);
    return key ? { key, title: str(p.title) || key, pdf: typeof p.pdf === "string" && p.pdf ? p.pdf : null, count: list.length } : null;
  }

  async function submitAdd(): Promise<void> {
    const text = addInput.trim();
    if (!text || addingRef) return;
    addingRef = true; errorMsg = ""; addedSummary = null;
    try {
      const sum = parseAdded(await api.pluginHelper("catalog-papers", "add", { id: text }, 300));
      addedSummary = sum;
      notifyChanged();
      toast(sum && sum.count > 1 ? `Added ${sum.count} references` : `Added ${sum?.key || "reference"}`, sum?.title, "success");
      addInput = "";
    } catch (err) { errorMsg = errReason(err); }
    finally { addingRef = false; }
  }

  async function runRemoteSearch(): Promise<void> {
    const q = remoteQuery.trim();
    if (!q || searchingRemote) return;
    searchingRemote = true; errorMsg = "";
    try {
      const raw = await api.pluginHelper("catalog-papers", "search_remote", { query: q, source: remoteSource }, 60);
      const o = asRecord(raw);
      const arr = Array.isArray(raw) ? raw : Array.isArray(o.results) ? o.results : Array.isArray(o.items) ? o.items : [];
      remoteHits = arr.map((item, idx) => {
        const r = asRecord(item), doi = str(r.doi ?? r.DOI), arxiv = str(r.arxiv ?? r.eprint ?? r.arxiv_id).replace(/^arxiv:/i, "");
        const addId = arxiv ? `arXiv:${arxiv}` : doi || str(r.bibtex ?? r.id ?? r.url);
        return {
          uid: `${remoteSource}-${idx}-${addId || str(r.title)}`, addId,
          title: str(r.title) || "Untitled work", authors: joinArr(r.authors ?? r.author),
          year: str(r.year ?? r.date).slice(0, 4), venue: str(r.venue ?? r.journal ?? r.publication), doi, arxiv,
        };
      });
      remoteSearched = true;
    } catch (err) { errorMsg = errReason(err); }
    finally { searchingRemote = false; }
  }

  async function addRemoteHit(hit: RemoteHit): Promise<void> {
    if (!hit.addId || addingHitUid) return;
    addingHitUid = hit.uid; errorMsg = "";
    try {
      const sum = parseAdded(await api.pluginHelper("catalog-papers", "add", { id: hit.addId }, 300));
      const key = sum?.key || "added";
      addedHitKeys[hit.uid] = key;
      notifyChanged();
      toast(`Added ${key}`, hit.title, "success");
    } catch (err) { errorMsg = errReason(err); }
    finally { addingHitUid = ""; }
  }

  async function copyBookmarklet(): Promise<void> {
    try { await navigator.clipboard.writeText(BOOKMARKLET); toast("Copied capture bookmarklet", "Paste as a bookmark URL in any browser", "success"); }
    catch (err) { toast("Copy failed", errReason(err), "error"); }
  }

  async function scanInbox(): Promise<void> {
    if (inboxLoading) return;
    inboxLoading = true; errorMsg = ""; inboxDoneCount = null;
    try {
      const raw = await api.pluginHelper("catalog-papers", "scan_inbox", {}, 60);
      const o = asRecord(raw);
      const rawDir = str(o.inbox_dir ?? o.watch_inbox);
      const isConfigured = typeof o.configured === "boolean" ? o.configured : Boolean(rawDir);
      inboxConfigured = isConfigured;
      watchInbox = isConfigured ? rawDir : "";
      renameFormat = str(o.rename_format) || "{Author}{Year} - {Title}.pdf";
      const roots = Array.isArray(o.external_pdf_roots) ? o.external_pdf_roots : [];
      externalRoot = str(o.external_root) || str(roots[0]) || "../Papers";
      subfolderPresets = Array.isArray(o.subfolder_presets) ? o.subfolder_presets.map((x) => str(x)).filter(Boolean) : [];
      const arr = Array.isArray(o.items) ? o.items : Array.isArray(o.files) ? o.files : Array.isArray(raw) ? raw : [];
      const sel: Record<string, boolean> = {};
      const rootBase = externalRoot.replace(/\/+$/, "");
      inboxItems = arr.map((entry, i) => {
        const r = asRecord(entry), name = str(r.name ?? r.file ?? r.filename) || `paper-${i + 1}.pdf`;
        const id = str(r.path ?? r.file ?? r.name) || name;
        const dup = str(r.duplicate_key ?? r.existing_key) || (r.duplicate ? "existing" : "");
        sel[id] = !dup;
        const subClean = str(r.suggested_subfolder).replace(/^\/+|\/+$/g, "");
        const suggestedFile = str(r.suggested_filename) || name;
        const constructedTarget = [rootBase, subClean, suggestedFile].filter(Boolean).join("/");
        return {
          id, name, title: str(r.title) || name.replace(/\.pdf$/i, ""),
          authors: joinArr(r.authors ?? r.author), year: str(r.year ?? r.date).slice(0, 4),
          doi: str(r.doi), arxiv: str(r.arxiv),
          targetPath: str(r.target_path ?? r.renamed_path ?? r.preview_path) || constructedTarget,
          duplicateKey: dup,
        };
      });
      inboxSelected = sel;
    } catch (err) {
      const msg = errReason(err);
      if (/watch_inbox is not configured/i.test(msg)) {
        inboxConfigured = false;
        watchInbox = "";
        inboxItems = [];
        inboxSelected = {};
      } else {
        errorMsg = msg;
      }
    }
    finally { inboxLoading = false; }
  }

  function previewDest(item: InboxItem): string {
    const sub = inboxSubfolder.trim().replace(/^\/+|\/+$/g, "");
    if (!sub) return item.targetPath;
    return `${externalRoot.replace(/\/+$/, "")}/${sub}/${item.targetPath.split("/").pop() || item.name}`;
  }

  async function organizeSelected(): Promise<void> {
    const files = inboxItems.filter((it) => inboxSelected[it.id]).map((it) => it.id);
    if (!files.length || inboxOrganizing) return;
    inboxOrganizing = true; errorMsg = "";
    try {
      const o = asRecord(await api.pluginHelper("catalog-papers", "organize_inbox", { files, subfolder: inboxSubfolder.trim() || undefined }, 300));
      const n = typeof o.organized === "number" ? o.organized : Array.isArray(o.organized) ? o.organized.length : typeof o.count === "number" ? o.count : files.length;
      notifyChanged();
      toast(`Organized ${n} PDF${n === 1 ? "" : "s"}`, undefined, "success");
      await scanInbox();
      inboxDoneCount = n;
    } catch (err) { errorMsg = errReason(err); }
    finally { inboxOrganizing = false; }
  }

  function signalLabel(sig: string): string {
    const k = sig.toLowerCase().replace(/[\s_-]+/g, "_");
    if (k === "doi") return "DOI";
    if (k === "arxiv") return "arXiv";
    if (k.includes("preprint")) return "Preprint ↔ Published";
    if (k.includes("sha") || k.includes("hash")) return "PDF SHA-256";
    if (k === "isbn") return "ISBN";
    return k.includes("title") ? "Title + author" : sig;
  }

  async function scanDuplicates(): Promise<void> {
    if (dupsLoading) return;
    dupsLoading = true; errorMsg = "";
    try {
      const raw = await api.pluginHelper("catalog-papers", "find_duplicates", {}, 90);
      const ro = asRecord(raw);
      const arr = Array.isArray(raw) ? raw : Array.isArray(ro.groups) ? ro.groups : [];
      const prim: Record<string, string> = {};
      dupGroups = arr.map((g, idx) => {
        const o = asRecord(g);
        const sigRaw = Array.isArray(o.reasons) ? o.reasons : Array.isArray(o.signals) ? o.signals : o.reason ? [o.reason] : o.signal ? [o.signal] : [];
        const signals = Array.from(new Set(sigRaw.map((s) => signalLabel(str(s))).filter(Boolean)));
        const list = Array.isArray(o.members) ? o.members : Array.isArray(o.papers) ? o.papers : Array.isArray(o.entries) ? o.entries : Array.isArray(o.items) ? o.items : [];
        const entries: DupEntry[] = list.map((p) => {
          const r = asRecord(p);
          return {
            key: str(r.key ?? r.citekey), title: str(r.title), authors: joinArr(r.authors),
            year: str(r.year), venue: str(r.venue), doi: str(r.doi), arxiv: str(r.arxiv),
            pdf: str(r.pdf), collections: joinArr(r.collections, ", "), tags: joinArr(r.tags, ", "),
          };
        }).filter((e) => e.key);
        const id = str(o.id) || entries.map((e) => e.key).join("::") || `group-${idx}`;
        prim[id] = str(o.primary ?? o.suggested_primary) || entries[0]?.key || "";
        return { id, signals: signals.length ? signals : ["Duplicate match"], entries };
      }).filter((g) => g.entries.length >= 2);
      primaryByGroup = prim;
    } catch (err) { errorMsg = errReason(err); }
    finally { dupsLoading = false; }
  }

  const fieldDiffers = (entries: DupEntry[], field: keyof DupEntry): boolean =>
    entries.some((e) => e[field] !== entries[0]?.[field]) && entries.some((e) => Boolean(e[field]));

  async function mergeGroup(group: DupGroup): Promise<void> {
    const into = primaryByGroup[group.id] || group.entries[0]?.key;
    const dups = group.entries.filter((e) => e.key && e.key !== into);
    if (!into || !dups.length || mergingGroupId) return;
    mergingGroupId = group.id; errorMsg = "";
    try {
      for (const d of dups) {
        await api.pluginHelper("catalog-papers", "merge", { dup: d.key, into, relink_vault: relinkVault, trash_duplicate_pdf: trashDuplicatePdf }, 120);
      }
      notifyChanged();
      toast(`Merged into ${into}`, `${dups.map((d) => d.key).join(", ")} kept in aliases`, "success");
      dupGroups = dupGroups.filter((g) => g.id !== group.id);
    } catch (err) { errorMsg = errReason(err); }
    finally { mergingGroupId = ""; }
  }

  function parseScanReport(raw: unknown, fallbackDry: boolean): ScanReport {
    const o = asRecord(raw);
    const rawErrors = Array.isArray(o.errors) ? o.errors : [];
    const errors = rawErrors.map((err) => {
      if (typeof err === "string") return err.trim();
      const er = asRecord(err);
      const msg = str(er.error ?? er.message ?? er.reason);
      const path = str(er.pdf_ref ?? er.pdf_path ?? er.path);
      return path && msg ? `${path}: ${msg}` : msg || path || JSON.stringify(err);
    }).filter(Boolean);
    const rawItems = Array.isArray(o.items) ? o.items : [];
    const items: ScanItem[] = rawItems.map((entry, idx) => {
      const r = asRecord(entry);
      const citekey = str(r.citekey ?? r.key);
      const pdf_path = str(r.pdf_path);
      const pdf_ref = str(r.pdf_ref);
      const errVal = str(r.error);
      return {
        uid: `${idx}:${pdf_ref || pdf_path || citekey || str(r.title)}`,
        action: str(r.action) || "unchanged",
        citekey,
        title: str(r.title) || citekey || pdf_ref || pdf_path || "Untitled PDF",
        kind: str(r.kind) || "paper",
        bibtex_type: str(r.bibtex_type),
        pdf_path,
        pdf_ref,
        collections: strList(r.collections),
        source: str(r.source),
        error: errVal || null,
      };
    });
    const created = num(o.created), updated = num(o.updated), moved = num(o.moved);
    const unchanged = num(o.unchanged), enriched = num(o.enriched), skipped = num(o.skipped);
    const total_pdfs = num(o.total_pdfs, items.length || created + updated + moved + unchanged + skipped + errors.length);
    return {
      dry_run: typeof o.dry_run === "boolean" ? o.dry_run : fallbackDry,
      roots_scanned: strList(o.roots_scanned),
      total_pdfs,
      created,
      updated,
      moved,
      unchanged,
      enriched,
      skipped,
      errors,
      items,
    };
  }

  function scanKindBadge(kind: string, bibtexType: string): { label: string; isBook: boolean } {
    const k = kind.toLowerCase(), b = bibtexType.toLowerCase();
    if (k === "book" || k === "science_book" || k === "booksection" || b === "book" || b === "inbook" || b === "incollection" || b === "mvbook") {
      return { label: "Book", isBook: true };
    }
    if (k === "thesis" || b === "phdthesis" || b === "mastersthesis") {
      return { label: "Thesis", isBook: false };
    }
    return { label: "Paper", isBook: false };
  }

  function scanActionClass(action: string): string {
    const a = action.toLowerCase();
    if (a === "create" || a === "created") return "ok";
    if (a === "move" || a === "moved") return "accent";
    if (a === "update" || a === "updated") return "warn";
    if (a === "error" || a === "failed") return "err";
    return "";
  }

  async function runScanFolders(dryRun: boolean): Promise<void> {
    if (scanBusy) return;
    scanBusy = true;
    scanMode = dryRun ? "preview" : "sync";
    errorMsg = "";
    scanProgress = null;
    try {
      const params: Record<string, unknown> = { dry_run: dryRun };
      const rootVal = scanRoot.trim();
      if (rootVal) params.root = rootVal;
      const maxLookupsVal = parseOptInt(scanMaxLookups);
      if (maxLookupsVal !== undefined) params.max_lookups = maxLookupsVal;
      const rateLimitVal = parseOptInt(scanRateLimitMs);
      if (rateLimitVal !== undefined) params.rate_limit_ms = rateLimitVal;
      const raw = await api.pluginHelper("catalog-papers", "scan_external_roots", params, 300);
      const parsed = parseScanReport(raw, dryRun);
      scanResult = parsed;
      scanProgress = { current: parsed.total_pdfs, total: parsed.total_pdfs, pdf_ref: "", dry_run: parsed.dry_run };
      if (!parsed.dry_run) {
        const changed = parsed.created + parsed.updated + parsed.moved;
        if (changed > 0) {
          notifyChanged();
          toast("Synced external folders", `${parsed.created} new · ${parsed.moved} moved · ${parsed.updated} updated`, "success");
        } else {
          toast("External folders up to date", `${parsed.total_pdfs} PDF${parsed.total_pdfs === 1 ? "" : "s"} checked`, "info");
        }
      }
    } catch (err) {
      errorMsg = errReason(err);
      scanProgress = null;
    } finally {
      scanBusy = false;
      scanMode = "";
    }
  }

  function switchTab(next: PaperWorkflowTab): void { paperWorkflowModal.tab = next; errorMsg = ""; }
  function onTabKeyDown(e: KeyboardEvent): void {
    const idx = TAB_ORDER.indexOf(paperWorkflowModal.tab);
    if (idx < 0) return;
    let nextIdx = -1;
    if (e.key === "ArrowRight") nextIdx = (idx + 1) % TAB_ORDER.length;
    else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + TAB_ORDER.length) % TAB_ORDER.length;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = TAB_ORDER.length - 1;
    if (nextIdx < 0) return;
    e.preventDefault();
    const nextTab = TAB_ORDER[nextIdx];
    switchTab(nextTab);
    document.getElementById(`pw-tab-${nextTab}`)?.focus();
  }

  function handleClose(): void {
    if (addingRef || inboxOrganizing || Boolean(mergingGroupId) || scanBusy) return;
    closePaperWorkflowModal();
    onclose?.();
  }

  const selectedInboxCount = $derived(inboxItems.filter((it) => inboxSelected[it.id]).length);
  const scanProgressMax = $derived(
    scanProgress && scanProgress.total > 0
      ? scanProgress.total
      : scanResult && scanResult.total_pdfs > 0
        ? scanResult.total_pdfs
        : 1,
  );
  const scanProgressValue = $derived(
    scanBusy
      ? Math.min(scanProgress?.current ?? 0, scanProgressMax)
      : scanResult
        ? scanProgressMax
        : 0,
  );
  const scanStatusText = $derived.by(() => {
    if (scanBusy) {
      const verb = scanMode === "preview" ? "Previewing" : "Syncing";
      if (scanProgress && scanProgress.total > 0) {
        const ref = scanProgress.pdf_ref ? ` — ${scanProgress.pdf_ref}` : "";
        return `${verb} ${scanProgress.current} of ${scanProgress.total}${ref}`;
      }
      return `${verb} external folders…`;
    }
    if (scanResult) {
      const mode = scanResult.dry_run ? "Preview complete" : "Sync complete";
      const extra = scanResult.enriched > 0 ? ` · ${scanResult.enriched} enriched` : "";
      return `${mode} — ${scanResult.total_pdfs} PDF${scanResult.total_pdfs === 1 ? "" : "s"} scanned (${scanResult.created} new, ${scanResult.moved} moved, ${scanResult.updated} updated${extra})`;
    }
    return "Ready to preview or sync configured external PDF folders";
  });

  $effect(() => {
    return on("plugin", (e) => {
      if (!scanBusy || e.plugin !== "catalog-papers" || e.event !== "papers:scan-progress") return;
      const d = asRecord(e.data);
      scanProgress = {
        current: Math.max(0, num(d.current)),
        total: Math.max(0, num(d.total)),
        pdf_ref: str(d.pdf_ref),
        dry_run: typeof d.dry_run === "boolean" ? d.dry_run : scanMode === "preview",
      };
    });
  });

  $effect(() => {
    if (paperWorkflowModal.open && !wasOpen) {
      wasOpen = true; loadedTab = ""; errorMsg = ""; addedSummary = null; inboxDoneCount = null; scanResult = null; scanProgress = null;
      if (paperWorkflowModal.initialQuery) { addInput = paperWorkflowModal.initialQuery; remoteQuery = paperWorkflowModal.initialQuery; }
    } else if (!paperWorkflowModal.open) {
      wasOpen = false; loadedTab = "";
    }
  });

  $effect(() => {
    if (!paperWorkflowModal.open || paperWorkflowModal.tab === loadedTab) return;
    loadedTab = paperWorkflowModal.tab;
    if (loadedTab === "inbox") void scanInbox();
    else if (loadedTab === "duplicates") void scanDuplicates();
  });
</script>

{#if paperWorkflowModal.open}
  <Dialog label="References tools" center onclose={handleClose} testid="paper-workflows-modal">
    <div class="pw-modal">
      <header class="pw-head">
        <div class="pw-title"><Icon name="library" size={16} /> <strong>References tools</strong></div>
        <div class="kandinsky-seg pw-tabs" role="tablist" aria-label="References workflow tabs" tabindex="-1" onkeydown={onTabKeyDown}>
          <button type="button" role="tab" id="pw-tab-add" data-testid="paper-tab-add" aria-controls="pw-panel-add" aria-selected={paperWorkflowModal.tab === "add"} class:on={paperWorkflowModal.tab === "add"} onclick={() => switchTab("add")}>
            <Icon name="plus" size={13} /> <span>Add or search</span>
          </button>
          <button type="button" role="tab" id="pw-tab-inbox" data-testid="paper-tab-inbox" aria-controls="pw-panel-inbox" aria-selected={paperWorkflowModal.tab === "inbox"} class:on={paperWorkflowModal.tab === "inbox"} onclick={() => switchTab("inbox")}>
            <Icon name="inbox" size={13} /> <span>Drop inbox</span>
          </button>
          <button type="button" role="tab" id="pw-tab-duplicates" data-testid="paper-tab-duplicates" aria-controls="pw-panel-duplicates" aria-selected={paperWorkflowModal.tab === "duplicates"} class:on={paperWorkflowModal.tab === "duplicates"} onclick={() => switchTab("duplicates")}>
            <Icon name="pages" size={13} /> <span>Duplicates</span>
          </button>
          <button type="button" role="tab" id="pw-tab-scan" data-testid="paper-tab-scan" aria-controls="pw-panel-scan" aria-selected={paperWorkflowModal.tab === "scan"} class:on={paperWorkflowModal.tab === "scan"} onclick={() => switchTab("scan")}>
            <Icon name="folder-open" size={13} /> <span>Scan folders</span>
          </button>
        </div>
        <button type="button" class="icon-btn" aria-label="Close references tools" disabled={addingRef || inboxOrganizing || Boolean(mergingGroupId) || scanBusy} onclick={handleClose}><Icon name="close" size={15} /></button>
      </header>

      <div class="pw-body scroll">
        {#if errorMsg}
          <div class="kandinsky-notice error" role="alert"><strong>Action failed</strong><span>{errorMsg}</span></div>
        {/if}

        {#if paperWorkflowModal.tab === "add"}
          <div class="panel" id="pw-panel-add" role="tabpanel" aria-labelledby="pw-tab-add" data-testid="add-search-panel">
            <div class="field-group">
              <label class="field-label" for="pw-add-textarea">Identifier, BibTeX, or RIS</label>
              <textarea id="pw-add-textarea" rows={3} data-testid="paper-add-input"
                placeholder="10.1103/PhysRevLett.77.3865, arXiv:2401.12345v2, ISBN, link, or paste @article / TY  - RIS"
                bind:value={addInput} disabled={addingRef}
                onkeydown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void submitAdd(); } }}></textarea>
              <div class="row-between">
                <span class="hint">Preserves explicit arXiv versions (<code>v2</code>) and resolves open-access PDFs</span>
                <button type="button" class="btn primary" data-testid="paper-add-submit" disabled={addingRef || !addInput.trim()} onclick={() => void submitAdd()}>
                  {addingRef ? "Adding…" : "Add reference"}
                </button>
              </div>
            </div>

            {#if addedSummary}
              <div class="added-banner" data-testid="paper-added-banner">
                <Icon name="check" size={14} />
                <div class="added-text"><strong>{addedSummary.key}</strong><span>{addedSummary.title}</span></div>
                <div class="row-actions">
                  <button type="button" class="btn btn-ghost" onclick={() => { void openReadingNote(addedSummary!.key); handleClose(); }}>Open note</button>
                  {#if addedSummary.pdf}
                    <button type="button" class="btn btn-ghost" onclick={() => { openPath(addedSummary!.pdf!); handleClose(); }}>Open PDF</button>
                  {/if}
                </div>
              </div>
            {/if}

            <div class="field-group">
              <label class="field-label" for="pw-remote-search">Search live scholarly indexes</label>
              <div class="search-bar">
                <select aria-label="Search index" data-testid="paper-remote-source" bind:value={remoteSource}>
                  {#each SOURCES as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
                </select>
                <input id="pw-remote-search" type="search" data-testid="paper-remote-query" placeholder="Search title, author, or topic…" bind:value={remoteQuery}
                  onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); void runRemoteSearch(); } }} />
                <button type="button" class="btn btn-ghost" data-testid="paper-remote-search-btn" disabled={searchingRemote || !remoteQuery.trim()} onclick={() => void runRemoteSearch()}>
                  {searchingRemote ? "Searching…" : "Search"}
                </button>
              </div>

              {#if remoteHits.length > 0}
                <div class="hit-list">
                  {#each remoteHits as hit (hit.uid)}
                    <article class="hit-card" data-testid="paper-remote-result">
                      <div class="hit-main">
                        <strong class="hit-title">{hit.title}</strong>
                        <span class="hit-sub">{[hit.authors, hit.year, hit.venue].filter(Boolean).join(" · ")}</span>
                        <div class="chip-row">
                          {#if hit.arxiv}<span class="chip">arXiv:{hit.arxiv}</span>{/if}
                          {#if hit.doi}<span class="chip">doi:{hit.doi}</span>{/if}
                        </div>
                      </div>
                      {#if addedHitKeys[hit.uid]}
                        <button type="button" class="btn btn-ghost" onclick={() => { void openReadingNote(addedHitKeys[hit.uid]); handleClose(); }}>{addedHitKeys[hit.uid]}</button>
                      {:else}
                        <button type="button" class="btn primary" data-testid="paper-remote-add-btn" disabled={!hit.addId || addingHitUid === hit.uid} onclick={() => void addRemoteHit(hit)}>
                          {addingHitUid === hit.uid ? "Adding…" : "Add"}
                        </button>
                      {/if}
                    </article>
                  {/each}
                </div>
              {:else if remoteSearched && !searchingRemote}
                <p class="kandinsky-empty">No matching papers returned by {SOURCES.find((s) => s.id === remoteSource)?.label}</p>
              {/if}
            </div>

            <footer class="bookmarklet-strip">
              <div class="bm-info"><Icon name="globe" size={14} /> <span>Browser without Zotero Connector? Capture any open article tab via <code>kandinsky://capture-paper</code></span></div>
              <button type="button" class="btn btn-ghost" data-testid="copy-bookmarklet-btn" onclick={() => void copyBookmarklet()}>
                <Icon name="copy" size={13} /> <span>Copy capture bookmarklet</span>
              </button>
            </footer>
          </div>

        {:else if paperWorkflowModal.tab === "inbox"}
          <div class="panel" id="pw-panel-inbox" role="tabpanel" aria-labelledby="pw-tab-inbox" data-testid="inbox-triage-panel">
            <div class="meta-strip">
              <div class="meta-pairs"><span>Inbox: <code>{watchInbox || "not configured"}</code></span> <span>Rename: <code>{renameFormat}</code></span></div>
              <button type="button" class="btn btn-ghost" data-testid="inbox-rescan-btn" disabled={inboxLoading} onclick={() => void scanInbox()}>
                <Icon name="refresh" size={13} /> <span>{inboxLoading ? "Scanning…" : "Rescan inbox"}</span>
              </button>
            </div>

            {#if !inboxConfigured && !inboxLoading}
              <div class="kandinsky-notice" data-testid="inbox-unconfigured-notice">
                <strong>No drop inbox folder configured yet</strong>
                <span>Set <strong>Shared PDF pool &amp; inbox</strong> (e.g. <code>../Papers</code> and <code>../Papers/Sort</code>) in Settings → Plugins → Catalog · Science.</span>
              </div>
            {/if}

            {#if inboxDoneCount !== null}
              <div class="added-banner" data-testid="inbox-organized-banner">
                <Icon name="check" size={14} /> <span>Organized <strong>{inboxDoneCount}</strong> PDF{inboxDoneCount === 1 ? "" : "s"} into library</span>
              </div>
            {/if}

            <div class="sub-row">
              <label class="field-label" for="pw-inbox-subfolder">Destination subfolder</label>
              <input id="pw-inbox-subfolder" type="text" list="pw-subfolder-presets" data-testid="inbox-subfolder-input" placeholder="Optional subfolder inside {externalRoot}" bind:value={inboxSubfolder} />
              <datalist id="pw-subfolder-presets">{#each subfolderPresets as preset (preset)}<option value={preset}></option>{/each}</datalist>
            </div>

            {#if inboxItems.length > 0}
              <div class="inbox-list">
                {#each inboxItems as item (item.id)}
                  <label class="inbox-card" data-testid="inbox-pdf-row">
                    <input type="checkbox" class="kandinsky-check" bind:checked={inboxSelected[item.id]} />
                    <div class="hit-main">
                      <div class="row-between">
                        <strong class="hit-title">{item.title}</strong>
                        {#if item.duplicateKey}<span class="chip warn"><Icon name="warning" size={11} /> Already in library ({item.duplicateKey})</span>{/if}
                      </div>
                      <span class="hit-sub">{[item.authors, item.year, item.name].filter(Boolean).join(" · ")}</span>
                      <div class="chip-row">
                        {#if item.doi}<span class="chip">doi:{item.doi}</span>{/if}
                        {#if item.arxiv}<span class="chip">arXiv:{item.arxiv}</span>{/if}
                        <code class="dest-preview">→ {previewDest(item)}</code>
                      </div>
                    </div>
                  </label>
                {/each}
              </div>
              <div class="row-between">
                <span class="hint">{selectedInboxCount} of {inboxItems.length} PDFs selected</span>
                <button type="button" class="btn primary" data-testid="inbox-organize-btn" disabled={inboxOrganizing || selectedInboxCount === 0} onclick={() => void organizeSelected()}>
                  {inboxOrganizing ? "Organizing…" : "Organize selected PDFs"}
                </button>
              </div>
            {:else if inboxConfigured && !inboxLoading}
              <p class="kandinsky-empty">Drop inbox <code>{watchInbox}</code> is clean — no unfiled PDFs waiting</p>
            {/if}
          </div>

        {:else if paperWorkflowModal.tab === "duplicates"}
          <div class="panel" id="pw-panel-duplicates" role="tabpanel" aria-labelledby="pw-tab-duplicates" data-testid="duplicates-panel">
            <div class="meta-strip">
              <div class="dup-checks">
                <label class="inline-check">
                  <input type="checkbox" class="kandinsky-check" data-testid="dup-relink-vault" bind:checked={relinkVault} />
                  <span>Update <code>[[old_citekey]]</code> and <code>{"\\cite{old_citekey}"}</code> links across vault</span>
                </label>
                <label class="inline-check">
                  <input type="checkbox" class="kandinsky-check" data-testid="dup-trash-pdf" bind:checked={trashDuplicatePdf} />
                  <span>Move duplicate vault PDF copy to trash</span>
                </label>
              </div>
              <button type="button" class="btn btn-ghost" data-testid="duplicates-scan-btn" disabled={dupsLoading} onclick={() => void scanDuplicates()}>
                <Icon name="refresh" size={13} /> <span>{dupsLoading ? "Scanning…" : "Scan for duplicates"}</span>
              </button>
            </div>

            {#if dupGroups.length > 0}
              <div class="dup-list">
                {#each dupGroups as group (group.id)}
                  <section class="dup-card" data-testid="duplicate-group-card">
                    <div class="row-between">
                      <div class="chip-row">{#each group.signals as sig (sig)}<span class="chip accent">{sig}</span>{/each}</div>
                      <button type="button" class="btn primary" data-testid="dup-merge-btn" disabled={mergingGroupId === group.id} onclick={() => void mergeGroup(group)}>
                        {mergingGroupId === group.id ? "Merging…" : "Merge into primary"}
                      </button>
                    </div>
                    <div class="cmp-scroll">
                      <table class="cmp-table">
                        <thead>
                          <tr>
                            <th>Field</th>
                            {#each group.entries as entry (entry.key)}
                              <th>
                                <label class="prim-pick">
                                  <input type="radio" name={`prim-${group.id}`} value={entry.key} bind:group={primaryByGroup[group.id]} />
                                  <code>{entry.key}</code>
                                  {#if primaryByGroup[group.id] === entry.key}<span class="chip ok">Primary</span>{/if}
                                </label>
                              </th>
                            {/each}
                          </tr>
                        </thead>
                        <tbody>
                          {#each COMPARE_FIELDS as f (f.key)}
                            {#if group.entries.some((e) => e[f.key])}
                              <tr class:diff={fieldDiffers(group.entries, f.key)}>
                                <td class="cmp-lbl">{f.label}</td>
                                {#each group.entries as entry (entry.key)}<td>{entry[f.key] || "—"}</td>{/each}
                              </tr>
                            {/if}
                          {/each}
                        </tbody>
                      </table>
                    </div>
                  </section>
                {/each}
              </div>
            {:else if !dupsLoading}
              <p class="kandinsky-empty">No duplicate references detected across DOI, arXiv, ISBN, PDF hash, or title + author</p>
            {/if}
          </div>

        {:else}
          <div class="panel" id="pw-panel-scan" role="tabpanel" aria-labelledby="pw-tab-scan" data-testid="scan-folders-panel">
            <div class="scan-controls">
              <div class="field-group">
                <label class="field-label" for="pw-scan-root">Folder filter (optional)</label>
                <input id="pw-scan-root" type="text" data-testid="scan-root-input" placeholder="../Library/Papers" bind:value={scanRoot} disabled={scanBusy} spellcheck="false" />
              </div>
              <div class="field-group">
                <label class="field-label" for="pw-scan-max-lookups">Max lookups</label>
                <input id="pw-scan-max-lookups" type="number" min={0} step={1} data-testid="scan-max-lookups" placeholder="50" bind:value={scanMaxLookups} disabled={scanBusy} />
              </div>
              <div class="field-group">
                <label class="field-label" for="pw-scan-rate-limit">Rate limit (ms)</label>
                <input id="pw-scan-rate-limit" type="number" min={0} step={50} data-testid="scan-rate-limit" placeholder="250" bind:value={scanRateLimitMs} disabled={scanBusy} />
              </div>
            </div>

            <div class="row-between">
              <span class="hint">Scans configured external PDF folders (e.g. <code>../Library/Papers</code>, <code>../Library/Books</code>) and derives collections from subfolders</span>
              <div class="row-actions">
                <button type="button" class="btn btn-ghost" data-testid="scan-preview-btn" disabled={scanBusy} onclick={() => void runScanFolders(true)}>
                  {scanMode === "preview" ? "Previewing…" : "Preview scan…"}
                </button>
                <button type="button" class="btn primary" data-testid="scan-sync-btn" disabled={scanBusy} onclick={() => void runScanFolders(false)}>
                  {scanMode === "sync" ? "Syncing…" : "Sync folders"}
                </button>
              </div>
            </div>

            <div class="scan-progress-box" data-testid="scan-progress-box">
              {#if scanBusy || scanResult}
                <progress class="scan-progress" class:done={!scanBusy && Boolean(scanResult)} value={scanProgressValue} max={scanProgressMax}></progress>
              {/if}
              <div class="scan-status" role="status" aria-live="polite" data-testid="scan-status">{scanStatusText}</div>
            </div>

            {#if scanResult}
              <section class="scan-report" class:applied={!scanResult.dry_run} data-testid="scan-report" data-mode={scanResult.dry_run ? "dry-run" : "applied"}>
                <div class="row-between">
                  <div class="scan-report-title">
                    <Icon name={scanResult.dry_run ? "eye" : "check"} size={14} />
                    <strong>{scanResult.dry_run ? "Dry-run preview (no changes written)" : "External folders synced"}</strong>
                  </div>
                  <div class="scan-report-meta">
                    {#each scanResult.roots_scanned as rootPath, rIdx (`${rootPath}-${rIdx}`)}
                      <span class="chip"><Icon name="folder" size={11} /> {rootPath}</span>
                    {/each}
                    <button type="button" class="btn btn-ghost" data-testid="scan-clear-btn" disabled={scanBusy} onclick={() => { scanResult = null; scanProgress = null; }}>
                      Clear
                    </button>
                  </div>
                </div>

                <div class="scan-stat-grid">
                  <div class="stat-cell"><span class="stat-num" data-testid="scan-count-total">{scanResult.total_pdfs}</span><span class="stat-lbl">Total</span></div>
                  <div class="stat-cell"><span class="stat-num" data-testid="scan-count-created">{scanResult.created}</span><span class="stat-lbl">New</span></div>
                  <div class="stat-cell"><span class="stat-num" data-testid="scan-count-moved">{scanResult.moved}</span><span class="stat-lbl">Moved</span></div>
                  <div class="stat-cell"><span class="stat-num" data-testid="scan-count-updated">{scanResult.updated}</span><span class="stat-lbl">Updated</span></div>
                  <div class="stat-cell"><span class="stat-num" data-testid="scan-count-unchanged">{scanResult.unchanged}</span><span class="stat-lbl">Unchanged</span></div>
                  <div class="stat-cell"><span class="stat-num" data-testid="scan-count-errors">{scanResult.errors.length}</span><span class="stat-lbl">Errors</span></div>
                </div>

                {#if scanResult.errors.length > 0}
                  <ul class="scan-error-list" data-testid="scan-errors-list">
                    {#each scanResult.errors as errLine, idx (idx)}
                      <li><Icon name="warning" size={12} /> <span>{errLine}</span></li>
                    {/each}
                  </ul>
                {/if}

                {#if scanResult.items.length > 0}
                  <div class="scan-items-list" data-testid="scan-items-list">
                    {#each scanResult.items as item (item.uid)}
                      {@const kindInfo = scanKindBadge(item.kind, item.bibtex_type)}
                      <article class="scan-item-card" data-testid="scan-item-row">
                        <div class="hit-main">
                          <div class="row-between">
                            <div class="scan-item-head">
                              <span class="chip scan-kind" class:book={kindInfo.isBook} data-testid="scan-item-kind">
                                <Icon name={kindInfo.isBook ? "library" : "file-text"} size={11} />
                                <span>{kindInfo.label}</span>
                              </span>
                              <span class="chip {scanActionClass(item.action)}" data-testid="scan-item-action">{item.action}</span>
                              {#if item.citekey}<code class="scan-citekey" data-testid="scan-item-citekey">{item.citekey}</code>{/if}
                            </div>
                            {#if item.source}<span class="chip" data-testid="scan-item-source">{item.source}</span>{/if}
                          </div>
                          <strong class="hit-title" data-testid="scan-item-title">{item.title}</strong>
                          {#if item.collections.length > 0 || item.pdf_ref || item.pdf_path}
                            <div class="chip-row">
                              {#each item.collections as coll, cIdx (`${coll}-${cIdx}`)}
                                <span class="chip" data-testid="scan-item-collection"><Icon name="folder" size={11} /> {coll}</span>
                              {/each}
                              {#if item.pdf_ref || item.pdf_path}
                                <code class="scan-pdf-path" data-testid="scan-item-pdf" title={item.pdf_path || item.pdf_ref}>{item.pdf_ref || item.pdf_path}</code>
                              {/if}
                            </div>
                          {/if}
                          {#if item.error}
                            <p class="scan-item-error" data-testid="scan-item-error">{item.error}</p>
                          {/if}
                        </div>
                      </article>
                    {/each}
                  </div>
                {:else if scanResult.roots_scanned.length === 0}
                  <div class="kandinsky-notice">
                    <strong>No external PDF folders configured yet</strong>
                    <span>Set <strong>Shared external PDF folders</strong> (e.g. <code>../Library/Papers</code>, <code>../Library/Books</code>) in Settings → Plugins → Catalog · Science.</span>
                  </div>
                {:else}
                  <p class="kandinsky-empty">No PDFs found in {scanResult.roots_scanned.join(", ")}</p>
                {/if}
              </section>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </Dialog>
{/if}

<style>
  .pw-modal { width: min(860px, 96vw); max-height: 88vh; display: flex; flex-direction: column; background: var(--bg-elev); border: 1px solid var(--border-strong); border-radius: var(--radius-lg); box-shadow: var(--shadow-pop); overflow: hidden; }
  .pw-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 10px 14px; border-bottom: 1px solid var(--border); background: var(--bg-alt); }
  .pw-title { display: inline-flex; align-items: center; gap: 8px; font-size: calc(14px * var(--ui-scale, 1)); color: var(--heading); }
  .pw-tabs { flex-wrap: nowrap; overflow-x: auto; max-width: 100%; scrollbar-width: thin; }
  .pw-tabs > button { flex: 0 0 auto; }
  .pw-body { padding: 14px 16px 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
  .panel { display: flex; flex-direction: column; gap: 13px; }
  .field-group { display: flex; flex-direction: column; gap: 6px; }
  .field-label { font-size: calc(11px * var(--ui-scale, 1)); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
  .hint { font-size: calc(11.5px * var(--ui-scale, 1)); color: var(--text-faint); }
  .row-between { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .row-actions { display: inline-flex; align-items: center; gap: 6px; }
  textarea, .search-bar input, .search-bar select, .sub-row input { border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--bg); color: var(--text); font-size: calc(12.5px * var(--ui-scale, 1)); padding: 7px 10px; outline: none; }
  textarea { font-family: var(--font-mono); resize: vertical; line-height: 1.45; }
  textarea:focus, .search-bar input:focus, .search-bar select:focus, .sub-row input:focus { border-color: var(--accent); }
  .search-bar { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
  .search-bar input { flex: 1; min-width: 180px; }
  .sub-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .sub-row input { flex: 1; min-width: 200px; font-family: var(--font-mono); }
  .added-banner { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; padding: 8px 11px; border-radius: var(--radius); background: var(--green-soft); border: 1px solid color-mix(in srgb, var(--green) 42%, var(--border)); color: var(--text); }
  .added-text { flex: 1; min-width: 0; display: flex; flex-direction: column; font-size: calc(12.5px * var(--ui-scale, 1)); }
  .added-text span { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hit-list, .inbox-list, .dup-list { display: flex; flex-direction: column; gap: 8px; }
  .hit-card, .inbox-card, .dup-card { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 9px 11px; border-radius: var(--radius); background: var(--bg-alt); border: 1px solid var(--border); }
  .dup-card { flex-direction: column; align-items: stretch; }
  .inbox-card { justify-content: flex-start; cursor: pointer; }
  .inbox-card input { margin-top: 3px; flex: none; }
  .hit-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .hit-title { font-size: calc(13px * var(--ui-scale, 1)); color: var(--heading); line-height: 1.35; }
  .hit-sub { font-size: calc(12px * var(--ui-scale, 1)); color: var(--text-muted); }
  .chip-row { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 2px; }
  .chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px; border-radius: 999px; font-size: calc(11px * var(--ui-scale, 1)); font-family: var(--font-mono); background: var(--bg-elev); border: 1px solid var(--border-strong); color: var(--text-muted); }
  .chip.accent { color: var(--accent); background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 35%, var(--border)); }
  .chip.ok { color: var(--green); background: var(--green-soft); border-color: color-mix(in srgb, var(--green) 38%, var(--border)); }
  .chip.warn { color: var(--yellow); background: var(--yellow-soft); border-color: color-mix(in srgb, var(--yellow) 40%, var(--border)); }
  .chip.err { color: var(--red); background: var(--red-soft); border-color: color-mix(in srgb, var(--red) 40%, var(--border)); }
  .chip.scan-kind.book { color: var(--heading); background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 38%, var(--border)); }
  .dest-preview { font-size: calc(11.5px * var(--ui-scale, 1)); color: var(--accent); }
  .meta-strip, .bookmarklet-strip { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 8px 10px; border-radius: var(--radius); background: var(--bg-alt); border: 1px solid var(--border); font-size: calc(12px * var(--ui-scale, 1)); color: var(--text-muted); }
  .meta-pairs, .bm-info { display: inline-flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .pw-modal .btn { display: inline-flex; align-items: center; gap: 5px; }
  .dup-checks { display: flex; flex-direction: column; gap: 5px; }
  .inline-check { display: inline-flex; align-items: center; gap: 7px; color: var(--text); cursor: pointer; }
  .cmp-scroll { overflow-x: auto; }
  .cmp-table { width: 100%; border-collapse: collapse; font-size: calc(12px * var(--ui-scale, 1)); }
  .cmp-table th, .cmp-table td { padding: 5px 8px; border-top: 1px solid var(--border); text-align: left; vertical-align: top; }
  .cmp-table th { border-top: 0; color: var(--heading); background: var(--bg-elev); }
  .cmp-lbl { width: 92px; color: var(--text-muted); font-weight: 600; white-space: nowrap; }
  .cmp-table tr.diff td { background: color-mix(in srgb, var(--yellow) 10%, var(--bg)); }
  .prim-pick { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .scan-controls { display: grid; grid-template-columns: minmax(0, 1.8fr) minmax(105px, 0.8fr) minmax(115px, 0.8fr); gap: 8px; }
  .scan-controls .field-group { min-width: 0; }
  .scan-controls input { border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--bg); color: var(--text); font-size: calc(12.5px * var(--ui-scale, 1)); font-family: var(--font-mono); padding: 7px 10px; outline: none; min-width: 0; width: 100%; }
  .scan-controls input:focus { border-color: var(--accent); }
  .scan-progress-box { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border-radius: var(--radius); background: var(--bg-alt); border: 1px solid var(--border); }
  progress.scan-progress { --scan-track: var(--bg); --scan-fill: var(--accent); display: block; width: 100%; height: 6px; appearance: none; -webkit-appearance: none; border: 0 solid; border-radius: 999px; background-color: var(--scan-track); overflow: clip; }
  progress.scan-progress.done { --scan-fill: var(--green); }
  progress.scan-progress::-webkit-progress-bar { background-color: var(--scan-track); border-radius: 999px; }
  progress.scan-progress::-webkit-progress-value { background-color: var(--scan-fill); border-radius: 999px; }
  progress.scan-progress::-moz-progress-bar { background-color: var(--scan-fill); border-radius: 999px; }
  .scan-status { font-size: calc(12px * var(--ui-scale, 1)); font-variant-numeric: tabular-nums; color: var(--text-muted); overflow-wrap: anywhere; }
  .scan-report { display: flex; flex-direction: column; gap: 10px; padding: 11px; border-radius: var(--radius); background: var(--bg-alt); border: 1px solid var(--border-strong); }
  .scan-report.applied { border-color: color-mix(in srgb, var(--green) 45%, var(--border)); background: color-mix(in srgb, var(--green) 6%, var(--bg)); }
  .scan-report-title { display: inline-flex; align-items: center; gap: 7px; font-size: calc(13px * var(--ui-scale, 1)); color: var(--heading); }
  .scan-report-meta { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
  .scan-stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(98px, 1fr)); gap: 7px; }
  .stat-cell { background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 7px 9px; display: flex; flex-direction: column; gap: 2px; }
  .stat-num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: calc(16px * var(--ui-scale, 1)); font-weight: 700; color: var(--heading); }
  .stat-lbl { font-size: calc(11.5px * var(--ui-scale, 1)); color: var(--text-muted); line-height: 1.35; }
  .scan-error-list { margin: 0; padding: 8px 10px; list-style: none; border-radius: var(--radius-sm); background: var(--red-soft); border: 1px solid color-mix(in srgb, var(--red) 35%, var(--border)); display: flex; flex-direction: column; gap: 4px; font-size: calc(12px * var(--ui-scale, 1)); color: var(--text); }
  .scan-error-list li { display: flex; align-items: flex-start; gap: 6px; overflow-wrap: anywhere; }
  .scan-items-list { display: flex; flex-direction: column; gap: 7px; }
  .scan-item-card { display: flex; align-items: flex-start; gap: 10px; padding: 9px 11px; border-radius: var(--radius); background: var(--bg-elev); border: 1px solid var(--border); min-width: 0; }
  .scan-item-head { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; min-width: 0; }
  .scan-citekey { font-size: calc(11.5px * var(--ui-scale, 1)); color: var(--heading); }
  .scan-pdf-path { font-size: calc(11.5px * var(--ui-scale, 1)); color: var(--accent); overflow-wrap: anywhere; }
  .scan-item-error { margin: 2px 0 0; font-size: calc(11.5px * var(--ui-scale, 1)); color: var(--red); overflow-wrap: anywhere; }
  @media (max-width: 620px) { .scan-controls { grid-template-columns: 1fr; } }
</style>
