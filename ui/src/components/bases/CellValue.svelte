<script lang="ts">
  // One Bases value: lists as chips, links, checkboxes, humanized dates, aligned numbers, plus Nootion column formats
  // (semantic status pills with 1-click dot cycling, inline progress bars, %, currency, compact URL/email/phone, files).
  import Icon from "../Icon.svelte";
  import Self from "./CellValue.svelte";
  import type { BaseCell } from "../../lib/gen/BaseCell";
  import type { BaseColumn } from "../../lib/gen/BaseColumn";
  import type { IconName } from "../../lib/panes";
  import {
    classifyStatus,
    compactUrlLabel,
    effectiveColumnFormat,
    formatCurrency,
    nextStatusValue,
  } from "../../lib/base-format";
  import { openPath } from "../../lib/dock";
  import { basename, IMAGE_RE } from "../../lib/paths";
  import { resolveLink } from "../../lib/vault";
  import { openOutside } from "../../lib/web-links";

  let { cell, column, oncycle }: {
    cell: BaseCell;
    column?: BaseColumn;
    oncycle?: () => void;
  } = $props();

  const fmt = $derived(effectiveColumnFormat(column, cell));
  const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(Math.abs(n) < 1 ? 3 : 2));
  const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/;

  function shortDate(v: string): string | null {
    const m = ISO.exec(v.trim());
    if (!m || v.trim().length > 30) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0));
    const now = new Date();
    if (m[4] && d.toDateString() === now.toDateString()) return `${m[4]}:${m[5]}`;
    return d.toLocaleDateString(
      undefined,
      d.getFullYear() === now.getFullYear()
        ? { day: "numeric", month: "short" }
        : { day: "numeric", month: "short", year: "numeric" },
    );
  }

  function numVal(c: BaseCell): number | null {
    if (c.t === "num") return c.value;
    if (c.t === "text" && c.value.trim() !== "") {
      const n = Number(c.value.trim().replace(/%$/, ""));
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  function parseFile(raw: string, knownPath?: string | null): { resolved: string; label: string; icon: IconName } {
    const inner = raw.trim().replace(/^!\[\[/, "").replace(/^\[\[/, "").replace(/\]\]$/, "");
    const [targetPart, alias] = inner.split("|");
    const target = targetPart.split("#")[0].trim();
    const resolved = knownPath ?? (target ? resolveLink(target, "") ?? target : raw.trim());
    const label = alias?.trim() || basename(target || resolved);
    const probe = resolved || target;
    const icon: IconName = /\.pdf$/i.test(probe) ? "pdf" : IMAGE_RE.test(probe) ? "image" : "file";
    return { resolved, label, icon };
  }

  const selfStyled = (it: BaseCell) => {
    const f = effectiveColumnFormat(column, it);
    return f === "status" || f === "file" || f === "url" || f === "email" || f === "phone";
  };
</script>

{#if cell.t === "list"}
  <span class="chips">
    {#each cell.items as it, i (i)}
      <span class="chip" class:bare={selfStyled(it)} class:linkchip={it.t === "link"}><Self cell={it} {column} /></span>
    {/each}
  </span>
{:else if fmt === "status" && cell.t === "text" && cell.value.trim()}
  {@const st = classifyStatus(cell.value)}
  <span class="status-pill tone-{st.tone}">
    {#if oncycle}
      <button
        type="button"
        class="status-dot cycle"
        title="Cycle status ({st.label} → {nextStatusValue(cell.value)})"
        aria-label="Cycle status from {st.label}"
        onclick={(e) => { e.stopPropagation(); oncycle(); }}
      ></button>
    {:else}
      <span class="status-dot" aria-hidden="true"></span>
    {/if}
    <span class="status-lbl">{st.label}</span>
  </span>
{:else if fmt === "progress" && numVal(cell) !== null}
  {@const val = numVal(cell)!}
  {@const target = column?.max != null && column.max > 0 ? column.max : 100}
  {@const pct = Math.round((val / target) * 100)}
  {@const fill = Math.max(0, Math.min(100, pct))}
  <span class="progress" title="{num(val)} / {target} ({pct}%)">
    <span class="progress-track"><span class="progress-fill" class:done={pct >= 100} style:width="{fill}%"></span></span>
    <span class="progress-lbl">{pct}%</span>
  </span>
{:else if fmt === "percent" && numVal(cell) !== null}
  <span class="num">{num(numVal(cell)!)}%</span>
{:else if fmt === "currency" && numVal(cell) !== null}
  <span class="num">{formatCurrency(numVal(cell)!, column?.currency ?? "€")}</span>
{:else if fmt === "url" && cell.t === "text" && cell.value.trim()}
  {@const raw = cell.value.trim()}
  {@const href = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`}
  <button type="button" class="ext-chip" title={href} onclick={(e) => { e.stopPropagation(); void openOutside(href); }}>
    <Icon name="external-link" size={11} /><span class="ext-lbl">{compactUrlLabel(href)}</span>
  </button>
{:else if fmt === "email" && cell.t === "text" && cell.value.trim()}
  {@const addr = cell.value.trim().replace(/^mailto:/i, "")}
  <button type="button" class="ext-chip" title="mailto:{addr}" onclick={(e) => { e.stopPropagation(); void openOutside(`mailto:${addr}`); }}>
    <Icon name="mail" size={11} /><span class="ext-lbl">{addr}</span>
  </button>
{:else if fmt === "phone" && cell.t === "text" && cell.value.trim()}
  {@const clean = cell.value.trim().replace(/^tel:/i, "")}
  {@const dial = clean.replace(/[^\d+]/g, "") || clean}
  <button type="button" class="ext-chip phone" title="tel:{dial}" onclick={(e) => { e.stopPropagation(); void openOutside(`tel:${dial}`); }}>
    <Icon name="external-link" size={11} /><span class="ext-lbl">{clean}</span>
  </button>
{:else if fmt === "file" && ((cell.t === "text" && cell.value.trim()) || cell.t === "link")}
  {@const f = cell.t === "link" ? parseFile(cell.text, cell.path) : parseFile(cell.value)}
  <button type="button" class="file-chip" title={f.resolved} onclick={(e) => { e.stopPropagation(); openPath(f.resolved); }}>
    <Icon name={f.icon} size={12} /><span class="ext-lbl">{f.label}</span>
  </button>
{:else if cell.t === "link"}
  {#if cell.path}<button type="button" class="link" onclick={(e) => { e.stopPropagation(); openPath(cell.path!); }}>{cell.text}</button>{:else}<span class="link missing">{cell.text}</span>{/if}
{:else if cell.t === "bool"}
  <span class="check" class:on={cell.value} role="img" aria-label={cell.value ? "checked" : "not checked"}>
    {#if cell.value}<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>{/if}
  </span>
{:else if cell.t === "num"}
  <span class="num">{num(cell.value)}</span>
{:else if cell.t === "date" || (cell.t === "text" && shortDate(cell.value))}
  {@const raw = cell.t === "date" ? cell.text : cell.value}
  <span class="date" title={raw}>{shortDate(raw) ?? raw}</span>
{:else if cell.t === "text"}
  {cell.value}
{/if}

<style>
  .link { color: var(--link, var(--accent)); padding: 0; font: inherit; background: none; border: 0; cursor: pointer; text-align: left; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .link:hover { text-decoration: underline; }
  .link.missing { color: var(--text-faint); cursor: default; }
  .chips { display: inline-flex; gap: 4px; flex-wrap: nowrap; max-width: 100%; overflow: hidden; vertical-align: middle; }
  .chip { flex: none; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 8px; line-height: 20px; border-radius: 999px; background: var(--accent-soft); color: var(--text); font-size: .92em; }
  .chip.bare { padding: 0; background: none; overflow: visible; }
  .check { display: inline-grid; place-items: center; width: 15px; height: 15px; border-radius: 4px; border: 1.5px solid var(--border-strong); vertical-align: middle; color: var(--accent-fg); }
  .check.on { background: var(--accent); border-color: var(--accent); }
  .num, .date, .phone { font-variant-numeric: tabular-nums; }

  .status-pill { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; height: 21px; padding: 0 8px 0 6px; border-radius: 999px; font-size: .88em; font-weight: 500; line-height: 1; vertical-align: middle; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); }
  .status-lbl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .status-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: currentColor; padding: 0; border: 0; }
  .status-dot.cycle { cursor: pointer; position: relative; transition: transform .12s ease; }
  .status-dot.cycle::after { content: ""; position: absolute; inset: -5px; }
  .status-dot.cycle:hover { transform: scale(1.35); }
  .status-pill.tone-todo { background: var(--bg-hover); color: var(--text-muted); border-color: var(--border-strong); }
  .status-pill.tone-progress { background: var(--accent-soft); color: var(--accent); }
  .status-pill.tone-blocked { background: var(--red-soft, color-mix(in srgb, var(--red) 12%, transparent)); color: var(--red); }
  .status-pill.tone-done { background: var(--green-soft, color-mix(in srgb, var(--green) 12%, transparent)); color: var(--green); }
  .status-pill.tone-review { background: var(--yellow-soft, color-mix(in srgb, var(--yellow) 12%, transparent)); color: var(--yellow); }
  .status-pill.tone-other { background: var(--accent-soft); color: var(--text); border-color: var(--border); }
  .status-pill.tone-other .status-dot { background: var(--accent); }

  .progress { display: inline-flex; align-items: center; gap: 7px; width: 100%; min-width: 72px; max-width: 190px; vertical-align: middle; }
  .progress-track { flex: 1; height: 6px; border-radius: 99px; background: color-mix(in srgb, var(--text) 11%, transparent); overflow: hidden; }
  .progress-fill { display: block; height: 100%; border-radius: 99px; background: var(--accent); transition: width .15s ease; }
  .progress-fill.done { background: var(--green); }
  .progress-lbl { flex: none; min-width: 32px; text-align: right; font-size: .86em; color: var(--text-muted); font-variant-numeric: tabular-nums; }

  .ext-chip, .file-chip { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; height: 21px; padding: 0 7px; border-radius: var(--radius-sm); background: var(--bg-hover); border: 1px solid var(--border); color: var(--link, var(--accent)); font: inherit; font-size: .88em; cursor: pointer; vertical-align: middle; }
  .file-chip { color: var(--text); }
  .ext-chip:hover, .file-chip:hover { border-color: var(--border-strong); background: var(--accent-soft); }
  .ext-chip :global(.icon), .file-chip :global(.icon) { flex: none; color: var(--text-muted); }
  .ext-lbl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
</style>
