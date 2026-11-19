<script lang="ts">
  // Floating Notion × Bauhaus card anchored to a button or a link/equation rect in <body> so no pane clips it.
  // Supports two modes:
  // 1. Interactive toolbar/status-bar dialog (`children` snippet): traps Tab focus and restores focus on close.
  // 2. Non-intrusive hover/Ctrl-hover preview (`preview` card from `lib/preview.ts`): renders subtle target path,
  //    `#heading` / `#^block` / `Equation` badge, full `<Markdown>` + KaTeX or display equation without stealing focus.
  import { tick, type Snippet } from "svelte";
  import { closable } from "../lib/back";
  import { FOCUSABLE, trapTab } from "../lib/focus-return";
  import { renderMathInto } from "../lib/math";
  import Markdown from "./Markdown.svelte";

  export interface VirtualAnchor {
    getBoundingClientRect(): DOMRect;
    inBar?: boolean;
    isConnected?: boolean;
    contains?: (n: Node | null) => boolean;
    focus?: (opts?: FocusOptions) => void;
  }

  export interface HoverPreviewCard {
    title: string;
    subpath?: string;
    badge?: string;
    badgeTone?: "accent" | "green" | "yellow" | "red" | "muted";
    markdown?: string;
    notePath?: string;
    equationTex?: string;
    htmlNode?: HTMLElement;
  }

  let {
    anchor,
    label,
    onclose,
    children,
    width,
    preview,
    hoverMode = false,
    onpointerenter,
    onpointerleave,
  }: {
    anchor: HTMLElement | VirtualAnchor;
    label: string;
    onclose: () => void;
    children?: Snippet;
    /** The panel's max width in px (defaults to 460 for hover previews, 380 for toolbar popovers). */
    width?: number;
    preview?: HoverPreviewCard;
    hoverMode?: boolean;
    onpointerenter?: () => void;
    onpointerleave?: () => void;
  } = $props();

  const isHover = $derived(hoverMode || !!preview);
  const targetWidth = $derived(width ?? (isHover ? 460 : 380));
  const MAX_HOVER_H = 340;
  const EDGE = 8;

  let el = $state<HTMLDivElement>();
  let at = $state<{ left: number; top?: number; bottom?: number; maxH: number } | null>(null);

  function place() {
    const r = anchor.getBoundingClientRect();
    const w = Math.min(targetWidth, innerWidth - 2 * EDGE);
    if ("inBar" in anchor && anchor.inBar) {
      const left = Math.min(r.right + 8, innerWidth - w - EDGE);
      const maxH = isHover ? Math.min(MAX_HOVER_H, innerHeight - 2 * EDGE) : innerHeight - 2 * EDGE;
      const top = r.top + maxH > innerHeight - EDGE ? Math.max(EDGE, innerHeight - maxH - EDGE) : Math.max(EDGE, r.top);
      at = { left: Math.max(EDGE, left), top, maxH };
      return;
    }
    const left = Math.max(EDGE, Math.min(r.left, innerWidth - w - EDGE));
    const top = r.bottom + 6;
    const capH = isHover ? MAX_HOVER_H : innerHeight;
    if (innerHeight - top - EDGE < (isHover ? 190 : 240) && r.top > innerHeight / 2) {
      at = { left, bottom: innerHeight - r.top + 6, maxH: Math.min(capH, Math.max(140, r.top - 6 - EDGE)) };
    } else {
      at = { left, top, maxH: Math.min(capH, Math.max(150, innerHeight - top - EDGE)) };
    }
  }

  function mountMath(node: HTMLElement, tex: string) {
    renderMathInto(node, tex, true);
    return {
      update(next: string) {
        renderMathInto(node, next, true);
      },
    };
  }

  function mountHtmlNode(node: HTMLElement, child: HTMLElement) {
    node.replaceChildren(child);
    return {
      update(next: HTMLElement) {
        node.replaceChildren(next);
      },
    };
  }

  $effect(() => {
    void preview;
    if (el) place();
  });

  $effect(() => {
    if (!el) return;
    document.body.appendChild(el);
    place();
    const node = el;
    const anchorEl = anchor;
    const outside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (node.contains(t) || anchorEl.contains?.(t) || (t as Element).closest?.(".ctx-menu, [role=listbox], [role=menu], .backdrop")) return;
      onclose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      onclose();
      if (!isHover) anchorEl.focus?.();
    };
    const onResize = () => place();
    document.addEventListener("mousedown", outside, true);
    window.addEventListener("keydown", key);
    window.addEventListener("resize", onResize);
    const off = isHover ? () => {} : closable(onclose);
    if (!isHover) {
      void tick().then(() => {
        if (!node.contains(document.activeElement)) {
          (node.querySelector<HTMLElement>(FOCUSABLE) ?? node).focus({ preventScroll: true });
        }
      });
    }
    return () => {
      document.removeEventListener("mousedown", outside, true);
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", onResize);
      off();
      if (!isHover && node.contains(document.activeElement) && anchorEl.isConnected) {
        anchorEl.focus?.({ preventScroll: true });
      }
      node.remove();
    };
  });
</script>

<div
  class="popover"
  class:hover-preview={isHover}
  data-testid={isHover ? "hover-preview" : undefined}
  role={isHover ? "tooltip" : "dialog"}
  aria-label={label}
  tabindex="-1"
  bind:this={el}
  {onpointerenter}
  {onpointerleave}
  onkeydown={(e) => { if (!isHover) trapTab(e, e.currentTarget); }}
  style:left={at ? `${at.left}px` : "-9999px"}
  style:top={at ? (at.top === undefined ? undefined : `${at.top}px`) : "0"}
  style:bottom={at?.bottom === undefined ? undefined : `${at.bottom}px`}
  style:width={isHover ? undefined : `min(${targetWidth}px, calc(100vw - ${2 * EDGE}px))`}
  style:max-width={isHover ? `min(${targetWidth}px, calc(100vw - ${2 * EDGE}px))` : undefined}
  style:min-width={isHover ? "min(280px, calc(100vw - 16px))" : undefined}
  style:max-height={at ? `${at.maxH}px` : undefined}
>
  {#if preview}
    <div class="preview-head">
      <div class="preview-meta">
        {#if preview.subpath}
          <span class="preview-path">{preview.subpath}</span>
        {/if}
        <span class="preview-title">{preview.title}</span>
      </div>
      {#if preview.badge}
        <span class="preview-badge tone-{preview.badgeTone ?? 'accent'}">{preview.badge}</span>
      {/if}
    </div>
    <div class="preview-body" class:is-eq={!!preview.equationTex} class:is-md={preview.markdown !== undefined && !preview.equationTex}>
      {#if preview.equationTex}
        <div class="preview-equation math-display" use:mountMath={preview.equationTex}></div>
      {:else if preview.markdown !== undefined}
        <Markdown text={preview.markdown} path={preview.notePath ?? ""} compact />
      {:else if preview.htmlNode}
        <div class="preview-custom" use:mountHtmlNode={preview.htmlNode}></div>
      {/if}
    </div>
  {:else if children}
    {@render children()}
  {/if}
</div>

<style>
  .popover {
    position: fixed;
    z-index: 90;
    display: flex;
    flex-direction: column;
    overflow: auto;
    overscroll-behavior: contain;
    padding: 8px;
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg, 10px);
    box-shadow: var(--shadow-pop, 0 12px 32px rgba(0, 0, 0, 0.28));
    font-family: var(--font-ui);
    font-size: calc(12.5px * var(--ui-scale, 1));
    color: var(--text);
    outline: none;
  }

  .popover.hover-preview {
    padding: 0;
    border-radius: var(--radius, 8px);
    max-width: 460px;
    max-height: 340px;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
  }

  .preview-head {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 12px;
    background: color-mix(in srgb, var(--bg-elev) 94%, transparent);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--border);
    min-width: 0;
  }

  .preview-meta {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    flex: 1;
    overflow: hidden;
  }

  .preview-path {
    color: var(--text-faint);
    font-family: var(--font-mono, monospace);
    font-size: calc(11px * var(--ui-scale, 1));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex-shrink: 1;
  }

  .preview-title {
    color: var(--heading, var(--text));
    font-size: calc(12px * var(--ui-scale, 1));
    font-weight: 600;
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .preview-badge {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 180px;
    padding: 1px 7px;
    border-radius: 999px;
    border: 1px solid var(--border);
    font-family: var(--font-mono, monospace);
    font-size: calc(10.5px * var(--ui-scale, 1));
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-muted);
    background: color-mix(in srgb, var(--text) 5%, transparent);
  }

  .preview-badge.tone-accent {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 28%, var(--border));
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  .preview-badge.tone-green {
    color: var(--green);
    border-color: color-mix(in srgb, var(--green) 28%, var(--border));
    background: color-mix(in srgb, var(--green) 10%, transparent);
  }

  .preview-badge.tone-yellow {
    color: var(--yellow);
    border-color: color-mix(in srgb, var(--yellow) 30%, var(--border));
    background: color-mix(in srgb, var(--yellow) 10%, transparent);
  }

  .preview-badge.tone-red {
    color: var(--red);
    border-color: color-mix(in srgb, var(--red) 28%, var(--border));
    background: color-mix(in srgb, var(--red) 10%, transparent);
  }

  .preview-body {
    padding: 10px 14px 13px;
    font-size: calc(13.5px * var(--ui-scale, 1));
    line-height: 1.6;
    min-width: 0;
  }

  .preview-body.is-eq {
    padding: 14px 16px;
    overflow-x: auto;
  }

  .preview-equation {
    margin: 0;
    color: var(--text);
  }

  .preview-body :global(.markdown > :first-child) {
    margin-top: 0;
  }

  .preview-body :global(.markdown > :last-child) {
    margin-bottom: 0;
  }

  .preview-body :global(.markdown h1) {
    font-size: 1.28em;
  }

  .preview-body :global(.markdown h2) {
    font-size: 1.15em;
  }

  .preview-custom :global(img),
  .preview-custom :global(canvas) {
    display: block;
    max-width: 100%;
    border-radius: 5px;
  }

  .preview-custom :global(pre) {
    margin: 0;
    font: calc(11.5px * var(--ui-scale, 1)) / 1.45 var(--font-mono, monospace);
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
