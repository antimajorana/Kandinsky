<script lang="ts">
  // Visual block picker for .page dashboards: click a friendly card to insert any block without editing YAML.
  import Icon from "./Icon.svelte";
  import type { IconName } from "../lib/panes";

  let { onpick, onclose }: { onpick: (yaml: string) => void; onclose: () => void } = $props();

  const CHOICES: { id: string; title: string; desc: string; icon: IconName; yaml: string }[] = [
    { id: "calendar", title: "Calendar", desc: "Interactive monthly events, Daily Notes & tasks", icon: "calendar", yaml: "view: calendar" },
    { id: "tasks", title: "Open Tasks", desc: "Checkboxes across your workspace", icon: "check", yaml: "view: tasks" },
    { id: "base", title: "Database (.base)", desc: "Table, Board, Cards or Timeline", icon: "table", yaml: "view: base\npath: " },
    { id: "note", title: "Note Embed", desc: "Live summary or section from a note", icon: "file-text", yaml: "view: note\npath: " },
    { id: "chart", title: "Chart", desc: "Bar, donut or line plot from a base or CSV", icon: "chart", yaml: "view: chart\nchart: bar\nmetric: count" },
    { id: "progress", title: "Progress Bar", desc: "Year, month or goal tracker", icon: "sliders", yaml: "view: progress\nkind: both\nlabel: Goal\ncurrent: 40\ntarget: 100" },
    { id: "countdown", title: "Countdown", desc: "Days remaining until a target date", icon: "clock", yaml: "view: countdown\nlabel: Milestone\ntarget_date: 2026-12-31" },
    { id: "capture", title: "Quick Capture", desc: "Drop notes straight into Today's log", icon: "edit", yaml: "view: capture" },
  ];
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions a11y_interactive_supports_focus -->
<div class="picker-backdrop" role="dialog" aria-modal="true" tabindex="-1" aria-label="Add page block"
  onclick={(e) => { if (e.target === e.currentTarget) onclose(); }}>
  <div class="picker-card" data-testid="page-block-picker">
    <header class="head">
      <strong>Add dashboard block</strong>
      <button type="button" class="x" onclick={onclose} aria-label="Close"><Icon name="close" size={14} /></button>
    </header>
    <div class="grid">
      {#each CHOICES as ch (ch.id)}
        <button type="button" class="choice" onclick={() => onpick(ch.yaml)}>
          <span class="ico"><Icon name={ch.icon} size={16} /></span>
          <span class="meta"><strong>{ch.title}</strong><span>{ch.desc}</span></span>
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  .picker-backdrop { position: fixed; inset: 0; z-index: 80; background: var(--scrim); display: grid; place-items: center; padding: 16px; }
  .picker-card { width: min(520px, 100%); background: var(--bg-elev); border: 1px solid var(--border-strong); border-radius: var(--radius-xl); box-shadow: var(--shadow-pop); padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .head { display: flex; align-items: center; justify-content: space-between; color: var(--heading); }
  .x { padding: 4px; border-radius: 5px; color: var(--text-muted); }
  .x:hover { background: var(--bg-hover); color: var(--text); }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .choice { display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--card-bg); text-align: left; }
  .choice:hover { border-color: var(--accent); background: var(--bg-hover); }
  .ico { width: 32px; height: 32px; border-radius: 8px; background: var(--accent-soft); color: var(--accent); display: grid; place-items: center; flex: none; }
  .meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .meta strong { font-size: 13px; color: var(--heading); }
  .meta span { font-size: 11.5px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
