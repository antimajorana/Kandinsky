<script lang="ts">
  // One property's control in the properties panel, chosen by its kind: text, number, checkbox,
  // date, date and time, a choice (enum), or pills for a link / list / tags / links. `onset` gets
  // the new YAML value (null = empty); conversions live in lib/property-model.ts.
  import Select from "./Select.svelte";
  import Icon from "./Icon.svelte";
  import SuggestInput, { type Suggestion } from "./SuggestInput.svelte";
  import type { LinkTarget } from "../lib/gen/LinkTarget";
  import { asLink, asNumber, asTag, fromInput, isListKind, linkLabel, linkTarget, listOf, scalarText, toInput, WIKI } from "../lib/property-model";
  import type { PropertyKind, PropertySpec } from "../lib/types";
  import { api } from "../lib/api";
  import { arxivOf, doiOf, filedSource, isSource, openSource } from "../lib/doi-links";
  import { classifyPigment } from "../lib/editor/pigment-pills";
  import { classifyStatus, groupStatusOptions } from "../lib/base-format";
  import { closable } from "../lib/back";

  let { name, kind, value, spec, onset, onopen, values = [] }: {
    name: string; kind: PropertyKind; value: unknown; spec?: PropertySpec;
    onset: (v: unknown) => void; onopen: (target: string) => void;
    /** the values this property has in the vault's notes, the commonest first (lib/known-properties.svelte.ts) */
    values?: string[];
  } = $props();

  const label = $derived(`${name}: ${kind}`);
  const items = $derived(listOf(value));
  const multi = $derived(isListKind(kind));
  const pills = $derived(multi || kind === "link");
  // a single link takes one pill: its input shows only while it is empty
  const canAdd = $derived(multi || items.length === 0);
  let draft = $state("");
  // a link field offers the vault's notes as the user types: the core's ranking, as `[[` in the editor
  let found = $state<Suggestion[]>([]);
  let asked = 0;
  $effect(() => {
    const q = draft.trim().replace(/^\[\[|\]\]$/g, "");
    if (!(kind === "link" || kind === "links") || !q) { found = []; return; }
    const n = ++asked;
    const t = setTimeout(() => void api.linkTargets(q).then((ts) => { if (n === asked) found = ts.slice(0, 12).map(linkSuggestion("")); }, () => {}), 120);
    return () => clearTimeout(t);
  });
  /** A note the core found, as a row: its link, and the folder it is in (two notes of one name tell apart). */
  const linkSuggestion = (before: string) => (x: LinkTarget): Suggestion => {
    const folder = x.path.includes("/") ? x.path.slice(0, x.path.lastIndexOf("/")) : "";
    return { value: `${before}[[${x.link}]]`, label: x.alias ? `${x.alias} → ${x.link}` : x.link, detail: folder };
  };
  const plain = (v: string): Suggestion => ({ value: v, label: WIKI.test(v) ? linkLabel(v) : v });
  const unique = (l: Suggestion[]) => l.filter((s, i, all) => all.findIndex((o) => o.value === s.value) === i);
  // what was typed narrows the known values too (the core already ranked the notes)
  const matches = (v: string, q: string) => !q || v.toLowerCase().includes(q.toLowerCase());
  const suggest = $derived(unique([...found, ...[...(spec?.suggest ?? []), ...values].filter((v) => matches(v, draft.trim())).map(plain)])
    .filter((s) => !items.includes(s.value)).slice(0, 40));
  // a text field: its known values, and the vault's notes after a `[[` typed in it (as `[[` in the editor)
  let typed = $state("");
  let linksAt = $state<Suggestion[]>([]);
  $effect(() => {
    const open = typed.lastIndexOf("[[");
    const q = open >= 0 && !typed.slice(open).includes("]]") ? typed.slice(open + 2).trim() : null;
    if (q === null) { linksAt = []; return; }
    const n = ++asked;
    const t = setTimeout(() => void api.linkTargets(q).then((ts) => { if (n === asked) linksAt = ts.slice(0, 12).map(linkSuggestion(typed.slice(0, open))); }, () => {}), 120);
    return () => clearTimeout(t);
  });
  const textSuggest = $derived(linksAt.length ? linksAt : unique([...(spec?.suggest ?? []), ...values].filter((v) => v !== typed && matches(v, typed.trim())).map(plain)).slice(0, 40));

  /** What the user typed in a pill field → the value to store (links get brackets, tags lose `#`). */
  const shape = (s: string) => (kind === "link" || kind === "links" ? asLink(s) : kind === "tags" ? asTag(s) : s.trim());

  function add(text: string) {
    const next = text.split(kind === "link" ? /\n/ : /,/).map(shape).filter((s) => s && !items.includes(s));
    draft = "";
    if (!next.length) return;
    onset(kind === "link" ? next[0] : [...items, ...next]);
  }
  function remove(i: number) {
    const rest = items.filter((_, j) => j !== i);
    onset(kind === "link" ? null : rest.length ? rest : null);
  }
  function pillKey(e: KeyboardEvent) {
    const el = e.currentTarget as HTMLInputElement;
    if (e.key === "Enter" || (e.key === "," && multi)) { e.preventDefault(); add(el.value); }
    else if (e.key === "Backspace" && !el.value && items.length) { e.preventDefault(); remove(items.length - 1); }
  }
  const commitText = (e: Event) => { const v = (e.currentTarget as HTMLInputElement).value; onset(v.trim() === "" ? null : v); };
  const commitNumber = (e: Event) => onset(asNumber((e.currentTarget as HTMLInputElement).value));
  const commitDate = (e: Event, k: "date" | "datetime") => { const v = (e.currentTarget as HTMLInputElement).value; onset(v ? fromInput(v, k, spec?.format ?? "", value) : null); };
  const enterBlurs = (e: KeyboardEvent) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); };
  const options = $derived.by(() => {
    const vals = [...(spec?.values ?? [])];
    const cur = scalarText(value);
    if (cur && !vals.includes(cur)) vals.push(cur); // a value outside the spec stays choosable (and visible)
    return [{ value: "", label: "Empty" }, ...vals.map((v) => ({ value: v, label: v.replace(/^\[\[|\]\]$/g, ""), note: spec?.values.includes(v) ? undefined : "not in the spec" }))];
  });
  const statusSections = $derived.by(() => {
    if (kind !== "status") return [];
    const cur = scalarText(value).trim();
    return groupStatusOptions(spec?.values, spec?.groups, cur || null);
  });
  const flatStatusOptions = $derived(["", ...statusSections.flatMap((s) => s.items.map((it) => it.value))]);
  let statusOpen = $state(false);
  let statusActive = $state(0);
  let statusWrap = $state<HTMLDivElement>();
  let statusMenu = $state<HTMLDivElement>();
  $effect(() => { if (statusOpen) return closable(() => (statusOpen = false)); });
  function openStatusMenu() {
    const cur = scalarText(value).trim().toLowerCase();
    const idx = flatStatusOptions.findIndex((v) => v.toLowerCase() === cur);
    statusActive = idx >= 0 ? idx : 0;
    statusOpen = true;
    requestAnimationFrame(() => statusMenu?.querySelector(".on")?.scrollIntoView({ block: "nearest" }));
  }
  function pickStatusOption(next: string) {
    statusOpen = false;
    const cur = scalarText(value);
    if (next !== cur) onset(next || null);
    statusWrap?.querySelector("button")?.focus();
  }
  function onStatusKeydown(e: KeyboardEvent) {
    if (!statusOpen) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) { e.preventDefault(); openStatusMenu(); }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); statusOpen = false; }
    else if (e.key === "ArrowDown") { e.preventDefault(); statusActive = Math.min(flatStatusOptions.length - 1, statusActive + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); statusActive = Math.max(0, statusActive - 1); }
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const val = flatStatusOptions[statusActive];
      if (val !== undefined) pickStatusOption(val);
    } else if (e.key.length === 1) {
      const i = flatStatusOptions.findIndex((v) => (v || "empty").toLowerCase().startsWith(e.key.toLowerCase()));
      if (i >= 0) statusActive = i;
    } else return;
    requestAnimationFrame(() => statusMenu?.querySelector(".on")?.scrollIntoView({ block: "nearest" }));
  }
  function onStatusFocusout(e: FocusEvent) {
    if (!statusWrap?.contains(e.relatedTarget as Node)) statusOpen = false;
  }
  // what a value points at:
  // a [[link]] or a file name (`paper.pdf`, found as links are) opens in Kandinsky, an address in the browser
  const isUrl = (v: string) => /^https?:\/\//i.test(v.trim());
  const isFile = (v: string) => !isUrl(v) && /^[^\n]{1,200}\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(v.trim());
  const target = (v: string): string | null => (WIKI.test(v) ? linkTarget(v) : isFile(v) ? v.trim() : null);
  const follow = (v: string) => { if (isUrl(v)) void import("../lib/web-links").then((m) => m.openWeb(v.trim())); else { const t = target(v); if (t) onopen(t); } };
  const opens = (v: string) => isUrl(v) || target(v) !== null;
  // links inside a longer value ("from [[a]] and https://b"): each one offered under the field
  const inner = (v: string): string[] => (opens(v) ? [] : [...v.matchAll(/\[\[[^\]\n]+\]\]|https?:\/\/[^\s<>"')\]]+/g)].map((m) => m[0]));
  // a note's sources (`sources`, `references`…): an entry the library lacks shows red, a click files it through the
  // catalog and opens its note (lib/doi-links.ts); Shift+click opens the address in the browser
  const sourcesField = $derived(/^(sources?|references?|refs|cites?|citations?)$/i.test(name));
  let unfiled = $state<string[]>([]);
  $effect(() => {
    const list = sourcesField ? items.filter(isSource) : [];
    let live = true;
    void Promise.all(list.map(async (s) => ((await filedSource(s)) ? null : s))).then((r) => { if (live) unfiled = r.filter((x): x is string => !!x); });
    return () => { live = false; };
  });
  const asSource = (v: string) => sourcesField && isSource(v);
  const openPill = (e: MouseEvent, v: string) => {
    if (!asSource(v)) return follow(v);
    const url = isUrl(v) ? v.trim() : doiOf(v) ? `https://doi.org/${doiOf(v)}` : `https://arxiv.org/abs/${arxivOf(v)}`;
    if (e.shiftKey) return void import("../lib/web-links").then((m) => m.openOutside(url));
    void openSource(v).then((ok) => { if (!ok) void import("../lib/web-links").then((m) => m.openPage(url)); });
  };
  // Ctrl/⌘+click on a field holding one link opens it, as Ctrl+click on a name in the editor
  const ctrlOpen = (e: MouseEvent, v: string) => { if ((e.ctrlKey || e.metaKey) && opens(v)) { e.preventDefault(); follow(v); } };
</script>

{#if pills}
  <div class="pills" data-kind={kind}>
    {#each items as it, i (it)}
      {@const pig = classifyPigment(name, WIKI.test(it) ? linkLabel(it) : it, i, { isList: multi, isTag: kind === "tags", isLink: WIKI.test(it) })}
      <span class="pill {pig.tone ? `pill-${pig.tone}` : ''}" class:tag={kind === "tags"} class:link={WIKI.test(it)} class:has-dot={pig.dot}>
        {#if WIKI.test(it)}
          <button type="button" class="pill-text" title="Open {linkTarget(it)}" onclick={() => onopen(linkTarget(it))}>{linkLabel(it)}</button>
        {:else if asSource(it)}
          <button type="button" class="pill-text opens" class:unfiled={unfiled.includes(it)} onclick={(e) => openPill(e, it)}
            title={unfiled.includes(it) ? `Not in the library: a click adds it (Shift+click: the browser)` : `Open its note (Shift+click: the browser)`}>{it}</button>
        {:else if opens(it)}
          <button type="button" class="pill-text opens" title={isUrl(it) ? `Open ${it} in the browser` : `Open ${it}`} onclick={() => follow(it)}>{it}</button>
        {:else}
          <span class="pill-text">{it}</span>
        {/if}
        <button type="button" class="pill-x" aria-label="Remove {it}" onclick={() => remove(i)}><Icon name="close" size={11} /></button>
      </span>
    {/each}
    {#if canAdd}
      <SuggestInput class="pill-input" aria-label={label} placeholder={kind === "tags" ? "Add a tag…" : kind === "list" ? "Add…" : "Add a link…"}
        items={suggest} onpick={add} bind:value={draft} onkeydown={pillKey} onblur={() => draft.trim() && add(draft)} />
    {/if}
  </div>
{:else if kind === "bool"}
  <label class="check"><input type="checkbox" aria-label={label} checked={value === true} onchange={(e) => onset((e.currentTarget as HTMLInputElement).checked)} /><span>{value === true ? "Yes" : "No"}</span></label>
{:else if kind === "status"}
  {@const curText = scalarText(value)}
  {@const st = curText ? classifyStatus(curText, spec?.groups) : null}
  <div class="status-select" bind:this={statusWrap} onfocusout={onStatusFocusout}>
    <button
      type="button"
      class="status-trigger {st ? `tone-${st.tone}` : 'is-empty'}"
      aria-haspopup="listbox"
      aria-expanded={statusOpen}
      aria-label={label}
      onclick={() => (statusOpen ? (statusOpen = false) : openStatusMenu())}
      onkeydown={onStatusKeydown}
    >
      {#if st}<span class="status-dot" aria-hidden="true"></span>{/if}
      <span class="cur">{st ? st.label : "Empty"}</span>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>
    {#if statusOpen}
      <div class="status-menu" role="listbox" aria-label={label} bind:this={statusMenu} tabindex="-1">
        <button
          type="button"
          role="option"
          class="status-opt empty-opt"
          class:on={statusActive === 0}
          class:cur={!curText}
          aria-selected={!curText}
          onmousedown={(e) => { e.preventDefault(); pickStatusOption(""); }}
          onmousemove={() => (statusActive = 0)}
        >
          <span>Empty</span>
        </button>
        {#each statusSections as sec (sec.key)}
          <div class="status-sec-lbl">{sec.label}</div>
          {#each sec.items as opt (opt.value)}
            {@const idx = flatStatusOptions.indexOf(opt.value)}
            <button
              type="button"
              role="option"
              class="status-opt"
              class:on={idx === statusActive}
              class:cur={curText.trim().toLowerCase() === opt.value.toLowerCase()}
              aria-selected={curText.trim().toLowerCase() === opt.value.toLowerCase()}
              onmousedown={(e) => { e.preventDefault(); pickStatusOption(opt.value); }}
              onmousemove={() => (statusActive = idx)}
            >
              <span class="status-pill tone-{opt.tone}">
                <span class="status-dot" aria-hidden="true"></span>
                <span>{opt.label}</span>
              </span>
              {#if !opt.inSpec}<span class="status-note">not in spec</span>{/if}
            </button>
          {/each}
        {/each}
      </div>
    {/if}
  </div>
{:else if kind === "enum"}
  {@const curText = scalarText(value)}
  {@const selPig = classifyPigment(name, curText, 0)}
  <div
    class="select-wrap"
    class:is-empty={!curText}
    class:has-dot={Boolean(curText && selPig.dot)}
    data-tone={curText && selPig.tone ? selPig.tone : undefined}
  >
    <Select label={label} value={curText} {options} onchange={(v) => onset(v || null)} />
  </div>
{:else if kind === "rating"}
  {@const cur = Math.max(0, Math.min(5, Math.round(Number(value) || 0)))}
  <div class="rating-row" role="radiogroup" aria-label={label}>
    {#each [1, 2, 3, 4, 5] as star (star)}
      <button type="button" class="star-btn" class:lit={cur >= star} aria-label="{star} star"
        onclick={() => onset(cur === star ? null : star)}>★</button>
    {/each}
  </div>
{:else if kind === "auto_id"}
  <span class="auto-id">{scalarText(value) || "Auto"}</span>
<!-- a template's `{{date}}` stays its text, never read as a date -->
{:else if (kind === "date" || kind === "datetime") && !/\{\{/.test(scalarText(value))}
  <!-- a datetime property holding a bare day (a daily note's `date: 2026-11-02`) is edited as that day, not as its midnight -->
  {@const k = kind === "datetime" && /^\d{4}-\d{2}-\d{2}$/.test(scalarText(value)) ? "date" : kind}
  <input class="field" type={k === "date" ? "date" : "datetime-local"} aria-label={label} value={toInput(value, k)} onchange={(e) => commitDate(e, k)} onkeydown={enterBlurs} />
{:else if kind === "number"}
  <input class="field num" type="number" step="any" aria-label={label} value={scalarText(value)} onchange={commitNumber} onkeydown={enterBlurs} />
{:else}
  {@const text = scalarText(value)}
  {@const scalarPig = classifyPigment(name, text, 0)}
  <div class="text-row" class:has-pigment={!!(text && scalarPig.wrapScalar && scalarPig.tone)} data-tone={scalarPig.tone ?? undefined}>
    {#if text && scalarPig.dot}<span class="status-dot" aria-hidden="true">●</span>{/if}
    <SuggestInput class="field {opens(text) ? 'is-link' : ''}" type="text" aria-label={label} placeholder="Empty" value={text} items={textSuggest}
      title={opens(text) ? "Ctrl+click to open" : undefined} onclick={(e: MouseEvent) => ctrlOpen(e, text)}
      onpick={(v) => { typed = v; onset(v.trim() === "" ? null : v); }} onchange={commitText} onkeydown={enterBlurs}
      oninput={(e) => (typed = e.currentTarget.value)} onfocus={(e) => (typed = e.currentTarget.value)} />
    {#if text && opens(text)}
      <button type="button" class="icon-btn open" aria-label="Open {label}" title={isUrl(text) ? `Open ${text} in the browser` : `Open ${target(text)}`} onclick={() => follow(text)}><Icon name="link" size={12} /></button>
    {/if}
    {#if inner(text).length}
    <div class="inner-links">
      {#each inner(text) as l (l)}<button type="button" class="inner-link" title={isUrl(l) ? `Open ${l} in the browser` : `Open ${linkTarget(l)}`} onclick={() => follow(l)}>{isUrl(l) ? l.replace(/^https?:\/\/(www\.)?/, "") : linkLabel(l)}</button>{/each}
    </div>
    {/if}
  </div>
{/if}

<style>
  .field, .text-row :global(.field) { width: 100%; min-width: 0; height: calc(26px * var(--ui-scale, 1)); padding: 0 7px; border-radius: var(--radius-sm); border: 1px solid transparent; background: transparent;
    color: var(--text); font: inherit; font-size: calc(12.5px * var(--ui-scale, 1)); }
  .field:hover, .text-row :global(.field:hover) { border-color: var(--border); }
  .field:focus, .text-row :global(.field:focus) { outline: none; border-color: var(--accent); background: var(--bg); }
  .field::placeholder, .text-row :global(.field::placeholder) { color: var(--text-faint); font-style: italic; }
  .num { font-variant-numeric: tabular-nums; }
  input[type="date"], input[type="datetime-local"] { font-variant-numeric: tabular-nums; color-scheme: light dark; }
  .select-wrap { display: flex; align-items: center; min-width: 0; width: 100%; min-height: calc(26px * var(--ui-scale, 1)); }
  .select-wrap :global(.select) { width: 100%; min-width: 0; display: flex; align-items: center; }
  .select-wrap :global(.trigger) {
    width: fit-content; max-width: 100%; min-height: calc(22px * var(--ui-scale, 1)); height: auto;
    padding: 2px 8px; gap: 6px; border-radius: var(--radius-sm); border: 1px solid transparent;
    background: var(--bg-alt); color: var(--text); font-size: calc(12px * var(--ui-scale, 1)); font-weight: 500;
  }
  .select-wrap.is-empty :global(.trigger) { background: transparent; color: var(--text-faint); font-style: italic; font-weight: 400; padding-left: 7px; }
  .select-wrap:hover :global(.trigger), .select-wrap :global(.trigger:hover) { border-color: var(--border); }
  .select-wrap :global(.trigger:focus-visible), .select-wrap :global(.trigger[aria-expanded="true"]) { border-color: var(--accent); }
  .select-wrap :global(.trigger svg) { opacity: 0; transition: opacity .12s; }
  .select-wrap:hover :global(.trigger svg), .select-wrap :global(.trigger:focus-visible svg), .select-wrap :global(.trigger[aria-expanded="true"] svg) { opacity: 1; }
  .select-wrap.has-dot :global(.trigger::before) { content: "●"; font-size: .62em; line-height: 1; margin-right: -1px; }
  .select-wrap[data-tone="viridian"] :global(.trigger) { background: color-mix(in srgb, var(--green) 14%, transparent); border-color: color-mix(in srgb, var(--green) 26%, transparent); color: var(--green); }
  .select-wrap[data-tone="cobalt"] :global(.trigger) { background: color-mix(in srgb, var(--accent) 14%, transparent); border-color: color-mix(in srgb, var(--accent) 26%, transparent); color: var(--accent-strong, var(--accent)); }
  .select-wrap[data-tone="ochre"] :global(.trigger) { background: color-mix(in srgb, var(--yellow) 15%, transparent); border-color: color-mix(in srgb, var(--yellow) 28%, transparent); color: var(--yellow); }
  .select-wrap[data-tone="mauve"] :global(.trigger) { background: color-mix(in srgb, var(--purple) 15%, transparent); border-color: color-mix(in srgb, var(--purple) 28%, transparent); color: var(--purple); }
  .select-wrap[data-tone="vermilion"] :global(.trigger) { background: color-mix(in srgb, var(--red) 14%, transparent); border-color: color-mix(in srgb, var(--red) 26%, transparent); color: var(--red); }
  .status-select { position: relative; display: flex; align-items: center; min-width: 0; width: 100%; min-height: calc(26px * var(--ui-scale, 1)); }
  .status-trigger {
    display: inline-flex; align-items: center; gap: 6px; width: fit-content; max-width: 100%; min-height: calc(22px * var(--ui-scale, 1));
    padding: 2px 8px; border-radius: 999px; border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
    background: var(--bg-alt); color: var(--text); font-size: calc(12px * var(--ui-scale, 1)); font-weight: 500;
  }
  .status-trigger.is-empty { background: transparent; border-color: transparent; border-radius: var(--radius-sm); color: var(--text-faint); font-style: italic; font-weight: 400; padding-left: 7px; }
  .status-select:hover .status-trigger, .status-trigger:hover { border-color: var(--border); }
  .status-trigger:focus-visible, .status-trigger[aria-expanded="true"] { outline: none; border-color: var(--accent); }
  .status-trigger .cur { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .status-trigger svg { flex: none; opacity: 0; transition: opacity .12s; }
  .status-select:hover .status-trigger svg, .status-trigger:focus-visible svg, .status-trigger[aria-expanded="true"] svg { opacity: 1; }
  .status-trigger .status-dot, .status-pill .status-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: none; }
  .status-trigger.tone-todo, .status-pill.tone-todo { background: var(--bg-hover); color: var(--text-muted); border-color: var(--border-strong); }
  .status-trigger.tone-progress, .status-pill.tone-progress { background: var(--accent-soft); color: var(--accent); }
  .status-trigger.tone-blocked, .status-pill.tone-blocked { background: var(--red-soft); color: var(--red); }
  .status-trigger.tone-done, .status-pill.tone-done { background: var(--green-soft); color: var(--green); }
  .status-trigger.tone-review, .status-pill.tone-review { background: var(--yellow-soft); color: var(--yellow); }
  .status-trigger.tone-other, .status-pill.tone-other { background: var(--accent-soft); color: var(--text); border-color: var(--border); }
  .status-trigger.tone-other .status-dot, .status-pill.tone-other .status-dot { background: var(--accent); }
  .status-menu {
    position: absolute; z-index: 50; top: calc(100% + 4px); left: 0; min-width: 190px; max-width: 320px; max-height: 280px; overflow: auto;
    padding: 4px; background: var(--bg-elev); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); box-shadow: var(--shadow-pop);
    display: flex; flex-direction: column; gap: 1px;
  }
  .status-sec-lbl { padding: 5px 8px 2px; font-size: calc(10px * var(--ui-scale, 1)); font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--text-faint); }
  .status-opt { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 4px 7px; border-radius: 4px; text-align: left; color: var(--text); font-size: calc(12.5px * var(--ui-scale, 1)); }
  .status-opt.on { background: var(--bg-hover); }
  .status-opt.cur { background: var(--accent-soft); }
  .status-opt.empty-opt { color: var(--text-muted); font-style: italic; }
  .status-pill { display: inline-flex; align-items: center; gap: 6px; height: 21px; padding: 0 8px 0 6px; border-radius: 999px; font-size: .92em; font-weight: 500; line-height: 1; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); }
  .status-note { color: var(--text-faint); font-size: .84em; }
  .check { display: inline-flex; align-items: center; gap: 7px; min-height: calc(26px * var(--ui-scale, 1)); padding: 0 7px; color: var(--text-muted); font-size: calc(12.5px * var(--ui-scale, 1)); cursor: pointer; }
  .check input { accent-color: var(--accent); width: calc(14px * var(--ui-scale, 1)); height: calc(14px * var(--ui-scale, 1)); }
  .rating-row { display: inline-flex; align-items: center; gap: 2px; min-height: calc(26px * var(--ui-scale, 1)); padding: 0 4px; }
  .star-btn { padding: 1px 2px; font-size: 14px; line-height: 1; color: var(--text-faint); transition: color .1s; }
  .star-btn.lit, .star-btn:hover { color: var(--yellow); }
  .auto-id { display: inline-flex; align-items: center; padding: 1px 7px; border-radius: 4px; background: var(--bg-alt); border: 1px solid var(--border); font-family: var(--font-mono); font-size: calc(11.5px * var(--ui-scale, 1)); color: var(--text-muted); }
  .pills { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-height: calc(26px * var(--ui-scale, 1)); padding: 2px 4px; border-radius: var(--radius-sm); border: 1px solid transparent; }
  .pills:hover { border-color: var(--border); }
  .pills:focus-within { border-color: var(--accent); background: var(--bg); }
  .pill { display: inline-flex; align-items: center; max-width: 100%; min-width: 0; border-radius: 5px; background: var(--bg-alt); border: 1px solid var(--border);
    font-size: calc(12px * var(--ui-scale, 1)); line-height: calc(20px * var(--ui-scale, 1)); font-weight: 500; }
  .pill.tag { background: var(--accent-soft); border-color: transparent; color: var(--accent); }
  .pill.pill-viridian { background: color-mix(in srgb, var(--green) 14%, transparent); border-color: color-mix(in srgb, var(--green) 26%, transparent); color: var(--green); }
  .pill.pill-cobalt { background: color-mix(in srgb, var(--accent) 14%, transparent); border-color: color-mix(in srgb, var(--accent) 26%, transparent); color: var(--accent-strong, var(--accent)); }
  .pill.pill-ochre { background: color-mix(in srgb, var(--yellow) 15%, transparent); border-color: color-mix(in srgb, var(--yellow) 28%, transparent); color: var(--yellow); }
  .pill.pill-mauve { background: color-mix(in srgb, var(--purple) 15%, transparent); border-color: color-mix(in srgb, var(--purple) 28%, transparent); color: var(--purple); }
  .pill.pill-vermilion { background: color-mix(in srgb, var(--red) 14%, transparent); border-color: color-mix(in srgb, var(--red) 26%, transparent); color: var(--red); }
  .pill.has-dot::before { content: "●"; font-size: .62em; margin-left: 7px; margin-right: -3px; line-height: 1; }
  .pill-text { padding: 0 2px 0 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; color: inherit; }
  .pill.link .pill-text { color: inherit; }
  .pill .pill-text.opens { color: inherit; cursor: pointer; }
  .pill .pill-text.unfiled { color: var(--red); }
  .text-row { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; min-width: 0; width: 100%; }
  .text-row.has-pigment:not(:focus-within) {
    width: fit-content; max-width: 100%; padding: 1px 8px; border-radius: var(--radius-sm); gap: 6px;
    border: 1px solid transparent;
  }
  .text-row.has-pigment:not(:focus-within) :global(.field) {
    width: auto; field-sizing: content; max-width: 100%; height: calc(22px * var(--ui-scale, 1)); padding: 0; border: 0;
  }
  .text-row[data-tone="viridian"]:not(:focus-within) { background: color-mix(in srgb, var(--green) 14%, transparent); border-color: color-mix(in srgb, var(--green) 26%, transparent); color: var(--green); }
  .text-row[data-tone="viridian"]:not(:focus-within) :global(.field) { color: var(--green); font-weight: 500; }
  .text-row[data-tone="cobalt"]:not(:focus-within) { background: color-mix(in srgb, var(--accent) 14%, transparent); border-color: color-mix(in srgb, var(--accent) 26%, transparent); color: var(--accent-strong, var(--accent)); }
  .text-row[data-tone="cobalt"]:not(:focus-within) :global(.field) { color: var(--accent-strong, var(--accent)); font-weight: 500; }
  .text-row[data-tone="ochre"]:not(:focus-within) { background: color-mix(in srgb, var(--yellow) 15%, transparent); border-color: color-mix(in srgb, var(--yellow) 28%, transparent); color: var(--yellow); }
  .text-row[data-tone="ochre"]:not(:focus-within) :global(.field) { color: var(--yellow); font-weight: 500; }
  .text-row[data-tone="mauve"]:not(:focus-within) { background: color-mix(in srgb, var(--purple) 15%, transparent); border-color: color-mix(in srgb, var(--purple) 28%, transparent); color: var(--purple); }
  .text-row[data-tone="mauve"]:not(:focus-within) :global(.field) { color: var(--purple); font-weight: 500; }
  .text-row[data-tone="vermilion"]:not(:focus-within) { background: color-mix(in srgb, var(--red) 14%, transparent); border-color: color-mix(in srgb, var(--red) 26%, transparent); color: var(--red); }
  .text-row[data-tone="vermilion"]:not(:focus-within) :global(.field) { color: var(--red); font-weight: 500; }
  .status-dot { font-size: .62em; line-height: 1; flex: none; }
  .text-row > :global(:not(.status-dot):first-of-type), .text-row > :global(:first-child:not(.status-dot)) { flex: 1; min-width: 0; }
  .text-row.has-pigment:not(:focus-within) > :global(:not(.status-dot)) { flex: 0 1 auto; }
  .text-row .open { flex: none; width: calc(22px * var(--ui-scale, 1)); height: calc(22px * var(--ui-scale, 1)); color: var(--text-faint); }
  .text-row .open:hover { color: var(--link, var(--accent)); }
  .text-row :global(.field.is-link) { color: var(--link, var(--accent)); }
  .inner-links { flex-basis: 100%; display: flex; flex-wrap: wrap; gap: 2px 8px; padding: 0 7px 3px; min-width: 0; }
  .inner-link { border: 0; background: none; padding: 0; font: inherit; font-size: calc(12px * var(--ui-scale, 1)); color: var(--link, var(--accent)); cursor: pointer;
    max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .inner-link:hover { text-decoration: underline; }
  button.pill-text:hover { text-decoration: underline; }
  .pill-x { display: inline-grid; place-items: center; width: calc(20px * var(--ui-scale, 1)); height: calc(20px * var(--ui-scale, 1)); border-radius: 50%; color: var(--text-faint); flex: none; }
  .pill-x:hover { color: var(--text); background: var(--bg-hover); }
  .pills :global(.pill-input) { flex: 1; min-width: calc(70px * var(--ui-scale, 1)); height: calc(22px * var(--ui-scale, 1)); border: 0; background: transparent; color: var(--text); font: inherit; font-size: calc(12.5px * var(--ui-scale, 1)); padding: 0 4px; }
  .pills :global(.pill-input:focus) { outline: none; }
  .pills :global(.pill-input::placeholder) { color: var(--text-faint); }
</style>
