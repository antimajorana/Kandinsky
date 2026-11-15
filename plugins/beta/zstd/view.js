// A .zst opened (this plugin claims the type, plugin.toml): the file it holds is decompressed into the plugin's cache
// (helper/helper.ts) and opened there in its own view, in this tab's place — the .zst is an input, never edited.
export default function mount(host, kandinsky) {
  const say = document.createElement("p");
  say.className = "muted";
  say.style.padding = "24px";
  say.textContent = `Decompressing ${(kandinsky.path ?? "").split("/").pop()}…`;
  host.append(say);
  kandinsky.helper.call("open", { path: kandinsky.path }, { timeout: 600 }).then(
    ({ path }) => {
      kandinsky.open(path);
      kandinsky.pane?.close();
    },
    (e) => { say.textContent = `This file could not be decompressed: ${e?.message ?? e}`; },
  );
  return () => say.remove();
}
