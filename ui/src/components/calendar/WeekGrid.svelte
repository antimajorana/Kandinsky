<script lang="ts">
  // Hourly Week time-grid: all-day strip, 24h grid, live current-time line, drag-across-days/hours rescheduling & bottom-edge duration resize.
  import { onMount } from "svelte";
  import type { CalendarDaySummary, CalendarEvent, WeekStart } from "../../lib/types";
  import { addDays, colorSpec, daysBetween, formatHm, minutesOf, parseIso, todayIso, weekDays } from "./calendar-dates";
  import type { AnchorRect } from "./EventPopover.svelte";

  let {
    anchorDate,
    weekStart = "monday",
    days = [],
    events = [],
    onselectday,
    oncreatetimed,
    oneditevent,
    onreschedule,
    ontoggle,
  }: {
    anchorDate: string;
    weekStart?: WeekStart;
    days?: CalendarDaySummary[];
    events?: CalendarEvent[];
    onselectday: (iso: string) => void;
    oncreatetimed: (date: string, start: string, end: string, anchorRect?: AnchorRect) => void;
    oneditevent: (ev: CalendarEvent, anchorRect?: AnchorRect) => void;
    onreschedule: (ev: CalendarEvent, date: string, start?: string, end?: string) => void;
    ontoggle?: (ev: CalendarEvent) => void;
  } = $props();

  const HOUR_PX = 44;
  const today = todayIso();
  const cols = $derived(weekDays(anchorDate, weekStart));
  const summaryByDate = $derived(new Map(days.map((d) => [d.day, d])));
  let nowMins = $state(new Date().getHours() * 60 + new Date().getMinutes());
  let resizing = $state<{ occId: string; startMins: number; endMins: number } | null>(null);
  let dragOccId = $state<string | null>(null);
  let dragFromIso: string | null = null;
  let dragAllDay = $state(false);
  let allDayOverIso = $state<string | null>(null);
  let scroller = $state<HTMLElement>();

  onMount(() => {
    if (scroller) scroller.scrollTop = 7.5 * HOUR_PX;
    const t = setInterval(() => {
      const n = new Date();
      nowMins = n.getHours() * 60 + n.getMinutes();
    }, 60_000);
    return () => clearInterval(t);
  });

  function allDayFor(iso: string): CalendarEvent[] {
    return events.filter((e) => e.all_day && e.date <= iso && e.end_date >= iso);
  }

  function timedFor(iso: string): CalendarEvent[] {
    return events.filter((e) => !e.all_day && e.date <= iso && e.end_date >= iso);
  }

  function dayStartMins(ev: CalendarEvent, iso: string): number {
    return ev.date < iso ? 0 : (minutesOf(ev.start) ?? 9 * 60);
  }

  function dayEndMins(ev: CalendarEvent, iso: string): number {
    const s = dayStartMins(ev, iso);
    if (resizing?.occId === ev.occurrence_id && ev.end_date === iso) return resizing.endMins;
    if (ev.end_date > iso) return 24 * 60;
    return minutesOf(ev.end) ?? s + 60;
  }

  function blockTop(ev: CalendarEvent, iso: string): number {
    return (dayStartMins(ev, iso) / 60) * HOUR_PX;
  }

  function blockHeight(ev: CalendarEvent, iso: string): number {
    const s = dayStartMins(ev, iso);
    const e = dayEndMins(ev, iso);
    return Math.max(22, ((Math.max(e, s + 15) - s) / 60) * HOUR_PX);
  }

  function startResize(e: PointerEvent, ev: CalendarEvent): void {
    if (!ev.editable) return;
    e.stopPropagation();
    e.preventDefault();
    const s = minutesOf(ev.start) ?? 9 * 60;
    const baseEnd = minutesOf(ev.end) ?? s + 60;
    const y0 = e.clientY;
    resizing = { occId: ev.occurrence_id, startMins: s, endMins: baseEnd };
    const move = (mv: PointerEvent) => {
      const delta = ((mv.clientY - y0) / HOUR_PX) * 60;
      const snapped = Math.max(s + 15, Math.min(23 * 60 + 55, Math.round((baseEnd + delta) / 15) * 15));
      resizing = { occId: ev.occurrence_id, startMins: s, endMins: snapped };
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
    const up = () => {
      cleanup();
      const finalEnd = resizing?.endMins ?? baseEnd;
      resizing = null;
      onreschedule(ev, ev.date, ev.start ?? formatHm(s), formatHm(finalEnd));
    };
    const cancel = () => {
      cleanup();
      resizing = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
  }

  function startDrag(e: DragEvent, ev: CalendarEvent, iso: string, isAllDay: boolean): void {
    if (!ev.editable) return;
    dragOccId = ev.occurrence_id;
    dragFromIso = iso;
    dragAllDay = isAllDay;
    e.dataTransfer?.setData("text/plain", ev.occurrence_id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }

  function clearDrag(): void {
    dragOccId = null;
    dragFromIso = null;
    dragAllDay = false;
    allDayOverIso = null;
  }

  function dropOnAllDay(e: DragEvent, iso: string): void {
    e.preventDefault();
    const occId = dragOccId || e.dataTransfer?.getData("text/plain") || "";
    const fromIso = dragFromIso;
    clearDrag();
    const ev = events.find((x) => x.occurrence_id === occId);
    if (!ev || !ev.editable) return;
    const delta = daysBetween(fromIso ?? ev.date, iso);
    if (delta !== 0) {
      onreschedule(ev, addDays(ev.date, delta), ev.all_day ? undefined : (ev.start ?? undefined), ev.all_day ? undefined : (ev.end ?? undefined));
    }
  }

  function dropOnColumn(e: DragEvent, iso: string): void {
    e.preventDefault();
    const occId = dragOccId || e.dataTransfer?.getData("text/plain") || "";
    const fromIso = dragFromIso;
    const wasAllDay = dragAllDay;
    clearDrag();
    const ev = events.find((x) => x.occurrence_id === occId);
    if (!ev || !ev.editable) return;
    if (wasAllDay) {
      const delta = daysBetween(fromIso ?? ev.date, iso);
      if (delta !== 0) onreschedule(ev, addDays(ev.date, delta));
      return;
    }
    // grabbed by a later day of a multi-day event: shift by the days dragged and keep its times (that
    // day's block starts at 00:00, so the drop height says nothing about the event's own start)
    if (fromIso && fromIso !== ev.date) {
      const delta = daysBetween(fromIso, iso);
      if (delta !== 0) onreschedule(ev, addDays(ev.date, delta), ev.start ?? undefined, ev.end ?? undefined);
      return;
    }
    const colEl = e.currentTarget as HTMLElement;
    const y = e.clientY - colEl.getBoundingClientRect().top;
    const mins = Math.max(0, Math.min(23 * 60, Math.round(((y / HOUR_PX) * 60) / 15) * 15));
    const dur = Math.max(15, (minutesOf(ev.end) ?? (minutesOf(ev.start) ?? 540) + 60) - (minutesOf(ev.start) ?? 540));
    onreschedule(ev, iso, formatHm(mins), formatHm(Math.min(23 * 60 + 45, mins + dur)));
  }

  function rectOf(el: HTMLElement): AnchorRect {
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, bottom: r.bottom, right: r.right };
  }

  function colLabel(iso: string): string {
    return parseIso(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
  }
</script>

<div class="week-wrap">
  <div class="week-header">
    <div class="gutter-head">All day</div>
    {#each cols as iso (iso)}
      {@const info = summaryByDate.get(iso)}
      <button
        type="button"
        class="day-head"
        class:today={iso === today}
        class:drop-over={allDayOverIso === iso}
        onclick={() => onselectday(iso)}
        ondragover={(e) => { if (dragOccId) { e.preventDefault(); allDayOverIso = iso; } }}
        ondragleave={() => { if (allDayOverIso === iso) allDayOverIso = null; }}
        ondrop={(e) => dropOnAllDay(e, iso)}
      >
        <span>{colLabel(iso)}</span>
        {#if info?.has_log}<span class="dot" class:faint={!info.log_has_content} title="Daily note"></span>{/if}
      </button>
    {/each}
  </div>

  <div class="allday-row">
    <div class="gutter-spacer"></div>
    {#each cols as iso (iso)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="allday-cell"
        class:drop-over={allDayOverIso === iso}
        data-date={iso}
        ondragover={(e) => { if (dragOccId) { e.preventDefault(); allDayOverIso = iso; } }}
        ondragleave={() => { if (allDayOverIso === iso) allDayOverIso = null; }}
        ondrop={(e) => dropOnAllDay(e, iso)}
      >
        {#each allDayFor(iso) as ev (ev.occurrence_id)}
          {@const c = colorSpec(ev.color)}
          {@const isTask = ev.source === "task"}
          <div class="ad-row">
            {#if isTask && ontoggle}
              <input
                type="checkbox"
                class="kandinsky-check ad-tick"
                checked={ev.completed}
                disabled={ev.completed}
                aria-label="Done: {ev.title}"
                onclick={(e) => e.stopPropagation()}
                onkeydown={(e) => e.stopPropagation()}
                onchange={() => { if (!ev.completed) ontoggle(ev); }}
              />
            {/if}
            <button
              type="button"
              class="ad-pill"
              class:done={ev.completed}
              style:background={c.bg}
              style:color={c.fg}
              draggable={ev.editable}
              ondragstart={(e) => startDrag(e, ev, iso, true)}
              ondragend={clearDrag}
              onclick={(e) => { e.stopPropagation(); oneditevent(ev, rectOf(e.currentTarget as HTMLElement)); }}
            >{ev.title}</button>
          </div>
        {/each}
      </div>
    {/each}
  </div>

  <div class="hours-scroll" bind:this={scroller}>
    <div class="hours-inner" style:height="{24 * HOUR_PX}px">
      <div class="time-axis">
        {#each Array.from({ length: 24 }, (_, h) => h) as h (h)}
          <div class="hour-mark" style:height="{HOUR_PX}px">{String(h).padStart(2, "0")}:00</div>
        {/each}
      </div>

      {#each cols as iso (iso)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="day-col"
          ondragover={(e) => { if (dragOccId) e.preventDefault(); }}
          ondrop={(e) => dropOnColumn(e, iso)}
          onclick={(e) => {
            if (e.target !== e.currentTarget) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const h = Math.max(0, Math.min(22, Math.floor((e.clientY - rect.top) / HOUR_PX)));
            const anchor: AnchorRect = { top: e.clientY, bottom: e.clientY, left: e.clientX, right: e.clientX };
            oncreatetimed(iso, formatHm(h * 60), formatHm((h + 1) * 60), anchor);
          }}
          onkeydown={() => {}}
        >
          {#each Array.from({ length: 24 }, (_, h) => h) as h (h)}
            <div class="hour-slot" style:height="{HOUR_PX}px"></div>
          {/each}

          {#if iso === today}
            <div class="now-line" style:top="{(nowMins / 60) * HOUR_PX}px"><span class="now-dot"></span></div>
          {/if}

          {#each timedFor(iso) as ev (ev.occurrence_id)}
            {@const c = colorSpec(ev.color)}
            <div
              class="timed-card"
              class:done={ev.completed}
              style:top="{blockTop(ev, iso)}px"
              style:height="{blockHeight(ev, iso)}px"
              style:background={c.bg}
              style:border-left="3px solid {c.dot}"
              draggable={ev.editable}
              ondragstart={(e) => startDrag(e, ev, iso, false)}
              ondragend={clearDrag}
              onclick={(e) => { e.stopPropagation(); oneditevent(ev, rectOf(e.currentTarget as HTMLElement)); }}
              role="button"
              tabindex="0"
              onkeydown={(e) => { if (e.key === "Enter") { e.stopPropagation(); oneditevent(ev, rectOf(e.currentTarget as HTMLElement)); } }}
            >
              <span class="t-title">{ev.title}</span>
              <span class="t-time">{ev.date < iso ? "00:00" : (ev.start ?? "")}{ev.end_date > iso ? "–24:00" : ev.end ? `–${ev.end}` : ""}</span>
              {#if ev.editable && ev.date === ev.end_date}
                <div class="resize-edge" title="Drag to change duration" onpointerdown={(e) => startResize(e, ev)}></div>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .week-wrap { display: flex; flex-direction: column; flex: 1; min-height: 0; }
  .week-header, .allday-row { display: grid; grid-template-columns: 54px repeat(7, minmax(0, 1fr)); border-bottom: 1px solid var(--border); }
  .gutter-head, .gutter-spacer { font-size: 10.5px; color: var(--text-faint); padding: 6px; text-align: right; border-right: 1px solid var(--border); }
  .day-head { padding: 7px 6px; font-size: 12px; font-weight: 600; color: var(--text-muted); border-right: 1px solid var(--border); display: inline-flex; align-items: center; justify-content: center; gap: 5px; }
  .day-head:last-child { border-right: 0; }
  .day-head:hover { background: var(--bg-hover); color: var(--heading); }
  .day-head.today { color: var(--accent); }
  .day-head.drop-over, .allday-cell.drop-over { outline: 2px solid var(--accent); outline-offset: -2px; }
  .day-head .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--green); }
  .day-head .dot.faint { background: var(--border-strong); }
  .allday-cell { border-right: 1px solid var(--border); padding: 3px; display: flex; flex-direction: column; gap: 2px; min-height: 26px; min-width: 0; }
  .allday-cell:last-child { border-right: 0; }
  .ad-row { display: flex; align-items: center; gap: 4px; min-width: 0; }
  .ad-tick { font-size: 11px; flex: none; cursor: pointer; }
  .ad-pill { flex: 1; min-width: 0; font-size: 11px; padding: 1px 6px; border-radius: 4px; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ad-pill.done { text-decoration: line-through; opacity: .65; }
  .hours-scroll { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: thin; }
  .hours-inner { display: grid; grid-template-columns: 54px repeat(7, minmax(0, 1fr)); position: relative; }
  .time-axis { border-right: 1px solid var(--border); }
  .hour-mark { font-size: 10.5px; color: var(--text-faint); padding: 2px 6px 0 0; text-align: right; font-variant-numeric: tabular-nums; }
  .day-col { position: relative; border-right: 1px solid var(--border); cursor: crosshair; }
  .day-col:last-child { border-right: 0; }
  .hour-slot { border-bottom: 1px solid var(--border); pointer-events: none; }
  .now-line { position: absolute; left: 0; right: 0; height: 1.5px; background: var(--red); z-index: 4; pointer-events: none; }
  .now-dot { position: absolute; left: -3px; top: -3px; width: 7px; height: 7px; border-radius: 50%; background: var(--red); }
  .timed-card { position: absolute; left: 2px; right: 2px; border-radius: 5px; padding: 2px 6px; font-size: 11px; color: var(--heading); overflow: hidden; display: flex; flex-direction: column; cursor: pointer; z-index: 2; box-shadow: var(--shadow-sm); }
  .timed-card.done .t-title { text-decoration: line-through; opacity: .65; }
  .t-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .t-time { font-size: 10px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .resize-edge { position: absolute; left: 0; right: 0; bottom: 0; height: 6px; cursor: ns-resize; }
</style>
