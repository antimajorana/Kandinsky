<script lang="ts">
  // Hover Configure popover for ```view / block cards in Live Preview: edits options with form inputs instead of forcing raw YAML.
  import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
  import { EditorView } from "@codemirror/view";
  import Icon from "../Icon.svelte";
  import { optionFields } from "../../lib/blocks";
  import type { OptionField } from "../../lib/block-options";
  import { blockType } from "../../lib/panes";

  let {
    blockEl,
    src,
    onupdated,
  }: {
    blockEl: HTMLElement;
    src: string;
    onupdated?: (newSrc: string) => void;
  } = $props();

  let open = $state(false);
  let draft = $state<Record<string, string | boolean>>({});
  let error = $state("");

  const type = $derived(blockType(src));
  const fields: OptionField[] = $derived(optionFields(type));

  function loadDraft(): void {
    error = "";
    try {
      const parsed = (parseYaml(src) as Record<string, unknown>) ?? {};
      const next: Record<string, string | boolean> = {};
      for (const f of fields) {
        const v = parsed[f.key];
        if (f.kind === "toggle") next[f.key] = v === true;
        else if (Array.isArray(v)) next[f.key] = v.join(", ");
        else next[f.key] = v == null ? "" : String(v);
      }
      draft = next;
    } catch {
      draft = {};
    }
  }

  function findFenceRange(view: EditorView): { from: number; to: number; innerFrom: number; innerTo: number } | null {
    const rendered = blockEl.closest(".cm-rendered-block");
    if (!rendered) return null;
    let at = 0;
    try {
      at = view.posAtDOM(rendered);
    } catch {
      return null;
    }
    const doc = view.state.doc;
    const startLine = doc.lineAt(Math.max(0, Math.min(at, doc.length)));
    let openLineNo = startLine.number;
    // Check the anchor line first, then immediate neighbours, so a neighbouring fence above isn't matched first.
    for (const delta of [0, -1, 1, -2, 2]) {
      const ln = startLine.number + delta;
      if (ln < 1 || ln > doc.lines) continue;
      const m = /^[ \t]*(`{3,}|~{3,})[ \t]*\S/.exec(doc.line(ln).text);
      if (m) {
        openLineNo = ln;
        break;
      }
    }
    const openMatch = /^[ \t]*(`{3,}|~{3,})/.exec(doc.line(openLineNo).text);
    if (!openMatch) return null;
    const fenceChar = openMatch[1][0];
    const fenceLen = openMatch[1].length;
    let closeLineNo = openLineNo + 1;
    while (closeLineNo <= doc.lines) {
      const t = doc.line(closeLineNo).text.replace(/^[ \t]+/, "");
      let run = 0;
      while (t[run] === fenceChar) run++;
      if (run >= fenceLen && t.slice(run).trim() === "") break;
      closeLineNo++;
    }
    if (closeLineNo > doc.lines) return null;
    return {
      from: doc.line(openLineNo).from,
      to: doc.line(closeLineNo).to,
      innerFrom: doc.line(openLineNo).to + 1,
      innerTo: doc.line(closeLineNo).from,
    };
  }

  function editorViewForBlock(): EditorView | null {
    const host = blockEl.closest(".cm-editor");
    return host instanceof HTMLElement ? EditorView.findFromDOM(host) : EditorView.findFromDOM(blockEl);
  }

  function applyConfig(e: SubmitEvent): void {
    e.preventDefault();
    const view = editorViewForBlock();
    if (!view) { error = "Open editor to update block"; return; }
    const range = findFenceRange(view);
    if (!range) { error = "Could not locate block in document"; return; }
    let existing: Record<string, unknown> = {};
    try {
      const p = parseYaml(src);
      if (p && typeof p === "object" && !Array.isArray(p)) existing = { ...(p as Record<string, unknown>) };
    } catch { /* fallback */ }
    existing.type = type;
    for (const f of fields) {
      const val = draft[f.key];
      if (f.kind === "toggle") {
        if (val === true) existing[f.key] = true;
        else delete existing[f.key];
      } else if (f.kind === "number") {
        const s = String(val ?? "").trim();
        if (s && Number.isFinite(Number(s))) existing[f.key] = Number(s);
        else delete existing[f.key];
      } else if (f.kind === "list") {
        const items = String(val ?? "").split(",").map((x) => x.trim()).filter(Boolean);
        if (items.length) existing[f.key] = items;
        else delete existing[f.key];
      } else {
        const s = String(val ?? "").trim();
        if (s) existing[f.key] = s;
        else delete existing[f.key];
      }
    }
    const newYaml = stringifyYaml(existing).trimEnd();
    view.dispatch({
      changes: { from: range.innerFrom, to: Math.max(range.innerFrom, range.innerTo - 1), insert: newYaml },
      userEvent: "input.configure",
    });
    open = false;
    onupdated?.(newYaml);
  }

  function editBlockSource(): void {
    const view = editorViewForBlock();
    if (!view) return;
    const range = findFenceRange(view);
    if (!range) return;
    view.dispatch({ selection: { anchor: Math.min(range.innerFrom, view.state.doc.length) }, scrollIntoView: true });
    view.focus();
    open = false;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="cfg-wrap" onmousedown={(e) => e.stopPropagation()} onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
  <button
    type="button"
    class="cfg-btn"
    title="Configure widget"
    aria-label="Configure block"
    data-testid="widget-configure-btn"
    onclick={() => { loadDraft(); open = !open; }}
  >
    <Icon name="sliders" size={12} /> <span>Configure</span>
  </button>
  <button type="button" class="cfg-btn icon" title="Edit block source" aria-label="Edit block source" onclick={editBlockSource}>
    <Icon name="file-code" size={12} />
  </button>

  {#if open}
    <form class="cfg-pop" onsubmit={applyConfig} data-testid="widget-configure-popover">
      <header class="pop-head">
        <strong>Configure {type}</strong>
        <button type="button" class="x" onclick={() => (open = false)} aria-label="Close"><Icon name="close" size={12} /></button>
      </header>
      <div class="pop-fields">
        {#each fields as f (f.key)}
          {#if f.kind === "toggle"}
            <label class="chk">
              <input type="checkbox" checked={draft[f.key] === true} onchange={(e) => (draft = { ...draft, [f.key]: e.currentTarget.checked })} />
              <span>{f.label}</span>
            </label>
          {:else if f.kind === "choice"}
            <label class="fld">
              <span>{f.label}</span>
              <select value={String(draft[f.key] ?? "")} onchange={(e) => (draft = { ...draft, [f.key]: e.currentTarget.value })}>
                {#each f.choices ?? [] as c (c)}<option value={c}>{c || "(default)"}</option>{/each}
              </select>
            </label>
          {:else if f.kind === "number" || f.kind === "text" || f.kind === "list"}
            <label class="fld">
              <span>{f.label}</span>
              <input
                type={f.kind === "number" ? "number" : "text"}
                placeholder={f.hint ?? ""}
                value={String(draft[f.key] ?? "")}
                oninput={(e) => (draft = { ...draft, [f.key]: e.currentTarget.value })}
              />
            </label>
          {/if}
        {/each}
      </div>
      {#if error}<p class="err">{error}</p>{/if}
      <footer class="pop-foot">
        <button type="button" class="ghost" onclick={editBlockSource}>Edit block source</button>
        <button type="submit" class="save">Apply</button>
      </footer>
    </form>
  {/if}
</div>

<style>
  .cfg-wrap { position: relative; display: inline-flex; align-items: center; gap: 4px; }
  .cfg-btn { display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: var(--radius-sm); background: var(--bg-elev); border: 1px solid var(--border-strong); color: var(--text-muted); font-size: 11px; font-weight: 500; box-shadow: var(--shadow-sm); }
  .cfg-btn.icon { padding: 3px 5px; }
  .cfg-btn:hover { color: var(--heading); background: var(--bg-hover); }
  .cfg-pop { position: absolute; right: 0; top: calc(100% + 6px); z-index: 60; width: 290px; background: var(--bg-elev); border: 1px solid var(--border-strong); border-radius: var(--radius-lg); box-shadow: var(--shadow-pop); padding: 12px; display: flex; flex-direction: column; gap: 10px; }
  .pop-head { display: flex; align-items: center; justify-content: space-between; font-size: 12.5px; color: var(--heading); }
  .pop-head .x { color: var(--text-faint); padding: 2px; border-radius: 4px; }
  .pop-head .x:hover { color: var(--text); background: var(--bg-hover); }
  .pop-fields { display: flex; flex-direction: column; gap: 8px; max-height: 260px; overflow-y: auto; }
  .fld { display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; color: var(--text-muted); }
  .fld input, .fld select { padding: 5px 7px; border-radius: var(--radius-sm); border: 1px solid var(--border-strong); background: var(--bg); color: var(--text); font: inherit; }
  .fld input:focus, .fld select:focus { outline: none; border-color: var(--accent); }
  .chk { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--text); cursor: pointer; }
  .chk input { accent-color: var(--accent); }
  .err { margin: 0; font-size: 11.5px; color: var(--red); }
  .pop-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 4px; border-top: 1px solid var(--border); }
  .ghost { font-size: 11.5px; color: var(--text-muted); padding: 4px 6px; border-radius: var(--radius-sm); }
  .ghost:hover { color: var(--text); background: var(--bg-hover); }
  .save { padding: 4px 12px; border-radius: var(--radius-sm); background: var(--accent); color: var(--accent-fg); font-size: 12px; font-weight: 600; }
</style>
