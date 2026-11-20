<script module lang="ts">
  // unsaved drafts by note path, kept across workspaces: one closed during a conflict comes back with it next time.
  // `owner`: the workspace that kept or took it up; only it drops the draft, so another one's save never loses it
  const savedDrafts = new Map<string, { text: string; mtime: number | undefined; conflict?: boolean; owner: symbol }>();
</script>

<script lang="ts">
  // Unified Day Workspace: pairs chronological Day Events & Tasks with that day's lazy Daily Note editor (`@container` responsive).
  import { onDestroy, onMount } from "svelte";
  import Icon from "../Icon.svelte";
  import EventPopover, { type AnchorRect } from "./EventPopover.svelte";
  import { api, ApiError } from "../../lib/api";
  import { diff } from "../../lib/frontmatter-edit";
  import { openPath } from "../../lib/dock";
  import { createEditor, type KandinskyEditor } from "../../lib/editor/create";
  import { phone } from "../../lib/phone.svelte";
  import { app, toast } from "../../lib/state.svelte";
  import { errText } from "../../lib/text";
  import { onVaultChange } from "../../lib/vault";
  import type { CalendarEvent, DayLogInfo, WeekStart } from "../../lib/types";
  import { addDays, colorSpec, formatDayHeading, isVideoMeetingUrl, monthGridDays, parseIso, todayIso, weekdayNames } from "./calendar-dates";

  let {
    date,
    events = [],
    weekStart = "monday",
    ondatechange,
    onrefresh,
    ontoggle,
  }: {
    date: string;
    events: CalendarEvent[];
    weekStart?: WeekStart;
    ondatechange: (iso: string) => void;
    onrefresh: () => void;
    ontoggle?: (ev: CalendarEvent) => void | Promise<void>;
  } = $props();

  const today = todayIso();
  let dayInfo = $state<DayLogInfo | null>(null);
  let loadingNote = $state(false);
  let saving = $state(false);
  let dirty = $state(false);
  // the note changed on disk under unsaved edits (a 409, or created elsewhere): autosave stops until the user chooses
  let conflict = $state(false);
  let noteError = $state("");
  let scheduleOpen = $state(true);
  let pickerOpen = $state(false);
  let editingEvent = $state<CalendarEvent | null | "new">(null);
  let anchorRect = $state<AnchorRect | null>(null);
  let editorHost = $state<HTMLElement>();

  let editor: KandinskyEditor | null = null;
  let loadedFor = "";
  let dirtyPath = "";
  let dirtyMtime: number | undefined;
  let dirtySeq = 0;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let inFlightSave: Promise<void> | null = null;
  let draftSnapshot: { path: string; text: string; mtime: number | undefined } | null = null;
  const me = Symbol("day-workspace");
  const dropDraft = (path: string) => { if (savedDrafts.get(path)?.owner === me) savedDrafts.delete(path); };
  /** A draft this closing workspace could not save: kept for when the day is opened again (another's left alone). */
  const keepDraft = (path: string, text: string, mtime: number | undefined, conflicted: boolean) => {
    const held = savedDrafts.get(path);
    if (!held || held.owner === me) savedDrafts.set(path, { text, mtime, conflict: conflicted, owner: me });
  };

  // Mini-month picker state follows selected date when opened.
  let pickYear = $state(parseIso(today).getFullYear());
  let pickMonth0 = $state(parseIso(today).getMonth());

  const dayEvents = $derived(
    events
      .filter((e) => e.date <= date && e.end_date >= date)
      .sort((a, b) => Number(a.all_day) - Number(b.all_day) || (a.start ?? "").localeCompare(b.start ?? "") || a.title.localeCompare(b.title)),
  );

  async function flushSave(
    path = dirtyPath,
    text = editor?.view.state.doc.toString() ?? draftSnapshot?.text ?? "",
    keepalive = false,
  ): Promise<void> {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    if (!dirty || !path || conflict) return;
    if (keepalive) {
      const seqAtStart = dirtySeq;
      const mtimeAtStart = dirtyMtime;
      const live = () => dirtyPath === path && dirtySeq === seqAtStart;
      void api.putFile(path, text, mtimeAtStart, false, true, mtimeAtStart === undefined).then((r) => {
        if (r.written === false) {
          keepDraft(path, text, mtimeAtStart, true); // created elsewhere: the typed text comes back with a conflict
          if (live()) conflict = true; // its mtime is not adopted, or the next save would overwrite it
        } else if (live()) {
          dirtyMtime = r.mtime;
          dirty = false;
          if (draftSnapshot?.path === path) draftSnapshot = null;
          dropDraft(path);
        }
      }).catch((err) => {
        // not saved: the text is kept, a 409 as a conflict (another write is not overwritten when it comes back)
        const clash = err instanceof ApiError && err.status === 409;
        keepDraft(path, text, mtimeAtStart, clash);
        if (clash && live()) conflict = true;
      });
      return;
    }
    while (inFlightSave) {
      await inFlightSave;
    }
    if (!dirty || !path || conflict) return;
    const run = (async () => {
      while (dirty && !conflict) {
        const seqAtStart = dirtySeq;
        const savePath = dirtyPath || path;
        // the editor holds the note: it takes a template's or an automation's edits itself (apply_here), as the Editor pane
        const held = !!editor && loadedFor.endsWith(`:${savePath}`);
        const saveText = held && editor
          ? editor.view.state.doc.toString()
          : (draftSnapshot?.path === savePath ? draftSnapshot.text : text);
        const saveMtime = dirtyMtime;
        saving = true;
        try {
          const r = await api.putFile(savePath, saveText, saveMtime, held, false, saveMtime === undefined);
          if (r.written === false) {
            conflict = true;
            toast("Daily Note not saved", `${savePath} was created elsewhere: load it, or keep your version.`, "error");
            break;
          }
          dirtyMtime = r.mtime;
          dropDraft(savePath);
          if (draftSnapshot && draftSnapshot.path === savePath && dirtySeq === seqAtStart) {
            draftSnapshot = null;
          }
          if (dayInfo && dayInfo.path === savePath) {
            dayInfo = { ...dayInfo, exists: true, mtime: r.mtime, text: saveText };
          }
          if (dirtySeq === seqAtStart) dirty = false;
          if (held && r.template?.text !== undefined) await applyTemplate(savePath, r.template.template, r.template.added, lf(r.template.text), saveText, r.template.automation ?? false);
          onrefresh();
        } catch (err) {
          // the disk's mtime is not adopted here: that would let the next save silently overwrite the other change
          if (err instanceof ApiError && err.status === 409) conflict = true;
          else toast("Could not save Daily Note", errText(err), "error");
          break;
        } finally {
          saving = false;
        }
      }
    })();
    inFlightSave = run;
    try {
      await run;
    } finally {
      if (inFlightSave === run) inFlightSave = null;
    }
  }

  const lf = (t: string) => t.replace(/\r\n/g, "\n");

  /** A template's or automation's edit this save brought (apply_here), merged in as one edit of the editor's own, as the
   *  Editor pane does: the next save writes it on the mtime just adopted, so the rewrite is no conflict. */
  async function applyTemplate(path: string, name: string, added: string[], merged: string, base: string, automation = false): Promise<void> {
    const now = () => (editor && loadedFor.endsWith(`:${path}`) ? editor.view.state.doc.toString() : null);
    const cur = now();
    if (cur === null) return;
    // an automation's property edits are named "<rule> (<file>.base)" (core automations.rs), a template by its stem
    const auto = name === "" || /\.base\)$/.test(name);
    if (cur !== base) {
      // an automation's edit is already on disk, also when a template ran with it: merging the template again would drop it
      if (auto || automation) {
        const typed = diff(base, cur), edit = diff(base, merged);
        if (!typed || !edit) return;
        const shift = typed.insert.length - (typed.to - typed.from);
        const at = edit.to <= typed.from ? edit : edit.from >= typed.to ? { from: edit.from + shift, to: edit.to + shift, insert: edit.insert } : null;
        // overlapping what was typed: the conflict bar, else the loop's next save drops the edit already on disk
        if (!at) { conflict = true; return; }
        merged = cur.slice(0, at.from) + at.insert + cur.slice(at.to);
      } else {
        const again = await api.mergeTemplate(path, name, cur).catch(() => null);
        if (!again?.text || now() !== cur) return;
        merged = lf(again.text);
      }
      base = cur;
    }
    const change = diff(base, merged);
    if (!change || !editor) return;
    editor.view.dispatch({ changes: change, userEvent: "input.template" });
    const rule = name.match(/^(.+?) \(.+\.base\)$/)?.[1] ?? name;
    toast(!auto ? `Template “${name}” applied` : rule ? `Automation “${rule}” updated this note` : "An automation updated this note", `${auto ? "Set" : "Added"} ${added.join(", ")}`, "info");
  }

  /** Drops the unsaved edits and shows the note as it is on disk. */
  async function loadDiskVersion(): Promise<void> {
    if (dirtyPath) dropDraft(dirtyPath);
    dirty = false;
    conflict = false;
    draftSnapshot = null;
    loadedFor = "";
    await loadDay(date);
  }

  /** Writes the unsaved edits over what is on disk now, as the user chose. */
  async function keepMine(): Promise<void> {
    const path = dirtyPath;
    if (!path) return;
    try {
      dirtyMtime = (await api.file(path)).mtime;
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) { toast("Could not save Daily Note", errText(err), "error"); return; }
      dirtyMtime = undefined; // gone meanwhile: written as a new file
    }
    conflict = false;
    await flushSave(path);
  }

  function scheduleSave(path: string): void {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void flushSave(path); }, 450);
  }

  async function refreshCurrentDayMetadata(): Promise<void> {
    const targetDate = date;
    try {
      const info = await api.dayLog(targetDate);
      if (targetDate !== date) return;
      if (dirty || inFlightSave) {
        // changed on disk under unsaved edits: say so now rather than at the next save
        // (only a newer mtime: an answer sent before our own last save carries an older one)
        if (dirty && !inFlightSave && info.path === dirtyPath && info.exists && (dirtyMtime === undefined || (info.mtime ?? 0) > dirtyMtime)) conflict = true;
        return;
      }
      dayInfo = info;
      dirtyPath = info.path;
      dirtyMtime = info.mtime;
      if (editor && info.text !== editor.view.state.doc.toString()) {
        editor.setDoc(info.text);
      }
    } catch { /* silent background sync */ }
  }

  async function loadDay(targetDate: string): Promise<void> {
    if (dirty && dirtyPath) await flushSave();
    while (inFlightSave) await inFlightSave;
    if (dirty && dirtyPath) {
      const unsaved = editor?.view.state.doc.toString() ?? draftSnapshot?.text;
      if (unsaved !== undefined) {
        savedDrafts.set(dirtyPath, { text: unsaved, mtime: dirtyMtime, conflict, owner: me });
      }
      toast("Kept unsaved draft", `${dirtyPath} could not be saved yet.`, "error");
    }
    loadingNote = true;
    noteError = "";
    try {
      const info = await api.dayLog(targetDate);
      if (targetDate !== date) return;
      const pending = savedDrafts.get(info.path);
      if (pending) {
        pending.owner = me; // taken up here: this workspace's save or "Load disk version" now drops it
        dayInfo = { ...info, text: pending.text };
        dirty = true;
        dirtySeq += 1;
        draftSnapshot = { path: info.path, text: pending.text, mtime: pending.mtime };
        dirtyPath = info.path;
        // the draft keeps the mtime it was based on: a note written (or created) meanwhile is a conflict, not overwritten
        dirtyMtime = pending.mtime;
        conflict = !!pending.conflict || (pending.mtime === undefined ? info.exists : pending.mtime !== info.mtime);
        loadedFor = `${info.day}:${info.path}`;
        mountEditor(dayInfo);
      } else {
        dayInfo = info;
        dirty = false;
        conflict = false;
        draftSnapshot = null;
        dirtyPath = info.path;
        dirtyMtime = info.mtime;
        loadedFor = `${info.day}:${info.path}`;
        mountEditor(info);
      }
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
      vim: app.vimEnabled && !phone.on,
      caretEnd: true,
      onChange: (typed) => {
        if (!typed) return;
        dirty = true;
        dirtySeq += 1;
        draftSnapshot = {
          path: info.path,
          text: editor?.view.state.doc.toString() ?? info.text,
          mtime: dirtyMtime,
        };
        scheduleSave(info.path);
      },
      onSave: () => {
        dirty = true;
        dirtySeq += 1;
        draftSnapshot = {
          path: info.path,
          text: editor?.view.state.doc.toString() ?? info.text,
          mtime: dirtyMtime,
        };
        void flushSave(info.path);
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

  let offVault: (() => void) | undefined;
  const onBeforeUnload = () => {
    if (dirty && dirtyPath) {
      const text = editor?.view.state.doc.toString() ?? draftSnapshot?.text ?? "";
      void flushSave(dirtyPath, text, true);
    }
  };
  onMount(() => {
    window.addEventListener("beforeunload", onBeforeUnload);
    offVault = onVaultChange(() => {
      if (dayInfo) void refreshCurrentDayMetadata();
    });
  });

  onDestroy(() => {
    window.removeEventListener("beforeunload", onBeforeUnload);
    offVault?.();
    clearTimeout(saveTimer);
    if (dirty && dirtyPath) {
      const text = editor?.view.state.doc.toString() ?? draftSnapshot?.text ?? "";
      // a conflict is not saved over: its draft is kept for when this day is opened again
      if (conflict) savedDrafts.set(dirtyPath, { text, mtime: dirtyMtime, conflict: true, owner: me });
      else void flushSave(dirtyPath, text, true);
    }
    editor?.destroy();
    editor = null;
  });

  async function openInFullPane(): Promise<void> {
    if (!dayInfo) return;
    if (dirty) {
      await flushSave();
      while (inFlightSave) await inFlightSave;
      if (dirty) return;
    } else {
      while (inFlightSave) await inFlightSave;
      if (!dayInfo.exists) {
        const created = await api.ensureDayLog(date);
        dayInfo = created;
        dirtyMtime = created.mtime;
      }
    }
    openPath(dayInfo.path);
  }

  function rectOf(el: HTMLElement): AnchorRect {
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, bottom: r.bottom, right: r.right };
  }

  function openScheduleItem(ev: CalendarEvent, trigger?: HTMLElement): void {
    setEditing(ev, trigger ? rectOf(trigger) : null);
  }

  function setEditing(ev: CalendarEvent, rect: AnchorRect | null = null): void {
    if (ev.editable) {
      anchorRect = rect;
      editingEvent = ev;
    } else if (ev.path) {
      openPath(ev.path, ev.line ?? undefined);
    }
  }

  async function toggleDayTask(ev: CalendarEvent): Promise<void> {
    if (ev.completed) return;
    if (ontoggle) {
      await ontoggle(ev);
      await refreshCurrentDayMetadata();
      return;
    }
    if (!ev.path || !ev.line) return;
    try {
      await api.tickTask(ev.path, ev.line);
      onrefresh();
      await refreshCurrentDayMetadata();
    } catch (err) {
      toast("Could not complete task", errText(err), "error");
    }
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
      <button type="button" class="new-ev-btn" data-testid="day-new-event" onclick={(e) => { anchorRect = rectOf(e.currentTarget as HTMLElement); editingEvent = "new"; }}>
        <Icon name="plus" size={13} /> Add event
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
                {#if ev.source === "task"}
                  <input
                    type="checkbox"
                    class="kandinsky-check ev-tick"
                    checked={ev.completed}
                    disabled={ev.completed}
                    aria-label="Done: {ev.title}"
                    onchange={() => void toggleDayTask(ev)}
                  />
                {:else}
                  <span class="ev-dot" style:background={c.dot}></span>
                {/if}
                <button type="button" class="ev-main" onclick={(e) => openScheduleItem(ev, e.currentTarget as HTMLElement)}>
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
        <span class="note-path">{dayInfo?.path ?? `Daily Note · ${date}`}</span>
        <span class="draft-pill" class:saved={dayInfo?.exists && !dirty}>
          {#if saving}Saving…{:else if conflict}Not saved{:else if dirty}Unsaved changes{:else if dayInfo?.exists}Saved{:else}Draft — created when you start writing{/if}
        </span>
      </div>
      {#if conflict}
        <div class="conflict-bar" role="alert" data-testid="day-note-conflict">
          <span>The Daily Note changed on disk while you were editing.</span>
          <span class="conflict-actions">
            <button type="button" class="ghost-btn" onclick={() => void loadDiskVersion()}>Load disk version</button>
            <button type="button" class="new-ev-btn" onclick={() => void keepMine()}>Keep mine (overwrite)</button>
          </span>
        </div>
      {/if}
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
    {anchorRect}
    onclose={() => { editingEvent = null; anchorRect = null; }}
    onsaved={() => { onrefresh(); void refreshCurrentDayMetadata(); }}
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
  .ev-tick { flex: none; cursor: pointer; }
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
  .conflict-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 8px 18px; font-size: 12.5px; color: var(--text); background: color-mix(in srgb, var(--yellow) 14%, var(--bg)); border-bottom: 1px solid var(--border); }
  .conflict-actions { display: inline-flex; gap: 8px; }
  .editor-host { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 18px 24px; }
  .loading, .err { padding: 14px 18px; margin: 0; font-size: 12.5px; color: var(--text-faint); }
  .err { color: var(--red); }

  @container (max-width: 759px) {
    .workspace-body { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
    .sched-col { border-right: 0; border-bottom: 1px solid var(--border); max-height: 220px; }
  }
</style>
