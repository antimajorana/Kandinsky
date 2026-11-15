// A link to a web page: with
// `[web] open_links = "tab"`, a tab of Kandinsky when the site lets itself be shown inside another page, else Kandinsky's
// browsing window — a site that forbids framing would be a blank tab. The core asks the site (web_frame.rs); the answer
// is kept per site for the session. In the desktop app every site is a tab: on Linux a native view (kandinsky-app webtab.rs), on Windows an iframe whose
// forbidding headers the app's WebView2 extension removes (kandinsky-app main.rs `frame_any_extension`). "window" and "browser" go straight to window.open, which the app routes.
import { api, ownCore } from "./api";
import { open } from "./dock";
import { settings } from "./settings.svelte";

const sites = new Map<string, Promise<boolean>>();
/** The desktop app's window frames any site: on Windows its WebView2 extension, on Linux its libsoup hook removes the
 *  headers that forbid it for Kandinsky's own page (kandinsky-app main.rs). */
export const framesAnything = !!(globalThis as unknown as { __kandinskyFramesAnything?: boolean }).__kandinskyFramesAnything;
/** The desktop app's window (kandinsky-app main.rs says so before the page runs), not a plain browser. */
const desktopApp = !!(globalThis as unknown as { __kandinskyDesktop?: boolean }).__kandinskyDesktop;
const nativeTabs = !!(globalThis as unknown as { webkit?: { messageHandlers?: { kandinskyWeb?: unknown } } }).webkit?.messageHandlers?.kandinskyWeb;

/** A web tab uses the native view (Linux, kandinsky-app webtab.rs) only when there is no hook, or `[web] tab_view = "native"`. */
export const nativeTabView = (): boolean => nativeTabs && (!framesAnything || settings.config?.web?.tab_view === "native");

/** The system's browser, whatever `[web] open_links` says (Shift+click, "Open in the browser"): through the desktop's
 *  core, since the desktop window turns every window.open into a tab of Kandinsky; in a plain browser (or a server that
 *  refuses) window.open, which is a tab of that browser. */
export async function openOutside(url: string): Promise<void> {
  try { await ownCore("POST", "/api/open-outside", { url }); } catch { window.open(url, "_blank", "noopener"); }
}

export function openWeb(url: string): void {
  // a DOI is a paper: its note, or the offer to file it (doi-links.ts); the page itself when that cannot be done
  if (/doi\.org\/10\.|^doi:/i.test(url)) {
    void import("./doi-links").then(async (m) => { const doi = m.doiOf(url); if (!doi || !(await m.openDoi(doi))) openPage(url); });
    return;
  }
  // a file on a server Kandinsky browses (a copyparty link): that file in Kandinsky, as the explorer opens it
  if (owned?.(url)) return;
  openPage(url);
}

// who claims an address before it opens as a page: the file sources (file-sources.svelte.ts), set when they load. A
// synchronous check, so a page that opens anyway still opens within the click (a browser blocks a late window.open).
let owned: ((url: string) => boolean) | null = null;
export const claimLinks = (fn: (url: string) => boolean): void => { owned = fn; };

/** A web page in Kandinsky (a tab or its browsing window, `[web] open_links`). */
export function openPage(url: string): void {
  let host = "";
  try { host = new URL(url).host; } catch { return void window.open(url, "_blank", "noopener"); }
  if (!/^https?:/i.test(url)) return void window.open(url, "_blank", "noopener"); // mailto: and the like: their handler
  // Kandinsky in a plain browser (a vault on a server): a tab of that browser, as any web page's links
  if (!desktopApp) return void window.open(url, "_blank", "noopener");
  if ((settings.config?.web?.open_links ?? "tab") !== "tab") return void window.open(url, "_blank", "noopener");
  // the desktop app shows any site in a tab (a view of its own over the pane, panes/Web.svelte), framing allowed or not
  if (nativeTabs || framesAnything) return void open({ kind: "web", url });
  // a failed ask (the core restarting) opens a window this time and is asked again next time, not kept as the answer
  if (!sites.has(host)) sites.set(host, api.webFrameable(url).catch(() => (sites.delete(host), false)));
  void sites.get(host)!.then((ok) => (ok ? open({ kind: "web", url }) : void window.open(url, "_blank", "noopener")));
}
