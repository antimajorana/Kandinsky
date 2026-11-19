import { test, expect } from "@playwright/test";
import { openFile } from "./open";

// Touch screens everywhere: a long press is a right click (lib/touch.ts) — a tab's menu
// opens under the finger — and the targets grow to a finger's size on a touch screen (styles/touch.css).
const H = { "x-kandinsky": "1" };
// the sidebar lists a single open tab only with vertical tabs; the config is shared by every spec of the run, so it is put back
let savedConfig: unknown = null;
test.afterEach(async ({ request }) => {
  if (savedConfig) await request.put("/api/config", { headers: H, data: savedConfig });
  savedConfig = null;
});
const verticalTabs = async (request: import("@playwright/test").APIRequestContext) => {
  const cfg = (await (await request.get("/api/config", { headers: H })).json()).config;
  savedConfig = cfg;
  expect((await request.put("/api/config", { headers: H, data: { ...cfg, ui: { ...cfg.ui, tabs: "vertical" } } })).ok()).toBe(true);
};
test.use({ hasTouch: true });

test("a long press on a tab opens its menu, as a right click does", async ({ page, request }) => {
  await verticalTabs(request);
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await openFile(page, "journal.md");
  const row = page.getByTestId("sidebar").getByTestId("open-tabs").locator(".pane-row", { hasText: "journal" }).locator(".pane-main");
  await expect(row).toBeVisible();
  const b = (await row.boundingBox())!;
  const at = { x: b.x + 30, y: b.y + b.height / 2 };
  await row.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true, clientX: at.x, clientY: at.y, button: 0 });
  await page.waitForTimeout(700);
  await expect(page.getByRole("menuitem", { name: /^Pin/ })).toBeVisible();
  await row.dispatchEvent("pointerup", { pointerType: "touch", isPrimary: true, clientX: at.x, clientY: at.y });
});
