import { test, expect } from "@playwright/test";
import { openFile } from "./open";
import { shownName } from "../src/lib/paths";

// "ctrl + + magnifies everything not just one of the tabs": Ctrl++ / Ctrl+- / Ctrl+0 zoom the tab
// that has the keys (lib/pane-zoom.ts). Everything at once is Ctrl+Alt with the same keys: those
// move the text sizes of the settings, so they are in .kandinsky/config.toml like any other choice.
const H = { "x-kandinsky": "1" };
// the sidebar lists a single open tab only with vertical tabs; the config is shared by every spec of the run, so it is put back
let savedConfig: unknown = null;
test.afterEach(async ({ request }) => {
  if (savedConfig) await request.put("/api/config", { headers: H, data: savedConfig });
  savedConfig = null;
});
const verticalTabs = async (request: import("@playwright/test").APIRequestContext) => {
  const cfg = (await (await request.get("/api/config", { headers: H })).json()).config;
  savedConfig = cfg;
  expect((await request.put("/api/config", { headers: H, data: { ...cfg, ui: { ...cfg.ui, tabs: "vertical" } } })).ok()).toBe(true);
};
const rootVar = (page: import("@playwright/test").Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n), name);

test("Ctrl++ zooms the tab it is pressed in, not the others; Ctrl+0 puts it back", async ({ page, request }) => {
  await verticalTabs(request);
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  for (const name of ["journal.md", "paste.md"]) {
    await openFile(page, name);
    await expect(page.getByTestId("sidebar").getByTestId("open-tabs").locator(".pane-row", { hasText: shownName(name) })).toHaveCount(1);
    await page.waitForTimeout(300);
  }
  const size = () => page.locator(".cm-content:visible").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const base = await size(), scale = await rootVar(page, "--ui-scale");
  await page.keyboard.press("Control++");
  await page.keyboard.press("Control+=");
  await expect.poll(size).toBeCloseTo(base * 1.21, 1);
  expect(await rootVar(page, "--ui-scale"), "the window's own size is untouched").toBe(scale);
  // the other tab is as it was; coming back, this one is still zoomed
  await page.getByTestId("sidebar").getByTestId("open-tabs").locator(".pane-row", { hasText: "journal" }).locator(".pane-main").click();
  await expect.poll(size).toBeCloseTo(base, 1);
  await page.getByTestId("sidebar").getByTestId("open-tabs").locator(".pane-row", { hasText: "paste" }).locator(".pane-main").click();
  await expect.poll(size).toBeCloseTo(base * 1.21, 1);
  await page.keyboard.press("Control+-");
  await expect.poll(size).toBeCloseTo(base * 1.1, 1);
  await page.keyboard.press("Control+0");
  await expect.poll(size).toBeCloseTo(base, 1);
});

test("Ctrl+Alt++ and Ctrl+Alt+- zoom everything, Ctrl+Alt+0 resets", async ({ page }) => {
  // the set scale (base.css folds it into --ui-scale with the e-ink factor, a calc())
  const scale = async () => Number(await rootVar(page, "--ui-scale-set"));
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  const [s0, p0] = [await scale(), await rootVar(page, "--prose-size")];
  await page.keyboard.press("Control+Alt++");
  await expect.poll(scale).toBeGreaterThan(s0);
  expect(await rootVar(page, "--prose-size")).not.toBe(p0);
  await page.keyboard.press("Control+Alt+-");
  await expect.poll(scale).toBeCloseTo(s0, 3);
  await page.keyboard.press("Control+Alt++");
  await page.keyboard.press("Control+Alt+0");
  await expect.poll(scale).toBe(1);
  await expect.poll(() => rootVar(page, "--prose-size"), "set in the same save, painted a moment later").toBe(p0); // the default size, as it was
});

// zoom is immediate: a key press sets the size at the next frame, never a picture-scale or a glide;
// Ctrl+wheel / a touchpad pinch zoom the pane under the pointer
test("zoom is immediate, with no picture-scale, and Ctrl+wheel zooms the pane under the pointer", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await openFile(page, "journal.md");
  const content = page.locator(".cm-content:visible").first();
  await expect(content).toBeVisible();
  const size = () => content.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const pane = () => content.evaluate((el) => (el.closest(".dv-content-container") as HTMLElement | null)?.querySelector<HTMLElement>(":scope > *")?.style.transform ?? "");
  const base = await size();
  await page.keyboard.press("Control++");
  await expect.poll(size, { timeout: 500 }).toBeCloseTo(base * 1.1, 1); // at once…
  expect(await pane()).toBe(""); // …and never drawn as a scaled picture
  const box = (await content.boundingBox())!;
  await page.mouse.move(box.x + 50, box.y + 50);
  for (let i = 0; i < 4; i++) await page.evaluate(() => document.querySelector(".cm-content")!.dispatchEvent(new WheelEvent("wheel", { deltaY: -30, ctrlKey: true, bubbles: true, cancelable: true })));
  await expect.poll(size).toBeCloseTo(base * 1.1 ** 2, 1); // four 30 px steps = one notch = one step
  await page.keyboard.press("Control+0");
  await expect.poll(size).toBeCloseTo(base, 1);
});
