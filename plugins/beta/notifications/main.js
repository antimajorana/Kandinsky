// Notifications (docs/design/DESIGN-notifications.md): the server's messages, a note per source in the folder set
// (newest first). The helper's `sync` files them — every 5 minutes by the core's schedule, once when the page starts,
// and on "Check now" — and says what it found as a `synced` event, whose loud messages (sources not muted) become
// toasts here. The bell in the status bar counts what is unread; opening a source's note reads it. A source is muted
// from its note's `muted:` (true, or a date), here with "Notifications: mute a source…" (sources.js, a dialog). "Send
// to my phone" (a command, the editor menu) goes through the helper's `send`, as the agents' `notifications_send` tool
// does; the command's form is send.js, a dialog.
const folderOf = (kandinsky) => String(kandinsky.plugin.settings.folder || "notifications").replace(/\/+$/, "");
/** A source's name: its note's, under the folder. */
export const sourceName = (kandinsky, path) => path.slice(folderOf(kandinsky).length + 1, -3);

/** The sources' notes, one per source. */
export async function sourceNotes(kandinsky) {
  const entries = await kandinsky.list(folderOf(kandinsky)).catch(() => []); // none yet: nothing filed
  return entries.filter((e) => !e.dir).map((e) => e.path).filter((p) => p.startsWith(`${folderOf(kandinsky)}/`) && p.endsWith(".md"));
}

/** A day as YYYY-MM-DD where the user is (UTC's day is another one for hours each evening west of Greenwich). */
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** A note's `muted:` read: "always", the last day as YYYY-MM-DD, or "" (not muted, or a day gone by). */
export function mutedOf(props) {
  const m = String(props?.muted ?? "false");
  if (m === "true") return "always";
  return /^\d{4}-\d{2}-\d{2}$/.test(m) && m >= localDay() ? m : "";
}

/** How long a source can be muted, as the mute's `how`. */
export const MUTE_CHOICES = [
  { value: "1", title: "A day" }, { value: "7", title: "A week" }, { value: "30", title: "A month" },
  { value: "always", title: "Until I unmute it" }, { value: "off", title: "Unmute" },
];

/** How long a mute lasts: a number of days, "always", or "off" (unmute). Returns the note's new `muted:`. */
export async function muteSource(kandinsky, path, how) {
  const until = how === "always" ? "true" : how === "off" ? "false" : localDay(new Date(Date.now() + Number(how) * 864e5));
  await kandinsky.writeProperty(path, "muted", until);
  return until;
}

/** Sends to the phone; the channel it went through (Apprise or ntfy), or throws with the reason. */
export async function sendToPhone(kandinsky, text, title) {
  const r = await kandinsky.helper.call("send", { text, title: title || "Kandinsky" });
  return (r.result ?? r).through;
}

const dialogs = (kandinsky) => (kandinsky.version ?? 0) >= 23; // openDialog's `view` (plugin API 23)

export function register(kandinsky) {
  const folder = () => folderOf(kandinsky);
  const isNote = (path) => path?.startsWith(`${folder()}/`) && path.endsWith(".md");
  const bell = kandinsky.shell.statusItem({
    id: "bell",
    text: "🔔",
    title: "Notifications",
    run: () => {
      if (typeof window !== "undefined") {
        const ev = new CustomEvent("kandinsky:open-notifications", { cancelable: true });
        if (!window.dispatchEvent(ev)) return;
      }
      void list();
    },
  });
  const notes = () => sourceNotes(kandinsky);
  async function count() {
    let n = 0;
    for (const p of await notes()) n += Number((await kandinsky.noteProps(p).catch(() => ({}))).unread) || 0;
    bell.set(n ? `🔔 ${n}` : "🔔", n ? `${n} unread notification${n === 1 ? "" : "s"}` : "Notifications");
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("kandinsky:notifications-updated", { detail: { unread: n, folder: folder() } }));
    }
  }
  // whoever ran the sync (the schedule, this page, another window): its loud messages are toasted once, here
  const unhear = kandinsky.helper.on("synced", (a) => {
    for (const m of (a?.loud ?? []).slice(-5)) kandinsky.toast(`${m.source}: ${m.title}`, m.text, "info", { run: () => kandinsky.open(m.path) });
    void count();
  });
  async function sync(quiet) {
    try {
      const r = await kandinsky.helper.call("sync", {}, { timeout: 60 });
      const a = r.result ?? r;
      if (!quiet && !a.new) kandinsky.toast("Notifications", a.problems?.length ? a.problems.join("; ") : "nothing new");
    } catch (e) { if (!quiet) kandinsky.toast("Notifications", String(e.message ?? e), "error"); }
    void count();
  }
  async function send(text, title) {
    try {
      kandinsky.toast("Sent to your phone", `through ${await sendToPhone(kandinsky, text, title)}`, "success");
    } catch (e) { kandinsky.toast("Not sent", String(e.message ?? e).replace(/^\w+Error: /, ""), "error"); }
  }
  const from = () => kandinsky.context().active?.path?.split("/").pop()?.replace(/\.(md|page)$/, ""); // a note or a page, by its name
  async function list() {
    const items = await Promise.all((await notes()).map(async (p) => {
      const props = await kandinsky.noteProps(p).catch(() => ({}));
      const unread = Number(props.unread) || 0;
      return { value: p, title: sourceName(kandinsky, p), detail: [unread ? `${unread} unread` : "", { always: "muted", "": "" }[mutedOf(props)] ?? `muted until ${mutedOf(props)}`].filter(Boolean).join(" · ") };
    }));
    kandinsky.pick({ placeholder: "A source's notifications…", tag: "Notifications", items, onpick: (p) => kandinsky.open(p) });
  }

  // a source's note opened: read
  kandinsky.on("file:open", async ({ path }) => {
    if (!isNote(path)) return;
    const props = await kandinsky.noteProps(path).catch(() => ({}));
    if (Number(props.unread)) { await kandinsky.writeProperty(path, "unread", "0"); void count(); }
  });

  kandinsky.registerCommand({ id: "check", title: "Notifications: check now", run: () => void sync(false) });
  kandinsky.registerCommand({ id: "open", title: "Notifications: a source's notes…", run: () => void list() });
  kandinsky.registerCommand({ id: "mute", title: "Notifications: mute a source…", run: async () => {
    if (dialogs(kandinsky)) return kandinsky.openDialog(undefined, { title: "Notification sources", width: 520, height: 440, view: "sources.js" });
    const items = (await notes()).map((p) => ({ value: p, title: sourceName(kandinsky, p) }));
    kandinsky.pick({ placeholder: "Mute which source?", tag: "Mute", items, onpick: (p) => kandinsky.pick({
      placeholder: "For how long?", tag: "Mute",
      items: MUTE_CHOICES,
      onpick: async (v) => {
        const until = await muteSource(kandinsky, p, v);
        void count();
        kandinsky.toast(v === "off" ? "Unmuted" : "Muted", `${sourceName(kandinsky, p)}${v === "off" || v === "always" ? "" : ` until ${until}`} — still logged`);
      },
    }) });
  } });
  kandinsky.registerCommand({ id: "send", title: "Notifications: send to my phone…", run: () => dialogs(kandinsky)
    ? kandinsky.openDialog(from() ?? "", { title: "Send to my phone", width: 480, height: 320, view: "send.js" })
    : kandinsky.pick({
    placeholder: "What to send to your phone…", tag: "Phone", items: [], typed: (t) => `Send “${t}”`,
    onpick: (text) => void send(text, from()),
  }) });
  kandinsky.shell.menu("editor", (t) => ((t.selection ?? "").trim() ? [{ label: "Send the selection to my phone", icon: "arrow-up", run: () => send(t.selection.trim(), from()) }] : []));

  const onSyncRequest = () => void sync(false);
  if (typeof window !== "undefined") window.addEventListener("kandinsky:notifications-sync-request", onSyncRequest);

  void sync(true); // then the core's schedule, every 5 minutes; its findings arrive as `synced`
  return () => {
    unhear();
    if (typeof window !== "undefined") window.removeEventListener("kandinsky:notifications-sync-request", onSyncRequest);
  };
}
