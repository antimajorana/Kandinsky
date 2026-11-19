import { expect, type APIRequestContext } from "@playwright/test";

// The sidebar's Open section lists a lone tab only with vertical tabs (ui.tabs). The config is shared by every spec
// of the run: this sets it and returns what puts it back.
export async function verticalTabs(request: APIRequestContext): Promise<() => Promise<unknown>> {
  const H = { "x-kandinsky": "1" };
  const cfg = (await (await request.get("/api/config", { headers: H })).json()).config;
  expect((await request.put("/api/config", { headers: H, data: { ...cfg, ui: { ...cfg.ui, tabs: "vertical" } } })).ok()).toBe(true);
  return () => request.put("/api/config", { headers: H, data: cfg });
}
