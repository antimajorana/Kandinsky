import { test, expect } from "@playwright/test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { WS } from "../playwright.config";

// Closing tabs one after another by hand (the shown one's ×, again and again): the UI used
// to stutter. Measures the gaps between frames while it closes (any engine: `--browser=webkit` too).
const H = { "x-kandinsky": "1" };
const names = Array.from({ length: 8 }, (_, i) => `notes/closing-${i}.md`);
// The config is shared by every spec of the run, and other specs count the workspace's notes (graph):
// both are put back after the test, whatever its outcome.
let savedConfig: unknown = null;
test.afterEach(async ({ request }) => {
  if (savedConfig) await request.put("/api/config", { headers: H, data: savedConfig });
  savedConfig = null;
  for (const n of names) rmSync(join(WS, n), { force: true });
});

test("closing the shown tab again and again stays smooth", async ({ page, request }) => {
  const body = Array.from({ length: 400 }, (_, i) => `Line ${i} with $x^${i}$ and **bold** [[hubbard]]`).join("\n\n");
  for (const n of names) await request.put("/api/file", { headers: H, data: { path: n, text: `# ${n}\n\n${body}\n` } });
  // the tabs are the rows of the sidebar's Open section: with horizontal tabs it lists them only while two are
  // open, vertical tabs list the last one too
  const cfg = (await (await request.get("/api/config", { headers: H })).json()).config;
  savedConfig = cfg;
  expect((await request.put("/api/config", { headers: H, data: { ...cfg, ui: { ...cfg.ui, tabs: "vertical" } } })).ok()).toBe(true);
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  for (const n of names) {
    await page.request.post("/api/cmd/open", { headers: H, data: { args: { path: n } } });
    await expect(page.locator(".cm-editor:visible").first()).toBeVisible();
  }
  const open = page.getByTestId("sidebar").getByTestId("open-tabs");
  const tabs = open.locator(".pane-row", { hasText: "closing-" });
  await expect(tabs).toHaveCount(names.length);
  // the gaps between frames over 50 ms: what a stutter is, in every engine (WebKit reports no long tasks)
  await page.evaluate(() => {
    const w = window as unknown as { longs: number[]; stopFrames?: boolean };
    w.longs = [];
    let last = performance.now();
    const tick = (now: number) => { if (now - last > 50) w.longs.push(Math.round(now - last)); last = now; if (!w.stopFrames) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const t0 = Date.now();
  for (let i = names.length; i > 0; i--) {
    // the row's × closes on click; dispatched, so no hover or scroll is waited for between closes
    await open.locator(".pane-row.active .pane-close").first().dispatchEvent("click");
    await expect(tabs).toHaveCount(i - 1);
  }
  const longs = await page.evaluate(() => { const w = window as unknown as { longs: number[]; stopFrames?: boolean }; w.stopFrames = true; return w.longs; });
  console.log(`[close] ${names.length} closes in ${Date.now() - t0} ms; frames over 50 ms apart: ${JSON.stringify(longs)}`);
  expect(Math.max(0, ...longs)).toBeLessThan(400);
});
