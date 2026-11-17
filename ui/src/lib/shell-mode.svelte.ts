// Unified Notion-style workspace shell: single primary experience (Sidebar, Hero, Inline Properties, Calm Topbar) with drawers & shortcuts for power tools.
import { save } from "./prefs";

export type ShellMode = "notion" | "classic";

export const SHELL_MODE_KEY = "kandinsky.shellMode";

export const shellMode = $state<{ value: ShellMode }>({
  value: "notion",
});

export const isNotionShell = (): boolean => true;

export function setShellMode(_mode: ShellMode): void {
  shellMode.value = "notion";
  save(SHELL_MODE_KEY, "notion");
}

export function toggleShellMode(): void {
  setShellMode("notion");
}
