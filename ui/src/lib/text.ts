// Small text helpers every part of the interface shares (one copy each).

/** What went wrong, as text: an Error's message, anything else as written. */
export const errText = (e: unknown): string => String(e instanceof Error ? e.message : e);

/** The reason alone, without the API's "VERB /path: 500 " in front (lib/api.ts writes that prefix). */
export const errReason = (e: unknown): string => errText(e).replace(/^\w+ \S+: \d+ /, "");

/** Turn raw API / Rust / network errors into calm, human-readable text while keeping specific details intact. */
export function humanizeErrorText(raw: string): string {
  const input = (raw ?? "").trim();
  if (!input) return "";
  // Drop JS stack frames and Rust cause chains.
  let s = input.split(/\r?\n\s*(?:at\s+|Caused by:)/)[0].trim();
  // Strip HTTP verb/path/status prefix from api.ts (e.g. "POST /api/config: 500 ...").
  const httpMatch = /^(?:GET|POST|PUT|PATCH|DELETE|HEAD)\s+\/\S+:\s*(\d{3})\s*(.*)$/is.exec(s);
  const status = httpMatch ? Number(httpMatch[1]) : 0;
  if (httpMatch) s = httpMatch[2].trim();
  // Unwrap JSON error payloads when the server returned {"error": "..."}.
  if (s.startsWith("{")) {
    try {
      const parsed = JSON.parse(s) as Record<string, unknown>;
      if (typeof parsed.error === "string" && parsed.error.trim()) s = parsed.error.trim();
      else if (typeof parsed.message === "string" && parsed.message.trim()) s = parsed.message.trim();
    } catch { /* keep text as-is */ }
  }
  // Strip Rust / anyhow wrapper prefixes and trailing "(os error N)" codes.
  s = s
    .replace(/^(?:Error::[A-Za-z0-9_]+(?:\([^)]*\))?|anyhow::Error|error):\s*/i, "")
    .replace(/\s*\(os error \d+\)\s*$/i, "")
    .trim();
  if (/^(?:Failed to fetch|NetworkError\b|Load failed|TypeError:\s*Failed to fetch)/i.test(s)) {
    return "Could not reach the workspace server.";
  }
  if (/^(?:AbortError|TimeoutError)\b|signal timed out/i.test(s)) {
    return "The request took too long and timed out.";
  }
  if (!s) {
    if (status === 401 || status === 403) return "Access was denied.";
    if (status === 404) return "The requested item could not be found.";
    if (status >= 500) return "The workspace server hit an unexpected error.";
    return "Something went wrong.";
  }
  return s;
}

/** `s` matched literally inside a RegExp. */
export const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `s` in lower case with every character where it was: one whose lower case is longer (`İ` → `i̇`) is kept as it is,
 *  so an index found in the result marks the same text in `s` (a highlight, a fuzzy match). */
export function lowerInPlace(s: string): string {
  const low = s.toLowerCase();
  return low.length === s.length ? low : Array.from(s, (c) => { const l = c.toLowerCase(); return l.length === c.length ? l : c; }).join("");
}

/** Text made safe inside HTML: `&`, `<`, `>` and `"` escaped. */
export const escapeHtml = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A file size for a listing: `512 B`, `3.4 KB`, `1.2 MB`, `2.05 GB`; "" when unknown. */
export const bytes = (n?: number): string =>
  n === undefined ? "" : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`;

// made on first use: the first Intl formatter loads the locale's data (~25 ms), which the start need not wait for
const dtf = (o: Intl.DateTimeFormatOptions) => { let f: Intl.DateTimeFormat | undefined; return () => (f ??= new Intl.DateTimeFormat(undefined, o)); };
const HM = dtf({ hour: "2-digit", minute: "2-digit" }), MD = dtf({ month: "short", day: "numeric" }), YMD = dtf({ year: "numeric", month: "short", day: "numeric" });
/** A file's time (unix seconds) short enough for a column: the time today, the day this year, else the date; "" when unknown. */
export function shortWhen(secs?: number): string {
  if (!secs) return "";
  const d = new Date(secs * 1000), now = new Date();
  return d.toDateString() === now.toDateString() ? HM().format(d) : d.getFullYear() === now.getFullYear() ? MD().format(d) : YMD().format(d);
}
