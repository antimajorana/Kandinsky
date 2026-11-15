// Workspace shell mode: Nootion-style Unified Sidebar ("notion", default) vs Classic Rail + Horizontal Tabs ("classic").
// Cached in localStorage for zero-flash startup and synced to `.kandinsky/cache/shell.json` via shellPart.
import { load, save } from "./prefs";
import { saveShellPrefs, shellPart } from "./shell-prefs";

export type ShellMode = "notion" | "classic";

export const SHELL_MODE_KEY = "kandinsky.shellMode";

function normalizeMode(v: unknown): ShellMode {
  return v === "classic" ? "classic" : "notion";
}

export const shellMode = $state({
  value: normalizeMode(load<string>(SHELL_MODE_KEY, "notion")),
});

export const isNotionShell = (): boolean => shellMode.value === "notion";

export function setShellMode(mode: ShellMode): void {
  const next = normalizeMode(mode);
  if (shellMode.value === next) return;
  shellMode.value = next;
  save(SHELL_MODE_KEY, next);
  saveShellPrefs();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("kandinsky-layout"));
  }
}

export function toggleShellMode(): void {
  setShellMode(shellMode.value === "notion" ? "classic" : "notion");
}

shellPart("shellMode", {
  get: () => ({ mode: shellMode.value }),
  set: (v) => {
    if (v && (v.mode === "notion" || v.mode === "classic")) {
      shellMode.value = v.mode;
      save(SHELL_MODE_KEY, v.mode);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("kandinsky-layout"));
      }
    }
  },
});
