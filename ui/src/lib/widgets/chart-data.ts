// Data loading, aggregation, and Bauhaus pigment assignment for ChartWidget (.base, .csv/.tsv, or vault folder fallback).
import { api } from "../api";
import { isAgentFile } from "../agent-files";
import { classifyStatus, type StatusTone } from "../base-format";
import { isBookkeeping } from "../bus";
import type { BaseColumn } from "../gen/BaseColumn";
import type { BaseRow } from "../gen/BaseRow";
import { basename, dirOf, resolveRel, shownName } from "../paths";
import type { BaseCell } from "../types";
import { listVault, resolveLink, vaultReady } from "../vault";

export type ChartKind = "bar" | "column" | "donut" | "line";
export type ChartMetric = "count" | "sum" | "avg";

export const CHART_KINDS: { id: ChartKind; label: string }[] = [
  { id: "bar", label: "Bar" },
  { id: "column", label: "Column" },
  { id: "donut", label: "Donut" },
  { id: "line", label: "Line" },
];

export interface ChartPoint { label: string; value: number; count: number; pct: number; color: string }
export interface ChartDataset {
  points: ChartPoint[]; total: number; rowCount: number; metric: ChartMetric;
  sourceTitle: string; sourcePath: string | null; groupLabel: string; valueLabel: string;
}

const PIGMENTS = ["var(--accent)", "var(--green)", "var(--yellow)", "var(--orange)", "var(--purple)", "var(--red)"] as const;
const STATUS_COLOR: Record<Exclude<StatusTone, "other">, string> = {
  done: "var(--green)", progress: "var(--accent)", blocked: "var(--red)", review: "var(--yellow)", todo: "var(--text-muted)",
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const cleanWiki = (s: string): string => s.replace(/^!?\[\[/, "").replace(/\]\]$/, "").split("|").pop()?.trim() ?? s.trim();

export function parseChartKind(v: unknown): ChartKind {
  const s = str(v).toLowerCase();
  return s === "column" || s === "donut" || s === "line" ? s : "bar";
}

export function formatMetricValue(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Number.isInteger(n) || Math.abs(n) >= 1000) return Math.round(n).toLocaleString();
  return Number(n.toFixed(Math.abs(n) >= 10 ? 1 : 2)).toLocaleString();
}

interface Bucket { sum: number; numCount: number; count: number }

function addBucket(map: Map<string, Bucket>, rawLabel: string, num: number | null): void {
  const label = rawLabel.trim() || "No value";
  const b = map.get(label) ?? { sum: 0, numCount: 0, count: 0 };
  b.count += 1;
  if (num !== null && Number.isFinite(num)) { b.sum += num; b.numCount += 1; }
  map.set(label, b);
}

function finalize(
  map: Map<string, Bucket>, metric: ChartMetric, limit: number, rowCount: number,
  sourceTitle: string, sourcePath: string | null, groupLabel: string, valueLabel: string,
): ChartDataset {
  const raw = [...map.entries()].map(([label, b]) => ({
    label,
    count: b.count,
    value: metric === "count" ? b.count : metric === "sum" ? b.sum : (b.numCount ? b.sum / b.numCount : 0),
  }));
  const nonEmpty = raw.filter((r) => r.label !== "No value");
  const isChrono = nonEmpty.length > 1 && nonEmpty.every((r) => /^\d{4}(?:[-/]\d{1,2}(?:[-/]\d{1,2})?)?$/.test(r.label));
  if (isChrono) raw.sort((a, b) => a.label.localeCompare(b.label));
  else raw.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const sliced = isChrono ? raw.slice(-limit) : raw.slice(0, limit);
  const posSum = sliced.reduce((s, r) => s + Math.max(0, r.value), 0);
  const total = metric === "avg"
    ? (sliced.length ? sliced.reduce((s, r) => s + r.value, 0) / sliced.length : 0)
    : sliced.reduce((s, r) => s + r.value, 0);
  const hasStatus = sliced.some((r) => r.label !== "No value" && classifyStatus(r.label).tone !== "other");
  const points: ChartPoint[] = sliced.map((r, i) => {
    const tone = r.label === "No value" ? "other" : classifyStatus(r.label).tone;
    const color = tone !== "other" ? STATUS_COLOR[tone]
      : r.label === "No value" && hasStatus ? "var(--text-faint)"
      : PIGMENTS[i % PIGMENTS.length];
    return { label: r.label, value: r.value, count: r.count, pct: posSum > 0 ? (Math.max(0, r.value) / posSum) * 100 : 0, color };
  });
  return { points, total, rowCount, metric, sourceTitle, sourcePath, groupLabel, valueLabel };
}

function cellLabels(cell: BaseCell | undefined): string[] {
  if (!cell || cell.t === "null") return ["No value"];
  if (cell.t === "bool") return [cell.value ? "True" : "False"];
  if (cell.t === "num") return [Number.isFinite(cell.value) ? String(cell.value) : "No value"];
  if (cell.t === "date") return [cell.text.trim() || "No value"];
  if (cell.t === "link") return [cell.text.trim() || basename(cell.path ?? "") || "No value"];
  if (cell.t === "text") { const v = cleanWiki(cell.value); return [v || "No value"]; }
  const out = cell.items.flatMap((it) => cellLabels(it)).filter((x) => x !== "No value");
  return out.length ? out : ["No value"];
}

function cellNum(cell: BaseCell | undefined): number | null {
  if (!cell) return null;
  if (cell.t === "num") return Number.isFinite(cell.value) ? cell.value : null;
  if (cell.t === "bool") return cell.value ? 1 : 0;
  if (cell.t === "text") { const n = Number(cell.value.replace(/[^0-9.-]+/g, "")); return cell.value.trim() && Number.isFinite(n) ? n : null; }
  return null;
}

function findCol(cols: BaseColumn[], spec: string): number {
  const s = spec.trim().toLowerCase();
  if (!s) return -1;
  return cols.findIndex((c) => {
    const id = c.id.toLowerCase(), key = (c.key ?? "").toLowerCase(), lbl = c.label.toLowerCase();
    return id === s || key === s || lbl === s || id === `note.${s}` || id === `file.${s}` || id === `formula.${s}`;
  });
}

async function loadFromBase(path: string, doc: string, viewName: string, groupBy: string, metric: ChartMetric, valueField: string, limit: number): Promise<ChartDataset> {
  const res = await api.base(path, doc || undefined);
  if (res.error && !res.views.length) throw new Error(res.error);
  const view = (viewName ? res.views.find((v) => v.name.toLowerCase() === viewName.toLowerCase()) : undefined) ?? res.views[0];
  if (!view) return finalize(new Map(), metric, limit, 0, shownName(path), path, groupBy || "group", "");
  const cols = view.columns;
  const gSpec = groupBy || view.group_by || "";
  const gIdx = gSpec ? findCol(cols, gSpec) : cols.findIndex((c) => c.id !== "file.name");
  const folderFallback = /^(?:file\.)?folder$/i.test(gSpec) && gIdx < 0;
  const useRowGroup = !groupBy && !!view.group_by && gIdx < 0;
  const effIdx = gIdx >= 0 ? gIdx : (!folderFallback && !useRowGroup && cols.length ? 0 : -1);
  const groupLabel = folderFallback ? "folder" : useRowGroup ? (view.group_key || view.group_by || "group") : (cols[effIdx]?.label || gSpec || "group");
  const vIdx = metric === "count" ? -1 : (valueField ? findCol(cols, valueField) : cols.findIndex((_, j) => view.rows.some((r) => r.cells[j]?.t === "num")));
  const buckets = new Map<string, Bucket>();
  for (const row of view.rows as BaseRow[]) {
    const labels = folderFallback ? [dirOf(row.path).split("/")[0] || "Root"]
      : useRowGroup ? [row.group?.trim() || "No value"]
      : effIdx >= 0 ? cellLabels(row.cells[effIdx]) : ["All"];
    const num = vIdx >= 0 ? cellNum(row.cells[vIdx]) : null;
    for (const l of labels) addBucket(buckets, l, num);
  }
  return finalize(buckets, metric, limit, view.rows.length, shownName(path), path, groupLabel, vIdx >= 0 ? cols[vIdx].label : valueField);
}

export function parseDelimited(text: string, sep: "," | "\t"): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQ = false;
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === sep) { cur.push(field.trim()); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      cur.push(field.trim()); field = "";
      if (cur.some((c) => c.length > 0)) rows.push(cur);
      cur = [];
    } else field += ch;
  }
  if (field.length || cur.length) { cur.push(field.trim()); if (cur.some((c) => c.length > 0)) rows.push(cur); }
  return rows;
}

async function loadFromCsv(path: string, groupBy: string, metric: ChartMetric, valueField: string, limit: number): Promise<ChartDataset> {
  const file = await api.file(path);
  const firstLine = file.text.split(/\r?\n/, 1)[0] ?? "";
  const sep: "," | "\t" = /\.tsv$/i.test(path) || (firstLine.includes("\t") && !firstLine.includes(",")) ? "\t" : ",";
  const [head, ...body] = parseDelimited(file.text, sep);
  if (!head?.length) return finalize(new Map(), metric, limit, 0, shownName(path), path, "column", "");
  const isNumCol = (j: number) => {
    const vals = body.map((r) => r[j] ?? "").filter(Boolean);
    return vals.length > 0 && vals.filter((v) => Number.isFinite(Number(v.replace(/[,$€%]/g, "")))).length >= vals.length * 0.7;
  };
  let gIdx = groupBy ? head.findIndex((h) => h.toLowerCase() === groupBy.toLowerCase()) : -1;
  if (gIdx < 0) gIdx = head.findIndex((_, j) => !isNumCol(j));
  if (gIdx < 0) gIdx = 0;
  let vIdx = metric === "count" ? -1 : (valueField ? head.findIndex((h) => h.toLowerCase() === valueField.toLowerCase()) : head.findIndex((_, j) => j !== gIdx && isNumCol(j)));
  const buckets = new Map<string, Bucket>();
  for (const r of body) {
    const rawVal = vIdx >= 0 ? Number((r[vIdx] ?? "").replace(/[^0-9.-]+/g, "")) : null;
    addBucket(buckets, cleanWiki(r[gIdx] ?? ""), rawVal !== null && Number.isFinite(rawVal) ? rawVal : null);
  }
  return finalize(buckets, metric, limit, body.length, shownName(path), path, head[gIdx] || "group", vIdx >= 0 ? head[vIdx] : valueField);
}

function folderFallbackDataset(files: string[], limit: number): ChartDataset {
  const notes = files.filter((f) => /\.(md|markdown)$/i.test(f) && !f.startsWith(".") && !isBookkeeping(f) && !isAgentFile(f));
  const buckets = new Map<string, Bucket>();
  for (const f of notes) addBucket(buckets, f.includes("/") ? f.slice(0, f.indexOf("/")) : "Vault root", 1);
  return finalize(buckets, "count", limit, notes.length, "Vault notes", null, "folder", "");
}

export async function loadChartData(options: Record<string, unknown>, doc = ""): Promise<ChartDataset> {
  const metricRaw = str(options.metric).toLowerCase();
  const metric: ChartMetric = metricRaw === "sum" || metricRaw === "avg" ? metricRaw : "count";
  const limit = Math.max(1, Math.min(30, Math.round(Number(options.limit) || 8)));
  const groupBy = str(options.group_by), valueField = str(options.value_field), view = str(options.view);
  const rawPath = str(options.path).replace(/^!?\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();

  if (rawPath) {
    await vaultReady();
    const resolved = resolveLink(rawPath, dirOf(doc)) ?? resolveRel(rawPath, dirOf(doc));
    return /\.(csv|tsv)$/i.test(resolved)
      ? loadFromCsv(resolved, groupBy, metric, valueField, limit)
      : loadFromBase(resolved, doc, view, groupBy, metric, valueField, limit);
  }

  const files = (await listVault()).filter((f) => !f.startsWith(".") && !isBookkeeping(f) && !isAgentFile(f));
  const autoBase = files.find((f) => /\.base$/i.test(f));
  const autoCsv = !autoBase ? files.find((f) => /\.(csv|tsv)$/i.test(f)) : undefined;
  const picked = autoBase ?? autoCsv;
  if (picked) {
    try {
      const ds = autoBase
        ? await loadFromBase(picked, doc, view, groupBy, metric, valueField, limit)
        : await loadFromCsv(picked, groupBy, metric, valueField, limit);
      if (ds.points.length > 0) return ds;
    } catch { /* fall back to vault note folders */ }
  }
  return folderFallbackDataset(files, limit);
}
