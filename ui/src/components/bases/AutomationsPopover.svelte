<script lang="ts">
  // Guided Notion-style Automations & Recurring Note Templates popover for .base views.
  import Icon from "../Icon.svelte";
  import Select from "../Select.svelte";
  import { api } from "../../lib/api";
  import { dateTip, showDate } from "../../lib/dates";
  import { openPath } from "../../lib/dock";
  import { shownName } from "../../lib/paths";
  import { toast } from "../../lib/state.svelte";
  import { errText } from "../../lib/text";
  import type { AutomationAction } from "../../lib/gen/AutomationAction";
  import type { BaseAutomation } from "../../lib/gen/BaseAutomation";
  import type { BaseAutomationRun } from "../../lib/gen/BaseAutomationRun";
  import type { BaseRecurringTemplate } from "../../lib/gen/BaseRecurringTemplate";
  import type { BaseResult } from "../../lib/gen/BaseResult";
  import type { BaseRow } from "../../lib/gen/BaseRow";
  import type { RecurringCadence } from "../../lib/gen/RecurringCadence";
  import type { ViewEdit } from "../../lib/gen/ViewEdit";

  let {
    basePath,
    thisPath,
    rows,
    res,
    props,
    onedit,
    onclose,
  }: {
    basePath: string;
    thisPath?: string;
    rows: BaseRow[];
    res: BaseResult;
    props: { id: string; label: string }[];
    onedit: (e: ViewEdit, then?: () => void) => void;
    onclose: () => void;
  } = $props();

  let tab = $state<"rules" | "recurring" | "history">("rules");
  let running = $state(false);
  let pickedRule = $state<BaseAutomation | null>(null);
  let note = $state("");
  let history = $state<BaseAutomationRun[] | null>(null);
  let historyError = $state("");
  let baseChoices = $state<string[] | null>(null);
  const id = $props.id();
  const rowOptions = $derived(rows.map((row) => ({ value: row.path, label: shownName(row.path), note: row.path })));

  // Rule builder draft
  let rName = $state("Mark complete → log");
  let rTrigKind = $state<BaseAutomation["trigger"]["kind"]>("property_changed");
  let rTrigProp = $state("status");
  let rTrigTo = $state("Done");
  let editing = $state<{ index: number; original: string } | null>(null);
  let actionId = 0;
  function draftAction(action?: AutomationAction) {
    return {
      id: actionId++,
      kind: action?.kind ?? "append_log",
      property: action?.kind === "set_property" || action?.kind === "update_related" ? action.property : "done_date",
      value: action?.kind === "set_property" || action?.kind === "update_related" ? action.value : action?.kind === "append_log" ? action.text : "",
      base: action?.kind === "create_row" || action?.kind === "update_related" ? action.base : "",
      view: action?.kind === "create_row" ? action.view ?? "" : "",
      title: action?.kind === "create_row" ? action.title ?? "" : "",
      linkProperty: action?.kind === "create_row" ? action.link_property ?? "" : "",
      relation: action?.kind === "update_related" ? action.relation : "",
    };
  }
  let actions = $state([draftAction()]);

  // Recurring template builder draft
  let recName = $state("Weekly review");
  let recCadence = $state<RecurringCadence>("weekly");
  let recFolder = $state("reviews");
  let recTitle = $state("{{date}} Review");
  let recTemplate = $state("");

  const propChoices = $derived(props.filter((p) => !p.id.startsWith("file.")).map((p) => p.id.replace(/^note\./, "")));

  const TRIGGER_OPTIONS: { value: BaseAutomation["trigger"]["kind"]; label: string }[] = [
    { value: "property_changed", label: "Property changes" },
    { value: "note_created", label: "Note created" },
    { value: "manual", label: "Run manually" },
  ];
  const ACTION_OPTIONS: { value: AutomationAction["kind"]; label: string }[] = [
    { value: "set_property", label: "Set property" },
    { value: "append_log", label: "Append to Daily Note" },
    { value: "create_row", label: "Create row in a Base" },
    { value: "update_related", label: "Update related rows in a Base" },
  ];
  const CADENCE_OPTIONS: { value: RecurringCadence; label: string }[] = [
    { value: "daily", label: "Daily" },
    { value: "weekly", label: "Weekly" },
    { value: "monthly", label: "Monthly" },
  ];

  function steps(rule: BaseAutomation): AutomationAction[] {
    return rule.actions ?? (rule.action ? [rule.action] : []);
  }

  function actionLabel(action: AutomationAction): string {
    switch (action.kind) {
      case "append_log": return `Log “${action.text}”`;
      case "set_property": return `Set ${action.property} = ${action.value}`;
      case "create_row": return `Create row in ${action.base}`;
      case "update_related": return `Set ${action.property} on ${action.relation} rows in ${action.base}`;
    }
  }

  function triggerLabel(trigger: BaseAutomation["trigger"]): string {
    if (trigger.kind === "manual") return "When run manually";
    if (trigger.kind === "note_created") return "When note created";
    return `When ${trigger.property}${trigger.to ? ` → ${trigger.to}` : " changes"}`;
  }

  function startEdit(rule: BaseAutomation, index: number): void {
    editing = { index, original: JSON.stringify(rule) };
    rName = rule.name;
    rTrigKind = rule.trigger.kind;
    if (rule.trigger.kind === "property_changed") {
      rTrigProp = rule.trigger.property;
      rTrigTo = rule.trigger.to ?? "";
    } else {
      rTrigProp = "";
      rTrigTo = "";
    }
    actions = steps(rule).map(draftAction);
    if (!actions.length) actions = [draftAction()];
  }

  function resetRule(): void {
    editing = null;
    rName = "";
    rTrigKind = "property_changed";
    rTrigProp = "";
    rTrigTo = "";
    actions = [draftAction()];
  }

  function moveAction(index: number, offset: -1 | 1): void {
    const next = [...actions];
    const [action] = next.splice(index, 1);
    next.splice(index + offset, 0, action);
    actions = next;
  }

  function saveRule(e: SubmitEvent): void {
    e.preventDefault();
    const rules = res.automations ?? [];
    const previous = editing ? rules[editing.index] : undefined;
    if (editing && JSON.stringify(previous) !== editing.original) {
      toast("The rule changed", "Open the latest version of the rule before saving.");
      return;
    }
    const ordered = actions.map(({ kind, property, value, base, view, title, linkProperty, relation }): AutomationAction => {
      switch (kind) {
        case "append_log": return { kind, text: value.trim() || "Updated" };
        case "set_property": return { kind, property: property.trim(), value: value.trim() };
        case "create_row": return { kind, base: base.trim(), view: view.trim() || undefined, title: title.trim() || undefined, link_property: linkProperty.trim() || undefined };
        case "update_related": return { kind, base: base.trim(), relation: relation.trim(), property: property.trim(), value: value.trim() };
      }
    });
    const rule: BaseAutomation = {
      name: rName.trim() || "Automation",
      enabled: previous?.enabled ?? true,
      trigger: rTrigKind === "property_changed"
        ? { kind: rTrigKind, property: rTrigProp.trim() || "status", ...(rTrigTo.trim() ? { to: rTrigTo.trim() } : {}) }
        : { kind: rTrigKind },
      ...(ordered.length === 1 ? { action: ordered[0] } : { actions: ordered }),
    };
    const next = [...rules];
    if (editing) next[editing.index] = rule;
    else next.push(rule);
    onedit({ op: "automations", automations: next }, resetRule);
  }

  function toggleRule(idx: number): void {
    const next = (res.automations ?? []).map((r, i) => (i === idx ? { ...r, enabled: !r.enabled } : r));
    onedit({ op: "automations", automations: next });
  }

  function removeRule(idx: number): void {
    const next = (res.automations ?? []).filter((_, i) => i !== idx);
    onedit({ op: "automations", automations: next });
  }

  async function loadBaseChoices(): Promise<void> {
    if (baseChoices !== null) return;
    baseChoices = [];
    try { baseChoices = (await api.files()).filter((path) => path.endsWith(".base")).sort((a, b) => a.localeCompare(b)); }
    catch { baseChoices = null; }
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

  async function showHistory(): Promise<void> {
    tab = "history";
    historyError = "";
    try { history = await api.baseAutomationHistory(basePath); }
    catch (e) { historyError = errText(e); }
  }

  function pickRun(rule: BaseAutomation): void {
    pickedRule = rule;
    note = rows[0]?.path ?? "";
  }

  async function runPicked(): Promise<void> {
    if (!pickedRule || !note || running) return;
    running = true;
    try {
      const run = await api.runBaseAutomation({ path: basePath, note, rule: pickedRule, this: thisPath });
      pickedRule = null;
      if (run.error) toast("Automation stopped", run.error, "error");
      await showHistory();
    } catch (e) {
      toast("Could not run automation", errText(e), "error");
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
      <button type="button" class:on={tab === "history"} onclick={() => void showHistory()}>Run history</button>
    </div>
    <button type="button" class="x" onclick={onclose} aria-label="Close"><Icon name="close" size={12} /></button>
  </header>

  {#if tab === "rules"}
    <ul class="item-list">
      {#each res.automations ?? [] as rule, idx (idx)}
        <li class="item-row">
          <label class="chk">
            <input type="checkbox" checked={rule.enabled} disabled={editing !== null} onchange={() => toggleRule(idx)} />
            <span class="meta">
              <strong>{rule.name}</strong>
              <small title={steps(rule).map(actionLabel).join(" · ")}>
                {triggerLabel(rule.trigger)}
                →
                {steps(rule).map(actionLabel).join(" · ")}
              </small>
            </span>
          </label>
          <div class="rule-buttons">
            {#if rule.trigger.kind === "manual"}
              <button type="button" class="edit" disabled={!rule.enabled || !rows.length || running} onclick={() => pickRun(rule)}
                aria-label={`Run ${rule.name}`} title="Run on a row"><Icon name="arrow-right" size={14} /></button>
            {/if}
            <button type="button" class="edit" onclick={() => startEdit(rule, idx)} aria-label={`Edit ${rule.name}`} title="Edit rule"><Icon name="edit" size={14} /></button>
            <button type="button" class="del" disabled={editing !== null} onclick={() => removeRule(idx)} aria-label="Remove rule"><Icon name="trash" size={12} /></button>
          </div>
        </li>
      {:else}
        <li class="empty">No automations yet.</li>
      {/each}
    </ul>

    {#if pickedRule}
      <form class="add-box" onsubmit={(e) => { e.preventDefault(); void runPicked(); }}>
        <label class="fld" for={`${id}-row`}><span>Run {pickedRule.name} on</span></label>
        <Select id={`${id}-row`} label="Row" value={note} options={rowOptions} onchange={(value) => (note = value)} />
        <div class="foot-end">
          <button type="button" class="ghost" disabled={running} onclick={() => (pickedRule = null)}>Cancel</button>
          <button type="submit" class="save" disabled={running || !rows.some((row) => row.path === note)}>{running ? "Running…" : "Run on row"}</button>
        </div>
      </form>
    {/if}

    <form class="add-box" onsubmit={saveRule}>
      <div class="row-2">
        <label class="fld"><span>Name</span><input bind:value={rName} required /></label>
        <div class="fld">
          <span>Trigger</span>
          <Select label="Trigger" value={rTrigKind} options={TRIGGER_OPTIONS} onchange={(v) => (rTrigKind = v)} />
        </div>
      </div>
      {#if rTrigKind === "property_changed"}
        <div class="row-2">
          <label class="fld">
            <span>Property</span>
            <input list={`${id}-props`} bind:value={rTrigProp} placeholder="status" />
          </label>
          <label class="fld"><span>Equals value (optional)</span><input bind:value={rTrigTo} placeholder="Done" /></label>
        </div>
      {/if}
      {#each actions as action, index (action.id)}
        <fieldset class="step">
          <legend>Action {index + 1}</legend>
          {#if actions.length > 1}
            <div class="rule-buttons step-tools">
              <button type="button" class="edit up" disabled={index === 0} onclick={() => moveAction(index, -1)}
                aria-label={`Move action ${index + 1} up`}><Icon name="chevron" size={13} /></button>
              <button type="button" class="edit down" disabled={index === actions.length - 1} onclick={() => moveAction(index, 1)}
                aria-label={`Move action ${index + 1} down`}><Icon name="chevron" size={13} /></button>
              <button type="button" class="del" onclick={() => (actions = actions.filter((a) => a.id !== action.id))}
                aria-label={`Remove action ${index + 1}`}><Icon name="trash" size={13} /></button>
            </div>
          {/if}
          <div class="row-2">
            <div class="fld">
              <span>Type</span>
              <Select label={`Action ${index + 1} type`} value={action.kind} options={ACTION_OPTIONS} onchange={(v) => (action.kind = v)} />
            </div>
            {#if action.kind === "set_property" || action.kind === "update_related"}
              <label class="fld"><span>Target property</span><input list={`${id}-props`} bind:value={action.property} required /></label>
            {/if}
          </div>
          {#if action.kind === "update_related"}
            <div class="row-2">
              <label class="fld"><span>Destination Base</span><input list={`${id}-bases`} bind:value={action.base} onfocus={loadBaseChoices} placeholder="Projects.base" required /></label>
              <label class="fld"><span>Relation on this row</span><input list={`${id}-props`} bind:value={action.relation} placeholder="projects" required /></label>
            </div>
          {/if}
          {#if action.kind === "create_row"}
            <div class="row-2">
              <label class="fld"><span>Destination Base</span><input list={`${id}-bases`} bind:value={action.base} onfocus={loadBaseChoices} placeholder="Projects.base" required /></label>
              <label class="fld"><span>View (optional)</span><input bind:value={action.view} /></label>
              <label class="fld"><span>New note title (optional)</span><input bind:value={action.title} placeholder={'Follow up on {{title}}'} /></label>
              <label class="fld"><span>Link back property (optional)</span><input bind:value={action.linkProperty} placeholder="source" /></label>
            </div>
          {:else}
            <label class="fld">
              <span>{action.kind === "append_log" ? "Log line text" : "Property value"}</span>
              <input bind:value={action.value} placeholder={action.kind === "append_log" ? "- Finished {{title}}" : "{{date}}"} />
            </label>
          {/if}
        </fieldset>
      {/each}
      <div class="foot-split">
        <button type="button" class="ghost" onclick={() => actions.push(draftAction())}>Add action</button>
        <div class="rule-buttons">
          {#if editing}<button type="button" class="ghost" onclick={resetRule}>Cancel</button>{/if}
          <button type="submit" class="save">{editing ? "Save automation" : "Add automation"}</button>
        </div>
      </div>
    </form>
  {:else if tab === "recurring"}
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
        <div class="fld">
          <span>Cadence</span>
          <Select label="Cadence" value={recCadence} options={CADENCE_OPTIONS} onchange={(v) => (recCadence = v)} />
        </div>
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
  {:else if historyError}
    <p class="empty" role="alert">{historyError}</p>
  {:else if history === null}
    <p class="empty" role="status">Loading history…</p>
  {:else}
    <ul class="item-list history" aria-label="Recent automation runs">
      {#each history as run}
        <li class="item-row">
          <div class="meta">
            <strong>{run.rule} · {run.error ? "Stopped" : "Completed"}</strong>
            <small title={`${run.note} · ${dateTip(run.at)}`}>{run.note} · {showDate(run.at)}</small>
            {#if run.error}<p class="run-error">{run.error}</p>{/if}
            {#if run.files.length}
              <div class="run-files">{#each run.files as file (file)}
                <button type="button" onclick={() => { onclose(); openPath(file); }} title={file}>{file}</button>
              {/each}</div>
            {/if}
          </div>
        </li>
      {:else}
        <li class="empty">No automation runs yet.</li>
      {/each}
    </ul>
  {/if}

  <datalist id={`${id}-props`}>
    {#each propChoices as p (p)}<option value={p}></option>{/each}
  </datalist>
  <datalist id={`${id}-bases`}>
    {#each baseChoices ?? [] as path (path)}<option value={path}></option>{/each}
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
  .rule-buttons { display: flex; align-items: center; gap: 4px; }
  .edit, .del { display: grid; place-items: center; min-width: 24px; min-height: 24px; color: var(--text-muted); border-radius: var(--radius-sm); }
  .edit:hover:not(:disabled), .del:hover:not(:disabled) { background: var(--bg-hover); }
  .del:hover:not(:disabled) { color: var(--red); }
  .empty { margin: 0; color: var(--text-faint); padding: 6px 2px; }
  .add-box { display: flex; flex-direction: column; gap: 7px; padding-top: 6px; border-top: 1px solid var(--border); }
  .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .fld { display: flex; flex-direction: column; gap: 3px; color: var(--text-muted); min-width: 0; }
  .fld input { padding: 5px 7px; border-radius: var(--radius-sm); border: 1px solid var(--border-strong); background: var(--bg); color: var(--text); font: inherit; }
  .fld :global(.select) { width: 100%; min-width: 0; }
  .fld :global(.trigger) { padding: 5px 7px; font-size: inherit; background: var(--bg); border-color: var(--border-strong); }
  .step { position: relative; display: flex; flex-direction: column; gap: 7px; min-width: 0; margin: 0; padding: 6px 8px 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); }
  .step legend { padding-inline: 4px; color: var(--text-muted); }
  .step-tools { position: absolute; top: -13px; right: 4px; padding-inline: 2px; background: var(--bg); }
  .step-tools .up :global(.icon) { transform: rotate(-90deg); }
  .step-tools .down :global(.icon) { transform: rotate(90deg); }
  .foot-split { display: flex; justify-content: space-between; align-items: center; }
  .foot-end { display: flex; justify-content: flex-end; gap: 5px; }
  .history { max-height: 400px; }
  .run-error { color: var(--red); margin: 4px 0 0; overflow-wrap: anywhere; }
  .run-files { display: flex; flex-wrap: wrap; gap: 2px 8px; margin-top: 4px; }
  .run-files button { min-height: 24px; color: var(--link); overflow-wrap: anywhere; text-align: left; }
  .run-files button:hover { text-decoration: underline; }
  .ghost { padding: 5px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border-strong); color: var(--text); background: var(--bg); }
  .ghost:hover { background: var(--bg-hover); }
  .save { padding: 5px 12px; border-radius: var(--radius-sm); background: var(--accent); color: var(--accent-fg); font-weight: 600; }
</style>
