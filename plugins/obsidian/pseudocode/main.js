// Pseudocode Algorithms — Kandinsky plugin (API v28).
// Renders Obsidian ```pseudo and ```pseudocode LaTeX algorithm blocks in academic booktabs style.

const STYLE_ID = "kandinsky-plugin-pseudocode-style";

const CSS = `
.pseudo-alg {
  margin: 12px 0;
  background: var(--bg-elev);
  color: var(--text);
  border-top: 2px solid var(--border-strong);
  border-top-color: color-mix(in srgb, var(--text) 72%, var(--border-strong));
  border-bottom: 2px solid var(--border-strong);
  border-bottom-color: color-mix(in srgb, var(--text) 72%, var(--border-strong));
  font-size: 0.95em;
  line-height: 1.55;
  overflow-x: auto;
}
.pseudo-caption {
  display: flex;
  align-items: baseline;
  gap: 0.45em;
  padding: 7px 12px;
  border-bottom: 1px solid var(--border-strong);
  color: var(--text);
}
.pseudo-caption-tag {
  font-weight: 700;
  color: var(--heading);
  white-space: nowrap;
}
.pseudo-caption-title {
  flex: 1 1 auto;
  min-width: 0;
}
.pseudo-label-badge {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 0.76em;
  color: var(--text-faint);
  white-space: nowrap;
}
.pseudo-preamble {
  padding: 5px 12px;
  border-bottom: 1px solid var(--border);
}
.pseudo-preamble-row {
  padding: 1.5px 0;
}
.pseudo-steps {
  padding: 5px 12px 6px 8px;
}
.pseudo-row {
  display: flex;
  align-items: stretch;
  min-height: 1.55em;
  border-radius: 3px;
}
.pseudo-row:hover {
  background: var(--bg-hover);
}
.pseudo-ln {
  flex: 0 0 2.3em;
  padding-right: 0.75em;
  text-align: right;
  font-family: var(--font-mono);
  font-size: 0.78em;
  font-variant-numeric: tabular-nums;
  color: var(--text-faint);
  user-select: none;
  line-height: 1.95;
}
.pseudo-guides {
  display: flex;
  align-items: stretch;
  flex: 0 0 auto;
}
.pseudo-guide {
  width: 1.35em;
  border-left: 1px solid var(--border-strong);
  flex: 0 0 1.35em;
}
.pseudo-body {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 0.75em;
  padding: 1px 4px 1px 0;
}
.pseudo-code-text {
  flex: 0 1 auto;
  min-width: 0;
}
.pseudo-kw {
  font-weight: 700;
  color: var(--heading);
}
.pseudo-sc {
  font-variant: small-caps;
  letter-spacing: 0.025em;
  font-weight: 500;
}
.pseudo-tt {
  font-family: var(--font-mono);
  font-size: 0.88em;
  color: var(--inline-code);
  background: var(--code-bg);
  padding: 0 0.28em;
  border-radius: 3px;
}
.pseudo-comment {
  margin-left: auto;
  color: var(--text-muted);
  font-style: italic;
  font-size: 0.92em;
  white-space: normal;
}
.pseudo-comment-standalone {
  color: var(--text-muted);
  font-style: italic;
}
.pseudo-comment-sym {
  font-style: normal;
  color: var(--text-faint);
  margin-right: 0.3em;
}
`;

function ensureStyles() {
  if (typeof document === "undefined") return () => {};
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  return () => {
    const el = document.getElementById(STYLE_ID);
    if (el) el.remove();
  };
}

/** Strip unescaped LaTeX `% ...` line comments while preserving `\%` and `$...$`. */
export function stripLatexComments(src) {
  const s = String(src ?? "").replace(/\r\n?/g, "\n");
  let out = "";
  let inMath = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length) {
      out += ch + s[i + 1];
      i++;
      continue;
    }
    if (ch === "$") {
      if (s[i + 1] === "$") {
        out += "$$";
        i++;
      } else {
        inMath = !inMath;
        out += "$";
      }
      continue;
    }
    if (ch === "\n") {
      inMath = false;
      out += "\n";
      continue;
    }
    if (ch === "%" && !inMath) {
      while (i + 1 < s.length && s[i + 1] !== "\n") i++;
      continue;
    }
    out += ch;
  }
  return out;
}

function skipHoriWs(s, i) {
  while (i < s.length && (s[i] === " " || s[i] === "\t")) i++;
  return i;
}

function skipAllWs(s, i) {
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
}

/** Read a balanced `{...}` group starting at or after horizontal whitespace from `pos` (skips `$...$` and `\{` `\}`). */
export function readBraced(s, pos, allowNewlineBefore = true) {
  const i = allowNewlineBefore ? skipAllWs(s, pos) : skipHoriWs(s, pos);
  if (s[i] !== "{") return null;
  let depth = 0;
  let inMath = false;
  for (let j = i; j < s.length; j++) {
    const ch = s[j];
    if (ch === "\\" && j + 1 < s.length) {
      j++;
      continue;
    }
    if (ch === "$") {
      inMath = !inMath;
      continue;
    }
    if (!inMath) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return { value: s.slice(i + 1, j), next: j + 1 };
      }
    }
  }
  return { value: s.slice(i + 1), next: s.length };
}

/** Read an optional `[...]` bracket group starting after horizontal whitespace from `pos`. */
function readOptBracket(s, pos) {
  const i = skipHoriWs(s, pos);
  if (s[i] !== "[") return { value: null, next: pos };
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === "\\" && j + 1 < s.length) {
      j++;
      continue;
    }
    if (s[j] === "[") depth++;
    else if (s[j] === "]") {
      depth--;
      if (depth === 0) return { value: s.slice(i + 1, j), next: j + 1 };
    }
  }
  return { value: s.slice(i + 1), next: s.length };
}

function readCmdAt(s, pos) {
  if (s[pos] !== "\\") return null;
  const m = /^\\([A-Za-z]+)/.exec(s.slice(pos));
  if (!m) return null;
  return { name: m[1], lower: m[1].toLowerCase(), next: pos + m[0].length };
}

const STATEMENT_BOUNDARY_CMDS = new Set([
  "begin", "end", "caption", "label",
  "procedure", "endprocedure", "function", "endfunction",
  "require", "input", "ensure", "output",
  "for", "forall", "endfor",
  "while", "endwhile",
  "repeat", "until", "loop", "endloop",
  "if", "elsif", "elseif", "elif", "else", "endif",
  "state", "statex", "statei",
]);

const STANDALONE_STMT_CMDS = new Set(["return", "print", "break", "continue"]);
const COMMENT_CMDS = new Set(["comment", "lcomment", "linecomment", "tcc", "tcp"]);

/** Read free-form text until newline (when braces/math are closed) or the next block-level command. */
function readStatementRest(s, pos) {
  let i = skipHoriWs(s, pos);
  const start = i;
  let braceDepth = 0;
  let inMath = false;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length) {
      if (!inMath && braceDepth === 0) {
        const cmd = readCmdAt(s, i);
        if (cmd && STATEMENT_BOUNDARY_CMDS.has(cmd.lower)) break;
      }
      i += 2;
      continue;
    }
    if (ch === "$") {
      inMath = !inMath;
      i++;
      continue;
    }
    if (!inMath) {
      if (ch === "{") braceDepth++;
      else if (ch === "}" && braceDepth > 0) braceDepth--;
      else if (ch === "\n" && braceDepth === 0) {
        i++;
        break;
      }
    }
    i++;
  }
  return { text: s.slice(start, i).trim(), next: i };
}

/** Extract trailing `\Comment{...}` / `\COMMENT{...}` from a statement body (outside `$...$`). */
export function extractComments(rawText) {
  const s = String(rawText ?? "");
  let body = "";
  const comments = [];
  let inMath = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length) {
      if (!inMath) {
        const cmd = readCmdAt(s, i);
        if (cmd && COMMENT_CMDS.has(cmd.lower)) {
          const grp = readBraced(s, cmd.next, false);
          if (grp) {
            comments.push(grp.value.trim());
            i = grp.next;
            continue;
          }
        }
      }
      body += s.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === "$") {
      inMath = !inMath;
    }
    body += ch;
    i++;
  }
  return { body: body.trim(), comment: comments.join("; ") };
}

/** Consume optional same-line `\COMMENT{...}` right after a structural command like `\IF{...}` or `\ELSE`. */
function readTrailingLineComment(s, pos) {
  let i = skipHoriWs(s, pos);
  const comments = [];
  while (i < s.length) {
    const cmd = readCmdAt(s, i);
    if (!cmd || !COMMENT_CMDS.has(cmd.lower)) break;
    const grp = readBraced(s, cmd.next, false);
    if (!grp) break;
    comments.push(grp.value.trim());
    i = skipHoriWs(s, grp.next);
  }
  if (s[i] === "\n") i++;
  return { comment: comments.join("; "), next: i };
}

function readCondition(s, pos) {
  const grp = readBraced(s, pos, false);
  if (grp) {
    const tail = readTrailingLineComment(s, grp.next);
    return { cond: grp.value.trim(), comment: tail.comment, next: tail.next };
  }
  const rest = readStatementRest(s, pos);
  const { body, comment } = extractComments(rest.text);
  return { cond: body, comment, next: rest.next };
}

/** Parse LaTeX algorithm / algorithmic source into structured algorithm ASTs. */
export function parsePseudocode(source) {
  const s = stripLatexComments(source);
  const algorithms = [];
  const makeAlg = () => ({ caption: "", label: "", preambles: [], steps: [] });
  const isEmptyAlg = (a) => !a.caption && !a.label && a.preambles.length === 0 && a.steps.length === 0;

  let cur = makeAlg();
  let indent = 0;
  let i = 0;

  while (i < s.length) {
    i = skipAllWs(s, i);
    if (i >= s.length) break;

    const cmd = readCmdAt(s, i);
    if (cmd) {
      const c = cmd.lower;

      if (c === "begin") {
        const envGrp = readBraced(s, cmd.next, false);
        const envName = (envGrp?.value || "").trim().toLowerCase().replace(/\*$/, "");
        let nextPos = envGrp ? envGrp.next : cmd.next;
        nextPos = readOptBracket(s, nextPos).next;
        if (envName === "algorithm") {
          if (!isEmptyAlg(cur)) {
            algorithms.push(cur);
            cur = makeAlg();
          }
          indent = 0;
          i = nextPos;
          continue;
        }
        if (envName === "algorithmic") {
          indent = 0;
          i = nextPos;
          continue;
        }
      }

      if (c === "end") {
        const envGrp = readBraced(s, cmd.next, false);
        const envName = (envGrp?.value || "").trim().toLowerCase().replace(/\*$/, "");
        const nextPos = envGrp ? envGrp.next : cmd.next;
        if (envName === "algorithm") {
          if (!isEmptyAlg(cur)) algorithms.push(cur);
          cur = makeAlg();
          indent = 0;
          i = nextPos;
          continue;
        }
        if (envName === "algorithmic") {
          indent = 0;
          i = nextPos;
          continue;
        }
      }

      if (c === "caption") {
        const opt = readOptBracket(s, cmd.next);
        const grp = readBraced(s, opt.next, true);
        if (grp) {
          cur.caption = grp.value.trim();
          i = grp.next;
          continue;
        }
      }

      if (c === "label") {
        const grp = readBraced(s, cmd.next, false);
        if (grp) {
          cur.label = grp.value.trim();
          i = grp.next;
          continue;
        }
      }

      if (c === "require" || c === "input" || c === "ensure" || c === "output") {
        const labelMap = { require: "Require:", input: "Input:", ensure: "Ensure:", output: "Output:" };
        const rest = readStatementRest(s, cmd.next);
        const { body, comment } = extractComments(rest.text);
        if (cur.steps.length === 0 && indent === 0) {
          cur.preambles.push({ tag: labelMap[c], body, comment });
        } else {
          cur.steps.push({ kind: "preamble", numbered: false, indent, tag: labelMap[c], body, comment });
        }
        i = rest.next;
        continue;
      }

      if (c === "procedure" || c === "function") {
        const nameGrp = readBraced(s, cmd.next, false) || { value: "", next: cmd.next };
        const argsGrp = readBraced(s, nameGrp.next, false) || { value: "", next: nameGrp.next };
        const tail = readTrailingLineComment(s, argsGrp.next);
        cur.steps.push({
          kind: "proc",
          numbered: true,
          indent,
          kw: c,
          name: nameGrp.value.trim(),
          args: argsGrp.value.trim(),
          comment: tail.comment,
        });
        indent++;
        i = tail.next;
        continue;
      }

      if (c === "endprocedure" || c === "endfunction") {
        indent = Math.max(0, indent - 1);
        const tail = readTrailingLineComment(s, cmd.next);
        cur.steps.push({
          kind: "end",
          numbered: true,
          indent,
          kw: c === "endprocedure" ? "end procedure" : "end function",
          comment: tail.comment,
        });
        i = tail.next;
        continue;
      }

      if (c === "for" || c === "forall" || c === "while") {
        const { cond, comment, next } = readCondition(s, cmd.next);
        const kw = c === "forall" ? "for all" : c;
        cur.steps.push({ kind: "cond-open", numbered: true, indent, kw, cond, suffix: "do", comment });
        indent++;
        i = next;
        continue;
      }

      if (c === "endfor" || c === "endwhile") {
        indent = Math.max(0, indent - 1);
        const tail = readTrailingLineComment(s, cmd.next);
        cur.steps.push({
          kind: "end",
          numbered: true,
          indent,
          kw: c === "endfor" ? "end for" : "end while",
          comment: tail.comment,
        });
        i = tail.next;
        continue;
      }

      if (c === "repeat" || c === "loop") {
        const tail = readTrailingLineComment(s, cmd.next);
        cur.steps.push({ kind: "kw-only", numbered: true, indent, kw: c, comment: tail.comment });
        indent++;
        i = tail.next;
        continue;
      }

      if (c === "until") {
        indent = Math.max(0, indent - 1);
        const { cond, comment, next } = readCondition(s, cmd.next);
        cur.steps.push({ kind: "cond-open", numbered: true, indent, kw: "until", cond, suffix: "", comment });
        i = next;
        continue;
      }

      if (c === "endloop") {
        indent = Math.max(0, indent - 1);
        const tail = readTrailingLineComment(s, cmd.next);
        cur.steps.push({ kind: "end", numbered: true, indent, kw: "end loop", comment: tail.comment });
        i = tail.next;
        continue;
      }

      if (c === "if") {
        const { cond, comment, next } = readCondition(s, cmd.next);
        cur.steps.push({ kind: "cond-open", numbered: true, indent, kw: "if", cond, suffix: "then", comment });
        indent++;
        i = next;
        continue;
      }

      if (c === "elsif" || c === "elseif" || c === "elif") {
        const { cond, comment, next } = readCondition(s, cmd.next);
        cur.steps.push({
          kind: "cond-open",
          numbered: true,
          indent: Math.max(0, indent - 1),
          kw: "else if",
          cond,
          suffix: "then",
          comment,
        });
        i = next;
        continue;
      }

      if (c === "else") {
        const tail = readTrailingLineComment(s, cmd.next);
        cur.steps.push({
          kind: "kw-only",
          numbered: true,
          indent: Math.max(0, indent - 1),
          kw: "else",
          comment: tail.comment,
        });
        i = tail.next;
        continue;
      }

      if (c === "endif") {
        indent = Math.max(0, indent - 1);
        const tail = readTrailingLineComment(s, cmd.next);
        cur.steps.push({ kind: "end", numbered: true, indent, kw: "end if", comment: tail.comment });
        i = tail.next;
        continue;
      }

      if (c === "state" || c === "statex" || c === "statei") {
        const rest = readStatementRest(s, cmd.next);
        const { body, comment } = extractComments(rest.text);
        cur.steps.push({
          kind: "state",
          numbered: c === "state",
          indent,
          body,
          comment,
        });
        i = rest.next;
        continue;
      }

      if (STANDALONE_STMT_CMDS.has(c)) {
        const rest = readStatementRest(s, cmd.next);
        let rawArg = rest.text;
        // Support both `\Return $x$` and `\Return{$x$}`
        if (rawArg.startsWith("{")) {
          const grp = readBraced(rawArg, 0, false);
          if (grp && grp.next === rawArg.length) rawArg = grp.value.trim();
        }
        const { body, comment } = extractComments(rawArg);
        cur.steps.push({
          kind: "lead-kw",
          numbered: true,
          indent,
          kw: c,
          body,
          comment,
        });
        i = rest.next;
        continue;
      }

      if (COMMENT_CMDS.has(c)) {
        const grp = readBraced(s, cmd.next, false);
        if (grp) {
          const tail = readTrailingLineComment(s, grp.next);
          const merged = [grp.value.trim(), tail.comment].filter(Boolean).join("; ");
          cur.steps.push({ kind: "comment", numbered: false, indent, comment: merged });
          i = tail.next;
          continue;
        }
      }
    }

    // Fallback: plain line inside algorithmic body
    const rest = readStatementRest(s, i);
    if (rest.next <= i) {
      i++;
      continue;
    }
    const { body, comment } = extractComments(rest.text);
    if (body || comment) {
      cur.steps.push({ kind: body ? "state" : "comment", numbered: Boolean(body), indent, body, comment });
    }
    i = rest.next;
  }

  if (!isEmptyAlg(cur) || algorithms.length === 0) algorithms.push(cur);
  return algorithms;
}

/** Rewrite `\CALL{Fn}{Args}` inside math mode into `\operatorname{Fn}(Args)` so KaTeX renders it natively. */
function normalizeMathLatex(latex) {
  let s = String(latex ?? "");
  let out = "";
  let i = 0;
  while (i < s.length) {
    const cmd = readCmdAt(s, i);
    if (cmd && cmd.lower === "call") {
      const fnGrp = readBraced(s, cmd.next, false);
      if (fnGrp) {
        const argGrp = readBraced(s, fnGrp.next, false);
        const fnName = fnGrp.value.trim();
        if (argGrp) {
          out += `\\operatorname{${fnName}}(${normalizeMathLatex(argGrp.value.trim())})`;
          i = argGrp.next;
          continue;
        }
        out += `\\operatorname{${fnName}}`;
        i = fnGrp.next;
        continue;
      }
    }
    out += s[i];
    i++;
  }
  return out;
}

const INLINE_KW_MAP = {
  return: "return",
  print: "print",
  break: "break",
  continue: "continue",
  to: "to",
  downto: "downto",
  step: "step",
  and: "and",
  or: "or",
  not: "not",
  xor: "xor",
  true: "true",
  false: "false",
};

function appendSpaceSeparatedKw(host, word, hadLeadingText, hasTrailingText) {
  if (hadLeadingText) host.append(" ");
  const b = document.createElement("span");
  b.className = "pseudo-kw";
  b.textContent = word;
  host.appendChild(b);
  if (hasTrailingText) host.append(" ");
}

function unescapeTextChunk(chunk) {
  return chunk
    .replace(/\\([{}%&_$#])/g, "$1")
    .replace(/~/g, "\u00a0")
    .replace(/``/g, "“")
    .replace(/''/g, "”")
    .replace(/---/g, "—")
    .replace(/--/g, "–");
}

/** Render mixed prose, inline LaTeX formatting/keywords (`\CALL`, `\textbf`, `\TO`…), and `$...$` math into `host`. */
export function renderInline(host, rawText, atlas) {
  const s = String(rawText ?? "");
  let buf = "";
  const flushBuf = () => {
    if (!buf) return;
    host.append(unescapeTextChunk(buf));
    buf = "";
  };

  let i = 0;
  while (i < s.length) {
    const ch = s[i];

    // Escaped character (`\$`, `\{`, `\}`, `\%`, `\_`, `\&`)
    if (ch === "\\" && i + 1 < s.length && !/[A-Za-z(]/.test(s[i + 1])) {
      buf += s.slice(i, i + 2);
      i += 2;
      continue;
    }

    // `\( ... \)` inline math
    if (ch === "\\" && s[i + 1] === "(") {
      const end = s.indexOf("\\)", i + 2);
      if (end !== -1) {
        flushBuf();
        const span = document.createElement("span");
        atlas.editor.drawMath(span, normalizeMathLatex(s.slice(i + 2, end).trim()), false);
        host.appendChild(span);
        i = end + 2;
        continue;
      }
    }

    // `$...$` or `$$...$$` inline math
    if (ch === "$") {
      const double = s[i + 1] === "$";
      const delim = double ? "$$" : "$";
      let j = i + delim.length;
      while (j < s.length) {
        if (s[j] === "\\" && j + 1 < s.length) {
          j += 2;
          continue;
        }
        if (double ? s.slice(j, j + 2) === "$$" : s[j] === "$") break;
        j++;
      }
      if (j < s.length) {
        flushBuf();
        const latex = s.slice(i + delim.length, j).trim();
        const span = document.createElement("span");
        atlas.editor.drawMath(span, normalizeMathLatex(latex), false);
        host.appendChild(span);
        i = j + delim.length;
        continue;
      }
    }

    // Inline LaTeX commands (`\CALL`, `\textbf`, `\textit`, `\textsc`, `\texttt`, `\TO`, `\AND`, `\RETURN`, ...)
    if (ch === "\\") {
      const cmd = readCmdAt(s, i);
      if (cmd) {
        const c = cmd.lower;

        if (c === "call") {
          const fnGrp = readBraced(s, cmd.next, false);
          if (fnGrp) {
            flushBuf();
            const argsGrp = readBraced(s, fnGrp.next, false);
            const callWrap = document.createElement("span");
            const fnSpan = document.createElement("span");
            fnSpan.className = "pseudo-sc";
            renderInline(fnSpan, fnGrp.value.trim(), atlas);
            callWrap.appendChild(fnSpan);
            if (argsGrp) {
              callWrap.append("(");
              renderInline(callWrap, argsGrp.value.trim(), atlas);
              callWrap.append(")");
              i = argsGrp.next;
            } else {
              callWrap.append("()");
              i = fnGrp.next;
            }
            host.appendChild(callWrap);
            continue;
          }
        }

        if (c === "textbf" || c === "textit" || c === "emph" || c === "textsc" || c === "texttt" || c === "textrm" || c === "textnormal" || c === "text") {
          const grp = readBraced(s, cmd.next, false);
          if (grp) {
            flushBuf();
            let el;
            if (c === "textbf") el = document.createElement("strong");
            else if (c === "textit" || c === "emph") el = document.createElement("em");
            else if (c === "textsc") {
              el = document.createElement("span");
              el.className = "pseudo-sc";
            } else if (c === "texttt") {
              el = document.createElement("code");
              el.className = "pseudo-tt";
            } else {
              el = document.createElement("span");
            }
            renderInline(el, grp.value, atlas);
            host.appendChild(el);
            i = grp.next;
            continue;
          }
        }

        if (Object.hasOwn(INLINE_KW_MAP, c)) {
          const hadLeadingSpace = /\s$/.test(buf);
          buf = buf.replace(/\s+$/, "");
          const hadBefore = buf.length > 0 || host.childNodes.length > 0;
          flushBuf();
          const nextNonWs = skipHoriWs(s, cmd.next);
          const hasAfter = nextNonWs < s.length && !/^[,.;:)\]}]/.test(s.slice(nextNonWs));
          appendSpaceSeparatedKw(host, INLINE_KW_MAP[c], hadBefore && (hadLeadingSpace || host.childNodes.length > 0), hasAfter);
          i = nextNonWs;
          continue;
        }

        // Common symbol commands written outside `$...$` by mistake
        const symMap = {
          gets: "←",
          leftarrow: "←",
          rightarrow: "→",
          le: "≤",
          leq: "≤",
          ge: "≥",
          geq: "≥",
          neq: "≠",
          ne: "≠",
          times: "×",
          cdot: "·",
          dots: "…",
          ldots: "…",
        };
        if (Object.hasOwn(symMap, c)) {
          buf += symMap[c];
          i = skipHoriWs(s, cmd.next);
          if (s[cmd.next] === " ") buf += " ";
          continue;
        }
      }
    }

    // Unwrap stray `{...}` text groups outside math
    if (ch === "{") {
      const grp = readBraced(s, i, false);
      if (grp) {
        flushBuf();
        renderInline(host, grp.value, atlas);
        i = grp.next;
        continue;
      }
    }

    buf += ch;
    i++;
  }
  flushBuf();
}

function makeKw(text) {
  const span = document.createElement("span");
  span.className = "pseudo-kw";
  span.textContent = text;
  return span;
}

function makeCommentNode(commentText, standalone, atlas) {
  const wrap = document.createElement("span");
  wrap.className = standalone ? "pseudo-comment-standalone" : "pseudo-comment";
  const sym = document.createElement("span");
  sym.className = "pseudo-comment-sym";
  sym.textContent = "▷";
  wrap.appendChild(sym);
  renderInline(wrap, commentText, atlas);
  return wrap;
}

function renderAlgorithmCard(alg, fallbackTitle, showLineNumbers, atlas) {
  const card = document.createElement("div");
  card.className = "pseudo-alg";
  if (alg.label) card.dataset.label = alg.label;

  const captionText = alg.caption || fallbackTitle || "";
  if (captionText || alg.label) {
    const cap = document.createElement("div");
    cap.className = "pseudo-caption";
    const tag = document.createElement("span");
    tag.className = "pseudo-caption-tag";
    tag.textContent = captionText ? "Algorithm:" : "Algorithm";
    cap.appendChild(tag);
    if (captionText) {
      const titleSpan = document.createElement("span");
      titleSpan.className = "pseudo-caption-title";
      renderInline(titleSpan, captionText, atlas);
      cap.appendChild(titleSpan);
    }
    if (alg.label) {
      const badge = document.createElement("span");
      badge.className = "pseudo-label-badge";
      badge.textContent = alg.label;
      cap.appendChild(badge);
    }
    card.appendChild(cap);
  }

  if (alg.preambles.length > 0) {
    const pre = document.createElement("div");
    pre.className = "pseudo-preamble";
    for (const p of alg.preambles) {
      const row = document.createElement("div");
      row.className = "pseudo-preamble-row";
      row.appendChild(makeKw(p.tag));
      row.append(" ");
      renderInline(row, p.body, atlas);
      if (p.comment) {
        row.append(" ");
        row.appendChild(makeCommentNode(p.comment, false, atlas));
      }
      pre.appendChild(row);
    }
    card.appendChild(pre);
  }

  const stepsBox = document.createElement("div");
  stepsBox.className = "pseudo-steps";
  let lineNo = 0;

  for (const step of alg.steps) {
    const row = document.createElement("div");
    row.className = "pseudo-row";

    if (showLineNumbers) {
      const ln = document.createElement("span");
      ln.className = "pseudo-ln";
      if (step.numbered) {
        lineNo++;
        ln.textContent = String(lineNo);
      }
      row.appendChild(ln);
    }

    if (step.indent > 0) {
      const guides = document.createElement("span");
      guides.className = "pseudo-guides";
      guides.setAttribute("aria-hidden", "true");
      for (let d = 0; d < step.indent; d++) {
        const g = document.createElement("span");
        g.className = "pseudo-guide";
        guides.appendChild(g);
      }
      row.appendChild(guides);
    }

    const body = document.createElement("div");
    body.className = "pseudo-body";
    const textSpan = document.createElement("span");
    textSpan.className = "pseudo-code-text";

    if (step.kind === "proc") {
      textSpan.appendChild(makeKw(step.kw));
      textSpan.append(" ");
      const nameEl = document.createElement("span");
      nameEl.className = "pseudo-sc";
      renderInline(nameEl, step.name, atlas);
      textSpan.appendChild(nameEl);
      textSpan.append("(");
      if (step.args) renderInline(textSpan, step.args, atlas);
      textSpan.append(")");
    } else if (step.kind === "cond-open") {
      textSpan.appendChild(makeKw(step.kw));
      if (step.cond) {
        textSpan.append(" ");
        renderInline(textSpan, step.cond, atlas);
      }
      if (step.suffix) {
        textSpan.append(" ");
        textSpan.appendChild(makeKw(step.suffix));
      }
    } else if (step.kind === "kw-only" || step.kind === "end") {
      textSpan.appendChild(makeKw(step.kw));
    } else if (step.kind === "preamble") {
      textSpan.appendChild(makeKw(step.tag));
      textSpan.append(" ");
      renderInline(textSpan, step.body, atlas);
    } else if (step.kind === "lead-kw") {
      textSpan.appendChild(makeKw(step.kw));
      if (step.body) {
        textSpan.append(" ");
        renderInline(textSpan, step.body, atlas);
      }
    } else if (step.kind === "state") {
      renderInline(textSpan, step.body, atlas);
    } else if (step.kind === "comment") {
      textSpan.appendChild(makeCommentNode(step.comment, true, atlas));
    }

    body.appendChild(textSpan);
    if (step.kind !== "comment" && step.comment) {
      body.appendChild(makeCommentNode(step.comment, false, atlas));
    }
    row.appendChild(body);
    stepsBox.appendChild(row);
  }

  card.appendChild(stepsBox);
  return card;
}

export function register(atlas) {
  const removeStyles = ensureStyles();

  const renderFence = (host, fence) => {
    const showLineNumbers = atlas.plugin?.settings?.line_numbers !== false;
    const algs = parsePseudocode(fence.source);
    const infoTitle = typeof fence.info === "string" ? fence.info.trim() : "";
    for (let idx = 0; idx < algs.length; idx++) {
      host.appendChild(renderAlgorithmCard(algs[idx], idx === 0 ? infoTitle : "", showLineNumbers, atlas));
    }
  };

  atlas.editor.registerFence("pseudo", renderFence);
  atlas.editor.registerFence("pseudocode", renderFence);

  return () => {
    removeStyles();
  };
}
