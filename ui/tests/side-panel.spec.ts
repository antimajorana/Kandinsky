import { test, expect } from "@playwright/test";

test("power panels (Files, Search, Terminal) toggle cleanly as dock drawers without cluttering NotionSidebar", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  const sidebar = page.getByTestId("sidebar");

  // Meta+Shift+F opens Files side pane in the dock alongside NotionSidebar
  await page.keyboard.press("Meta+Shift+f");
  await expect(page.locator(".dv-groupview .side-pane").first()).toBeVisible();
  await expect(sidebar.getByText("Open panes")).toHaveCount(0);

  // Control+Shift+F switches to Search and focuses the search box
  await page.keyboard.press("Control+Shift+F");
  await expect(page.getByTestId("side-head").getByRole("tab", { name: "Search" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".dv-groupview .side-pane input").first()).toBeFocused();
  await page.keyboard.press("Escape");

  // Meta+b hides and restores the dock side pane cleanly
  await page.keyboard.press("Meta+b");
  await expect(page.locator(".dv-groupview .side-pane")).toHaveCount(0);
  await page.keyboard.press("Meta+b");
  await expect(page.locator(".dv-groupview .side-pane").first()).toBeVisible();

  // Meta+j toggles Terminal drawer cleanly
  await page.keyboard.press("Meta+j");
  await expect(page.locator(".term-pane")).toBeVisible();
  await page.keyboard.press("Meta+j");
  await expect(page.locator(".term-pane")).toHaveCount(0);
});
