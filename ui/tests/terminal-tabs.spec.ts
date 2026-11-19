import { test, expect } from "@playwright/test";

// VS Code: several terminals as tabs (the terminal group's +), renamed by
// double-clicking the tab; the name survives a reload (it lives in the pane's spec, saved with the layout).
test("terminals: + opens another, double-click renames, the name survives a reload", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+`");
  await expect(page.locator(".xterm").first()).toBeVisible();
  // the terminal group's + starts another shell; a Claude session is the palette's command (as many as wanted)
  const tab = (name: string | RegExp) => page.locator(".dv-tab", { hasText: name });
  await page.getByRole("button", { name: "New terminal" }).click();
  await expect(tab(/Shell/)).toHaveCount(2);
  for (const n of [1, 2]) {
    await page.keyboard.press("Meta+e"); // Super keys reach the app from a terminal
    await page.keyboard.type("New AI agent session");
    await page.keyboard.press("Enter");
    await expect(tab(/Claude/)).toHaveCount(n);
  }
  await tab("Shell 2").dblclick();
  const name = page.getByRole("textbox", { name: "Terminal name" });
  await expect(name).toBeFocused();
  await name.fill("build");
  await name.press("Enter");
  await expect(tab("build")).toBeVisible();
  await page.waitForTimeout(800); // the layout save is debounced
  await page.reload();
  await expect(tab("build")).toBeVisible();
});
