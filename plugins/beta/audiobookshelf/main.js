// Audiobookshelf's page side — the Libraries page's Audiobooks and Podcasts (the user's Audiobookshelf) and a command
// opening it; a book opens in the player (view.js), a podcast on its episodes (podcast.js). The catalog side is the helper (helper/). docs/design/DESIGN-audiobooks.md.
import { abs, clock, openidSignIn } from "./abs.js";
import { playBook } from "./play.js";

/** Another plugin's ▶ on a book of this server (the Books reader's, when the book's note has `audiobookshelf: <id>`):
 *  window events, answered only while a server is set. `kandinsky-audiobook:ask` `{ item }` gets `plugin` (this plugin's
 *  id, which the app's player names in its state) set while it is dispatched; `kandinsky-audiobook:play` `{ item, from? }`
 *  gets `started`, the promise of the playing (play.js, the pane's own path); `kandinsky-audiobook:ready` tells readers
 *  opened before this plugin to ask again. */
function answerReaders(kandinsky) {
  const ask = (ev) => { const d = ev.detail; if (d && abs(kandinsky).on) d.plugin = kandinsky.plugin.id; };
  const play = (ev) => {
    const d = ev.detail, a = abs(kandinsky);
    if (d?.item && a.on) d.started = playBook(kandinsky, a, { item: String(d.item), from: Number.isFinite(d.from) ? d.from : undefined });
  };
  window.addEventListener("kandinsky-audiobook:ask", ask);
  window.addEventListener("kandinsky-audiobook:play", play);
  window.dispatchEvent(new CustomEvent("kandinsky-audiobook:ready"));
  return () => { window.removeEventListener("kandinsky-audiobook:ask", ask); window.removeEventListener("kandinsky-audiobook:play", play); };
}

export function register(kandinsky) {
  const listen = (id, title) => kandinsky.openView(id, { title, icon: "headphones" });
  // the library is the Libraries page's Audiobooks; the pane is the player
  kandinsky.registerCommand({ id: "library", title: "Audiobooks: library", run: () => kandinsky.openLibrary("audiobooks") });
  // the pane with no book: the server's shelves, search, collections, playlists and your listening
  const home = () => kandinsky.openView(undefined, { title: "Audiobookshelf", icon: "headphones" });
  kandinsky.registerCommand({ id: "home", title: "Audiobooks: shelves and search", run: home });
  // the server's own sign-in (Authelia or any OpenID provider in front of it), instead of pasting an API token
  kandinsky.registerCommand({
    id: "signin", title: "Audiobookshelf: sign in (OpenID, Authelia…)",
    run: async () => {
      try { await openidSignIn(kandinsky); kandinsky.toast?.("Signed in to Audiobookshelf", "Its token is kept with the plugin's secrets."); }
      catch (e) { kandinsky.toast?.("Not signed in to Audiobookshelf", String(e?.message ?? e), "error"); }
    },
  });
  kandinsky.registerLibrary?.({
    id: "audiobooks", title: "Audiobooks", icon: "headphones", noun: "audiobooks",
    async load() {
      const a = abs(kandinsky);
      if (!a.on) return [];
      return (await a.books()).map((b) => {
        const done = b.progress?.isFinished, pct = b.progress ? Math.round((b.progress.progress ?? 0) * 100) : 0;
        return {
          id: b.id, title: b.title, sub: [b.author, b.narrator && `read by ${b.narrator}`, clock(b.duration, true)].filter(Boolean).join(" · "),
          cover: () => a.cover(b.id).catch(() => null),
          flags: done ? [{ label: "finished" }] : [], // how far is the bar under the cover
          groups: [b.series || b.author || b.library, ...b.groups].filter(Boolean), tags: done ? ["finished"] : pct ? ["listening"] : [],
          text: [b.title, b.author, b.narrator, b.series].join(" "),
          sort: { title: b.title, recent: b.progress?.lastUpdate ?? 0, author: b.author }, book: b,
          // the Continue row and the bar under the cover: how far, and when last listened
          progress: done ? 1 : b.progress ? b.progress.progress ?? 0 : undefined, lastUsed: b.progress?.lastUpdate || undefined,
          // yours once started (past the start, as its note is made) or finished; the rest is the server's, in its own tab
          ...(done || pct >= 1 ? {} : { from: "Audiobookshelf" }),
        };
      });
    },
    groupsTitle: "Series, authors, collections", layouts: ["covers", "list"],
    // the server's own shelves (Continue listening, Recently added, series…) and its search: the pane's home, its own
    // tab — the library lists only what you have started; on the phone the app's own Audiobooks screen
    homes: [{ from: "Audiobookshelf", label: "Audiobookshelf", run: () => kandinsky.openNative?.("audiobookshelf:home") || home() }],
    sorts: [{ id: "recent", label: "last listened", desc: true }, { id: "title", label: "title" }, { id: "author", label: "author" }],
    // not signed in (no token yet), or no server named: a button, never the request's error
    setup: {
      label: "Sign in to Audiobookshelf",
      run: async () => {
        if (!abs(kandinsky).on && kandinsky.openSettings) return kandinsky.openSettings();
        try { await openidSignIn(kandinsky); kandinsky.toast?.("Signed in to Audiobookshelf", "Its token is kept with the plugin's secrets."); }
        catch (e) { kandinsky.toast?.("Not signed in to Audiobookshelf", String(e?.message ?? e), "error"); }
      },
    },
    search: "Search the audiobooks…", empty: "No audiobooks: your Audiobookshelf's address in Settings → Plugins → Audiobookshelf, then the command “Audiobookshelf: sign in” (or an API token there).",
    detail: (item) => ({
      kind: "Audiobook", title: item.title, lines: [{ text: item.sub ?? "" }, ...(item.book.series ? [{ text: item.book.series, muted: true }] : [])],
      actions: [{ label: item.book.progress && !item.book.progress.isFinished ? "Go on listening" : "Listen", icon: "headphones", primary: true, run: () => listen(item.id, item.title) }],
    }),
    open: (item) => listen(item.id, item.title),
  });
  // the server's podcasts beside its audiobooks: a podcast opens on its episodes (podcast.js)
  const episodes = (id, title) => kandinsky.openView(`show:${id}`, { title, icon: "headphones" });
  kandinsky.registerLibrary?.({
    id: "podcasts", title: "Podcasts", icon: "headphones", noun: "podcasts",
    async load() {
      const a = abs(kandinsky);
      if (!a.on) return [];
      return (await a.shows()).map((p) => ({
        id: p.id, title: p.title, sub: [p.author, p.episodes ? `${p.episodes} episodes` : ""].filter(Boolean).join(" · "),
        cover: () => a.cover(p.id).catch(() => null), groups: [p.author || p.library].filter(Boolean), tags: p.lastUsed ? ["listening"] : [],
        text: [p.title, p.author].join(" "), sort: { title: p.title, recent: p.lastUsed, author: p.author }, lastUsed: p.lastUsed || undefined, show: p,
        ...(p.lastUsed ? {} : { from: "Audiobookshelf" }), // yours once listened to; the rest in the server's own tab
      }));
    },
    groupsTitle: "Authors", layouts: ["covers", "list"],
    homes: [{ from: "Audiobookshelf", label: "Audiobookshelf", run: () => kandinsky.openNative?.("audiobookshelf:home") || home() }],
    sorts: [{ id: "recent", label: "last listened", desc: true }, { id: "title", label: "title" }],
    search: "Search the podcasts…", empty: "No podcasts: none in your Audiobookshelf's podcast libraries (or its address is not set: Settings → Plugins → Audiobookshelf).",
    detail: (item) => ({ kind: "Podcast", title: item.title, lines: [{ text: item.sub ?? "" }], actions: [{ label: "Episodes", icon: "headphones", primary: true, run: () => episodes(item.id, item.title) }] }),
    open: (item) => episodes(item.id, item.title),
  });
  return answerReaders(kandinsky); // undone when the plugin reloads or is switched off
}
