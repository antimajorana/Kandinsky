// Footnotes & FakeLink — Obsidian Footnote Shortcut + FakeLink workflow for Kandinsky (API v28).
// - Alt+Shift+F (in notes) & command "Footnotes: Insert numbered footnote":
//   picks next unused [^n], asks for footnote text, inserts [^n] at cursor, appends [^n]: <text> at end of note.
// - Decorates [^id] references as styled superscripts with hover tooltips showing their definition.
// - Decorates [unlinked placeholder] fake links (excluding markdown links, wikilinks, footnotes, checkboxes, code)
//   and provides "FakeLink: Convert [fake links] in note to [[wikilinks]]".

const FOOTNOTE_REF_RE = /\[\^([\w-]+)\](?!:)/;
const FOOTNOTE_NUM_RE = /\[\^(\d+)\]/g;

// Matches single-bracket [fake link] placeholders that are:
// - NOT preceded by [, !, \, or ` (excludes [[wikilinks]], ![[embeds]], ![images], \[escaped\], `[code]`)
// - NOT starting with ^ (excludes [^footnotes])
// - NOT empty or task checkboxes ([ ], [x], [X], [-], [/], [?], [!])
// - Contains at least one letter (excludes numeric citations/intervals like [1] or [0, 1])
// - NOT followed by ], (, [, :, `, or { (excludes [[wikilinks]], [md](url), [ref][id], [def]: url, `[code]`, \cmd[opt]{arg})
const FAKELINK_RE = /(?<![\[!\\`])\[(?!\^|\s*\]|[xX\-/?!>]\])(?=[^\[\]`\r\n]*[A-Za-z\u00C0-\u024F])([^\[\]`\r\n]{1,120}?)\](?![\]\(\[:`\{])/;

const STYLE_CSS = `
.cm-obs-footnote-ref {
  font-size: 0.78em;
  vertical-align: super;
  line-height: 0;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 4px;
  padding: 1px 4px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  cursor: help;
  transition: background 0.12s ease, color 0.12s ease;
}
.cm-obs-footnote-ref:hover {
  background: var(--accent-sel);
  color: var(--accent-strong);
}
.cm-obs-footnote-ref.is-unresolved {
  color: var(--orange);
  background: color-mix(in srgb, var(--orange) 14%, transparent);
}
.cm-obs-fakelink {
  color: color-mix(in srgb, var(--link) 82%, var(--text-muted));
  text-decoration: underline dashed color-mix(in srgb, var(--link) 55%, transparent);
  text-underline-offset: 3px;
  border-radius: 3px;
  cursor: pointer;
  transition: color 0.12s ease, background 0.12s ease;
}
.cm-obs-fakelink:hover {
  color: var(--link);
  background: var(--accent-soft);
}
`;

const isNotePath = (path) => typeof path === "string" && /\.(md|markdown)$/i.test(path);

/** Parse all `[^id]: text` footnote definitions (including indented continuation lines) from a note. */
export function parseFootnoteDefinitions(text) {
  const defs = new Map();
  if (!text) return defs;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let currentId = null;
  let currentParts = [];
  let inFence = false;

  const flush = () => {
    if (currentId !== null) {
      const joined = currentParts.join(" ").replace(/\s+/g, " ").trim();
      if (joined) defs.set(currentId, joined);
      currentId = null;
      currentParts = [];
    }
  };

  for (const line of lines) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      flush();
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const m = /^\[\^([\w-]+)\]:\s*(.*)$/.exec(line);
    if (m) {
      flush();
      currentId = m[1];
      if (m[2]) currentParts.push(m[2].trim());
      continue;
    }
    if (currentId !== null) {
      if (/^(?: {2,}|\t+)\S/.test(line)) {
        currentParts.push(line.trim());
      } else if (line.trim() === "") {
        continue;
      } else {
        flush();
      }
    }
  }
  flush();
  return defs;
}

/** Pick the smallest positive integer `n >= 1` not yet used as `[^n]` anywhere in the note texts. */
export function nextFootnoteNumber(...texts) {
  const used = new Set();
  for (const text of texts) {
    if (!text) continue;
    FOOTNOTE_NUM_RE.lastIndex = 0;
    for (let m = FOOTNOTE_NUM_RE.exec(text); m; m = FOOTNOTE_NUM_RE.exec(text)) {
      const k = Number(m[1]);
      if (Number.isInteger(k) && k > 0) used.add(k);
    }
  }
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

/** Build the footnote definition suffix to append cleanly to the end of `docText`. */
export function buildFootnoteSuffix(docText, n, body) {
  const clean = String(body ?? "").trim();
  const entry = `[^${n}]: ${clean}`;
  if (!docText) return `${entry}\n`;

  const trimmedEnd = docText.replace(/[ \t]+$/g, "");
  const lastNonEmpty = trimmedEnd.trimEnd().split("\n").pop() ?? "";
  const endsAfterFootnoteDef = /^\[\^[\w-]+\]:/.test(lastNonEmpty);

  if (docText.endsWith("\n\n")) return `${entry}\n`;
  if (docText.endsWith("\n")) return endsAfterFootnoteDef ? `${entry}\n` : `\n${entry}\n`;
  return endsAfterFootnoteDef ? `\n${entry}\n` : `\n\n${entry}\n`;
}

/** Convert `[fake links]` to `[[wikilinks]]`, skipping YAML frontmatter, code fences, inline code, and math. */
export function convertFakeLinksInMarkdown(text) {
  let count = 0;
  const protectedSpans = [];
  const stash = (segment) => {
    const token = `\u0000PROTECTED_${protectedSpans.length}_\u0000`;
    protectedSpans.push(segment);
    return token;
  };

  let working = text;
  // 1. Protect YAML frontmatter at top of note
  working = working.replace(/^---(?:\r?\n)[\s\S]*?\r?\n---(?:\r?\n|$)/, stash);
  // 2. Protect fenced code blocks (``` or ~~~)
  working = working.replace(/^[ \t]*(?:`{3,}|~{3,})[\s\S]*?^[ \t]*(?:`{3,}|~{3,})[ \t]*$/gm, stash);
  // 3. Protect inline code spans
  working = working.replace(/`+[^`\r\n]+`+/g, stash);
  // 4. Protect display and inline math
  working = working.replace(/\$\$[\s\S]*?\$\$|\$(?!\s)[^$\r\n]+?(?<!\s)\$/g, stash);

  const globalFakeRe = new RegExp(FAKELINK_RE.source, "g");
  working = working.replace(globalFakeRe, (whole, inner) => {
    const target = inner.trim();
    if (!target || target.includes("\u0000")) return whole;
    count++;
    return `[[${target}]]`;
  });

  const restored = working.replace(/\u0000PROTECTED_(\d+)_\u0000/g, (_, idx) => protectedSpans[Number(idx)] ?? "");
  return { text: restored, count };
}

export function register(kandinsky) {
  const styleEl = document.createElement("style");
  styleEl.dataset.kandinskyPlugin = "obsidian-footnotes";
  styleEl.textContent = STYLE_CSS;
  document.head.appendChild(styleEl);

  // Per-note footnote definition cache + open CodeMirror EditorView tracking
  const defsByPath = new Map();
  const views = new Set();
  let lastFocusedView = null;

  const viewPath = (view) => {
    try { return kandinsky.editor.path(view) || ""; } catch { return ""; }
  };

  const findViewForPath = (path) => {
    if (!path) return null;
    if (lastFocusedView && views.has(lastFocusedView) && viewPath(lastFocusedView) === path) {
      return lastFocusedView;
    }
    for (const v of views) {
      if (viewPath(v) === path) return v;
    }
    return null;
  };

  const refreshDefsFromDisk = async (path) => {
    if (!isNotePath(path)) return;
    try {
      const text = await kandinsky.readText(path);
      if (!findViewForPath(path)) {
        defsByPath.set(path, parseFootnoteDefinitions(text));
      }
    } catch {
      // Ignore missing or unreadable files
    }
  };

  // Track live editor buffers so tooltips stay up to date as the user types and edits avoid 409 conflicts
  if (kandinsky.editor.codemirror?.view?.ViewPlugin) {
    const { ViewPlugin } = kandinsky.editor.codemirror.view;
    kandinsky.editor.extension(
      ViewPlugin.fromClass(class {
        constructor(view) {
          this.view = view;
          views.add(view);
          const p = viewPath(view);
          if (isNotePath(p)) defsByPath.set(p, parseFootnoteDefinitions(view.state.doc.toString()));
        }
        update(u) {
          if (u.focusChanged && u.view.hasFocus) lastFocusedView = u.view;
          if (u.docChanged) {
            const p = viewPath(u.view);
            if (isNotePath(p)) defsByPath.set(p, parseFootnoteDefinitions(u.state.doc.toString()));
          }
        }
        destroy() {
          views.delete(this.view);
          if (lastFocusedView === this.view) lastFocusedView = null;
        }
      })
    );
  }

  // Prime cache for currently active/open notes and keep synced
  const syncContextNotes = (ctx) => {
    const activePath = ctx?.active?.path;
    if (isNotePath(activePath) && !defsByPath.has(activePath)) void refreshDefsFromDisk(activePath);
    for (const pane of ctx?.open ?? []) {
      if (isNotePath(pane.path) && !defsByPath.has(pane.path)) void refreshDefsFromDisk(pane.path);
    }
  };
  syncContextNotes(kandinsky.context());
  kandinsky.onContext(syncContextNotes);
  kandinsky.onFilesChanged((paths) => {
    if (!paths.length) {
      const activePath = kandinsky.context().active?.path;
      if (isNotePath(activePath)) void refreshDefsFromDisk(activePath);
      return;
    }
    for (const p of paths) {
      if (isNotePath(p)) void refreshDefsFromDisk(p);
    }
  });

  const lookupFootnote = (id) => {
    const activePath = kandinsky.context().active?.path;
    if (activePath && defsByPath.get(activePath)?.has(id)) {
      return defsByPath.get(activePath).get(id);
    }
    for (const map of defsByPath.values()) {
      if (map.has(id)) return map.get(id);
    }
    return null;
  };

  async function insertNumberedFootnote(touch) {
    const path = touch?.path || kandinsky.context().active?.path;
    if (!isNotePath(path)) {
      kandinsky.toast("Footnotes", "Open a Markdown note first.", "info");
      return;
    }

    const diskText = await kandinsky.readText(path).catch(() => "");
    const liveView = findViewForPath(path);
    const liveText = liveView ? liveView.state.doc.toString() : "";
    const n = nextFootnoteNumber(diskText, liveText);

    const footnoteText = await kandinsky.input("Footnote text", {
      hint: "Appended as [^" + n + "]: at the end of the note",
      ok: "Insert",
    });
    if (footnoteText === null) return;

    const marker = `[^${n}]`;
    const activeView = findViewForPath(path);

    if (touch && typeof touch.insert === "function") {
      touch.insert(marker);
      if (activeView) {
        const afterInsertDoc = activeView.state.doc.toString();
        const keepCaret = activeView.state.selection.main.head;
        const suffix = buildFootnoteSuffix(afterInsertDoc, n, footnoteText);
        activeView.dispatch({
          changes: { from: activeView.state.doc.length, insert: suffix },
          selection: { anchor: keepCaret },
          userEvent: "input",
        });
        defsByPath.set(path, parseFootnoteDefinitions(activeView.state.doc.toString()));
        activeView.focus();
        return;
      }
      // Fallback if EditorView handle is unavailable: write appended definition to note
      const latestDisk = await kandinsky.readText(path).catch(() => diskText);
      const updated = latestDisk + buildFootnoteSuffix(latestDisk, n, footnoteText);
      await kandinsky.writeText(path, updated);
      defsByPath.set(path, parseFootnoteDefinitions(updated));
      return;
    }

    if (activeView) {
      const head = activeView.state.selection.main.head;
      const docNow = activeView.state.doc.toString();
      const docLen = activeView.state.doc.length;
      const previewWithMarker = docNow.slice(0, head) + marker + docNow.slice(head);
      const suffix = buildFootnoteSuffix(previewWithMarker, n, footnoteText);
      const changes = head === docLen
        ? { from: docLen, insert: marker + suffix }
        : [
            { from: head, insert: marker },
            { from: docLen, insert: suffix },
          ];
      activeView.dispatch({
        changes,
        selection: { anchor: head + marker.length },
        scrollIntoView: true,
        userEvent: "input",
      });
      defsByPath.set(path, parseFootnoteDefinitions(activeView.state.doc.toString()));
      activeView.focus();
      return;
    }

    // Fallback when triggered from command palette without a live CodeMirror view
    const suffix = buildFootnoteSuffix(diskText, n, footnoteText);
    const updated = diskText + suffix;
    await kandinsky.writeText(path, updated);
    defsByPath.set(path, parseFootnoteDefinitions(updated));
    kandinsky.toast("Footnotes", `Added [^${n}] to the end of ${path.split("/").pop()}.`, "success");
  }

  async function convertNoteFakeLinks() {
    const path = kandinsky.context().active?.path;
    if (!isNotePath(path)) {
      kandinsky.toast("FakeLink", "Open a Markdown note first.", "info");
      return;
    }

    const diskText = await kandinsky.readText(path).catch(() => "");
    const liveView = findViewForPath(path);
    const sourceText = liveView ? liveView.state.doc.toString() : diskText;
    const { text: converted, count } = convertFakeLinksInMarkdown(sourceText);

    if (count === 0) {
      kandinsky.toast("FakeLink", "No [fake links] found in this note.", "info");
      return;
    }

    if (liveView) {
      const head = liveView.state.selection.main.head;
      liveView.dispatch({
        changes: { from: 0, to: liveView.state.doc.length, insert: converted },
        selection: { anchor: Math.min(head, converted.length) },
        userEvent: "input",
      });
      liveView.focus();
    } else {
      await kandinsky.writeText(path, converted);
    }

    kandinsky.toast(
      "FakeLink",
      `Converted ${count} fake link${count === 1 ? "" : "s"} to [[wikilinks]].`,
      "success"
    );
  }

  // 1. Editor shortcut Alt+Shift+F (in Markdown notes)
  kandinsky.editor.registerKey(
    "Alt+Shift+F",
    (t) => {
      void insertNumberedFootnote(t);
    },
    "note"
  );

  // 2. Command: Footnotes: Insert numbered footnote
  kandinsky.registerCommand({
    id: "insert-footnote",
    title: "Footnotes: Insert numbered footnote",
    keys: "Alt+Shift+F",
    run: () => insertNumberedFootnote(),
  });

  // 3. Decoration: Superscript [^n] / [^id] references with hover preview tooltip
  kandinsky.editor.registerDecoration(FOOTNOTE_REF_RE, (m) => {
    const id = m[1];
    const text = lookupFootnote(id);
    return {
      class: text ? "cm-obs-footnote-ref" : "cm-obs-footnote-ref is-unresolved",
      title: text ? `[^${id}]: ${text}` : `Footnote [^${id}] (no definition yet)`,
    };
  });

  // 4. Decoration: Single-bracket [fake link] placeholders
  kandinsky.editor.registerDecoration(FAKELINK_RE, (m) => {
    const label = m[1].trim();
    if (!label) return null;
    return {
      class: "cm-obs-fakelink",
      title: `FakeLink placeholder: [${label}] — run "FakeLink: Convert [fake links] in note to [[wikilinks]]" to link`,
    };
  });

  // 5. Command: FakeLink: Convert [fake links] in note to [[wikilinks]]
  kandinsky.registerCommand({
    id: "convert-fakelinks",
    title: "FakeLink: Convert [fake links] in note to [[wikilinks]]",
    run: () => convertNoteFakeLinks(),
  });

  // 6. Autocomplete existing [^id] footnotes in the active note when typing [^
  kandinsky.editor.registerCompletion({
    where: "note",
    trigger: /\[\^[\w-]*/,
    complete: ({ path }) => {
      const defs = defsByPath.get(path);
      if (!defs || !defs.size) return null;
      return [...defs.entries()].map(([id, body]) => ({
        label: `[^${id}]`,
        detail: body.length > 60 ? `${body.slice(0, 57)}…` : body,
        insert: `[^${id}]`,
        kind: "reference",
      }));
    },
  });

  // 7. Editor context menu helpers
  kandinsky.shell.menu("editor", (target) => {
    if (!isNotePath(target.path)) return null;
    const items = [
      {
        label: "Insert numbered footnote…",
        icon: "quote",
        run: () => insertNumberedFootnote(),
      },
    ];
    if (FAKELINK_RE.test(target.selection ?? "")) {
      items.push({
        label: "Convert [fake links] in note to [[wikilinks]]",
        icon: "link",
        run: () => convertNoteFakeLinks(),
      });
    }
    return items;
  });

  return () => {
    styleEl.remove();
    views.clear();
    defsByPath.clear();
  };
}
