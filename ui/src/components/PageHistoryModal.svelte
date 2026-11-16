<script lang="ts">
  // Per-Page Version History modal: local snapshots + Git commit timeline with unified & side-by-side diffs.
  import Dialog from "./Dialog.svelte";
  import DiffView from "./DiffView.svelte";
  import Icon from "./Icon.svelte";
  import { api } from "../lib/api";
  import { open } from "../lib/dock";
  import { shownPath } from "../lib/paths";
  import { toast } from "../lib/state.svelte";
  import { bytes, errReason } from "../lib/text";
  import { pageHistoryModal, closePageHistory } from "../lib/page-history.svelte";
  import type { PageHistoryList } from "../lib/gen/PageHistoryList";
  import type { PageHistoryEntry } from "../lib/gen/PageHistoryEntry";
  import type { PageHistoryDetail } from "../lib/gen/PageHistoryDetail";
  import type { HistorySource } from "../lib/gen/HistorySource";

  let { onclose }: { onclose?: () => void } = $props();

  type FilterKind = "all" | HistorySource;
  type ViewMode = "unified" | "split" | "preview";
  type SplitCell = { num: number; text: string; chg: boolean } | null;
  type SplitRow = { kind: "hunk"; text: string } | { kind: "pair"; left: SplitCell; right: SplitCell };

  let list = $state<PageHistoryList | null>(null);
  let filter = $state<FilterKind>("all");
  let mode = $state<ViewMode>("unified");
  let selectedKey = $state<string | null>(null);
  let detail = $state<PageHistoryDetail | null>(null);
  let loadingList = $state(false);
  let loadingDetail = $state(false);
  let savingSnapshot = $state(false);
  let restoring = $state(false);
  let errorMsg = $state("");

  let listSeq = 0;
  let detailSeq = 0;

  const entryKey = (e: PageHistoryEntry): string => `${e.source}:${e.id}`;
  const filteredEntries = $derived.by((): PageHistoryEntry[] => {
    const all = list?.entries ?? [];
    return filter === "all" ? all : all.filter((e) => e.source === filter);
  });
  const selected = $derived.by((): PageHistoryEntry | null =>
    selectedKey ? ((list?.entries ?? []).find((e) => entryKey(e) === selectedKey) ?? null) : null,
  );

  const toMs = (raw: number): number => (raw > 1e11 ? raw : raw * 1000);

  function relativeTime(raw: number): string {
    const diffSec = Math.max(0, Math.floor((Date.now() - toMs(raw)) / 1000));
    if (diffSec < 45) return "just now";
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    if (diffSec < 86400 * 30) return `${Math.floor(diffSec / 86400)}d ago`;
    return `${Math.floor(diffSec / (86400 * 30))}mo ago`;
  }

  function formattedTime(raw: number): string {
    const d = new Date(toMs(raw));
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function ensureGitDiffHeader(path: string, patch: string): string {
    if (!patch.trim()) return "";
    return patch.startsWith("diff --git ") ? patch : `diff --git a/${path} b/${path}\n${patch}`;
  }

  function buildSplitRows(d: PageHistoryDetail): SplitRow[] {
    const rows: SplitRow[] = [];
    let inHunk = false, a = 1, b = 1;
    let dels: { num: number; text: string }[] = [];
    let adds: { num: number; text: string }[] = [];

    const flush = () => {
      const len = Math.max(dels.length, adds.length);
      for (let i = 0; i < len; i++) {
        rows.push({
          kind: "pair",
          left: dels[i] ? { num: dels[i].num, text: dels[i].text, chg: true } : null,
          right: adds[i] ? { num: adds[i].num, text: adds[i].text, chg: true } : null,
        });
      }
      dels = [];
      adds = [];
    };

    const rawLines = d.unified_diff.replace(/\r\n/g, "\n").split("\n");
    for (let idx = 0; idx < rawLines.length; idx++) {
      const raw = rawLines[idx];
      if (idx === rawLines.length - 1 && raw === "") break;
      const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw);
      if (h) {
        flush();
        inHunk = true;
        a = Number(h[1]);
        b = Number(h[2]);
        rows.push({ kind: "hunk", text: raw });
        continue;
      }
      if (!inHunk) continue;
      if (raw.startsWith("-")) dels.push({ num: a++, text: raw.slice(1) });
      else if (raw.startsWith("+")) adds.push({ num: b++, text: raw.slice(1) });
      else if (raw.startsWith("\\")) continue;
      else {
        flush();
        const text = raw.startsWith(" ") ? raw.slice(1) : raw;
        rows.push({ kind: "pair", left: { num: a++, text, chg: false }, right: { num: b++, text, chg: false } });
      }
    }
    flush();
    return rows;
  }

  const splitRows = $derived(detail ? buildSplitRows(detail) : []);
  const previewLines = $derived(detail ? detail.old_text.replace(/\r\n/g, "\n").split("\n") : []);
  const identical = $derived(detail ? detail.old_text === detail.current_text : false);

  async function selectEntry(entry: PageHistoryEntry): Promise<void> {
    const path = pageHistoryModal.path;
    if (!path) return;
    selectedKey = entryKey(entry);
    const seq = ++detailSeq;
    loadingDetail = true;
    errorMsg = "";
    try {
      const res = await api.pageHistoryEntry(path, entry.source, entry.id);
      if (seq === detailSeq) detail = res;
    } catch (err) {
      if (seq === detailSeq) { detail = null; errorMsg = errReason(err); }
    } finally {
      if (seq === detailSeq) loadingDetail = false;
    }
  }

  async function loadHistory(path: string, preferKey?: string): Promise<void> {
    const seq = ++listSeq;
    loadingList = true;
    errorMsg = "";
    try {
      const res = await api.pageHistory(path);
      if (seq !== listSeq) return;
      list = res;
      if (!res.git_repo && filter === "git") filter = "all";
      if (res.entries.length === 0) { selectedKey = null; detail = null; return; }
      if (preferKey) {
        const hit = res.entries.find((e) => entryKey(e) === preferKey);
        if (hit) { await selectEntry(hit); return; }
      }
      // Auto-select index 1 if index 0 has 0 diff lines against current text and index 1 exists.
      const first = res.entries[0];
      const dSeq = ++detailSeq;
      loadingDetail = true;
      selectedKey = entryKey(first);
      try {
        const d0 = await api.pageHistoryEntry(path, first.source, first.id);
        if (seq !== listSeq || dSeq !== detailSeq) return;
        const zeroDiff = d0.added === 0 && d0.removed === 0 && d0.old_text === d0.current_text;
        if (zeroDiff && res.entries.length > 1) await selectEntry(res.entries[1]);
        else detail = d0;
      } finally {
        if (dSeq === detailSeq) loadingDetail = false;
      }
    } catch (err) {
      if (seq === listSeq) { errorMsg = errReason(err); list = null; detail = null; }
    } finally {
      if (seq === listSeq) loadingList = false;
    }
  }

  async function saveSnapshotNow(): Promise<void> {
    const path = pageHistoryModal.path;
    if (!path || savingSnapshot) return;
    savingSnapshot = true;
    try {
      const snap = await api.createPageSnapshot(path);
      toast("Snapshot saved", shownPath(path), "success");
      await loadHistory(path, entryKey(snap));
    } catch (err) {
      toast("Could not save snapshot", errReason(err), "error");
    } finally {
      savingSnapshot = false;
    }
  }

  async function restoreSelected(): Promise<void> {
    const path = pageHistoryModal.path;
    if (!path || !selected || restoring) return;
    const cb = pageHistoryModal.onRestored;
    restoring = true;
    try {
      const res = await api.restorePageHistory(path, selected.source, selected.id);
      cb?.(res);
      toast("Version restored", `${shownPath(path)} (previous version snapshotted)`, "success");
      handleClose();
    } catch (err) {
      toast("Could not restore version", errReason(err), "error");
    } finally {
      restoring = false;
    }
  }

  function setFilter(next: FilterKind): void {
    filter = next;
    const vis = next === "all" ? (list?.entries ?? []) : (list?.entries ?? []).filter((e) => e.source === next);
    if (vis.length > 0 && !vis.some((e) => entryKey(e) === selectedKey)) void selectEntry(vis[0]);
  }

  function handleClose(): void { closePageHistory(); onclose?.(); }

  $effect(() => {
    if (!pageHistoryModal.open || !pageHistoryModal.path) return;
    filter = "all";
    mode = "unified";
    void loadHistory(pageHistoryModal.path);
  });
</script>

{#if pageHistoryModal.open}
  <Dialog label="Version history" center onclose={handleClose} testid="page-history-modal">
    <div class="hist-modal">
      <header class="hist-top">
        <div class="hist-title">
          <Icon name="clock" size={16} />
          <strong>Version History</strong>
          <span class="hist-path" title={pageHistoryModal.path}>{shownPath(pageHistoryModal.path)}</span>
        </div>
        <div class="hist-top-actions">
          <button type="button" class="ghost-btn" onclick={() => { open({ kind: "git" }); handleClose(); }}>
            <Icon name="git" size={13} />
            <span>Open Git pane</span>
          </button>
          <button type="button" class="icon-btn" aria-label="Close version history" onclick={handleClose}>
            <Icon name="close" size={15} />
          </button>
        </div>
      </header>

      <div class="hist-columns">
        <!-- Left timeline column (260px) -->
        <aside class="hist-left">
          <div class="hist-left-bar">
            <div class="filter-pills" role="tablist" aria-label="History source filter">
              <button type="button" class="pill" class:active={filter === "all"} onclick={() => setFilter("all")}>All</button>
              <button type="button" class="pill" class:active={filter === "snapshot"} onclick={() => setFilter("snapshot")}>Snapshots</button>
              {#if list?.git_repo}
                <button type="button" class="pill" class:active={filter === "git"} onclick={() => setFilter("git")}>Git</button>
              {/if}
            </div>
            <button
              type="button"
              class="snap-btn"
              data-testid="history-save-snapshot-btn"
              disabled={savingSnapshot || loadingList}
              onclick={() => void saveSnapshotNow()}
            >
              <Icon name="plus" size={13} />
              <span>{savingSnapshot ? "Saving…" : "Save snapshot"}</span>
            </button>
          </div>

          <div class="hist-timeline">
            {#if loadingList && !list}
              <p class="empty-msg">Loading history…</p>
            {:else if filteredEntries.length === 0}
              <p class="empty-msg">No saved versions yet. Click “Save snapshot” to capture the current page.</p>
            {:else}
              {#each filteredEntries as entry (entryKey(entry))}
                {@const active = selectedKey === entryKey(entry)}
                <button type="button" class="entry-row" class:active data-testid="history-entry-row" onclick={() => void selectEntry(entry)}>
                  <div class="entry-top">
                    <span class="src-badge" class:git={entry.source === "git"}>{entry.source === "git" ? "Git" : "Snapshot"}</span>
                    <span class="entry-rel" title={formattedTime(entry.time)}>{relativeTime(entry.time)}</span>
                  </div>
                  <div class="entry-label">{entry.label || (entry.source === "git" ? entry.id.slice(0, 7) : "Local snapshot")}</div>
                  <div class="entry-meta">
                    <span>{formattedTime(entry.time)}</span>
                    {#if entry.author}<span>· {entry.author}</span>{/if}
                  </div>
                  <div class="entry-size">{entry.lines} lines · {bytes(entry.bytes)}</div>
                </button>
              {/each}
            {/if}
          </div>
        </aside>

        <!-- Right diff viewer column -->
        <section class="hist-right">
          <div class="diff-toolbar">
            <div class="diff-summary">
              {#if selected}
                <span class="src-badge" class:git={selected.source === "git"}>
                  {selected.source === "git" ? `Git ${selected.id.slice(0, 7)}` : "Snapshot"}
                </span>
                <span class="sel-label">{selected.label || formattedTime(selected.time)}</span>
                {#if detail}
                  <span class="diff-stats"><span class="st-add">+{detail.added}</span> <span class="st-del">−{detail.removed}</span></span>
                {/if}
              {:else}
                <span class="muted-note">Select a version on the left</span>
              {/if}
            </div>

            <div class="toolbar-right">
              <div class="seg-toggle" role="group" aria-label="Diff view mode">
                <button type="button" class:active={mode === "unified"} data-testid="history-mode-unified" onclick={() => (mode = "unified")}>Unified</button>
                <button type="button" class:active={mode === "split"} data-testid="history-mode-split" onclick={() => (mode = "split")}>Side-by-side</button>
                <button type="button" class:active={mode === "preview"} data-testid="history-mode-preview" onclick={() => (mode = "preview")}>Preview text</button>
              </div>

              <button
                type="button"
                class="restore-btn"
                data-testid="history-restore-btn"
                disabled={!selected || restoring || loadingDetail}
                onclick={() => void restoreSelected()}
              >
                <Icon name="undo" size={13} />
                <span>{restoring ? "Restoring…" : "Restore this version"}</span>
              </button>
            </div>
          </div>

          <div class="diff-stage">
            {#if errorMsg}
              <p class="err-box">{errorMsg}</p>
            {:else if loadingDetail && !detail}
              <p class="empty-msg">Loading version diff…</p>
            {:else if !detail}
              <p class="empty-msg">Choose a snapshot or Git commit to compare with the current file on disk.</p>
            {:else if mode === "preview"}
              <div class="preview-card">
                {#each previewLines as line, idx (idx)}
                  <div class="prev-line"><span class="ln">{idx + 1}</span><span class="code">{line}</span></div>
                {/each}
              </div>
            {:else if identical}
              <div class="identical-card">Identical to current file on disk</div>
            {:else if mode === "unified"}
              <DiffView patch={ensureGitDiffHeader(detail.path, detail.unified_diff)} />
            {:else}
              <div class="split-card">
                <div class="split-head">
                  <div>Selected version ({selected?.source === "git" ? selected.id.slice(0, 7) : "Snapshot"})</div>
                  <div>Current on disk</div>
                </div>
                <div class="split-body">
                  {#each splitRows as row, idx (idx)}
                    {#if row.kind === "hunk"}
                      <div class="split-hunk">{row.text}</div>
                    {:else}
                      <div class="split-row">
                        <div class="split-cell" class:del={row.left?.chg} class:void={!row.left}>
                          <span class="ln">{row.left?.num ?? ""}</span>
                          <span class="sign">{row.left ? (row.left.chg ? "−" : " ") : ""}</span>
                          <span class="code">{row.left?.text ?? ""}</span>
                        </div>
                        <div class="split-cell" class:add={row.right?.chg} class:void={!row.right}>
                          <span class="ln">{row.right?.num ?? ""}</span>
                          <span class="sign">{row.right ? (row.right.chg ? "+" : " ") : ""}</span>
                          <span class="code">{row.right?.text ?? ""}</span>
                        </div>
                      </div>
                    {/if}
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        </section>
      </div>
    </div>
  </Dialog>
{/if}

<style>
  .hist-modal { width: min(1080px, 95vw); height: min(760px, 86vh); display: flex; flex-direction: column; background: var(--bg-elev); border: 1px solid var(--border-strong); border-radius: var(--radius-lg, 10px); box-shadow: var(--shadow-pop); overflow: hidden; }
  .hist-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; border-bottom: 1px solid var(--border); background: var(--bg-alt); }
  .hist-title { display: inline-flex; align-items: center; gap: 8px; min-width: 0; color: var(--heading); font-size: 14px; }
  .hist-path { font-family: var(--font-mono); font-size: 12px; color: var(--text-muted); background: var(--bg); border: 1px solid var(--border); border-radius: 5px; padding: 1px 7px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hist-top-actions { display: inline-flex; align-items: center; gap: 8px; flex: none; }
  .ghost-btn { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text-muted); padding: 4px 9px; border-radius: 5px; border: 1px solid var(--border-strong); background: var(--bg); }
  .ghost-btn:hover { background: var(--bg-hover); color: var(--text); }
  .icon-btn { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 5px; color: var(--text-muted); }
  .icon-btn:hover { background: var(--bg-hover); color: var(--text); }
  .hist-columns { flex: 1; min-height: 0; display: grid; grid-template-columns: 260px 1fr; }
  .hist-left { width: 260px; min-height: 0; display: flex; flex-direction: column; border-right: 1px solid var(--border); background: var(--bg-side, var(--bg-alt)); }
  .hist-left-bar { padding: 8px 10px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 7px; }
  .filter-pills { display: flex; gap: 4px; }
  .pill { flex: 1; font-size: 11.5px; font-weight: 600; padding: 3px 7px; border-radius: 5px; color: var(--text-muted); border: 1px solid transparent; }
  .pill:hover { background: var(--bg-hover); color: var(--text); }
  .pill.active { background: var(--accent-soft); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 35%, transparent); }
  .snap-btn { display: inline-flex; align-items: center; justify-content: center; gap: 5px; width: 100%; padding: 5px 8px; border-radius: 5px; font-size: 12px; font-weight: 600; background: var(--bg-elev); color: var(--text); border: 1px solid var(--border-strong); }
  .snap-btn:hover:not(:disabled) { background: var(--bg-hover); border-color: var(--accent); }
  .snap-btn:disabled { opacity: 0.55; cursor: not-allowed; }
  .hist-timeline { flex: 1; min-height: 0; overflow-y: auto; padding: 6px; display: flex; flex-direction: column; gap: 3px; }
  .entry-row { text-align: left; padding: 7px 9px; border-radius: 6px; border: 1px solid transparent; display: flex; flex-direction: column; gap: 2px; color: var(--text); }
  .entry-row:hover { background: var(--bg-hover); }
  .entry-row.active { background: var(--bg-active); border-color: color-mix(in srgb, var(--accent) 42%, var(--border)); }
  .entry-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  .src-badge { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; padding: 1px 6px; border-radius: 999px; background: var(--green-soft, rgba(60, 163, 149, 0.14)); color: var(--green); }
  .src-badge.git { background: var(--accent-soft); color: var(--accent); }
  .entry-rel { font-size: 11px; color: var(--text-faint); font-family: var(--font-mono); }
  .entry-label { font-size: 12.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .entry-meta, .entry-size { font-size: 11px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .entry-size { font-family: var(--font-mono); color: var(--text-faint); }
  .hist-right { min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--bg); }
  .diff-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--bg-alt); }
  .diff-summary { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
  .sel-label { font-size: 12.5px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 280px; }
  .diff-stats { font-family: var(--font-mono); font-size: 12px; display: inline-flex; gap: 6px; }
  .st-add { color: var(--green); font-weight: 600; }
  .st-del { color: var(--red); font-weight: 600; }
  .muted-note { font-size: 12.5px; color: var(--text-muted); }
  .toolbar-right { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .seg-toggle { display: inline-flex; border: 1px solid var(--border-strong); border-radius: 6px; overflow: hidden; background: var(--bg); }
  .seg-toggle button { font-size: 12px; padding: 4px 9px; color: var(--text-muted); border-right: 1px solid var(--border); }
  .seg-toggle button:last-child { border-right: 0; }
  .seg-toggle button:hover { color: var(--text); background: var(--bg-hover); }
  .seg-toggle button.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
  .restore-btn { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 6px; font-size: 12.5px; font-weight: 600; background: var(--accent); color: var(--accent-fg, #fff); }
  .restore-btn:hover:not(:disabled) { opacity: 0.92; }
  .restore-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .diff-stage { flex: 1; min-height: 0; overflow: auto; padding: 12px; }
  .empty-msg, .identical-card { margin: 24px auto; padding: 24px 18px; text-align: center; color: var(--text-muted); font-size: 13px; border: 1px dashed var(--border-strong); border-radius: 8px; max-width: 440px; }
  .err-box { margin: 0; padding: 10px 12px; border-radius: 6px; color: var(--red); background: var(--red-soft); border: 1px solid color-mix(in srgb, var(--red) 35%, transparent); font-size: 12.5px; }
  .split-card, .preview-card { border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: var(--bg); }
  .split-head { display: grid; grid-template-columns: 1fr 1fr; font-size: 11.5px; font-weight: 600; color: var(--text-muted); background: var(--bg-alt); border-bottom: 1px solid var(--border); }
  .split-head > div { padding: 6px 10px; }
  .split-head > div:first-child { border-right: 1px solid var(--border); }
  .split-body, .preview-card { font-family: var(--font-mono); font-size: 12px; line-height: 1.55; overflow-x: auto; }
  .split-hunk { padding: 2px 10px; color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); font-size: 11.5px; }
  .split-row { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid color-mix(in srgb, var(--border) 45%, transparent); }
  .split-cell { display: grid; grid-template-columns: 3.2em 1.3em 1fr; min-width: 0; }
  .split-cell:first-child { border-right: 1px solid var(--border); }
  .split-cell.void { background: color-mix(in srgb, var(--bg-alt) 65%, transparent); }
  .split-cell.del { background: color-mix(in srgb, var(--red) 11%, transparent); }
  .split-cell.del .sign { color: var(--red); }
  .split-cell.add { background: color-mix(in srgb, var(--green) 11%, transparent); }
  .split-cell.add .sign { color: var(--green); }
  .prev-line { display: grid; grid-template-columns: 3.5em 1fr; }
  .ln { color: var(--text-faint); text-align: right; padding-right: 8px; user-select: none; }
  .sign { text-align: center; color: var(--text-faint); user-select: none; }
  .code { white-space: pre; overflow-x: auto; padding-right: 12px; }
</style>
