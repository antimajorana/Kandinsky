<script lang="ts">
  // A Bases view as a list (Obsidian's list view, and a table too narrow for its columns): one row per note — its name,
  // the other values faint after it, a date at the end (in the table's words). Click opens the note.
  import { SvelteSet } from "svelte/reactivity";
  import Icon from "../Icon.svelte";
  import CellValue from "./CellValue.svelte";
  import { openPath } from "../../lib/dock";
  import { shownName } from "../../lib/paths";
  import { classifyStatus, effectiveColumnFormat, formatCurrency, type StatusTone } from "../../lib/base-format";
  import { context, setHover } from "../../lib/context.svelte";
  import { groupRows, NO_VALUE } from "../../lib/base-groups";
  import type { BaseView } from "../../lib/gen/BaseView";
  import type { BaseCell } from "../../lib/gen/BaseCell";
  import type { BaseColumn } from "../../lib/gen/BaseColumn";

  let { view }: { view: BaseView } = $props();

  const hoverIn = (p: string) => setHover({ path: p, source: "base" });
  const hoverOut = () => { if (context.hover?.source === "base") setHover(null); };
  const lit = (p: string) => context.hover?.path === p && context.hover.source !== "base";
  const ISO = /^\d{4}-\d{2}-\d{2}/;
  const text = (c: BaseCell, col?: BaseColumn): string => {
    const fmt = effectiveColumnFormat(col, c);
    if (c.t === "num") {
      if (fmt === "currency") return formatCurrency(c.value, col?.currency ?? "€");
      if (fmt === "percent") return `${c.value}%`;
      if (fmt === "progress") return `${Math.round((c.value / (col?.max || 100)) * 100)}%`;
    }
    switch (c.t) {
      case "null": return "";
      case "bool": return c.value ? "✓" : "";
      case "num": return String(c.value);
      case "text": return c.value;
      case "link": case "date": return c.text;
      case "list": return c.items.map((it) => text(it, col)).join(", ");
    }
  };
  const isDate = (c: BaseCell) => c.t === "date" || (c.t === "text" && ISO.test(c.value) && c.value.length <= 30);
  const groups = $derived(groupRows(view));
  const collapsedGroups = new SvelteSet<string>();
  const toggleGroup = (title: string) => {
    if (collapsedGroups.has(title)) collapsedGroups.delete(title);
    else collapsedGroups.add(title);
  };
  const groupCol = $derived(
    view.group_by
      ? view.columns.find((c) => c.id === view.group_by || c.id.replace(/^note\./, "") === view.group_by!.replace(/^note\./, "")) ?? { id: view.group_by }
      : null,
  );
  function groupTone(title: string): StatusTone | null {
    if (title === NO_VALUE) return null;
    const t = classifyStatus(title).tone;
    return effectiveColumnFormat(groupCol) === "status" || t !== "other" ? t : null;
  }
  const leadIdx = $derived(Math.max(0, view.columns.findIndex((c) => c.id === "file.name")));
</script>

<ul class="rows">
  {#each groups as g (g.title)}
  {@const collapsed = g.title !== null && collapsedGroups.has(g.title)}
  {#if g.title !== null}
    {@const tone = groupTone(g.title)}
    <li class="group-li">
      <button type="button" class="group" aria-expanded={!collapsed} onclick={() => toggleGroup(g.title!)}>
        <span class="caret" aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
        {#if tone}
          <span class="g-pill tone-{tone}"><span class="g-dot"></span><span>{g.title}</span></span>
        {:else}
          <span class="g-title">{g.title}</span>
        {/if}
        <span class="n">{g.rows.length}</span>
      </button>
    </li>
  {/if}
  {#if !collapsed}
  {#each g.rows as r (r.path)}
    {@const first = r.cells[leadIdx]}
    {@const whenIdx = r.cells.findIndex((c, i) => i !== leadIdx && isDate(c))}
    {@const statusIdx = r.cells.findIndex((c, i) => i !== leadIdx && i !== whenIdx && c.t === "text" && !!c.value.trim() && effectiveColumnFormat(view.columns[i], c) === "status")}
    {@const rest = r.cells.map((c, i) => (i !== leadIdx && i !== whenIdx && i !== statusIdx ? text(c, view.columns[i]) : "")).filter(Boolean)}
    <li><button type="button" class="row" class:lit={lit(r.path)} onclick={() => openPath(r.path)} onmouseenter={() => hoverIn(r.path)} onmouseleave={hoverOut} title={[text(first), ...rest].join(" · ")}>
      <Icon name={/\.md$/i.test(r.path) ? "file-text" : "file"} size={14} />
      <span class="lead">{text(first) || shownName(r.path)}</span>
      {#if rest.length}<span class="rest">{rest.join(" · ")}</span>{/if}
      {#if statusIdx >= 0}<span class="status-slot"><CellValue cell={r.cells[statusIdx]} column={view.columns[statusIdx]} /></span>{/if}
      {#if whenIdx >= 0}<span class="when"><CellValue cell={r.cells[whenIdx]} column={view.columns[whenIdx]} /></span>{/if}
    </button></li>
  {/each}
  {/if}
  {/each}
  {#if !view.rows.length}<li class="empty">No notes match this view.</li>{/if}
</ul>

<style>
  .rows { list-style: none; margin: 0; padding: 0 2px 4px; overflow: auto; min-height: 0; flex: 1; }
  .rows > li { margin: 0; }
  .row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; border-radius: 6px; font: inherit; color: var(--text); text-align: left; min-width: 0; }
  .row:hover, .row.lit { background: var(--bg-hover); }
  .row :global(.icon) { color: var(--text-faint); flex: none; }
  .lead { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rest { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-faint); font-size: .92em; }
  .status-slot { flex: none; margin-left: auto; }
  .status-slot + .when { margin-left: 0; }
  .when { flex: none; margin-left: auto; color: var(--text-faint); font-size: .9em; font-variant-numeric: tabular-nums; }
  .empty { color: var(--text-faint); padding: 10px; }
  .group { display: flex; align-items: center; gap: 6px; width: 100%; margin-top: 4px; padding: 5px 6px; border-radius: 6px; font: inherit; font-weight: 600; color: var(--heading, var(--text)); text-align: left; }
  .group:hover { background: var(--bg-hover); }
  .caret { width: 12px; color: var(--text-faint); font-size: .9em; text-align: center; flex: none; }
  .g-pill { display: inline-flex; align-items: center; gap: 6px; height: 20px; padding: 0 8px 0 6px; border-radius: 999px; font-size: .88em; font-weight: 500; line-height: 1; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); }
  .g-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: none; }
  .g-pill.tone-todo { background: var(--bg-hover); color: var(--text-muted); border-color: var(--border-strong); }
  .g-pill.tone-progress { background: var(--accent-soft); color: var(--accent); }
  .g-pill.tone-blocked { background: var(--red-soft, color-mix(in srgb, var(--red) 12%, transparent)); color: var(--red); }
  .g-pill.tone-done { background: var(--green-soft, color-mix(in srgb, var(--green) 12%, transparent)); color: var(--green); }
  .g-pill.tone-review { background: var(--yellow-soft, color-mix(in srgb, var(--yellow) 12%, transparent)); color: var(--yellow); }
  .g-pill.tone-other { background: var(--accent-soft); color: var(--text); border-color: var(--border); }
  .g-pill.tone-other .g-dot { background: var(--accent); }
  .group .n { margin-left: 2px; padding: 0 6px; line-height: 18px; border-radius: 99px; background: var(--bg-hover); color: var(--text-faint); font-weight: 500; font-size: .84em; font-variant-numeric: tabular-nums; }
</style>
