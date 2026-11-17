<script lang="ts">
  // Interactive `calendar` view widget: shows tasks/notes (when passed via /api/view) AND local calendar events, and clicking any day opens the native Calendar Day Workspace.
  import { onMount } from "svelte";
  import MonthGrid from "../calendar/MonthGrid.svelte";
  import { addMonths, parseIso, todayIso } from "../calendar/calendar-dates";
  import { api } from "../../lib/api";
  import { open, openPath } from "../../lib/dock";
  import type { ViewRow } from "../../lib/gen/ViewRow";
  import type { CalendarEvent, CalendarRangeResponse } from "../../lib/types";

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

  const d = $derived(parseIso(anchor));
  const year = $derived(d.getFullYear());
  const month0 = $derived(d.getMonth());
  const title = $derived(d.toLocaleDateString(undefined, { month: "long", year: "numeric" }));

  $effect(() => {
    const from = `${year}-${String(month0 + 1).padStart(2, "0")}-01`;
    const last = new Date(year, month0 + 1, 0).getDate();
    const to = `${year}-${String(month0 + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
    void api.calendar(from, to).then((r) => { rangeData = r; }, () => {});
  });

  const combinedEvents = $derived.by<CalendarEvent[]>(() => {
    const base = [...(rangeData?.events ?? [])];
    const seen = new Set(base.map((e) => `${e.date}:${e.title}`));
    for (const r of rows) {
      if (!r.date || seen.has(`${r.date}:${r.title}`)) continue;
      base.push({
        id: `view:${r.path ?? ""}:${r.line ?? 0}`,
        occurrence_id: `view:${r.path ?? ""}:${r.line ?? 0}@${r.date}`,
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
    }
    return base;
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
  });
</script>

<div class="cal-embed kandinsky-view-calendar" data-testid="embedded-calendar">
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
    days={rangeData?.days ?? []}
    events={combinedEvents}
    {compact}
    onselectday={openDay}
    oneditevent={clickEvent}
  />

  {#if undated.length > 0}
    <div class="undated">
      <span class="uh">Undated tasks ({undated.length})</span>
      <div class="ulist">
        {#each undated.slice(0, 6) as r (`${r.path}:${r.line}:${r.title}`)}
          <div class="uitem">
            {#if r.done === false && ontick}<input type="checkbox" aria-label="Done: {r.title}" onchange={() => ontick(r)} />{/if}
            <button type="button" onclick={() => r.path && openPath(r.path, r.line ?? undefined)}>{r.title}</button>
          </div>
        {/each}
      </div>
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
  .ulist { display: flex; flex-direction: column; gap: 2px; margin-top: 4px; }
  .uitem { display: flex; align-items: center; gap: 6px; font-size: 12px; }
  .uitem button { color: var(--text); text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .uitem button:hover { color: var(--accent); text-decoration: underline; }
</style>
