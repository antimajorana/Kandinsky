import { test, expect } from "@playwright/test";
import { openFile } from "./open";

// Mermaid fences: node labels sit in <foreignObject> (htmlLabels), which an SVG-only re-sanitize removed; a broken
// diagram must not leave mermaid's error SVG in a temp div on <body>.
const H = { "x-kandinsky": "1" };

test("a mermaid flowchart keeps its node labels", async ({ page, request }) => {
  const path = "notes/fix-mermaid-labels.md";
  await request.put("/api/file", {
    headers: H,
    data: { path, text: "# Mermaid labels\n\nIntro line.\n\n```mermaid\nflowchart LR\n  A[Start] --> B[Result]\n```\n\nTail line.\n" },
  });
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await openFile(page, "fix-mermaid-labels.md");
  const fig = page.locator(".mermaid-figure");
  await expect(fig).toHaveAttribute("data-state", "done", { timeout: 15_000 });
  await expect(fig.locator("foreignObject").first()).toBeAttached();
  await expect(fig).toContainText("Start");
  await expect(fig).toContainText("Result");
  await request.post(`/api/fs/trash?path=${encodeURIComponent(path)}`, { headers: H }).catch(() => {});
});

test("a broken mermaid diagram leaves no error SVG on the page body", async ({ page, request }) => {
  const path = "notes/fix-mermaid-broken.md";
  await request.put("/api/file", {
    headers: H,
    data: { path, text: "# Mermaid broken\n\nIntro line.\n\n```mermaid\ngraph TD\n  A-->\n```\n\nTail line.\n" },
  });
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await openFile(page, "fix-mermaid-broken.md");
  const fig = page.locator(".mermaid-figure");
  await expect(fig).toHaveAttribute("data-state", "error", { timeout: 15_000 });
  await expect(fig).toContainText("Mermaid diagram syntax issue");
  await expect(page.locator('body > div[id^="dkdy-mmd-"]')).toHaveCount(0);
  // a theme flip draws it again: still nothing left behind. The first error box is marked, so its replacement shows
  // the redraw's failure has been handled before the body is counted.
  await fig.locator(".tikz-error-log").evaluate((el) => el.setAttribute("data-first-draw", ""));
  const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t === "light" ? "dark" : "light"), theme);
  await expect(fig.locator(".tikz-error-log[data-first-draw]")).toHaveCount(0, { timeout: 15_000 });
  await expect(fig.locator(".tikz-error-log")).toHaveCount(1);
  await expect(fig).toHaveAttribute("data-state", "error");
  await expect(page.locator('body > div[id^="dkdy-mmd-"]')).toHaveCount(0);
  await page.evaluate((t) => { if (t === null) document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", t); }, theme);
  await request.post(`/api/fs/trash?path=${encodeURIComponent(path)}`, { headers: H }).catch(() => {});
});
