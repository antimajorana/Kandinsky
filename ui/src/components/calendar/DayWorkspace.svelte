<script lang="ts">
  // Unified Day Workspace: pairs chronological Day Events & Tasks with that day's lazy Daily Note editor (`@container` responsive).
  import { onDestroy } from "svelte";
  import Icon from "../Icon.svelte";
  import EventPopover from "./EventPopover.svelte";
  import { api } from "../../lib/api";
  import { openPath } from "../../lib/dock";
  import { createEditor, type KandinskyEditor } from "../../lib/editor/create";
  import { toast } from "../../lib/state.svelte";
  import { app } from "../../lib/state.svelte";
  import { errText } from "../../lib/text";
  import type { CalendarEvent, DayLogInfo, WeekStart } from "../../lib/types";
  import { addDays, colorSpec, formatDayHeading, isVideoMeetingUrl, monthGridDays, pad2, parseIso, todayIso, weekdayNames } from "./calendar-dates";

  let {
    date,
    events = [],
    weekStart = "monday",
    ondatechange,
    onrefresh,
  }: {
    date: string;
    events: CalendarEvent[];
    weekStart?: WeekStart;
    ondatechange: (iso: string) => void;
    onrefresh: () => void;
  } = $props();

  const today = todayIso();
  let dayInfo = $state<DayLogInfo | null>(null);
  let loadingNote = $state(false);
  let saving = $state(false);
  let dirty = $state(false);
  let noteError = $state("");
  let scheduleOpen = $state(true);
  let pickerOpen = $state(false);
  let editingEvent = $state<CalendarEvent | null | "new">(null);
  let editorHost = $state<HTMLElement>();

  let editor: KandinskyEditor | null = null;
  let loadedFor = "";
  let dirtyPath = "";
  let dirtyMtime: number | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  // Mini-month picker state follows selected date when opened.
  let pickYear = $state(parseIso(today).getFullYear());
  let pickMonth0 = $state(parseIso(today).getMonth());

  const dayEvents = $derived(
    events
      .filter((e) => e.date <= date && e.end_date >= date)
      .sort((a, b) => Number(a.all_day) - Number(b.all_day) || (a.start ?? "").localeCompare(b.start ?? "") || a.title.localeCompare(b.title)),
  );

  async function flushSave(path = dirtyPath, text = editor?.view.state.doc.toString() ?? "", mtime = dirtyMtime): Promise<void> {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    if (!dirty || !path) return;
    dirty = false;
    saving = true;
    try {
      const r = await api.putFile(path, text, mtime);
      dirtyMtime = r.mtime;
      if (dayInfo && dayInfo.path === path) {
        dayInfo = { ...dayInfo, exists: true, mtime: r.mtime, text };
      }
      onrefresh();
    } catch (err) {
      toast("Could not save Daily Note", errText(err), "error");
    } finally {
      saving = false;
    }
  }

  function scheduleSave(path: string): void {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void flushSave(path, editor?.view.state.doc.toString() ?? "", dirtyMtime); }, 450);
  }

  async function loadDay(targetDate: string): Promise<void> {
    if (dirty && dirtyPath) await flushSave();
    loadingNote = true;
    noteError = "";
    try {
      const info = await api.dayLog(targetDate);
      if (targetDate !== date) return;
      dayInfo = info;
      dirty = false;
      dirtyPath = info.path;
      dirtyMtime = info.mtime;
      loadedFor = `${info.day}:${info.path}`;
      mountEditor(info);
    } catch (err) {
      if (targetDate === date) noteError = errText(err);
    } finally {
      if (targetDate === date) loadingNote = false;
    }
  }

  function mountEditor(info: DayLogInfo): void {
    editor?.destroy();
    editor = null;
    if (!editorHost) return;
    editor = createEditor({
      parent: editorHost,
      doc: info.text,
      path: info.path,
      vim: app.vimEnabled,
      caretEnd: true,
      onChange: (typed) => {
        if (!typed) return;
        dirty = true;
        scheduleSave(info.path);
      },
      onSave: () => {
        dirty = true;
        void flushSave(info.path, editor?.view.state.doc.toString() ?? "", dirtyMtime);
      },
      onOpenLink: (target, opts) => {
        openPath(target, undefined, { beside: opts?.beside });
      },
    });
  }

  $effect(() => {
    const key = `${date}`;
    if (loadedFor.startsWith(`${key}:`) && editor) return;
    void loadDay(date);
  });

  $effect(() => {
    if (editorHost && dayInfo && !editor && loadedFor === `${dayInfo.day}:${dayInfo.path}`) {
      mountEditor(dayInfo);
    }
  });

  onDestroy(() => {
    if (dirty && dirtyPath) void flushSave();
    clearTimeout(saveTimer);
    editor?.destroy();
    editor = null;
  });

  async function openInFullPane(): Promise<void> {
    if (!dayInfo) return;
    if (!dayInfo.exists) {
      const created = await api.ensureDayLog(date);
      dayInfo = created;
      dirtyMtime = created.mtime;
    } else if (dirty) {
      await flushSave();
    }
    openPath(dayInfo.path);
  }

  function openScheduleItem(ev: CalendarEvent): void {
    setEditing(ev);
  }

  function setEditing(ev: CalendarEvent): void {
    if (ev.editable) editingEvent = ev;
    else if (ev.path) openPath(ev.path, ev.line ?? undefined);
  }

  const miniDays = $derived(monthGridDays(pickYear, pickMonth0, weekStart));
</script>

<div class="day-workspace" data-testid="day-workspace">
  <header class="day-head">
    <div class="day-nav">
      <button type="button" class="nav-btn" aria-label="Previous day" onclick={() => ondatechange(addDays(date, -1))}><Icon name="arrow-left" size={14} /></button>
      <button type="button" class="today-btn" class:is-today={date === today} onclick={() => ondatechange(today)}>Today</button>
      <button type="button" class="nav-btn" aria-label="Next day" onclick={() => ondatechange(addDays(date, 1))}><Icon name="arrow-right" size={14} /></button>
      <div class="picker-wrap">
        <button type="button" class="day-title-btn" onclick={() => {
          const d = parseIso(date);
          pickYear = d.getFullYear();
          pickMonth0 = d.getMonth();
          pickerOpen = !pickerOpen;
        }}>
          <span>{formatDayHeading(date)}</span>
          <Icon name="chevron-down" size={13} />
        </button>
        {#if pickerOpen}
          <div class="mini-pop">
            <div class="mini-head">
              <button type="button" onclick={() => {
                const m = new Date(pickYear, pickMonth0 - 1, 1);
                pickYear = m.getFullYear(); pickMonth0 = m.getMonth();
              }}><Icon name="arrow-left" size={12} /></button>
              <span>{new Date(pickYear, pickMonth0, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span>
              <button type="button" onclick={() => {
                const m = new Date(pickYear, pickMonth0 + 1, 1);
                pickYear = m.getFullYear(); pickMonth0 = m.getMonth();
              }}><Icon name="arrow-right" size={12} /></button>
            </div>
            <div class="mini-grid">
              {#each weekdayNames(weekStart) as dn (dn)}<span class="mini-dow">{dn.slice(0, 2)}</span>{/each}
              {#each miniDays as md (md.iso)}
                <button type="button" class="mini-cell" class:out={!md.inMonth} class:sel={md.iso === date} class:today={md.iso === today}
                  onclick={() => { pickerOpen = false; ondatechange(md.iso); }}>{md.day}</button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>
    <div class="day-actions">
      <button type="button" class="schedule-toggle" onclick={() => (scheduleOpen = !scheduleOpen)}>
        {scheduleOpen ? "Hide schedule" : `Schedule (${dayEvents.length})`}
      </button>
      <button type="button" class="new-ev-btn" data-testid="day-new-event" onclick={() => (editingEvent = "new")}>
        <Icon name="plus" size={13} /> New event
      </button>
      <button type="button" class="ghost-btn" onclick={() => void openInFullPane()} title="Open Daily Note tab">
        <Icon name="external-link" size={13} /> Open note
      </button>
    </div>
  </header>

  <div class="workspace-body" class:no-sched={!scheduleOpen}>
    {#if scheduleOpen}
      <aside class="sched-col">
        <div class="sched-head">
          <span class="sec-label">Schedule & due items</span>
          <span class="count">{dayEvents.length}</span>
        </div>
        {#if dayEvents.length === 0}
          <p class="empty-sched">Nothing scheduled for {date}.</p>
        {:else}
          <ul class="sched-list">
            {#each dayEvents as ev (ev.occurrence_id)}
              {@const c = colorSpec(ev.color)}
              <li class="ev-item">
                <span class="ev-dot" style:background={c.dot}></span>
                <button type="button" class="ev-main" onclick={() => openScheduleItem(ev)}>
                  <span class="ev-time">{ev.all_day ? "All day" : `${ev.start ?? ""}${ev.end ? `–${ev.end}` : ""}`}</span>
                  <span class="ev-title" class:done={ev.completed}>{ev.title}</span>
                  {#if ev.location && !isVideoMeetingUrl(ev.location)}<span class="ev-loc">{ev.location}</span>{/if}
                </button>
                {#if ev.location && isVideoMeetingUrl(ev.location)}
                  <a class="join-link" href={ev.location} target="_blank" rel="noopener noreferrer">Join</a>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </aside>
    {/if}

    <section class="note-col">
      <div class="note-status">
        <span class="note-path">{dayInfo?.path ?? `notes/log/${pad2(parseIso(date).getMonth() + 1)}-${pad2(parseIso(date).getDate())}`}</span>
        <span class="draft-pill" class:saved={dayInfo?.exists && !dirty}>
          {#if saving}Saving…{:else if dirty}Unsaved changes{:else if dayInfo?.exists}Saved{:else}Draft — created when you start writing{/if}
        </span>
      </div>
      {#if noteError}
        <p class="err">{noteError}</p>
      {:else if loadingNote && !dayInfo}
        <p class="loading">Loading note…</p>
      {/if}
      <div class="editor-host" bind:this={editorHost} data-testid="day-note-editor"></div>
    </section>
  </div>
</div>

{#if editingEvent}
  <EventPopover
    initial={editingEvent === "new" ? null : editingEvent}
    defaultDate={date}
    onclose={() => (editingEvent = null)}
    onsaved={onrefresh}
  />
{/if}

<style>
  .day-workspace { container-type: inline-size; display: flex; flex-direction: column; flex: 1; min-height: 0; background: var(--bg); }
  .day-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  .day-nav { display: flex; align-items: center; gap: 6px; position: relative; }
  .nav-btn { width: 28px; height: 28px; display: grid; place-items: center; border-radius: var(--radius-sm); border: 1px solid var(--border); color: var(--text-muted); }
  .nav-btn:hover, .today-btn:hover, .ghost-btn:hover, .schedule-toggle:hover { background: var(--bg-hover); color: var(--text); }
  .today-btn, .ghost-btn, .schedule-toggle { padding: 4px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border); font-size: 12px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 5px; }
  .today-btn.is-today { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
  .picker-wrap { position: relative; }
  .day-title-btn { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 600; color: var(--heading); padding: 4px 8px; border-radius: var(--radius-sm); }
  .day-title-btn:hover { background: var(--bg-hover); }
  .mini-pop { position: absolute; top: calc(100% + 6px); left: 0; z-index: 40; width: 236px; padding: 10px; border-radius: var(--radius-lg); background: var(--bg-elev); border: 1px solid var(--border-strong); box-shadow: var(--shadow-pop); }
  .mini-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-size: 12px; font-weight: 600; color: var(--heading); }
  .mini-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; text-align: center; }
  .mini-dow { font-size: 10px; color: var(--text-faint); padding: 2px 0; }
  .mini-cell { height: 26px; border-radius: 5px; font-size: 11.5px; color: var(--text); font-variant-numeric: tabular-nums; }
  .mini-cell.out { color: var(--text-faint); opacity: .5; }
  .mini-cell:hover { background: var(--bg-hover); }
  .mini-cell.today { border: 1px solid var(--accent); color: var(--accent); }
  .mini-cell.sel { background: var(--accent); color: var(--accent-fg); font-weight: 600; }
  .day-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .new-ev-btn { display: inline-flex; align-items: center; gap: 5px; padding: 5px 11px; border-radius: var(--radius-sm); background: var(--accent); color: var(--accent-fg); font-size: 12px; font-weight: 600; }
  .workspace-body { flex: 1; min-height: 0; display: grid; grid-template-columns: 300px minmax(0, 1fr); }
  .workspace-body.no-sched { grid-template-columns: minmax(0, 1fr); }
  .sched-col { border-right: 1px solid var(--border); padding: 14px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; background: var(--bg-side); }
  .sched-head { display: flex; align-items: center; justify-content: space-between; }
  .sec-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--text-faint); }
  .count { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: var(--bg-hover); color: var(--text-muted); }
  .empty-sched { margin: 8px 0; font-size: 12.5px; color: var(--text-faint); }
  .sched-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
  .ev-item { display: flex; align-items: center; gap: 8px; padding: 7px 9px; border-radius: var(--radius); background: var(--card-bg); border: 1px solid var(--border); }
  .ev-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  .ev-main { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; text-align: left; }
  .ev-time { font-size: 11px; color: var(--text-faint); font-variant-numeric: tabular-nums; }
  .ev-title { font-size: 13px; font-weight: 500; color: var(--heading); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  .ev-title.done { text-decoration: line-through; opacity: .6; }
  .ev-loc { font-size: 11px; color: var(--text-muted); }
  .join-link { padding: 3px 8px; border-radius: var(--radius-sm); background: var(--accent); color: var(--accent-fg); font-size: 11px; font-weight: 600; text-decoration: none; flex: none; }
  .note-col { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
  .note-status { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 18px; border-bottom: 1px solid var(--border); font-size: 11.5px; color: var(--text-faint); }
  .note-path { font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .draft-pill { padding: 1px 8px; border-radius: 999px; background: var(--bg-alt); color: var(--text-muted); flex: none; }
  .draft-pill.saved { color: var(--green); background: var(--green-soft); }
  .editor-host { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 18px 24px; }
  .loading, .err { padding: 14px 18px; margin: 0; font-size: 12.5px; color: var(--text-faint); }
  .err { color: var(--red); }

  @container (max-width: 759px) {
    .workspace-body { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
    .sched-col { border-right: 0; border-bottom: 1px solid var(--border); max-height: 220px; }
  }
</style>
