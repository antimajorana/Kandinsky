// Kiwix — the command that opens the search pane (view.js).
export function register(kandinsky) {
  kandinsky.registerCommand({ id: "search", title: "Kiwix: search the offline library", run: () => kandinsky.openView(undefined, { title: "Kiwix" }) });
}
