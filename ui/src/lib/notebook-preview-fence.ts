// Read-only ```notebook-preview and ```nb-preview code fences for .ipynb transclusion.
import { mount, unmount, type Component } from "svelte";
import { registerFence } from "./fences";

function mountNotebookFence(host: HTMLElement, source: string, doc: string, info = ""): () => void {
  let app: ReturnType<typeof mount> | undefined;
  let gone = false;
  void import("../components/blocks/NotebookPreviewBlock.svelte").then((m) => {
    if (!gone) {
      app = mount(m.default as Component<{ source?: string; doc?: string; info?: string }>, {
        target: host,
        props: { source, doc, info },
      });
    }
  });
  return () => {
    gone = true;
    if (app) void unmount(app);
  };
}

for (const name of ["notebook-preview", "nb-preview"]) {
  registerFence("kandinsky", name, (host, fence) =>
    mountNotebookFence(host, fence.source, fence.path, fence.info ?? ""),
  );
}
