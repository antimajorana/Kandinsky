<script lang="ts">
  // Native Jupyter (.ipynb) & WLJS/Wolfram (.wln) computational physics notebook pane.
  import { onMount } from "svelte";
  import Icon from "../components/Icon.svelte";
  import Markdown from "../components/Markdown.svelte";
  import { api } from "../lib/api";
  import { on, touches } from "../lib/bus";
  import { open, type PaneProps } from "../lib/dock";
  import { insertIntoActiveNote, sendPassageToAgent, type AgentTarget } from "../lib/editor-insert-bus";
  import { superOf } from "../lib/keys";
  import {
    applyJupyterResultToCell,
    buildWolframNotebookRunner,
    makeCellId,
    parseNotebook,
    serializeIpynb,
    type NotebookCell,
    type NotebookCellKind,
    type NotebookDoc,
  } from "../lib/notebook-format";
  import {
    openInWljs,
    runJupyterNotebook,
    runWolfram,
    type JupyterKernelChoice,
    type WolframRunResponse,
  } from "../lib/oracle-runner";
  import { shownName } from "../lib/paths";
  import { app, toast } from "../lib/state.svelte";
  import { errText } from "../lib/text";

  let { spec, panel }: PaneProps<"notebook"> = $props();

  let nb = $state<NotebookDoc | null>(null);
  let loading = $state(true);
  let loadErr = $state("");
  let mtime = $state<number | undefined>(undefined);
  let dirty = $state(false);
  let saving = $state(false);

  let kernel = $state<JupyterKernelChoice>("auto");
  let activeKernelLabel = $state("");
  let runningAll = $state(false);
  let runningCellId = $state<string | null>(null);
  let wolframReport = $state<WolframRunResponse | null>(null);

  let activeCellId = $state<string | null>(null);
  let editingMd = $state<Record<string, boolean>>({});
  let openSendMenuId = $state<string | null>(null); // "header" or cell.id

  const isWln = $derived(nb ? nb.format === "wln" : /\.wln$/i.test(spec.path));
  const autoNeeds314 = $derived(
    Boolean(nb?.cells.some((c) => c.kind === "code" && /\b(tenpy|qutip)\b/.test(c.source))),
  );
  const effectiveKernelBadge = $derived(
    activeKernelLabel ||
      (kernel === "jupyter314" || (kernel === "auto" && autoNeeds314) ? "jupyter314" : "jupyter"),
  );

  function markDirty(next: boolean) {
    dirty = next;
    if (next) app.dirty[panel.id] = true;
    else delete app.dirty[panel.id];
  }

  async function loadNotebook() {
    loading = true;
    loadErr = "";
    try {
      const doc = await api.file(spec.path);
      mtime = doc.mtime;
      const parsed = parseNotebook(spec.path, doc.text);
      nb = parsed;
      activeCellId = parsed.cells[0]?.id ?? null;
      editingMd = {};
      wolframReport = null;
      markDirty(false);
    } catch (e) {
      loadErr = errText(e);
    } finally {
      loading = false;
    }
  }

  let loadedPath = "";
  $effect(() => {
    const p = spec.path;
    if (p && p !== loadedPath) {
      loadedPath = p;
      void loadNotebook();
    }
  });

  onMount(() => {
    const offFs = on("fs", (e) => {
      if (!dirty && !saving && touches(e.paths, (p) => p === spec.path)) {
        void loadNotebook();
      }
    });
    const onWinClick = () => {
      if (openSendMenuId) openSendMenuId = null;
    };
    window.addEventListener("click", onWinClick);
    return () => {
      offFs();
      window.removeEventListener("click", onWinClick);
      delete app.dirty[panel.id];
    };
  });

  async function saveNotebook() {
    if (!nb || nb.format !== "ipynb" || saving) return;
    saving = true;
    try {
      const raw = serializeIpynb(nb);
      const res = await api.putFile(spec.path, raw, mtime);
      mtime = res.mtime;
      markDirty(false);
      toast("Notebook saved", shownName(spec.path), "success", 2600);
    } catch (e) {
      toast("Save failed", errText(e), "error");
    } finally {
      saving = false;
    }
  }

  function addCell(kind: NotebookCellKind) {
    if (!nb || nb.format !== "ipynb") return;
    const cell: NotebookCell = {
      id: makeCellId(kind === "code" ? "py" : "md"),
      kind,
      language: kind === "code" ? "python" : "raw",
      source: "",
      executionCount: null,
      outputs: [],
    };
    const idx = activeCellId ? nb.cells.findIndex((c) => c.id === activeCellId) : -1;
    const insertAt = idx >= 0 ? idx + 1 : nb.cells.length;
    nb.cells.splice(insertAt, 0, cell);
    activeCellId = cell.id;
    if (kind === "markdown") editingMd[cell.id] = true;
    markDirty(true);
  }

  function moveCell(id: string, delta: -1 | 1) {
    if (!nb || nb.format !== "ipynb") return;
    const i = nb.cells.findIndex((c) => c.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= nb.cells.length) return;
    const [picked] = nb.cells.splice(i, 1);
    nb.cells.splice(j, 0, picked);
    markDirty(true);
  }

  function deleteCell(id: string) {
    if (!nb || nb.format !== "ipynb" || nb.cells.length <= 1) return;
    const i = nb.cells.findIndex((c) => c.id === id);
    if (i < 0) return;
    nb.cells.splice(i, 1);
    if (activeCellId === id) activeCellId = nb.cells[Math.min(i, nb.cells.length - 1)]?.id ?? null;
    markDirty(true);
  }

  async function runIpynbCells(upToCellId?: string) {
    if (!nb || nb.format !== "ipynb" || runningAll || runningCellId) return;
    const codeSlice: Array<{ index: number; source: string; cellIdx: number }> = [];
    for (let i = 0; i < nb.cells.length; i++) {
      const c = nb.cells[i];
      if (c.kind === "code") codeSlice.push({ index: i, source: c.source, cellIdx: i });
      if (upToCellId && c.id === upToCellId) break;
    }
    if (!codeSlice.length) return;

    if (upToCellId) runningCellId = upToCellId;
    else runningAll = true;

    try {
      const res = await runJupyterNotebook({
        path: spec.path,
        cells: codeSlice.map(({ index, source }) => ({ index, source })),
        kernel,
      });
      if (res.kernel) activeKernelLabel = res.kernel;
      if (!res.ok && res.error) {
        toast("Kernel execution failed", res.error, "error");
        return;
      }
      for (const r of res.results || []) {
        const target = nb.cells[r.index];
        if (target && target.kind === "code") {
          nb.cells[r.index] = applyJupyterResultToCell(target, r);
        }
      }
      markDirty(true);
    } catch (e) {
      toast("Jupyter run failed", errText(e), "error");
    } finally {
      runningAll = false;
      runningCellId = null;
    }
  }

  function applyWolframStdout(stdout: string, upToId?: string, totalMs?: number) {
    if (!nb) return;
    const byId = new Map<string, string[]>();
    const otherLines: string[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      if (line.startsWith("__WLN_CELL__\t")) {
        const parts = line.split("\t");
        const cid = parts[1] ?? "";
        const val = parts.slice(2).join("\t");
        byId.set(cid, [...(byId.get(cid) ?? []), val]);
      } else if (line.trim()) {
        otherLines.push(line);
      }
    }
    nb.cells = nb.cells.map((c) => {
      if (c.kind !== "code") return c;
      if (upToId && c.id !== upToId && !byId.has(c.id)) return c;
      const vals = byId.get(c.id);
      if (!vals?.length) return c;
      return {
        ...c,
        runtimeMs: upToId === c.id ? totalMs : c.runtimeMs,
        outputs: vals.map((v) => ({ type: "display", executionCount: c.executionCount, plain: v })),
      };
    });
    if (otherLines.length && upToId) {
      const idx = nb.cells.findIndex((c) => c.id === upToId);
      if (idx >= 0) {
        nb.cells[idx].outputs = [
          { type: "stream", stream: "stdout", text: `${otherLines.join("\n")}\n` },
          ...nb.cells[idx].outputs,
        ];
      }
    }
  }

  async function runWlnCheck(upToCellId?: string) {
    if (!nb || nb.format !== "wln" || runningAll || runningCellId) return;
    if (upToCellId) runningCellId = upToCellId;
    else runningAll = true;
    try {
      const companionWls = spec.path.replace(/\.wln$/i, ".wls");
      const hasCompanion = !upToCellId && companionWls !== spec.path && (await api.exists(companionWls).catch(() => false));
      const code = hasCompanion ? undefined : buildWolframNotebookRunner(nb.cells, upToCellId);
      const res = await runWolfram({
        path: spec.path,
        wlsPath: hasCompanion ? companionWls : undefined,
        code,
      });
      wolframReport = res;
      if (!hasCompanion && res.stdout) {
        applyWolframStdout(res.stdout, upToCellId, res.ms);
      }
      toast(
        res.ok ? `Wolfram check passed (${res.ms} ms)` : `Wolfram check exited ${res.exitCode}`,
        hasCompanion ? `Ran ${shownName(companionWls)} via wl.py` : `Evaluated ${shownName(spec.path)} via wl.py`,
        res.ok ? "success" : "error",
      );
    } catch (e) {
      toast("Wolfram check failed", errText(e), "error");
    } finally {
      runningAll = false;
      runningCellId = null;
    }
  }

  async function launchWljs() {
    try {
      const res = await openInWljs(spec.path);
      if (!res.ok) throw new Error(res.error || "Could not launch WLJS");
      toast("Opened in WLJS", shownName(spec.path), "success", 2800);
    } catch (e) {
      toast("Could not open WLJS", errText(e), "error");
    }
  }

  async function sendCellToAgent(target: AgentTarget, cell?: NotebookCell) {
    openSendMenuId = null;
    const chosen =
      cell ??
      nb?.cells.find((c) => c.id === activeCellId) ??
      nb?.cells.find((c) => c.kind === "code");
    if (!chosen || !chosen.source.trim()) {
      toast("Nothing to send", "Pick a non-empty notebook cell first.", "info");
      return;
    }
    const lang = chosen.language === "wolfram" ? "wolfram" : chosen.kind === "code" ? "python" : "markdown";
    const prompt = [
      `Notebook cell from \`${spec.path}\`${chosen.executionCount ? ` [In ${chosen.executionCount}]` : ""}:`,
      "",
      `\`\`\`${lang}`,
      chosen.source.trim(),
      "```",
    ].join("\n");
    const ok = await sendPassageToAgent({ target, prompt, path: spec.path });
    const label = target === "antigravity" ? "Antigravity" : target === "claude" ? "Claude" : "Solver";
    if (ok) toast(`Sent cell (${shownName(spec.path)}) to ${label}`, undefined, "success");
  }

  function copyCellToNote(cell: NotebookCell) {
    const lang = cell.language === "wolfram" ? "wolfram" : cell.kind === "code" ? "python" : "markdown";
    const block = cell.kind === "markdown" ? cell.source.trim() : `\`\`\`${lang}\n${cell.source.trim()}\n\`\`\``;
    const r = insertIntoActiveNote(block);
    if (r.ok) toast("Inserted cell into note", r.path ? shownName(r.path) : undefined, "success", 2600);
    else toast("No active note open", "Open a Markdown note side-by-side to insert cells.", "info");
  }

  function onPaneKeydown(e: KeyboardEvent) {
    const mod = e.ctrlKey || superOf(e);
    if (mod && e.key.toLowerCase() === "s") {
      if (!isWln) {
        e.preventDefault();
        e.stopPropagation();
        void saveNotebook();
      }
    }
  }

  function onCodeKeydown(e: KeyboardEvent, cell: NotebookCell) {
    if ((e.shiftKey || e.ctrlKey || superOf(e)) && e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (isWln) void runWlnCheck(cell.id);
      else void runIpynbCells(cell.id);
    }
  }

  function formatLatex(tex: string): string {
    const t = tex.trim();
    if (t.startsWith("$$") || t.startsWith("\\begin{")) return `$$\n${t.replace(/^\$\$|\$\$$/g, "").trim()}\n$$`;
    if (t.startsWith("$") && t.endsWith("$")) return t;
    return `$$\n${t}\n$$`;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="nb-pane" onkeydown={onPaneKeydown} data-testid="notebook-pane">
  <header class="nb-toolbar">
    <span class="nb-badge" class:wln={isWln}>
      <Icon name="sigma" size={12} />
      {isWln ? "WLJS .wln" : "Jupyter .ipynb"}
    </span>
    <span class="nb-title" title={spec.path}>{shownName(spec.path)}</span>

    <span class="spacer"></span>

    {#if !isWln}
      <label class="kernel-wrap" title="Python kernel environment">
        <span class="kernel-dot"></span>
        <select class="kernel-select" bind:value={kernel} aria-label="Jupyter kernel">
          <option value="auto">Auto ({autoNeeds314 ? "3.14 TeNPy/QuTiP" : "Standard"})</option>
          <option value="jupyter">Jupyter (Standard)</option>
          <option value="jupyter314">Jupyter 3.14 (TeNPy / QuTiP)</option>
        </select>
      </label>
      <span class="kernel-pill" title="Active Python environment">{effectiveKernelBadge}</span>

      <button class="nb-btn primary" disabled={runningAll || Boolean(runningCellId)} onclick={() => void runIpynbCells()} title="Execute all cells sequentially in one Python session">{runningAll ? "◌ Running…" : "▶ Run All"}</button>
      <button class="nb-btn" onclick={() => addCell("code")} title="Insert Python code cell below"><Icon name="plus" size={12} /> Code</button>
      <button class="nb-btn" onclick={() => addCell("markdown")} title="Insert Markdown + KaTeX cell below"><Icon name="plus" size={12} /> Markdown</button>
      <button class="nb-btn" class:dirty disabled={saving} onclick={() => void saveNotebook()} title="Save .ipynb to disk (Ctrl+S)"><Icon name="check" size={13} /> {saving ? "Saving…" : dirty ? "Save*" : "Save"}</button>
    {:else}
      <button class="nb-btn" onclick={() => void launchWljs()} title="Launch this .wln file in WLJS Notebook"><Icon name="external-link" size={13} /> Open in WLJS</button>
      <button class="nb-btn primary" disabled={runningAll || Boolean(runningCellId)} onclick={() => void runWlnCheck()} title="Run Wolfram verification via wl.py">{runningAll ? "◌ Running wl.py…" : "▶ Run Wolfram Check (wl.py)"}</button>
      <div class="menu-anchor">
        <button class="nb-btn" onclick={(e) => { e.stopPropagation(); openSendMenuId = openSendMenuId === "header" ? null : "header"; }}>Send Cell to Solver / Agent ▾</button>
        {#if openSendMenuId === "header"}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div class="pop-menu" tabindex="-1" onclick={(e) => e.stopPropagation()} role="menu">
            <button role="menuitem" onclick={() => void sendCellToAgent("solver")}>Send to Solver</button>
            <button role="menuitem" onclick={() => void sendCellToAgent("antigravity")}>Send to Antigravity</button>
            <button role="menuitem" onclick={() => void sendCellToAgent("claude")}>Send to Claude</button>
          </div>
        {/if}
      </div>
    {/if}

    <button class="nb-btn subtle" onclick={() => open({ kind: "editor", path: spec.path })} title="Open raw file in the text editor"><Icon name="file-code" size={13} /> Open as JSON/Text</button>
  </header>

  <div class="nb-scroll">
    {#if loading}
      <div class="nb-state">Loading notebook…</div>
    {:else if loadErr}
      <div class="nb-state error">
        <p>Could not parse notebook <code>{shownName(spec.path)}</code>: {loadErr}</p>
        <button class="nb-btn" onclick={() => open({ kind: "editor", path: spec.path })}>Open as JSON/Text</button>
      </div>
    {:else if nb}
      <div class="nb-column">
        {#if wolframReport}
          <div class="wl-banner" class:ok={wolframReport.ok} class:fail={!wolframReport.ok}>
            <div class="wl-banner-head">
              <strong>{wolframReport.ok ? "● Wolfram Check Clean" : `▲ Wolfram Exit ${wolframReport.exitCode}`}</strong>
              <span class="ms-pill">{wolframReport.ms} ms</span>
              <button class="icon-xs" onclick={() => (wolframReport = null)} title="Dismiss"><Icon name="close" size={12} /></button>
            </div>
            {#if wolframReport.stdout.trim()}
              <pre class="nb-stream">{wolframReport.stdout.replace(/^__WLN_CELL__\t.*$/gm, "").trim()}</pre>
            {/if}
            {#if wolframReport.stderr.trim()}
              <pre class="nb-stream stderr">{wolframReport.stderr.trim()}</pre>
            {/if}
          </div>
        {/if}

        {#each nb.cells as cell (cell.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <section
            class="nb-cell"
            class:active={activeCellId === cell.id}
            class:md-cell={cell.kind === "markdown"}
            onclick={() => (activeCellId = cell.id)}
          >
            {#if cell.kind === "markdown"}
              <div class="cell-head md-head">
                <span class="cell-tag">Markdown</span>
                <span class="spacer"></span>
                {#if editingMd[cell.id]}
                  <button class="cell-act" onclick={() => (editingMd[cell.id] = false)}>Done</button>
                {:else}
                  <button class="cell-act" onclick={() => (editingMd[cell.id] = true)} title="Edit Markdown">
                    <Icon name="edit" size={12} /> Edit
                  </button>
                {/if}
                {#if !isWln}
                  <button class="icon-xs" onclick={() => moveCell(cell.id, -1)} title="Move cell up"><Icon name="arrow-up" size={12} /></button>
                  <button class="icon-xs" onclick={() => moveCell(cell.id, 1)} title="Move cell down"><Icon name="arrow-down" size={12} /></button>
                  <button class="icon-xs" onclick={() => deleteCell(cell.id)} title="Delete cell"><Icon name="trash" size={12} /></button>
                {/if}
              </div>

              {#if editingMd[cell.id]}
                <textarea class="md-editor" rows={Math.max(3, cell.source.split("\n").length)} bind:value={cell.source} oninput={() => { if (!isWln) markDirty(true); }}
                  onkeydown={(e) => { if ((e.ctrlKey || superOf(e) || e.shiftKey) && e.key === "Enter") { e.preventDefault(); editingMd[cell.id] = false; } else if (e.key === "Escape") editingMd[cell.id] = false; }}
                  placeholder="Write Markdown + $LaTeX$…"></textarea>
              {:else}
                <div class="md-body" ondblclick={() => (editingMd[cell.id] = true)}>
                  {#if cell.source.trim()}<Markdown text={cell.source} path={spec.path} />{:else}<span class="empty-md">Double-click to write Markdown…</span>{/if}
                </div>
              {/if}
            {:else}
              <div class="code-row">
                <div class="exec-gutter" title="Execution counter">[{runningCellId === cell.id || runningAll ? "*" : (cell.executionCount ?? " ")}]</div>
                <div class="code-main">
                  <div class="cell-head">
                    <button class="run-cell-btn" disabled={runningAll || Boolean(runningCellId)} onclick={() => (isWln ? void runWlnCheck(cell.id) : void runIpynbCells(cell.id))} title="Run cell (Shift+Enter)">{runningCellId === cell.id ? "◌ Running…" : "▶ Run Cell"}</button>
                    <span class="cell-tag">{cell.language === "wolfram" ? "Wolfram" : cell.kind === "raw" ? "Raw" : "Python"}</span>
                    {#if cell.runtimeMs !== undefined}<span class="ms-pill">{cell.runtimeMs} ms</span>{/if}
                    <span class="spacer"></span>
                    <button class="cell-act" onclick={() => copyCellToNote(cell)} title="Insert cell into active Markdown note">+ Note</button>
                    <div class="menu-anchor">
                      <button class="cell-act" onclick={(e) => { e.stopPropagation(); openSendMenuId = openSendMenuId === cell.id ? null : cell.id; }}>Send ▾</button>
                      {#if openSendMenuId === cell.id}
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <div class="pop-menu" tabindex="-1" onclick={(e) => e.stopPropagation()} role="menu">
                          <button role="menuitem" onclick={() => void sendCellToAgent("solver", cell)}>Solver</button>
                          <button role="menuitem" onclick={() => void sendCellToAgent("antigravity", cell)}>Antigravity</button>
                          <button role="menuitem" onclick={() => void sendCellToAgent("claude", cell)}>Claude</button>
                        </div>
                      {/if}
                    </div>
                    {#if !isWln}
                      <button class="icon-xs" onclick={() => moveCell(cell.id, -1)} title="Move cell up"><Icon name="arrow-up" size={12} /></button>
                      <button class="icon-xs" onclick={() => moveCell(cell.id, 1)} title="Move cell down"><Icon name="arrow-down" size={12} /></button>
                      <button class="icon-xs" onclick={() => deleteCell(cell.id)} title="Delete cell"><Icon name="trash" size={12} /></button>
                    {/if}
                  </div>
                  <textarea class="code-editor" spellcheck="false" rows={Math.max(2, Math.min(28, cell.source.split("\n").length))} bind:value={cell.source} oninput={() => { if (!isWln) markDirty(true); }} onkeydown={(e) => onCodeKeydown(e, cell)} placeholder={cell.language === "wolfram" ? "Wolfram Language input…" : "Python code… (Shift+Enter to run)"}></textarea>

                  {#if cell.outputs.length > 0}
                    <div class="outputs">
                      {#each cell.outputs as out, oi (oi)}
                        {#if out.type === "stream"}
                          <pre class="nb-stream" class:stderr={out.stream === "stderr"}>{out.text}</pre>
                        {:else if out.type === "error"}
                          <pre class="nb-error">{out.traceback || `${out.ename}: ${out.evalue}`}</pre>
                        {:else if out.type === "display"}
                          {#if out.png}
                            <div class="nb-plot">
                              <img src="data:image/png;base64,{out.png}" alt="Cell plot output" />
                            </div>
                          {/if}
                          {#if out.svg}
                            <div class="nb-plot nb-svg">{@html out.svg}</div>
                          {/if}
                          {#if out.latex}
                            <div class="nb-rich"><Markdown text={formatLatex(out.latex)} path={spec.path} /></div>
                          {/if}
                          {#if out.markdown}
                            <div class="nb-rich"><Markdown text={out.markdown} path={spec.path} /></div>
                          {/if}
                          {#if out.plain && !out.png && !out.svg && !out.latex && !out.markdown}
                            <div class="nb-plain">
                              {#if out.executionCount}<span class="out-tag">Out[{out.executionCount}]:</span>{/if}
                              <pre>{out.plain}</pre>
                            </div>
                          {/if}
                        {/if}
                      {/each}
                    </div>
                  {/if}
                </div>
              </div>
            {/if}
          </section>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .nb-pane { height: 100%; display: flex; flex-direction: column; background: var(--bg); color: var(--text); outline: none; }
  .nb-toolbar { display: flex; align-items: center; gap: 6px; min-height: 38px; padding: 4px 12px; border-bottom: 1px solid var(--border); background: var(--bg); flex: none; flex-wrap: wrap; font-size: calc(12.5px * var(--ui-scale, 1)); }
  .nb-badge { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 600; color: var(--accent); background: color-mix(in srgb, var(--accent) 13%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent); }
  .nb-badge.wln { color: var(--yellow, #dfab2e); background: color-mix(in srgb, var(--yellow, #dfab2e) 14%, transparent); border-color: color-mix(in srgb, var(--yellow, #dfab2e) 35%, transparent); }
  .nb-title { font-weight: 500; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px; }
  .spacer { flex: 1; min-width: 6px; }
  .kernel-wrap { display: inline-flex; align-items: center; gap: 5px; padding: 2px 7px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-elev); }
  .kernel-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--green, #3ca395); }
  .kernel-select { background: transparent; border: none; color: var(--text); font: inherit; font-size: 12px; outline: none; cursor: pointer; }
  .kernel-pill { font-family: var(--font-mono); font-size: 11px; padding: 2px 6px; border-radius: 999px; color: var(--text-muted); background: var(--bg-elev); border: 1px solid var(--border); }
  .nb-btn { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-elev); color: var(--text); font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
  .nb-btn:hover:not(:disabled) { background: var(--bg-hover); border-color: var(--border-strong); }
  .nb-btn:disabled { opacity: 0.55; cursor: default; }
  .nb-btn.primary { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 38%, var(--border)); background: color-mix(in srgb, var(--accent) 11%, transparent); font-weight: 500; }
  .nb-btn.primary:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 18%, transparent); }
  .nb-btn.dirty { border-color: var(--accent); color: var(--accent); }
  .nb-btn.subtle { color: var(--text-muted); background: transparent; }

  .nb-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 22px 24px 64px; }
  .nb-column { max-width: 880px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }
  .nb-state { max-width: 640px; margin: 40px auto; padding: 18px; border: 1px solid var(--border); border-radius: 6px; color: var(--text-muted); text-align: center; }
  .nb-state.error { border-color: color-mix(in srgb, var(--red, #d94e41) 40%, var(--border)); color: var(--red, #d94e41); }

  .wl-banner { padding: 10px 12px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-elev); }
  .wl-banner.ok { border-color: color-mix(in srgb, var(--green, #3ca395) 38%, transparent); background: color-mix(in srgb, var(--green, #3ca395) 9%, var(--bg-elev)); }
  .wl-banner.fail { border-color: color-mix(in srgb, var(--red, #d94e41) 40%, transparent); background: color-mix(in srgb, var(--red, #d94e41) 9%, var(--bg-elev)); }
  .wl-banner-head { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
  .wl-banner-head strong { flex: 1; }

  .nb-cell { border: 1px solid var(--border); border-radius: 6px; background: var(--bg-elev); transition: border-color 120ms ease; }
  .nb-cell.md-cell { background: transparent; border-color: transparent; padding: 4px 10px; }
  .nb-cell.md-cell:hover, .nb-cell.md-cell.active { border-color: var(--border); background: color-mix(in srgb, var(--bg-elev) 55%, transparent); }
  .nb-cell.active { border-color: color-mix(in srgb, var(--accent) 52%, var(--border)); box-shadow: inset 2px 0 0 var(--accent); }

  .code-row { display: flex; align-items: stretch; }
  .exec-gutter { width: 48px; flex: none; padding: 9px 6px 0 8px; font-family: var(--font-mono); font-size: 11.5px; color: var(--text-faint); text-align: right; user-select: none; }
  .code-main { flex: 1; min-width: 0; padding: 6px 10px 8px 4px; display: flex; flex-direction: column; gap: 6px; }
  .cell-head { display: flex; align-items: center; gap: 6px; min-height: 22px; font-size: 11.5px; color: var(--text-muted); }
  .md-head { opacity: 0.25; transition: opacity 120ms ease; }
  .nb-cell:hover .md-head, .nb-cell.active .md-head { opacity: 1; }
  .cell-tag { font-family: var(--font-mono); font-size: 10.5px; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.04em; }
  .run-cell-btn { padding: 2px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 500; color: var(--green, #3ca395); background: color-mix(in srgb, var(--green, #3ca395) 13%, transparent); border: 1px solid color-mix(in srgb, var(--green, #3ca395) 32%, transparent); cursor: pointer; }
  .run-cell-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--green, #3ca395) 20%, transparent); }
  .ms-pill { font-family: var(--font-mono); font-size: 11px; padding: 1px 6px; border-radius: 999px; color: var(--text-muted); background: var(--bg); border: 1px solid var(--border); }
  .cell-act { padding: 1px 6px; border-radius: 4px; font-size: 11.5px; color: var(--text-muted); cursor: pointer; display: inline-flex; align-items: center; gap: 3px; }
  .cell-act:hover, .icon-xs:hover { background: var(--bg-hover); color: var(--text); }
  .icon-xs { width: 20px; height: 20px; display: grid; place-items: center; border-radius: 4px; color: var(--text-faint); cursor: pointer; }

  .code-editor, .md-editor { width: 100%; resize: vertical; font-family: var(--font-mono); font-size: calc(12.5px * var(--ui-scale, 1)); line-height: 1.5; color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 5px; padding: 8px 10px; outline: none; }
  .code-editor:focus, .md-editor:focus { border-color: var(--accent); }
  .md-body { padding: 2px 2px 6px; cursor: text; }
  .empty-md { color: var(--text-faint); font-style: italic; font-size: 13px; }

  .outputs { border-top: 1px solid var(--border); padding-top: 8px; display: flex; flex-direction: column; gap: 8px; }
  .nb-stream, .nb-error, .nb-plain pre { margin: 0; font-family: var(--font-mono); font-size: 12px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; padding: 6px 8px; border-radius: 4px; background: var(--bg); color: var(--text); }
  .nb-stream.stderr { color: var(--yellow, #dfab2e); border-left: 2px solid var(--yellow, #dfab2e); }
  .nb-error { color: var(--red, #d94e41); background: color-mix(in srgb, var(--red, #d94e41) 9%, var(--bg)); border: 1px solid color-mix(in srgb, var(--red, #d94e41) 30%, transparent); }
  .nb-plain { display: flex; align-items: flex-start; gap: 8px; }
  .out-tag { font-family: var(--font-mono); font-size: 11px; color: var(--accent); padding-top: 6px; flex: none; }
  .nb-plain pre { flex: 1; }
  .nb-plot { padding: 8px; background: #fff; border-radius: 5px; border: 1px solid var(--border); overflow-x: auto; max-width: 100%; width: fit-content; }
  .nb-plot img, .nb-svg :global(svg) { display: block; max-width: 100%; height: auto; }
  .nb-rich { padding: 4px 6px; background: var(--bg); border-radius: 4px; }

  .menu-anchor { position: relative; display: inline-flex; }
  .pop-menu { position: absolute; right: 0; top: calc(100% + 4px); z-index: 30; min-width: 155px; padding: 4px; border-radius: 6px; background: var(--bg-elev); border: 1px solid var(--border-strong); box-shadow: var(--shadow-pop); display: flex; flex-direction: column; }
  .pop-menu button { text-align: left; padding: 5px 8px; border-radius: 4px; font-size: 12px; color: var(--text); cursor: pointer; }
  .pop-menu button:hover { background: var(--bg-hover); color: var(--accent); }
</style>
