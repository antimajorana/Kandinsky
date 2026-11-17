<script lang="ts">
  // Graph view ("Several Circles" mode, after Wassily Kandinsky, 1926): every note is a luminous translucent circle
  // tinted by its semantic vault domain with a soft radial halo, concentric double-ring orbit halos on hover/focus,
  // a Barnes–Hut force layout (lib/graph/sim.ts), and Obsidian's settings card — Filters, Groups, Display and Forces —
  // read from `.kandinsky/graph.json` or `.obsidian/graph.json` (lib/graph/settings.ts). Hover lights a note and its
  // neighbours; click opens it (Ctrl/Cmd+click beside); drag moves a note; wheel zooms; drag the background pans.
  import { onMount } from "svelte";
  import Icon from "../components/Icon.svelte";
  import GraphControls from "../components/GraphControls.svelte";
  import { errText } from "../lib/text";
  import { shownPath } from "../lib/paths";
  import { reloadOnChange } from "../lib/reload-on-change";
  import { getDock, open, openPath } from "../lib/dock";
  import { editors, lastEditorId } from "../lib/registry";
  import { app } from "../lib/state.svelte";
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
  let allNotes = $state.raw<NoteData[] | null>(null);
  let notes = $state.raw<NoteData[] | null>(null);
  let tagFilter = $state("");
  let folderFilter = $state("");
  let failed = $state("");
  let local = $state(false);
  let depth = $state(1);
  let noActive = $state(false);
  let count = $state({ nodes: 0, edges: 0 });
  let tip = $state("");
  let tipDomain = $state<Domain>("concepts");
  let tipCustomColor = $state<string | null>(null);
  let paneSize = $state({ w: 0, h: 0 });
  let domTheme = $state<"dark" | "light" | null>(null);

  type Kind = "note" | "tag" | "attachment";
  type Domain = "concepts" | "sources" | "entities" | "problems" | "notebooks" | "meta" | "other";

  /** Kandinsky "Several Circles" (1926) domain pigments for Velvet Circles (dark) and Bauhaus Paper (light). */
  const PIGMENTS: Record<Domain, { dark: string; light: string; label: string }> = {
    concepts:  { dark: "#7d97f4", light: "#264ca4", label: "Concepts" },
    sources:   { dark: "#3ca395", light: "#247a7d", label: "Sources" },
    entities:  { dark: "#d48fb0", light: "#9b4dca", label: "Entities" },
    problems:  { dark: "#dfab2e", light: "#c48b16", label: "Problems" },
    notebooks: { dark: "#e28327", light: "#cf6d17", label: "Notebooks" },
    meta:      { dark: "#5fb3ce", light: "#2a7ca3", label: "Meta" },
    other:     { dark: "#d94e41", light: "#c6362c", label: "Notes" },
  };
  const LEGEND_DOMAINS: Domain[] = ["concepts", "sources", "entities", "problems"];

  const lightMode = $derived((domTheme ?? app.theme) === "light");
  const tipDotColor = $derived(tipCustomColor ?? PIGMENTS[tipDomain][lightMode ? "light" : "dark"]);
  const showLegend = $derived(count.nodes > 0 && !failed && paneSize.w >= 380 && paneSize.h >= 240 && (s.close || paneSize.w >= 620));

  function domainOf(path: string, kind: Kind): Domain {
    if (kind === "tag") return "meta";
    const low = path.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
    const base = low.split("/").pop() ?? low;
    if (/\.(ipynb|wln)$/i.test(base) || low.startsWith("notebooks/") || low.includes("/notebooks/")) return "notebooks";
    if (/\.pdf$/i.test(base) || low.startsWith("wiki/sources/") || low === "wiki/sources" || low.startsWith("zai/papers/") || low.startsWith("papers/") || low.includes("/papers/")) return "sources";
    if (low.startsWith("wiki/entities/") || low.startsWith("entities/") || low.includes("/entities/")) return "entities";
    if (low.startsWith("problems/") || low.includes("/problems/")) return "problems";
    if (low.startsWith("wiki/concepts/") || low.startsWith("concepts/") || low.includes("/concepts/") || low.startsWith("wiki/lectures/")) return "concepts";
    if (low.startsWith("wiki/meta/") || low.startsWith("zai/") || low.startsWith("zmeta/") || low.startsWith("genkan/") || low.startsWith(".agents/") || low.startsWith(".claude/") || /^(agents|claude|gemini)\.md$/i.test(base) || /^wiki\/(hot|index|log|overview)\.md$/i.test(low)) return "meta";
    return kind === "attachment" ? "notebooks" : "other";
  }

  interface RGB { r: number; g: number; b: number }
  const rgbCache = new Map<string, RGB>();
  function parseRgb(color: string): RGB {
    const hit = rgbCache.get(color);
    if (hit) return hit;
    let out: RGB = { r: 125, g: 151, b: 244 };
    const hex = color.trim();
    if (/^#[0-9a-f]{6}$/i.test(hex)) {
      const n = parseInt(hex.slice(1), 16);
      out = { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    } else if (/^#[0-9a-f]{3}$/i.test(hex)) {
      out = { r: parseInt(hex[1] + hex[1], 16), g: parseInt(hex[2] + hex[2], 16), b: parseInt(hex[3] + hex[3], 16) };
    } else {
      const m = hex.match(/rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)/i);
      if (m) out = { r: +m[1], g: +m[2], b: +m[3] };
    }
    rgbCache.set(color, out);
    return out;
  }
  const rgba = ({ r, g, b }: RGB, a: number) => `rgba(${r}, ${g}, ${b}, ${a})`;
  const WHITE: RGB = { r: 255, g: 255, b: 255 };

  type GNode = SimNode & { key: string; kind: Kind; domain: Domain; name: string; path: string; deg: number; colour: string | null };
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
  const pigmentHex = (n: GNode, light: boolean) => n.colour ?? PIGMENTS[n.domain][light ? "light" : "dark"];

  /** The properties the filter and the groups read: asked for in the notes' query. */
  const wanted = $derived([...new Set([s.search, ...s.colorGroups.map((g) => g.query)].flatMap(propertiesIn))].sort().join("\n"));

  const availableTags = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const n of allNotes ?? []) {
      for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12).map(([t]) => t);
  });

  const availableFolders = $derived.by(() => {
    const set = new Set<string>();
    for (const n of allNotes ?? []) {
      const idx = n.path.indexOf("/");
      if (idx > 0) set.add(n.path.slice(0, idx));
    }
    return [...set].sort((a, b) => a.localeCompare(b)).slice(0, 12);
  });

  async function load() {
    try { allNotes = await loadNotes(wanted ? wanted.split("\n") : []); failed = ""; }
    catch (e) { failed = errText(e); }
  }

  $effect(() => {
    if (!allNotes) { notes = null; return; }
    if (!tagFilter && !folderFilter) { notes = allNotes; return; }
    notes = allNotes.filter(
      (n) => (!tagFilter || n.tags.includes(tagFilter)) && (!folderFilter || n.path.startsWith(`${folderFilter}/`)),
    );
  });

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
      const domain = domainOf(it.path, it.kind);
      const name = it.kind === "tag" ? `#${it.path}` : nameOf(it.path);
      const at = prev ?? { ...Sim.seed(i), vx: 0, vy: 0 };
      return { x: at.x, y: at.y, vx: at.vx, vy: at.vy, fx: null, fy: null, key: it.key, kind: it.kind, domain, name, path: it.path, deg: 0, colour };
    });
    edges = es.filter(([a, b]) => remap.has(a) && remap.has(b)).map(([a, b]) => [remap.get(a)!, remap.get(b)!]);
    adj = nodes.map(() => new Set());
    for (const [a, b] of edges) { adj[a].add(b); adj[b].add(a); nodes[a].deg++; nodes[b].deg++; }
    sim.setGraph(nodes, edges);
    sim.reheat(old.size ? 0.6 : 1);
    count = { nodes: nodes.length, edges: edges.length };
    hover = null; tip = ""; tipCustomColor = null;
    kick();
  }

  // ---- drawing ("Several Circles" luminous halos + concentric orbits)
  function theme() {
    const st = getComputedStyle(document.documentElement), css = (v: string, d = "") => st.getPropertyValue(v).trim() || d;
    return {
      bg: css("--bg", lightMode ? "#faf8f4" : "#15161a"),
      line: css("--border-strong", lightMode ? "rgba(30, 32, 36, 0.22)" : "rgba(237, 235, 230, 0.22)"),
      text: css("--text", lightMode ? "#222428" : "#e8e6e1"),
      font: css("--font-ui", "sans-serif"),
    };
  }
  const radius = (n: GNode) => s.nodeSizeMultiplier * (4 + Math.sqrt(Math.min(n.deg, 64)) * 1.5);

  function draw() {
    const dpr = window.devicePixelRatio || 1, w = wrap.clientWidth, h = wrap.clientHeight;
    if (w <= 0 || h <= 0) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const c = canvas.getContext("2d");
    if (!c) return;
    const light = lightMode, col = theme(), k = view.k;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = col.bg;
    c.fillRect(0, 0, w, h);

    const ox = w / 2 + view.x, oy = h / 2 + view.y;
    const X = (n: GNode) => ox + n.x * k, Y = (n: GNode) => oy + n.y * k;
    const hoverIdx = hover !== null && hover >= 0 && hover < nodes.length ? hover : null;
    const active = activePath();
    const activeFound = active ? nodes.findIndex((n) => n.path === active) : -1;
    const activeIdx = activeFound >= 0 ? activeFound : null;
    const focusIdx = hoverIdx ?? activeIdx;
    const lit = (i: number) => hoverIdx === null || i === hoverIdx || Boolean(adj[hoverIdx]?.has(i));

    // 1. Links: calm draftsman hairlines at rest; incident links tinted with the hovered/focused node's pigment
    const lw = Math.max(0.45, s.lineSizeMultiplier * Math.min(1.6, Math.max(0.55, k)));
    c.lineWidth = lw;
    c.strokeStyle = col.line;
    c.globalAlpha = hoverIdx !== null ? 0.12 : light ? 0.36 : 0.42;
    c.beginPath();
    for (const [a, b] of edges) {
      if (focusIdx !== null && (a === focusIdx || b === focusIdx)) continue;
      c.moveTo(X(nodes[a]), Y(nodes[a]));
      c.lineTo(X(nodes[b]), Y(nodes[b]));
    }
    c.stroke();

    const focusHex = focusIdx !== null ? pigmentHex(nodes[focusIdx], light) : "";
    if (focusIdx !== null) {
      const focusRgb = parseRgb(focusHex);
      c.lineWidth = hoverIdx !== null ? lw * 1.3 : lw * 1.15;
      c.strokeStyle = rgba(focusRgb, hoverIdx !== null ? (light ? 0.78 : 0.86) : (light ? 0.56 : 0.66));
      c.globalAlpha = 1;
      c.beginPath();
      for (const [a, b] of edges) {
        if (a !== focusIdx && b !== focusIdx) continue;
        c.moveTo(X(nodes[a]), Y(nodes[a]));
        c.lineTo(X(nodes[b]), Y(nodes[b]));
      }
      c.stroke();
    }

    if (s.showArrow) {
      for (const [a, b] of edges) {
        const A = nodes[a], B = nodes[b], dx = X(B) - X(A), dy = Y(B) - Y(A), d = Math.hypot(dx, dy);
        if (d < 1) continue;
        const isFocusEdge = focusIdx !== null && (a === focusIdx || b === focusIdx);
        const ux = dx / d, uy = dy / d, tip0 = Math.max(2, radius(B) * k), size = 4 + 2 * lw;
        const px = X(B) - ux * tip0, py = Y(B) - uy * tip0;
        c.fillStyle = isFocusEdge ? focusHex : col.line;
        c.globalAlpha = hoverIdx !== null ? (isFocusEdge ? 0.88 : 0.12) : isFocusEdge ? 0.72 : light ? 0.48 : 0.56;
        c.beginPath();
        c.moveTo(px, py);
        c.lineTo(px - ux * size - uy * size * 0.5, py - uy * size + ux * size * 0.5);
        c.lineTo(px - ux * size + uy * size * 0.5, py - uy * size - ux * size * 0.5);
        c.fill();
      }
    }

    // 2. Nodes: background/dimmed first, lit neighbourhood next, active & hovered concentric orbits on top
    c.globalAlpha = 1;
    const order: number[] = [];
    const litNeighbors: number[] = [];
    for (let i = 0; i < nodes.length; i++) {
      if (i === hoverIdx || i === activeIdx) continue;
      if (hoverIdx !== null && lit(i)) litNeighbors.push(i);
      else order.push(i);
    }
    for (const i of litNeighbors) order.push(i);
    if (activeIdx !== null && activeIdx !== hoverIdx) order.push(activeIdx);
    if (hoverIdx !== null) order.push(hoverIdx);

    for (const i of order) {
      const n = nodes[i];
      const x = X(n), y = Y(n);
      const r = Math.max(2, radius(n) * k);
      const margin = Math.max(48, r * 4.2);
      if (x < -margin || x > w + margin || y < -margin || y > h + margin) continue;

      const hex = pigmentHex(n, light);
      const rgb = parseRgb(hex);
      const isHover = i === hoverIdx;
      const isActive = i === activeIdx;
      const isLit = lit(i);

      if (isHover || isActive) {
        const mul = isHover ? 1 : hoverIdx !== null && !isLit ? 0.34 : 0.92;
        const outerR = isHover ? r * 3.35 + 9 : r * 2.85 + 6;
        const orbitR = isHover ? r * 1.68 + 4.5 : r * 1.48 + 3.5;
        const coreR = isHover ? r * 1.08 : r;

        // Outer radial glow wash
        const wash = c.createRadialGradient(x, y, r * 0.35, x, y, outerR);
        wash.addColorStop(0, rgba(rgb, (light ? 0.34 : 0.46) * mul));
        wash.addColorStop(0.45, rgba(rgb, (light ? 0.15 : 0.21) * mul));
        wash.addColorStop(0.78, rgba(rgb, (light ? 0.05 : 0.07) * mul));
        wash.addColorStop(1, rgba(rgb, 0));
        c.fillStyle = wash;
        c.beginPath();
        c.arc(x, y, outerR, 0, Math.PI * 2);
        c.fill();

        // Translucent Bauhaus concentric disc + 1px crisp concentric orbit ring
        c.fillStyle = rgba(rgb, (light ? 0.10 : 0.14) * mul);
        c.beginPath();
        c.arc(x, y, orbitR, 0, Math.PI * 2);
        c.fill();

        c.lineWidth = 1;
        c.strokeStyle = rgba(rgb, (isHover ? (light ? 0.82 : 0.90) : (light ? 0.62 : 0.72)) * mul);
        c.beginPath();
        c.arc(x, y, orbitR, 0, Math.PI * 2);
        c.stroke();

        // Bright luminous inner core
        c.fillStyle = rgba(rgb, (light ? 0.96 : 0.98) * mul);
        c.beginPath();
        c.arc(x, y, coreR, 0, Math.PI * 2);
        c.fill();

        c.lineWidth = 1;
        c.strokeStyle = rgba(WHITE, (light ? 0.68 : 0.50) * mul);
        c.beginPath();
        c.arc(x, y, Math.max(1, coreR - 0.5), 0, Math.PI * 2);
        c.stroke();
      } else {
        const dim = isLit ? 1 : 0.18;
        if (isLit && r >= 2) {
          const haloR = r * 2.25 + 1.5;
          const halo = c.createRadialGradient(x, y, r * 0.3, x, y, haloR);
          halo.addColorStop(0, rgba(rgb, light ? 0.24 : 0.32));
          halo.addColorStop(0.52, rgba(rgb, light ? 0.09 : 0.13));
          halo.addColorStop(1, rgba(rgb, 0));
          c.fillStyle = halo;
          c.beginPath();
          c.arc(x, y, haloR, 0, Math.PI * 2);
          c.fill();
        } else {
          c.fillStyle = rgba(rgb, (light ? 0.09 : 0.11) * dim);
          c.beginPath();
          c.arc(x, y, r * 1.7, 0, Math.PI * 2);
          c.fill();
        }

        // Crisp luminous inner core circle
        c.fillStyle = rgba(rgb, (light ? 0.88 : 0.90) * dim);
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fill();

        if (isLit && r >= 3) {
          c.lineWidth = 0.75;
          c.strokeStyle = light ? rgba(rgb, 0.98) : rgba(WHITE, 0.22);
          c.stroke();
        }
      }
    }

    // 3. Labels: fading in with zoom (Obsidian's text fade threshold); hovered neighbourhood & active note stay legible
    const fade = Math.min(1, Math.max(0, 1 + Math.log2(k) - s.textFadeMultiplier));
    const size = Math.min(15.5, Math.max(9.5, 12 * Math.sqrt(k)));
    c.font = `${size}px ${col.font}`;
    c.textAlign = "center";
    c.textBaseline = "top";
    c.lineJoin = "round";
    c.lineWidth = 3;
    c.strokeStyle = col.bg;
    c.fillStyle = col.text;
    for (const i of order) {
      const n = nodes[i];
      const isHover = i === hoverIdx;
      const isActive = i === activeIdx;
      const a = hoverIdx !== null
        ? (lit(i) ? 1 : fade * 0.16)
        : (isActive ? Math.max(fade, 0.85) : fade);
      if (a <= 0.02) continue;
      const x = X(n), y = Y(n);
      if (x < -120 || x > w + 120 || y < -40 || y > h + 40) continue;
      const r = Math.max(2, radius(n) * k);
      const offset = (isHover ? r * 1.68 + 4.5 : isActive ? r * 1.48 + 3.5 : r) + 4;
      c.globalAlpha = a * 0.78;
      c.strokeText(n.name, x, y + offset);
      c.globalAlpha = a;
      c.fillText(n.name, x, y + offset);
    }
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
      if (!n) {
        tip = "";
        tipCustomColor = null;
      } else {
        tipDomain = n.domain;
        tipCustomColor = n.colour;
        tip = n.kind === "tag"
          ? `${n.name} · ${n.deg} note${n.deg === 1 ? "" : "s"} — click to search`
          : `${shownPath(n.path)} · ${n.deg} link${n.deg === 1 ? "" : "s"} — click to open`;
      }
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
  $effect(() => { void s.showArrow; void s.textFadeMultiplier; void s.nodeSizeMultiplier; void s.lineSizeMultiplier; void lightMode; kick(); });
  let saved = "";
  $effect(() => {
    const text = JSON.stringify(s);
    if (!ready) return;
    if (!saved) { saved = text; return; } // as read: nothing to save yet
    if (text !== saved) { saved = text; saveGraphSettings($state.snapshot(s)); }
  });

  onMount(() => {
    void loadGraphSettings().then((r) => { s = r.settings; from = r.from; ready = true; });
    const syncSize = () => {
      if (wrap) paneSize = { w: wrap.clientWidth, h: wrap.clientHeight };
      kick();
    };
    syncSize();
    const ro = new ResizeObserver(syncSize);
    ro.observe(wrap);

    const syncDomTheme = () => {
      const dt = document.documentElement.dataset.theme;
      domTheme = dt === "light" || dt === "dark" ? dt : null;
    };
    syncDomTheme();
    const mo = new MutationObserver(() => { syncDomTheme(); kick(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-palette", "style", "class"] });

    const off = reloadOnChange(() => void load(), { wait: 800, wants: (p) => /\.(md|ipynb|wln|pdf)$/i.test(p), host: () => wrap });
    // the active note gets its concentric orbit halo, and Local follows it
    const sub = getDock()?.onDidActivePanelChange(() => setTimeout(() => { if (local) build(); else kick(); }, 50));
    return () => { ro.disconnect(); mo.disconnect(); off(); sub?.dispose(); if (raf) cancelAnimationFrame(raf); };
  });
</script>

<div class="graph-pane">
  <header>
    <span class="title">Graph</span>
    <span class="meta">{count.nodes} node{count.nodes === 1 ? "" : "s"} · {count.edges} link{count.edges === 1 ? "" : "s"}</span>
    <div class="pill-filters" role="group" aria-label="Quick graph filters">
      {#if availableTags.length > 0}
        <select class="pill-select" aria-label="Filter by tag" bind:value={tagFilter} data-testid="graph-tag-filter">
          <option value="">All #tags</option>
          {#each availableTags as t (t)}<option value={t}>#{t}</option>{/each}
        </select>
      {/if}
      {#if availableFolders.length > 0}
        <select class="pill-select" aria-label="Filter by folder" bind:value={folderFilter} data-testid="graph-folder-filter">
          <option value="">All folders</option>
          {#each availableFolders as f (f)}<option value={f}>{f}/</option>{/each}
        </select>
      {/if}
      <button type="button" class="pill-btn" class:on={!s.showOrphans} aria-pressed={!s.showOrphans} onclick={() => { s.showOrphans = !s.showOrphans; }} data-testid="graph-hide-orphans">
        Hide orphans
      </button>
    </div>
    <span class="grow"></span>
    <button type="button" class="pill-btn" class:on={local} aria-pressed={local} onclick={() => (local = !local)} data-testid="graph-local-toggle">Local</button>
    {#if local && noActive}<span class="hint">no note open: showing all</span>{/if}
    {#if local}
      <div class="hop-pills" role="group" aria-label="Local hop depth">
        {#each [1, 2, 3] as h (h)}
          <button type="button" class="pill-btn" class:on={depth === h} aria-pressed={depth === h} onclick={() => (depth = h)}>{h} hop{h === 1 ? "" : "s"}</button>
        {/each}
      </div>
    {/if}
    <button class="btn" onclick={() => { moved = false; fit(); kick(); }} title="The whole graph in view">Fit</button>
    <button class="btn icon" class:on={!s.close} onclick={() => (s.close = !s.close)} title="Graph settings: filters, groups, display, forces" aria-label="Graph settings" aria-pressed={!s.close}><Icon name="settings" size={14} /></button>
  </header>
  <div class="canvas-wrap" bind:this={wrap}>
    <canvas bind:this={canvas} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={() => { drag = null; sim.alphaTarget = 0; }}
      onpointerleave={() => { if (!drag) { hover = null; tip = ""; tipCustomColor = null; kick(); } }} onwheel={wheel}
      aria-label="Graph of {count.nodes} nodes" data-testid="graph-canvas"></canvas>
    {#if ready && !s.close}<GraphControls bind:s {from} onanimate={animate} onclose={() => (s.close = true)} />{/if}
    {#if showLegend}
      <div class="legend" class:yield={Boolean(tip) && paneSize.w < 640} aria-label="Domain legend">
        {#each LEGEND_DOMAINS as dom (dom)}
          <span class="legend-item"><span class="legend-dot" style="--dot: {lightMode ? PIGMENTS[dom].light : PIGMENTS[dom].dark}" aria-hidden="true"></span>{PIGMENTS[dom].label}</span>
        {/each}
      </div>
    {/if}
    {#if tip}
      <div class="tip" class:with-legend={showLegend && paneSize.w >= 640}>
        <span class="tip-dot" style="--dot: {tipDotColor}" aria-hidden="true"></span>
        <span class="tip-text">{tip}</span>
      </div>
    {/if}
    {#if failed}<p class="empty">The graph could not be read: {failed}</p>
    {:else if notes && !count.nodes}<p class="empty">{allNotes?.length ? "Nothing to show with these filters: clear filters, or turn off Hide orphans." : "No notes yet: write a note, and link it to another with [[its name]]."}</p>{/if}
  </div>
</div>

<style>
  .graph-pane { height: 100%; display: flex; flex-direction: column; background: var(--bg); }
  header { display: flex; align-items: center; gap: 12px; padding: 6px 12px; border-bottom: 1px solid var(--border); flex-wrap: wrap; font-size: calc(12.5px * var(--ui-scale, 1)); }
  .title { color: var(--heading); font-weight: 600; letter-spacing: -0.01em; }
  .meta, .hint { color: var(--text-muted); }
  .grow { flex: 1; }
  .pill-filters, .hop-pills { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .pill-select { padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font: inherit; font-size: calc(11.5px * var(--ui-scale, 1)); cursor: pointer; max-width: 130px; }
  .pill-select:focus { outline: none; border-color: var(--accent); }
  .pill-btn { padding: 2px 9px; border-radius: 999px; border: 1px solid var(--border); background: var(--bg); color: var(--text-muted); font: inherit; font-size: calc(11.5px * var(--ui-scale, 1)); transition: background 120ms ease, color 120ms ease, border-color 120ms ease; }
  .pill-btn:hover { background: var(--bg-hover); color: var(--text); }
  .pill-btn.on { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); font-weight: 500; }
  .btn { border: 1px solid var(--border); padding: 3px 10px; border-radius: var(--radius-sm); color: var(--text-muted); transition: background 120ms ease, color 120ms ease; }
  .btn.icon { display: inline-grid; place-items: center; padding: 3px 6px; }
  .btn:hover, .btn.on { background: var(--bg-hover); color: var(--text); }
  .canvas-wrap { position: relative; flex: 1; min-height: 0; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; cursor: grab; touch-action: none; }
  canvas:active { cursor: grabbing; }
  .empty { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; padding: 24px; text-align: center; color: var(--text-muted); font-size: calc(13px * var(--ui-scale, 1)); pointer-events: none; }
  .legend { position: absolute; right: 12px; bottom: 10px; display: inline-flex; align-items: center; gap: 11px; padding: 4px 11px; border-radius: 999px; background: color-mix(in srgb, var(--bg-elev) 84%, transparent); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border: 1px solid var(--border); color: var(--text-muted); font-size: calc(11.5px * var(--ui-scale, 1)); line-height: 1.2; pointer-events: none; user-select: none; transition: opacity 140ms ease; z-index: 1; }
  .legend.yield { opacity: 0; }
  .legend-item { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
  .legend-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dot); box-shadow: 0 0 0 2.5px color-mix(in srgb, var(--dot) 24%, transparent); flex-shrink: 0; }
  .tip { position: absolute; left: 12px; bottom: 10px; display: inline-flex; align-items: center; gap: 6px; max-width: calc(100% - 24px); font-size: calc(12px * var(--ui-scale, 1)); color: var(--text-muted); background: color-mix(in srgb, var(--bg-elev) 90%, transparent); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border: 1px solid var(--border); border-radius: 999px; padding: 3px 10px; pointer-events: none; z-index: 1; }
  .tip.with-legend { max-width: calc(100% - 320px); }
  .tip-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dot); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dot) 28%, transparent); flex-shrink: 0; }
  .tip-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
