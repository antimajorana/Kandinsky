// The Calendar plugin's page side, loaded with Kandinsky (not only with the pane): its commands, the Home card, the
// notices of dates the important-notes sync added, the account and subscription cards' Test, the 0.1 settings moved
// into an account card, and the engine's background sync.
import { mount, unmount } from "svelte";
import Upcoming from "./Upcoming.svelte";
import CalendarsSection from "./CalendarsSection.svelte";
import { NEW_EVENT_DIALOG, call, newEventDialog, type NewEventSeed, type PluginApi } from "./api";
import { localDay } from "../../../../../ui/src/lib/local-day"; // today where the user is, not UTC's

type Show = { date?: string; view?: string; quick?: boolean; create?: boolean };

export function register(kandinsky: PluginApi) {
  type Card = { name?: string; url?: string; user?: string; server?: string };
  const cards = () => (kandinsky.plugin.settings.accounts as Card[] | undefined) ?? [];
  // an Exchange card has no address: its mailbox is enough
  const ready = () => cards().some((c) => c.name && c.user && (c.url || c.server === "exchange")) || Boolean(kandinsky.plugin.settings.url && kandinsky.plugin.settings.user);
  const show = (detail: Show = {}) => {
    (window as unknown as { __kandinskyCalendarShow?: unknown }).__kandinskyCalendarShow = detail;
    kandinsky.openView(undefined, { title: "Calendar", icon: "calendar" });
    // a pane already open hears it now; a new one reads __kandinskyCalendarShow when it mounts
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("kandinsky-calendar:show", { detail }));
      (window as unknown as { __kandinskyCalendarShow?: unknown }).__kandinskyCalendarShow = undefined;
    }, 300);
  };

  kandinsky.registerCommand({ id: "open", title: "Calendar: open", run: () => show() });
  kandinsky.registerCommand({ id: "today", title: "Calendar: today", run: () => show({ date: localDay(), view: "day" }) });
  // a moment, not the place: the editor in a dialog (API 20); the pane with its editor open on an older app
  kandinsky.registerCommand({ id: "new", title: "Calendar: new event", run: () => (typeof kandinsky.openDialog === "function"
    ? void kandinsky.openDialog(NEW_EVENT_DIALOG, { title: "New event", width: 640, height: 560 })
    : show({ create: true })) });
  // another plugin's "make it a meeting" (Email: a conversation's subject and people): the editor in a dialog, seeded.
  // Under the name from before the rename too (`atlas-calendar:`), which an Email plugin installed then still sends;
  // answered under the name it was asked with.
  for (const name of ["kandinsky-calendar", "atlas-calendar"]) window.addEventListener(`${name}:new`, (ev) => {
    const { ack, ...seed } = ((ev as CustomEvent).detail ?? {}) as NewEventSeed & { ack?: boolean };
    if (ack) window.dispatchEvent(new CustomEvent(`${name}:heard`));
    if (typeof kandinsky.openDialog === "function") void kandinsky.openDialog(newEventDialog(seed), { title: seed.guests?.length ? "New meeting" : "New event", width: 640, height: 600 });
    else show({ create: true });
  });
  kandinsky.registerCommand({ id: "quick", title: "Calendar: quick add (in words)…", run: () => show({ quick: true }) });
  kandinsky.registerCommand({
    id: "sync",
    title: "Calendar: put important notes on the server",
    run: async () => {
      if (!ready()) { kandinsky.toast("Calendar", "Add a calendar account first.", "error"); kandinsky.plugin.openSettings(); return; }
      kandinsky.toast("Calendar", "Looking for important notes…");
      try {
        const r = await call<{ summary: string; events?: { outcome: string; title: string; why?: string }[] }>(kandinsky, "sync", {}, 300);
        const failed = (r.events ?? []).filter((e) => e.outcome === "failed").map((e) => `${e.title}: ${e.why}`);
        kandinsky.toast("Calendar", [r.summary, ...failed.slice(0, 3)].join("\n"), failed.length ? "error" : undefined);
      } catch (e) { kandinsky.toast("Calendar", (e as Error).message, "error"); }
    },
  });
  kandinsky.registerCommand({
    id: "calendars",
    title: "Calendar: test the accounts",
    run: async () => {
      try {
        await call(kandinsky, "refresh", { force: true }, 300);
        type Listed = { accounts: { account: string; status?: { state: string; text: string }; calendars: { id: string; name: string; writable: boolean }[] }[]; default: string | null };
        const r = await call<Listed>(kandinsky, "calendars");
        if (!r.accounts.length) { kandinsky.toast("Calendar", "No account yet.", "error"); kandinsky.plugin.openSettings(); return; }
        const lines = r.accounts.map((a) => `${a.account}: ${a.status?.state === "ok" ? a.calendars.map((c) => `${c.name}${c.id === r.default ? " (new events)" : ""}${c.writable ? "" : " (read-only)"}`).join(", ") || "no calendar" : a.status?.text ?? "?"}`);
        kandinsky.toast("Calendar", lines.join("\n"), r.accounts.some((a) => a.status?.state === "error") ? "error" : undefined);
      } catch (e) { kandinsky.toast("Calendar", (e as Error).message, "error"); }
    },
  });
  // an account card's "Test" (Settings saves the form first, then calls this with the card)
  kandinsky.registerCommand({
    id: "test-account",
    title: "Calendar: test an account",
    run: async (arg?: unknown) => {
      const record = (arg as { record?: Record<string, unknown> } | undefined)?.record;
      if (!record) { kandinsky.plugin.openSettings(); return; }
      try {
        const r = await call<{ ok: boolean; text: string }>(kandinsky, "test_account", { record }, 60);
        kandinsky.toast(String(record.name ?? "Account"), r.text, r.ok ? "success" : "error");
        if (r.ok) void call(kandinsky, "refresh", { force: true }, 300).catch(() => {});
      } catch (e) { kandinsky.toast("Calendar", (e as Error).message, "error"); }
    },
  });
  // under the account cards: every account and subscription read again now, each one's problem said
  kandinsky.registerCommand({
    id: "sync-now",
    title: "Calendar: sync now",
    run: async () => {
      try {
        const r = await call<{ errors: string[] }>(kandinsky, "refresh", { force: true }, 300);
        kandinsky.toast("Calendar", r.errors.length ? r.errors.join("\n") : "Every account and subscription is up to date.", r.errors.length ? "error" : "success");
      } catch (e) { kandinsky.toast("Calendar", (e as Error).message, "error"); }
    },
  });
  // the Subscriptions card's "Test" (Settings saves the form first, then calls this with the card)
  kandinsky.registerCommand({
    id: "test-subscription",
    title: "Calendar: test a subscription",
    run: async (arg?: unknown) => {
      const record = (arg as { record?: Record<string, unknown> } | undefined)?.record;
      if (!record) { kandinsky.plugin.openSettings(); return; }
      try {
        const r = await call<{ summary: string }>(kandinsky, "test_subscription", { record }, 60);
        kandinsky.toast("Subscription", r.summary, "success");
        void call(kandinsky, "refresh", { force: true }, 120).catch(() => {});
      } catch (e) { kandinsky.toast("Subscription", (e as Error).message, "error"); }
    },
  });

  // the automatic sync (on changed files) runs in the core; it tells the page what it added
  kandinsky.helper.on("added", (d) => {
    const a = d as { title: string; start: string; outcome: string };
    kandinsky.toast(a.outcome === "updated" ? "Updated in your calendar" : "Added to your calendar", `${a.title} — ${a.start}`, "info", { run: () => show({ date: a.start.slice(0, 10), view: "day" }) });
  });

  // ```view\ntype: dav.upcoming\ndays: 7\n``` — today, tomorrow, the week
  kandinsky.registerBlock("dav.upcoming", (host, b) => {
    const v = mount(Upcoming, { target: host, props: { kandinsky, options: b.options ?? {}, onopen: (date: string) => show({ date, view: "day" }) } });
    return () => unmount(v);
  }, { title: "Calendar: upcoming", options: [{ key: "days", label: "Days", kind: "number" }] });

  // 0.1 kept one account as flat settings (url, user, the `password` secret): moved into a card once, its secret
  // copied by the helper — nothing to retype. Not awaited here (saveSettings reloads the plugin).
  if (kandinsky.plugin.settings.url && kandinsky.plugin.settings.user && !cards().length) {
    void (async () => {
      const plan = await call<{ values?: Record<string, unknown>; name?: string }>(kandinsky, "migrate", {}, 60);
      if (!plan.values) return;
      await kandinsky.plugin.saveSettings(plan.values);
      kandinsky.toast("Calendar", `Your calendar account is now the card “${plan.name}” (Settings → Calendar → Accounts); add more there.`, "success");
    })().catch((e) => kandinsky.toast("Calendar: account not moved", String((e as Error).message ?? e), "error"));
  }

  // a renamed account card: its calendars' ids (`<account>/<calendar>`) change with it, so do the settings holding them
  kandinsky.helper.on("settings:renamed", (d) => {
    const { key, from, to } = d as { key: string; from: string; to: string };
    if (key !== "accounts") return;
    const move = (v: unknown) => (typeof v === "string" && v.startsWith(`${from}/`) ? `${to}/${v.slice(from.length + 1)}` : v);
    const s = kandinsky.plugin.settings;
    void kandinsky.plugin.saveSettings({
      calendar: move(s.calendar) || null,
      hidden: ((s.hidden as string[] | undefined) ?? []).map(move),
      colors: ((s.colors as string[] | undefined) ?? []).map(move),
    }).catch((e) => kandinsky.toast("Calendar", `The renamed account's calendars kept their old ids: ${(e as Error).message}`, "error"));
  });

  // Settings v2 (API 12): the calendars of every account with their visibility and colour, under the account cards
  const offSection = kandinsky.plugin.registerSettingsSection?.({
    id: "calendars", title: "Calendars", hint: "Which calendars the pane shows, and their colours.", place: "before",
    mount(host, ctx) { const v = mount(CalendarsSection, { target: host, props: { ctx } }); return () => unmount(v); },
  });

  // the engine keeps the cache fresh (CalDAV every few minutes, subscriptions when due) once Kandinsky is up
  const first = setTimeout(() => { void call(kandinsky, "watch", {}, 60).catch(() => {}); }, 5000);
  return () => { clearTimeout(first); offSection?.(); };
}
