import { test, expect, type Page } from "@playwright/test";
import { openFile } from "./open";
import { shownName } from "../src/lib/paths";

// "when you delete a file the tab does not close": a tab closes with its file, however the file
// went (the Files pane, a terminal, git); a file renamed in the Files pane keeps its tab, at the new name.
const H = { "x-kandinsky": "1" };
// the open tabs are the rows of the sidebar's Open section
const tabRow = (page: Page, text: string) => page.getByTestId("sidebar").getByTestId("open-tabs").locator(".pane-row", { hasText: text });
// With horizontal tabs the Open section lists the tabs only once two are open; vertical tabs list each one.
// The config is shared by every spec of the run: it is put back after each test, whatever its outcome.
let savedConfig: unknown = null;
test.beforeEach(async ({ request }) => {
  const cfg = (await (await request.get("/api/config", { headers: H })).json()).config;
  savedConfig = cfg;
  expect((await request.put("/api/config", { headers: H, data: { ...cfg, ui: { ...cfg.ui, tabs: "vertical" } } })).ok()).toBe(true);
});
test.afterEach(async ({ request }) => {
  if (savedConfig) await request.put("/api/config", { headers: H, data: savedConfig });
  savedConfig = null;
});

test("a deleted file's tab closes; a file renamed in Files reopens under its new name", async ({ page, request }) => {
  // the rename's target must not be there (a run before left it; a move never overwrites a file)
  await request.post("/api/fs/trash?path=notes/here-b.md", { headers: H }).catch(() => {});
  for (const f of ["gone-a.md", "gone-b.md"]) await request.put("/api/file", { headers: H, data: { path: `notes/${f}`, text: `# ${f}\n\nbody\n` } });
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  for (const name of ["gone-a.md", "gone-b.md"]) {
    await openFile(page, name);
    await expect(tabRow(page, shownName(name))).toHaveCount(1);
    await page.waitForTimeout(300);
  }
  // deleted outside the app's own menus
  await request.post("/api/fs/trash?path=notes/gone-a.md", { headers: H });
  await expect(tabRow(page, "gone-a")).toHaveCount(0);
  await expect(tabRow(page, "gone-b")).toHaveCount(1);

  // renamed in the Files pane: F2 on its row
  await page.keyboard.press("Meta+Shift+f");
  // the sidebar's own file tree may list the file too: the row on screen
  const row = page.locator('.row[data-path="notes/gone-b.md"]').filter({ visible: true }).first();
  const name = page.getByRole("dialog").locator("input");
  // the tree may still be settling after the trash above (it redraws on the file event): the row is
  // clicked once it is there, and clicked again if F2 found no row with the keys
  await expect(row).toBeVisible();
  await expect(async () => {
    await row.click();
    await page.keyboard.press("F2");
    await expect(name).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 10_000 });
  await name.fill("here-b.md");
  await name.press("Enter");
  // the tab follows the file once the core reports the move (a file event): slower in a full run
  await expect(tabRow(page, "here-b")).toHaveCount(1, { timeout: 10_000 });
  await expect(tabRow(page, "gone-b")).toHaveCount(0);
  await request.post("/api/fs/trash?path=notes/here-b.md", { headers: H }); // the shared vault as it was
});

// "GET /api/file: 404 not found: runs/Incoming/DCA_…_avg_2nb_1PHS_316840/…_iter.clean.tsv": run folders
// renamed (dropping "_avg") while the window was away; the restored tab showed the raw error.
test("a tab restored for a file renamed meanwhile opens where it went; a deleted one closes", async ({ page, request }) => {
  const R = "runs-moved", A = `${R}/X_4pi_avg_2nb_9001`, B = `${R}/X_4pi_avg_2nb_9002`;
  for (const p of [`${R}/X_4pi_2nb_9001`, A, B]) await request.post(`/api/fs/trash?path=${p}`, { headers: H }).catch(() => {});
  await request.put("/api/file", { headers: H, data: { path: `${A}/X_4pi_avg_2nb_9001_dmft.md`, text: "# run 9001\n" } });
  await request.put("/api/file", { headers: H, data: { path: `${B}/X_4pi_avg_2nb_9002_dmft.md`, text: "# run 9002\n" } });
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  // opened by path: the palette's index can lag files made a moment ago in a full run
  for (const path of [`${A}/X_4pi_avg_2nb_9001_dmft.md`, `${B}/X_4pi_avg_2nb_9002_dmft.md`]) {
    await request.post("/api/cmd/open", { headers: H, data: { args: { path } } });
    await expect(tabRow(page, shownName(path))).toHaveCount(1, { timeout: 10_000 });
  }
  await page.waitForTimeout(1200); // the layout is saved
  await page.goto("about:blank"); // the window away: no file events reach it
  await request.post("/api/fs/move", { headers: H, data: { from: A, to: `${R}/X_4pi_2nb_9001` } });
  await request.post(`/api/fs/trash?path=${B}`, { headers: H }); // gone for good: its sibling is not it
  await page.goto("/");
  await expect(tabRow(page, "X_4pi_2nb_9001_dmft")).toHaveCount(0); // the file kept its old name…
  await expect(tabRow(page, "9001_dmft")).toHaveCount(1, { timeout: 10_000 }); // …in the renamed folder
  await expect(page.locator(".cm-content:visible").first()).toContainText("run 9001");
  await expect(tabRow(page, "9002_dmft")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText("GET /api/file")).toHaveCount(0);
  await request.post(`/api/fs/trash?path=${R}`, { headers: H }); // the shared vault as it was
});
