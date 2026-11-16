<script lang="ts">
  // A Bases view as cards (Obsidian's cards view): a grid of notes, each its name and the view's other columns as
  // labelled values (lists as chips), its picture on top when the view names an `image` property; in groups when the
  // view has a `groupBy`. Click a card to open its note.
  import { SvelteSet } from "svelte/reactivity";
  import CellValue from "./CellValue.svelte";
  import { openPath } from "../../lib/dock";
  import { shownName } from "../../lib/paths";
  import { classifyStatus, effectiveColumnFormat, type StatusTone } from "../../lib/base-format";
  import { context, setHover } from "../../lib/context.svelte";
  import { groupRows, NO_VALUE } from "../../lib/base-groups";
  import { blobUrl, thumbUrl } from "../../lib/raw";
  import type { BaseView } from "../../lib/gen/BaseView";

  let { view }: { view: BaseView } = $props();

  const hoverIn = (p: string) => setHover({ path: p, source: "base" });
  const hoverOut = () => { if (context.hover?.source === "base") setHover(null); };
  const lit = (p: string) => context.hover?.path === p && context.hover.source !== "base";
  const nameAt = $derived(view.columns.findIndex((c) => c.id === "file.name"));
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
  // a vault picture through the API (its header-guarded routes give blob: URLs), downscaled where the core can
  const src = (img: string): Promise<string> =>
    /^https?:\/\//.test(img) ? Promise.resolve(img) : /\.svg$/i.test(img) ? blobUrl(img) : thumbUrl(img, 480).catch(() => blobUrl(img));
</script>

<div class="scroll">
{#each groups as g (g.title)}
{@const collapsed = g.title !== null && collapsedGroups.has(g.title)}
{#if g.title !== null}
  {@const tone = groupTone(g.title)}
  <button type="button" class="group" aria-expanded={!collapsed} onclick={() => toggleGroup(g.title!)}>
    <span class="caret" aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
    {#if tone}
      <span class="g-pill tone-{tone}"><span class="g-dot"></span><span>{g.title}</span></span>
    {:else}
      <span class="g-title">{g.title}</span>
    {/if}
    <span class="n">{g.rows.length}</span>
  </button>
{/if}
{#if !collapsed}
<div class="cards">
  {#each g.rows as r (r.path)}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
    <article class="card" class:lit={lit(r.path)} onmouseenter={() => hoverIn(r.path)} onmouseleave={hoverOut} onclick={() => openPath(r.path)}>
      {#if view.image}
        <div class="cover">{#if r.image}{#await src(r.image) then u}<img src={u} alt="" loading="lazy" />{/await}{/if}</div>
      {/if}
      <button type="button" class="title" onclick={(e) => { e.stopPropagation(); openPath(r.path); }}>{nameAt >= 0 && r.cells[nameAt].t === "link" ? r.cells[nameAt].text : shownName(r.path)}</button>
      {#each r.cells as c, i (i)}
        {#if i !== nameAt && c.t !== "null"}
          <div class="prop"><span class="k">{view.columns[i].label}</span><span class="v"><CellValue cell={c} column={view.columns[i]} /></span></div>
        {/if}
      {/each}
    </article>
  {/each}
</div>
{/if}
{/each}
{#if !view.rows.length}<p class="empty">No notes match this view.</p>{/if}
</div>

<style>
  .scroll { overflow: auto; min-height: 0; flex: 1; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; padding: 10px; align-content: start; }
  .group { display: flex; align-items: center; gap: 6px; width: calc(100% - 16px); margin: 8px 8px 0; padding: 5px 6px; border-radius: var(--radius-sm); font: inherit; font-weight: 600; font-size: .95em; color: var(--heading, var(--text)); text-align: left; }
  .group:hover { background: var(--bg-hover); }
  .caret { width: 12px; color: var(--text-faint); font-size: .9em; text-align: center; flex: none; }
  .g-pill { display: inline-flex; align-items: center; gap: 6px; height: 21px; padding: 0 8px 0 6px; border-radius: 999px; font-size: .9em; font-weight: 500; line-height: 1; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); }
  .g-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: none; }
  .g-pill.tone-todo { background: var(--bg-hover); color: var(--text-muted); border-color: var(--border-strong); }
  .g-pill.tone-progress { background: var(--accent-soft); color: var(--accent); }
  .g-pill.tone-blocked { background: var(--red-soft, color-mix(in srgb, var(--red) 12%, transparent)); color: var(--red); }
  .g-pill.tone-done { background: var(--green-soft, color-mix(in srgb, var(--green) 12%, transparent)); color: var(--green); }
  .g-pill.tone-review { background: var(--yellow-soft, color-mix(in srgb, var(--yellow) 12%, transparent)); color: var(--yellow); }
  .g-pill.tone-other { background: var(--accent-soft); color: var(--text); border-color: var(--border); }
  .g-pill.tone-other .g-dot { background: var(--accent); }
  .group .n { margin-left: 2px; padding: 0 6px; line-height: 18px; border-radius: 99px; background: var(--bg-hover); color: var(--text-faint); font-weight: 500; font-size: .84em; font-variant-numeric: tabular-nums; }
  /* the picture bleeds to the card's edges, as Obsidian's covers */
  .cover { margin: -10px -12px 4px; aspect-ratio: 16 / 9; background: var(--bg-alt); border-bottom: 1px solid var(--border); border-radius: var(--radius) var(--radius) 0 0; overflow: hidden; }
  .cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .card { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-elev); cursor: pointer; min-width: 0; }
  .card:hover { border-color: var(--border-strong); }
  .card.lit { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .title { font: inherit; font-weight: 600; color: var(--heading, var(--text)); text-align: left; padding: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .title:hover { text-decoration: underline; }
  .prop { display: flex; gap: 8px; align-items: center; min-width: 0; font-size: .92em; }
  .k { flex: none; color: var(--text-faint); }
  .v { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted); }
  .empty { color: var(--text-faint); padding: 10px; margin: 0; }
</style>
