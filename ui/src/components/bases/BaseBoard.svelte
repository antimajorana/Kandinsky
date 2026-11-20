<script lang="ts">
  // A board view: the notes in lanes by the view's `groupBy` property; dragging a card to another lane rewrites that
  // property of the note (`onwrite`). Double-click a card (or Enter on it) to open it; Alt+←/→ moves it a lane over.
  import CellValue from "./CellValue.svelte";
  import { openPath } from "../../lib/dock";
  import { classifyStatus, effectiveColumnFormat, nextStatusValue, type StatusTone } from "../../lib/base-format";
  import { context, setHover } from "../../lib/context.svelte";
  import { groupRows, NO_VALUE as NONE } from "../../lib/base-groups";
  import { propertySpec } from "../../lib/property-spec.svelte";
  import type { BaseColumn } from "../../lib/gen/BaseColumn";
  import type { BaseView } from "../../lib/gen/BaseView";
  import type { PropertySpec } from "../../lib/gen/PropertySpec";

  let { view, onwrite }: { view: BaseView; onwrite: (path: string, key: string, value: unknown) => void } = $props();

  const hoverIn = (p: string) => setHover({ path: p, source: "base" });
  const hoverOut = () => { if (context.hover?.source === "base") setHover(null); };
  const lit = (p: string) => context.hover?.path === p && context.hover.source !== "base";

  const norm = (s: string) => s.replace(/^note\./, "");
  function specForCol(col?: { id: string; key?: string | null } | null): PropertySpec | undefined {
    if (!col) return undefined;
    const key = col.key ?? (/^(file|formula)\./.test(col.id) ? null : norm(col.id));
    return key ? propertySpec.spec?.properties[key] : undefined;
  }

  const groupCol = $derived(
    view.group_by
      ? view.columns.find((c) => c.id === view.group_by || norm(c.id) === norm(view.group_by!)) ?? { id: view.group_by }
      : null,
  );
  const groupSpec = $derived(specForCol(groupCol));
  const lanes = $derived(
    groupRows(view, {
      groups: groupSpec?.groups ?? null,
      values: groupSpec?.values ?? null,
      isStatus: groupSpec?.kind === "status" || effectiveColumnFormat(groupCol, undefined, groupSpec) === "status",
    }).map((g) => [g.title ?? NONE, g.rows] as const),
  );
  function laneTone(lane: string): StatusTone | null {
    if (lane === NONE) return null;
    const t = classifyStatus(lane, groupSpec?.groups).tone;
    return effectiveColumnFormat(groupCol, undefined, groupSpec) === "status" || t !== "other" ? t : null;
  }
  const canCycleCol = (col: BaseColumn, c: BaseView["rows"][number]["cells"][number], editVal: string | null) => {
    const colSpec = specForCol(col);
    return !!col.key && editVal != null && (colSpec?.kind === "status" || effectiveColumnFormat(col, c, colSpec) === "status");
  };
  let dragging = $state<string | null>(null);
  let overLane = $state<string | null>(null);
  function dropOn(lane: string) {
    const p = dragging;
    dragging = overLane = null;
    if (p) moveTo(p, lane);
  }
  function moveTo(p: string, lane: string) {
    if (!view.group_key) return;
    const row = view.rows.find((r) => r.path === p);
    if (!row || (row.group || NONE) === lane) return;
    onwrite(p, view.group_key, lane === NONE ? null : lane);
  }
  function cardKey(e: KeyboardEvent, p: string, at: number) {
    if (e.key === "Enter") { e.preventDefault(); openPath(p); }
    else if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      const to = lanes[at + (e.key === "ArrowLeft" ? -1 : 1)];
      if (!to) return;
      e.preventDefault();
      refocus = p;
      moveTo(p, to[0]);
    }
  }
  // the moved card comes back in its new lane when the view reloads: the focus follows it there
  let refocus: string | null = null;
  let board = $state<HTMLElement>();
  $effect(() => {
    void lanes;
    if (!refocus) return;
    board?.querySelector<HTMLElement>(`.card[data-path="${CSS.escape(refocus)}"]`)?.focus();
    refocus = null;
  });
</script>

<div class="board" bind:this={board}>
  {#each lanes as [lane, cards], at (lane)}
    {@const tone = laneTone(lane)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <section class="lane" class:over={overLane === lane} aria-label="{view.group_by}: {lane}"
      ondragover={(e) => { if (dragging && view.group_key) { e.preventDefault(); overLane = lane; } }}
      ondragleave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) overLane = null; }}
      ondrop={(e) => { e.preventDefault(); dropOn(lane); }}>
      <header>
        {#if tone}
          <span class="lane-pill tone-{tone}"><span class="lane-dot"></span><span class="lane-name">{lane}</span></span>
        {:else}
          <span class="lane-name">{lane}</span>
        {/if}
        <span class="n">{cards.length}</span>
      </header>
      {#each cards as r (r.path)}
        <!-- a card is the button that opens its note (Enter; Alt+arrows move it between lanes) -->
        <div role="button" class="card" class:lit={lit(r.path)} onmouseenter={() => hoverIn(r.path)} onmouseleave={hoverOut} draggable={!!view.group_key}
          tabindex="0" data-path={r.path} aria-label="{r.path}{view.group_key ? ' (Enter opens, Alt+arrows move it)' : ''}" onkeydown={(e) => cardKey(e, r.path, at)}
          ondragstart={(e) => { dragging = r.path; e.dataTransfer?.setData("text/plain", r.path); }}
          ondragend={() => (dragging = overLane = null)} ondblclick={() => openPath(r.path)}>
          {#each r.cells as c, i (i)}
            {@const col = view.columns[i]}
            {#if col.id === "file.name"}<div class="card-title"><CellValue cell={c} column={col} /></div>
            {:else if c.t !== "null" && col.id !== view.group_by && col.key !== view.group_key}
              {@const colSpec = specForCol(col)}
              {@const canCycle = canCycleCol(col, c, r.edit[i])}
              <div class="card-prop">
                <span class="k">{col.label}</span>
                <span class="v"><CellValue cell={c} column={col} kind={colSpec?.kind} oncycle={canCycle ? () => onwrite(r.path, col.key!, nextStatusValue(String(r.values[i] ?? ""), colSpec?.values, colSpec?.groups)) : undefined} /></span>
              </div>{/if}
          {/each}
        </div>
      {/each}
    </section>
  {:else}
    <p class="empty">No notes match this view.</p>
  {/each}
</div>

<style>
  .board { display: flex; gap: 10px; align-items: flex-start; padding: 10px; overflow: auto; min-height: 0; flex: 1; }
  .lane { flex: 0 0 240px; background: var(--bg-alt); border: 1px solid var(--border); border-radius: var(--radius); padding: 6px; display: flex; flex-direction: column; gap: 6px; min-height: 80px; }
  .lane.over { border-color: var(--accent); background: var(--accent-soft); }
  .lane header { display: flex; gap: 6px; align-items: center; padding: 2px 4px 4px; font-weight: 600; color: var(--heading, var(--text)); min-width: 0; }
  .lane-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .lane-pill { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; height: 21px; padding: 0 8px 0 6px; border-radius: 999px; font-size: .88em; font-weight: 500; line-height: 1; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); min-width: 0; }
  .lane-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: none; }
  .lane-pill.tone-todo { background: var(--bg-hover); color: var(--text-muted); border-color: var(--border-strong); }
  .lane-pill.tone-progress { background: var(--accent-soft); color: var(--accent); }
  .lane-pill.tone-blocked { background: var(--red-soft, color-mix(in srgb, var(--red) 12%, transparent)); color: var(--red); }
  .lane-pill.tone-done { background: var(--green-soft, color-mix(in srgb, var(--green) 12%, transparent)); color: var(--green); }
  .lane-pill.tone-review { background: var(--yellow-soft, color-mix(in srgb, var(--yellow) 12%, transparent)); color: var(--yellow); }
  .lane-pill.tone-other { background: var(--accent-soft); color: var(--text); border-color: var(--border); }
  .lane-pill.tone-other .lane-dot { background: var(--accent); }
  .lane .n { flex: none; padding: 0 6px; line-height: 18px; border-radius: 99px; background: var(--bg-hover); color: var(--text-faint); font-weight: 500; font-size: .82em; font-variant-numeric: tabular-nums; }
  .card { background: var(--bg-elev); border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; cursor: grab; display: flex; flex-direction: column; gap: 3px; }
  .card:hover { border-color: var(--border-strong); }
  .card:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }
  .card.lit { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  /* a card's name reads as the cards view's title, not as a link among the values */
  .card-title { font-weight: 600; color: var(--heading, var(--text)); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card-title :global(.link) { color: inherit; }
  .card-prop { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: .88em; color: var(--text-muted); }
  .card-prop .k { flex: none; color: var(--text-faint); }
  .card-prop .v { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { color: var(--text-faint); padding: 10px; margin: 0; }
</style>
