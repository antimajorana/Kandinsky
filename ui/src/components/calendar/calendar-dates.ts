// Pure date, grid, and visual helpers for the native Calendar & Unified Day Workspace.
import type { WeekStart } from "../../lib/types";

export const EVENT_COLORS = [
  { id: "blue", label: "Cobalt", bg: "var(--accent-soft)", fg: "var(--accent)", dot: "var(--accent)" },
  { id: "green", label: "Teal", bg: "var(--green-soft)", fg: "var(--green)", dot: "var(--green)" },
  { id: "purple", label: "Orchid", bg: "var(--purple-soft)", fg: "var(--purple)", dot: "var(--purple)" },
  { id: "orange", label: "Amber", bg: "var(--orange-soft)", fg: "var(--orange)", dot: "var(--orange)" },
  { id: "red", label: "Coral", bg: "var(--red-soft)", fg: "var(--red)", dot: "var(--red)" },
  { id: "yellow", label: "Ochre", bg: "var(--yellow-soft)", fg: "var(--yellow)", dot: "var(--yellow)" },
  { id: "cyan", label: "Cyan", bg: "var(--cyan-soft)", fg: "var(--cyan)", dot: "var(--cyan)" },
] as const;

export function colorSpec(id: string) {
  return EVENT_COLORS.find((c) => c.id === id) ?? EVENT_COLORS[0];
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatIso(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayIso(): string {
  return formatIso(new Date());
}

export function parseIso(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return new Date();
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
}

export function addDays(iso: string, delta: number): string {
  const d = parseIso(iso);
  d.setDate(d.getDate() + delta);
  return formatIso(d);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseIso(to).getTime() - parseIso(from).getTime()) / 86_400_000);
}

export function addMonths(iso: string, delta: number): string {
  const d = parseIso(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + delta);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return formatIso(d);
}

export function weekdayNames(weekStart: WeekStart): string[] {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return weekStart === "sunday" ? names : [...names.slice(1), names[0]];
}

export function startOfWeek(iso: string, weekStart: WeekStart): string {
  const d = parseIso(iso);
  const dow = d.getDay(); // 0=Sun..6=Sat
  const shift = weekStart === "sunday" ? dow : (dow + 6) % 7;
  d.setDate(d.getDate() - shift);
  return formatIso(d);
}

export function weekDays(anchorIso: string, weekStart: WeekStart): string[] {
  const start = startOfWeek(anchorIso, weekStart);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function monthGridDays(year: number, month0: number, weekStart: WeekStart): { iso: string; inMonth: boolean; day: number }[] {
  const first = `${year}-${pad2(month0 + 1)}-01`;
  const start = startOfWeek(first, weekStart);
  return Array.from({ length: 42 }, (_, i) => {
    const iso = addDays(start, i);
    const d = parseIso(iso);
    return { iso, inMonth: d.getMonth() === month0, day: d.getDate() };
  });
}

export function minutesOf(hm?: string | null): number | null {
  if (!hm) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
}

export function formatHm(mins: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 45, Math.round(mins / 15) * 15));
  return `${pad2(Math.floor(clamped / 60))}:${pad2(clamped % 60)}`;
}

export function formatDayHeading(iso: string): string {
  return parseIso(iso).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

export function formatMonthHeading(year: number, month0: number): string {
  return new Date(year, month0, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

const MEETING_RE = /^https?:\/\/([^/]*\.)?(zoom\.us|meet\.google\.com|teams\.microsoft\.com|meet\.jit\.si|whereby\.com|webex\.com|bbb\.|discord\.gg)\b/i;

export function isVideoMeetingUrl(location: string): boolean {
  const s = location.trim();
  return /^https?:\/\//i.test(s) && (MEETING_RE.test(s) || /meet|zoom|call|video|jitsi/i.test(s));
}
