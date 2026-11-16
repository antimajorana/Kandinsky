<script lang="ts">
  // The optional formatting bar above a note (`[editor] format_bar`): each button does what its key
  // does — the same functions (lib/editor/md-format.ts) — and hands the keyboard back to the text.
  import type { EditorView } from "@codemirror/view";
  import { applyPigmentSpan, formatNote, insertSemanticTag, type PigmentColor } from "../lib/editor/md-format";
  import { tipFor } from "../lib/keymap.svelte";
  import type { MdFormat } from "../lib/registry";
  import type { IconName } from "../lib/panes";
  import Icon from "./Icon.svelte";

  let { view }: { view: () => EditorView | null } = $props();
  type Button = { kind: MdFormat; icon?: IconName; svg?: string; title: string; command?: string };

  const SVG_TOGGLE = '<path d="m6 8 5 4-5 4z" fill="currentColor" stroke="none"/><path d="M13 9h7M13 15h7"/>';
  const SVG_COLUMNS = '<rect x="3.5" y="4.5" width="7" height="15" rx="1.5"/><rect x="13.5" y="4.5" width="7" height="15" rx="1.5"/>';
  const SVG_MIC = '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 10.5a6.5 6.5 0 0 0 13 0M12 17v4M8.5 21h7"/>';
  const SVG_RTL = '<path d="M9 4v11M13 4v11M9 4H7a3.5 3.5 0 0 0 0 7h2M16 4H9"/><path d="m7 20-3-2.5L7 15M4 17.5h16"/>';

  const PIGMENTS: { id: PigmentColor; label: string; cssVar: string }[] = [
    { id: "cobalt", label: "Cobalt", cssVar: "var(--accent)" },
    { id: "ochre", label: "Ochre", cssVar: "var(--yellow)" },
    { id: "viridian", label: "Viridian", cssVar: "var(--green)" },
    { id: "vermilion", label: "Vermilion", cssVar: "var(--red)" },
    { id: "mauve", label: "Mauve", cssVar: "var(--purple)" },
  ];

  const SEMANTIC_TAGS: { marker: "[!]" | "[?]" | "[*]" | "[i]" | "TODO:"; glyph: string; label: string; cls: string }[] = [
    { marker: "[!]", glyph: "▲", label: "Important", cls: "tone-vermilion" },
    { marker: "[?]", glyph: "?", label: "Question", cls: "tone-cobalt" },
    { marker: "[*]", glyph: "✦", label: "Idea", cls: "tone-ochre" },
    { marker: "[i]", glyph: "■", label: "Remember", cls: "tone-viridian" },
    { marker: "TODO:", glyph: "TODO", label: "To-do", cls: "tone-todo" },
  ];

  const GROUPS: Button[][] = [
    [
      { kind: "bold", icon: "bold", title: "Bold", command: "note.bold" },
      { kind: "italic", icon: "italic", title: "Italic", command: "note.italic" },
      { kind: "highlight", icon: "highlighter", title: "Highlight (==mark==)", command: "note.highlight" },
      { kind: "code", icon: "code", title: "Code" },
    ],
    [
      { kind: "heading", icon: "heading", title: "Heading (again: a smaller one, then none)" },
      { kind: "bullet", icon: "list", title: "List" },
      { kind: "number", icon: "list-ordered", title: "Numbered list" },
      { kind: "task", icon: "list-todo", title: "To-do (again: done)", command: "note.task" },
      { kind: "taskDialog", icon: "calendar", title: "Task: dates, priority, repeat…", command: "note.task-edit" },
      { kind: "quote", icon: "quote", title: "Quote" },
    ],
    [
      { kind: "link", icon: "link", title: "Link", command: "note.link" },
      { kind: "table", icon: "table", title: "Insert a table" },
      { kind: "toggle", svg: SVG_TOGGLE, title: "Collapsible toggle", command: "note.toggle" },
      { kind: "columns", svg: SVG_COLUMNS, title: "2-column block", command: "note.columns" },
      { kind: "toc", icon: "outline", title: "Table of Contents ([[_TOC_]])", command: "note.toc" },
    ],
  ];

  let paletteOpen = $state(false);
  let activeCssVar = $state("var(--accent)");
  let paletteBtn = $state<HTMLButtonElement | null>(null);
  let popoverEl = $state<HTMLDivElement | null>(null);
  let popPos = $state({ top: 0, left: 0 });

  function updatePopPos() {
    if (!paletteBtn) return;
    const r = paletteBtn.getBoundingClientRect();
    const w = 236;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    popPos = { top: Math.round(r.bottom + 5), left: Math.round(left) };
  }

  function togglePalette() {
    paletteOpen = !paletteOpen;
    if (paletteOpen) updatePopPos();
  }

  $effect(() => {
    if (!paletteOpen) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (t && (paletteBtn?.contains(t) || popoverEl?.contains(t))) return;
      paletteOpen = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        paletteOpen = false;
        view()?.focus();
      }
    };
    document.addEventListener("mousedown", onDocDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", updatePopPos);
    return () => {
      document.removeEventListener("mousedown", onDocDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", updatePopPos);
    };
  });

  function run(kind: MdFormat) {
    paletteOpen = false;
    const v = view();
    if (!v) return;
    formatNote(v, kind);
    v.focus();
  }

  function pickPigment(mode: "color" | "bg", p: { id: PigmentColor; cssVar: string } | null) {
    if (p) activeCssVar = p.cssVar;
    paletteOpen = false;
    const v = view();
    if (!v) return;
    applyPigmentSpan(v, mode, p ? p.id : null);
    v.focus();
  }

  function pickSemantic(marker: "[!]" | "[?]" | "[*]" | "[i]" | "TODO:") {
    paletteOpen = false;
    const v = view();
    if (!v) return;
    insertSemanticTag(v, marker);
    v.focus();
  }

  function recordVoice() {
    paletteOpen = false;
    const v = view();
    window.dispatchEvent(new CustomEvent("kandinsky:voice-record", { detail: { view: v } }));
    v?.focus();
  }
</script>

<div class="format-bar" role="toolbar" aria-label="Formatting" data-testid="format-bar">
  {#each GROUPS as group, i (i)}
    {#if i}<span class="gap"></span>{/if}
    {#each group as b (b.kind)}
      <!-- mousedown is stopped so the text keeps its selection while the button is pressed -->
      <button type="button" data-format={b.kind} onmousedown={(e) => e.preventDefault()} onclick={() => run(b.kind)}
        aria-label={b.title} title={b.command ? tipFor(b.title, b.command) : b.title}>
        {#if b.icon}
          <Icon name={b.icon} size={16} />
        {:else if b.svg}
          <span class="svg-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html b.svg}</svg></span>
        {/if}
      </button>
    {/each}
    {#if i === 0}
      <button type="button" class="palette-btn" class:is-open={paletteOpen} bind:this={paletteBtn}
        data-testid="pigment-palette-btn" aria-haspopup="dialog" aria-expanded={paletteOpen}
        aria-label="Bauhaus pigments & semantic tags" title="Pigment colors, highlight washes & semantic tags"
        onmousedown={(e) => e.preventDefault()} onclick={togglePalette}>
        <span class="glyph-a">A</span>
        <span class="swatch-dot" style:background={activeCssVar}></span>
      </button>
    {/if}
  {/each}

  <span class="gap"></span>
  <button type="button" data-testid="voice-memo-btn" onmousedown={(e) => e.preventDefault()} onclick={recordVoice}
    aria-label="Record voice memo" title={tipFor("Record voice memo", "note.voice")}>
    <span class="svg-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html SVG_MIC}</svg></span>
  </button>
  <button type="button" data-format="rtl" onmousedown={(e) => e.preventDefault()} onclick={() => run("rtl")}
    aria-label="Toggle RTL / LTR direction" title={tipFor("Toggle RTL / LTR direction", "note.rtl")}>
    <span class="svg-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html SVG_RTL}</svg></span>
  </button>
</div>

{#if paletteOpen}
  <div class="pigment-popover" role="dialog" aria-label="Pigment palette" data-testid="pigment-popover"
    bind:this={popoverEl} style:top="{popPos.top}px" style:left="{popPos.left}px">
    <div class="pop-sec-label">Text color</div>
    <div class="swatch-row">
      <button type="button" class="swatch swatch-text is-default" title="Default text color"
        onmousedown={(e) => e.preventDefault()} onclick={() => pickPigment("color", null)}>A</button>
      {#each PIGMENTS as p (p.id)}
        <button type="button" class="swatch swatch-text" style:--p={p.cssVar} title="{p.label} text"
          data-pigment-color={p.id} onmousedown={(e) => e.preventDefault()} onclick={() => pickPigment("color", p)}>A</button>
      {/each}
    </div>

    <div class="pop-sec-label">Highlight wash</div>
    <div class="swatch-row">
      <button type="button" class="swatch swatch-bg is-default" title="Clear highlight"
        onmousedown={(e) => e.preventDefault()} onclick={() => pickPigment("bg", null)}>∅</button>
      {#each PIGMENTS as p (p.id)}
        <button type="button" class="swatch swatch-bg" style:--p={p.cssVar} title="{p.label} highlight wash"
          data-pigment-bg={p.id} onmousedown={(e) => e.preventDefault()} onclick={() => pickPigment("bg", p)}>
          <span class="wash-dot"></span>
        </button>
      {/each}
    </div>

    <div class="pop-sec-label">Semantic tags</div>
    <div class="sem-grid">
      {#each SEMANTIC_TAGS as s (s.marker)}
        <button type="button" class="sem-btn {s.cls}" title="Insert {s.marker} ({s.label})"
          data-sem-marker={s.marker} onmousedown={(e) => e.preventDefault()} onclick={() => pickSemantic(s.marker)}>
          <span class="sem-glyph">{s.glyph}</span>
          <span class="sem-name">{s.label}</span>
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  /* beside the Properties panel the bar is narrow: its buttons wrap to a second row rather than scroll */
  /* one height with the Properties panel's heading, so the two lines under them meet as one */
  .format-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; padding: 3px 10px; border-bottom: 1px solid var(--border); flex: none; box-sizing: border-box; min-height: calc(36px * var(--ui-scale, 1)); }
  .format-bar > button { display: grid; place-items: center; width: calc(30px * var(--ui-scale, 1)); height: calc(28px * var(--ui-scale, 1)); padding: 0; border-radius: var(--radius-sm); color: var(--text-muted); flex: none; }
  .format-bar > button:hover, .format-bar > button.is-open { background: var(--bg-hover); color: var(--text); }
  .svg-icon { display: inline-flex; width: calc(16px * var(--ui-scale, 1)); height: calc(16px * var(--ui-scale, 1)); line-height: 0; }
  .svg-icon svg { width: 100%; height: 100%; }
  .palette-btn { display: inline-flex !important; flex-direction: column; align-items: center; justify-content: center; gap: 1.5px; }
  .glyph-a { font-family: var(--font-ui); font-size: calc(12.5px * var(--ui-scale, 1)); font-weight: 700; line-height: 1; }
  .swatch-dot { width: calc(12px * var(--ui-scale, 1)); height: 3px; border-radius: 99px; }
  .gap { width: 1px; height: calc(16px * var(--ui-scale, 1)); margin: 0 6px; background: var(--border); flex: none; }

  .pigment-popover {
    position: fixed; z-index: 120; width: 236px; padding: 9px 10px 10px; box-sizing: border-box;
    background: var(--bg-elev); border: 1px solid var(--border-strong); border-radius: var(--radius, 8px);
    box-shadow: var(--shadow-pop); font-family: var(--font-ui); color: var(--text); user-select: none;
  }
  .pop-sec-label {
    font-size: 10.5px; font-weight: 600; letter-spacing: .055em; text-transform: uppercase;
    color: var(--text-faint); margin: 6px 2px 5px;
  }
  .pop-sec-label:first-child { margin-top: 0; }
  .swatch-row { display: grid; grid-template-columns: repeat(6, 1fr); gap: 5px; }
  .swatch {
    display: grid; place-items: center; height: 28px; padding: 0; border-radius: 5px;
    border: 1px solid var(--border); background: var(--bg-alt); cursor: pointer;
    font-family: var(--font-ui); font-size: 12.5px; font-weight: 700; transition: transform .1s, border-color .1s;
  }
  .swatch:hover { transform: translateY(-1px); border-color: var(--border-strong); background: var(--bg-hover); }
  .swatch-text { color: var(--p, var(--text)); }
  .swatch-text.is-default { color: var(--text-muted); font-weight: 500; }
  .swatch-bg { background: color-mix(in srgb, var(--p, transparent) 24%, var(--bg-alt)); border-color: color-mix(in srgb, var(--p, var(--border)) 36%, var(--border)); }
  .swatch-bg.is-default { background: var(--bg-alt); color: var(--text-faint); font-size: 12px; font-weight: 500; }
  .wash-dot { width: 11px; height: 11px; border-radius: 50%; background: var(--p); opacity: .88; }

  .sem-grid { display: flex; flex-wrap: wrap; gap: 4px; }
  .sem-btn {
    display: inline-flex; align-items: center; gap: 5px; height: 25px; padding: 0 7px;
    border-radius: 5px; border: 1px solid var(--border); background: var(--bg-alt);
    color: var(--text); font-family: var(--font-ui); font-size: 11.5px; cursor: pointer;
  }
  .sem-btn:hover { background: var(--bg-hover); border-color: var(--border-strong); }
  .sem-glyph { display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 11px; line-height: 1; }
  .sem-btn.tone-vermilion .sem-glyph { color: var(--red); }
  .sem-btn.tone-cobalt .sem-glyph { color: var(--accent-strong, var(--accent)); }
  .sem-btn.tone-ochre .sem-glyph { color: var(--yellow); }
  .sem-btn.tone-viridian .sem-glyph { color: var(--green); }
  .sem-btn.tone-todo .sem-glyph { color: var(--accent-strong, var(--accent)); font-family: var(--font-mono); font-size: 9.5px; }
  .sem-name { color: var(--text-muted); }
</style>
