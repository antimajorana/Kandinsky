import { mount, unmount } from "svelte";
import type { EditorView } from "@codemirror/view";
import InlineProperties from "../components/InlineProperties.svelte";

export interface InlinePropsHost {
  el: HTMLElement;
  update: (text: string, view: () => EditorView | null, onopen?: (target: string) => void) => void;
  destroy: () => void;
}

export function createInlinePropsHost(
  initialText: string,
  initialView: () => EditorView | null,
  onopen?: (target: string) => void,
): InlinePropsHost {
  const el = document.createElement("div");
  el.className = "cm-notion-inline-props";
  const state = $state({ text: initialText, view: initialView, onopen: onopen ?? (() => {}) });
  const app = mount(InlineProperties, { target: el, props: state });
  const ro = new ResizeObserver(() => state.view()?.requestMeasure());
  ro.observe(el);
  return {
    el,
    update(text, view, open) {
      state.text = text;
      state.view = view;
      state.onopen = open ?? (() => {});
    },
    destroy() {
      ro.disconnect();
      void unmount(app);
    },
  };
}
