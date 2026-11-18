import { test, expect, type APIRequestContext } from "@playwright/test";
import { openFile } from "./open";

// Typewriter scrolling is the scroll-margins band only: no second, smooth centring scroll after it, so a click
// (which does not ask to scroll) leaves the view where it is.
const H = { "x-kandinsky": "1" };
async function setTypewriter(request: APIRequestContext, on: boolean) {
  const d = await (await request.get("/api/config", { headers: H })).json();
  d.config.editor.typewriter = on;
  expect((await request.put("/api/config", { headers: H, data: d.config })).ok()).toBeTruthy();
}
test.afterEach(async ({ request }) => { await setTypewriter(request, false); });

test("with typewriter scrolling a click on a line does not scroll the note", async ({ page, request }) => {
  const path = "notes/fix-typewriter-click.md";
  await request.put("/api/file", { headers: H, data: { path, text: Array.from({ length: 160 }, (_, i) => `Row ${i + 1} of a long note.`).join("\n\n") + "\n" } });
  await setTypewriter(request, true);
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await openFile(page, "fix-typewriter-click.md");
  const scroller = page.locator(".cm-scroller").first();
  await expect(page.locator(".cm-content")).toContainText("Row 1 of a long note.");
  const pane = (await scroller.boundingBox())!;
  // a line near the bottom of the pane, well away from the middle band
  const lines = page.locator(".cm-line");
  let target = -1;
  for (let i = 0, n = await lines.count(); i < n; i++) {
    const b = await lines.nth(i).boundingBox();
    if (b && (await lines.nth(i).innerText()).trim() && b.y > pane.y + pane.height * 0.8 && b.y + b.height < pane.y + pane.height) { target = i; break; }
  }
  expect(target).toBeGreaterThanOrEqual(0);
  const before = await scroller.evaluate((el) => el.scrollTop);
  await lines.nth(target).click({ position: { x: 20, y: 6 } }); // on the text, not past its end
  await page.waitForTimeout(600); // longer than a smooth scroll would take
  expect(Math.abs((await scroller.evaluate((el) => el.scrollTop)) - before)).toBeLessThan(2);
  await request.post(`/api/fs/trash?path=${encodeURIComponent(path)}`, { headers: H }).catch(() => {});
});
