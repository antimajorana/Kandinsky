// Templater expansion engine: Moment-style date formatting, <% tp.* %> & <%* ... %> evaluation,
// {{title}}/{{date}}/{{time}} placeholders, and Obsidian folder_templates rule matching.

const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_MIN = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const pad2 = (n) => String(n).padStart(2, "0");
const pad3 = (n) => String(n).padStart(3, "0");

function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function dayOfYear(d) {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / 86400000);
}

function isoWeek(d) {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function tzOffset(d, colon = true) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const hh = pad2(Math.floor(abs / 60));
  const mm = pad2(abs % 60);
  return colon ? `${sign}${hh}:${mm}` : `${sign}${hh}${mm}`;
}

const TOKEN_RE = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DDDD|DDD|DD|Do|D|dddd|ddd|dd|d|E|WW|W|ww|w|HH|H|hh|h|mm|m|ss|s|SSS|ZZ|Z|A|a|X|x/g;

/** Format a JS Date with Moment.js tokens (single pass so month/day words are never re-tokenized). */
export function formatMoment(date, fmt = "YYYY-MM-DD") {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const f = fmt === undefined || fmt === null || fmt === "" ? "YYYY-MM-DD" : String(fmt);
  return f.replace(TOKEN_RE, (tok, escaped) => {
    if (escaped !== undefined) return escaped;
    const h24 = d.getHours();
    const h12 = h24 % 12 || 12;
    switch (tok) {
      case "YYYY": return String(d.getFullYear()).padStart(4, "0");
      case "YY": return String(d.getFullYear()).slice(-2);
      case "MMMM": return MONTHS_LONG[d.getMonth()];
      case "MMM": return MONTHS_SHORT[d.getMonth()];
      case "MM": return pad2(d.getMonth() + 1);
      case "M": return String(d.getMonth() + 1);
      case "DDDD": return pad3(dayOfYear(d));
      case "DDD": return String(dayOfYear(d));
      case "DD": return pad2(d.getDate());
      case "Do": return ordinal(d.getDate());
      case "D": return String(d.getDate());
      case "dddd": return DAYS_LONG[d.getDay()];
      case "ddd": return DAYS_SHORT[d.getDay()];
      case "dd": return DAYS_MIN[d.getDay()];
      case "d": return String(d.getDay());
      case "E": return String(d.getDay() || 7);
      case "WW":
      case "ww": return pad2(isoWeek(d));
      case "W":
      case "w": return String(isoWeek(d));
      case "HH": return pad2(h24);
      case "H": return String(h24);
      case "hh": return pad2(h12);
      case "h": return String(h12);
      case "mm": return pad2(d.getMinutes());
      case "m": return String(d.getMinutes());
      case "ss": return pad2(d.getSeconds());
      case "s": return String(d.getSeconds());
      case "SSS": return pad3(d.getMilliseconds());
      case "A": return h24 < 12 ? "AM" : "PM";
      case "a": return h24 < 12 ? "am" : "pm";
      case "Z": return tzOffset(d, true);
      case "ZZ": return tzOffset(d, false);
      case "X": return String(Math.floor(d.getTime() / 1000));
      case "x": return String(d.getTime());
      default: return tok;
    }
  });
}

/** Parse a reference date string using an optional Moment format (YYYY-MM-DD, DD-MM-YYYY, etc.). */
export function parseReferenceDate(ref, refFormat, fallback = new Date()) {
  if (!ref) return new Date(fallback.getTime());
  if (ref instanceof Date && !Number.isNaN(ref.getTime())) return new Date(ref.getTime());
  const s = String(ref).trim();
  if (!s) return new Date(fallback.getTime());

  if (refFormat) {
    const fmt = String(refFormat).trim();
    if (/^YYYY[-/.]MM[-/.]DD/.test(fmt)) {
      const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
      if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), fallback.getHours(), fallback.getMinutes(), fallback.getSeconds());
    }
    if (/^DD[-/.]MM[-/.]YYYY/.test(fmt)) {
      const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s);
      if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), fallback.getHours(), fallback.getMinutes(), fallback.getSeconds());
    }
    if (/^MM[-/.]DD[-/.]YYYY/.test(fmt)) {
      const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s);
      if (m) return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]), fallback.getHours(), fallback.getMinutes(), fallback.getSeconds());
    }
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (iso) {
    return new Date(
      Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]),
      iso[4] ? Number(iso[4]) : fallback.getHours(),
      iso[5] ? Number(iso[5]) : fallback.getMinutes(),
      iso[6] ? Number(iso[6]) : fallback.getSeconds(),
    );
  }
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (dmy && Number(dmy[2]) >= 1 && Number(dmy[2]) <= 12) {
    return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]), fallback.getHours(), fallback.getMinutes(), fallback.getSeconds());
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? new Date(fallback.getTime()) : parsed;
}

/** Apply numeric day offset or ISO/Moment duration offset ("P-1D", "P1M", "+7d", "-2w") to a Date. */
export function applyDateOffset(baseDate, offset) {
  const d = new Date(baseDate.getTime());
  if (offset === undefined || offset === null || offset === "" || offset === 0) return d;
  if (typeof offset === "number" && Number.isFinite(offset)) {
    d.setDate(d.getDate() + offset);
    return d;
  }
  const s = String(offset).trim();
  if (/^[+-]?\d+$/.test(s)) {
    d.setDate(d.getDate() + Number(s));
    return d;
  }
  // ISO-8601 duration like P-1D, P1Y2M3D, -P1W
  const isoDur = /^([+-])?P(?:([+-]?\d+)Y)?(?:([+-]?\d+)M)?(?:([+-]?\d+)W)?(?:([+-]?\d+)D)?$/i.exec(s);
  if (isoDur) {
    const sign = isoDur[1] === "-" ? -1 : 1;
    if (isoDur[2]) d.setFullYear(d.getFullYear() + sign * Number(isoDur[2]));
    if (isoDur[3]) d.setMonth(d.getMonth() + sign * Number(isoDur[3]));
    if (isoDur[4]) d.setDate(d.getDate() + sign * Number(isoDur[4]) * 7);
    if (isoDur[5]) d.setDate(d.getDate() + sign * Number(isoDur[5]));
    return d;
  }
  // Shorthand like "+3 days", "-1w", "2 months"
  const rel = /^([+-]?\d+)\s*(y|yr|year|years|M|mo|month|months|w|wk|week|weeks|d|day|days|h|hr|hour|hours|m|min|minute|minutes)$/i.exec(s);
  if (rel) {
    const n = Number(rel[1]);
    const u = rel[2];
    if (/^y/i.test(u)) d.setFullYear(d.getFullYear() + n);
    else if (u === "M" || /^mo/i.test(u)) d.setMonth(d.getMonth() + n);
    else if (/^w/i.test(u)) d.setDate(d.getDate() + n * 7);
    else if (/^d/i.test(u)) d.setDate(d.getDate() + n);
    else if (/^h/i.test(u)) d.setHours(d.getHours() + n);
    else d.setMinutes(d.getMinutes() + n);
  }
  return d;
}

/** Lightweight Moment-compatible wrapper for templates that call moment(...) directly. */
export function makeMomentShim(now = new Date()) {
  const wrap = (date) => ({
    _d: new Date(date.getTime()),
    format(fmt = "YYYY-MM-DD") { return formatMoment(this._d, fmt); },
    add(n, unit = "d") { return wrap(applyDateOffset(this._d, `${Number(n) || 0}${unit}`)); },
    subtract(n, unit = "d") { return wrap(applyDateOffset(this._d, `${-(Number(n) || 0)}${unit}`)); },
    startOf(unit) {
      const c = new Date(this._d.getTime());
      if (unit === "day") c.setHours(0, 0, 0, 0);
      else if (unit === "month") { c.setDate(1); c.setHours(0, 0, 0, 0); }
      else if (unit === "year") { c.setMonth(0, 1); c.setHours(0, 0, 0, 0); }
      return wrap(c);
    },
    toDate() { return new Date(this._d.getTime()); },
    valueOf() { return this._d.getTime(); },
    toString() { return formatMoment(this._d, "YYYY-MM-DDTHH:mm:ssZ"); },
  });
  return (inp, fmt) => (inp === undefined ? wrap(now) : wrap(parseReferenceDate(inp, fmt, now)));
}

export const normPath = (p) => String(p ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

export function noteTitleFromPath(path) {
  const clean = normPath(path);
  const base = clean.includes("/") ? clean.slice(clean.lastIndexOf("/") + 1) : clean;
  return base.replace(/\.(md|markdown)$/i, "");
}

export function folderFromPath(path, relative = false) {
  const clean = normPath(path);
  const idx = clean.lastIndexOf("/");
  if (idx < 0) return relative ? "/" : "";
  const dir = clean.slice(0, idx);
  if (relative) return dir;
  const leafIdx = dir.lastIndexOf("/");
  return leafIdx < 0 ? dir : dir.slice(leafIdx + 1);
}

/** Check whether a newly created note is empty or contains only YAML frontmatter. */
export function isEmptyOrFrontmatterOnly(text) {
  const s = String(text ?? "");
  if (!s.trim()) return true;
  const m = /^---\r?\n[\s\S]*?\r?\n---\s*$/.exec(s);
  return Boolean(m);
}

/** Build the Templater `tp` helper object for a target file. */
export function buildTpContext({
  atlas,
  targetPath,
  title,
  now = new Date(),
  ctime = now,
  mtime = now,
  selection = "",
  content = "",
  frontmatter = {},
  resolveTemplate,
  expandNested,
}) {
  const cleanPath = normPath(targetPath);
  const resolvedTitle = title !== undefined ? String(title) : noteTitleFromPath(cleanPath);
  const appendedAtEnd = [];
  let movedPath = null;

  const tp = {
    file: {
      title: resolvedTitle,
      content: String(content ?? ""),
      tags: [...new Set((String(content ?? "").match(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu) ?? []).map((t) => t.trim()))],
      path(relative = false) {
        return relative ? cleanPath : cleanPath;
      },
      folder(relative = false) {
        return folderFromPath(cleanPath, Boolean(relative));
      },
      creation_date(format = "YYYY-MM-DD HH:mm") {
        return formatMoment(ctime, format);
      },
      last_modified_date(format = "YYYY-MM-DD HH:mm") {
        return formatMoment(mtime, format);
      },
      cursor() {
        return "";
      },
      cursor_append(text) {
        if (text !== undefined && text !== null) appendedAtEnd.push(String(text));
        return "";
      },
      selection() {
        return String(selection ?? "");
      },
      async exists(filepath) {
        return atlas ? atlas.exists(normPath(filepath)) : false;
      },
      find_tfile(filename) {
        const p = normPath(String(filename ?? "").replace(/^\[\[|\]\]$/g, ""));
        const withExt = /\.[a-z0-9]+$/i.test(p) ? p : `${p}.md`;
        return { path: withExt, name: withExt.split("/").pop(), basename: noteTitleFromPath(withExt), extension: "md" };
      },
      async include(linkOrPath) {
        if (!resolveTemplate || !expandNested) return "";
        const raw = String(linkOrPath ?? "").trim().replace(/^\[\[|\]\]$/g, "").split("|")[0].trim();
        const tplPath = await resolveTemplate(raw);
        if (!tplPath) return "";
        return expandNested(tplPath);
      },
      async rename(newTitle) {
        const stem = String(newTitle ?? "").trim().replace(/\.md$/i, "");
        if (!stem) return;
        const dir = folderFromPath(movedPath ?? cleanPath, true);
        movedPath = dir && dir !== "/" ? `${dir}/${stem}.md` : `${stem}.md`;
      },
      async move(newPath) {
        const dest = normPath(newPath);
        if (!dest) return;
        movedPath = /\.md$/i.test(dest) ? dest : `${dest}.md`;
      },
    },
    date: {
      now(format = "YYYY-MM-DD", offset = 0, reference = undefined, reference_format = undefined) {
        const base = reference ? parseReferenceDate(reference, reference_format, now) : now;
        return formatMoment(applyDateOffset(base, offset), format);
      },
      tomorrow(format = "YYYY-MM-DD") {
        return formatMoment(applyDateOffset(now, 1), format);
      },
      yesterday(format = "YYYY-MM-DD") {
        return formatMoment(applyDateOffset(now, -1), format);
      },
      weekday(format = "YYYY-MM-DD", weekday = 0, reference = undefined, reference_format = undefined) {
        const base = reference ? parseReferenceDate(reference, reference_format, now) : new Date(now.getTime());
        const diff = Number(weekday) - base.getDay();
        return formatMoment(applyDateOffset(base, diff), format);
      },
    },
    system: {
      async prompt(promptText = "Enter value", defaultValue = "", throwOnCancel = false) {
        if (!atlas?.input) return defaultValue ?? "";
        const ans = await atlas.input(String(promptText), { value: String(defaultValue ?? "") });
        if (ans === null) {
          if (throwOnCancel) throw new Error("Prompt cancelled");
          return null;
        }
        return ans;
      },
      async suggester(textItems, items, throwOnCancel = false, placeholder = "Choose an option…") {
        const vals = Array.isArray(items) ? items : [];
        if (!atlas?.pick || !vals.length) return vals[0] ?? null;
        return new Promise((resolve, reject) => {
          atlas.pick({
            placeholder: String(placeholder || "Choose an option…"),
            tag: "Templater",
            icon: "file-code",
            items: vals.map((val, idx) => {
              const label = typeof textItems === "function" ? textItems(val, idx) : (Array.isArray(textItems) ? textItems[idx] : val);
              return { value: String(idx), title: String(label ?? val) };
            }),
            onpick: (idxStr) => resolve(vals[Number(idxStr)]),
            oncancel: () => (throwOnCancel ? reject(new Error("Suggester cancelled")) : resolve(null)),
          });
        });
      },
      async clipboard() {
        try { return (await navigator.clipboard?.readText?.()) ?? ""; } catch { return ""; }
      },
    },
    frontmatter: frontmatter && typeof frontmatter === "object" ? { ...frontmatter } : {},
    config: {
      target_file: { path: cleanPath, basename: resolvedTitle },
      active_file: { path: cleanPath, basename: resolvedTitle },
      run_mode: 0,
    },
    obsidian: {},
    user: {},
  };

  return { tp, getAppended: () => appendedAtEnd.join(""), getMovedPath: () => movedPath };
}

const TAG_RE = /<%([_-])?(\*)?([\s\S]*?)([_-])?%>/g;
const CORE_PLACEHOLDER_RE = /\{\{(title|date(?::([^}]+))?|time(?::([^}]+))?)\}\}/g;

/** Compile and run a Templater template string with `tp` and `moment` in scope. */
export async function expandTemplateText(rawTemplate, ctxOpts) {
  const now = ctxOpts.now ?? new Date();
  const { tp, getAppended, getMovedPath } = buildTpContext({ ...ctxOpts, now });
  const moment = makeMomentShim(now);

  // First expand Obsidian Core Templates placeholders: {{title}}, {{date}}, {{date:FMT}}, {{time}}, {{time:FMT}}
  const withCoreVars = String(rawTemplate ?? "").replace(CORE_PLACEHOLDER_RE, (_m, full, dateFmt, timeFmt) => {
    if (full === "title") return tp.file.title;
    if (full.startsWith("date")) return formatMoment(now, dateFmt || "YYYY-MM-DD");
    if (full.startsWith("time")) return formatMoment(now, timeFmt || "HH:mm");
    return _m;
  });

  if (!withCoreVars.includes("<%")) {
    return { text: withCoreVars, movedPath: null };
  }

  // Tokenize into literal chunks and <% ... %> tags with Eta/Templater whitespace control
  const parts = [];
  let cursor = 0;
  let trimNextLeading = null; // "_" (all whitespace) | "-" (single newline)
  TAG_RE.lastIndex = 0;

  for (let m = TAG_RE.exec(withCoreVars); m; m = TAG_RE.exec(withCoreVars)) {
    let chunk = withCoreVars.slice(cursor, m.index);
    if (trimNextLeading === "_") chunk = chunk.replace(/^\s+/, "");
    else if (trimNextLeading === "-") chunk = chunk.replace(/^\r?\n/, "");

    const openTrim = m[1] || null;
    const isExec = m[2] === "*";
    const inner = m[3] ?? "";
    const closeTrim = m[4] || null;

    if (openTrim === "_") chunk = chunk.replace(/\s+$/, "");
    else if (openTrim === "-") chunk = chunk.replace(/[ \t]*\r?\n[ \t]*$|^[ \t]+$/, "");

    if (chunk) parts.push({ kind: "text", value: chunk });
    parts.push({ kind: isExec ? "exec" : "interp", code: inner });

    trimNextLeading = closeTrim;
    cursor = m.index + m[0].length;
  }

  let tail = withCoreVars.slice(cursor);
  if (trimNextLeading === "_") tail = tail.replace(/^\s+/, "");
  else if (trimNextLeading === "-") tail = tail.replace(/^\r?\n/, "");
  if (tail) parts.push({ kind: "text", value: tail });

  const lines = ['let tR = "";'];
  for (const part of parts) {
    if (part.kind === "text") {
      lines.push(`tR += ${JSON.stringify(part.value)};`);
    } else if (part.kind === "exec") {
      lines.push(part.code);
    } else {
      const expr = part.code.trim().replace(/;+\s*$/, "");
      if (expr) {
        lines.push(`{ const __v = (${expr}); if (__v !== undefined && __v !== null) tR += String(__v); }`);
      }
    }
  }
  lines.push("return tR;");

  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  let fn;
  try {
    fn = new AsyncFunction("tp", "moment", lines.join("\n"));
  } catch {
    // Fallback: evaluate each tag individually if a template had unclosed blocks or unusual syntax
    const fallbackText = parts.map((part) => {
      if (part.kind === "text") return part.value;
      try {
        if (part.kind === "exec") {
          const f = new Function("tp", "moment", `let tR = "";\n${part.code}\nreturn tR;`);
          return String(f(tp, moment) ?? "");
        }
        const expr = part.code.trim().replace(/;+\s*$/, "");
        if (!expr) return "";
        const f = new Function("tp", "moment", `return (${expr});`);
        const v = f(tp, moment);
        return v === undefined || v === null ? "" : String(v);
      } catch {
        return "";
      }
    }).join("");
    return { text: fallbackText + getAppended(), movedPath: getMovedPath() };
  }

  const evaluated = await fn(tp, moment);
  return { text: String(evaluated ?? "") + getAppended(), movedPath: getMovedPath() };
}

/** Parse custom "folder=template.md" rules (comma, semicolon, or newline separated). */
export function parseCustomFolderRules(raw) {
  const out = [];
  for (const entry of String(raw ?? "").split(/[;\n,]+/)) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const folder = normPath(trimmed.slice(0, eq).trim());
    const template = normPath(trimmed.slice(eq + 1).trim());
    if (template) out.push({ folder, template, source: "settings" });
  }
  return out;
}

/** Match a vault file path against folder-to-template rules (deepest matching folder prefix wins). */
export function matchFolderRule(notePath, rules, ignoredFolders = []) {
  const clean = normPath(notePath);
  if (!/\.md$/i.test(clean)) return null;
  const noteFolder = clean.includes("/") ? clean.slice(0, clean.lastIndexOf("/")) : "";

  for (const ig of ignoredFolders) {
    const igClean = normPath(ig);
    if (igClean && (noteFolder === igClean || noteFolder.startsWith(`${igClean}/`))) return null;
  }

  let best = null;
  let bestDepth = -2;
  for (const r of rules) {
    const rf = normPath(r.folder);
    const matches = rf === ""
      ? true
      : (noteFolder === rf || noteFolder.startsWith(`${rf}/`));
    if (!matches) continue;
    const depth = rf === "" ? -1 : rf.split("/").length * 1000 + rf.length + (r.source === "settings" ? 1 : 0);
    if (depth > bestDepth) {
      bestDepth = depth;
      best = r;
    }
  }
  return best;
}
