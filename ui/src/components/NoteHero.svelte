<script lang="ts">
  // NoteHero: mounted above `.cm-content` inside `ed.view.scrollDOM` so cover banners and hero actions
  // scroll naturally with the note without shifting CodeMirror document offsets.
  import type { EditorView } from "@codemirror/view";
  import EmojiIconPicker from "./EmojiIconPicker.svelte";
  import Popover, { type VirtualAnchor } from "./Popover.svelte";
  import { cleanImageIconPath, isImageIcon } from "../lib/emoji-data";
  import { editFrontmatter } from "../lib/frontmatter-edit";
  import { setCachedNoteIcon } from "../lib/folder-colors.svelte";
  import { dirOf } from "../lib/paths";
  import { toggleProperties } from "../lib/properties-panel.svelte";
  import { blobUrlNow, warm } from "../lib/raw";
  import { isNotionShell } from "../lib/shell-mode.svelte";
  import { toast } from "../lib/state.svelte";
  import { errText } from "../lib/text";
  import { resolveLink, resolveOrBeside, vaultReady } from "../lib/vault";

  let {
    path,
    noteProps = null,
    view,
    emblemHost,
    pageLayout = false,
    isFullWidth = false,
    onWriteProp,
    onToggleWidth,
    onToggleProperties,
  }: {
    path: string;
    noteProps: Record<string, unknown> | null;
    view: () => EditorView | null;
    emblemHost?: () => HTMLElement | null;
    pageLayout?: boolean;
    isFullWidth?: boolean;
    onWriteProp?: (key: string, value: string | null) => void | Promise<void>;
    onToggleWidth?: () => void;
    onToggleProperties?: () => void;
  } = $props();

  const COVER_PRESETS = [
    { id: "several-circles", label: "Several Circles" },
    { id: "velvet-cosmos", label: "Velvet Cosmos" },
    { id: "bauhaus-paper", label: "Bauhaus Paper" },
    { id: "viridian-mist", label: "Viridian Mist" },
    { id: "ochre-wash", label: "Ochre Wash" },
  ] as const;

  const rawIcon = $derived(typeof noteProps?.icon === "string" ? noteProps.icon.trim() : "");
  const hasExplicitIcon = $derived(Boolean(rawIcon) && rawIcon.toLowerCase() !== "none");
  const iconIsImage = $derived(hasExplicitIcon && isImageIcon(rawIcon));
  const coverValue = $derived(typeof noteProps?.cover === "string" ? noteProps.cover.trim() : "");
  const isPresetCover = $derived(COVER_PRESETS.some((p) => p.id === coverValue));

  let resolvedCoverUrl = $state<string | null>(null);
  let resolvedIconUrl = $state<string | null>(null);
  let gutterWidth = $state(18);
  let iconAnchor = $state<HTMLElement | VirtualAnchor | null>(null);
  let coverAnchor = $state<HTMLElement | null>(null);
  let iconBtnEl = $state<HTMLButtonElement>();
  let coverBtnEl = $state<HTMLButtonElement>();
  let customCoverInput = $state("");

  // Sync per-note icon cache so Sidebar FileTree updates immediately when `icon:` changes
  $effect(() => {
    setCachedNoteIcon(path, hasExplicitIcon ? rawIcon : null);
  });

  // Resolve custom image page icon URL (vault attachment or remote URL) and hydrate inline `.page-emblem` buttons
  $effect(() => {
    if (!iconIsImage) {
      resolvedIconUrl = null;
      return;
    }
    const clean = cleanImageIconPath(rawIcon);
    if (/^(https?:|data:|blob:)/i.test(clean)) {
      resolvedIconUrl = clean;
      return;
    }
    const dir = dirOf(path);
    const target = resolveLink(clean, dir) ?? clean;
    const now = blobUrlNow(target);
    if (now) {
      resolvedIconUrl = now;
      return;
    }
    let cancelled = false;
    void vaultReady()
      .then(() => warm(resolveOrBeside(clean, dir)))
      .then((url) => { if (!cancelled) resolvedIconUrl = url; })
      .catch(() => { if (!cancelled) resolvedIconUrl = null; });
    return () => { cancelled = true; };
  });

  // Hydrate `.page-emblem` DOM button inside CodeMirror or Page host whenever `icon:` is an image path/URL
  $effect(() => {
    const v = view();
    const root = v ? v.dom : emblemHost?.();
    const imgUrl = iconIsImage ? resolvedIconUrl : null;
    if (!root) return;
    const syncEmblems = () => {
      root.querySelectorAll<HTMLElement>(".page-emblem").forEach((btn) => {
        if (imgUrl) {
          btn.classList.add("is-image-emblem");
          let img = btn.querySelector<HTMLImageElement>("img.page-emblem-img");
          if (!img) {
            img = document.createElement("img");
            img.className = "page-emblem-img";
            img.alt = "";
            btn.replaceChildren(img);
          }
          if (img.src !== imgUrl) img.src = imgUrl;
        } else if (iconIsImage) {
          btn.classList.add("is-image-emblem");
        } else if (btn.classList.contains("is-image-emblem")) {
          btn.classList.remove("is-image-emblem");
          btn.textContent = hasExplicitIcon ? rawIcon : (isNotionShell() ? "◎" : "");
        }
      });
    };
    syncEmblems();
    const mo = new MutationObserver(syncEmblems);
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
  });

  // Measure `.cm-gutters` width so `.hero-measure` aligns to the exact pixel column of `.cm-content`
  $effect(() => {
    const v = view();
    if (!v) { gutterWidth = 0; return; }
    let raf = 0;
    const measure = () => {
      const g = v.dom.querySelector<HTMLElement>(".cm-gutters");
      const next = g ? Math.round(g.getBoundingClientRect().width) : 0;
      if (next !== gutterWidth) gutterWidth = next;
    };
    const syncGutter = () => {
      raf = 0;
      if (!v.dom.isConnected) return;
      measure();
    };
    const scheduleSync = () => {
      if (raf) return;
      raf = requestAnimationFrame(syncGutter);
    };
    if (v.dom.isConnected) measure();
    const ro = new ResizeObserver(scheduleSync);
    const g = v.dom.querySelector<HTMLElement>(".cm-gutters");
    if (g) ro.observe(g);
    ro.observe(v.dom);
    return () => {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      ro.disconnect();
    };
  });

  // Resolve non-preset vault or remote cover URLs and remeasure CodeMirror when cover toggles
  $effect(() => {
    const cv = coverValue;
    requestAnimationFrame(() => view()?.requestMeasure());
    if (!cv || isPresetCover) { resolvedCoverUrl = null; return; }
    if (/^(https?:|data:|blob:)/i.test(cv)) { resolvedCoverUrl = cv; return; }
    const clean = cv.replace(/^\[\[|\]\]$/g, "").trim();
    const dir = dirOf(path);
    const target = resolveLink(clean, dir) ?? clean;
    const now = blobUrlNow(target);
    if (now) { resolvedCoverUrl = now; return; }
    let cancelled = false;
    void vaultReady()
      .then(() => warm(resolveOrBeside(clean, dir)))
      .then((url) => { if (!cancelled) resolvedCoverUrl = url; })
      .catch(() => { if (!cancelled) resolvedCoverUrl = null; });
    return () => { cancelled = true; };
  });

  // Listen to inline `.page-emblem` clicks from `note-extensions.ts` or `Page.svelte`
  $effect(() => {
    const v = view();
    const target = v ? v.dom : emblemHost?.();
    if (!target) return;
    const onEmblemPick = (ev: Event) => {
      const detail = (ev as CustomEvent<{ x?: number; y?: number; el?: HTMLElement }>).detail;
      coverAnchor = null;
      if (detail?.el && detail.el.isConnected) {
        iconAnchor = iconAnchor === detail.el ? null : detail.el;
      } else {
        const x = detail?.x ?? 120, y = detail?.y ?? 120;
        iconAnchor = { getBoundingClientRect: () => new DOMRect(x, Math.max(0, y - 6), 30, 6) };
      }
    };
    target.addEventListener("kandinsky-icon-picker", onEmblemPick);
    return () => target.removeEventListener("kandinsky-icon-picker", onEmblemPick);
  });

  async function writeFrontmatterProp(key: string, value: string | null): Promise<void> {
    if (onWriteProp) {
      try {
        await onWriteProp(key, value);
      } catch (err) {
        toast(`Could not update ${key}`, errText(err), "error");
      }
      return;
    }
    const v = view();
    if (!v) return;
    try {
      const edit = value === null ? ({ op: "remove", key } as const) : ({ op: "set", key, value } as const);
      await editFrontmatter(v, edit);
    } catch (err) {
      toast(`Could not update ${key}`, errText(err), "error");
    }
  }

  const chooseIcon = (glyph: string) => { iconAnchor = null; void writeFrontmatterProp("icon", glyph); };
  const resetDefaultIcon = () => { iconAnchor = null; void writeFrontmatterProp("icon", null); };
  const removeIcon = () => { iconAnchor = null; void writeFrontmatterProp("icon", isNotionShell() ? "none" : null); };

  function openCoverPicker(target?: HTMLElement): void {
    iconAnchor = null;
    const btn = target ?? coverBtnEl ?? null;
    customCoverInput = isPresetCover ? "" : coverValue;
    coverAnchor = coverAnchor === btn ? null : btn;
  }

  const chooseCover = (val: string | null) => { coverAnchor = null; void writeFrontmatterProp("cover", val); };

  function submitCustomCover(e: SubmitEvent): void {
    e.preventDefault();
    const trimmed = customCoverInput.trim();
    if (trimmed) chooseCover(trimmed);
  }

  const handleProperties = () => {
    if (onToggleProperties) {
      onToggleProperties();
      return;
    }
    const v = view();
    if (v) {
      window.dispatchEvent(new CustomEvent("kandinsky-inline-add-property", { detail: { view: v } }));
      return;
    }
    toggleProperties();
  };
  const handleWidth = () => (onToggleWidth ? onToggleWidth() : void writeFrontmatterProp("width", isFullWidth ? null : "full"));
</script>

<div class="note-hero" class:has-cover={Boolean(coverValue)} class:page-layout={pageLayout} class:full-width={isFullWidth} class:pop-open={Boolean(iconAnchor || coverAnchor)}>
  {#if coverValue}
    <div class="note-cover {isPresetCover ? `preset-${coverValue}` : 'preset-image'}" data-testid="note-cover">
      {#if !isPresetCover && resolvedCoverUrl}
        <img src={resolvedCoverUrl} alt="" class="cover-img" />
      {/if}
      <div class="cover-controls">
        <button type="button" class="cover-btn" onclick={(e) => openCoverPicker(e.currentTarget)}>Change cover</button>
        <button type="button" class="cover-btn" onclick={() => chooseCover(null)}>Remove</button>
      </div>
    </div>
  {/if}

  <div class="hero-row" style:padding-left="{gutterWidth}px">
    <div class="hero-measure">
      <div class="hero-actions" data-testid="hero-actions">
        <button type="button" class="hero-act" bind:this={iconBtnEl}
          onclick={() => { coverAnchor = null; iconAnchor = iconAnchor === iconBtnEl ? null : (iconBtnEl ?? null); }}>
          {hasExplicitIcon ? "Change icon" : "Add icon"}
        </button>
        <button type="button" class="hero-act" bind:this={coverBtnEl} onclick={() => openCoverPicker(coverBtnEl)}>
          {coverValue ? "Change cover" : "Add cover"}
        </button>
        <button type="button" class="hero-act" data-testid="hero-add-property" onclick={handleProperties}>
          {pageLayout ? "Properties" : "+ Add property"}
        </button>
        <button type="button" class="hero-act hero-width-btn" class:active={isFullWidth} onclick={handleWidth}
          title={isFullWidth ? (pageLayout ? "Switch to standard 1080px page width" : "Switch to standard 740px reading width") : (pageLayout ? "Expand page to full width" : "Expand note to full width")}>
          {isFullWidth ? "Standard width" : "Full width"}
        </button>
      </div>
    </div>
  </div>
</div>

{#if iconAnchor}
  <Popover anchor={iconAnchor} label="Choose page icon" width={368} onclose={() => (iconAnchor = null)}>
    <EmojiIconPicker
      {path}
      currentIcon={rawIcon}
      onSelect={chooseIcon}
      onResetDefault={resetDefaultIcon}
      onRemove={removeIcon}
    />
  </Popover>
{/if}

{#if coverAnchor}
  <Popover anchor={coverAnchor} label="Choose page cover" width={316} onclose={() => (coverAnchor = null)}>
    <div class="hero-pop" data-testid="cover-picker">
      <div class="pop-head">
        <span class="pop-title">Kandinsky &amp; Weimar Covers</span>
        {#if coverValue}
          <button type="button" class="mini-act" onclick={() => chooseCover(null)}>Remove</button>
        {/if}
      </div>
      <div class="cover-grid">
        {#each COVER_PRESETS as p (p.id)}
          <button type="button" class="cover-swatch" class:selected={coverValue === p.id} onclick={() => chooseCover(p.id)}>
            <span class="swatch-art preset-{p.id}"></span>
            <span class="swatch-lbl">{p.label}</span>
          </button>
        {/each}
      </div>
      <form class="cover-custom" onsubmit={submitCustomCover}>
        <input type="text" placeholder="Vault image path or https:// URL…" aria-label="Custom cover image path" bind:value={customCoverInput} />
        <button type="submit" class="mini-submit">Apply</button>
      </form>
    </div>
  </Popover>
{/if}

<style>
  .note-hero { width: 100%; user-select: none; }
  .note-cover { position: relative; width: 100%; height: 152px; overflow: hidden; border-bottom: 1px solid var(--border); background: var(--bg-alt); }
  .cover-img { width: 100%; height: 100%; object-fit: cover; display: block; }

  /* Pure CSS Kandinsky & Bauhaus cover presets — zero network calls */
  .preset-several-circles {
    background-color: #13151c; /* literal: Kandinsky Several Circles 1926 canvas ground */
    background-image:
      radial-gradient(circle 62px at 22% 54%, rgba(50, 89, 194, 0.58) 0%, rgba(50, 89, 194, 0.16) 68%, transparent 72%), /* literal: cover art pigment */
      radial-gradient(circle 34px at 31% 36%, rgba(223, 171, 46, 0.72) 0%, rgba(223, 171, 46, 0.14) 72%, transparent 76%), /* literal: cover art pigment */
      radial-gradient(circle 22px at 66% 42%, rgba(217, 78, 65, 0.74) 0%, transparent 74%), /* literal: cover art pigment */
      radial-gradient(circle 46px at 74% 62%, rgba(60, 163, 149, 0.48) 0%, rgba(60, 163, 149, 0.1) 70%, transparent 74%), /* literal: cover art pigment */
      radial-gradient(circle 14px at 49% 68%, rgba(245, 243, 238, 0.52) 0%, transparent 75%), /* literal: cover art pigment */
      linear-gradient(135deg, #101218 0%, #191d28 100%); /* literal: cover art ground */
  }
  .preset-velvet-cosmos {
    background:
      radial-gradient(ellipse 65% 90% at 18% 20%, rgba(125, 151, 244, 0.24), transparent 70%), /* literal: cover art pigment */
      radial-gradient(ellipse 55% 80% at 82% 80%, rgba(60, 163, 149, 0.18), transparent 70%), /* literal: cover art pigment */
      linear-gradient(125deg, #121521 0%, #1c2236 52%, #151722 100%); /* literal: cover art ground */
  }
  .preset-bauhaus-paper {
    background-color: #f3efe6; /* literal: Weimar watercolor paper preset */
    background-image:
      radial-gradient(circle 48px at 80% 48%, rgba(38, 76, 164, 0.14) 0%, transparent 72%), /* literal: cover art pigment */
      radial-gradient(circle 32px at 24% 60%, rgba(196, 139, 22, 0.18) 0%, transparent 72%), /* literal: cover art pigment */
      linear-gradient(to right, rgba(30, 32, 36, 0.055) 1px, transparent 1px), /* literal: cover art grid */
      linear-gradient(to bottom, rgba(30, 32, 36, 0.055) 1px, transparent 1px); /* literal: cover art grid */
    background-size: auto, auto, 24px 24px, 24px 24px;
  }
  .preset-viridian-mist {
    background:
      radial-gradient(circle 90px at 26% 50%, rgba(60, 163, 149, 0.3), transparent 75%), /* literal: cover art pigment */
      radial-gradient(circle 75px at 76% 38%, rgba(86, 182, 194, 0.22), transparent 75%), /* literal: cover art pigment */
      linear-gradient(120deg, color-mix(in srgb, var(--green) 18%, var(--bg-alt)) 0%, var(--bg-alt) 100%);
  }
  .preset-ochre-wash {
    background:
      radial-gradient(circle 88px at 25% 48%, rgba(223, 171, 46, 0.28), transparent 75%), /* literal: cover art pigment */
      radial-gradient(circle 68px at 74% 58%, rgba(226, 131, 39, 0.22), transparent 75%), /* literal: cover art pigment */
      linear-gradient(120deg, color-mix(in srgb, var(--yellow) 16%, var(--bg-alt)) 0%, var(--bg-alt) 100%);
  }

  .cover-controls { position: absolute; right: 16px; bottom: 10px; display: flex; gap: 6px; opacity: 0; transition: opacity 120ms ease; }
  .note-cover:hover .cover-controls, .cover-controls:focus-within { opacity: 1; }
  .cover-btn { padding: 3px 9px; border-radius: 5px; font-size: 11.5px; color: #f5f3ee; background: rgba(21, 22, 26, 0.72); border: 1px solid rgba(255, 255, 255, 0.16); backdrop-filter: blur(6px); cursor: pointer; } /* literal: translucent badge over arbitrary cover image */
  .cover-btn:hover { background: rgba(21, 22, 26, 0.9); } /* literal: translucent badge over arbitrary cover image */

  .hero-row { width: 100%; box-sizing: border-box; }
  /* Evaluated at `--prose-size` so `ch`-based `--prose-width` matches `.live-cm .cm-content` to the exact pixel */
  .hero-measure {
    font-size: var(--prose-size, 15.5px);
    max-width: calc(var(--prose-width, var(--line-width, 740px)) + 112px);
    margin: 0 auto; padding: 28px 56px 6px; width: 100%; box-sizing: border-box;
  }
  .has-cover .hero-measure { padding-top: 16px; }
  .page-layout .hero-measure { max-width: 1080px; padding: 24px 36px 4px; }
  .page-layout.has-cover .hero-measure { padding-top: 16px; }
  .page-layout.full-width .hero-measure { max-width: none; }
  @container (max-width: 760px) { .page-layout .hero-measure { padding: 18px 18px 4px; } }
  :global(html.phone) .hero-measure { padding: 16px 16px 4px; }
  .hero-actions {
    display: flex; align-items: center; flex-wrap: wrap; gap: 14px; font-size: calc(12px * var(--ui-scale, 1)); color: var(--text-faint);
    opacity: 0; transition: opacity 120ms ease;
  }
  .note-hero:hover .hero-actions,
  .note-hero:focus-within .hero-actions,
  .note-hero.pop-open .hero-actions,
  :global(.cm-scroller:has(> .cm-note-hero-slot:hover)) .hero-actions,
  :global(.cm-scroller:has(.inline-title-wrap:hover, .inline-title:hover, .cm-page-title-h1:hover)) .hero-actions,
  :global(.page-scroll:has(.page-head:hover)) .hero-actions,
  :global(:root[data-touch]) .hero-actions,
  :global(html.phone) .hero-actions { opacity: 1; }

  .hero-act { padding: 1px 0; border-radius: 4px; color: var(--text-faint); font: inherit; background: transparent; border: 0; cursor: pointer; transition: color 120ms ease, opacity 120ms ease; }
  .hero-act:hover, .hero-act:focus-visible { color: var(--text); outline: none; }
  .hero-width-btn { opacity: 0; }
  .note-hero:hover .hero-width-btn,
  .note-hero:focus-within .hero-width-btn,
  .note-hero.pop-open .hero-width-btn,
  :global(.cm-scroller:has(.inline-title-wrap:hover, .inline-title:hover, .cm-page-title-h1:hover)) .hero-width-btn,
  :global(:root[data-touch]) .hero-width-btn,
  .hero-width-btn:focus-visible,
  .hero-width-btn.active { opacity: 1; }
  :global(html.phone) .hero-width-btn { display: none; }

  .hero-pop { display: flex; flex-direction: column; gap: 8px; padding: 2px; }
  .pop-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  .pop-title { font-size: 11px; font-weight: 600; color: var(--text-muted); }
  .mini-act { padding: 2px 6px; border-radius: 4px; font-size: 11px; color: var(--text-muted); border: 1px solid var(--border); background: var(--bg); cursor: pointer; }
  .mini-act:hover { color: var(--text); border-color: var(--border-strong); }

  .cover-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .cover-swatch { display: flex; flex-direction: column; gap: 4px; padding: 4px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); text-align: left; cursor: pointer; }
  .cover-swatch:hover { border-color: var(--border-strong); }
  .cover-swatch.selected { border-color: var(--accent); background: var(--accent-soft); }
  .swatch-art { width: 100%; height: 36px; border-radius: 4px; display: block; border: 1px solid var(--border); }
  .swatch-lbl { font-size: 11px; color: var(--text-muted); padding: 0 2px; }

  .cover-custom { display: flex; gap: 5px; padding-top: 4px; border-top: 1px solid var(--border); }
  .cover-custom input { flex: 1; min-width: 0; padding: 4px 7px; border-radius: 5px; border: 1px solid var(--border-strong); background: var(--bg); color: var(--text); font-size: 11.5px; outline: none; }
  .cover-custom input:focus { border-color: var(--accent); }
  .mini-submit { padding: 4px 9px; border-radius: 5px; background: var(--accent); color: var(--accent-fg, #fff); font-size: 11.5px; font-weight: 500; cursor: pointer; }
</style>
