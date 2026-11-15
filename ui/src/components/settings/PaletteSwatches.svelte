<script lang="ts">
  // The colour schemes as swatches to pick from, each drawn by the palette's own rules (palettes.css matches
  // `.pal-sample[data-theme][data-palette]` beside the window's): the day's (`ui.palette`) in light, the night's
  // (`ui.palette_dark`) in dark, with "as by day" first for the night.
  import { leaves, options, choiceLabel, resolve, valueOf, setValue } from "../../lib/settings-schema";

  let { path, label }: { path: string; label: string } = $props();
  const night = $derived(path === "ui.palette_dark");
  const schema = $derived(resolve(leaves().get("ui.palette") ?? {}));
  const names = $derived((options(schema) ?? []).map((o) => o.value));
  const v = $derived((valueOf(path) as string | null) ?? "");
  const day = $derived((valueOf("ui.palette") as string) ?? "kandinsky");

  const isKandinsky = (name: string | null | undefined) => name === "kandinsky" || name === "atlas";
  const labelFor = (name: string) => (isKandinsky(name) ? "Kandinsky" : choiceLabel(schema, name));
</script>

<div class="swatches" role="radiogroup" aria-label={label} id={path}>
  {#if night}
    <button role="radio" aria-checked={!v} class:on={!v} title="The day's scheme at night too" onclick={() => setValue(path, null)}>
      <span class="pal-sample sample" class:kandinsky={isKandinsky(day)} data-theme="dark" data-palette={isKandinsky(day) ? "kandinsky" : day}>
        {#if isKandinsky(day)}
          <span class="sc-dots" aria-hidden="true">
            <i class="sc-cobalt"></i><i class="sc-ochre"></i><i class="sc-vermilion"></i><i class="sc-viridian"></i>
          </span>
        {:else}
          <i></i>
        {/if}
        <b>Aa</b>
      </span>
      <span class="name">as by day</span>
    </button>
  {/if}
  {#each names as n (n)}
    {@const active = v === n || (isKandinsky(n) && isKandinsky(v))}
    <button role="radio" aria-checked={active} class:on={active} onclick={() => setValue(path, n)}>
      <span class="pal-sample sample" class:kandinsky={isKandinsky(n)} data-theme={night ? "dark" : "light"} data-palette={isKandinsky(n) ? "kandinsky" : n}>
        {#if isKandinsky(n)}
          <span class="sc-dots" aria-hidden="true">
            <i class="sc-cobalt"></i><i class="sc-ochre"></i><i class="sc-vermilion"></i><i class="sc-viridian"></i>
          </span>
        {:else}
          <i></i>
        {/if}
        <b>Aa</b>
      </span>
      <span class="name">{labelFor(n)}</span>
    </button>
  {/each}
</div>

<style>
  .swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(calc(64px * var(--ui-scale, 1)), 1fr)); gap: 6px; width: min(100%, 460px); }
  button { display: flex; flex-direction: column; align-items: stretch; gap: 3px; padding: 3px; border: 1px solid transparent; border-radius: var(--radius); background: none; cursor: pointer; font: inherit; color: var(--text-muted); }
  button:hover { border-color: var(--border); color: var(--text); }
  button.on { border-color: var(--accent); color: var(--text); }
  .sample { position: relative; display: flex; align-items: center; justify-content: center; height: calc(38px * var(--ui-scale, 1)); border-radius: var(--radius-sm);
    background: var(--bg); border: 1px solid var(--border); color: var(--heading, var(--text)); }
  .sample.kandinsky[data-theme="dark"] { background: #15161a; color: #eceae4; }
  .sample.kandinsky[data-theme="light"] { background: #faf8f4; color: #1c1d22; }
  .sample b { font-size: calc(13px * var(--ui-scale, 1)); font-weight: 600; }
  .sample > i { position: absolute; right: 5px; bottom: 5px; width: 9px; height: 9px; border-radius: 50%; background: var(--accent); }
  .sc-dots { position: absolute; right: 4px; bottom: 4px; display: inline-flex; align-items: center; gap: 2px; }
  .sc-dots i { width: 6px; height: 6px; border-radius: 50%; display: block; }
  .sc-cobalt { background: #7d97f4; }
  .sample[data-theme="light"] .sc-cobalt { background: #264ca4; }
  .sc-ochre { background: #dfab2e; }
  .sc-vermilion { background: #d94e41; }
  .sc-viridian { background: #3ca395; }
  .name { font-size: calc(11px * var(--ui-scale, 1)); text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: capitalize; }
</style>
