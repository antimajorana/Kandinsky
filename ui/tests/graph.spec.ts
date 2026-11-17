import { test, expect } from "@playwright/test";
import { openFile } from "./open";

test("graph of notes: counts, local neighbourhood of the active note, hover shows the note", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await openFile(page, "hubbard.md");
  await expect(page.locator(".cm-content")).toContainText("Energy");
  await page.keyboard.press("Meta+Shift+G");
  const pane = page.locator(".graph-pane");
  await expect(pane.locator(".meta")).toHaveText(/[1-9]\d* nodes · [1-9]\d* links/); // loaded, not the initial 0
  const links = Number((await pane.locator(".meta").textContent())!.match(/(\d+) links/)![1]);
  expect(links).toBeGreaterThanOrEqual(4); // related→hubbard, journal→hubbard, l1/l2→Topic
  // Orphans off: only notes with a link, the links all kept
  const all = Number((await pane.locator(".meta").textContent())!.match(/(\d+) nodes/)![1]);
  await pane.getByTestId("graph-hide-orphans").click();
  await expect(pane.locator(".meta")).toHaveText(new RegExp(` nodes · ${links} links`));
  expect(Number((await pane.locator(".meta").textContent())!.match(/(\d+) nodes/)![1])).toBeLessThan(all);
  await pane.getByTestId("graph-hide-orphans").click();
  // Local: hubbard.md and the two notes that link to it
  await pane.getByTestId("graph-local-toggle").click();
  await expect(pane.locator(".meta")).toHaveText("3 nodes · 2 links");
  // the layout settles around the centre: sample drawn canvas pixels to hover a node cleanly
  await page.waitForTimeout(1500);
  const canvas = page.getByTestId("graph-canvas");
  const box = (await canvas.boundingBox())!;
  const pts = await canvas.evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext("2d");
    const rect = c.getBoundingClientRect();
    if (!ctx || !rect.width || !rect.height) return [] as [number, number][];
    const img = ctx.getImageData(0, 0, c.width, c.height).data;
    const bgR = img[0], bgG = img[1], bgB = img[2];
    const sx = c.width / rect.width, sy = c.height / rect.height;
    const hits: [number, number][] = [];
    for (let cy = 12; cy < rect.height - 12; cy += 10) {
      for (let cx = 12; cx < rect.width - 12; cx += 10) {
        const px = Math.min(c.width - 1, Math.round(cx * sx));
        const py = Math.min(c.height - 1, Math.round(cy * sy));
        const i = (py * c.width + px) * 4;
        const diff = Math.abs(img[i] - bgR) + Math.abs(img[i + 1] - bgG) + Math.abs(img[i + 2] - bgB);
        if (diff > 36) hits.push([cx, cy]);
      }
    }
    const midX = rect.width / 2, midY = rect.height / 2;
    hits.sort((a, b) => (a[0] - midX) ** 2 + (a[1] - midY) ** 2 - ((b[0] - midX) ** 2 + (b[1] - midY) ** 2));
    return hits.slice(0, 80);
  });
  let found = false;
  for (const [cx, cy] of pts) {
    await page.mouse.move(box.x + cx, box.y + cy);
    if (await pane.locator(".tip").isVisible()) {
      found = true;
      break;
    }
  }
  expect(found).toBe(true);
  await expect(pane.locator(".tip")).toContainText("click to open");
});
