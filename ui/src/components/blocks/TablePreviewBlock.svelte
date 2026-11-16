<script lang="ts">
  // Read-only scientific tabular preview block for .tsv, .csv, and .dat result files.
  import { onMount } from "svelte";
  import { parse as parseYaml } from "yaml";
  import Icon from "../Icon.svelte";
  import { openPath } from "../../lib/dock";
  import { basename, dirOf, resolveRel } from "../../lib/paths";
  import { reloadOnChange } from "../../lib/reload-on-change";
  import type { Table } from "../../lib/table";
  import { loadTable } from "../../lib/table-load";
  import { errReason } from "../../lib/text";
  import { resolveLink, vaultReady } from "../../lib/vault";

  let { options = {}, doc = "", source = "", info = "" }: {
    options?: Record<string, unknown>; doc?: string; source?: string; info?: string;
  } = $props();

  type NotationMode = "auto" | "scientific" | "fixed" | "raw";
  const SUP_DIGITS: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
  const FLOAT_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?$/;

  function toSuperscript(exp: number): string {
    const abs = String(Math.abs(Math.trunc(exp))).split("").map((d) => SUP_DIGITS[d] ?? d).join("");
    return exp < 0 ? `⁻${abs}` : abs;
  }

  function formatScientific(x: number, precision: number, trimZeros: boolean): string {
    if (x === 0) return trimZeros ? "0" : (0).toFixed(precision);
    const sign = x < 0 ? "−" : "";
    const [mantRaw, expRaw] = Math.abs(x).toExponential(precision).split("e");
    const mant = trimZeros ? mantRaw.replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1") : mantRaw;
    const exp = Number(expRaw);
    return exp === 0 ? `${sign}${mant}` : `${sign}${mant} × 10${toSuperscript(exp)}`;
  }

  function formatCell(raw: string, mode: NotationMode, precision: number): string {
    const t = raw.trim();
    if (!t || mode === "raw") return raw;
    const normalized = t.replace(/^[−–]/, "-").replace(/[dD]/, "e");
    if (!FLOAT_RE.test(normalized)) return raw;
    const x = Number(normalized);
    if (!Number.isFinite(x)) return raw;
    if (mode === "scientific") return formatScientific(x, precision, true);
    if (mode === "fixed") {
      const fixed = Math.abs(x).toFixed(precision);
      return x < 0 && Number(fixed) !== 0 ? `−${fixed}` : fixed;
    }
    const abs = Math.abs(x);
    const hasExp = /[eEdD]/.test(t);
    if (!hasExp && /^[+-]?\d+$/.test(normalized) && abs < 1e5) {
      return x < 0 ? `−${normalized.replace(/^[+-]/, "")}` : normalized.replace(/^\+/, "");
    }
    if (hasExp || (abs > 0 && (abs < 1e-3 || abs >= 1e5))) return formatScientific(x, precision, true);
    const rounded = Math.abs(x).toFixed(precision).replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1");
    return x < 0 && Number(rounded) !== 0 ? `−${rounded}` : rounded;
  }

  function parseNumeric(val: string): number {
    const t = val.trim().replace(/^[−–]/, "-").replace(/[dD]/, "e");
    return FLOAT_RE.test(t) ? Number(t) : NaN;
  }

  const merged = $derived.by((): Record<string, unknown> => {
    let fromFence: Record<string, unknown> = {};
    const trimmed = source.trim();
    if (trimmed) {
      try {
        const parsed = parseYaml(trimmed);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) fromFence = parsed as Record<string, unknown>;
        else if (typeof parsed === "string" && parsed.trim()) fromFence = { path: parsed.trim() };
      } catch {
        if (!trimmed.includes("\n") && !trimmed.includes(":")) fromFence = { path: trimmed };
      }
    }
    const base = { ...fromFence, ...options };
    if (!base.path && info.trim()) base.path = info.trim();
    return base;
  });

  const rawPath = $derived(typeof merged.path === "string" ? merged.path.replace(/^\[\[|\]\]$/g, "").split("|")[0].split("#")[0].trim() : "");
  const notation = $derived.by((): NotationMode => {
    const m = String(merged.format ?? merged.notation ?? "auto").toLowerCase();
    return m === "scientific" || m === "sci" ? "scientific" : m === "fixed" ? "fixed" : m === "raw" ? "raw" : "auto";
  });
  const precision = $derived(typeof merged.precision === "number" && Number.isFinite(merged.precision) ? Math.max(0, Math.min(12, Math.floor(merged.precision))) : 4);

  let rootEl = $state<HTMLElement | null>(null);
  let resolvedPath = $state("");
  let table = $state<Table | null>(null);
  let loading = $state(false);
  let errorMsg = $state("");
  let manualSort = $state<{ col: number; desc: boolean } | null>(null);

  $effect(() => { void merged.sort; void rawPath; manualSort = null; });

  async function resolveTablePath(target: string, fromDoc: string): Promise<string> {
    if (!target) return "";
    const fromDir = dirOf(fromDoc);
    await vaultReady().catch(() => {});
    const isRel = target.startsWith("./") || target.startsWith("../");
    const linked = resolveLink(target, fromDir, !isRel);
    return linked || (isRel || fromDir ? resolveRel(target, fromDir) : target.replace(/^\/+/, ""));
  }

  let loadSeq = 0;
  async function load(): Promise<void> {
    const target = rawPath;
    if (!target) { resolvedPath = ""; table = null; errorMsg = ""; loading = false; return; }
    const seq = ++loadSeq;
    loading = true;
    errorMsg = "";
    try {
      let candidate = await resolveTablePath(target, doc);
      let loaded: Table;
      try { loaded = await loadTable(candidate); }
      catch (firstErr) {
        const alt = target.replace(/^\/+/, "");
        if (alt && alt !== candidate) { loaded = await loadTable(alt); candidate = alt; }
        else throw firstErr;
      }
      if (seq !== loadSeq) return;
      resolvedPath = candidate;
      table = loaded;
    } catch (err) {
      if (seq !== loadSeq) return;
      table = null;
      errorMsg = errReason(err);
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  $effect(() => { void rawPath; void doc; void load(); });
  onMount(() => reloadOnChange(() => void load(), { wait: 300, wants: (p) => Boolean(resolvedPath) && p === resolvedPath, host: () => rootEl }));

  function resolveColumnIndex(spec: string, header: string[]): number {
    const s = spec.trim();
    if (!s) return -1;
    const exact = header.findIndex((h) => h === s);
    if (exact >= 0) return exact;
    const low = header.findIndex((h) => h.toLowerCase() === s.toLowerCase());
    if (low >= 0) return low;
    if (/^\d+$/.test(s)) {
      const idx = Number(s) - 1;
      if (idx >= 0 && idx < header.length) return idx;
    }
    return -1;
  }

  const colIndices = $derived.by((): number[] => {
    if (!table) return [];
    const all = table.header.map((_, i) => i);
    const rawCols = merged.columns;
    if (rawCols === undefined || rawCols === null || String(rawCols).trim() === "") return all;
    const tokens = Array.isArray(rawCols) ? rawCols.map(String) : String(rawCols).split(",");
    const picked = tokens.map((t) => resolveColumnIndex(t, table!.header)).filter((i) => i >= 0);
    return picked.length > 0 ? picked : all;
  });

  const activeSort = $derived.by((): { col: number; desc: boolean } | null => {
    if (manualSort) return manualSort;
    if (!table || typeof merged.sort !== "string" || !merged.sort.trim()) return null;
    const raw = merged.sort.trim();
    const col = resolveColumnIndex(raw.replace(/^[-+]/, "").trim(), table.header);
    return col >= 0 ? { col, desc: raw.startsWith("-") } : null;
  });

  const shownRows = $derived.by((): string[][] => {
    if (!table) return [];
    let rows = table.rows;
    const s = activeSort;
    if (s) {
      const dir = s.desc ? -1 : 1;
      rows = [...rows].sort((a, b) => {
        const av = a[s.col] ?? "", bv = b[s.col] ?? "";
        if (!av && !bv) return 0;
        if (!av) return 1;
        if (!bv) return -1;
        const an = parseNumeric(av), bn = parseNumeric(bv);
        if (!Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * dir;
        return av.localeCompare(bv, undefined, { numeric: true }) * dir;
      });
    }
    const sliceRaw = typeof merged.slice === "string" ? merged.slice.trim() : typeof merged.rows === "string" ? merged.rows.trim() : "";
    if (sliceRaw) {
      const m = /^(-?\d+)?\s*[:–-]\s*(-?\d+)?$/.exec(sliceRaw);
      if (m) {
        const a = m[1] !== undefined ? Number(m[1]) : 1;
        const b = m[2] !== undefined ? Number(m[2]) : rows.length;
        if (a < 0) return rows.slice(a);
        return rows.slice(a >= 1 ? a - 1 : 0, b >= 0 ? b : rows.length + b);
      }
    }
    const offset = typeof merged.offset === "number" && merged.offset > 0 ? Math.floor(merged.offset) : 0;
    const limit = typeof merged.limit === "number" && merged.limit > 0 ? Math.floor(merged.limit) : 25;
    return rows.slice(offset, offset + limit);
  });

  const delimBadge = $derived.by((): string => {
    const d = table?.delimiterName.toLowerCase() ?? "", p = resolvedPath || rawPath;
    if (d.includes("tab") || /\.tsv$/i.test(p)) return "TSV";
    if (d.includes("whitespace") || /\.dat$/i.test(p)) return "DAT";
    return "CSV";
  });

  function toggleSort(col: number): void {
    manualSort = activeSort?.col === col ? (activeSort.desc ? null : { col, desc: true }) : { col, desc: false };
  }
</script>

<section class="tp-card" bind:this={rootEl} data-testid="table-preview-block">
  <header class="tp-head">
    <div class="tp-meta">
      <span class="tp-badge">{delimBadge}</span>
      <span class="tp-file" title={resolvedPath || rawPath}>{resolvedPath || rawPath ? basename(resolvedPath || rawPath) : "Table preview"}</span>
      {#if table}<span class="tp-count">showing {shownRows.length} of {table.rows.length} rows</span>{/if}
    </div>
    {#if resolvedPath}
      <button type="button" class="btn btn-ghost" data-testid="table-preview-open-btn" onclick={() => openPath(resolvedPath)}>
        <Icon name="table" size={12} /> <span>Open table</span>
      </button>
    {/if}
  </header>

  {#if !rawPath}
    <p class="kandinsky-empty tp-pad">Add <code>path: path/to/results.tsv</code> (or <code>.csv</code>) to preview rows</p>
  {:else if loading && !table}
    <p class="kandinsky-empty tp-pad">Loading table…</p>
  {:else if errorMsg}
    <div class="tp-pad"><div class="kandinsky-notice error"><strong>Could not read table <code>{rawPath}</code></strong><span>{errorMsg}</span></div></div>
  {:else if table}
    <div class="tp-scroll scroll">
      <table class="tp-table">
        <thead>
          <tr>
            {#each colIndices as ci (ci)}
              {@const isNumCol = Boolean(table.numeric[ci])}
              {@const sorted = activeSort?.col === ci}
              <th class:num={isNumCol} aria-sort={sorted ? (activeSort?.desc ? "descending" : "ascending") : "none"}>
                <button type="button" class="th-btn" onclick={() => toggleSort(ci)}>
                  <span>{table.header[ci] ?? `Col ${ci + 1}`}</span>
                  {#if sorted}<span class="sort-mark">{activeSort?.desc ? "↓" : "↑"}</span>{/if}
                </button>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each shownRows as row, ri (ri)}
            <tr>
              {#each colIndices as ci (ci)}
                <td class:num={Boolean(table.numeric[ci])} title={row[ci] ?? ""}>{formatCell(row[ci] ?? "", notation, precision)}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<style>
  .tp-card { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--card-bg); color: var(--text); overflow: hidden; margin: 6px 0; }
  .tp-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; padding: 7px 11px; border-bottom: 1px solid var(--border); background: var(--bg-alt); }
  .tp-meta { display: inline-flex; align-items: center; gap: 7px; flex-wrap: wrap; min-width: 0; }
  .tp-head .btn { display: inline-flex; align-items: center; gap: 5px; height: 25px; padding: 0 9px; font-size: calc(12px * var(--ui-scale, 1)); }
  .tp-badge { padding: 1px 7px; border-radius: 999px; font-family: var(--font-mono); font-size: calc(10.5px * var(--ui-scale, 1)); font-weight: 700; color: var(--cyan); background: var(--cyan-soft); border: 1px solid color-mix(in srgb, var(--cyan) 35%, var(--border)); }
  .tp-file { font-family: var(--font-mono); font-size: calc(12px * var(--ui-scale, 1)); font-weight: 600; color: var(--heading); }
  .tp-count { font-size: calc(11.5px * var(--ui-scale, 1)); font-variant-numeric: tabular-nums; color: var(--text-muted); }
  .tp-pad { padding: 8px 12px; }
  .tp-scroll { overflow-x: auto; max-height: 440px; }
  .tp-table { width: 100%; border-collapse: collapse; font-size: calc(12.5px * var(--ui-scale, 1)); }
  .tp-table th, .tp-table td { padding: 5px 10px; border-bottom: 1px solid var(--border); text-align: left; white-space: nowrap; }
  .tp-table tbody tr:last-child td { border-bottom: 0; }
  .tp-table tbody tr:hover td { background: var(--bg-hover); }
  .tp-table th { position: sticky; top: 0; background: var(--bg-elev); color: var(--heading); font-weight: 600; z-index: 1; }
  .tp-table th.num, .tp-table td.num { text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
  .th-btn { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; color: inherit; cursor: pointer; }
  .sort-mark { color: var(--accent); font-family: var(--font-mono); }
</style>
