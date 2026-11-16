<script lang="ts">
  // The properties popover's content: every property of the notes, the base's formulas and the file's own, each with a
  // checkbox to show it as a column; shown ones reorder by drag (or Alt+↑/↓), rename in place, and pick display format.
  import Icon from "../Icon.svelte";
  import { reorder } from "../../lib/base-drag";
  import type { ViewEdit } from "../../lib/gen/ViewEdit";
  import type { BaseColumn } from "../../lib/gen/BaseColumn";

  let { columns, others, onedit }: {
    columns: BaseColumn[];
    /** the properties not shown, with their names */
    others: { id: string; label: string }[];
    onedit: (e: ViewEdit) => void;
  } = $props();

  const FORMAT_OPTS: { key: string; label: string; format: string | null; currency: string | null }[] = [
    { key: "auto", label: "Auto", format: null, currency: null },
    { key: "status", label: "Status", format: "status", currency: null },
    { key: "progress", label: "Progress", format: "progress", currency: null },
    { key: "percent", label: "%", format: "percent", currency: null },
    { key: "eur", label: "€", format: "currency", currency: "€" },
    { key: "usd", label: "$", format: "currency", currency: "$" },
    { key: "gbp", label: "£", format: "currency", currency: "£" },
    { key: "url", label: "URL", format: "url", currency: null },
    { key: "email", label: "Email", format: "email", currency: null },
    { key: "phone", label: "Phone", format: "phone", currency: null },
    { key: "file", label: "File", format: "file", currency: null },
  ];

  function selectKeyOf(c: BaseColumn): string {
    const f = c.format?.trim().toLowerCase();
    if (!f || f === "auto") return "auto";
    if (f === "currency") {
      const cur = (c.currency ?? "€").trim();
      return cur === "$" ? "usd" : cur === "£" ? "gbp" : "eur";
    }
    return FORMAT_OPTS.some((o) => o.key === f) ? f : "auto";
  }

  function applyFormat(c: BaseColumn, key: string) {
    const opt = FORMAT_OPTS.find((o) => o.key === key) ?? FORMAT_OPTS[0];
    const max = opt.format === "progress" ? (c.max ?? 100) : null;
    onedit({ op: "column_format", column: c.id, format: opt.format, currency: opt.currency, max });
  }

  let q = $state("");
  const hit = (id: string, label: string, extra = "") =>
    !q.trim() || `${id} ${label} ${extra}`.toLowerCase().includes(q.trim().toLowerCase());
  const order = $derived(columns.map((c) => c.id));
  let dragged = $state<number | null>(null);
  let over = $state<number | null>(null);
  let renaming = $state<string | null>(null);
  const move = (from: number, to: number) => { if (to >= 0 && to < order.length && from !== to) onedit({ op: "order", columns: reorder(order, from, to) }); };
  function rename(c: BaseColumn, name: string) {
    renaming = null;
    const n = name.trim();
    if (n !== c.label) onedit({ op: "display_name", column: c.id, name: n || null });
  }
  const focus = (el: HTMLInputElement) => { el.focus(); el.select(); };

  const ROLLUP_SUMMARIES = ["Sum", "Average", "Min", "Max", "Count", "Checked", "Filled", "Unique", "Values"] as const;
  let addingRollup = $state(false);
  let rColumn = $state("");
  let rRelation = $state("");
  let rProperty = $state("");
  let rSummary = $state("Sum");
  const relCandidates = $derived([
    ...new Set(
      [...columns.filter((c) => !c.rollup).map((c) => c.id), ...others.map((o) => o.id)]
        .filter((id) => !/^(file|formula)\./.test(id))
        .map((id) => id.replace(/^note\./, "")),
    ),
  ]);

  function submitRollup(e: SubmitEvent) {
    e.preventDefault();
    const column = rColumn.trim();
    const relation = rRelation.trim().replace(/^note\./, "");
    const property = rProperty.trim().replace(/^note\./, "");
    if (!column || !relation || !property) return;
    onedit({ op: "rollup", column, rollup: { relation, property, summary: rSummary } });
    addingRollup = false;
    rColumn = "";
    rRelation = "";
    rProperty = "";
    rSummary = "Sum";
  }

  function rollupKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      addingRollup = false;
    } else {
      e.stopPropagation();
    }
  }
</script>

<input class="search" type="search" placeholder="Search properties…" aria-label="Search properties" bind:value={q} spellcheck="false" />
<ul class="props" aria-label="Shown as columns">
  {#each columns as c, i (c.id)}
    {#if hit(c.id, c.label, `${c.rollup ? `rollup ${c.rollup.relation} ${c.rollup.property}` : ""} ${c.back_relation ?? ""}`)}
      <li class:over={over === i && dragged !== i}
        ondragover={(e) => { if (dragged !== null) { e.preventDefault(); over = i; } }}
        ondrop={(e) => { e.preventDefault(); if (dragged !== null) move(dragged, i); dragged = over = null; }}>
        <button type="button" class="handle" draggable="true" aria-label="Move {c.label} (Alt+↑/↓)" title="Drag to reorder"
          ondragstart={(e) => { dragged = i; e.dataTransfer?.setData("text/plain", c.id); }} ondragend={() => (dragged = over = null)}
          onkeydown={(e) => { if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); move(i, i + (e.key === "ArrowUp" ? -1 : 1)); } }}>
          <Icon name="grid" size={12} />
        </button>
        <input type="checkbox" checked aria-label="Show {c.label}" disabled={columns.length === 1} onchange={() => onedit({ op: "hide", column: c.id })} />
        {#if renaming === c.id}
          <input class="name-edit" aria-label="Name of {c.id}" value={c.label} use:focus
            onkeydown={(e) => { e.stopPropagation(); if (e.key === "Enter") rename(c, e.currentTarget.value); else if (e.key === "Escape") { e.preventDefault(); renaming = null; } }}
            onblur={(e) => rename(c, e.currentTarget.value)} />
        {:else}
          <span class="label" title={c.id}>{c.label}</span>
          {#if c.label.toLowerCase() !== c.id.replace(/^(note|file|formula)\./, "").toLowerCase()}<span class="id">{c.id}</span>{/if}
          {#if c.rollup}
            <span class="meta-badge rollup" title="Rollup: {c.rollup.relation} → {c.rollup.property} ({c.rollup.summary ?? 'Values'})">∑ Rollup</span>
          {/if}
          {#if c.back_relation}
            <span class="meta-badge rel" title="Bidirectional relation paired with “{c.back_relation}”">⇄ {c.back_relation}</span>
          {/if}
          <span class="spacer"></span>
          {#if c.id !== "file.name"}
            {#if c.format === "progress"}
              <input
                class="max-edit"
                type="number"
                min="1"
                step="any"
                title="Progress target (max)"
                aria-label="Max target for {c.label}"
                value={c.max ?? 100}
                onkeydown={(e) => { if (e.key !== "Escape") e.stopPropagation(); }}
                onchange={(e) => {
                  const n = Number(e.currentTarget.value);
                  onedit({ op: "column_format", column: c.id, format: "progress", currency: null, max: Number.isFinite(n) && n > 0 ? n : 100 });
                }}
              />
            {/if}
            <select
              class="fmt-select"
              class:set={!!c.format && c.format !== "auto"}
              aria-label="Display format of {c.label}"
              title="Display format"
              value={selectKeyOf(c)}
              onchange={(e) => applyFormat(c, e.currentTarget.value)}
            >
              {#each FORMAT_OPTS as opt (opt.key)}
                <option value={opt.key}>{opt.label}</option>
              {/each}
            </select>
          {/if}
          <button type="button" class="icon-btn" aria-label="Rename {c.label}" title="Rename the column (every view)" onclick={() => (renaming = c.id)}><Icon name="edit" size={12} /></button>
        {/if}
      </li>
    {/if}
  {/each}
</ul>
<div class="sep"></div>
<ul class="props" aria-label="Not shown">
  {#each others.filter((p) => hit(p.id, p.label)) as p (p.id)}
    <li>
      <span class="handle-space"></span>
      <input type="checkbox" aria-label="Show {p.label}" onchange={() => onedit({ op: "show", column: p.id })} />
      <span class="label muted" title={p.id}>{p.label}</span>
      {#if p.label !== p.id}<span class="id">{p.id}</span>{/if}
    </li>
  {:else}
    <li class="empty">{q ? "No property matches." : "Every property is shown."}</li>
  {/each}
</ul>
<div class="sep"></div>
{#if addingRollup}
  <form class="rollup-form" aria-label="Add rollup column" onsubmit={submitRollup}>
    <div class="rollup-grid">
      <input class="r-in" placeholder="Column name" aria-label="Column name" bind:value={rColumn} use:focus onkeydown={rollupKeydown} spellcheck="false" />
      <input class="r-in" list="rollup-rel-list" placeholder="Relation property" aria-label="Relation property" bind:value={rRelation} onkeydown={rollupKeydown} spellcheck="false" />
      <input class="r-in" placeholder="Target property" aria-label="Target property" bind:value={rProperty} onkeydown={rollupKeydown} spellcheck="false" />
      <select class="r-in" aria-label="Summary kind" bind:value={rSummary} onkeydown={rollupKeydown}>
        {#each ROLLUP_SUMMARIES as s (s)}<option value={s}>{s}</option>{/each}
      </select>
    </div>
    <datalist id="rollup-rel-list">
      {#each relCandidates as rel (rel)}<option value={rel}></option>{/each}
    </datalist>
    <div class="rollup-actions">
      <button type="button" class="r-btn" onclick={() => (addingRollup = false)}>Cancel</button>
      <button type="submit" class="r-btn primary" disabled={!rColumn.trim() || !rRelation.trim() || !rProperty.trim()}>Add rollup</button>
    </div>
  </form>
{:else}
  <button type="button" class="add-rollup" onclick={() => (addingRollup = true)}>
    <Icon name="sigma" size={12} /> Add rollup…
  </button>
{/if}

<style>
  .search { height: 28px; padding: 0 8px; margin-bottom: 6px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg); color: var(--text); font: inherit; }
  .search:focus { outline: none; border-color: var(--accent); }
  .props { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
  li { display: flex; align-items: center; gap: 6px; min-height: 28px; padding: 0 4px; border-radius: var(--radius-sm); border: 1px solid transparent; min-width: 0; }
  li:hover { background: var(--bg-hover); }
  li.over { border-color: var(--accent); background: var(--accent-soft); }
  .handle, .handle-space { flex: none; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 4px; color: var(--text-faint); cursor: grab; }
  .handle:hover { color: var(--text); }
  input[type="checkbox"] { flex: none; accent-color: var(--accent); width: 14px; height: 14px; margin: 0; }
  .label { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .label.muted { color: var(--text-muted); }
  .id { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-faint); font-family: var(--font-mono); font-size: .85em; }
  .meta-badge { flex: none; font-family: var(--font-mono); font-size: .78em; font-weight: 500; padding: 1px 5px; border-radius: 4px; white-space: nowrap; max-width: 96px; overflow: hidden; text-overflow: ellipsis; }
  .meta-badge.rollup { background: var(--accent-soft); color: var(--accent); }
  .meta-badge.rel { background: var(--green-soft, color-mix(in srgb, var(--green) 14%, transparent)); color: var(--green); }
  .spacer { flex: 1 1 0; }
  .fmt-select { flex: none; height: 22px; max-width: 86px; padding: 0 4px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg); color: var(--text-muted); font: inherit; font-size: .84em; cursor: pointer; }
  .fmt-select.set { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); background: var(--accent-soft); }
  .fmt-select:focus { outline: none; border-color: var(--accent); }
  .max-edit { flex: none; width: 48px; height: 22px; padding: 0 4px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font: inherit; font-size: .84em; font-variant-numeric: tabular-nums; text-align: right; }
  .max-edit:focus { outline: none; border-color: var(--accent); }
  .name-edit { flex: 1; min-width: 0; height: 24px; padding: 0 6px; border-radius: var(--radius-sm); border: 1px solid var(--accent); background: var(--bg); color: var(--text); font: inherit; }
  .name-edit:focus { outline: none; }
  .icon-btn { flex: none; display: grid; place-items: center; width: 24px; height: 24px; border-radius: var(--radius-sm); color: var(--text-faint); opacity: 0; }
  li:hover .icon-btn, .icon-btn:focus-visible { opacity: 1; }
  .icon-btn:hover { background: var(--bg-elev); color: var(--text); }
  .sep { height: 1px; background: var(--border); margin: 6px 2px; }
  .empty { color: var(--text-faint); font-size: .92em; }
  .empty:hover { background: none; }
  .add-rollup { display: inline-flex; align-items: center; gap: 6px; width: 100%; height: 28px; padding: 0 6px; border-radius: var(--radius-sm); color: var(--text-muted); font: inherit; font-size: .9em; text-align: left; }
  .add-rollup:hover { background: var(--bg-hover); color: var(--accent); }
  .rollup-form { display: flex; flex-direction: column; gap: 6px; padding: 4px 2px 2px; }
  .rollup-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
  .r-in { min-width: 0; height: 26px; padding: 0 6px; border-radius: var(--radius-sm); border: 1px solid var(--border-strong); background: var(--bg); color: var(--text); font: inherit; font-size: .88em; }
  .r-in:focus { outline: none; border-color: var(--accent); }
  .rollup-actions { display: flex; justify-content: flex-end; gap: 6px; }
  .r-btn { height: 24px; padding: 0 9px; border-radius: var(--radius-sm); border: 1px solid var(--border-strong); background: var(--bg-elev); color: var(--text-muted); font: inherit; font-size: .85em; }
  .r-btn:hover:not(:disabled) { color: var(--text); background: var(--bg-hover); }
  .r-btn:disabled { opacity: .45; }
  .r-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg, #fff); font-weight: 500; }
</style>
