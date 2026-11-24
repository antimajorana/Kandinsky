<script lang="ts">
  // A template's questions asked together in one form (`{{prompt:Course | choice:a,b}}`, `| date`, `| number`,
  // `| note:folder`, plain text): a list, a date, a number, a note of the vault (offered from its folder), or text.
  // The answers go to the core as the template's values (crates/kandinsky-template).
  import Dialog from "./Dialog.svelte";
  import PromptFields, { promptAnswers, promptDefaults } from "./PromptFields.svelte";
  import type { PromptAsk } from "../lib/gen/PromptAsk";

  let { title, asks, onsubmit, oncancel }: {
    title: string; asks: PromptAsk[];
    onsubmit: (values: Record<string, string>) => void; oncancel: () => void;
  } = $props();
  // svelte-ignore state_referenced_locally -- the questions are fixed while the form is open
  let values = $state(promptDefaults(asks));
  let form = $state<HTMLFormElement>();
  $effect(() => { form?.querySelector<HTMLElement>("input, button[aria-haspopup=listbox]")?.focus(); });
</script>

<Dialog label={title} onclose={oncancel}>
  <form class="dialog" bind:this={form}
    onsubmit={(e) => { e.preventDefault(); onsubmit(promptAnswers(asks, values)); }}>
    <p class="q">{title}</p>
    <PromptFields {asks} bind:values />
    <div class="btns"><button type="button" class="btn" onclick={oncancel}>Cancel</button><button class="btn primary">Create</button></div>
  </form>
</Dialog>

<style>
  .dialog { width: min(460px, 92vw); background: var(--bg-elev); border: 1px solid var(--border-strong); border-radius: 10px; padding: 14px; box-shadow: var(--shadow-pop); display: flex; flex-direction: column; gap: 10px; }
  .q { margin: 0; color: var(--text); font-weight: 600; }
  .btns { display: flex; justify-content: flex-end; gap: 8px; }
  .btn { border: 1px solid var(--border-strong); padding: 4px 12px; border-radius: var(--radius-sm); }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg, #fff); }
</style>
