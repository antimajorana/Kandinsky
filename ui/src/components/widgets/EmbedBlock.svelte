<script lang="ts">
  // Rich Notion-style Media & Web Embed card: renders inline vault media, PDF links, or clean bookmark/iframe previews.
  import Icon from "../Icon.svelte";
  import { openPath } from "../../lib/dock";
  import { resolveWikilink } from "../../lib/links";
  import { basename } from "../../lib/paths";
  import { blobUrl } from "../../lib/raw";

  let { options, doc }: { options: Record<string, unknown>; doc: string } = $props();

  const AUDIO_RE = /\.(mp3|ogg|oga|opus|m4a|aac|wav|flac|weba)$/i;
  const VIDEO_RE = /\.(mp4|webm|mov|m4v|mkv|ogv)$/i;
  const PDF_RE = /\.pdf$/i;

  const rawTarget = $derived(String(options.url ?? options.path ?? "").trim());
  const customTitle = $derived(String(options.title ?? "").trim());
  const customCaption = $derived(String(options.caption ?? "").trim());
  const isWebUrl = $derived(/^https?:\/\//i.test(rawTarget));

  let resolvedVaultPath = $state("");
  let mediaSrc = $state("");
  let showIframe = $state(false);
  let loadErr = $state("");

  const hostName = $derived.by(() => {
    if (!isWebUrl) return "";
    try { return new URL(rawTarget).hostname.replace(/^www\./, ""); }
    catch { return ""; }
  });

  $effect(() => {
    const target = rawTarget;
    resolvedVaultPath = "";
    mediaSrc = "";
    loadErr = "";
    if (!target || /^https?:\/\//i.test(target)) return;
    let alive = true;
    void resolveWikilink(target, doc)
      .then(async (p) => {
        if (!alive) return;
        const path = p || target;
        resolvedVaultPath = path;
        if (AUDIO_RE.test(path) || VIDEO_RE.test(path) || PDF_RE.test(path)) {
          mediaSrc = await blobUrl(path);
        }
      })
      .catch(() => {
        if (alive) resolvedVaultPath = target;
      });
    return () => { alive = false; };
  });
</script>

<div class="embed-card" data-testid="embed-block">
  {#if !rawTarget}
    <p class="empty">Hover Configure to set a web URL or vault file to embed.</p>
  {:else if isWebUrl}
    <div class="web-row">
      <div class="web-meta">
        <span class="web-host"><Icon name="globe" size={12} /> {hostName || "Web link"}</span>
        <strong class="web-title">{customTitle || hostName || rawTarget}</strong>
        {#if customCaption}<span class="web-cap">{customCaption}</span>{/if}
        <span class="web-url">{rawTarget}</span>
      </div>
      <div class="web-actions">
        <button type="button" class="pill" onclick={() => (showIframe = !showIframe)}>
          {showIframe ? "Hide preview" : "Preview"}
        </button>
        <a class="pill primary" href={rawTarget} target="_blank" rel="noopener noreferrer">
          Open <Icon name="external-link" size={11} />
        </a>
      </div>
    </div>
    {#if showIframe}
      <iframe
        class="web-frame"
        title={customTitle || hostName || "Embedded web content"}
        src={rawTarget}
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        referrerpolicy="no-referrer"
      ></iframe>
    {/if}
  {:else if resolvedVaultPath && AUDIO_RE.test(resolvedVaultPath)}
    <div class="media-bar">
      <span class="media-name"><Icon name="headphones" size={14} /> {customTitle || basename(resolvedVaultPath)}</span>
      {#if mediaSrc}<audio controls src={mediaSrc} class="audio-el"></audio>{/if}
    </div>
  {:else if resolvedVaultPath && VIDEO_RE.test(resolvedVaultPath)}
    <!-- svelte-ignore a11y_media_has_caption -->
    {#if mediaSrc}<video controls preload="metadata" src={mediaSrc} class="video-el"></video>{/if}
  {:else if resolvedVaultPath && PDF_RE.test(resolvedVaultPath)}
    <div class="web-row">
      <div class="web-meta">
        <span class="web-host"><Icon name="pdf" size={12} /> PDF Document</span>
        <strong class="web-title">{customTitle || basename(resolvedVaultPath)}</strong>
        {#if customCaption}<span class="web-cap">{customCaption}</span>{/if}
      </div>
      <div class="web-actions">
        <button type="button" class="pill" onclick={() => (showIframe = !showIframe)}>{showIframe ? "Collapse" : "Preview PDF"}</button>
        <button type="button" class="pill primary" onclick={() => void openPath(resolvedVaultPath)}>Open tab</button>
      </div>
    </div>
    {#if showIframe && mediaSrc}
      <iframe class="pdf-frame" title={basename(resolvedVaultPath)} src={mediaSrc}></iframe>
    {/if}
  {:else}
    <button type="button" class="file-row" onclick={() => void openPath(resolvedVaultPath || rawTarget)}>
      <Icon name="file-text" size={15} />
      <span>{customTitle || basename(resolvedVaultPath || rawTarget)}</span>
      <Icon name="arrow-right" size={13} />
    </button>
  {/if}
  {#if loadErr}<p class="err">{loadErr}</p>{/if}
</div>

<style>
  .embed-card { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-side); }
  .empty { margin: 0; font-size: calc(12.5px * var(--ui-scale, 1)); color: var(--text-muted); }
  .web-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .web-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
  .web-host { display: inline-flex; align-items: center; gap: 4px; font-size: calc(11px * var(--ui-scale, 1)); color: var(--text-faint); text-transform: lowercase; }
  .web-title { font-size: calc(13.5px * var(--ui-scale, 1)); color: var(--heading); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .web-cap, .web-url { font-size: calc(11.5px * var(--ui-scale, 1)); color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .web-actions { display: inline-flex; align-items: center; gap: 6px; }
  .pill { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border-strong); background: var(--bg); color: var(--text); font-size: calc(12px * var(--ui-scale, 1)); text-decoration: none; cursor: pointer; }
  .pill:hover { background: var(--bg-hover); }
  .pill.primary { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); font-weight: 500; }
  .web-frame, .pdf-frame { width: 100%; height: 340px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); }
  .media-bar { display: flex; flex-direction: column; gap: 6px; }
  .media-name { display: inline-flex; align-items: center; gap: 6px; font-size: calc(12.5px * var(--ui-scale, 1)); color: var(--heading); font-weight: 500; }
  .audio-el, .video-el { width: 100%; max-height: 360px; border-radius: var(--radius-sm); }
  .file-row { display: inline-flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: var(--radius-sm); color: var(--heading); font-size: calc(13px * var(--ui-scale, 1)); text-align: left; }
  .file-row:hover { background: var(--bg-hover); }
  .err { margin: 0; font-size: calc(12px * var(--ui-scale, 1)); color: var(--red); }
</style>
