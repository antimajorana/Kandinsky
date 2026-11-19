import { test, expect, type APIRequestContext } from "@playwright/test";

// A device that keeps its own look (off by default: Settings > Appearance turns it on) draws the same in every vault it
// opens, and a vault whose own `[ui]` says otherwise (another scheme in its file) no longer changes this screen (device-look.svelte.ts).
const H = { "x-kandinsky": "1" };
const cfg = async (request: APIRequestContext) => (await (await request.get("/api/config", { headers: H })).json()).config;
const put = async (request: APIRequestContext, ui: Record<string, string>) => {
  const c = await cfg(request);
  Object.assign(c.ui, ui);
  expect((await request.put("/api/config", { headers: H, data: c })).ok()).toBe(true);
};

let before: Record<string, string> | undefined;
test.beforeAll(async ({ request }) => { const c = await cfg(request); before = { theme: c.ui.theme, palette: c.ui.palette }; });
test.afterAll(async ({ request }) => { if (before) await put(request, before); });

test("a vault's own scheme does not change the device's look", async ({ page, request }) => {
  await put(request, { theme: "dark", palette: "kandinsky" });
  // this device keeps its own look, as the setting does once turned on
  await page.addInitScript(() => localStorage.setItem("kandinsky.device-look.v1", JSON.stringify({ own: true, ui: { theme: "dark", palette: "kandinsky" } })));
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  const bg = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim());
  const first = await bg();
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("kandinsky.device-look.v1") ?? "{}"));
  expect(kept).toMatchObject({ own: true, ui: { theme: "dark", palette: "kandinsky" } });

  await put(request, { palette: "sea" }); // as another vault with its own scheme would say
  await page.waitForTimeout(1500); // the config reaches the page (a watched file)
  expect(await bg(), "the device's look stays").toBe(first);
  await page.reload();
  await page.getByText("Finish the GW notes.").waitFor();
  expect(await bg(), "also when the page is drawn again").toBe(first);
});
