// Export — "Export…" on a note (its menus in the file tree and the tab, the palette) opens the export dialog (view.js):
// the options beside a preview, PDF through Typst or LaTeX, LaTeX or Typst source, Word (helper/helper.ts).
const isNote = (p) => !!p && /\.md$/i.test(p);

export function register(kandinsky) {
  const open = (path) => {
    const opts = { title: `Export ${path.split("/").pop().replace(/\.md$/i, "")}`, icon: "file" };
    // a popup over the app (API 20); a tab in an older app
    if (kandinsky.openDialog) void kandinsky.openDialog(path, { ...opts, width: 1100, height: 760 });
    else kandinsky.openView(path, opts);
  };
  const rows = (path) => (isNote(path) ? [{ label: "Export…", icon: "file", run: () => open(path) }] : []);
  kandinsky.shell.menu("file", (t) => (t.dir ? [] : rows(t.path)));
  kandinsky.shell.menu("tab", (t) => rows(t.path));
  kandinsky.registerCommand({ id: "dialog", title: "Export the open note…", run: () => {
    const path = kandinsky.context().active?.path;
    if (!isNote(path)) return kandinsky.toast("Export", "Open a note first.");
    return open(path);
  } });
}
