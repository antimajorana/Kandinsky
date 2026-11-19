// Shared Notion-style column display modes, status classification, and value formatters for Obsidian `.base` views.
// Metadata lives optionally under `.base` `properties.<col>.{format, currency, max}` with safe auto-detection fallbacks.
import type { BaseCell } from "./gen/BaseCell";

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

export function classifyStatus(raw: string): { tone: StatusTone; label: string } {
  const s = raw.trim();
  if (!s) return { tone: "todo", label: "To do" };
  if (DONE_RE.test(s)) return { tone: "done", label: s };
  if (PROG_RE.test(s)) return { tone: "progress", label: s };
  if (BLOCK_RE.test(s)) return { tone: "blocked", label: s };
  if (REV_RE.test(s)) return { tone: "review", label: s };
  if (TODO_RE.test(s)) return { tone: "todo", label: s };
  return { tone: "other", label: s };
}

/** Cycles `To do` -> `In progress` -> `Done` -> `Blocked` -> `To do`, preserving lowercase convention when present. */
export function nextStatusValue(raw: string): string {
  const trimmed = raw.trim();
  const isLower = trimmed.length > 0 && trimmed === trimmed.toLowerCase();
  const { tone } = classifyStatus(trimmed);
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
): ColumnDisplayFormat {
  const explicit = col?.format?.trim().toLowerCase();
  if (explicit && KNOWN_FORMATS.has(explicit)) return explicit as ColumnDisplayFormat;

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
