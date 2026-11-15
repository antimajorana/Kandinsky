// Shared cross-pane bus for:
// 1. Inserting Markdown / KaTeX blocks at the active Markdown note's cursor (used by Solver -> Note export and UI tools)
// 2. Handing off PDF / arXiv passages, equations, or note selections to Antigravity, Claude, or Solver
import { activeEditorId, focusPanel, getDock, lastEditorId, nextTerminalN, open } from "./dock";
import { agentsOn } from "./agents";
import { editors, terminals, type EditorHandle, type TerminalHandle } from "./registry";
import type { PaneSpec } from "./panes";

export interface InsertResult {
  ok: boolean;
  path?: string;
  reason?: string;
}

/** Find the best open Markdown editor handle (active first, then most recently focused, then any open .md editor). */
export function findTargetMarkdownEditor(): { id: string; handle: EditorHandle } | null {
  const isMd = (p: string) => /\.(md|markdown)$/i.test(p);
  const candidates = [activeEditorId(), lastEditorId()].filter((x): x is string => !!x);
  for (const id of candidates) {
    const h = editors.get(id);
    if (h && isMd(h.path)) return { id, handle: h };
  }
  for (const [id, h] of editors) {
    if (isMd(h.path)) return { id, handle: h };
  }
  for (const id of candidates) {
    const h = editors.get(id);
    if (h) return { id, handle: h };
  }
  return null;
}

/** Insert a Markdown / KaTeX block at the cursor of the active (or last focused) Markdown note. */
export function insertIntoActiveNote(markdown: string, opts: { focus?: boolean } = {}): InsertResult {
  const text = markdown.trim();
  if (!text) return { ok: false, reason: "Nothing to insert." };
  const found = findTargetMarkdownEditor();
  if (!found) return { ok: false, reason: "No open Markdown note. Open a note tab first." };
  found.handle.insertBlock(text);
  if (opts.focus !== false) focusPanel(found.id);
  return { ok: true, path: found.handle.path };
}

/** Extract an arXiv identifier from a PDF path or filename when present (e.g. `zAI/papers/2401.12345v2_foo.pdf`). */
export function extractArxivId(pathOrName: string): string | null {
  const base = pathOrName.split("/").pop() ?? pathOrName;
  const modern = /(?:arxiv[-_:]?)?(\d{4}\.\d{4,5}(?:v\d+)?)/i.exec(base);
  if (modern) return modern[1];
  const legacy = /((?:cond-mat|hep-th|hep-ph|quant-ph|math-ph|math|physics)[-_]\d{7}(?:v\d+)?)/i.exec(base);
  if (legacy) return legacy[1].replace("_", "/");
  return null;
}

export type AgentTarget = "antigravity" | "claude" | "solver";

export interface AgentPassageHandoff {
  target: AgentTarget;
  prompt: string;
  path?: string;
  page?: number;
  arxivId?: string | null;
  /** Execute immediately with Enter instead of pasting into input buffer (default false). */
  execute?: boolean;
}

async function waitForTerminal(panelId: string, timeoutMs = 3000): Promise<TerminalHandle | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const t = terminals.get(panelId);
    if (t?.ready()) return t;
    await new Promise((r) => setTimeout(r, 60));
  }
  return terminals.get(panelId) ?? null;
}

function latestTerminalMatching(pred: (id: string, t: TerminalHandle) => boolean): { id: string; handle: TerminalHandle } | null {
  let best: { id: string; handle: TerminalHandle } | null = null;
  for (const [id, handle] of terminals) {
    if (!pred(id, handle)) continue;
    if (!best || handle.usedAt > best.handle.usedAt) best = { id, handle };
  }
  return best;
}

/** Format a clean PDF / arXiv passage prompt for an agent pane. */
export function formatPdfPassagePrompt(opts: {
  path: string;
  page?: number;
  passage: string;
  note?: string;
}): { prompt: string; arxivId: string | null } {
  const arxivId = extractArxivId(opts.path);
  const loc = opts.page ? `${opts.path} (p. ${opts.page})` : opts.path;
  const header = arxivId ? `[Paper: arXiv:${arxivId} — ${loc}]` : `[Paper: ${loc}]`;
  const quoted = opts.passage
    .trim()
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
  const extra = opts.note?.trim() ? `\n${opts.note.trim()}` : "";
  return {
    arxivId,
    prompt: `${header}\n${quoted}${extra}\n`,
  };
}

/** Send a passage, equation, or prompt directly to Antigravity, Claude, or Solver (opening the pane beside if needed). */
export async function sendPassageToAgent(opts: AgentPassageHandoff): Promise<boolean> {
  if (opts.target === "solver") {
    const win = window as unknown as { __kandinskyPendingSolverPrompt?: AgentPassageHandoff };
    win.__kandinskyPendingSolverPrompt = opts;
    const existing = getDock()?.panels.find(
      (p) => (p.params as PaneSpec | undefined)?.kind === "plugin" && (p.params as { id?: string }).id === "solver"
    );
    if (existing) focusPanel(existing.id);
    else open({ kind: "plugin", id: "solver", title: "Solver", icon: "sigma" }, { beside: true });
    window.dispatchEvent(new CustomEvent("kandinsky:solver-prefill", { detail: opts }));
    setTimeout(() => window.dispatchEvent(new CustomEvent("kandinsky:solver-prefill", { detail: opts })), 250);
    return true;
  }

  if (opts.target === "claude") {
    const existing = latestTerminalMatching((_id, t) => t.preset === "claude");
    let panelId = existing?.id ?? null;
    if (panelId) {
      focusPanel(panelId);
    } else {
      const api = open({ kind: "terminal", preset: "claude", n: nextTerminalN(), title: "Claude" }, { beside: true });
      panelId = api?.id ?? null;
    }
    if (!panelId) return false;
    const term = await waitForTerminal(panelId);
    if (!term) return false;
    if (opts.execute) term.run(opts.prompt.trim());
    else term.paste(opts.prompt);
    term.focus();
    return true;
  }

  // target === "antigravity"
  const agyDecl = agentsOn().find((a) => a.plugin === "antigravity" || a.id === "agy" || a.ref.startsWith("antigravity/"));
  const agentRef = agyDecl?.ref ?? "antigravity/agy";
  const existing = latestTerminalMatching((_id, t) => Boolean(t.agent?.startsWith("antigravity/")) || t.preset === "antigravity");
  let panelId = existing?.id ?? null;
  if (panelId) {
    focusPanel(panelId);
  } else {
    const spec: PaneSpec = agyDecl
      ? { kind: "terminal", preset: "shell", n: nextTerminalN(), title: agyDecl.title || "Antigravity", agent: agentRef }
      : { kind: "terminal", preset: "shell", n: nextTerminalN(), title: "Antigravity", command: "agy" };
    const api = open(spec, { beside: true });
    panelId = api?.id ?? null;
  }
  if (!panelId) return false;
  const term = await waitForTerminal(panelId);
  if (!term) return false;
  if (opts.execute) term.run(opts.prompt.trim());
  else term.paste(opts.prompt);
  term.focus();
  return true;
}

// Global DOM CustomEvent bridge so workspace plugins (like solver/view.js and antigravity/switcher-ui.js)
// can insert into the active Markdown note or hand off passages without importing internal Svelte modules.
if (typeof window !== "undefined") {
  const w = window as unknown as {
    __kandinskyInsertBusInstalled?: boolean;
    __kandinskyInsertIntoActiveNote?: typeof insertIntoActiveNote;
    __kandinskySendPassageToAgent?: typeof sendPassageToAgent;
  };
  if (!w.__kandinskyInsertBusInstalled) {
    w.__kandinskyInsertBusInstalled = true;
    w.__kandinskyInsertIntoActiveNote = insertIntoActiveNote;
    w.__kandinskySendPassageToAgent = sendPassageToAgent;
    window.addEventListener("kandinsky:insert-at-cursor", (ev: Event) => {
      const detail = (ev as CustomEvent<{ text?: string; focus?: boolean; onResult?: (r: InsertResult) => void }>).detail;
      if (!detail?.text) return;
      const res = insertIntoActiveNote(detail.text, { focus: detail.focus });
      detail.onResult?.(res);
    });
  }
}
