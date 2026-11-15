// Tag Wrangler & Tactician — shared UI for both the Side Panel tool and the full Tactician pane.

import { extractNoteInfo } from "./tag-engine.js";
import { buildIndexFromNotes, promptRenameTag, scanVaultTags, sortedChildren } from "./tag-index.js";

const STYLE_ID = "kandinsky-tag-wrangler-styles";
const CSS = `
.tw-root { display:flex; flex-direction:column; height:100%; min-height:0; color:var(--text); font-size:13px; user-select:none; }
.tw-bar { display:flex; flex-wrap:wrap; gap:6px; align-items:center; padding:8px 10px; border-bottom:1px solid var(--border); background:var(--bg); position:sticky; top:0; z-index:2; }
.tw-search { flex:1 1 140px; min-width:0; padding:5px 9px; border-radius:var(--radius-sm); border:1px solid var(--border-strong); background:var(--bg-elev); color:var(--text); font:inherit; outline:none; }
.tw-search:focus { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent); }
.tw-btn { all:unset; cursor:pointer; display:inline-flex; align-items:center; gap:4px; padding:4px 8px; border-radius:var(--radius-sm); border:1px solid var(--border); background:var(--bg-elev); color:var(--text-muted); font-size:12px; white-space:nowrap; }
.tw-btn:hover { background:var(--bg-hover); color:var(--text); border-color:var(--border-strong); }
.tw-btn-accent { background:var(--accent-soft); color:var(--accent); border-color:transparent; font-weight:500; }
.tw-btn-accent:hover { background:var(--accent-sel); color:var(--accent-strong); }
.tw-body { flex:1; min-height:0; display:grid; grid-template-columns:minmax(0,1fr); overflow:hidden; }
.tw-root.tw-full .tw-body { grid-template-columns:minmax(260px, 360px) minmax(0, 1fr); }
@media (max-width: 680px) { .tw-root.tw-full .tw-body { grid-template-columns:minmax(0,1fr); } .tw-detail { display:none; } }
.tw-tree { overflow-y:auto; padding:6px 8px 18px; }
.tw-detail { overflow-y:auto; padding:14px 18px; border-left:1px solid var(--border); background:var(--bg-alt); }
.tw-meta { padding:4px 4px 6px; font-size:11.5px; color:var(--text-faint); display:flex; justify-content:space-between; align-items:center; }
.tw-row { display:flex; align-items:center; gap:4px; padding:3px 5px; border-radius:var(--radius-sm); min-width:0; }
.tw-row:hover { background:var(--bg-hover); }
.tw-row.tw-active { background:var(--accent-soft); }
.tw-twisty { all:unset; cursor:pointer; width:16px; height:16px; display:grid; place-items:center; color:var(--text-faint); font-size:10px; flex:none; border-radius:3px; }
.tw-twisty:hover { color:var(--text); background:var(--bg-active); }
.tw-twisty.tw-leaf { visibility:hidden; pointer-events:none; }
.tw-label { all:unset; cursor:pointer; flex:1; min-width:0; display:flex; align-items:center; gap:5px; overflow:hidden; padding:2px 0; }
.tw-hash { color:var(--accent); font-weight:600; opacity:.85; }
.tw-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text); }
.tw-badge { all:unset; cursor:pointer; flex:none; padding:1px 6px; border-radius:999px; background:var(--tag-bg); color:var(--tag-color); font-size:11px; font-variant-numeric:tabular-nums; }
.tw-badge:hover { background:var(--accent-sel); }
.tw-rename { all:unset; cursor:pointer; flex:none; padding:2px 6px; border-radius:var(--radius-sm); font-size:11px; color:var(--text-muted); border:1px solid transparent; opacity:0; transition:opacity .12s; }
.tw-row:hover .tw-rename, .tw-row.tw-active .tw-rename, .tw-rename:focus-visible { opacity:1; border-color:var(--border-strong); background:var(--bg-elev); }
.tw-rename:hover { color:var(--accent); border-color:var(--accent); }
@media (hover: none) { .tw-rename { opacity:1; } }
.tw-notes { margin:2px 0 4px 20px; padding-left:8px; border-left:1px solid var(--border-strong); display:flex; flex-direction:column; gap:1px; }
.tw-note-btn { all:unset; cursor:pointer; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:4px 6px; border-radius:var(--radius-sm); color:var(--text-muted); font-size:12px; min-width:0; }
.tw-note-btn:hover { background:var(--bg-hover); color:var(--text); }
.tw-note-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500; color:var(--text); }
.tw-note-path { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px; color:var(--text-faint); }
.tw-children { margin-left:13px; padding-left:4px; border-left:1px dashed var(--border); }
.tw-card { display:flex; flex-direction:column; gap:4px; padding:9px 11px; border-radius:var(--radius); background:var(--card-bg); border:1px solid var(--border); margin-bottom:7px; cursor:pointer; }
.tw-card:hover { border-color:var(--accent); background:var(--bg-elev); }
.tw-chips { display:flex; flex-wrap:wrap; gap:4px; margin-top:2px; }
.tw-chip { padding:1px 6px; border-radius:999px; background:var(--tag-bg); color:var(--tag-color); font-size:11px; }
.tw-empty { padding:18px 10px; color:var(--text-faint); text-align:center; font-size:12.5px; }
`;

function ensureStyles() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** Mount Tag Wrangler into `host`. Returns cleanup function. */
export function mountTagWrangler(host, kandinsky, opts = {}) {
  ensureStyles();
  const compact = !!opts.compact;
  let sortMode = kandinsky.plugin.settings?.sort === "name" ? "name" : "count";
  let query = "";
  let selectedTag = opts.initialTag || "";
  let index = null;
  let loading = true;
  const openBranches = new Set();
  const openNoteLists = new Set();

  const root = h("div", `tw-root${compact ? "" : " tw-full"}`);
  const bar = h("div", "tw-bar");
  const search = Object.assign(h("input", "tw-search"), { type: "search", placeholder: "Filter #tags or notes…" });
  const sortBtn = h("button", "tw-btn", sortMode === "count" ? "Sort: # Count" : "Sort: A–Z");
  sortBtn.title = "Toggle sort order (count vs alphabetical)";
  const refreshBtn = h("button", "tw-btn", "↻");
  refreshBtn.title = "Rescan vault tags";
  bar.append(search, sortBtn, refreshBtn);

  if (compact) {
    const paneBtn = h("button", "tw-btn tw-btn-accent", "Tactician");
    paneBtn.title = "Open full Tag Wrangler & Tactician pane";
    paneBtn.onclick = () => kandinsky.openView(selectedTag || undefined);
    bar.append(paneBtn);
  }

  const body = h("div", "tw-body");
  const treePane = h("div", "tw-tree");
  const detailPane = h("div", "tw-detail");
  body.append(treePane);
  if (!compact) body.append(detailPane);
  root.append(bar, body);
  host.replaceChildren(root);

  const openNote = (path, ev) => kandinsky.open(path, undefined, { beside: !!(ev?.ctrlKey || ev?.metaKey) });

  const matchesFilter = (node, q) => {
    if (!q) return true;
    if (node.tag.toLowerCase().includes(q)) return true;
    for (const p of node.allNotes) {
      const info = index?.notes.get(p);
      if (p.toLowerCase().includes(q) || info?.title.toLowerCase().includes(q)) return true;
    }
    return false;
  };

  const doRename = async (tag) => {
    const next = await promptRenameTag(kandinsky, tag, index);
    if (next) {
      if (selectedTag === tag) selectedTag = next;
      if (openNoteLists.delete(tag)) openNoteLists.add(next);
      await fullScan();
    }
  };

  function renderNode(node, q) {
    if (!matchesFilter(node, q)) return null;
    const kids = sortedChildren(node, sortMode);
    const hasKids = kids.length > 0;
    const branchOpen = q ? true : openBranches.has(node.tag);
    const notesOpen = openNoteLists.has(node.tag);

    const wrap = h("div");
    const row = h("div", `tw-row${selectedTag === node.tag ? " tw-active" : ""}`);

    const twisty = h("button", `tw-twisty${hasKids ? "" : " tw-leaf"}`, branchOpen ? "▾" : "▸");
    twisty.title = branchOpen ? "Collapse subtags" : "Expand subtags";
    twisty.onclick = (e) => {
      e.stopPropagation();
      if (openBranches.has(node.tag)) openBranches.delete(node.tag);
      else openBranches.add(node.tag);
      render();
    };

    const label = h("button", "tw-label");
    label.title = `#${node.tag} — click to toggle matching notes`;
    label.append(h("span", "tw-hash", "#"), h("span", "tw-name", node.name));
    label.onclick = () => {
      selectedTag = node.tag;
      if (openNoteLists.has(node.tag)) openNoteLists.delete(node.tag);
      else openNoteLists.add(node.tag);
      if (hasKids && !openBranches.has(node.tag)) openBranches.add(node.tag);
      render();
    };

    const renameBtn = h("button", "tw-rename", "Rename");
    renameBtn.title = `Rename or merge #${node.tag}`;
    renameBtn.onclick = (e) => { e.stopPropagation(); void doRename(node.tag); };

    const badge = h("button", "tw-badge", String(node.allNotes.size));
    badge.title = `${node.directNotes.size} direct, ${node.allNotes.size} total including subtags`;
    badge.onclick = label.onclick;

    row.append(twisty, label, renameBtn, badge);
    wrap.append(row);

    if (notesOpen) {
      const list = h("div", "tw-notes");
      const paths = [...node.allNotes].sort((a, b) => a.localeCompare(b));
      for (const path of paths) {
        const info = index.notes.get(path);
        const nb = h("button", "tw-note-btn");
        nb.title = path;
        nb.append(h("span", "tw-note-title", info?.title ?? path), h("span", "tw-note-path", path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "/"));
        nb.onmouseenter = () => kandinsky.hover(path);
        nb.onmouseleave = () => kandinsky.hover(null);
        nb.onclick = (ev) => openNote(path, ev);
        list.append(nb);
      }
      wrap.append(list);
    }

    if (hasKids && branchOpen) {
      const childBox = h("div", "tw-children");
      for (const child of kids) {
        const rendered = renderNode(child, q);
        if (rendered) childBox.append(rendered);
      }
      if (childBox.childElementCount) wrap.append(childBox);
    }
    return wrap;
  }

  function renderDetail() {
    if (compact) return;
    detailPane.replaceChildren();
    const active = selectedTag && index?.byTag.get(selectedTag);
    if (!active) {
      detailPane.append(h("div", "tw-empty", index?.byTag.size ? "Select any #tag on the left to inspect its notes, hierarchy, or bulk-rename / merge it." : "No #tags found in this vault yet."));
      return;
    }
    const head = h("div", "tw-meta");
    const title = h("div", "", `#${active.tag}`);
    title.style.cssText = "font-size:16px; font-weight:650; color:var(--heading)";
    const actBtn = h("button", "tw-btn tw-btn-accent", `Rename / Merge #${active.tag}…`);
    actBtn.onclick = () => void doRename(active.tag);
    head.append(title, actBtn);

    const sub = h("div", "tw-meta", `${active.allNotes.size} matching ${active.allNotes.size === 1 ? "note" : "notes"} (${active.directNotes.size} direct${active.children.size ? `, ${active.children.size} child subtags` : ""})`);
    detailPane.append(head, sub);

    for (const path of [...active.allNotes].sort((a, b) => a.localeCompare(b))) {
      const info = index.notes.get(path);
      const card = h("div", "tw-card");
      const top = h("div", "tw-meta");
      top.style.padding = "0";
      const t = h("span", "tw-note-title", info?.title ?? path);
      t.style.fontSize = "13.5px";
      const p = h("span", "tw-note-path", path);
      top.append(t, p);
      card.append(top);
      if (info?.tags.length) {
        const chips = h("div", "tw-chips");
        for (const tg of info.tags) {
          const c = h("span", "tw-chip", `#${tg}`);
          if (tg === active.tag || tg.startsWith(`${active.tag}/`)) c.style.fontWeight = "600";
          chips.append(c);
        }
        card.append(chips);
      }
      card.onmouseenter = () => kandinsky.hover(path);
      card.onmouseleave = () => kandinsky.hover(null);
      card.onclick = (ev) => openNote(path, ev);
      detailPane.append(card);
    }
  }

  function render() {
    treePane.replaceChildren();
    if (loading || !index) {
      treePane.append(h("div", "tw-empty", "Scanning vault #tags…"));
      return;
    }
    const q = query.trim().toLowerCase().replace(/^#+/, "");
    const meta = h("div", "tw-meta");
    meta.append(
      h("span", "", `${index.byTag.size} ${index.byTag.size === 1 ? "tag" : "tags"} · ${index.totalNotes} notes`),
      h("button", "tw-btn", openBranches.size ? "Collapse" : "Expand all"),
    );
    meta.lastChild.onclick = () => {
      if (openBranches.size) openBranches.clear();
      else for (const [t, n] of index.byTag) if (n.children.size) openBranches.add(t);
      render();
    };
    treePane.append(meta);

    const topNodes = sortedChildren(index.root, sortMode);
    let shown = 0;
    for (const n of topNodes) {
      const el = renderNode(n, q);
      if (el) { treePane.append(el); shown++; }
    }
    if (!shown) {
      treePane.append(h("div", "tw-empty", q ? `No tags matching “${query}”.` : "No #tags found in Markdown notes yet."));
    }
    renderDetail();
  }

  async function fullScan() {
    loading = !index;
    if (loading) render();
    index = await scanVaultTags(kandinsky);
    loading = false;
    if (!selectedTag && !compact) {
      const first = sortedChildren(index.root, sortMode)[0];
      if (first) selectedTag = first.tag;
    }
    render();
  }

  async function incrementalUpdate(paths) {
    if (!index || !paths.length) return fullScan();
    const mdPaths = paths.filter((p) => /\.md$/i.test(p) && !p.startsWith("."));
    if (!mdPaths.length) return;
    if (mdPaths.length > 25) return fullScan();
    const nextNotes = new Map(index.notes);
    await Promise.all(mdPaths.map(async (p) => {
      if (await kandinsky.exists(p)) {
        try { nextNotes.set(p, extractNoteInfo(p, await kandinsky.readText(p))); }
        catch { nextNotes.delete(p); }
      } else {
        nextNotes.delete(p);
      }
    }));
    index = buildIndexFromNotes(nextNotes);
    render();
  }

  search.oninput = () => { query = search.value; render(); };
  sortBtn.onclick = () => {
    sortMode = sortMode === "count" ? "name" : "count";
    sortBtn.textContent = sortMode === "count" ? "Sort: # Count" : "Sort: A–Z";
    render();
  };
  refreshBtn.onclick = () => void fullScan();

  let timer;
  const offFs = kandinsky.onFilesChanged((paths) => {
    clearTimeout(timer);
    timer = setTimeout(() => void incrementalUpdate(paths), 220);
  });

  void fullScan();
  return () => { clearTimeout(timer); offFs(); kandinsky.hover(null); };
}
