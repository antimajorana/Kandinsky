<script lang="ts">
  // Notion-style clickable inline properties directly under page icon/cover & title, with >5 collapse & + Add property.
  import { tick } from "svelte";
  import type { EditorView } from "@codemirror/view";
  import Icon from "./Icon.svelte";
  import PropertyField from "./PropertyField.svelte";
  import { editFrontmatter } from "../lib/frontmatter-edit";
  import { editRawProperties } from "../lib/editor/live/live-preview.js";
  import { known, loadKnown, valuesOf } from "../lib/known-properties.svelte";
  import { propertyIcon } from "../lib/properties";
  import { addable, emptyValue, frontmatterOf, kindOf, parseYaml, rowsOf } from "../lib/property-model";
  import { propertySpec, watchPropertySpec } from "../lib/property-spec.svelte";
  import { toast } from "../lib/state.svelte";
  import { errText } from "../lib/text";
  import type { FrontmatterEdit } from "../lib/types";

  let {
    text,
    view,
    onopen,
  }: {
    text: string;
    view: () => EditorView | null;
    onopen: (target: string) => void;
  } = $props();

  watchPropertySpec();

  const COLLAPSE_LIMIT = 5;
  let expanded = $state(false);
  let adding = $state(false);
  let newKey = $state("");
  let root = $state<HTMLElement>();

  const spec = $derived(propertySpec.spec);
  const fm = $derived(frontmatterOf(text));
  const data = $derived(fm ? parseYaml(fm.yaml) : {});
  const rows = $derived(data ? rowsOf(data, spec) : []);
  const offered = $derived(
    data
      ? [...addable(data, spec), ...known.list.map((p) => p.key)]
          .filter((k, i, all) => !(k in data!) && all.indexOf(k) === i)
          .slice(0, 60)
      : [],
  );

  $effect(() => {
    if (rows.length > 0 || adding) loadKnown();
  });

  const shownRows = $derived(expanded || rows.length <= COLLAPSE_LIMIT ? rows : rows.slice(0, COLLAPSE_LIMIT));
  const hiddenCount = $derived(Math.max(0, rows.length - shownRows.length));

  async function edit(e: FrontmatterEdit): Promise<void> {
    const v = view();
    if (!v) return;
    try {
      if (!(await editFrontmatter(v, e))) {
        toast("Note changed during edit", "Try updating the property again.", "error");
      }
    } catch (err) {
      toast("Could not change property", errText(err), "error");
    }
  }

  async function addProperty(keyRaw = newKey): Promise<void> {
    const key = keyRaw.trim();
    newKey = "";
    adding = false;
    if (!key) return;
    if (data && key in data) return;
    await edit({ op: "set", key, value: emptyValue(kindOf(spec, key, null)) });
    await tick();
    root?.querySelector<HTMLElement>(`[data-prop-key="${CSS.escape(key)}"] :is(input, button.select-btn, button)`)?.focus();
  }
</script>

{#if data === null}
  <div class="inline-props invalid" data-testid="inline-properties-error">
    <span>Frontmatter syntax needs attention.</span>
    <button type="button" class="fix-btn" onclick={() => { const v = view(); if (v) editRawProperties(v); }}>Edit YAML</button>
  </div>
{:else}
  <div class="inline-props" bind:this={root} data-testid="inline-properties">
    {#each shownRows as r (r.key)}
      <div class="prop-row" class:missing={r.missing} data-prop-key={r.key}>
        <div class="prop-key" title={spec?.properties[r.key]?.description || r.key}>
          <span class="k-ico">{@html propertyIcon(r.kind, r.key)}</span>
          <span class="k-name">{r.key}</span>
        </div>
        <div class="prop-val">
          <PropertyField
            name={r.key}
            kind={r.kind}
            value={r.value}
            spec={spec?.properties[r.key]}
            values={valuesOf(r.key)}
            onset={(val) => void edit({ op: "set", key: r.key, value: val })}
            {onopen}
          />
        </div>
        <button type="button" class="rm-btn" aria-label="Remove {r.key}" title="Remove property"
          onclick={() => void edit({ op: "remove", key: r.key })}>
          <Icon name="close" size={11} />
        </button>
      </div>
    {/each}

    <div class="prop-actions">
      {#if adding}
        <form class="add-form" onsubmit={(e) => { e.preventDefault(); void addProperty(); }}>
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="add-in"
            placeholder="Property name…"
            list="kandinsky-known-props"
            bind:value={newKey}
            autofocus
            onkeydown={(e) => { if (e.key === "Escape") { adding = false; newKey = ""; } }}
          />
          <datalist id="kandinsky-known-props">
            {#each offered as k (k)}<option value={k}></option>{/each}
          </datalist>
          <button type="submit" class="add-go" disabled={!newKey.trim()}>Add</button>
          <button type="button" class="add-cancel" onclick={() => { adding = false; newKey = ""; }}>Cancel</button>
        </form>
      {:else}
        <button type="button" class="act-btn" data-testid="inline-add-property" onclick={() => (adding = true)}>
          <Icon name="plus" size={12} /> <span>Add property</span>
        </button>
        {#if hiddenCount > 0}
          <button type="button" class="act-btn" data-testid="inline-show-more-props" onclick={() => (expanded = true)}>
            Show {hiddenCount} more propert{hiddenCount === 1 ? "y" : "ies"}
          </button>
        {:else if expanded && rows.length > COLLAPSE_LIMIT}
          <button type="button" class="act-btn" onclick={() => (expanded = false)}>Show fewer</button>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  .inline-props { max-width: var(--measure, 740px); margin: 4px auto 12px; padding: 4px 0 8px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 3px; }
  .inline-props.invalid { flex-direction: row; align-items: center; gap: 10px; font-size: 12.5px; color: var(--red); padding: 8px 10px; border-radius: var(--radius); background: var(--red-soft); }
  .fix-btn { padding: 2px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-strong); color: var(--text); font-size: 12px; }
  .prop-row { display: grid; grid-template-columns: minmax(110px, 160px) minmax(0, 1fr) 22px; align-items: center; gap: 6px; padding: 1px 0; }
  .prop-key { display: inline-flex; align-items: center; gap: 6px; min-width: 0; color: var(--text-muted); font-size: calc(12.5px * var(--ui-scale, 1)); padding: 3px 6px; border-radius: var(--radius-sm); }
  .k-ico { display: inline-flex; color: var(--text-faint); flex: none; }
  .k-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .prop-val { min-width: 0; }
  .rm-btn { width: 20px; height: 20px; border-radius: 4px; display: grid; place-items: center; color: var(--text-faint); opacity: 0; transition: opacity .12s; }
  .prop-row:hover .rm-btn, .rm-btn:focus-visible { opacity: 1; }
  .rm-btn:hover { background: var(--bg-hover); color: var(--text); }
  .prop-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 2px; padding-left: 4px; }
  .act-btn { display: inline-flex; align-items: center; gap: 4px; padding: 3px 7px; border-radius: var(--radius-sm); font-size: 12px; color: var(--text-faint); }
  .act-btn:hover { background: var(--bg-hover); color: var(--text); }
  .add-form { display: inline-flex; align-items: center; gap: 6px; }
  .add-in { padding: 3px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-strong); background: var(--bg); color: var(--text); font-size: 12px; width: 170px; }
  .add-in:focus { outline: none; border-color: var(--accent); }
  .add-go { padding: 3px 9px; border-radius: var(--radius-sm); background: var(--accent); color: var(--accent-fg); font-size: 11.5px; font-weight: 600; }
  .add-cancel { font-size: 11.5px; color: var(--text-muted); }
</style>
