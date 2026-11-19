import { test, expect } from "@playwright/test";
import { openFile } from "./open";
import { shownName } from "../src/lib/paths";
import { verticalTabs } from "./vertical-tabs";

// "Embed in note…" (the plan's phase 1): a tab's menu puts that pane as a live block into the note
// last written in — a ```view block, plain text in the note.
const H = { "x-kandinsky": "1" };

let restoreTabs: (() => Promise<void>) | null = null;
test.afterEach(async () => { await restoreTabs?.(); restoreTabs = null; });

test("a tab's menu embeds its pane in the note last written in", async ({ page, request }) => {
  restoreTabs = await verticalTabs(request);
  await request.put("/api/file", { headers: H, data: { path: "notes/embed-here.md", text: "# Embed here\n\nFirst paragraph.\n\nSecond paragraph.\n" } });
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  for (const name of ["journal.md", "embed-here.md"]) {
    await openFile(page, name);
    await expect(page.getByTestId("sidebar").getByTestId("open-tabs").locator(".pane-row", { hasText: shownName(name) })).toHaveCount(1);
    await page.waitForTimeout(300);
  }
  await page.getByText("First paragraph.").click();
  const sidebar = page.getByTestId("sidebar");
  await sidebar.getByTestId("open-tabs").locator(".pane-row", { hasText: "journal" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Embed in embed-here" }).click();
  const text = () => request.get("/api/file?path=notes/embed-here.md", { headers: H }).then((r) => r.json()).then((j) => String(j.text));
  await expect.poll(text, { timeout: 8000 }).toContain("First paragraph.\n\n```view\ntype: editor\npath: journal.md\n```\n");
  expect(await text()).toContain("Second paragraph.");
  // the note's own tab offers no "embed in itself"; a terminal is not a thing to embed
  await sidebar.getByTestId("open-tabs").locator(".pane-row", { hasText: "embed-here" }).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: /^Embed in/ })).toHaveCount(0);
});
