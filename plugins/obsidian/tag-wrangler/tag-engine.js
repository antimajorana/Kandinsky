// Tag Wrangler & Tactician — vault tag scanner, hierarchical tree builder, and surgical tag rewriter.

const TAG_CHAR = /[\p{L}\p{N}_\-/]/u;
const VALID_TAG = /^(?=.*[^\d/])[\p{L}\p{N}_\-]+(?:\/[\p{L}\p{N}_\-]+)*$/u;
const FRONTMATTER_RE = /^---(\r?\n)([\s\S]*?)\r?\n---(\r?\n|$)/;
const HEADING_RE = /^\s*#{1,6}(?:\s|$)/;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;

/** Normalize raw tag string (strips leading #, quotes, whitespace, duplicate slashes); "" if invalid. */
export function normalizeTag(raw) {
  if (typeof raw !== "string") return "";
  const cleaned = raw
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .trim()
    .replace(/^#+/, "")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
  return VALID_TAG.test(cleaned) ? cleaned : "";
}

/** Parse YAML scalar/inline list items from a frontmatter value string. */
function parseInlineTagList(val) {
  const trimmed = val.trim();
  if (!trimmed || trimmed === "[]" || trimmed === "~" || trimmed === "null") return [];
  const inner = trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
  // Split by comma if commas exist, else by whitespace (matches Obsidian frontmatter rules)
  const parts = inner.includes(",") ? inner.split(",") : inner.split(/\s+/);
  return parts.map(normalizeTag).filter(Boolean);
}

/** Extract frontmatter tags from raw YAML block text. */
export function extractFrontmatterTags(yaml) {
  const out = new Set();
  const lines = yaml.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key !== "tags" && key !== "tag") continue;
    const rest = m[2].replace(/\s+#.*$/, "").trim();
    if (rest) {
      for (const t of parseInlineTagList(rest)) out.add(t);
    } else {
      while (i + 1 < lines.length) {
        const item = /^\s*-\s*(.+?)\s*$/.exec(lines[i + 1]);
        if (!item) {
          if (/^\s*(?:#.*)?$/.test(lines[i + 1])) { i++; continue; }
          break;
        }
        const rawVal = item[1].replace(/\s+#.*$/, "");
        const t = normalizeTag(rawVal);
        if (t) out.add(t);
        i++;
      }
    }
  }
  return [...out];
}

/** Scan a single line (outside code spans) for body #tags. */
function scanLineTags(line, into) {
  // Mask inline code spans (`...`) with spaces of equal length
  const masked = line.replace(/`+[^`]*`+/g, (m) => " ".repeat(m.length));
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] !== "#") continue;
    const prev = i === 0 ? "" : masked[i - 1];
    // Reject wikilink anchors [[#heading]], URLs, HTML entities, or mid-word #
    if (prev && !/[\s({'"`,;]/.test(prev)) {
      if (!(prev === "[" && masked[i - 2] !== "[")) continue;
    }
    if (masked[i + 1] === "#" || masked[i + 1] === " ") continue;
    let end = i + 1;
    while (end < masked.length && TAG_CHAR.test(masked[end])) end++;
    // Trim trailing slash if any
    while (end > i + 1 && masked[end - 1] === "/") end--;
    const candidate = normalizeTag(masked.slice(i + 1, end));
    if (candidate) into.add(candidate);
    i = end - 1;
  }
}

/** Extract all tags ({ tags, frontmatterTags, bodyTags, title }) from a Markdown note. */
export function extractNoteInfo(path, text) {
  const fmMatch = FRONTMATTER_RE.exec(text);
  const fmTags = fmMatch ? extractFrontmatterTags(fmMatch[2]) : [];
  const body = fmMatch ? text.slice(fmMatch[0].length) : text;
  const bodySet = new Set();
  let fenceMarker = "";
  let firstHeading = "";

  for (const line of body.split(/\r?\n/)) {
    const f = FENCE_RE.exec(line);
    if (f) {
      const ch = f[1][0];
      if (!fenceMarker) fenceMarker = f[1];
      else if (ch === fenceMarker[0] && f[1].length >= fenceMarker.length) fenceMarker = "";
      continue;
    }
    if (fenceMarker) continue;
    if (HEADING_RE.test(line)) {
      if (!firstHeading) {
        const hm = /^\s*#\s+(.+?)\s*$/.exec(line);
        if (hm) firstHeading = hm[1];
      }
      continue;
    }
    scanLineTags(line, bodySet);
  }

  let title = path.split("/").pop().replace(/\.md$/i, "");
  if (fmMatch) {
    const tm = /^title\s*:\s*(.+)$/m.exec(fmMatch[2]);
    if (tm) title = tm[1].trim().replace(/^['"]|['"]$/g, "") || title;
    else if (firstHeading) title = firstHeading;
  } else if (firstHeading) {
    title = firstHeading;
  }

  const all = new Set([...fmTags, ...bodySet]);
  return { path, title, tags: [...all], fmTags, bodyTags: [...bodySet] };
}

/** Map a single tag under a rename rule (exact + optional subtags); returns mapped tag or original. */
function mapTag(tag, oldTag, newTag, includeSubtags) {
  if (tag === oldTag) return newTag;
  if (includeSubtags && tag.startsWith(`${oldTag}/`)) return `${newTag}${tag.slice(oldTag.length)}`;
  return tag;
}

/** Rewrite YAML frontmatter tags cleanly while preserving all other YAML lines and deduplicating merges. */
function rewriteFrontmatter(yaml, eol, oldTag, newTag, includeSubtags) {
  const lines = yaml.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z0-9_-]+)(\s*:\s*)(.*)$/.exec(lines[i]);
    if (!m || (m[1].toLowerCase() !== "tags" && m[1].toLowerCase() !== "tag")) {
      out.push(lines[i]);
      continue;
    }
    const [, key, sep, rawRest] = m;
    const commentMatch = /(\s+#.*)$/.exec(rawRest);
    const comment = commentMatch ? commentMatch[1] : "";
    const rest = (commentMatch ? rawRest.slice(0, commentMatch.index) : rawRest).trim();

    if (rest) {
      const bracketed = rest.startsWith("[") && rest.endsWith("]");
      const commaSep = rest.includes(",") || bracketed;
      const items = parseInlineTagList(rest);
      const mapped = [];
      const seen = new Set();
      for (const t of items) {
        const next = mapTag(t, oldTag, newTag, includeSubtags);
        if (next && !seen.has(next)) { seen.add(next); mapped.push(next); }
      }
      const joined = bracketed ? `[${mapped.join(", ")}]` : mapped.join(commaSep ? ", " : " ");
      out.push(`${key}${sep}${joined}${comment}`);
    } else {
      out.push(lines[i]);
      const seen = new Set();
      while (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        const item = /^(\s*-\s*)(.+?)(\s*(?:#.*)?)$/.exec(nextLine);
        if (!item) {
          if (/^\s*(?:#.*)?$/.test(nextLine)) { out.push(nextLine); i++; continue; }
          break;
        }
        i++;
        const norm = normalizeTag(item[2]);
        if (!norm) { out.push(nextLine); continue; }
        const hadHash = item[2].trim().replace(/^['"]|['"]$/g, "").startsWith("#");
        const quote = /^(['"]).*\1$/.exec(item[2].trim())?.[1] ?? (hadHash ? '"' : "");
        const updated = mapTag(norm, oldTag, newTag, includeSubtags);
        if (seen.has(updated)) continue; // clean merge: drop duplicate entry
        seen.add(updated);
        if (updated === norm) {
          out.push(nextLine);
        } else {
          const rendered = `${hadHash ? "#" : ""}${updated}`;
          out.push(`${item[1]}${quote}${rendered}${quote}${item[3]}`);
        }
      }
    }
  }
  return out.join(eol);
}

/** Rewrite body #tags on a single non-fence, non-heading line while preserving inline code spans. */
function rewriteBodyLine(line, oldTag, newTag, includeSubtags) {
  // Split line into alternating [plain, `code`, plain, ...] segments
  const parts = line.split(/(`+[^`]*`+)/g);
  return parts.map((seg, idx) => {
    if (idx % 2 === 1) return seg; // inline code span untouched
    let res = "";
    let cursor = 0;
    for (let i = 0; i < seg.length; i++) {
      if (seg[i] !== "#") continue;
      const prev = i === 0 ? "" : seg[i - 1];
      if (prev && !/[\s({'"`,;]/.test(prev)) {
        if (!(prev === "[" && seg[i - 2] !== "[")) continue;
      }
      if (seg[i + 1] === "#" || seg[i + 1] === " ") continue;
      let end = i + 1;
      while (end < seg.length && TAG_CHAR.test(seg[end])) end++;
      while (end > i + 1 && seg[end - 1] === "/") end--;
      const candidate = normalizeTag(seg.slice(i + 1, end));
      if (candidate) {
        const next = mapTag(candidate, oldTag, newTag, includeSubtags);
        if (next !== candidate) {
          res += seg.slice(cursor, i) + `#${next}`;
          cursor = end;
        }
        i = end - 1;
      }
    }
    return res + seg.slice(cursor);
  }).join("");
}

/** Safely rename/merge oldTag -> newTag across YAML frontmatter and markdown body. */
export function renameTagInText(text, oldTag, newTag, includeSubtags = true) {
  const fmMatch = FRONTMATTER_RE.exec(text);
  let head = "";
  let body = text;
  if (fmMatch) {
    const eol = fmMatch[1];
    const newYaml = rewriteFrontmatter(fmMatch[2], eol, oldTag, newTag, includeSubtags);
    head = `---${eol}${newYaml}${eol}---${fmMatch[3]}`;
    body = text.slice(fmMatch[0].length);
  }

  const bodyEol = body.includes("\r\n") ? "\r\n" : "\n";
  let fenceMarker = "";
  const updatedBody = body.split(/\r?\n/).map((line) => {
    const f = FENCE_RE.exec(line);
    if (f) {
      const ch = f[1][0];
      if (!fenceMarker) fenceMarker = f[1];
      else if (ch === fenceMarker[0] && f[1].length >= fenceMarker.length) fenceMarker = "";
      return line;
    }
    if (fenceMarker || HEADING_RE.test(line)) return line;
    return rewriteBodyLine(line, oldTag, newTag, includeSubtags);
  }).join(bodyEol);

  return head + updatedBody;
}
