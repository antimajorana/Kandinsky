import { test, expect } from "@playwright/test";

// The window's first paint needs nothing but the page itself (ui/index.html): the app's background and a quiet
// "Opening Kandinsky…" while its scripts are still on their way. Here the scripts are held back until the page has
// been looked at, as a slow start would hold them — the window must never be an empty black or white.
test("the page paints the app's background and an opening line before any of its scripts has run", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route(/\.(m?js|ts)(\?.*)?$/, async (route) => { await held; await route.continue(); });
  await page.goto("/", { waitUntil: "commit" });
  const boot = page.getByTestId("boot");
  await expect(boot).toBeVisible();
  await expect(boot).toHaveText("Opening Kandinsky…");
  // the tests' vault is dark with the `plain` palette: its --bg-app (palettes.css), not black and not the browser's white
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(32, 32, 32)");
  release();
  // the app takes over: its shell, and the opening line gone
  await expect(page.getByText("Finish the GW notes.")).toBeVisible({ timeout: 20_000 });
  await expect(boot).toBeHidden();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
});
