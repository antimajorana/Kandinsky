// Solver-to-Note Import Dialog (import-dialog.js): browse local Solver derivations or .zip exports and import into Kandinsky notes.

function getSettings(atlas) {
  const s = (atlas.plugin && atlas.plugin.settings) || {};
  return {
    url: String(s.url || "http://localhost:4200").trim().replace(/\/+$/, ""),
    apiUrl: String(s.api_url || "http://127.0.0.1:3000").trim().replace(/\/+$/, ""),
    notesFolder: String(s.notes_folder ?? "Solver").trim().replace(/^\/+|\/+$/g, ""),
  };
}

async function pickUniqueNotePath(atlas, folder, fileName) {
  const stem = fileName.replace(/\.md$/i, "") || "Solver Derivation";
  for (let n = 1; n <= 99; n++) {
    const leaf = n === 1 ? `${stem}.md` : `${stem} (${n}).md`;
    const candidate = folder ? `${folder}/${leaf}` : leaf;
    if (!(await atlas.exists(candidate))) return candidate;
  }
  return folder ? `${folder}/${stem}-${Date.now()}.md` : `${stem}-${Date.now()}.md`;
}

export default function mountImportDialog(host, atlas) {
  let disposed = false;
  let loading = true;
  let importing = false;
  let backendOnline = false;
  let conversations = [];
  let exports = [];
  let selectedId = "";
  let selectedZip = "";
  let manualInput = "";
  let onlyVerified = true;
  let includeCode = true;
  let errorMsg = "";

  const cfg = getSettings(atlas);
  let argObj = null;
  try {
    if (atlas.arg) argObj = JSON.parse(atlas.arg);
  } catch {}
  const targetNotePath = (argObj && argObj.targetPath) || (atlas.context()?.active?.path ?? "");
  const canAppend = Boolean(targetNotePath && /\.md$/i.test(targetNotePath));

  host.style.display = "flex";
  host.style.flexDirection = "column";
  host.style.height = "100%";
  host.style.padding = "16px 18px";
  host.style.gap = "12px";
  host.style.overflow = "auto";
  host.style.color = "var(--text)";

  const style = document.createElement("style");
  style.textContent = `
    .si-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .si-sub { margin: 2px 0 0; font-size: 12px; color: var(--text-muted); }
    .si-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .si-input { flex: 1; min-width: 220px; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border-strong, var(--border)); background: var(--bg); color: var(--text); font-size: 12.5px; }
    .si-list { display: flex; flex-direction: column; gap: 6px; max-height: 240px; overflow: auto; border: 1px solid var(--border); border-radius: 8px; padding: 6px; background: var(--bg-elevated, var(--bg)); }
    .si-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 10px; border-radius: 6px; border: 1px solid transparent; cursor: pointer; text-align: left; background: transparent; color: var(--text); width: 100%; }
    .si-item:hover { background: var(--bg-hover); }
    .si-item.sel { border-color: var(--accent); background: var(--bg-hover); }
    .si-item-title { font-size: 12.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .si-item-meta { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
    .si-badge { font-size: 10.5px; padding: 2px 7px; border-radius: 999px; border: 1px solid var(--border-strong, var(--border)); color: var(--text-muted); flex: none; }
    .si-badge.solved { border-color: #2ea043; color: #2ea043; font-weight: 600; }
    .si-opts { display: flex; gap: 16px; flex-wrap: wrap; font-size: 12px; color: var(--text-muted); padding: 4px 2px; }
    .si-opts label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; color: var(--text); }
    .si-btn { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 6px; border: 1px solid var(--border-strong, var(--border)); background: var(--bg); color: var(--text); font-size: 12.5px; cursor: pointer; }
    .si-btn:hover { background: var(--bg-hover); }
    .si-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--bg); font-weight: 600; }
    .si-btn:disabled { opacity: 0.5; pointer-events: none; }
    .si-err { padding: 8px 10px; border-radius: 6px; border: 1px solid var(--red, #e5534b); color: var(--red, #e5534b); font-size: 12px; }
    .si-empty { padding: 18px 12px; text-align: center; color: var(--text-muted); font-size: 12.5px; line-height: 1.5; }
    .si-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-top: auto; padding-top: 10px; border-top: 1px solid var(--border); }
  `;

  const root = document.createElement("div");
  root.style.display = "flex";
  root.style.flexDirection = "column";
  root.style.gap = "11px";
  root.style.flex = "1";
  host.replaceChildren(style, root);

  async function loadList(scanDownloads = false) {
    if (disposed) return;
    loading = true;
    errorMsg = "";
    render();
    try {
      const res = await atlas.helper.call(
        "listConversations",
        { url: cfg.url, apiUrl: cfg.apiUrl, scanDownloads },
        { timeout: 15 },
      );
      if (disposed) return;
      backendOnline = Boolean(res && res.backendOnline);
      conversations = Array.isArray(res && res.conversations) ? res.conversations : [];
      if (scanDownloads || (res && Array.isArray(res.exports) && res.exports.length)) {
        exports = res.exports || [];
      }
      if (!selectedId && !selectedZip) {
        if (conversations.length > 0) selectedId = conversations[0].id;
        else if (exports.length > 0) selectedZip = exports[0].path;
      }
    } catch (e) {
      errorMsg = String((e && e.message) || e);
    } finally {
      loading = false;
      render();
    }
  }

  async function doImport(mode) {
    if (importing || disposed) return;
    const typed = manualInput.trim();
    const isZipInput = /\.zip$/i.test(typed);
    const zipPath = isZipInput ? typed : selectedZip;
    const conversationId = !isZipInput && typed ? typed : selectedId;

    if (!zipPath && !conversationId) {
      errorMsg = "Select a Solver problem below, paste a conversation URL/ID, or scan Downloads for a Solver .zip export.";
      render();
      return;
    }

    importing = true;
    errorMsg = "";
    render();
    try {
      const res = await atlas.helper.call(
        "exportMarkdown",
        { apiUrl: cfg.apiUrl, conversationId, zipPath, includeCode, onlyVerified },
        { timeout: 25 },
      );
      if (!res || !res.ok) {
        errorMsg = (res && res.error) || "Could not export derivation.";
        return;
      }

      if (mode === "append" && canAppend) {
        const existing = await atlas.readText(targetNotePath);
        const sep = existing.endsWith("\n") ? "\n---\n\n" : "\n\n---\n\n";
        await atlas.writeText(targetNotePath, existing + sep + res.bodyOnly);
        atlas.toast("Appended Solver derivation", `Added ${res.stepCount} step(s) to ${targetNotePath}`, "success");
        atlas.open(targetNotePath);
        atlas.pane?.close();
      } else {
        const dest = await pickUniqueNotePath(atlas, cfg.notesFolder, res.suggestedFileName || "Solver Derivation.md");
        await atlas.writeText(dest, res.markdown);
        atlas.toast("Imported Solver note", `Saved ${dest} (${res.stepCount} step(s))`, "success");
        atlas.open(dest, undefined, { beside: true });
        atlas.pane?.close();
      }
    } catch (e) {
      errorMsg = String((e && e.message) || e);
    } finally {
      importing = false;
      render();
    }
  }

  function render() {
    if (disposed) return;
    root.replaceChildren();

    const head = document.createElement("div");
    head.className = "si-head";
    const hLeft = document.createElement("div");
    const hTitle = document.createElement("div");
    hTitle.style.fontWeight = "650";
    hTitle.style.fontSize = "14px";
    hTitle.textContent = "Import Solver Derivation into Kandinsky";
    const hSub = document.createElement("p");
    hSub.className = "si-sub";
    hSub.textContent = backendOnline
      ? `Connected to Solver (${conversations.length} problem${conversations.length === 1 ? "" : "s"} found) — preserves LaTeX math, proof narrative, and verification scripts.`
      : "Solver backend is currently offline — start Solver or scan Downloads to import an exported Solver .zip bundle.";
    hLeft.append(hTitle, hSub);

    const hRight = document.createElement("div");
    hRight.className = "si-row";
    const zipBtn = document.createElement("button");
    zipBtn.className = "si-btn";
    zipBtn.disabled = loading || importing;
    zipBtn.textContent = "Scan Downloads (.zip)";
    zipBtn.onclick = () => void loadList(true);

    const refBtn = document.createElement("button");
    refBtn.className = "si-btn";
    refBtn.disabled = loading || importing;
    refBtn.textContent = loading ? "Refreshing…" : "Refresh";
    refBtn.onclick = () => void loadList(false);
    hRight.append(zipBtn, refBtn);
    head.append(hLeft, hRight);

    const inputRow = document.createElement("div");
    inputRow.className = "si-row";
    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = "si-input";
    inp.placeholder = "Or paste a Solver conversation ID / URL, or path to a Solver export .zip…";
    inp.value = manualInput;
    inp.oninput = (ev) => {
      manualInput = ev.target.value;
    };
    inputRow.append(inp);

    const list = document.createElement("div");
    list.className = "si-list";

    if (loading) {
      const em = document.createElement("div");
      em.className = "si-empty";
      em.textContent = "Looking up local Solver conversations…";
      list.append(em);
    } else if (conversations.length === 0 && exports.length === 0) {
      const em = document.createElement("div");
      em.className = "si-empty";
      em.textContent = backendOnline
        ? "No conversations saved in Solver yet. Solve a problem in Solver or click 'Scan Downloads (.zip)' to import a bundle."
        : "Solver is not running right now. Start Solver in the sidebar (or click 'Scan Downloads (.zip)' to import a saved export bundle).";
      list.append(em);
    } else {
      for (const c of conversations) {
        const btn = document.createElement("button");
        btn.className = `si-item ${selectedId === c.id && !selectedZip ? "sel" : ""}`;
        btn.onclick = () => {
          selectedId = c.id;
          selectedZip = "";
          manualInput = "";
          render();
        };
        const left = document.createElement("div");
        left.style.minWidth = "0";
        const t = document.createElement("div");
        t.className = "si-item-title";
        t.textContent = c.title || "Untitled problem";
        const m = document.createElement("div");
        m.className = "si-item-meta";
        const dt = c.updatedAt ? String(c.updatedAt).slice(0, 10) : "";
        m.textContent = `${c.stepCount ?? 0} ledger step(s)${dt ? " · " + dt : ""} · ${c.id.slice(0, 8)}`;
        left.append(t, m);

        const b = document.createElement("span");
        const st = String(c.status || "active");
        b.className = `si-badge ${st === "solved" || st === "verified" ? "solved" : ""}`;
        b.textContent = st;
        btn.append(left, b);
        list.append(btn);
      }

      for (const z of exports) {
        const btn = document.createElement("button");
        btn.className = `si-item ${selectedZip === z.path ? "sel" : ""}`;
        btn.onclick = () => {
          selectedZip = z.path;
          selectedId = "";
          manualInput = "";
          render();
        };
        const left = document.createElement("div");
        left.style.minWidth = "0";
        const t = document.createElement("div");
        t.className = "si-item-title";
        t.textContent = z.name;
        const m = document.createElement("div");
        m.className = "si-item-meta";
        m.textContent = `Downloads export bundle · ${Math.max(1, Math.round((z.size || 0) / 1024))} KB`;
        left.append(t, m);

        const b = document.createElement("span");
        b.className = "si-badge solved";
        b.textContent = ".zip bundle";
        btn.append(left, b);
        list.append(btn);
      }
    }

    const opts = document.createElement("div");
    opts.className = "si-opts";
    const lblVer = document.createElement("label");
    const chkVer = document.createElement("input");
    chkVer.type = "checkbox";
    chkVer.checked = onlyVerified;
    chkVer.onchange = () => { onlyVerified = chkVer.checked; };
    lblVer.append(chkVer, document.createTextNode("Accepted & verified steps only"));

    const lblCode = document.createElement("label");
    const chkCode = document.createElement("input");
    chkCode.type = "checkbox";
    chkCode.checked = includeCode;
    chkCode.onchange = () => { includeCode = chkCode.checked; };
    lblCode.append(chkCode, document.createTextNode("Include collapsible Python / Lean verification code"));
    opts.append(lblVer, lblCode);

    root.append(head, inputRow, list, opts);

    if (errorMsg) {
      const err = document.createElement("div");
      err.className = "si-err";
      err.textContent = errorMsg;
      root.append(err);
    }

    const foot = document.createElement("div");
    foot.className = "si-foot";
    const destHint = document.createElement("span");
    destHint.style.fontSize = "11.5px";
    destHint.style.color = "var(--text-muted)";
    destHint.textContent = cfg.notesFolder ? `New notes save to ${cfg.notesFolder}/` : "New notes save to vault root";

    const acts = document.createElement("div");
    acts.className = "si-row";
    if (canAppend) {
      const appBtn = document.createElement("button");
      appBtn.className = "si-btn";
      appBtn.disabled = importing;
      appBtn.textContent = `Append to ${targetNotePath.split("/").pop()}`;
      appBtn.onclick = () => void doImport("append");
      acts.append(appBtn);
    }
    const newBtn = document.createElement("button");
    newBtn.className = "si-btn primary";
    newBtn.disabled = importing;
    newBtn.textContent = importing ? "Importing…" : "Create New Note & Open Beside";
    newBtn.onclick = () => void doImport("new");
    acts.append(newBtn);

    foot.append(destHint, acts);
    root.append(foot);
  }

  render();
  void loadList(false);

  return () => {
    disposed = true;
  };
}
