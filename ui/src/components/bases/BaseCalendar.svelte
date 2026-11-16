<script lang="ts">
  // A Bases calendar view: notes placed on a 7-column Mon–Sun month grid by a selectable date property
  // (`date`, `due`, `updated`, `file.mtime`, …). Dragging a chip onto another day rewrites its frontmatter date.
  import Icon from "../Icon.svelte";
  import { openPath } from "../../lib/dock";
  import { shownName } from "../../lib/paths";
  import { context, setHover } from "../../lib/context.svelte";
  import { classifyStatus } from "../../lib/base-format";
  import type { BaseView } from "../../lib/gen/BaseView";
  import type { BaseColumn } from "../../lib/gen/BaseColumn";
  import type { BaseRow } from "../../lib/gen/BaseRow";
  import type { BaseCell } from "../../lib/gen/BaseCell";

  let { view, onwrite, onnew }: {
    view: BaseView;
    onwrite?: (path: string, key: string, value: unknown) => void;
    onnew?: () => void;
  } = $props();

  const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
  const PIGMENTS = ["var(--accent)", "var(--green)", "var(--yellow)", "var(--orange)", "var(--purple)", "var(--cyan)", "var(--red)"];
  const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})/;
  const TIME_SUFFIX_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)/;
  const DATE_COL_RE = /date|due|updated|start|end|created|mtime|ctime/i;
  const PRIO = ["date", "due", "updated", "start", "created", "end"];

  function fmtYmd(y: number, m0: number, d: number): string {
    return `${String(y).padStart(4, "0")}-${String(m0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  function cellYmd(cell: BaseCell | undefined): string | null {
    if (!cell || cell.t === "null") return null;
    if (cell.t === "list") return cell.items.length ? cellYmd(cell.items[0]) : null;
    if (cell.t === "num" && cell.value > 1e11 && cell.value < 1e14) {
      const dt = new Date(cell.value);
      return fmtYmd(dt.getFullYear(), dt.getMonth(), dt.getDate());
    }
    const raw = cell.t === "date" ? cell.text.trim() : cell.t === "text" ? cell.value.trim() : "";
    const m = ISO_RE.exec(raw);
    if (!m) return null;
    const mo = +m[2], da = +m[3];
    return mo >= 1 && mo <= 12 && da >= 1 && da <= 31 ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }

  function withPreservedTime(cell: BaseCell | undefined, ymd: string): string {
    if (!cell || cell.t === "null") return ymd;
    if (cell.t === "list") return cell.items.length ? withPreservedTime(cell.items[0], ymd) : ymd;
    const raw = cell.t === "date" ? cell.text.trim() : cell.t === "text" ? cell.value.trim() : "";
    const m = TIME_SUFFIX_RE.exec(raw);
    return m ? `${ymd}${m[1]}` : ymd;
  }

  const hoverIn = (p: string) => setHover({ path: p, source: "base" });
  const hoverOut = () => { if (context.hover?.source === "base") setHover(null); };
  const lit = (p: string) => context.hover?.path === p && context.hover.source !== "base";

  const nameAt = $derived(view.columns.findIndex((c) => c.id === "file.name"));
  const statusAt = $derived(view.columns.findIndex((c) => c.format === "status" || /(?:^|\.)(?:status|state|stage)$/i.test(c.id)));
  const rowTitle = (r: BaseRow) => (nameAt >= 0 && r.cells[nameAt]?.t === "link" ? r.cells[nameAt].text : shownName(r.path));
  const pigmentFor = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return PIGMENTS[Math.abs(h) % PIGMENTS.length];
  };
  const toneColor = (s: string): string | null => {
    const { tone } = classifyStatus(s);
    return tone === "done" ? "var(--green)" : tone === "progress" ? "var(--accent)" : tone === "blocked" ? "var(--red)" : tone === "review" ? "var(--purple)" : null;
  };
  function rowDot(r: BaseRow): { color: string; label: string } | null {
    if (r.group) return { color: toneColor(r.group) ?? pigmentFor(r.group), label: r.group };
    const sc = statusAt >= 0 ? r.cells[statusAt] : undefined;
    if (sc?.t === "text" && sc.value.trim()) return { color: toneColor(sc.value) ?? pigmentFor(sc.value), label: sc.value.trim() };
    return null;
  }

  const dateColumns = $derived(
    view.columns
      .map((col, idx) => ({ col, idx }))
      .filter(({ col, idx }) => DATE_COL_RE.test(col.id) || view.rows.some((r) => cellYmd(r.cells[idx]) !== null)),
  );

  function colRank(col: BaseColumn, idx: number): number {
    const bare = col.id.replace(/^note\./, "").toLowerCase();
    const isFile = col.id.startsWith("file.");
    const hasData = view.rows.some((r) => cellYmd(r.cells[idx]) !== null);
    const pIdx = PRIO.findIndex((p) => bare === p || bare.includes(p));
    const pScore = pIdx >= 0 ? pIdx : 20;
    if (!isFile && hasData) return pScore;
    if (isFile && hasData) return 40 + pScore;
    if (!isFile) return 70 + pScore;
    return 100 + pScore;
  }

  let chosenColId = $state("");
  const activeEntry = $derived(
    dateColumns.find((d) => d.col.id === chosenColId) ??
      [...dateColumns].sort((a, b) => colRank(a.col, a.idx) - colRank(b.col, b.idx))[0] ??
      null,
  );
  const canWrite = $derived(Boolean(onwrite && activeEntry?.col.key));

  const now = new Date();
  const todayYmd = fmtYmd(now.getFullYear(), now.getMonth(), now.getDate());
  const todayYm = todayYmd.slice(0, 7);

  let curYear = $state(now.getFullYear());
  let curMonth0 = $state(now.getMonth());
  let manualNav = $state(false);
  let lastSeedKey = "";
  let showUndated = $state(false);
  let draggingPath = $state<string | null>(null);
  let overDay = $state<string | null>(null);
  let overUnschedule = $state(false);
  let ptrDrag = $state<{ path: string; title: string; fromScheduled: boolean; startX: number; startY: number; x: number; y: number; active: boolean } | null>(null);
  let suppressClick = false;

  const buckets = $derived.by(() => {
    const byDay = new Map<string, BaseRow[]>();
    const undated: BaseRow[] = [];
    const allDates: string[] = [];
    const idx = activeEntry?.idx ?? -1;
    for (const r of view.rows) {
      const ymd = idx >= 0 ? cellYmd(r.cells[idx]) : null;
      if (!ymd) { undated.push(r); continue; }
      allDates.push(ymd);
      let list = byDay.get(ymd);
      if (!list) { list = []; byDay.set(ymd, list); }
      list.push(r);
    }
    return { byDay, undated, allDates };
  });

  $effect(() => {
    const seedKey = `${view.name}\u0000${activeEntry?.col.id ?? ""}`;
    if (seedKey !== lastSeedKey) {
      lastSeedKey = seedKey;
      manualNav = false;
    }
    if (manualNav) return;
    const dates = buckets.allDates;
    if (!dates.length || dates.some((d) => d.startsWith(todayYm))) {
      curYear = now.getFullYear();
      curMonth0 = now.getMonth();
    } else {
      const latest = dates.reduce((a, b) => (a > b ? a : b));
      curYear = +latest.slice(0, 4);
      curMonth0 = +latest.slice(5, 7) - 1;
    }
  });

  const monthLabel = $derived(new Date(curYear, curMonth0, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }));
  const isCurrentMonth = $derived(curYear === now.getFullYear() && curMonth0 === now.getMonth());

  function stepMonth(delta: number): void {
    const d = new Date(curYear, curMonth0 + delta, 1);
    curYear = d.getFullYear();
    curMonth0 = d.getMonth();
    manualNav = true;
  }

  function goToday(): void {
    curYear = now.getFullYear();
    curMonth0 = now.getMonth();
    manualNav = true;
  }

  const cells = $derived.by(() => {
    const firstDow = (new Date(curYear, curMonth0, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(curYear, curMonth0 + 1, 0).getDate();
    const count = Math.max(35, Math.ceil((firstDow + daysInMonth) / 7) * 7);
    const out: { ymd: string; day: number; inMonth: boolean; isToday: boolean; weekend: boolean; rows: BaseRow[] }[] = [];
    for (let i = 0; i < count; i++) {
      const dt = new Date(curYear, curMonth0, 1 - firstDow + i);
      const ymd = fmtYmd(dt.getFullYear(), dt.getMonth(), dt.getDate());
      out.push({
        ymd,
        day: dt.getDate(),
        inMonth: dt.getMonth() === curMonth0 && dt.getFullYear() === curYear,
        isToday: ymd === todayYmd,
        weekend: i % 7 >= 5,
        rows: buckets.byDay.get(ymd) ?? [],
      });
    }
    return out;
  });

  function commitDay(path: string, ymd: string): void {
    if (!path || !canWrite || !activeEntry?.col.key) return;
    const r = view.rows.find((row) => row.path === path);
    const cell = r?.cells[activeEntry.idx];
    if (cellYmd(cell) === ymd) return;
    onwrite?.(path, activeEntry.col.key, withPreservedTime(cell, ymd));
  }

  function commitUnschedule(path: string): void {
    if (!path || !canWrite || !activeEntry?.col.key) return;
    const r = view.rows.find((row) => row.path === path);
    const cell = r?.cells[activeEntry.idx];
    if (!cell || cell.t === "null" || !cellYmd(cell)) return;
    onwrite?.(path, activeEntry.col.key, null);
  }

  function detachPtr(): void {
    window.removeEventListener("pointermove", onPtrMove);
    window.removeEventListener("pointerup", onPtrUp);
    window.removeEventListener("pointercancel", resetDrag);
    window.removeEventListener("keydown", onPtrKey);
  }

  function resetDrag(): void {
    detachPtr();
    ptrDrag = null;
    draggingPath = overDay = null;
    overUnschedule = false;
  }

  function onPtrMove(ev: PointerEvent): void {
    if (!ptrDrag) return;
    if (!ptrDrag.active) {
      if (Math.hypot(ev.clientX - ptrDrag.startX, ev.clientY - ptrDrag.startY) <= 4) return;
      ptrDrag.active = true;
      draggingPath = ptrDrag.path;
    }
    ptrDrag.x = ev.clientX;
    ptrDrag.y = ev.clientY;
    const hit = document.elementFromPoint(ev.clientX, ev.clientY);
    const dayEl = hit?.closest<HTMLElement>(".day-cell[data-date]");
    const unschEl = hit?.closest<HTMLElement>("[data-unschedule='true'], [data-unschedule-pill='true']");
    overDay = dayEl?.dataset.date ?? null;
    overUnschedule = !overDay && Boolean(unschEl) && ptrDrag.fromScheduled;
  }

  function onPtrUp(ev: PointerEvent): void {
    const cur = ptrDrag;
    if (!cur) { resetDrag(); return; }
    if (!cur.active) { resetDrag(); return; }
    const hit = document.elementFromPoint(ev.clientX, ev.clientY);
    const targetDay = hit?.closest<HTMLElement>(".day-cell[data-date]")?.dataset.date ?? overDay;
    const targetUnsch = Boolean(hit?.closest<HTMLElement>("[data-unschedule='true'], [data-unschedule-pill='true']")) || overUnschedule;
    suppressClick = true;
    requestAnimationFrame(() => { suppressClick = false; });
    resetDrag();
    if (targetDay) commitDay(cur.path, targetDay);
    else if (targetUnsch && cur.fromScheduled) commitUnschedule(cur.path);
  }

  function onPtrKey(ev: KeyboardEvent): void {
    if (ev.key === "Escape" && ptrDrag) { ev.preventDefault(); resetDrag(); }
  }

  function startChipPtr(e: PointerEvent, r: BaseRow, fromScheduled: boolean): void {
    if (!canWrite || e.button !== 0) return;
    detachPtr();
    ptrDrag = { path: r.path, title: rowTitle(r), fromScheduled, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, active: false };
    window.addEventListener("pointermove", onPtrMove);
    window.addEventListener("pointerup", onPtrUp);
    window.addEventListener("pointercancel", resetDrag);
    window.addEventListener("keydown", onPtrKey);
  }

  $effect(() => () => detachPtr());
</script>

<div class="cal-wrap">
  <div class="cal-bar">
    <div class="nav-group">
      <button type="button" class="nav-btn" onclick={() => stepMonth(-1)} aria-label="Previous month" title="Previous month">‹</button>
      <strong class="month-title">{monthLabel}</strong>
      <button type="button" class="nav-btn" onclick={() => stepMonth(1)} aria-label="Next month" title="Next month">›</button>
      <button type="button" class="today-btn" class:current={isCurrentMonth} onclick={goToday} title="Jump to current month">Today</button>
    </div>

    <div class="ctrl-group">
      {#if dateColumns.length > 0}
        <label class="prop-pill" title={canWrite ? "Date property (drag chips across days to reschedule)" : "Date property (read-only computed column)"}>
          <span class="lbl">Date:</span>
          <select value={activeEntry?.col.id ?? ""} onchange={(e) => { chosenColId = (e.currentTarget as HTMLSelectElement).value; }}>
            {#each dateColumns as d (d.col.id)}
              <option value={d.col.id}>{d.col.label}</option>
            {/each}
          </select>
        </label>
      {/if}
      {#if buckets.undated.length > 0 || canWrite}
        <button type="button" class="undated-pill" class:open={showUndated} class:over={overUnschedule && !showUndated}
          data-unschedule-pill="true"
          onclick={() => (showUndated = !showUndated)}
          ondragover={(e) => { if (canWrite && (draggingPath || e.dataTransfer)) { e.preventDefault(); overUnschedule = true; overDay = null; } }}
          ondragleave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) overUnschedule = false; }}
          ondrop={(e) => { e.preventDefault(); const p = draggingPath || e.dataTransfer?.getData("text/plain") || ""; resetDrag(); commitUnschedule(p); }}
          title="Toggle notes without a valid date in this column (or drop a scheduled chip here to clear its date)">
          Unscheduled ({buckets.undated.length})
        </button>
      {/if}
      {#if onnew}
        <button type="button" class="add-mini" onclick={onnew} title="New note in this view" aria-label="New note"><Icon name="plus" size={12} /></button>
      {/if}
    </div>
  </div>

  {#if !dateColumns.length}
    <p class="empty">No date columns found in this view. Add a <code>date</code> or <code>due</code> property to schedule notes.</p>
  {:else}
    <div class="cal-scroll">
      <div class="dow-row" role="row">
        {#each WEEKDAYS as wd (wd)}
          <div class="dow" role="columnheader">{wd}</div>
        {/each}
      </div>

      <div class="month-grid" style:grid-template-rows="repeat({cells.length / 7}, minmax(82px, 1fr))">
        {#each cells as c (c.ymd)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="day-cell" class:outside={!c.inMonth} class:today={c.isToday} class:weekend={c.weekend} class:over={overDay === c.ymd}
            data-date={c.ymd}
            ondragover={(e) => { if (canWrite && (draggingPath || e.dataTransfer)) { e.preventDefault(); overDay = c.ymd; overUnschedule = false; } }}
            ondragleave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node) && overDay === c.ymd) overDay = null; }}
            ondrop={(e) => { e.preventDefault(); const p = draggingPath || e.dataTransfer?.getData("text/plain") || ""; resetDrag(); commitDay(p, c.ymd); }}>
            <div class="day-head">
              <span class="day-num" class:today-badge={c.isToday}>{c.day}</span>
              {#if c.rows.length > 2}<span class="day-cnt">{c.rows.length}</span>{/if}
            </div>
            <div class="day-items">
              {#each c.rows as r (r.path)}
                {@const dot = rowDot(r)}
                <div role="button" tabindex="0" class="chip" class:lit={lit(r.path)} class:draggable={canWrite} class:dragging={draggingPath === r.path}
                  draggable={canWrite}
                  title="{rowTitle(r)} — {c.ymd}{r.group ? ` · ${r.group}` : ''} ({r.path})"
                  onmouseenter={() => hoverIn(r.path)} onmouseleave={hoverOut}
                  onpointerdown={(e) => startChipPtr(e, r, true)}
                  onclick={() => { if (!suppressClick) openPath(r.path); }}
                  onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPath(r.path); } }}
                  ondragstart={(e) => { if (ptrDrag) { e.preventDefault(); return; } draggingPath = r.path; e.dataTransfer?.setData("text/plain", r.path); }}
                  ondragend={resetDrag}>
                  {#if dot}<span class="dot" style:background={dot.color} title={dot.label}></span>{/if}
                  <span class="chip-title">{rowTitle(r)}</span>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>

      {#if (showUndated && (buckets.undated.length > 0 || canWrite)) || (canWrite && ptrDrag?.active && ptrDrag.fromScheduled)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <section class="undated-tray" class:over={overUnschedule} data-unschedule="true" aria-label="Unscheduled notes"
          ondragover={(e) => { if (canWrite && (draggingPath || e.dataTransfer)) { e.preventDefault(); overUnschedule = true; overDay = null; } }}
          ondragleave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) overUnschedule = false; }}
          ondrop={(e) => { e.preventDefault(); const p = draggingPath || e.dataTransfer?.getData("text/plain") || ""; resetDrag(); commitUnschedule(p); }}>
          <header class="tray-head">
            <span>Unscheduled ({buckets.undated.length})</span>
            {#if canWrite}
              <span class="tray-hint">{ptrDrag?.active && ptrDrag.fromScheduled ? `Drop here to clear ${activeEntry?.col.key}` : `Drag onto any day above to set ${activeEntry?.col.key}, or drop a scheduled chip here to clear it`}</span>
            {/if}
          </header>
          {#if buckets.undated.length > 0}
            <div class="tray-chips">
              {#each buckets.undated as r (r.path)}
                {@const dot = rowDot(r)}
                <div role="button" tabindex="0" class="chip tray-chip" class:lit={lit(r.path)} class:draggable={canWrite} class:dragging={draggingPath === r.path}
                  draggable={canWrite} title={r.path}
                  onmouseenter={() => hoverIn(r.path)} onmouseleave={hoverOut}
                  onpointerdown={(e) => startChipPtr(e, r, false)}
                  onclick={() => { if (!suppressClick) openPath(r.path); }}
                  onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPath(r.path); } }}
                  ondragstart={(e) => { if (ptrDrag) { e.preventDefault(); return; } draggingPath = r.path; e.dataTransfer?.setData("text/plain", r.path); }}
                  ondragend={resetDrag}>
                  {#if dot}<span class="dot" style:background={dot.color} title={dot.label}></span>{/if}
                  <span class="chip-title">{rowTitle(r)}</span>
                </div>
              {/each}
            </div>
          {/if}
        </section>
      {/if}
    </div>
  {/if}

  {#if ptrDrag?.active}
    <div class="drag-badge" style:left="{ptrDrag.x + 12}px" style:top="{ptrDrag.y + 12}px" aria-hidden="true">
      {ptrDrag.title}{overDay ? ` → ${overDay}` : overUnschedule ? " → Unscheduled" : ""}
    </div>
  {/if}
</div>

<style>
  .cal-wrap { display: flex; flex-direction: column; min-height: 0; flex: 1; background: var(--bg); }
  .cal-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; padding: 6px 10px; border-bottom: 1px solid var(--border); background: var(--bg-alt); }
  .nav-group, .ctrl-group { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .nav-btn { width: 24px; height: 24px; display: grid; place-items: center; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg); color: var(--text-muted); font-size: 15px; line-height: 1; cursor: pointer; }
  .nav-btn:hover { background: var(--bg-hover); color: var(--text); border-color: var(--border-strong); }
  .month-title { min-width: 132px; text-align: center; font-weight: 600; color: var(--heading, var(--text)); font-variant-numeric: tabular-nums; }
  .today-btn, .undated-pill { height: 24px; padding: 0 9px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg); color: var(--text-muted); font: inherit; font-size: .9em; cursor: pointer; }
  .today-btn:hover, .undated-pill:hover { background: var(--bg-hover); color: var(--text); border-color: var(--border-strong); }
  .today-btn.current { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 38%, var(--border)); background: var(--accent-soft); }
  .undated-pill.open, .undated-pill.over { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }

  .prop-pill { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 6px 0 8px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg); font-size: .9em; }
  .prop-pill .lbl { color: var(--text-faint); }
  .prop-pill select { border: 0; background: transparent; color: var(--text); font: inherit; font-weight: 500; outline: none; cursor: pointer; padding-right: 2px; }
  .add-mini { width: 24px; height: 24px; display: grid; place-items: center; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg); color: var(--text-muted); cursor: pointer; }
  .add-mini:hover { background: var(--bg-hover); color: var(--text); }

  .cal-scroll { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: auto; }
  .dow-row { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border-bottom: 1px solid var(--border); background: var(--bg-alt); position: sticky; top: 0; z-index: 2; }
  .dow { padding: 5px 8px; font-size: .82em; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--text-faint); text-align: right; }

  .month-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); flex: 1; background: var(--border); gap: 1px; }
  .day-cell { background: var(--bg); padding: 4px 5px 5px; display: flex; flex-direction: column; gap: 3px; min-width: 0; min-height: 78px; transition: background 90ms ease; }
  .day-cell.weekend { background: color-mix(in srgb, var(--bg-alt) 45%, var(--bg)); }
  .day-cell.outside { background: var(--bg-alt); }
  .day-cell.outside .day-num { color: var(--text-faint); opacity: .65; }
  .day-cell.today { background: color-mix(in srgb, var(--accent-soft) 40%, var(--bg)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent); }
  .day-cell.over { background: var(--accent-soft); box-shadow: inset 0 0 0 1.5px var(--accent); }

  .day-head { display: flex; align-items: center; justify-content: space-between; gap: 4px; padding: 0 2px; }
  .day-num { font-size: .86em; font-variant-numeric: tabular-nums; color: var(--text-muted); font-weight: 500; margin-left: auto; line-height: 20px; }
  .day-num.today-badge { background: var(--accent); color: var(--accent-fg, #fff); border-radius: 999px; padding: 0 6px; font-weight: 600; }
  .day-cnt { font-size: .75em; color: var(--text-faint); font-variant-numeric: tabular-nums; order: -1; }

  .day-items { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .chip { display: flex; align-items: center; gap: 5px; padding: 2px 6px; border-radius: 4px; background: var(--bg-elev); border: 1px solid var(--border); color: var(--heading, var(--text)); font-size: .86em; line-height: 1.35; cursor: pointer; min-width: 0; user-select: none; }
  .chip.draggable { cursor: grab; touch-action: none; }
  .chip.dragging { opacity: .45; border-style: dashed; cursor: grabbing; }
  .chip:hover { border-color: var(--border-strong); background: var(--bg-hover); }
  .chip:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }
  .chip.lit { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
  .chip-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; font-weight: 500; }

  .undated-tray { border-top: 1px solid var(--border); padding: 8px 10px 10px; background: var(--bg-alt); transition: background 90ms ease; }
  .undated-tray.over { background: var(--accent-soft); box-shadow: inset 0 0 0 1.5px var(--accent); }
  .tray-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; font-size: .86em; font-weight: 600; color: var(--text-muted); }
  .tray-hint { font-weight: 400; color: var(--text-faint); }
  .tray-chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .tray-chip { max-width: 220px; }
  .drag-badge { position: fixed; z-index: 900; pointer-events: none; padding: 3px 9px; border-radius: 999px; background: var(--bg-elev); border: 1.5px solid var(--accent); color: var(--heading, var(--text)); font-size: .82em; font-weight: 600; font-variant-numeric: tabular-nums; box-shadow: var(--shadow-sm); white-space: nowrap; max-width: 320px; overflow: hidden; text-overflow: ellipsis; }
  .empty { color: var(--text-faint); padding: 14px; margin: 0; }
</style>
