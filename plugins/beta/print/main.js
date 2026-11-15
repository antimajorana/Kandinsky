// Print — a dialog (view.js) with the document as it will print and the options; CUPS through the helper (helper/helper.ts:
// `lp`, run by the core). A note prints as the document the Export plugin makes of it, any other file as it is.
export function register(kandinsky) {
  // the print dialog (view.js): the document as it will print beside the options; a popup (API 20), a tab in an older app
  const print = (path) => {
    const opts = { title: `Print ${path.split("/").pop()}`, icon: "file" };
    if (kandinsky.openDialog) void kandinsky.openDialog(path, { ...opts, width: 1000, height: 720 });
    else kandinsky.openView(path, opts);
  };
  const printable = (p) => !!p && !p.endsWith("/");
  kandinsky.shell.menu("file", (t) => (t.path && !t.dir ? [{ label: "Print", icon: "file", run: () => print(t.path) }] : []));
  kandinsky.shell.menu("tab", (t) => (printable(t.path) ? [{ label: "Print", icon: "file", run: () => print(t.path) }] : []));
  kandinsky.registerCommand({ id: "this", title: "Print the open file", run: () => {
    const path = kandinsky.context().active?.path;
    if (!printable(path)) return kandinsky.toast("Print", "Open a file first.");
    return print(path);
  } });
}
