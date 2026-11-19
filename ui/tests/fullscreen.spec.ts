import { test, expect, type Page, type Locator } from "@playwright/test";
import { openFile } from "./open";

// "we need also a fullscreen mode for both the terminal and the main editor window": Super+F gives the
// tab that has the keys the whole window (lib/fullscreen.svelte.ts); the same key again puts the layout back.
// (F11 is Zen mode now, which hides the sidebar altogether.)
const FULL = "Meta+f";
const H = { "x-kandinsky": "1" };
const box = async (l: Locator) => (await l.boundingBox())!;
/** the icon strip's own button: hovering the strip does not open the bar in fullscreen */
const openBar = (page: Page) => page.getByTestId("sidebar").getByTestId("sidebar-toggle").click();

// the config is shared by every spec of the run: what a test changed is put back
let savedConfig: unknown = null;
test.afterEach(async ({ request }) => {
  if (savedConfig) await request.put("/api/config", { headers: H, data: savedConfig });
  savedConfig = null;
});

test("Super+F gives the editor, then the terminal, the whole window, and puts the layout back", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await openFile(page, "journal.md");
  const editor = page.locator(".cm-editor:visible").first(), sidebar = page.getByTestId("sidebar");
  await expect(editor).toBeVisible();
  await page.keyboard.press("Control+`");
  const term = page.locator(".xterm:visible").first();
  await expect(term).toBeVisible();
  const view = page.viewportSize()!, before = await box(term);

  // the terminal has the keys: it takes the window, the editor is out of the way and the left bar
  // shrinks to its icons ("i want the compact side bar to show up, and make it full when i move the mouse over there")
  await page.keyboard.press(FULL);
  await expect.poll(async () => (await box(sidebar)).width).toBeLessThan(64);
  await expect.poll(async () => (await box(term)).height).toBeGreaterThan(view.height - 80);
  await expect.poll(async () => (await box(term)).width).toBeGreaterThan(view.width - 100);
  await expect(editor).toBeHidden();
  // hovering does NOT open it ("not automatic"); its button does, over the pane, and the terminal keeps its size
  // (no reflow of what runs in it); the pointer leaving puts it away
  const full = await box(term);
  await page.mouse.move(view.width - 20, view.height / 2);
  await sidebar.hover();
  await page.waitForTimeout(600);
  expect((await box(sidebar)).width).toBeLessThan(64);
  await openBar(page);
  await expect.poll(async () => (await box(sidebar)).width).toBeGreaterThan(150);
  expect(Math.round((await box(term)).width)).toBe(Math.round(full.width));
  await page.mouse.move(view.width - 20, view.height / 2);
  await expect.poll(async () => (await box(sidebar)).width).toBeLessThan(64);
  // no frame round the one pane (it took the accent's tint from the split's active-group border)
  // — none drawn: either no width (the paper shape's `border: 0`, whose colour is then the text's) or no colour (cards)
  const border = await page.locator(".dv-groupview:visible").first().evaluate((g) => { const c = getComputedStyle(g); return c.borderTopWidth === "0px" ? "none" : c.borderTopColor; });
  expect(["none", "rgba(0, 0, 0, 0)"]).toContain(border);
  await page.keyboard.press(FULL);
  await expect.poll(async () => (await box(sidebar)).width).toBeGreaterThan(150);
  await expect(editor).toBeVisible();
  await expect.poll(async () => Math.round((await box(term)).height)).toBe(Math.round(before.height));

  // the same key in the editor
  await editor.locator(".cm-content").click();
  await page.keyboard.press(FULL);
  await expect.poll(async () => (await box(sidebar)).width).toBeLessThan(64);
  await expect(term).toBeHidden();
  await expect.poll(async () => (await box(editor)).height).toBeGreaterThan(view.height - 80);
  // a reload does not come back locked in fullscreen
  await page.waitForTimeout(800);
  await page.reload();
  await expect(sidebar).toBeVisible();
});

// "if i am in fullscreen and change to a terminal, keep fullscreen but in the terminal" · "and viceversa"
test("fullscreen follows the keys: editor → terminal → editor stays fullscreen", async ({ page, request }) => {
  // the sidebar's Open section lists a single open tab (journal) only with vertical tabs
  const cfg = (await (await request.get("/api/config", { headers: H })).json()).config;
  savedConfig = cfg;
  expect((await request.put("/api/config", { headers: H, data: { ...cfg, ui: { ...cfg.ui, tabs: "vertical" } } })).ok()).toBe(true);
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await openFile(page, "journal.md");
  const editor = page.locator(".cm-editor:visible").first(), sidebar = page.getByTestId("sidebar");
  await expect(editor).toBeVisible();
  await page.keyboard.press("Control+`"); // a terminal exists (and has the keys)…
  const term = page.locator(".xterm:visible").first();
  await expect(term).toBeVisible();
  await editor.locator(".cm-content").click(); // …then back to the editor
  const view = page.viewportSize()!;
  await page.keyboard.press(FULL);
  await expect.poll(async () => (await box(editor)).height).toBeGreaterThan(view.height - 80);

  await page.keyboard.press("Control+`"); // to the terminal: it takes the window, still fullscreen
  await expect(term).toBeVisible();
  await expect.poll(async () => (await box(term)).height).toBeGreaterThan(view.height - 80);
  await expect(editor).toBeHidden();
  await expect.poll(async () => (await box(sidebar)).width).toBeLessThan(64);

  // and back through the sidebar's tab (opened by its button; the pointer leaving puts it away)
  await openBar(page);
  await sidebar.getByTestId("open-tabs").locator(".pane-row", { hasText: "journal" }).locator(".pane-main").click();
  await expect(page.locator(".cm-editor:visible").first()).toBeVisible();
  await expect.poll(async () => (await box(page.locator(".cm-editor:visible").first())).height).toBeGreaterThan(view.height - 80);
  await expect(term).toBeHidden();
  await page.mouse.move(view.width - 20, view.height / 2);
  await expect.poll(async () => (await box(sidebar)).width).toBeLessThan(64);

  await page.keyboard.press(FULL); // and the same key still puts the layout back
  await expect.poll(async () => (await box(sidebar)).width).toBeGreaterThan(150);
  await expect(term).toBeVisible();
});

// Fullscreen keeps a split, and a small button unsplits it: two editors side by side are two badged rows of the
// sidebar's Open section; fullscreen keeps both on screen; the section's button makes them one editor again
test("a split is two badged rows of the open tabs, fullscreen keeps it, and its button unsplits", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  for (const f of ["journal.md", "paste.md"]) {
    await openFile(page, f);
    await expect(page.locator(".cm-editor:visible").first()).toBeVisible();
  }
  const sidebar = page.getByTestId("sidebar");
  const open = sidebar.getByTestId("open-tabs");
  await open.locator(".pane-row", { hasText: "paste" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Split right" }).click();
  await expect(open.locator(".split-badge")).toHaveCount(2);
  await expect(page.locator(".cm-editor:visible")).toHaveCount(2);
  await expect(open, "one Open section, not one per split").toHaveCount(1);

  await page.locator(".cm-editor:visible").first().locator(".cm-content").click();
  await page.keyboard.press(FULL);
  await expect.poll(async () => (await box(sidebar)).width).toBeLessThan(64);
  await expect(page.locator(".cm-editor:visible"), "both halves stay").toHaveCount(2);
  await page.keyboard.press(FULL);
  await expect.poll(async () => (await box(sidebar)).width).toBeGreaterThan(150);

  await open.getByRole("button", { name: "Unsplit" }).click();
  await expect(open.locator(".split-badge")).toHaveCount(0);
  await expect(page.locator(".cm-editor:visible")).toHaveCount(1);
  await expect(open.locator(".pane-row", { hasText: "journal" })).toHaveCount(1);
  await expect(open.locator(".pane-row", { hasText: "paste" })).toHaveCount(1);
});
