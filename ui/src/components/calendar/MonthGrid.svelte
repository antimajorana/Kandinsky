<script lang="ts">
  // Monthly grid for the native Calendar: shows Daily Note dots, multi-day event spans, timed/all-day pills, open tasks & .base overlays, with drag-and-drop rescheduling.
  import type { CalendarDaySummary, CalendarEvent, WeekStart } from "../../lib/types";
  import { addDays, colorSpec, daysBetween, monthGridDays, todayIso, weekdayNames } from "./calendar-dates";

  let {
    year,
    month0,
    selectedDate,
    weekStart = "monday",
    days = [],
    events = [],
    compact = false,
    onselectday,
    oneditevent,
    onmoveevent,
    ontoggle,
    cantoggle,
  }: {
    year: number;
    month0: number;
    selectedDate: string;
    weekStart?: WeekStart;
    days?: CalendarDaySummary[];
    events?: CalendarEvent[];
    compact?: boolean;
    onselectday: (iso: string) => void;
    oneditevent?: (ev: CalendarEvent) => void;
    onmoveevent?: (ev: CalendarEvent, newDate: string) => void;
    /** When set, an open task gets a checkbox that calls this (a view block ticks its rows). */
    ontoggle?: (ev: CalendarEvent) => void;
    /** Which items get that checkbox (default: open tasks). */
    cantoggle?: (ev: CalendarEvent) => boolean;
  } = $props();

  const today = todayIso();
  const headers = $derived(weekdayNames(weekStart));
  const cells = $derived(monthGridDays(year, month0, weekStart));
  const summaryByDate = $derived(new Map(days.map((d) => [d.day, d])));

  let draggingOcc = $state<{ occId: string; date: string } | null>(null);
  let dragOverDate = $state<string | null>(null);

  function eventsForDay(iso: string): CalendarEvent[] {
    return events.filter((e) => e.date <= iso && e.end_date >= iso);
  }

  function onDragStart(e: DragEvent, ev: CalendarEvent, cellIso: string): void {
    if (!ev.editable) return;
    draggingOcc = { occId: ev.occurrence_id, date: cellIso };
    e.dataTransfer?.setData("text/plain", ev.occurrence_id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }

  function onDropDay(e: DragEvent, iso: string): void {
    e.preventDefault();
    const occId = draggingOcc?.occId || e.dataTransfer?.getData("text/plain") || "";
    const fromDate = draggingOcc?.date;
    draggingOcc = null;
    dragOverDate = null;
    const ev = events.find((x) => x.occurrence_id === occId);
    if (!ev || !ev.editable) return;
    // a multi-day event grabbed by a later day moves by as many days as it was dragged, not to the drop day
    const delta = daysBetween(fromDate ?? ev.date, iso);
    if (delta !== 0) onmoveevent?.(ev, addDays(ev.date, delta));
  }
</script>

<div class="month-wrap" class:compact>
  <div class="dow-row">
    {#each headers as h (h)}
      <div class="dow">{h}</div>
    {/each}
  </div>
  <div class="grid">
    {#each cells as c (c.iso)}
      {@const info = summaryByDate.get(c.iso)}
      {@const list = eventsForDay(c.iso)}
      {@const maxShow = compact ? 1 : 3}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="cell"
        class:out={!c.inMonth}
        class:today={c.iso === today}
        class:selected={c.iso === selectedDate}
        class:drop-over={dragOverDate === c.iso}
        data-date={c.iso}
        onclick={() => onselectday(c.iso)}
        onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onselectday(c.iso); } }}
        ondragover={(e) => { if (draggingOcc) { e.preventDefault(); dragOverDate = c.iso; } }}
        ondragleave={() => { if (dragOverDate === c.iso) dragOverDate = null; }}
        ondrop={(e) => onDropDay(e, c.iso)}
        role="button"
        tabindex="0"
        aria-label={c.iso}
      >
        <div class="cell-head">
          <span class="num">{c.day}</span>
          {#if info?.has_log && info.log_has_content}
            <span class="note-dot" title="Daily note"></span>
          {:else if info?.has_log}
            <span class="note-dot faint" title="Daily note exists"></span>
          {/if}
        </div>
        {#if !compact}
          <div class="items">
            {#each list.slice(0, maxShow) as ev (ev.occurrence_id)}
              {@const col = colorSpec(ev.color)}
              {@const isSpan = ev.end_date > ev.date}
              {@const tickable = !!ontoggle && (cantoggle ? cantoggle(ev) : ev.source === "task" && !ev.completed)}
              <div class="pill-row">
                {#if tickable}
                  <!-- a checkbox beside the pill (not in it): a button cannot hold another control -->
                  <input type="checkbox" class="tick" aria-label="Done: {ev.title}"
                    onclick={(e) => e.stopPropagation()}
                    onkeydown={(e) => e.stopPropagation()}
                    onchange={() => ontoggle?.(ev)} />
                {/if}
                <button
                  type="button"
                  class="pill"
                  class:span={isSpan}
                  class:done={ev.completed}
                  draggable={ev.editable}
                  ondragstart={(e) => onDragStart(e, ev, c.iso)}
                  ondragend={() => { draggingOcc = null; dragOverDate = null; }}
                  onclick={(e) => { e.stopPropagation(); oneditevent?.(ev); }}
                  style:background={col.bg}
                  style:color={col.fg}
                  title={`${ev.start ? ev.start + " · " : ""}${ev.title}`}
                >
                  <span class="dot" style:background={col.dot}></span>
                  {#if ev.start && ev.date === c.iso}<span class="tm">{ev.start}</span>{/if}
                  <span class="t">{ev.title}</span>
                </button>
              </div>
            {/each}
            {#if list.length > maxShow}
              <span class="more">+{list.length - maxShow} more</span>
            {/if}
          </div>
        {:else if list.length > 0}
          <div class="dots">
            {#each list.slice(0, 3) as ev (ev.occurrence_id)}
              <span class="mini-dot" style:background={colorSpec(ev.color).dot}></span>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .month-wrap { display: flex; flex-direction: column; flex: 1; min-height: 0; }
  .dow-row { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border-bottom: 1px solid var(--border); }
  .dow { padding: 6px 8px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--text-faint); text-align: right; }
  .compact .dow { text-align: center; padding: 4px 2px; font-size: 10px; }
  .grid { flex: 1; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); grid-template-rows: repeat(6, minmax(0, 1fr)); min-height: 360px; }
  .compact .grid { min-height: 200px; }
  .cell { border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); padding: 6px; display: flex; flex-direction: column; gap: 4px; cursor: pointer; min-width: 0; overflow: hidden; transition: background .1s; text-align: left; }
  .cell:nth-child(7n) { border-right: 0; }
  .cell:hover { background: var(--bg-hover); }
  .cell.selected { background: var(--bg-active); }
  .cell.drop-over { outline: 2px solid var(--accent); outline-offset: -2px; }
  .cell.out .num { color: var(--text-faint); opacity: .55; }
  .cell-head { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
  .compact .cell-head { justify-content: center; }
  .num { font-size: 12px; font-weight: 600; color: var(--text-muted); width: 22px; height: 22px; border-radius: 50%; display: inline-grid; place-items: center; font-variant-numeric: tabular-nums; }
  .cell.today .num { background: var(--accent); color: var(--accent-fg); }
  .note-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); flex: none; }
  .note-dot.faint { background: var(--border-strong); }
  .items { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .pill-row { display: flex; align-items: center; gap: 3px; min-width: 0; }
  .pill-row .tick { margin: 0; width: 11px; height: 11px; flex: none; accent-color: var(--accent); }
  .pill { display: flex; align-items: center; gap: 4px; width: 100%; min-width: 0; padding: 2px 5px; border-radius: 4px; font-size: 11px; line-height: 1.3; text-align: left; }
  .pill.span { border-left: 2px solid currentColor; }
  .pill.done .t { text-decoration: line-through; opacity: .65; }
  .pill .dot { width: 5px; height: 5px; border-radius: 50%; flex: none; }
  .pill .tm { font-variant-numeric: tabular-nums; font-weight: 600; flex: none; font-size: 10px; }
  .pill .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .more { font-size: 10.5px; color: var(--text-faint); padding-left: 4px; }
  .dots { display: flex; justify-content: center; gap: 3px; }
  .mini-dot { width: 4px; height: 4px; border-radius: 50%; }
</style>
