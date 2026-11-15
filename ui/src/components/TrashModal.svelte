<script lang="ts">
  // Nootion-style Trash modal over `.kandinsky/trash/`: inspect, open, or restore deleted notes & folders.
  import { onMount } from "svelte";
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
  import Dialog from "./Dialog.svelte";
  import Icon from "./Icon.svelte";
  import { api } from "../lib/api";
  import { open, openPath } from "../lib/dock";
  import { fileIcon } from "../lib/panes";
  import { toast } from "../lib/state.svelte";
  import { errText } from "../lib/text";
  import type { TreeEntry } from "../lib/types";

  let { onclose }: { onclose: () => void } = $props();

  const TRASH_DIR = ".kandinsky/trash";

  let roots = $state<TreeEntry[]>([]);
  let loading = $state(true);
  let query = $state("");
  let busyPath = $state<string | null>(null);
  const expanded = new SvelteSet<string>();
  const subEntries = new SvelteMap<string, TreeEntry[]>();

  interface FlatTrashRow {
    entry: TreeEntry;
    depth: number;
    relPath: string;
  }

  async function loadTrash(): Promise<void> {
    loading = true;
    try {
      const hasTrash = await api.exists(TRASH_DIR).catch(() => false);
      if (!hasTrash) {
        roots = [];
        subEntries.clear();
        return;
      }
      roots = await api.tree(TRASH_DIR, true).catch(() => []);
      for (const dir of [...expanded]) {
        const kids = await api.tree(dir, true).catch(() => []);
        subEntries.set(dir, kids);
      }
    } finally {
      loading = false;
    }
  }

  async function toggleDir(entry: TreeEntry): Promise<void> {
    if (expanded.has(entry.path)) {
      expanded.delete(entry.path);
      return;
    }
    expanded.add(entry.path);
    if (!subEntries.has(entry.path)) {
      const kids = await api.tree(entry.path, true).catch(() => []);
      subEntries.set(entry.path, kids);
    }
  }

  const rows = $derived.by((): FlatTrashRow[] => {
    const out: FlatTrashRow[] = [];
    const q = query.trim().toLowerCase();
    const walk = (list: TreeEntry[], depth: number) => {
      for (const e of list) {
        const relPath = e.path.replace(/^\.kandinsky\/trash\/+/, "");
        if (!q || e.name.toLowerCase().includes(q) || relPath.toLowerCase().includes(q)) {
          out.push({ entry: e, depth, relPath });
        }
        if (e.kind === "dir" && expanded.has(e.path)) {
          walk(subEntries.get(e.path) ?? [], depth + 1);
        }
      }
    };
    walk(roots, 0);
    return out;
  });

  async function pickFreeTarget(entry: TreeEntry, relPath: string): Promise<string> {
    let base = entry.name;
    if (relPath.includes("/")) {
      const parent = relPath.slice(0, relPath.lastIndexOf("/"));
      if (await api.exists(parent).catch(() => false)) base = relPath;
    }
    if (!(await api.exists(base).catch(() => false))) return base;
    const slash = base.lastIndexOf("/");
    const dot = base.lastIndexOf(".");
    const hasExt = entry.kind !== "dir" && dot > slash + 1;
    const stem = hasExt ? base.slice(0, dot) : base;
    const ext = hasExt ? base.slice(dot) : "";
    for (let n = 1; n < 100; n++) {
      const candidate = n === 1 ? `${stem} (restored)${ext}` : `${stem} (restored ${n})${ext}`;
      if (!(await api.exists(candidate).catch(() => false))) return candidate;
    }
    return `${stem}-${Date.now()}${ext}`;
  }

  async function restore(entry: TreeEntry, relPath: string): Promise<void> {
    if (busyPath) return;
    busyPath = entry.path;
    try {
      const target = await pickFreeTarget(entry, relPath);
      await api.move(entry.path, target);
      toast("Restored", `${entry.name} → ${target}`, "success");
      await loadTrash();
    } catch (err) {
      toast("Could not restore", errText(err), "error");
    } finally {
      busyPath = null;
    }
  }

  onMount(() => {
    void loadTrash();
  });
</script>

<Dialog label="Trash" {onclose} testid="trash-modal">
  <div class="trash-modal">
    <header class="trash-head">
      <div class="trash-title">
        <Icon name="trash" size={16} />
        <span>Trash</span>
        {#if roots.length > 0}<span class="count">{roots.length}</span>{/if}
      </div>
      <div class="trash-head-actions">
        {#if roots.length > 0}
          <button type="button" class="ghost-btn" onclick={() => { open({ kind: "explorer", source: "vault", place: "", path: TRASH_DIR }); onclose(); }}>
            Browse folder
          </button>
        {/if}
        <button type="button" class="icon-btn" aria-label="Close Trash" onclick={onclose}>
          <Icon name="close" size={15} />
        </button>
      </div>
    </header>

    {#if roots.length > 3}
      <div class="trash-search">
        <Icon name="search" size={14} />
        <input type="search" placeholder="Filter trashed notes…" aria-label="Filter trashed items" bind:value={query} />
      </div>
    {/if}

    <div class="trash-body">
      {#if loading}
        <p class="empty-msg">Loading trash…</p>
      {:else if roots.length === 0}
        <p class="empty-msg">Trash is empty — deleted notes appear here (.kandinsky/trash/)</p>
      {:else if rows.length === 0}
        <p class="empty-msg">No trashed items match “{query}”.</p>
      {:else}
        <ul class="trash-list">
          {#each rows as { entry, depth, relPath } (entry.path)}
            <li class="trash-row" style:padding-left="{12 + depth * 16}px">
              {#if entry.kind === "dir"}
                <button type="button" class="item-main dir-btn" onclick={() => void toggleDir(entry)} title={entry.path}>
                  <span class="chev" class:open={expanded.has(entry.path)}><Icon name="chevron" size={12} /></span>
                  <Icon name={expanded.has(entry.path) ? "folder-open" : "folder"} size={15} />
                  <span class="item-meta">
                    <span class="item-name">{entry.name}</span>
                    <span class="item-path">{entry.path}</span>
                  </span>
                </button>
              {:else}
                <div class="item-main" title={entry.path}>
                  <Icon name={fileIcon(entry.path)} size={15} />
                  <span class="item-meta">
                    <span class="item-name">{entry.name}</span>
                    <span class="item-path">{entry.path}</span>
                  </span>
                </div>
              {/if}
              <div class="row-actions">
                {#if entry.kind !== "dir"}
                  <button type="button" class="act-btn" onclick={() => { openPath(entry.path); onclose(); }}>Open</button>
                {/if}
                <button type="button" class="act-btn restore" disabled={busyPath === entry.path} onclick={() => void restore(entry, relPath)}>
                  {busyPath === entry.path ? "Restoring…" : "Restore"}
                </button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
</Dialog>

<style>
  .trash-modal { width: min(560px, 94vw); max-height: 72vh; display: flex; flex-direction: column; background: var(--bg-elev); border: 1px solid var(--border-strong); border-radius: 10px; box-shadow: var(--shadow-pop); overflow: hidden; }
  .trash-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid var(--border); }
  .trash-title { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: calc(14px * var(--ui-scale, 1)); color: var(--heading); }
  .count { font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 999px; background: var(--bg-hover); color: var(--text-muted); }
  .trash-head-actions { display: inline-flex; align-items: center; gap: 6px; }
  .ghost-btn { font-size: 12px; color: var(--text-muted); padding: 4px 8px; border-radius: 5px; border: 1px solid var(--border); }
  .ghost-btn:hover { background: var(--bg-hover); color: var(--text); }
  .trash-search { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--border); color: var(--text-faint); }
  .trash-search input { flex: 1; background: transparent; border: 0; outline: none; color: var(--text); font-size: 13px; }
  .trash-body { flex: 1; min-height: 0; overflow-y: auto; padding: 6px; }
  .empty-msg { margin: 0; padding: 28px 16px; text-align: center; color: var(--text-muted); font-size: 13px; }
  .trash-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .trash-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 10px 6px 12px; border-radius: 6px; }
  .trash-row:hover { background: var(--bg-hover); }
  .item-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; color: var(--text-muted); text-align: left; }
  .dir-btn { cursor: pointer; }
  .chev { display: inline-flex; color: var(--text-faint); transition: transform .12s ease; }
  .chev.open { transform: rotate(90deg); }
  .item-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .item-name { color: var(--text); font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item-path { color: var(--text-faint); font-family: var(--font-mono); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row-actions { flex: none; display: inline-flex; align-items: center; gap: 6px; }
  .act-btn { padding: 3px 9px; border-radius: 5px; border: 1px solid var(--border-strong); background: var(--bg); color: var(--text); font-size: 12px; font-weight: 500; }
  .act-btn:hover:not(:disabled) { background: var(--bg-hover); }
  .act-btn.restore { border-color: color-mix(in srgb, var(--accent) 45%, var(--border-strong)); background: var(--accent-soft); color: var(--accent); }
  .act-btn:disabled { opacity: .5; cursor: not-allowed; }
</style>
