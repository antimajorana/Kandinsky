// Typewriter scrolling for the CodeMirror note editor: `[editor] typewriter` turns it on for every note (mdOptions in
// note-extensions.ts), the page menu's "Typewriter mode" for one editor. Both use the same scroll-margins extension.
import { Compartment, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/** Typewriter scrolling: the caret's line stays at mid-height. Done with scroll margins, so CodeMirror's
 *  own scroll-into-view keeps the caret in a one-line band at the middle — one scroll per keystroke, in
 *  the same frame (a second, centring scroll a frame later made the text rattle). A click does not
 *  scroll; the padding lets the last lines reach the middle. */
export const typewriter: Extension = [
  EditorView.scrollMargins.of((view) => {
    // a selection being made (a drag, Shift+arrows) keeps its end where it is: only a caret is held at mid-height
    if (!view.state.selection.main.empty) return null;
    // CodeMirror shows a tooltip only inside the editor less these margins: with a list open (completions, snippets,
    // a hover) the one-line band hid every list under the caret; while one is up the caret is not held mid-height
    if (view.dom.querySelector(".cm-tooltip")) return null;
    const m = Math.max(0, view.scrollDOM.clientHeight / 2 - view.defaultLineHeight);
    return { top: m, bottom: m };
  }),
  EditorView.theme({ ".cm-content": { paddingBottom: "50vh" } }),
];

// the page menu's per-editor toggle; empty until it is switched on (each editor state holds its own content)
const menuSlot = new Compartment();
let listenerInstalled = false;

export function installZenScrollListener(): void {
  if (listenerInstalled || typeof window === "undefined") return;
  listenerInstalled = true;
  window.addEventListener("kandinsky:toggle-typewriter", (ev: Event) => {
    const detail = (ev as CustomEvent<{ view?: EditorView | null; enabled?: boolean }>).detail;
    const view = detail?.view;
    if (!view || menuSlot.get(view.state) === undefined) return;
    const enabled = detail.enabled === true;
    view.dispatch({ effects: menuSlot.reconfigure(enabled ? typewriter : []), scrollIntoView: enabled });
  });
}

export function zenScrollExtension(): Extension {
  installZenScrollListener();
  return menuSlot.of([]);
}
