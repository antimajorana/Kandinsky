// Shared Notion-style column display modes, status classification, and value formatters for Obsidian `.base` views.
// Metadata lives optionally under `.base` `properties.<col>.{format, currency, max}` with safe auto-detection fallbacks.
import type { BaseCell } from "./gen/BaseCell";
import type { StatusGroups } from "./gen/StatusGroups";

export type ColumnDisplayFormat =
  | "auto"
  | "status"
  | "progress"
  | "percent"
  | "currency"
  | "url"
  | "email"
  | "phone"
  | "file";

export const COLUMN_FORMAT_CHOICES: { value: ColumnDisplayFormat; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "status", label: "Status pill" },
  { value: "progress", label: "Progress bar" },
  { value: "percent", label: "Percent (%)" },
  { value: "currency", label: "Currency" },
  { value: "url", label: "URL link" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "file", label: "File / Media" },
];

export type StatusTone = "todo" | "progress" | "blocked" | "done" | "review" | "other";
export type StatusMetaGroup = "todo" | "in_progress" | "done";

export interface StatusOption {
  value: string;
  label: string;
  tone: StatusTone;
  group: StatusMetaGroup | "other";
  inSpec?: boolean;
}

export interface StatusGroupSection {
  key: StatusMetaGroup | "other";
  label: string;
  items: StatusOption[];
}

export const STATUS_PRESETS: { value: string; label: string; tone: StatusTone }[] = [
  { value: "To do", label: "To do", tone: "todo" },
  { value: "In progress", label: "In progress", tone: "progress" },
  { value: "Blocked", label: "Blocked", tone: "blocked" },
  { value: "Done", label: "Done", tone: "done" },
];

const TODO_RE = /^(?:to[\s_-]*do|backlog|open|not[\s_-]*started|planned|queued|inbox|draft|pending)$/i;
const PROG_RE = /^(?:in[\s_-]*progress|doing|active|started|wip|working|current|ongoing|running)$/i;
const BLOCK_RE = /^(?:blocked|stuck|on[\s_-]*hold|paused|cancelled|canceled|dropped|failed|error|overdue|rejected)$/i;
const DONE_RE = /^(?:done|complete|completed|shipped|closed|resolved|verified|accepted|published|finished)$/i;
const REV_RE = /^(?:review|in[\s_-]*review|testing|qa|verifying|awaiting)$/i;

function matchGroup(raw: string, groups?: StatusGroups | null): StatusMetaGroup | null {
  if (!groups) return null;
  const low = raw.trim().toLowerCase();
  if (!low) return null;
  if (groups.done.some((v) => v.trim().toLowerCase() === low)) return "done";
  if (groups.in_progress.some((v) => v.trim().toLowerCase() === low)) return "in_progress";
  if (groups.todo.some((v) => v.trim().toLowerCase() === low)) return "todo";
  return null;
}

export function classifyStatus(raw: string, groups?: StatusGroups | null): { tone: StatusTone; label: string } {
  const s = raw.trim();
  if (!s) return { tone: "todo", label: "To do" };
  const explicit = matchGroup(s, groups);
  if (explicit === "done") return { tone: "done", label: s };
  if (explicit === "in_progress") return { tone: "progress", label: s };
  if (explicit === "todo") return { tone: "todo", label: s };
  if (DONE_RE.test(s)) return { tone: "done", label: s };
  if (PROG_RE.test(s)) return { tone: "progress", label: s };
  if (BLOCK_RE.test(s)) return { tone: "blocked", label: s };
  if (REV_RE.test(s)) return { tone: "review", label: s };
  if (TODO_RE.test(s)) return { tone: "todo", label: s };
  return { tone: "other", label: s };
}

export function statusMetaGroup(raw: string, groups?: StatusGroups | null): StatusMetaGroup | null {
  const s = raw.trim();
  if (!s) return null;
  const { tone } = classifyStatus(s, groups);
  if (tone === "todo") return "todo";
  if (tone === "done") return "done";
  if (tone === "progress" || tone === "review" || tone === "blocked") return "in_progress";
  return null;
}

export function statusSortRank(
  raw: string,
  groups?: StatusGroups | null,
  values?: readonly string[] | null,
): [number, number] {
  const s = raw.trim();
  const low = s.toLowerCase();
  const { tone } = classifyStatus(s, groups);
  const bucket =
    tone === "todo" ? 0
    : tone === "progress" || tone === "review" || tone === "blocked" ? 1
    : tone === "done" ? 2
    : 3;
  if (groups) {
    const arr = bucket === 0 ? groups.todo : bucket === 1 ? groups.in_progress : bucket === 2 ? groups.done : [];
    const idx = arr.findIndex((v) => v.trim().toLowerCase() === low);
    if (idx >= 0) return [bucket, idx];
  }
  if (values?.length) {
    const idx = values.findIndex((v) => v.trim().toLowerCase() === low);
    if (idx >= 0) return [bucket, 1000 + idx];
  }
  const sub = tone === "progress" ? 2000 : tone === "review" ? 2001 : tone === "blocked" ? 2002 : 3000;
  return [bucket, sub];
}

export function groupStatusOptions(
  values?: readonly string[] | null,
  groups?: StatusGroups | null,
  extraValue?: string | null,
): StatusGroupSection[] {
  const hasGroups = Boolean(groups && (groups.todo.length || groups.in_progress.length || groups.done.length));
  const hasValues = Boolean(values && values.length);
  const baseList: { val: string; inSpec: boolean }[] = [];
  const seen = new Set<string>();
  const push = (raw: string, inSpec: boolean) => {
    const t = raw.trim();
    const low = t.toLowerCase();
    if (!t || seen.has(low)) return;
    seen.add(low);
    baseList.push({ val: t, inSpec });
  };

  if (hasGroups && groups) {
    for (const v of groups.todo) push(v, true);
    for (const v of groups.in_progress) push(v, true);
    for (const v of groups.done) push(v, true);
    if (hasValues && values) for (const v of values) push(v, true);
  } else if (hasValues && values) {
    for (const v of values) push(v, true);
  } else {
    for (const p of STATUS_PRESETS) push(p.value, true);
  }
  if (extraValue) push(extraValue, false);

  const buckets: Record<StatusMetaGroup | "other", StatusOption[]> = {
    todo: [],
    in_progress: [],
    done: [],
    other: [],
  };
  for (const { val, inSpec } of baseList) {
    const { tone } = classifyStatus(val, groups);
    const group: StatusMetaGroup | "other" =
      tone === "todo" ? "todo"
      : tone === "done" ? "done"
      : tone === "progress" || tone === "review" || tone === "blocked" ? "in_progress"
      : "other";
    buckets[group].push({ value: val, label: val, tone, group, inSpec });
  }

  const meta: [StatusMetaGroup | "other", string][] = [
    ["todo", "To do"],
    ["in_progress", "In progress"],
    ["done", "Done"],
    ["other", "Other"],
  ];
  return meta
    .filter(([k]) => buckets[k].length > 0)
    .map(([key, label]) => ({ key, label, items: buckets[key] }));
}

/** Cycles through explicit `groups`/`choices` in lifecycle order (`To do` -> `In progress` -> `Done`), or the built-in status cycle. */
export function nextStatusValue(
  raw: string,
  choices?: readonly string[] | null,
  groups?: StatusGroups | null,
): string {
  const trimmed = raw.trim();
  const hasGroups = Boolean(groups && (groups.todo.length || groups.in_progress.length || groups.done.length));
  const cleanChoices = (choices ?? []).map((c) => c.trim()).filter(Boolean);

  if (hasGroups || cleanChoices.length > 0) {
    const cycle: string[] = [];
    const seen = new Set<string>();
    const add = (s: string) => {
      const t = s.trim();
      const low = t.toLowerCase();
      if (!t || seen.has(low)) return;
      seen.add(low);
      cycle.push(t);
    };

    if (hasGroups && groups) {
      const extraByBucket: Record<StatusMetaGroup | "other", string[]> = { todo: [], in_progress: [], done: [], other: [] };
      for (const c of cleanChoices) {
        const g = statusMetaGroup(c, groups) ?? "other";
        extraByBucket[g].push(c);
      }
      for (const v of groups.todo) add(v);
      for (const v of extraByBucket.todo) add(v);
      for (const v of groups.in_progress) add(v);
      for (const v of extraByBucket.in_progress) add(v);
      for (const v of groups.done) add(v);
      for (const v of extraByBucket.done) add(v);
      for (const v of extraByBucket.other) add(v);
    } else {
      for (const c of cleanChoices) add(c);
    }

    if (cycle.length > 0) {
      const idx = cycle.findIndex((c) => c.toLowerCase() === trimmed.toLowerCase());
      if (idx >= 0) return cycle[(idx + 1) % cycle.length];
      if (!trimmed) return cycle[0];
      const curGroup = statusMetaGroup(trimmed, groups);
      if (curGroup === "todo") {
        const next = cycle.find((c) => statusMetaGroup(c, groups) === "in_progress") ?? cycle.find((c) => statusMetaGroup(c, groups) === "done");
        if (next) return next;
      } else if (curGroup === "in_progress") {
        const next = cycle.find((c) => statusMetaGroup(c, groups) === "done");
        if (next) return next;
      }
      return cycle[0];
    }
  }

  const isLower = trimmed.length > 0 && trimmed === trimmed.toLowerCase();
  const { tone } = classifyStatus(trimmed, groups);
  const next =
    tone === "todo" ? "In progress"
    : tone === "progress" || tone === "review" ? "Done"
    : tone === "done" ? "Blocked"
    : "To do";
  return isLower ? next.toLowerCase() : next;
}

const URL_RE = /^https?:\/\/\S+$/i;
const EMAIL_RE = /^(?:mailto:)?([^\s@]+@[^\s@]+\.[^\s@]{2,})$/i;
const PHONE_RE = /^tel:[+\d().\s-]+$/i;
const PHONE_COL_RE = /(?:^|[\s._-])(?:phone|tel|mobile|whatsapp)(?:$|[\s._-])/i;
const STATUS_COL_RE = /(?:^|[\s._-])(?:status|state|stage|phase|workflow)(?:$|[\s._-])/i;
const PROGRESS_COL_RE = /(?:^|[\s._-])(?:progress|completion|completed_pct|percent_done)(?:$|[\s._-])/i;
const PERCENT_COL_RE = /(?:^|[\s._-])(?:percent|pct|rate|ratio)(?:$|[\s._-])/i;
const CURRENCY_COL_RE = /(?:^|[\s._-])(?:price|cost|budget|amount|revenue|salary|fee|eur|usd|gbp)(?:$|[\s._-])/i;
const FILE_EXT_RE = /\.(?:pdf|png|jpe?g|gif|webp|svg|avif|mp3|wav|ogg|m4a|webm|mp4|mov|canvas|excalidraw|ipynb|wln)$/i;

const KNOWN_FORMATS = new Set<string>([
  "status", "progress", "percent", "currency", "url", "email", "phone", "file",
]);

export function effectiveColumnFormat(
  col?: { id: string; label?: string; format?: string | null } | null,
  cell?: BaseCell,
  spec?: { kind?: string } | null,
): ColumnDisplayFormat {
  const explicit = col?.format?.trim().toLowerCase();
  if (explicit && KNOWN_FORMATS.has(explicit)) return explicit as ColumnDisplayFormat;
  if (spec?.kind === "status" && (!cell || cell.t === "text" || cell.t === "null")) return "status";

  const colKey = `${col?.id ?? ""} ${col?.label ?? ""}`.trim();
  if (col?.id !== "file.name") {
    if (STATUS_COL_RE.test(colKey) && (!cell || cell.t === "text" || cell.t === "null")) return "status";
    if (PROGRESS_COL_RE.test(colKey) && (!cell || cell.t === "num")) return "progress";
    if (PERCENT_COL_RE.test(colKey) && (!cell || cell.t === "num")) return "percent";
    if (CURRENCY_COL_RE.test(colKey) && (!cell || cell.t === "num")) return "currency";
  }

  if (cell?.t === "text") {
    const v = cell.value.trim();
    if (URL_RE.test(v)) return "url";
    if (EMAIL_RE.test(v)) return "email";
    if (PHONE_RE.test(v) || (PHONE_COL_RE.test(colKey) && /^[+\d][\d\s().-]{5,}$/.test(v))) return "phone";
    const stripped = v.replace(/^!\[\[/, "").replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
    if (stripped && FILE_EXT_RE.test(stripped) && !/\s{2,}/.test(stripped) && v.length < 220) return "file";
  }
  return "auto";
}

export function formatCurrency(n: number, symbol = "€"): string {
  const s = symbol.trim() || "€";
  const abs = Math.abs(n);
  const body = abs.toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  const sign = n < 0 ? "−" : "";
  if (s === "€" || s.toUpperCase() === "EUR") return `${sign}${body} €`;
  if (s.length <= 2) return `${sign}${s}${body}`;
  return `${sign}${body} ${s.toUpperCase()}`;
}

export function compactUrlLabel(raw: string): string {
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.replace(/^www\./i, "");
    const p = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
    const short = p.length > 24 ? `${p.slice(0, 22)}…` : p;
    return `${host}${short}`;
  } catch {
    return raw.trim().replace(/^https?:\/\/(www\.)?/i, "");
  }
}
