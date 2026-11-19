<script lang="ts">
  // Bauhaus / Notion choice dialog when external files or images are dropped onto a note:
  // 1) Copy into vault attachments folder (Default / Enter)  2) Link in place via `file:///` (L)  3) Copy beside note (B).
  import { tick } from "svelte";
  import Dialog from "./Dialog.svelte";
  import Icon from "./Icon.svelte";
  import { fileIcon } from "../lib/panes";
  import {
    attachmentName,
    dropFilePrompt,
    formatFileSize,
    previewExternalMarkdown,
    vaultAttachDir,
    type DropFilePromptState,
  } from "../lib/attach";

  let { prompt }: { prompt?: DropFilePromptState | null } = $props();

  const attachDir = $derived(vaultAttachDir());

  const req = $derived(prompt !== undefined ? prompt : dropFilePrompt.current);
  const files = $derived(req?.files ?? []);
  const firstName = $derived(files[0] ? (files[0].name || attachmentName(files[0])) : "attachment");
  const totalBytes = $derived(files.reduce((sum, f) => sum + (f.size || 0), 0));

  let linkMode = $state(false);
  let uriDraft = $state("");
  let vaultBtn = $state<HTMLButtonElement>();
  let uriInput = $state<HTMLInputElement>();

  $effect(() => {
    const active = req;
    if (!active) return;
    linkMode = false;
    uriDraft = active.defaultUri;
    void tick().then(() => { vaultBtn?.focus(); });
  });

  function openLinkEditor(): void {
    linkMode = true;
    void tick().then(() => {
      uriInput?.focus();
      uriInput?.select();
    });
  }

  function confirmLink(e?: Event): void {
    e?.preventDefault();
    if (!req) return;
    req.choose({ action: "link", uri: uriDraft.trim() || req.defaultUri });
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (!req || e.ctrlKey || e.metaKey || e.altKey) return;
    const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    if (inField) return;
    if (e.key === "l" || e.key === "L") {
      e.preventDefault();
      e.stopPropagation();
      openLinkEditor();
    } else if (e.key === "b" || e.key === "B") {
      e.preventDefault();
      e.stopPropagation();
      req.choose({ action: "beside" });
    } else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      e.stopPropagation();
      req.choose({ action: "vault" });
    }
  }
</script>

{#if req}
  <Dialog label={files.length === 1 ? "Drop file into note" : `Drop ${files.length} files into note`} onclose={() => req.cancel()} testid="drop-file-choice-modal">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="modal-card" role="document" onkeydown={handleKeydown}>
      <header class="head">
        <div class="title-wrap">
          <span class="dot" aria-hidden="true"></span>
          <h3>{files.length === 1 ? "Add dropped file to note" : `Add ${files.length} dropped files to note`}</h3>
        </div>
        <button type="button" class="icon-btn" onclick={() => req.cancel()} aria-label="Cancel" title="Cancel (Esc)">
          <Icon name="close" size={14} />
        </button>
      </header>

      <div class="file-strip" aria-label="Dropped files">
        {#each files.slice(0, 3) as f}
          {@const name = f.name || attachmentName(f)}
          <span class="file-chip">
            <Icon name={fileIcon(name)} size={13} />
            <span class="fname" dir="auto">{name}</span>
            <span class="fsize">{formatFileSize(f.size)}</span>
          </span>
        {/each}
        {#if files.length > 3}
          <span class="more-chip">+{files.length - 3} more · {formatFileSize(totalBytes)}</span>
        {/if}
      </div>

      <div class="choices">
        <button
          type="button"
          class="choice default-choice"
          bind:this={vaultBtn}
          data-testid="drop-choice-vault"
          onclick={() => req.choose({ action: "vault" })}
        >
          <span class="c-icon accent"><Icon name="folder-open" size={16} /></span>
          <span class="c-body">
            <span class="c-title">Copy into vault (<code>{attachDir}/</code>) <span class="badge">Default</span></span>
            <span class="c-desc">Uploads cleanly without overwriting existing files and embeds <code>![[{attachDir}/…]]</code></span>
          </span>
          <kbd class="keys-only">Enter</kbd>
        </button>

        <div class="choice-group" class:expanded={linkMode}>
          <button
            type="button"
            class="choice"
            data-testid="drop-choice-link"
            aria-expanded={linkMode}
            onclick={() => (linkMode ? confirmLink() : openLinkEditor())}
          >
            <span class="c-icon"><Icon name="external-link" size={16} /></span>
            <span class="c-body">
              <span class="c-title">Link in place (external link)</span>
              <span class="c-desc">Reference local path or <code>file:///</code> URI without copying bytes into the vault</span>
            </span>
            <kbd class="keys-only">L</kbd>
          </button>

          {#if linkMode}
            <form class="link-editor" onsubmit={confirmLink}>
              <label class="uri-lbl" for="drop-uri-input">Local file path or <code>file:///</code> URI</label>
              <div class="uri-row">
                <input
                  id="drop-uri-input"
                  type="text"
                  class="uri-input"
                  bind:this={uriInput}
                  bind:value={uriDraft}
                  data-testid="drop-link-uri-input"
                  spellcheck="false"
                  placeholder="file:///path/to/{firstName}"
                />
                <button type="submit" class="btn primary" data-testid="drop-link-confirm">Insert link</button>
              </div>
              <div class="uri-preview">{previewExternalMarkdown(firstName, uriDraft)}{files.length > 1 ? ` (+${files.length - 1} more)` : ""}</div>
            </form>
          {/if}
        </div>

        <button
          type="button"
          class="choice"
          data-testid="drop-choice-beside"
          onclick={() => req.choose({ action: "beside" })}
        >
          <span class="c-icon"><Icon name="copy" size={16} /></span>
          <span class="c-body">
            <span class="c-title">Copy beside note (default attachment folder)</span>
            <span class="c-desc">Saves into this note's configured attachment folder alongside the note</span>
          </span>
          <kbd class="keys-only">B</kbd>
        </button>
      </div>

      <footer class="foot">
        <span class="legend keys-only"><kbd>Enter</kbd> vault · <kbd>L</kbd> external link · <kbd>B</kbd> beside · <kbd>Esc</kbd> cancel</span>
        <button type="button" class="btn btn-ghost" data-testid="drop-choice-cancel" onclick={() => req.cancel()}>Cancel</button>
      </footer>
    </div>
  </Dialog>
{/if}

<style>
  .modal-card {
    width: min(520px, 94vw); background: var(--bg-elev); border: 1px solid var(--border-strong);
    border-radius: var(--radius-xl, 12px); padding: 16px; box-shadow: var(--shadow-pop);
    display: flex; flex-direction: column; gap: 12px; animation: pop-in 120ms var(--ease, ease-out);
  }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .title-wrap { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); flex: none; }
  h3 { margin: 0; font-size: calc(14px * var(--ui-scale, 1)); font-weight: 600; color: var(--heading); }

  .file-strip { display: flex; flex-wrap: wrap; gap: 6px; padding: 7px 10px; border-radius: var(--radius, 6px); background: var(--bg-alt); border: 1px solid var(--border); }
  .file-chip { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; font-size: calc(12px * var(--ui-scale, 1)); color: var(--text); }
  .fname { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 300px; }
  .fsize, .more-chip { font-family: var(--font-mono); font-size: calc(11px * var(--ui-scale, 1)); color: var(--text-faint); flex: none; }

  .choices { display: flex; flex-direction: column; gap: 7px; }
  .choice-group { display: flex; flex-direction: column; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); transition: border-color 120ms; }
  .choice-group.expanded { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 4%, var(--bg)); }
  .choice-group .choice { border: 0; background: transparent; }

  .choice {
    width: 100%; display: flex; align-items: center; gap: 11px; padding: 10px 12px; text-align: left;
    border-radius: 8px; border: 1px solid var(--border); background: var(--bg); cursor: pointer;
    transition: background 120ms, border-color 120ms;
  }
  .choice:hover, .choice:focus-visible { background: var(--bg-hover); border-color: var(--border-strong); outline: none; }
  .default-choice { border-color: color-mix(in srgb, var(--accent) 42%, var(--border)); background: color-mix(in srgb, var(--accent) 5%, var(--bg)); }
  .default-choice:hover, .default-choice:focus-visible { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, var(--bg)); }

  .c-icon { width: 30px; height: 30px; border-radius: 7px; display: grid; place-items: center; flex: none; background: var(--bg-alt); color: var(--text-muted); border: 1px solid var(--border); }
  .c-icon.accent { background: var(--accent-soft); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 28%, transparent); }
  .c-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .c-title { font-size: calc(13px * var(--ui-scale, 1)); font-weight: 600; color: var(--text); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .c-title code, .c-desc code, .uri-lbl code { font-size: 0.92em; color: var(--inline-code, var(--accent)); }
  .badge { font-size: calc(10px * var(--ui-scale, 1)); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; padding: 1px 5px; border-radius: 4px; background: var(--accent-soft); color: var(--accent); }
  .c-desc { font-size: calc(11.5px * var(--ui-scale, 1)); color: var(--text-muted); line-height: 1.35; }

  .link-editor { padding: 4px 12px 11px 53px; display: flex; flex-direction: column; gap: 6px; border-top: 1px dashed var(--border); }
  .uri-lbl { font-size: calc(11px * var(--ui-scale, 1)); color: var(--text-muted); font-weight: 500; }
  .uri-row { display: flex; gap: 6px; align-items: center; }
  .uri-input {
    flex: 1; min-width: 0; height: 28px; padding: 0 8px; border-radius: var(--radius-sm);
    border: 1px solid var(--border-strong); background: var(--bg-elev); color: var(--text);
    font-family: var(--font-mono); font-size: calc(12px * var(--ui-scale, 1));
  }
  .uri-input:focus { border-color: var(--accent); outline: none; }
  .uri-preview { font-family: var(--font-mono); font-size: calc(11px * var(--ui-scale, 1)); color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 2px; }
  .legend { font-size: calc(11px * var(--ui-scale, 1)); color: var(--text-faint); }
  @media (max-width: 520px) { .link-editor { padding-left: 12px; } }
</style>
