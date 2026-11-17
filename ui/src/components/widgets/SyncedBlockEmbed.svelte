<script lang="ts">
  import { tick as svelteTick } from "svelte";
  import Markdown from "../Markdown.svelte";
  // Live editable synced block card: transcludes a block anchored by ^block-id and syncs edits back to the source Markdown file.
  import { onMount, onDestroy } from "svelte";
  import Icon from "../Icon.svelte";
  import { openPath } from "../../lib/dock";
  import { api } from "../../lib/api";
  import { resolveWikilink } from "../../lib/links";
  import { shownName } from "../../lib/paths";
  import { errText } from "../../lib/text";
  import { onVaultChange } from "../../lib/vault";
  import type { Mtime } from "../../lib/gen/Mtime";

  let { options, doc }: { options: Record<string, unknown>; doc: string } = $props();

  let resolvedPath = $state("");
  let blockId = $state("");
  let text = $state("");
  let lastSavedText = $state("");
  let mtime = $state<Mtime | undefined>(undefined);
  let loading = $state(true);
  let saving = $state(false);
  let dirty = $state(false);
  let cycleDetected = $state(false);
  let loadError = $state("");
  let saveError = $state("");
  let focused = $state(false);
  let hostEl: HTMLDivElement | undefined = $state();
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let dirtySeq = 0;
  let inFlightSave: Promise<void> | null = null;

  const syncKey = $derived(resolvedPath && blockId ? `${resolvedPath}#^${blockId}` : "");

  function extractSyncedBlock(src: string, id: string): string | null {
    const tag = `^${id}`;
    const lines = src.split(/\r?\n/);
    const startMarker = `<!-- synced:${id} -->`;

    // Track CommonMark fence spans forward so nested ``` inside ~~~ or ```` matches accurately.
    const fenceSpans = new Map<number, number>();
    const fencedLine = new Set<number>();
    let openFence: { char: string; len: number; line: number } | null = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const t0 = line.replace(/^ +/, "");
      const indented = line.length - t0.length > 3;
      const t = t0.replace(/[\r\n]+$/, "");
      if (openFence) {
        fencedLine.add(i);
        let run = 0;
        while (t[run] === openFence.char) run++;
        if (!indented && run >= openFence.len && t.slice(run).trim() === "") {
          fenceSpans.set(i, openFence.line);
          openFence = null;
        }
        continue;
      }
      if (!indented) {
        for (const ch of ["`", "~"] as const) {
          let run = 0;
          while (t[run] === ch) run++;
          if (run >= 3 && (ch === "~" || !t.slice(run).includes("`"))) {
            fencedLine.add(i);
            openFence = { char: ch, len: run, line: i };
            break;
          }
        }
      }
    }

    let anchorIdx = -1;
    let markerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (fencedLine.has(i)) continue;
      const tr = lines[i].trimEnd();
      if (tr.trim() === startMarker && markerIdx < 0) {
        markerIdx = i;
        continue;
      }
      if (tr === tag || tr.endsWith(` ${tag}`)) {
        anchorIdx = i;
        break;
      }
    }
    if (anchorIdx < 0) return null;

    const isList = (s: string) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(s);
    const indentOf = (s: string) => s.length - s.trimStart().length;
    const trimmed = lines[anchorIdx].trimEnd();

    if (markerIdx >= 0 && markerIdx < anchorIdx) {
      const body = lines.slice(markerIdx + 1, trimmed === tag ? anchorIdx : anchorIdx + 1);
      if (trimmed !== tag && body.length > 0) {
        body[body.length - 1] = body[body.length - 1].trimEnd().slice(0, -tag.length).trimEnd();
      }
      return body.join("\n");
    }

    if (trimmed === tag) {
      if (anchorIdx === 0) return "";
      const prevFenceStart = fenceSpans.get(anchorIdx - 1);
      if (prevFenceStart !== undefined) {
        return lines.slice(prevFenceStart, anchorIdx).join("\n");
      }
      let s = anchorIdx - 1;
      if (lines[s].trim() === "") return "";
      while (s > 0 && !fencedLine.has(s - 1) && lines[s - 1].trim() !== "" && !lines[s - 1].trimStart().startsWith("#")) s--;
      return lines.slice(s, anchorIdx).join("\n");
    }

    if (isList(lines[anchorIdx])) {
      const ind = indentOf(lines[anchorIdx]);
      let e = anchorIdx + 1;
      while (e < lines.length && lines[e].trim() !== "" && indentOf(lines[e]) > ind) e++;
      const out = lines.slice(anchorIdx, e);
      out[0] = out[0].trimEnd().slice(0, -tag.length).trimEnd();
      return out.join("\n");
    }

    let s = anchorIdx;
    while (s > 0 && !fencedLine.has(s - 1) && lines[s - 1].trim() !== "" && !lines[s - 1].trimStart().startsWith("#") && !isList(lines[s - 1])) s--;
    const out = lines.slice(s, anchorIdx + 1);
    out[out.length - 1] = out[out.length - 1].trimEnd().slice(0, -tag.length).trimEnd();
    return out.join("\n");
  }

  async function resolveTarget(): Promise<{ path: string; id: string } | null> {
    const rawPath = String(options.path ?? "").trim();
    const rawBlock = String(options.block ?? "").trim().replace(/^\^/, "");
    if (rawPath && rawBlock) {
      const r = await resolveWikilink(rawPath, doc).catch(() => rawPath);
      return { path: r || rawPath, id: rawBlock };
    }
    const rawSource = String(options.source ?? "").trim().replace(/^\[\[/, "").replace(/\]\]$/, "");
    if (!rawSource) return null;
    const [notePart, hashPart] = rawSource.split("#");
    const bid = (hashPart ?? "").trim().replace(/^\^/, "") || rawBlock;
    if (!bid) return null;
    const p = notePart.trim() ? await resolveWikilink(notePart.trim(), doc).catch(() => "") : doc;
    return p ? { path: p, id: bid } : null;
  }

  async function load(): Promise<void> {
    loading = true;
    loadError = "";
    try {
      const target = await resolveTarget();
      if (!target) {
        loading = false;
        loadError = "Select a source note and block in Configure.";
        return;
      }
      resolvedPath = target.path;
      blockId = target.id;
      const key = `${target.path}#^${target.id}`;
      let anc = hostEl?.parentElement ?? null;
      while (anc) {
        if (anc.getAttribute("data-synced-key") === key) { cycleDetected = true; loading = false; return; }
        anc = anc.parentElement;
      }
      cycleDetected = false;
      const file = await api.file(target.path);
      mtime = file.mtime;
      const found = extractSyncedBlock(file.text, target.id);
      if (found === null) {
        loadError = `Synced block could not be found in ${shownName(target.path)}.`;
      } else if (!focused && !dirty && !inFlightSave) {
        text = found;
        lastSavedText = found;
      }
    } catch (e) {
      loadError = errText(e);
    } finally {
      loading = false;
    }
  }

  async function commitSave(keepalive = false): Promise<void> {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    if (!resolvedPath || !blockId || cycleDetected) return;
    if (!dirty && text === lastSavedText) return;
    if (keepalive) {
      const seqAtStart = dirtySeq;
      const body = text;
      void api.updateSyncedBlock({
        path: resolvedPath,
        block_id: blockId,
        text: body,
        base_mtime: mtime,
      }, true).then((res) => {
        if (dirtySeq === seqAtStart) {
          mtime = res.mtime;
          lastSavedText = res.text;
          dirty = false;
        }
      }).catch(() => {});
      return;
    }
    while (inFlightSave) await inFlightSave;
    const run = (async () => {
      while (dirty || text !== lastSavedText) {
        const seqAtStart = dirtySeq;
        const body = text;
        saving = true;
        saveError = "";
        try {
          const res = await api.updateSyncedBlock({
            path: resolvedPath,
            block_id: blockId,
            text: body,
            base_mtime: mtime,
          });
          mtime = res.mtime;
          lastSavedText = res.text;
          if (dirtySeq === seqAtStart) dirty = false;
        } catch (e) {
          saveError = errText(e);
          break;
        } finally {
          saving = false;
        }
      }
    })();
    inFlightSave = run;
    try {
      await run;
    } finally {
      if (inFlightSave === run) inFlightSave = null;
    }
  }

  function scheduleSave(): void {
    dirty = true;
    dirtySeq += 1;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void commitSave(); }, 500);
  }

  let offVault: (() => void) | undefined;
  onMount(() => {
    void load();
    offVault = onVaultChange(() => {
      if (resolvedPath && !focused && !dirty && !inFlightSave) void load();
    });
  });

  onDestroy(() => {
    clearTimeout(saveTimer);
    if (dirty || text !== lastSavedText) void commitSave(true);
    offVault?.();
  });
</script>

<div class="synced-card" bind:this={hostEl} data-synced-key={syncKey} data-testid="synced-block">
  <header class="synced-head">
    <span class="synced-badge"><Icon name="link" size={12} /> Synced</span>
    {#if resolvedPath}
      <button type="button" class="src-link" onclick={() => void openPath(resolvedPath)}>{shownName(resolvedPath)}</button>
    {/if}
    <span class="status">{saving ? "Saving…" : dirty || text !== lastSavedText ? "Unsaved" : resolvedPath ? "In sync" : ""}</span>
    {#if !cycleDetected && !loadError && !(loading && !text)}
      <button
        type="button"
        class="edit-btn"
        aria-label={focused ? "Done editing synced block" : "Edit synced block"}
        onmousedown={(e) => { if (focused) e.preventDefault(); }}
        onclick={() => {
          if (focused) {
            focused = false;
            clearTimeout(saveTimer);
            void commitSave();
          } else {
            focused = true;
            void svelteTick().then(() => hostEl?.querySelector<HTMLTextAreaElement>("textarea.synced-input")?.focus());
          }
        }}
      >
        {focused ? "Done" : "Edit"}
      </button>
    {/if}
  </header>

  {#if cycleDetected}
    <p class="msg">Synced block recursion prevented.</p>
  {:else if loadError}
    <p class="msg err">{loadError}</p>
  {:else if loading && !text}
    <p class="msg">Loading synced block…</p>
  {:else}
    {#if saveError}
      <p class="msg err">{saveError}</p>
    {/if}
    {#if focused}
      <textarea
        class="synced-input"
        aria-label="Synced block content"
        rows={Math.max(2, Math.min(14, text.split("\n").length))}
        bind:value={text}
        onfocus={() => (focused = true)}
        oninput={scheduleSave}
        onkeydown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            (e.currentTarget as HTMLTextAreaElement).blur();
          }
        }}
        onblur={() => { focused = false; clearTimeout(saveTimer); void commitSave(); }}
      ></textarea>
    {:else if !text.trim()}
      <button
        type="button"
        class="synced-empty"
        onclick={() => {
          focused = true;
          void svelteTick().then(() => hostEl?.querySelector<HTMLTextAreaElement>("textarea.synced-input")?.focus());
        }}
      >
        Empty synced block — click to edit
      </button>
    {:else}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div
        class="synced-preview"
        onclick={(e) => {
          if ((e.target as HTMLElement).closest("a, button, input, summary, details")) return;
          focused = true;
          void svelteTick().then(() => hostEl?.querySelector<HTMLTextAreaElement>("textarea.synced-input")?.focus());
        }}
      >
        <Markdown {text} path={resolvedPath} compact={true} class="synced-md" />
      </div>
    {/if}
  {/if}
</div>

<style>
  .synced-card { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-left: 3px solid var(--accent); border-top: 1px solid var(--border); border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-side); }
  .synced-head { display: flex; align-items: center; gap: 8px; font-size: calc(11.5px * var(--ui-scale, 1)); color: var(--text-muted); }
  .synced-badge { display: inline-flex; align-items: center; gap: 4px; color: var(--accent); font-weight: 600; }
  .src-link { display: inline-flex; align-items: center; gap: 2px; color: var(--heading); font-weight: 500; padding: 1px 6px; border-radius: var(--radius-sm); }
  .src-link:hover { background: var(--bg-hover); }
  .status { margin-left: auto; color: var(--text-faint); font-size: calc(11px * var(--ui-scale, 1)); }
  .synced-input { width: 100%; resize: vertical; border: 1px solid transparent; border-radius: var(--radius-sm); background: var(--bg); color: var(--text); font: inherit; font-size: calc(13.5px * var(--ui-scale, 1)); line-height: 1.55; padding: 6px 8px; }
  .synced-input:focus { outline: none; border-color: var(--accent); }
  .msg { margin: 0; font-size: calc(12px * var(--ui-scale, 1)); color: var(--text-muted); }
  .msg.err { color: var(--red); }
  .edit-btn {
    border: 0;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: calc(11px * var(--ui-scale, 1));
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .edit-btn:hover { background: var(--bg-hover); color: var(--text); }
  .edit-btn:focus-visible, .synced-empty:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .synced-preview {
    padding: 6px 8px;
    cursor: text;
    border-radius: var(--radius-sm);
  }
  .synced-preview:hover { background: var(--bg-hover); }
  .synced-empty {
    display: block;
    width: 100%;
    text-align: left;
    border: 0;
    background: transparent;
    color: var(--text-faint);
    font: inherit;
    font-size: calc(13px * var(--ui-scale, 1));
    padding: 8px;
    cursor: text;
    border-radius: var(--radius-sm);
  }
  .synced-empty:hover { background: var(--bg-hover); color: var(--text-muted); }
</style>
