<script lang="ts">
  // Inline Oracle verification (`c_lint`) & Wiki filing (`oracle_wiki.py file-computation`) bar for Markdown notes.
  import { onMount } from "svelte";
  import Icon from "./Icon.svelte";
  import { api } from "../lib/api";
  import { openPath } from "../lib/dock";
  import {
    fileToWiki,
    runCLint,
    type CLintIssue,
    type CLintResponse,
    type FileToWikiResponse,
    type OracleWikiPageType,
  } from "../lib/oracle-runner";
  import { shownName } from "../lib/paths";
  import { toast } from "../lib/state.svelte";
  import { errText } from "../lib/text";

  let {
    path,
    flush = async () => {},
    gotoLine = (_line: number) => {},
  }: {
    path: string;
    flush?: () => Promise<void>;
    gotoLine?: (line: number) => void;
  } = $props();

  type LintPhase = "idle" | "running" | "clean" | "issues";

  let lintPhase = $state<LintPhase>("idle");
  let lintRes = $state<CLintResponse | null>(null);
  let popOpen = $state(false);

  // Wiki filing modal state
  let wikiOpen = $state(false);
  let wikiTitle = $state("");
  let wikiType = $state<OracleWikiPageType>("concept");
  let wikiDest = $state("");
  let wikiProblem = $state("");
  let wikiComputation = $state("");
  let wikiSummary = $state("");
  let wikiAcceptedWords = $state(""); // NEVER prefill or invent acceptance words!
  let wikiAcceptedDate = $state("");
  let wikiDateConfirmed = $state(false);
  let wikiReplace = $state(false);
  let wikiSubmitting = $state(false);
  let wikiResult = $state<FileToWikiResponse | null>(null);
  let wikiError = $state("");

  const TYPE_FOLDER: Record<OracleWikiPageType, string> = {
    concept: "concepts",
    question: "questions",
    comparison: "comparisons",
    entity: "entities",
    source: "sources",
    session: "sessions",
  };

  function localTodayIso(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function slugifyTitle(raw: string): string {
    const cleaned = raw
      .replace(/^C\d+\s*[-—:]?\s*/i, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
    return cleaned || "Untitled-Result";
  }

  function inferProblemFromPath(p: string): string {
    const norm = p.replace(/\\/g, "/");
    const m = /^(?:zAI\/)?problems\/([^/]+)\//i.exec(norm);
    return m ? m[1] : "";
  }

  let trackedPath = "";
  $effect(() => {
    if (path !== trackedPath) {
      trackedPath = path;
      lintPhase = "idle";
      lintRes = null;
      popOpen = false;
    }
  });

  onMount(() => {
    const onDocClick = () => {
      if (popOpen) popOpen = false;
    };
    window.addEventListener("click", onDocClick);
    return () => window.removeEventListener("click", onDocClick);
  });

  async function executeCLint() {
    if (lintPhase === "running" || !path) return;
    lintPhase = "running";
    try {
      await flush();
      const res = await runCLint(path);
      lintRes = res;
      if (res.clean) {
        lintPhase = "clean";
        popOpen = false;
      } else {
        lintPhase = "issues";
        popOpen = true;
      }
    } catch (e) {
      lintRes = {
        clean: false,
        issues: [{ line: 1, code: "EXEC_ERR", severity: "ERROR", message: errText(e) }],
        raw: errText(e),
      };
      lintPhase = "issues";
      popOpen = true;
    }
  }

  function onPillClick(e: MouseEvent) {
    e.stopPropagation();
    if (lintPhase === "idle") {
      void executeCLint();
    } else if (lintPhase === "clean" || lintPhase === "issues") {
      popOpen = !popOpen;
    }
  }

  function jumpToIssue(issue: CLintIssue) {
    const targetLine = typeof issue.line === "number" && issue.line >= 1 ? issue.line : 1;
    gotoLine(targetLine);
    popOpen = false;
  }

  async function openWikiModal(e: MouseEvent) {
    e.stopPropagation();
    popOpen = false;
    wikiResult = null;
    wikiError = "";
    wikiAcceptedWords = ""; // Strict rule: always empty on open — never invent acceptance words!
    wikiAcceptedDate = localTodayIso();
    wikiDateConfirmed = false;
    wikiReplace = false;

    let inferredTitle = shownName(path).replace(/\.md$/i, "");
    try {
      await flush();
      const doc = await api.file(path);
      const h1 = /^#\s+(.+)$/m.exec(doc.text);
      if (h1?.[1]?.trim()) inferredTitle = h1[1].trim();
    } catch {
      // Fallback to note filename if unreadable
    }

    wikiTitle = inferredTitle;
    wikiType = "concept";
    wikiDest = `wiki/${TYPE_FOLDER.concept}/${slugifyTitle(inferredTitle)}.md`;
    wikiProblem = inferProblemFromPath(path);
    wikiComputation = path;
    wikiSummary = "";
    wikiOpen = true;
  }

  function onWikiTypeChange() {
    const m = /^wiki\/[a-z]+\/(.+)$/i.exec(wikiDest.trim());
    if (m) {
      wikiDest = `wiki/${TYPE_FOLDER[wikiType]}/${m[1]}`;
    }
  }

  const todayDisplay = $derived(localTodayIso());
  const canSubmitWiki = $derived(
    !wikiSubmitting &&
      wikiTitle.trim().length > 0 &&
      wikiDest.trim().length > 0 &&
      wikiProblem.trim().length > 0 &&
      wikiComputation.trim().length > 0 &&
      wikiSummary.trim().length > 0 &&
      wikiAcceptedWords.trim().length > 0 &&
      wikiDateConfirmed &&
      /^\d{4}-\d{2}-\d{2}$/.test(wikiAcceptedDate.trim()),
  );

  async function submitWikiFiling(e: SubmitEvent) {
    e.preventDefault();
    if (!canSubmitWiki) return;
    wikiSubmitting = true;
    wikiError = "";
    wikiResult = null;
    try {
      await flush();
      const res = await fileToWiki({
        problem: wikiProblem.trim(),
        computation: wikiComputation.trim(),
        dest: wikiDest.trim(),
        title: wikiTitle.trim(),
        summary: wikiSummary.trim(),
        acceptedWords: wikiAcceptedWords.trim(),
        acceptedDate: wikiAcceptedDate.trim(),
        dateConfirmed: wikiDateConfirmed,
        type: wikiType,
        replace: wikiReplace,
        notePath: path,
      });
      wikiResult = res;
      if (res.ok) {
        toast("Filed computation to Oracle Wiki", res.destPath || wikiDest.trim(), "success");
      } else {
        wikiError = res.stderr || res.stdout || `oracle_wiki exited with code ${res.exitCode}`;
      }
    } catch (err) {
      wikiError = errText(err);
    } finally {
      wikiSubmitting = false;
    }
  }

  function openFiledNote() {
    const rawDest = wikiResult?.destPath || wikiDest.trim();
    const target = rawDest.endsWith(".md") ? rawDest : `${rawDest}.md`;
    wikiOpen = false;
    openPath(target);
  }
</script>

<div class="oracle-bar" data-testid="oracle-bar">
  <div class="pill-anchor">
    <button
      type="button"
      class="clint-pill"
      class:running={lintPhase === "running"}
      class:clean={lintPhase === "clean"}
      class:issues={lintPhase === "issues"}
      disabled={lintPhase === "running"}
      onclick={onPillClick}
      title={lintPhase === "idle"
        ? "Verify note structure & numerical receipts via c_lint.py"
        : "Click to inspect or re-run c_lint"}
    >
      {#if lintPhase === "idle"}
        <span class="glyph">◎</span><span>Run c_lint</span>
      {:else if lintPhase === "running"}
        <span class="glyph spin">◌</span><span>Checking…</span>
      {:else if lintPhase === "clean"}
        <span class="glyph">●</span><span>c_lint clean</span>
      {:else}
        {@const count = lintRes?.issues.length ?? 1}
        <span class="glyph">▲</span><span>{count} c_lint {count === 1 ? "issue" : "issues"}</span>
      {/if}
    </button>

    {#if popOpen && lintRes}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="clint-pop" tabindex="-1" onclick={(e) => e.stopPropagation()} role="dialog" aria-label="c_lint findings">
        <div class="pop-head">
          <strong>{lintRes.clean ? "● Receipt & Structure Check Passed" : `▲ ${lintRes.issues.length} Finding(s)`}</strong>
          <button type="button" class="mini-btn" onclick={() => void executeCLint()}>Re-run</button>
          <button type="button" class="icon-btn-xs" onclick={() => (popOpen = false)} aria-label="Close">
            <Icon name="close" size={12} />
          </button>
        </div>

        {#if lintRes.issues.length === 0}
          <p class="pop-clean-msg">Zero errors reported by <code>c_lint.py</code> on <code>{shownName(path)}</code>.</p>
        {:else}
          <ul class="issue-list">
            {#each lintRes.issues as issue, idx (idx)}
              <li>
                <button type="button" class="issue-row" onclick={() => jumpToIssue(issue)}>
                  <span class="line-badge">L{issue.line ?? 1}</span>
                  {#if issue.code}<span class="code-badge" class:warn={issue.severity === "WARN"}>{issue.code}</span>{/if}
                  <span class="issue-msg">{issue.message}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  </div>

  <button
    type="button"
    class="wiki-btn"
    onclick={openWikiModal}
    title="File an accepted computation into wiki/ via oracle_wiki.py"
  >
    File to Wiki…
  </button>
</div>

{#if wikiOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal-backdrop"
    onclick={() => { if (!wikiSubmitting) wikiOpen = false; }}
    onkeydown={(e) => { if (e.key === "Escape" && !wikiSubmitting) wikiOpen = false; }}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="wiki-modal" tabindex="-1" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="File Computation to Oracle Wiki">
      <header class="modal-head">
        <div>
          <h3>File Computation to Oracle Wiki</h3>
          <p class="sub">Runs <code>oracle_wiki.py file-computation</code> with verbatim PI acceptance provenance.</p>
        </div>
        <button type="button" class="icon-btn-xs" onclick={() => (wikiOpen = false)} disabled={wikiSubmitting} aria-label="Close modal">
          <Icon name="close" size={14} />
        </button>
      </header>

      <form class="wiki-form" onsubmit={submitWikiFiling}>
        <div class="field-row two-col">
          <label class="field">
            <span>Title <code>--title</code> *</span>
            <input type="text" bind:value={wikiTitle} required placeholder="Canonical concept or result title" />
          </label>
          <label class="field">
            <span>Page Type <code>--type</code></span>
            <select bind:value={wikiType} onchange={onWikiTypeChange}>
              <option value="concept">concept</option>
              <option value="question">question</option>
              <option value="comparison">comparison</option>
              <option value="entity">entity</option>
              <option value="source">source</option>
              <option value="session">session</option>
            </select>
          </label>
        </div>

        <label class="field">
          <span>Destination Wiki Page <code>--dest</code> *</span>
          <input type="text" bind:value={wikiDest} required placeholder="wiki/concepts/Result-Name.md" />
        </label>

        <div class="field-row two-col">
          <label class="field">
            <span>Problem ID / Folder <code>--problem</code> *</span>
            <input type="text" bind:value={wikiProblem} required placeholder="e.g. Anyon-Condensation" />
          </label>
          <label class="field">
            <span>Computation Note / ID <code>--computation</code> *</span>
            <input type="text" bind:value={wikiComputation} required placeholder="C01 or note path" />
          </label>
        </div>

        <label class="field">
          <span>Concise Summary <code>--summary</code> (1–3 lines) *</span>
          <textarea rows="2" bind:value={wikiSummary} required placeholder="1–3 line falsifiable summary for wiki/index.md & wiki/hot.md…"></textarea>
        </label>

        <label class="field">
          <span>Exact Acceptance Words <code>--accepted-words</code> * <em>(never prefilled)</em></span>
          <textarea
            rows="2"
            bind:value={wikiAcceptedWords}
            required
            placeholder="Paste or type the PI's exact acceptance words…"
          ></textarea>
        </label>

        <div class="date-confirm-box">
          <label class="field date-field">
            <span>Acceptance Date <code>--accepted-date</code> *</span>
            <input type="date" bind:value={wikiAcceptedDate} required />
          </label>
          <label class="check-row">
            <input type="checkbox" bind:checked={wikiDateConfirmed} />
            <span>I confirm this acceptance date (defaults to today {todayDisplay})</span>
          </label>
        </div>

        <label class="check-row subtle-check">
          <input type="checkbox" bind:checked={wikiReplace} />
          <span>Replace existing wiki page if destination already exists (<code>--replace</code>)</span>
        </label>

        {#if wikiError}
          <div class="feedback error">{wikiError}</div>
        {/if}

        {#if wikiResult?.ok}
          <div class="feedback success">
            <div>
              <strong>● Filed cleanly to <code>{wikiResult.destPath || wikiDest}</code></strong>
              {#if wikiResult.stdout}<div class="stdout-line">{wikiResult.stdout}</div>{/if}
            </div>
            <button type="button" class="open-dest-btn" onclick={openFiledNote}>
              Open Filed Note →
            </button>
          </div>
        {/if}

        <footer class="modal-foot">
          <button type="button" class="btn-cancel" onclick={() => (wikiOpen = false)} disabled={wikiSubmitting}>
            {wikiResult?.ok ? "Close" : "Cancel"}
          </button>
          <button type="submit" class="btn-submit" disabled={!canSubmitWiki}>
            {wikiSubmitting ? "◌ Filing to Wiki…" : "File Computation"}
          </button>
        </footer>
      </form>
    </div>
  </div>
{/if}

<style>
  .oracle-bar { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; flex: none; font-size: calc(11.5px * var(--ui-scale, 1)); }
  .pill-anchor { position: relative; display: inline-flex; }

  .clint-pill, .wiki-btn {
    display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 8px;
    border-radius: 999px; border: 1px solid var(--border); background: var(--bg-elev);
    color: var(--text-muted); font: inherit; font-weight: 500; white-space: nowrap; cursor: pointer;
    transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
  }
  .clint-pill:hover:not(:disabled), .wiki-btn:hover { background: var(--bg-hover); color: var(--text); border-color: var(--border-strong); }
  .clint-pill.running { color: var(--yellow, #dfab2e); border-color: color-mix(in srgb, var(--yellow, #dfab2e) 35%, var(--border)); cursor: wait; }
  .clint-pill.clean {
    color: var(--green, #3ca395);
    background: color-mix(in srgb, var(--green, #3ca395) 13%, transparent);
    border: 1px solid color-mix(in srgb, var(--green, #3ca395) 32%, transparent);
  }
  .clint-pill.issues {
    color: var(--red, #d94e41);
    background: color-mix(in srgb, var(--red, #d94e41) 13%, transparent);
    border: 1px solid color-mix(in srgb, var(--red, #d94e41) 34%, transparent);
  }
  .wiki-btn { border-radius: 6px; }
  .glyph { font-size: 10.5px; line-height: 1; }

  .clint-pop {
    position: absolute; right: 0; top: calc(100% + 6px); z-index: 50;
    width: min(440px, 82vw); max-height: 320px; display: flex; flex-direction: column;
    background: var(--bg-elev); border: 1px solid var(--border-strong); border-radius: 6px;
    box-shadow: var(--shadow-pop); overflow: hidden; color: var(--text);
  }
  .pop-head { display: flex; align-items: center; gap: 6px; padding: 7px 10px; border-bottom: 1px solid var(--border); font-size: 12px; }
  .pop-head strong { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mini-btn { padding: 2px 7px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg); color: var(--text-muted); font-size: 11px; cursor: pointer; }
  .mini-btn:hover { color: var(--text); border-color: var(--border-strong); }
  .icon-btn-xs { width: 22px; height: 22px; display: grid; place-items: center; border-radius: 4px; color: var(--text-muted); cursor: pointer; }
  .icon-btn-xs:hover { background: var(--bg-hover); color: var(--text); }
  .pop-clean-msg { margin: 0; padding: 10px 12px; color: var(--text-muted); font-size: 12px; }

  .issue-list { list-style: none; margin: 0; padding: 4px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
  .issue-row {
    width: 100%; display: flex; align-items: baseline; gap: 6px; text-align: left;
    padding: 5px 7px; border-radius: 4px; cursor: pointer; color: var(--text); font-size: 12px; line-height: 1.4;
  }
  .issue-row:hover { background: var(--bg-hover); }
  .line-badge { font-family: var(--font-mono); font-size: 11px; color: var(--accent); flex: none; min-width: 28px; }
  .code-badge { font-family: var(--font-mono); font-size: 10px; padding: 1px 5px; border-radius: 4px; color: var(--red, #d94e41); background: color-mix(in srgb, var(--red, #d94e41) 13%, transparent); flex: none; }
  .code-badge.warn { color: var(--yellow, #dfab2e); background: color-mix(in srgb, var(--yellow, #dfab2e) 14%, transparent); }
  .issue-msg { flex: 1; white-space: normal; word-break: break-word; }

  .modal-backdrop { position: fixed; inset: 0; z-index: 200; background: var(--scrim); display: grid; place-items: center; padding: 16px; }
  .wiki-modal { width: min(560px, 100%); max-height: calc(100vh - 32px); overflow-y: auto; background: var(--bg-elev); border: 1px solid var(--border-strong); border-radius: 6px; box-shadow: var(--shadow-pop); color: var(--text); }
  .modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 14px 16px 10px; border-bottom: 1px solid var(--border); }
  .modal-head h3 { margin: 0; font-size: 14.5px; font-weight: 600; }
  .modal-head .sub { margin: 3px 0 0; font-size: 12px; color: var(--text-muted); }

  .wiki-form { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 10px; font-size: 12.5px; }
  .field-row.two-col { display: grid; grid-template-columns: 1fr 150px; gap: 10px; }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field > span { font-size: 11.5px; font-weight: 500; color: var(--text-muted); }
  .field > span em { font-style: normal; color: var(--yellow, #dfab2e); }
  .field input, .field select, .field textarea {
    background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
    padding: 6px 8px; color: var(--text); font: inherit; outline: none;
  }
  .field input:focus, .field select:focus, .field textarea:focus { border-color: var(--accent); }

  .date-confirm-box { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); }
  .date-field { flex: 0 0 165px; }
  .check-row { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: var(--text); cursor: pointer; padding-bottom: 4px; flex: 1; min-width: 210px; }
  .subtle-check { color: var(--text-muted); padding-bottom: 0; }

  .feedback { padding: 8px 10px; border-radius: 6px; font-size: 12px; line-height: 1.4; }
  .feedback.error { color: var(--red, #d94e41); background: color-mix(in srgb, var(--red, #d94e41) 11%, transparent); border: 1px solid color-mix(in srgb, var(--red, #d94e41) 34%, transparent); white-space: pre-wrap; }
  .feedback.success { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--green, #3ca395); background: color-mix(in srgb, var(--green, #3ca395) 12%, transparent); border: 1px solid color-mix(in srgb, var(--green, #3ca395) 32%, transparent); }
  .stdout-line { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); margin-top: 2px; }
  .open-dest-btn { padding: 4px 10px; border-radius: 6px; background: var(--green); color: #fff; font-weight: 500; white-space: nowrap; cursor: pointer; } /* literal: white ink on saturated viridian button */

  .modal-foot { display: flex; justify-content: flex-end; gap: 8px; padding-top: 6px; border-top: 1px solid var(--border); }
  .btn-cancel { padding: 5px 12px; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: var(--text-muted); cursor: pointer; }
  .btn-cancel:hover { background: var(--bg-hover); color: var(--text); }
  .btn-submit { padding: 5px 14px; border-radius: 6px; border: 1px solid color-mix(in srgb, var(--accent) 50%, transparent); background: var(--accent); color: var(--accent-fg); font-weight: 500; cursor: pointer; }
  .btn-submit:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
