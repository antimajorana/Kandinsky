// Folder Notes & Genkan — responsive Genkan MOC card grid renderer for fences and blocks.

import {
  candidateFolderNotePaths,
  cleanFolder,
  findExistingFolderNote,
  folderDisplayName,
  openOrCreateFolderNote,
  parentFolder,
  resolveTargetFolder,
  summarizeNote,
} from "./folder-note-utils.js";

const STYLE_ID = "atlas-folder-notes-genkan-styles";
const CSS = `
.gk-wrap { margin:8px 0; display:flex; flex-direction:column; gap:10px; color:var(--text); font-size:13px; }
.gk-head { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; padding:4px 2px; border-bottom:1px solid var(--border); }
.gk-title { display:inline-flex; align-items:center; gap:7px; font-weight:600; color:var(--heading); font-size:13.5px; }
.gk-sub { color:var(--text-faint); font-weight:400; font-size:12px; }
.gk-actions { display:flex; align-items:center; gap:6px; }
.gk-btn { all:unset; cursor:pointer; display:inline-flex; align-items:center; gap:4px; padding:3px 9px; border-radius:var(--radius-sm); border:1px solid var(--border); background:var(--bg-elev); color:var(--text-muted); font-size:12px; }
.gk-btn:hover { background:var(--bg-hover); color:var(--text); border-color:var(--border-strong); }
.gk-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(var(--gk-min, 215px), 1fr)); gap:10px; }
.gk-card { all:unset; box-sizing:border-box; cursor:pointer; display:flex; flex-direction:column; justify-content:space-between; gap:7px; padding:11px 13px; border-radius:var(--radius); background:var(--card-bg); border:1px solid var(--border); box-shadow:var(--shadow-card); text-align:left; transition:border-color .12s, background .12s, transform .12s; min-width:0; }
.gk-card:hover { border-color:var(--accent); background:var(--bg-elev); }
.gk-card:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
.gk-card-folder { border-left:3px solid var(--accent); }
.gk-card-top { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; min-width:0; }
.gk-card-heading { display:flex; align-items:center; gap:7px; min-width:0; flex:1; }
.gk-icon { flex:none; display:inline-flex; color:var(--text-muted); }
.gk-card-folder .gk-icon { color:var(--accent); }
.gk-name { font-weight:600; color:var(--heading); font-size:13.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.gk-count { flex:none; padding:1px 7px; border-radius:999px; background:var(--accent-soft); color:var(--accent); font-size:11px; font-variant-numeric:tabular-nums; white-space:nowrap; }
.gk-excerpt { color:var(--text-muted); font-size:12px; line-height:1.45; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; margin:0; }
.gk-tags { display:flex; flex-wrap:wrap; gap:4px; margin-top:auto; padding-top:2px; }
.gk-tag { padding:1px 6px; border-radius:999px; background:var(--tag-bg); color:var(--tag-color); font-size:11px; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.gk-empty { padding:16px 12px; border-radius:var(--radius); border:1px dashed var(--border-strong); color:var(--text-faint); text-align:center; font-size:12.5px; }
`;

const FOLDER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h3.3l2 2.2h5.7A2.5 2.5 0 0 1 20 8.7v8.8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z"/></svg>';
const NOTE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>';

function ensureStyles() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const iconBox = (svg) => {
  const s = el("span", "gk-icon");
  s.innerHTML = svg;
  return s;
};

function sortEntries(items, sortKey) {
  const mode = String(sortKey ?? "name").toLowerCase();
  return [...items].sort((a, b) => {
    if (mode === "mtime" || mode === "modified" || mode === "recent") {
      const diff = (b.mtime ?? 0) - (a.mtime ?? 0);
      if (diff !== 0) return diff;
    } else if (mode === "size") {
      const diff = (b.size ?? 0) - (a.size ?? 0);
      if (diff !== 0) return diff;
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

/** Mount a Genkan card grid into `host`. Returns cleanup function. */
export function mountGenkanGrid(host, atlas, notePath, options = {}) {
  ensureStyles();
  let disposed = false;
  let drawRun = 0;

  const targetFolder = resolveTargetFolder(options.folder, notePath);
  const showMode = String(options.show ?? "all").toLowerCase();
  const showExcerpt = options.excerpt !== false;
  const cols = Number(options.columns) || 0;

  async function createChildNote() {
    const label = folderDisplayName(targetFolder);
    const name = await atlas.input(`New note in ${label}`, {
      hint: "Note title (creates <title>.md in this folder)",
      ok: "Create",
    });
    if (!name) return;
    const slug = name.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\.md$/i, "");
    if (!slug) return;
    const path = targetFolder ? `${targetFolder}/${slug}.md` : `${slug}.md`;
    await atlas.createFile(path, `# ${name.trim()}\n\n`);
    atlas.open(path);
  }

  async function draw() {
    const myRun = ++drawRun;
    if (!(targetFolder === "" || await atlas.exists(targetFolder))) {
      if (disposed || myRun !== drawRun) return;
      host.replaceChildren(el("div", "gk-empty", `Folder “${targetFolder}” does not exist yet.`));
      return;
    }

    const entries = await atlas.list(targetFolder).catch(() => []);
    if (disposed || myRun !== drawRun) return;

    const selfNotes = new Set([
      ...(notePath ? [cleanFolder(notePath)] : []),
      ...candidateFolderNotePaths(atlas, targetFolder),
    ]);

    const visible = entries.filter((e) => !e.ignored && !e.name.startsWith("."));
    const subfolders = showMode === "notes" ? [] : sortEntries(visible.filter((e) => e.dir), options.sort);
    const mdFiles = showMode === "folders"
      ? []
      : sortEntries(visible.filter((e) => !e.dir && /\.md$/i.test(e.name) && !selfNotes.has(e.path)), options.sort);

    const [folderCardsData, noteCardsData] = await Promise.all([
      Promise.all(subfolders.map(async (dir) => {
        const children = (await atlas.list(dir.path).catch(() => [])).filter((c) => !c.ignored && !c.name.startsWith("."));
        const subFolderNote = await findExistingFolderNote(atlas, dir.path);
        const subDirs = children.filter((c) => c.dir).length;
        const subNotes = children.filter((c) => !c.dir && /\.md$/i.test(c.name) && c.path !== subFolderNote).length;
        let meta = { title: dir.name, excerpt: "", tags: [] };
        if (subFolderNote) {
          try { meta = summarizeNote(subFolderNote, await atlas.readText(subFolderNote)); } catch { /* ignore */ }
        }
        return { dir, subFolderNote, subDirs, subNotes, meta };
      })),
      Promise.all(mdFiles.map(async (file) => {
        let meta = { title: file.name.replace(/\.md$/i, ""), excerpt: "", tags: [] };
        try { meta = summarizeNote(file.path, await atlas.readText(file.path)); } catch { /* ignore */ }
        return { file, meta };
      })),
    ]);

    if (disposed || myRun !== drawRun) return;

    const wrap = el("div", "gk-wrap");
    const head = el("div", "gk-head");
    const titleWrap = el("div", "gk-title");
    titleWrap.append(
      iconBox(FOLDER_SVG),
      el("span", "", folderDisplayName(targetFolder)),
      el("span", "gk-sub", `· ${subfolders.length} ${subfolders.length === 1 ? "folder" : "folders"}, ${mdFiles.length} ${mdFiles.length === 1 ? "note" : "notes"}`),
    );

    const actions = el("div", "gk-actions");
    const addBtn = el("button", "gk-btn", "+ New note");
    addBtn.title = `Create a new note in ${targetFolder || "/"}`;
    addBtn.onclick = () => void createChildNote();
    actions.append(addBtn);
    head.append(titleWrap, actions);
    wrap.append(head);

    if (!folderCardsData.length && !noteCardsData.length) {
      wrap.append(el("div", "gk-empty", "This folder has no child notes or subfolders yet. Click “+ New note” to add one."));
      host.replaceChildren(wrap);
      return;
    }

    const grid = el("div", "gk-grid");
    if (cols > 0) {
      grid.style.gridTemplateColumns = `repeat(${Math.min(cols, 6)}, minmax(0, 1fr))`;
    }

    for (const { dir, subFolderNote, subDirs, subNotes, meta } of folderCardsData) {
      const card = el("button", "gk-card gk-card-folder");
      card.title = subFolderNote ? `Open folder note ${subFolderNote}` : `Create & open folder note for ${dir.path}`;
      const top = el("div", "gk-card-top");
      const heading = el("div", "gk-card-heading");
      heading.append(iconBox(FOLDER_SVG), el("span", "gk-name", dir.name));
      const parts = [];
      if (subNotes) parts.push(`${subNotes} ${subNotes === 1 ? "note" : "notes"}`);
      if (subDirs) parts.push(`${subDirs} ${subDirs === 1 ? "folder" : "folders"}`);
      top.append(heading, el("span", "gk-count", parts.length ? parts.join(" · ") : "Empty"));
      card.append(top);

      if (showExcerpt && meta.excerpt) card.append(el("p", "gk-excerpt", meta.excerpt));
      if (meta.tags.length) {
        const tgWrap = el("div", "gk-tags");
        for (const t of meta.tags) tgWrap.append(el("span", "gk-tag", `#${t}`));
        card.append(tgWrap);
      }
      if (subFolderNote) {
        card.onmouseenter = () => atlas.hover(subFolderNote);
        card.onmouseleave = () => atlas.hover(null);
      }
      card.onclick = (ev) => void openOrCreateFolderNote(atlas, dir.path, { beside: !!(ev.ctrlKey || ev.metaKey) });
      grid.append(card);
    }

    for (const { file, meta } of noteCardsData) {
      const card = el("button", "gk-card");
      card.title = file.path;
      const top = el("div", "gk-card-top");
      const heading = el("div", "gk-card-heading");
      heading.append(iconBox(NOTE_SVG), el("span", "gk-name", meta.title));
      top.append(heading);
      card.append(top);

      if (showExcerpt && meta.excerpt) card.append(el("p", "gk-excerpt", meta.excerpt));
      if (meta.tags.length) {
        const tgWrap = el("div", "gk-tags");
        for (const t of meta.tags) tgWrap.append(el("span", "gk-tag", `#${t}`));
        card.append(tgWrap);
      }
      card.onmouseenter = () => atlas.hover(file.path);
      card.onmouseleave = () => atlas.hover(null);
      card.onclick = (ev) => atlas.open(file.path, undefined, { beside: !!(ev.ctrlKey || ev.metaKey) });
      grid.append(card);
    }

    wrap.append(grid);
    host.replaceChildren(wrap);
  }

  let timer;
  const offFs = atlas.onFilesChanged((paths) => {
    if (paths.length) {
      const relevant = paths.some((p) => {
        const pf = parentFolder(p);
        return pf === targetFolder || parentFolder(pf) === targetFolder || p === targetFolder;
      });
      if (!relevant) return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => void draw(), 180);
  });

  void draw();
  return () => {
    disposed = true;
    clearTimeout(timer);
    offFs();
    atlas.hover(null);
  };
}
