<script lang="ts">
  // Workspace plugins hub: Core & Installed plugins, active Obsidian plugins from `.obsidian/plugins/`
  // (unnecessary built-in / unused Obsidian plugins pruned out), and the bundled Kandinsky plugin catalog.
  import Icon from "../Icon.svelte";
  import PlatformChips from "./PlatformChips.svelte";
  import { api } from "../../lib/api";
  import { confirmDialog } from "../../lib/confirm";
  import type { Available } from "../../lib/gen/Available";
  import { OBSIDIAN_BRIDGE } from "../../lib/obsidian-plugin-map";
  import { pluginLog } from "../../lib/plugin-log.svelte";
  import { openPluginSettings, openPluginSettingsText } from "../../lib/plugin-settings.svelte";
  import { open } from "../../lib/dock";
  import { BUILTINS } from "../../lib/builtin-plugins";
  import { openSettingsAt } from "../../lib/settings-nav.svelte";
  import { plugins, pluginOn, pluginBlocked, pluginSpec, loadPlugins } from "../../lib/plugins.svelte";
  import { changedSettings, installFrom, installPlugin, isOff, mayOf, partsOf, removePlugin, switchPlugin, updatePlugin } from "../../lib/plugin-manage";
  import { toast } from "../../lib/state.svelte";
  import { errText } from "../../lib/text";
  import { onMount } from "svelte";

  type ObsidianItem = { id: string; name: string; version?: string; description?: string; author?: string; enabled: boolean };
  type TabFilter = "all" | "installed" | "obsidian" | "catalog";

  let { onnew, onblock }: { onnew: () => void; onblock: () => void } = $props();
  const PROPS = 4;

  let query = $state("");
  let tab = $state<TabFilter>("all");
  let catalog = $state<Available[]>([]);
  let obsidianList = $state<ObsidianItem[]>([]);
  let busyIds = $state<Record<string, boolean>>({});
  let batchBusy = $state(false);
  let trashBusy = $state(false);

  async function refreshCatalog(): Promise<void> {
    const [avail, obs] = await Promise.all([
      api.availablePlugins().catch(() => [] as Available[]),
      api.obsidianPlugins().catch(() => [] as ObsidianItem[]),
    ]);
    catalog = avail;
    obsidianList = obs;
  }

  onMount(() => {
    if (!plugins.loaded) void loadPlugins();
    void refreshCatalog();
  });

  const q = $derived(query.trim().toLowerCase());
  const matches = (...parts: (string | undefined | null)[]) =>
    !q || parts.some((s) => s && s.toLowerCase().includes(q));

  const installedById = $derived(new Map(plugins.list.map((p) => [p.id, p])));
  const catalogById = $derived(new Map(catalog.map((a) => [a.id, a])));
  const solverInstalled = $derived(installedById.get("solver"));
  const solverOffer = $derived(catalogById.get("solver"));
  const showSolverCard = $derived(Boolean((solverInstalled || solverOffer) && matches("solver", "solver agent", "math", "physics", "app")));
  const agyInstalled = $derived(installedById.get("antigravity"));
  const agyOffer = $derived(catalogById.get("antigravity"));
  const showAgyCard = $derived(Boolean((agyInstalled || agyOffer) && matches("antigravity", "agy", "google", "claude", "agent", "mcp")));

  const neededObsidian = $derived(obsidianList.filter((o) => OBSIDIAN_BRIDGE[o.id]?.kind !== "unnecessary"));
  const unnecessaryObsidian = $derived(obsidianList.filter((o) => OBSIDIAN_BRIDGE[o.id]?.kind === "unnecessary"));

  const shownBuiltins = $derived(BUILTINS.filter((b) => matches(b.title, b.id, b.description, b.parts)));
  const shownInstalled = $derived(plugins.list.filter((p) => matches(p.title, p.id, p.description)));
  const shownObsidian = $derived(neededObsidian.filter((o) => {
    const br = OBSIDIAN_BRIDGE[o.id];
    return matches(o.name, o.id, o.description, br?.summary, br?.kind === "plugin" ? br.targetId : "");
  }));

  const sortedCatalog = $derived([...catalog]
    .filter((a) => a.runs_here && matches(a.title, a.id, a.description, a.tier))
    .sort((a, b) => {
      const rank = (x: Available) => x.tier === "obsidian" ? 0 : x.tier === "stable" ? 1 : 2;
      return rank(a) - rank(b) || a.title.localeCompare(b.title);
    }));

  const missingRecommendedTargets = $derived((() => {
    const ids = new Set<string>();
    for (const o of neededObsidian) {
      if (!o.enabled) continue;
      const br = OBSIDIAN_BRIDGE[o.id];
      if (br?.kind === "plugin" && br.recommended !== false) {
        const inst = installedById.get(br.targetId);
        if (!inst || isOff(br.targetId)) {
          if (catalogById.has(br.targetId) || inst) ids.add(br.targetId);
        }
      }
    }
    return [...ids];
  })());

  async function enableByTargetId(targetId: string): Promise<void> {
    if (busyIds[targetId]) return;
    const existing = installedById.get(targetId);
    if (existing) {
      switchPlugin(targetId, isOff(targetId));
      return;
    }
    const offer = catalogById.get(targetId);
    if (!offer) {
      toast("Plugin not in bundle", `Could not find ${targetId} in bundled plugins.`, "error");
      return;
    }
    busyIds = { ...busyIds, [targetId]: true };
    try {
      await installFrom(offer.url);
      await refreshCatalog();
    } finally {
      const next = { ...busyIds };
      delete next[targetId];
      busyIds = next;
    }
  }

  async function enableAllRecommended(): Promise<void> {
    if (batchBusy || !missingRecommendedTargets.length) return;
    batchBusy = true;
    let count = 0;
    try {
      for (const id of missingRecommendedTargets) {
        const existing = installedById.get(id);
        if (existing) {
          if (isOff(id)) { switchPlugin(id, true); count++; }
          continue;
        }
        const offer = catalogById.get(id);
        if (!offer) continue;
        await api.installPlugin(offer.url, offer.id);
        count++;
      }
      await loadPlugins();
      await refreshCatalog();
      if (count) toast(`Enabled ${count} plugin${count === 1 ? "" : "s"}`, "Your Obsidian workflow equivalents are now active in this vault.", "success", 8000);
    } catch (e) {
      toast("Could not enable all plugins", errText(e), "error", 9000);
    } finally {
      batchBusy = false;
    }
  }

  async function trashUnnecessaryObsidian(): Promise<void> {
    if (trashBusy || !unnecessaryObsidian.length) return;
    const names = unnecessaryObsidian.map((o) => o.name).join(", ");
    const ok = await confirmDialog(
      `Move ${unnecessaryObsidian.length} unnecessary Obsidian plugins to Trash?`,
      `${names} — moved safely to .atlas/trash/ so nothing is permanently deleted.`,
      "Move to Trash",
      false,
    );
    if (!ok) return;
    trashBusy = true;
    try {
      const r = await api.removeObsidianPlugins(unnecessaryObsidian.map((o) => o.id));
      await refreshCatalog();
      toast(`Moved ${r.moved.length} plugin${r.moved.length === 1 ? "" : "s"} to Trash`, "Saved under .atlas/trash/.", "success", 8000);
    } catch (e) {
      toast("Could not move plugins", errText(e), "error", 9000);
    } finally {
      trashBusy = false;
    }
  }

  async function handleRemove(id: string): Promise<void> {
    const p = installedById.get(id);
    if (!p) return;
    removePlugin(p);
  }
</script>

<section class="settings-panel plugins">
  <div class="hub-bar">
    <div class="search-box">
      <Icon name="search" size={14} />
      <input type="search" bind:value={query} placeholder="Filter installed, Obsidian, or catalog plugins…" aria-label="Filter plugins" />
      {#if query}<button class="clear-btn" onclick={() => (query = "")} aria-label="Clear filter"><Icon name="close" size={12} /></button>{/if}
    </div>
    <div class="tabs" role="tablist">
      <button class="pill" class:active={tab === "all"} onclick={() => (tab = "all")}>All</button>
      <button class="pill" class:active={tab === "installed"} onclick={() => (tab = "installed")}>
        Installed <span class="cnt">{BUILTINS.length + plugins.list.length}</span>
      </button>
      {#if neededObsidian.length || unnecessaryObsidian.length}
        <button class="pill" class:active={tab === "obsidian"} onclick={() => (tab = "obsidian")}>
          Your Obsidian Plugins <span class="cnt">{neededObsidian.length}</span>
        </button>
      {/if}
      <button class="pill" class:active={tab === "catalog"} onclick={() => (tab = "catalog")}>
        Browse Catalog <span class="cnt">{sortedCatalog.length}</span>
      </button>
    </div>
  </div>

  {#if showSolverCard && (tab === "all" || tab === "installed" || tab === "catalog")}
    {@const solverOn = !!(solverInstalled && !isOff("solver"))}
    <div class="solver-feature">
      <span class="solver-badge" aria-hidden="true"><Icon name="sigma" size={16} /></span>
      <div class="solver-copy">
        <b>Solver App</b>
        <span class="badge ok">Kandinsky App</span>
        <span class="d">Pins Solver to the top of your left sidebar, launches local Solver services silently in the background, and docks Solver beside your notes.</span>
      </div>
      <span class="acts">
        {#if solverInstalled && solverOn && solverInstalled.view}
          <button class="btn primary" onclick={() => open(pluginSpec(solverInstalled))}><Icon name="sigma" size={13} /> Open Solver</button>
          <button class="btn small" onclick={() => void openPluginSettings("solver")}>Settings…</button>
        {:else}
          <button class="btn primary" disabled={!!busyIds["solver"]} onclick={() => void enableByTargetId("solver")}>
            <Icon name="sigma" size={13} />
            {busyIds["solver"] ? "Adding…" : "Add Solver to Sidebar"}
          </button>
        {/if}
      </span>
    </div>
  {/if}

  {#if showAgyCard && (tab === "all" || tab === "installed" || tab === "catalog")}
    {@const agyOn = !!(agyInstalled && !isOff("antigravity"))}
    <div class="solver-feature">
      <span class="solver-badge" aria-hidden="true"><Icon name="claude" size={16} /></span>
      <div class="solver-copy">
        <b>Google Antigravity</b>
        <span class="badge ok">AI Agent</span>
        <span class="d">Integrates Antigravity (agy) like Claude: terminal sessions (+ menu &amp; Super+K), send note selections (@path#Lfrom-to), status bar launcher, and 1-click Kandinsky MCP connection.</span>
      </div>
      <span class="acts">
        {#if agyInstalled && agyOn && agyInstalled.view}
          <button class="btn primary" onclick={() => open(pluginSpec(agyInstalled))}><Icon name="claude" size={13} /> Open Antigravity</button>
          <button class="btn small" onclick={() => void openPluginSettings("antigravity")}>Settings…</button>
        {:else}
          <button class="btn primary" disabled={!!busyIds["antigravity"]} onclick={() => void enableByTargetId("antigravity")}>
            <Icon name="claude" size={13} />
            {busyIds["antigravity"] ? "Enabling…" : "Enable Antigravity"}
          </button>
        {/if}
      </span>
    </div>
  {/if}

  {#if tab === "all" || tab === "installed"}
    <div class="group-head">
      <h3>Installed &amp; Core Plugins <span class="n">{shownBuiltins.length + shownInstalled.length}</span></h3>
      <span class="group-acts">
        <button class="btn small" onclick={installPlugin} title="Install from a folder, git repository, or archive"><Icon name="arrow-down" size={13} /> Install from path…</button>
        <button class="btn small" onclick={onnew}><Icon name="plus" size={13} /> New plugin</button>
        <button class="btn small" onclick={onblock} title="Create a note/page block from a template"><Icon name="plus" size={13} /> New block</button>
      </span>
    </div>
    <ul>
      {#each shownBuiltins as b (b.id)}
        <li class:off={isOff(b.id)}>
          <button class="switch" class:on={!isOff(b.id)} role="switch" aria-checked={!isOff(b.id)} aria-label="Plugin {b.title}" onclick={() => switchPlugin(b.id, isOff(b.id))}><span></span></button>
          <div class="main">
            {#if b.page}{@const at = b.page}<button class="name" aria-label="The page of {b.title}" title="Its settings" onclick={() => openSettingsAt(at)}><b>{b.title}</b></button>{:else}<b>{b.title}</b>{/if}
            <span class="badge core">core</span>
            <span class="d">{b.description}</span>
            <span class="d">{b.parts}</span>
          </div>
        </li>
      {/each}
      {#each shownInstalled as p (p.id)}
        <li class:off={!pluginOn(p)}>
          <button class="switch" class:on={!isOff(p.id)} role="switch" aria-checked={!isOff(p.id)} aria-label="Plugin {p.title}" disabled={!!p.error} onclick={() => switchPlugin(p.id, isOff(p.id))}><span></span></button>
          <div class="main">
            <button class="name" aria-label="The page of {p.title}" title="Its settings, problems and actions" onclick={() => void openPluginSettings(p.id)}><b>{p.title}</b></button>
            <code>{p.id}</code>{#if p.version} <code>v{p.version}</code>{/if}
            {#if p.description}<span class="d">{p.description}</span>{/if}
            {#if mayOf(p.permissions, p.has_helper)}<span class="d may" data-plugin-may={p.id}>May {mayOf(p.permissions, p.has_helper)}.</span>{/if}
            {#if p.error ?? plugins.errors[p.id]}<span class="err">{p.error ?? plugins.errors[p.id]}</span>
            {:else if !isOff(p.id) && pluginBlocked(p)}<span class="err">Not loaded — {pluginBlocked(p)}</span>{/if}
            {#if pluginLog[p.id]?.length}<button class="d problems" onclick={() => void openPluginSettings(p.id)}>{pluginLog[p.id].length} problem{pluginLog[p.id].length === 1 ? "" : "s"} since Kandinsky started</button>{/if}
            <span class="d">{partsOf(p).join(" · ") || "active"}</span>
            <span class="d"><PlatformChips {p} /></span>
            {#if changedSettings(p).length}
              {@const changed = changedSettings(p)}
              <span class="props" title="Its settings changed from the defaults">{#each changed.slice(0, PROPS) as s (s.key)}<span><i>{s.label}</i> {s.value}</span>{/each}{#if changed.length > PROPS}<span class="more">{changed.length - PROPS} more</span>{/if}</span>
            {/if}
          </div>
          <span class="acts">
            {#if pluginOn(p) && p.view}<button class="icon-btn" title="Open" aria-label="Open {p.title}" onclick={() => open(pluginSpec(p))}><Icon name="panel-right" size={13} /></button>{/if}
            {#if p.fields.length}<button class="btn small" aria-label="Settings of {p.title}" onclick={() => void openPluginSettings(p.id)}>Settings…</button>{/if}
            {#if p.from}<button class="icon-btn" title="Update from {p.from}" aria-label="Update {p.title}" onclick={() => void updatePlugin(p).then(refreshCatalog)}><Icon name="refresh" size={13} /></button>{/if}
            {#if p.fields.length}<button class="icon-btn" title="Its settings file (.atlas/plugin-settings/{p.id}.toml)" aria-label="Edit {p.title} settings file" onclick={() => void openPluginSettingsText(p)}><Icon name="file-text" size={13} /></button>{/if}
            <button class="icon-btn" title="Remove from this vault (to .atlas/trash/)" aria-label="Remove {p.title}" onclick={() => void handleRemove(p.id)}><Icon name="close" size={13} /></button>
          </span>
        </li>
      {:else}
        {#if !q}<li class="muted">No extra vault plugins installed yet — switch on any Obsidian or Catalog plugin below.</li>{/if}
      {/each}
    </ul>
  {/if}

  {#if (neededObsidian.length || unnecessaryObsidian.length) && (tab === "all" || tab === "obsidian")}
    <div class="group-head spaced">
      <div>
        <h3>Your Obsidian Plugins <span class="n">{shownObsidian.length}</span></h3>
        <p class="desc">Only the Obsidian plugins that add features beyond Kandinsky's built-ins are shown here.</p>
      </div>
      {#if missingRecommendedTargets.length}
        <button class="btn primary" disabled={batchBusy} onclick={() => void enableAllRecommended()}>
          <Icon name="check" size={13} />
          {batchBusy ? "Enabling…" : `Enable ${missingRecommendedTargets.length} Recommended`}
        </button>
      {/if}
    </div>
    <ul>
      {#each shownObsidian as o (o.id)}
        {@const bridge = OBSIDIAN_BRIDGE[o.id]}
        {@const targetId = bridge?.kind === "plugin" ? bridge.targetId : null}
        {@const inst = targetId ? installedById.get(targetId) : undefined}
        {@const active = !!(inst && !isOff(inst.id))}
        <li class:off={!active}>
          {#if targetId}
            <button
              class="switch"
              class:on={active}
              role="switch"
              aria-checked={active}
              disabled={!!busyIds[targetId]}
              aria-label="Enable Kandinsky equivalent for {o.name}"
              onclick={() => void enableByTargetId(targetId)}
            ><span></span></button>
          {:else}
            <span class="builtin-dot faint"><Icon name="plugin" size={14} /></span>
          {/if}
          <div class="main">
            <b>{o.name}</b>
            <code>{o.id}</code>
            {#if o.version}<code>v{o.version}</code>{/if}
            {#if !o.enabled}<span class="badge muted-badge">off in Obsidian</span>{/if}
            {#if bridge?.kind === "plugin"}
              {#if inst && !isOff(inst.id)}
                <span class="badge ok">active via {inst.title}</span>
              {:else}
                <span class="badge obs">Kandinsky plugin: {catalogById.get(bridge.targetId)?.title ?? bridge.targetId}</span>
              {/if}
              <span class="d">{bridge.summary}</span>
            {:else}
              <span class="d">{o.description ?? "Installed in .obsidian/plugins/."}</span>
            {/if}
          </div>
          <span class="acts">
            {#if targetId}
              {#if inst}
                <button class="btn small" onclick={() => void openPluginSettings(inst.id)}>Settings…</button>
              {:else}
                <button class="btn small accent-btn" disabled={!!busyIds[targetId]} onclick={() => void enableByTargetId(targetId)}>
                  {busyIds[targetId] ? "Installing…" : "Enable"}
                </button>
              {/if}
            {/if}
          </span>
        </li>
      {/each}
    </ul>
    {#if unnecessaryObsidian.length}
      <div class="prune-bar">
        <span>{unnecessaryObsidian.length} unnecessary Obsidian plugin{unnecessaryObsidian.length === 1 ? "" : "s"} hidden (already built into Kandinsky or unused).</span>
        <button class="btn small" disabled={trashBusy} onclick={() => void trashUnnecessaryObsidian()}>
          <Icon name="trash" size={12} />
          {trashBusy ? "Moving…" : `Move ${unnecessaryObsidian.length} from .obsidian to Trash…`}
        </button>
      </div>
    {/if}
  {/if}

  {#if tab === "all" || tab === "catalog"}
    <div class="group-head spaced">
      <div>
        <h3>Browse Kandinsky Plugin Catalog <span class="n">{sortedCatalog.length}</span></h3>
        <p class="desc">Obsidian-compatible plugins and official Kandinsky plugins bundled with the app. Click any switch or Install button to add it to this vault.</p>
      </div>
    </div>
    <ul>
      {#each sortedCatalog as a (a.id)}
        {@const inst = installedById.get(a.id)}
        {@const active = !!(inst && !isOff(inst.id))}
        <li class:off={!active && !!inst}>
          <button
            class="switch"
            class:on={active}
            role="switch"
            aria-checked={active}
            disabled={!!busyIds[a.id]}
            aria-label="{inst ? 'Toggle' : 'Install and enable'} {a.title}"
            onclick={() => void enableByTargetId(a.id)}
          ><span></span></button>
          <div class="main">
            {#if inst}
              <button class="name" onclick={() => void openPluginSettings(inst.id)}><b>{a.title}</b></button>
            {:else}
              <b>{a.title}</b>
            {/if}
            <code>{a.id}</code>
            {#if a.version}<code>v{a.version}</code>{/if}
            {#if a.tier === "obsidian"}
              <span class="badge obs">Obsidian parity</span>
            {:else if a.tier === "stable"}
              <span class="badge core">official</span>
            {:else}
              <span class="badge muted-badge">{a.tier}</span>
            {/if}
            {#if inst && !isOff(inst.id)}<span class="badge ok">installed</span>{/if}
            {#if a.description}<span class="d">{a.description}</span>{/if}
          </div>
          <span class="acts">
            {#if inst}
              {#if pluginOn(inst) && inst.view}<button class="icon-btn" title="Open" aria-label="Open {inst.title}" onclick={() => open(pluginSpec(inst))}><Icon name="panel-right" size={13} /></button>{/if}
              <button class="btn small" onclick={() => void openPluginSettings(inst.id)}>Settings…</button>
            {:else}
              <button class="btn small accent-btn" disabled={!!busyIds[a.id]} onclick={() => void enableByTargetId(a.id)}>
                {busyIds[a.id] ? "Installing…" : "Install"}
              </button>
            {/if}
          </span>
        </li>
      {:else}
        <li class="muted">No matching plugins in catalog.</li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .hub-bar { display: flex; flex-direction: column; gap: 8px; margin: 4px 0 12px; }
  .search-box { display: flex; align-items: center; gap: 8px; padding: 5px 10px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--bg); color: var(--text-muted); }
  .search-box input { flex: 1; border: none; background: transparent; color: var(--text); font-size: calc(13px * var(--ui-scale, 1)); outline: none; }
  .clear-btn { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 4px; color: var(--text-muted); }
  .clear-btn:hover { background: var(--bg-hover); color: var(--text); }
  .tabs { display: flex; flex-wrap: wrap; gap: 6px; }
  .pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 11px; border-radius: 999px; border: 1px solid var(--border-strong); font-size: calc(12px * var(--ui-scale, 1)); color: var(--text-muted); background: var(--bg); }
  .pill:hover { background: var(--bg-hover); color: var(--text); }
  .pill.active { background: var(--accent); border-color: var(--accent); color: var(--bg); font-weight: 600; }
  .pill .cnt { opacity: .8; font-size: calc(11px * var(--ui-scale, 1)); }
  .group-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin: 6px 0 4px; }
  .group-head.spaced { margin-top: 22px; padding-top: 12px; border-top: 2px solid var(--border); }
  .group-acts { display: flex; flex-wrap: wrap; gap: 6px; }
  h3 { margin: 2px 0; }
  .n { color: var(--text-faint); font-weight: 400; }
  .desc, .muted { margin: 2px 0 6px; color: var(--text-faint); font-size: calc(12.5px * var(--ui-scale, 1)); }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; padding: 8px 0; border-top: 1px solid var(--border); }
  li.off .main { opacity: .65; }
  .main { flex: 1 1 320px; min-width: 0; display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; }
  .acts { display: flex; gap: 4px; align-items: center; margin-left: auto; }
  .props .more { color: var(--text-faint); }
  code { color: var(--text-faint); font-size: calc(11px * var(--ui-scale, 1)); }
  .badge { font-size: calc(10.5px * var(--ui-scale, 1)); padding: 1px 7px; border-radius: 999px; font-weight: 600; border: 1px solid var(--border-strong); color: var(--text-muted); }
  .badge.ok { color: var(--accent); border-color: var(--accent); }
  .badge.obs { color: var(--text); background: var(--bg-hover); }
  .badge.core { color: var(--text-muted); }
  .badge.muted-badge { color: var(--text-faint); border-color: var(--border); font-weight: 400; }
  .builtin-dot { width: 34px; height: 20px; display: grid; place-items: center; color: var(--accent); flex: none; }
  .builtin-dot.faint { color: var(--text-faint); }
  .d { color: var(--text-muted); font-size: calc(12.5px * var(--ui-scale, 1)); flex-basis: 100%; }
  .err { color: var(--red); flex-basis: 100%; }
  .props { display: block; flex-basis: 100%; font-size: calc(12px * var(--ui-scale, 1)); line-height: 1.5; color: var(--text); }
  .props span + span::before { content: " · "; color: var(--text-faint); }
  .props i { font-style: normal; color: var(--text-faint); }
  .props i::after { content: ": "; }
  .switch { flex: none; width: 34px; height: 20px; border-radius: 10px; background: var(--border-strong); position: relative; }
  .switch span { position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: var(--bg); transition: transform .15s; }
  .switch.on { background: var(--accent); }
  .switch.on span { transform: translateX(14px); }
  .switch:disabled { opacity: .4; }
  .icon-btn { display: grid; place-items: center; width: 26px; height: 26px; border-radius: var(--radius-sm); color: var(--text-muted); }
  .icon-btn:hover { background: var(--bg-active); color: var(--text); }
  .btn { display: inline-flex; gap: 6px; align-items: center; padding: 4px 10px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); font-size: calc(12px * var(--ui-scale, 1)); }
  .btn.small { padding: 2px 9px; }
  .btn:hover { background: var(--bg-hover); }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: var(--bg); font-weight: 600; }
  .btn.primary:hover { opacity: .92; }
  .btn.accent-btn { border-color: var(--accent); color: var(--accent); font-weight: 600; }
  .btn:disabled { opacity: .5; pointer-events: none; }
  .name { font-weight: 700; color: var(--accent); padding: 0; }
  .name:hover { text-decoration: underline; }
  .problems { color: var(--red); text-align: left; padding: 0; }
  .problems:hover { text-decoration: underline; }
  .prune-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--bg-hover); color: var(--text-muted); font-size: calc(12px * var(--ui-scale, 1)); }
  .solver-feature { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 12px; padding: 10px 12px; margin: 2px 0 14px; border: 1px solid var(--accent); border-radius: var(--radius-sm); background: var(--bg-hover); }
  .solver-badge { width: 32px; height: 32px; border-radius: 7px; background: var(--accent); color: var(--bg); display: grid; place-items: center; flex: none; }
  .solver-copy { flex: 1 1 280px; min-width: 0; display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; }
</style>
