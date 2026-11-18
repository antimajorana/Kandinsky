<script lang="ts">
  // Guided formula builder popover for .base views: property chips, function hints, live sample preview, and save.
  import Icon from "../Icon.svelte";
  import { api } from "../../lib/api";
  import type { BaseCell } from "../../lib/gen/BaseCell";
  import type { BaseResult } from "../../lib/gen/BaseResult";
  import type { BaseView } from "../../lib/gen/BaseView";
  import type { FormulaPreviewResponse } from "../../lib/gen/FormulaPreviewResponse";
  import type { ViewEdit } from "../../lib/gen/ViewEdit";

  let {
    basePath,
    res,
    view,
    props,
    onedit,
    onclose,
  }: {
    basePath: string;
    res: BaseResult;
    view: BaseView;
    props: { id: string; label: string }[];
    onedit: (e: ViewEdit, then?: () => void) => void;
    onclose: () => void;
  } = $props();

  const existing = $derived(Object.entries(res.formula_exprs ?? {}));
  // svelte-ignore state_referenced_locally
  let name = $state(existing[0]?.[0] ?? "score");
  // svelte-ignore state_referenced_locally
  let expr = $state(existing[0]?.[1] ?? 'prop("status")');
  let preview = $state<FormulaPreviewResponse | null>(null);
  let busy = $state(false);
  let inputEl: HTMLTextAreaElement;

  const FUNCTIONS = [
    { label: 'if(cond, "A", "B")', sig: "if(cond, then, else) — Conditional branch" },
    { label: 'let(x, 1, x + 2)', sig: "let(name, val, ..., expr) — Local variable binding" },
    { label: 'dateBetween(prop("due"), today(), "days")', sig: 'dateBetween(a, b, "days"|"weeks"|"months") — Date delta' },
    { label: 'round(prop("hours"), 1)', sig: "round(num, digits) — Round number" },
    { label: 'concat(prop("code"), "-", prop("title"))', sig: "concat(a, b, ...) — Join strings" },
    { label: '.filter(value > 0)', sig: ".filter(predicate) — Keep list items; `value` is the current item" },
    { label: '.map(value * 2)', sig: ".map(transform) — Map list items; `value` is the current item" },
    { label: '.sum()', sig: ".sum() / .avg() — Numeric list aggregate" },
  ];

  function formatCell(c: BaseCell | null): string {
    if (!c || c.t === "null") return "—";
    if (c.t === "bool" || c.t === "num" || c.t === "text") return String(c.value);
    if (c.t === "date" || c.t === "link") return c.text;
    return `[${c.items.map(formatCell).join(", ")}]`;
  }

  $effect(() => {
    void view;
    const curExpr = expr.trim();
    const t = setTimeout(() => {
      if (!curExpr || !basePath) { preview = null; return; }
      busy = true;
      void api.formulaPreview({ path: basePath, expr: curExpr })
        .then((r) => { preview = r; })
        .catch(() => { preview = { ok: false, sample_title: "", value: null, kind: null, error: "Could not evaluate formula" }; })
        .finally(() => { busy = false; });
    }, 180);
    return () => clearTimeout(t);
  });

  function insertToken(tok: string): void {
    if (!inputEl) { expr += tok; return; }
    const s = inputEl.selectionStart ?? expr.length;
    const e = inputEl.selectionEnd ?? expr.length;
    expr = expr.slice(0, s) + tok + expr.slice(e);
    requestAnimationFrame(() => {
      inputEl.focus();
      inputEl.setSelectionRange(s + tok.length, s + tok.length);
    });
  }

  function pickExisting(n: string, x: string): void {
    name = n;
    expr = x;
  }

  function save(e: SubmitEvent): void {
    e.preventDefault();
    const clean = name.trim().replace(/^formula\./, "");
    if (!clean || !expr.trim()) return;
    onedit({ op: "formula", name: clean, expr: expr.trim() }, onclose);
  }
</script>

<form class="fx-pop" onsubmit={save} data-testid="formula-editor-popover">
  <header class="fx-head">
    <strong>Guided Formula Builder</strong>
    <button type="button" class="x" onclick={onclose} aria-label="Close"><Icon name="close" size={12} /></button>
  </header>

  {#if existing.length > 0}
    <div class="chips-row">
      {#each existing as [fnName, fnExpr] (fnName)}
        <button type="button" class="chip" class:active={name === fnName} onclick={() => pickExisting(fnName, fnExpr)}>formula.{fnName}</button>
      {/each}
    </div>
  {/if}

  <label class="fld">
    <span>Column name</span>
    <input placeholder="score" bind:value={name} required />
  </label>

  <label class="fld">
    <span>Expression</span>
    <textarea bind:this={inputEl} rows="3" bind:value={expr} spellcheck="false" placeholder='if(prop("done"), 100, 0)'></textarea>
  </label>

  <div class="section-lbl">Properties</div>
  <div class="chips-row">
    {#each props.slice(0, 12) as p (p.id)}
      {@const key = p.id.replace(/^note\./, "")}
      <button type="button" class="chip" onclick={() => insertToken(/^(file|formula)\./.test(p.id) ? p.id : `prop("${key}")`)}>{p.label}</button>
    {/each}
  </div>

  <div class="section-lbl">Functions</div>
  <div class="fn-list">
    {#each FUNCTIONS as fn (fn.label)}
      <button type="button" class="fn-item" title={fn.sig} onclick={() => insertToken(fn.label)}>
        <code>{fn.label}</code>
        <span>{fn.sig.split("—")[1]?.trim() ?? ""}</span>
      </button>
    {/each}
  </div>

  <div class="preview-box" class:err={preview && !preview.ok}>
    <span class="pv-lbl">{busy ? "Checking…" : preview?.ok ? "Live sample output" : "Syntax check"}</span>
    {#if preview && !preview.ok}
      <p class="pv-err">{preview.error ?? "Invalid expression"}</p>
    {:else if preview && preview.ok}
      <ul class="pv-list">
        <li><span class="pv-path">{preview.sample_title || "Sample"}</span><code>{formatCell(preview.value)}</code></li>
      </ul>
    {:else}
      <p class="pv-empty">Type a formula above to preview its output on rows in this view.</p>
    {/if}
  </div>

  <footer class="fx-foot">
    {#if existing.some(([fnName]) => fnName === name)}
      <button type="button" class="del" onclick={() => onedit({ op: "formula", name, expr: null }, onclose)}>Remove</button>
    {:else}<span></span>{/if}
    <div class="right">
      <button type="button" class="ghost" onclick={onclose}>Cancel</button>
      <button type="submit" class="save" disabled={!name.trim() || !expr.trim()}>Save formula</button>
    </div>
  </footer>
</form>

<style>
  .fx-pop { display: flex; flex-direction: column; gap: 8px; font-size: 12px; color: var(--text); }
  .fx-head { display: flex; align-items: center; justify-content: space-between; color: var(--heading); font-size: 13px; }
  .fx-head .x { color: var(--text-faint); padding: 2px; border-radius: 4px; }
  .fld { display: flex; flex-direction: column; gap: 3px; color: var(--text-muted); }
  .fld input, .fld textarea { padding: 6px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-strong); background: var(--bg); color: var(--text); font-family: var(--font-mono); font-size: 12px; }
  .fld input:focus, .fld textarea:focus { outline: none; border-color: var(--accent); }
  .section-lbl { font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--text-faint); }
  .chips-row { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip { padding: 2px 7px; border-radius: 999px; background: var(--bg-side); border: 1px solid var(--border); color: var(--text-muted); font-size: 11px; }
  .chip:hover, .chip.active { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
  .fn-list { display: flex; flex-direction: column; gap: 2px; max-height: 110px; overflow-y: auto; }
  .fn-item { display: flex; justify-content: space-between; gap: 8px; padding: 3px 6px; border-radius: 4px; text-align: left; color: var(--text-muted); font-size: 11px; }
  .fn-item:hover { background: var(--bg-hover); color: var(--text); }
  .fn-item code { color: var(--accent); font-family: var(--font-mono); white-space: nowrap; }
  .preview-box { padding: 7px 9px; border-radius: var(--radius); background: var(--bg-side); border: 1px solid var(--border); }
  .preview-box.err { background: var(--red-soft); border-color: color-mix(in srgb, var(--red) 40%, transparent); }
  .pv-lbl { display: block; font-size: 10.5px; font-weight: 600; color: var(--text-faint); margin-bottom: 4px; }
  .pv-err { margin: 0; color: var(--red); }
  .pv-empty { margin: 0; color: var(--text-faint); }
  .pv-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; }
  .pv-list li { display: flex; justify-content: space-between; gap: 8px; }
  .pv-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted); }
  .fx-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 4px; border-top: 1px solid var(--border); }
  .right { display: inline-flex; gap: 6px; }
  .ghost { padding: 4px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border); color: var(--text-muted); }
  .del { padding: 4px 10px; border-radius: var(--radius-sm); color: var(--red); }
  .save { padding: 4px 12px; border-radius: var(--radius-sm); background: var(--accent); color: var(--accent-fg); font-weight: 600; }
</style>
