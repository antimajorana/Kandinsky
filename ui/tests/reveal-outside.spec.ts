import { test, expect, type APIRequestContext } from "@playwright/test";

// A tab's menu shows its file in Kandinsky's explorer and in the system's file manager; the
// latter is the desktop core's alone (the test core runs with KANDINSKY_NO_BROWSER: nothing is launched).
const H = { "x-kandinsky": "1" };

// The sidebar's Open section lists a lone tab only with vertical tabs; the config is shared by every spec of the run, so it is
// put back after the test, whatever its outcome.
let savedConfig: unknown = null;
async function verticalTabs(request: APIRequestContext) {
  const cfg = (await (await request.get("/api/config", { headers: H })).json()).config;
  savedConfig = cfg;
  expect((await request.put("/api/config", { headers: H, data: { ...cfg, ui: { ...cfg.ui, tabs: "vertical" } } })).ok()).toBe(true);
}
test.afterEach(async ({ request }) => {
  if (savedConfig) await request.put("/api/config", { headers: H, data: savedConfig });
  savedConfig = null;
});

test("a tab's menu: show in the explorer, show in the system's file manager", async ({ page, request }) => {
  await verticalTabs(request);
  await request.put("/api/file", { headers: H, data: { path: "reveal/out.md", text: "# out\n" } });
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await page.evaluate(() => (window as unknown as { __kandinsky: { open(p: string): void } }).__kandinsky.open("reveal/out.md"));
  // the tab is a row of the sidebar's Open section
  await page.getByTestId("sidebar").getByTestId("open-tabs").locator(".pane-row", { hasText: "out" }).first().click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Show in the explorer" })).toBeVisible();
  const outside = page.getByRole("menuitem", { name: "Show in the system's file manager" });
  await expect(outside).toBeVisible();
  const call = page.waitForResponse((r) => r.url().includes("/api/fs/reveal-outside"));
  await outside.click();
  expect((await call).status()).toBe(204);
  await request.post("/api/fs/trash?path=reveal", { headers: H });
});
