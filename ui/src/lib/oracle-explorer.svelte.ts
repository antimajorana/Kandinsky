// Oracle vault explorer conventions (.obsidian/snippets/oracle-explorer.css & vault-colors.css):
// hides AI agent plumbing from the FileTree by default (while keeping every file linkable and searchable),
// and assigns Bauhaus "Several Circles" pigments to semantic wiki/research folders.
import { load, save } from "./prefs";

export const HIDE_PLUMBING_KEY = "kandinsky.hideAgentPlumbing";

export const oracleExplorer = $state({
  hidePlumbing: load<boolean>(HIDE_PLUMBING_KEY, true),
});

export function setHidePlumbing(hide: boolean): void {
  oracleExplorer.hidePlumbing = hide;
  save(HIDE_PLUMBING_KEY, hide);
}

export function toggleHidePlumbing(): void {
  setHidePlumbing(!oracleExplorer.hidePlumbing);
}

const PLUMBING_EXACT = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "zAI",
  "zMeta",
  "zAttachments",
  "genkan",
  "wiki/hot.md",
  "wiki/index.md",
  "wiki/log.md",
  "wiki/overview.md",
  "wiki/meta",
]);

const PLUMBING_PREFIXES = [
  "zAI/",
  "zMeta/",
  "zAttachments/",
  "genkan/",
  "wiki/meta/",
];

function normPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

/** True when `path` is agent/vault plumbing hidden from the Explorer tree by default. */
export function isAgentPlumbing(path: string | undefined): boolean {
  if (!path) return false;
  const p = normPath(path);
  return PLUMBING_EXACT.has(p) || PLUMBING_PREFIXES.some((pre) => p.startsWith(pre));
}

export interface FolderTint {
  color: string;
  dot?: string;
}

/** Bauhaus "Several Circles" semantic pigment for Oracle wiki and problem folders. */
export function folderTint(path: string | undefined): FolderTint | null {
  if (!path) return null;
  const p = normPath(path);
  if (p === "wiki/concepts" || p.startsWith("wiki/concepts/")) {
    return { color: "var(--accent)", dot: "var(--accent)" };
  }
  if (p === "wiki/sources" || p.startsWith("wiki/sources/")) {
    return { color: "var(--green)", dot: "var(--green)" };
  }
  if (p === "wiki/entities" || p.startsWith("wiki/entities/")) {
    return { color: "var(--purple)", dot: "var(--purple)" };
  }
  if (p === "wiki/meta" || p.startsWith("wiki/meta/")) {
    return { color: "var(--cyan)", dot: "var(--cyan)" };
  }
  if (p === "problems" || p.startsWith("problems/")) {
    return { color: "var(--yellow)", dot: "var(--yellow)" };
  }
  if (p === "wiki") {
    return { color: "var(--cyan)" };
  }
  return null;
}
