import { test, expect } from "@playwright/test";

// The icon (docs/guides/ICON.md): the tab's icon is served and linked, and the sidebar's vault button names the vault.
test("the browser tab has Kandinsky's icon", async ({ page, request }) => {
  for (const [path, type] of [["/favicon.svg", "image/svg+xml"], ["/favicon.ico", "image/"], ["/apple-touch-icon.png", "image/png"]]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    expect(res.headers()["content-type"], path).toContain(type);
  }
  await page.goto("/");
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute("href", "/favicon.svg");
});

// The Notion sidebar's header button names the open vault (the classic bar's initial badge is retired).
test("the vault button names the open vault", async ({ page }) => {
  await page.goto("/");
  const btn = page.getByTestId("sidebar").locator(".vault-btn");
  await expect(btn).toBeVisible();
  const name = ((await btn.locator(".vault-name").textContent()) ?? "").trim();
  expect(name).not.toBe("");
  expect((await btn.getAttribute("title")) ?? "").toContain("switch vault");
});
