<script lang="ts">
  import { tipFor } from "../lib/keymap.svelte";
  // Bottom status bar: workspace (horizontal tabs only), the plugins' cells, Antigravity @specialist + model chip, vim mode, server connection.
  import { app, toast } from "../lib/state.svelte";
  import { settings, toggleVim } from "../lib/settings.svelte";
  import { showProblems } from "../lib/actions";
  import Icon from "./Icon.svelte";
  import { tabs } from "../lib/tabs.svelte";
  import { statusCells } from "../lib/plugin-status.svelte";
  import { zoomShown } from "../lib/zoom-status.svelte";
  import { zoomPane } from "../lib/pane-zoom";
  import Popover from "./Popover.svelte";
  import type { StatusCell } from "../lib/plugin-status.svelte";
  import { api } from "../lib/api";
  import { onFilesAddedOrRemoved, vaultReady } from "../lib/vault";
  import { context } from "../lib/context.svelte";
  import { editors, terminals } from "../lib/registry";
  import { activeEditorId, focusPanel, getDock, lastEditorId, nextTerminalN, open } from "../lib/dock";
  import { agentsOn } from "../lib/agents";
  import { sendPassageToAgent } from "../lib/editor-insert-bus";
  import { basename, type PaneSpec } from "../lib/panes";
  import { isNotionShell } from "../lib/shell-mode.svelte";
  import { frontmatterOf } from "../lib/property-model";

  interface VaultSpecialist {
    id: string;
    handle: string;
    title: string;
    description: string;
    model?: string;
  }

  interface AgyModelPill {
    id: string;
    slug: string;
    label: string;
    short: string;
  }

  const AGY_STORAGE_MODEL = "kandinsky.agy.model";
  const AGY_STORAGE_SLUG = "kandinsky.agy.modelSlug";
  const AGY_STORAGE_SPECIALIST = "kandinsky.agy.specialist";
  const AGY_CONFIG_EVENT = "kandinsky:agy-config";

  const AGY_MODEL_PILLS: readonly AgyModelPill[] = [
    { id: "gemini-4-carbon", slug: "gemini-4-carbon-high", label: "Gemini 4 Carbon", short: "Carbon" },
    { id: "gemini-4-argon", slug: "gemini-4-argon-high", label: "Gemini 4 Argon", short: "Argon" },
    { id: "gemini-4-hydrogen", slug: "gemini-4-hydrogen-high", label: "Gemini 4 Hydrogen", short: "Hydrogen" },
    { id: "gemini-3-flash", slug: "gemini-3.8-flash-high", label: "Gemini 3 Flash", short: "Flash" },
  ];

  function resolvePill(raw: string | null | undefined): AgyModelPill {
    const s = (raw ?? "").trim().toLowerCase();
    if (s.includes("argon")) return AGY_MODEL_PILLS[1];
    if (s.includes("hydrogen")) return AGY_MODEL_PILLS[2];
    if (s.includes("flash")) return AGY_MODEL_PILLS[3];
    return AGY_MODEL_PILLS[0];
  }

  function resolveSlug(raw: string | null | undefined, fallbackPill: AgyModelPill): string {
    const s = (raw ?? "").trim();
    if (!s || s === "default" || s === "inherit") return fallbackPill.slug;
    const byId = AGY_MODEL_PILLS.find((p) => p.id === s.toLowerCase() || p.short.toLowerCase() === s.toLowerCase());
    if (byId) return byId.slug;
    return s;
  }

  function normalizeSpecialist(raw: string | null | undefined): string {
    const s = (raw ?? "").trim();
    if (!s || s === "coordinator" || s === "none") return "";
    return s.startsWith("@") ? s : `@${s}`;
  }

  function readInitialAgyConfig(): { modelId: string; modelSlug: string; specialist: string } {
    try {
      const m = localStorage.getItem(AGY_STORAGE_MODEL);
      const slug = localStorage.getItem(AGY_STORAGE_SLUG);
      const spec = localStorage.getItem(AGY_STORAGE_SPECIALIST);
      const pill = resolvePill(m || slug);
      return {
        modelId: pill.id,
        modelSlug: resolveSlug(slug || m, pill),
        specialist: normalizeSpecialist(spec),
      };
    } catch {
      return { modelId: "gemini-4-carbon", modelSlug: "gemini-4-carbon-high", specialist: "" };
    }
  }

  function unquoteYaml(val: string): string {
    let s = val.trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      s = s.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, " ");
    }
    return s.replace(/\s+/g, " ").trim();
  }

  function parseSpecialistFrontmatter(raw: string, fileStem: string): VaultSpecialist | null {
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
    const fields: Record<string, string> = {};
    if (fm) {
      let curKey = "";
      for (const ln of fm[1].split(/\r?\n/)) {
        const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(ln);
        if (kv) {
          curKey = kv[1];
          const rest = kv[2].trim();
          fields[curKey] = rest === ">" || rest === "|" ? "" : rest;
        } else if (curKey && /^\s+/.test(ln)) {
          fields[curKey] = `${fields[curKey] ?? ""} ${ln.trim()}`.trim();
        } else {
          curKey = "";
        }
      }
    }
    const id = unquoteYaml(fields.name || fileStem).replace(/^@+/, "") || fileStem;
    if (!id) return null;
    const title =
      unquoteYaml(fields.title || "") ||
      id.split(/[-_]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
    const description = unquoteYaml(fields.description || "");
    const model = unquoteYaml(fields.model || "");
    return { id, handle: `@${id}`, title, description, ...(model ? { model } : {}) };
  }

  const initAgy = readInitialAgyConfig();
  let agyModelId = $state<string>(initAgy.modelId);
  let agyModelSlug = $state<string>(initAgy.modelSlug);
  let agySpecialist = $state<string>(initAgy.specialist);
  let specialists = $state<VaultSpecialist[]>([]);
  let specialistQuery = $state<string>("");
  let agyOpen = $state<boolean>(false);
  let agyAnchor = $state<HTMLButtonElement>();
  let agyLiveSubagents = $state<number>(0);
  let agyLiveRoots = $state<number>(0);

  const activeModelPill = $derived(resolvePill(agyModelId || agyModelSlug));
  const effectiveSpecialist = $derived(
    specialists.length > 0 && specialists.some((s) => s.handle === agySpecialist) ? agySpecialist : "",
  );
  const filteredSpecialists = $derived.by(() => {
    const q = specialistQuery.trim().toLowerCase();
    if (!q) return specialists;
    return specialists.filter(
      (s) =>
        s.handle.toLowerCase().includes(q) ||
        s.title.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    );
  });

  const devMode = $derived(Boolean(settings.config?.developer_mode));
  const visibleStatusCells = $derived.by(() => {
    const list = statusCells.filter((c) => {
      if (c.key === "antigravity:agy") return false;
      if (!devMode && (/^(?:solver|antigravity|claude):/.test(c.key) || c.text.includes("Solver"))) return false;
      return true;
    });
    return [...list].sort((a, b) => (a.key === "solver:solver" ? 1 : b.key === "solver:solver" ? -1 : 0));
  });
  const hasSolverCell = $derived(
    visibleStatusCells.some((c) => c.key === "solver:solver" || c.text.includes("Solver")),
  );
  const solverDisabled = $derived(Boolean(settings.config?.plugins.off?.includes("solver")));

  let scanSeq = 0;
  async function scanVaultSpecialists(): Promise<void> {
    const seq = ++scanSeq;
    try {
      const hasAgentsDir = await api.exists(".agents/agents").catch(() => false);
      if (seq !== scanSeq) return;
      if (!hasAgentsDir) {
        specialists = [];
        return;
      }
      const entries = await api.tree(".agents/agents", true).catch(() => []);
      if (seq !== scanSeq) return;
      const mdEntries = entries.filter((e) => e.kind === "file" && /\.md$/i.test(e.name));
      if (!mdEntries.length) {
        specialists = [];
        return;
      }
      const docs = await Promise.all(
        mdEntries.map(async (e) => {
          try {
            const f = await api.file(e.path);
            return parseSpecialistFrontmatter(f.text, e.name.replace(/\.md$/i, ""));
          } catch {
            return null;
          }
        }),
      );
      if (seq !== scanSeq) return;
      specialists = docs
        .filter((d): d is VaultSpecialist => d !== null)
        .sort((a, b) => a.id.localeCompare(b.id));
    } catch {
      if (seq === scanSeq) specialists = [];
    }
  }

  // Re-scan vault specialists whenever the active workspace changes or files are added/removed
  $effect(() => {
    const _wsRoot = app.workspace?.root ?? "";
    void _wsRoot;
    void scanVaultSpecialists();
    void vaultReady().then(() => scanVaultSpecialists());
    const offFiles = onFilesAddedOrRemoved(() => void scanVaultSpecialists(), 500);
    return () => offFiles();
  });

  // Bidirectional sync with antigravity/switcher-ui.js & main.js
  $effect(() => {
    const onAgyConfig = (ev: Event) => {
      const detail = (ev as CustomEvent<{ model?: string; modelSlug?: string; specialist?: string; source?: string }>).detail;
      if (!detail || detail.source === "statusbar") return;
      const pill = resolvePill(detail.model || detail.modelSlug || agyModelId);
      agyModelId = pill.id;
      agyModelSlug = resolveSlug(detail.modelSlug || detail.model, pill);
      if (detail.specialist !== undefined) agySpecialist = normalizeSpecialist(detail.specialist);
    };
    const onAgyLive = (ev: Event) => {
      const d = (ev as CustomEvent<{ liveSubagentCount?: number; liveRootCount?: number }>).detail;
      if (!d) return;
      agyLiveSubagents = Number(d.liveSubagentCount || 0);
      agyLiveRoots = Number(d.liveRootCount || 0);
    };
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === AGY_STORAGE_MODEL || ev.key === AGY_STORAGE_SLUG || ev.key === AGY_STORAGE_SPECIALIST) {
        const next = readInitialAgyConfig();
        agyModelId = next.modelId;
        agyModelSlug = next.modelSlug;
        agySpecialist = next.specialist;
      }
    };
    window.addEventListener(AGY_CONFIG_EVENT, onAgyConfig);
    window.addEventListener("kandinsky:agy-live", onAgyLive);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(AGY_CONFIG_EVENT, onAgyConfig);
      window.removeEventListener("kandinsky:agy-live", onAgyLive);
      window.removeEventListener("storage", onStorage);
    };
  });

  function broadcastAgyConfig(nextPill: AgyModelPill, nextSlug: string, nextSpec: string): void {
    agyModelId = nextPill.id;
    agyModelSlug = nextSlug;
    agySpecialist = nextSpec;
    try {
      localStorage.setItem(AGY_STORAGE_MODEL, nextPill.id);
      localStorage.setItem(AGY_STORAGE_SLUG, nextSlug);
      localStorage.setItem(AGY_STORAGE_SPECIALIST, nextSpec);
    } catch { /* storage unavailable */ }
    window.dispatchEvent(
      new CustomEvent(AGY_CONFIG_EVENT, {
        detail: { model: nextPill.id, modelSlug: nextSlug, specialist: nextSpec, source: "statusbar" },
      }),
    );
  }

  function pickAgyModel(pill: AgyModelPill): void {
    broadcastAgyConfig(pill, pill.slug, agySpecialist);
  }

  function pickAgySpecialist(handle: string): void {
    broadcastAgyConfig(activeModelPill, agyModelSlug, normalizeSpecialist(handle));
  }

  const activeNoteTarget = $derived.by(() => {
    const sel = context.selection;
    const edId = activeEditorId() ?? lastEditorId();
    const edHandle = edId ? editors.get(edId) : undefined;
    const path = (sel?.text ? sel.path : undefined) ?? context.active?.path ?? edHandle?.path ?? "";
    if (!path) return null;

    let lines: { from: number; to: number } | null = null;
    if (sel?.text && sel.path === path) {
      lines = { from: sel.from_line, to: sel.to_line };
    } else if (edHandle && edHandle.path === path) {
      const snap = edHandle.snapshot();
      const r = snap.ranges[0];
      if (r && r.from < r.to) {
        const beforeFrom = snap.text.slice(0, r.from);
        const beforeTo = snap.text.slice(0, r.to);
        const fromLine = beforeFrom.split("\n").length;
        const toLine = Math.max(fromLine, beforeTo.split("\n").length - (beforeTo.endsWith("\n") ? 1 : 0));
        lines = { from: fromLine, to: toLine };
      }
    }

    const shortFile = basename(path);
    const refPart = lines ? `@${path}#L${lines.from}-${lines.to} ` : `@${path} `;
    const badgeRef = lines ? `@${shortFile}#L${lines.from}-${lines.to}` : `@${shortFile}`;
    const prompt = `${effectiveSpecialist ? `${effectiveSpecialist} ` : ""}${refPart}`;
    const buttonLabel = `Send ${badgeRef} → ${effectiveSpecialist || "agy"}`;
    return { path, lines, prompt, badgeRef, buttonLabel };
  });

  function resolveAgyAgentRef(): string {
    const decl = agentsOn().find((a) => a.plugin === "antigravity" || a.id === "antigravity" || a.id === "agy" || a.ref.startsWith("antigravity/"));
    return decl?.ref ?? "antigravity/antigravity";
  }

  function buildAgyLaunchSpec(): PaneSpec {
    const title = effectiveSpecialist ? `agy · ${effectiveSpecialist}` : "Antigravity";
    const cmd = agyModelSlug && agyModelSlug !== "default" ? `agy --model ${agyModelSlug}` : "agy";
    return {
      kind: "terminal",
      preset: "shell",
      n: nextTerminalN(),
      title,
      agent: resolveAgyAgentRef(),
      command: cmd,
    };
  }

  function findOpenAgyPanel() {
    return getDock()?.panels.find((p) => {
      const s = p.params as PaneSpec | undefined;
      return (
        s?.kind === "terminal" &&
        (Boolean(s.agent?.startsWith("antigravity")) || /^agy\b/i.test(s.command ?? "") || /antigravity|^agy\b/i.test(s.title ?? ""))
      );
    });
  }

  function launchAgyInVault(forceNew = false): void {
    const title = effectiveSpecialist ? `agy · ${effectiveSpecialist}` : "Antigravity";
    const existing = !forceNew ? findOpenAgyPanel() : undefined;
    if (existing) {
      existing.api.setTitle(title);
      focusPanel(existing.id);
    } else {
      open(buildAgyLaunchSpec(), { beside: true });
    }
    agyOpen = false;
  }

  async function ensureAgyTerminalReady(): Promise<void> {
    for (const [, t] of terminals) {
      if (Boolean(t.agent?.startsWith("antigravity/")) || t.preset === "antigravity") return;
    }
    const existingPanel = findOpenAgyPanel();
    const panelId = existingPanel ? existingPanel.id : open(buildAgyLaunchSpec(), { beside: true })?.id;
    if (!panelId) return;
    const deadline = Date.now() + 2800;
    while (Date.now() < deadline) {
      if (terminals.get(panelId)?.ready()) return;
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  async function sendActiveSelectionToAgy(): Promise<void> {
    const target = activeNoteTarget;
    if (!target) {
      toast("No active file open", "Open a Markdown note or file first to send @note#Lfrom-to to Antigravity.");
      return;
    }
    agyOpen = false;
    await ensureAgyTerminalReady();
    const ok = await sendPassageToAgent({
      target: "antigravity",
      prompt: target.prompt,
      path: target.path,
    });
    if (!ok) {
      toast("Antigravity terminal starting", `Copied prompt: ${target.prompt.trim()}`, "info");
      try { await navigator.clipboard?.writeText(target.prompt); } catch { /* ignore */ }
    }
  }

  const agyChipTitle = $derived(
    `Antigravity · ${effectiveSpecialist ? `${effectiveSpecialist} · ` : ""}${activeModelPill.label}${
      agyLiveSubagents > 0 ? ` · ${agyLiveSubagents} live subagent(s)` : agyLiveRoots > 0 ? ` · ${agyLiveRoots} active session(s)` : ""
    } — Click to switch model, pick vault @specialist, or send @note#Lfrom-to`,
  );

  const connLabel = $derived(app.conn === "open" ? "Connected" : app.conn === "connecting" ? "Connecting…" : "Offline — retrying");
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const dirtyCount = $derived(Object.keys(app.dirty).length);

  let docTick = $state(0);
  $effect(() => {
    const onDocChange = () => { docTick++; };
    window.addEventListener("kandinsky-doc-change", onDocChange);
    return () => window.removeEventListener("kandinsky-doc-change", onDocChange);
  });

  const activeMdInfo = $derived.by(() => {
    void docTick;
    void tabs.active;
    void context.active;
    const edHandle = editors.get(activeEditorId() ?? lastEditorId() ?? "");
    if (!edHandle || !/\.(md|markdown)$/i.test(edHandle.path)) return null;
    const text = edHandle.snapshot().text;
    const fm = frontmatterOf(text);
    const data = fm?.data ?? null;
    let rawVal: unknown = undefined;
    if (data) {
      for (const [k, v] of Object.entries(data)) {
        if (k.toLowerCase() === "verification") { rawVal = v; break; }
      }
    }
    const rawVerify =
      rawVal === undefined || rawVal === null
        ? ""
        : (Array.isArray(rawVal) ? rawVal.map(String).join(" ") : String(rawVal)).trim();
    const hasVerification = rawVerify.length > 0;
    const vLow = rawVerify.toLowerCase();
    const verifyClean =
      vLow.includes("clean") || vLow.includes("verified") || vLow === "true" || vLow === "pass" || vLow === "passed";
    const body = fm ? text.slice(fm.end) : text;
    const words = body
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/[#*_`~>\[\]()|!$]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    return { words, hasVerification, verifyClean, rawVerify };
  });

  /** The cell whose panel is open, and its button (the popover's anchor). */
  let opened = $state<{ cell: StatusCell; anchor: HTMLElement } | null>(null);
  const toggle = (cell: StatusCell, anchor: HTMLElement) => {
    agyOpen = false;
    opened = opened?.cell.key === cell.key ? null : { cell, anchor };
  };
  /** The plugin draws its panel into the popover's body; its cleanup runs when the popover closes. */
  function drawn(host: HTMLElement, cell: StatusCell) {
    const done = cell.panel?.(host, () => { opened = null; });
    return { destroy: () => { if (typeof done === "function") done(); } };
  }
</script>

<footer class="status" class:notion={isNotionShell()}>
  {#if isNotionShell()}
    {#if devMode && activeMdInfo?.hasVerification}
      <span class="sb-verify">
        <span class="v-dot" class:clean={activeMdInfo.verifyClean}>●</span>
        {activeMdInfo.verifyClean ? "c_lint: verified" : `c_lint: ${activeMdInfo.rawVerify}`}
      </span>
    {/if}
  {:else if tabs.layout !== "vertical"}
    <!-- the tab sidebar names the workspace itself -->
    <span class="ws" title={app.workspace?.root ?? ""}>{app.workspace?.name ?? "—"}</span>
  {/if}
  {#if zoomShown.percent !== 100}
    <button class="cell zoom" data-cell="zoom" onclick={() => zoomPane(0)} title={tipFor(`This tab is shown at ${zoomShown.percent} % of the settings' sizes. Click for 100 %`, "ui.zoomReset")}>{zoomShown.percent} %</button>
  {/if}
  {#if dirtyCount}<span class="saving">{dirtyCount} unsaved</span>{/if}
  <span class="grow"></span>
  {#each visibleStatusCells as c (c.key)}
    {@const isSolver = c.key === "solver:solver" || c.text.includes("Solver")}
    {@const solverOpen = isSolver && c.text.includes(": open")}
    {@const solverOffline = isSolver && c.text.includes(": offline")}
    {#if c.panel}<button class="cell" class:solver-chip={isSolver} class:solver-open={solverOpen} class:solver-offline={solverOffline} class:open={opened?.cell.key === c.key} title={c.title} data-cell={c.key} aria-haspopup="dialog" aria-expanded={opened?.cell.key === c.key} onclick={(e) => toggle(c, e.currentTarget)}>{c.text}</button>
    {:else if c.run}<button class="cell" class:solver-chip={isSolver} class:solver-open={solverOpen} class:solver-offline={solverOffline} title={c.title} data-cell={c.key} onclick={() => void c.run?.()}>{c.text}</button>
    {:else}<span class="cell" class:solver-chip={isSolver} class:solver-open={solverOpen} class:solver-offline={solverOffline} title={c.title} data-cell={c.key}>{c.text}</span>{/if}
  {/each}
  {#if devMode && isNotionShell() && !hasSolverCell && !solverDisabled}
    <button
      type="button"
      class="cell solver-chip"
      data-cell="solver:solver"
      title="Open Solver side-by-side"
      onclick={() => open({ kind: "plugin", id: "solver", title: "Solver" }, { beside: true })}
    >Σ Solver: ready</button>
  {/if}
  {#if devMode}
    <button
      class="cell sb-item agy-chip"
      class:open={agyOpen}
      class:has-spec={!!effectiveSpecialist}
      bind:this={agyAnchor}
      title={agyChipTitle}
      data-cell="agy"
      data-testid="agy-chip"
      aria-haspopup="dialog"
      aria-expanded={agyOpen}
      onclick={() => {
        opened = null;
        specialistQuery = "";
        agyOpen = !agyOpen;
      }}
    >
      <span class="agy-dot" class:live={agyLiveSubagents + agyLiveRoots > 0} aria-hidden="true">●</span>
      <span class="agy-brand">agy</span>
      {#if effectiveSpecialist}
        <span class="agy-badge">{effectiveSpecialist}</span>
      {/if}
      <span class="agy-sep" aria-hidden="true">·</span>
      <span class="agy-model">{activeModelPill.short}</span>
      {#if agyLiveSubagents > 0}
        <span class="agy-subcount" title="{agyLiveSubagents} live subagent(s)">⚡{agyLiveSubagents}</span>
      {/if}
    </button>
  {/if}
  {#if isNotionShell() && activeMdInfo}
    <span class="sb-words">{plural(activeMdInfo.words, "word")}</span>
  {/if}
  {#if devMode && app.problems}
    <button class="problems" class:bad={app.problems.errors > 0} onclick={showProblems} title={tipFor("Problems in this file", "ui.problems")}
      aria-label="Problems: {plural(app.problems.errors, 'error')}, {plural(app.problems.warnings, 'warning')}">
      <Icon name="error" size={12} />{app.problems.errors}<Icon name="warning" size={12} />{app.problems.warnings}
    </button>
  {/if}
  {#if devMode || app.vimEnabled}
    <button class="vim" class:off={!app.vimEnabled} data-mode={app.vimMode} onclick={toggleVim} title="Toggle vim mode" data-testid="vim-mode">
      {#if app.vimEnabled}{app.vimMode || "VIM"}{:else}vim off{/if}
    </button>
  {/if}
  <span class="conn" title={connLabel} data-state={app.conn} data-testid="conn"><span class="dot"></span>{connLabel}</span>
</footer>

{#if devMode && agyOpen && agyAnchor}
  <Popover anchor={agyAnchor} label="Antigravity Model & Specialist Switcher" width={320} onclose={() => (agyOpen = false)}>
    <div class="agy-pop" data-testid="agy-popover">
      <div class="agy-pop-sec">
        <div class="agy-pop-head">
          <span class="agy-pop-k"><span class="agy-k-dot">●</span> Antigravity Model</span>
          <span class="agy-pop-slug">{activeModelPill.short}</span>
        </div>
        <div class="agy-pills" role="radiogroup" aria-label="Antigravity model">
          {#each AGY_MODEL_PILLS as pill (pill.id)}
            {@const active = activeModelPill.id === pill.id}
            <button
              type="button"
              role="radio"
              aria-checked={active}
              class="agy-pill-btn"
              class:active
              title="{pill.label} ({pill.slug})"
              onclick={() => pickAgyModel(pill)}
            >
              <span>{pill.label}</span>
              {#if active}<span class="agy-pill-mark" aria-hidden="true">●</span>{/if}
            </button>
          {/each}
        </div>
      </div>

      {#if specialists.length > 0}
        <div class="agy-pop-sec agy-spec-sec">
          <div class="agy-pop-head">
            <span class="agy-pop-k">Vault @specialist</span>
            <span class="agy-pop-slug">{specialists.length} in vault</span>
          </div>
          {#if specialists.length > 6}
            <input
              type="search"
              class="agy-filter"
              placeholder="Filter @specialists…"
              aria-label="Filter vault specialists"
              bind:value={specialistQuery}
            />
          {/if}
          <div class="agy-spec-list" role="listbox" aria-label="Vault specialists">
            {#if !specialistQuery.trim() || "coordinator (no @specialist)".includes(specialistQuery.trim().toLowerCase())}
              <button
                type="button"
                role="option"
                aria-selected={!effectiveSpecialist}
                class="agy-spec-row"
                class:active={!effectiveSpecialist}
                onclick={() => pickAgySpecialist("")}
              >
                <div class="agy-spec-top">
                  <span class="agy-spec-coord">Coordinator (no @specialist)</span>
                  {#if !effectiveSpecialist}<span class="agy-pill-mark" aria-hidden="true">●</span>{/if}
                </div>
                <div class="agy-spec-desc">Direct research session in active vault</div>
              </button>
            {/if}
            {#each filteredSpecialists as sp (sp.id)}
              {@const isSelected = effectiveSpecialist === sp.handle}
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                class="agy-spec-row"
                class:active={isSelected}
                title={sp.description || sp.title}
                onclick={() => pickAgySpecialist(sp.handle)}
              >
                <div class="agy-spec-top">
                  <span class="agy-spec-handle">{sp.handle}</span>
                  {#if isSelected}<span class="agy-pill-mark" aria-hidden="true">●</span>{/if}
                </div>
                {#if sp.description}
                  <div class="agy-spec-desc">{sp.description}</div>
                {/if}
              </button>
            {/each}
            {#if filteredSpecialists.length === 0 && !"coordinator (no @specialist)".includes(specialistQuery.trim().toLowerCase())}
              <div class="agy-spec-empty">No matching @specialist</div>
            {/if}
          </div>
        </div>
      {/if}

      <div class="agy-pop-actions">
        <button
          type="button"
          class="agy-act-btn primary"
          title="Open or focus Antigravity terminal in vault root (Shift+click for a new tab)"
          onclick={(e) => launchAgyInVault(e.shiftKey)}
        >
          <span>Launch <code>agy</code> in Vault</span>
          <span class="agy-act-meta">{effectiveSpecialist || activeModelPill.short}</span>
        </button>
        <button
          type="button"
          class="agy-act-btn handoff"
          disabled={!activeNoteTarget}
          title={activeNoteTarget ? `Send ${activeNoteTarget.prompt.trim()} into Antigravity terminal` : "Open a note in the editor first to send @path#Lfrom-to"}
          onclick={() => void sendActiveSelectionToAgy()}
        >
          {#if activeNoteTarget}
            <span class="agy-handoff-lbl">{activeNoteTarget.buttonLabel}</span>
          {:else}
            <span class="agy-handoff-empty">No open note — open a file to send @note#Lfrom-to</span>
          {/if}
        </button>
      </div>
    </div>
  </Popover>
{/if}

{#if opened}
  {#key opened.cell.key}
    <Popover anchor={opened.anchor} label={opened.cell.title ?? opened.cell.text} width={opened.cell.panelWidth ?? 380} onclose={() => (opened = null)}>
      <div class="cell-panel" data-panel={opened.cell.key} use:drawn={opened.cell}></div>
    </Popover>
  {/key}
{/if}

<style>
  .status { height: var(--status-h); flex: none; display: flex; align-items: center; gap: 14px; padding: 0 12px 0 14px; background: var(--bg-alt, var(--bg-app)); border-top: 1px solid var(--border); color: var(--text-muted); font-size: calc(11.5px * var(--ui-scale, 1)); user-select: none; }
  .status.notion { --status-h: 24px; height: 24px; padding: 0 14px; font-size: calc(11px * var(--ui-scale, 1)); }
  .ws { color: var(--text-muted); font-weight: 500; }
  .sb-verify { display: inline-flex; align-items: center; gap: 5px; color: var(--text-muted); white-space: nowrap; }
  .sb-verify .v-dot { font-size: 9.5px; line-height: 1; color: var(--yellow); }
  .sb-verify .v-dot.clean { color: var(--green); }
  .sb-words { color: var(--text-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .grow { flex: 1; }
  /* a plugin's cell: quiet text; a button only shows it on hover */
  .cell { max-width: 28ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button.cell { padding: 1px 6px; border-radius: 5px; color: inherit; }
  button.cell:hover, button.cell.open { background: var(--bg-hover); color: var(--text); }
  .cell[data-cell="solver:solver"], .solver-chip {
    display: inline-flex; align-items: center; padding: 1px 6px; border-radius: 5px;
    color: var(--text-muted); font-variant-numeric: tabular-nums; letter-spacing: -0.005em;
    transition: background .12s, color .12s;
  }
  button.cell[data-cell="solver:solver"]:hover, button.solver-chip:hover {
    background: var(--bg-hover); color: var(--heading, var(--text));
  }
  .solver-chip.solver-open { color: var(--green); }
  .solver-chip.solver-offline { color: var(--text-faint); }
  .sb-item.agy-chip { max-width: 38ch; display: inline-flex; align-items: center; gap: 5px; padding: 1px 7px; border-radius: 5px; color: var(--text-muted); font-weight: 500; transition: background .12s, color .12s; }
  .sb-item.agy-chip:hover, .sb-item.agy-chip.open { background: var(--bg-hover); color: var(--heading, var(--text)); }
  .agy-dot { font-size: 9px; line-height: 1; color: var(--green); }
  .sb-item.agy-chip.has-spec .agy-dot { color: var(--accent); }
  .agy-dot.live { color: var(--green); text-shadow: 0 0 6px color-mix(in srgb, var(--green) 55%, transparent); }
  .agy-brand { font-family: var(--font-mono); font-size: calc(11px * var(--ui-scale, 1)); font-weight: 600; color: var(--text); letter-spacing: -0.01em; }
  .agy-badge { font-family: var(--font-mono); font-size: calc(10.5px * var(--ui-scale, 1)); font-weight: 600; color: var(--accent); background: var(--accent-soft); padding: 0 5px; border-radius: 4px; line-height: 1.45; }
  .agy-sep { color: var(--text-faint); }
  .agy-model { color: var(--text-muted); }
  .agy-subcount { font-size: 10px; color: var(--green); font-weight: 600; margin-left: 1px; }

  /* Notion × Bauhaus Popover Body (width: 320px via Popover) */
  .agy-pop { display: flex; flex-direction: column; gap: 10px; padding: 4px; color: var(--text); }
  .agy-pop-sec { display: flex; flex-direction: column; gap: 6px; padding-bottom: 9px; border-bottom: 1px solid var(--border); }
  .agy-pop-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  .agy-pop-k { font-size: 11px; font-weight: 600; color: var(--text-muted); letter-spacing: 0.01em; display: inline-flex; align-items: center; gap: 5px; }
  .agy-k-dot { color: var(--green); font-size: 9px; }
  .agy-pop-slug { font-family: var(--font-mono); font-size: 10.5px; color: var(--text-faint); }
  .agy-pills { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
  .agy-pill-btn { display: flex; align-items: center; justify-content: space-between; gap: 4px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: 11.5px; font-weight: 500; text-align: left; transition: background .12s, border-color .12s; }
  .agy-pill-btn:hover { background: var(--bg-hover); border-color: var(--border-strong); }
  .agy-pill-btn.active { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); font-weight: 600; }
  .agy-pill-mark { font-size: 8.5px; color: var(--accent); flex: none; }
  .agy-filter { width: 100%; padding: 5px 8px; border-radius: 6px; border: 1px solid var(--border-strong); background: var(--bg); color: var(--text); font-size: 11.5px; outline: none; }
  .agy-filter:focus { border-color: var(--accent); }
  .agy-spec-list { display: flex; flex-direction: column; gap: 2px; max-height: 196px; overflow-y: auto; padding-right: 2px; }
  .agy-spec-row { display: flex; flex-direction: column; gap: 1px; padding: 5px 8px; border-radius: 6px; border: 1px solid transparent; background: transparent; text-align: left; color: var(--text); }
  .agy-spec-row:hover { background: var(--bg-hover); }
  .agy-spec-row.active { background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 42%, transparent); }
  .agy-spec-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  .agy-spec-handle { font-family: var(--font-mono); font-size: 11.5px; font-weight: 600; color: var(--accent); }
  .agy-spec-coord { font-size: 11.5px; font-weight: 600; color: var(--heading, var(--text)); }
  .agy-spec-desc { font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .agy-spec-empty { font-size: 11px; color: var(--text-faint); padding: 6px 4px; text-align: center; }
  .agy-pop-actions { display: flex; flex-direction: column; gap: 5px; }
  .agy-act-btn { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border-strong); background: var(--bg); color: var(--text); font-size: 11.5px; font-weight: 500; text-align: left; }
  .agy-act-btn:hover:not(:disabled) { background: var(--bg-hover); }
  .agy-act-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg, #fff); font-weight: 600; }
  .agy-act-btn.primary:hover { background: var(--accent-hover, var(--accent)); }
  .agy-act-btn.primary code { font-family: var(--font-mono); font-size: 11px; background: color-mix(in srgb, var(--accent-fg) 16%, transparent); padding: 0 4px; border-radius: 3px; color: inherit; }
  .agy-act-meta { font-family: var(--font-mono); font-size: 10.5px; opacity: 0.9; }
  .agy-act-btn.handoff:not(:disabled) { border-color: color-mix(in srgb, var(--accent) 45%, var(--border-strong)); background: var(--accent-soft); color: var(--accent); font-weight: 600; }
  .agy-act-btn:disabled { opacity: 0.55; cursor: not-allowed; }
  .agy-handoff-lbl { font-family: var(--font-mono); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%; }
  .agy-handoff-empty { font-size: 11px; color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .saving { color: var(--yellow); }
  .vim { font-family: var(--font-mono); font-size: calc(10.5px * var(--ui-scale, 1)); font-weight: 600; letter-spacing: .06em; padding: 1px 8px; border-radius: 5px; color: var(--text-muted); background: var(--bg-hover); min-width: 64px; text-align: center; }
  .vim[data-mode="INSERT"] { color: var(--bg); background: var(--green); }
  .vim[data-mode="VISUAL"], .vim[data-mode="V-LINE"], .vim[data-mode="V-BLOCK"] { color: var(--bg); background: var(--purple); }
  .vim[data-mode="REPLACE"] { color: var(--bg); background: var(--red); }
  .problems { display: inline-flex; align-items: center; gap: 4px; color: var(--text-muted); padding: 1px 6px; border-radius: 5px; font-variant-numeric: tabular-nums; }
  .problems:hover { background: var(--bg-hover); color: var(--text); }
  .problems.bad { color: var(--red); }
  .conn { display: inline-flex; align-items: center; gap: 6px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-faint); transition: background .2s; }
  .conn[data-state="open"] .dot { background: var(--green); box-shadow: 0 0 0 3px color-mix(in srgb, var(--green) 18%, transparent); }
  .conn[data-state="connecting"] .dot { background: var(--yellow); animation: pulse 1.2s ease-in-out infinite; }
  .conn[data-state="closed"] .dot { background: var(--red); }
</style>
