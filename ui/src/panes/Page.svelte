<script lang="ts">
  import { parse as parseYaml } from "yaml";
  import { errText } from "../lib/text";
  import { listVault } from "../lib/vault";
  import { reloadOnChange } from "../lib/reload-on-change";
  import { below, popMenu, type MenuAt } from "../lib/menu";
  import { shownName, shownPath } from "../lib/paths";
  import { superOf } from "../lib/keys";
  // A `.page` file (docs/guides/PAGES.md): rows and columns of blocks. The file is the source — "Arrange"
  // reshapes it by hand (drag, add, resize, remove; each gesture is one write of the file) and
  // "Edit as text" opens the same YAML in the editor. Saving either way redraws the page at once.
  import { onMount } from "svelte";
  import type { Document } from "yaml";
  import { api, ApiError } from "../lib/api";
  import { closePanel, open, openPath, type PaneProps } from "../lib/dock";
  import { openHome } from "../lib/actions";
  import { getBlock, mountBlock, optionFields } from "../lib/blocks";
  import BlockOptions from "../components/BlockOptions.svelte";
  import { pick } from "../lib/palette.svelte";
  import { app, toast } from "../lib/state.svelte";
  import { isNotionShell } from "../lib/shell-mode.svelte";
  import { isFileStarred, toggleFileStar } from "../lib/bookmarks.svelte";
  import { copyPath, tabs, toggleSidebar } from "../lib/tabs.svelte";
  import {
    parsePage, writePage, readPageProps, setPageProp, blockSrc, newBlock, findBlock, blockAt, insertBlock, insertRow, insertColumn, moveBlock, removeBlock, setWidths,
    type BlockAt, type Drop, type PageBlock, type PageModel,
  } from "../lib/page-doc";
  import ContextMenu from "../components/ContextMenu.svelte";
  import NoteHero from "../components/NoteHero.svelte";
  import PageBlockPicker from "../components/PageBlockPicker.svelte";
  import { pluginMenu } from "../lib/plugin-menus";
  import Icon from "../components/Icon.svelte";
  import { openPageHistory } from "../lib/page-history.svelte";

  let { spec, panel }: PaneProps<"page"> = $props();
  // svelte-ignore state_referenced_locally -- a pane's spec is fixed for its lifetime
  const path = spec.path;

  const page = $state<PageModel>({ rows: [], props: {} });
  let doc: Document | null = null; // the parsed YAML the model came from (comments, other keys)
  let text = ""; // the file as last read or written
  let mtime = $state<number | undefined>(undefined);
  let nowTick = $state(Date.now());
  let error = $state("");
  let arranging = $state(false);
  let undo = $state<string[]>([]);
  let pageRootEl = $state<HTMLDivElement>();
  let showPageProps = $state(false);
  let editingTitle = $state(false);
  let titleDraft = $state("");
  let newPropKey = $state("");
  let newPropVal = $state("");
  let pickerDrop = $state<((b: PageBlock) => void) | null>(null);

  function show(src: string): void {
    const p = parsePage(src);
    doc = p.doc;
    page.title = p.model.title;
    page.icon = p.model.icon;
    page.cover = p.model.cover;
    page.width = p.model.width;
    page.props = p.model.props ?? {};
    page.rows = p.model.rows;
    text = src;
    error = "";
    panel.setTitle(p.model.title || shownName(path));
  }
  let writes = 0; // our own writes started: a reload begun before one of them answers with the older file
  async function load(): Promise<void> {
    const seen = writes;
    try {
      const f = await api.file(path);
      if (seen !== writes) return;
      mtime = f.mtime;
      if (f.text !== text || error) show(f.text); // our own write comes back unchanged: keep the blocks
    } catch (e) { error = errText(e); }
  }

  /** Write the model to the file (one gesture = one write); `keep` puts the old text on the undo stack. */
  async function save(next = doc ? writePage($state.snapshot(page) as PageModel, doc) : text, keep = true): Promise<void> {
    if (next === text) return;
    const before = text;
    text = next;
    writes++;
    try {
      mtime = (await api.putFile(path, next, mtime)).mtime;
      if (keep) undo = [...undo.slice(-30), before];
    } catch (e) {
      text = before;
      toast("The page was not saved", e instanceof ApiError && e.status === 409 ? "It changed on disk meanwhile — reloaded." : errText(e), "error");
      text = ""; // force the reload to redraw from the file
      await load();
    }
  }
  async function undoLast(): Promise<void> {
    const prev = undo.at(-1);
    if (prev === undefined) return;
    undo = undo.slice(0, -1);
    await save(prev, false);
    show(prev);
  }

  // --- drawing --------------------------------------------------------------------------------------
  function draw(el: HTMLElement, src: string) {
    return { destroy: mountBlock(el, path, src, "page") }; // on close / change only — a hidden tab keeps its blocks
  }
  const carded = (b: PageBlock) => !!b.title || !!getBlock(b.type)?.card;
  const label = (b: PageBlock) => b.title ?? getBlock(b.type)?.title ?? b.type;
  // two columns keep the proportions of the old Today screen unless the file says otherwise
  const cols = (r: PageModel["rows"][number]) => (r.widths ?? (r.columns.length === 2 ? [1.25, 1] : r.columns.map(() => 1))).map((w) => `minmax(0, ${w}fr)`).join(" ");

  function openVisualPicker(placeFn: (b: PageBlock) => void): void {
    pickerDrop = placeFn;
  }

  function applyPickerYaml(yamlSrc: string): void {
    const placeFn = pickerDrop;
    pickerDrop = null;
    if (!placeFn) return;
    let parsed: unknown;
    try {
      parsed = parseYaml(yamlSrc);
    } catch {
      return;
    }
    const obj = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    const { view: rawView, ...opts } = obj;
    const viewType = typeof rawView === "string" && rawView.trim() ? rawView.trim() : "text";
    const blkDef = getBlock(viewType);
    if (blkDef?.file && !opts.path) {
      setTimeout(() => pickFile(blkDef.file!, (p) => { placeFn(newBlock(viewType, { ...opts, path: p })); void save(); }), 0);
    } else {
      placeFn(newBlock(viewType, opts));
      void save();
    }
  }
  function pickFile(match: RegExp | true, then: (path: string) => void): void {
    pick({
      placeholder: "Which file…", tag: "File", icon: "file",
      items: async () => (await listVault()).filter((p) => match === true || match.test(p)).map((p) => ({ value: p, title: shownName(p), detail: shownPath(p) })),
      onpick: then,
    });
  }

  // --- arranging: move (drag, or the block's menu for the keyboard) -------------------------------
  let dragging = $state<number | null>(null);
  let over = $state("");
  function dragStart(e: DragEvent, b: PageBlock): void {
    dragging = b.id;
    e.dataTransfer?.setData("text/plain", String(b.id));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }
  const dragEnd = () => { dragging = null; over = ""; };
  function slotOver(e: DragEvent, key: string): void {
    if (dragging === null) return;
    e.preventDefault();
    over = key;
  }
  function drop(e: DragEvent, to: Drop): void {
    if (dragging === null) return;
    e.preventDefault();
    moveBlock(page, dragging, to);
    dragEnd();
    void save();
  }
  /** A slot: where a dragged block lands, and a "+" that adds one there. */
  const place = (to: Drop) => (b: PageBlock) => {
    if (to.kind === "at") insertBlock(page, to.at, b);
    else if (to.kind === "row") insertRow(page, to.row, b);
    else insertColumn(page, to.row, b);
  };

  // --- arranging: a block's menu ------------------------------------------------------------------------
  let menu = $state<MenuAt | null>(null);
  // the block whose options form is open, and where it stood: a reload meanwhile re-parses the page into new blocks
  let editing = $state<{ block: PageBlock; at: BlockAt } | null>(null);
  /** `b` if it is still in the page, else the block of its type at its old place (the file was reloaded meanwhile). */
  function current(b: PageBlock, at: BlockAt): PageBlock | undefined {
    if (findBlock(page, b.id)) return b;
    const there = blockAt(page, at);
    return there?.type === b.type ? there : undefined;
  }
  function ask(placeholder: string, tag: string, then: (v: string) => void, clear?: string): void {
    pick({ placeholder, tag, icon: "edit", items: clear ? [{ value: "", title: clear }] : [], typed: (t) => `Use “${t}”`, typedAs: { section: "", icon: "edit" }, onpick: then });
  }
  function blockMenu(e: MouseEvent, b: PageBlock): void {
    const at = findBlock(page, b.id);
    if (!at) return;
    const here = page.rows[at.row].columns[at.col];
    const edit = (f: () => void) => () => { f(); void save(); };
    menu = below(e, [
      { label: "Title…", icon: "edit" as const, run: () => ask("Title of this block", "Title", (v) => { b.title = v.trim() || undefined; void save(); }, "No title") },
      ...(optionFields(b.type).length ? [{ label: "Options…", icon: "settings" as const, run: () => { editing = { block: b, at }; } }] : []),
      ...(getBlock(b.type)?.height ? [{ label: "Height…", run: () => ask("Height in pixels (e.g. 360)", "Height", (v) => { const n = Number(v); if (n >= 120) b.options.height = Math.round(n); else delete b.options.height; void save(); }, "Default height") }] : []),
      "sep",
      ...(at.index > 0 ? [{ label: "Move up", icon: "arrow-up" as const, run: edit(() => moveBlock(page, b.id, { kind: "at", at: { ...at, index: at.index - 1 } })) }] : []),
      ...(at.index < here.length - 1 ? [{ label: "Move down", icon: "arrow-down" as const, run: edit(() => moveBlock(page, b.id, { kind: "at", at: { ...at, index: at.index + 2 } })) }] : []),
      { label: "Move to a new column", icon: "panel-right" as const, run: edit(() => moveBlock(page, b.id, { kind: "column", row: at.row })) },
      { label: "Move to its own row", icon: "panel-bottom" as const, run: edit(() => moveBlock(page, b.id, { kind: "row", row: at.row + 1 })) },
      { label: "Duplicate", icon: "copy" as const, run: edit(() => insertBlock(page, { ...at, index: at.index + 1 }, newBlock(b.type, { ...$state.snapshot(b.options) }, b.title))) },
      "sep",
      { label: "Remove", icon: "close" as const, danger: true, run: () => { removeBlock(page, b.id); void save().then(() => toast("Block removed", "Undo brings it back (Ctrl+Z while arranging)")); } },
      ...pluginMenu("block", { type: b.type, note: path }),
    ], 4);
  }

  // --- arranging: column widths ---------------------------------------------------------------------------
  function resizeColumns(e: PointerEvent, row: number, col: number): void {
    e.preventDefault();
    const r = page.rows[row];
    const grid = (e.currentTarget as HTMLElement).closest<HTMLElement>(".row")!;
    const start = r.widths ?? (r.columns.length === 2 ? [1.25, 1] : r.columns.map(() => 1));
    const perPx = start.reduce((a, b) => a + b, 0) / grid.clientWidth;
    const x0 = e.clientX;
    document.body.classList.add("kandinsky-resizing"); // no text selection while dragging
    const move = (ev: PointerEvent) => {
      // neither side below a quarter share
      const d = Math.min(Math.max((ev.clientX - x0) * perPx, 0.25 - start[col]), start[col + 1] - 0.25);
      setWidths(page, row, start.map((w, i) => (i === col ? w + d : i === col + 1 ? w - d : w)));
    };
    const up = () => {
      document.body.classList.remove("kandinsky-resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      void save();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const starred = $derived(isFileStarred(path));
  const pathSegments = $derived(path.split("/"));
  const folderSegments = $derived(path.startsWith(".kandinsky/") ? [] : pathSegments.slice(0, -1));
  const pageTitle = $derived(page.title || shownName(path));
  const pageProps = $derived(page.props ?? null);
  const isFullWidth = $derived(pageProps?.width === "full");
  const rawIcon = $derived(typeof pageProps?.icon === "string" ? pageProps.icon.trim() : "");
  const emblemGlyph = $derived(rawIcon.toLowerCase() === "none" ? "" : rawIcon || (isNotionShell() ? "◎" : ""));
  const editedLabel = $derived.by(() => {
    if (!mtime) return "";
    const diffSec = Math.max(0, Math.floor((nowTick - mtime) / 1000));
    if (diffSec < 120) return "Edited just now";
    if (diffSec < 3600) return `Edited ${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `Edited ${Math.floor(diffSec / 3600)}h ago`;
    const days = Math.floor(diffSec / 86400);
    if (days < 7) return `Edited ${days}d ago`;
    return `Edited ${new Date(mtime).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  });

  async function writePageMeta(key: string, value: unknown | null): Promise<void> {
    if (!doc) return;
    const next = setPageProp(doc, key, value);
    const refreshed = readPageProps(doc);
    page.props = refreshed;
    page.title = typeof refreshed.title === "string" ? refreshed.title : undefined;
    page.icon = typeof refreshed.icon === "string" ? refreshed.icon : undefined;
    page.cover = typeof refreshed.cover === "string" ? refreshed.cover : undefined;
    page.width = typeof refreshed.width === "string" ? refreshed.width : undefined;
    panel.setTitle(page.title || shownName(path));
    await save(next);
  }

  function togglePageFullWidth(): void {
    void writePageMeta("width", isFullWidth ? null : "full");
  }

  function triggerEmblemPicker(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const btn = e.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    (pageRootEl ?? btn).dispatchEvent(
      new CustomEvent("kandinsky-icon-picker", {
        bubbles: true,
        detail: { x: rect.left, y: rect.bottom + 6, el: btn },
      }),
    );
  }

  function focusInput(el: HTMLInputElement) {
    el.focus();
    el.select();
  }

  function startTitleEdit(): void {
    titleDraft = pageTitle;
    editingTitle = true;
  }

  function commitTitleEdit(): void {
    if (!editingTitle) return;
    editingTitle = false;
    const trimmed = titleDraft.trim();
    if (!trimmed) {
      if (page.title) void writePageMeta("title", null);
      return;
    }
    if (trimmed !== pageTitle) void writePageMeta("title", trimmed);
  }

  const propDisplay = (v: unknown): string =>
    Array.isArray(v) ? v.map(String).join(", ") : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "");

  function parsePropInput(key: string, raw: string, prev?: unknown): unknown | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (Array.isArray(prev) || key === "tags") return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    return trimmed;
  }

  function submitNewProp(e: SubmitEvent): void {
    e.preventDefault();
    const k = newPropKey.trim();
    if (!k || k === "rows") return;
    const val = parsePropInput(k, newPropVal);
    if (val === null) return;
    newPropKey = "";
    newPropVal = "";
    void writePageMeta(k, val);
  }

  async function copyText(val: string, msg: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(val);
      toast(msg, shownName(path));
    } catch {
      toast("Could not copy to clipboard", "", "error");
    }
  }

  async function trashThisPage(): Promise<void> {
    try {
      const res = await api.trash(path);
      const undoAct = res.to.startsWith(".kandinsky/")
        ? [{ label: "Undo", run: () => void api.move(res.to, path).then(() => openPath(path)) }]
        : undefined;
      toast("Moved to Trash", `${shownPath(path)} → ${res.to}`, "info", 7000, undoAct);
      await closePanel(panel);
    } catch (e) {
      toast(`Could not move ${shownPath(path)} to Trash`, errText(e), "error");
    }
  }

  function showPageHistory(): void {
    openPageHistory(path, (res) => {
      mtime = res.mtime;
      show(res.text);
    });
  }

  function openPageActions(e: MouseEvent): void {
    popMenu(
      below(e, [
        { label: "Zen mode (distraction-free)", hint: "F11", icon: "maximize", run: () => { window.dispatchEvent(new CustomEvent("kandinsky:toggle-zen")); } },
        { label: isFullWidth ? "Standard width" : "Full width page", icon: "maximize", run: togglePageFullWidth },
        { label: showPageProps ? "Hide properties" : "Properties", icon: "table", run: () => { showPageProps = !showPageProps; } },
        { label: arranging ? "Finish arranging" : "Arrange blocks", icon: arranging ? "check" : "edit", run: () => { arranging = !arranging; } },
        { label: "Version history & restore…", icon: "clock", run: showPageHistory },
        { label: "Open Git repository pane", icon: "git", run: () => open({ kind: "git" }) },
        { label: "Edit page source", icon: "file-code", run: () => open({ kind: "editor", path }) },
        { label: "Copy file path", icon: "file-text", run: () => void copyPath(path) },
        "sep",
        { label: "Move page to Trash", icon: "trash", danger: true, run: () => void trashThisPage() },
      ], 4),
    );
  }

  function openShareMenu(e: MouseEvent): void {
    popMenu(
      below(e, [
        { label: "Copy page source", icon: "copy", run: () => void copyText(text, "Page source copied") },
        { label: "Copy [[wikilink]]", icon: "link", run: () => void copyText(`[[${shownName(path)}]]`, "Wikilink copied") },
        { label: "Copy file path", icon: "file-text", run: () => void copyPath(path) },
        { label: "Export / Print…", icon: "external-link", run: () => window.print() },
      ], 4),
    );
  }

  function onKey(e: KeyboardEvent): void {
    if (!arranging) return;
    if (e.key === "Escape") { arranging = false; e.stopPropagation(); }
    else if ((e.ctrlKey || superOf(e)) && e.key.toLowerCase() === "z") { e.preventDefault(); e.stopPropagation(); void undoLast(); }
  }

  onMount(() => {
    const tickInterval = setInterval(() => { nowTick = Date.now(); }, 30_000);
    void load();
    const offReload = reloadOnChange(() => void load(), { wait: 150, wants: (p) => p === path });
    return () => {
      clearInterval(tickInterval);
      offReload();
    };
  });
</script>

{#snippet slot(to: Drop, key: string, kind: "between" | "row" | "column")}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="drop {kind}" data-slot={key} class:over={over === key} ondragover={(e) => slotOver(e, key)} ondragleave={() => { if (over === key) over = ""; }} ondrop={(e) => drop(e, to)}>
      <button type="button" class="add" onclick={() => openVisualPicker(place(to))} aria-label={kind === "column" ? "Add a block in a new column" : kind === "row" ? "Add a block in a new row" : "Add a block here"}
      title={kind === "column" ? "Add a column" : "Add a block"}><Icon name="plus" size={13} /></button>
  </div>
{/snippet}

{#snippet block(b: PageBlock)}
  <div class="pb" class:card={carded(b)} class:moving={dragging === b.id} data-block={b.type}>
    {#if arranging}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="bar" draggable="true" ondragstart={(e) => dragStart(e, b)} ondragend={dragEnd} title="Drag to move">
        <span class="grip" aria-hidden="true">⠿</span><span class="name">{label(b)}</span>
        <button class="icon-btn" onclick={(e) => blockMenu(e, b)} aria-label="Block menu: {label(b)}" title="Title, height, move, duplicate, remove…"><Icon name="chevron-down" size={14} /></button>
      </div>
    {/if}
    {#if b.title && !arranging}<h2>{b.title}</h2>{/if}
    {#key blockSrc(b)}<div class="content" inert={arranging} use:draw={blockSrc(b)}></div>{/key}
  </div>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="page-pane" bind:this={pageRootEl} onkeydown={onKey}>
  <header class="topbar" aria-label="Page header">
    <div class="breadcrumbs">
      {#if isNotionShell() && tabs.sidebar.collapsed}
        <button type="button" class="icon-btn expand-sb" onclick={toggleSidebar} title="Expand sidebar (Super+S)" aria-label="Expand sidebar">
          <Icon name="panel-left" size={15} />
        </button>
      {/if}
      <button type="button" class="seg vault" onclick={() => void openHome()} title="Open vault Home">
        {app.workspace?.name ?? "Workspace"}
      </button>
      <span class="sep">›</span>
      {#if folderSegments.length > 0}
        <span class="folder-trail">
          {#each folderSegments as seg, i}
            {#if i > 0}<span class="sub-sep">/</span>{/if}
            <button type="button" class="seg" title="Show {folderSegments.slice(0, i + 1).join('/')} in the explorer"
              onclick={() => open({ kind: "explorer", source: "vault", place: "", path: folderSegments.slice(0, i + 1).join("/"), select: pathSegments[i + 1] })}>{seg}</button>
          {/each}
        </span>
        <span class="sep">›</span>
      {/if}
      <strong class="doc-crumb" dir="auto">{pageTitle}</strong>
    </div>
    <div class="top-actions">
      {#if editedLabel}<span class="edited-lbl">{editedLabel}</span>{/if}
      {#if arranging}
        <button type="button" class="tool" onclick={undoLast} disabled={!undo.length} title="Undo the last change (Ctrl+Z)"><Icon name="undo" size={13} /> Undo</button>
        <button type="button" class="tool primary" onclick={() => (arranging = false)} title="Finish arranging (Esc)"><Icon name="check" size={13} /> Done</button>
      {:else}
        <button type="button" class="tool" onclick={() => openVisualPicker((b) => insertRow(page, page.rows.length, b))} title="Add a dashboard block"><Icon name="plus" size={13} /> Add block</button>
        <button type="button" class="tool" onclick={() => (arranging = true)} title="Rearrange blocks and columns"><Icon name="sliders" size={13} /> Layout</button>
      {/if}
      <button type="button" class="icon-btn star-icon" class:starred={starred}
        aria-label={starred ? "Remove from Favorites" : "Add to Favorites"}
        title={starred ? "Remove from Favorites" : "Add to Favorites"}
        onclick={() => toggleFileStar(path, pageTitle)}>
        {starred ? "★" : "☆"}
      </button>
      <button type="button" class="top-pill" onclick={openShareMenu} title="Copy or export page">Share</button>
      <button type="button" class="top-more" aria-label="Page actions" title="Page actions" onclick={openPageActions}>···</button>
    </div>
  </header>

  <div class="page scroll" class:arranging>
    {#if !error}
      <NoteHero
        {path}
        noteProps={pageProps}
        view={() => null}
        emblemHost={() => pageRootEl ?? null}
        pageLayout={true}
        {isFullWidth}
        onWriteProp={writePageMeta}
        onToggleWidth={togglePageFullWidth}
        onToggleProperties={() => (showPageProps = !showPageProps)}
      />
    {/if}
    <div class="inner" class:full-width={isFullWidth}>
      {#if error}
        <section class="pb card err"><strong>{shownPath(path)} could not be read.</strong><pre>{error}</pre>
          <button class="link" onclick={() => open({ kind: "editor", path })}>Open it to fix it</button></section>
      {:else}
        <div class="page-head">
          {#if emblemGlyph}
            <button type="button" class="page-emblem" onmousedown={(e) => e.preventDefault()} onclick={triggerEmblemPicker}
              title="Change page icon" aria-label="Change page icon">{emblemGlyph}</button>
          {/if}
          {#if editingTitle}
            <input type="text" class="page-title-input" dir="auto" use:focusInput bind:value={titleDraft}
              aria-label="Page title" onblur={commitTitleEdit}
              onkeydown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") { e.preventDefault(); commitTitleEdit(); }
                else if (e.key === "Escape") { e.preventDefault(); editingTitle = false; }
              }} />
          {:else}
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events -->
            <h1 class="page-title" dir="auto" title="Click to rename page title" onclick={startTitleEdit}>{pageTitle}</h1>
          {/if}
        </div>

        {#if showPageProps}
          <section class="page-props-card" aria-label="Page properties">
            <div class="props-head">
              <span>Page Properties</span>
              <button type="button" class="props-close" onclick={() => (showPageProps = false)} aria-label="Close properties" title="Hide properties">×</button>
            </div>
            <div class="props-list">
              {#each Object.entries(pageProps ?? {}) as [k, v] (k)}
                <div class="prop-row">
                  <span class="prop-k">{k}</span>
                  <input type="text" class="prop-v" value={propDisplay(v)} aria-label="Property {k}"
                    onchange={(e) => void writePageMeta(k, parsePropInput(k, (e.currentTarget as HTMLInputElement).value, v))}
                    onkeydown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }} />
                  <button type="button" class="prop-del" onclick={() => void writePageMeta(k, null)} title="Remove {k}" aria-label="Remove {k}">×</button>
                </div>
              {:else}
                <p class="props-empty">No top-level metadata keys yet (e.g. <code>title</code>, <code>icon</code>, <code>cover</code>, <code>width</code>).</p>
              {/each}
            </div>
            <form class="prop-add" onsubmit={submitNewProp}>
              <input type="text" class="prop-add-k" placeholder="Property key…" aria-label="New property key" bind:value={newPropKey} />
              <input type="text" class="prop-add-v" placeholder="Value…" aria-label="New property value" bind:value={newPropVal} />
              <button type="submit" class="prop-add-btn">+ Add property</button>
            </form>
          </section>
        {/if}

        {#each page.rows as row, i (i)}
          {#if arranging}{@render slot({ kind: "row", row: i }, `r${i}`, "row")}{/if}
          <div class="row" style:grid-template-columns={cols(row)}>
            {#each row.columns as col, j (j)}
              <div class="col">
                {#each col as b, k (b.id)}
                  {#if arranging}{@render slot({ kind: "at", at: { row: i, col: j, index: k } }, `b${i}.${j}.${k}`, "between")}{/if}
                  {@render block(b)}
                {/each}
                {#if arranging}
                  {@render slot({ kind: "at", at: { row: i, col: j, index: col.length } }, `b${i}.${j}.end`, "between")}
                  {#if j < row.columns.length - 1}
                    <div class="col-resize" role="separator" aria-orientation="vertical" aria-label="Resize columns" onpointerdown={(e) => resizeColumns(e, i, j)}></div>
                  {/if}
                {/if}
              </div>
            {/each}
            {#if arranging}{@render slot({ kind: "column", row: i }, `c${i}`, "column")}{/if}
          </div>
        {/each}
        {#if arranging}{@render slot({ kind: "row", row: page.rows.length }, "rend", "row")}{/if}
        {#if !page.rows.length && !arranging}
          <section class="pb card empty">
            <strong>This dashboard is ready.</strong>
            <button class="link" onclick={() => openVisualPicker((b) => insertRow(page, 0, b))}>+ Add your first block</button>
          </section>
        {/if}
      {/if}
    </div>
  </div>
</div>
{#if pickerDrop}
  <PageBlockPicker onpick={applyPickerYaml} onclose={() => (pickerDrop = null)} />
{/if}
{#if menu}<ContextMenu x={menu.x} y={menu.y} items={menu.items} onclose={() => (menu = null)} />{/if}
{#if editing}
  {@const { block: b, at } = editing}
  <BlockOptions title={label(b)} fields={optionFields(b.type)} options={$state.snapshot(b.options)} oncancel={() => (editing = null)}
    onsave={(o) => { const cur = current(b, at); editing = null; if (!cur) return toast("The block moved meanwhile", "Its options were not saved.", "error"); cur.options = o; void save(); }} />
{/if}

<style>
  .page-pane { height: 100%; display: flex; flex-direction: column; background: var(--bg); }
  .topbar {
    flex: none; height: 40px; padding: 0 20px; display: flex; align-items: center; justify-content: space-between;
    gap: 12px; font-size: calc(12.5px * var(--ui-scale, 1)); color: var(--text-muted);
    border-bottom: 1px solid var(--border); background: var(--bg); white-space: nowrap;
  }
  .breadcrumbs { display: flex; align-items: center; gap: 5px; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .expand-sb { width: 26px; height: 26px; display: grid; place-items: center; border-radius: 5px; color: var(--text-muted); flex: none; margin-right: 2px; }
  .expand-sb:hover { background: var(--bg-hover); color: var(--text); }
  .breadcrumbs .seg { padding: 2px 5px; border-radius: 4px; color: var(--text-muted); font: inherit; }
  .breadcrumbs button.seg:hover { background: var(--bg-hover); color: var(--text); }
  .breadcrumbs .folder-trail { display: inline-flex; align-items: center; gap: 1px; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .breadcrumbs .sub-sep { color: var(--text-faint); padding: 0 1px; }
  .breadcrumbs .sep { color: var(--text-faint); opacity: .75; }
  .breadcrumbs .doc-crumb { color: var(--heading); font-weight: 500; overflow: hidden; text-overflow: ellipsis; padding: 0 2px; }

  .top-actions { display: inline-flex; align-items: center; gap: 8px; flex: none; font-size: calc(12px * var(--ui-scale, 1)); color: var(--text-faint); }
  .edited-lbl { color: var(--text-faint); margin-right: 2px; }
  .top-pill { padding: 3px 8px; border-radius: 5px; border: 1px solid var(--border); background: transparent; color: var(--text-muted); font: inherit; cursor: pointer; transition: background 120ms, color 120ms, border-color 120ms; }
  .top-pill:hover { background: var(--bg-hover); color: var(--text); border-color: var(--border-strong); }
  .star-pill.starred { color: var(--yellow); background: color-mix(in srgb, var(--yellow) 11%, transparent); border-color: color-mix(in srgb, var(--yellow) 36%, var(--border)); font-weight: 500; }
  .top-link, .top-more { padding: 3px 5px; border-radius: 5px; color: var(--text-muted); font: inherit; cursor: pointer; transition: background 120ms, color 120ms; }
  .top-link:hover, .top-more:hover { background: var(--bg-hover); color: var(--text); }
  .top-more { font-weight: 600; letter-spacing: 0.06em; padding: 3px 6px; }
  .trash-btn { width: 26px; height: 26px; display: grid; place-items: center; border-radius: 5px; color: var(--text-faint); transition: background 120ms, color 120ms; }
  .trash-btn:hover { background: color-mix(in srgb, var(--red) 12%, transparent); color: var(--red); }

  @media (max-width: 920px) {
    .edited-lbl, .edit-txt-btn { display: none; }
    .topbar { padding: 0 12px; }
    .top-actions { gap: 6px; }
  }

  .page { flex: 1; min-height: 0; overflow: auto; background: var(--bg); container-type: inline-size; }
  .inner { max-width: 1080px; margin: 0 auto; padding: 8px 36px 64px; position: relative; }
  .inner.full-width { max-width: none; }

  .page-head { display: flex; align-items: center; gap: 12px; margin: 0 0 18px; min-width: 0; }
  .page-head .page-emblem { margin-right: 0; }
  .page-title {
    font-size: calc(28px * var(--ui-scale, 1)); font-weight: 700; letter-spacing: -0.026em; line-height: 1.2;
    color: var(--heading, var(--text)); margin: 0; padding: 2px 4px; margin-left: -4px; border-radius: 5px;
    cursor: text; min-width: 0; overflow-wrap: anywhere;
  }
  .page-title:hover { background: var(--bg-hover); }
  .page-title-input {
    flex: 1; min-width: 0; font-family: inherit; font-size: calc(28px * var(--ui-scale, 1)); font-weight: 700;
    letter-spacing: -0.026em; line-height: 1.2; color: var(--heading, var(--text)); background: var(--bg-hover);
    border: 0; border-radius: 5px; padding: 2px 6px; margin-left: -6px; outline: none; box-shadow: inset 0 -2px 0 var(--accent);
  }

  .page-props-card {
    margin: 0 0 20px; padding: 10px 14px; border-radius: var(--radius-lg);
    background: var(--bg-alt); border: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px;
  }
  .props-head { display: flex; align-items: center; justify-content: space-between; font-size: calc(11.5px * var(--ui-scale, 1)); font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--text-muted); }
  .props-close, .prop-del { width: 22px; height: 22px; display: grid; place-items: center; border-radius: 4px; color: var(--text-faint); font-size: 14px; cursor: pointer; }
  .props-close:hover, .prop-del:hover { background: var(--bg-hover); color: var(--text); }
  .props-list { display: flex; flex-direction: column; gap: 4px; }
  .prop-row { display: grid; grid-template-columns: 120px 1fr 22px; gap: 8px; align-items: center; }
  .prop-k { font-family: var(--font-mono); font-size: calc(12px * var(--ui-scale, 1)); color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .prop-v { min-width: 0; padding: 3px 7px; border-radius: 4px; border: 1px solid transparent; background: transparent; color: var(--text); font: inherit; font-size: calc(12.5px * var(--ui-scale, 1)); outline: none; }
  .prop-v:hover { border-color: var(--border); background: var(--bg); }
  .prop-v:focus { border-color: var(--accent); background: var(--bg); }
  .props-empty { margin: 0; font-size: calc(12px * var(--ui-scale, 1)); color: var(--text-faint); }
  .prop-add { display: flex; align-items: center; gap: 6px; padding-top: 6px; border-top: 1px solid var(--border); flex-wrap: wrap; }
  .prop-add-k { width: 120px; padding: 4px 7px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font-family: var(--font-mono); font-size: calc(12px * var(--ui-scale, 1)); outline: none; }
  .prop-add-v { flex: 1; min-width: 140px; padding: 4px 7px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font: inherit; font-size: calc(12px * var(--ui-scale, 1)); outline: none; }
  .prop-add-k:focus, .prop-add-v:focus { border-color: var(--accent); }
  .prop-add-btn { padding: 4px 10px; border-radius: 5px; border: 1px solid var(--border-strong); background: var(--bg-elev); color: var(--text); font: inherit; font-size: calc(12px * var(--ui-scale, 1)); cursor: pointer; }
  .prop-add-btn:hover { border-color: var(--accent); color: var(--accent); }

  .row { display: grid; gap: 16px; align-items: start; margin-bottom: 16px; position: relative; }
  .col { display: flex; flex-direction: column; gap: 16px; min-width: 0; position: relative; }
  @container (max-width: 760px) { .row { grid-template-columns: 1fr !important; } .inner { padding: 8px 18px 48px; } }
  .pb { min-width: 0; position: relative; }
  .pb.card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: var(--radius-lg); padding: 16px 18px; }
  .pb h2 { font-size: calc(12px * var(--ui-scale, 1)); font-weight: 600; text-transform: uppercase; letter-spacing: .07em; color: var(--text-muted); margin: 0 0 8px; }
  .pb[data-block="base"] { padding: 10px; }
  .content { min-width: 0; }
  /* a Today part draws its own card */
  .content :global(.today.part .card) { margin: 0; }
  .err pre { white-space: pre-wrap; color: var(--red); font-size: .9em; }
  .empty { color: var(--text-muted); }

  .tool { display: inline-flex; gap: 5px; align-items: center; min-height: 24px; color: var(--text-muted); font-size: calc(12px * var(--ui-scale, 1)); padding: 2px 8px; border-radius: 6px; cursor: pointer; }
  .tool:hover:not(:disabled) { color: var(--text); background: var(--bg-hover); }
  .tool:disabled { opacity: .45; }
  .tool.primary { color: var(--accent-fg); background: var(--accent); }
  .tool.primary:hover { background: var(--accent-strong); color: var(--accent-fg); }

  /* arranging: every block is an object you hold by its bar; its content rests */
  .arranging .pb { outline: 1px dashed var(--border-strong); outline-offset: 3px; border-radius: var(--radius-lg); }
  .arranging .content { opacity: .82; }
  .pb.moving { opacity: .35; }
  .bar { display: flex; align-items: center; gap: 6px; height: 26px; margin: 0 0 6px; padding: 0 4px 0 8px; border-radius: 7px; cursor: grab; user-select: none;
    background: var(--bg-elev); border: 1px solid var(--border); color: var(--text-muted); font-size: calc(12px * var(--ui-scale, 1)); }
  .bar:active { cursor: grabbing; }
  .bar .grip { color: var(--text-faint); }
  .bar .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* a slot: thin until the pointer or a dragged block is on it */
  .drop { display: grid; place-items: center; border-radius: 6px; transition: background .12s; }
  .drop.between { height: 14px; margin: -8px 0; }
  .drop.row { height: 16px; margin: -8px 0 8px; }
  .drop.column { position: absolute; top: 0; bottom: 0; right: -30px; width: 22px; }
  .drop .add { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 50%; color: var(--text-muted); background: var(--bg-elev); border: 1px solid var(--border-strong);
    opacity: 0; transition: opacity .12s; position: relative; z-index: 4; }
  .drop:hover .add, .drop .add:focus-visible { opacity: 1; }
  .drop .add:hover { color: var(--accent); border-color: var(--accent); }
  .drop.over { background: var(--accent-sel); outline: 1px solid var(--accent); }
  .col-resize { position: absolute; top: 0; bottom: 0; right: -12px; width: 8px; cursor: col-resize; border-radius: 4px; z-index: 3; }
  .col-resize:hover { background: var(--accent-sel); }
  @media (prefers-reduced-motion: reduce) { .drop, .drop .add { transition: none; } }
</style>
