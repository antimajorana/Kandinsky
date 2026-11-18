<script lang="ts">
  // First-class native Calendar pane: Month, Week, Agenda & Click-a-Day Unified Workspace over 100% local files.
  import { onMount } from "svelte";
  import Icon from "../components/Icon.svelte";
  import AgendaList from "../components/calendar/AgendaList.svelte";
  import DayWorkspace from "../components/calendar/DayWorkspace.svelte";
  import EventPopover from "../components/calendar/EventPopover.svelte";
  import MonthGrid from "../components/calendar/MonthGrid.svelte";
  import WeekGrid from "../components/calendar/WeekGrid.svelte";
  import { addDays, addMonths, daysBetween, formatMonthHeading, monthGridDays, parseIso, todayIso, weekDays } from "../components/calendar/calendar-dates";
  import { confirmMoveSeries } from "../components/calendar/series";
  import { api } from "../lib/api";
  import type { PaneProps } from "../lib/dock";
  import { openPath } from "../lib/dock";
  import { calendarGo } from "../lib/registry";
  import { reloadOnChange } from "../lib/reload-on-change";
  import { settings } from "../lib/settings.svelte";
  import { toast } from "../lib/state.svelte";
  import { errText } from "../lib/text";
  import type { CalendarDefaultView, CalendarEvent, CalendarRangeResponse, WeekStart } from "../lib/types";

  let { spec, panel }: PaneProps<"calendar"> = $props();

  const calCfg = $derived(settings.config?.calendar);
  const weekStart: WeekStart = $derived(calCfg?.week_start ?? "monday");

  // svelte-ignore state_referenced_locally
  let mode = $state<CalendarDefaultView | "day">(spec.view ?? "month");
  // svelte-ignore state_referenced_locally
  let selectedDate = $state(spec.date ?? todayIso());
  let rangeData = $state<CalendarRangeResponse | null>(null);
  let loading = $state(false);
  let error = $state("");
  let host: HTMLElement;
  let editingEvent = $state<CalendarEvent | null | "new">(null);
  let baseChoices = $state<string[]>([]);
  // svelte-ignore state_referenced_locally
  let selectedBases = $state<string[]>(calCfg?.bases ? [...calCfg.bases] : []);
  let basesCustomized = $state(false);
  let baseMenuOpen = $state(false);
  let jumperOpen = $state(false);
  let exporting = $state(false);
  let icsInput: HTMLInputElement;

  $effect(() => {
    if (!basesCustomized && calCfg?.bases) {
      selectedBases = [...calCfg.bases];
    }
  });

  const anchorObj = $derived(parseIso(selectedDate));
  const viewYear = $derived(anchorObj.getFullYear());
  const viewMonth0 = $derived(anchorObj.getMonth());

  const queryWindow = $derived.by(() => {
    if (mode === "month") {
      const cells = monthGridDays(viewYear, viewMonth0, weekStart);
      return { from: cells[0].iso, to: cells[cells.length - 1].iso };
    }
    if (mode === "week") {
      const days = weekDays(selectedDate, weekStart);
      return { from: days[0], to: days[6] };
    }
    if (mode === "agenda") {
      return { from: selectedDate, to: addDays(selectedDate, 30) };
    }
    return { from: addDays(selectedDate, -7), to: addDays(selectedDate, 7) };
  });

  // only the latest request is shown: an older period's answer arriving late must not replace the current one
  let loadSeq = 0;
  async function loadCalendar(): Promise<void> {
    const seq = ++loadSeq;
    loading = true;
    error = "";
    try {
      const bases = basesCustomized || calCfg?.bases !== undefined ? selectedBases : undefined;
      const r = await api.calendar(queryWindow.from, queryWindow.to, bases);
      if (seq === loadSeq) rangeData = r;
    } catch (err) {
      if (seq === loadSeq) error = errText(err);
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  async function loadBaseFiles(): Promise<void> {
    try {
      const files = await api.files({ index: true });
      baseChoices = files.filter((f) => /\.base$/i.test(f));
    } catch {
      baseChoices = [];
    }
  }

  $effect(() => {
    void queryWindow.from;
    void queryWindow.to;
    void selectedBases;
    void loadCalendar();
  });

  onMount(() => {
    if (!spec.view && calCfg?.default_view) mode = calCfg.default_view;
    calendarGo.set(panel.id, (nextDate, nextView) => {
      if (nextDate) selectedDate = nextDate;
      if (nextView) mode = nextView;
    });
    void loadBaseFiles();
    const offChange = reloadOnChange(() => void loadCalendar(), {
      wait: 400,
      wants: (p) => /\.(md|base|ics)$/i.test(p),
      host: () => host,
    });
    return () => {
      loadSeq += 1; // drop an answer that arrives after the pane is gone
      offChange();
      calendarGo.delete(panel.id);
    };
  });

  function stepPeriod(dir: -1 | 1): void {
    if (mode === "month") selectedDate = addMonths(selectedDate, dir);
    else if (mode === "week") selectedDate = addDays(selectedDate, dir * 7);
    else if (mode === "agenda") selectedDate = addDays(selectedDate, dir * 14);
    else selectedDate = addDays(selectedDate, dir);
  }

  function selectDay(iso: string): void {
    selectedDate = iso;
    mode = "day";
  }

  function editEvent(ev: CalendarEvent): void {
    if (ev.editable) editingEvent = ev;
    else if (ev.path) openPath(ev.path, ev.line ?? undefined);
  }

  async function reschedule(ev: CalendarEvent, date: string, start?: string, end?: string): Promise<void> {
    const repeats = ev.repeat !== "none";
    // there is no per-occurrence exception: moving one day of a repeating event moves the series, so ask first
    if (repeats && date !== ev.date && !(await confirmMoveSeries(ev))) return;
    try {
      await api.upsertCalendarEvent({
        // an occurrence id lets the core shift the series start by this occurrence's move (0 for a time change)
        id: repeats ? ev.occurrence_id : ev.id,
        title: ev.title,
        date,
        end_date: ev.end_date !== ev.date ? addDays(date, Math.max(0, daysBetween(ev.date, ev.end_date))) : undefined,
        start: start ?? ev.start ?? undefined,
        end: end ?? ev.end ?? undefined,
        all_day: start ? false : ev.all_day,
        color: ev.color,
        location: ev.location,
        repeat: ev.repeat,
        links: ev.links,
      });
      await loadCalendar();
    } catch (err) {
      toast("Could not move event", errText(err), "error");
    }
  }

  async function handleIcsFile(e: Event): Promise<void> {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    (e.currentTarget as HTMLInputElement).value = "";
    if (!file) return;
    try {
      const ics = await file.text();
      const r = await api.importCalendarIcs({ ics, as_pages: true });
      toast("Imported .ics events", `${r.imported} event${r.imported === 1 ? "" : "s"} added`);
      await loadCalendar();
    } catch (err) {
      toast("ICS import failed", errText(err), "error");
    }
  }

  function toggleBaseSource(b: string): void {
    basesCustomized = true;
    selectedBases = selectedBases.includes(b) ? selectedBases.filter((x) => x !== b) : [...selectedBases, b];
  }

  async function exportIcs(): Promise<void> {
    if (exporting) return;
    exporting = true;
    try {
      const blob = await api.exportCalendarIcs();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = "kandinsky-calendar.ics";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (err) {
      toast("ICS export failed", errText(err), "error");
    } finally {
      exporting = false;
    }
  }

  function onWindowPointerDown(e: PointerEvent): void {
    const t = e.target as HTMLElement | null;
    if (jumperOpen && !t?.closest(".jumper-wrap")) jumperOpen = false;
    if (baseMenuOpen && !t?.closest(".sources-wrap")) baseMenuOpen = false;
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape" && (jumperOpen || baseMenuOpen)) {
      jumperOpen = false;
      baseMenuOpen = false;
      return;
    }
    const t = e.target as HTMLElement | null;
    if (t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable || t.closest(".cm-editor"))) return;
    if (e.key === "t" || e.key === "T") { e.preventDefault(); selectedDate = todayIso(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); stepPeriod(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); stepPeriod(1); }
    else if (e.key === "m") mode = "month";
    else if (e.key === "w") mode = "week";
    else if (e.key === "a") mode = "agenda";
    else if (e.key === "d") mode = "day";
  }

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="cal-pane" bind:this={host} onkeydown={onKeydown} role="region" aria-label="Calendar" tabindex="-1" data-testid="calendar-pane">
  <header class="cal-bar">
    <div class="bar-left">
      <div class="seg" role="tablist" aria-label="Calendar view">
        {#each [["month", "Month"], ["week", "Week"], ["agenda", "Agenda"], ["day", "Day"]] as [id, label] (id)}
          <button type="button" class:active={mode === id} onclick={() => (mode = id as CalendarDefaultView | "day")} data-testid="cal-mode-{id}">{label}</button>
        {/each}
      </div>
      {#if mode !== "day"}
        <div class="nav-group">
          <button type="button" class="icon-btn" aria-label="Previous period" onclick={() => stepPeriod(-1)}><Icon name="arrow-left" size={14} /></button>
          <button type="button" class="pill-btn" onclick={() => (selectedDate = todayIso())}>Today</button>
          <button type="button" class="icon-btn" aria-label="Next period" onclick={() => stepPeriod(1)}><Icon name="arrow-right" size={14} /></button>
        </div>
        <div class="jumper-wrap">
          <button type="button" class="month-title" onclick={() => (jumperOpen = !jumperOpen)}>
            <span>{formatMonthHeading(viewYear, viewMonth0)}</span>
            <Icon name="chevron-down" size={13} />
          </button>
          {#if jumperOpen}
            <div class="jumper-pop">
              <div class="yr-row">
                <button type="button" onclick={() => (selectedDate = addMonths(selectedDate, -12))}><Icon name="arrow-left" size={12} /></button>
                <strong>{viewYear}</strong>
                <button type="button" onclick={() => (selectedDate = addMonths(selectedDate, 12))}><Icon name="arrow-right" size={12} /></button>
              </div>
              <div class="mo-grid">
                {#each months as m, idx (m)}
                  <button type="button" class:cur={idx === viewMonth0} onclick={() => {
                    selectedDate = `${viewYear}-${String(idx + 1).padStart(2, "0")}-01`;
                    jumperOpen = false;
                  }}>{m}</button>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <div class="bar-right">
      {#if baseChoices.length > 0}
        <div class="sources-wrap">
          <button type="button" class="pill-btn" onclick={() => (baseMenuOpen = !baseMenuOpen)}>
            <Icon name="table" size={13} /> Sources{selectedBases.length ? ` (${selectedBases.length})` : ""}
          </button>
          {#if baseMenuOpen}
            <div class="sources-pop">
              {#each baseChoices as b (b)}
                <label class="src-item"><input type="checkbox" checked={selectedBases.includes(b)} onchange={() => toggleBaseSource(b)} /> <span>{b}</span></label>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
      <input type="file" accept=".ics,text/calendar" bind:this={icsInput} onchange={(e) => void handleIcsFile(e)} hidden />
      <button type="button" class="pill-btn" onclick={() => icsInput?.click()} title="Import .ics calendar file">Import .ics</button>
      <button type="button" class="pill-btn" disabled={exporting} onclick={() => void exportIcs()} title="Export local events as .ics">Export .ics</button>
      <button type="button" class="primary-btn" onclick={() => (editingEvent = "new")} data-testid="cal-new-event">
        <Icon name="plus" size={13} /> New event
      </button>
    </div>
  </header>

  {#if error}<p class="err-bar">{error}</p>{/if}

  {#if mode === "month"}
    <MonthGrid
      year={viewYear}
      month0={viewMonth0}
      {selectedDate}
      {weekStart}
      days={rangeData?.days ?? []}
      events={rangeData?.events ?? []}
      onselectday={selectDay}
      oneditevent={editEvent}
      onmoveevent={(ev, d) => void reschedule(ev, d)}
    />
  {:else if mode === "week"}
    <WeekGrid
      anchorDate={selectedDate}
      {weekStart}
      days={rangeData?.days ?? []}
      events={rangeData?.events ?? []}
      onselectday={selectDay}
      oncreatetimed={(d, s, en) => {
        selectedDate = d;
        editingEvent = {
          id: "", occurrence_id: "", title: "", date: d, end_date: d, start: s, end: en, all_day: false,
          color: "blue", location: "", repeat: "none", links: [], source: "daily_frontmatter", completed: false, editable: true,
        };
      }}
      oneditevent={editEvent}
      onreschedule={(ev, d, s, en) => void reschedule(ev, d, s, en)}
    />
  {:else if mode === "agenda"}
    <AgendaList days={rangeData?.days ?? []} events={rangeData?.events ?? []} onselectday={selectDay} oneditevent={editEvent} />
  {:else}
    <DayWorkspace
      date={selectedDate}
      events={rangeData?.events ?? []}
      {weekStart}
      ondatechange={(d) => (selectedDate = d)}
      onrefresh={() => void loadCalendar()}
    />
  {/if}

  {#if loading && !rangeData}<div class="loading-bar">Loading calendar…</div>{/if}
</div>

{#if editingEvent}
  <EventPopover
    initial={editingEvent === "new" ? null : editingEvent}
    defaultDate={selectedDate}
    onclose={() => (editingEvent = null)}
    onsaved={() => void loadCalendar()}
  />
{/if}

<style>
  .cal-pane { height: 100%; display: flex; flex-direction: column; min-height: 0; background: var(--bg); color: var(--text); container-type: inline-size; outline: none; }
  .cal-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  .bar-left, .bar-right, .nav-group { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .seg { display: inline-flex; background: var(--bg-side); border: 1px solid var(--border); border-radius: var(--radius); padding: 2px; }
  .seg button { padding: 4px 10px; border-radius: var(--radius-sm); font-size: 12px; color: var(--text-muted); font-weight: 500; }
  .seg button.active { background: var(--bg-elev); color: var(--heading); box-shadow: var(--shadow-sm); }
  .icon-btn { width: 28px; height: 28px; display: grid; place-items: center; border-radius: var(--radius-sm); border: 1px solid var(--border); color: var(--text-muted); }
  .icon-btn:hover, .pill-btn:hover { background: var(--bg-hover); color: var(--text); }
  .pill-btn { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border); font-size: 12px; color: var(--text-muted); text-decoration: none; }
  .primary-btn { display: inline-flex; align-items: center; gap: 5px; padding: 5px 11px; border-radius: var(--radius-sm); background: var(--accent); color: var(--accent-fg); font-size: 12px; font-weight: 600; }
  .jumper-wrap, .sources-wrap { position: relative; }
  .month-title { display: inline-flex; align-items: center; gap: 5px; font-size: 15px; font-weight: 600; color: var(--heading); padding: 4px 8px; border-radius: var(--radius-sm); }
  .month-title:hover { background: var(--bg-hover); }
  .jumper-pop, .sources-pop { position: absolute; top: calc(100% + 6px); left: 0; z-index: 40; padding: 10px; border-radius: var(--radius-lg); background: var(--bg-elev); border: 1px solid var(--border-strong); box-shadow: var(--shadow-pop); min-width: 210px; }
  .yr-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-size: 13px; }
  .mo-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
  .mo-grid button { padding: 5px 6px; border-radius: var(--radius-sm); font-size: 12px; color: var(--text-muted); }
  .mo-grid button:hover { background: var(--bg-hover); color: var(--text); }
  .mo-grid button.cur { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
  .src-item { display: flex; align-items: center; gap: 6px; padding: 4px 2px; font-size: 12px; cursor: pointer; }
  .err-bar { margin: 0; padding: 6px 14px; font-size: 12px; color: var(--red); background: var(--red-soft); }
  .loading-bar { padding: 14px; text-align: center; font-size: 12.5px; color: var(--text-faint); }
</style>
