<script lang="ts">
  // Read-only transclusion card for Jupyter (.ipynb) and legacy (.wln) notebook cells & outputs.
  // Strictly read-only: parses static JSON / .wln text via notebook-format.ts and never invokes any kernel.
  import { onMount } from "svelte";
  import { parse as parseYaml } from "yaml";
  import Icon from "../Icon.svelte";
  import Markdown from "../Markdown.svelte";
  import { api } from "../../lib/api";
  import { open } from "../../lib/dock";
  import { parseNotebook, type NotebookCell, type NotebookDoc } from "../../lib/notebook-format";
  import { basename, dirOf, resolveRel } from "../../lib/paths";
  import { reloadOnChange } from "../../lib/reload-on-change";
  import { toast } from "../../lib/state.svelte";
  import { errReason } from "../../lib/text";
  import { resolveLink, vaultReady } from "../../lib/vault";

  let { options = {}, doc = "", source = "", info = "" }: {
    options?: Record<string, unknown>; doc?: string; source?: string; info?: string;
  } = $props();

  interface IndexedCell { index: number; cell: NotebookCell }
  interface CodeToken { cls: "" | "kw" | "str" | "num" | "cmt" | "fn"; text: string }

  const PY_KW = new Set([
    "import", "from", "as", "def", "return", "class", "for", "in", "if", "elif", "else",
    "while", "with", "try", "except", "finally", "raise", "yield", "lambda", "True", "False",
    "None", "and", "or", "not", "is", "pass", "break", "continue", "assert",
  ]);
  const WL_KW = new Set([
    "Module", "Block", "With", "Table", "Map", "Plot", "ListPlot", "ListLinePlot", "Simplify",
    "FullSimplify", "Solve", "NSolve", "Eigenvalues", "Eigenvectors", "Eigensystem", "Sum",
    "Integrate", "NIntegrate", "Series", "Limit", "If", "Which", "Do", "For", "True", "False", "Print",
  ]);
  const TOKEN_RE = /(\(\*[\s\S]*?\*\)|#[^\n]*|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\b[A-Za-z_]\w*(?=\s*[\[(])|\b[A-Za-z_]\w*\b)/g;

  function tokenizeCode(code: string, lang: "python" | "wolfram" | "raw"): CodeToken[] {
    if (lang === "raw" || !code) return [{ cls: "", text: code }];
    const kwSet = lang === "wolfram" ? WL_KW : PY_KW;
    const out: CodeToken[] = [];
    let last = 0;
    for (const m of code.matchAll(TOKEN_RE)) {
      const idx = m.index ?? 0;
      if (idx > last) out.push({ cls: "", text: code.slice(last, idx) });
      const tok = m[0];
      let cls: CodeToken["cls"] = "";
      if ((lang === "python" && tok.startsWith("#")) || (lang === "wolfram" && tok.startsWith("(*"))) cls = "cmt";
      else if (tok.startsWith('"') || tok.startsWith("'")) cls = "str";
      else if (/^\d/.test(tok)) cls = "num";
      else if (kwSet.has(tok)) cls = "kw";
      else if (idx + tok.length < code.length && /^[\s]*[\[(]/.test(code.slice(idx + tok.length, idx + tok.length + 3))) cls = "fn";
      out.push({ cls, text: tok });
      last = idx + tok.length;
    }
    if (last < code.length) out.push({ cls: "", text: code.slice(last) });
    return out;
  }

  function svgDataUri(svg: string): string {
    const bytes = new TextEncoder().encode(svg);
    const chunks: string[] = [];
    for (let i = 0; i < bytes.length; i += 0x8000) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
    return `data:image/svg+xml;base64,${btoa(chunks.join(""))}`;
  }

  const formatLatexOutput = (latex: string): string => `$$\n${latex.trim().replace(/^\$\$?|\$\$?$/g, "").trim()}\n$$`;

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
  const showInput = $derived(merged.show_input !== false);
  const showOutput = $derived(merged.show_output !== false);
  const limitOpt = $derived(typeof merged.limit === "number" && merged.limit > 0 ? Math.floor(merged.limit) : 6);

  let rootEl = $state<HTMLElement | null>(null);
  let resolvedPath = $state("");
  let nb = $state<NotebookDoc | null>(null);
  let loading = $state(false);
  let errorMsg = $state("");

  async function resolveNotebookPath(target: string, fromDoc: string): Promise<string> {
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
    if (!target) { resolvedPath = ""; nb = null; errorMsg = ""; loading = false; return; }
    const seq = ++loadSeq;
    loading = true;
    errorMsg = "";
    try {
      let candidate = await resolveNotebookPath(target, doc);
      let fileDoc;
      try { fileDoc = await api.file(candidate); }
      catch (firstErr) {
        const alt = target.replace(/^\/+/, "");
        if (alt && alt !== candidate) { fileDoc = await api.file(alt); candidate = alt; }
        else throw firstErr;
      }
      if (seq !== loadSeq) return;
      resolvedPath = candidate;
      nb = parseNotebook(candidate, fileDoc.text);
    } catch (err) {
      if (seq !== loadSeq) return;
      nb = null;
      errorMsg = errReason(err);
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  $effect(() => { void rawPath; void doc; void load(); });
  onMount(() => reloadOnChange(() => void load(), { wait: 300, wants: (p) => Boolean(resolvedPath) && p === resolvedPath, host: () => rootEl }));

  function parseCellSelector(spec: unknown, total: number): number[] {
    const picked: number[] = [];
    const pushIdx = (n: number) => { if (Number.isInteger(n) && n >= 1 && n <= total && !picked.includes(n)) picked.push(n); };
    const parts = Array.isArray(spec) ? spec.map(String) : String(spec).split(",");
    for (const raw of parts) {
      const s = raw.trim();
      const range = /^(\d+)\s*[-–:]\s*(\d+)$/.exec(s);
      if (range) {
        const lo = Math.min(Number(range[1]), Number(range[2]));
        const hi = Math.max(Number(range[1]), Number(range[2]));
        for (let k = lo; k <= hi; k++) pushIdx(k);
      } else if (/^\d+$/.test(s)) pushIdx(Number(s));
    }
    return picked;
  }

  function cellHasTag(cell: NotebookCell, want: string): boolean {
    const low = want.toLowerCase();
    const metaTags = cell.rawMeta?.tags;
    if (Array.isArray(metaTags) && metaTags.some((t) => String(t).trim().toLowerCase() === low)) return true;
    for (const line of cell.source.split(/\r?\n/)) {
      const py = /^\s*#\s*@?tag:\s*(.+?)\s*$/i.exec(line);
      if (py && py[1].split(/[,\s]+/).some((t) => t.toLowerCase() === low)) return true;
      const wl = /\(\*\s*@?tag:\s*(.+?)\s*\*\)/i.exec(line);
      if (wl && wl[1].split(/[,\s]+/).some((t) => t.toLowerCase() === low)) return true;
    }
    return false;
  }

  function selectByHeading(all: IndexedCell[], query: string): IndexedCell[] {
    const want = query.trim().toLowerCase();
    const headingsOf = (src: string) => [...src.matchAll(/^(#{1,6})\s+(.+?)\s*$/gm)].map((m) => ({ level: m[1].length, title: m[2].trim().toLowerCase() }));
    let startIdx = all.findIndex((ic) => ic.cell.kind === "markdown" && headingsOf(ic.cell.source).some((h) => h.title === want));
    if (startIdx < 0) startIdx = all.findIndex((ic) => ic.cell.kind === "markdown" && headingsOf(ic.cell.source).some((h) => h.title.includes(want)));
    if (startIdx < 0) return [];
    const matched = headingsOf(all[startIdx].cell.source);
    const baseLevel = (matched.find((h) => h.title === want) ?? matched.find((h) => h.title.includes(want)))?.level ?? 1;
    const slice: IndexedCell[] = [all[startIdx]];
    for (let i = startIdx + 1; i < all.length; i++) {
      if (all[i].cell.kind === "markdown" && headingsOf(all[i].cell.source).some((h) => h.level <= baseLevel)) break;
      slice.push(all[i]);
    }
    return slice;
  }

  const selection = $derived.by((): { items: IndexedCell[]; badge: string } => {
    if (!nb) return { items: [], badge: "" };
    const all: IndexedCell[] = nb.cells.map((cell, i) => ({ index: i + 1, cell }));
    const total = all.length;
    const cellSpec = merged.cells ?? merged.cell ?? merged.index;
    const headingSpec = typeof merged.heading === "string" ? merged.heading.trim() : "";
    const tagSpec = typeof merged.tag === "string" ? merged.tag.trim() : "";

    if (cellSpec !== undefined && cellSpec !== null && String(cellSpec).trim() !== "") {
      const nums = parseCellSelector(cellSpec, total);
      const items = nums.map((n) => all[n - 1]).filter(Boolean);
      return { items, badge: nums.length === 1 ? `Cell ${nums[0]} of ${total}` : `Cells ${String(cellSpec).trim()} (${items.length}/${total})` };
    }
    if (headingSpec) {
      const items = selectByHeading(all, headingSpec);
      const capped = typeof merged.limit === "number" ? items.slice(0, limitOpt) : items;
      return { items: capped, badge: `§ ${headingSpec} · ${capped.length} cell${capped.length === 1 ? "" : "s"}` };
    }
    if (tagSpec) {
      const items = all.filter((ic) => cellHasTag(ic.cell, tagSpec));
      const capped = typeof merged.limit === "number" ? items.slice(0, limitOpt) : items;
      return { items: capped, badge: `#${tagSpec} · ${capped.length} cell${capped.length === 1 ? "" : "s"}` };
    }
    const items = all.slice(0, limitOpt);
    return { items, badge: total <= items.length ? `${total} cell${total === 1 ? "" : "s"}` : `Cells 1–${items.length} of ${total}` };
  });

  const isWln = $derived(nb ? nb.format === "wln" : /\.wln$/i.test(resolvedPath || rawPath));

  async function revealNotebook(): Promise<void> {
    if (!resolvedPath) return;
    try { await api.revealOutside(resolvedPath); }
    catch (err) { toast("Could not reveal file", errReason(err), "error"); }
  }
</script>

<section class="nbp-card" bind:this={rootEl} data-testid="notebook-preview-block">
  <header class="nbp-head">
    <div class="nbp-meta">
      <span class="nbp-lang" class:wln={isWln}>
        <Icon name="sigma" size={12} />
        <span>{isWln ? "Legacy · .wln" : "Python · .ipynb"}</span>
      </span>
      <span class="nbp-file" title={resolvedPath || rawPath}>{resolvedPath || rawPath ? basename(resolvedPath || rawPath) : "Notebook preview"}</span>
      {#if selection.badge}<span class="nbp-range">{selection.badge}</span>{/if}
    </div>
    {#if resolvedPath}
      <div class="nbp-actions">
        <button type="button" class="btn btn-ghost" data-testid="nb-preview-open-btn" onclick={() => open({ kind: "notebook", path: resolvedPath })}>
          <Icon name="sigma" size={12} /> <span>Open notebook</span>
        </button>
        <button type="button" class="btn btn-ghost" data-testid="nb-preview-reveal-btn" onclick={() => void revealNotebook()}>
          <Icon name="folder-open" size={12} /> <span>Reveal file</span>
        </button>
      </div>
    {/if}
  </header>

  <div class="nbp-body">
    {#if !rawPath}
      <p class="kandinsky-empty">Add <code>path: path/to/notebook.ipynb</code> to preview cells</p>
    {:else if loading && !nb}
      <p class="kandinsky-empty">Loading notebook preview…</p>
    {:else if errorMsg}
      <div class="kandinsky-notice error"><strong>Could not read notebook <code>{rawPath}</code></strong><span>{errorMsg}</span></div>
    {:else if selection.items.length === 0}
      <p class="kandinsky-empty">No matching cells found in <code>{basename(resolvedPath)}</code></p>
    {:else}
      {#each selection.items as { index, cell } (cell.id)}
        {#if cell.kind === "markdown"}
          {#if showInput && cell.source.trim()}
            <div class="nbp-md"><Markdown text={cell.source} path={resolvedPath} /></div>
          {/if}
        {:else}
          <div class="nbp-cell" data-cell-index={index}>
            {#if showInput && cell.source.trim()}
              <div class="nbp-io-row">
                <span class="nbp-prompt">In [{cell.executionCount ?? index}]:</span>
                <pre class="nbp-code"><code>{#each tokenizeCode(cell.source, cell.language) as tok, ti (ti)}{#if tok.cls}<span class={`tok-${tok.cls}`}>{tok.text}</span>{:else}{tok.text}{/if}{/each}</code></pre>
              </div>
            {/if}
            {#if showOutput && cell.outputs.length > 0}
              <div class="nbp-io-row out-row">
                <span class="nbp-prompt out">Out [{cell.executionCount ?? index}]:</span>
                <div class="nbp-outputs">
                  {#each cell.outputs as out, oi (oi)}
                    {#if out.type === "stream"}
                      <pre class="nbp-stream" class:stderr={out.stream === "stderr"}>{out.text}</pre>
                    {:else if out.type === "error"}
                      <pre class="nbp-error">{out.traceback || `${out.ename}: ${out.evalue}`}</pre>
                    {:else if out.type === "display"}
                      {#if out.png}<div class="nbp-plot"><img src={`data:image/png;base64,${out.png}`} alt="Notebook plot" /></div>{/if}
                      {#if out.svg}<div class="nbp-plot"><img src={svgDataUri(out.svg)} alt="Notebook plot" /></div>{/if}
                      {#if out.latex}<div class="nbp-rich"><Markdown text={formatLatexOutput(out.latex)} path={resolvedPath} /></div>{/if}
                      {#if out.markdown}<div class="nbp-rich"><Markdown text={out.markdown} path={resolvedPath} /></div>{/if}
                      {#if out.plain && !out.png && !out.svg && !out.latex && !out.markdown}<pre class="nbp-plain">{out.plain}</pre>{/if}
                    {/if}
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        {/if}
      {/each}
    {/if}
  </div>
</section>

<style>
  .nbp-card { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--card-bg); color: var(--text); overflow: hidden; margin: 6px 0; }
  .nbp-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; padding: 7px 11px; border-bottom: 1px solid var(--border); background: var(--bg-alt); }
  .nbp-meta, .nbp-actions { display: inline-flex; align-items: center; gap: 7px; flex-wrap: wrap; min-width: 0; }
  .nbp-actions .btn { display: inline-flex; align-items: center; gap: 5px; height: 25px; padding: 0 9px; font-size: calc(12px * var(--ui-scale, 1)); }
  .nbp-lang { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: 999px; font-size: calc(11px * var(--ui-scale, 1)); font-weight: 600; color: var(--accent); background: var(--accent-soft); border: 1px solid color-mix(in srgb, var(--accent) 32%, var(--border)); }
  .nbp-lang.wln { color: var(--yellow); background: var(--yellow-soft); border-color: color-mix(in srgb, var(--yellow) 38%, var(--border)); }
  .nbp-file { font-family: var(--font-mono); font-size: calc(12px * var(--ui-scale, 1)); font-weight: 600; color: var(--heading); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nbp-range { font-family: var(--font-mono); font-size: calc(11px * var(--ui-scale, 1)); color: var(--text-muted); padding: 1px 7px; border-radius: 999px; background: var(--bg-elev); border: 1px solid var(--border); }
  .nbp-body { padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; }
  .nbp-md { padding: 2px 4px; }
  .nbp-cell { display: flex; flex-direction: column; gap: 6px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
  .nbp-cell:last-child { padding-bottom: 0; border-bottom: 0; }
  .nbp-io-row { display: grid; grid-template-columns: 66px minmax(0, 1fr); gap: 8px; align-items: start; }
  .nbp-prompt { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: calc(11px * var(--ui-scale, 1)); color: var(--text-faint); padding-top: 7px; text-align: right; user-select: none; }
  .nbp-prompt.out { color: var(--accent); }
  .nbp-code { margin: 0; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--code-bg); border: 1px solid var(--border); font-family: var(--font-mono); font-size: calc(12.5px * var(--ui-scale, 1)); line-height: 1.5; overflow-x: auto; white-space: pre; color: var(--text); }
  .tok-kw { color: var(--syn-keyword); font-weight: 600; }
  .tok-str { color: var(--syn-string); }
  .tok-num { color: var(--syn-number); }
  .tok-cmt { color: var(--syn-comment); font-style: italic; }
  .tok-fn { color: var(--syn-function); }
  .nbp-outputs { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .nbp-stream, .nbp-plain, .nbp-error { margin: 0; padding: 6px 9px; border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: calc(12px * var(--ui-scale, 1)); line-height: 1.45; white-space: pre-wrap; word-break: break-word; background: var(--bg); border: 1px solid var(--border); color: var(--text); }
  .nbp-stream.stderr { color: var(--yellow); border-left: 2px solid var(--yellow); }
  .nbp-error { color: var(--red); background: var(--red-soft); border-color: color-mix(in srgb, var(--red) 35%, var(--border)); }
  .nbp-plot { padding: 8px; background: #ffffff; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow-x: auto; max-width: 100%; width: fit-content; } /* literal: plot paper */
  .nbp-plot img { display: block; max-width: 100%; height: auto; }
  .nbp-rich { padding: 4px 8px; border-radius: var(--radius-sm); background: var(--bg); border: 1px solid var(--border); }
  @media (max-width: 560px) {
    .nbp-io-row { grid-template-columns: minmax(0, 1fr); gap: 3px; }
    .nbp-prompt { text-align: left; padding-top: 0; }
  }
</style>
