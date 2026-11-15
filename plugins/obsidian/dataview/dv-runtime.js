// Dataview DOM renderers & DataviewJS (`dv` + `DataArray` + `app`) runtime for Kandinsky.

import { dvCompare, dvEqual, executeDql, filterPagesBySource } from "./dql.js";
import { makeDvDate, makeDvLink, normPath, parseDateMs } from "./index.js";

const STYLE_ID = "kandinsky-plugin-obsidian-dataview-style";

const CSS = `
.dv-fence-root {
  /* Alias Obsidian theme tokens onto Kandinsky's tokens so DataviewJS widgets (e.g. Graph.md) follow dark/light/eink */
  --color-green: var(--green);
  --color-yellow: var(--yellow);
  --color-red: var(--red);
  --color-orange: var(--orange);
  --color-purple: var(--purple);
  --color-cyan: var(--cyan);
  --color-blue: var(--accent);
  --text-normal: var(--text);
  --background-primary: var(--bg);
  --background-secondary: var(--bg-alt);
  --background-secondary-alt: var(--bg-elev);
  --background-modifier-border: var(--border);
  --interactive-accent: var(--accent);
  --font-ui-small: 0.86em;

  margin: 6px 0;
  color: var(--text);
  font-size: 0.94em;
  line-height: 1.5;
  overflow-x: auto;
}
.dv-fence-root button {
  background: var(--bg-elev);
  color: var(--text);
  border: 1px solid var(--border-strong, var(--border));
  border-radius: var(--radius-sm, 6px);
  padding: 2px 8px;
  cursor: pointer;
  font: inherit;
}
.dv-fence-root button:hover {
  background: var(--bg-hover);
}
.dv-table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}
.dv-table th {
  text-align: left;
  font-weight: 600;
  font-size: 0.82em;
  letter-spacing: 0.03em;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border-strong, var(--border));
  padding: 6px 10px 6px 4px;
  white-space: nowrap;
}
.dv-table td {
  padding: 6px 10px 6px 4px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
.dv-table tbody tr:hover td {
  background: var(--bg-hover);
}
.dv-link {
  color: var(--link);
  text-decoration: none;
  cursor: pointer;
  border-radius: 3px;
}
.dv-link:hover {
  text-decoration: underline;
}
.dv-tag {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 0.84em;
  background: var(--tag-bg);
  color: var(--tag-color);
}
.dv-null {
  color: var(--text-faint);
}
.dv-list {
  margin: 4px 0;
  padding-left: 20px;
}
.dv-list li {
  margin: 3px 0;
}
.dv-task-group {
  margin: 8px 0;
}
.dv-task-group-head {
  font-weight: 600;
  font-size: 0.9em;
  margin-bottom: 4px;
}
.dv-task-list {
  list-style: none;
  margin: 2px 0;
  padding-left: 4px;
}
.dv-task-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 2px 4px;
  border-radius: var(--radius-sm, 6px);
}
.dv-task-item:hover {
  background: var(--bg-hover);
}
.dv-task-item.is-done .dv-task-text {
  color: var(--text-faint);
  text-decoration: line-through;
}
.dv-task-jump {
  margin-left: auto;
  font-size: 0.8em;
  color: var(--text-faint);
  cursor: pointer;
  white-space: nowrap;
}
.dv-task-jump:hover {
  color: var(--link);
}
.dv-empty {
  color: var(--text-faint);
  font-style: italic;
  margin: 4px 0;
}
.dv-error {
  border: 1px solid var(--red);
  border-left: 3px solid var(--red);
  border-radius: var(--radius, 8px);
  padding: 8px 12px;
  color: var(--red);
  background: var(--bg-elev);
  font-family: var(--font-mono);
  font-size: 0.86em;
  white-space: pre-wrap;
}
`;

export function injectDataviewStyles() {
  if (typeof document === "undefined") return () => {};
  let el = document.getElementById(STYLE_ID);
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = CSS;
    document.head.appendChild(el);
  }
  return () => { el?.remove(); };
}

// --- Chainable DataArray matching Obsidian DataviewJS ---------------------------------------------------

export class DataArray extends Array {
  static get [Symbol.species]() { return Array; }

  static wrap(items) {
    if (items instanceof DataArray) return items;
    const arr = Array.isArray(items) ? items : Array.from(items ?? []);
    const da = new DataArray(arr.length);
    for (let i = 0; i < arr.length; i++) da[i] = arr[i];
    return da;
  }

  get values() {
    return Array.from(this);
  }

  array() {
    return Array.from(this);
  }

  first() {
    return this[0];
  }

  last() {
    return this[this.length - 1];
  }

  where(pred) {
    return DataArray.wrap(super.filter(pred));
  }

  filter(pred) {
    return DataArray.wrap(super.filter(pred));
  }

  map(fn) {
    return DataArray.wrap(super.map(fn));
  }

  flatMap(fn) {
    return DataArray.wrap(super.flatMap(fn));
  }

  limit(count) {
    return DataArray.wrap(super.slice(0, Math.max(0, Number(count) || 0)));
  }

  slice(start, end) {
    return DataArray.wrap(super.slice(start, end));
  }

  distinct(keyFn = (x) => x) {
    const seen = new Set();
    const out = [];
    for (const item of this) {
      const k = keyFn(item);
      const id = k && typeof k === "object" ? String(k) : k;
      if (!seen.has(id)) {
        seen.add(id);
        out.push(item);
      }
    }
    return DataArray.wrap(out);
  }

  sort(keyFnOrComparator, direction = undefined) {
    const copy = Array.from(this);
    if (direction === undefined && typeof keyFnOrComparator === "function" && keyFnOrComparator.length >= 2) {
      copy.sort(keyFnOrComparator);
      return DataArray.wrap(copy);
    }
    const keyFn = typeof keyFnOrComparator === "function" ? keyFnOrComparator : (x) => x;
    const desc = typeof direction === "string" && /^desc/i.test(direction);
    copy.sort((a, b) => {
      const va = keyFn(a);
      const vb = keyFn(b);
      if ((va === null || va === undefined) && (vb === null || vb === undefined)) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      const c = dvCompare(va, vb);
      return desc ? -c : c;
    });
    return DataArray.wrap(copy);
  }

  groupBy(keyFn) {
    const fn = typeof keyFn === "function" ? keyFn : (x) => x?.[keyFn];
    const groups = new Map();
    for (const item of this) {
      const key = fn(item);
      const id = key && typeof key === "object" ? String(key) : JSON.stringify(key ?? null);
      if (!groups.has(id)) groups.set(id, { key, rows: [] });
      groups.get(id).rows.push(item);
    }
    return DataArray.wrap([...groups.values()].map((g) => ({ key: g.key, rows: DataArray.wrap(g.rows) })));
  }
}

// --- Navigation & Rich Value Rendering ------------------------------------------------------------------

export function openWikiTarget(kandinsky, index, rawTarget, fromPath = "", opts = {}) {
  const cleaned = String(rawTarget ?? "").trim().replace(/^!?\[\[|\]\]$/g, "");
  const [pathPart] = cleaned.split("|");
  const [fileRef] = (pathPart ?? "").split("#");
  const target = (fileRef ?? "").trim();
  if (!target) return;
  const resolved = index.resolvePath(target, fromPath) ?? (/\.md$/i.test(target) ? normPath(target) : `${normPath(target)}.md`);
  kandinsky.open(resolved, opts.line, { beside: Boolean(opts.beside) });
}

function makeClickableLinkEl(kandinsky, index, linkObj, fromPath) {
  const a = document.createElement("a");
  a.className = "dv-link";
  a.href = "#";
  a.textContent = linkObj.display ?? linkObj.fileName();
  const resolved = index.resolvePath(linkObj.path, fromPath) ?? linkObj.path;
  a.title = resolved;
  a.addEventListener("mouseenter", () => kandinsky.hover?.(resolved));
  a.addEventListener("mouseleave", () => kandinsky.hover?.(null));
  a.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    openWikiTarget(kandinsky, index, resolved, fromPath, { beside: ev.ctrlKey || ev.metaKey || ev.shiftKey });
  });
  return a;
}

const INLINE_TOKEN_RE = /(!?\[\[([^\]|#\n]+)(?:#([^\]|\n]+))?(?:\|([^\]\n]+))?\]\])|(\[([^\]]+)\]\(([^)]+)\))|(`[^`]+`)/g;

function renderRichStringInto(container, text, { kandinsky, index, fromPath }) {
  const s = String(text ?? "");
  if (/^#[\p{L}\p{N}_/-]+$/u.test(s.trim())) {
    const chip = document.createElement("span");
    chip.className = "dv-tag";
    chip.textContent = s.trim();
    container.appendChild(chip);
    return;
  }

  let cursor = 0;
  INLINE_TOKEN_RE.lastIndex = 0;
  for (let m = INLINE_TOKEN_RE.exec(s); m; m = INLINE_TOKEN_RE.exec(s)) {
    if (m.index > cursor) container.appendChild(document.createTextNode(s.slice(cursor, m.index)));
    if (m[1]) {
      const link = makeDvLink(m[2].trim(), m[4]?.trim(), m[1].startsWith("!"), m[3]?.trim());
      container.appendChild(makeClickableLinkEl(kandinsky, index, link, fromPath));
    } else if (m[5]) {
      const label = m[6], href = m[7].trim();
      if (href.startsWith("obsidian://open")) {
        let fileParam = "";
        try { fileParam = new URL(href).searchParams.get("file") ?? ""; } catch { /* ignore */ }
        if (fileParam) {
          container.appendChild(makeClickableLinkEl(kandinsky, index, makeDvLink(decodeURIComponent(fileParam), label), fromPath));
        } else {
          container.appendChild(document.createTextNode(label));
        }
      } else if (/^https?:\/\//i.test(href)) {
        const a = document.createElement("a");
        a.className = "dv-link";
        a.href = href;
        a.textContent = label;
        a.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          kandinsky.openLink(href, { outside: ev.shiftKey });
        });
        container.appendChild(a);
      } else {
        container.appendChild(makeClickableLinkEl(kandinsky, index, makeDvLink(href, label), fromPath));
      }
    } else if (m[8]) {
      const code = document.createElement("code");
      code.textContent = m[8].slice(1, -1);
      container.appendChild(code);
    }
    cursor = m.index + m[0].length;
  }
  if (cursor < s.length) container.appendChild(document.createTextNode(s.slice(cursor)));
}

export function renderValueInto(container, val, ctx) {
  if (val === null || val === undefined || val === "") {
    const dash = document.createElement("span");
    dash.className = "dv-null";
    dash.textContent = "—";
    container.appendChild(dash);
    return;
  }
  if (typeof Node !== "undefined" && val instanceof Node) {
    container.appendChild(val);
    return;
  }
  if (typeof val === "object") {
    if (val.__dvLink) {
      container.appendChild(makeClickableLinkEl(ctx.kandinsky, ctx.index, val, ctx.fromPath));
      return;
    }
    if (val.__dvExternalLink) {
      const a = document.createElement("a");
      a.className = "dv-link";
      a.href = val.url;
      a.textContent = val.display || val.url;
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        ctx.kandinsky.openLink(val.url, { outside: ev.shiftKey });
      });
      container.appendChild(a);
      return;
    }
    if (val.__dvDate) {
      const span = document.createElement("span");
      span.textContent = val.toFormat(ctx.getDefaultFmt());
      span.title = val.toISO();
      container.appendChild(span);
      return;
    }
    if (Array.isArray(val)) {
      if (!val.length) {
        const dash = document.createElement("span");
        dash.className = "dv-null";
        dash.textContent = "—";
        container.appendChild(dash);
        return;
      }
      val.forEach((item, idx) => {
        if (idx > 0) container.appendChild(document.createTextNode(", "));
        renderValueInto(container, item, ctx);
      });
      return;
    }
  }
  if (typeof val === "boolean" || typeof val === "number") {
    container.appendChild(document.createTextNode(String(val)));
    return;
  }
  renderRichStringInto(container, String(val), ctx);
}

// --- High-level Table / List / Task DOM Builders --------------------------------------------------------

export function renderTableDom(container, headers, rows, ctx) {
  const listRows = Array.from(rows ?? []);
  if (!listRows.length) {
    const p = document.createElement("p");
    p.className = "dv-empty";
    p.textContent = "Dataview: 0 results.";
    container.appendChild(p);
    return p;
  }
  const table = document.createElement("table");
  table.className = "dv-table";
  if (headers?.length) {
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    for (const h of headers) {
      const th = document.createElement("th");
      th.textContent = String(h ?? "");
      tr.appendChild(th);
    }
    thead.appendChild(tr);
    table.appendChild(thead);
  }
  const tbody = document.createElement("tbody");
  for (const row of listRows) {
    const tr = document.createElement("tr");
    for (const cell of Array.from(row ?? [])) {
      const td = document.createElement("td");
      renderValueInto(td, cell, ctx);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);
  return table;
}

export function renderListDom(container, items, ctx) {
  const arr = Array.from(items ?? []);
  if (!arr.length) {
    const p = document.createElement("p");
    p.className = "dv-empty";
    p.textContent = "Dataview: 0 results.";
    container.appendChild(p);
    return p;
  }
  const ul = document.createElement("ul");
  ul.className = "dv-list";
  for (const item of arr) {
    const li = document.createElement("li");
    if (item && typeof item === "object" && ("idVal" in item || "extraVal" in item)) {
      if (item.idVal !== null && item.idVal !== undefined) {
        renderValueInto(li, item.idVal, ctx);
        if (item.extraVal !== null && item.extraVal !== undefined && item.extraVal !== "") {
          li.appendChild(document.createTextNode(": "));
          renderValueInto(li, item.extraVal, ctx);
        }
      } else {
        renderValueInto(li, item.extraVal, ctx);
      }
    } else {
      renderValueInto(li, item, ctx);
    }
    ul.appendChild(li);
  }
  container.appendChild(ul);
  return ul;
}

export function renderTaskListDom(container, tasks, groupByFile, ctx) {
  const list = Array.from(tasks ?? []);
  if (!list.length) {
    const p = document.createElement("p");
    p.className = "dv-empty";
    p.textContent = "Dataview: 0 tasks.";
    container.appendChild(p);
    return p;
  }

  const buildOneTask = (t) => {
    const li = document.createElement("li");
    li.className = `dv-task-item${t.completed ? " is-done" : ""}`;
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = Boolean(t.completed);
    cb.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      if (!t.path || !t.line) return;
      try {
        const raw = await ctx.kandinsky.readText(t.path);
        const lines = raw.split(/\r?\n/);
        const idx = t.line - 1;
        if (idx >= 0 && idx < lines.length) {
          const nextMark = cb.checked ? "x" : " ";
          const updated = lines[idx].replace(/^(\s*[-*+]\s+\[).(])/, `$1${nextMark}$2`);
          if (updated !== lines[idx]) {
            lines[idx] = updated;
            await ctx.kandinsky.writeText(t.path, lines.join("\n"));
          }
        }
      } catch {
        ctx.kandinsky.open(t.path, t.line);
      }
    });
    li.appendChild(cb);

    const span = document.createElement("span");
    span.className = "dv-task-text";
    renderRichStringInto(span, t.visual ?? t.text ?? "", { ...ctx, fromPath: t.path || ctx.fromPath });
    li.appendChild(span);

    if (t.path) {
      const jump = document.createElement("a");
      jump.className = "dv-task-jump";
      jump.textContent = groupByFile ? `:${t.line ?? 1}` : `${(t.path.split("/").pop() ?? "").replace(/\.md$/i, "")}:${t.line ?? 1}`;
      jump.title = `Open ${t.path} at line ${t.line ?? 1}`;
      jump.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        ctx.kandinsky.open(t.path, t.line, { beside: ev.ctrlKey || ev.metaKey || ev.shiftKey });
      });
      li.appendChild(jump);
    }
    return li;
  };

  if (!groupByFile) {
    const ul = document.createElement("ul");
    ul.className = "dv-task-list";
    for (const t of list) ul.appendChild(buildOneTask(t));
    container.appendChild(ul);
    return ul;
  }

  const byFile = new Map();
  for (const t of list) {
    const p = t.path ?? "";
    if (!byFile.has(p)) byFile.set(p, []);
    byFile.get(p).push(t);
  }

  const wrap = document.createElement("div");
  for (const [filePath, fileTasks] of byFile) {
    const sec = document.createElement("div");
    sec.className = "dv-task-group";
    if (filePath) {
      const head = document.createElement("div");
      head.className = "dv-task-group-head";
      head.appendChild(makeClickableLinkEl(ctx.kandinsky, ctx.index, makeDvLink(filePath), ctx.fromPath));
      head.appendChild(document.createTextNode(` (${fileTasks.length})`));
      sec.appendChild(head);
    }
    const ul = document.createElement("ul");
    ul.className = "dv-task-list";
    for (const t of fileTasks) ul.appendChild(buildOneTask(t));
    sec.appendChild(ul);
    wrap.appendChild(sec);
  }
  container.appendChild(wrap);
  return wrap;
}

export function renderDqlResult(container, result, ctx) {
  if (result.mode === "TABLE") return renderTableDom(container, result.headers, result.rows, ctx);
  if (result.mode === "LIST") return renderListDom(container, result.items, ctx);
  if (result.mode === "TASK") return renderTaskListDom(container, result.tasks, true, ctx);
  return null;
}

// --- DataviewJS (`dv` + `app`) Execution ----------------------------------------------------------------

export async function runDataviewJs(source, container, { kandinsky, index, currentPath, liveProps = {}, getDefaultFmt = () => "YYYY-MM-DD", maxRows = 500 }) {
  const ctx = { kandinsky, index, fromPath: currentPath, getDefaultFmt };
  const appShim = {
    workspace: {
      openLinkText(linktext, sourcePath = currentPath, newLeaf = false) {
        openWikiTarget(kandinsky, index, linktext, sourcePath, { beside: Boolean(newLeaf) });
      },
    },
    vault: {
      getAbstractFileByPath(p) {
        const page = index.getPage(p, currentPath);
        return page ? { path: page.file.path, name: `${page.file.name}.md`, basename: page.file.name, extension: "md" } : null;
      },
    },
  };

  const dv = {
    container,
    currentFilePath: currentPath,
    app: appShim,
    current() {
      const indexed = index.getPage(currentPath);
      return indexed ? { ...liveProps, ...indexed } : { ...liveProps, file: { path: currentPath, name: currentPath.split("/").pop()?.replace(/\.md$/i, "") ?? "" } };
    },
    pages(query = "") {
      return DataArray.wrap(filterPagesBySource(index.allPages(), query, currentPath, index));
    },
    pagePaths(query = "") {
      return this.pages(query).map((p) => p.file.path);
    },
    page(path) {
      return index.getPage(path, currentPath);
    },
    array(raw) {
      return DataArray.wrap(raw);
    },
    isArray(v) {
      return Array.isArray(v);
    },
    fileLink(path, embed = false, display = undefined) {
      const resolved = index.resolvePath(path, currentPath) ?? normPath(path);
      return makeDvLink(resolved, display, embed);
    },
    sectionLink(path, section, embed = false, display = undefined) {
      const resolved = index.resolvePath(path, currentPath) ?? normPath(path);
      return makeDvLink(resolved, display, embed, section);
    },
    date(val) {
      const ms = parseDateMs(val);
      return ms !== null ? makeDvDate(ms, getDefaultFmt) : null;
    },
    compare: dvCompare,
    equal: dvEqual,
    clone(v) {
      try { return structuredClone(v); } catch { return v; }
    },
    el(tag, text, opts = {}) {
      const elem = document.createElement(String(tag || "div"));
      if (opts?.cls) elem.className = Array.isArray(opts.cls) ? opts.cls.join(" ") : String(opts.cls);
      if (opts?.attr && typeof opts.attr === "object") {
        for (const [k, v] of Object.entries(opts.attr)) elem.setAttribute(k, String(v));
      }
      if (text !== undefined && text !== null && text !== "") renderValueInto(elem, text, ctx);
      (opts?.container ?? container).appendChild(elem);
      return elem;
    },
    header(level, text) {
      const n = Math.min(6, Math.max(1, Number(level) || 2));
      return this.el(`h${n}`, text);
    },
    paragraph(text) {
      return this.el("p", text);
    },
    span(text) {
      return this.el("span", text);
    },
    list(items) {
      return renderListDom(container, items, ctx);
    },
    table(headers, rows) {
      return renderTableDom(container, headers, rows, ctx);
    },
    taskList(tasks, groupByFile = true) {
      return renderTaskListDom(container, tasks, groupByFile, ctx);
    },
    execute(dqlSource) {
      const res = executeDql(dqlSource, { index, currentPath, getDefaultFmt, maxRows });
      return renderDqlResult(container, res, ctx);
    },
  };

  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction("dv", "app", `"use strict";\n${source}`);
  await fn(dv, appShim);
}
