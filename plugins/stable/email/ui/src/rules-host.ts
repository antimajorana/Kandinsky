// What the rules editor needs (Rules.svelte): the pane's Mail, or the stand-in Settings and the Rules dialog give it.
import { call, type PluginApi } from "./api";
import { openMail } from "./open-mail";
import type { Mail } from "./store.svelte";

export type RulesHost = Pick<Mail, "call" | "search"> & {
  toast(text: string, kind?: "info" | "success" | "error"): void;
  kandinsky: { open(path: string, line?: number, opts?: { beside?: boolean }): void };
};

/** The editor's host outside the pane: the helper called directly, a search opening the pane on it. */
export const standIn = (kandinsky: PluginApi): RulesHost => ({
  call: <T>(method: string, params: Record<string, unknown> = {}, timeout = 120) => call<T>(kandinsky, method, params, timeout),
  search: (q: string) => openMail(kandinsky, { search: q }),
  toast: (text, kind = "info") => kandinsky.toast("Email", text, kind),
  kandinsky: { open: (path, line, opts) => kandinsky.open(path, line, opts) },
}) as RulesHost;

/** The pane's arg that opens the rules dialog (view.ts). */
export const RULES_DIALOG = JSON.stringify({ dialog: "rules" });

/** The pane's arg that opens the Thunderbird dialog (view.ts): its accounts as cards, its local mail as notes. */
export const THUNDERBIRD_DIALOG = JSON.stringify({ dialog: "thunderbird" });
