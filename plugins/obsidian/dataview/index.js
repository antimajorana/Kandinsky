// Fast cached Markdown vault indexer for Dataview & DataviewJS.
// Walks .md files concurrently, parses YAML frontmatter, inline `key:: value` fields, #tags, [[links]], and tasks,
// and refreshes incrementally via `kandinsky.onFilesChanged`.

const SKIP_DIRS = new Set([".git", ".obsidian", ".kandinsky", ".atlas" /* a vault not yet renamed */, ".trash", "node_modules", "__pycache__"]);

export const normPath = (p) => String(p ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

const pad2 = (n) => String(n).padStart(2, "0");
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const DATE_TOK_RE = /\[([^\]]*)\]|YYYY|yyyy|YY|yy|MMMM|MMM|MM|M|DD|dd|D|d|dddd|cccc|ddd|ccc|HH|H|hh|h|mm|m|ss|s/g;

export function formatDateTokens(msOrDate, fmt = "YYYY-MM-DD") {
  const d = msOrDate instanceof Date ? msOrDate : new Date(Number(msOrDate));
  if (Number.isNaN(d.getTime())) return "";
  return String(fmt || "YYYY-MM-DD").replace(DATE_TOK_RE, (tok, esc) => {
    if (esc !== undefined) return esc;
    const h24 = d.getHours();
    const h12 = h24 % 12 || 12;
    switch (tok) {
      case "YYYY": case "yyyy": return String(d.getFullYear()).padStart(4, "0");
      case "YY": case "yy": return String(d.getFullYear()).slice(-2);
      case "MMMM": return MONTHS_LONG[d.getMonth()];
      case "MMM": return MONTHS_SHORT[d.getMonth()];
      case "MM": return pad2(d.getMonth() + 1);
      case "M": return String(d.getMonth() + 1);
      case "DD": case "dd": return pad2(d.getDate());
      case "D": case "d": return String(d.getDate());
      case "dddd": case "cccc": return DAYS_LONG[d.getDay()];
      case "ddd": case "ccc": return DAYS_SHORT[d.getDay()];
      case "HH": return pad2(h24);
      case "H": return String(h24);
      case "hh": return pad2(h12);
      case "h": return String(h12);
      case "mm": return pad2(d.getMinutes());
      case "m": return String(d.getMinutes());
      case "ss": return pad2(d.getSeconds());
      case "s": return String(d.getSeconds());
      default: return tok;
    }
  });
}

/** Parse ISO YYYY-MM-DD[THH:mm:ss] or European DD-MM-YYYY strings into epoch ms, or null if not a date. */
export function parseDateMs(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === "object" && val.__dvDate) return val.ts;
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val.getTime();
  if (typeof val !== "string") return null;
  const s = val.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (iso) {
    const dt = new Date(
      Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]),
      iso[4] ? Number(iso[4]) : 0, iso[5] ? Number(iso[5]) : 0, iso[6] ? Number(iso[6]) : 0,
    );
    return Number.isNaN(dt.getTime()) ? null : dt.getTime();
  }
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (dmy) {
    const day = Number(dmy[1]), mon = Number(dmy[2]), yr = Number(dmy[3]);
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
      return new Date(yr, mon - 1, day).getTime();
    }
  }
  return null;
}

/** Luxon-compatible DateTime wrapper used on page.file.mtime / ctime / day and dv.date(). */
export function makeDvDate(ms, getDefaultFmt = () => "YYYY-MM-DD") {
  const d = new Date(Number(ms));
  const ts = d.getTime();
  if (Number.isNaN(ts)) return null;
  return {
    __dvDate: true,
    ts,
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
    second: d.getSeconds(),
    weekday: d.getDay() || 7,
    toFormat(fmt) { return formatDateTokens(d, fmt || getDefaultFmt()); },
    toISODate() { return formatDateTokens(d, "YYYY-MM-DD"); },
    toISO() { return d.toISOString(); },
    startOf(unit) {
      const c = new Date(ts);
      if (unit === "day") c.setHours(0, 0, 0, 0);
      else if (unit === "month") { c.setDate(1); c.setHours(0, 0, 0, 0); }
      else if (unit === "year") { c.setMonth(0, 1); c.setHours(0, 0, 0, 0); }
      return makeDvDate(c.getTime(), getDefaultFmt);
    },
    valueOf() { return ts; },
    toString() { return formatDateTokens(d, getDefaultFmt()); },
  };
}

/** Dataview Link wrapper used on page.file.link, frontmatter [[links]], and dv.fileLink(). */
export function makeDvLink(path, display = undefined, embed = false, subpath = "") {
  const clean = normPath(String(path ?? ""));
  const base = (clean.includes("/") ? clean.slice(clean.lastIndexOf("/") + 1) : clean).replace(/\.md$/i, "");
  return {
    __dvLink: true,
    path: clean,
    display: display !== undefined && display !== null && display !== "" ? String(display) : undefined,
    embed: Boolean(embed),
    subpath: subpath ? String(subpath) : "",
    type: subpath ? "header" : "file",
    fileName() { return base; },
    markdown() {
      const target = subpath ? `${clean}#${subpath}` : clean;
      const shown = this.display ?? base;
      return `${embed ? "!" : ""}[[${target}|${shown}]]`;
    },
    valueOf() { return clean.toLowerCase(); },
    toString() { return this.display ?? base; },
  };
}

function unquoteYaml(raw) {
  const s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    const inner = s.slice(1, -1);
    return s.startsWith('"') ? inner.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\") : inner;
  }
  return s;
}

function parseYamlScalar(raw) {
  const s = raw.trim();
  if (s === "" || s === "null" || s === "~") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^[+-]?\d+(?:\.\d+)?$/.test(s)) return Number(s);
  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return splitCsvQuoted(inner).map((item) => parseYamlScalar(item));
  }
  const str = unquoteYaml(s);
  const wl = /^!?\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]$/.exec(str);
  if (wl) return makeDvLink(wl[1].trim(), wl[3]?.trim(), str.startsWith("!"), wl[2]?.trim());
  return str;
}

function splitCsvQuoted(s) {
  const out = [];
  let cur = "", quote = null, bracket = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      cur += c;
      if (c === quote && s[i - 1] !== "\\") quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (c === "[") {
      bracket++;
      cur += c;
    } else if (c === "]") {
      bracket = Math.max(0, bracket - 1);
      cur += c;
    } else if (c === "," && bracket === 0) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Lightweight YAML frontmatter parser handling scalars, arrays, indented `- item` lists, and nested 1-level maps. */
export function parseFrontmatter(text) {
  const s = String(text ?? "");
  if (!s.startsWith("---\n") && !s.startsWith("---\r\n")) return { frontmatter: {}, body: s, bodyStartLine: 1 };
  const endMatch = /\r?\n---[ \t]*(?:\r?\n|$)/.exec(s.slice(3));
  if (!endMatch) return { frontmatter: {}, body: s, bodyStartLine: 1 };

  const yamlBlock = s.slice(4, 3 + endMatch.index);
  const afterIdx = 3 + endMatch.index + endMatch[0].length;
  const body = s.slice(afterIdx);
  const bodyStartLine = s.slice(0, afterIdx).split("\n").length;

  const fm = {};
  const lines = yamlBlock.split(/\r?\n/);
  let currentKey = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;

    const listItem = /^\s+-\s*(.*)$/.exec(line);
    if (listItem && currentKey) {
      if (!Array.isArray(fm[currentKey])) fm[currentKey] = [];
      const val = parseYamlScalar(listItem[1]);
      if (val !== null && val !== "") fm[currentKey].push(val);
      continue;
    }

    const nestedKv = /^\s{2,}([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (nestedKv && currentKey && (fm[currentKey] === null || (typeof fm[currentKey] === "object" && !Array.isArray(fm[currentKey])))) {
      if (fm[currentKey] === null) fm[currentKey] = {};
      fm[currentKey][nestedKv[1]] = parseYamlScalar(nestedKv[2]);
      continue;
    }

    const topKv = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (topKv) {
      currentKey = topKv[1];
      const rest = topKv[2].replace(/\s+#.*$/, "").trim();
      fm[currentKey] = rest === "" ? null : parseYamlScalar(rest);
    }
  }
  return { frontmatter: fm, body, bodyStartLine };
}

function addTagWithParents(tagSet, etagSet, rawTag) {
  let clean = String(rawTag ?? "").trim().replace(/^#+/, "");
  if (!clean) return;
  etagSet.add(`#${clean}`);
  const parts = clean.split("/");
  for (let i = 1; i <= parts.length; i++) {
    tagSet.add(`#${parts.slice(0, i).join("/")}`);
  }
}

const WIKILINK_RE = /!?\[\[([^\]|#\n]+)(?:#([^\]|\n]+))?(?:\|([^\]\n]+))?\]\]/g;
const INLINE_TAG_RE = /(?:^|[\s([{"'])#([\p{L}\p{N}_/-]*[\p{L}_-][\p{L}\p{N}_/-]*)/gu;

/** Parse one Markdown document into a Dataview Page object. */
export function parseMarkdownPage(path, text, meta = {}, getDefaultFmt = () => "YYYY-MM-DD") {
  const cleanPath = normPath(path);
  const idx = cleanPath.lastIndexOf("/");
  const folder = idx >= 0 ? cleanPath.slice(0, idx) : "";
  const fileNameWithExt = idx >= 0 ? cleanPath.slice(idx + 1) : cleanPath;
  const name = fileNameWithExt.replace(/\.md$/i, "");

  const { frontmatter, body, bodyStartLine } = parseFrontmatter(text);
  const tagSet = new Set();
  const etagSet = new Set();
  const outlinkTargets = [];
  const tasks = [];
  const lists = [];
  const inlineFields = {};

  // Tags from frontmatter (`tags` or `tag`)
  for (const k of ["tags", "tag"]) {
    const v = frontmatter[k];
    if (Array.isArray(v)) {
      for (const item of v) addTagWithParents(tagSet, etagSet, item);
    } else if (typeof v === "string") {
      for (const item of v.split(/[\s,]+/)) addTagWithParents(tagSet, etagSet, item);
    }
  }

  // Links inside frontmatter values
  for (const val of Object.values(frontmatter)) {
    const arr = Array.isArray(val) ? val : [val];
    for (const item of arr) {
      if (item && typeof item === "object" && item.__dvLink) outlinkTargets.push(item);
      else if (typeof item === "string") {
        WIKILINK_RE.lastIndex = 0;
        for (let m = WIKILINK_RE.exec(item); m; m = WIKILINK_RE.exec(item)) {
          outlinkTargets.push(makeDvLink(m[1].trim(), m[3]?.trim(), m[0].startsWith("!"), m[2]?.trim()));
        }
      }
    }
  }

  // Scan body lines outside fenced code blocks
  const bodyLines = body.split(/\r?\n/);
  let inFence = false;
  let fenceMarker = "";
  let currentSection = name;

  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    const lineNum = bodyStartLine + i;

    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;

    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) currentSection = heading[2].trim();

    const withoutInlineCode = line.replace(/`[^`]*`/g, " ");

    // Outgoing [[WikiLinks]]
    WIKILINK_RE.lastIndex = 0;
    for (let m = WIKILINK_RE.exec(withoutInlineCode); m; m = WIKILINK_RE.exec(withoutInlineCode)) {
      outlinkTargets.push(makeDvLink(m[1].trim(), m[3]?.trim(), m[0].startsWith("!"), m[2]?.trim()));
    }

    // Inline #tags
    INLINE_TAG_RE.lastIndex = 0;
    for (let m = INLINE_TAG_RE.exec(withoutInlineCode); m; m = INLINE_TAG_RE.exec(withoutInlineCode)) {
      addTagWithParents(tagSet, etagSet, m[1]);
    }

    // Inline Dataview fields: `key:: value`, `[key:: value]`, `(key:: value)`
    const wholeInline = /^\s*(?:[-*+]\s+)?([A-Za-z0-9_ -]+?)::\s*(.+?)\s*$/.exec(withoutInlineCode);
    if (wholeInline && !wholeInline[1].includes("http")) {
      const k = wholeInline[1].trim();
      inlineFields[k] = parseYamlScalar(wholeInline[2]);
    } else {
      const bracketInline = /[[(]([A-Za-z0-9_ -]+?)::\s*([^\])\n]+)[\])]/g;
      for (let m = bracketInline.exec(withoutInlineCode); m; m = bracketInline.exec(withoutInlineCode)) {
        inlineFields[m[1].trim()] = parseYamlScalar(m[2]);
      }
    }

    // Tasks & bullet list items
    const taskMatch = /^(\s*)[-*+]\s+\[(.)\]\s*(.*)$/.exec(line);
    if (taskMatch) {
      const status = taskMatch[2];
      const taskText = taskMatch[3].trim();
      const taskTags = [];
      INLINE_TAG_RE.lastIndex = 0;
      for (let tm = INLINE_TAG_RE.exec(taskText); tm; tm = INLINE_TAG_RE.exec(taskText)) {
        taskTags.push(`#${tm[1]}`);
      }
      const completed = status === "x" || status === "X";
      const taskObj = {
        symbol: "-",
        link: makeDvLink(cleanPath, name, false, currentSection),
        section: makeDvLink(cleanPath, currentSection, false, currentSection),
        text: taskText,
        visual: taskText,
        tags: taskTags,
        line: lineNum,
        lineCount: 1,
        path: cleanPath,
        status,
        checked: status !== " ",
        completed,
        fullyCompleted: completed,
        task: true,
        subtasks: [],
        children: [],
      };
      tasks.push(taskObj);
      lists.push(taskObj);
    } else {
      const listMatch = /^(\s*)[-*+]\s+(.+)$/.exec(line);
      if (listMatch) {
        lists.push({
          symbol: "-",
          link: makeDvLink(cleanPath, name, false, currentSection),
          section: makeDvLink(cleanPath, currentSection, false, currentSection),
          text: listMatch[2].trim(),
          line: lineNum,
          path: cleanPath,
          task: false,
          children: [],
        });
      }
    }
  }

  const mtimeMs = meta.mtime ? meta.mtime * 1000 : Date.now();
  const createdMs = parseDateMs(frontmatter.created) ?? mtimeMs;
  const dayMs = parseDateMs(frontmatter.date) ?? parseDateMs(name);

  const mtimeDv = makeDvDate(mtimeMs, getDefaultFmt);
  const ctimeDv = makeDvDate(createdMs, getDefaultFmt);
  const aliases = Array.isArray(frontmatter.aliases)
    ? frontmatter.aliases.map(String)
    : (frontmatter.aliases ? [String(frontmatter.aliases)] : []);

  const fileObj = {
    path: cleanPath,
    folder,
    name,
    ext: "md",
    link: makeDvLink(cleanPath, name),
    size: meta.size ?? text.length,
    ctime: ctimeDv,
    cday: ctimeDv?.startOf("day") ?? null,
    mtime: mtimeDv,
    mday: mtimeDv?.startOf("day") ?? null,
    day: dayMs !== null ? makeDvDate(dayMs, getDefaultFmt) : null,
    tags: [...tagSet],
    etags: [...etagSet],
    outlinks: outlinkTargets,
    inlinks: [],
    aliases,
    tasks,
    lists,
    frontmatter: { ...frontmatter },
  };

  const page = { ...frontmatter, ...inlineFields };
  // Also expose Dataview's lowercase-slug normalized field keys without clobbering exact keys
  for (const [k, v] of Object.entries({ ...frontmatter, ...inlineFields })) {
    const slug = k.toLowerCase().replace(/\s+/g, "-");
    const snake = k.toLowerCase().replace(/[\s-]+/g, "_");
    if (!(slug in page)) page[slug] = v;
    if (!(snake in page)) page[snake] = v;
  }
  page.file = fileObj;
  return page;
}

/** Create the shared, incrementally cached VaultIndex for a Dataview plugin instance. */
export function createVaultIndex(kandinsky, getDefaultFmt = () => "YYYY-MM-DD") {
  const entriesByPath = new Map(); // path -> { mtime, size, page }
  const byBasename = new Map();    // lowercase basename -> path[]
  let initialized = false;
  let scanPromise = null;
  const subscribers = new Set();
  let notifyTimer = null;

  function rebuildLinksAndNames() {
    byBasename.clear();
    for (const [p, rec] of entriesByPath) {
      rec.page.file.inlinks = [];
      const key = rec.page.file.name.toLowerCase();
      const arr = byBasename.get(key) ?? [];
      arr.push(p);
      byBasename.set(key, arr);
    }

    for (const [srcPath, rec] of entriesByPath) {
      const seenTargets = new Set();
      const resolvedOut = [];
      for (const link of rec.page.file.outlinks) {
        const resolved = resolvePath(link.path, srcPath) ?? link.path;
        const resolvedLink = makeDvLink(resolved, link.display, link.embed, link.subpath);
        resolvedOut.push(resolvedLink);
        if (!seenTargets.has(resolved) && entriesByPath.has(resolved) && resolved !== srcPath) {
          seenTargets.add(resolved);
          entriesByPath.get(resolved).page.file.inlinks.push(makeDvLink(srcPath, rec.page.file.name));
        }
      }
      rec.page.file.outlinks = resolvedOut;
    }
  }

  function resolvePath(rawTarget, fromPath = "") {
    if (!rawTarget) return null;
    const stripped = String(rawTarget).trim().replace(/^!?\[\[|\]\]$/g, "").split("|")[0].split("#")[0].trim();
    if (!stripped) return fromPath || null;
    const clean = normPath(stripped);
    const withMd = /\.md$/i.test(clean) ? clean : `${clean}.md`;

    if (entriesByPath.has(clean)) return clean;
    if (entriesByPath.has(withMd)) return withMd;

    if (fromPath && !clean.includes("/")) {
      const fromDir = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : "";
      if (fromDir) {
        const sibling = `${fromDir}/${withMd}`;
        if (entriesByPath.has(sibling)) return sibling;
      }
    }

    const baseKey = clean.replace(/\.md$/i, "").split("/").pop().toLowerCase();
    const candidates = byBasename.get(baseKey);
    if (candidates?.length) {
      if (clean.includes("/")) {
        const suffix = `/${withMd.toLowerCase()}`;
        const hit = candidates.find((c) => c.toLowerCase().endsWith(suffix) || c.toLowerCase() === withMd.toLowerCase());
        if (hit) return hit;
      }
      return candidates[0];
    }
    return null;
  }

  async function walkVaultMdFiles(dir = "", acc = []) {
    let list = [];
    try {
      list = await kandinsky.list(dir);
    } catch {
      return acc;
    }
    const subdirs = [];
    for (const item of list) {
      if (item.ignored) continue;
      if (item.dir) {
        if (!SKIP_DIRS.has(item.name) && !item.name.startsWith(".")) subdirs.push(item.path);
      } else if (/\.md$/i.test(item.name)) {
        acc.push(item);
      }
    }
    if (subdirs.length) {
      await Promise.all(subdirs.map((d) => walkVaultMdFiles(d, acc)));
    }
    return acc;
  }

  async function runFullOrDiffScan() {
    const files = await walkVaultMdFiles("");
    const diskSet = new Set();
    const toRead = [];

    for (const f of files) {
      const p = normPath(f.path);
      diskSet.add(p);
      const prev = entriesByPath.get(p);
      if (!prev || (f.mtime !== undefined && prev.mtime !== f.mtime) || (f.size !== undefined && prev.size !== f.size)) {
        toRead.push(f);
      }
    }

    for (const existing of [...entriesByPath.keys()]) {
      if (!diskSet.has(existing)) entriesByPath.delete(existing);
    }

    // Read changed/new files with bounded concurrency (24 at a time)
    const BATCH = 24;
    for (let i = 0; i < toRead.length; i += BATCH) {
      const slice = toRead.slice(i, i + BATCH);
      await Promise.all(slice.map(async (f) => {
        const p = normPath(f.path);
        try {
          const text = await kandinsky.readText(p);
          const page = parseMarkdownPage(p, text, { mtime: f.mtime, size: f.size }, getDefaultFmt);
          entriesByPath.set(p, { mtime: f.mtime, size: f.size, page });
        } catch {
          entriesByPath.delete(p);
        }
      }));
    }

    rebuildLinksAndNames();
    initialized = true;
  }

  async function ensureReady() {
    if (initialized) return;
    if (!scanPromise) {
      scanPromise = runFullOrDiffScan().finally(() => { scanPromise = null; });
    }
    await scanPromise;
  }

  async function refreshPaths(paths) {
    if (!initialized) return;
    if (!paths || !paths.length || paths.length > 40) {
      scanPromise = runFullOrDiffScan().finally(() => { scanPromise = null; });
      await scanPromise;
      scheduleNotify();
      return;
    }

    const mdPaths = paths.map(normPath).filter((p) => /\.md$/i.test(p) && !p.startsWith(".kandinsky/") && !p.startsWith(".atlas/") && !p.startsWith(".obsidian/"));
    if (!mdPaths.length) return;

    await Promise.all(mdPaths.map(async (p) => {
      try {
        if (!(await kandinsky.exists(p))) {
          entriesByPath.delete(p);
          return;
        }
        const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
        const list = await kandinsky.list(dir).catch(() => []);
        const hit = list.find((e) => normPath(e.path) === p);
        const text = await kandinsky.readText(p);
        const page = parseMarkdownPage(p, text, { mtime: hit?.mtime, size: hit?.size }, getDefaultFmt);
        entriesByPath.set(p, { mtime: hit?.mtime, size: hit?.size, page });
      } catch {
        entriesByPath.delete(p);
      }
    }));

    rebuildLinksAndNames();
    scheduleNotify();
  }

  function scheduleNotify() {
    if (notifyTimer) clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => {
      notifyTimer = null;
      for (const fn of [...subscribers]) {
        try { fn(); } catch { /* ignore individual fence listener errors */ }
      }
    }, 80);
  }

  return {
    ensureReady,
    refreshPaths,
    async forceRescan() {
      entriesByPath.clear();
      initialized = false;
      await ensureReady();
      scheduleNotify();
    },
    allPages() {
      return [...entriesByPath.values()].map((r) => r.page);
    },
    getPage(pathOrLink, fromPath = "") {
      const target = pathOrLink && typeof pathOrLink === "object" && pathOrLink.__dvLink ? pathOrLink.path : pathOrLink;
      const resolved = resolvePath(target, fromPath);
      return resolved ? entriesByPath.get(resolved)?.page : undefined;
    },
    resolvePath,
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}
