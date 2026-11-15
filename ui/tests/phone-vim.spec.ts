import { test, expect } from "@playwright/test";

// No Vim on mobile: in the phone app (a fake KandinskyNative bridge) a
// note is plain typing even when the vault's setting has Vim on — `x` is a letter, not "delete a character".
test.use({ viewport: { width: 412, height: 760 }, hasTouch: true });

test("no Vim in the phone app: typing in a note inserts what is typed", async ({ page, request }) => {
  await request.put("/api/file", { headers: { "x-kandinsky": "1" }, data: { path: "phone-vim.md", text: "abc\n" } });
  await page.addInitScript(() => { (window as unknown as { KandinskyNative: unknown }).KandinskyNative = { ready() {}, tabs() {} }; });
  await page.goto("/");
  await page.waitForFunction(() => "kandinskyShell" in window);
  await page.evaluate(() => (window as unknown as { kandinskyShell: { view(k: string): void } }).kandinskyShell.view("files"));
  const pf = page.locator(".pf");
  await pf.locator(".row", { hasText: "phone-vim" }).click();
  const content = page.locator(".cm-content").filter({ hasText: "abc" }).first();
  await expect(content).toBeVisible();
  await content.click();
  await page.keyboard.press("End");
  await page.keyboard.type("xyz");
  await expect(content).toContainText("abcxyz");
  await expect(page.locator(".cm-vimMode, .cm-fat-cursor")).toHaveCount(0);
});
