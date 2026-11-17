// Oracle Physics Runner UI plugin: palette commands, context-menu actions, and oracle.links / oracle.lint blocks.

function normalizeVaultPath(raw) {
  return String(raw || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
}

function activeMdPath(kandinsky) {
  const ctx = kandinsky.context();
  const p = normalizeVaultPath((ctx && ctx.active && ctx.active.path) || (ctx && ctx.selection && ctx.selection.path) || "");
  return /\.md$/i.test(p) ? p : "";
}

async function runLintToast(kandinsky, rawPath) {
  const path = normalizeVaultPath(rawPath);
  if (!path) {
    kandinsky.toast("Oracle lint", "Open a Markdown computation note first.", "info");
    return;
  }
  try {
    const res = await kandinsky.helper.call("runCLint", { path, anyLayout: true }, { timeout: 60 });
    const issues = Array.isArray(res && res.issues) ? res.issues : [];
    if (res && res.clean) {
      kandinsky.toast("c_lint passed", `${path} — 0 issues`, "success");
    } else {
      const top = issues.slice(0, 3).map((x) => `L${x.line} [${x.code}] ${x.message}`).join(" | ");
      kandinsky.toast("c_lint found issues", top || (res && res.raw) || "Check failed", "error", { timeout: 9000 });
    }
  } catch (err) {
    kandinsky.toast("c_lint error", String(err && err.message ? err.message : err), "error");
  }
}

function extractSection(text, headingRe) {
  const m = headingRe.exec(text);
  if (!m) return "";
  const rest = text.slice(m.index + m[0].length);
  const next = /\r?\n##\s+/.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

async function copyProblemContext(kandinsky, path) {
  if (!path) {
    kandinsky.toast("Copy conventions", "Open a problem or computation note first.", "info");
    return;
  }
  const text = await kandinsky.readText(path);
  const titleMatch = /^#\s+(.+)$/m.exec(text);
  const title = titleMatch ? titleMatch[1].trim() : path;
  const stmt = extractSection(text, /^##\s+(?:1\.\s*Request|Statement)\s*\r?\n/mi);
  const conv = extractSection(text, /^##\s+(?:2\.\s*Conventions(?:\s+and\s+assumptions)?|Conventions)\s*\r?\n/mi);
  const parts = [`# ${title}`];
  if (stmt) parts.push(`## Statement\n\n${stmt}`);
  if (conv) parts.push(`## Conventions\n\n${conv}`);
  const payload = parts.join("\n\n");
  if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(payload);
    kandinsky.toast("Copied context", `Statement & conventions from ${title} copied to clipboard.`, "success");
  } else {
    kandinsky.toast("Clipboard unavailable", "Could not access browser clipboard.", "error");
  }
}

function extractFrontmatterLinks(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(String(text || ""));
  if (!m) return {};
  const fields = ["up", "conventions", "depends_on", "sources", "used_in", "problems", "computations"];
  const want = new Set(fields);
  const out = {};
  let currentKey = "";
  const stripQuotes = (v) => String(v || "").trim().replace(/^(['"])(.*)\1$/, "$2").trim();
  for (const rawLine of m[1].split(/\r?\n/)) {
    const item = /^\s*-\s+(.+)$/.exec(rawLine);
    if (item && currentKey) {
      const val = stripQuotes(item[1]);
      if (val) (out[currentKey] ||= []).push(val);
      continue;
    }
    const kv = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(rawLine);
    if (!kv) {
      currentKey = "";
      continue;
    }
    const key = kv[1];
    const rest = kv[2].trim();
    currentKey = want.has(key) ? key : "";
    if (!currentKey || !rest || rest === "[]") continue;
    if (rest.startsWith("[") && rest.endsWith("]")) {
      for (const part of rest.slice(1, -1).split(",")) {
        const val = stripQuotes(part);
        if (val) (out[currentKey] ||= []).push(val);
      }
    } else {
      const val = stripQuotes(rest);
      if (val) (out[currentKey] ||= []).push(val);
    }
  }
  return out;
}

const SKIP_INDEX_DIRS = new Set([".git", ".kandinsky", ".obsidian", ".vault-meta", ".claude", ".agents", "zArchive", "zAI", ".trash"]);

async function buildVaultNoteLookup(kandinsky) {
  const byPath = new Map();
  const byStem = new Map();
  const queue = [""];
  while (queue.length) {
    const batch = queue.splice(0, 12);
    const lists = await Promise.all(batch.map((d) => kandinsky.list(d).catch(() => [])));
    for (const entries of lists) {
      for (const entry of entries || []) {
        if (!entry || !entry.path) continue;
        if (entry.dir) {
          if (!entry.ignored && !SKIP_INDEX_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
            queue.push(entry.path);
          }
        } else if (/\.md$/i.test(entry.path)) {
          const norm = entry.path.replace(/\\/g, "/");
          byPath.set(norm.toLowerCase(), norm);
          const stem = norm.slice(norm.lastIndexOf("/") + 1, -3).toLowerCase();
          if (!byStem.has(stem)) byStem.set(stem, norm);
        }
      }
    }
  }
  return { byPath, byStem };
}

function parseLinkRef(raw) {
  const s = String(raw || "").trim();
  const wiki = /^!?\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]$/.exec(s);
  if (wiki) {
    const target = wiki[1].trim();
    const anchor = (wiki[2] || "").trim();
    const alias = (wiki[3] || "").trim();
    const base = target.split("/").pop().replace(/\.md$/i, "");
    return { kind: "wiki", target, anchor, label: alias || (anchor ? `${base}#${anchor}` : base) };
  }
  if (/^https?:\/\//i.test(s)) return { kind: "url", url: s, label: s };
  return { kind: "raw", target: s, label: s };
}

export function register(kandinsky) {
  kandinsky.registerCommand({
    id: "lint-computation",
    title: "Oracle: Lint computation note (c_lint)",
    run: () => void runLintToast(kandinsky, activeMdPath(kandinsky)),
  });

  kandinsky.registerCommand({
    id: "copy-conventions",
    title: "Oracle: Copy statement & conventions for external model",
    run: () => void copyProblemContext(kandinsky, activeMdPath(kandinsky)),
  });

  kandinsky.shell.menu("file", (target) => {
    const p = (target && target.path) || "";
    if (!p || (target && target.dir)) return [];
    if (/\.md$/i.test(p) && /(?:^|\/)Problems\//i.test(p)) {
      return [
        { label: "Lint computation (c_lint)", icon: "check", run: () => void runLintToast(kandinsky, p) },
        { label: "Copy statement & conventions", icon: "copy", run: () => void copyProblemContext(kandinsky, p) },
      ];
    }
    return [];
  });

  kandinsky.shell.menu("editor", (target) => {
    const p = (target && target.path) || "";
    if (!p || !/\.md$/i.test(p)) return [];
    return [
      { label: "Oracle: Lint note (c_lint)", icon: "check", run: () => void runLintToast(kandinsky, p) },
      { label: "Oracle: Copy statement & conventions", icon: "copy", run: () => void copyProblemContext(kandinsky, p) },
    ];
  });

  kandinsky.registerBlock("oracle.links", (host, block) => {
    let gone = false;
    const getNotePath = () => normalizeVaultPath((block.options && block.options.path) || block.doc || block.note || activeMdPath(kandinsky) || "");

    const wrap = document.createElement("div");
    wrap.style.cssText = "font-size:0.9rem;display:flex;flex-direction:column;gap:6px;";
    host.replaceChildren(wrap);

    async function refresh() {
      const notePath = getNotePath();
      if (gone) return;
      if (!notePath || !/\.md$/i.test(notePath)) {
        const empty = document.createElement("span");
        empty.style.color = "var(--text-muted)";
        empty.textContent = "No note selected for typed links.";
        wrap.replaceChildren(empty);
        return;
      }
      try {
        const [text, lookup] = await Promise.all([
          kandinsky.readText(notePath),
          buildVaultNoteLookup(kandinsky),
        ]);
        if (gone) return;
        const grouped = extractFrontmatterLinks(text);
        const rows = [];
        const labels = {
          up: "Parent",
          conventions: "Conventions",
          depends_on: "Depends on",
          sources: "Sources",
          used_in: "Used in",
          problems: "Problems",
          computations: "Computations",
        };
        for (const key of Object.keys(labels)) {
          const vals = grouped[key];
          if (!vals || !vals.length) continue;
          const row = document.createElement("div");
          row.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:6px;";
          const kSpan = document.createElement("span");
          kSpan.style.cssText = "font-weight:600;color:var(--text-muted);min-width:96px;font-size:0.84em;";
          kSpan.textContent = labels[key];
          row.appendChild(kSpan);

          for (const raw of vals) {
            const parsed = parseLinkRef(raw);
            if (parsed.kind === "url") {
              const a = document.createElement("a");
              a.href = parsed.url;
              a.textContent = parsed.label;
              a.style.cssText = "padding:2px 8px;border:1px solid var(--border);border-radius:999px;font-size:0.84em;color:var(--link);text-decoration:none;";
              a.onclick = (ev) => {
                ev.preventDefault();
                if (typeof kandinsky.openLink === "function") kandinsky.openLink(parsed.url, { outside: ev.shiftKey });
                else window.open(parsed.url, "_blank", "noopener");
              };
              row.appendChild(a);
            } else {
              const normTarget = parsed.target.replace(/\\/g, "/");
              const withMd = /\.md$/i.test(normTarget) ? normTarget : `${normTarget}.md`;
              const resolved = lookup.byPath.get(withMd.toLowerCase()) || lookup.byStem.get(normTarget.split("/").pop().replace(/\.md$/i, "").toLowerCase()) || "";
              const btn = document.createElement("button");
              btn.type = "button";
              btn.textContent = parsed.label;
              btn.title = resolved || `${parsed.target} (unresolved)`;
              btn.style.cssText = resolved
                ? "padding:2px 9px;border:1px solid var(--border-strong, var(--border));border-radius:999px;background:var(--bg-alt);color:var(--link);font-size:0.84em;cursor:pointer;"
                : "padding:2px 9px;border:1px dashed var(--border);border-radius:999px;background:transparent;color:var(--text-muted);font-size:0.84em;cursor:default;";
              if (resolved) {
                btn.onmouseenter = () => kandinsky.hover?.(resolved);
                btn.onmouseleave = () => kandinsky.hover?.(null);
                btn.onclick = (ev) => kandinsky.open(resolved, undefined, { beside: ev.ctrlKey || ev.metaKey || ev.shiftKey });
              }
              row.appendChild(btn);
            }
          }
          rows.push(row);
        }
        if (!rows.length) {
          const none = document.createElement("span");
          none.style.color = "var(--text-muted)";
          none.textContent = "No typed parent, convention, dependency, or source links yet.";
          wrap.replaceChildren(none);
        } else {
          wrap.replaceChildren(...rows);
        }
      } catch (err) {
        if (!gone) {
          const errEl = document.createElement("span");
          errEl.style.color = "var(--red, var(--text-muted))";
          errEl.textContent = `oracle.links error: ${String(err && err.message ? err.message : err)}`;
          wrap.replaceChildren(errEl);
        }
      }
    }

    void refresh();
    const offWatch = kandinsky.onFilesChanged((paths) => {
      const notePath = getNotePath();
      if (!paths.length || paths.some((p) => normalizeVaultPath(p) === notePath)) void refresh();
    });
    return () => {
      gone = true;
      offWatch();
    };
  }, {
    title: "Oracle Typed Links",
    icon: "link",
    card: true,
    options: [{ key: "path", label: "Note path (defaults to current note)", kind: "text" }],
  });

  kandinsky.registerBlock("oracle.lint", (host, block) => {
    let gone = false;
    const getNotePath = () => normalizeVaultPath((block.options && block.options.path) || block.doc || block.note || activeMdPath(kandinsky) || "");
    const initialPath = getNotePath();

    const wrap = document.createElement("div");
    wrap.style.cssText = "font-size:0.9rem;display:flex;flex-direction:column;gap:8px;";
    const head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;";
    const statusEl = document.createElement("strong");
    statusEl.textContent = initialPath ? `c_lint: checking ${initialPath}...` : "c_lint: no target path";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Re-check";
    btn.style.cssText = "padding:3px 10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-alt);color:var(--text);cursor:pointer;";
    head.append(statusEl, btn);

    const listEl = document.createElement("ul");
    listEl.style.cssText = "margin:0;padding-left:18px;color:var(--text-muted);display:flex;flex-direction:column;gap:4px;";
    wrap.append(head, listEl);
    host.replaceChildren(wrap);

    async function refresh() {
      const notePath = getNotePath();
      if (gone) return;
      if (!notePath || !/\.md$/i.test(notePath)) {
        listEl.replaceChildren();
        statusEl.textContent = "c_lint: no target path";
        statusEl.style.color = "var(--text-muted)";
        return;
      }
      statusEl.textContent = `c_lint: running on ${notePath}…`;
      try {
        const res = await kandinsky.helper.call("runCLint", { path: notePath, anyLayout: true }, { timeout: 60 });
        if (gone) return;
        listEl.replaceChildren();
        const issues = Array.isArray(res && res.issues) ? res.issues : [];
        if (res && res.clean) {
          statusEl.textContent = `c_lint PASS (${notePath})`;
          statusEl.style.color = "var(--accent)";
        } else {
          statusEl.textContent = `c_lint: ${issues.length} issue(s) in ${notePath}`;
          statusEl.style.color = "var(--text)";
          for (const item of issues.slice(0, 12)) {
            const li = document.createElement("li");
            li.textContent = `L${item.line} [${item.severity} ${item.code}] ${item.message}`;
            listEl.appendChild(li);
          }
        }
      } catch (err) {
        if (!gone) statusEl.textContent = `c_lint error: ${String(err && err.message ? err.message : err)}`;
      }
    }

    btn.onclick = () => void refresh();
    void refresh();
    const offWatch = kandinsky.onFilesChanged((paths) => {
      const notePath = getNotePath();
      if (!paths.length || paths.some((p) => normalizeVaultPath(p) === notePath)) void refresh();
    });
    return () => {
      gone = true;
      offWatch();
    };
  }, {
    title: "Computation Lint (c_lint)",
    icon: "sigma",
    card: true,
    options: [{ key: "path", label: "Note path (defaults to current note)", kind: "text" }],
  });
}
