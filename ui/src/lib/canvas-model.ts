// JSON Canvas 1.0 data model, Bauhaus pigment mapping, and edge/viewport geometry.
// Spec: https://jsoncanvas.org/spec/1.0/ — unknown properties on doc, nodes, and edges round-trip losslessly.

export type Side = "top" | "right" | "bottom" | "left";
export type EdgeEnd = "none" | "arrow";
export type CanvasBackgroundStyle = "cover" | "ratio" | "repeat";
export type CanvasColor = "1" | "2" | "3" | "4" | "5" | "6" | (string & {});

export interface CanvasNodeBase {
  [extra: string]: unknown;
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: CanvasColor;
}

export interface CanvasTextNode extends CanvasNodeBase { type: "text"; text: string }
export interface CanvasFileNode extends CanvasNodeBase { type: "file"; file: string; subpath?: string }
export interface CanvasLinkNode extends CanvasNodeBase { type: "link"; url: string }
export interface CanvasGroupNode extends CanvasNodeBase {
  type: "group";
  label?: string;
  background?: string;
  backgroundStyle?: CanvasBackgroundStyle;
}

export type CanvasNode = CanvasTextNode | CanvasFileNode | CanvasLinkNode | CanvasGroupNode;

export interface CanvasEdge {
  [extra: string]: unknown;
  id: string;
  fromNode: string;
  fromSide?: Side;
  fromEnd?: EdgeEnd;
  toNode: string;
  toSide?: Side;
  toEnd?: EdgeEnd;
  color?: CanvasColor;
  label?: string;
}

export interface CanvasDoc {
  [extra: string]: unknown;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface CanvasBounds { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number }
export interface EdgeGeometry {
  d: string; x1: number; y1: number; x2: number; y2: number; mx: number; my: number; fromSide: Side; toSide: Side;
}

export const SIDES: readonly Side[] = ["top", "right", "bottom", "left"];

/** Obsidian Canvas preset colors "1".."6" mapped to Kandinsky's Bauhaus Several Circles pigments. */
export const CANVAS_PRESET_COLORS: readonly { id: "1" | "2" | "3" | "4" | "5" | "6"; label: string; css: string }[] = [
  { id: "1", label: "Vermilion", css: "var(--red)" },
  { id: "2", label: "Amber", css: "var(--orange)" },
  { id: "3", label: "Ochre", css: "var(--yellow)" },
  { id: "4", label: "Viridian", css: "var(--green)" },
  { id: "5", label: "Cyan", css: "var(--cyan, #4aa8b8)" },
  { id: "6", label: "Cobalt", css: "var(--accent)" },
];

const PRESET_MAP = new Map<string, string>(CANVAS_PRESET_COLORS.map((p) => [p.id, p.css]));
const HEX_COLOR_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Resolves an Obsidian preset ("1".."6") or custom #hex string into a safe CSS color value. */
export function resolveCanvasColor(color?: string): string | null {
  if (!color) return null;
  const trimmed = color.trim();
  return PRESET_MAP.get(trimmed) ?? (HEX_COLOR_RE.test(trimmed) ? trimmed : null);
}

/** Generates a random 16-hex-character ID matching Obsidian Canvas conventions (e.g. "a1b2c3d4e5f60718"). */
export function canvasId(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") crypto.getRandomValues(bytes);
  else for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const isSide = (v: unknown): v is Side => v === "top" || v === "right" || v === "bottom" || v === "left";
const isEnd = (v: unknown): v is EdgeEnd => v === "none" || v === "arrow";
const isBgStyle = (v: unknown): v is CanvasBackgroundStyle => v === "cover" || v === "ratio" || v === "repeat";
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

function normalizeNode(raw: unknown): CanvasNode | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && r.id ? r.id : canvasId();
  const x = num(r.x, 0), y = num(r.y, 0);
  const width = Math.max(40, num(r.width, 260)), height = Math.max(40, num(r.height, 140));
  const color = typeof r.color === "string" && r.color ? r.color : undefined;
  const base = { ...r, id, x, y, width, height, ...(color ? { color } : {}) };
  if (!color) delete base.color;

  switch (r.type) {
    case "text":
      return { ...base, type: "text", text: typeof r.text === "string" ? r.text : "" };
    case "file": {
      const out: CanvasFileNode = { ...base, type: "file", file: typeof r.file === "string" ? r.file : "" };
      if (typeof r.subpath === "string") out.subpath = r.subpath; else delete out.subpath;
      return out;
    }
    case "link":
      return { ...base, type: "link", url: typeof r.url === "string" ? r.url : "" };
    case "group": {
      const out: CanvasGroupNode = { ...base, type: "group" };
      if (typeof r.label === "string") out.label = r.label; else delete out.label;
      if (typeof r.background === "string") out.background = r.background; else delete out.background;
      if (isBgStyle(r.backgroundStyle)) out.backgroundStyle = r.backgroundStyle; else delete out.backgroundStyle;
      return out;
    }
    default:
      return null;
  }
}

function normalizeEdge(raw: unknown): CanvasEdge | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.fromNode !== "string" || !r.fromNode || typeof r.toNode !== "string" || !r.toNode) return null;
  const out: CanvasEdge = {
    ...r,
    id: typeof r.id === "string" && r.id ? r.id : canvasId(),
    fromNode: r.fromNode,
    toNode: r.toNode,
  };
  if (isSide(r.fromSide)) out.fromSide = r.fromSide; else delete out.fromSide;
  if (isSide(r.toSide)) out.toSide = r.toSide; else delete out.toSide;
  if (isEnd(r.fromEnd)) out.fromEnd = r.fromEnd; else delete out.fromEnd;
  if (isEnd(r.toEnd)) out.toEnd = r.toEnd; else delete out.toEnd;
  if (typeof r.color === "string" && r.color) out.color = r.color; else delete out.color;
  if (typeof r.label === "string") out.label = r.label; else delete out.label;
  return out;
}

/** Parses standard JSON Canvas 1.0 text, keeping unknown fields on document, nodes, and edges intact. */
export function parseCanvas(raw: string): CanvasDoc {
  if (!raw.trim()) return { nodes: [], edges: [] };
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid .canvas JSON: root value must be an object.");
  }
  const obj = parsed as Record<string, unknown>;
  const nodes = (Array.isArray(obj.nodes) ? obj.nodes : []).map(normalizeNode).filter((n): n is CanvasNode => n !== null);
  const edges = (Array.isArray(obj.edges) ? obj.edges : []).map(normalizeEdge).filter((e): e is CanvasEdge => e !== null);
  return { ...obj, nodes, edges };
}

/** Serializes a CanvasDoc to standard 2-space indented JSON Canvas 1.0 format, preserving unknown fields. */
export function serializeCanvas(doc: CanvasDoc): string {
  const { nodes, edges, ...rest } = doc;
  return `${JSON.stringify({ nodes, edges, ...rest }, null, 2)}\n`;
}

type Rect = Pick<CanvasNodeBase, "x" | "y" | "width" | "height">;

/** World coordinates of a node's connection port on `side`. */
export function anchorPoint(node: Rect, side: Side): { x: number; y: number } {
  switch (side) {
    case "top": return { x: node.x + node.width / 2, y: node.y };
    case "right": return { x: node.x + node.width, y: node.y + node.height / 2 };
    case "bottom": return { x: node.x + node.width / 2, y: node.y + node.height };
    case "left": return { x: node.x, y: node.y + node.height / 2 };
  }
}

/** Side of `node` whose connection anchor is closest to world point `(px, py)`. */
export function nearestSide(node: Rect, px: number, py: number): Side {
  let best: Side = "top", bestDist = Infinity;
  for (const s of SIDES) {
    const a = anchorPoint(node, s), d = Math.hypot(px - a.x, py - a.y);
    if (d < bestDist) { bestDist = d; best = s; }
  }
  return best;
}

/** Resolves `fromSide` and `toSide`, picking natural facing sides when either or both are omitted. */
export function autoSides(from: Rect, to: Rect, fromSide?: Side, toSide?: Side): { fromSide: Side; toSide: Side } {
  if (fromSide && toSide) return { fromSide, toSide };
  if (fromSide) { const p1 = anchorPoint(from, fromSide); return { fromSide, toSide: nearestSide(to, p1.x, p1.y) }; }
  if (toSide) { const p2 = anchorPoint(to, toSide); return { fromSide: nearestSide(from, p2.x, p2.y), toSide }; }
  const overlaps = from.x < to.x + to.width && from.x + from.width > to.x && from.y < to.y + to.height && from.y + from.height > to.y;
  if (overlaps) {
    const dx = to.x + to.width / 2 - (from.x + from.width / 2), dy = to.y + to.height / 2 - (from.y + from.height / 2);
    return Math.abs(dx) >= Math.abs(dy)
      ? (dx >= 0 ? { fromSide: "right", toSide: "left" } : { fromSide: "left", toSide: "right" })
      : (dy >= 0 ? { fromSide: "bottom", toSide: "top" } : { fromSide: "top", toSide: "bottom" });
  }
  let bestFrom: Side = "right", bestTo: Side = "left", bestDist = Infinity;
  for (const s1 of SIDES) {
    const a1 = anchorPoint(from, s1);
    for (const s2 of SIDES) {
      const a2 = anchorPoint(to, s2), d = Math.hypot(a2.x - a1.x, a2.y - a1.y);
      if (d < bestDist) { bestDist = d; bestFrom = s1; bestTo = s2; }
    }
  }
  return { fromSide: bestFrom, toSide: bestTo };
}

function sideNormal(side: Side): [number, number] {
  return side === "top" ? [0, -1] : side === "right" ? [1, 0] : side === "bottom" ? [0, 1] : [-1, 0];
}

/** Smooth cubic Bezier SVG path `d` and exact curve midpoint `(mx, my)` at t = 0.5. */
export function bezierPath(x1: number, y1: number, fromSide: Side, x2: number, y2: number, toSide: Side): { d: string; mx: number; my: number } {
  const tang = Math.max(28, Math.min(220, Math.hypot(x2 - x1, y2 - y1) * 0.44));
  const [nx1, ny1] = sideNormal(fromSide), [nx2, ny2] = sideNormal(toSide);
  const c1x = x1 + nx1 * tang, c1y = y1 + ny1 * tang, c2x = x2 + nx2 * tang, c2y = y2 + ny2 * tang;
  return {
    d: `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`,
    mx: 0.125 * x1 + 0.375 * c1x + 0.375 * c2x + 0.125 * x2,
    my: 0.125 * y1 + 0.375 * c1y + 0.375 * c2y + 0.125 * y2,
  };
}

/** Full SVG path + endpoints + label midpoint for an edge between two nodes in `byId`. */
export function edgeGeometry(edge: CanvasEdge, byId: ReadonlyMap<string, CanvasNode>): EdgeGeometry | null {
  const from = byId.get(edge.fromNode), to = byId.get(edge.toNode);
  if (!from || !to) return null;
  const { fromSide, toSide } = autoSides(from, to, edge.fromSide, edge.toSide);
  const p1 = anchorPoint(from, fromSide), p2 = anchorPoint(to, toSide);
  const { d, mx, my } = bezierPath(p1.x, p1.y, fromSide, p2.x, p2.y, toSide);
  return { d, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, mx, my, fromSide, toSide };
}

/** Bounding box of `nodes` in world coordinates, or `null` when empty. */
export function canvasBounds(nodes: readonly Rect[]): CanvasBounds | null {
  if (!nodes.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + n.width > maxX) maxX = n.x + n.width;
    if (n.y + n.height > maxY) maxY = n.y + n.height;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** IDs of nodes contained inside `group`'s bounds (dragging a group moves its contained cards). */
export function nodesInsideGroup(group: Pick<CanvasNodeBase, "id" | "x" | "y" | "width" | "height">, nodes: readonly CanvasNode[]): string[] {
  const gx2 = group.x + group.width, gy2 = group.y + group.height;
  return nodes
    .filter((n) => n.id !== group.id && n.x >= group.x && n.y >= group.y && n.x + n.width <= gx2 && n.y + n.height <= gy2)
    .map((n) => n.id);
}

/** Snaps `value` to `step` (default 10px), or rounds to 1px when `free` (`Alt` held). */
export const snapGrid = (value: number, step = 10, free = false): number =>
  free ? Math.round(value) : Math.round(value / step) * step;

/** Applies an inline text/group/edge edit to `doc` if changed; calls `beforeMutate` once before mutating. */
export function applyInlineEdit(
  doc: CanvasDoc, kind: "text" | "group" | "edge", id: string, value: string, beforeMutate: () => void,
): boolean {
  if (kind === "text") {
    const n = doc.nodes.find((x) => x.id === id);
    if (!n || n.type !== "text" || n.text === value) return false;
    beforeMutate(); n.text = value; return true;
  }
  const trimmed = value.trim();
  if (kind === "group") {
    const g = doc.nodes.find((x) => x.id === id);
    if (!g || g.type !== "group" || (g.label ?? "") === trimmed) return false;
    beforeMutate(); if (trimmed) g.label = trimmed; else delete g.label; return true;
  }
  const ed = doc.edges.find((x) => x.id === id);
  if (!ed || (ed.label ?? "") === trimmed) return false;
  beforeMutate(); if (trimmed) ed.label = trimmed; else delete ed.label; return true;
}

/** Builds a centered `file` or `link` node at `(cx, cy)` with appropriate default dimensions. */
export function makeMediaNode(val: string, isUrl: boolean, cx: number, cy: number, isImg: boolean, isMd: boolean): CanvasNode {
  const [w, h] = isUrl ? [300, 110] : isImg ? [320, 240] : isMd ? [320, 260] : [280, 110];
  const base = { id: canvasId(), x: snapGrid(cx - w / 2), y: snapGrid(cy - h / 2), width: w, height: h };
  return isUrl ? { ...base, type: "link", url: val.trim() } : { ...base, type: "file", file: val };
}
