// Folder Notes & Genkan — registers the open-folder-note command, file context menu, and Genkan card grid fences/blocks.

import {
  cleanFolder,
  openOrCreateFolderNote,
  parentFolder,
  parseFenceOptions,
} from "./folder-note-utils.js";
import { mountGenkanGrid } from "./genkan-grid.js";

async function listVaultFolders(kandinsky) {
  const folders = [""];
  const queue = [""];
  while (queue.length) {
    const batch = queue.splice(0, 12);
    const lists = await Promise.all(batch.map((d) => kandinsky.list(d).catch(() => [])));
    for (const entries of lists) {
      for (const e of entries) {
        if (e.dir && !e.ignored && !e.name.startsWith(".")) {
          folders.push(e.path);
          queue.push(e.path);
        }
      }
    }
  }
  return folders.sort((a, b) => a.localeCompare(b));
}

export function register(kandinsky) {
  kandinsky.registerCommand({
    id: "open-folder-note",
    title: "Folder Notes: Open or create folder note for active note's folder",
    run: async () => {
      const activePath = kandinsky.context().active?.path;
      if (activePath) {
        const folder = parentFolder(activePath);
        await openOrCreateFolderNote(kandinsky, folder);
        return;
      }
      const folders = await listVaultFolders(kandinsky);
      kandinsky.pick({
        placeholder: "Choose a folder to open or create its folder note…",
        tag: "Folder Note",
        icon: "folder-open",
        items: folders.map((f) => ({
          value: f,
          title: f || "/ (Vault root)",
          icon: "folder",
        })),
        onpick: (chosen) => openOrCreateFolderNote(kandinsky, chosen),
      });
    },
  });

  kandinsky.shell.menu("file", (target) => {
    if (target.path === undefined) return;
    const folder = target.dir ? cleanFolder(target.path) : parentFolder(target.path);
    return [
      {
        label: "Open Folder Note",
        icon: "folder-open",
        run: () => openOrCreateFolderNote(kandinsky, folder),
      },
    ];
  });

  const renderFence = (host, fence) => {
    const opts = parseFenceOptions(fence.source, fence.info);
    return mountGenkanGrid(host, kandinsky, fence.path, opts);
  };

  kandinsky.editor.registerFence("genkan", renderFence);
  kandinsky.editor.registerFence("folder-notes", renderFence);

  kandinsky.registerBlock(
    "folder-notes.grid",
    (host, block) => mountGenkanGrid(host, kandinsky, block.note, block.options ?? {}),
    {
      title: "Folder Notes & Genkan Grid",
      options: [
        { key: "folder", label: "Folder", kind: "text", hint: "Vault folder path (empty: current note's folder, / for root)" },
        { key: "sort", label: "Sort by", kind: "choice", choices: ["name", "mtime", "size"], default: "name" },
        { key: "show", label: "Show", kind: "choice", choices: ["all", "folders", "notes"], default: "all" },
        { key: "columns", label: "Fixed columns", kind: "number", hint: "Optional column count (empty: responsive auto-grid)" },
        { key: "excerpt", label: "Show note excerpts", kind: "toggle", default: true },
      ],
    },
  );
}
