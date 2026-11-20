<script lang="ts">
  // Shared 40px calm Notion pane topbar: collapsed-sidebar expand button, breadcrumb trail,
  // edited timestamp, custom slot actions, Favorite star, Share pill, and `···` overflow menu.
  import type { Snippet } from "svelte";
  import { open } from "../lib/dock";
  import { openHome } from "../lib/actions";
  import { fileIcon } from "../lib/panes";
  import { app } from "../lib/state.svelte";
  import { isNotionShell } from "../lib/shell-mode.svelte";
  import { tabs, toggleSidebar } from "../lib/tabs.svelte";
  import Icon from "./Icon.svelte";

  let {
    path,
    title,
    ariaLabel = "Page header",
    starred = false,
    onStar,
    onShare,
    onMore,
    moreTestId,
    editedLabel = "",
    showFileIcon = false,
    titleBadge,
    actions,
  }: {
    path: string;
    title: string;
    ariaLabel?: string;
    starred?: boolean;
    onStar?: () => void;
    onShare?: (e: MouseEvent) => void;
    onMore?: (e: MouseEvent) => void;
    moreTestId?: string;
    editedLabel?: string;
    showFileIcon?: boolean;
    titleBadge?: Snippet;
    actions?: Snippet;
  } = $props();

  const pathSegments = $derived(path.split("/"));
  const folderSegments = $derived(path.startsWith(".kandinsky/") ? [] : pathSegments.slice(0, -1));
</script>

<header class="topbar" aria-label={ariaLabel}>
  <div class="breadcrumbs">
    {#if isNotionShell() && tabs.sidebar.collapsed}
      <button type="button" class="icon-btn expand-sb" onclick={toggleSidebar} title="Expand sidebar (Super+S)" aria-label="Expand sidebar">
        <Icon name="panel-left" size={15} />
      </button>
    {/if}
    <button type="button" class="seg vault" onclick={() => void openHome()} title="Open vault Home">
      {app.workspace?.name ?? "Workspace"}
    </button>
    <span class="sep">›</span>
    {#if folderSegments.length > 0}
      <span class="folder-trail">
        {#each folderSegments as seg, i}
          {#if i > 0}<span class="sub-sep">/</span>{/if}
          <button type="button" class="seg" title="Show {folderSegments.slice(0, i + 1).join('/')} in the explorer"
            onclick={() => open({ kind: "explorer", source: "vault", place: "", path: folderSegments.slice(0, i + 1).join("/"), select: pathSegments[i + 1] })}>{seg}</button>
        {/each}
      </span>
      <span class="sep">›</span>
    {/if}
    <strong class="doc-crumb" dir="auto">
      {#if showFileIcon}<Icon name={fileIcon(path)} size={13} />{/if}
      {title}
    </strong>
    {#if titleBadge}{@render titleBadge()}{/if}
  </div>
  <div class="top-actions">
    {#if editedLabel}<span class="edited-lbl">{editedLabel}</span>{/if}
    {#if actions}{@render actions()}{/if}
    {#if onStar}
      <button type="button" class="icon-btn star-icon" class:starred
        aria-label={starred ? "Remove from Favorites" : "Add to Favorites"}
        title={starred ? "Remove from Favorites" : "Add to Favorites"}
        onclick={onStar}>
        {starred ? "★" : "☆"}
      </button>
    {/if}
    {#if onShare}
      <button type="button" class="top-pill" onclick={onShare} title="Copy or export">Share</button>
    {/if}
    {#if onMore}
      <button type="button" class="top-more" data-testid={moreTestId} aria-label="More actions" title="More actions" onclick={onMore}>···</button>
    {/if}
  </div>
</header>

<style>
  .topbar {
    flex: none; height: 40px; padding: 0 20px; display: flex; align-items: center; justify-content: space-between;
    gap: 12px; font-size: calc(12.5px * var(--ui-scale, 1)); color: var(--text-muted);
    border-bottom: 1px solid var(--border); background: var(--bg); white-space: nowrap;
  }
  .breadcrumbs { display: flex; align-items: center; gap: 5px; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .expand-sb { width: 26px; height: 26px; display: grid; place-items: center; border-radius: 5px; color: var(--text-muted); flex: none; margin-right: 2px; }
  .expand-sb:hover { background: var(--bg-hover); color: var(--text); }
  .breadcrumbs .seg { padding: 2px 5px; border-radius: 4px; color: var(--text-muted); font: inherit; }
  .breadcrumbs button.seg:hover { background: var(--bg-hover); color: var(--text); }
  .breadcrumbs .folder-trail { display: inline-flex; align-items: center; gap: 1px; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .breadcrumbs .sub-sep { color: var(--text-faint); padding: 0 1px; }
  .breadcrumbs .sep { color: var(--text-faint); opacity: .75; }
  .breadcrumbs .doc-crumb { display: inline-flex; align-items: center; gap: 5px; color: var(--heading); font-weight: 500; overflow: hidden; text-overflow: ellipsis; padding: 0 2px; }

  .top-actions { display: inline-flex; align-items: center; gap: 8px; flex: none; font-size: calc(12px * var(--ui-scale, 1)); color: var(--text-faint); }
  .edited-lbl { color: var(--text-faint); margin-right: 2px; }
  .star-icon { width: 26px; height: 26px; display: grid; place-items: center; border-radius: 5px; color: var(--text-faint); font-size: calc(14px * var(--ui-scale, 1)); line-height: 1; transition: background 120ms, color 120ms; }
  .star-icon:hover { background: var(--bg-hover); color: var(--text); }
  .star-icon.starred { color: var(--yellow); }
  .top-pill { padding: 3px 8px; border-radius: 5px; border: 1px solid var(--border); background: transparent; color: var(--text-muted); font: inherit; cursor: pointer; transition: background 120ms, color 120ms, border-color 120ms; }
  .top-pill:hover { background: var(--bg-hover); color: var(--text); border-color: var(--border-strong); }
  .top-more { padding: 3px 6px; border-radius: 5px; color: var(--text-muted); font: inherit; font-weight: 600; letter-spacing: 0.06em; cursor: pointer; transition: background 120ms, color 120ms; }
  .top-more:hover { background: var(--bg-hover); color: var(--text); }

  @media (max-width: 920px) {
    .edited-lbl { display: none; }
    .topbar { padding: 0 12px; }
    .top-actions { gap: 6px; }
  }
  :global(html.phone) .topbar { justify-content: flex-end; height: 36px; padding: 0 10px; }
  :global(html.phone) .topbar .breadcrumbs { display: none; }
</style>
