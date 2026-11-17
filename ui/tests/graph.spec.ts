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
  // the layout settles around the centre: hovering it finds a note
  await page.waitForTimeout(1500);
  const box = (await page.getByTestId("graph-canvas").boundingBox())!;
  const pts: [number, number][] = [];
  for (let dx = -252; dx <= 252; dx += 14) {
    for (let dy = -196; dy <= 196; dy += 14) pts.push([dx, dy]);
  }
  pts.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
  let found = false;
  for (const [dx, dy] of pts) {
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
    if (await pane.locator(".tip").isVisible()) {
      found = true;
      break;
    }
  }
  expect(found).toBe(true);
  await expect(pane.locator(".tip")).toContainText("click to open");
});
