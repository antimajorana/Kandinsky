<script lang="ts">
  // A Bases table view, as Obsidian's: a header to drag (reorder), to stretch by its edge (the width is saved as the
  // view's `columnSize`) and to click for its menu (sort, rename, hide); cells edited in place — a click on a property
  // cell opens its editor (CellEditor.svelte), a checkbox toggles at once, a note's name opens it. Every change is
  // written through the core (`onedit` for the `.base`, `onwrite` for a note's property). Rows come in groups when the
  // view has a `groupBy`; the footer holds each column's summary (click it to choose one).
  import { tick } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import Icon from "../Icon.svelte";
  import ContextMenu, { type MenuItem } from "../ContextMenu.svelte";
  import Dialog from "../Dialog.svelte";
  import InputDialog from "../InputDialog.svelte";
  import CellValue from "./CellValue.svelte";
  import CellEditor from "./CellEditor.svelte";
  import { below, type MenuAt } from "../../lib/menu";
  import { openPath } from "../../lib/dock";
  import { shownName } from "../../lib/paths";
  import { reorder } from "../../lib/base-drag";
  import {
    classifyStatus,
    COLUMN_FORMAT_CHOICES,
    effectiveColumnFormat,
    nextStatusValue,
    type StatusTone,
  } from "../../lib/base-format";
  import { context, setHover } from "../../lib/context.svelte";
  import { groupRows, NO_VALUE } from "../../lib/base-groups";
  import { RowWindow } from "../../lib/windowed.svelte";
  import type { BaseView } from "../../lib/gen/BaseView";
  import type { BaseRow } from "../../lib/gen/BaseRow";
  import type { BaseCell } from "../../lib/gen/BaseCell";
  import type { PropertyKind } from "../../lib/gen/PropertyKind";
  import type { ViewEdit } from "../../lib/gen/ViewEdit";
  import type { SummaryKind } from "../../lib/gen/SummaryKind";

  let { view, kindOf, others, onedit, onwrite }: {
    view: BaseView;
    /** a column's property kind (the cell editor it gets) */
    kindOf: (id: string) => PropertyKind;
    /** the properties the "+" column offers */
    others: { id: string; label: string }[];
    onedit: (e: ViewEdit) => void;
    onwrite: (path: string, key: string, value: unknown) => void;
  } = $props();

  // hover sync: a row under the pointer is the shared hover; one hovered elsewhere lights up
  const hoverIn = (p: string) => setHover({ path: p, source: "base" });
  const hoverOut = () => { if (context.hover?.source === "base") setHover(null); };
  const lit = (p: string) => context.hover?.path === p && context.hover.source !== "base";

  let menu = $state<MenuAt | null>(null);
  let dialog = $state<{ column: string; label: string } | null>(null);
  let relDialog = $state<{ column: string; label: string; current: string } | null>(null);
  let relInputVal = $state("");
  let editing = $state<{ path: string; col: number } | null>(null);
  const focusRelInput = (el: HTMLInputElement) => { void tick().then(() => { el.focus(); el.select(); }); };
  function openRelDialog(c: BaseView["columns"][number]) {
    relInputVal = c.back_relation ?? "";
    relDialog = { column: c.id, label: c.label, current: c.back_relation ?? "" };
  }

  // --- columns: width, order, menu -----------------------------------------------------------------------------------
  const MIN = 60;
  let live = $state<Record<string, number>>({}); // a width being dragged, before it is saved
  // every column has a width (fixed layout: a long value never pushes the others); the "+" column takes what is left
  const widthOf = (c: BaseView["columns"][number]) => live[c.id] ?? c.width ?? (c.id === "file.name" ? 240 : 160);
  const total = $derived(view.columns.reduce((n, c) => n + widthOf(c), 0) + 36);
  function resize(e: PointerEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).parentElement!;
    const start = e.clientX, from = th.getBoundingClientRect().width;
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const moveTo = (ev: PointerEvent) => { live = { ...live, [id]: Math.max(MIN, Math.round(from + ev.clientX - start)) }; };
    const up = () => {
      handle.removeEventListener("pointermove", moveTo);
      handle.removeEventListener("pointerup", up);
      const w = live[id];
      if (w !== undefined && Math.abs(w - from) >= 2) onedit({ op: "width", column: id, width: w });
      else { const { [id]: _, ...rest } = live; live = rest; }
    };
    handle.addEventListener("pointermove", moveTo);
    handle.addEventListener("pointerup", up);
  }
  // a saved width replaces the dragged one once the view comes back with it
  $effect(() => { for (const c of view.columns) if (live[c.id] !== undefined && c.width === live[c.id]) { const { [c.id]: _, ...rest } = live; live = rest; } });

  let dragCol = $state<number | null>(null);
  let overCol = $state<number | null>(null);
  const ids = $derived(view.columns.map((c) => c.id));
  const move = (from: number, to: number) => { if (to >= 0 && to < ids.length && from !== to) onedit({ op: "order", columns: reorder(ids, from, to) }); };
  const sortedBy = (id: string) => view.sort[0]?.property === id ? view.sort[0].direction : null;

  function formatMenu(anchor: HTMLElement, c: BaseView["columns"][number]) {
    const r = anchor.getBoundingClientRect();
    const cur = c.format?.trim().toLowerCase() || "auto";
    const curSym = (c.currency ?? "€").trim();
    const items: MenuItem[] = [];
    for (const ch of COLUMN_FORMAT_CHOICES) {
      if (ch.value === "currency") {
        for (const sym of ["€", "$", "£"]) {
          items.push({
            label: `Currency (${sym})`,
            icon: cur === "currency" && curSym === sym ? ("check" as const) : undefined,
            run: () => onedit({ op: "column_format", column: c.id, format: "currency", currency: sym, max: null }),
          });
        }
      } else {
        const nextFmt = ch.value === "auto" ? null : ch.value;
        items.push({
          label: ch.label,
          icon: cur === ch.value ? ("check" as const) : undefined,
          run: () => onedit({ op: "column_format", column: c.id, format: nextFmt, currency: null, max: ch.value === "progress" ? (c.max ?? 100) : null }),
        });
      }
    }
    menu = { x: r.left, y: r.bottom + 2, items };
  }

  function headerMenu(e: MouseEvent, i: number) {
    const anchor = e.currentTarget as HTMLElement;
    const c = view.columns[i];
    const norm = (s: string) => s.replace(/^note\./, "");
    const isGrouped = !!view.group_by && (view.group_by === c.id || norm(view.group_by) === norm(c.id));
    const items: MenuItem[] = [
      { label: "Sort ascending", icon: "arrow-up", run: () => onedit({ op: "sort", sort: [{ property: c.id, direction: "ASC" }, ...view.sort.filter((k) => k.property !== c.id)] }) },
      { label: "Sort descending", icon: "arrow-down", run: () => onedit({ op: "sort", sort: [{ property: c.id, direction: "DESC" }, ...view.sort.filter((k) => k.property !== c.id)] }) },
    ];
    if (view.sort.some((k) => k.property === c.id)) items.push({ label: "Remove from the sort", icon: "close", run: () => onedit({ op: "sort", sort: view.sort.filter((k) => k.property !== c.id) }) });
    if (c.id !== "file.name" && view.kind !== "board") {
      if (isGrouped) {
        items.push({ label: "Ungroup", icon: "close", run: () => onedit({ op: "group", property: null }) });
      } else {
        items.push({ label: `Group by “${c.label}”`, icon: "folder-tree", run: () => onedit({ op: "group", property: c.id }) });
        if (view.group_by) items.push({ label: "Ungroup", icon: "close", run: () => onedit({ op: "group", property: null }) });
      }
    }
    const fmtDetail = !c.format || c.format === "auto"
      ? "Auto"
      : c.format === "currency"
        ? `Currency (${c.currency ?? "€"})`
        : (COLUMN_FORMAT_CHOICES.find((f) => f.value === c.format)?.label ?? c.format);
    items.push("sep",
      { label: "Move left", icon: "arrow-left", disabled: i === 0, run: () => move(i, i - 1) },
      { label: "Move right", icon: "arrow-right", disabled: i === ids.length - 1, run: () => move(i, i + 1) },
      { label: "Rename…", icon: "edit", run: () => (dialog = { column: c.id, label: c.label }) });
    if (c.id !== "file.name") items.push({ label: "Display format…", icon: "sliders", detail: fmtDetail, run: () => formatMenu(anchor, c) });
    if (c.key !== null && !c.rollup) {
      items.push({
        label: "Bidirectional relation…",
        icon: "link",
        detail: c.back_relation ? `⇄ ${c.back_relation}` : undefined,
        run: () => openRelDialog(c),
      });
      if (c.back_relation) {
        items.push({
          label: "Clear bidirectional relation",
          icon: "close",
          run: () => onedit({ op: "back_relation", column: c.id, back_relation: null }),
        });
      }
    }
    if (c.width) items.push({ label: "Reset the width", icon: "refresh", run: () => onedit({ op: "width", column: c.id, width: null }) });
    if (c.rollup) {
      items.push(
        "sep",
        {
          info: `Rollup (${c.rollup.summary ?? "Values"})`,
          detail: `${c.rollup.relation} → ${c.rollup.property}`,
          icon: "sigma",
        },
        {
          label: "Remove rollup config",
          icon: "trash",
          danger: true,
          run: () => onedit({ op: "rollup", column: c.id, rollup: null }),
        },
      );
    }
    items.push("sep", { label: `Hide “${c.label}”`, icon: "eye", disabled: ids.length === 1, run: () => onedit({ op: "hide", column: c.id }) });
    menu = below(e, items);
  }
  function addColumnMenu(e: MouseEvent) {
    menu = below(e, others.length ? others.map((p) => ({ label: p.label, detail: p.label !== p.id ? p.id : undefined, run: () => onedit({ op: "show", column: p.id }) })) : [{ label: "Every property is shown", disabled: true, run: () => {} }]);
  }

  // --- summaries (the footer) ----------------------------------------------------------------------------------------
  const COUNTS: SummaryKind[] = ["Empty", "Filled", "Unique"];
  function isNumericColumn(id: string): boolean {
    if (kindOf(id) === "number") return true;
    const idx = view.columns.findIndex((c) => c.id === id);
    if (idx < 0 || !view.columns[idx].rollup) return false;
    const sumKind = (view.columns[idx].rollup?.summary ?? "").toLowerCase();
    const numericRollup = ["sum", "average", "min", "max", "count", "checked", "filled", "unique"].includes(sumKind);
    const hasNum = view.rows.some((r) => r.cells[idx]?.t === "num");
    const hasNonNum = view.rows.some((r) => {
      const t = r.cells[idx]?.t;
      return t !== undefined && t !== "null" && t !== "num";
    });
    return hasNum || (numericRollup && !hasNonNum);
  }
  /** The summaries a column's kind makes sense of, as Obsidian offers them. */
  function summariesFor(id: string): SummaryKind[] {
    if (isNumericColumn(id)) return ["Sum", "Average", "Median", "Min", "Max", "Range", "Stddev", ...COUNTS];
    const k = kindOf(id);
    if (k === "date" || k === "datetime") return ["Earliest", "Latest", "Range", ...COUNTS];
    if (k === "bool") return ["Checked", "Unchecked", ...COUNTS];
    return COUNTS;
  }
  function summaryMenu(e: MouseEvent, c: BaseView["columns"][number]) {
    const items: MenuItem[] = summariesFor(c.id).map((kind) => ({ label: kind, icon: c.summary?.kind === kind ? "check" as const : undefined, run: () => onedit({ op: "summary", column: c.id, summary: kind }) }));
    if (c.summary) items.push("sep", { label: "No summary", icon: "close", run: () => onedit({ op: "summary", column: c.id, summary: null }) });
    menu = below(e, items);
  }
  const groups = $derived(groupRows(view));
  const collapsedGroups = new SvelteSet<string>();
  function toggleGroup(title: string) {
    if (collapsedGroups.has(title)) collapsedGroups.delete(title);
    else collapsedGroups.add(title);
  }
  const groupCol = $derived(
    view.group_by
      ? view.columns.find((c) => c.id === view.group_by || c.id.replace(/^note\./, "") === view.group_by!.replace(/^note\./, "")) ?? { id: view.group_by }
      : null,
  );
  function groupTone(title: string): StatusTone | null {
    if (title === NO_VALUE) return null;
    const t = classifyStatus(title).tone;
    return effectiveColumnFormat(groupCol) === "status" || t !== "other" ? t : null;
  }

  const statusColIdx = $derived(view.columns.findIndex((c) => effectiveColumnFormat(c) === "status" || kindOf(c.id) === "status"));
  const isStatusGrouped = $derived(!!groupCol && (effectiveColumnFormat(groupCol) === "status" || kindOf(groupCol.id) === "status"));
  function groupMetaLabel(title: string): string | null {
    if (!isStatusGrouped || title === NO_VALUE) return null;
    const t = classifyStatus(title).tone;
    return t === "done" ? "Complete" : t === "todo" ? "To-do" : "In progress";
  }
  function isRowDone(r: BaseRow): boolean {
    if (statusColIdx < 0) return false;
    const c = r.cells[statusColIdx];
    return c?.t === "text" && classifyStatus(c.value).tone === "done";
  }

  // --- sub-items hierarchy --------------------------------------------------------------------------------------------
  const subColIdx = $derived(
    view.sub_items_by
      ? view.columns.findIndex((c) => c.id === view.sub_items_by || c.key === view.sub_items_by || c.id === `note.${view.sub_items_by}`)
      : -1,
  );
  const collapsedParents = new SvelteSet<string>();
  function toggleParentRow(path: string): void {
    if (collapsedParents.has(path)) collapsedParents.delete(path);
    else collapsedParents.add(path);
  }
  function buildTreeRows(rows: BaseRow[]): { r: BaseRow; depth: number; childCount: number; doneChildren: number }[] {
    if (subColIdx < 0) return rows.map((r) => ({ r, depth: 0, childCount: 0, doneChildren: 0 }));
    const byPath = new Map<string, BaseRow>();
    const nameToPath = new Map<string, string>();
    for (const r of rows) {
      byPath.set(r.path, r);
      nameToPath.set(r.path.toLowerCase(), r.path);
      nameToPath.set(shownName(r.path).toLowerCase(), r.path);
    }
    const resolveRef = (c: BaseCell | undefined): string | null => {
      if (!c) return null;
      if (c.t === "link") return c.path ?? nameToPath.get(c.text.toLowerCase()) ?? null;
      if (c.t === "list") {
        for (const it of c.items) { const p = resolveRef(it); if (p) return p; }
        return null;
      }
      if (c.t === "text") {
        const clean = c.value.trim().replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim().toLowerCase();
        return nameToPath.get(clean) ?? null;
      }
      return null;
    };
    const kids = new Map<string, BaseRow[]>();
    const hasParent = new Set<string>();
    for (const r of rows) {
      const p = resolveRef(r.cells[subColIdx]);
      if (p && p !== r.path && byPath.has(p)) {
        hasParent.add(r.path);
        const list = kids.get(p) ?? [];
        list.push(r);
        kids.set(p, list);
      }
    }
    const countSub = (p: string, seen = new Set<string>()): { total: number; done: number } => {
      let total = 0, done = 0;
      for (const ch of kids.get(p) ?? []) {
        if (seen.has(ch.path)) continue;
        seen.add(ch.path);
        total += 1;
        if (isRowDone(ch)) done += 1;
        const nested = countSub(ch.path, seen);
        total += nested.total;
        done += nested.done;
      }
      return { total, done };
    };
    const out: { r: BaseRow; depth: number; childCount: number; doneChildren: number }[] = [];
    const visited = new Set<string>();
    const markHidden = (p: string) => {
      for (const ch of kids.get(p) ?? []) {
        if (!visited.has(ch.path)) {
          visited.add(ch.path);
          markHidden(ch.path);
        }
      }
    };
    const pushNode = (r: BaseRow, depth: number) => {
      if (visited.has(r.path)) return;
      visited.add(r.path);
      const st = countSub(r.path);
      out.push({ r, depth, childCount: st.total, doneChildren: st.done });
      if (st.total > 0) {
        if (collapsedParents.has(r.path)) markHidden(r.path);
        else for (const ch of kids.get(r.path) ?? []) pushNode(ch, Math.min(4, depth + 1));
      }
    };
    for (const r of rows) { if (!hasParent.has(r.path)) pushNode(r, 0); }
    for (const r of rows) { if (!visited.has(r.path)) pushNode(r, 0); }
    return out;
  }

  // --- cells ---------------------------------------------------------------------------------------------------------
  const editable = (r: BaseRow, i: number) => !view.columns[i].rollup && !!view.columns[i].key && r.edit[i] != null;
  /** A cell's kind: the property's, but a list stays a list where one note holds one. */
  const cellKind = (r: BaseRow, i: number): PropertyKind => {
    const col = view.columns[i];
    const k = kindOf(col.id);
    const v = r.values[i];
    if (Array.isArray(v)) return k === "tags" || k === "links" ? k : "list";
    const fmt = col.format?.trim().toLowerCase();
    if (fmt === "progress" || fmt === "percent" || fmt === "currency") return "number";
    // a date written without a time keeps that shape, whatever the vault's kind says
    return k === "datetime" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? "date" : k;
  };
  function activate(r: BaseRow, i: number) {
    if (!editable(r, i)) return;
    const key = view.columns[i].key!;
    if (cellKind(r, i) === "bool") { onwrite(r.path, key, r.values[i] !== true); return; }
    editing = { path: r.path, col: i };
  }
  const isEditing = (r: BaseRow, i: number) => editing?.path === r.path && editing.col === i;
  /** Closing the editor by a key (Enter, Escape) gives the focus back to its cell; a click elsewhere keeps it there. */
  function closeEditor() {
    const cell = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("td.editing");
    editing = null;
    if (cell) void tick().then(() => cell.focus());
  }
  const cellKey = (e: KeyboardEvent, r: BaseRow, i: number) => { if ((e.key === "Enter" || e.key === "F2") && !isEditing(r, i)) { e.preventDefault(); activate(r, i); } };
  const asBool = (c: BaseCell): BaseCell => (c.t === "null" ? { t: "bool", value: false } : c);

  // --- the window: a group's title and a row are one height (32px), and only those around the view are drawn; a view
  // over every note of a vault has thousands, each a cell per column. 100 beyond each side: a usual view is drawn whole
  type Line =
    | { kind: "group"; title: string; n: number; meta: string | null; done: number; collapsed: boolean }
    | { kind: "row"; r: BaseRow; depth: number; childCount: number; doneChildren: number };
  const lines = $derived(
    groups.flatMap((g): Line[] => {
      const tree = buildTreeRows(g.rows);
      if (g.title === null) return tree.map((t) => ({ kind: "row" as const, ...t }));
      const collapsed = collapsedGroups.has(g.title);
      const done = g.rows.reduce((acc, r) => acc + (isRowDone(r) ? 1 : 0), 0);
      return [
        { kind: "group" as const, title: g.title, n: g.rows.length, meta: groupMetaLabel(g.title), done, collapsed },
        ...(collapsed ? [] : tree.map((t) => ({ kind: "row" as const, ...t }))),
      ];
    }),
  );
  let scroller = $state<HTMLElement>();
  const win = new RowWindow(100, 32);
  $effect(() => win.follow(scroller));
  const { first, last } = $derived(win.range(lines.length));
  $effect(() => { void lines.length; win.measure(scroller?.querySelector<HTMLElement>("tbody tr:not(.pad, .group, .empty-row)")); });
</script>

<div class="scroll" bind:this={scroller}>
  <table style:width="max(100%, {total}px)">
    <colgroup>
      {#each view.columns as c (c.id)}<col style:width="{widthOf(c)}px" />{/each}
      <col />
    </colgroup>
    <thead>
      <tr>
        {#each view.columns as c, i (c.id)}
          {@const dir = sortedBy(c.id)}
          <th class:over={overCol === i && dragCol !== i} class:dragging={dragCol === i}
            ondragover={(e) => { if (dragCol !== null) { e.preventDefault(); overCol = i; } }}
            ondrop={(e) => { e.preventDefault(); if (dragCol !== null) move(dragCol, i); dragCol = overCol = null; }}>
            <!-- the label drags, not the whole header: its edge is the resize handle -->
            <button type="button" class="head" draggable="true"
              ondragstart={(e) => { dragCol = i; e.dataTransfer?.setData("text/plain", c.id); }} ondragend={() => (dragCol = overCol = null)} onclick={(e) => headerMenu(e, i)} oncontextmenu={(e) => { e.preventDefault(); headerMenu(e, i); }} title="{c.label}: sort, rename, hide (drag to move)">
              {#if c.rollup}<span class="head-meta" title="Rollup: {c.rollup.relation} → {c.rollup.property} ({c.rollup.summary ?? 'Values'})"><Icon name="sigma" size={11} /></span>{:else if c.back_relation}<span class="head-meta rel" title="Bidirectional relation: ⇄ {c.back_relation}"><Icon name="link" size={11} /></span>{/if}
              <span class="label">{c.label}</span>
              {#if dir}<Icon name={dir === "ASC" ? "arrow-up" : "arrow-down"} size={11} />{/if}
            </button>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span class="resize" title="Drag to resize" onpointerdown={(e) => resize(e, c.id)} ondblclick={() => onedit({ op: "width", column: c.id, width: null })}></span>
          </th>
        {/each}
        <th class="add-col"><button type="button" onclick={addColumnMenu} title="Show another property as a column" aria-label="Add column"><Icon name="plus" size={12} /></button></th>
      </tr>
    </thead>
    <tbody>
      {#if first}<tr class="pad" aria-hidden="true"><td colspan={view.columns.length + 1} style:height="{first * win.rowH}px"></td></tr>{/if}
      {#each lines.slice(first, last) as l (l.kind === "row" ? l.r.path : `group:${l.title}`)}
      {#if l.kind === "group"}
        {@const tone = groupTone(l.title)}
        <tr class="group" class:collapsed={l.collapsed}>
          <td colspan={view.columns.length + 1}>
            <button type="button" class="g-toggle" aria-expanded={!l.collapsed} onclick={() => toggleGroup(l.title)}>
              <span class="g-caret" aria-hidden="true">{l.collapsed ? "▸" : "▾"}</span>
              {#if l.meta}<span class="g-meta">{l.meta}</span>{/if}
              {#if tone}
                <span class="g-pill tone-{tone}"><span class="g-dot"></span><span class="g-name">{l.title}</span></span>
              {:else}
                <span class="g-name">{l.title}</span>
              {/if}
              <span class="g-n">{statusColIdx >= 0 ? `${l.done}/${l.n}` : l.n}</span>
            </button>
          </td>
        </tr>
      {:else}
        {@const r = l.r}
        <tr class:lit={lit(r.path)} onmouseenter={() => hoverIn(r.path)} onmouseleave={hoverOut}>
          {#each r.cells as c, i (i)}
            {@const col = view.columns[i]}
            {@const fmt = effectiveColumnFormat(col, c)}
            {@const k = cellKind(r, i)}
            {@const kind = editable(r, i) ? k : null}
            <td class:first={col.id === "file.name"} class:editable={!!kind} class:bool={kind === "bool"} class:num={(c.t === "num" || fmt === "percent" || fmt === "currency") && fmt !== "progress"} class:progress={fmt === "progress"} class:editing={isEditing(r, i)}
              tabindex={kind ? 0 : undefined} aria-label={kind ? `${col.label} of ${r.path}` : undefined}
              onclick={() => activate(r, i)} onkeydown={(e) => cellKey(e, r, i)} ondblclick={() => { if (!kind && col.id !== "file.name") openPath(r.path); }}>
              {#if isEditing(r, i) && kind}
                <CellEditor {kind} column={col} value={r.values[i]} label={col.label} oncommit={(v) => onwrite(r.path, col.key!, v)} onclose={closeEditor} />
              {:else if col.id === "file.name" && c.t === "link"}
                <span class="name" style:padding-left={l.depth ? `${l.depth * 18}px` : undefined}>
                  {#if l.childCount > 0}
                    <button type="button" class="tree-caret" aria-label="Toggle sub-items" onclick={(e) => { e.stopPropagation(); toggleParentRow(r.path); }}>
                      {collapsedParents.has(r.path) ? "▸" : "▾"}
                    </button>
                  {/if}
                  <Icon name={c.path && !/\.md$/i.test(c.path) ? "file" : "file-text"} size={14} /><CellValue cell={c} />
                  {#if l.childCount > 0}<span class="tree-rollup" title="Sub-items completed">{l.doneChildren}/{l.childCount}</span>{/if}
                </span>
              {:else if kind === "bool"}
                <CellValue cell={asBool(c)} column={col} kind={k} />
              {:else}
                <CellValue cell={c} column={col} kind={k}
                  oncycle={kind && fmt === "status" ? () => onwrite(r.path, col.key!, nextStatusValue(String(r.values[i] ?? ""))) : undefined}
                  onrate={kind && k === "rating" ? (v) => onwrite(r.path, col.key!, v) : undefined} />
              {/if}
            </td>
          {/each}
          <td class="add-col"></td>
        </tr>
      {/if}
      {/each}
      {#if last < lines.length}<tr class="pad" aria-hidden="true"><td colspan={view.columns.length + 1} style:height="{(lines.length - last) * win.rowH}px"></td></tr>{/if}
      {#if !view.rows.length}
        <tr class="empty-row"><td class="empty" colspan={view.columns.length + 1}>No notes match this view. Change its filters, or add a note with “New”.</td></tr>
      {/if}
    </tbody>
    <tfoot>
      <tr>
        {#each view.columns as c (c.id)}
          <td><button type="button" class="sum" class:set={!!c.summary} class:left={!isNumericColumn(c.id) || effectiveColumnFormat(c) === "progress"} onclick={(e) => summaryMenu(e, c)} title="Summary of “{c.label}”" aria-label="Summary of {c.label}">
            {#if c.summary}<span class="sum-kind">{c.summary.kind}</span><span class="sum-val">{#if c.summary.value}<CellValue cell={{ t: "text", value: c.summary.value }} />{:else}—{/if}</span>{:else}<span class="sum-kind">Summarize</span>{/if}
          </button></td>
        {/each}
        <td class="add-col"></td>
      </tr>
    </tfoot>
  </table>
</div>

{#if menu}<ContextMenu x={menu.x} y={menu.y} items={menu.items} onclose={() => (menu = null)} />{/if}
{#if dialog}
  <InputDialog title="Name of the column “{dialog.label}” (every view)" value={dialog.label} onsubmit={(v) => { const d = dialog!; dialog = null; onedit({ op: "display_name", column: d.column, name: v || null }); }} oncancel={() => (dialog = null)} />
{/if}
{#if relDialog}
  <Dialog label="Bidirectional relation for “{relDialog.label}”" onclose={() => (relDialog = null)}>
    <form class="rel-dialog" aria-label="Bidirectional relation for “{relDialog.label}”"
      onsubmit={(e) => {
        e.preventDefault();
        const d = relDialog!;
        const next = relInputVal.trim();
        relDialog = null;
        onedit({ op: "back_relation", column: d.column, back_relation: next || null });
      }}>
      <label class="rel-lbl">
        <span>Paired property on target notes for “{relDialog.label}”</span>
        <input bind:value={relInputVal} use:focusRelInput placeholder="e.g. project (leave empty to clear)" spellcheck="false" />
      </label>
      <p class="rel-hint">Links edited in “{relDialog.label}” stay synced with this property on linked notes.</p>
      <div class="rel-btns">
        {#if relDialog.current}
          <button type="button" class="rel-btn danger" onclick={() => { const d = relDialog!; relDialog = null; onedit({ op: "back_relation", column: d.column, back_relation: null }); }}>Clear</button>
        {/if}
        <span class="rel-spacer"></span>
        <button type="button" class="rel-btn" onclick={() => (relDialog = null)}>Cancel</button>
        <button type="submit" class="rel-btn primary">{relInputVal.trim() ? "Save" : "Clear"}</button>
      </div>
    </form>
  </Dialog>
{/if}

<style>
  .scroll { overflow: auto; min-height: 0; flex: 1; }
  table { border-collapse: separate; border-spacing: 0; table-layout: fixed; }
  th, td { text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-bottom: 1px solid var(--border); }
  th + th, td + td { border-left: 1px solid var(--border); }
  th { position: sticky; top: 0; z-index: 1; background: var(--bg-alt); padding: 0; user-select: none; }
  th.over { box-shadow: inset 2px 0 0 var(--accent); }
  th.dragging { opacity: .5; }
  .head { display: flex; align-items: center; gap: 4px; width: 100%; height: 30px; padding: 0 10px; color: var(--text-muted); font: inherit; font-weight: 600; font-size: .9em; text-align: left; }
  .head:hover { color: var(--text); background: var(--bg-hover); }
  .head .label { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  /* the header and the footer clip their cells: their focus rings go inside */
  .head:focus-visible, .sum:focus-visible { outline-offset: -2px; }
  .head :global(.icon) { flex: none; color: var(--accent); }
  .resize { position: absolute; top: 0; right: 0; width: 6px; height: 100%; cursor: col-resize; z-index: 2; }
  .resize:hover { background: var(--accent); opacity: .5; }
  td { padding: 0 10px; height: 32px; color: var(--text); }
  td.editable { cursor: text; }
  td.editable:hover { background: var(--bg-hover); }
  td.editing { position: relative; padding: 2px 4px; overflow: visible; white-space: normal; }
  /* inside the cell (the row clips it); `.editable` outweighs the global [tabindex] ring */
  td.editable:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  td.num { text-align: right; }
  tbody tr:hover td { background: var(--bg-hover); }
  tbody tr.lit td { background: var(--accent-soft); }
  /* the footer's top edge is the last row's: one line, not two */
  tbody tr:last-child td { border-bottom: 0; }
  .name { display: inline-flex; align-items: center; gap: 8px; min-width: 0; max-width: 100%; }
  .name :global(.icon) { flex: none; color: var(--text-faint); }
  .name :global(.link) { color: var(--text); font-weight: 500; }
  th.add-col, td.add-col { padding: 0 4px; border-left: 0; }
  th.add-col button { display: grid; place-items: center; width: 28px; height: 28px; border-radius: var(--radius-sm); color: var(--text-faint); }
  th.add-col button:hover { background: var(--bg-hover); color: var(--text); }
  .empty { color: var(--text-faint); padding: 14px 10px; white-space: normal; }
  tr.pad td { padding: 0; border: 0; }
  /* a group's title is a row's height (32px): the window counts lines of one height */
  tr.group td { position: sticky; left: 0; height: 32px; padding: 0; background: var(--bg-alt); }
  .g-toggle { display: inline-flex; align-items: center; gap: 6px; width: 100%; height: 32px; padding: 0 10px; font: inherit; font-weight: 600; color: var(--heading, var(--text)); text-align: left; }
  .g-toggle:hover { background: var(--bg-hover); }
  .g-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .g-caret { width: 12px; color: var(--text-faint); font-size: .88em; text-align: center; flex: none; }
  .g-pill { display: inline-flex; align-items: center; gap: 6px; height: 20px; padding: 0 8px 0 6px; border-radius: 999px; font-size: .88em; font-weight: 500; line-height: 1; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); }
  .g-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: none; }
  .g-pill.tone-todo { background: var(--bg-hover); color: var(--text-muted); border-color: var(--border-strong); }
  .g-pill.tone-progress { background: var(--accent-soft); color: var(--accent); }
  .g-pill.tone-blocked { background: var(--red-soft, color-mix(in srgb, var(--red) 12%, transparent)); color: var(--red); }
  .g-pill.tone-done { background: var(--green-soft, color-mix(in srgb, var(--green) 12%, transparent)); color: var(--green); }
  .g-pill.tone-review { background: var(--yellow-soft, color-mix(in srgb, var(--yellow) 12%, transparent)); color: var(--yellow); }
  .g-pill.tone-other { background: var(--accent-soft); color: var(--text); border-color: var(--border); }
  .g-pill.tone-other .g-dot { background: var(--accent); }
  .g-n { margin-left: 2px; padding: 0 6px; line-height: 18px; border-radius: 99px; background: var(--bg-hover); color: var(--text-faint); font-weight: 500; font-size: .82em; font-variant-numeric: tabular-nums; }
  .g-meta { font-size: .75em; text-transform: uppercase; letter-spacing: .05em; color: var(--text-faint); margin-right: 2px; }
  .tree-caret { width: 16px; height: 18px; display: inline-grid; place-items: center; border-radius: 4px; color: var(--text-faint); font-size: 11px; flex: none; }
  .tree-caret:hover { background: var(--bg-hover); color: var(--text); }
  .tree-rollup { margin-left: 4px; padding: 0 6px; border-radius: 99px; background: var(--bg-side); border: 1px solid var(--border); color: var(--text-muted); font-size: .78em; font-variant-numeric: tabular-nums; flex: none; }
  tfoot td { position: sticky; bottom: 0; background: var(--bg); border-bottom: 0; border-top: 1px solid var(--border); padding: 0; height: 28px; }
  /* no column lines in the footer: unsummarised it is not read as one more, empty row */
  tfoot td + td { border-left: 0; }
  .sum { display: flex; align-items: baseline; justify-content: flex-end; gap: 6px; width: 100%; height: 100%; padding: 0 10px; font: inherit; font-size: .88em; color: var(--text-faint); }
  .sum.left { justify-content: flex-start; }
  .sum:not(.set) .sum-kind { opacity: 0; }
  .sum:hover .sum-kind, .sum:focus-visible .sum-kind { opacity: 1; }
  .sum:hover { background: var(--bg-hover); }
  .sum-val { color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; }
  .head-meta { display: inline-flex; align-items: center; flex: none; opacity: .85; }
  .head-meta.rel :global(.icon) { color: var(--green); }
  .rel-dialog { width: min(440px, 92vw); background: var(--bg-elev); border: 1px solid var(--border-strong); border-radius: 10px; padding: 14px; box-shadow: var(--shadow-pop); display: flex; flex-direction: column; gap: 8px; }
  .rel-lbl { display: flex; flex-direction: column; gap: 6px; color: var(--text-muted); font-size: calc(12.5px * var(--ui-scale, 1)); }
  .rel-lbl input { font: inherit; font-size: calc(14px * var(--ui-scale, 1)); color: var(--text); background: var(--bg); border: 1px solid var(--accent); border-radius: var(--radius-sm); padding: 6px 9px; outline: none; }
  .rel-hint { margin: 0; color: var(--text-faint); font-size: calc(12px * var(--ui-scale, 1)); }
  .rel-btns { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
  .rel-spacer { flex: 1; }
  .rel-btn { border: 1px solid var(--border-strong); padding: 4px 12px; border-radius: var(--radius-sm); background: var(--bg); color: var(--text); font: inherit; font-size: calc(12.5px * var(--ui-scale, 1)); }
  .rel-btn:hover { background: var(--bg-hover); }
  .rel-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg, #fff); font-weight: 600; }
  .rel-btn.danger { color: var(--red); border-color: color-mix(in srgb, var(--red) 40%, var(--border-strong)); }
</style>
