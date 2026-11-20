import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

// The graph zooms under the pointer: a wheel, and Ctrl+wheel (a touchpad's pinch arrives so) — the graph's own camera,
// not the pane's text size. The canvas says its scale as drawn (`data-zoom`). The zoom is the reader's from then on: a
// layout started again (a note added) moves the notes, not the camera. Whether the Windows app passes a pinch to the
// page at all (kandinsky-app `zoom_hotkeys_enabled`) is the webview's, out of a browser test's reach.
const H = { "x-kandinsky": "1" };
const zoom = async (page: Page) => Number(await page.getByTestId("graph-canvas").getAttribute("data-zoom"));
/** The zoom once the wheel's frames are drawn: two equal reads in a row. */
async function settled(page: Page): Promise<number> {
  let a = await zoom(page);
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(100);
    const b = await zoom(page);
    if (b === a) return b;
    a = b;
  }
  return a;
}
const wheel = async (page: Page, dy: number, n = 3) => { for (let i = 0; i < n; i++) await page.mouse.wheel(0, dy); };
const nodes = async (page: Page) => Number(((await page.locator(".graph-pane .meta").textContent()) ?? "").match(/(\d+) node/)?.[1] ?? 0);

// the notes this test adds: its own names each attempt, linked only to each other, gone after (the vault is every test's)
const made: string[] = [];
test.afterEach(async ({ request }) => {
  for (const p of made.splice(0)) await request.post(`/api/fs/trash?path=${encodeURIComponent(p)}`, { headers: H }).catch(() => {});
});

test("the graph zooms in and out with the wheel and with Ctrl+wheel, and keeps that zoom", async ({ page, request }: { page: Page; request: APIRequestContext }, info) => {
  const tag = `${info.repeatEachIndex}-${info.retry}`, a = `zoom-a-${tag}`, b = `zoom-b-${tag}`;
  made.push(`notes/${a}.md`, `notes/${b}.md`);
  await request.put("/api/file", { headers: H, data: { path: `notes/${a}.md`, text: `# ${a}\n` } });
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

  // one notch takes the camera from the layout's fitting: the reader's from here
  await wheel(page, -100, 1);
  const start = await settled(page);
  await wheel(page, -200); // in: e^(3·200·0.0015) ≈ 2.46×
  const zoomedIn = await settled(page);
  expect(zoomedIn / start).toBeCloseTo(Math.exp(3 * 200 * 0.0015), 1);

  // the layout starts again (a note linking into the graph): the notes move, the zoom stays
  const before = await nodes(page);
  await request.put("/api/file", { headers: H, data: { path: `notes/${b}.md`, text: `# ${b}\n\n[[${a}]]\n` } });
  await expect.poll(() => nodes(page), { timeout: 10_000 }).toBeGreaterThan(before);
  await page.waitForTimeout(1500);
  expect(await zoom(page)).toBeCloseTo(zoomedIn, 3);

  await wheel(page, 200); // out
  expect(await settled(page)).toBeCloseTo(zoomedIn / Math.exp(3 * 200 * 0.0015), 2);

  // Ctrl+wheel (a pinch): the graph again, and the pane's text keeps its size
  const plain = await settled(page);
  await page.keyboard.down("Control");
  await wheel(page, -200);
  await page.keyboard.up("Control");
  expect((await settled(page)) / plain).toBeCloseTo(Math.exp(3 * 200 * 0.0015), 1);
  expect(await pane.locator("header").evaluate((e) => getComputedStyle(e).fontSize)).toBe(headerFont);

  // Fit brings the whole graph back into view: out again from the pinched-in zoom
  const pinched = await zoom(page);
  await pane.getByRole("button", { name: "Fit" }).click();
  await expect.poll(() => zoom(page)).toBeLessThan(pinched / 1.5);
});
