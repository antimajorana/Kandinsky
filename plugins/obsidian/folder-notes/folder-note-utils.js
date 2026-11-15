// Folder Notes & Genkan — path resolution, folder note creation, and lightweight Markdown metadata parser.

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;

/** Normalize a vault folder path (no leading or trailing slash; "" is vault root). */
export function cleanFolder(path) {
  return String(path ?? "").trim().replace(/^\/+|\/+$/g, "");
}

/** Parent folder of a vault file path ("" when in vault root). */
export function parentFolder(filePath) {
  const clean = cleanFolder(filePath);
  const idx = clean.lastIndexOf("/");
  return idx >= 0 ? clean.slice(0, idx) : "";
}

/** Display name of a folder ("Vault" for root ""). */
export function folderDisplayName(folder) {
  const clean = cleanFolder(folder);
  return clean ? clean.split("/").pop() : "Vault";
}

/** Preferred and fallback folder-note paths for `folder` according to the `naming` setting. */
export function candidateFolderNotePaths(kandinsky, folder) {
  const clean = cleanFolder(folder);
  const mode = kandinsky.plugin.settings?.naming === "index" ? "index" : "folder-name";
  if (!clean) return mode === "index" ? ["index.md", "Vault.md"] : ["index.md", "Vault.md"];
  const leaf = clean.split("/").pop();
  const byName = `${clean}/${leaf}.md`;
  const byIndex = `${clean}/index.md`;
  return mode === "index" ? [byIndex, byName] : [byName, byIndex];
}

/** Return the existing folder note path if present, otherwise null. */
export async function findExistingFolderNote(kandinsky, folder) {
  for (const p of candidateFolderNotePaths(kandinsky, folder)) {
    if (await kandinsky.exists(p)) return p;
  }
  return null;
}

/** Seed Markdown text for a newly created folder overview note. */
export function buildFolderNoteSeed(folder) {
  const title = folderDisplayName(folder);
  return `---\ntags: [moc]\n---\n# ${title}\n\n\`\`\`genkan\nsort: name\n\`\`\`\n`;
}

/** Find or create the folder note for `folder`, then open it in Kandinsky. */
export async function openOrCreateFolderNote(kandinsky, folder, opts = {}) {
  const clean = cleanFolder(folder);
  const existing = await findExistingFolderNote(kandinsky, clean);
  if (existing) {
    kandinsky.open(existing, undefined, { beside: !!opts.beside });
    return existing;
  }
  const [target] = candidateFolderNotePaths(kandinsky, clean);
  const created = await kandinsky.createFile(target, buildFolderNoteSeed(clean));
  kandinsky.open(target, undefined, { beside: !!opts.beside });
  if (created) {
    kandinsky.toast("Folder Notes", `Created folder overview note ${target}`, "success");
  }
  return target;
}

/** Resolve a `folder:` option from a fence or block relative to `notePath`. */
export function resolveTargetFolder(rawFolder, notePath) {
  const base = notePath ? parentFolder(notePath) : "";
  if (rawFolder === undefined || rawFolder === null || String(rawFolder).trim() === "" || String(rawFolder).trim() === ".") {
    return base;
  }
  const str = String(rawFolder).trim();
  if (str === "/") return "";
  if (str.startsWith("./") || str.startsWith("../")) {
    const parts = base ? base.split("/") : [];
    for (const seg of str.split("/")) {
      if (!seg || seg === ".") continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    return parts.join("/");
  }
  return cleanFolder(str);
}

/** Parse simple `key: value` lines from a fence body. */
export function parseFenceOptions(source, info = "") {
  const out = {};
  if (info && info.trim() && !info.includes(":")) out.folder = info.trim();
  for (const line of String(source ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(trimmed);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const raw = m[2].trim().replace(/^['"]|['"]$/g, "");
    if (raw === "true") out[key] = true;
    else if (raw === "false") out[key] = false;
    else if (raw !== "" && !Number.isNaN(Number(raw)) && key === "columns") out[key] = Number(raw);
    else out[key] = raw;
  }
  return out;
}

/** Clean inline Markdown syntax out of an excerpt line so cards read cleanly. */
function stripMarkdownInline(line) {
  return line
    .replace(/!\[\[[^\]]*\]\]/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1")
    .replace(/(?:^|\s)#[\p{L}\p{N}_\-/]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract card metadata ({ title, excerpt, tags }) from a Markdown note's text. */
export function summarizeNote(path, text) {
  const fallbackTitle = path.split("/").pop().replace(/\.md$/i, "");
  let title = "";
  let description = "";
  const tags = new Set();

  const fm = FRONTMATTER_RE.exec(text);
  const body = fm ? text.slice(fm[0].length) : text;

  if (fm) {
    const lines = fm[1].split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(lines[i]);
      if (!m) continue;
      const k = m[1].toLowerCase();
      const v = m[2].trim().replace(/^['"]|['"]$/g, "");
      if (k === "title" && v) title = v;
      else if ((k === "description" || k === "summary" || k === "subtitle") && v) description = v;
      else if (k === "tags" || k === "tag") {
        if (v && v !== "[]") {
          const inner = v.startsWith("[") && v.endsWith("]") ? v.slice(1, -1) : v;
          for (const item of (inner.includes(",") ? inner.split(",") : inner.split(/\s+/))) {
            const clean = item.trim().replace(/^['"#]+|['"]+$/g, "");
            if (clean) tags.add(clean);
          }
        } else {
          while (i + 1 < lines.length) {
            const li = /^\s*-\s*(.+?)\s*$/.exec(lines[i + 1]);
            if (!li) break;
            const clean = li[1].replace(/\s+#.*$/, "").trim().replace(/^['"#]+|['"]+$/g, "");
            if (clean) tags.add(clean);
            i++;
          }
        }
      }
    }
  }

  let fence = "";
  const excerptParts = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const f = FENCE_RE.exec(rawLine);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = "";
      continue;
    }
    if (fence) continue;
    const h1 = /^\s*#\s+(.+?)\s*$/.exec(rawLine);
    if (h1 && !title) { title = stripMarkdownInline(h1[1]); continue; }
    if (/^\s*#{1,6}\s/.test(rawLine)) continue;

    // Collect inline #tags
    const noCode = rawLine.replace(/`+[^`]*`+/g, " ");
    for (const tm of noCode.matchAll(/(?:^|[\s({'"`,;])#([\p{L}\p{N}_\-]+(?:\/[\p{L}\p{N}_\-]+)*)/gu)) {
      if (/[^\d/]/.test(tm[1])) tags.add(tm[1]);
    }

    if (!description && excerptParts.join(" ").length < 160) {
      const cleaned = stripMarkdownInline(rawLine.replace(/^\s*[-*+>]\s+/, ""));
      if (cleaned) excerptParts.push(cleaned);
      else if (excerptParts.length) break; // first paragraph complete
    }
  }

  const rawExcerpt = description || excerptParts.join(" ");
  const excerpt = rawExcerpt.length > 145 ? `${rawExcerpt.slice(0, 142).trimEnd()}…` : rawExcerpt;
  return {
    title: title || fallbackTitle,
    excerpt,
    tags: [...tags].slice(0, 5),
  };
}
