// Tag Wrangler & Tactician — vault-wide Markdown indexer, nested tree builder, and interactive rename/merge flow.

import { extractNoteInfo, normalizeTag, renameTagInText } from "./tag-engine.js";

/** Recursively list all non-ignored .md files in the vault. */
export async function listVaultMarkdownFiles(atlas, dir = "") {
  const out = [];
  const queue = [dir];
  while (queue.length) {
    const batch = queue.splice(0, 12);
    const results = await Promise.all(batch.map((d) => atlas.list(d).catch(() => [])));
    for (const entries of results) {
      for (const e of entries) {
        if (e.ignored || e.name.startsWith(".")) continue;
        if (e.dir) queue.push(e.path);
        else if (/\.md$/i.test(e.name)) out.push(e.path);
      }
    }
  }
  return out;
}

/** Scan all .md files in parallel chunks and build a complete tag index. */
export async function scanVaultTags(atlas) {
  const files = await listVaultMarkdownFiles(atlas);
  const notes = new Map();
  const CHUNK = 24;
  for (let i = 0; i < files.length; i += CHUNK) {
    const slice = files.slice(i, i + CHUNK);
    const infos = await Promise.all(slice.map(async (path) => {
      try {
        const text = await atlas.readText(path);
        return extractNoteInfo(path, text);
      } catch {
        return null;
      }
    }));
    for (const info of infos) {
      if (info) notes.set(info.path, info);
    }
  }
  return buildIndexFromNotes(notes);
}

/** Build flat tag counts + nested tree from a Map<path, noteInfo>. */
export function buildIndexFromNotes(notesMap) {
  const root = { tag: "", name: "", directNotes: new Set(), allNotes: new Set(), children: new Map() };
  const byTag = new Map();

  const ensureNode = (fullTag) => {
    let cur = root;
    const parts = fullTag.split("/");
    let built = "";
    for (const part of parts) {
      built = built ? `${built}/${part}` : part;
      let child = cur.children.get(part);
      if (!child) {
        child = { tag: built, name: part, directNotes: new Set(), allNotes: new Set(), children: new Map() };
        cur.children.set(part, child);
        byTag.set(built, child);
      }
      cur = child;
    }
    return cur;
  };

  for (const info of notesMap.values()) {
    for (const tag of info.tags) {
      const leaf = ensureNode(tag);
      leaf.directNotes.add(info.path);
      const parts = tag.split("/");
      let prefix = "";
      for (const p of parts) {
        prefix = prefix ? `${prefix}/${p}` : p;
        byTag.get(prefix)?.allNotes.add(info.path);
      }
    }
  }

  return { notes: notesMap, root, byTag, totalNotes: notesMap.size };
}

/** Sort child nodes by count descending (or alphabetically). */
export function sortedChildren(node, sortMode = "count") {
  const arr = [...node.children.values()];
  arr.sort((a, b) => {
    if (sortMode === "count") {
      const diff = b.allNotes.size - a.allNotes.size;
      if (diff !== 0) return diff;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return arr;
}

/** Interactive Rename / Merge workflow using atlas.input and atlas.confirm. */
export async function promptRenameTag(atlas, oldRaw, existingIndex = null) {
  const oldTag = normalizeTag(oldRaw);
  if (!oldTag) {
    atlas.toast("Tag Wrangler", "Select a valid tag to rename.", "error");
    return null;
  }

  const index = existingIndex ?? await scanVaultTags(atlas);
  const includeSubtags = atlas.plugin.settings?.include_subtags !== false;
  const node = index.byTag.get(oldTag);
  const candidatePaths = node
    ? [...(includeSubtags ? node.allNotes : node.directNotes)]
    : [];

  if (!candidatePaths.length) {
    atlas.toast("Tag Wrangler", `No notes currently contain #${oldTag}.`, "info");
    return null;
  }

  const typed = await atlas.input(`Rename or merge #${oldTag}`, {
    value: oldTag,
    hint: includeSubtags
      ? "New tag name (without #). Subtags move with it; existing tags merge cleanly."
      : "New tag name (without #). Existing tags merge cleanly.",
    ok: "Next",
  });
  if (typed === null) return null;

  const newTag = normalizeTag(typed);
  if (!newTag) {
    atlas.toast("Tag Wrangler", `“${typed}” is not a valid tag name.`, "error");
    return null;
  }
  if (newTag === oldTag) return null;

  const merging = index.byTag.has(newTag);
  const n = candidatePaths.length;
  const confirmed = await atlas.confirm(
    `Rename #${oldTag} to #${newTag} across ${n} ${n === 1 ? "note" : "notes"}?`,
    {
      ok: merging ? "Merge tags" : "Rename",
      hint: merging
        ? `#${newTag} already exists (${index.byTag.get(newTag).allNotes.size} notes) — duplicate frontmatter tags will be merged.`
        : "Rewrites both YAML frontmatter tags and markdown body #tags.",
    },
  );
  if (!confirmed) return null;

  let rewritten = 0;
  for (const path of candidatePaths) {
    const before = await atlas.readText(path);
    const after = renameTagInText(before, oldTag, newTag, includeSubtags);
    if (after !== before) {
      await atlas.writeText(path, after);
      rewritten++;
    }
  }

  atlas.toast(
    "Tag Wrangler",
    `Renamed #${oldTag} → #${newTag} in ${rewritten} ${rewritten === 1 ? "note" : "notes"}.`,
    "success",
  );
  return newTag;
}
