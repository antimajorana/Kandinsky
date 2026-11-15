// Tag Wrangler & Tactician — full two-column Tactician pane (view.js).

import { mountTagWrangler } from "./tag-ui.js";

export default function (host, kandinsky) {
  return mountTagWrangler(host, kandinsky, {
    compact: false,
    initialTag: typeof kandinsky.arg === "string" ? kandinsky.arg.replace(/^#+/, "") : "",
  });
}
