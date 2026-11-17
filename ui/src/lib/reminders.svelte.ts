// Local 60s calendar event reminder loop: respects settings.notifications.calendar_reminders and works offline.
import { api } from "./api";
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

export function startCalendarReminders(): () => void {
  const notified = new Set<string>();
  let lastDay = todayLocal();

  const tick = async () => {
    const today = todayLocal();
    if (today !== lastDay) { notified.clear(); lastDay = today; }
    if (settings.config?.notifications?.calendar_reminders === false) return;
    try {
      const bases = settings.config?.calendar?.bases;
      const res = await api.calendar(today, today, bases?.length ? bases : undefined);
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      for (const ev of res.events) {
        if (ev.all_day || ev.completed || !ev.start) continue;
        const startMin = parseMinutes(ev.start);
        if (startMin === null) continue;
        const diff = startMin - nowMin;
        if (diff >= 0 && diff <= WINDOW_MINUTES) {
          const key = `${today}:${ev.occurrence_id || ev.id}`;
          if (notified.has(key)) continue;
          notified.add(key);
          const when = diff === 0 ? "Starting now" : `In ${diff} min (${ev.start})`;
          const detail = ev.location ? `${when} · ${ev.location}` : when;
          toast(`Upcoming: ${ev.title}`, detail);
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            try { new Notification(ev.title, { body: detail }); } catch { /* ignore notification errors */ }
          }
        }
      }
    } catch {
      /* offline or uninitialized vault: skip silently until next interval */
    }
  };

  void tick();
  const timer = setInterval(() => { void tick(); }, 60_000);
  return () => clearInterval(timer);
}
