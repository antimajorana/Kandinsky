// The Email plugin's page side, loaded with Kandinsky (not only with the pane): its commands, the unread count in the
// status bar, notices of new mail, the inbox block and side tool, saved mail notes drawn as mail, Outlook's sign-in,
// and the question when Claude asks to read an account. The engine watches the accounts (IDLE) from the start.
import { mount, unmount } from "svelte";
import Inbox from "./Inbox.svelte";
import Rules from "./Rules.svelte";
import NoteView from "./NoteView.svelte";
import { call, type PluginApi } from "./api";
import { openMail as openPane } from "./open-mail";
import { THUNDERBIRD_DIALOG, standIn } from "./rules-host";
import { signin } from "./signin";

type Card = { name: string; auth?: string; user?: string; claude?: string };

export function register(kandinsky: PluginApi) {
  const cards = () => ((kandinsky.plugin.settings.accounts as Card[] | undefined) ?? []).filter((c) => c?.name);
  const openMail = (detail: Record<string, unknown> = {}) => openPane(kandinsky, detail);

  kandinsky.registerCommand({ id: "open", title: "Email: open mail", run: () => openMail() });
  kandinsky.registerCommand({ id: "compose", title: "Email: new message", run: () => openMail({ compose: {} }) });
  kandinsky.registerCommand({ id: "check", title: "Email: check for new mail", run: async () => {
    kandinsky.toast("Email", "Checking for new mail…");
    try { await call(kandinsky, "sync", {}, 600); } catch (e) { kandinsky.toast("Email", (e as Error).message, "error"); }
  } });
  kandinsky.registerCommand({ id: "send", title: "Email: send this note…", run: () => {
    const path = kandinsky.context().active?.path;
    if (!path?.endsWith(".md")) { kandinsky.toast("Email", "Open the note to send first."); return; }
    void kandinsky.readText(path).then((raw) => {
      const body = raw.replace(/^---\n[\s\S]*?\n---\n/, "");
      const subject = body.match(/^# (.+)$/m)?.[1] ?? path.split("/").pop()!.replace(/\.md$/, "");
      openMail({ compose: { subject, body: body.replace(/^# .+\n+/, "") } });
    });
  } });
  // a link to a mail saved as a note, followed from another plugin (the Calendar's card): the mail opens in the pane
  // when the index still has it, else the note (what is left of it)
  window.addEventListener("kandinsky-email:open-note", (ev) => {
    const { path } = ((ev as CustomEvent).detail ?? {}) as { path?: string };
    if (!path) return;
    window.dispatchEvent(new CustomEvent("kandinsky-email:heard"));
    void (async () => {
      const props = await kandinsky.noteProps(path).catch(() => ({} as Record<string, unknown>));
      const r = await call<{ id: number | null }>(kandinsky, "find", { message_id: props.message_id, account: props.account }).catch(() => ({ id: null }));
      if (r.id) openMail({ id: r.id }); else kandinsky.open(path);
    })();
  });
  // another plugin asks for a mail to link (the Calendar's "Link a mail…" on an event): the user searches the mail
  // index in the palette, the chosen conversation is saved as its note (Email's own path) and that note handed back
  window.addEventListener("kandinsky-email:pick", (ev) => {
    const { seed, reply } = ((ev as CustomEvent).detail ?? {}) as { seed?: string; reply?: (note: string | null) => void };
    window.dispatchEvent(new CustomEvent("kandinsky-email:heard"));
    if (!reply) return;
    type Hit = { title: string; detail: string; date: string; open: { args: { message_id: string; account: string } } };
    const found = async (q: string) => {
      if (!q.trim()) return [];
      const r = await call<{ hits: Hit[] }>(kandinsky, "vault_search", { q, limit: 20 });
      return r.hits.map((h) => ({ value: JSON.stringify(h.open.args), title: h.title || "(no subject)", detail: `${h.date.slice(0, 10)} · ${h.detail}`, icon: "mail" as const }));
    };
    let answered = false;
    const answer = (note: string | null) => { if (!answered) { answered = true; reply(note); } };
    kandinsky.pick({
      placeholder: "Which mail? Words, from:, to:, subject:…",
      tag: "Link a mail",
      icon: "mail",
      seed,
      // the matches of the asker's words first (an event's title); an Kandinsky whose palette searches (API 35) asks
      // again as the user types, an older one filters these
      items: () => found(seed ?? ""),
      search: found,
      onpick: async (v) => {
        try {
          const r = await call<{ path: string }>(kandinsky, "agent_save_note", JSON.parse(v) as Record<string, unknown>);
          answer(r.path);
        } catch (e) { kandinsky.toast("Email", `The mail was not saved: ${(e as Error).message}`, "error"); answer(null); }
      },
      oncancel: () => answer(null),
    });
  });
  kandinsky.registerCommand({ id: "accounts", title: "Email: accounts…", run: () => kandinsky.plugin.openSettings() });
  kandinsky.registerCommand({ id: "signin", title: "Email: sign in to Outlook…", run: (arg?: unknown) => void signin(kandinsky, (arg as { record?: Card })?.record) });
  // Thunderbird's accounts and local mail: one dialog over the app (API 20); a tab of its own on an older one
  const thunderbird = () => (typeof kandinsky.openDialog === "function"
    ? void kandinsky.openDialog(THUNDERBIRD_DIALOG, { title: "Import from Thunderbird", width: 640, height: 560 })
    : kandinsky.openView(THUNDERBIRD_DIALOG, { title: "Thunderbird", icon: "mail" }));
  kandinsky.registerCommand({ id: "thunderbird", title: "Email: import an account from Thunderbird…", run: thunderbird });
  kandinsky.registerCommand({ id: "thunderbird-mail", title: "Email: put Thunderbird's local mail on the server…", run: thunderbird });
  // one listener however often the plugin is loaded again (a stale one would start a second sign-in)
  const w = window as unknown as { __kandinskyEmailSignin?: EventListener };
  if (w.__kandinskyEmailSignin) window.removeEventListener("kandinsky-email:signin", w.__kandinskyEmailSignin);
  w.__kandinskyEmailSignin = (e) => void signin(kandinsky, (e as CustomEvent<string>).detail);
  window.addEventListener("kandinsky-email:signin", w.__kandinskyEmailSignin);

  // Settings → Email: the rules, edited where the other settings are (plugin API 12)
  kandinsky.plugin.registerSettingsSection?.({ id: "rules", title: "Rules", hint: "What happens to new mail by itself: important, archive, a label, kept as a note.", mount: (host) => {
    const v = mount(Rules, { target: host, props: { frame: "page", mail: standIn(kandinsky) } });
    return () => unmount(v);
  } });

  // saved mail notes are drawn as mail
  kandinsky.registerNoteView?.("mail", { title: "Mail", types: ["email-thread", "email"], render: (host, note) => {
    const v = mount(NoteView, { target: host, props: { kandinsky, note, onmail: openMail } });
    return () => unmount(v);
  } });

  kandinsky.registerBlock("email.inbox", (host, block) => {
    const v = mount(Inbox, { target: host, props: { kandinsky, options: block.options ?? {}, onopen: openMail } });
    return () => unmount(v);
  }, { title: "Mail", options: [{ key: "limit", label: "At most", kind: "number" }, { key: "unseen", label: "Only unread", kind: "toggle" }, { key: "folder", label: "Folder", kind: "text" }, { key: "account", label: "Account", kind: "text", hint: "an account's name in Email's settings; empty: every account" }] });

  kandinsky.shell.sideTool({ id: "mail", title: "Email", icon: "inbox", mount: (host) => {
    const v = mount(Inbox, { target: host, props: { kandinsky, options: { limit: 12 }, onopen: openMail } });
    return () => unmount(v);
  } });

  // the unread count: from the index, again whenever the engine says something changed
  const status = kandinsky.shell.statusItem({ id: "unread", text: "", title: "Unread mail — open Email", run: () => openMail() });
  let countTimer: ReturnType<typeof setTimeout> | undefined;
  const count = () => {
    clearTimeout(countTimer);
    countTimer = setTimeout(async () => {
      try {
        const { unread } = await call<{ unread: number }>(kandinsky, "unread_count", {}, 20);
        status.set(unread ? `✉ ${unread}` : "", `${unread} unread — open Email`);
      } catch { status.set("", "Email"); }
    }, 400);
  };
  kandinsky.helper.on("changed", count);
  kandinsky.helper.on("new", (d) => {
    count();
    if (kandinsky.plugin.settings.notify === false) return;
    const n = d as { count: number; messages: { id: number; subject: string; from: { name: string; addr: string }[] }[] };
    for (const m of n.messages.slice(0, 3)) kandinsky.toast(m.from[0]?.name || m.from[0]?.addr || "New mail", m.subject || "(no subject)", "info", { run: () => openMail({ id: m.id }) });
    if (n.count > 3) kandinsky.toast("Email", `${n.count - 3} more new messages`, "info", { run: () => openMail() });
  });
  kandinsky.helper.on("sent", (d) => { const s = d as { subject: string; later?: boolean }; if (s.later) kandinsky.toast("Sent (scheduled)", s.subject, "success"); });
  kandinsky.helper.on("notify", (d) => { const r = d as { rule: string; ids: number[] }; kandinsky.toast("Email", `New mail for the rule “${r.rule}”`, "info", { run: () => openMail({ id: r.ids[0] }) }); });

  // a card renamed in Settings: the index and the saved notes' folder follow (the core moved its secrets)
  kandinsky.helper.on("settings:renamed", (d) => {
    const r = d as { key?: string; from: string; to: string };
    if (r?.key === "accounts") void call(kandinsky, "rename_account", { from: r.from, to: r.to }).catch((e) => kandinsky.toast("Email", `The account's mail kept its old name: ${(e as Error).message}`, "error"));
  });

  // an agent's email_open: the message shown in the pane, then the engine told (its tool answers only after this)
  kandinsky.helper.on("open", (d) => {
    const q = d as { id: string; message: number };
    let ok = "no";
    try { openMail({ id: q.message }); ok = "opened"; }
    finally { void kandinsky.helper.call("consent_answer", { id: q.id, allow: ok, settings: kandinsky.plugin.settings }); }
  });

  // Claude asks to read an account (the card's "Claude may read it" = ask): the answer is given here
  kandinsky.helper.on("consent", (d) => {
    const q = d as { id: string; account: string; user: string; what: string };
    const reply = (allow: string) => kandinsky.helper.call("consent_answer", { id: q.id, allow, settings: kandinsky.plugin.settings });
    kandinsky.pick({
      placeholder: `Claude asks to read ${q.account}${q.user ? ` (${q.user})` : ""}: ${q.what}`, tag: "Email",
      items: [
        { value: "once", title: "Allow this once" },
        { value: "always", title: `Always allow for ${q.account}`, detail: "its card's “Claude may read it” becomes always" },
        { value: "no", title: "Don't allow" },
      ],
      onpick: async (v) => {
        await reply(v);
        if (v === "always") await kandinsky.plugin.saveSettings({ accounts: cards().map((a) => (a.name === q.account ? { ...a, claude: "always" } : a)) });
      },
    });
  });

  // the engine starts watching the accounts (IDLE, the periodic sync, snoozes, scheduled mail) once Kandinsky is up
  const first = setTimeout(() => { void call(kandinsky, "watch", {}, 60).then(count, () => {}); }, 4000);
  return () => clearTimeout(first);
}
