import type { APIRequestContext } from "@playwright/test";

const H = { "x-kandinsky": "1" };

// The Notion sidebar lists the open tabs (its "Open" section) only with two tabs open, or always with vertical tabs:
// a spec that needs a row for a single tab turns vertical tabs on and puts the config back afterwards.
export async function verticalTabs(request: APIRequestContext): Promise<() => Promise<void>> {
  const cfg = (await (await request.get("/api/config", { headers: H })).json()).config;
  await request.put("/api/config", { headers: H, data: { ...cfg, ui: { ...cfg.ui, tabs: "vertical" } } });
  return async () => { await request.put("/api/config", { headers: H, data: cfg }); };
}
