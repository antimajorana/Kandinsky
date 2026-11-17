<script lang="ts">
  // Two-step lossless Zotero 6 / 7 / 8 migration wizard: profile discovery, dry-run preview, and import.
  import Dialog from "./Dialog.svelte";
  import Icon from "./Icon.svelte";
  import { api } from "../lib/api";
  import { openLibraries } from "../lib/libraries.svelte";
  import { closeZoteroImportModal, zoteroModal } from "../lib/paper-modals.svelte";
  import { toast } from "../lib/state.svelte";
  import { errReason } from "../lib/text";
  import { refreshVault } from "../lib/vault";

  let { onclose }: { onclose?: () => void } = $props();

  interface ZoteroDiscovery {
    found: boolean; profile: string; dataDir: string;
    baseAttachmentPath: string; zotmoovFolder: string;
    betterBibtex: boolean; bbtCitekeys: number | null;
  }
  interface ZoteroPreviewItem { key: string; title: string; year: string; status: string; pdfMode: string }
  interface ZoteroReport {
    dryRun: boolean; created: number; updated: number; unchanged: number; itemsTotal: number;
    linkedInPlace: number; copiedFiles: number; collectionsCount: number; notesCount: number;
    relationsCount: number; annotationsCount: number; trashSkipped: number;
    warnings: string[]; sampleItems: ZoteroPreviewItem[];
  }

  let dataDir = $state("");
  let baseAttachmentPath = $state("");
  let copyStoragePdfs = $state(true);
  let discovering = $state(false);
  let discovery = $state<ZoteroDiscovery | null>(null);
  let busy = $state(false);
  let busyMode = $state<"preview" | "apply" | "">("");
  let errorMsg = $state("");
  let report = $state<ZoteroReport | null>(null);
  let wasOpen = false;

  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

  function parseDiscovery(raw: unknown): ZoteroDiscovery {
    const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const data = str(o.data_dir) || str(o.zotero_dir);
    const base = str(o.base_attachment_path) || str(o.linked_attachment_base_dir);
    const zotmoov = str(o.zotmoov_folder) || str(o.zotmoov_dir) || str(o.zotmoov_dst_dir);
    const bbt = Boolean(o.better_bibtex || o.has_better_bibtex || o.bbt_found || str(o.better_bibtex_path) || str(o.bbt_path));
    const bbtCitekeys = typeof o.bbt_citekeys === "number" ? o.bbt_citekeys : null;
    const profile = str(o.profile_name) || str(o.profile) || str(o.profile_dir);
    return { found: Boolean(o.found ?? o.detected ?? (data || profile)), profile, dataDir: data, baseAttachmentPath: base, zotmoovFolder: zotmoov, betterBibtex: bbt, bbtCitekeys };
  }

  function parseReport(raw: unknown, fallbackDry: boolean): ZoteroReport {
    const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const dryRun = typeof o.dry_run === "boolean" ? o.dry_run : fallbackDry;
    const created = num(o.imported ?? o.created ?? o.items_created);
    const updated = num(o.updated ?? o.items_updated);
    const hasUnchanged = o.unchanged !== undefined || o.items_unchanged !== undefined;
    const itemsTotal = num(o.items_found ?? o.items_total ?? o.total_items, created + updated + num(o.unchanged ?? o.items_unchanged));
    const unchanged = hasUnchanged ? num(o.unchanged ?? o.items_unchanged) : Math.max(0, itemsTotal - created - updated);
    const warnings: string[] = [];
    for (const key of ["missing_pdfs", "warnings", "missing_files", "collisions"]) {
      const list = o[key];
      if (Array.isArray(list)) {
        for (const item of list) {
          const line = typeof item === "string" ? item : item && typeof item === "object" ? JSON.stringify(item) : "";
          if (line) warnings.push(line);
        }
      }
    }
    const rawSample = Array.isArray(o.sample_items) ? o.sample_items : Array.isArray(o.preview_items) ? o.preview_items : Array.isArray(o.items) ? o.items : [];
    const sampleItems: ZoteroPreviewItem[] = rawSample.length
      ? rawSample.slice(0, 8).map((entry) => {
          const r = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
          return {
            key: str(r.key ?? r.citekey) || "entry",
            title: str(r.title) || "Untitled item",
            year: str(r.year ?? r.date).slice(0, 4),
            status: str(r.status ?? r.action) || (r.created ? "new" : "ready"),
            pdfMode: str(r.pdf_mode ?? r.attachment_mode) || (r.linked ? "linked" : r.pdf ? "pdf" : ""),
          };
        })
      : (Array.isArray(o.citekeys) ? o.citekeys : [])
          .map((ck) => str(ck))
          .filter(Boolean)
          .slice(0, 8)
          .map((key) => ({
            key,
            title: key,
            year: "",
            status: dryRun ? "preview" : "imported",
            pdfMode: "",
          }));
    return {
      dryRun,
      created, updated, unchanged, itemsTotal,
      linkedInPlace: num(o.linked_in_place ?? o.linked_pdfs),
      copiedFiles: num(o.copied_pdfs ?? o.copied_files ?? o.storage_pdfs),
      collectionsCount: num(o.collections_found ?? o.collections_count ?? (Array.isArray(o.collections) ? o.collections.length : o.collections)),
      notesCount: num(o.notes_imported ?? o.notes_count ?? o.reading_notes ?? o.notes),
      relationsCount: num(o.relations_linked ?? o.relations_count ?? o.relations),
      annotationsCount: num(o.annotations_imported ?? o.annotations_count ?? o.pdf_marks_count ?? o.annotations),
      trashSkipped: num(o.trash_skipped ?? o.skipped_trash),
      warnings, sampleItems,
    };
  }

  async function discover(): Promise<void> {
    discovering = true;
    try {
      const d = parseDiscovery(await api.pluginHelper("catalog-papers", "discover_zotero", {}, 30));
      discovery = d;
      if (!dataDir && d.dataDir) dataDir = d.dataDir;
      if (!baseAttachmentPath && (d.baseAttachmentPath || d.zotmoovFolder)) {
        baseAttachmentPath = d.baseAttachmentPath || d.zotmoovFolder;
      }
    } catch {
      discovery = null;
    } finally {
      discovering = false;
    }
  }

  async function runImport(dryRun: boolean): Promise<void> {
    if (busy) return;
    busy = true;
    busyMode = dryRun ? "preview" : "apply";
    errorMsg = "";
    try {
      const raw = await api.pluginHelper(
        "catalog-papers",
        "import_zotero",
        {
          data_dir: dataDir.trim() || undefined,
          base_attachment_path: baseAttachmentPath.trim() || undefined,
          copy_storage_pdfs: copyStoragePdfs,
          dry_run: dryRun,
          apply: !dryRun,
        },
        300,
      );
      const parsed = parseReport(raw, dryRun);
      report = parsed;
      if (!dryRun) {
        window.dispatchEvent(new CustomEvent("kandinsky:papers-changed"));
        void refreshVault().catch(() => {});
        toast("Imported Zotero library", `${parsed.created} new · ${parsed.updated} updated · ${parsed.linkedInPlace} linked in place`, "success");
      }
    } catch (err) {
      errorMsg = errReason(err);
    } finally {
      busy = false;
      busyMode = "";
    }
  }

  function handleClose(): void {
    if (busy) return;
    closeZoteroImportModal();
    onclose?.();
  }

  $effect(() => {
    if (zoteroModal.open && !wasOpen) {
      wasOpen = true;
      errorMsg = "";
      report = null;
      void discover();
    } else if (!zoteroModal.open) {
      wasOpen = false;
    }
  });
</script>

{#if zoteroModal.open}
  <Dialog label="Import from Zotero" center onclose={handleClose} testid="zotero-import-modal">
    <div class="zot-modal">
      <header class="zot-head">
        <div class="zot-title"><Icon name="library" size={16} /> <strong>Import from Zotero</strong></div>
        <button type="button" class="icon-btn" aria-label="Close Zotero import" disabled={busy} onclick={handleClose}>
          <Icon name="close" size={15} />
        </button>
      </header>

      <div class="zot-body scroll">
        <div class="disc-strip" data-testid="zotero-discovery-strip">
          {#if discovering}
            <span class="disc-muted">Detecting local Zotero profile…</span>
          {:else if discovery?.found}
            <span class="badge ok"><Icon name="check" size={12} /> <span>Profile{discovery.profile ? `: ${discovery.profile}` : " detected"}</span></span>
            <span class="badge" class:ok={discovery.betterBibtex}>
              <Icon name={discovery.betterBibtex ? "check" : "circle"} size={11} />
              <span>{discovery.betterBibtex ? `Better BibTeX${discovery.bbtCitekeys !== null ? ` (${discovery.bbtCitekeys} keys)` : " active"}` : "Standard citekeys"}</span>
            </span>
            {#if discovery.zotmoovFolder}
              <span class="badge"><Icon name="folder" size={12} /> <span>ZotMoov: <code>{discovery.zotmoovFolder}</code></span></span>
            {/if}
          {:else}
            <span class="disc-muted">Zotero is read without locking or modifying its database; enter folder paths below if not auto-detected</span>
          {/if}
        </div>

        <div class="field-group">
          <label class="field-label" for="zotero-data-dir-input">Zotero data folder</label>
          <div class="input-row">
            <Icon name="folder" size={14} />
            <input id="zotero-data-dir-input" type="text" data-testid="zotero-data-dir" placeholder="Leave blank for detected Zotero folder" bind:value={dataDir} disabled={busy} />
          </div>
          <span class="field-hint">Folder holding <code>zotero.sqlite</code> and optional <code>better-bibtex.sqlite</code></span>
        </div>

        <div class="field-group">
          <label class="field-label" for="zotero-base-att-input">Linked attachments base folder</label>
          <div class="input-row">
            <Icon name="folder-open" size={14} />
            <input id="zotero-base-att-input" type="text" data-testid="zotero-base-attachment-path" placeholder="e.g. ../Papers" bind:value={baseAttachmentPath} disabled={busy} />
          </div>
          <span class="field-hint">Resolves Zotero <code>attachments:…</code> relative paths from <code>extensions.zotero.baseAttachmentPath</code> or ZotMoov</span>
        </div>

        <label class="check-row">
          <input type="checkbox" class="kandinsky-check" data-testid="zotero-copy-storage-pdfs" bind:checked={copyStoragePdfs} disabled={busy} />
          <span>Copy PDFs stored inside <code>Zotero/storage/</code> into library (linked PDFs in shared folders stay in place with zero copying)</span>
        </label>

        <div class="action-bar">
          <button type="button" class="btn btn-ghost" data-testid="zotero-preview-btn" disabled={busy} onclick={() => void runImport(true)}>
            {busyMode === "preview" ? "Previewing…" : "Preview migration (dry run)"}
          </button>
          <button type="button" class="btn primary" data-testid="zotero-apply-btn" disabled={busy} onclick={() => void runImport(false)}>
            {busyMode === "apply" ? "Importing…" : "Import library"}
          </button>
        </div>

        {#if errorMsg}
          <div class="kandinsky-notice error" role="alert">
            <strong>Could not read Zotero library</strong>
            <span>{errorMsg}</span>
          </div>
        {/if}

        {#if report}
          <section class="report-card" class:applied={!report.dryRun} data-testid="zotero-dry-run-report" data-mode={report.dryRun ? "dry-run" : "applied"}>
            <div class="report-head">
              <div class="report-title">
                <Icon name={report.dryRun ? "eye" : "check"} size={14} />
                <strong>{report.dryRun ? "Dry-run preview (no files written yet)" : "Migration complete"}</strong>
              </div>
              {#if !report.dryRun}
                <button type="button" class="btn btn-ghost" onclick={() => { openLibraries("references"); handleClose(); }}>
                  <span>Open references</span> <Icon name="arrow-right" size={13} />
                </button>
              {/if}
            </div>

            <div class="stat-grid">
              <div class="stat-cell"><span class="stat-num">{report.itemsTotal}</span><span class="stat-lbl">Items ({report.created} new · {report.updated} updated · {report.unchanged} unchanged)</span></div>
              <div class="stat-cell"><span class="stat-num">{report.linkedInPlace}</span><span class="stat-lbl">Linked PDFs kept in place</span></div>
              <div class="stat-cell"><span class="stat-num">{report.copiedFiles}</span><span class="stat-lbl">{report.dryRun ? "Storage PDFs to copy" : "Storage PDFs copied"}</span></div>
              <div class="stat-cell"><span class="stat-num">{report.collectionsCount}</span><span class="stat-lbl">Collections</span></div>
              <div class="stat-cell"><span class="stat-num">{report.notesCount}</span><span class="stat-lbl">Reading notes</span></div>
              <div class="stat-cell"><span class="stat-num">{report.annotationsCount}</span><span class="stat-lbl">PDF annotations → <code>pdf-marks</code></span></div>
              <div class="stat-cell"><span class="stat-num">{report.relationsCount}</span><span class="stat-lbl">Item relations</span></div>
              <div class="stat-cell"><span class="stat-num">{report.trashSkipped}</span><span class="stat-lbl">Trash items skipped</span></div>
            </div>

            {#if report.warnings.length > 0}
              <ul class="warn-list">
                {#each report.warnings as w, idx (idx)}<li><Icon name="warning" size={12} /> <span>{w}</span></li>{/each}
              </ul>
            {/if}

            {#if report.sampleItems.length > 0}
              <div class="sample-wrap">
                <span class="field-label">Sample items</span>
                <div class="sample-list">
                  {#each report.sampleItems as item, idx (`${item.key}-${idx}`)}
                    <div class="sample-row">
                      <code class="sample-key">{item.key}</code>
                      <span class="sample-title">{item.title}</span>
                      {#if item.year}<span class="sample-meta">{item.year}</span>{/if}
                      {#if item.pdfMode}<span class="sample-chip">{item.pdfMode}</span>{/if}
                      <span class="sample-chip">{item.status}</span>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
          </section>
        {/if}
      </div>
    </div>
  </Dialog>
{/if}

<style>
  .zot-modal { width: min(680px, 95vw); max-height: 88vh; display: flex; flex-direction: column; background: var(--bg-elev); border: 1px solid var(--border-strong); border-radius: var(--radius-lg); box-shadow: var(--shadow-pop); overflow: hidden; }
  .zot-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border); background: var(--bg-alt); }
  .zot-title { display: inline-flex; align-items: center; gap: 8px; font-size: calc(14px * var(--ui-scale, 1)); color: var(--heading); }
  .zot-body { padding: 14px 16px 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
  .disc-strip { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 10px; border-radius: var(--radius); background: var(--bg-alt); border: 1px solid var(--border); }
  .disc-muted { font-size: calc(12px * var(--ui-scale, 1)); color: var(--text-muted); }
  .badge { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; font-size: calc(11.5px * var(--ui-scale, 1)); color: var(--text-muted); background: var(--bg-elev); border: 1px solid var(--border-strong); }
  .badge.ok { color: var(--green); background: var(--green-soft); border-color: color-mix(in srgb, var(--green) 38%, var(--border)); }
  .badge code { font-size: calc(11px * var(--ui-scale, 1)); }
  .field-group { display: flex; flex-direction: column; gap: 5px; }
  .field-label { font-size: calc(11px * var(--ui-scale, 1)); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
  .field-hint { font-size: calc(11.5px * var(--ui-scale, 1)); color: var(--text-faint); line-height: 1.4; }
  .input-row { display: flex; align-items: center; gap: 8px; padding: 0 10px; border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--bg); color: var(--text-muted); }
  .input-row:focus-within { border-color: var(--accent); }
  .input-row input { flex: 1; min-width: 0; border: 0; background: transparent; color: var(--text); font-family: var(--font-mono); font-size: calc(12.5px * var(--ui-scale, 1)); padding: 7px 0; outline: none; }
  .check-row { display: flex; align-items: flex-start; gap: 8px; font-size: calc(12.5px * var(--ui-scale, 1)); color: var(--text); line-height: 1.45; cursor: pointer; }
  .check-row input { margin-top: 3px; flex: none; }
  .action-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; padding-top: 2px; }
  .report-card { border: 1px solid var(--border-strong); background: var(--bg-alt); border-radius: var(--radius); padding: 12px; display: flex; flex-direction: column; gap: 10px; }
  .report-card.applied { border-color: color-mix(in srgb, var(--green) 45%, var(--border)); background: color-mix(in srgb, var(--green) 7%, var(--bg)); }
  .report-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .report-title { display: inline-flex; align-items: center; gap: 7px; font-size: calc(13px * var(--ui-scale, 1)); color: var(--heading); }
  .report-head .btn { display: inline-flex; align-items: center; gap: 5px; }
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); gap: 7px; }
  .stat-cell { background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 7px 9px; display: flex; flex-direction: column; gap: 2px; }
  .stat-num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: calc(16px * var(--ui-scale, 1)); font-weight: 700; color: var(--heading); }
  .stat-lbl { font-size: calc(11.5px * var(--ui-scale, 1)); color: var(--text-muted); line-height: 1.35; }
  .warn-list { margin: 0; padding: 8px 10px; list-style: none; border-radius: var(--radius-sm); background: var(--yellow-soft); border: 1px solid color-mix(in srgb, var(--yellow) 35%, transparent); display: flex; flex-direction: column; gap: 4px; font-size: calc(12px * var(--ui-scale, 1)); color: var(--text); }
  .warn-list li { display: flex; align-items: flex-start; gap: 6px; }
  .sample-wrap { display: flex; flex-direction: column; gap: 6px; }
  .sample-list { display: flex; flex-direction: column; gap: 4px; max-height: 170px; overflow-y: auto; }
  .sample-row { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: var(--radius-sm); background: var(--bg-elev); border: 1px solid var(--border); font-size: calc(12px * var(--ui-scale, 1)); }
  .sample-key { color: var(--accent); font-size: calc(11.5px * var(--ui-scale, 1)); flex: none; }
  .sample-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
  .sample-meta { font-variant-numeric: tabular-nums; color: var(--text-muted); flex: none; }
  .sample-chip { padding: 1px 6px; border-radius: 999px; font-size: calc(11px * var(--ui-scale, 1)); background: var(--bg-alt); border: 1px solid var(--border); color: var(--text-muted); flex: none; }
</style>
