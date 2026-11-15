<script lang="ts">
  // Graph view, as Obsidian draws it: every note a dot sized by its links, links as lines, a force layout that
  // settles (lib/graph/sim.ts), and Obsidian's settings card — Filters (search, tags, attachments, orphans),
  // Groups (colour by query), Display (arrows, text fade, node size, link thickness) and Forces — read from the
  // vault's Obsidian graph settings the first time (lib/graph/settings.ts). Hover lights a note and its neighbours;
  // click opens it (Ctrl/Cmd+click beside); drag moves a note; wheel zooms; drag the background pans. "Local" keeps
  // the active note's neighbourhood.
  import { onMount } from "svelte";
  import Icon from "../components/Icon.svelte";
  import GraphControls from "../components/GraphControls.svelte";
  import { errText } from "../lib/text";
  import { shownPath } from "../lib/paths";
  import { reloadOnChange } from "../lib/reload-on-change";
  import { getDock, open, openPath } from "../lib/dock";
  import { editors, lastEditorId } from "../lib/registry";
  import type { PaneProps } from "../lib/dock";
  import { Sim, type SimNode } from "../lib/graph/sim";
  import { compile, propertiesIn, type Subject } from "../lib/graph/query";
  import { DEFAULTS, clean, hexOf, loadGraphSettings, saveGraphSettings, type GraphSettings, type GraphSettingsSource } from "../lib/graph/settings";
  import { loadNotes, type NoteData } from "../lib/graph/data";

  let { panel: _panel }: PaneProps<"graph"> = $props();
  let canvas: HTMLCanvasElement;
  let wrap: HTMLDivElement;

  let s = $state<GraphSettings>(clean({}));
  let from = $state<GraphSettingsSource>("defaults");
  let ready = $state(false); // the settings are read: building and saving may start
  let notes = $state.raw<NoteData[] | null>(null);
  let failed = $state("");
  let local = $state(false);
  let depth = $state(1);
  let noActive = $state(false);
  let count = $state({ nodes: 0, edges: 0 });
  let tip = $state("");

  type Kind = "note" | "tag" | "attachment";
  type GNode = SimNode & { key: string; kind: Kind; name: string; path: string; deg: number; colour: string | null };
  let nodes: GNode[] = [];
  let edges: [number, number][] = []; // from → to
  let adj: Set<number>[] = [];
  let hover: number | null = null;
  const sim = new Sim({ centerStrength: DEFAULTS.centerStrength, repelStrength: DEFAULTS.repelStrength, linkStrength: DEFAULTS.linkStrength, linkDistance: DEFAULTS.linkDistance });
  let view = { x: 0, y: 0, k: 1 };
  let moved = false; // the reader panned or zoomed: the camera is theirs, no longer fitted
  let raf = 0;

  const activePath = () => { const id = lastEditorId(); return id ? editors.get(id)?.path : undefined; };
  const isNote = (p: string) => /\.md$/i.test(p);
  const nameOf = (p: string) => (p.split("/").pop() ?? p).replace(/\.md$/i, "");
  const subjectOf = (n: NoteData): Subject => ({ path: n.path, name: n.path.split("/").pop() ?? n.path, tags: n.tags, props: n.props });
  const fileSubject = (p: string): Subject => ({ path: p, name: p.split("/").pop() ?? p, tags: [], props: {} });

  /** The properties the filter and the groups read: asked for in the notes' query. */
  const wanted = $derived([...new Set([s.search, ...s.colorGroups.map((g) => g.query)].flatMap(propertiesIn))].sort().join("\n"));

  async function load() {
    try { notes = await loadNotes(wanted ? wanted.split("\n") : []); failed = ""; }
    catch (e) { failed = errText(e); }
  }

  /** What to draw, from the notes and the settings; nodes already drawn keep their place. */
  function build() {
    if (!notes) return;
    const keepIt = compile(s.search);
    const groups = s.colorGroups.filter((g) => g.query.trim()).map((g) => ({ test: compile(g.query), colour: hexOf(g.color.rgb) }));
    const shown = notes.filter((n) => keepIt(subjectOf(n)));
    const list: { key: string; kind: Kind; path: string; subject: Subject }[] = shown.map((n) => ({ key: n.path, kind: "note", path: n.path, subject: subjectOf(n) }));
    const index = new Map(list.map((n, i) => [n.key, i]));
    const add = (key: string, kind: Kind, path: string, subject: Subject) => {
      let i = index.get(key);
      if (i === undefined) { i = list.length; list.push({ key, kind, path, subject }); index.set(key, i); }
      return i;
    };
    const pairs = new Set<string>(), es: [number, number][] = [];
    const link = (a: number, b: number) => { const k = a < b ? `${a},${b}` : `${b},${a}`; if (a !== b && !pairs.has(k)) { pairs.add(k); es.push([a, b]); } };
    shown.forEach((n, i) => {
      for (const t of n.links) {
        if (isNote(t)) { const j = index.get(t); if (j !== undefined) link(i, j); }
        else if (s.showAttachments && keepIt(fileSubject(t))) link(i, add(t, "attachment", t, fileSubject(t)));
      }
      if (s.showTags) for (const t of new Set(n.tags)) link(i, add(`#${t}`, "tag", t, { path: "", name: `#${t}`, tags: [t], props: {} }));
    });
    // Local: the active note and what lies within `depth` links of it
    let keep = list.map((_, i) => i);
    noActive = false;
    if (local) {
      const start = index.get(activePath() ?? "");
      if (start !== undefined) {
        const nb: number[][] = list.map(() => []);
        for (const [a, b] of es) { nb[a].push(b); nb[b].push(a); }
        const seen = new Set([start]);
        let edge = [start];
        for (let d = 0; d < Math.max(1, Math.min(4, Math.round(depth) || 1)); d++) edge = edge.flatMap((i) => nb[i].filter((j) => !seen.has(j) && seen.add(j)));
        keep = [...seen];
      } else noActive = true;
    }
    if (!s.showOrphans) { const linked = new Set(es.flat()); keep = keep.filter((i) => linked.has(i)); }
    const remap = new Map(keep.map((g, i) => [g, i]));
    const old = new Map(nodes.map((n) => [n.key, n]));
    nodes = keep.map((g, i) => {
      const it = list[g], prev = old.get(it.key);
      const colour = it.kind === "tag" ? null : groups.find((gr) => gr.test(it.subject))?.colour ?? null;
      const name = it.kind === "tag" ? `#${it.path}` : nameOf(it.path);
      const at = prev ?? { ...Sim.seed(i), vx: 0, vy: 0 };
      return { x: at.x, y: at.y, vx: at.vx, vy: at.vy, fx: null, fy: null, key: it.key, kind: it.kind, name, path: it.path, deg: 0, colour };
    });
    edges = es.filter(([a, b]) => remap.has(a) && remap.has(b)).map(([a, b]) => [remap.get(a)!, remap.get(b)!]);
    adj = nodes.map(() => new Set());
    for (const [a, b] of edges) { adj[a].add(b); adj[b].add(a); nodes[a].deg++; nodes[b].deg++; }
    sim.setGraph(nodes, edges);
    sim.reheat(old.size ? 0.6 : 1);
    count = { nodes: nodes.length, edges: edges.length };
    hover = null; tip = "";
    kick();
  }

  // ---- drawing
  function theme() {
    const st = getComputedStyle(document.documentElement), css = (v: string, d = "") => st.getPropertyValue(v).trim() || d;
    return { bg: css("--bg", "#1e1e1e"), node: css("--text-muted", "#999"), line: css("--border-strong", "#555"), text: css("--text", "#ddd"),
      accent: css("--accent", "#7b6cd9"), tag: css("--green", "#86d1a0"), file: css("--yellow", "#e8c47c"), font: css("--font-ui", "sans-serif") };
  }
  const radius = (n: GNode) => s.nodeSizeMultiplier * (4 + Math.sqrt(n.deg) * 1.5);

  function draw() {
    const dpr = window.devicePixelRatio || 1, w = wrap.clientWidth, h = wrap.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const c = canvas.getContext("2d")!, col = theme(), k = view.k;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = col.bg; c.fillRect(0, 0, w, h);
    const ox = w / 2 + view.x, oy = h / 2 + view.y;
    const X = (n: GNode) => ox + n.x * k, Y = (n: GNode) => oy + n.y * k;
    const lit = (i: number) => hover === null || i === hover || adj[hover]?.has(i);
    const active = activePath();
    // links: the hovered note's in the accent, the rest faint
    const lw = Math.max(0.4, s.lineSizeMultiplier * Math.min(1.6, Math.max(0.5, k)));
    c.lineWidth = lw;
    const stroke = (mine: boolean) => {
      c.beginPath();
      for (const [a, b] of edges) {
        if ((hover !== null && (a === hover || b === hover)) !== mine) continue;
        c.moveTo(X(nodes[a]), Y(nodes[a])); c.lineTo(X(nodes[b]), Y(nodes[b]));
      }
      c.stroke();
    };
    c.strokeStyle = col.line; c.globalAlpha = hover === null ? 0.6 : 0.12; stroke(false);
    if (hover !== null) { c.strokeStyle = col.accent; c.globalAlpha = 0.9; stroke(true); }
    if (s.showArrow) {
      c.fillStyle = col.line;
      for (const [a, b] of edges) {
        const A = nodes[a], B = nodes[b], dx = X(B) - X(A), dy = Y(B) - Y(A), d = Math.hypot(dx, dy);
        if (d < 1) continue;
        const ux = dx / d, uy = dy / d, tip0 = Math.max(1.5, radius(B) * k), size = 4 + 2 * lw;
        const px = X(B) - ux * tip0, py = Y(B) - uy * tip0;
        c.globalAlpha = hover === null ? 0.7 : lit(a) && lit(b) && (a === hover || b === hover) ? 0.9 : 0.12;
        c.beginPath(); c.moveTo(px, py); c.lineTo(px - ux * size - uy * size * 0.5, py - uy * size + ux * size * 0.5); c.lineTo(px - ux * size + uy * size * 0.5, py - uy * size - ux * size * 0.5); c.fill();
      }
    }
    // nodes
    nodes.forEach((n, i) => {
      c.globalAlpha = lit(i) ? 1 : 0.2;
      c.fillStyle = i === hover || n.path === active ? col.accent : n.kind === "tag" ? col.tag : n.kind === "attachment" ? col.file : n.colour ?? col.node;
      c.beginPath(); c.arc(X(n), Y(n), Math.max(1.5, radius(n) * k), 0, Math.PI * 2); c.fill();
    });
    // names: fading in with the zoom (Obsidian's text fade threshold); the hovered note's neighbourhood always
    const fade = Math.min(1, Math.max(0, 1 + Math.log2(k) - s.textFadeMultiplier));
    const size = Math.min(16, Math.max(9, 12 * Math.sqrt(k)));
    c.font = `${size}px ${col.font}`; c.textAlign = "center"; c.textBaseline = "top"; c.fillStyle = col.text;
    nodes.forEach((n, i) => {
      const a = hover !== null ? (lit(i) ? 1 : fade * 0.2) : fade;
      if (a <= 0.02) return;
      c.globalAlpha = a;
      c.fillText(n.name, X(n), Y(n) + Math.max(1.5, radius(n) * k) + 3);
    });
    c.globalAlpha = 1;
  }

  const shown = () => wrap?.isConnected && wrap.clientWidth > 0;
  function frame() {
    raf = 0;
    if (!shown()) return;
    if (sim.hot) {
      for (let t = sim.alpha > 0.3 ? 3 : 1; t > 0 && sim.hot; t--) sim.tick();
      if (!moved && !drag) fit();
      kick();
    }
    draw();
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }
  /** Everything in the pane. */
  function fit() {
    if (!nodes.length || !wrap) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
    const k = Math.min(2, Math.max(0.05, Math.min(wrap.clientWidth / (x1 - x0 + 120), wrap.clientHeight / (y1 - y0 + 120))));
    view = { x: -((x0 + x1) / 2) * k, y: -((y0 + y1) / 2) * k, k };
  }

  // ---- pointer
  function world(e: PointerEvent | WheelEvent) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left - r.width / 2 - view.x) / view.k, y: (e.clientY - r.top - r.height / 2 - view.y) / view.k };
  }
  function at(e: PointerEvent): number | null {
    const p = world(e);
    let best: number | null = null, bd = Infinity;
    nodes.forEach((n, i) => {
      const reach = Math.max(radius(n), 7 / view.k), d = (n.x - p.x) ** 2 + (n.y - p.y) ** 2;
      if (d < reach * reach && d < bd) { bd = d; best = i; }
    });
    return best;
  }
  let drag: { node: number | null; x: number; y: number; moved: boolean } | null = null;
  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    drag = { node: at(e), x: e.clientX, y: e.clientY, moved: false };
  }
  function move(e: PointerEvent) {
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      drag.moved = true;
      if (drag.node !== null) {
        const n = nodes[drag.node], p = world(e);
        n.fx = p.x; n.fy = p.y;
        sim.alphaTarget = 0.3; sim.reheat(0.3);
      } else { view.x += dx; view.y += dy; moved = true; }
      drag.x = e.clientX; drag.y = e.clientY;
      kick();
      return;
    }
    const h = at(e);
    if (h !== hover) {
      hover = h;
      const n = h === null ? null : nodes[h];
      tip = !n ? "" : n.kind === "tag" ? `${n.name} · ${n.deg} note${n.deg === 1 ? "" : "s"} — click to search` : `${shownPath(n.path)} · ${n.deg} link${n.deg === 1 ? "" : "s"} — click to open`;
      kick();
    }
  }
  function up(e: PointerEvent) {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.node !== null) { const n = nodes[d.node]; if (n) { n.fx = null; n.fy = null; } sim.alphaTarget = 0; }
    if (!d.moved && d.node !== null) {
      const n = nodes[d.node];
      if (n.kind === "tag") open({ kind: "search", q: `#${n.path}` });
      else openPath(n.path, undefined, { beside: e.ctrlKey || e.metaKey });
    }
    kick();
  }
  function wheel(e: WheelEvent) {
    e.preventDefault();
    const k = Math.min(8, Math.max(0.03, view.k * Math.exp(-e.deltaY * 0.0015)));
    const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2;
    view.x = mx - ((mx - view.x) / view.k) * k; view.y = my - ((my - view.y) / view.k) * k; view.k = k; moved = true;
    kick();
  }
  /** "Animate": every note from the middle again, as Obsidian's button replays the layout. */
  function animate() {
    nodes.forEach((n, i) => { const p = Sim.seed(i, 6); n.x = p.x; n.y = p.y; n.vx = 0; n.vy = 0; });
    moved = false; sim.alpha = 1; kick();
  }

  // ---- what follows what
  $effect(() => { if (ready) { void wanted; void load(); } });
  $effect(() => {
    void notes; void s.search; void s.showTags; void s.showAttachments; void s.showOrphans; void local; void depth;
    void JSON.stringify(s.colorGroups);
    if (ready) build();
  });
  $effect(() => {
    sim.forces = { centerStrength: s.centerStrength, repelStrength: s.repelStrength, linkStrength: s.linkStrength, linkDistance: s.linkDistance };
    sim.reheat(0.3); kick();
  });
  $effect(() => { void s.showArrow; void s.textFadeMultiplier; void s.nodeSizeMultiplier; void s.lineSizeMultiplier; kick(); });
  let saved = "";
  $effect(() => {
    const text = JSON.stringify(s);
    if (!ready) return;
    if (!saved) { saved = text; return; } // as read: nothing to save yet
    if (text !== saved) { saved = text; saveGraphSettings($state.snapshot(s)); }
  });

  onMount(() => {
    void loadGraphSettings().then((r) => { s = r.settings; from = r.from; ready = true; });
    const ro = new ResizeObserver(() => kick());
    ro.observe(wrap);
    const off = reloadOnChange(() => void load(), { wait: 800, wants: (p) => /\.md$/i.test(p), host: () => wrap });
    // the active note is drawn in the accent, and Local follows it
    const sub = getDock()?.onDidActivePanelChange(() => setTimeout(() => { if (local) build(); else kick(); }, 50));
    return () => { ro.disconnect(); off(); sub?.dispose(); if (raf) cancelAnimationFrame(raf); };
  });
</script>

<div class="graph-pane">
  <header>
    <span class="title">Graph</span>
    <span class="meta">{count.nodes} node{count.nodes === 1 ? "" : "s"} · {count.edges} link{count.edges === 1 ? "" : "s"}</span>
    <span class="grow"></span>
    <label class="toggle"><input type="checkbox" bind:checked={local} /> Local</label>
    {#if local && noActive}<span class="hint">no note open: showing all</span>{/if}
    {#if local}<label class="toggle">depth <input type="number" min="1" max="4" bind:value={depth} aria-label="Depth" /></label>{/if}
    <button class="btn" onclick={() => { moved = false; fit(); kick(); }} title="The whole graph in view">Fit</button>
    <button class="btn icon" class:on={!s.close} onclick={() => (s.close = !s.close)} title="Graph settings: filters, groups, display, forces" aria-label="Graph settings" aria-pressed={!s.close}><Icon name="settings" size={14} /></button>
  </header>
  <div class="canvas-wrap" bind:this={wrap}>
    <canvas bind:this={canvas} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={() => { drag = null; sim.alphaTarget = 0; }}
      onpointerleave={() => { if (!drag) { hover = null; tip = ""; kick(); } }} onwheel={wheel}
      aria-label="Graph of {count.nodes} nodes" data-testid="graph-canvas"></canvas>
    {#if ready && !s.close}<GraphControls bind:s {from} onanimate={animate} onclose={() => (s.close = true)} />{/if}
    {#if tip}<div class="tip">{tip}</div>{/if}
    {#if failed}<p class="empty">The graph could not be read: {failed}</p>
    {:else if notes && !count.nodes}<p class="empty">{notes.length ? "Nothing to show with these filters: change the search, or turn on Orphans." : "No notes yet: write a note, and link it to another with [[its name]]."}</p>{/if}
  </div>
</div>

<style>
  .graph-pane { height: 100%; display: flex; flex-direction: column; background: var(--bg); }
  header { display: flex; align-items: center; gap: 12px; padding: 6px 10px; border-bottom: 1px solid var(--border); flex-wrap: wrap; font-size: calc(12.5px * var(--ui-scale, 1)); }
  .title { color: var(--heading); font-weight: 600; }
  .meta, .hint { color: var(--text-muted); }
  .grow { flex: 1; }
  .toggle { display: inline-flex; gap: 5px; align-items: center; color: var(--text-muted); }
  .toggle input[type="number"] { width: 46px; font: inherit; color: var(--text); background: var(--bg-elev); border: 1px solid var(--border-strong); border-radius: 4px; padding: 1px 4px; }
  .btn { border: 1px solid var(--border-strong); padding: 3px 10px; border-radius: var(--radius-sm); }
  .btn.icon { display: inline-grid; place-items: center; padding: 3px 6px; }
  .btn:hover, .btn.on { background: var(--bg-hover); }
  .canvas-wrap { position: relative; flex: 1; min-height: 0; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; cursor: grab; touch-action: none; }
  canvas:active { cursor: grabbing; }
  .empty { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; padding: 24px; text-align: center; color: var(--text-muted); font-size: calc(13px * var(--ui-scale, 1)); pointer-events: none; }
  .tip { position: absolute; left: 12px; bottom: 10px; font-size: calc(12px * var(--ui-scale, 1)); color: var(--text-muted); background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 3px 8px; pointer-events: none; }
</style>
