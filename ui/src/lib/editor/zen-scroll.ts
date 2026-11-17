// Zen typewriter vertical cursor centering for the CodeMirror note editor.
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { settings } from "../settings.svelte";

const enabledViews = new WeakSet<EditorView>();
let listenerInstalled = false;

function centerCursor(view: EditorView): void {
  const head = view.state.selection.main.head;
  const coords = view.coordsAtPos(head);
  if (!coords) return;
  const scroller = view.scrollDOM;
  const rect = scroller.getBoundingClientRect();
  if (!rect.height) return;
  const targetY = rect.top + rect.height * 0.45;
  const delta = coords.top - targetY;
  if (Math.abs(delta) > 8) {
    scroller.scrollBy({ top: delta, behavior: "smooth" });
  }
}

export function installZenScrollListener(): void {
  if (listenerInstalled || typeof window === "undefined") return;
  listenerInstalled = true;
  window.addEventListener("kandinsky:toggle-typewriter", (ev: Event) => {
    const detail = (ev as CustomEvent<{ view?: EditorView | null; enabled?: boolean }>).detail;
    if (!detail?.view) return;
    if (detail.enabled) {
      enabledViews.add(detail.view);
      centerCursor(detail.view);
    } else {
      enabledViews.delete(detail.view);
    }
  });
}

export function zenScrollExtension(): Extension {
  installZenScrollListener();
  return EditorView.updateListener.of((u) => {
    if (!u.docChanged && !u.selectionSet) return;
    const cfgOn = settings.config?.editor.typewriter === true;
    if (enabledViews.has(u.view) || cfgOn) {
      requestAnimationFrame(() => centerCursor(u.view));
    }
  });
}
