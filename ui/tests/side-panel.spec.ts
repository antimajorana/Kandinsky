import { test, expect } from "@playwright/test";

test("power panels (Files, Search, Terminal) toggle cleanly as dock drawers without cluttering NotionSidebar", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  const sidebar = page.getByTestId("sidebar");

  // Meta+b collapses NotionSidebar, and Meta+Shift+f expands it back cleanly without "Open panes"
  await page.keyboard.press("Meta+b");
  await expect(sidebar).not.toHaveClass(/wide/);
  await page.keyboard.press("Meta+Shift+f");
  await expect(sidebar).toHaveClass(/wide/);
  await expect(sidebar.getByText("Open panes")).toHaveCount(0);

  // Control+Shift+F opens Search side pane in the dock and focuses the search box
  await page.keyboard.press("Control+Shift+F");
  await expect(page.locator(".dv-groupview .side-pane").first()).toBeVisible();
  await expect(page.getByTestId("side-head").getByRole("tab", { name: "Search" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".dv-groupview .side-pane input").first()).toBeFocused();
  await page.keyboard.press("Escape");

  // Meta+b hides and restores the dock side pane cleanly when open
  await page.keyboard.press("Meta+b");
  await expect(page.locator(".dv-groupview .side-pane").first()).toBeHidden();
  await page.keyboard.press("Meta+b");
  await expect(page.locator(".dv-groupview .side-pane").first()).toBeVisible();

  // Meta+j toggles Terminal drawer cleanly
  await page.keyboard.press("Meta+j");
  await expect(page.locator(".term-pane").first()).toBeVisible();
  await page.keyboard.press("Meta+j");
  await expect(page.locator(".term-pane").first()).toBeHidden();
});
