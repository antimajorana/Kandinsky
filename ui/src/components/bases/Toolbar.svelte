<script lang="ts">
  // A base's toolbar, as Obsidian's: the view switcher (its menu adds, renames, copies, retypes and deletes views), the
  // results count, and Sort / Filter / Properties, each a popover under its button; "New" makes a note in the view.
  import Icon from "../Icon.svelte";
  import ContextMenu from "../ContextMenu.svelte";
  import type { MenuItem } from "../../lib/menu";
  import InputDialog from "../InputDialog.svelte";
  import Popover from "../Popover.svelte";
  import FilterPanel from "./FilterPanel.svelte";
  import GroupPanel from "./GroupPanel.svelte";
  import SortPanel from "./SortPanel.svelte";
  import PropertiesPanel from "./PropertiesPanel.svelte";
  import FormulaEditorPopover from "./FormulaEditorPopover.svelte";
  import AutomationsPopover from "./AutomationsPopover.svelte";
  import { below, type MenuAt } from "../../lib/menu";
  import { countConditions, type FieldType } from "../../lib/base-filter";
  import type { BaseResult } from "../../lib/gen/BaseResult";
  import type { BaseView } from "../../lib/gen/BaseView";
  import type { ViewEdit } from "../../lib/gen/ViewEdit";
  import type { IconName } from "../../lib/panes";

  let { basePath = "", res, view, pinned, compact, props, typeOf, onpick, onedit, onnew }: {
    basePath?: string;
    res: BaseResult;
    view: BaseView;
    /** an embed that names its view: no switching */
    pinned: boolean;
    /** a narrow embed: icons without words */
    compact: boolean;
    props: { id: string; label: string }[];
    typeOf: (id: string) => FieldType;
    onpick: (name: string) => void;
    /** writes a change to the `.base`; `then` runs once the view is redrawn */
    onedit: (e: ViewEdit, then?: () => void) => void;
    onnew: () => void;
  } = $props();

  type Pop = "group" | "sort" | "filter" | "props" | "formulas" | "automations";
  let pop = $state<{ which: Pop; anchor: HTMLElement } | null>(null);
  const autoCount = $derived((res.automations?.filter((a) => a.enabled).length ?? 0) + (res.recurring?.filter((r) => r.enabled).length ?? 0));
  let menu = $state<MenuAt | null>(null);
  let dialog = $state<{ title: string; value?: string; confirm?: string; submit: (v: string) => void } | null>(null);

  const KINDS: { kind: string; label: string; icon: IconName }[] = [
    { kind: "table", label: "Table", icon: "table" },
    { kind: "cards", label: "Cards", icon: "grid" },
    { kind: "list", label: "List", icon: "rows" },
    { kind: "board", label: "Board", icon: "panel-left" },
    { kind: "calendar", label: "Calendar", icon: "calendar" },
    { kind: "timeline", label: "Timeline", icon: "clock" },
  ];
  const iconOf = (kind: string): IconName => KINDS.find((k) => k.kind === kind)?.icon ?? "table";
  const unique = (base: string) => { let n = base, i = 2; while (res.views.some((v) => v.name === n)) n = `${base} ${i++}`; return n; };
  const filters = $derived(countConditions(res.filters) + countConditions(view.filters));
  const columnIds = $derived(view.columns.map((c) => c.id));
  const groupLabel = $derived.by(() => {
    if (!view.group_by) return null;
    const g = view.group_by;
    const norm = g.replace(/^note\./, "");
    return (
      view.columns.find((c) => c.id === g || c.id.replace(/^note\./, "") === norm)?.label ??
      props.find((p) => p.id === g || p.id.replace(/^note\./, "") === norm)?.label ??
      norm
    );
  });

  function toggle(which: Pop, e: MouseEvent) {
    pop = pop?.which === which ? null : { which, anchor: e.currentTarget as HTMLElement };
  }
  function viewMenu(e: MouseEvent) {
    const anchor = e.currentTarget as HTMLElement;
    const items: MenuItem[] = pinned ? [] : res.views.map((v) => ({ label: v.name, hint: String(v.count), icon: v === view ? "check" as const : iconOf(v.kind), run: () => onpick(v.name) }));
    if (!pinned) items.push("sep");
    for (const k of KINDS.filter((k) => k.kind !== "board")) {
      items.push({ label: `New ${k.label.toLowerCase()} view`, icon: "plus", run: () => { const n = unique(k.label); onedit({ op: "add", name: n, kind: k.kind }, () => onpick(n)); } });
    }
    items.push({ label: "New board view…", icon: "plus", detail: "grouped by a property", run: () => boardMenu(anchor) },
      "sep",
      { label: "Rename view…", icon: "edit", run: () => (dialog = { title: "Name of the view", value: view.name, submit: (n) => onedit({ op: "rename", name: n }, () => onpick(n)) }) },
      { label: "Duplicate view", icon: "copy", run: () => { const n = unique(`${view.name} copy`); onedit({ op: "duplicate", name: n }, () => onpick(n)); } });
    for (const k of KINDS) {
      if (k.kind !== view.kind && (k.kind !== "board" || view.group_by)) items.push({ label: `Show as ${k.label.toLowerCase()}`, icon: k.icon, run: () => onedit({ op: "kind", kind: k.kind }) });
    }
    if (view.kind === "cards") items.push("sep", { label: "Card picture…", icon: "image", detail: view.image ?? "none", run: () => pictureMenu(anchor) });
    items.push("sep", { label: "Delete view…", icon: "close", danger: true, disabled: res.views.length <= 1, run: () => (dialog = { title: `Delete the view “${view.name}”? Its notes stay.`, confirm: "Delete view", submit: () => onedit({ op: "remove" }, () => onpick(res.views[0]?.name ?? "")) }) });
    menu = below(e, items);
  }
  function pictureMenu(anchor: HTMLElement) {
    const keys = props.filter((p) => !/^(file|formula)\./.test(p.id));
    const r = anchor.getBoundingClientRect();
    const items: MenuItem[] = keys.map((p) => ({ label: p.label, icon: view.image && view.image.replace(/^note\./, "") === p.id.replace(/^note\./, "") ? "check" as const : undefined, run: () => onedit({ op: "image", property: p.id }) }));
    if (view.image) items.push("sep", { label: "No picture", icon: "close", run: () => onedit({ op: "image", property: null }) });
    menu = { x: r.left, y: r.bottom + 2, items: items.length ? items : [{ label: "No property to take the picture from", disabled: true, run: () => {} }] };
  }
  function boardMenu(anchor: HTMLElement) {
    const keys = props.filter((p) => !/^(file|formula)\./.test(p.id));
    const r = anchor.getBoundingClientRect();
    menu = { x: r.left, y: r.bottom + 2, items: keys.length
      ? keys.map((p) => ({ label: `Board grouped by ${p.label}`, run: () => { const n = unique(`By ${p.label}`); onedit({ op: "board", name: n, group_by: p.id }, () => onpick(n)); } }))
      : [{ label: "No property to group by", disabled: true, run: () => {} }] };
  }
</script>

<div class="toolbar">
  <button type="button" class="view-switch" onclick={viewMenu} aria-haspopup="menu" title={pinned ? "This view's menu" : "Switch, add or change views"}>
    <Icon name={iconOf(view.kind)} size={13} /><span class="view-name">{view.name}</span>
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
  </button>
  <span class="count" title="Notes in this view">{view.count === view.rows.length ? view.count : `${view.rows.length} of ${view.count}`} {view.count === 1 ? "result" : "results"}</span>
  <span class="grow"></span>
  <button type="button" class="tool" class:on={pop?.which === "group" || !!view.group_by} aria-expanded={pop?.which === "group"} aria-label="Group" title={groupLabel ? `Grouped by ${groupLabel}` : "Group"} onclick={(e) => toggle("group", e)}>
    <Icon name="folder-tree" size={13} />{#if !compact}<span>Group</span>{#if groupLabel}<span class="badge group-badge">{groupLabel}</span>{/if}{/if}
  </button>
  <button type="button" class="tool" class:on={pop?.which === "sort" || view.sort.length > 0} aria-expanded={pop?.which === "sort"} aria-label="Sort" title="Sort" onclick={(e) => toggle("sort", e)}>
    <Icon name="arrow-down" size={13} />{#if !compact}<span>Sort</span>{/if}{#if view.sort.length}<span class="badge">{view.sort.length}</span>{/if}
  </button>
  <button type="button" class="tool" class:on={pop?.which === "filter" || filters > 0} aria-expanded={pop?.which === "filter"} aria-label="Filter" title="Filter" onclick={(e) => toggle("filter", e)}>
    <Icon name="sliders" size={13} />{#if !compact}<span>Filter</span>{/if}{#if filters}<span class="badge">{filters}</span>{/if}
  </button>
  <button type="button" class="tool" class:on={pop?.which === "props"} aria-expanded={pop?.which === "props"} aria-label="Properties" title="Properties shown as columns" onclick={(e) => toggle("props", e)}>
    <Icon name="list" size={13} />{#if !compact}<span>Properties</span>{/if}
  </button>
  {#if basePath}
    <button type="button" class="tool" class:on={pop?.which === "formulas"} aria-expanded={pop?.which === "formulas"} aria-label="Formulas" title="Formula columns" data-testid="base-formulas-btn" onclick={(e) => toggle("formulas", e)}>
      <Icon name="sigma" size={13} />{#if !compact}<span>Formulas</span>{/if}
    </button>
    <button type="button" class="tool" class:on={pop?.which === "automations" || autoCount > 0} aria-expanded={pop?.which === "automations"} aria-label="Automations" title="Local automations & recurring notes" data-testid="base-automations-btn" onclick={(e) => toggle("automations", e)}>
      <Icon name="clock" size={13} />{#if !compact}<span>Automations</span>{/if}{#if autoCount}<span class="badge">{autoCount}</span>{/if}
    </button>
  {/if}
  <button type="button" class="new" class:compact onclick={onnew} aria-label="New" title="New note in this view (its filters fill the folder and properties)"><Icon name="plus" size={12} />{#if !compact} New{/if}</button>
</div>

{#if pop}
  {@const p = pop}
  {#if p.which === "group"}
    <Popover anchor={p.anchor} label="Group" width={300} onclose={() => (pop = null)}>
      <GroupPanel group={view.group_by} board={view.kind === "board"} subItemsBy={view.sub_items_by ?? null} {props} ongroup={(property) => onedit({ op: "group", property })} onsubitems={(property) => onedit({ op: "sub_items", property })} />
    </Popover>
  {:else if p.which === "filter"}
    <Popover anchor={p.anchor} label="Filter" width={560} onclose={() => (pop = null)}>
      <FilterPanel base={res.filters} view={view.filters} viewName={view.name} {props} {typeOf} onedit={(e) => onedit(e)} />
    </Popover>
  {:else if p.which === "sort"}
    <Popover anchor={p.anchor} label="Sort" width={420} onclose={() => (pop = null)}>
      <SortPanel sort={view.sort} {props} {typeOf} onsort={(sort) => onedit({ op: "sort", sort })}
        group={view.group_by} board={view.kind === "board"} ongroup={(property) => onedit({ op: "group", property })} />
    </Popover>
  {:else if p.which === "formulas"}
    <Popover anchor={p.anchor} label="Formulas" width={480} onclose={() => (pop = null)}>
      <FormulaEditorPopover {basePath} {res} {view} {props} {onedit} onclose={() => (pop = null)} />
    </Popover>
  {:else if p.which === "automations"}
    <Popover anchor={p.anchor} label="Automations" width={480} onclose={() => (pop = null)}>
      <AutomationsPopover {basePath} {res} {props} {onedit} onclose={() => (pop = null)} />
    </Popover>
  {:else}
    <Popover anchor={p.anchor} label="Properties" width={380} onclose={() => (pop = null)}>
      <PropertiesPanel columns={view.columns} formulas={res.formula_exprs} others={props.filter((x) => !columnIds.includes(x.id))} onedit={(e, then) => onedit(e, then)} />
    </Popover>
  {/if}
{/if}
{#if menu}<ContextMenu x={menu.x} y={menu.y} items={menu.items} onclose={() => (menu = null)} />{/if}
{#if dialog}
  <InputDialog title={dialog.title} value={dialog.value ?? ""} confirm={dialog.confirm ?? ""} onsubmit={(v) => { const d = dialog!; dialog = null; d.submit(v); }} oncancel={() => (dialog = null)} />
{/if}

<style>
  .toolbar { display: flex; align-items: center; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--border); min-width: 0; flex-wrap: wrap; }
  .view-switch { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 8px; border-radius: var(--radius-sm); color: var(--heading, var(--text)); font-weight: 600; min-width: 0; max-width: 50%; }
  .view-switch:hover, .view-switch:focus-visible { background: var(--bg-hover); }
  .view-switch :global(.icon), .view-switch svg { flex: none; color: var(--text-faint); }
  .view-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .count { color: var(--text-faint); font-size: .9em; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .grow { flex: 1; }
  .tool { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 8px; border-radius: var(--radius-sm); color: var(--text-muted); }
  .tool:hover { background: var(--bg-hover); color: var(--text); }
  .tool.on { color: var(--accent); }
  .tool[aria-expanded="true"] { background: var(--accent-soft); }
  .badge { font-size: .8em; font-variant-numeric: tabular-nums; background: var(--accent-soft); color: var(--accent); padding: 0 6px; border-radius: 99px; line-height: 16px; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .new { display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 10px; margin-left: 4px; border-radius: var(--radius-sm); border: 1px solid var(--border-strong); color: var(--text); }
  .new.compact { padding: 0 7px; }
  .new:hover { background: var(--bg-hover); }
</style>
