<script lang="ts">
  // Vault frontmatter schema health widget: audits notes against properties.yaml and jumps to issue lines.
  import { onMount } from "svelte";
  import Icon from "../Icon.svelte";
  import { api } from "../../lib/api";
  import { openPath } from "../../lib/dock";
  import { shownPath } from "../../lib/paths";
  import { reloadOnChange } from "../../lib/reload-on-change";
  import { errReason } from "../../lib/text";

  let { options = {} }: { options?: Record<string, unknown>; doc?: string } = $props();

  type AuditIssueKind = "missing-required" | "invalid-value" | "broken-link" | "unknown-property";
  interface AuditIssue {
    path: string; line: number; key: string; kind: AuditIssueKind; message: string; note_type?: string;
  }
  interface AuditReport {
    spec_path: string; spec_found: boolean; strict: boolean;
    notes_scanned: number; spec_problems: string[]; issues: AuditIssue[];
  }
  type KindFilter = "all" | AuditIssueKind;

  const KIND_PILLS: readonly { id: KindFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "missing-required", label: "Missing required" },
    { id: "invalid-value", label: "Invalid value" },
    { id: "broken-link", label: "Broken link" },
    { id: "unknown-property", label: "Unknown" },
  ];
  const KIND_BADGE: Record<AuditIssueKind, { label: string; tone: "red" | "yellow" | "orange" | "muted" }> = {
    "missing-required": { label: "missing required", tone: "red" },
    "invalid-value": { label: "invalid value", tone: "orange" },
    "broken-link": { label: "broken link", tone: "yellow" },
    "unknown-property": { label: "unknown", tone: "muted" },
  };

  let rootEl = $state<HTMLElement | null>(null);
  let strict = $state(false);
  let query = $state("");
  let kindFilter = $state<KindFilter>("all");
  let report = $state<AuditReport | null>(null);
  let loading = $state(true);
  let errorMsg = $state("");

  $effect(() => { strict = options.strict === true; });

  let reqSeq = 0;
  async function refresh(): Promise<void> {
    const seq = ++reqSeq;
    loading = true;
    try {
      const fn = (api as unknown as { propertiesAudit: (s?: boolean) => Promise<AuditReport> }).propertiesAudit;
      const res = await fn.call(api, strict);
      if (seq !== reqSeq) return;
      report = res;
      errorMsg = "";
    } catch (err) {
      if (seq !== reqSeq) return;
      errorMsg = errReason(err);
    } finally {
      if (seq === reqSeq) loading = false;
    }
  }

  $effect(() => { void strict; void refresh(); });

  onMount(() =>
    reloadOnChange(() => void refresh(), {
      wait: 400,
      wants: (p) => /\.(md|markdown|ya?ml)$/i.test(p),
      host: () => rootEl,
    }),
  );

  const countsByKind = $derived.by((): Record<KindFilter, number> => {
    const base: Record<KindFilter, number> = { all: 0, "missing-required": 0, "invalid-value": 0, "broken-link": 0, "unknown-property": 0 };
    for (const iss of report?.issues ?? []) {
      base.all += 1;
      if (iss.kind in base) base[iss.kind] += 1;
    }
    return base;
  });

  const filteredIssues = $derived.by((): AuditIssue[] => {
    const all = report?.issues ?? [];
    const q = query.trim().toLowerCase();
    return all.filter((iss) => {
      if (kindFilter !== "all" && iss.kind !== kindFilter) return false;
      if (!q) return true;
      return iss.path.toLowerCase().includes(q) || iss.key.toLowerCase().includes(q) || iss.message.toLowerCase().includes(q) || (iss.note_type?.toLowerCase().includes(q) ?? false);
    });
  });

  const groupedByNote = $derived.by((): { path: string; noteType: string; items: AuditIssue[] }[] => {
    const map = new Map<string, { path: string; noteType: string; items: AuditIssue[] }>();
    for (const iss of filteredIssues) {
      let g = map.get(iss.path);
      if (!g) { g = { path: iss.path, noteType: iss.note_type ?? "", items: [] }; map.set(iss.path, g); }
      g.items.push(iss);
    }
    return [...map.values()];
  });

  const isClean = $derived(Boolean(report && report.issues.length === 0 && report.spec_problems.length === 0));
</script>

<section class="pa-widget" bind:this={rootEl} data-testid="properties-audit-widget" aria-label="Properties schema audit">
  <header class="pa-head">
    <div class="pa-summary">
      {#if report}
        {#if isClean}
          <span class="status-pill clean" data-testid="audit-clean-badge">
            <Icon name="check" size={13} />
            <strong>All {report.notes_scanned} {report.notes_scanned === 1 ? "note matches" : "notes match"} schema</strong>
          </span>
        {:else}
          <span class="status-pill issues" data-testid="audit-summary-text">
            <Icon name="warning" size={13} />
            <strong>{report.notes_scanned} {report.notes_scanned === 1 ? "note" : "notes"} scanned · {report.issues.length} {report.issues.length === 1 ? "issue" : "issues"}</strong>
          </span>
        {/if}
        {#if report.spec_path}
          <button type="button" class="spec-link" onclick={() => openPath(report!.spec_path)} title="Open schema file">
            <code>{report.spec_path}</code>
          </button>
        {/if}
      {:else}
        <span class="muted">{loading ? "Scanning note properties…" : "Properties audit"}</span>
      {/if}
    </div>

    <div class="pa-head-right">
      <label class="strict-toggle">
        <input type="checkbox" class="kandinsky-check" data-testid="audit-strict-toggle" bind:checked={strict} />
        <span>Report undeclared properties</span>
      </label>
      <button type="button" class="icon-btn" aria-label="Refresh properties audit" disabled={loading} onclick={() => void refresh()}>
        <Icon name="refresh" size={14} />
      </button>
    </div>
  </header>

  <div class="pa-controls">
    <div class="kandinsky-seg" role="tablist" aria-label="Issue kind filter">
      {#each KIND_PILLS as pill (pill.id)}
        <button type="button" role="tab" aria-selected={kindFilter === pill.id} class:on={kindFilter === pill.id} onclick={() => (kindFilter = pill.id)}>
          <span>{pill.label}</span>
          <span class="count">{countsByKind[pill.id]}</span>
        </button>
      {/each}
    </div>
    <div class="search-box">
      <Icon name="search" size={13} />
      <input type="search" data-testid="audit-filter-input" placeholder="Filter by note, property, or message…" bind:value={query} />
    </div>
  </div>

  {#if errorMsg}
    <div class="kandinsky-notice error" role="alert">
      <strong>Could not run properties audit</strong>
      <span>{errorMsg}</span>
    </div>
  {:else if report}
    {#if !report.spec_found}
      <div class="kandinsky-notice">
        <strong>No property schema file found at <code>{report.spec_path}</code></strong>
        <span>Create <code>{report.spec_path}</code> to declare required keys, allowed values, and note types.</span>
      </div>
    {/if}

    {#if report.spec_problems.length > 0}
      <ul class="spec-warn-list" data-testid="audit-spec-problems">
        {#each report.spec_problems as prob, idx (idx)}
          <li><Icon name="warning" size={13} /> <span>{prob}</span></li>
        {/each}
      </ul>
    {/if}

    {#if groupedByNote.length > 0}
      <div class="group-list scroll">
        {#each groupedByNote as group (group.path)}
          <div class="note-group">
            <div class="note-head">
              <Icon name="file-text" size={13} />
              <span class="note-path">{shownPath(group.path)}</span>
              {#if group.noteType}<span class="type-chip">{group.noteType}</span>{/if}
              <span class="note-count">{group.items.length}</span>
            </div>
            {#each group.items as issue, ii (`${issue.line}-${issue.key}-${ii}`)}
              {@const badge = KIND_BADGE[issue.kind] ?? { label: issue.kind, tone: "muted" }}
              <button type="button" class="issue-row" data-testid="audit-issue-row" onclick={() => openPath(issue.path, issue.line)}>
                <span class={`kind-chip ${badge.tone}`}>{badge.label}</span>
                <code class="prop-key">{issue.key}</code>
                <span class="issue-msg">{issue.message}</span>
                <span class="line-num">:{issue.line}</span>
              </button>
            {/each}
          </div>
        {/each}
      </div>
    {:else if report.issues.length > 0}
      <p class="kandinsky-empty">No issues match the current filter</p>
    {/if}
  {/if}
</section>

<style>
  .pa-widget { display: flex; flex-direction: column; gap: 10px; padding: 4px 2px; color: var(--text); }
  .pa-head, .pa-controls { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .pa-summary, .pa-head-right { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .status-pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; font-size: calc(12px * var(--ui-scale, 1)); font-variant-numeric: tabular-nums; }
  .status-pill.clean { color: var(--green); background: var(--green-soft); border: 1px solid color-mix(in srgb, var(--green) 40%, var(--border)); }
  .status-pill.issues { color: var(--yellow); background: var(--yellow-soft); border: 1px solid color-mix(in srgb, var(--yellow) 40%, var(--border)); }
  .spec-link { color: var(--text-muted); font-size: calc(11.5px * var(--ui-scale, 1)); }
  .spec-link:hover { color: var(--accent); text-decoration: underline; }
  .strict-toggle { display: inline-flex; align-items: center; gap: 6px; font-size: calc(12px * var(--ui-scale, 1)); color: var(--text-muted); cursor: pointer; }
  .search-box { display: inline-flex; align-items: center; gap: 6px; padding: 0 8px; flex: 1 1 200px; max-width: 300px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--bg); color: var(--text-muted); }
  .search-box:focus-within { border-color: var(--accent); }
  .search-box input { flex: 1; min-width: 0; border: 0; background: transparent; color: var(--text); font-size: calc(12px * var(--ui-scale, 1)); padding: 4px 0; outline: none; }
  .spec-warn-list { margin: 0; padding: 8px 10px; list-style: none; border-radius: var(--radius-sm); background: var(--yellow-soft); border: 1px solid color-mix(in srgb, var(--yellow) 38%, var(--border)); display: flex; flex-direction: column; gap: 4px; font-size: calc(12px * var(--ui-scale, 1)); }
  .spec-warn-list li { display: flex; align-items: flex-start; gap: 6px; }
  .group-list { display: flex; flex-direction: column; gap: 7px; max-height: 420px; overflow-y: auto; }
  .note-group { border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-alt); overflow: hidden; }
  .note-head { display: flex; align-items: center; gap: 6px; padding: 5px 9px; background: var(--bg-elev); border-bottom: 1px solid var(--border); font-size: calc(12px * var(--ui-scale, 1)); }
  .note-path { font-weight: 600; color: var(--heading); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .type-chip { padding: 0 6px; border-radius: 999px; font-family: var(--font-mono); font-size: calc(10.5px * var(--ui-scale, 1)); color: var(--accent); background: var(--accent-soft); }
  .note-count { margin-left: auto; font-variant-numeric: tabular-nums; font-size: calc(11px * var(--ui-scale, 1)); color: var(--text-faint); }
  .issue-row { width: 100%; display: flex; align-items: center; gap: 8px; padding: 6px 9px; text-align: left; border-top: 1px solid var(--border); font-size: calc(12px * var(--ui-scale, 1)); color: var(--text); }
  .note-head + .issue-row { border-top: 0; }
  .issue-row:hover { background: var(--bg-hover); }
  .kind-chip { flex: none; padding: 1px 7px; border-radius: 999px; font-size: calc(10.5px * var(--ui-scale, 1)); font-weight: 600; background: var(--bg-elev); border: 1px solid var(--border-strong); color: var(--text-muted); }
  .kind-chip.red { color: var(--red); background: var(--red-soft); border-color: color-mix(in srgb, var(--red) 35%, var(--border)); }
  .kind-chip.orange { color: var(--orange); background: var(--orange-soft); border-color: color-mix(in srgb, var(--orange) 35%, var(--border)); }
  .kind-chip.yellow { color: var(--yellow); background: var(--yellow-soft); border-color: color-mix(in srgb, var(--yellow) 38%, var(--border)); }
  .prop-key { flex: none; color: var(--inline-code); font-size: calc(11.5px * var(--ui-scale, 1)); }
  .issue-msg { flex: 1; min-width: 0; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .line-num { flex: none; font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: calc(11px * var(--ui-scale, 1)); color: var(--text-faint); }
</style>
