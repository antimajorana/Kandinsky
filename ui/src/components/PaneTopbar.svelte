<script lang="ts">
  // Shared breadcrumb and actions for notes, pages, and Bases.
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
    moreLabel = "More actions",
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
    moreLabel?: string;
    editedLabel?: string;
    showFileIcon?: boolean;
    titleBadge?: Snippet;
    actions?: Snippet;
  } = $props();

  const pathSegments = $derived(path.split("/"));
  const folderSegments = $derived(path.startsWith(".kandinsky/") ? [] : pathSegments.slice(0, -1));
</script>

<header class="topbar kandinsky-pane-topbar" aria-label={ariaLabel}>
  <div class="breadcrumbs">
    {#if isNotionShell() && tabs.sidebar.collapsed}
      <button type="button" class="icon-btn expand-sb" onclick={toggleSidebar} title="Expand sidebar (Super+S)" aria-label="Expand sidebar">
        <Icon name="panel-left" size={15} />
      </button>
    {/if}
    <button type="button" class="seg vault" onclick={() => void openHome()} title={`Open ${app.workspace?.name ?? "workspace"} home`}>
      {app.workspace?.name ?? "Workspace"}
    </button>
    <span class="sep" aria-hidden="true">/</span>
    {#if folderSegments.length > 0}
      <span class="folder-trail">
        {#each folderSegments as seg, i}
          {#if i > 0}<span class="sep" aria-hidden="true">/</span>{/if}
          <button type="button" class="seg" title="Show {folderSegments.slice(0, i + 1).join('/')} in the explorer"
            onclick={() => open({ kind: "explorer", source: "vault", place: "", path: folderSegments.slice(0, i + 1).join("/"), select: pathSegments[i + 1] })}>{seg}</button>
        {/each}
      </span>
      <span class="sep" aria-hidden="true">/</span>
    {/if}
    <strong class="doc-crumb" aria-current="page" title={title}>
      {#if showFileIcon}<Icon name={fileIcon(path)} size={13} />{/if}
      <span dir="auto">{title}</span>
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
      <button type="button" class="top-share" onclick={onShare} title="Copy or export">Share</button>
    {/if}
    {#if onMore}
      <button type="button" class="top-more" data-testid={moreTestId} aria-label={moreLabel} title={moreLabel} onclick={onMore}><Icon name="more" size={16} /></button>
    {/if}
  </div>
</header>

<style>
  .topbar {
    flex: none; min-height: calc(46px * var(--ui-scale, 1)); padding: 0 16px; display: flex; align-items: center; justify-content: space-between;
    gap: 10px; font-size: calc(13px * var(--ui-scale, 1)); color: var(--text-muted);
    border-bottom: 1px solid var(--border); background: var(--bg); white-space: nowrap; container-type: inline-size;
  }
  .breadcrumbs { display: flex; align-items: center; gap: 4px; min-width: 0; }
  .expand-sb { width: 28px; height: 28px; display: grid; place-items: center; border-radius: var(--radius-sm); color: var(--text-muted); flex: none; }
  .breadcrumbs .seg { min-width: 0; max-width: 20ch; min-height: 28px; padding: 2px 5px; border-radius: var(--radius-sm); overflow: hidden; text-overflow: ellipsis; color: var(--text-muted); font: inherit; }
  .breadcrumbs .folder-trail { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
  .breadcrumbs .sep { color: var(--text-faint); }
  .breadcrumbs .doc-crumb { display: inline-flex; align-items: center; gap: 5px; color: var(--heading); font-weight: 600; min-width: 0; padding: 0 3px; }
  .doc-crumb > span { overflow: hidden; text-overflow: ellipsis; }
  .doc-crumb :global(.icon) { flex: none; }

  .top-actions { display: inline-flex; align-items: center; gap: 4px; flex: none; font-size: calc(12.5px * var(--ui-scale, 1)); color: var(--text-faint); }
  .edited-lbl { color: var(--text-faint); margin-right: 2px; }
  .star-icon, .top-more { width: 28px; height: 28px; display: grid; place-items: center; border-radius: var(--radius-sm); color: var(--text-muted); }
  .star-icon { font-size: calc(16px * var(--ui-scale, 1)); line-height: 1; }
  .star-icon.starred { color: var(--yellow); }
  .top-share { min-height: 28px; padding: 2px 9px; border-radius: var(--radius-sm); color: var(--text); font: inherit; font-weight: 500; }
  .top-more :global(.icon) { transform: rotate(90deg); }
  :is(.expand-sb, .seg, .star-icon, .top-more, .top-share):hover { background: var(--bg-hover); color: var(--heading); }

  @container (max-width: 520px) {
    .edited-lbl { display: none; }
    .breadcrumbs .seg { max-width: 13ch; }
  }
  :global(html.phone) .topbar { justify-content: flex-end; min-height: 36px; padding: 0 10px; }
  :global(html.phone) .topbar .breadcrumbs { display: none; }
</style>
