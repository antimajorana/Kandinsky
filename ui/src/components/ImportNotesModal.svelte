<script lang="ts">
  // Nootion × Bauhaus Import Notes modal: Notion (.zip / folder), NoteCraft (_node.toml), OneNote (.one / HTML / MD).
  import Dialog from "./Dialog.svelte";
  import Icon from "./Icon.svelte";
  import { api } from "../lib/api";
  import { openPath } from "../lib/dock";
  import type { IconName } from "../lib/panes";
  import { toast } from "../lib/state.svelte";
  import { errReason } from "../lib/text";
  import { importNotesModal, closeImportModal } from "../lib/import-modal.svelte";
  import type { ImportFormat } from "../lib/gen/ImportFormat";
  import type { ImportReport } from "../lib/gen/ImportReport";
  import type { ImportBundleFile } from "../lib/gen/ImportBundleFile";

  let { onclose }: { onclose?: () => void } = $props();

  const FORMAT_CARDS: readonly { id: ImportFormat; title: string; desc: string; icon: IconName }[] = [
    { id: "auto", title: "Auto-detect", desc: "Detect Notion, NoteCraft, or OneNote automatically", icon: "move-in" },
    { id: "notion", title: "Notion Export", desc: ".zip or folder of .md pages + .csv databases", icon: "table" },
    { id: "notecraft", title: "NoteCraft", desc: "_node.toml notebook folder or .zip archive", icon: "notes" },
    { id: "onenote", title: "OneNote", desc: ".one section file, HTML, or Markdown export", icon: "file-text" },
  ];

  let format = $state<ImportFormat>("auto");
  let targetDir = $state("Imported");
  let localPath = $state("");
  let dragOver = $state(false);
  let busy = $state(false);
  let busyLabel = $state("");
  let errorMsg = $state("");
  let report = $state<ImportReport | null>(null);
  let wasOpen = false;

  function webkitDir(node: HTMLInputElement): void {
    node.setAttribute("webkitdirectory", "");
    (node as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory = true;
  }

  function bytesToBase64(bytes: Uint8Array): string {
    const chunks: string[] = [];
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
      chunks.push(String.fromCharCode(...bytes.subarray(i, i + step)));
    }
    return btoa(chunks.join(""));
  }

  function finishImport(res: ImportReport): void {
    report = res;
    const summary = `${res.notes_created} note${res.notes_created === 1 ? "" : "s"}, ${res.bases_created} database${res.bases_created === 1 ? "" : "s"}`;
    toast("Import complete", `${res.detected_format} → ${res.target_dir || "vault root"} (${summary})`, "success");
  }

  async function runArchiveImport(file: File): Promise<void> {
    if (busy) return;
    busy = true;
    busyLabel = `Importing ${file.name}…`;
    errorMsg = "";
    report = null;
    try {
      const res = await api.importArchive(file, {
        format,
        target_dir: targetDir.trim(),
        filename: file.name,
      });
      finishImport(res);
    } catch (err) {
      errorMsg = errReason(err);
    } finally {
      busy = false;
      busyLabel = "";
    }
  }

  async function runBundleImport(fileList: File[]): Promise<void> {
    if (busy || fileList.length === 0) return;
    busy = true;
    busyLabel = `Reading ${fileList.length} file${fileList.length === 1 ? "" : "s"}…`;
    errorMsg = "";
    report = null;
    try {
      const files: ImportBundleFile[] = [];
      for (const f of fileList) {
        const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
        const buf = new Uint8Array(await f.arrayBuffer());
        files.push({ rel_path: rel.replace(/\\/g, "/"), data_base64: bytesToBase64(buf) });
      }
      busyLabel = `Importing ${files.length} file${files.length === 1 ? "" : "s"} into vault…`;
      const res = await api.importBundle({
        format,
        target_dir: targetDir.trim(),
        files,
      });
      finishImport(res);
    } catch (err) {
      errorMsg = errReason(err);
    } finally {
      busy = false;
      busyLabel = "";
    }
  }

  async function runLocalPathImport(): Promise<void> {
    const src = localPath.trim();
    if (busy || !src) return;
    busy = true;
    busyLabel = `Importing from ${src}…`;
    errorMsg = "";
    report = null;
    try {
      const res = await api.importPath({
        source_path: src,
        format,
        target_dir: targetDir.trim(),
      });
      finishImport(res);
    } catch (err) {
      errorMsg = errReason(err);
    } finally {
      busy = false;
      busyLabel = "";
    }
  }

  function onFilePicked(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (file) void runArchiveImport(file);
  }

  function onFolderPicked(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const picked = input.files ? Array.from(input.files) : [];
    input.value = "";
    if (picked.length > 0) void runBundleImport(picked);
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault();
    dragOver = false;
    if (busy) return;
    const dropped = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    if (dropped.length === 1) void runArchiveImport(dropped[0]);
    else if (dropped.length > 1) void runBundleImport(dropped);
  }

  function handleClose(): void {
    if (busy) return;
    closeImportModal();
    onclose?.();
  }

  const firstOpenTarget = $derived(report?.first_open_path || report?.created_paths?.[0] || "");

  $effect(() => {
    if (importNotesModal.open && !wasOpen) {
      wasOpen = true;
      format = "auto";
      targetDir = importNotesModal.targetDir || "Imported";
      localPath = "";
      errorMsg = "";
      report = null;
    } else if (!importNotesModal.open) {
      wasOpen = false;
    }
  });
</script>

{#if importNotesModal.open}
  <Dialog label="Import notes" center onclose={handleClose} testid="import-notes-modal">
    <div class="imp-modal">
      <header class="imp-head">
        <div class="imp-title">
          <Icon name="move-in" size={16} />
          <strong>Import Notes &amp; Databases</strong>
        </div>
        <button type="button" class="icon-btn" aria-label="Close import modal" disabled={busy} onclick={handleClose}>
          <Icon name="close" size={15} />
        </button>
      </header>

      <div class="imp-body">
        <!-- Source format cards -->
        <div class="field-group">
          <span class="field-label">Source format</span>
          <div class="fmt-grid" role="radiogroup" aria-label="Import source format">
            {#each FORMAT_CARDS as card (card.id)}
              <button
                type="button"
                class="fmt-card"
                class:active={format === card.id}
                disabled={busy}
                onclick={() => (format = card.id)}
              >
                <div class="fmt-card-top">
                  <Icon name={card.icon} size={14} />
                  <strong>{card.title}</strong>
                </div>
                <span class="fmt-desc">{card.desc}</span>
              </button>
            {/each}
          </div>
        </div>

        <!-- Target vault folder -->
        <div class="field-group">
          <label class="field-label" for="kandinsky-import-target">Target vault folder</label>
          <div class="target-row">
            <Icon name="folder" size={14} />
            <input
              id="kandinsky-import-target"
              type="text"
              data-testid="import-target-dir"
              placeholder="Imported (or leave blank for vault root)"
              bind:value={targetDir}
              disabled={busy}
            />
          </div>
        </div>

        <!-- 1 & 2: Dropzone + File Picker + Folder Picker -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="dropzone"
          class:drag={dragOver}
          class:disabled={busy}
          ondragover={(e) => { e.preventDefault(); if (!busy) dragOver = true; }}
          ondragleave={() => (dragOver = false)}
          ondrop={onDrop}
        >
          {#if busy}
            <div class="spinner-row" role="status">
              <span class="spinner" aria-hidden="true"></span>
              <span>{busyLabel || "Importing notes…"}</span>
            </div>
          {:else}
            <p class="drop-title">Drop a <code>.zip</code>, <code>.one</code>, <code>.html</code>, <code>.md</code>, or <code>.csv</code> here</p>
            <div class="picker-btns">
              <label class="pick-btn primary">
                <Icon name="file" size={13} />
                <span>Pick File / .zip / .one</span>
                <input
                  type="file"
                  class="sr-file"
                  accept=".zip,.one,.html,.htm,.md,.csv"
                  data-testid="import-file-input"
                  onchange={onFilePicked}
                />
              </label>
              <label class="pick-btn">
                <Icon name="folder-open" size={13} />
                <span>Pick Folder</span>
                <input
                  type="file"
                  class="sr-file"
                  multiple
                  use:webkitDir
                  data-testid="import-folder-input"
                  onchange={onFolderPicked}
                />
              </label>
            </div>
          {/if}
        </div>

        <!-- 3: Local Path on Disk -->
        <div class="field-group">
          <label class="field-label" for="kandinsky-import-local">Or import from a local path on disk</label>
          <div class="local-row">
            <input
              id="kandinsky-import-local"
              type="text"
              data-testid="import-local-path"
              placeholder="C:\path\to\Notion-Export or section.one…"
              bind:value={localPath}
              disabled={busy}
              onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); void runLocalPathImport(); } }}
            />
            <button
              type="button"
              class="imp-submit-btn"
              data-testid="import-local-submit"
              disabled={busy || !localPath.trim()}
              onclick={() => void runLocalPathImport()}
            >Import path</button>
          </div>
        </div>

        {#if errorMsg}
          <div class="err-banner" role="alert">
            <Icon name="warning" size={14} />
            <span>{errorMsg}</span>
          </div>
        {/if}

        <!-- Import Summary Card -->
        {#if report}
          <section class="report-card" data-testid="import-report">
            <div class="report-top">
              <div class="report-title">
                <span class="ok-dot"><Icon name="check" size={13} /></span>
                <strong>Imported ({report.detected_format})</strong>
                <span class="dest-chip">→ {report.target_dir || "/"}</span>
              </div>
              {#if firstOpenTarget}
                <button
                  type="button"
                  class="open-imported-btn"
                  data-testid="import-open-btn"
                  onclick={() => { openPath(firstOpenTarget); handleClose(); }}
                >
                  <span>Open imported note / database</span>
                  <Icon name="arrow-right" size={13} />
                </button>
              {/if}
            </div>

            <div class="stat-tiles">
              <div class="stat-tile">
                <span class="stat-num">{report.notes_created}</span>
                <span class="stat-lbl">Notes created</span>
              </div>
              <div class="stat-tile">
                <span class="stat-num">{report.bases_created}</span>
                <span class="stat-lbl"><code>.base</code> databases</span>
              </div>
              <div class="stat-tile">
                <span class="stat-num">{report.attachments_saved}</span>
                <span class="stat-lbl">Attachments in <code>zAttachments/</code></span>
              </div>
            </div>

            {#if report.warnings.length > 0}
              <ul class="warn-list">
                {#each report.warnings as warn, idx (idx)}
                  <li><Icon name="warning" size={12} /> <span>{warn}</span></li>
                {/each}
              </ul>
            {/if}
          </section>
        {/if}
      </div>
    </div>
  </Dialog>
{/if}

<style>
  .imp-modal {
    width: min(640px, 95vw); max-height: 88vh;
    display: flex; flex-direction: column;
    background: var(--bg-elev); border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg, 10px); box-shadow: var(--shadow-pop); overflow: hidden;
  }
  .imp-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px; border-bottom: 1px solid var(--border); background: var(--bg-alt);
  }
  .imp-title { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; color: var(--heading); }
  .icon-btn { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 5px; color: var(--text-muted); }
  .icon-btn:hover:not(:disabled) { background: var(--bg-hover); color: var(--text); }

  .imp-body { padding: 14px 16px 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 13px; }
  .field-group { display: flex; flex-direction: column; gap: 6px; }
  .field-label { font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); }

  .fmt-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
  .fmt-card {
    text-align: left; padding: 8px 10px; border-radius: 7px;
    border: 1px solid var(--border-strong); background: var(--bg);
    display: flex; flex-direction: column; gap: 3px; color: var(--text);
  }
  .fmt-card:hover:not(:disabled) { background: var(--bg-hover); }
  .fmt-card.active {
    border-color: var(--accent); background: var(--accent-soft);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .fmt-card-top { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; }
  .fmt-desc { font-size: 11.5px; color: var(--text-muted); line-height: 1.35; }

  .target-row, .local-row { display: flex; align-items: center; gap: 8px; }
  .target-row {
    padding: 0 10px; border: 1px solid var(--border-strong); border-radius: 6px;
    background: var(--bg); color: var(--text-muted);
  }
  .target-row:focus-within { border-color: var(--accent); }
  .target-row input {
    flex: 1; border: 0; background: transparent; color: var(--text);
    font-family: var(--font-mono); font-size: 12.5px; padding: 7px 0; outline: none;
  }

  .dropzone {
    border: 1.5px dashed var(--border-strong); border-radius: 8px;
    background: var(--bg-alt); padding: 16px 14px; text-align: center;
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    transition: border-color 0.12s, background 0.12s;
  }
  .dropzone.drag { border-color: var(--accent); background: var(--accent-soft); }
  .drop-title { margin: 0; font-size: 13px; color: var(--text-muted); }
  .drop-title code { font-family: var(--font-mono); font-size: 12px; color: var(--text); }
  .picker-btns { display: inline-flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
  .pick-btn {
    position: relative; display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 12px; border-radius: 6px; font-size: 12.5px; font-weight: 600;
    border: 1px solid var(--border-strong); background: var(--bg-elev); color: var(--text); cursor: pointer;
  }
  .pick-btn:hover { background: var(--bg-hover); }
  .pick-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg, #fff); }
  .pick-btn.primary:hover { opacity: 0.92; }
  .sr-file { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

  .spinner-row { display: inline-flex; align-items: center; gap: 9px; font-size: 13px; color: var(--text); padding: 6px 0; }
  .spinner {
    width: 15px; height: 15px; border-radius: 50%;
    border: 2px solid var(--border-strong); border-top-color: var(--accent);
    animation: imp-spin 0.75s linear infinite;
  }
  @keyframes imp-spin { to { transform: rotate(360deg); } }

  .local-row input {
    flex: 1; padding: 7px 10px; border-radius: 6px;
    border: 1px solid var(--border-strong); background: var(--bg); color: var(--text);
    font-family: var(--font-mono); font-size: 12.5px; outline: none;
  }
  .local-row input:focus { border-color: var(--accent); }
  .imp-submit-btn {
    padding: 7px 13px; border-radius: 6px; font-size: 12.5px; font-weight: 600;
    border: 1px solid var(--border-strong); background: var(--bg); color: var(--text); white-space: nowrap;
  }
  .imp-submit-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
  .imp-submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .err-banner {
    display: flex; align-items: center; gap: 8px; padding: 8px 11px; border-radius: 6px;
    background: var(--red-soft); border: 1px solid color-mix(in srgb, var(--red) 35%, transparent);
    color: var(--red); font-size: 12.5px;
  }

  .report-card {
    border: 1px solid color-mix(in srgb, var(--green) 45%, var(--border));
    background: color-mix(in srgb, var(--green) 7%, var(--bg));
    border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 10px;
  }
  .report-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .report-title { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; color: var(--text); }
  .ok-dot {
    display: grid; place-items: center; width: 20px; height: 20px; border-radius: 999px;
    background: var(--green-soft); color: var(--green);
  }
  .dest-chip { font-family: var(--font-mono); font-size: 11.5px; color: var(--text-muted); }
  .open-imported-btn {
    display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 6px;
    font-size: 12px; font-weight: 600; background: var(--accent); color: var(--accent-fg, #fff);
  }
  .open-imported-btn:hover { opacity: 0.92; }

  .stat-tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .stat-tile {
    background: var(--bg-elev); border: 1px solid var(--border); border-radius: 6px;
    padding: 8px 10px; display: flex; flex-direction: column; gap: 2px;
  }
  .stat-num { font-family: var(--font-mono); font-size: 17px; font-weight: 700; color: var(--heading); }
  .stat-lbl { font-size: 11.5px; color: var(--text-muted); }
  .stat-lbl code { font-family: var(--font-mono); font-size: 11px; }

  .warn-list {
    margin: 0; padding: 8px 10px; list-style: none; border-radius: 6px;
    background: var(--yellow-soft); border: 1px solid color-mix(in srgb, var(--yellow) 35%, transparent);
    display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text);
  }
  .warn-list li { display: flex; align-items: flex-start; gap: 6px; }
</style>
