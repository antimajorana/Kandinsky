<script lang="ts">
  // Interactive Obsidian `.canvas` (JSON Canvas 1.0) whiteboard pane — Bauhaus Several Circles palette.
  import { onMount, tick } from "svelte";
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
  import Icon from "../components/Icon.svelte";
  import { api, ApiError } from "../lib/api";
  import { on, touches } from "../lib/bus";
  import {
    anchorPoint, applyInlineEdit, bezierPath, CANVAS_PRESET_COLORS, canvasBounds, canvasId, edgeGeometry,
    makeMediaNode, nearestSide, nodesInsideGroup, parseCanvas, resolveCanvasColor, serializeCanvas, SIDES, snapGrid,
    type CanvasDoc, type CanvasGroupNode, type CanvasNode, type Side,
  } from "../lib/canvas-model";
  import { open, openPath, setDirty, type PaneProps } from "../lib/dock";
  import { superOf } from "../lib/keys";
  import { renderMarkdown, stripFrontmatter } from "../lib/markdown";
  import { pick } from "../lib/palette.svelte";
  import { fileIcon } from "../lib/panes";
  import { dirOf, IMAGE_RE, shownName } from "../lib/paths";
  import { blobUrl, hydrateImages } from "../lib/raw";
  import { keepRecovery, recoveryPath } from "../lib/recovery";
  import { paneFocus, paneParks } from "../lib/registry";
  import { errText } from "../lib/text";
  import { listVault, resolveOrBeside } from "../lib/vault";
  import { openOutside, openWeb } from "../lib/web-links";

  let { spec, panel }: PaneProps<"canvas"> = $props();
  const markerId = `ca-${canvasId().slice(0, 8)}`, MAX_HISTORY = 40;
  let paneEl = $state<HTMLDivElement>(), stageEl = $state<HTMLDivElement>();
  let doc = $state<CanvasDoc>({ nodes: [], edges: [] });
  let baseMtime: number | undefined, original = "", saving: Promise<void> | null = null, saveTimer = 0;
  let dirty = $state(false), conflict = $state(false), error = $state("");
  let panX = $state(120), panY = $state(80), zoom = $state(1), spaceHeld = $state(false);
  const selectedNodes = new SvelteSet<string>();
  let selectedEdgeId = $state<string | null>(null);
  let edit = $state<{ kind: "text" | "group" | "edge"; id: string; value: string } | null>(null);
  let undoStack = $state<string[]>([]), redoStack = $state<string[]>([]);
  const noteCache = new SvelteMap<string, string>(), blobCache = new SvelteMap<string, string>();

  type DragState =
    | { kind: "pan"; sx: number; sy: number; ox: number; oy: number; moved: boolean; clearOnClick: boolean }
    | { kind: "marquee"; x0: number; y0: number; x1: number; y1: number }
    | { kind: "move"; sx: number; sy: number; origins: Map<string, { x: number; y: number }>; recorded: boolean }
    | { kind: "resize"; id: string; handle: "se" | "e" | "s"; sx: number; sy: number; ow: number; oh: number; recorded: boolean }
    | { kind: "wire"; fromNode: string; fromSide: Side; x1: number; y1: number; x2: number; y2: number; toNode: string | null; toSide: Side | null };
  let drag = $state<DragState | null>(null);

  const byId = $derived(new Map(doc.nodes.map((n) => [n.id, n])));
  const groups = $derived(doc.nodes.filter((n): n is CanvasGroupNode => n.type === "group"));
  const cards = $derived(doc.nodes.filter((n) => n.type !== "group"));
  const hasSelection = $derived(selectedNodes.size > 0 || selectedEdgeId !== null);
  const activeColor = $derived(selectedEdgeId
    ? (doc.edges.find((e) => e.id === selectedEdgeId)?.color ?? "")
    : selectedNodes.size === 1 ? (byId.get([...selectedNodes][0])?.color ?? "") : "");
  const isMd = (p: string): boolean => /\.(md|markdown|txt)$/i.test(p);
  const domainOf = (u: string): string => { try { return new URL(u).hostname.replace(/^www\./, "") || u; } catch { return u; } };

  $effect(() => { setDirty(panel.id, dirty); });
  $effect(() => {
    for (const n of doc.nodes) {
      if (n.type === "file" && n.file) {
        if (IMAGE_RE.test(n.file) && !blobCache.has(n.file)) {
          blobCache.set(n.file, ""); void blobUrl(n.file).then((u) => blobCache.set(n.file, u), () => {});
        } else if (isMd(n.file) && !noteCache.has(n.file)) {
          noteCache.set(n.file, "…");
          void api.file(n.file).then((f) => noteCache.set(n.file, stripFrontmatter(f.text)), () => noteCache.set(n.file, "*File not found in vault.*"));
        }
      } else if (n.type === "group" && n.background && !blobCache.has(n.background)) {
        const bg = n.background; blobCache.set(bg, ""); void blobUrl(bg).then((u) => blobCache.set(bg, u), () => {});
      }
    }
  });

  function hydrateMd(el: HTMLElement, _html: string) {
    void hydrateImages(el);
    const onClick = (e: MouseEvent) => {
      const href = ((e.target as HTMLElement | null)?.closest?.("a.internal-link") as HTMLAnchorElement | null)?.dataset.href;
      if (!href) return;
      e.preventDefault(); e.stopPropagation();
      const [target, anchor] = href.split("#");
      if (target) openPath(resolveOrBeside(target, dirOf(spec.path)), undefined, { beside: e.ctrlKey || superOf(e), anchor });
    };
    el.addEventListener("click", onClick);
    return { update(_next: string) { void hydrateImages(el); }, destroy() { el.removeEventListener("click", onClick); } };
  }

  function pushHistory(): void {
    const snap = serializeCanvas(doc);
    if (undoStack[undoStack.length - 1] !== snap) { undoStack = [...undoStack.slice(-(MAX_HISTORY - 1)), snap]; redoStack = []; }
  }
  function markDirty(): void { dirty = true; clearTimeout(saveTimer); saveTimer = window.setTimeout(() => void save(), 500); }
  function pruneSelection(): void {
    const valid = new Set(doc.nodes.map((n) => n.id));
    for (const id of [...selectedNodes]) if (!valid.has(id)) selectedNodes.delete(id);
    if (selectedEdgeId && !doc.edges.some((e) => e.id === selectedEdgeId)) selectedEdgeId = null;
  }
  function undo(): void {
    if (!undoStack.length) return;
    commitEdit(); redoStack = [...redoStack.slice(-(MAX_HISTORY - 1)), serializeCanvas(doc)];
    doc = parseCanvas(undoStack[undoStack.length - 1]); undoStack = undoStack.slice(0, -1); pruneSelection(); markDirty();
  }
  function redo(): void {
    if (!redoStack.length) return;
    commitEdit(); undoStack = [...undoStack.slice(-(MAX_HISTORY - 1)), serializeCanvas(doc)];
    doc = parseCanvas(redoStack[redoStack.length - 1]); redoStack = redoStack.slice(0, -1); pruneSelection(); markDirty();
  }

  async function ownWrite(): Promise<boolean> {
    const f = await api.file(spec.path).catch(() => null);
    if (!f || f.text !== original) return false;
    baseMtime = f.mtime; return true;
  }
  const rescue = (text: string) => void keepRecovery(spec.path, text, `The canvas is kept in ${recoveryPath(spec.path)}.`);

  async function save(closingText?: string): Promise<void> {
    clearTimeout(saveTimer);
    while (saving) await saving;
    if (!dirty && closingText === undefined) return;
    if (conflict) { if (closingText !== undefined) rescue(closingText); return; }
    saving = (async () => {
      const text = closingText ?? serializeCanvas(doc);
      try {
        let r;
        try { r = await api.putFile(spec.path, text, baseMtime); }
        catch (e) {
          if (e instanceof ApiError && e.status === 409 && (await ownWrite())) r = await api.putFile(spec.path, text, baseMtime);
          else throw e;
        }
        baseMtime = r.mtime; original = text; error = "";
        if (closingText === undefined) dirty = false;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) conflict = true;
        else error = `Save failed: ${errText(e)}`;
        if (closingText !== undefined) rescue(text);
      }
    })();
    try { await saving; } finally { saving = null; }
  }

  async function keepMine(): Promise<void> {
    try {
      const text = serializeCanvas(doc), r = await api.putFile(spec.path, text);
      baseMtime = r.mtime; original = text; conflict = false; dirty = false; error = "";
    } catch (e) { error = `Save failed: ${errText(e)}`; }
  }
  async function load(initial = true): Promise<void> {
    try {
      const f = await api.file(spec.path);
      baseMtime = f.mtime; original = f.text; doc = parseCanvas(f.text); dirty = false; conflict = false; error = "";
      if (initial) { undoStack = []; redoStack = []; requestAnimationFrame(() => fitToView()); }
    } catch (e) { error = errText(e); }
  }

  function toWorld(cx: number, cy: number): { x: number; y: number } {
    const r = stageEl?.getBoundingClientRect();
    return r ? { x: (cx - r.left - panX) / zoom, y: (cy - r.top - panY) / zoom } : { x: 0, y: 0 };
  }
  const centerWorld = () => ({ x: ((stageEl?.clientWidth ?? 800) / 2 - panX) / zoom, y: ((stageEl?.clientHeight ?? 560) / 2 - panY) / zoom });

  function zoomAt(next: number, cx?: number, cy?: number): void {
    const z = Math.min(3, Math.max(0.15, next));
    const px = cx ?? (stageEl?.clientWidth ?? 800) / 2, py = cy ?? (stageEl?.clientHeight ?? 560) / 2;
    panX = px - ((px - panX) / zoom) * z; panY = py - ((py - panY) / zoom) * z; zoom = z;
  }
  function fitToView(): void {
    const w = stageEl?.clientWidth ?? 800, h = stageEl?.clientHeight ?? 560, b = canvasBounds(doc.nodes);
    if (!b) { zoom = 1; panX = Math.round(w / 2); panY = Math.round(h / 2); return; }
    const z = Math.min(1.2, Math.max(0.2, Math.min((w - 144) / Math.max(1, b.width), (h - 144) / Math.max(1, b.height))));
    zoom = z; panX = Math.round(w / 2 - (b.minX + b.width / 2) * z); panY = Math.round(h / 2 - (b.minY + b.height / 2) * z);
  }
  function onWheel(e: WheelEvent): void {
    const sc = !e.ctrlKey && !e.metaKey ? (e.target as HTMLElement | null)?.closest?.("textarea, .canvas-scroll") as HTMLElement | null : null;
    if (sc && sc.scrollHeight > sc.clientHeight) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const r = stageEl?.getBoundingClientRect();
      zoomAt(zoom * Math.exp(-e.deltaY * 0.0022), r ? e.clientX - r.left : undefined, r ? e.clientY - r.top : undefined);
    } else { panX -= e.deltaX; panY -= e.deltaY; }
  }

  function commitEdit(): void {
    if (!edit) return;
    const cur = edit; edit = null;
    if (applyInlineEdit(doc, cur.kind, cur.id, cur.value, pushHistory)) markDirty();
  }
  function startEdit(kind: "text" | "group" | "edge", id: string, value: string): void {
    commitEdit(); selectedNodes.clear(); selectedEdgeId = kind === "edge" ? id : null;
    if (kind !== "edge") selectedNodes.add(id);
    edit = { kind, id, value };
    void tick().then(() => {
      if (kind === "text") stageEl?.querySelector<HTMLTextAreaElement>(".canvas-editor")?.focus();
      else stageEl?.querySelector<HTMLInputElement>(".inline-input")?.select();
    });
  }

  function beginDrag(next: DragState): void {
    drag = next;
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      if (drag.kind === "pan") {
        const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
        if (Math.hypot(dx, dy) > 3) drag.moved = true;
        panX = drag.ox + dx; panY = drag.oy + dy;
      } else if (drag.kind === "marquee") {
        const w = toWorld(e.clientX, e.clientY); drag.x1 = w.x; drag.y1 = w.y;
        const x0 = Math.min(drag.x0, w.x), x1 = Math.max(drag.x0, w.x), y0 = Math.min(drag.y0, w.y), y1 = Math.max(drag.y0, w.y);
        selectedNodes.clear();
        for (const n of doc.nodes) if (n.x + n.width >= x0 && n.x <= x1 && n.y + n.height >= y0 && n.y <= y1) selectedNodes.add(n.id);
      } else if (drag.kind === "move") {
        const dx = (e.clientX - drag.sx) / zoom, dy = (e.clientY - drag.sy) / zoom;
        if (!drag.recorded && Math.hypot(dx, dy) > 1) { pushHistory(); drag.recorded = true; }
        if (drag.recorded) for (const n of doc.nodes) {
          const o = drag.origins.get(n.id); if (o) { n.x = snapGrid(o.x + dx, 10, e.altKey); n.y = snapGrid(o.y + dy, 10, e.altKey); }
        }
      } else if (drag.kind === "resize") {
        const targetId = drag.id;
        const dx = (e.clientX - drag.sx) / zoom, dy = (e.clientY - drag.sy) / zoom;
        if (!drag.recorded && Math.hypot(dx, dy) > 1) { pushHistory(); drag.recorded = true; }
        const n = doc.nodes.find((x) => x.id === targetId);
        if (n && drag.recorded) {
          if (drag.handle !== "s") n.width = Math.max(100, snapGrid(drag.ow + dx, 10, e.altKey));
          if (drag.handle !== "e") n.height = Math.max(60, snapGrid(drag.oh + dy, 10, e.altKey));
        }
      } else if (drag.kind === "wire") {
        const w = toWorld(e.clientX, e.clientY); drag.x2 = w.x; drag.y2 = w.y;
        const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        const portEl = el?.closest?.("[data-port-node]") as HTMLElement | null, cardEl = el?.closest?.("[data-node-id]") as HTMLElement | null;
        if (portEl && portEl.dataset.portNode !== drag.fromNode) {
          drag.toNode = portEl.dataset.portNode!; drag.toSide = portEl.dataset.portSide as Side;
          const tn = byId.get(drag.toNode); if (tn) { const p = anchorPoint(tn, drag.toSide); drag.x2 = p.x; drag.y2 = p.y; }
        } else if (cardEl && cardEl.dataset.nodeId !== drag.fromNode) {
          drag.toNode = cardEl.dataset.nodeId!; const tn = byId.get(drag.toNode);
          drag.toSide = tn ? nearestSide(tn, w.x, w.y) : null;
        } else { drag.toNode = null; drag.toSide = null; }
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onUp);
      if (!drag) return;
      if (drag.kind === "pan" && !drag.moved && drag.clearOnClick) { commitEdit(); selectedNodes.clear(); selectedEdgeId = null; }
      else if ((drag.kind === "move" || drag.kind === "resize") && drag.recorded) markDirty();
      else if (drag.kind === "wire" && drag.toNode && drag.toSide && drag.toNode !== drag.fromNode) {
        pushHistory(); const id = canvasId();
        doc.edges.push({ id, fromNode: drag.fromNode, fromSide: drag.fromSide, toNode: drag.toNode, toSide: drag.toSide, toEnd: "arrow" });
        selectedNodes.clear(); selectedEdgeId = id; markDirty();
      }
      drag = null;
    };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp); window.addEventListener("pointercancel", onUp);
  }

  function onStageDown(e: PointerEvent): void {
    paneEl?.focus({ preventScroll: true });
    if (e.button === 1 || (e.button === 0 && spaceHeld)) { e.preventDefault(); beginDrag({ kind: "pan", sx: e.clientX, sy: e.clientY, ox: panX, oy: panY, moved: false, clearOnClick: false }); return; }
    if (e.button !== 0 || e.target !== stageEl) return;
    if (e.shiftKey) { const w = toWorld(e.clientX, e.clientY); selectedEdgeId = null; beginDrag({ kind: "marquee", x0: w.x, y0: w.y, x1: w.x, y1: w.y }); }
    else beginDrag({ kind: "pan", sx: e.clientX, sy: e.clientY, ox: panX, oy: panY, moved: false, clearOnClick: true });
  }
  function onNodeDown(e: PointerEvent, n: CanvasNode): void {
    if (e.button !== 0 || spaceHeld || (e.target as HTMLElement | null)?.closest?.("textarea, input, button, a")) return;
    e.stopPropagation(); paneEl?.focus({ preventScroll: true });
    if (edit && edit.id !== n.id) commitEdit();
    selectedEdgeId = null;
    if (e.shiftKey) { if (selectedNodes.has(n.id)) selectedNodes.delete(n.id); else selectedNodes.add(n.id); return; }
    if (!selectedNodes.has(n.id)) { selectedNodes.clear(); selectedNodes.add(n.id); }
    const moving = new Set(selectedNodes);
    for (const id of [...selectedNodes]) { const g = byId.get(id); if (g?.type === "group") for (const cid of nodesInsideGroup(g, doc.nodes)) moving.add(cid); }
    const origins = new Map<string, { x: number; y: number }>();
    for (const id of moving) { const it = byId.get(id); if (it) origins.set(id, { x: it.x, y: it.y }); }
    beginDrag({ kind: "move", sx: e.clientX, sy: e.clientY, origins, recorded: false });
  }
  function onResizeDown(e: PointerEvent, n: CanvasNode, handle: "se" | "e" | "s"): void {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault(); selectedNodes.clear(); selectedNodes.add(n.id); selectedEdgeId = null;
    beginDrag({ kind: "resize", id: n.id, handle, sx: e.clientX, sy: e.clientY, ow: n.width, oh: n.height, recorded: false });
  }
  function onPortDown(e: PointerEvent, n: CanvasNode, side: Side): void {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault(); commitEdit();
    const p = anchorPoint(n, side);
    beginDrag({ kind: "wire", fromNode: n.id, fromSide: side, x1: p.x, y1: p.y, x2: p.x, y2: p.y, toNode: null, toSide: null });
  }

  function addCard(): void {
    commitEdit(); pushHistory(); const c = centerWorld();
    const node: CanvasNode = { id: canvasId(), type: "text", x: snapGrid(c.x - 140), y: snapGrid(c.y - 80), width: 280, height: 160, text: "" };
    doc.nodes.push(node); markDirty(); startEdit("text", node.id, "");
  }
  function addGroup(): void {
    commitEdit(); pushHistory(); const c = centerWorld();
    const node: CanvasGroupNode = { id: canvasId(), type: "group", x: snapGrid(c.x - 240), y: snapGrid(c.y - 160), width: 480, height: 320, label: "Group" };
    doc.nodes.unshift(node); markDirty(); startEdit("group", node.id, "Group");
  }
  async function addFileOrLink(): Promise<void> {
    const files = (await listVault().catch(() => [] as string[])).filter((p) => !p.startsWith(".kandinsky/") && p !== spec.path).sort((a, b) => a.localeCompare(b));
    pick({
      placeholder: "Pick a vault note, image, or PDF — or paste an https:// URL…", tag: "Add to canvas", icon: "plus",
      items: files.map((p) => ({ value: p, title: shownName(p), detail: dirOf(p) || "/", icon: fileIcon(p), section: IMAGE_RE.test(p) ? "Images" : isMd(p) ? "Notes" : "Files" })),
      typed: (t) => (/^https?:\/\/\S+$/i.test(t.trim()) ? `Add link card “${t.trim()}”` : null),
      typedAs: { section: "Web link", icon: "globe" },
      onpick: (val, isUrl) => {
        commitEdit(); pushHistory(); const c = centerWorld();
        const node = makeMediaNode(val, isUrl, c.x, c.y, IMAGE_RE.test(val), isMd(val));
        doc.nodes.push(node); selectedNodes.clear(); selectedNodes.add(node.id); selectedEdgeId = null; markDirty();
      },
    });
  }

  function setColor(color?: string): void {
    if (!hasSelection) return;
    pushHistory();
    if (selectedEdgeId) { const ed = doc.edges.find((e) => e.id === selectedEdgeId); if (ed) { if (color) ed.color = color; else delete ed.color; } }
    for (const n of doc.nodes) if (selectedNodes.has(n.id)) { if (color) n.color = color; else delete n.color; }
    markDirty();
  }
  function deleteSelected(): void {
    if (!hasSelection) return;
    pushHistory();
    if (selectedNodes.size) {
      const gone = new Set(selectedNodes);
      doc.nodes = doc.nodes.filter((n) => !gone.has(n.id));
      doc.edges = doc.edges.filter((e) => !gone.has(e.fromNode) && !gone.has(e.toNode));
      selectedNodes.clear();
    }
    if (selectedEdgeId) { doc.edges = doc.edges.filter((e) => e.id !== selectedEdgeId); selectedEdgeId = null; }
    markDirty();
  }

  function onKeyDown(e: KeyboardEvent): void {
    const mod = e.ctrlKey || superOf(e);
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); e.stopPropagation(); commitEdit(); void save(); return; }
    if ((e.target as HTMLElement | null)?.matches?.("textarea, input")) return;
    if (e.code === "Space") { spaceHeld = true; return; }
    if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); redo(); return; }
    if (mod && e.key.toLowerCase() === "a") { e.preventDefault(); selectedEdgeId = null; doc.nodes.forEach((n) => selectedNodes.add(n.id)); return; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelected(); return; }
    if (e.key === "Escape") { selectedNodes.clear(); selectedEdgeId = null; return; }
    if (e.key === "Enter") {
      if (selectedEdgeId) { const ed = doc.edges.find((x) => x.id === selectedEdgeId); if (ed) { e.preventDefault(); startEdit("edge", ed.id, ed.label ?? ""); } }
      else if (selectedNodes.size === 1) {
        const n = byId.get([...selectedNodes][0]); if (!n) return;
        e.preventDefault();
        if (n.type === "text") startEdit("text", n.id, n.text);
        else if (n.type === "group") startEdit("group", n.id, n.label ?? "");
        else if (n.type === "file") openPath(n.file, undefined, { anchor: n.subpath?.replace(/^#/, "") });
        else if (n.type === "link") openWeb(n.url);
      }
    }
  }

  onMount(() => {
    void load(true);
    paneParks.set(panel.id, () => { commitEdit(); return dirty ? save() : Promise.resolve(); });
    paneFocus.set(panel.id, () => paneEl?.focus({ preventScroll: true }));
    const offFs = on("fs", (e) => {
      for (const [p] of noteCache) if (touches(e.paths, (x) => x === p)) void api.file(p).then((f) => noteCache.set(p, stripFrontmatter(f.text)), () => {});
      if (!touches(e.paths, (p) => p === spec.path) || dirty || saving) return;
      void api.file(spec.path).then((f) => {
        if (f.text === original) baseMtime = f.mtime;
        else { baseMtime = f.mtime; original = f.text; doc = parseCanvas(f.text); pruneSelection(); }
      }, () => {});
    });
    return () => {
      commitEdit(); clearTimeout(saveTimer); if (dirty) void save(serializeCanvas(doc));
      paneParks.delete(panel.id); paneFocus.delete(panel.id); offFs(); setDirty(panel.id, false);
    };
  });
</script>

{#snippet chrome(n: CanvasNode)}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  {#each SIDES as s (s)}<span class="port port-{s}" data-port-node={n.id} data-port-side={s} onpointerdown={(e) => onPortDown(e, n, s)}></span>{/each}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  {#each (["e", "s", "se"] as const) as h (h)}<span class="rh rh-{h}" onpointerdown={(e) => onResizeDown(e, n, h)}></span>{/each}
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="canvas-pane" tabindex="-1" bind:this={paneEl} onkeydown={onKeyDown} onkeyup={(e) => { if (e.code === "Space") spaceHeld = false; }}>
  <div class="canvas-topbar">
    <div class="crumbs" title={spec.path}>
      <Icon name="grid" size={14} />
      {#if dirOf(spec.path)}<span class="crumb-dir">{dirOf(spec.path)}/</span>{/if}
      <span class="crumb-name">{shownName(spec.path)}</span>
    </div>
    <div class="tools">
      <button type="button" class="tbtn" onclick={addCard} title="Add Markdown text card"><Icon name="plus" size={13} /> Card</button>
      <button type="button" class="tbtn" onclick={() => void addFileOrLink()} title="Add vault note, image, PDF, or URL"><Icon name="file-text" size={13} /> Note / Image</button>
      <button type="button" class="tbtn" onclick={addGroup} title="Add group frame"><Icon name="crop" size={13} /> Group</button>
      {#if hasSelection}
        <span class="sep"></span>
        <div class="swatches" role="group" aria-label="Canvas color">
          {#each CANVAS_PRESET_COLORS as sw (sw.id)}
            <button type="button" class="swatch" class:on={activeColor === sw.id} style:--sw={sw.css} title={sw.label} aria-label={sw.label} onclick={() => setColor(sw.id)}></button>
          {/each}
          <button type="button" class="tbtn icon-only" title="Clear color" aria-label="Clear color" onclick={() => setColor(undefined)}><Icon name="close" size={12} /></button>
          <button type="button" class="tbtn icon-only danger" title="Delete selected (Del)" aria-label="Delete selected" onclick={deleteSelected}><Icon name="trash" size={13} /></button>
        </div>
      {/if}
      <span class="sep"></span>
      <button type="button" class="tbtn icon-only" disabled={!undoStack.length} onclick={undo} title="Undo (Ctrl+Z)" aria-label="Undo"><Icon name="undo" size={14} /></button>
      <button type="button" class="tbtn icon-only" disabled={!redoStack.length} onclick={redo} title="Redo (Ctrl+Y)" aria-label="Redo"><Icon name="redo" size={14} /></button>
      <span class="sep"></span>
      <button type="button" class="tbtn icon-only" onclick={() => zoomAt(zoom / 1.2)} title="Zoom out" aria-label="Zoom out"><Icon name="minus" size={13} /></button>
      <button type="button" class="tbtn mono" onclick={() => zoomAt(1)} title="Reset zoom to 100%">{Math.round(zoom * 100)}%</button>
      <button type="button" class="tbtn icon-only" onclick={() => zoomAt(zoom * 1.2)} title="Zoom in" aria-label="Zoom in"><Icon name="plus" size={13} /></button>
      <button type="button" class="tbtn" onclick={fitToView} title="Fit all cards into view">Fit</button>
      <span class="sep"></span>
      <button type="button" class="tbtn" onclick={() => window.dispatchEvent(new CustomEvent("kandinsky:toggle-zen"))} title="Zen mode (F11)"><Icon name="maximize" size={13} /> Zen</button>
      <button type="button" class="tbtn" onclick={() => open({ kind: "editor", path: spec.path })} title="Edit raw .canvas JSON"><Icon name="file-code" size={13} /> JSON</button>
    </div>
  </div>

  {#if conflict}
    <div class="banner">This canvas changed on disk. <button type="button" onclick={() => void load(false)}>Reload from disk</button> or <button type="button" onclick={() => void keepMine()}>Keep mine</button>.</div>
  {/if}
  {#if error}<div class="banner err">{error}</div>{/if}

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="canvas-stage" class:panning={spaceHeld || drag?.kind === "pan"} bind:this={stageEl}
    style:background-size="{22 * zoom}px {22 * zoom}px" style:background-position="{panX}px {panY}px" onpointerdown={onStageDown} onwheel={onWheel}>
    <div class="world" style:transform="translate({panX}px, {panY}px) scale({zoom})">
      {#each groups as g (g.id)}
        {@const bg = g.background ? blobCache.get(g.background) : ""}
        <div class="cnode group" class:selected={selectedNodes.has(g.id)} data-node-id={g.id}
          style:left="{g.x}px" style:top="{g.y}px" style:width="{g.width}px" style:height="{g.height}px"
          style:--nc={resolveCanvasColor(g.color) ?? "var(--border-strong)"} style:background-image={bg ? `url(${bg})` : undefined}
          style:background-size={g.backgroundStyle === "repeat" ? "auto" : g.backgroundStyle === "ratio" ? "contain" : "cover"}
          style:background-repeat={g.backgroundStyle === "repeat" ? "repeat" : "no-repeat"} onpointerdown={(e) => onNodeDown(e, g)}>
          <div class="group-bar" ondblclick={(e) => { e.stopPropagation(); startEdit("group", g.id, g.label ?? ""); }}>
            {#if edit?.kind === "group" && edit.id === g.id}
              <input class="inline-input" dir="auto" bind:value={edit.value} onblur={commitEdit} onkeydown={(e) => { e.stopPropagation(); if (e.key === "Enter" || e.key === "Escape") commitEdit(); }} />
            {:else}<span class="group-title" dir="auto">{g.label || "Group"}</span>{/if}
          </div>
          {@render chrome(g)}
        </div>
      {/each}

      <svg class="edges" aria-hidden="true">
        <defs><marker id={markerId} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="context-stroke" /></marker></defs>
        {#each doc.edges as ed (ed.id)}
          {@const geo = edgeGeometry(ed, byId)}
          {#if geo}
            {@const sel = selectedEdgeId === ed.id}
            <g class="edge-g" class:selected={sel}>
              <path class="edge-hit" d={geo.d}
                onpointerdown={(e) => { if (e.button !== 0) return; e.stopPropagation(); commitEdit(); selectedNodes.clear(); selectedEdgeId = ed.id; paneEl?.focus({ preventScroll: true }); }}
                ondblclick={(e) => { e.stopPropagation(); startEdit("edge", ed.id, ed.label ?? ""); }} />
              <path class="edge-line" d={geo.d} style:stroke={resolveCanvasColor(ed.color) ?? (sel ? "var(--accent)" : "var(--text-faint)")}
                marker-end={(ed.toEnd ?? "arrow") === "arrow" ? `url(#${markerId})` : undefined} marker-start={ed.fromEnd === "arrow" ? `url(#${markerId})` : undefined} />
            </g>
          {/if}
        {/each}
        {#if drag?.kind === "wire"}
          {@const w = bezierPath(drag.x1, drag.y1, drag.fromSide, drag.x2, drag.y2, drag.toSide ?? nearestSide({ x: drag.x2 - 1, y: drag.y2 - 1, width: 2, height: 2 }, drag.x1, drag.y1))}
          <path class="edge-line wire-preview" d={w.d} marker-end="url(#{markerId})" />
        {/if}
      </svg>

      {#each doc.edges as ed (ed.id)}
        {@const geo = edgeGeometry(ed, byId)}
        {@const isEd = edit?.kind === "edge" && edit.id === ed.id}
        {#if geo && (ed.label || isEd)}
          <div class="edge-pill" class:selected={selectedEdgeId === ed.id} style:left="{geo.mx}px" style:top="{geo.my}px"
            onpointerdown={(e) => { e.stopPropagation(); selectedNodes.clear(); selectedEdgeId = ed.id; }} ondblclick={(e) => { e.stopPropagation(); startEdit("edge", ed.id, ed.label ?? ""); }}>
            {#if edit?.kind === "edge" && edit.id === ed.id}
              <input class="inline-input" dir="auto" bind:value={edit.value} onblur={commitEdit} onkeydown={(e) => { e.stopPropagation(); if (e.key === "Enter" || e.key === "Escape") commitEdit(); }} />
            {:else}<span dir="auto">{ed.label}</span>{/if}
          </div>
        {/if}
      {/each}

      {#each cards as n (n.id)}
        {@const col = resolveCanvasColor(n.color)}
        {@const isEdit = edit?.kind === "text" && edit.id === n.id}
        <div class="cnode card" class:selected={selectedNodes.has(n.id)} class:editing={isEdit} class:tinted={!!col}
          data-node-id={n.id} style:left="{n.x}px" style:top="{n.y}px" style:width="{n.width}px" style:height="{n.height}px" style:--nc={col ?? "var(--border-strong)"}
          onpointerdown={(e) => onNodeDown(e, n)} ondblclick={(e) => { if (n.type === "text") { e.stopPropagation(); startEdit("text", n.id, n.text); } }}>
          {#if n.type === "text"}
            {#if edit?.kind === "text" && edit.id === n.id}
              <textarea class="canvas-editor" dir="auto" bind:value={edit.value} placeholder="Write Markdown…" onblur={commitEdit}
                onkeydown={(e) => {
                  if ((e.ctrlKey || superOf(e)) && e.key.toLowerCase() === "s") return;
                  e.stopPropagation();
                  if (e.key === "Escape" || ((e.ctrlKey || superOf(e)) && e.key === "Enter")) { e.preventDefault(); commitEdit(); paneEl?.focus({ preventScroll: true }); }
                }}></textarea>
            {:else}
              {@const html = renderMarkdown(n.text || "*Double-click to write…*", { dir: dirOf(spec.path) })}
              <div class="canvas-scroll canvas-md markdown" class:empty={!n.text.trim()} dir="auto" use:hydrateMd={html}>{@html html}</div>
            {/if}
          {:else if n.type === "file"}
            <div class="card-head">
              <Icon name={fileIcon(n.file)} size={13} />
              <span class="card-title" dir="auto" title={n.file}>{shownName(n.file)}{n.subpath ?? ""}</span>
              <button type="button" class="mini-btn" title="Open file (Ctrl+click opens beside)"
                onclick={(e) => { e.stopPropagation(); openPath(n.file, undefined, { beside: e.ctrlKey || superOf(e), anchor: n.subpath?.replace(/^#/, "") }); }}>Open</button>
            </div>
            {#if IMAGE_RE.test(n.file)}
              <div class="img-wrap">{#if blobCache.get(n.file)}<img src={blobCache.get(n.file)} alt={shownName(n.file)} draggable="false" />{/if}</div>
            {:else if isMd(n.file)}
              {@const mdHtml = renderMarkdown(noteCache.get(n.file) ?? "…", { dir: dirOf(n.file) })}
              <div class="canvas-scroll canvas-md markdown" dir="auto" use:hydrateMd={mdHtml}>{@html mdHtml}</div>
            {:else}
              <div class="file-body">
                <Icon name={fileIcon(n.file)} size={24} />
                <div class="file-path" dir="auto">{n.file}</div>
                <button type="button" class="tbtn" onclick={(e) => { e.stopPropagation(); openPath(n.file, undefined, { beside: e.ctrlKey || superOf(e) }); }}>Open file</button>
              </div>
            {/if}
          {:else if n.type === "link"}
            <div class="card-head">
              <Icon name="globe" size={13} />
              <span class="domain-badge">{domainOf(n.url)}</span>
              <button type="button" class="mini-btn" title="Open link (Shift+click opens external browser)"
                onclick={(e) => { e.stopPropagation(); if (e.shiftKey) void openOutside(n.url); else openWeb(n.url); }}><Icon name="external-link" size={12} /></button>
            </div>
            <div class="link-body" dir="auto">{n.url}</div>
          {/if}
          {@render chrome(n)}
        </div>
      {/each}

      {#if drag?.kind === "marquee"}
        <div class="marquee" style:left="{Math.min(drag.x0, drag.x1)}px" style:top="{Math.min(drag.y0, drag.y1)}px"
          style:width="{Math.abs(drag.x1 - drag.x0)}px" style:height="{Math.abs(drag.y1 - drag.y0)}px"></div>
      {/if}
    </div>
  </div>
</div>

<style>
  .canvas-pane { height: 100%; display: flex; flex-direction: column; background: var(--bg); outline: none; position: relative; user-select: none; }
  .canvas-topbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 5px 10px; min-height: 36px; background: var(--bg-side, var(--bg-alt)); border-bottom: 1px solid var(--border); flex-wrap: wrap; z-index: 5; }
  .crumbs { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: calc(13px * var(--ui-scale, 1)); color: var(--heading); font-weight: 600; }
  .crumb-dir { color: var(--text-faint); font-weight: 400; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; }
  .crumb-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tools, .swatches { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .sep { width: 1px; height: 16px; background: var(--border-strong); margin: 0 3px; }
  .tbtn { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 8px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg-elev); color: var(--text); font-size: calc(12px * var(--ui-scale, 1)); }
  .tbtn:hover:not(:disabled) { background: var(--bg-hover); border-color: var(--border-strong); } .tbtn:disabled { opacity: .4; cursor: default; }
  .tbtn.icon-only { padding: 0 6px; } .tbtn.danger:hover { color: var(--red); border-color: var(--red); }
  .tbtn.mono { font-family: var(--font-mono); font-size: calc(11.5px * var(--ui-scale, 1)); min-width: 46px; justify-content: center; }
  .swatch { width: 16px; height: 16px; border-radius: 50%; background: var(--sw); border: 2px solid transparent; padding: 0; }
  .swatch:hover, .swatch.on { transform: scale(1.15); border-color: var(--heading); }
  .banner { padding: 6px 12px; background: var(--bg-elev); border-bottom: 1px solid var(--border); font-size: calc(12.5px * var(--ui-scale, 1)); color: var(--text); z-index: 5; }
  .banner button { color: var(--accent); text-decoration: underline; padding: 0 2px; } .banner.err { color: var(--red); }
  .canvas-stage { flex: 1; min-height: 0; position: relative; overflow: hidden; touch-action: none; background-color: var(--bg); background-image: radial-gradient(circle, color-mix(in srgb, var(--text) 16%, transparent) 1.15px, transparent 1.25px); }
  .canvas-stage.panning { cursor: grabbing; } .world { position: absolute; left: 0; top: 0; width: 0; height: 0; transform-origin: 0 0; }
  .edges { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; z-index: 2; }
  .edge-hit { fill: none; stroke: transparent; stroke-width: 14px; pointer-events: stroke; cursor: pointer; }
  .edge-line { fill: none; stroke-width: 2px; transition: stroke-width .1s; pointer-events: none; }
  .edge-g.selected .edge-line { stroke-width: 2.8px; } .wire-preview { stroke: var(--accent); stroke-dasharray: 5 4; }
  .edge-pill { position: absolute; z-index: 4; transform: translate(-50%, -50%); padding: 2px 8px; border-radius: 999px; background: var(--bg-elev); border: 1px solid var(--border-strong); color: var(--text); font-size: 12px; box-shadow: var(--shadow-sm); cursor: pointer; white-space: nowrap; }
  .edge-pill.selected { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
  .inline-input { font: inherit; font-size: 12px; color: var(--text); background: var(--bg); border: 1px solid var(--accent); border-radius: 4px; padding: 1px 5px; outline: none; min-width: 80px; }
  .cnode { position: absolute; box-sizing: border-box; border-radius: var(--radius-lg); }
  .cnode.group { z-index: 1; border: 1.5px dashed color-mix(in srgb, var(--nc) 62%, transparent); background-color: color-mix(in srgb, var(--nc) 7%, transparent); }
  .cnode.group.selected { border-style: solid; border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
  .group-bar { position: absolute; top: -26px; left: 0; display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: var(--radius-sm); background: color-mix(in srgb, var(--nc) 16%, var(--bg-elev)); color: var(--heading); font-size: 12px; font-weight: 600; border: 1px solid color-mix(in srgb, var(--nc) 45%, var(--border)); cursor: grab; max-width: 100%; }
  .group-title, .card-title, .domain-badge { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cnode.card { z-index: 3; display: flex; flex-direction: column; overflow: visible; background: var(--bg-elev); border: 1.5px solid var(--border-strong); box-shadow: var(--shadow-card); }
  .cnode.card.tinted { border-color: color-mix(in srgb, var(--nc) 68%, var(--border-strong)); background: color-mix(in srgb, var(--nc) 7%, var(--bg-elev)); }
  .cnode.card.selected { z-index: 4; border-color: var(--accent); box-shadow: 0 0 0 2.5px var(--accent-sel), var(--shadow-card); }
  .cnode.card.editing { z-index: 5; user-select: text; }
  .card-head { display: flex; align-items: center; gap: 6px; padding: 6px 9px; border-bottom: 1px solid var(--border); font-size: 12px; color: var(--text-muted); border-radius: var(--radius-lg) var(--radius-lg) 0 0; cursor: grab; flex: none; }
  .card-title { flex: 1; min-width: 0; color: var(--heading); font-weight: 600; }
  .domain-badge { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: 11px; color: var(--accent); }
  .mini-btn { padding: 2px 6px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg); color: var(--text-muted); font-size: 11px; display: inline-flex; align-items: center; }
  .mini-btn:hover { color: var(--text); border-color: var(--border-strong); background: var(--bg-hover); }
  .canvas-scroll { flex: 1; min-height: 0; overflow: auto; padding: 10px 12px; border-radius: var(--radius-lg); user-select: text; }
  .canvas-md { font-size: 13.5px; line-height: 1.55; }
  .canvas-md.empty { color: var(--text-faint); }
  .canvas-editor { flex: 1; width: 100%; height: 100%; box-sizing: border-box; resize: none; border: 0; border-radius: var(--radius-lg); padding: 10px 12px; background: transparent; color: var(--text); font: 13.5px / 1.55 var(--prose-font, var(--font-ui)); outline: none; user-select: text; }
  .img-wrap { flex: 1; min-height: 0; display: grid; place-items: center; overflow: hidden; border-radius: 0 0 var(--radius-lg) var(--radius-lg); background: var(--bg); }
  .img-wrap img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
  .file-body { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 10px; color: var(--text-muted); text-align: center; }
  .file-path { font-size: 11.5px; color: var(--text-faint); word-break: break-all; }
  .link-body { flex: 1; padding: 8px 10px; font-size: 12.5px; color: var(--text); word-break: break-all; overflow: auto; user-select: text; }
  .port { position: absolute; width: 10px; height: 10px; border-radius: 50%; background: var(--bg-elev); border: 2px solid var(--accent); opacity: 0; transition: opacity .12s, transform .12s; z-index: 6; cursor: crosshair; }
  .cnode:hover > .port, .cnode.selected > .port { opacity: .9; } .port:hover { opacity: 1 !important; transform: scale(1.3); background: var(--accent); }
  .port-top { top: -6px; left: calc(50% - 5px); } .port-right { right: -6px; top: calc(50% - 5px); }
  .port-bottom { bottom: -6px; left: calc(50% - 5px); } .port-left { left: -6px; top: calc(50% - 5px); }
  .rh { position: absolute; z-index: 5; } .rh-se { right: -5px; bottom: -5px; width: 12px; height: 12px; cursor: nwse-resize; }
  .rh-e { top: 8px; right: -4px; width: 7px; bottom: 10px; cursor: ew-resize; } .rh-s { left: 8px; bottom: -4px; height: 7px; right: 10px; cursor: ns-resize; }
  .marquee { position: absolute; z-index: 7; border: 1.5px solid var(--accent); background: var(--accent-soft); border-radius: 3px; pointer-events: none; }
</style>
