<script lang="ts">
  // The graph view's settings card (Obsidian's): Filters, Groups, Display and Forces, each folding away; the
  // values are graph.json's (lib/graph/settings.ts) and every change shows at once.
  import Icon from "./Icon.svelte";
  import { DEFAULTS, RANGES, hexOf, rgbOf, type GraphSettings } from "../lib/graph/settings";

  let { s = $bindable(), from, onanimate, onclose }: {
    s: GraphSettings;
    /** where the settings came from, said once under the title */
    from: "own" | "obsidian" | "defaults";
    onanimate: () => void;
    onclose: () => void;
  } = $props();

  type Section = "collapse-filter" | "collapse-color-groups" | "collapse-display" | "collapse-forces";
  const sections: [Section, string][] = [["collapse-filter", "Filters"], ["collapse-color-groups", "Groups"], ["collapse-display", "Display"], ["collapse-forces", "Forces"]];
  const display: [keyof typeof RANGES, string][] = [["textFadeMultiplier", "Text fade threshold"], ["nodeSizeMultiplier", "Node size"], ["lineSizeMultiplier", "Link thickness"]];
  const forces: [keyof typeof RANGES, string][] = [["centerStrength", "Center force"], ["repelStrength", "Repel force"], ["linkStrength", "Link force"], ["linkDistance", "Link distance"]];
  // a new group's colour: the next of these, as Obsidian picks one
  const SWATCHES = [0xe05d5d, 0xe0a85d, 0xd6d65c, 0x6cc46c, 0x5dbde0, 0x7a7ae0, 0xc46cc4];

  function reset() {
    const keep = { close: s.close };
    for (const k of Object.keys(DEFAULTS) as (keyof GraphSettings)[]) {
      if (k.startsWith("collapse-") || k === "close") continue;
      (s as unknown as Record<string, unknown>)[k] = k === "colorGroups" ? [] : DEFAULTS[k];
    }
    s.close = keep.close;
  }
  const addGroup = () => { s.colorGroups = [...s.colorGroups, { query: "", color: { a: 1, rgb: SWATCHES[s.colorGroups.length % SWATCHES.length] } }]; };
  const dropGroup = (i: number) => { s.colorGroups = s.colorGroups.filter((_, j) => j !== i); };
</script>

<div class="graph-controls" role="region" aria-label="Graph settings">
  <div class="head">
    <span class="title">Graph settings</span>
    <button class="icon-btn" title="Back to the defaults (Obsidian's)" aria-label="Restore defaults" onclick={reset}><Icon name="refresh" size={14} /></button>
    <button class="icon-btn" title="Close" aria-label="Close graph settings" onclick={onclose}><Icon name="close" size={14} /></button>
  </div>
  {#if from === "obsidian"}<p class="from">Started from this vault's Obsidian graph settings. Changes are kept for Kandinsky only.</p>{/if}

  {#each sections as [key, label] (key)}
    <section>
      <button class="sec" class:open={!s[key]} aria-expanded={!s[key]} onclick={() => (s[key] = !s[key])}>
        <span class="chev"><Icon name="chevron" size={12} /></span>{label}
      </button>
      {#if !s[key]}
        <div class="body">
          {#if key === "collapse-filter"}
            <input class="search" type="search" placeholder="Search files… (path:, tag:, [property:value], -)" spellcheck="false" bind:value={s.search} aria-label="Search files" />
            <label class="row"><span>Tags</span><input type="checkbox" bind:checked={s.showTags} /></label>
            <label class="row"><span>Attachments</span><input type="checkbox" bind:checked={s.showAttachments} /></label>
            <label class="row"><span>Orphans</span><input type="checkbox" bind:checked={s.showOrphans} /></label>
          {:else if key === "collapse-color-groups"}
            {#each s.colorGroups as g, i (i)}
              <div class="group">
                <input class="query" placeholder="Enter query…" spellcheck="false" bind:value={g.query} aria-label="Group {i + 1} query" />
                <input class="swatch" type="color" value={hexOf(g.color.rgb)} oninput={(e) => (g.color = { ...g.color, rgb: rgbOf(e.currentTarget.value) })} aria-label="Group {i + 1} colour" />
                <button class="icon-btn" title="Remove this group" aria-label="Remove group {i + 1}" onclick={() => dropGroup(i)}><Icon name="close" size={12} /></button>
              </div>
            {/each}
            <button class="wide" onclick={addGroup}>New group</button>
          {:else if key === "collapse-display"}
            <label class="row"><span>Arrows</span><input type="checkbox" bind:checked={s.showArrow} /></label>
            {#each display as [k, name] (k)}
              <label class="slider"><span>{name}</span><input type="range" min={RANGES[k][0]} max={RANGES[k][1]} step={RANGES[k][2]} bind:value={s[k]} aria-label={name} /></label>
            {/each}
            <button class="wide" onclick={onanimate}>Animate</button>
          {:else}
            {#each forces as [k, name] (k)}
              <label class="slider"><span>{name}</span><input type="range" min={RANGES[k][0]} max={RANGES[k][1]} step={RANGES[k][2]} bind:value={s[k]} aria-label={name} /></label>
            {/each}
          {/if}
        </div>
      {/if}
    </section>
  {/each}
</div>

<style>
  .graph-controls { position: absolute; top: 10px; right: 10px; width: 260px; max-height: calc(100% - 20px); overflow: auto; background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius-sm); box-shadow: 0 6px 24px rgb(0 0 0 / 0.25); font-size: calc(12.5px * var(--ui-scale, 1)); color: var(--text); padding: 6px 0; z-index: 2; }
  .head { display: flex; align-items: center; gap: 4px; padding: 2px 8px 6px 12px; }
  .title { flex: 1; font-weight: 600; color: var(--heading); }
  .from { margin: 0 12px 6px; color: var(--text-muted); font-size: 0.92em; line-height: 1.35; }
  .icon-btn { display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 4px; color: var(--text-muted); }
  .icon-btn:hover { background: var(--bg-hover); color: var(--text); }
  section { border-top: 1px solid var(--border); }
  .sec { display: flex; align-items: center; gap: 6px; width: 100%; padding: 7px 12px; font-weight: 600; color: var(--text); text-align: left; }
  .sec:hover { background: var(--bg-hover); }
  .chev { display: inline-grid; transform: rotate(-90deg); transition: transform 120ms; color: var(--text-muted); }
  .sec.open .chev { transform: none; }
  .body { display: flex; flex-direction: column; gap: 8px; padding: 2px 12px 10px; }
  .search, .query { width: 100%; box-sizing: border-box; font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding: 4px 7px; }
  .search:focus, .query:focus { outline: none; border-color: var(--accent); }
  .row { display: flex; align-items: center; justify-content: space-between; color: var(--text-muted); }
  .row input { accent-color: var(--accent); }
  .slider { display: flex; flex-direction: column; gap: 3px; color: var(--text-muted); }
  .slider input { width: 100%; accent-color: var(--accent); }
  .group { display: flex; align-items: center; gap: 6px; }
  .swatch { width: 26px; height: 22px; padding: 0; border: 1px solid var(--border-strong); border-radius: 4px; background: none; }
  .wide { width: 100%; padding: 5px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--text); }
  .wide:hover { background: var(--bg-hover); }
</style>
