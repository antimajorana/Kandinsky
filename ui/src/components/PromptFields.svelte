<script module lang="ts">
  import type { PromptAsk } from "../lib/gen/PromptAsk";

  export function promptDefaults(asks: PromptAsk[]): Record<string, string> {
    return Object.fromEntries(asks.map((ask) => [ask.name, ask.kind === "choice" ? (ask.choices[0] ?? "") : ""]));
  }

  export function promptAnswers(asks: PromptAsk[], values: Record<string, string>): Record<string, string> {
    return Object.fromEntries(asks.map((ask) => {
      const value = (values[ask.name] ?? "").trim();
      return [ask.name, ask.kind === "note" && value && !value.startsWith("[[") ? `[[${value}]]` : value];
    }));
  }
</script>

<script lang="ts">
  import { api } from "../lib/api";
  import Select from "./Select.svelte";
  import SuggestInput, { type Suggestion } from "./SuggestInput.svelte";

  let { asks, values = $bindable() }: { asks: PromptAsk[]; values: Record<string, string> } = $props();
  let notes = $state<Record<string, Suggestion[]>>({});

  async function suggest(ask: PromptAsk, query: string) {
    const matches = await api.linkTargets(query).catch(() => []);
    if (values[ask.name] !== query) return;
    notes[ask.name] = matches.filter((note) => !ask.folder || note.path.startsWith(`${ask.folder}/`))
      .slice(0, 12).map((note) => ({ value: note.link, label: note.title ?? note.link, detail: note.path }));
  }
</script>

{#each asks as ask (ask.name)}
  <label>{ask.name}
    {#if ask.kind === "choice"}
      <Select label={ask.name} value={values[ask.name]} options={ask.choices.map((value) => ({ value, label: value }))}
        onchange={(value) => (values[ask.name] = value)} />
    {:else if ask.kind === "date"}
      <input type="date" bind:value={values[ask.name]} />
    {:else if ask.kind === "number"}
      <input type="number" step="any" value={values[ask.name]}
        oninput={(event) => (values[ask.name] = event.currentTarget.value)} />
    {:else if ask.kind === "note"}
      <SuggestInput class="field" type="text" bind:value={values[ask.name]} items={notes[ask.name] ?? []}
        placeholder={ask.folder ? `A note in ${ask.folder}/…` : "A note…"}
        oninput={(event) => {
          const value = (event.currentTarget as HTMLInputElement).value;
          values[ask.name] = value;
          void suggest(ask, value);
        }}
        onpick={(value) => (values[ask.name] = value)} />
    {:else}
      <input type="text" bind:value={values[ask.name]} spellcheck="false" />
    {/if}
  </label>
{/each}

<style>
  label { display: flex; flex-direction: column; gap: 5px; color: var(--text-muted); font-size: calc(12.5px * var(--ui-scale, 1)); }
  input, :global(input.field) { min-width: 0; font: inherit; font-size: calc(14px * var(--ui-scale, 1)); color: var(--text); background: var(--bg); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding: 6px 9px; }
  input:focus, :global(input.field:focus) { outline: none; border-color: var(--accent); }
</style>
