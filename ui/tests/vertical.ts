import type { test as base } from "@playwright/test";

// The sidebar's Open section lists the open tabs only while two are open (or one hides behind another); with
// ui.tabs = "vertical" it lists a single one too. A spec that needs rows with one tab calls this once at its top: the
// config is shared by every spec of the run, so it is put back after each test.
const H = { "x-kandinsky": "1" };
export function verticalTabs(test: typeof base): void {
  let saved: unknown = null;
  test.beforeEach(async ({ request }) => {
    const cfg = (await (await request.get("/api/config", { headers: H })).json()).config;
    saved = cfg;
    await request.put("/api/config", { headers: H, data: { ...cfg, ui: { ...cfg.ui, tabs: "vertical" } } });
  });
  test.afterEach(async ({ request }) => {
    if (saved) await request.put("/api/config", { headers: H, data: saved });
    saved = null;
  });
}
