// Oracle Physics Runner UI plugin: palette commands, context-menu actions, and `oracle.lint` block.

function activeMdPath(kandinsky) {
  const ctx = kandinsky.context();
  const p = (ctx && ctx.active && ctx.active.path) || (ctx && ctx.selection && ctx.selection.path) || "";
  return /\.md$/i.test(p) ? p : "";
}

async function runLintToast(kandinsky, path) {
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

  kandinsky.registerBlock("oracle.lint", (host, block) => {
    let gone = false;
    const notePath = String((block.options && block.options.path) || block.doc || "");

    const wrap = document.createElement("div");
    wrap.style.cssText = "font-size:0.9rem;display:flex;flex-direction:column;gap:8px;";
    const head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;";
    const statusEl = document.createElement("strong");
    statusEl.textContent = notePath ? `c_lint: checking ${notePath}...` : "c_lint: no target path";
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
      if (gone || !notePath || !/\.md$/i.test(notePath)) return;
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
      if (!paths.length || paths.includes(notePath)) void refresh();
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
