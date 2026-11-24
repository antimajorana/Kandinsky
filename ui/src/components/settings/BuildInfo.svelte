<script lang="ts">
  import { api } from "../../lib/api";

  // which Kandinsky this is: the core's version, the commit it was built from and its plugin API, and the interface's build
  // (it may be newer than the core)
  let version = $state<Awaited<ReturnType<typeof api.version>> | null>(null);
  $effect(() => { void api.version().then((v) => (version = v), () => {}); });
  const sourceRef = $derived(version?.commit && /^[0-9a-f]{7,40}$/i.test(version.commit) ? version.commit : null);
</script>

{#if version}<p class="version" data-testid="kandinsky-version">Kandinsky <b>{version.version}</b>{#if version.commit} · commit <code>{version.commit}</code>{/if}{#if version.plugin_api} · plugin API {version.plugin_api}{/if}{#if version.ui} · interface build <code>{version.ui}</code>{/if}</p>{/if}
<!-- the credit the licence asks for (README.md, "License"): a modified version of Atlas -->
<p class="version credit" data-testid="kandinsky-credit">Kandinsky is based on Atlas by Alneb (github.com/Alneb/atlas), AGPL-3.0-or-later · modified 2026-11-15{#if sourceRef} · <a href={`https://github.com/antimajorana/Kandinsky/tree/${encodeURIComponent(sourceRef)}`} target="_blank" rel="noreferrer">Source code</a>{/if}</p>

<style>
  .version { margin: 0 0 10px; color: var(--text-muted); font-size: calc(12.5px * var(--ui-scale, 1)); }
  .version b { color: var(--text); font-weight: 600; }
  .credit { margin-top: -6px; }
</style>
