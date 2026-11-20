// Local 60s calendar event & timed @date mention reminder loop: respects settings.notifications.calendar_reminders and works offline.
import { api } from "./api";
import { editors } from "./registry";
import { settings } from "./settings.svelte";
import { toast } from "./state.svelte";

const WINDOW_MINUTES = 10;

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59 ? h * 60 + min : null;
}

const TIMED_MENTION_RE = /(?:^|[\s(\[;])@(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?=$|[\s.,;:!?)\]\}])/g;
const TASK_DONE_RE = /^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[[^ ]\]/;

function notifyReminder(title: string, detail: string): void {
  toast(title, detail);
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try { new Notification(title, { body: detail }); } catch { /* ignore notification errors */ }
  }
}

export function startCalendarReminders(): () => void {
  const notified = new Set<string>();
  let lastDay = todayLocal();

  const maybeNotifyAt = (key: string, title: string, timeStr: string, nowMin: number, extra?: string) => {
    const startMin = parseMinutes(timeStr);
    if (startMin === null) return;
    const diff = startMin - nowMin;
    if (diff < 0 || diff > WINDOW_MINUTES) return;
    if (notified.has(key)) return;
    notified.add(key);
    const when = diff === 0 ? "Starting now" : `In ${diff} min (${timeStr})`;
    const detail = extra ? `${when} · ${extra}` : when;
    notifyReminder(title, detail);
  };

  const scanTextMentions = (path: string, lines: Array<{ line: number; text: string }>, today: string, nowMin: number) => {
    for (const hit of lines) {
      if (TASK_DONE_RE.test(hit.text)) continue;
      for (const m of hit.text.matchAll(TIMED_MENTION_RE)) {
        if (m[1] !== today) continue;
        const timeStr = m[2];
        const cleanText = hit.text
          .replace(/^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?/, "")
          .replace(TIMED_MENTION_RE, "")
          .trim() || `Reminder at ${timeStr}`;
        const key = `${today}:mention:${path}:${hit.line}:${timeStr}`;
        maybeNotifyAt(key, `Upcoming: ${cleanText}`, timeStr, nowMin, path);
      }
    }
  };

  const tick = async () => {
    const today = todayLocal();
    if (today !== lastDay) { notified.clear(); lastDay = today; }
    if (settings.config?.notifications?.calendar_reminders === false) return;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    try {
      const bases = settings.config?.calendar?.bases;
      const res = await api.calendar(today, today, bases?.length ? bases : undefined);
      for (const ev of res.events) {
        if (ev.all_day || ev.completed || !ev.start) continue;
        const key = `${today}:${ev.occurrence_id || ev.id}`;
        maybeNotifyAt(key, `Upcoming: ${ev.title}`, ev.start, nowMin, ev.location || undefined);
      }
    } catch {
      /* offline or uninitialized vault: skip silently until next interval */
    }

    // Check open note buffers immediately (even before autosave) and saved notes via search.
    const checkedOpenPaths = new Set<string>();
    for (const ed of editors.values()) {
      checkedOpenPaths.add(ed.path);
      const docLines = ed.snapshot().text.split("\n");
      const hits: Array<{ line: number; text: string }> = [];
      for (let i = 0; i < docLines.length; i++) {
        if (docLines[i].includes(`@${today}`)) hits.push({ line: i + 1, text: docLines[i] });
      }
      if (hits.length) scanTextMentions(ed.path, hits, today, nowMin);
    }

    try {
      const searchRes = await api.search(`@${today}`, { lane: "reminders" });
      const byPath = new Map<string, Array<{ line: number; text: string }>>();
      for (const hit of searchRes.lines) {
        if (checkedOpenPaths.has(hit.path)) continue;
        const arr = byPath.get(hit.path) ?? [];
        arr.push({ line: hit.line, text: hit.text });
        byPath.set(hit.path, arr);
      }
      for (const [p, hits] of byPath) scanTextMentions(p, hits, today, nowMin);
    } catch {
      /* ignore search failure when offline */
    }
  };

  void tick();
  const timer = setInterval(() => { void tick(); }, 60_000);
  return () => clearInterval(timer);
}
