<script lang="ts">
  import { onMount } from "svelte";
  import { openPath } from "../../lib/dock";
  import { reloadOnChange } from "../../lib/reload-on-change";
  import { errReason } from "../../lib/text";
  import {
    CHART_KINDS,
    formatMetricValue,
    loadChartData,
    parseChartKind,
    type ChartDataset,
    type ChartKind,
  } from "../../lib/widgets/chart-data";

  let { options = {}, doc = "" }: { options?: Record<string, unknown>; doc?: string } = $props();

  let rootEl = $state<HTMLElement | null>(null);
  let data = $state<ChartDataset | null>(null);
  let error = $state("");
  let loading = $state(true);
  let overrideKind = $state<ChartKind | null>(null);

  const gradId = `kw-chart-grad-${Math.random().toString(36).slice(2, 9)}`;
  const optKind = $derived(parseChartKind(options.chart));
  $effect(() => { void optKind; overrideKind = null; });
  const chart = $derived<ChartKind>(overrideKind ?? optKind);

  const querySig = $derived(JSON.stringify([
    doc, options.path, options.view, options.group_by, options.metric, options.value_field, options.limit,
  ]));

  let reqSeq = 0;
  async function refresh(): Promise<void> {
    const seq = ++reqSeq;
    try {
      const next = await loadChartData(options, doc);
      if (seq !== reqSeq) return;
      data = next;
      error = "";
    } catch (e) {
      if (seq !== reqSeq) return;
      error = errReason(e);
    } finally {
      if (seq === reqSeq) loading = false;
    }
  }

  $effect(() => { void querySig; void refresh(); });

  onMount(() =>
    reloadOnChange(() => void refresh(), {
      wait: 350,
      wants: (p) => /\.(md|markdown|base|csv|tsv)$/i.test(p),
      host: () => rootEl,
    }),
  );

  const points = $derived(data?.points ?? []);
  const maxVal = $derived(Math.max(...points.map((p) => Math.max(0, p.value)), 0) || 1);
  const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s);

  const metricCaption = $derived.by(() => {
    if (!data) return "";
    if (data.metric === "count") return `by ${data.groupLabel}`;
    return `${data.metric}(${data.valueLabel || "value"}) by ${data.groupLabel}`;
  });

  // Shared SVG plot coordinates for column & line views (viewBox 520 x 204)
  const PL = { left: 42, right: 506, top: 24, bottom: 168, w: 464, h: 144 };

  const lineCoords = $derived(
    points.map((pt, i) => ({
      pt,
      x: points.length === 1 ? PL.left + PL.w / 2 : PL.left + (i / (points.length - 1)) * PL.w,
      y: PL.bottom - (Math.max(0, pt.value) / maxVal) * PL.h,
    })),
  );
  const linePoly = $derived(lineCoords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" "));
  const areaPoly = $derived.by(() => {
    if (!lineCoords.length) return "";
    if (lineCoords.length === 1) {
      const c = lineCoords[0];
      return `${PL.left + PL.w * 0.3},${PL.bottom} ${PL.left + PL.w * 0.3},${c.y.toFixed(1)} ${PL.left + PL.w * 0.7},${c.y.toFixed(1)} ${PL.left + PL.w * 0.7},${PL.bottom}`;
    }
    return `${lineCoords[0].x.toFixed(1)},${PL.bottom} ${linePoly} ${lineCoords[lineCoords.length - 1].x.toFixed(1)},${PL.bottom}`;
  });

  const CIRC = 2 * Math.PI * 56;
  const donutSlices = $derived.by(() => {
    const nonZero = points.filter((p) => p.pct > 0).length;
    let offset = 0;
    return points.map((pt) => {
      const raw = (Math.max(0, pt.pct) / 100) * CIRC;
      const gap = nonZero > 1 && raw > 3.5 ? 2 : 0;
      const slice = { pt, len: Math.max(0, raw - gap), offset };
      offset += raw;
      return slice;
    });
  });
</script>

<section class="kw-chart" bind:this={rootEl} aria-label="Chart widget">
  <header class="kw-head">
    <div class="kw-title-wrap">
      {#if data?.sourcePath}
        <button type="button" class="kw-source link" onclick={() => data?.sourcePath && openPath(data.sourcePath)} title="Open {data.sourcePath}">
          {data.sourceTitle}
        </button>
      {:else}
        <span class="kw-source">{data?.sourceTitle ?? "Chart"}</span>
      {/if}
      {#if metricCaption}
        <span class="kw-sub">{metricCaption}</span>
      {/if}
    </div>
    <div class="kw-pills" role="tablist" aria-label="Chart style">
      {#each CHART_KINDS as k (k.id)}
        <button
          type="button"
          role="tab"
          aria-selected={chart === k.id}
          class="kw-pill"
          class:active={chart === k.id}
          onclick={() => { overrideKind = k.id; }}
        >{k.label}</button>
      {/each}
    </div>
  </header>

  {#if error}
    <p class="kw-msg err">{error}</p>
  {:else if loading && !data}
    <p class="kw-msg">Loading chart…</p>
  {:else if !points.length}
    <p class="kw-msg">No matching entries to plot yet.</p>
  {:else if chart === "bar"}
    <div class="bar-list">
      {#each points as pt (pt.label)}
        <div class="bar-row" title="{pt.label}: {formatMetricValue(pt.value)} ({Math.round(pt.pct)}%)">
          <span class="bar-label">
            <span class="dot" style:background={pt.color}></span>
            <span class="lbl-txt">{pt.label}</span>
          </span>
          <div class="bar-track">
            <div
              class="bar-fill"
              style:width="{Math.max(pt.value > 0 ? 2 : 0, (Math.max(0, pt.value) / maxVal) * 100)}%"
              style:background={pt.color}
            ></div>
          </div>
          <span class="bar-stat">
            <strong class="val">{formatMetricValue(pt.value)}</strong>
            <span class="pct">{Math.round(pt.pct)}%</span>
          </span>
        </div>
      {/each}
    </div>
  {:else if chart === "column"}
    {@const slotW = PL.w / points.length}
    {@const barW = Math.min(42, Math.max(12, slotW * 0.56))}
    <svg class="plot-svg" viewBox="0 0 520 204" role="img" aria-label="Column chart">
      {#each [0, 0.5, 1] as frac (frac)}
        {@const gy = PL.bottom - frac * PL.h}
        <line x1={PL.left} y1={gy} x2={PL.right} y2={gy} stroke={frac === 0 ? "var(--border-strong)" : "var(--border)"} stroke-dasharray={frac === 0 ? undefined : "3 3"} />
        <text x={PL.left - 7} y={gy + 3.5} text-anchor="end" class="svg-axis">{formatMetricValue(maxVal * frac)}</text>
      {/each}
      {#each points as pt, i (pt.label)}
        {@const cx = PL.left + slotW * (i + 0.5)}
        {@const bh = Math.max(pt.value > 0 ? 3 : 0, (Math.max(0, pt.value) / maxVal) * PL.h)}
        {@const by = PL.bottom - bh}
        <g class="col-group">
          <title>{pt.label}: {formatMetricValue(pt.value)} ({Math.round(pt.pct)}%)</title>
          <rect x={cx - barW / 2} y={PL.top} width={barW} height={PL.h} rx="4" fill="var(--bg-hover)" opacity="0.55" />
          <rect x={cx - barW / 2} y={by} width={barW} height={bh} rx="4" fill={pt.color} />
          <text x={cx} y={Math.max(14, by - 6)} text-anchor="middle" class="svg-val">{formatMetricValue(pt.value)}</text>
          <text x={cx} y={188} text-anchor="middle" class="svg-lbl">{trunc(pt.label, points.length > 7 ? 7 : 11)}</text>
        </g>
      {/each}
    </svg>
  {:else if chart === "line"}
    <svg class="plot-svg" viewBox="0 0 520 204" role="img" aria-label="Line chart">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.24" />
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.01" />
        </linearGradient>
      </defs>
      {#each [0, 0.5, 1] as frac (frac)}
        {@const gy = PL.bottom - frac * PL.h}
        <line x1={PL.left} y1={gy} x2={PL.right} y2={gy} stroke={frac === 0 ? "var(--border-strong)" : "var(--border)"} stroke-dasharray={frac === 0 ? undefined : "3 3"} />
        <text x={PL.left - 7} y={gy + 3.5} text-anchor="end" class="svg-axis">{formatMetricValue(maxVal * frac)}</text>
      {/each}
      {#if areaPoly}<polygon points={areaPoly} fill="url(#{gradId})" />{/if}
      {#if lineCoords.length === 1}
        <line x1={PL.left + PL.w * 0.3} y1={lineCoords[0].y} x2={PL.left + PL.w * 0.7} y2={lineCoords[0].y} stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" />
      {:else}
        <polyline points={linePoly} fill="none" stroke="var(--accent)" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" />
      {/if}
      {#each lineCoords as c (c.pt.label)}
        <g>
          <title>{c.pt.label}: {formatMetricValue(c.pt.value)}</title>
          <circle cx={c.x} cy={c.y} r="7.5" fill={c.pt.color} opacity="0.18" />
          <circle cx={c.x} cy={c.y} r="4" fill="var(--card-bg, var(--bg))" stroke={c.pt.color} stroke-width="2.2" />
          {#if lineCoords.length <= 10}
            <text x={c.x} y={Math.max(14, c.y - 9)} text-anchor="middle" class="svg-val">{formatMetricValue(c.pt.value)}</text>
          {/if}
          <text x={c.x} y={188} text-anchor="middle" class="svg-lbl">{trunc(c.pt.label, lineCoords.length > 7 ? 7 : 11)}</text>
        </g>
      {/each}
    </svg>
  {:else}
    <div class="donut-layout">
      <svg class="donut-svg" viewBox="0 0 164 164" role="img" aria-label="Donut chart">
        <circle cx="82" cy="82" r="56" fill="none" stroke="var(--border)" stroke-width="18" />
        {#each donutSlices as s (s.pt.label)}
          {#if s.len > 0}
            <circle
              cx="82" cy="82" r="56" fill="none"
              stroke={s.pt.color} stroke-width="18"
              stroke-dasharray="{s.len} {CIRC}"
              stroke-dashoffset={-s.offset}
              transform="rotate(-90 82 82)"
            ><title>{s.pt.label}: {formatMetricValue(s.pt.value)} ({Math.round(s.pt.pct)}%)</title></circle>
          {/if}
        {/each}
        <text x="82" y="79" text-anchor="middle" class="donut-total">{formatMetricValue(data?.total ?? 0)}</text>
        <text x="82" y="96" text-anchor="middle" class="donut-cap">{data?.metric === "avg" ? "average" : data?.valueLabel || "total"}</text>
      </svg>
      <div class="donut-legend">
        {#each points as pt (pt.label)}
          <div class="leg-row" title="{pt.label}: {formatMetricValue(pt.value)} ({Math.round(pt.pct)}%)">
            <span class="dot" style:background={pt.color}></span>
            <span class="leg-lbl">{pt.label}</span>
            <strong class="val">{formatMetricValue(pt.value)}</strong>
            <span class="pct">{Math.round(pt.pct)}%</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</section>

<style>
  .kw-chart {
    display: flex; flex-direction: column; gap: 12px; font-family: var(--font-ui);
    background: var(--card-bg, var(--bg-alt)); border: 1px solid var(--border);
    border-radius: var(--radius-lg, 10px); padding: 14px 16px; min-width: 0;
  }
  :global(.pb.card) .kw-chart { background: transparent; border: 0; border-radius: 0; padding: 0; }
  .kw-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .kw-title-wrap { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .kw-source { font-size: calc(13.5px * var(--ui-scale, 1)); font-weight: 600; color: var(--heading); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kw-source.link { cursor: pointer; padding: 0; background: none; border: 0; font: inherit; font-weight: 600; color: var(--heading); }
  .kw-source.link:hover { color: var(--accent); }
  .kw-sub { font-size: calc(11.5px * var(--ui-scale, 1)); color: var(--text-faint); white-space: nowrap; }
  .kw-pills { display: inline-flex; padding: 2px; border-radius: 7px; background: var(--bg-alt); border: 1px solid var(--border); gap: 1px; }
  .kw-pill { padding: 2px 8px; border-radius: 5px; font-size: calc(11.5px * var(--ui-scale, 1)); color: var(--text-muted); cursor: pointer; border: 0; background: transparent; transition: background 120ms, color 120ms; }
  .kw-pill:hover { color: var(--text); }
  .kw-pill.active { background: var(--bg-elev); color: var(--heading); font-weight: 500; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12); }
  .kw-msg { margin: 4px 0; font-size: calc(12.5px * var(--ui-scale, 1)); color: var(--text-muted); }
  .kw-msg.err { color: var(--red); }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  .val { font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; }
  .pct { color: var(--text-faint); font-variant-numeric: tabular-nums; min-width: 32px; text-align: right; }

  .bar-list { display: flex; flex-direction: column; gap: 7px; }
  .bar-row { display: grid; grid-template-columns: minmax(90px, 148px) minmax(0, 1fr) auto; align-items: center; gap: 10px; font-size: calc(12.5px * var(--ui-scale, 1)); }
  .bar-label { display: inline-flex; align-items: center; gap: 7px; min-width: 0; color: var(--text); }
  .lbl-txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-track { height: 9px; border-radius: 999px; background: color-mix(in srgb, var(--text) 7%, transparent); overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 999px; transition: width 220ms var(--ease, ease); }
  .bar-stat { display: inline-flex; align-items: baseline; gap: 6px; font-size: calc(12px * var(--ui-scale, 1)); }

  .plot-svg { width: 100%; height: auto; max-height: 220px; display: block; overflow: visible; }
  .svg-axis { font-size: 10px; fill: var(--text-faint); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
  .svg-val { font-size: 10.5px; font-weight: 600; fill: var(--text); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
  .svg-lbl { font-size: 10.5px; fill: var(--text-muted); font-family: var(--font-ui); }

  .donut-layout { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }
  .donut-svg { width: 152px; height: 152px; flex: none; }
  .donut-total { font-size: 20px; font-weight: 700; fill: var(--heading); font-variant-numeric: tabular-nums; }
  .donut-cap { font-size: 10.5px; fill: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .donut-legend { flex: 1; min-width: 170px; display: flex; flex-direction: column; gap: 6px; font-size: calc(12.5px * var(--ui-scale, 1)); }
  .leg-row { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto auto; align-items: center; gap: 8px; }
  .leg-lbl { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
