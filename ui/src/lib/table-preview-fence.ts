// Read-only ```table-preview and ```tsv-preview code fences for .tsv / .csv / .dat tabular transclusion.
import { mount, unmount, type Component } from "svelte";
import { registerFence } from "./fences";

function mountTableFence(host: HTMLElement, source: string, doc: string, info = ""): () => void {
  let app: ReturnType<typeof mount> | undefined;
  let gone = false;
  void import("../components/blocks/TablePreviewBlock.svelte").then((m) => {
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

for (const name of ["table-preview", "tsv-preview"]) {
  registerFence("kandinsky", name, (host, fence) =>
    mountTableFence(host, fence.source, fence.path, fence.info ?? ""),
  );
}
