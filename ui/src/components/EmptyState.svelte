<script lang="ts">
  // Shared empty state (UI-STYLE.md §9): calm centered icon, title, optional one-line reason, and primary action button.
  import type { IconName } from "../lib/panes";
  import Icon from "./Icon.svelte";

  let {
    icon,
    title,
    reason = "",
    actionLabel = "",
    onAction,
    compact = false,
  }: {
    icon: IconName;
    title: string;
    reason?: string;
    actionLabel?: string;
    onAction?: () => void;
    compact?: boolean;
  } = $props();
</script>

<div class="empty-state" class:compact role="status">
  <span class="empty-ico" aria-hidden="true"><Icon name={icon} size={compact ? 22 : 28} /></span>
  <strong class="empty-title">{title}</strong>
  {#if reason}<p class="empty-reason">{reason}</p>{/if}
  {#if actionLabel && onAction}
    <button type="button" class="empty-btn" onclick={onAction}>{actionLabel}</button>
  {/if}
</div>

<style>
  .empty-state {
    display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
    gap: 8px; padding: 40px 24px; color: var(--text-muted); max-width: 420px; margin: 0 auto;
  }
  .empty-state.compact { padding: 24px 16px; gap: 6px; }
  .empty-ico {
    display: grid; place-items: center; width: 48px; height: 48px; border-radius: 12px;
    background: var(--bg-alt); border: 1px solid var(--border); color: var(--text-faint); margin-bottom: 2px;
  }
  .empty-state.compact .empty-ico { width: 38px; height: 38px; border-radius: 10px; }
  .empty-title { font-size: calc(14.5px * var(--ui-scale, 1)); font-weight: 600; color: var(--heading); }
  .empty-reason { margin: 0; font-size: calc(13px * var(--ui-scale, 1)); line-height: 1.45; color: var(--text-muted); max-width: 40ch; }
  .empty-btn {
    margin-top: 6px; padding: 6px 14px; border-radius: var(--radius-sm);
    background: var(--accent); color: var(--accent-fg); font-size: calc(12.5px * var(--ui-scale, 1));
    font-weight: 600; cursor: pointer; transition: opacity 120ms ease;
  }
  .empty-btn:hover { opacity: .92; }
</style>
