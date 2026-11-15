// Paste Image Rename — Kandinsky plugin (API v28).
// Saves pasted or dropped images into zAttachments (or configured folder), named cleanly after the active note.

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico|tiff?)$/i;
const MIME_TO_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/avif": "avif",
  "image/tiff": "tif",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};

const DEFAULTS = {
  attachment_folder: "zAttachments",
  pattern: "{note}-{n}",
  prompt_rename: false,
  use_wikilink: true,
};

export function isImageFile(file) {
  if (!file) return false;
  const type = typeof file.type === "string" ? file.type.toLowerCase() : "";
  if (type.startsWith("image/")) return true;
  return typeof file.name === "string" && IMAGE_EXT_RE.test(file.name);
}

export function extensionOf(file) {
  const name = typeof file?.name === "string" ? file.name.trim() : "";
  const match = IMAGE_EXT_RE.exec(name);
  if (match) {
    const ext = match[1].toLowerCase();
    return ext === "jpeg" ? "jpg" : ext === "tiff" ? "tif" : ext;
  }
  const mime = typeof file?.type === "string" ? file.type.toLowerCase().split(";")[0].trim() : "";
  return MIME_TO_EXT[mime] || "png";
}

export function sanitizeStem(raw, fallback = "image") {
  const cleaned = String(raw ?? "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "");
  return cleaned || fallback;
}

export function noteStemOf(notePath) {
  const base = String(notePath ?? "").split("/").pop() || "";
  return sanitizeStem(base.replace(/\.md$/i, ""), "note");
}

export function dirOf(vaultPath) {
  const idx = String(vaultPath ?? "").lastIndexOf("/");
  return idx >= 0 ? vaultPath.slice(0, idx) : "";
}

export function joinVaultPath(folder, fileName) {
  const cleanFolder = String(folder ?? "").replace(/^\/+|\/+$/g, "");
  const cleanFile = String(fileName ?? "").replace(/^\/+/, "");
  return cleanFolder ? `${cleanFolder}/${cleanFile}` : cleanFile;
}

export function resolveAttachmentFolder(rawFolder, notePath) {
  const raw = String(rawFolder ?? "").trim();
  if (!raw || raw === "/") return "";
  const noteDir = dirOf(notePath);
  if (raw === "." || raw === "./") return noteDir;
  if (raw.startsWith("./")) return joinVaultPath(noteDir, raw.slice(2));
  return raw.replace(/^\/+|\/+$/g, "");
}

export function localDateString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function convertObsidianPattern(obsPattern, delimiter = "-") {
  if (typeof obsPattern !== "string" || !obsPattern.trim()) return null;
  let pat = obsPattern.trim()
    .replace(/\{\{\s*fileName\s*\}\}/gi, "{note}")
    .replace(/\{\{\s*DATE(?::[^}]+)?\s*\}\}/gi, "{date}");
  if (!pat.includes("{n}")) pat = `${pat}${delimiter || "-"}{n}`;
  return pat;
}

export function formatImageLink(destPath, useWikilink) {
  if (useWikilink) return `![[${destPath}]]`;
  const encoded = encodeURI(destPath).replace(/\(/g, "%28").replace(/\)/g, "%29");
  return `![](${encoded})`;
}

export function extractNoteImages(markdown) {
  const results = [];
  const text = String(markdown ?? "");
  // Strip fenced code blocks so example syntax inside code fences is not mistaken for real embeds
  const stripped = text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, "");
  const wikiRe = /!\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]]*)?\]\]/g;
  for (let m = wikiRe.exec(stripped); m; m = wikiRe.exec(stripped)) {
    const target = m[1].trim();
    if (IMAGE_EXT_RE.test(target)) results.push({ raw: m[0], target, kind: "wikilink" });
  }
  const mdRe = /!\[[^\]]*\]\(([^)\n]+)\)/g;
  for (let m = mdRe.exec(stripped); m; m = mdRe.exec(stripped)) {
    let target = m[1].trim().replace(/^<|>$/g, "").replace(/\s+["'][^"']*["']$/, "");
    if (/^(?:https?:|data:|blob:)/i.test(target)) continue;
    try { target = decodeURI(target); } catch { /* keep raw if malformed */ }
    if (IMAGE_EXT_RE.test(target)) results.push({ raw: m[0], target, kind: "markdown" });
  }
  return results;
}

export function register(atlas) {
  let obsidianCache = null;

  async function loadObsidianDefaults() {
    if (obsidianCache) return obsidianCache;
    const found = {};
    try {
      if (await atlas.exists(".obsidian/app.json")) {
        const appJson = JSON.parse(await atlas.readText(".obsidian/app.json"));
        if (typeof appJson?.attachmentFolderPath === "string" && appJson.attachmentFolderPath.trim()) {
          found.attachment_folder = appJson.attachmentFolderPath.trim();
        }
        if (typeof appJson?.useMarkdownLinks === "boolean") {
          found.use_wikilink = !appJson.useMarkdownLinks;
        }
      }
    } catch { /* ignore malformed .obsidian/app.json */ }

    try {
      const pluginDataPath = ".obsidian/plugins/obsidian-paste-image-rename/data.json";
      if (await atlas.exists(pluginDataPath)) {
        const data = JSON.parse(await atlas.readText(pluginDataPath));
        const pat = convertObsidianPattern(data?.imageNamePattern, data?.dupNumberDelimiter);
        if (pat) found.pattern = pat;
        if (typeof data?.autoRename === "boolean") {
          found.prompt_rename = !data.autoRename;
        }
      }
    } catch { /* ignore malformed obsidian plugin data.json */ }

    obsidianCache = found;
    return found;
  }

  atlas.onFilesChanged((paths) => {
    if (!paths?.length || paths.some((p) => p.startsWith(".obsidian/"))) obsidianCache = null;
  });

  async function effectiveConfig() {
    const s = atlas.plugin?.settings ?? {};
    const obs = await loadObsidianDefaults();
    const attachmentFolder =
      typeof s.attachment_folder === "string" && s.attachment_folder !== DEFAULTS.attachment_folder
        ? s.attachment_folder
        : (obs.attachment_folder ?? s.attachment_folder ?? DEFAULTS.attachment_folder);
    const pattern =
      typeof s.pattern === "string" && s.pattern !== DEFAULTS.pattern
        ? s.pattern
        : (obs.pattern ?? s.pattern ?? DEFAULTS.pattern);
    const promptRename =
      typeof s.prompt_rename === "boolean" && s.prompt_rename !== DEFAULTS.prompt_rename
        ? s.prompt_rename
        : (obs.prompt_rename ?? Boolean(s.prompt_rename));
    const useWikilink =
      typeof s.use_wikilink === "boolean" && s.use_wikilink !== DEFAULTS.use_wikilink
        ? s.use_wikilink
        : (obs.use_wikilink ?? (s.use_wikilink !== false));
    return { attachmentFolder, pattern, promptRename, useWikilink };
  }

  async function nextAvailableStem(folder, pattern, noteStem, date, ext, reserved) {
    const hasCounter = /\{n\}/i.test(pattern);
    if (hasCounter) {
      for (let n = 1; n < 10000; n++) {
        const rendered = pattern
          .replace(/\{note\}/gi, noteStem)
          .replace(/\{date\}/gi, date)
          .replace(/\{n\}/gi, String(n));
        const stem = sanitizeStem(rendered, `${noteStem}-${n}`);
        const candidate = joinVaultPath(folder, `${stem}.${ext}`);
        if (!reserved.has(candidate) && !(await atlas.exists(candidate))) return stem;
      }
    } else {
      const base = sanitizeStem(
        pattern.replace(/\{note\}/gi, noteStem).replace(/\{date\}/gi, date),
        noteStem,
      );
      const first = joinVaultPath(folder, `${base}.${ext}`);
      if (!reserved.has(first) && !(await atlas.exists(first))) return base;
      for (let n = 1; n < 10000; n++) {
        const stem = `${base}-${n}`;
        const candidate = joinVaultPath(folder, `${stem}.${ext}`);
        if (!reserved.has(candidate) && !(await atlas.exists(candidate))) return stem;
      }
    }
    return `${noteStem}-${Date.now()}`;
  }

  async function ensureCollisionFreePath(folder, stem, ext, reserved) {
    const initial = joinVaultPath(folder, `${stem}.${ext}`);
    if (!reserved.has(initial) && !(await atlas.exists(initial))) return initial;
    const stripped = stem.replace(/-\d+$/, "") || stem;
    for (let n = 1; n < 10000; n++) {
      const candidate = joinVaultPath(folder, `${stripped}-${n}.${ext}`);
      if (!reserved.has(candidate) && !(await atlas.exists(candidate))) return candidate;
    }
    return joinVaultPath(folder, `${stripped}-${Date.now()}.${ext}`);
  }

  async function saveIncomingImages(notePath, imageFiles) {
    const cfg = await effectiveConfig();
    const folder = resolveAttachmentFolder(cfg.attachmentFolder, notePath);
    const noteStem = noteStemOf(notePath);
    const date = localDateString();
    const reserved = new Set();
    const links = [];

    for (const file of imageFiles) {
      const ext = extensionOf(file);
      let stem = await nextAvailableStem(folder, cfg.pattern, noteStem, date, ext, reserved);

      if (cfg.promptRename) {
        const typed = await atlas.input("Image filename", {
          value: stem,
          hint: `Saved in ${folder || "/"} as .${ext}`,
          ok: "Save",
        });
        if (typed === null) continue;
        const withoutExt = typed.trim().replace(new RegExp(`\\.${ext}$`, "i"), "");
        stem = sanitizeStem(withoutExt, stem);
      }

      const destPath = await ensureCollisionFreePath(folder, stem, ext, reserved);
      reserved.add(destPath);
      await atlas.writeBytes(destPath, file);
      links.push(formatImageLink(destPath, cfg.useWikilink));
    }

    if (links.length === 0) return "";
    return links.join("\n");
  }

  // Synchronous gate: return null immediately when paste/drop has no image files or is outside a .md note,
  // so Kandinsky's editor leaves normal text/file pastes untouched.
  function onIncoming(data) {
    if (!data || typeof data.path !== "string" || !/\.md$/i.test(data.path)) return null;
    const files = Array.isArray(data.files) ? data.files.filter(isImageFile) : [];
    if (files.length === 0) return null;
    return saveIncomingImages(data.path, files);
  }

  atlas.editor.onPaste(onIncoming);
  atlas.editor.onDrop(onIncoming);

  atlas.registerCommand({
    id: "rename-note-images",
    title: "Paste Image Rename: Check image attachments in this note",
    run: async () => {
      const ctx = atlas.context();
      const notePath = ctx?.active?.path || ctx?.selection?.path || "";
      if (!notePath || !/\.md$/i.test(notePath)) {
        atlas.toast("Paste Image Rename", "Open a Markdown note first to check its image attachments.", "info");
        return;
      }

      const cfg = await effectiveConfig();
      const expectedFolder = resolveAttachmentFolder(cfg.attachmentFolder, notePath);
      const noteStem = noteStemOf(notePath);
      const text = await atlas.readText(notePath);
      const embeds = extractNoteImages(text);

      if (embeds.length === 0) {
        atlas.toast("Paste Image Rename", `No local image attachments found in ${noteStem}.md.`, "info");
        return;
      }

      const genericRe = /^(?:pasted image\b|image(?:-\d+)?$|screenshot\b|clipboard\b|untitled\b|img[_-]?\d+)/i;
      const items = [];
      let okCount = 0;
      let genericCount = 0;
      let missingCount = 0;

      for (const emb of embeds) {
        const candidates = [
          emb.target.replace(/^\/+/, ""),
          joinVaultPath(dirOf(notePath), emb.target),
          joinVaultPath(expectedFolder, emb.target),
        ].filter((v, idx, arr) => v && arr.indexOf(v) === idx);

        let resolved = null;
        for (const c of candidates) {
          if (await atlas.exists(c)) {
            resolved = c;
            break;
          }
        }

        const fileBase = (emb.target.split("/").pop() || emb.target).replace(IMAGE_EXT_RE, "");
        if (!resolved) {
          missingCount++;
          items.push({
            value: emb.target,
            title: `[Missing] ${emb.target}`,
            detail: "File not found in vault",
          });
        } else if (genericRe.test(fileBase)) {
          genericCount++;
          items.push({
            value: resolved,
            title: `[Generic] ${resolved}`,
            detail: `Consider naming "${noteStem}-…" in ${expectedFolder || "/"}`,
          });
        } else {
          okCount++;
          items.push({
            value: resolved,
            title: `[OK] ${resolved}`,
            detail: expectedFolder && !resolved.startsWith(`${expectedFolder}/`) ? `Outside ${expectedFolder}/` : "Cleanly named",
          });
        }
      }

      const summary = `${embeds.length} image${embeds.length === 1 ? "" : "s"}: ${okCount} clean, ${genericCount} generic, ${missingCount} missing`;
      atlas.toast("Paste Image Rename", summary, missingCount ? "error" : "info");
      atlas.pick({
        placeholder: `${summary} — pick an attachment to open`,
        tag: "Images",
        items,
        onpick: (chosen) => {
          if (chosen && !items.find((x) => x.value === chosen && x.title.startsWith("[Missing]"))) {
            atlas.open(chosen, undefined, { beside: true });
          }
        },
      });
    },
  });
}
