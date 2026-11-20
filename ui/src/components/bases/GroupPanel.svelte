<script lang="ts">
  // Toolbar Group popover: search properties, ungroup (disabled on boards, which require lanes), or pick a group property.
  import Icon from "../Icon.svelte";
  import Select from "../Select.svelte";

  let { group, board, subItemsBy = null, props, ongroup, onsubitems }: {
    group: string | null;
    board: boolean;
    subItemsBy?: string | null;
    props: { id: string; label: string }[];
    ongroup: (property: string | null) => void;
    onsubitems?: (property: string | null) => void;
  } = $props();

  let q = $state("");
  const norm = (s: string) => s.replace(/^note\./, "");
  const isCurrent = (id: string) => !!group && (group === id || norm(group) === norm(id));
  const hit = (id: string, label: string) => !q.trim() || `${id} ${label}`.toLowerCase().includes(q.trim().toLowerCase());

  const items = $derived(
    props.filter((p) => {
      if (isCurrent(p.id)) return hit(p.id, p.label);
      if (p.id === "file.name") return false;
      if (board && /^(file|formula)\./.test(p.id)) return false;
      return hit(p.id, p.label);
    }),
  );
  const showNone = $derived(!q.trim() || "none ungrouped".includes(q.trim().toLowerCase()));
  const subOptions = $derived([
    { value: "", label: "Off (flat rows)" },
    ...props.filter((p) => !p.id.startsWith("file.")).map((p) => ({ value: norm(p.id), label: p.label })),
  ]);
</script>

<input
  class="search"
  type="search"
  placeholder="Search properties…"
  aria-label="Search group properties"
  bind:value={q}
  spellcheck="false"
/>

{#if showNone}
  <button
    type="button"
    class="opt"
    class:active={!group}
    disabled={board}
    title={board ? "Board views require a lane property" : "Show rows without grouping"}
    onclick={() => ongroup(null)}
  >
    <span class="chk">{#if !group}<Icon name="check" size={13} />{/if}</span>
    <span class="label">None (ungrouped)</span>
  </button>
  {#if board}
    <p class="board-note">Boards require a property for lanes.</p>
  {/if}
  <div class="sep"></div>
{/if}

<ul class="list" aria-label="Group by property">
  {#each items as p (p.id)}
    {@const active = isCurrent(p.id)}
    <li>
      <button type="button" class="opt" class:active onclick={() => ongroup(p.id)}>
        <span class="chk">{#if active}<Icon name="check" size={13} />{/if}</span>
        <span class="label">{p.label}</span>
        {#if p.label.toLowerCase() !== p.id.replace(/^(note|file|formula)\./, "").toLowerCase()}
          <span class="id">{p.id}</span>
        {/if}
      </button>
    </li>
  {:else}
    <li class="empty">{q.trim() ? "No matching properties." : "No groupable properties."}</li>
  {/each}
</ul>

{#if !board && onsubitems}
  <div class="sep"></div>
  <div class="sub-row">
    <span>Sub-items (parent link)</span>
    <Select
      label="Sub-items (parent link)"
      value={subItemsBy ?? ""}
      options={subOptions}
      onchange={(v) => onsubitems(v || null)}
    />
  </div>
{/if}

<style>
  .search { height: 28px; width: 100%; padding: 0 8px; margin-bottom: 6px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg); color: var(--text); font: inherit; }
  .search:focus { outline: none; border-color: var(--accent); }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; max-height: 280px; overflow-y: auto; }
  .opt { display: flex; align-items: center; gap: 7px; width: 100%; min-height: 28px; padding: 0 6px; border-radius: var(--radius-sm); color: var(--text); font: inherit; text-align: left; min-width: 0; }
  .opt:hover:not(:disabled), .opt:focus-visible { background: var(--bg-hover); outline: none; }
  .opt.active { color: var(--accent); font-weight: 500; background: var(--accent-soft); }
  .opt:disabled { color: var(--text-faint); cursor: not-allowed; opacity: .65; }
  .chk { flex: none; width: 14px; height: 14px; display: grid; place-items: center; color: var(--accent); }
  .label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .id { flex: none; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-faint); font-family: var(--font-mono); font-size: .84em; }
  .board-note { margin: 2px 6px 4px 27px; color: var(--text-faint); font-size: .86em; line-height: 1.3; }
  .sep { height: 1px; background: var(--border); margin: 4px 2px; }
  .sub-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 6px; font-size: .9em; color: var(--text-muted); }
  .sub-row :global(.select) { min-width: 136px; max-width: 160px; }
  .sub-row :global(.trigger) { padding: 3px 8px; font-size: inherit; background: var(--bg); border-color: var(--border); }
  .sub-row :global(.menu) { top: auto; bottom: calc(100% + 4px); left: auto; right: 0; }
  .empty { padding: 6px 8px; color: var(--text-faint); font-size: .92em; }
</style>
