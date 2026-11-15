// A vault's startup script: copy to <vault>/.kandinsky/init.js. Same API as a plugin (docs/guides/EXTENDING.md),
// for small things that do not deserve a folder. Reloaded on every save.
export function register(kandinsky) {
  // Today's log, one key away.
  kandinsky.registerCommand({
    id: "today-note", title: "Open today's log", keys: "Ctrl+Alt+T",
    run: () => kandinsky.open(`log/${new Date().toLocaleDateString("sv-SE")}.md`), // YYYY-MM-DD, the local day
  });

  // Two files side by side: the note being written, and the one it draws on.
  kandinsky.registerCommand({
    id: "focus-beside", title: "Open FOCUS.md beside this tab",
    run: () => kandinsky.open("FOCUS.md", undefined, { beside: true }),
  });

  // A chooser of your own: `pick` is the same fuzzy list the palette uses.
  kandinsky.registerCommand({
    id: "state", title: "Set this note's state…",
    run: () => {
      const path = kandinsky.context().active?.path;
      if (!path) return kandinsky.toast("Open a note first");
      kandinsky.pick({
        placeholder: "State of this note", tag: "State",
        items: ["active", "waiting", "done"].map((s) => ({ value: s, title: s })),
        onpick: (s) => kandinsky.writeProperty(path, "state", s),   // rewrites only that key of the frontmatter
      });
    },
  });
}
