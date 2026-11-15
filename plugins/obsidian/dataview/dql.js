// Dataview Query Language (DQL) parser & evaluator:
// Supports TABLE [WITHOUT ID], LIST [WITHOUT ID], and TASK queries with FROM ("folder", #tag, [[Link]], AND, OR, !/-),
// WHERE expressions & functions (default, choice, contains, lower, length, dateformat, ...),
// FLATTEN, GROUP BY, SORT (ASC/DESC, multi-key, date-aware), and LIMIT.

import { formatDateTokens, makeDvDate, makeDvLink, normPath, parseDateMs } from "./index.js";

// --- Value truthiness & comparison ----------------------------------------------------------------------

export function dvTruthy(val) {
  if (val === null || val === undefined || val === false || val === "" || Number.isNaN(val)) return false;
  if (Array.isArray(val)) return val.length > 0;
  return true;
}

function comparableScalar(v) {
  if (v === null || v === undefined) return { kind: "null", v: null };
  if (typeof v === "boolean") return { kind: "bool", v: v ? 1 : 0 };
  if (typeof v === "number") return { kind: "num", v };
  if (typeof v === "object") {
    if (v.__dvDate) return { kind: "date", v: v.ts };
    if (v.__dvLink) return { kind: "str", v: (v.display ?? v.fileName()).toLowerCase(), linkPath: normPath(v.path).toLowerCase() };
    if (v instanceof Date) return { kind: "date", v: v.getTime() };
  }
  const str = String(v);
  const dateMs = parseDateMs(str);
  if (dateMs !== null) return { kind: "date", v: dateMs, raw: str };
  return { kind: "str", v: str };
}

export function dvCompare(a, b) {
  const ca = comparableScalar(a);
  const cb = comparableScalar(b);
  if (ca.kind === "null" && cb.kind === "null") return 0;
  if (ca.kind === "null") return -1;
  if (cb.kind === "null") return 1;
  if (ca.kind === "date" && cb.kind === "date") return ca.v - cb.v;
  if (ca.kind === "num" && cb.kind === "num") return ca.v - cb.v;
  if (ca.kind === "bool" && cb.kind === "bool") return ca.v - cb.v;
  return String(ca.raw ?? ca.v).localeCompare(String(cb.raw ?? cb.v), undefined, { numeric: true, sensitivity: "base" });
}

export function dvEqual(a, b) {
  if (a === b) return true;
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a === "object" && a.__dvLink && typeof b === "object" && b.__dvLink) {
    return normPath(a.path).replace(/\.md$/i, "").toLowerCase() === normPath(b.path).replace(/\.md$/i, "").toLowerCase();
  }
  if ((typeof a === "object" && a.__dvLink) || (typeof b === "object" && b.__dvLink)) {
    const lp = typeof a === "object" && a.__dvLink ? a : b;
    const other = String(lp === a ? b : a).replace(/^\[\[|\]\]$/g, "").replace(/\.md$/i, "").toLowerCase();
    return normPath(lp.path).replace(/\.md$/i, "").toLowerCase() === other || lp.fileName().toLowerCase() === other;
  }
  const ca = comparableScalar(a);
  const cb = comparableScalar(b);
  if (ca.kind === "date" && cb.kind === "date") return ca.v === cb.v;
  if (ca.kind === "num" && cb.kind === "num") return ca.v === cb.v;
  if (ca.kind === "bool" && cb.kind === "bool") return ca.v === cb.v;
  if (ca.kind === "str" && cb.kind === "str") return String(a) === String(b);
  return false;
}

function dvContains(haystack, needle, caseInsensitive = false, exact = false) {
  if (haystack === null || haystack === undefined) return false;
  const normStr = (x) => (caseInsensitive ? String(x).toLowerCase() : String(x));
  if (Array.isArray(haystack)) {
    const wantTag = typeof needle === "string" && needle.startsWith("#") ? needle.toLowerCase() : null;
    return haystack.some((item) => {
      if (wantTag && typeof item === "string") {
        const it = item.startsWith("#") ? item.toLowerCase() : `#${item.toLowerCase()}`;
        return exact ? it === wantTag : (it === wantTag || it.startsWith(`${wantTag}/`));
      }
      if (dvEqual(item, needle)) return true;
      if (!exact && typeof item === "string" && typeof needle === "string") {
        return normStr(item).includes(normStr(needle));
      }
      return false;
    });
  }
  if (typeof haystack === "string") {
    return normStr(haystack).includes(normStr(needle ?? ""));
  }
  if (typeof haystack === "object" && !haystack.__dvDate && !haystack.__dvLink) {
    return Object.prototype.hasOwnProperty.call(haystack, String(needle));
  }
  return dvEqual(haystack, needle);
}

// --- FROM source parser & evaluator (shared by DQL `FROM` and `dv.pages(source)`) -----------------------

function tokenizeSource(src) {
  const tokens = [];
  let i = 0;
  const s = String(src ?? "").trim();
  while (i < s.length) {
    if (/\s/.test(s[i])) { i++; continue; }
    if (s[i] === "(" || s[i] === ")") { tokens.push({ type: s[i] }); i++; continue; }
    if (s[i] === "!" || (s[i] === "-" && (i === 0 || /[\s(]/.test(s[i - 1])))) {
      tokens.push({ type: "NOT" }); i++; continue;
    }
    if (s[i] === "&" && s[i + 1] === "&") { tokens.push({ type: "AND" }); i += 2; continue; }
    if (s[i] === "|" && s[i + 1] === "|") { tokens.push({ type: "OR" }); i += 2; continue; }
    if (s[i] === '"' || s[i] === "'") {
      const q = s[i++];
      let val = "";
      while (i < s.length && s[i] !== q) {
        if (s[i] === "\\" && i + 1 < s.length) val += s[++i];
        else val += s[i];
        i++;
      }
      i++;
      tokens.push({ type: "FOLDER", value: normPath(val) });
      continue;
    }
    if (s[i] === "#") {
      let end = i + 1;
      while (end < s.length && /[\p{L}\p{N}_/-]/u.test(s[end])) end++;
      tokens.push({ type: "TAG", value: s.slice(i, end).toLowerCase() });
      i = end;
      continue;
    }
    if (s.slice(i, i + 2) === "[[") {
      const close = s.indexOf("]]", i + 2);
      const inner = close >= 0 ? s.slice(i + 2, close) : s.slice(i + 2);
      i = close >= 0 ? close + 2 : s.length;
      tokens.push({ type: "LINK", value: inner.split("|")[0].split("#")[0].trim(), outgoing: false });
      continue;
    }
    let end = i;
    while (end < s.length && !/[\s()]/.test(s[end])) end++;
    const word = s.slice(i, end);
    const upper = word.toUpperCase();
    if (upper === "AND") { tokens.push({ type: "AND" }); i = end; continue; }
    if (upper === "OR" || word === ",") { tokens.push({ type: "OR" }); i = end; continue; }
    if (upper.startsWith("OUTGOING(") && s.slice(i).includes(")")) {
      const closeParen = s.indexOf(")", i);
      const arg = s.slice(i + 9, closeParen).trim().replace(/^\[\[|\]\]$/g, "").split("|")[0].trim();
      tokens.push({ type: "LINK", value: arg, outgoing: true });
      i = closeParen + 1;
      continue;
    }
    tokens.push({ type: "FOLDER", value: normPath(word) });
    i = end;
  }
  return tokens;
}

export function filterPagesBySource(pages, sourceStr, currentPagePath, index) {
  const s = String(sourceStr ?? "").trim();
  if (!s) return pages;
  const tokens = tokenizeSource(s);
  if (!tokens.length) return pages;

  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseOr() {
    let left = parseAnd();
    while (peek()?.type === "OR") {
      next();
      const right = parseAnd();
      const prev = left;
      left = (p) => prev(p) || right(p);
    }
    return left;
  }

  function parseAnd() {
    let left = parseUnary();
    while (peek()?.type === "AND") {
      next();
      const right = parseUnary();
      const prev = left;
      left = (p) => prev(p) && right(p);
    }
    return left;
  }

  function parseUnary() {
    if (peek()?.type === "NOT") {
      next();
      const inner = parseUnary();
      return (p) => !inner(p);
    }
    if (peek()?.type === "(") {
      next();
      const expr = parseOr();
      if (peek()?.type === ")") next();
      return expr;
    }
    const tok = next();
    if (!tok) return () => true;

    if (tok.type === "TAG") {
      const want = tok.value.startsWith("#") ? tok.value : `#${tok.value}`;
      return (p) => (p.file?.tags ?? []).some((t) => {
        const low = t.toLowerCase();
        return low === want || low.startsWith(`${want}/`);
      });
    }
    if (tok.type === "FOLDER") {
      const folder = tok.value;
      if (!folder || folder === "/") return () => true;
      const lowFolder = folder.toLowerCase();
      return (p) => {
        const pf = (p.file?.folder ?? "").toLowerCase();
        const pp = (p.file?.path ?? "").toLowerCase();
        return pf === lowFolder || pf.startsWith(`${lowFolder}/`) || pp === lowFolder || pp === `${lowFolder}.md`;
      };
    }
    if (tok.type === "LINK") {
      const targetPath = (index?.resolvePath(tok.value, currentPagePath) ?? normPath(tok.value)).toLowerCase();
      if (tok.outgoing) {
        const srcPage = index?.getPage(tok.value, currentPagePath);
        const outSet = new Set((srcPage?.file?.outlinks ?? []).map((l) => normPath(l.path).toLowerCase()));
        return (p) => outSet.has(normPath(p.file?.path).toLowerCase());
      }
      return (p) => (p.file?.outlinks ?? []).some((l) => normPath(l.path).toLowerCase() === targetPath);
    }
    return () => true;
  }

  const pred = parseOr();
  return pages.filter(pred);
}

// --- DQL Expression Tokenizer & Recursive-Descent Parser ------------------------------------------------

function tokenizeExpr(src) {
  const tokens = [];
  const s = String(src ?? "");
  let i = 0;

  while (i < s.length) {
    if (/\s/.test(s[i])) { i++; continue; }
    const two = s.slice(i, i + 2);
    if (two === "[[") {
      const end = s.indexOf("]]", i + 2);
      const raw = end >= 0 ? s.slice(i + 2, end) : s.slice(i + 2);
      i = end >= 0 ? end + 2 : s.length;
      const [targetPart, alias] = raw.split("|");
      const [filePart, sub] = (targetPart ?? "").split("#");
      tokens.push({ t: "LINK", path: (filePart ?? "").trim(), alias: alias?.trim(), sub: sub?.trim() });
      continue;
    }
    if (two === "&&") { tokens.push({ t: "OP", v: "AND" }); i += 2; continue; }
    if (two === "||") { tokens.push({ t: "OP", v: "OR" }); i += 2; continue; }
    if (two === "!=" || two === "<=" || two === ">=" || two === "==") {
      tokens.push({ t: "OP", v: two === "==" ? "=" : two });
      i += 2;
      continue;
    }
    if ("=<>+-*/%!".includes(s[i])) {
      tokens.push({ t: "OP", v: s[i] });
      i++;
      continue;
    }
    if ("()[],.".includes(s[i])) {
      tokens.push({ t: s[i] });
      i++;
      continue;
    }
    if (s[i] === '"' || s[i] === "'") {
      const q = s[i++];
      let str = "";
      while (i < s.length && s[i] !== q) {
        if (s[i] === "\\" && i + 1 < s.length) {
          const esc = s[++i];
          str += esc === "n" ? "\n" : esc === "t" ? "\t" : esc;
        } else {
          str += s[i];
        }
        i++;
      }
      i++;
      tokens.push({ t: "STR", v: str });
      continue;
    }
    if (/\d/.test(s[i])) {
      let end = i;
      while (end < s.length && /[\d.]/.test(s[end])) end++;
      tokens.push({ t: "NUM", v: Number(s.slice(i, end)) });
      i = end;
      continue;
    }
    if (/[\p{L}_$#]/u.test(s[i])) {
      let end = i;
      while (end < s.length && /[\p{L}\p{N}_$-]/u.test(s[end])) {
        // Stop before ` - ` subtraction, allow hyphen inside identifier when followed by letter/underscore (e.g. folder-note)
        if (s[end] === "-" && !/[\p{L}_]/u.test(s[end + 1] ?? "")) break;
        end++;
      }
      const word = s.slice(i, end);
      const upper = word.toUpperCase();
      if (upper === "AND" || upper === "OR") tokens.push({ t: "OP", v: upper });
      else if (word === "true") tokens.push({ t: "BOOL", v: true });
      else if (word === "false") tokens.push({ t: "BOOL", v: false });
      else if (word === "null") tokens.push({ t: "NULL", v: null });
      else tokens.push({ t: "ID", v: word });
      i = end;
      continue;
    }
    i++;
  }
  return tokens;
}

export function compileExpr(exprSrc) {
  const tokens = tokenizeExpr(exprSrc);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseOr() {
    let node = parseAnd();
    while (peek()?.t === "OP" && peek().v === "OR") {
      next();
      const right = parseAnd();
      node = { k: "or", a: node, b: right };
    }
    return node;
  }

  function parseAnd() {
    let node = parseCmp();
    while (peek()?.t === "OP" && peek().v === "AND") {
      next();
      const right = parseCmp();
      node = { k: "and", a: node, b: right };
    }
    return node;
  }

  function parseCmp() {
    let node = parseAdd();
    while (peek()?.t === "OP" && ["=", "!=", "<", "<=", ">", ">="].includes(peek().v)) {
      const op = next().v;
      const right = parseAdd();
      node = { k: "cmp", op, a: node, b: right };
    }
    return node;
  }

  function parseAdd() {
    let node = parseMul();
    while (peek()?.t === "OP" && (peek().v === "+" || peek().v === "-")) {
      const op = next().v;
      const right = parseMul();
      node = { k: "bin", op, a: node, b: right };
    }
    return node;
  }

  function parseMul() {
    let node = parseUnary();
    while (peek()?.t === "OP" && ["*", "/", "%"].includes(peek().v)) {
      const op = next().v;
      const right = parseUnary();
      node = { k: "bin", op, a: node, b: right };
    }
    return node;
  }

  function parseUnary() {
    if (peek()?.t === "OP" && (peek().v === "!" || peek().v === "-" || peek().v === "+")) {
      const op = next().v;
      return { k: "un", op, a: parseUnary() };
    }
    return parsePostfix();
  }

  function parsePostfix() {
    let node = parsePrimary();
    while (peek()) {
      if (peek().t === ".") {
        next();
        const prop = next();
        if (prop) node = { k: "prop", obj: node, name: String(prop.v ?? prop.t) };
      } else if (peek().t === "[") {
        next();
        const idx = parseOr();
        if (peek()?.t === "]") next();
        node = { k: "idx", obj: node, idx };
      } else {
        break;
      }
    }
    return node;
  }

  function parsePrimary() {
    const tok = next();
    if (!tok) return { k: "lit", v: null };
    if (tok.t === "STR" || tok.t === "NUM" || tok.t === "BOOL" || tok.t === "NULL") return { k: "lit", v: tok.v };
    if (tok.t === "LINK") return { k: "link", path: tok.path, alias: tok.alias, sub: tok.sub };
    if (tok.t === "(") {
      const inner = parseOr();
      if (peek()?.t === ")") next();
      return inner;
    }
    if (tok.t === "[") {
      const items = [];
      while (peek() && peek().t !== "]") {
        items.push(parseOr());
        if (peek()?.t === ",") next();
      }
      if (peek()?.t === "]") next();
      return { k: "arr", items };
    }
    if (tok.t === "ID") {
      if (peek()?.t === "(") {
        next();
        const args = [];
        // Special bare keywords inside date(today), date(now), dur(7 days)
        if ((tok.v.toLowerCase() === "date" || tok.v.toLowerCase() === "dur") && peek()?.t === "ID" && tokens[pos + 1]?.t === ")") {
          args.push({ k: "lit", v: next().v });
        } else {
          while (peek() && peek().t !== ")") {
            args.push(parseOr());
            if (peek()?.t === ",") next();
          }
        }
        if (peek()?.t === ")") next();
        return { k: "call", name: tok.v.toLowerCase(), args };
      }
      return { k: "id", name: tok.v };
    }
    return { k: "lit", v: null };
  }

  return parseOr();
}

function getField(obj, key) {
  if (obj === null || obj === undefined) return null;
  // Dataview implicit array projection (`rows.file.link`)
  if (Array.isArray(obj)) {
    if (key === "length") return obj.length;
    return obj.map((item) => getField(item, key));
  }
  if (typeof obj !== "object") return null;
  if (key in obj) return obj[key];
  const low = key.toLowerCase();
  if (low in obj) return obj[low];
  const snake = low.replace(/-/g, "_");
  if (snake in obj) return obj[snake];
  return null;
}

function evalDurationMs(arg) {
  if (typeof arg === "number") return arg;
  const s = String(arg ?? "").trim();
  const m = /^([+-]?\d+(?:\.\d+)?)\s*(ms|s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|month|months|y|yr|yrs|year|years)$/i.exec(s);
  if (!m) return 0;
  const n = Number(m[1]), u = m[2].toLowerCase();
  if (u === "ms") return n;
  if (u.startsWith("s")) return n * 1000;
  if (u === "m" || u.startsWith("min")) return n * 60000;
  if (u.startsWith("h")) return n * 3600000;
  if (u.startsWith("d")) return n * 86400000;
  if (u.startsWith("w")) return n * 7 * 86400000;
  if (u.startsWith("mo")) return n * 30 * 86400000;
  if (u.startsWith("y")) return n * 365 * 86400000;
  return 0;
}

export function evalAst(node, scope, ctx) {
  if (!node) return null;
  switch (node.k) {
    case "lit": return node.v;
    case "link": {
      const resolved = ctx.index?.resolvePath(node.path, ctx.currentPath) ?? node.path;
      return makeDvLink(resolved, node.alias, false, node.sub);
    }
    case "arr": return node.items.map((it) => evalAst(it, scope, ctx));
    case "id": {
      if (node.name === "this") return ctx.currentPage ?? {};
      if (node.name === "row") return scope;
      return getField(scope, node.name);
    }
    case "prop": return getField(evalAst(node.obj, scope, ctx), node.name);
    case "idx": {
      const target = evalAst(node.obj, scope, ctx);
      const idx = evalAst(node.idx, scope, ctx);
      if (Array.isArray(target) && typeof idx === "number") return target[idx < 0 ? target.length + idx : idx] ?? null;
      return getField(target, String(idx));
    }
    case "un": {
      const v = evalAst(node.a, scope, ctx);
      if (node.op === "!") return !dvTruthy(v);
      if (node.op === "-") return -(Number(v) || 0);
      return Number(v) || 0;
    }
    case "and": return dvTruthy(evalAst(node.a, scope, ctx)) && dvTruthy(evalAst(node.b, scope, ctx));
    case "or": return dvTruthy(evalAst(node.a, scope, ctx)) || dvTruthy(evalAst(node.b, scope, ctx));
    case "cmp": {
      const a = evalAst(node.a, scope, ctx);
      const b = evalAst(node.b, scope, ctx);
      if (node.op === "=") return dvEqual(a, b);
      if (node.op === "!=") return !dvEqual(a, b);
      if (a === null || a === undefined || b === null || b === undefined) return false;
      const c = dvCompare(a, b);
      if (node.op === "<") return c < 0;
      if (node.op === "<=") return c <= 0;
      if (node.op === ">") return c > 0;
      if (node.op === ">=") return c >= 0;
      return false;
    }
    case "bin": {
      const a = evalAst(node.a, scope, ctx);
      const b = evalAst(node.b, scope, ctx);
      if (node.op === "+") {
        if (typeof a === "object" && a?.__dvDate && typeof b === "number") return makeDvDate(a.ts + b, ctx.getDefaultFmt);
        if (typeof a === "string" || typeof b === "string") return `${a ?? ""}${b ?? ""}`;
        return (Number(a) || 0) + (Number(b) || 0);
      }
      if (node.op === "-") {
        if (typeof a === "object" && a?.__dvDate && typeof b === "number") return makeDvDate(a.ts - b, ctx.getDefaultFmt);
        if (typeof a === "object" && a?.__dvDate && typeof b === "object" && b?.__dvDate) return a.ts - b.ts;
        return (Number(a) || 0) - (Number(b) || 0);
      }
      if (node.op === "*") return (Number(a) || 0) * (Number(b) || 0);
      if (node.op === "/") return Number(b) ? (Number(a) || 0) / Number(b) : null;
      if (node.op === "%") return Number(b) ? (Number(a) || 0) % Number(b) : null;
      return null;
    }
    case "call": return evalFunction(node.name, node.args, scope, ctx);
    default: return null;
  }
}

function evalFunction(name, argNodes, scope, ctx) {
  // Short-circuit functions first
  if (name === "default") {
    const a = evalAst(argNodes[0], scope, ctx);
    return a !== null && a !== undefined && a !== "" ? a : evalAst(argNodes[1], scope, ctx);
  }
  if (name === "choice") {
    return dvTruthy(evalAst(argNodes[0], scope, ctx))
      ? evalAst(argNodes[1], scope, ctx)
      : evalAst(argNodes[2], scope, ctx);
  }

  const args = argNodes.map((n) => evalAst(n, scope, ctx));
  switch (name) {
    case "contains": return dvContains(args[0], args[1], false, false);
    case "icontains": return dvContains(args[0], args[1], true, false);
    case "econtains": return dvContains(args[0], args[1], false, true);
    case "startswith": return String(args[0] ?? "").startsWith(String(args[1] ?? ""));
    case "endswith": return String(args[0] ?? "").endsWith(String(args[1] ?? ""));
    case "lower": return String(args[0] ?? "").toLowerCase();
    case "upper": return String(args[0] ?? "").toUpperCase();
    case "length": {
      const v = args[0];
      if (v === null || v === undefined) return 0;
      if (Array.isArray(v) || typeof v === "string") return v.length;
      if (typeof v === "object") return Object.keys(v).length;
      return 0;
    }
    case "join": return Array.isArray(args[0]) ? args[0].join(args[1] === undefined ? ", " : String(args[1])) : String(args[0] ?? "");
    case "split": return String(args[0] ?? "").split(String(args[1] ?? ","));
    case "replace": return String(args[0] ?? "").split(String(args[1] ?? "")).join(String(args[2] ?? ""));
    case "regexmatch": {
      try { return new RegExp(String(args[0] ?? "")).test(String(args[1] ?? "")); } catch { return false; }
    }
    case "regexreplace": {
      try { return String(args[0] ?? "").replace(new RegExp(String(args[1] ?? ""), "g"), String(args[2] ?? "")); } catch { return String(args[0] ?? ""); }
    }
    case "truncate": {
      const s = String(args[0] ?? ""), lim = Number(args[1] ?? 50), suf = args[2] === undefined ? "..." : String(args[2]);
      return s.length <= lim ? s : s.slice(0, Math.max(0, lim - suf.length)) + suf;
    }
    case "round": {
      const n = Number(args[0] ?? 0), digits = Number(args[1] ?? 0);
      const p = 10 ** digits;
      return Math.round(n * p) / p;
    }
    case "floor": return Math.floor(Number(args[0] ?? 0));
    case "ceil": return Math.ceil(Number(args[0] ?? 0));
    case "sum": {
      const arr = Array.isArray(args[0]) ? args[0] : args;
      return arr.reduce((acc, x) => acc + (Number(x) || 0), 0);
    }
    case "average": {
      const arr = (Array.isArray(args[0]) ? args[0] : args).filter((x) => x !== null && x !== undefined);
      return arr.length ? arr.reduce((acc, x) => acc + (Number(x) || 0), 0) / arr.length : null;
    }
    case "min": {
      const arr = (Array.isArray(args[0]) ? args[0] : args).filter((x) => x !== null && x !== undefined);
      return arr.length ? arr.reduce((best, x) => (dvCompare(x, best) < 0 ? x : best)) : null;
    }
    case "max": {
      const arr = (Array.isArray(args[0]) ? args[0] : args).filter((x) => x !== null && x !== undefined);
      return arr.length ? arr.reduce((best, x) => (dvCompare(x, best) > 0 ? x : best)) : null;
    }
    case "nonnull": return (Array.isArray(args[0]) ? args[0] : args).filter((x) => x !== null && x !== undefined);
    case "isnull": return args[0] === null || args[0] === undefined;
    case "list": return args;
    case "link": {
      const p = args[0] && typeof args[0] === "object" && args[0].__dvLink ? args[0].path : String(args[0] ?? "");
      const resolved = ctx.index?.resolvePath(p, ctx.currentPath) ?? p;
      return makeDvLink(resolved, args[1]);
    }
    case "elink": return { __dvExternalLink: true, url: String(args[0] ?? ""), display: args[1] ? String(args[1]) : String(args[0] ?? "") };
    case "date": {
      const v = args[0];
      const now = new Date();
      if (typeof v === "string") {
        const kw = v.trim().toLowerCase();
        if (kw === "now") return makeDvDate(now.getTime(), ctx.getDefaultFmt);
        if (kw === "today") { now.setHours(0, 0, 0, 0); return makeDvDate(now.getTime(), ctx.getDefaultFmt); }
        if (kw === "tomorrow") { now.setDate(now.getDate() + 1); now.setHours(0, 0, 0, 0); return makeDvDate(now.getTime(), ctx.getDefaultFmt); }
        if (kw === "yesterday") { now.setDate(now.getDate() - 1); now.setHours(0, 0, 0, 0); return makeDvDate(now.getTime(), ctx.getDefaultFmt); }
      }
      if (v && typeof v === "object" && v.__dvLink) {
        const linked = ctx.index?.getPage(v.path, ctx.currentPath);
        return linked?.file?.day ?? null;
      }
      const ms = parseDateMs(v);
      return ms !== null ? makeDvDate(ms, ctx.getDefaultFmt) : null;
    }
    case "dur": return evalDurationMs(args[0]);
    case "dateformat": {
      const ms = parseDateMs(args[0]);
      return ms !== null ? formatDateTokens(ms, String(args[1] || "YYYY-MM-DD")) : "";
    }
    case "striptime": {
      const ms = parseDateMs(args[0]);
      if (ms === null) return null;
      const d = new Date(ms);
      d.setHours(0, 0, 0, 0);
      return makeDvDate(d.getTime(), ctx.getDefaultFmt);
    }
    case "meta": {
      const l = args[0];
      if (l && typeof l === "object" && l.__dvLink) {
        return { path: l.path, display: l.display ?? null, subpath: l.subpath || null, embed: l.embed, type: l.type };
      }
      return {};
    }
    case "typeof": {
      const v = args[0];
      if (v === null || v === undefined) return "null";
      if (Array.isArray(v)) return "array";
      if (typeof v === "object" && v.__dvLink) return "link";
      if (typeof v === "object" && v.__dvDate) return "date";
      return typeof v;
    }
    default: return null;
  }
}

// --- Top-level DQL Query Parser & Runner ----------------------------------------------------------------

function splitTopLevelCommas(str) {
  const parts = [];
  let cur = "", quote = null, paren = 0, bracket = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (quote) {
      cur += c;
      if (c === quote && str[i - 1] !== "\\") quote = null;
    } else if (c === '"' || c === "'") {
      quote = c; cur += c;
    } else if (c === "(") { paren++; cur += c; }
    else if (c === ")") { paren = Math.max(0, paren - 1); cur += c; }
    else if (c === "[") { bracket++; cur += c; }
    else if (c === "]") { bracket = Math.max(0, bracket - 1); cur += c; }
    else if (c === "," && paren === 0 && bracket === 0) {
      if (cur.trim()) parts.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function splitExprAlias(raw) {
  // Match trailing `AS "Label"` or `AS Label` outside parentheses/quotes
  let quote = null, paren = 0, bracket = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quote) { if (c === quote && raw[i - 1] !== "\\") quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "(") { paren++; continue; }
    if (c === ")") { paren = Math.max(0, paren - 1); continue; }
    if (c === "[") { bracket++; continue; }
    if (c === "]") { bracket = Math.max(0, bracket - 1); continue; }
    if (paren === 0 && bracket === 0 && /^\s+AS\s+/i.test(raw.slice(i))) {
      const m = /^\s+AS\s+([\s\S]+)$/i.exec(raw.slice(i));
      if (m) {
        const expr = raw.slice(0, i).trim();
        let label = m[1].trim();
        if ((label.startsWith('"') && label.endsWith('"')) || (label.startsWith("'") && label.endsWith("'"))) {
          label = label.slice(1, -1);
        }
        return { expr, label };
      }
    }
  }
  return { expr: raw.trim(), label: raw.trim() };
}

const CLAUSE_START_RE = /^(FROM|WHERE|SORT|LIMIT|FLATTEN|GROUP\s+BY)\b/i;

function splitDqlClauses(source) {
  const joined = String(source ?? "")
    .split(/\r?\n/)
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n")
    .trim();
  if (!joined) return [];

  const clauses = [];
  let start = 0;
  let quote = null, paren = 0, bracket = 0;

  for (let i = 0; i < joined.length; i++) {
    const c = joined[i];
    if (quote) {
      if (c === quote && joined[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "(") { paren++; continue; }
    if (c === ")") { paren = Math.max(0, paren - 1); continue; }
    if (c === "[") { bracket++; continue; }
    if (c === "]") { bracket = Math.max(0, bracket - 1); continue; }

    if (i > 0 && paren === 0 && bracket === 0 && /\s/.test(joined[i - 1]) && CLAUSE_START_RE.test(joined.slice(i))) {
      const seg = joined.slice(start, i).trim();
      if (seg) clauses.push(seg);
      start = i;
    }
  }
  const last = joined.slice(start).trim();
  if (last) clauses.push(last);
  return clauses;
}

export function parseDqlQuery(source) {
  const clauses = splitDqlClauses(source);
  if (!clauses.length) throw new Error("Empty Dataview query");

  const head = clauses[0].replace(/\s*\r?\n\s*/g, " ").trim();
  let mode = "TABLE";
  let withoutId = false;
  let restHead = "";

  const mTable = /^TABLE(?:\s+(WITHOUT\s+ID))?(?:\s+([\s\S]*))?$/i.exec(head);
  const mList = !mTable && /^LIST(?:\s+(WITHOUT\s+ID))?(?:\s+([\s\S]*))?$/i.exec(head);
  const mTask = !mTable && !mList && /^TASK(?:\s+([\s\S]*))?$/i.exec(head);

  if (mTable) {
    mode = "TABLE";
    withoutId = Boolean(mTable[1]);
    restHead = (mTable[2] ?? "").trim();
  } else if (mList) {
    mode = "LIST";
    withoutId = Boolean(mList[1]);
    restHead = (mList[2] ?? "").trim();
  } else if (mTask) {
    mode = "TASK";
    restHead = (mTask[1] ?? "").trim();
  } else {
    throw new Error(`Unsupported query type in "${head.slice(0, 40)}" (expected TABLE, LIST, or TASK)`);
  }

  const columns = mode === "TABLE" && restHead
    ? splitTopLevelCommas(restHead).map((c) => {
        const { expr, label } = splitExprAlias(c);
        return { expr, label, ast: compileExpr(expr) };
      })
    : [];

  const listExpr = mode === "LIST" && restHead ? compileExpr(restHead) : null;

  let fromSource = "";
  const steps = [];
  let limit = null;

  for (let i = 1; i < clauses.length; i++) {
    const cl = clauses[i];
    let m;
    if ((m = /^FROM\s+([\s\S]+)$/i.exec(cl))) {
      fromSource = m[1].trim();
    } else if ((m = /^WHERE\s+([\s\S]+)$/i.exec(cl))) {
      steps.push({ kind: "where", ast: compileExpr(m[1].trim()) });
    } else if ((m = /^FLATTEN\s+([\s\S]+)$/i.exec(cl))) {
      const { expr, label } = splitExprAlias(m[1].trim());
      steps.push({ kind: "flatten", ast: compileExpr(expr), as: label });
    } else if ((m = /^GROUP\s+BY\s+([\s\S]+)$/i.exec(cl))) {
      const { expr, label } = splitExprAlias(m[1].trim());
      steps.push({ kind: "group", ast: compileExpr(expr), as: label !== expr ? label : "key" });
    } else if ((m = /^SORT\s+([\s\S]+)$/i.exec(cl))) {
      const keys = splitTopLevelCommas(m[1]).map((k) => {
        const sm = /^([\s\S]+?)(?:\s+(ASC|ASCENDING|DESC|DESCENDING))?$/i.exec(k.trim());
        const dir = sm?.[2] && /^DESC/i.test(sm[2]) ? "desc" : "asc";
        return { ast: compileExpr(sm ? sm[1].trim() : k.trim()), dir };
      });
      steps.push({ kind: "sort", keys });
    } else if ((m = /^LIMIT\s+(\d+)\s*$/i.exec(cl))) {
      limit = Number(m[1]);
    }
  }

  return { mode, withoutId, columns, listExpr, fromSource, steps, limit };
}

export function executeDql(source, { index, currentPath = "", getDefaultFmt = () => "YYYY-MM-DD", maxRows = 500 }) {
  const q = parseDqlQuery(source);
  const currentPage = currentPath ? index.getPage(currentPath) : undefined;
  const ctx = { index, currentPath, currentPage, getDefaultFmt };

  const matchedPages = filterPagesBySource(index.allPages(), q.fromSource, currentPath, index);

  if (q.mode === "TASK") {
    let tasks = [];
    for (const page of matchedPages) {
      for (const t of page.file.tasks) {
        tasks.push({ ...page, ...t, file: page.file });
      }
    }
    for (const step of q.steps) {
      if (step.kind === "where") {
        tasks = tasks.filter((row) => dvTruthy(evalAst(step.ast, row, ctx)));
      } else if (step.kind === "sort") {
        tasks.sort((a, b) => {
          for (const k of step.keys) {
            const cmp = dvCompare(evalAst(k.ast, a, ctx), evalAst(k.ast, b, ctx));
            if (cmp !== 0) return k.dir === "desc" ? -cmp : cmp;
          }
          return 0;
        });
      }
    }
    const cap = q.limit ?? maxRows;
    return { mode: "TASK", tasks: tasks.slice(0, cap), totalCount: tasks.length };
  }

  let rows = matchedPages.map((p) => ({ ...p, __idLink: p.file.link }));
  let grouped = false;

  for (const step of q.steps) {
    if (step.kind === "where") {
      rows = rows.filter((r) => dvTruthy(evalAst(step.ast, r, ctx)));
    } else if (step.kind === "flatten") {
      const nextRows = [];
      for (const r of rows) {
        const val = evalAst(step.ast, r, ctx);
        const items = Array.isArray(val) ? val : (val !== null && val !== undefined ? [val] : []);
        for (const item of items) {
          nextRows.push({ ...r, [step.as]: item });
        }
      }
      rows = nextRows;
    } else if (step.kind === "group") {
      grouped = true;
      const groups = new Map();
      for (const r of rows) {
        const keyVal = evalAst(step.ast, r, ctx);
        const mapKey = keyVal && typeof keyVal === "object" ? String(keyVal) : JSON.stringify(keyVal ?? null);
        if (!groups.has(mapKey)) groups.set(mapKey, { key: keyVal, [step.as]: keyVal, rows: [], __idLink: keyVal });
        groups.get(mapKey).rows.push(r);
      }
      rows = [...groups.values()];
    } else if (step.kind === "sort") {
      rows.sort((a, b) => {
        for (const k of step.keys) {
          const va = evalAst(k.ast, a, ctx);
          const vb = evalAst(k.ast, b, ctx);
          // Always sort null/undefined last regardless of ASC/DESC, matching Dataview UX
          if ((va === null || va === undefined) && (vb === null || vb === undefined)) continue;
          if (va === null || va === undefined) return 1;
          if (vb === null || vb === undefined) return -1;
          const cmp = dvCompare(va, vb);
          if (cmp !== 0) return k.dir === "desc" ? -cmp : cmp;
        }
        return 0;
      });
    }
  }

  const totalCount = rows.length;
  const cap = q.limit ?? maxRows;
  const sliced = rows.slice(0, cap);

  if (q.mode === "LIST") {
    const items = sliced.map((r) => ({
      idVal: q.withoutId ? null : r.__idLink,
      extraVal: q.listExpr ? evalAst(q.listExpr, r, ctx) : (grouped && q.withoutId ? r.rows : null),
    }));
    return { mode: "LIST", withoutId: q.withoutId, items, totalCount };
  }

  // TABLE
  const headers = [];
  if (!q.withoutId) headers.push(grouped ? "Group" : `File (${totalCount})`);
  for (const col of q.columns) headers.push(col.label);

  const tableRows = sliced.map((r) => {
    const cells = [];
    if (!q.withoutId) cells.push(r.__idLink);
    for (const col of q.columns) cells.push(evalAst(col.ast, r, ctx));
    return cells;
  });

  return { mode: "TABLE", headers, rows: tableRows, totalCount };
}
