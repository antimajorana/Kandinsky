// The Email pane: the Svelte app mounted into the pane's host (docs/guides/PLUGIN-API.md, "A pane in Svelte"); with the
// arg RULES_DIALOG, the rules editor alone, as the pane's Rules… opens it in a dialog; with THUNDERBIRD_DIALOG, the
// Thunderbird import; with signinDialog(…), Outlook's sign-in.
import { mount, unmount } from "svelte";
import App from "./App.svelte";
import Rules from "./Rules.svelte";
import Thunderbird from "./Thunderbird.svelte";
import SignIn from "./SignIn.svelte";
import type { PluginApi } from "./api";
import { RULES_DIALOG, THUNDERBIRD_DIALOG, standIn } from "./rules-host";

export default function (host: HTMLElement, kandinsky: PluginApi) {
  if (kandinsky.arg === RULES_DIALOG) {
    const rules = mount(Rules, { target: host, props: { frame: "dialog", mail: standIn(kandinsky), onclose: () => kandinsky.pane?.close?.() } });
    return () => unmount(rules);
  }
  const dialog = (() => { try { return JSON.parse(String(kandinsky.arg ?? "")) as { dialog?: string; account?: string; record?: { name: string } }; } catch { return {}; } })();
  if (dialog.dialog === "signin") {
    const si = mount(SignIn, { target: host, props: { kandinsky, account: dialog.account, record: dialog.record, onclose: () => kandinsky.pane?.close?.() } });
    return () => unmount(si);
  }
  if (kandinsky.arg === THUNDERBIRD_DIALOG) {
    const tb = mount(Thunderbird, { target: host, props: { kandinsky, onclose: () => kandinsky.pane?.close?.() } });
    return () => unmount(tb);
  }
  host.style.height = "100%";
  const app = mount(App, { target: host, props: { kandinsky } });
  return () => unmount(app);
}
