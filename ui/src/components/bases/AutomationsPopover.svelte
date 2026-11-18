<script lang="ts">
  // Guided Notion-style Automations & Recurring Note Templates popover for .base views.
  import Icon from "../Icon.svelte";
  import { api } from "../../lib/api";
  import { toast } from "../../lib/state.svelte";
  import { errText } from "../../lib/text";
  import type { BaseAutomation } from "../../lib/gen/BaseAutomation";
  import type { BaseRecurringTemplate } from "../../lib/gen/BaseRecurringTemplate";
  import type { BaseResult } from "../../lib/gen/BaseResult";
  import type { RecurringCadence } from "../../lib/gen/RecurringCadence";
  import type { ViewEdit } from "../../lib/gen/ViewEdit";

  let {
    basePath,
    res,
    props,
    onedit,
    onclose,
  }: {
    basePath: string;
    res: BaseResult;
    props: { id: string; label: string }[];
    onedit: (e: ViewEdit, then?: () => void) => void;
    onclose: () => void;
  } = $props();

  let tab = $state<"rules" | "recurring">("rules");
  let running = $state(false);

  // Rule builder draft
  let rName = $state("Mark complete → log");
  let rTrigKind = $state<"property_changed" | "note_created">("property_changed");
  let rTrigProp = $state("status");
  let rTrigTo = $state("Done");
  let rActKind = $state<"set_property" | "append_log">("append_log");
  let rActProp = $state("done_date");
  let rActVal = $state("{{date}}");

  // Recurring template builder draft
  let recName = $state("Weekly review");
  let recCadence = $state<RecurringCadence>("weekly");
  let recFolder = $state("reviews");
  let recTitle = $state("{{date}} Review");
  let recTemplate = $state("");

  const propChoices = $derived(props.filter((p) => !p.id.startsWith("file.")).map((p) => p.id.replace(/^note\./, "")));

  function addRule(e: SubmitEvent): void {
    e.preventDefault();
    const name = rName.trim() || "Automation";
    const rule: BaseAutomation = {
      name,
      enabled: true,
      trigger: rTrigKind === "note_created"
        ? { kind: "note_created" }
        : { kind: "property_changed", property: rTrigProp.trim() || "status", ...(rTrigTo.trim() ? { to: rTrigTo.trim() } : {}) },
      action: rActKind === "append_log"
        ? { kind: "append_log", text: rActVal.trim() || "Updated" }
        : { kind: "set_property", property: rActProp.trim() || "updated", value: rActVal.trim() },
    };
    onedit({ op: "automations", automations: [...(res.automations ?? []), rule] });
  }

  function toggleRule(idx: number): void {
    const next = (res.automations ?? []).map((r, i) => (i === idx ? { ...r, enabled: !r.enabled } : r));
    onedit({ op: "automations", automations: next });
  }

  function removeRule(idx: number): void {
    const next = (res.automations ?? []).filter((_, i) => i !== idx);
    onedit({ op: "automations", automations: next });
  }

  function addRecurring(e: SubmitEvent): void {
    e.preventDefault();
    const rec: BaseRecurringTemplate = {
      name: recName.trim() || "Recurring note",
      enabled: true,
      cadence: recCadence,
      folder: recFolder.trim(),
      title_pattern: recTitle.trim() || "{{date}} Note",
      template: recTemplate.trim(),
      last_run: "",
    };
    onedit({ op: "recurring", recurring: [...(res.recurring ?? []), rec] });
  }

  function toggleRecurring(idx: number): void {
    const next = (res.recurring ?? []).map((r, i) => (i === idx ? { ...r, enabled: !r.enabled } : r));
    onedit({ op: "recurring", recurring: next });
  }

  function removeRecurring(idx: number): void {
    const next = (res.recurring ?? []).filter((_, i) => i !== idx);
    onedit({ op: "recurring", recurring: next });
  }

  async function runRecurringNow(): Promise<void> {
    if (!basePath) return;
    running = true;
    try {
      // The reply also lists .base files whose last_run was stamped; only the new notes are counted.
      const created = (await api.runBaseRecurring(basePath)).filter((p) => !p.endsWith(".base"));
      toast("Recurring templates checked", created.length ? `Created ${created.length} note(s)` : "No templates due yet");
    } catch (e) {
      toast("Could not run recurring templates", errText(e));
    } finally {
      running = false;
    }
  }
</script>

<div class="auto-pop" data-testid="base-automations-popover">
  <header class="auto-head">
    <div class="tabs">
      <button type="button" class:on={tab === "rules"} onclick={() => (tab = "rules")}>Rules ({res.automations?.length ?? 0})</button>
      <button type="button" class:on={tab === "recurring"} onclick={() => (tab = "recurring")}>Recurring ({res.recurring?.length ?? 0})</button>
    </div>
    <button type="button" class="x" onclick={onclose} aria-label="Close"><Icon name="close" size={12} /></button>
  </header>

  {#if tab === "rules"}
    <ul class="item-list">
      {#each res.automations ?? [] as rule, idx (idx)}
        <li class="item-row">
          <label class="chk">
            <input type="checkbox" checked={rule.enabled} onchange={() => toggleRule(idx)} />
            <span class="meta">
              <strong>{rule.name}</strong>
              <small>
                {rule.trigger.kind === "note_created" ? "When note created" : `When ${rule.trigger.property}${rule.trigger.to ? ` → ${rule.trigger.to}` : " changes"}`}
                →
                {rule.action.kind === "append_log" ? `Log "${rule.action.text}"` : `Set ${rule.action.property} = ${rule.action.value}`}
              </small>
            </span>
          </label>
          <button type="button" class="del" onclick={() => removeRule(idx)} aria-label="Remove rule"><Icon name="trash" size={12} /></button>
        </li>
      {:else}
        <li class="empty">No automations yet. Add a trigger and action below.</li>
      {/each}
    </ul>

    <form class="add-box" onsubmit={addRule}>
      <div class="row-2">
        <label class="fld"><span>Name</span><input bind:value={rName} required /></label>
        <label class="fld">
          <span>Trigger</span>
          <select bind:value={rTrigKind}>
            <option value="property_changed">Property changes</option>
            <option value="note_created">Note created</option>
          </select>
        </label>
      </div>
      {#if rTrigKind === "property_changed"}
        <div class="row-2">
          <label class="fld">
            <span>Property</span>
            <input list="auto-props-list" bind:value={rTrigProp} placeholder="status" />
          </label>
          <label class="fld"><span>Equals value (optional)</span><input bind:value={rTrigTo} placeholder="Done" /></label>
        </div>
      {/if}
      <div class="row-2">
        <label class="fld">
          <span>Action</span>
          <select bind:value={rActKind}>
            <option value="set_property">Set property</option>
            <option value="append_log">Append to Daily Note</option>
          </select>
        </label>
        {#if rActKind === "set_property"}
          <label class="fld"><span>Target property</span><input list="auto-props-list" bind:value={rActProp} placeholder="done_date" /></label>
        {/if}
      </div>
      <label class="fld">
        <span>{rActKind === "append_log" ? "Log line text" : "Property value"}</span>
        <input bind:value={rActVal} placeholder={rActKind === "append_log" ? "- Finished {{title}}" : "{{date}}"} />
      </label>
      <div class="foot-end"><button type="submit" class="save">+ Add automation</button></div>
    </form>
  {:else}
    <ul class="item-list">
      {#each res.recurring ?? [] as rec, idx (idx)}
        <li class="item-row">
          <label class="chk">
            <input type="checkbox" checked={rec.enabled} onchange={() => toggleRecurring(idx)} />
            <span class="meta">
              <strong>{rec.name} <small>({rec.cadence})</small></strong>
              <small>{rec.folder || "vault root"}/{rec.title_pattern}{rec.last_run ? ` · Last: ${rec.last_run}` : ""}</small>
            </span>
          </label>
          <button type="button" class="del" onclick={() => removeRecurring(idx)} aria-label="Remove recurring template"><Icon name="trash" size={12} /></button>
        </li>
      {:else}
        <li class="empty">No recurring note templates yet.</li>
      {/each}
    </ul>

    <form class="add-box" onsubmit={addRecurring}>
      <div class="row-2">
        <label class="fld"><span>Name</span><input bind:value={recName} required /></label>
        <label class="fld">
          <span>Cadence</span>
          <select bind:value={recCadence}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
      </div>
      <div class="row-2">
        <label class="fld"><span>Folder</span><input bind:value={recFolder} placeholder="tasks" /></label>
        <label class="fld"><span>Title pattern</span><input bind:value={recTitle} placeholder={'{{date}} Standup'} /></label>
      </div>
      <label class="fld"><span>Template note path (optional)</span><input bind:value={recTemplate} placeholder="templates/standup.md" /></label>
      <div class="foot-split">
        <button type="button" class="ghost" disabled={running} onclick={() => void runRecurringNow()}>
          {running ? "Running…" : "Run due now"}
        </button>
        <button type="submit" class="save">+ Add template</button>
      </div>
    </form>
  {/if}

  <datalist id="auto-props-list">
    {#each propChoices as p (p)}<option value={p}></option>{/each}
  </datalist>
</div>

<style>
  .auto-pop { display: flex; flex-direction: column; gap: 10px; font-size: 12px; color: var(--text); }
  .auto-head { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
  .tabs { display: inline-flex; gap: 4px; }
  .tabs button { padding: 3px 10px; border-radius: var(--radius-sm); color: var(--text-muted); font-weight: 500; }
  .tabs button.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
  .x { color: var(--text-faint); padding: 2px; border-radius: 4px; }
  .item-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; max-height: 150px; overflow-y: auto; }
  .item-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 8px; border-radius: var(--radius-sm); background: var(--bg-side); border: 1px solid var(--border); }
  .chk { display: flex; align-items: flex-start; gap: 7px; cursor: pointer; min-width: 0; }
  .chk input { margin-top: 2px; accent-color: var(--accent); }
  .meta { display: flex; flex-direction: column; min-width: 0; }
  .meta small { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .del { color: var(--text-faint); padding: 3px; border-radius: 4px; }
  .del:hover { color: var(--red); background: var(--bg-hover); }
  .empty { margin: 0; color: var(--text-faint); padding: 6px 2px; }
  .add-box { display: flex; flex-direction: column; gap: 7px; padding-top: 6px; border-top: 1px solid var(--border); }
  .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .fld { display: flex; flex-direction: column; gap: 3px; color: var(--text-muted); }
  .fld input, .fld select { padding: 5px 7px; border-radius: var(--radius-sm); border: 1px solid var(--border-strong); background: var(--bg); color: var(--text); font: inherit; }
  .foot-end { display: flex; justify-content: flex-end; }
  .foot-split { display: flex; justify-content: space-between; align-items: center; }
  .ghost { padding: 5px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border-strong); color: var(--text); background: var(--bg); }
  .ghost:hover { background: var(--bg-hover); }
  .save { padding: 5px 12px; border-radius: var(--radius-sm); background: var(--accent); color: var(--accent-fg, #fff); font-weight: 600; }
</style>
