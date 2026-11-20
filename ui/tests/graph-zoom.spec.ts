import { test, expect, type Page } from "@playwright/test";

// The graph zooms under the pointer: a wheel, and Ctrl+wheel (a touchpad's pinch arrives so) — the graph's own camera,
// not the pane's text size (pane-zoom.ts hears Ctrl+wheel only when no pane took it). The canvas says its scale as
// drawn (`data-zoom`), and the zoom stays while the layout keeps moving.
const zoom = async (page: Page) => Number(await page.getByTestId("graph-canvas").getAttribute("data-zoom"));

test("the graph zooms in and out with the wheel and with Ctrl+wheel, and keeps that zoom", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await page.getByRole("button", { name: "Graph", exact: true }).first().click();
  const pane = page.locator(".graph-pane");
  await expect(pane.locator(".meta")).toHaveText(/[1-9]\d* nodes/);
  const canvas = page.getByTestId("graph-canvas");
  await expect(canvas).toHaveAttribute("data-zoom", /\d/);
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const headerFont = await pane.locator("header").evaluate((e) => getComputedStyle(e).fontSize);

  const start = await zoom(page);
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -200); // in
  await expect.poll(() => zoom(page)).toBeGreaterThan(start * 1.5);
  const zoomedIn = await zoom(page);
  await page.waitForTimeout(1500); // the layout runs on: the reader's zoom is kept, not fitted again
  expect(await zoom(page)).toBeCloseTo(zoomedIn, 3);
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 200); // out
  await expect.poll(() => zoom(page)).toBeLessThan(zoomedIn / 1.5);

  // Ctrl+wheel (a pinch): the graph again, and the pane's text keeps its size
  const before = await zoom(page);
  await page.keyboard.down("Control");
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -200);
  await page.keyboard.up("Control");
  await expect.poll(() => zoom(page)).toBeGreaterThan(before * 1.5);
  expect(await pane.locator("header").evaluate((e) => getComputedStyle(e).fontSize)).toBe(headerFont);

  // Fit brings the whole graph back into view: out again from the pinched-in zoom
  const pinched = await zoom(page);
  await pane.getByRole("button", { name: "Fit" }).click();
  await expect.poll(() => zoom(page)).toBeLessThan(pinched / 1.5);
});
