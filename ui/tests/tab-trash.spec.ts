import { test, expect } from "@playwright/test";

// A note can be deleted from its tab: the tab's menu moves it to the Trash.
const H = { "x-kandinsky": "1" };
// The tab is a row of the sidebar's Open section, which lists a lone tab only with vertical tabs.
// The config is shared by every spec of the run: it is put back after the test, whatever its outcome.
let savedConfig: unknown = null;
test.afterEach(async ({ request }) => {
  if (savedConfig) await request.put("/api/config", { headers: H, data: savedConfig });
  savedConfig = null;
});

test("a note's tab moves it to the Trash, after a yes, and closes", async ({ page, request }) => {
  await request.put("/api/file", { headers: H, data: { path: "notes/to-trash-from-tab.md", text: "# Bye\n" } });
  const cfg = (await (await request.get("/api/config", { headers: H })).json()).config;
  savedConfig = cfg;
  expect((await request.put("/api/config", { headers: H, data: { ...cfg, ui: { ...cfg.ui, tabs: "vertical" } } })).ok()).toBe(true);
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await page.keyboard.press("Control+p");
  await page.keyboard.type("to-trash-from-tab");
  await expect(page.getByTestId("palette").getByText(/to-trash-from-tab/).first()).toBeVisible();
  await page.keyboard.press("Enter");
  const tab = page.getByTestId("sidebar").getByTestId("open-tabs").locator(".pane-row", { hasText: "to-trash-from-tab" });
  await expect(tab).toHaveCount(1);
  await tab.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to Trash…" }).click();
  await page.getByTestId("palette").getByText("Move notes/to-trash-from-tab.md to the Trash").click();
  await expect(tab).toHaveCount(0);
  await expect.poll(async () => (await request.get("/api/file?path=notes/to-trash-from-tab.md", { headers: H })).status()).toBe(404);
});
