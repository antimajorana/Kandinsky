<script lang="ts">
  import { onMount } from "svelte";
  import Dialog from "../Dialog.svelte";
  import PromptFields, { promptAnswers, promptDefaults } from "../PromptFields.svelte";
  import Select from "../Select.svelte";
  import { api } from "../../lib/api";
  import type { TemplateInfo } from "../../lib/gen/TemplateInfo";
  import { templateLabel } from "../../lib/notes-system";
  import { errText } from "../../lib/text";

  let { viewName, defaultTemplate, oncreate, ondefault, onclose }: {
    viewName: string; defaultTemplate?: string;
    oncreate: (title: string, template: string, values: Record<string, string>) => Promise<void>;
    ondefault: (template: string | null) => Promise<void>;
    onclose: () => void;
  } = $props();

  let input = $state<HTMLInputElement>();
  let title = $state("");
  // svelte-ignore state_referenced_locally -- the saved default seeds this dialog's selection
  let template = $state(defaultTemplate ?? "");
  let templates = $state<TemplateInfo[] | null>(null);
  let values = $state<Record<string, string>>({});
  let error = $state("");
  let working = $state<"create" | "default" | null>(null);
  const active = $derived(templates?.find((entry) => entry.name === template));
  const missing = $derived(templates !== null && !!template && !active);
  const options = $derived([
    { value: "", label: "Blank note" },
    ...(templates ?? []).map((entry) => ({ value: entry.name, label: templateLabel(entry), note: entry.path })),
    ...(missing ? [{ value: template, label: `${template} (missing)` }] : []),
  ]);

  $effect(() => { input?.focus(); });

  onMount(async () => {
    try {
      templates = await api.templates();
      values = promptDefaults(templates.find((entry) => entry.name === template)?.asks ?? []);
    } catch (e) {
      templates = [];
      error = errText(e);
    }
  });

  function selectTemplate(value: string) {
    template = value;
    values = promptDefaults(templates?.find((entry) => entry.name === value)?.asks ?? []);
    error = "";
  }

  async function saveDefault() {
    working = "default";
    error = "";
    try { await ondefault(template || null); }
    catch (e) { error = errText(e); }
    finally { working = null; }
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (working || templates === null || missing) return;
    working = "create";
    error = "";
    try { await oncreate(title.trim(), template, promptAnswers(active?.asks ?? [], values)); }
    catch (e) { error = errText(e); }
    finally { working = null; }
  }

  function close() {
    if (!working) onclose();
  }
</script>

<Dialog label="New row" onclose={close}>
  <form class="new-row" onsubmit={create}>
    <header>
      <h2>New row</h2>
      <p>{viewName} · The view fills in properties from its filters.</p>
    </header>
    <fieldset disabled={working !== null}>
      <label>Title<input bind:this={input} bind:value={title} placeholder="Untitled" spellcheck="false" /></label>
      {#if templates === null}
        <p role="status">Loading templates…</p>
      {:else}
        <div class="template">
          <span>Template</span>
          <Select label="Template" value={template} {options} onchange={selectTemplate} />
          {#if missing}
            <p>Choose an available template or start with a blank note.</p>
          {:else if (defaultTemplate ?? "") !== template}
            <button type="button" class="default" onclick={() => void saveDefault()}>
              {template ? "Set as view default" : "Clear view default"}
            </button>
          {:else if template}
            <p>Default template for this view</p>
          {/if}
        </div>
      {/if}
      {#if active?.asks.length}
        {#key template}<PromptFields asks={active.asks} bind:values />{/key}
      {/if}
    </fieldset>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <footer>
      <button type="button" class="btn" disabled={working !== null} onclick={close}>Cancel</button>
      <button type="submit" class="btn primary" disabled={working !== null || templates === null || missing}>
        {working === "create" ? "Creating…" : "Create row"}
      </button>
    </footer>
  </form>
</Dialog>

<style>
  .new-row { width: min(440px, 100%); display: grid; gap: 16px; padding: 18px; color: var(--text); background: var(--bg-elev); border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: var(--shadow-pop); }
  header { display: grid; gap: 4px; }
  h2 { margin: 0; font-size: calc(17px * var(--ui-scale, 1)); }
  p { margin: 0; color: var(--text-muted); font-size: calc(12px * var(--ui-scale, 1)); overflow-wrap: anywhere; }
  fieldset { display: grid; gap: 12px; border: 0; margin: 0; padding: 0; min-width: 0; }
  label, .template { display: grid; gap: 5px; color: var(--text-muted); font-size: calc(13px * var(--ui-scale, 1)); }
  input { min-width: 0; padding: 6px 9px; font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); }
  input:focus { border-color: var(--accent); outline: none; }
  .default { min-height: 24px; justify-self: start; color: var(--link); }
  .default:hover { text-decoration: underline; }
  .error { color: var(--red); }
  footer { display: flex; justify-content: flex-end; gap: 8px; }
  .btn { padding: 5px 12px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); }
</style>
