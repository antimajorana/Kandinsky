// The graph view's force layout, with Obsidian's four forces as its settings (Settings of the graph: Forces):
// every pair of nodes repels (Barnes–Hut, so a big vault stays fast), each link is a spring pulled to the link
// distance, and the centre pulls everything in. The motion cools down (alpha) and stops when the layout is at
// rest, so a still graph costs nothing; dragging a node warms it up again. No imports: tested on its own.

export interface SimNode { x: number; y: number; vx: number; vy: number; /** held by the pointer: placed here, not moved */ fx: number | null; fy: number | null }
/** Obsidian's graph.json names and ranges: centre 0–1, repel 0–20, link 0–1, distance 30–500. */
export interface Forces { centerStrength: number; repelStrength: number; linkStrength: number; linkDistance: number }

const THETA2 = 0.81; // Barnes–Hut: a cell this small for its distance (side/distance < 0.9) acts as one body
const MAX_DEPTH = 12; // nodes on one spot never split the tree forever
// The scales that turn Obsidian's slider values into this layout's units (tuned so the defaults spread a few
// hundred notes over a readable disc).
const REPEL = 30, CENTER = 0.12;

/** A quadtree cell: its bounds, its children (four, or none), the mass under it and their summed position. */
interface Cell { x: number; y: number; s: number; kids: Cell[] | null; n: number; sx: number; sy: number; one: number }

export class Sim {
  nodes: SimNode[] = [];
  private src: Int32Array = new Int32Array(0);
  private dst: Int32Array = new Int32Array(0);
  private bias: Float64Array = new Float64Array(0);
  private strength: Float64Array = new Float64Array(0);
  alpha = 1;
  alphaTarget = 0;
  readonly alphaMin = 0.001;
  readonly alphaDecay = 1 - Math.pow(0.001, 1 / 300); // from 1 to rest in about 300 steps
  readonly velocityDecay = 0.4;
  forces: Forces;

  constructor(forces: Forces) { this.forces = { ...forces }; }

  /** New nodes and links (indices into `nodes`). Nodes keep the positions they come with. */
  setGraph(nodes: SimNode[], links: [number, number][]): void {
    this.nodes = nodes;
    const deg = new Int32Array(nodes.length);
    const kept = links.filter(([a, b]) => a !== b && a >= 0 && b >= 0 && a < nodes.length && b < nodes.length);
    for (const [a, b] of kept) { deg[a]++; deg[b]++; }
    this.src = Int32Array.from(kept.map((l) => l[0]));
    this.dst = Int32Array.from(kept.map((l) => l[1]));
    // as d3 does: a link pulls the less connected end more, and a hub's many links each pull it gently
    this.bias = Float64Array.from(kept.map(([a, b]) => deg[a] / (deg[a] + deg[b])));
    this.strength = Float64Array.from(kept.map(([a, b]) => 1 / Math.min(deg[a], deg[b])));
  }

  /** Nodes with no position yet are laid on a sunflower spiral (even, and the same every time). */
  static seed(i: number, spacing = 30): { x: number; y: number } {
    const r = spacing * Math.sqrt(0.5 + i), a = i * Math.PI * (3 - Math.sqrt(5));
    return { x: r * Math.cos(a), y: r * Math.sin(a) };
  }

  /** Still moving (or held)? When false, the drawing can stop asking for frames. */
  get hot(): boolean { return this.alpha >= this.alphaMin || this.alphaTarget > 0; }

  /** Moves everything again (after a change of forces, or "Animate"). */
  reheat(alpha = 1): void { this.alpha = Math.max(this.alpha, alpha); }

  tick(): void {
    const ns = this.nodes, n = ns.length;
    if (!n) { this.alpha = 0; return; }
    this.alpha += (this.alphaTarget - this.alpha) * this.alphaDecay;
    const alpha = this.alpha, f = this.forces;
    // repulsion: each node against the tree's cells
    const root = this.build();
    const k = -f.repelStrength * REPEL * alpha;
    if (k) for (let i = 0; i < n; i++) this.repel(root, i, k);
    // links: springs towards the link distance
    const ls = Math.max(0, f.linkStrength);
    for (let l = 0; l < this.src.length; l++) {
      const a = ns[this.src[l]], b = ns[this.dst[l]];
      let dx = b.x + b.vx - a.x - a.vx || 1e-6, dy = b.y + b.vy - a.y - a.vy || 1e-6;
      const d = Math.sqrt(dx * dx + dy * dy);
      const m = ((d - f.linkDistance) / d) * alpha * ls * this.strength[l];
      dx *= m; dy *= m;
      const bi = this.bias[l];
      b.vx -= dx * bi; b.vy -= dy * bi; a.vx += dx * (1 - bi); a.vy += dy * (1 - bi);
    }
    // centre: a pull towards the middle, stronger the farther out
    const c = Math.max(0, f.centerStrength) * CENTER * alpha;
    for (const p of ns) {
      if (p.fx !== null && p.fy !== null) { p.x = p.fx; p.y = p.fy; p.vx = 0; p.vy = 0; continue; }
      p.vx -= p.x * c; p.vy -= p.y * c;
      p.vx *= 1 - this.velocityDecay; p.vy *= 1 - this.velocityDecay;
      p.x += p.vx; p.y += p.vy;
    }
  }

  /** The Barnes–Hut tree over the nodes' current places. */
  private build(): Cell {
    const ns = this.nodes;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of ns) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
    const s = Math.max(x1 - x0, y1 - y0, 1) * 1.0001;
    const root: Cell = { x: x0, y: y0, s, kids: null, n: 0, sx: 0, sy: 0, one: -1 };
    for (let i = 0; i < ns.length; i++) this.insert(root, i, 0);
    return root;
  }

  private insert(c: Cell, i: number, depth: number): void {
    const p = this.nodes[i];
    for (;;) {
      c.n++; c.sx += p.x; c.sy += p.y;
      if (c.kids) { c = this.child(c, p.x, p.y); depth++; continue; }
      if (c.n === 1) { c.one = i; return; } // an empty leaf takes it
      if (depth >= MAX_DEPTH) return; // a crowded spot: mass only
      const h = c.s / 2;
      c.kids = [0, 1, 2, 3].map((q) => ({ x: c.x + (q & 1 ? h : 0), y: c.y + (q & 2 ? h : 0), s: h, kids: null, n: 0, sx: 0, sy: 0, one: -1 }));
      const old = c.one; c.one = -1;
      if (old >= 0) { const o = this.nodes[old], oc = this.child(c, o.x, o.y); oc.n = 1; oc.sx = o.x; oc.sy = o.y; oc.one = old; }
      c = this.child(c, p.x, p.y); depth++;
    }
  }

  private child(c: Cell, x: number, y: number): Cell {
    const h = c.s / 2;
    return c.kids![(x >= c.x + h ? 1 : 0) + (y >= c.y + h ? 2 : 0)];
  }

  private repel(root: Cell, i: number, k: number): void {
    const p = this.nodes[i];
    const stack: Cell[] = [root];
    while (stack.length) {
      const c = stack.pop()!;
      if (!c.n || c.one === i) continue;
      const cx = c.sx / c.n, cy = c.sy / c.n;
      let dx = cx - p.x, dy = cy - p.y;
      let d2 = dx * dx + dy * dy;
      if (c.kids && c.s * c.s > THETA2 * d2) { stack.push(...c.kids); continue; }
      if (!c.kids && c.one < 0) continue; // a crowded leaf with this node in it: its mass is mostly here
      if (d2 < 1) { dx = (Math.random() - 0.5) * 1e-3; dy = (Math.random() - 0.5) * 1e-3; d2 = 1; } // two on one spot: nudge apart
      const w = (k * c.n) / d2;
      p.vx += dx * w; p.vy += dy * w;
    }
  }
}
