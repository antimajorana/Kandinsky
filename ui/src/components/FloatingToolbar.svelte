<script lang="ts">
  import { tick } from "svelte";
  import type { EditorView } from "@codemirror/view";
  import {
    getSelectionFormat,
    setBlockKind,
    toggleBold,
    toggleHighlight,
    toggleInlineCode,
    toggleItalic,
    toggleStrike,
    unwrapSelectionLink,
    wrapSelectionLink,
    type BlockKind,
    type SelectionFormatState,
  } from "../lib/editor/md-format";
  import Icon from "./Icon.svelte";

  export interface FloatingToolbarSnapshot {
    visible: boolean;
    top: number;
    left: number;
    format: SelectionFormatState;
    initialLink: string;
  }

  let {
    view,
    onDismiss,
    onLayoutChange,
  }: {
    view: EditorView;
    onDismiss: () => void;
    onLayoutChange?: () => void;
  } = $props();

  const DEFAULT_FORMAT: SelectionFormatState = {
    bold: false,
    italic: false,
    strike: false,
    code: false,
    highlight: false,
    link: false,
    block: "text",
    blockLabel: "Text",
  };

  const BLOCK_OPTIONS: { kind: BlockKind; label: string; hint: string }[] = [
    { kind: "text", label: "Text", hint: "Plain" },
    { kind: "h1", label: "Heading 1", hint: "#" },
    { kind: "h2", label: "Heading 2", hint: "##" },
    { kind: "h3", label: "Heading 3", hint: "###" },
    { kind: "bullet", label: "Bulleted list", hint: "-" },
    { kind: "number", label: "Numbered list", hint: "1." },
    { kind: "todo", label: "To-do", hint: "[ ]" },
    { kind: "quote", label: "Quote", hint: ">" },
  ];

  type StyleKey = "bold" | "italic" | "strike" | "code" | "highlight";
  const STYLE_BUTTONS: { key: StyleKey; label: string; icon: "bold" | "italic" | "strike" | "code" | "highlighter"; run: (v: EditorView) => boolean }[] = [
    { key: "bold", label: "Bold", icon: "bold", run: toggleBold },
    { key: "italic", label: "Italic", icon: "italic", run: toggleItalic },
    { key: "strike", label: "Strikethrough", icon: "strike", run: toggleStrike },
    { key: "code", label: "Inline code", icon: "code", run: toggleInlineCode },
    { key: "highlight", label: "Highlight", icon: "highlighter", run: toggleHighlight },
  ];

  const nativeFocusgroup = typeof HTMLElement !== "undefined" && "focusGroup" in HTMLElement.prototype;

  let visible = $state(false);
  let top = $state(0);
  let left = $state(0);
  let format = $state<SelectionFormatState>(DEFAULT_FORMAT);
  let turnIntoOpen = $state(false);
  let linkOpen = $state(false);
  let linkValue = $state("");
  let activeIndex = $state(0);
  let menuTop = $state(0);
  let menuLeft = $state(0);

  let toolbarEl = $state<HTMLDivElement | null>(null);
  let turnIntoBtn = $state<HTMLButtonElement | null>(null);
  let menuEl = $state<HTMLDivElement | null>(null);
  let linkInputEl = $state<HTMLInputElement | null>(null);

  export function setState(next: FloatingToolbarSnapshot): void {
    const wasVisible = visible;
    visible = next.visible;
    top = next.top;
    left = next.left;
    format = next.format;
    if (!next.visible) {
      turnIntoOpen = false;
      linkOpen = false;
      linkValue = "";
    } else if (!wasVisible) {
      activeIndex = 0;
      linkValue = next.initialLink;
    }
  }

  export function getElement(): HTMLElement | null {
    return toolbarEl;
  }

  export function hasOpenPopover(): boolean {
    return turnIntoOpen || linkOpen;
  }

  export function closeActivePopover(): boolean {
    if (linkOpen) {
      linkOpen = false;
      linkValue = "";
      view.focus();
      onLayoutChange?.();
      return true;
    }
    if (turnIntoOpen) {
      turnIntoOpen = false;
      turnIntoBtn?.focus();
      return true;
    }
    return false;
  }

  function toolbarButtons(): HTMLButtonElement[] {
    if (!toolbarEl) return [];
    return [...toolbarEl.querySelectorAll<HTMLButtonElement>("button.ft-btn")];
  }

  function syncRovingTabindex(): void {
    if (nativeFocusgroup) return;
    const btns = toolbarButtons();
    if (!btns.length) return;
    const clamped = Math.max(0, Math.min(activeIndex, btns.length - 1));
    activeIndex = clamped;
    btns.forEach((b, i) => {
      b.tabIndex = i === clamped ? 0 : -1;
    });
  }

  $effect(() => {
    if (visible) {
      void tick().then(() => syncRovingTabindex());
    }
  });

  function keepEditorSelection(e: Event): void {
    e.preventDefault();
  }

  function refreshFormatState(): void {
    format = getSelectionFormat(view.state);
    onLayoutChange?.();
  }

  function runToggle(fn: (v: EditorView) => boolean): void {
    turnIntoOpen = false;
    fn(view);
    view.focus();
    refreshFormatState();
  }

  async function toggleTurnInto(): Promise<void> {
    linkOpen = false;
    turnIntoOpen = !turnIntoOpen;
    if (!turnIntoOpen) return;
    await tick();
    positionDropdown();
    const selected = menuEl?.querySelector<HTMLButtonElement>("[aria-checked='true']") ?? menuEl?.querySelector<HTMLButtonElement>("button");
    selected?.focus();
  }

  function positionDropdown(): void {
    if (!turnIntoBtn || !menuEl) return;
    const tr = turnIntoBtn.getBoundingClientRect();
    const mr = menuEl.getBoundingClientRect();
    const margin = 8;
    const w = mr.width || 180;
    const h = mr.height || 260;
    const nextTop = tr.bottom + 4 + h <= window.innerHeight - margin
      ? tr.bottom + 4
      : Math.max(margin, tr.top - h - 4);
    const nextLeft = Math.max(margin, Math.min(tr.left, window.innerWidth - w - margin));
    menuTop = Math.round(nextTop);
    menuLeft = Math.round(nextLeft);
  }

  function applyBlock(kind: BlockKind): void {
    turnIntoOpen = false;
    setBlockKind(view, kind);
    view.focus();
    refreshFormatState();
  }

  async function toggleLinkBar(): Promise<void> {
    turnIntoOpen = false;
    linkOpen = !linkOpen;
    if (!linkOpen) {
      view.focus();
      onLayoutChange?.();
      return;
    }
    await tick();
    onLayoutChange?.();
    linkInputEl?.focus();
    linkInputEl?.select();
  }

  function submitLink(): void {
    const raw = linkValue.trim();
    if (!raw) {
      if (format.link) unwrapSelectionLink(view);
      linkOpen = false;
      view.focus();
      refreshFormatState();
      return;
    }
    wrapSelectionLink(view, raw);
    linkOpen = false;
    linkValue = "";
    view.focus();
    refreshFormatState();
  }

  function onToolbarFocusIn(e: FocusEvent): void {
    if (nativeFocusgroup) return;
    const btns = toolbarButtons();
    const idx = btns.indexOf(e.target as HTMLButtonElement);
    if (idx >= 0) {
      activeIndex = idx;
      btns.forEach((b, i) => {
        b.tabIndex = i === idx ? 0 : -1;
      });
    }
  }

  function moveFocusInList(items: HTMLButtonElement[], e: KeyboardEvent, prevKey: string, nextKey: string): number {
    if (!items.length) return -1;
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (e.key === nextKey) next = (idx < 0 ? 0 : idx + 1) % items.length;
    else if (e.key === prevKey) next = (idx <= 0 ? items.length - 1 : idx - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next < 0) return -1;
    e.preventDefault();
    e.stopPropagation();
    items[next]?.focus();
    return next;
  }

  function onToolbarKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (!closeActivePopover()) onDismiss();
      return;
    }
    if (nativeFocusgroup || linkOpen || turnIntoOpen) return;
    const rtl = toolbarEl ? getComputedStyle(toolbarEl).direction === "rtl" : false;
    const next = moveFocusInList(toolbarButtons(), e, rtl ? "ArrowRight" : "ArrowLeft", rtl ? "ArrowLeft" : "ArrowRight");
    if (next >= 0) {
      activeIndex = next;
      syncRovingTabindex();
    }
  }

  function onMenuKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      turnIntoOpen = false;
      turnIntoBtn?.focus();
      return;
    }
    const items = menuEl ? [...menuEl.querySelectorAll<HTMLButtonElement>("button.ft-menu-item")] : [];
    moveFocusInList(items, e, "ArrowUp", "ArrowDown");
  }
</script>

{#if visible}
  <div
    bind:this={toolbarEl}
    class="floating-toolbar"
    role="toolbar"
    aria-label="Text formatting"
    data-testid="floating-toolbar"
    tabindex={-1}
    {...({ focusgroup: "toolbar wrap" } as Record<string, unknown>)}
    style:top="{top}px"
    style:left="{left}px"
    onfocusin={onToolbarFocusIn}
    onkeydown={onToolbarKeyDown}
  >
    <div class="ft-row">
      <div class="ft-group" role="group" aria-label="Block type">
        <button
          bind:this={turnIntoBtn}
          type="button"
          class="ft-btn ft-turn-into"
          data-testid="ft-turn-into"
          aria-label="Turn into"
          aria-haspopup="menu"
          aria-expanded={turnIntoOpen}
          title="Turn into"
          onpointerdown={keepEditorSelection}
          onmousedown={keepEditorSelection}
          onclick={toggleTurnInto}
        >
          <span class="ft-turn-label">{format.blockLabel}</span>
          <Icon name="chevron-down" size={12} />
        </button>
      </div>

      <span class="ft-sep" role="separator" aria-orientation="vertical"></span>

      <div class="ft-group" role="group" aria-label="Text style">
        {#each STYLE_BUTTONS as btn (btn.key)}
          <button
            type="button"
            class="ft-btn"
            aria-label={btn.label}
            aria-pressed={format[btn.key] ? "true" : "false"}
            title={btn.label}
            onpointerdown={keepEditorSelection}
            onmousedown={keepEditorSelection}
            onclick={() => runToggle(btn.run)}
          >
            <Icon name={btn.icon} size={14} />
          </button>
        {/each}
      </div>

      <span class="ft-sep" role="separator" aria-orientation="vertical"></span>

      <div class="ft-group" role="group" aria-label="Links">
        <button
          type="button"
          class="ft-btn"
          aria-label="Link"
          aria-pressed={format.link ? "true" : "false"}
          title="Add link"
          onpointerdown={keepEditorSelection}
          onmousedown={keepEditorSelection}
          onclick={toggleLinkBar}
        >
          <Icon name="link" size={14} />
        </button>
      </div>
    </div>

    {#if linkOpen}
      <div class="ft-link-bar" data-testid="ft-link-bar">
        <input
          bind:this={linkInputEl}
          type="text"
          class="ft-link-input"
          placeholder="Paste URL or [[note]]…"
          aria-label="Link URL or note"
          bind:value={linkValue}
          onkeydown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              submitLink();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              closeActivePopover();
            }
          }}
        />
        <button
          type="button"
          class="ft-link-apply"
          aria-label="Apply link"
          title="Apply link"
          onpointerdown={keepEditorSelection}
          onmousedown={keepEditorSelection}
          onclick={submitLink}
        >
          <Icon name="check" size={13} />
        </button>
      </div>
    {/if}

    {#if turnIntoOpen}
      <div
        bind:this={menuEl}
        class="ft-menu"
        role="menu"
        aria-label="Turn into block"
        data-testid="ft-turn-into-menu"
        tabindex={-1}
        style:top="{menuTop}px"
        style:left="{menuLeft}px"
        onkeydown={onMenuKeyDown}
      >
        {#each BLOCK_OPTIONS as opt (opt.kind)}
          <button
            type="button"
            class="ft-menu-item"
            role="menuitemradio"
            aria-checked={format.block === opt.kind ? "true" : "false"}
            onpointerdown={keepEditorSelection}
            onmousedown={keepEditorSelection}
            onclick={() => applyBlock(opt.kind)}
          >
            <span class="ft-menu-label">{opt.label}</span>
            <kbd class="ft-menu-hint">{opt.hint}</kbd>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .floating-toolbar {
    position: fixed; z-index: 95; display: flex; flex-direction: column; gap: 4px; padding: 4px;
    background: var(--bg-elev); border: 1px solid var(--border-strong); border-radius: var(--radius);
    box-shadow: var(--shadow-pop); font-family: var(--font-ui); color: var(--text); user-select: none;
  }
  .ft-row, .ft-group { display: flex; align-items: center; gap: 2px; }
  .ft-sep {
    width: 1px; height: calc(16px * var(--ui-scale, 1)); margin: 0 3px;
    background: var(--border); border-left: 1px solid transparent; flex: none;
  }
  .ft-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 4px;
    min-inline-size: calc(26px * var(--ui-scale, 1)); min-block-size: calc(26px * var(--ui-scale, 1));
    padding: 0 5px; border: 1px solid transparent; border-radius: var(--radius-sm);
    background: transparent; color: var(--text-muted); font-family: var(--font-ui);
    font-size: calc(12px * var(--ui-scale, 1)); font-weight: 500; line-height: 1; cursor: pointer;
  }
  .ft-turn-into { padding: 0 7px; color: var(--text); }
  .ft-turn-label { white-space: nowrap; }
  @media (hover: hover) {
    .ft-btn:hover { background: var(--bg-hover); color: var(--text); }
    .ft-menu-item:hover { background: var(--bg-hover); }
  }
  .ft-btn[aria-pressed="true"] { background: var(--bg-active); color: var(--accent); border-color: var(--accent-soft); }
  .ft-btn:focus-visible, .ft-menu-item:focus-visible, .ft-link-apply:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  @media (prefers-reduced-motion: no-preference) {
    .ft-btn, .ft-menu-item { transition: background-color 0.1s ease, color 0.1s ease, border-color 0.1s ease; }
  }
  @media (pointer: coarse) {
    .ft-btn { min-inline-size: calc(34px * var(--ui-scale, 1)); min-block-size: calc(34px * var(--ui-scale, 1)); }
  }
  .ft-link-bar { display: flex; align-items: center; gap: 4px; padding-top: 4px; border-top: 1px solid var(--border); }
  .ft-link-input {
    flex: 1; min-width: 190px; height: calc(26px * var(--ui-scale, 1)); padding: 0 8px;
    border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
    background: var(--bg); color: var(--text); font-family: var(--font-ui); font-size: calc(12px * var(--ui-scale, 1));
  }
  .ft-link-input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
  .ft-link-apply {
    display: inline-flex; align-items: center; justify-content: center;
    min-inline-size: calc(26px * var(--ui-scale, 1)); min-block-size: calc(26px * var(--ui-scale, 1));
    padding: 0; border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
    background: var(--accent-soft); color: var(--accent); cursor: pointer;
  }
  .ft-menu {
    position: fixed; z-index: 96; min-width: 172px; display: flex; flex-direction: column; gap: 1px; padding: 4px;
    background: var(--bg-elev); border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: var(--shadow-pop);
  }
  .ft-menu-item {
    display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%;
    padding: 5px 8px; border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent;
    color: var(--text); font-family: var(--font-ui); font-size: calc(12.5px * var(--ui-scale, 1)); text-align: left; cursor: pointer;
  }
  .ft-menu-item[aria-checked="true"] { background: var(--bg-active); color: var(--accent); }
  .ft-menu-hint { font-family: var(--font-mono); font-size: calc(11px * var(--ui-scale, 1)); color: var(--text-faint); background: transparent; border: 0; padding: 0; }
  @media (forced-colors: active) {
    .floating-toolbar, .ft-menu { border-color: ButtonText; }
    .ft-btn[aria-pressed="true"], .ft-menu-item[aria-checked="true"] { border-color: Highlight; color: Highlight; }
  }
</style>
