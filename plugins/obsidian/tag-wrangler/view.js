// Tag Wrangler & Tactician — full two-column Tactician pane (view.js).

import { mountTagWrangler } from "./tag-ui.js";

export default function (host, atlas) {
  return mountTagWrangler(host, atlas, {
    compact: false,
    initialTag: typeof atlas.arg === "string" ? atlas.arg.replace(/^#+/, "") : "",
  });
}
