import { test, expect, type Page } from "@playwright/test";

// The window's first paint needs nothing but the page itself (ui/index.html): the app's background and a quiet
// "Opening Kandinsky…" while its styles and scripts are still on their way. Here they are held back until the page has
// been looked at, as a slow start holds them — the window must never be an empty black or white.
async function holdAssets(page: Page): Promise<() => void> {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route(/\.(m?js|ts|css)(\?.*)?$/, async (route) => { await held; await route.continue(); });
  return release;
}
const bg = (page: Page, el: "html" | "body") =>
  page.evaluate((e) => getComputedStyle(e === "html" ? document.documentElement : document.body).backgroundColor, el);

test("the page paints the app's background and an opening line before any of its styles or scripts", async ({ page }) => {
  const release = await holdAssets(page);
  await page.goto("/", { waitUntil: "commit" });
  const boot = page.getByTestId("boot");
  await expect(boot).toHaveText("Opening Kandinsky…");
  await expect(boot).toBeVisible();
  // the tests' vault is dark with the `plain` palette: its --bg-app (palettes.css), not black, not the browser's white
  await expect.poll(() => bg(page, "html")).toBe("rgb(32, 32, 32)");
  expect(await bg(page, "body")).toBe("rgb(32, 32, 32)");
  release();
  // the app takes over: its shell, the opening line gone, the canvas in the palette's colour
  await expect(page.getByText("Finish the GW notes.")).toBeVisible({ timeout: 20_000 });
  await expect(boot).toBeHidden();
  await expect.poll(() => bg(page, "html")).toBe("rgb(32, 32, 32)");
});

test("a light theme kept in this browser starts light", async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("kandinsky.theme", "light"); } catch {} });
  const release = await holdAssets(page);
  await page.goto("/", { waitUntil: "commit" });
  await expect(page.getByTestId("boot")).toBeVisible();
  await expect.poll(() => bg(page, "html")).toBe("rgb(247, 247, 245)"); // `plain`'s light --bg-app
  release();
  await expect(page.getByText("Finish the GW notes.")).toBeVisible({ timeout: 20_000 });
});
