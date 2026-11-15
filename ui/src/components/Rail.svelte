<script lang="ts">
  // Left activity rail (horizontal-tabs layout): Kandinsky "Several Circles" emblem + sidebar toolbars as icons.
  import { railItems } from "../lib/sidebar.svelte";
  import { tabs } from "../lib/tabs.svelte";
  import { app } from "../lib/state.svelte";
  import { toolTip as tip, type ToolItem } from "../lib/toolbar";
  import Icon from "./Icon.svelte";

  const bars = $derived(railItems());
  const wsTitle = $derived(app.workspace?.name ? `${app.workspace.name} — Kandinsky` : "Kandinsky");

  function isActive(b: ToolItem): boolean {
    if (b.icon === "files" || b.icon === "search" || b.icon === "outline" || b.icon === "git") {
      return tabs.side === b.icon;
    }
    if (b.icon === "today") return tabs.active === "today";
    if (b.icon === "graph") return tabs.active === "graph";
    if (b.icon === "settings") return tabs.active === "settings";
    return false;
  }
</script>

<nav class="rail" aria-label="Activity">
  <div class="brand" title={wsTitle} aria-label={wsTitle}>
    <svg class="kandinsky-emblem" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
      <defs>
        <radialGradient id="kc-cobalt-halo" cx="42%" cy="58%" r="48%">
          <stop offset="0%" stop-color="#7d97f4" stop-opacity="0.42" />
          <stop offset="65%" stop-color="#3d63c9" stop-opacity="0.16" />
          <stop offset="100%" stop-color="#13151c" stop-opacity="0" />
        </radialGradient>
      </defs>
      <!-- Outer Bauhaus halo & deep cosmic disc -->
      <circle cx="16" cy="16" r="15" fill="#13151c" stroke="rgba(176, 198, 210, 0.55)" stroke-width="1.4" />
      <!-- Subtle lower forest horizon arc from Several Circles -->
      <path d="M 4.2 24.5 A 13.5 13.5 0 0 1 27.8 24.5 A 14.2 14.2 0 0 1 4.2 24.5 Z" fill="#21382d" fill-opacity="0.72" />
      <!-- Concentric Cobalt halo + Ultramarine circle -->
      <circle cx="13.6" cy="18.2" r="9.2" fill="url(#kc-cobalt-halo)" />
      <circle cx="13.6" cy="18.2" r="5.9" fill="#3259c2" fill-opacity="0.94" stroke="#7d97f4" stroke-width="0.65" stroke-opacity="0.72" />
      <!-- Cadmium Ochre circle overlapping upper center -->
      <circle cx="16.8" cy="11.2" r="4.7" fill="#dfab2e" fill-opacity="0.93" />
      <!-- Warm Amber translucent circle -->
      <circle cx="21.2" cy="13.2" r="2.7" fill="#e28327" fill-opacity="0.86" />
      <!-- Vermilion circle overlapping lower right -->
      <circle cx="20.6" cy="18.5" r="3.8" fill="#d94e41" fill-opacity="0.9" />
      <!-- Upper-left concentric Bauhaus bullseye -->
      <circle cx="9.6" cy="10.2" r="2.5" fill="#efc8d2" fill-opacity="0.92" stroke="#dfab2e" stroke-width="0.95" />
      <circle cx="9.6" cy="10.2" r="1.15" fill="#d94e41" />
      <!-- Upper-right & lower Viridian circles -->
      <circle cx="23.0" cy="9.4" r="1.95" fill="#3ca395" stroke="#a8dfd4" stroke-width="0.75" />
      <circle cx="19.4" cy="24.2" r="2.35" fill="#3ca395" fill-opacity="0.92" />
      <circle cx="12.6" cy="24.9" r="1.35" fill="#e28327" />
    </svg>
  </div>
  {#each bars as bar, i}
    {#if i}<div class="sep"></div>{/if}
    {#each bar as b}
      {#if b === "spacer"}<div class="grow"></div>
      {:else if b === "divider"}<div class="sep"></div>
      {:else}<button class="rail-btn" class:active={isActive(b)} onclick={b.run} aria-label={b.label} data-tip={tip(b)}><Icon name={b.icon} size={17} /></button>{/if}
    {/each}
  {/each}
</nav>

<style>
  .rail { width: var(--rail-w); flex: none; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 11px 0 10px; background: var(--bg-side, var(--bg-alt)); border-right: 1px solid var(--border); }
  .brand { margin-bottom: 8px; display: grid; place-items: center; flex: none; }
  .kandinsky-emblem { display: block; border-radius: 50%; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.24); }
  :global([data-theme="light"]) .kandinsky-emblem { box-shadow: 0 0 0 1px rgba(28, 29, 34, 0.14), 0 2px 6px rgba(28, 29, 34, 0.12); }
  .rail-btn { position: relative; width: 32px; height: 32px; border-radius: var(--radius); display: grid; place-items: center; color: var(--text-muted); transition: color .12s, background .12s; }
  .rail-btn:hover { color: var(--text); background: var(--bg-hover); }
  .rail-btn.active { color: var(--accent); background: var(--accent-soft); }
  .rail-btn:active { transform: scale(.96); }
  .rail-btn::after { content: attr(data-tip); position: absolute; left: calc(100% + 10px); top: 50%; transform: translateY(-50%) translateX(-4px); white-space: nowrap;
    background: var(--bg-elev); color: var(--text); border: 1px solid var(--border-strong); box-shadow: var(--shadow-sm); padding: 4px 9px; border-radius: var(--radius); font-size: calc(12px * var(--ui-scale, 1));
    pointer-events: none; opacity: 0; transition: opacity .12s, transform .12s; z-index: 100; }
  .rail-btn:hover::after { opacity: 1; transform: translateY(-50%); transition-delay: .35s; }
  .sep { width: 18px; height: 1px; background: var(--border); margin: 5px 0; }
  .grow { flex: 1; }
</style>
