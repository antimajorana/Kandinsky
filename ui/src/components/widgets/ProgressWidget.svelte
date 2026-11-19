<script lang="ts">
  // Notion-style Progress & Countdown widget: live Year/Month/Week/Day pigment bars, frontmatter-backed
  // Goal progress with +/- steppers, and target-date Milestone countdowns.
  import { onMount } from "svelte";
  import { api } from "../../lib/api";
  import { frontmatterOf } from "../../lib/property-model";
  import { reloadOnChange } from "../../lib/reload-on-change";

  let {
    options = {},
    doc = "",
    mode = "progress",
  }: { options?: Record<string, unknown>; doc?: string; mode?: "progress" | "countdown" } = $props();

  const str = (v: unknown, d = ""): string => (typeof v === "string" && v.trim() ? v.trim() : d);
  const num = (v: unknown, d: number): number => {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
    return Number.isFinite(n) ? n : d;
  };
  const clamp = (v: number, lo = 0, hi = 100): number => Math.min(hi, Math.max(lo, v));

  let now = $state(new Date());
  let rootEl = $state<HTMLElement>();
  let propVal = $state<number | null>(null);
  let saving = $state(false);

  onMount(() => {
    const id = setInterval(() => { now = new Date(); }, 60_000);
    return () => clearInterval(id);
  });

  const viewMode = $derived(mode === "countdown" || options.mode === "countdown" ? "countdown" : "progress");
  const propName = $derived(str(options.property));
  const canBindProp = $derived(viewMode === "progress" && propName !== "" && doc.toLowerCase().endsWith(".md"));

  async function loadProp(): Promise<void> {
    if (!canBindProp) { propVal = null; return; }
    try {
      const f = await api.file(doc);
      const raw = frontmatterOf(f.text)?.data?.[propName];
      const n = typeof raw === "number" ? raw : raw != null && String(raw).trim() !== "" ? Number(raw) : NaN;
      propVal = Number.isFinite(n) ? n : 0;
    } catch {
      propVal = null;
    }
  }

  $effect(() => {
    if (!canBindProp) { propVal = null; return; }
    void doc;
    void propName;
    void loadProp();
    return reloadOnChange(() => void loadProp(), { wait: 150, wants: (p) => p === doc, host: () => rootEl });
  });

  async function stepGoal(delta: number): Promise<void> {
    if (!canBindProp || saving) return;
    const nextNum = Math.max(0, Math.round((goalCurrent + delta) * 100) / 100);
    propVal = nextNum;
    saving = true;
    try {
      await api.setProperty({ path: doc, key: propName, text: "", list: false, value: nextNum });
    } catch {
      await loadProp();
    } finally {
      saving = false;
    }
  }

  const hasGoalOpt = $derived(
    str(options.label) !== "" ||
      propName !== "" ||
      (options.target !== undefined && options.target !== null && options.target !== ""),
  );
  const kind = $derived.by((): "time" | "goal" | "both" => {
    const k = str(options.kind);
    if (k === "time" || k === "goal" || k === "both") return k;
    return hasGoalOpt ? "both" : "time";
  });

  const timeRows = $derived.by(() => {
    const t = now.getTime(), y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    const y0 = new Date(y, 0, 1).getTime(), y1 = new Date(y + 1, 0, 1).getTime();
    const m0 = new Date(y, m, 1).getTime(), m1 = new Date(y, m + 1, 1).getTime();
    const dow = (now.getDay() + 6) % 7; // Mon = 0 .. Sun = 6
    const wStart = new Date(y, m, d - dow, 0, 0, 0, 0);
    const wEnd = new Date(wStart.getFullYear(), wStart.getMonth(), wStart.getDate() + 7, 0, 0, 0, 0);
    const d0 = new Date(y, m, d, 0, 0, 0, 0).getTime(), d1 = new Date(y, m, d + 1, 0, 0, 0, 0).getTime();
    return [
      { key: "year", label: "Year", pct: clamp(((t - y0) / (y1 - y0)) * 100), color: "var(--accent)" },
      { key: "month", label: "Month", pct: clamp(((t - m0) / (m1 - m0)) * 100), color: "var(--green)" },
      { key: "week", label: "Week", pct: clamp(((t - wStart.getTime()) / (wEnd.getTime() - wStart.getTime())) * 100), color: "var(--yellow)" },
      { key: "day", label: "Day", pct: clamp(((t - d0) / (d1 - d0)) * 100), color: "var(--purple)" },
    ];
  });

  const goalLabel = $derived(str(options.label, propName || "Goal"));
  const goalTarget = $derived(Math.max(0.0001, num(options.target, 100)));
  const goalUnit = $derived(str(options.unit));
  const goalCurrent = $derived(canBindProp && propVal !== null ? propVal : num(options.current, 0));
  const goalPct = $derived(clamp((goalCurrent / goalTarget) * 100));
  const fmtVal = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  function parseDateSpec(raw: string, endOfDay: boolean) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw.trim());
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]), hasTime = m[4] !== undefined;
    const hh = hasTime ? Number(m[4]) : endOfDay ? 23 : 0;
    const mm = hasTime ? Number(m[5]) : endOfDay ? 59 : 0;
    const ss = hasTime ? Number(m[6] ?? 0) : endOfDay ? 59 : 0;
    const dt = new Date(y, mo - 1, d, hh, mm, ss, endOfDay && !hasTime ? 999 : 0);
    return Number.isNaN(dt.getTime()) ? null : { ms: dt.getTime(), y, m: mo, d, hh, mm, hasTime };
  }

  const countdown = $derived.by(() => {
    const yr = now.getFullYear();
    const tgt = parseDateSpec(str(options.target_date, `${yr}-12-31`), true) ?? parseDateSpec(`${yr}-12-31`, true)!;
    const st = parseDateSpec(str(options.start_date, `${yr}-01-01`), false) ?? parseDateSpec(`${yr}-01-01`, false)!;
    const spanStart = st.ms < tgt.ms ? st.ms : tgt.ms - 30 * 86_400_000;
    const elapsed = clamp(((now.getTime() - spanStart) / Math.max(1, tgt.ms - spanStart)) * 100);
    const today0 = new Date(yr, now.getMonth(), now.getDate()).getTime();
    const tgt0 = new Date(tgt.y, tgt.m - 1, tgt.d).getTime();
    const calDays = Math.round((tgt0 - today0) / 86_400_000);
    const diff = tgt.ms - now.getTime();
    const isToday = calDays === 0 && (!tgt.hasTime || diff <= 0);
    const isPast = !isToday && diff <= 0;
    const days = isPast ? Math.max(1, Math.abs(calDays)) : Math.floor(Math.max(0, diff) / 86_400_000);
    const hours = Math.floor((Math.max(0, diff) % 86_400_000) / 3_600_000);
    const mins = Math.floor((Math.max(0, diff) % 3_600_000) / 60_000);
    const dateStr = new Date(tgt.y, tgt.m - 1, tgt.d, tgt.hh, tgt.mm).toLocaleDateString(undefined, {
      weekday: "short", year: "numeric", month: "short", day: "numeric",
    }) + (tgt.hasTime ? ` · ${String(tgt.hh).padStart(2, "0")}:${String(tgt.mm).padStart(2, "0")}` : "");
    return { label: str(options.label, "Milestone"), isToday, isPast, days, hours, mins, dateStr, elapsed };
  });
</script>

<div class="widget" bind:this={rootEl}>
  {#if viewMode === "countdown"}
    <div class="cd-head">
      <span class="cd-label">{countdown.label}</span>
      {#if countdown.isToday}
        <span class="badge today">Today!</span>
      {:else if countdown.isPast}
        <span class="badge past">Passed</span>
      {/if}
    </div>
    <div class="cd-main">
      {#if countdown.isToday}
        <span class="cd-big accent-green">Today!</span>
      {:else if countdown.isPast}
        <span class="cd-big muted">{countdown.days}</span>
        <span class="cd-unit">{countdown.days === 1 ? "day" : "days"} ago</span>
      {:else}
        <span class="cd-big">{countdown.days}</span>
        <span class="cd-unit">{countdown.days === 1 ? "day" : "days"}</span>
        <span class="cd-hm">{String(countdown.hours).padStart(2, "0")}h {String(countdown.mins).padStart(2, "0")}m</span>
      {/if}
    </div>
    <div class="cd-sub">{countdown.dateStr}</div>
    <div class="bar-row">
      <div class="track"><div class="fill" style:width="{countdown.elapsed}%" style:background={countdown.isToday ? "var(--green)" : "var(--accent)"}></div></div>
      <span class="pct">{countdown.elapsed.toFixed(1)}%</span>
    </div>
  {:else}
    {#if kind === "time" || kind === "both"}
      <div class="rows">
        {#each timeRows as r (r.key)}
          <div class="time-row">
            <span class="r-lbl">{r.label}</span>
            <div class="track"><div class="fill" style:width="{r.pct}%" style:background={r.color}></div></div>
            <span class="pct">{r.pct.toFixed(1)}%</span>
          </div>
        {/each}
      </div>
    {/if}
    {#if kind === "goal" || kind === "both"}
      <div class="goal-box" class:divided={kind === "both"}>
        <div class="goal-head">
          <div class="goal-title">
            <span class="g-lbl">{goalLabel}</span>
            {#if canBindProp}<span class="prop-chip">{propName}</span>{/if}
          </div>
          <div class="goal-right">
            <span class="g-nums">
              {fmtVal(goalCurrent)} / {fmtVal(goalTarget)}{goalUnit ? ` ${goalUnit}` : ""}
            </span>
            {#if canBindProp}
              <div class="stepper">
                <button type="button" class="step-btn" disabled={saving || goalCurrent <= 0} onclick={() => void stepGoal(-1)} aria-label="Decrease {goalLabel}">−</button>
                <button type="button" class="step-btn" disabled={saving} onclick={() => void stepGoal(1)} aria-label="Increase {goalLabel}">+</button>
              </div>
            {/if}
          </div>
        </div>
        <div class="bar-row">
          <div class="track"><div class="fill" style:width="{goalPct}%" style:background={goalPct >= 100 ? "var(--green)" : "var(--orange)"}></div></div>
          <span class="pct">{goalPct.toFixed(1)}%</span>
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .widget {
    display: flex; flex-direction: column; gap: 10px; font-family: var(--font-ui); color: var(--text);
    background: var(--bg-alt); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px;
  }
  :global(.pb.card) .widget { background: none; border: 0; border-radius: 0; padding: 0; }
  .rows { display: flex; flex-direction: column; gap: 8px; }
  .time-row { display: grid; grid-template-columns: 52px minmax(0, 1fr) 48px; align-items: center; gap: 10px; }
  .bar-row { display: grid; grid-template-columns: minmax(0, 1fr) 48px; align-items: center; gap: 10px; }
  .r-lbl { font-size: 12.5px; font-weight: 500; color: var(--text-muted); }
  .track { height: 7px; border-radius: 99px; background: color-mix(in srgb, var(--text) 8%, transparent); border: 1px solid var(--border); overflow: hidden; }
  .fill { height: 100%; border-radius: 99px; transition: width 180ms ease; }
  .pct { font-family: var(--font-mono); font-size: 11.5px; font-variant-numeric: tabular-nums; color: var(--text-muted); text-align: right; }
  .goal-box { display: flex; flex-direction: column; gap: 7px; }
  .goal-box.divided { padding-top: 10px; border-top: 1px solid var(--border); }
  .goal-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .goal-title { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
  .g-lbl { font-size: 13px; font-weight: 600; color: var(--heading); }
  .prop-chip { font-family: var(--font-mono); font-size: 11px; padding: 1px 6px; border-radius: 4px; background: var(--accent-soft); color: var(--accent); }
  .goal-right { display: inline-flex; align-items: center; gap: 8px; }
  .g-nums { font-family: var(--font-mono); font-size: 12px; font-variant-numeric: tabular-nums; color: var(--text-muted); }
  .stepper { display: inline-flex; gap: 3px; }
  .step-btn { width: 22px; height: 22px; display: grid; place-items: center; border-radius: 5px; border: 1px solid var(--border-strong); background: var(--bg-elev); color: var(--text); font-family: var(--font-mono); font-size: 13px; cursor: pointer; }
  :global(html.phone) .step-btn { width: 40px; height: 40px; }
  .step-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .step-btn:disabled { opacity: 0.4; cursor: default; }
  .cd-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .cd-label { font-size: 13px; font-weight: 600; color: var(--heading); }
  .badge { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 99px; }
  .badge.today { background: color-mix(in srgb, var(--green) 15%, transparent); color: var(--green); }
  .badge.past { background: var(--bg-elev); color: var(--text-faint); border: 1px solid var(--border); }
  .cd-main { display: flex; align-items: baseline; gap: 7px; flex-wrap: wrap; }
  .cd-big { font-family: var(--font-mono); font-size: 28px; font-weight: 700; line-height: 1.05; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; color: var(--heading); }
  .cd-big.accent-green { color: var(--green); }
  .cd-big.muted { color: var(--text-muted); }
  .cd-unit { font-size: 14px; font-weight: 500; color: var(--text-muted); }
  .cd-hm { font-family: var(--font-mono); font-size: 13px; font-variant-numeric: tabular-nums; color: var(--text-faint); margin-left: 2px; }
  .cd-sub { font-size: 12px; color: var(--text-muted); }
</style>
