import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WS } from "../playwright.config";

// A background tab leaves the page and
// keeps its place; past the working set it sleeps (unmounted) and wakes where it was. And a note reopened later
// opens where it was left.
const H = { "x-kandinsky": "1" };
const long = (n: number) => Array.from({ length: 300 }, (_, i) => `Line ${i + 1} of note ${n}.`).join("\n\n") + "\n";
const editorTop = (page: Page) => page.evaluate(() => document.querySelector<HTMLElement>(".kandinsky-pane-editor:not(.asleep) .cm-scroller")?.scrollTop ?? -1);
/** A plain PDF of `n` letter pages, each saying its number (pdf.js rebuilds the cross-reference table it lacks). */
const pagesPdf = (n: number) => {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${Array.from({ length: n }, (_, i) => `${4 + 2 * i} 0 R`).join(" ")}] /Count ${n} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  for (let i = 0; i < n; i++) {
    const text = `BT /F1 36 Tf 72 700 Td (Page ${i + 1}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * i} 0 R >>`,
      `<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
  }
  return `%PDF-1.4\n${objs.map((o, i) => `${i + 1} 0 obj\n${o}\nendobj\n`).join("")}trailer\n<< /Root 1 0 R /Size ${objs.length + 1} >>\n%%EOF\n`;
};
const kandinsky = <T>(page: Page, f: string, ...a: unknown[]) => page.evaluate(([f, a]) => (window as unknown as Record<string, Record<string, (...x: unknown[]) => T>>).__kandinsky[f as string](...(a as unknown[])), [f, a] as const);

test("a note reopened, or woken from sleep, is where it was left", async ({ page, request }) => {
  for (let i = 0; i < 11; i++) await request.put("/api/file", { headers: H, data: { path: `sleep/n${i}.md`, text: long(i) } });
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();

  // scrolled far down in n0
  await kandinsky(page, "open", "sleep/n0.md");
  const scroller = page.locator(".kandinsky-pane-editor .cm-scroller").first();
  await expect(page.locator(".cm-line", { hasText: "Line 1 of note 0." })).toBeVisible();
  await scroller.evaluate((el) => { el.scrollTop = 4000; });
  await page.waitForTimeout(700); // the place is kept 500 ms after the last scroll
  const at = await editorTop(page);
  expect(at).toBeGreaterThan(3000);

  // ten other notes: n0 goes past the working set, and is put to sleep
  for (let i = 1; i < 11; i++) {
    await kandinsky(page, "open", `sleep/n${i}.md`);
    await expect(page.locator(`.live-cm[data-note="sleep/n${i}.md"]`)).toBeVisible();
  }
  const slept = await kandinsky<number>(page, "hibernate", 0);
  expect(slept).toBeGreaterThan(0);
  expect((await kandinsky<{ asleep: number }>(page, "sleeping")).asleep).toBe(slept);

  // shown again: mounted, at its place
  await kandinsky(page, "open", "sleep/n0.md");
  await expect.poll(() => editorTop(page), { timeout: 5000 }).toBeGreaterThan(at - 200);

  // closed and opened again: the same
  await page.keyboard.press("Control+w");
  await kandinsky(page, "open", "sleep/n0.md");
  await expect.poll(() => editorTop(page), { timeout: 5000 }).toBeGreaterThan(at - 200);

  // n1 was also past the working set. A requested line takes precedence over its remembered place.
  const before = (await kandinsky<{ asleep: number }>(page, "sleeping")).asleep;
  await kandinsky(page, "open", "sleep/n1.md", 551);
  const activeLine = page.locator('.live-cm[data-note="sleep/n1.md"] .cm-activeLine');
  await expect(activeLine).toHaveText("Line 276 of note 1.");
  await expect(activeLine).toBeInViewport();
  expect((await kandinsky<{ asleep: number }>(page, "sleeping")).asleep).toBe(before - 1);
});

test("a PDF tab switched away and back keeps its scroll (it leaves the page while hidden)", async ({ page }) => {
  mkdirSync(join(WS, "sleep"), { recursive: true });
  writeFileSync(join(WS, "sleep/pages.pdf"), pagesPdf(6));
  const pdf = "sleep/pages.pdf";
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await kandinsky(page, "open", pdf);
  const viewer = page.locator(".kandinsky-pane-pdf .viewer-container").first();
  await expect(viewer.locator(".page").first()).toBeVisible({ timeout: 15_000 });
  const max = await viewer.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(max).toBeGreaterThan(600);
  await viewer.evaluate((el) => { el.scrollTop = Math.min(600, el.scrollHeight - el.clientHeight); });
  const at = await viewer.evaluate((el) => el.scrollTop);
  await page.waitForTimeout(300);
  await kandinsky(page, "open", "FOCUS.md");
  await expect(page.locator(".kandinsky-pane-pdf")).toHaveCount(0); // out of the page, not hidden in it
  await kandinsky(page, "open", pdf);
  await expect.poll(() => page.locator(".kandinsky-pane-pdf .viewer-container").first().evaluate((el) => el.scrollTop)).toBeGreaterThan(at - 50);
});

test("the latest page request is applied to a PDF that is still opening", async ({ page }) => {
  const path = "sleep/queued-pages.pdf";
  mkdirSync(join(WS, "sleep"), { recursive: true });
  writeFileSync(join(WS, path), pagesPdf(6));
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await page.evaluate((file) => {
    const app = (window as unknown as { __kandinsky: { open(path: string, page: number): void } }).__kandinsky;
    app.open(file, 2);
    app.open(file, 6);
  }, path);
  await expect(page.getByRole("textbox", { name: "Page", exact: true })).toHaveValue("6", { timeout: 15_000 });
});
