<script lang="ts">
  // A Bases cell being edited, by the property's kind and column format: text, number (incl. progress/%/currency), date,
  // floating Nootion status picker with 1-click presets + cycle + custom input, or a list as chips.
  import Icon from "../Icon.svelte";
  import type { BaseColumn } from "../../lib/gen/BaseColumn";
  import type { PropertyKind } from "../../lib/gen/PropertyKind";
  import { effectiveColumnFormat, nextStatusValue, STATUS_PRESETS } from "../../lib/base-format";
  import { asLink, asNumber, asTag, fromInput, isListKind, linkLabel, listOf, scalarText, toInput } from "../../lib/property-model";

  let { kind, value, label, column, oncommit, onclose }: {
    kind: PropertyKind;
    value: unknown;
    label: string;
    column?: BaseColumn;
    oncommit: (v: unknown) => void;
    onclose: () => void;
  } = $props();

  const list = $derived(isListKind(kind));
  const isDate = $derived(kind === "date" || kind === "datetime");
  const colFmt = $derived(effectiveColumnFormat(column));
  const isStatus = $derived(!list && !isDate && (kind === "status" || colFmt === "status"));
  const isRating = $derived(!list && !isDate && kind === "rating");
  const isNum = $derived(kind === "number" || (!list && !isDate && !isRating && (colFmt === "progress" || colFmt === "percent" || colFmt === "currency")));

  // svelte-ignore state_referenced_locally -- the editor starts from the value it was opened on
  let items = $state(listOf(value));
  // svelte-ignore state_referenced_locally
  let text = $state(isDate ? toInput(value, kind as "date" | "datetime") : scalarText(value));
  let draft = $state("");
  let root = $state<HTMLElement>();
  let done = false;

  // The rating editor has no input, so its root takes focus: Escape and click-away then reach it.
  $effect(() => { (root?.querySelector<HTMLElement>("input") ?? (isRating ? root : null))?.focus(); });

  const shape = (s: string) => (kind === "links" ? asLink(s) : kind === "tags" ? asTag(s) : s.trim());
  function scalar(): unknown {
    if (isNum) return asNumber(text);
    if (isDate) return text ? fromInput(text, kind as "date" | "datetime", "", value) : null;
    return text.trim() === "" ? null : text;
  }
  function finish(save: boolean) {
    if (done) return;
    done = true;
    if (save && !list) {
      const v = scalar();
      if (scalarText(v) !== scalarText(value)) oncommit(v);
    }
    if (save && list && draft.trim()) add();
    onclose();
  }
  function pickStatus(next: string) {
    if (done) return;
    done = true;
    const v = next.trim() === "" ? null : next;
    if (scalarText(v) !== scalarText(value)) oncommit(v);
    onclose();
  }
  function add() {
    const next = draft.split(",").map(shape).filter((s) => s && !items.includes(s));
    draft = "";
    if (!next.length) return;
    items = [...items, ...next];
    oncommit(items);
  }
  function remove(i: number) {
    items = items.filter((_, j) => j !== i);
    oncommit(items.length ? items : null);
    root?.querySelector<HTMLInputElement>("input")?.focus();
  }
  function onkeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); finish(false); }
    else if (e.key === "Enter" && !(list && draft.trim())) { e.preventDefault(); finish(true); }
    else if (list && (e.key === "Enter" || e.key === ",")) { e.preventDefault(); add(); }
    else if (list && e.key === "Backspace" && !draft && items.length) { e.preventDefault(); remove(items.length - 1); }
  }
  function onfocusout(e: FocusEvent) {
    if (!root?.contains(e.relatedTarget as Node)) finish(true);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_no_noninteractive_tabindex -->
<div class="cell-editor" class:list class:status-pop={isStatus} tabindex={isRating ? -1 : undefined} bind:this={root} {onkeydown} {onfocusout} onclick={(e) => e.stopPropagation()}>
  {#if list}
    {#each items as it, i (it)}
      <span class="chip"><span class="t">{linkLabel(it)}</span><button type="button" class="x" aria-label="Remove {it}" onmousedown={(e) => e.preventDefault()} onclick={() => remove(i)}><Icon name="close" size={10} /></button></span>
    {/each}
    <input class="cell-edit" aria-label="Add to {label}" placeholder={items.length ? "" : "Add…"} bind:value={draft} spellcheck="false" />
  {:else if isStatus}
    <div class="status-presets">
      {#each STATUS_PRESETS as preset (preset.value)}
        <button
          type="button"
          class="preset tone-{preset.tone}"
          class:active={text.trim().toLowerCase() === preset.value.toLowerCase()}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => pickStatus(preset.value)}
        >
          <span class="dot"></span>{preset.label}
        </button>
      {/each}
      <button type="button" class="cycle-btn" title="Cycle status" onmousedown={(e) => e.preventDefault()} onclick={() => pickStatus(nextStatusValue(text))}>
        <Icon name="refresh" size={11} /> Cycle
      </button>
    </div>
    <input class="cell-edit" placeholder="Custom status…" aria-label="Edit {label}" bind:value={text} spellcheck="false" />
  {:else if isRating}
    {@const cur = Math.max(0, Math.min(5, Math.round(Number(text) || 0)))}
    <div class="rating-row" role="radiogroup" aria-label={label}>
      {#each [1, 2, 3, 4, 5] as star (star)}
        <button type="button" class="star-btn" class:lit={cur >= star} onmousedown={(e) => e.preventDefault()}
          onclick={() => { if (done) return; done = true; oncommit(cur === star ? null : star); onclose(); }}>★</button>
      {/each}
    </div>
  {:else if isDate}
    <input class="cell-edit" type={kind === "date" ? "date" : "datetime-local"} aria-label="Edit {label}" bind:value={text} />
  {:else if isNum}
    <!-- not bound: Svelte would hand a number input's value over as a number -->
    <input class="cell-edit num" type="number" step="any" aria-label="Edit {label}" value={text} oninput={(e) => (text = e.currentTarget.value)} />
  {:else}
    <input class="cell-edit" aria-label="Edit {label}" bind:value={text} spellcheck="false" />
  {/if}
</div>

<style>
  .cell-editor { display: flex; align-items: center; gap: 4px; min-width: 0; width: 100%; }
  /* floating cards keep the 32px table row height intact */
  .cell-editor.list, .cell-editor.status-pop { position: absolute; top: 0; left: 0; z-index: 4; min-width: 100%; width: max-content; max-width: 340px; min-height: 100%;
    padding: 5px 6px; background: var(--bg-elev); border: 1px solid var(--accent); border-radius: var(--radius); box-shadow: var(--shadow-pop); }
  .cell-editor.list { flex-wrap: wrap; }
  .cell-editor.status-pop { flex-direction: column; align-items: stretch; gap: 6px; min-width: max(100%, 240px); }
  .status-presets { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
  .preset { display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 8px 0 6px; border-radius: 999px; font: inherit; font-size: .85em; font-weight: 500; border: 1px solid color-mix(in srgb, currentColor 22%, transparent); cursor: pointer; }
  .preset .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .preset.active { box-shadow: 0 0 0 1.5px var(--accent); }
  .preset.tone-todo { background: var(--bg-hover); color: var(--text-muted); border-color: var(--border-strong); }
  .preset.tone-progress { background: var(--accent-soft); color: var(--accent); }
  .preset.tone-blocked { background: var(--red-soft, color-mix(in srgb, var(--red) 12%, transparent)); color: var(--red); }
  .preset.tone-done { background: var(--green-soft, color-mix(in srgb, var(--green) 12%, transparent)); color: var(--green); }
  .preset:hover { filter: brightness(1.08); }
  .cycle-btn { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 7px; margin-left: auto; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg); color: var(--text-muted); font: inherit; font-size: .84em; cursor: pointer; }
  .cycle-btn:hover { background: var(--bg-hover); color: var(--text); border-color: var(--border-strong); }

  .cell-edit { flex: 1; min-width: 60px; width: 100%; height: 24px; font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--accent); border-radius: var(--radius-sm); padding: 0 6px; }
  .list .cell-edit { border: 0; background: transparent; padding: 0 2px; }
  .status-pop .cell-edit { flex: none; border-color: var(--border-strong); }
  .status-pop .cell-edit:focus { border-color: var(--accent); }
  .cell-edit:focus, .cell-editor:focus { outline: none; }
  .num { font-variant-numeric: tabular-nums; text-align: right; }
  input[type="date"], input[type="datetime-local"] { color-scheme: light dark; font-variant-numeric: tabular-nums; }
  .chip { display: inline-flex; align-items: center; max-width: 200px; border-radius: 999px; background: var(--accent-soft); font-size: .92em; line-height: 20px; }
  .chip .t { padding: 0 2px 0 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .x { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; color: var(--text-faint); }
  .x:hover { color: var(--text); background: var(--bg-hover); }
  .rating-row { display: inline-flex; align-items: center; gap: 2px; padding: 0 4px; }
  .star-btn { padding: 1px 2px; font-size: 13px; color: var(--text-faint); }
  .star-btn.lit, .star-btn:hover { color: var(--yellow); }
</style>
