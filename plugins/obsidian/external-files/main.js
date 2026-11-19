// External Attachments & Embeds — Kandinsky workspace plugin (API v28).
// Links, previews, and opens external files and cloud folders (such as kDrive) from inside notes.

const DEFAULT_EXTERNAL_ROOT = "~/kDrive";

let cachedHomeDir = "";
let cachedVaultDir = "";
let homeDirPromise = null;

function inferHomeFromVaultPath(rawPath) {
  // a canonical Windows path (\\?\C:\...) reads as its plain drive path
  const norm = String(rawPath ?? "").replace(/\\/g, "/").replace(/^\/\/\?\//, "");
  const m = /^([A-Za-z]:\/Users\/[^/]+|\/Users\/[^/]+|\/home\/[^/]+)(?:\/|$)/.exec(norm);
  return m ? m[1] : "";
}

/** The home folder from `/api/vaults`: the open vault's own path first (`current` is a path), then the others. */
export function homeFromVaults(data) {
  const fromCurrent = inferHomeFromVaultPath(data?.current);
  if (fromCurrent) return fromCurrent;
  const key = (p) => String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const vaults = Array.isArray(data?.vaults) ? data.vaults.filter(Boolean) : [];
  const cur = key(data?.current);
  const currentFirst = [...vaults.filter((v) => key(v.path) === cur), ...vaults.filter((v) => key(v.path) !== cur)];
  for (const v of currentFirst) {
    const h = inferHomeFromVaultPath(v.path);
    if (h) return h;
  }
  return "";
}

function detectHomeDir() {
  if (cachedHomeDir && cachedVaultDir) return Promise.resolve(cachedHomeDir);
  if (!homeDirPromise) {
    homeDirPromise = (async () => {
      if (typeof fetch !== "function") return "";
      try {
        const res = await fetch("/api/vaults", { headers: { "x-kandinsky": "1" } });
        if (!res.ok) return "";
        const data = await res.json();
        const cur = String(data?.current ?? "").replace(/\\/g, "/").replace(/^\/\/\?\//, "").replace(/\/+$/, "");
        if (cur) cachedVaultDir = cur;
        const h = homeFromVaults(data);
        if (h) {
          cachedHomeDir = h;
          return h;
        }
      } catch {
        // Offline / Android / mocked test environments without /api/vaults continue cleanly
      }
      return "";
    })();
  }
  return homeDirPromise;
}

export function expandTildePath(p, homeDir = cachedHomeDir) {
  const s = String(p ?? "");
  if (!homeDir) return s;
  const h = String(homeDir).replace(/\\/g, "/").replace(/\/+$/, "");
  if (s === "~") return h;
  if (s.startsWith("~/")) return `${h}/${s.slice(2)}`;
  return s;
}

const ICONS = {
  "external-link": '<path d="M14 4h6v6"/><path d="M20 4l-8.5 8.5"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  "folder-open": '<path d="M4 17.5V6.5A2.5 2.5 0 0 1 6.5 4h3.3l2 2.2h5.2A2.5 2.5 0 0 1 19.5 8.7V10"/><path d="M4 17.5 6.3 11.6A2 2 0 0 1 8.2 10.3h12a1.3 1.3 0 0 1 1.2 1.8l-2.2 5.9a3 3 0 0 1-2.8 2H6.5A2.5 2.5 0 0 1 4 17.5z"/>',
  pdf: '<path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 3v5h5"/><path d="M8.5 17.5c2-1.2 4.5-4.6 4.2-6.6-.3-1.6-2.2-.6-1.4 1.4.9 2.4 3.3 4.4 4.9 4.6"/>',
  image: '<rect x="3" y="3.5" width="18" height="17" rx="2.5"/><circle cx="9" cy="9.5" r="1.8"/><path d="m21 15.5-4.5-4.5L6 20.5"/>',
  "file-code": '<path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 3v5h5M10 12.5l-2 2 2 2M14 12.5l2 2-2 2"/>',
  "file-text": '<path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M3 15h18M9.5 9.5V20"/>',
  headphones: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.4-3.6-8.5s1.1-5.9 3.6-8.5z"/>',
  file: '<path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 3v5h5"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.2"/><path d="M15.5 8.5V6A2 2 0 0 0 13.5 4h-7.5A2 2 0 0 0 4 6v7.5a2 2 0 0 0 2 2h2.5"/>',
};

function svgEl(name, size = 15) {
  const span = document.createElement("span");
  span.style.cssText = "display: inline-flex; align-items: center; justify-content: center; flex: none";
  span.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ICONS.file}</svg>`;
  return span;
}

const el = (tag, style, text) => {
  const node = document.createElement(tag);
  if (style) node.style.cssText = style;
  if (text !== undefined) node.textContent = text;
  return node;
};

function safeDecodeUri(raw) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Convert a file:/// URL, absolute path, or external_root-relative path into a clean target path. */
export function resolveExternalPath(rawInput, externalRoot = DEFAULT_EXTERNAL_ROOT, homeDir = cachedHomeDir) {
  let s = String(rawInput ?? "").trim();
  if (!s) return "";
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  if (/^https?:\/\//i.test(s)) return s;

  if (/^file:\/\//i.test(s)) {
    const rest = safeDecodeUri(s.replace(/^file:\/\//i, ""));
    // file:///C:/foo -> C:/foo ; file:///home/u/foo -> /home/u/foo ; file://server/share -> //server/share
    if (/^\/[A-Za-z]:[\\/]/.test(rest)) return rest.slice(1).replace(/\\/g, "/");
    if (rest.startsWith("/")) return rest;
    return `//${rest.replace(/\\/g, "/")}`;
  }

  const norm = s.replace(/\\/g, "/");
  const isWinDrive = /^[A-Za-z]:\//.test(norm) || /^[A-Za-z]:$/.test(norm);
  const isUnc = norm.startsWith("//");
  const isPosixAbs = norm.startsWith("/") || norm === "~" || norm.startsWith("~/");
  if (isWinDrive || isUnc || isPosixAbs) return expandTildePath(norm, homeDir);

  const rawRoot = externalRoot === undefined || externalRoot === null ? DEFAULT_EXTERNAL_ROOT : externalRoot;
  const root = expandTildePath(String(rawRoot).trim().replace(/\\/g, "/").replace(/\/+$/, ""), homeDir);
  const rel = norm.replace(/^\.\//, "").replace(/^\/+/, "");
  return root ? `${root}/${rel}` : rel;
}

/** Convert a resolved local path into a valid file:// URL for desktop shell fallback and media embeds. */
export function toFileUrl(resolvedPath) {
  const s = String(resolvedPath ?? "").trim();
  if (!s || /^https?:\/\//i.test(s) || /^file:\/\//i.test(s)) return s;
  const norm = s.replace(/\\/g, "/");
  const encodeSegs = (p) => p.split("/").map((seg, i) => (i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg))).join("/");
  if (norm.startsWith("//")) return `file:${encodeSegs(norm)}`;
  if (/^[A-Za-z]:\//.test(norm)) return `file:///${encodeSegs(norm)}`;
  if (/^[A-Za-z]:$/.test(norm)) return `file:///${norm}/`;
  if (norm.startsWith("/")) return `file://${encodeSegs(norm)}`;
  return `file:///${encodeSegs(norm)}`;
}

/** Parse lines inside an ```external or ```external-embed fence into `{ raw, resolved, label, note }[]`. */
export function parseExternalEntries(source, info = "", externalRoot = DEFAULT_EXTERNAL_ROOT) {
  const combined = [String(info ?? "").trim(), ...String(source ?? "").split(/\r?\n/)]
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("//"));
  if (!combined.length) return [];

  // Support single-card key-value syntax (`path: ...`, `title: ...`, `note: ...`) when all lines match known keys
  const kvPattern = /^(path|file|url|title|label|note|description)\s*:\s*(.+)$/i;
  if (combined.every((l) => kvPattern.test(l))) {
    const kv = {};
    for (const l of combined) {
      const m = kvPattern.exec(l);
      if (m) kv[m[1].toLowerCase()] = m[2].trim();
    }
    const raw = kv.path || kv.file || kv.url || "";
    if (raw) {
      return [{
        raw,
        resolved: resolveExternalPath(raw, externalRoot),
        label: kv.title || kv.label || "",
        note: kv.note || kv.description || "",
      }];
    }
  }

  return combined.map((line) => {
    // Markdown link syntax: [Label](file:///... or path) or ![Label](...)
    const mdMatch = /^!?\[([^\]]*)\]\(([^)]+)\)$/.exec(line);
    if (mdMatch) {
      const raw = mdMatch[2].trim();
      return { raw, resolved: resolveExternalPath(raw, externalRoot), label: mdMatch[1].trim(), note: "" };
    }
    // Pipe syntax: Label | path/to/file.ext  (or path/to/file.ext | Label if left side looks like a path)
    if (line.includes(" | ")) {
      const [left, right] = line.split(" | ", 2).map((p) => p.trim());
      const leftLooksLikePath = /^[A-Za-z]:[\\/]|^file:\/\/|^https?:\/\/|[\\/]|\.[A-Za-z0-9]{1,8}$/.test(left);
      const raw = leftLooksLikePath ? left : right;
      const label = leftLooksLikePath ? right : left;
      return { raw, resolved: resolveExternalPath(raw, externalRoot), label, note: "" };
    }
    return { raw: line, resolved: resolveExternalPath(line, externalRoot), label: "", note: "" };
  });
}

/** Classify a resolved path or URL for its badge, accent colour, icon, and preview kind. */
export function classifyExternalTarget(resolvedPath) {
  const clean = String(resolvedPath ?? "").split("?")[0].split("#")[0];
  if (/^https?:\/\//i.test(clean)) {
    return { badge: "WEB", icon: "globe", color: "var(--cyan)", preview: "none" };
  }
  if (clean.endsWith("/") || /^[A-Za-z]:$/.test(clean)) {
    return { badge: "FOLDER", icon: "folder-open", color: "var(--yellow)", preview: "none" };
  }
  const base = clean.slice(clean.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) {
    return { badge: "FOLDER", icon: "folder-open", color: "var(--yellow)", preview: "none" };
  }
  const ext = base.slice(dot + 1).toLowerCase();
  if (ext === "pdf") return { badge: "PDF", icon: "pdf", color: "var(--red)", preview: "pdf" };
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"].includes(ext)) {
    return { badge: ext.toUpperCase(), icon: "image", color: "var(--purple)", preview: "image" };
  }
  if (["mp3", "wav", "flac", "ogg", "m4a", "aac"].includes(ext)) {
    return { badge: ext.toUpperCase(), icon: "headphones", color: "var(--orange)", preview: "audio" };
  }
  if (["mp4", "webm", "mov", "mkv"].includes(ext)) {
    return { badge: ext.toUpperCase(), icon: "image", color: "var(--orange)", preview: "video" };
  }
  if (["csv", "tsv", "parquet", "h5", "hdf5", "npz", "npy", "fits", "mat", "xlsx"].includes(ext)) {
    return { badge: ext.toUpperCase(), icon: "table", color: "var(--green)", preview: "none" };
  }
  if (["ipynb", "wl", "wls", "nb", "py", "rs", "js", "ts", "tex", "sh", "c", "cpp", "jl"].includes(ext)) {
    return { badge: ext === "ipynb" || ext === "nb" ? "NOTEBOOK" : ext.toUpperCase(), icon: "file-code", color: "var(--cyan)", preview: "none" };
  }
  if (["zip", "7z", "tar", "gz", "zst", "rar", "xz"].includes(ext)) {
    return { badge: ext.toUpperCase(), icon: "file", color: "var(--yellow)", preview: "none" };
  }
  if (["md", "txt", "docx", "pptx", "odt", "epub", "djvu"].includes(ext)) {
    return { badge: ext.toUpperCase(), icon: "file-text", color: "var(--accent)", preview: "none" };
  }
  return { badge: ext.slice(0, 8).toUpperCase() || "FILE", icon: "file", color: "var(--accent)", preview: "none" };
}

function basenameOf(resolvedPath) {
  const trimmed = String(resolvedPath ?? "").replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return (idx >= 0 ? trimmed.slice(idx + 1) : trimmed) || resolvedPath;
}

function normalizeSlashPath(p) {
  const s = String(p ?? "").replace(/\\/g, "/").replace(/^\/\/\?\//, "").replace(/\/+$/, "");
  if (!s) return "";
  const winDrive = /^([A-Za-z]:)(\/.*)?$/.exec(s);
  const unc = !winDrive && s.startsWith("//");
  const abs = !winDrive && !unc && s.startsWith("/");
  const prefix = winDrive ? winDrive[1] : unc ? "//" : abs ? "/" : "";
  const body = winDrive ? (winDrive[2] ?? "") : unc ? s.slice(2) : abs ? s.slice(1) : s;
  const out = [];
  for (const seg of body.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else if (!prefix) out.push("..");
    } else {
      out.push(seg);
    }
  }
  if (winDrive) return `${prefix}${out.length ? "/" + out.join("/") : "/"}`;
  if (unc) return `//${out.join("/")}`;
  if (abs) return `/${out.join("/")}`;
  return out.join("/");
}

function relativeBetweenPaths(fromDir, toDir) {
  if (!fromDir || !toDir) return "";
  const ci = /^[A-Za-z]:\//.test(fromDir) || /^[A-Za-z]:\//.test(toDir);
  const norm = (x) => (ci ? x.toLowerCase() : x);
  const aParts = fromDir.split("/").filter(Boolean);
  const bParts = toDir.split("/").filter(Boolean);
  if (!aParts.length || !bParts.length || norm(aParts[0]) !== norm(bParts[0])) return "";
  let common = 0;
  while (common < aParts.length && common < bParts.length && norm(aParts[common]) === norm(bParts[common])) {
    common++;
  }
  if (common === 0) return "";
  const up = Array(aParts.length - common).fill("..");
  return [...up, ...bParts.slice(common)].join("/");
}

/** Map a resolved local PDF path inside the vault or `catalog-papers.settings.external_pdf_roots` to its portable path. */
export function toPortableExternalPdf(resolvedPath, vaultDir, extRoots, homeDir = cachedHomeDir) {
  const absTarget = normalizeSlashPath(expandTildePath(resolvedPath, homeDir));
  if (!absTarget) return "";
  const normVault = normalizeSlashPath(expandTildePath(vaultDir, homeDir));
  const matchUnder = (absRoot) => {
    if (!absRoot) return null;
    const ci = /^[A-Za-z]:\//.test(absTarget) || /^[A-Za-z]:\//.test(absRoot);
    const cmpTarget = ci ? absTarget.toLowerCase() : absTarget;
    const cmpRoot = ci ? absRoot.toLowerCase() : absRoot;
    if (cmpTarget.startsWith(`${cmpRoot}/`)) return absTarget.slice(absRoot.length + 1);
    return null;
  };
  if (normVault) {
    const insideVault = matchUnder(normVault);
    if (insideVault !== null) return insideVault;
  }
  const rawList = Array.isArray(extRoots)
    ? extRoots
    : typeof extRoots === "string"
      ? extRoots.split(/[\r\n,]+/)
      : [];
  for (let idx = 0; idx < rawList.length; idx++) {
    const raw = String(rawList[idx] ?? "").trim();
    if (!raw) continue;
    const cleaned = expandTildePath(raw, homeDir)
      .replace(/\\/g, "/")
      .replace(/^\/\/\?\//, "")
      .replace(/^\.\//, "")
      .replace(/\/+$/, "");
    if (!cleaned) continue;
    const isAbs = /^[A-Za-z]:\//.test(cleaned) || cleaned.startsWith("/") || cleaned.startsWith("//");
    if (!isAbs && !normVault) continue;
    const absRoot = isAbs ? normalizeSlashPath(cleaned) : normalizeSlashPath(`${normVault}/${cleaned}`);
    const sub = matchUnder(absRoot);
    if (sub !== null) {
      const prefix = !isAbs ? cleaned : relativeBetweenPaths(normVault, absRoot) || `@ext/${idx}`;
      return `${prefix.replace(/\/+$/, "")}/${sub}`;
    }
  }
  return "";
}

async function openInSystemApp(kandinsky, resolvedPath) {
  if (!resolvedPath) return false;
  let target = String(resolvedPath);
  if (target === "~" || target.startsWith("~/")) {
    const h = await detectHomeDir();
    target = expandTildePath(target, h);
  }
  if (!/^https?:\/\//i.test(target)) {
    const hashMatch = /#page=(\d+)/i.exec(target);
    const pageNum = hashMatch ? Number(hashMatch[1]) : undefined;
    const cleanTarget = target.split("?")[0].split("#")[0];
    if (/\.pdf$/i.test(cleanTarget)) {
      if (!cachedVaultDir) await detectHomeDir();
      const roots = kandinsky.other?.("catalog-papers")?.settings?.external_pdf_roots;
      const portable = toPortableExternalPdf(cleanTarget, cachedVaultDir, roots);
      if (portable && typeof kandinsky.exists === "function" && (await kandinsky.exists(portable))) {
        kandinsky.open(portable, Number.isFinite(pageNum) && pageNum > 0 ? pageNum : undefined);
        return true;
      }
    }
  }
  // Primary API v28 call required by Kandinsky contract:
  const tookNative = kandinsky.openNative(target);
  if (tookNative) return true;

  // Desktop / WebView fallback when openNative returns false:
  if (/^https?:\/\//i.test(target)) {
    kandinsky.openLink?.(target, { outside: true });
    return true;
  }
  if (typeof kandinsky.openLink === "function") {
    kandinsky.openLink(toFileUrl(target));
    return true;
  }
  kandinsky.toast?.("External Files", `Path: ${target}`, "info");
  return false;
}

export function register(kandinsky) {
  void detectHomeDir();
  const getRoot = () => String(kandinsky.plugin?.settings?.external_root ?? DEFAULT_EXTERNAL_ROOT).trim() || DEFAULT_EXTERNAL_ROOT;

  // Track live CodeMirror views so Insert Card can insert right at the cursor when an editor is mounted
  const liveEditors = new Map();
  try {
    const ViewPlugin = kandinsky.editor?.codemirror?.view?.ViewPlugin;
    if (ViewPlugin && typeof kandinsky.editor?.extension === "function" && typeof kandinsky.editor?.path === "function") {
      const ext = ViewPlugin.fromClass(class {
        constructor(view) {
          this.view = view;
          this.path = kandinsky.editor.path(view);
          if (this.path) liveEditors.set(this.path, view);
        }
        update(u) {
          const next = kandinsky.editor.path(u.view);
          if (next !== this.path) {
            if (this.path && liveEditors.get(this.path) === u.view) liveEditors.delete(this.path);
            this.path = next;
          }
          if (this.path) liveEditors.set(this.path, u.view);
        }
        destroy() {
          if (this.path && liveEditors.get(this.path) === this.view) liveEditors.delete(this.path);
        }
      });
      kandinsky.editor.extension(ext);
    }
  } catch {
    // Headless or mocked environments without CodeMirror continue cleanly via readText/writeText
  }

  const renderExternalFence = (embedMode) => (host, fence) => {
    let rerenderQueued = false;

    const render = () => {
      const rawRoot = getRoot();
      const root = expandTildePath(rawRoot);
      const normRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
      const rootName = basenameOf(normRoot) || "External";
      const entries = parseExternalEntries(fence.source, fence.info, root);

      const wrap = el("div", "display: grid; gap: 8px; margin: 6px 0;");
      if (!entries.length) {
        const empty = el(
          "div",
          "border: 1px dashed var(--border-strong); border-radius: var(--radius); padding: 10px 12px; color: var(--text-faint); font-size: 0.9em;",
          `Empty ${embedMode ? "external-embed" : "external"} block — add a path relative to ${rawRoot}, an absolute path, or a file:/// URL.`
        );
        wrap.append(empty);
        host.replaceChildren(wrap);
        return;
      }

      const needsHome =
        rawRoot === "~" ||
        rawRoot.startsWith("~/") ||
        entries.some((it) => it.resolved === "~" || it.resolved.startsWith("~/"));
      if (!cachedHomeDir && needsHome && !rerenderQueued) {
        rerenderQueued = true;
        void detectHomeDir().then((home) => {
          if (home && host.isConnected) render();
        });
      }

      for (const item of entries) {
        const info = classifyExternalTarget(item.resolved);
        const titleText = item.label || basenameOf(item.resolved);
        const normResolvedLower = item.resolved.toLowerCase();
        const normRootLower = normRoot.toLowerCase();
        const underRoot = Boolean(
          normRootLower &&
            (normResolvedLower === normRootLower || normResolvedLower.startsWith(`${normRootLower}/`))
        );

        const card = el(
          "div",
          "border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--bg-elev); padding: 10px 12px; display: grid; gap: 8px;"
        );

        const row = el("div", "display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0;");

        // File type badge + icon
        const badge = el(
          "span",
          `display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; border-radius: var(--radius-sm); font-size: 0.74em; font-weight: 650; letter-spacing: 0.04em; color: ${info.color}; background: color-mix(in srgb, ${info.color} 14%, transparent); border: 1px solid color-mix(in srgb, ${info.color} 30%, transparent); flex: none;`
        );
        badge.append(svgEl(info.icon, 13), el("span", "", info.badge));

        // Title + resolved path column
        const meta = el("div", "flex: 1 1 200px; min-width: 0; display: grid; gap: 2px;");
        const titleRow = el("div", "display: flex; align-items: center; gap: 6px; min-width: 0;");
        const titleEl = el(
          "span",
          "font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;",
          titleText
        );
        titleRow.append(titleEl);
        if (underRoot) {
          titleRow.append(
            el(
              "span",
              "font-size: 0.72em; padding: 1px 6px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); flex: none;",
              rootName
            )
          );
        }
        const pathEl = el(
          "div",
          "font-family: var(--font-mono); font-size: 0.78em; color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;",
          item.resolved
        );
        pathEl.title = item.resolved;
        meta.append(titleRow, pathEl);
        if (item.note) {
          meta.append(el("div", "font-size: 0.84em; color: var(--text-muted); margin-top: 2px;", item.note));
        }

        // Action buttons
        const actions = el("div", "display: inline-flex; align-items: center; gap: 6px; flex: none; margin-left: auto;");

        const copyBtn = el(
          "button",
          "display: inline-flex; align-items: center; gap: 5px; padding: 5px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-strong); background: transparent; color: var(--text-muted); font-size: 0.82em; cursor: pointer;"
        );
        copyBtn.type = "button";
        copyBtn.title = "Copy resolved path";
        copyBtn.append(svgEl("copy", 13));
        copyBtn.onclick = async (e) => {
          e.stopPropagation();
          try {
            await navigator.clipboard.writeText(item.resolved);
            kandinsky.toast("External Files", "Copied path to clipboard", "info", { timeout: 2200 });
          } catch {
            kandinsky.toast("External Files", item.resolved, "info");
          }
        };

        const openBtn = el(
          "button",
          "display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: var(--radius-sm); border: 1px solid transparent; background: var(--accent); color: var(--accent-fg); font-size: 0.82em; font-weight: 600; cursor: pointer;"
        );
        openBtn.type = "button";
        openBtn.title = `Open ${item.resolved} in default system application`;
        openBtn.append(svgEl("external-link", 13), el("span", "", "Open in System App"));
        openBtn.onclick = (e) => {
          e.stopPropagation();
          openInSystemApp(kandinsky, item.resolved);
        };

        actions.append(copyBtn, openBtn);
        row.append(badge, meta, actions);
        card.append(row);

        // Optional inline media preview when ```external-embed is used (skip unresolved ~ paths until homeDir resolves)
        const unresolvedTilde = item.resolved === "~" || item.resolved.startsWith("~/");
        if (embedMode && info.preview !== "none" && !unresolvedTilde) {
          const previewWrap = el(
            "div",
            "border-top: 1px solid var(--border); padding-top: 8px; display: none;"
          );
          const srcUrl = toFileUrl(item.resolved);
          if (info.preview === "image") {
            const img = document.createElement("img");
            img.alt = titleText;
            img.style.cssText = "max-width: 100%; max-height: 340px; border-radius: var(--radius-sm); display: block; object-fit: contain;";
            img.onload = () => { previewWrap.style.display = "block"; };
            img.onerror = () => { previewWrap.remove(); };
            img.src = srcUrl;
            previewWrap.append(img);
            card.append(previewWrap);
          } else if (info.preview === "audio") {
            const audio = document.createElement("audio");
            audio.controls = true;
            audio.preload = "metadata";
            audio.style.cssText = "width: 100%; height: 34px;";
            audio.onloadedmetadata = () => { previewWrap.style.display = "block"; };
            audio.onerror = () => { previewWrap.remove(); };
            audio.src = srcUrl;
            previewWrap.append(audio);
            card.append(previewWrap);
          } else if (info.preview === "video") {
            const video = document.createElement("video");
            video.controls = true;
            video.preload = "metadata";
            video.style.cssText = "max-width: 100%; max-height: 360px; border-radius: var(--radius-sm); display: block;";
            video.onloadedmetadata = () => { previewWrap.style.display = "block"; };
            video.onerror = () => { previewWrap.remove(); };
            video.src = srcUrl;
            previewWrap.append(video);
            card.append(previewWrap);
          }
        }

        wrap.append(card);
      }

      host.replaceChildren(wrap);
    };

    render();
  };

  kandinsky.editor.registerFence("external", renderExternalFence(false));
  kandinsky.editor.registerFence("external-embed", renderExternalFence(true));

  // Inline Live Preview widget for `[Label](file:///...)` external links
  kandinsky.editor.registerDecoration(/!?\[([^\]]*)\]\((file:\/\/\/[^)\r\n]+)\)/, (match) => {
    const rawLabel = match[1]?.trim() ?? "";
    const rawUrl = match[2]?.trim() ?? "";
    const resolved = resolveExternalPath(rawUrl, getRoot());
    if (!resolved) return null;
    const info = classifyExternalTarget(resolved);
    const label = rawLabel || basenameOf(resolved);
    return {
      title: `External file: ${resolved}`,
      replace(host) {
        const chip = el(
          "button",
          "display: inline-flex; align-items: center; gap: 5px; padding: 1px 7px; margin: 0 1px; border-radius: var(--radius-sm); border: 1px solid var(--border-strong); background: var(--bg-elev); color: var(--link); font-size: 0.9em; cursor: pointer; vertical-align: baseline;"
        );
        chip.type = "button";
        chip.title = `Open in System App: ${resolved}`;
        chip.append(
          el("b", `font-size: 0.72em; color: ${info.color}; letter-spacing: 0.03em;`, info.badge),
          el("span", "color: var(--text);", label),
          svgEl("external-link", 12)
        );
        chip.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          openInSystemApp(kandinsky, resolved);
        };
        host.append(chip);
      },
    };
  });

  // Command 1: Insert external file card
  kandinsky.registerCommand({
    id: "insert-card",
    title: "External Files: Insert external file card…",
    run: async () => {
      const root = getRoot();
      const entered = await kandinsky.input("Insert external file card", {
        hint: `Path relative to ${root}, absolute path, or file:/// URL`,
        ok: "Insert",
      });
      if (!entered || !entered.trim()) return;
      const snippet = `\n\`\`\`external\n${entered.trim()}\n\`\`\`\n`;

      const activePath = kandinsky.context()?.active?.path ?? "";
      const view = activePath ? liveEditors.get(activePath) : null;
      if (view) {
        const pos = view.state.selection.main.to;
        view.dispatch({
          changes: { from: pos, insert: snippet },
          selection: { anchor: pos + snippet.length },
          userEvent: "input",
          scrollIntoView: true,
        });
        view.focus();
        return;
      }

      if (activePath && /\.(md|markdown)$/i.test(activePath)) {
        const current = await kandinsky.readText(activePath);
        const sep = current.endsWith("\n") || !current.length ? "" : "\n";
        await kandinsky.writeText(activePath, `${current}${sep}\`\`\`external\n${entered.trim()}\n\`\`\`\n`);
        kandinsky.toast("External Files", `Inserted external file card in ${activePath}`, "success", { timeout: 2500 });
        return;
      }

      try {
        await navigator.clipboard.writeText(snippet.trim());
        kandinsky.toast("External Files", "No active note — copied ```external snippet to clipboard", "info");
      } catch {
        kandinsky.toast("External Files", "Open a Markdown note first to insert an external file card.", "error");
      }
    },
  });

  // Command 2: Open external attachments root folder
  kandinsky.registerCommand({
    id: "open-root",
    title: "External Files: Open external attachments root folder",
    run: () => {
      const root = resolveExternalPath(getRoot(), getRoot());
      openInSystemApp(kandinsky, root);
    },
  });
}
