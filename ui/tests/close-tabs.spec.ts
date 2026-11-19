import { test, expect } from "@playwright/test";
import { openFile, runCommand } from "./open";

// "Close other tabs" and "Close all tabs" leave terminals open, Home opens when no tab is left, and Super+F is
// fullscreen.
test("Close all tabs keeps the terminals, and Home comes back when nothing is open", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  const sidebar = page.getByTestId("sidebar");
  const rows = (name: string) => sidebar.getByTestId("open-tabs").locator(".pane-row", { hasText: name });
  for (const f of ["journal.md", "notes/hubbard.md"]) {
    await openFile(page, f);
    await expect(page.locator(".cm-editor:visible").first()).toBeVisible();
  }
  await page.keyboard.press("Control+`");
  await expect(page.locator(".xterm").first()).toBeVisible();
  await expect(rows("journal")).toBeVisible();

  // the command (the Notion sidebar's tab menu no longer lists it); F1 does not reach the palette from inside a terminal
  await sidebar.getByRole("button", { name: "Home", exact: true }).click();
  await runCommand(page, "Close all tabs", "Close all tabs");
  await expect(rows("journal")).toHaveCount(0);
  await expect(rows("hubbard")).toHaveCount(0);
  await expect(page.locator(".dv-tab", { hasText: /Shell/ })).toHaveCount(1); // the terminal stays
  // nothing left to read: Home is opened by itself
  await expect(page.getByText("Finish the GW notes.")).toBeVisible();

  // Super+F: fullscreen, again: back (F11 is Zen mode now, which takes the sidebar away altogether)
  await page.locator(".cm-editor, .today, [data-testid=page]").first().click({ trial: true }).catch(() => {});
  const width = async () => (await sidebar.boundingBox())?.width ?? 0;
  await page.keyboard.press("Meta+f");
  await expect.poll(async () => (await width()) < 64).toBe(true);
  await page.keyboard.press("Meta+f");
  await expect.poll(width).toBeGreaterThan(64);
  await page.keyboard.press("F11");
  await expect.poll(width).toBe(0);
  await page.keyboard.press("F11");
  await expect.poll(width).toBeGreaterThan(64);
});
