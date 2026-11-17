<script lang="ts">
  // A Bases timeline view: chronological horizontal swimlanes with Date / End selectors, Swimlanes (persisted
  // `view.group_by` or client-side Folder fallback), Month / Quarter / Year zoom, Today line, and span/milestone bars.
  import { SvelteSet } from "svelte/reactivity";
  import { openPath } from "../../lib/dock";
  import { shownName } from "../../lib/paths";
  import { context, setHover } from "../../lib/context.svelte";
  import { toast } from "../../lib/state.svelte";
  import { groupRows, NO_VALUE } from "../../lib/base-groups";
  import { classifyStatus } from "../../lib/base-format";
  import type { BaseView } from "../../lib/gen/BaseView";
  import type { BaseColumn } from "../../lib/gen/BaseColumn";
  import type { BaseRow } from "../../lib/gen/BaseRow";
  import type { BaseCell } from "../../lib/gen/BaseCell";
  import type { ViewEdit } from "../../lib/gen/ViewEdit";

  let { view, props, onedit, onwrite }: {
    view: BaseView; props: { id: string; label: string }[]; onedit: (e: ViewEdit) => void;
    onwrite?: (path: string, key: string, value: unknown) => void;
  } = $props();

  type Zoom = "month" | "quarter" | "year";
  type DragMode = "move" | "start" | "end";
  type BarItem = { row: BaseRow; sYmd: string; eYmd: string; sDay: number; eDay: number; hasEnd: boolean; isSpan: boolean; leftPct: number; widthPct: number; track: number };
  const PIGMENTS = ["var(--accent)", "var(--green)", "var(--yellow)", "var(--orange)", "var(--purple)", "var(--cyan)", "var(--red)"];
  const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})/;
  const TIME_SUFFIX_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)/;
  const DATE_COL_RE = /date|due|updated|start|end|created|mtime|ctime/i;
  const START_PRIO = ["start", "date", "due", "updated", "created", "end"];

  const fmtYmd = (y: number, m0: number, d: number) => `${String(y).padStart(4, "0")}-${String(m0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const toDay = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000); };
  const fromDay = (day: number) => { const dt = new Date(day * 86_400_000); return fmtYmd(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()); };

  function cellYmd(cell: BaseCell | undefined): string | null {
    if (!cell || cell.t === "null") return null;
    if (cell.t === "list") return cell.items.length ? cellYmd(cell.items[0]) : null;
    if (cell.t === "num" && cell.value > 1e11 && cell.value < 1e14) { const dt = new Date(cell.value); return fmtYmd(dt.getFullYear(), dt.getMonth(), dt.getDate()); }
    const m = ISO_RE.exec(cell.t === "date" ? cell.text.trim() : cell.t === "text" ? cell.value.trim() : "");
    return m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31 ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }

  function withPreservedTime(cell: BaseCell | undefined, ymd: string): string {
    if (!cell || cell.t === "null") return ymd;
    if (cell.t === "list") return cell.items.length ? withPreservedTime(cell.items[0], ymd) : ymd;
    const m = TIME_SUFFIX_RE.exec(cell.t === "date" ? cell.text.trim() : cell.t === "text" ? cell.value.trim() : "");
    return m ? `${ymd}${m[1]}` : ymd;
  }

  const hoverIn = (p: string) => setHover({ path: p, source: "base" });
  const hoverOut = () => { if (context.hover?.source === "base") setHover(null); };
  const lit = (p: string) => context.hover?.path === p && context.hover.source !== "base";
  const nameAt = $derived(view.columns.findIndex((c) => c.id === "file.name"));
  const rowTitle = (r: BaseRow) => (nameAt >= 0 && r.cells[nameAt]?.t === "link" ? r.cells[nameAt].text : shownName(r.path));
  const pigmentFor = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return PIGMENTS[Math.abs(h) % PIGMENTS.length]; };
  const laneColor = (s: string) => { const { tone } = classifyStatus(s); return tone === "done" ? "var(--green)" : tone === "progress" ? "var(--accent)" : tone === "blocked" ? "var(--red)" : tone === "review" ? "var(--purple)" : pigmentFor(s); };

  const dateColumns = $derived(view.columns.map((col, idx) => ({ col, idx })).filter(({ col, idx }) => DATE_COL_RE.test(col.id) || view.rows.some((r) => cellYmd(r.cells[idx]) !== null)));
  function colRank(col: BaseColumn, idx: number): number {
    const bare = col.id.replace(/^note\./, "").toLowerCase(), isFile = col.id.startsWith("file.");
    const hasData = view.rows.some((r) => cellYmd(r.cells[idx]) !== null);
    const pIdx = START_PRIO.findIndex((p) => bare === p || bare.includes(p)), pScore = pIdx >= 0 ? pIdx : 20;
    return !isFile && hasData ? pScore : isFile && hasData ? 40 + pScore : !isFile ? 70 + pScore : 100 + pScore;
  }

  let chosenStartId = $state("");
  let chosenEndId = $state<string | null>(null);
  let clientLane = $state<"__folder__" | "__all__">("__folder__");
  let zoom = $state<Zoom>("quarter");

  const startEntry = $derived(dateColumns.find((d) => d.col.id === chosenStartId) ?? [...dateColumns].sort((a, b) => colRank(a.col, a.idx) - colRank(b.col, b.idx))[0] ?? null);
  const isEndCand = (d: { col: BaseColumn; idx: number }) => {
    if (!startEntry || d.col.id === startEntry.col.id) return false;
    const bare = d.col.id.replace(/^note\./, "").toLowerCase();
    return bare === "end" || (startEntry.col.id.includes("start") && bare === "due");
  };
  const autoEndEntry = $derived(dateColumns.find((d) => isEndCand(d) && view.rows.some((r) => cellYmd(r.cells[d.idx]) !== null)) ?? dateColumns.find((d) => isEndCand(d) && Boolean(d.col.key)) ?? null);
  const endEntry = $derived(chosenEndId === "" ? null : dateColumns.find((d) => d.col.id === chosenEndId && d.col.id !== startEntry?.col.id) ?? autoEndEntry);
  const canWriteStart = $derived(Boolean(onwrite && startEntry?.col.key));
  const canWriteEnd = $derived(Boolean(onwrite && endEntry?.col.key));
  const collapsedLanes = new SvelteSet<string>();
  const toggleLane = (title: string) => { if (collapsedLanes.has(title)) collapsedLanes.delete(title); else collapsedLanes.add(title); };

  const now = new Date();
  const todayYmd = fmtYmd(now.getFullYear(), now.getMonth(), now.getDate());
  const todayDay = toDay(todayYmd);
  let anchorY = $state(now.getFullYear());
  let anchorM0 = $state(now.getMonth() - 1);
  let manualNav = $state(false);
  let lastSeed = "";
  let showUndated = $state(false);

  function seedAnchor(y: number, m0: number, z: Zoom): void {
    if (z === "month") { anchorY = y; anchorM0 = m0; }
    else if (z === "quarter") { const d = new Date(y, m0 - 1, 1); anchorY = d.getFullYear(); anchorM0 = d.getMonth(); }
    else { anchorY = y; anchorM0 = 0; }
  }

  $effect(() => {
    const seed = `${view.name}\u0000${startEntry?.col.id ?? ""}`;
    if (seed !== lastSeed) { lastSeed = seed; manualNav = false; }
    if (manualNav) return;
    const sIdx = startEntry?.idx ?? -1;
    const dates = sIdx >= 0 ? view.rows.map((r) => cellYmd(r.cells[sIdx])).filter((x): x is string => x !== null) : [];
    if (!dates.length || dates.some((d) => d.startsWith(todayYmd.slice(0, 7)))) seedAnchor(now.getFullYear(), now.getMonth(), zoom);
    else { const latest = dates.reduce((a, b) => (a > b ? a : b)); seedAnchor(+latest.slice(0, 4), +latest.slice(5, 7) - 1, zoom); }
  });

  function setZoom(z: Zoom): void {
    const midYmd = fromDay(Math.round((winRange.startDay + winRange.endDay) / 2));
    zoom = z;
    seedAnchor(+midYmd.slice(0, 4), +midYmd.slice(5, 7) - 1, z);
  }
  function panWindow(dir: -1 | 1): void {
    const d = new Date(anchorY, anchorM0 + dir * (zoom === "month" ? 1 : zoom === "quarter" ? 3 : 12), 1);
    anchorY = d.getFullYear(); anchorM0 = d.getMonth(); manualNav = true;
  }
  function goToday(): void { seedAnchor(now.getFullYear(), now.getMonth(), zoom); manualNav = true; }

  const winRange = $derived.by(() => {
    const spanMonths = zoom === "month" ? 1 : zoom === "quarter" ? 3 : 12;
    const startDay = Math.floor(Date.UTC(anchorY, anchorM0, 1) / 86_400_000);
    const endDay = Math.floor(Date.UTC(anchorY, anchorM0 + spanMonths, 1) / 86_400_000);
    const totalDays = Math.max(1, endDay - startDay);
    const sDate = new Date(anchorY, anchorM0, 1), eDate = new Date(anchorY, anchorM0 + spanMonths - 1, 1);
    const label = spanMonths === 1
      ? sDate.toLocaleDateString(undefined, { month: "short", year: "numeric" })
      : spanMonths === 12 && anchorM0 === 0 ? String(anchorY)
      : `${sDate.toLocaleDateString(undefined, { month: "short", year: sDate.getFullYear() !== eDate.getFullYear() ? "2-digit" : undefined })} – ${eDate.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`;

    const ticks: { pct: number; label: string; major: boolean }[] = [];
    if (zoom === "month") {
      const dim = new Date(anchorY, anchorM0 + 1, 0).getDate();
      for (const day of [1, 5, 10, 15, 20, 25]) {
        if (day > dim) continue;
        const tDay = Math.floor(Date.UTC(anchorY, anchorM0, day) / 86_400_000);
        ticks.push({ pct: ((tDay - startDay) / totalDays) * 100, label: day === 1 ? sDate.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : String(day), major: day === 1 || day === 15 });
      }
    } else if (zoom === "quarter") {
      for (let m = 0; m < 3; m++) {
        const dt = new Date(anchorY, anchorM0 + m, 1);
        const mDay = Math.floor(Date.UTC(anchorY, anchorM0 + m, 1) / 86_400_000), midDay = Math.floor(Date.UTC(anchorY, anchorM0 + m, 15) / 86_400_000);
        ticks.push({ pct: ((mDay - startDay) / totalDays) * 100, label: dt.toLocaleDateString(undefined, { month: "short" }), major: true });
        ticks.push({ pct: ((midDay - startDay) / totalDays) * 100, label: "15", major: false });
      }
    } else {
      for (let m = 0; m < 12; m++) {
        const dt = new Date(anchorY, anchorM0 + m, 1), mDay = Math.floor(Date.UTC(anchorY, anchorM0 + m, 1) / 86_400_000);
        ticks.push({ pct: ((mDay - startDay) / totalDays) * 100, label: dt.toLocaleDateString(undefined, { month: "short" }), major: m % 3 === 0 });
      }
    }
    const todayPct = todayDay >= startDay && todayDay < endDay ? ((todayDay + 0.5 - startDay) / totalDays) * 100 : null;
    return { startDay, endDay, totalDays, label, ticks, todayPct };
  });

  const swimlaneSelectValue = $derived(view.group_by ?? clientLane);
  const groupableProps = $derived(props.filter((p) => !/^(file|formula)\./.test(p.id) || p.id === view.group_by));
  function changeSwimlane(val: string): void {
    if (val === "__folder__" || val === "__all__") { clientLane = val; if (view.group_by) onedit({ op: "group", property: null }); }
    else onedit({ op: "group", property: val });
  }

  const computed = $derived.by(() => {
    const sIdx = startEntry?.idx ?? -1, eIdx = endEntry?.idx ?? -1;
    const undated: BaseRow[] = [], datedSet = new Set<string>();
    const rowDates = new Map<string, { sYmd: string; eYmd: string; sDay: number; eDay: number; hasEnd: boolean }>();

    for (const r of view.rows) {
      const sYmd = sIdx >= 0 ? cellYmd(r.cells[sIdx]) : null;
      if (!sYmd) { undated.push(r); continue; }
      const rawEnd = eIdx >= 0 ? cellYmd(r.cells[eIdx]) : null;
      const eYmd = rawEnd && rawEnd >= sYmd ? rawEnd : sYmd;
      datedSet.add(r.path);
      rowDates.set(r.path, { sYmd, eYmd, sDay: toDay(sYmd), eDay: toDay(eYmd), hasEnd: rawEnd !== null });
    }

    let rawGroups: { title: string; rows: BaseRow[] }[] = [];
    if (view.group_by) {
      rawGroups = groupRows(view).map((g) => ({ title: g.title ?? NO_VALUE, rows: g.rows.filter((r) => datedSet.has(r.path)) }));
    } else if (clientLane === "__folder__") {
      const m = new Map<string, BaseRow[]>();
      for (const r of view.rows) {
        if (!datedSet.has(r.path)) continue;
        const folder = r.path.includes("/") ? r.path.slice(0, r.path.lastIndexOf("/")) : "(Root)";
        if (!m.has(folder)) m.set(folder, []);
        m.get(folder)!.push(r);
      }
      rawGroups = [...m].sort(([a], [b]) => (a === "(Root)" ? -1 : b === "(Root)" ? 1 : a.localeCompare(b, undefined, { numeric: true }))).map(([title, rows]) => ({ title, rows }));
    } else {
      rawGroups = [{ title: "All notes", rows: view.rows.filter((r) => datedSet.has(r.path)) }];
    }

    const { startDay, endDay, totalDays } = winRange;
    const pillPadDays = Math.max(1, Math.ceil(totalDays * 0.12));
    const lanes = rawGroups.filter((g) => g.rows.length > 0).map((g) => {
      const sorted = [...g.rows].sort((a, b) => (rowDates.get(a.path)!.sDay - rowDates.get(b.path)!.sDay) || a.path.localeCompare(b.path));
      const trackEnds: number[] = [], bars: BarItem[] = [];
      let earlierYmd: string | null = null, laterYmd: string | null = null, outCount = 0;
      for (const r of sorted) {
        const d = rowDates.get(r.path)!;
        if (d.eDay < startDay) { outCount++; if (!earlierYmd || d.sYmd > earlierYmd) earlierYmd = d.sYmd; continue; }
        if (d.sDay >= endDay) { outCount++; if (!laterYmd || d.sYmd < laterYmd) laterYmd = d.sYmd; continue; }
        const clampS = Math.max(startDay, d.sDay), clampE = Math.min(endDay - 1, d.eDay);
        const isSpan = d.eDay > d.sDay, occEnd = isSpan ? clampE : clampS + pillPadDays;
        let t = trackEnds.findIndex((te) => te < clampS);
        if (t < 0) { t = trackEnds.length; trackEnds.push(occEnd); } else trackEnds[t] = occEnd;
        bars.push({ row: r, sYmd: d.sYmd, eYmd: d.eYmd, sDay: d.sDay, eDay: d.eDay, hasEnd: d.hasEnd, isSpan, leftPct: ((clampS - startDay) / totalDays) * 100, widthPct: isSpan ? Math.max(1.4, ((clampE + 1 - clampS) / totalDays) * 100) : 0, track: t });
      }
      return { title: g.title, total: g.rows.length, bars, tracks: Math.max(1, trackEnds.length), outCount, jumpYmd: earlierYmd ?? laterYmd };
    });
    return { lanes, undated };
  });

  let liveDrag = $state<{ path: string; mode: DragMode; sDay: number; eDay: number } | null>(null);
  let dragPillPos = $state<{ x: number; y: number } | null>(null);
  let dragSession: { path: string; row: BaseRow; mode: DragMode; origSDay: number; origEDay: number; origIsSpan: boolean; origHasEnd: boolean; startX: number; canvasLeft: number; canvasWidthPx: number; barTop: number; active: boolean } | null = null;
  let suppressClick = false;

  function computePreview(dxPx: number): { sDay: number; eDay: number } {
    if (!dragSession) return { sDay: 0, eDay: 0 };
    const deltaDays = Math.round((dxPx / dragSession.canvasWidthPx) * winRange.totalDays);
    const { mode, origSDay, origEDay, origIsSpan } = dragSession;
    if (mode === "start") return { sDay: Math.min(origEDay, origSDay + deltaDays), eDay: origEDay };
    if (mode === "end") return { sDay: origSDay, eDay: Math.max(origSDay, origEDay + deltaDays) };
    if (origIsSpan && canWriteEnd) return { sDay: origSDay + deltaDays, eDay: origEDay + deltaDays };
    if (origIsSpan) return { sDay: Math.min(origEDay, origSDay + deltaDays), eDay: origEDay };
    const sDay = origSDay + deltaDays;
    return { sDay, eDay: sDay };
  }

  function barGeom(sDay: number, eDay: number): { isSpan: boolean; leftPct: number; widthPct: number } {
    const clampS = Math.max(winRange.startDay, Math.min(winRange.endDay - 1, sDay)), clampE = Math.max(clampS, Math.min(winRange.endDay - 1, eDay));
    const isSpan = eDay > sDay;
    return { isSpan, leftPct: ((clampS - winRange.startDay) / winRange.totalDays) * 100, widthPct: isSpan ? Math.max(1.4, ((clampE + 1 - clampS) / winRange.totalDays) * 100) : 0 };
  }

  // --- Dependencies (`view.blocked_by`), SVG arrows & cascade drag undo ------------------------------------
  const depColIdx = $derived(
    view.blocked_by
      ? view.columns.findIndex((c) => c.id === view.blocked_by || c.key === view.blocked_by || c.id === `note.${view.blocked_by}`)
      : -1,
  );
  const relProps = $derived(
    props.filter((p) => !p.id.startsWith("file.") && p.id !== startEntry?.col.id && p.id !== endEntry?.col.id),
  );
  function resolveCellPaths(cell: BaseCell | undefined, byName: Map<string, string>): string[] {
    if (!cell || cell.t === "null") return [];
    if (cell.t === "link") {
      const p = cell.path ?? byName.get(cell.text.toLowerCase());
      return p ? [p] : [];
    }
    if (cell.t === "list") return cell.items.flatMap((it) => resolveCellPaths(it, byName));
    if (cell.t === "text") {
      return cell.value
        .split(",")
        .map((s) => s.trim().replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim().toLowerCase())
        .map((k) => byName.get(k) ?? "")
        .filter(Boolean);
    }
    return [];
  }

  const depData = $derived.by(() => {
    const empty = { arrows: [] as { id: string; d: string; conflict: boolean }[], conflicts: new Set<string>(), totalH: 120 };
    const nameMap = new Map<string, string>();
    for (const r of view.rows) {
      nameMap.set(r.path.toLowerCase(), r.path);
      nameMap.set(shownName(r.path).toLowerCase(), r.path);
    }
    type Pos = { sDay: number; eDay: number; row: BaseRow; leftPct: number; widthPct: number; isSpan: boolean; y: number };
    const posMap = new Map<string, Pos>();
    let y = 29;
    for (const lane of computed.lanes) {
      const col = collapsedLanes.has(lane.title);
      const h = col ? 35 : Math.max(44, lane.tracks * 28 + 12) + 1;
      if (!col) {
        for (const b of lane.bars) {
          const d = liveDrag?.path === b.row.path ? liveDrag : null;
          const sDay = d ? d.sDay : b.sDay;
          const eDay = d ? d.eDay : b.eDay;
          const g = d ? barGeom(d.sDay, d.eDay) : b;
          posMap.set(b.row.path, { sDay, eDay, row: b.row, leftPct: g.leftPct, widthPct: g.widthPct, isSpan: g.isSpan, y: y + 6 + b.track * 28 + 11 });
        }
      }
      y += h;
    }
    empty.totalH = Math.max(80, y);
    if (depColIdx < 0) return empty;

    const arrows: { id: string; d: string; conflict: boolean }[] = [];
    const conflicts = new Set<string>();
    for (const [succPath, succ] of posMap) {
      const preds = resolveCellPaths(succ.row.cells[depColIdx], nameMap);
      for (const predPath of preds) {
        const pred = posMap.get(predPath);
        if (!pred || predPath === succPath) continue;
        const x1 = (pred.isSpan ? pred.leftPct + pred.widthPct : pred.leftPct + 1.2) * 10;
        const x2 = succ.leftPct * 10;
        const dx = Math.max(24, Math.abs(x2 - x1) * 0.45);
        const d = `M ${x1.toFixed(1)} ${pred.y.toFixed(1)} C ${(x1 + dx).toFixed(1)} ${pred.y.toFixed(1)}, ${(x2 - dx).toFixed(1)} ${succ.y.toFixed(1)}, ${x2.toFixed(1)} ${succ.y.toFixed(1)}`;
        const conflict = pred.eDay > succ.sDay;
        if (conflict) conflicts.add(succPath);
        arrows.push({ id: `${predPath}->${succPath}`, d, conflict });
      }
    }
    return { arrows, conflicts, totalH: Math.max(80, y) };
  });

  let depUndoStack = $state<{ writes: { path: string; key: string; value: unknown }[] }[]>([]);
  function undoDepCascade(): void {
    const top = depUndoStack[depUndoStack.length - 1];
    if (!top || !onwrite) return;
    depUndoStack = depUndoStack.slice(0, -1);
    for (const w of top.writes) onwrite(w.path, w.key, w.value);
    toast("Reverted dependent schedule");
  }

  function trackDepDrag(bar: BarItem): void {
    if (depColIdx < 0 || !onwrite || !startEntry?.col.key) return;
    const origEnd = bar.eDay;
    const predPath = bar.row.path;
    const onCapUp = () => {
      window.removeEventListener("pointerup", onCapUp, true);
      if (!liveDrag || liveDrag.path !== predPath || !startEntry?.col.key) return;
      const newEnd = liveDrag.eDay;
      if (newEnd <= origEnd) return;
      const nameMap = new Map<string, string>();
      const byPath = new Map<string, BarItem>();
      for (const lane of computed.lanes) {
        for (const it of lane.bars) {
          byPath.set(it.row.path, it);
          nameMap.set(it.row.path.toLowerCase(), it.row.path);
          nameMap.set(shownName(it.row.path).toLowerCase(), it.row.path);
        }
      }
      const adj = new Map<string, BarItem[]>();
      for (const it of byPath.values()) {
        for (const p of resolveCellPaths(it.row.cells[depColIdx], nameMap)) {
          const arr = adj.get(p) ?? [];
          arr.push(it);
          adj.set(p, arr);
        }
      }
      const writes: { path: string; key: string; value: unknown }[] = [];
      const shiftedEnds = new Map<string, number>([[predPath, newEnd]]);
      const queue = [predPath];
      const visited = new Set<string>([predPath]);
      while (queue.length) {
        const cur = queue.shift()!;
        const parentEnd = shiftedEnds.get(cur) ?? newEnd;
        for (const succ of adj.get(cur) ?? []) {
          if (visited.has(succ.row.path)) continue;
          visited.add(succ.row.path);
          if (succ.sDay < parentEnd) {
            const shift = parentEnd - succ.sDay;
            writes.push({ path: succ.row.path, key: startEntry.col.key, value: withPreservedTime(succ.row.cells[startEntry.idx], fromDay(succ.sDay)) });
            onwrite(succ.row.path, startEntry.col.key, withPreservedTime(succ.row.cells[startEntry.idx], fromDay(succ.sDay + shift)));
            if (succ.hasEnd && endEntry?.col.key) {
              writes.push({ path: succ.row.path, key: endEntry.col.key, value: withPreservedTime(succ.row.cells[endEntry.idx], fromDay(succ.eDay)) });
              onwrite(succ.row.path, endEntry.col.key, withPreservedTime(succ.row.cells[endEntry.idx], fromDay(succ.eDay + shift)));
            }
            shiftedEnds.set(succ.row.path, succ.eDay + shift);
          } else {
            shiftedEnds.set(succ.row.path, succ.eDay);
          }
          queue.push(succ.row.path);
        }
      }
      if (writes.length) {
        depUndoStack = [...depUndoStack.slice(-7), { writes }];
        toast("Shifted dependent tasks", "Click Undo cascade in timeline bar to revert");
      }
    };
    window.addEventListener("pointerup", onCapUp, true);
  }
  function detachBarDrag(): void {
    window.removeEventListener("pointermove", onBarMove); window.removeEventListener("pointerup", onBarUp);
    window.removeEventListener("pointercancel", cancelBarDrag); window.removeEventListener("keydown", onBarKey);
  }
  function cancelBarDrag(): void { detachBarDrag(); dragSession = liveDrag = dragPillPos = null; }

  function onBarMove(ev: PointerEvent): void {
    if (!dragSession) return;
    const dxPx = ev.clientX - dragSession.startX;
    if (!dragSession.active) { if (Math.abs(dxPx) <= (dragSession.mode === "move" ? 4 : 2)) return; dragSession.active = true; }
    const { sDay, eDay } = computePreview(dxPx), g = barGeom(sDay, eDay);
    liveDrag = { path: dragSession.path, mode: dragSession.mode, sDay, eDay };
    const rawX = dragSession.canvasLeft + ((g.isSpan ? g.leftPct + g.widthPct / 2 : g.leftPct + 3) / 100) * dragSession.canvasWidthPx;
    dragPillPos = { x: Math.max(dragSession.canvasLeft + 44, Math.min(dragSession.canvasLeft + dragSession.canvasWidthPx - 44, rawX)), y: Math.max(8, dragSession.barTop - 4) };
  }

  function onBarUp(ev: PointerEvent): void {
    const sess = dragSession;
    if (!sess || !sess.active) { cancelBarDrag(); return; }
    const { sDay, eDay } = computePreview(ev.clientX - sess.startX);
    suppressClick = true;
    requestAnimationFrame(() => { suppressClick = false; });
    cancelBarDrag();
    if ((sess.mode === "move" || sess.mode === "start") && canWriteStart && startEntry?.col.key && sDay !== sess.origSDay) {
      onwrite?.(sess.path, startEntry.col.key, withPreservedTime(sess.row.cells[startEntry.idx], fromDay(sDay)));
    }
    if (canWriteEnd && endEntry?.col.key && eDay !== sess.origEDay && (sess.mode === "end" || sess.origIsSpan || sess.origHasEnd)) {
      onwrite?.(sess.path, endEntry.col.key, withPreservedTime(sess.row.cells[endEntry.idx], fromDay(eDay)));
    }
  }

  function onBarKey(ev: KeyboardEvent): void {
    if (ev.key === "Escape" && dragSession) { ev.preventDefault(); ev.stopPropagation(); cancelBarDrag(); }
  }

  function startBarDrag(e: PointerEvent, b: BarItem): void {
    if (e.button !== 0) return;
    const grip = (e.target as HTMLElement).closest<HTMLElement>("[data-grip]")?.dataset.grip as "start" | "end" | undefined;
    const mode: DragMode = grip === "start" ? "start" : grip === "end" ? "end" : "move";
    if (((mode === "move" || mode === "start") && !canWriteStart) || (mode === "end" && !canWriteEnd)) return;
    const barEl = e.currentTarget as HTMLElement;
    const canvasRect = barEl.closest<HTMLElement>(".canvas")?.getBoundingClientRect(), barRect = barEl.getBoundingClientRect();
    detachBarDrag();
    dragSession = { path: b.row.path, row: b.row, mode, origSDay: b.sDay, origEDay: b.eDay, origIsSpan: b.isSpan, origHasEnd: b.hasEnd, startX: e.clientX, canvasLeft: canvasRect?.left ?? 0, canvasWidthPx: Math.max(1, canvasRect?.width ?? 600), barTop: barRect.top, active: false };
    window.addEventListener("pointermove", onBarMove); window.addEventListener("pointerup", onBarUp);
    window.addEventListener("pointercancel", cancelBarDrag); window.addEventListener("keydown", onBarKey);
  }

  $effect(() => () => detachBarDrag());

  function nudgeBar(e: KeyboardEvent, b: BarItem): void {
    if (e.key === "Enter") { e.preventDefault(); openPath(b.row.path); return; }
    if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight") && onwrite && startEntry?.col.key) {
      e.preventDefault();
      const step = e.key === "ArrowLeft" ? -1 : 1;
      onwrite(b.row.path, startEntry.col.key, withPreservedTime(b.row.cells[startEntry.idx], fromDay(b.sDay + step)));
      if ((b.isSpan || b.hasEnd) && canWriteEnd && endEntry?.col.key) {
        onwrite(b.row.path, endEntry.col.key, withPreservedTime(b.row.cells[endEntry.idx], fromDay(b.eDay + step)));
      }
    }
  }
</script>

<div class="tl-wrap">
  <div class="tl-bar">
    <div class="ctrl-row">
      {#if dateColumns.length > 0}
        <label class="pill"><span class="lbl">Date:</span>
          <select value={startEntry?.col.id ?? ""} onchange={(e) => { chosenStartId = (e.currentTarget as HTMLSelectElement).value; }}>
            {#each dateColumns as d (d.col.id)}<option value={d.col.id}>{d.col.label}</option>{/each}
          </select>
        </label>
        <label class="pill"><span class="lbl">End:</span>
          <select value={endEntry?.col.id ?? ""} onchange={(e) => { chosenEndId = (e.currentTarget as HTMLSelectElement).value; }}>
            <option value="">None (point)</option>
            {#each dateColumns.filter((d) => d.col.id !== startEntry?.col.id) as d (d.col.id)}<option value={d.col.id}>{d.col.label}</option>{/each}
          </select>
        </label>
      {/if}
      <label class="pill"><span class="lbl">Swimlanes:</span>
        <select value={swimlaneSelectValue} onchange={(e) => changeSwimlane((e.currentTarget as HTMLSelectElement).value)}>
          <option value="__folder__">Folder</option>
          <option value="__all__">All notes</option>
          {#each groupableProps as p (p.id)}<option value={p.id}>{p.label}</option>{/each}
        </select>
      </label>
    </div>

    <div class="ctrl-row">
      <div class="zoom-seg" role="group" aria-label="Timeline zoom">
        {#each [["month", "Month"], ["quarter", "Quarter"], ["year", "Year"]] as [z, lbl] (z)}
          <button type="button" class:active={zoom === z} onclick={() => setZoom(z as Zoom)}>{lbl}</button>
        {/each}
      </div>
      <div class="nav-seg">
        <button type="button" class="nav-btn" onclick={() => panWindow(-1)} aria-label="Previous window" title="Pan earlier">‹</button>
        <span class="win-lbl">{winRange.label}</span>
        <button type="button" class="nav-btn" onclick={() => panWindow(1)} aria-label="Next window" title="Pan later">›</button>
        <button type="button" class="today-btn" onclick={goToday}>Today</button>
      </div>
    </div>
  </div>

  {#if !dateColumns.length}
    <p class="empty">No date columns found in this view.</p>
  {:else}
    <div class="tl-dep-bar">
      <label class="pill">
        <span class="lbl">Blocked by</span>
        <select aria-label="Dependency property" value={view.blocked_by ?? ""} onchange={(e) => onedit({ op: "dependency_property", property: e.currentTarget.value || null })}>
          <option value="">None</option>
          {#each relProps as p (p.id)}
            <option value={p.id.replace(/^note\./, "")}>{p.label}</option>
          {/each}
        </select>
      </label>
      {#if depData.conflicts.size > 0}
        <span class="dep-warn">{depData.conflicts.size} dependency conflict{depData.conflicts.size === 1 ? "" : "s"}</span>
      {/if}
      {#if depUndoStack.length > 0}
        <button type="button" class="today-btn" onclick={undoDepCascade}>Undo cascade</button>
      {/if}
    </div>
    <div class="tl-scroll">
      <div class="tl-grid" class:zoom-year={zoom === "year"}>
        {#if depData.arrows.length > 0}
          <svg class="dep-svg" viewBox="0 0 1000 {depData.totalH}" style:height="{depData.totalH}px" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <marker id="tl-arrow-ok" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0,1 L7,4 L0,7 Z" fill="var(--accent)"></path>
              </marker>
              <marker id="tl-arrow-err" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0,1 L7,4 L0,7 Z" fill="var(--red)"></path>
              </marker>
            </defs>
            {#each depData.arrows as a (a.id)}
              <path d={a.d} class="dep-path" class:conflict={a.conflict} vector-effect="non-scaling-stroke"
                marker-end={a.conflict ? "url(#tl-arrow-err)" : "url(#tl-arrow-ok)"}></path>
            {/each}
          </svg>
        {/if}
        <div class="tl-ruler">
          <div class="lane-sticky ruler-corner">Swimlane</div>
          <div class="canvas ruler-canvas">
            {#each winRange.ticks as t, i (i)}<div class="tick" class:major={t.major} style:left="{t.pct}%"><span>{t.label}</span></div>{/each}
            {#if winRange.todayPct !== null}<div class="today-flag" style:left="{winRange.todayPct}%">Today</div>{/if}
          </div>
        </div>

        {#each computed.lanes as lane (lane.title)}
          {@const isCollapsed = collapsedLanes.has(lane.title)}
          <div class="tl-lane" class:collapsed={isCollapsed} style:min-height={isCollapsed ? "34px" : `${Math.max(44, lane.tracks * 28 + 12)}px`}>
            <div class="lane-sticky">
              <button type="button" class="lane-toggle" aria-expanded={!isCollapsed} onclick={() => toggleLane(lane.title)}
                title="{isCollapsed ? 'Expand' : 'Collapse'} {lane.title}">
                <span class="lane-chev" aria-hidden="true">{isCollapsed ? "▸" : "▾"}</span>
                <span class="dot" style:background={laneColor(lane.title)}></span>
                <span class="lane-title">{lane.title}</span>
                <span class="lane-cnt">{lane.total}</span>
              </button>
              {#if lane.outCount > 0 && lane.jumpYmd}
                <button type="button" class="jump-out" title="Jump to {lane.outCount} note(s) outside window ({lane.jumpYmd})"
                  onclick={() => { seedAnchor(+lane.jumpYmd!.slice(0, 4), +lane.jumpYmd!.slice(5, 7) - 1, zoom); manualNav = true; }}>↗{lane.outCount}</button>
              {/if}
            </div>
            <div class="canvas">
              {#each winRange.ticks as t, i (i)}<div class="gridline" class:major={t.major} style:left="{t.pct}%"></div>{/each}
              {#if winRange.todayPct !== null}<div class="today-line" style:left="{winRange.todayPct}%"></div>{/if}
              {#if !isCollapsed}
                {#each lane.bars as b (b.row.path)}
                  {@const drag = liveDrag?.path === b.row.path ? liveDrag : null}
                  {@const g = drag ? barGeom(drag.sDay, drag.eDay) : b}
                  {@const sYmd = drag ? fromDay(drag.sDay) : b.sYmd}
                  {@const eYmd = drag ? fromDay(drag.eDay) : b.eYmd}
                  <button type="button" class="tl-item" class:span={g.isSpan} class:lit={lit(b.row.path)} class:conflict={depData.conflicts.has(b.row.path)} class:movable={canWriteStart} class:dragging={Boolean(drag)}
                    style:left="{g.leftPct}%" style:width={g.isSpan ? `${g.widthPct}%` : undefined} style:top="{6 + b.track * 28}px"
                    style:--bar-color={laneColor(lane.title)}
                    title="{rowTitle(b.row)} — {g.isSpan ? `${sYmd} → ${eYmd}` : sYmd} ({b.row.path})"
                    onmouseenter={() => hoverIn(b.row.path)} onmouseleave={hoverOut}
                    onpointerdown={(e) => { trackDepDrag(b); startBarDrag(e, b); }}
                    onclick={(e) => { if (!suppressClick && !(e.target as HTMLElement).closest("[data-grip]")) openPath(b.row.path); }}
                    onkeydown={(e) => nudgeBar(e, b)}>
                    {#if g.isSpan && canWriteStart}<span class="bar-grip start" data-grip="start" aria-hidden="true"></span>{/if}
                    <span class="item-dot"></span><span class="item-lbl">{rowTitle(b.row)}</span>
                    {#if canWriteEnd}<span class="bar-grip end" data-grip="end" aria-hidden="true"></span>{/if}
                  </button>
                {/each}
              {/if}
            </div>
          </div>
        {:else}
          <p class="empty">No dated notes match this view.</p>
        {/each}
      </div>
    </div>

    {#if liveDrag && dragPillPos}
      <div class="bar-date-pill" style:left="{dragPillPos.x}px" style:top="{dragPillPos.y}px" aria-hidden="true">{liveDrag.eDay > liveDrag.sDay ? `${fromDay(liveDrag.sDay)} → ${fromDay(liveDrag.eDay)}` : fromDay(liveDrag.sDay)}</div>
    {/if}

    {#if computed.undated.length > 0}
      <footer class="tl-undated">
        <button type="button" class="undated-toggle" onclick={() => (showUndated = !showUndated)}>
          {showUndated ? "▾" : "▸"} Undated ({computed.undated.length})
        </button>
        {#if showUndated}
          <div class="undated-list">
            {#each computed.undated as r (r.path)}
              <button type="button" class="u-chip" class:lit={lit(r.path)} title={r.path}
                onmouseenter={() => hoverIn(r.path)} onmouseleave={hoverOut} onclick={() => openPath(r.path)}>{rowTitle(r)}</button>
            {/each}
          </div>
        {/if}
      </footer>
    {/if}
  {/if}
</div>

<style>
  .tl-wrap { display: flex; flex-direction: column; min-height: 0; flex: 1; background: var(--bg); }
  .tl-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; padding: 6px 10px; border-bottom: 1px solid var(--border); background: var(--bg-alt); }
  .ctrl-row { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .pill { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 6px 0 8px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg); font-size: .88em; }
  .pill .lbl { color: var(--text-faint); }
  .pill select { border: 0; background: transparent; color: var(--text); font: inherit; font-weight: 500; outline: none; cursor: pointer; max-width: 130px; }
  .zoom-seg { display: inline-flex; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; background: var(--bg); }
  .zoom-seg button { height: 22px; padding: 0 8px; font: inherit; font-size: .86em; color: var(--text-muted); border: 0; background: transparent; cursor: pointer; }
  .zoom-seg button:hover { color: var(--text); background: var(--bg-hover); }
  .zoom-seg button.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
  .nav-seg { display: inline-flex; align-items: center; gap: 4px; }
  .nav-btn, .today-btn { height: 24px; padding: 0 7px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg); color: var(--text-muted); font: inherit; font-size: .88em; cursor: pointer; }
  .nav-btn:hover, .today-btn:hover { background: var(--bg-hover); color: var(--text); border-color: var(--border-strong); }
  .win-lbl { min-width: 98px; text-align: center; font-size: .88em; font-weight: 600; color: var(--heading, var(--text)); font-variant-numeric: tabular-nums; }

  .tl-scroll { flex: 1; min-height: 0; overflow: auto; }
  .tl-grid { display: flex; flex-direction: column; min-width: 760px; position: relative; }
  .tl-dep-bar { display: flex; align-items: center; gap: 8px; padding: 4px 10px; border-bottom: 1px solid var(--border); background: var(--bg-side); }
  .dep-warn { font-size: .82em; font-weight: 600; color: var(--red); padding: 1px 7px; border-radius: 99px; background: color-mix(in srgb, var(--red) 12%, transparent); }
  .dep-svg { position: absolute; left: 180px; top: 0; width: calc(100% - 180px); pointer-events: none; z-index: 2; overflow: visible; }
  .dep-path { fill: none; stroke: var(--accent); stroke-width: 1.5; stroke-opacity: .7; }
  .dep-path.conflict { stroke: var(--red); stroke-width: 2; stroke-opacity: .95; }
  .tl-item.conflict { border-color: var(--red); box-shadow: 0 0 0 1px var(--red); }
  .tl-grid.zoom-year { min-width: 880px; }
  .tl-ruler, .tl-lane { display: flex; border-bottom: 1px solid var(--border); }
  .tl-lane.collapsed { height: 34px; min-height: 34px; }
  .tl-ruler { position: sticky; top: 0; z-index: 4; background: var(--bg-alt); height: 28px; }
  .lane-sticky { flex: 0 0 180px; width: 180px; position: sticky; left: 0; z-index: 3; display: flex; align-items: center; gap: 4px; padding: 4px 8px; box-sizing: border-box; background: var(--bg-alt); border-right: 1px solid var(--border); min-width: 0; }
  .ruler-corner { padding: 6px 10px; font-size: .8em; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--text-faint); }
  .lane-toggle { flex: 1; min-width: 0; display: inline-flex; align-items: center; gap: 5px; padding: 2px; border: 0; border-radius: var(--radius-sm); background: transparent; color: inherit; font: inherit; cursor: pointer; text-align: left; }
  .lane-toggle:hover { background: var(--bg-hover); }
  .lane-chev { width: 11px; flex: none; font-size: .78em; color: var(--text-faint); text-align: center; }
  .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
  .lane-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; font-size: .9em; color: var(--heading, var(--text)); }
  .lane-cnt { font-size: .82em; color: var(--text-faint); font-variant-numeric: tabular-nums; }
  .jump-out { padding: 0 5px; height: 18px; border-radius: 99px; border: 1px solid var(--border); background: var(--bg); color: var(--accent); font-size: .76em; cursor: pointer; flex: none; }

  .canvas { flex: 1; position: relative; min-width: 0; overflow: hidden; }
  .ruler-canvas { height: 28px; }
  .tick { position: absolute; top: 0; bottom: 0; border-left: 1px solid var(--border); padding-left: 5px; display: flex; align-items: center; font-size: .78em; color: var(--text-faint); font-variant-numeric: tabular-nums; pointer-events: none; }
  .tick.major { color: var(--text-muted); font-weight: 600; border-left-color: var(--border-strong); }
  .gridline { position: absolute; top: 0; bottom: 0; border-left: 1px dashed var(--border); pointer-events: none; }
  .gridline.major { border-left-style: solid; }
  .today-line { position: absolute; top: 0; bottom: 0; width: 1.5px; background: var(--accent); z-index: 1; pointer-events: none; }
  .today-flag { position: absolute; top: 4px; transform: translateX(-50%); padding: 0 5px; border-radius: 99px; background: var(--accent); color: var(--accent-fg, #fff); font-size: .72em; font-weight: 600; line-height: 18px; z-index: 2; pointer-events: none; }

  .tl-item { position: absolute; height: 22px; display: inline-flex; align-items: center; gap: 5px; padding: 0 9px; border-radius: 999px; background: var(--bg-elev); border: 1px solid var(--border-strong); color: var(--heading, var(--text)); font: inherit; font-size: .84em; cursor: pointer; z-index: 2; max-width: 210px; box-sizing: border-box; white-space: nowrap; overflow: hidden; user-select: none; touch-action: none; }
  .tl-item.movable { cursor: grab; }
  .tl-item.span { border-radius: 5px; max-width: none; background: color-mix(in srgb, var(--bar-color, var(--accent)) 16%, var(--bg-elev)); border-color: color-mix(in srgb, var(--bar-color, var(--accent)) 48%, var(--border)); }
  .tl-item:hover { border-color: var(--accent); background: var(--bg-hover); z-index: 3; }
  .tl-item.dragging { border-color: var(--accent); box-shadow: var(--shadow-sm), 0 0 0 1px var(--accent); cursor: grabbing; z-index: 5; transition: left 45ms linear, width 45ms linear; }
  .tl-item:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; z-index: 3; }
  .tl-item.lit { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .item-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--bar-color, var(--accent)); flex: none; }
  .item-lbl { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
  .bar-grip { position: absolute; top: 0; bottom: 0; width: 6px; max-width: 28%; cursor: ew-resize; display: grid; place-items: center; z-index: 2; }
  .bar-grip.start { left: 0; }
  .bar-grip.end { right: 0; }
  .bar-grip::after { content: ""; width: 2px; height: 10px; border-radius: 1px; background: var(--accent); opacity: 0; transition: opacity 110ms; }
  .tl-item.span .bar-grip::after { opacity: .35; }
  .tl-item:hover .bar-grip::after, .tl-item.dragging .bar-grip::after { opacity: .9; }
  .bar-date-pill { position: fixed; transform: translate(-50%, -100%); z-index: 900; pointer-events: none; padding: 2px 8px; border-radius: 999px; background: var(--bg-elev); border: 1.5px solid var(--accent); color: var(--heading, var(--text)); font-size: .78em; font-weight: 600; font-variant-numeric: tabular-nums; box-shadow: var(--shadow-sm); white-space: nowrap; }

  .tl-undated { border-top: 1px solid var(--border); background: var(--bg-alt); padding: 5px 10px; }
  .undated-toggle { font: inherit; font-size: .86em; font-weight: 600; color: var(--text-muted); background: none; border: 0; cursor: pointer; padding: 2px 0; }
  .undated-toggle:hover { color: var(--text); }
  .undated-list { display: flex; flex-wrap: wrap; gap: 5px; padding-top: 5px; }
  .u-chip { padding: 2px 8px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-elev); color: var(--text); font: inherit; font-size: .84em; cursor: pointer; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .u-chip:hover, .u-chip.lit { border-color: var(--accent); }
  .empty { color: var(--text-faint); padding: 14px; margin: 0; }
</style>
