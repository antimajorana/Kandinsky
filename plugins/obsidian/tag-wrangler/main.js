// Tag Wrangler & Tactician — registers the Tags side panel tool, full Tactician pane command, and bulk-rename command.

import { promptRenameTag, scanVaultTags } from "./tag-index.js";
import { mountTagWrangler } from "./tag-ui.js";

export function register(atlas) {
  atlas.shell.sideTool({
    id: "tags",
    title: "Tags",
    icon: "hash",
    mount(host) {
      return mountTagWrangler(host, atlas, { compact: true });
    },
  });

  atlas.registerCommand({
    id: "rename-tag",
    title: "Tag Wrangler: Rename or merge a tag…",
    run: async () => {
      const index = await scanVaultTags(atlas);
      if (!index.byTag.size) {
        atlas.toast("Tag Wrangler", "No #tags found in this vault yet.", "info");
        return;
      }
      const items = [...index.byTag.values()]
        .sort((a, b) => b.allNotes.size - a.allNotes.size || a.tag.localeCompare(b.tag))
        .map((n) => ({
          value: n.tag,
          title: `#${n.tag}`,
          detail: `${n.allNotes.size} ${n.allNotes.size === 1 ? "note" : "notes"}`,
          icon: "hash",
        }));

      atlas.pick({
        placeholder: "Choose a #tag to rename or merge…",
        tag: "Rename tag",
        icon: "hash",
        items,
        onpick: (chosen) => promptRenameTag(atlas, chosen, index),
      });
    },
  });

  atlas.registerCommand({
    id: "open-tactician",
    title: "Tag Wrangler: Open Tag Tactician pane",
    run: () => atlas.openView(),
  });
}
