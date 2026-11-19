// Letterboxd: a command to read the user's export (helper `import_export`), then one sync to start filing it — in
// the import dialog (import.js), or a pick and toasts on an app without `openDialog`'s `view` (API < 23).
export function register(kandinsky) {
  const say = (text, kind = "success") => kandinsky.toast("Letterboxd", text, kind);
  const fail = (e) => say(e instanceof Error ? e.message : String(e), "error");
  const importFrom = async (path) => {
    try {
      say((await kandinsky.helper.call("import_export", { path }, { timeout: 60 })).summary);
      say((await kandinsky.helper.call("sync", { settings: kandinsky.plugin.settings }, { timeout: 300 })).summary);
    } catch (e) { fail(e); }
  };
  kandinsky.registerCommand({ id: "import-export", title: "Letterboxd: import your export…", run: async () => {
    if ((kandinsky.version ?? 0) >= 23) return kandinsky.openDialog(undefined, { title: "Import from Letterboxd", width: 520, height: 420, view: "import.js" });
    let found;
    try { found = (await kandinsky.helper.call("exports", {}, { timeout: 60 })).exports; } catch (e) { return fail(e); }
    kandinsky.pick({
      placeholder: found.length ? "Your Letterboxd export…" : "No export in the vault: its path (letterboxd.com → Settings → Data → Export)",
      tag: "Letterboxd", icon: "film", typed: true,
      items: found.map((p) => ({ value: p, title: p })),
      onpick: (path) => path && importFrom(path),
    });
  } });
}
