// Opening the Email pane from anywhere (a command, a block, the rules dialog), with what it should show.
import type { PluginApi } from "./api";

/** `detail`: `{ search }`, `{ compose }`… The pane opened now reads it when it mounts; one already open hears it. */
export function openMail(kandinsky: PluginApi, detail: Record<string, unknown> = {}): void {
  (window as unknown as { __kandinskyEmailOpen?: unknown }).__kandinskyEmailOpen = detail;
  kandinsky.openView(undefined, { title: "Email", icon: "mail" });
  setTimeout(() => window.dispatchEvent(new CustomEvent("kandinsky-email:open", { detail })), 0);
}
