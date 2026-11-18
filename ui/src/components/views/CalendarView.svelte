<script lang="ts">
  // The `calendar` row view: a month grid of the block's own dated rows (a checkbox ticks a task), its undated rows
  // listed under it, and the day-note dots; clicking a day opens the native Calendar Day Workspace.
  import { onMount } from "svelte";
  import MonthGrid from "../calendar/MonthGrid.svelte";
  import { addMonths, monthGridDays, parseIso, todayIso } from "../calendar/calendar-dates";
  import { api } from "../../lib/api";
  import { open, openPath } from "../../lib/dock";
  import type { ViewRow } from "../../lib/gen/ViewRow";
  import ListView from "./ListView.svelte";
  import { reloadOnChange } from "../../lib/reload-on-change";
  import { settings } from "../../lib/settings.svelte";
  import type { CalendarEvent, CalendarRangeResponse, WeekStart } from "../../lib/types";

  let {
    rows = [],
    ontick,
    compact = false,
  }: {
    rows?: ViewRow[];
    ontick?: (r: ViewRow) => void;
    compact?: boolean;
  } = $props();

  const today = todayIso();
  const initialDate = $derived.by(() => {
    const dated = rows.filter((r) => r.date).sort((a, b) => a.date!.localeCompare(b.date!));
    return dated.find((r) => r.date! >= today)?.date ?? dated[dated.length - 1]?.date ?? today;
  });

  // svelte-ignore state_referenced_locally
  let anchor = $state(initialDate);
  let rangeData = $state<CalendarRangeResponse | null>(null);
  let hostEl: HTMLDivElement | undefined = $state();

  const weekStart: WeekStart = $derived(settings.config?.calendar.week_start ?? "monday");
  const d = $derived(parseIso(anchor));
  const year = $derived(d.getFullYear());
  const month0 = $derived(d.getMonth());
  const title = $derived(d.toLocaleDateString(undefined, { month: "long", year: "numeric" }));

  // only for the day-note dots: the events shown are the block's rows, never the whole vault's calendar
  let loadSeq = 0;
  function refreshCalendar(): void {
    const cells = monthGridDays(year, month0, weekStart);
    const from = cells[0].iso;
    const to = cells[cells.length - 1].iso;
    const seq = ++loadSeq;
    void api.calendar(from, to).then((r) => { if (seq === loadSeq) rangeData = r; }, () => {});
  }

  $effect(() => {
    void year;
    void month0;
    void weekStart;
    refreshCalendar();
  });

  /** The block's dated rows as calendar items, each with the row it came from (to tick it). */
  const rowEvents = $derived.by(() => {
    const byOcc = new Map<string, ViewRow>();
    const base: CalendarEvent[] = [];
    rows.forEach((r, i) => {
      if (!r.date) return;
      // the index keeps keys unique when two rows share a file and line (or have neither)
      const occ = `view:${r.path ?? ""}:${r.line ?? 0}:${i}@${r.date}`;
      byOcc.set(occ, r);
      base.push({
        id: `view:${r.path ?? ""}:${r.line ?? 0}:${i}`,
        occurrence_id: occ,
        title: r.title,
        date: r.date,
        end_date: r.date,
        all_day: true,
        color: r.done ? "green" : "blue",
        location: "",
        repeat: "none",
        links: [],
        source: "task",
        path: r.path ?? undefined,
        line: r.line ?? undefined,
        completed: r.done === true,
        editable: false,
      });
    });
    return { events: base, byOcc };
  });

  const undated = $derived(rows.filter((r) => !r.date));

  function openDay(iso: string): void {
    open({ kind: "calendar", date: iso, view: "day" });
  }

  function clickEvent(ev: CalendarEvent): void {
    if (ev.path) openPath(ev.path, ev.line ?? undefined);
    else openDay(ev.date);
  }

  onMount(() => {
    anchor = initialDate;
    return reloadOnChange(() => refreshCalendar(), {
      wait: 400,
      wants: (p) => /\.(md|base|ics)$/i.test(p),
      host: () => hostEl ?? null,
    });
  });
</script>

<div class="cal-embed kandinsky-view-calendar" data-testid="embedded-calendar" bind:this={hostEl}>
  <header class="cal-top">
    <button type="button" aria-label="Previous month" onclick={() => (anchor = addMonths(anchor, -1))}>‹</button>
    <button type="button" class="t" onclick={() => open({ kind: "calendar", date: anchor, view: "month" })} title="Open full Calendar">{title}</button>
    <button type="button" class="today" onclick={() => (anchor = today)}>Today</button>
    <button type="button" aria-label="Next month" onclick={() => (anchor = addMonths(anchor, 1))}>›</button>
  </header>

  <MonthGrid
    {year}
    {month0}
    selectedDate={today}
    {weekStart}
    days={rangeData?.days ?? []}
    events={rowEvents.events}
    {compact}
    onselectday={openDay}
    oneditevent={clickEvent}
    ontoggle={ontick ? (ev) => { const r = rowEvents.byOcc.get(ev.occurrence_id); if (r?.done === false) ontick(r); } : undefined}
    cantoggle={(ev) => rowEvents.byOcc.get(ev.occurrence_id)?.done === false}
  />

  {#if undated.length > 0}
    <div class="undated">
      <span class="uh">No date ({undated.length})</span>
      <ListView rows={undated} ontick={ontick ?? (() => {})} />
    </div>
  {/if}
</div>

<style>
  .cal-embed { display: flex; flex-direction: column; gap: 6px; padding: 6px; background: var(--bg); border-radius: var(--radius); }
  .cal-top { display: flex; align-items: center; gap: 6px; padding: 2px 4px; }
  .cal-top button { padding: 2px 7px; border-radius: var(--radius-sm); color: var(--text-muted); font-size: 12px; }
  .cal-top button:hover { background: var(--bg-hover); color: var(--text); }
  .cal-top .t { flex: 1; text-align: center; font-weight: 600; color: var(--heading); font-size: 13px; }
  .cal-top .today { border: 1px solid var(--border); font-size: 11px; }
  .undated { border-top: 1px solid var(--border); padding-top: 6px; }
  .uh { font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--text-faint); }
</style>
