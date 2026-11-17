// Deterministic local natural-language @date parser and CodeMirror autocomplete source.
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDaysLocal(d: Date, days: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + days);
  return out;
}

export interface ParsedNlDate {
  iso: string;
  time?: string;
  display: string;
}

/** Parses `@today`, `@tomorrow`, `@yesterday`, `@next <weekday>`, `@in N days|weeks`, with optional `HH:MM`. */
export function parseNlDate(raw: string, ref = new Date()): ParsedNlDate | null {
  let clean = raw.trim().replace(/^@/, "").toLowerCase();
  if (!clean) return null;

  let time: string | undefined;
  const tm = /\s+(\d{1,2}):(\d{2})$/.exec(clean);
  if (tm) {
    const h = Number(tm[1]);
    const min = Number(tm[2]);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      time = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
      clean = clean.slice(0, tm.index).trim();
    }
  }

  let date: Date | null = null;
  if (clean === "today") date = addDaysLocal(ref, 0);
  else if (clean === "tomorrow" || clean === "tmrw") date = addDaysLocal(ref, 1);
  else if (clean === "yesterday") date = addDaysLocal(ref, -1);
  else if (clean.startsWith("next ")) {
    const dayName = clean.slice(5).trim();
    const idx = WEEKDAYS.findIndex((w) => w.startsWith(dayName) && dayName.length >= 3);
    if (idx >= 0) {
      const diff = (idx - ref.getDay() + 7) % 7 || 7;
      date = addDaysLocal(ref, diff);
    }
  } else {
    const inM = /^in\s+(\d+)\s+(day|days|week|weeks)$/.exec(clean);
    if (inM) {
      const n = Number(inM[1]);
      const mult = inM[2].startsWith("week") ? 7 : 1;
      date = addDaysLocal(ref, n * mult);
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
      return { iso: clean, time, display: time ? `${clean} ${time}` : clean };
    }
  }

  if (!date) return null;
  const iso = toIsoDate(date);
  return { iso, time, display: time ? `${iso} ${time}` : iso };
}

export function nlDateCompletions(query: string, ref = new Date()): Completion[] {
  const q = query.trim().replace(/^@/, "").toLowerCase();
  const candidates: { phrase: string; detail: string }[] = [
    { phrase: "today", detail: toIsoDate(ref) },
    { phrase: "tomorrow", detail: toIsoDate(addDaysLocal(ref, 1)) },
    { phrase: "tomorrow 09:00", detail: `${toIsoDate(addDaysLocal(ref, 1))} 09:00` },
    { phrase: "yesterday", detail: toIsoDate(addDaysLocal(ref, -1)) },
    { phrase: "in 3 days", detail: toIsoDate(addDaysLocal(ref, 3)) },
    { phrase: "in 1 week", detail: toIsoDate(addDaysLocal(ref, 7)) },
    ...WEEKDAYS.map((w) => {
      const parsed = parseNlDate(`next ${w}`, ref)!;
      return { phrase: `next ${w}`, detail: parsed.iso };
    }),
  ];

  // Also parse dynamic expressions like `@in 5 days` or `@tomorrow 14:00`
  const exact = parseNlDate(q, ref);
  const out: Completion[] = [];
  if (exact) {
    out.push({
      label: `@${q}`,
      displayLabel: `@${q} → ${exact.display}`,
      detail: exact.display,
      apply: `@${exact.display}`,
      boost: 20,
    });
  }
  for (const c of candidates) {
    if (!q || c.phrase.includes(q)) {
      out.push({
        label: `@${c.phrase}`,
        displayLabel: `@${c.phrase}`,
        detail: c.detail,
        apply: `@${c.detail}`,
      });
    }
  }
  return out.slice(0, 8);
}

const NL_DATE_BEFORE = /@(?:[a-z]+(?:\s+(?:\d+|[a-z]+|\d{1,2}:\d{0,2}))*)?$/i;

export const nlDateSource = {
  applies: (ctx: CompletionContext): boolean =>
    !!ctx.matchBefore(NL_DATE_BEFORE) && !ctx.matchBefore(/@[\w-]+:/),
  answer: (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(NL_DATE_BEFORE);
    if (!m) return null;
    const at = m.from + m.text.lastIndexOf("@");
    const options = nlDateCompletions(m.text.slice(m.text.lastIndexOf("@")));
    if (!options.length) return null;
    return { from: at, options, validFor: /^@[\w\s:-]*$/ };
  },
};
