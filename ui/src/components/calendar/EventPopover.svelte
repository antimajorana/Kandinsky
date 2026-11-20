<script lang="ts">
  // Notion-style inline event creation & quick-edit popover (with 1-click "Join meeting", recurrence, [[wikilinks]], & "Open as event page").
  import Icon from "../Icon.svelte";
  import { api } from "../../lib/api";
  import { openPath } from "../../lib/dock";
  import { toast } from "../../lib/state.svelte";
  import { errText } from "../../lib/text";
  import type { CalendarEvent, CalendarEventUpsert, CalendarRecurrence } from "../../lib/types";
  import { EVENT_COLORS, isVideoMeetingUrl } from "./calendar-dates";
  import { confirmMoveSeries } from "./series";

  export type AnchorRect = { top: number; left: number; bottom: number; right: number };

  let {
    initial,
    defaultDate,
    anchorRect,
    onclose,
    onsaved,
  }: {
    initial?: CalendarEvent | null;
    defaultDate: string;
    anchorRect?: AnchorRect | null;
    onclose: () => void;
    onsaved: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let title = $state(initial?.title ?? "");
  // svelte-ignore state_referenced_locally
  let date = $state(initial?.date ?? defaultDate);
  // svelte-ignore state_referenced_locally
  let endDate = $state(initial?.end_date && initial.end_date !== initial.date ? initial.end_date : "");
  // svelte-ignore state_referenced_locally
  let allDay = $state(initial ? initial.all_day : false);
  // svelte-ignore state_referenced_locally
  let start = $state(initial?.start ?? "09:00");
  // svelte-ignore state_referenced_locally
  let end = $state(initial?.end ?? "10:00");
  // svelte-ignore state_referenced_locally
  let color = $state(initial?.color || "blue");
  // svelte-ignore state_referenced_locally
  let location = $state(initial?.location ?? "");
  // svelte-ignore state_referenced_locally
  let repeat = $state<CalendarRecurrence>(initial?.repeat ?? "none");
  // svelte-ignore state_referenced_locally
  let linksText = $state((initial?.links ?? []).join(", "));
  // svelte-ignore state_referenced_locally
  let storage = $state<"inline" | "page">(initial?.source === "event_page" ? "page" : "inline");
  let notes = $state("");
  let busy = $state(false);
  let error = $state("");
  let cardEl = $state<HTMLDivElement>();
  let winW = $state(typeof window !== "undefined" ? window.innerWidth : 1280);
  let winH = $state(typeof window !== "undefined" ? window.innerHeight : 800);

  const canPromote = $derived(
    Boolean(initial?.id && (initial.source === "daily_frontmatter" || initial.source === "daily_schedule")),
  );
  const canDelete = $derived(
    Boolean(initial?.editable && initial.source !== "task" && initial.source !== "base"),
  );
  const dateOnlySource = $derived(initial?.source === "task" || initial?.source === "base");
  const isEventPage = $derived(initial?.source === "event_page" && !!initial.path);
  const joinUrl = $derived(isVideoMeetingUrl(location) ? location.trim() : null);
  // one occurrence of a stored repeating event: an edit applies to the whole series (there are no exceptions)
  const inSeries = $derived(!!initial?.id && initial.repeat !== "none");

  const isAnchored = $derived(Boolean(anchorRect) && winW >= 640);

  const anchoredStyle = $derived.by(() => {
    if (!anchorRect || winW < 640) return "";
    const margin = 12;
    const popW = Math.min(440, winW - margin * 2);
    const estH = cardEl?.offsetHeight && cardEl.offsetHeight > 40 ? cardEl.offsetHeight : 430;

    // Prefer opening below the trigger aligned to its right edge or left edge; flip/slide inside viewport bounds.
    let left = anchorRect.left;
    if (left + popW > winW - margin) {
      left = Math.max(margin, anchorRect.right - popW);
    }
    left = Math.max(margin, Math.min(left, winW - popW - margin));

    let top = anchorRect.bottom + 8;
    if (top + estH > winH - margin) {
      const above = anchorRect.top - estH - 8;
      if (above >= margin) {
        top = above;
      } else {
        // Place beside the trigger if vertical space above and below is tight.
        const rightSide = anchorRect.right + 10;
        const leftSide = anchorRect.left - popW - 10;
        if (rightSide + popW <= winW - margin) left = rightSide;
        else if (leftSide >= margin) left = leftSide;
        top = Math.max(margin, Math.min(winH - estH - margin, anchorRect.top));
      }
    }
    return `left: ${Math.round(left)}px; top: ${Math.round(top)}px; width: ${Math.round(popW)}px;`;
  });

  function onWindowPointerDown(e: PointerEvent): void {
    const t = e.target as Node | null;
    if (!cardEl || !t) return;
    if (!cardEl.contains(t)) {
      onclose();
    }
  }

  function onWindowKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.stopPropagation();
      onclose();
    }
  }

  function parsedLinks(): string[] {
    return linksText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (/^\[\[.*\]\]$/.test(s) ? s : `[[${s}]]`));
  }

  async function save(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (!title.trim() || busy) return;
    if (inSeries && initial && date !== initial.date && !(await confirmMoveSeries(initial))) return;
    busy = true;
    error = "";
    try {
      const payload: CalendarEventUpsert = {
        // the occurrence id lets the core move the series start by as much as this day moved (not at all when only
        // the title or time changed), instead of restarting the series on the day it was opened from
        id: inSeries ? initial?.occurrence_id : initial?.id,
        storage,
        title: title.trim(),
        date,
        end_date: endDate.trim() || undefined,
        start: allDay ? undefined : start,
        end: allDay ? undefined : end,
        all_day: allDay,
        color,
        location: location.trim(),
        repeat,
        links: parsedLinks(),
        notes: !initial && storage === "page" && notes.trim() ? notes : undefined,
      };
      await api.upsertCalendarEvent(payload);
      onsaved();
      onclose();
    } catch (err) {
      error = errText(err);
    } finally {
      busy = false;
    }
  }

  async function remove(): Promise<void> {
    if (!initial?.id || busy) return;
    busy = true;
    try {
      await api.deleteCalendarEvent(initial.id);
      onsaved();
      onclose();
    } catch (err) {
      error = errText(err);
    } finally {
      busy = false;
    }
  }

  async function promote(): Promise<void> {
    if (!initial?.id || busy) return;
    busy = true;
    try {
      const res = await api.promoteCalendarEvent(initial.id);
      toast("Created event page", res.path);
      onsaved();
      onclose();
      openPath(res.path);
    } catch (err) {
      error = errText(err);
    } finally {
      busy = false;
    }
  }

  function joinMeeting(): void {
    if (!joinUrl) return;
    window.open(joinUrl, "_blank", "noopener,noreferrer");
  }
</script>

<svelte:window bind:innerWidth={winW} bind:innerHeight={winH} onpointerdown={onWindowPointerDown} onkeydown={onWindowKeydown} />

<div class="pop-layer" class:centered={!isAnchored} role="presentation">
  <div
    bind:this={cardEl}
    class="pop-card"
    class:anchored={isAnchored}
    style={anchoredStyle}
    role="dialog"
    tabindex="-1"
    aria-modal={!isAnchored}
    aria-label={initial ? "Edit event" : "New event"}
    onpointerdown={(e) => e.stopPropagation()}
  >
    <form class="pop-form" onsubmit={(e) => void save(e)}>
      <header class="card-head">
        <strong>{initial ? "Edit event" : "New event"}</strong>
        <div class="head-actions">
          {#if joinUrl}
            <button type="button" class="join-btn" onclick={joinMeeting}><Icon name="external-link" size={12} /> Join meeting</button>
          {/if}
          {#if isEventPage && initial?.path}
            <button type="button" class="link-btn" onclick={() => { openPath(initial.path!); onclose(); }}><Icon name="file-text" size={12} /> Open page</button>
          {:else if canPromote}
            <button type="button" class="link-btn" disabled={busy} onclick={() => void promote()}><Icon name="file-text" size={12} /> Open as event page</button>
          {/if}
          <button type="button" class="x-btn" aria-label="Close" onclick={onclose}><Icon name="close" size={14} /></button>
        </div>
      </header>

      <!-- svelte-ignore a11y_autofocus -->
      <input class="title-in" placeholder="Event title…" bind:value={title} required readonly={dateOnlySource} autofocus data-testid="cal-event-title" />

      <div class="grid-two">
        <label class="fld"><span>Date</span><input type="date" bind:value={date} required /></label>
        {#if !dateOnlySource}
          <label class="fld"><span>End date (optional)</span><input type="date" min={date} bind:value={endDate} /></label>
        {/if}
      </div>

      {#if !dateOnlySource}
        <div class="time-row">
          <label class="toggle"><input type="checkbox" bind:checked={allDay} /> <span>All day</span></label>
          {#if !allDay}
            <label class="hm"><span>From</span><input type="time" bind:value={start} /></label>
            <label class="hm"><span>To</span><input type="time" bind:value={end} /></label>
          {/if}
        </div>

        <div class="swatches" role="radiogroup" aria-label="Category color">
          {#each EVENT_COLORS as sw (sw.id)}
            <button type="button" class="swatch" class:active={color === sw.id} aria-label={sw.label} title={sw.label}
              style:background={sw.dot} onclick={() => (color = sw.id)}></button>
          {/each}
        </div>

        <div class="grid-two">
          <label class="fld"><span>Location or meeting link</span><input placeholder="Room 301 or https://meet…" bind:value={location} /></label>
          <label class="fld">
            <span>Repeat</span>
            <select bind:value={repeat}>
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </label>
        </div>

        <label class="fld"><span>Linked notes (comma-separated)</span><input placeholder="[[Project]], [[Paper]]" bind:value={linksText} /></label>
        {#if inSeries}
          <p class="readonly-hint" data-testid="cal-series-hint">Repeats {initial?.repeat}: changes apply to every occurrence, a new date moves the whole series, and “Does not repeat” keeps only its first occurrence.</p>
        {/if}
      {:else if initial?.path}
        <p class="readonly-hint">Scheduled date updates in {initial.path}. Open note to edit task/page details.</p>
      {/if}

      {#if !initial}
        <div class="storage-row">
          <span>Save to</span>
          <label><input type="radio" bind:group={storage} value="inline" /> Daily Note</label>
          <label><input type="radio" bind:group={storage} value="page" /> Standalone event page</label>
        </div>
        {#if storage === "page"}
          <textarea class="notes-in" rows="3" placeholder="Agenda or meeting notes…" bind:value={notes}></textarea>
        {/if}
      {/if}

      {#if error}<p class="err">{error}</p>{/if}

      <footer class="card-foot">
        {#if canDelete}
          <button type="button" class="danger" disabled={busy} onclick={() => void remove()}>{inSeries ? "Delete series" : "Delete"}</button>
        {:else if dateOnlySource && initial?.path}
          <button type="button" class="link-btn" onclick={() => { openPath(initial.path!, initial.line ?? undefined); onclose(); }}>Open note</button>
        {:else}<span></span>{/if}
        <div class="foot-right">
          <button type="button" class="ghost" onclick={onclose}>Cancel</button>
          <button type="submit" class="primary" disabled={busy || !title.trim()} data-testid="cal-event-save">{busy ? "Saving…" : "Save"}</button>
        </div>
      </footer>
    </form>
  </div>
</div>

<style>
  .pop-layer { position: fixed; inset: 0; z-index: 90; pointer-events: none; }
  .pop-layer.centered { display: grid; place-items: center; padding: 16px; pointer-events: auto; }
  .pop-card { pointer-events: auto; width: min(440px, calc(100vw - 24px)); max-height: calc(100vh - 24px); overflow-y: auto; background: var(--bg-elev); border: 1px solid var(--border-strong); border-radius: var(--radius-xl); box-shadow: var(--shadow-pop); padding: 16px 18px; color: var(--text); }
  .pop-card.anchored { position: fixed; }
  .pop-form { display: flex; flex-direction: column; gap: 12px; }
  .card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .head-actions { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .title-in { width: 100%; font-size: 16px; font-weight: 600; padding: 7px 10px; border-radius: var(--radius); border: 1px solid var(--border-strong); background: var(--bg); color: var(--heading); }
  .title-in:focus, .fld input:focus, .fld select:focus, .hm input:focus, .notes-in:focus { outline: none; border-color: var(--accent); }
  .grid-two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .fld { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-muted); }
  .fld input, .fld select, .hm input, .notes-in { padding: 6px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-strong); background: var(--bg); color: var(--text); font: inherit; color-scheme: light dark; }
  .time-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 12.5px; }
  .toggle { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .toggle input { accent-color: var(--accent); }
  .hm { display: inline-flex; align-items: center; gap: 6px; color: var(--text-muted); }
  .swatches { display: flex; align-items: center; gap: 8px; }
  .swatch { width: 18px; height: 18px; border-radius: 50%; border: 2px solid transparent; transition: transform .1s; }
  .swatch.active { box-shadow: 0 0 0 2px var(--bg-elev), 0 0 0 3.5px var(--heading); transform: scale(1.1); }
  .storage-row { display: flex; align-items: center; gap: 12px; font-size: 12px; color: var(--text-muted); }
  .storage-row label { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; color: var(--text); }
  .join-btn, .link-btn { display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border-radius: var(--radius-sm); font-size: 12px; font-weight: 500; }
  .join-btn { background: var(--accent); color: var(--accent-fg); }
  .link-btn { border: 1px solid var(--border-strong); color: var(--text); }
  .link-btn:hover { background: var(--bg-hover); }
  .x-btn { width: 24px; height: 24px; display: grid; place-items: center; border-radius: var(--radius-sm); color: var(--text-muted); }
  .x-btn:hover { background: var(--bg-hover); color: var(--text); }
  .err { margin: 0; font-size: 12px; color: var(--red); }
  .readonly-hint { margin: 0; font-size: 12px; color: var(--text-muted); }
  .card-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 4px; }
  .foot-right { display: inline-flex; gap: 8px; }
  .primary { padding: 6px 14px; border-radius: var(--radius); background: var(--accent); color: var(--accent-fg); font-weight: 600; font-size: 13px; }
  .primary:disabled { opacity: .5; }
  .ghost { padding: 6px 12px; border-radius: var(--radius); border: 1px solid var(--border-strong); color: var(--text); font-size: 13px; }
  .danger { padding: 6px 12px; border-radius: var(--radius); color: var(--red); border: 1px solid color-mix(in srgb, var(--red) 35%, transparent); font-size: 13px; }
  .danger:hover { background: var(--red-soft); }
</style>
