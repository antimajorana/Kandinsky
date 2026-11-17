<script lang="ts">
  // Chronological upcoming Agenda view grouped by date, with Daily Note status, 1-click "Join meeting", & day jump.
  import Icon from "../Icon.svelte";
  import type { CalendarDaySummary, CalendarEvent } from "../../lib/types";
  import { addDays, colorSpec, formatDayHeading, isVideoMeetingUrl, todayIso } from "./calendar-dates";

  let {
    days = [],
    events = [],
    onselectday,
    oneditevent,
  }: {
    days?: CalendarDaySummary[];
    events?: CalendarEvent[];
    onselectday: (iso: string) => void;
    oneditevent: (ev: CalendarEvent) => void;
  } = $props();

  const today = todayIso();
  const summaryByDate = $derived(new Map(days.map((d) => [d.day, d])));

  const grouped = $derived.by(() => {
    const map = new Map<string, CalendarEvent[]>();
    const minDay = days.length ? days[0].day : "";
    const maxDay = days.length ? days[days.length - 1].day : "";
    for (const ev of events) {
      const start = minDay && ev.date < minDay ? minDay : ev.date;
      const end = maxDay && ev.end_date > maxDay ? maxDay : ev.end_date;
      for (let d = start, guard = 0; d <= end && guard < 120; d = addDays(d, 1), guard++) {
        const list = map.get(d) ?? [];
        list.push(ev);
        map.set(d, list);
      }
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  });
</script>

<div class="agenda">
  {#if grouped.length === 0}
    <div class="empty">No scheduled events or tasks in this period. Click any day in Month or Week view to plan or write its Daily Note.</div>
  {:else}
    {#each grouped as [date, list] (date)}
      {@const info = summaryByDate.get(date)}
      <section class="day-group" class:is-today={date === today}>
        <header class="group-head">
          <button type="button" class="day-btn" onclick={() => onselectday(date)}>
            <span class="day-name">{formatDayHeading(date)}</span>
            {#if date === today}<span class="today-tag">Today</span>{/if}
            {#if info?.has_log}<span class="note-tag">Daily Note{info.log_has_content ? "" : " (empty)"}</span>{/if}
          </button>
        </header>
        <div class="list">
          {#each list as ev (ev.occurrence_id)}
            {@const c = colorSpec(ev.color)}
            <div class="row" role="button" tabindex="0" onclick={() => oneditevent(ev)}
              onkeydown={(e) => { if (e.key === "Enter") oneditevent(ev); }}>
              <span class="bar" style:background={c.dot}></span>
              <span class="when">{ev.all_day ? "All day" : `${ev.start ?? ""}${ev.end ? ` – ${ev.end}` : ""}`}</span>
              <span class="title" class:done={ev.completed}>{ev.title}</span>
              {#if ev.location && isVideoMeetingUrl(ev.location)}
                <button type="button" class="join" onclick={(e) => { e.stopPropagation(); window.open(ev.location, "_blank", "noopener,noreferrer"); }}>
                  <Icon name="external-link" size={11} /> Join meeting
                </button>
              {:else if ev.location}
                <span class="loc">{ev.location}</span>
              {/if}
            </div>
          {/each}
        </div>
      </section>
    {/each}
  {/if}
</div>

<style>
  .agenda { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 18px; display: flex; flex-direction: column; gap: 18px; scrollbar-width: thin; }
  .empty { padding: 36px 20px; text-align: center; color: var(--text-faint); font-size: 13.5px; }
  .day-group { display: flex; flex-direction: column; gap: 6px; }
  .day-btn { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; text-align: left; }
  .day-name { font-size: 13px; font-weight: 600; color: var(--heading); }
  .day-btn:hover .day-name { color: var(--accent); }
  .today-tag { font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); }
  .note-tag { font-size: 11px; color: var(--green); }
  .list { display: flex; flex-direction: column; gap: 4px; }
  .row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: var(--radius); background: var(--card-bg); border: 1px solid var(--border); cursor: pointer; font-size: 13px; }
  .row:hover { border-color: var(--border-strong); background: var(--bg-hover); }
  .bar { width: 4px; height: 18px; border-radius: 2px; flex: none; }
  .when { min-width: 96px; font-size: 12px; color: var(--text-muted); font-variant-numeric: tabular-nums; flex: none; }
  .title { flex: 1; color: var(--text); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .title.done { text-decoration: line-through; color: var(--text-faint); }
  .loc { font-size: 12px; color: var(--text-faint); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .join { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: var(--radius-sm); background: var(--accent); color: var(--accent-fg); font-size: 11.5px; font-weight: 500; flex: none; }
</style>
