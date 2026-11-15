// An .rnote opened (this plugin claims the type, plugin.toml): converted into the drawing beside it, which opens in its
// place — the .rnote is an input, never edited.
import { openAsDrawing } from "./main.js";

export default function mount(host, kandinsky) {
  const say = document.createElement("p");
  say.className = "muted";
  say.style.padding = "24px";
  say.textContent = `Opening ${(kandinsky.path ?? "").split("/").pop()} as a drawing…`;
  host.append(say);
  void openAsDrawing(kandinsky, kandinsky.path).then((opened) => {
    if (opened) kandinsky.pane?.close();
    else say.textContent = "This Rnote file could not be converted (see the notice).";
  });
  return () => say.remove();
}
