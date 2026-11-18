import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { openFile } from "./open";

// Regressions in panes, widgets, settings blocks and the paper inbox: a notebook's own autosave does not reload it,
// two Pomodoro blocks with the same key stay in step, old settings page ids still open, and the inbox organizes
// each PDF where its preview says.
const H = { "x-kandinsky": "1" };
const trash = (request: APIRequestContext, path: string) =>
  request.post(`/api/fs/trash?path=${encodeURIComponent(path)}`, { headers: H });

async function home(page: Page) {
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
}

async function runCommandPalette(page: Page, label: string) {
  await page.keyboard.press("F1");
  const palette = page.getByTestId("palette");
  await expect(palette.getByRole("textbox")).toBeFocused();
  await page.keyboard.type(label);
  await palette.getByText(label, { exact: false }).first().click();
}

test("a notebook's autosave does not reload it under the cursor", async ({ page, request }) => {
  const ipynb = JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { kernelspec: { language: "python", display_name: "Python 3", name: "python3" } },
    cells: [{ id: "md-1", cell_type: "markdown", metadata: {}, source: ["# Start"] }],
  });
  await request.put("/api/file", { headers: H, data: { path: "notes/autosave-fix.ipynb", text: ipynb } });
  await home(page);
  await openFile(page, "autosave-fix.ipynb");
  await page.locator(".nb-cell.md-cell").getByRole("button", { name: "Edit" }).click();
  const md = page.locator(".md-editor");
  await md.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" more");
  // past the 800 ms autosave and the watcher's echo of that write
  await page.waitForTimeout(2500);
  // an fs event for unchanged text (as the watcher sends after a save) must not reload the pane
  const saved = await (await request.get("/api/file", { headers: H, params: { path: "notes/autosave-fix.ipynb" } })).json();
  expect(saved.text).toContain("# Start more");
  await request.put("/api/file", { headers: H, data: { path: "notes/autosave-fix.ipynb", text: saved.text } });
  await page.waitForTimeout(800);
  await expect(page.locator(".nb-state")).toHaveCount(0);
  await expect(md).toBeVisible();
  await expect(md).toBeFocused();
  await expect(md).toHaveValue("# Start more");
  await trash(request, "notes/autosave-fix.ipynb");
});

test("two Pomodoro blocks with the same key keep one timer", async ({ page, request }) => {
  const block = "```view\ntype: pomodoro\nsound: false\n```\n";
  await request.put("/api/file", { headers: H, data: { path: "notes/pomo-twins.md", text: `# Twins\n\n${block}\n${block}` } });
  await home(page);
  await page.evaluate(() => localStorage.removeItem("kandinsky.pomodoro.v1"));
  await openFile(page, "pomo-twins.md");
  const widgets = page.locator(".widget:has(.ring-wrap)");
  const states = widgets.locator(".ring-wrap .state");
  await expect(states).toHaveCount(2);
  await widgets.nth(0).getByRole("button", { name: "Start" }).click();
  await expect(states.nth(1)).toHaveText("Focusing");
  await widgets.nth(0).getByRole("button", { name: "Pause" }).click();
  await expect(states.nth(1)).toHaveText("Paused");
  // the other block's clock tick must not write "running" back over the pause
  await page.waitForTimeout(1500);
  await expect(states.nth(0)).toHaveText("Paused");
  await expect(states.nth(1)).toHaveText("Paused");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("kandinsky.pomodoro.v1") ?? "{}"));
  const records = Object.values(stored) as { running: boolean }[];
  expect(records).toHaveLength(1);
  expect(records[0].running).toBe(false);
  await trash(request, "notes/pomo-twins.md");
});

test("a notebook changed on disk shows a parse error, and leaves it once the file is valid again", async ({ page, request }) => {
  const path = "notes/refresh-err.ipynb";
  const valid = (title: string) => JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
    cells: [{ id: "md-1", cell_type: "markdown", metadata: {}, source: [`# ${title}`] }],
  });
  await request.put("/api/file", { headers: H, data: { path, text: valid("First") } });
  await home(page);
  await openFile(page, "refresh-err.ipynb");
  await expect(page.locator(".nb-cell.md-cell")).toContainText("First");
  // half-written by another tool: the error is shown, not stale cells
  await request.put("/api/file", { headers: H, data: { path, text: "{ \"cells\": [" } });
  await expect(page.locator(".nb-state.error")).toBeVisible();
  // fixed outside the pane: the notebook comes back without reopening it
  await request.put("/api/file", { headers: H, data: { path, text: valid("Second") } });
  await expect(page.locator(".nb-state.error")).toHaveCount(0);
  await expect(page.locator(".nb-cell.md-cell")).toContainText("Second");
  await trash(request, path);
});

test("a reopened Pomodoro reads the stored record, not the copy from before it closed", async ({ page, request }) => {
  await request.put("/api/file", { headers: H, data: { path: "notes/pomo-reopen.md", text: "# Reopen\n\n```view\ntype: pomodoro\nsound: false\n```\n" } });
  await home(page);
  await page.evaluate(() => localStorage.removeItem("kandinsky.pomodoro.v1"));
  await openFile(page, "pomo-reopen.md");
  const state = page.locator(".widget:has(.ring-wrap) .ring-wrap .state");
  await page.locator(".widget:has(.ring-wrap)").getByRole("button", { name: "Start" }).click();
  await expect(state).toHaveText("Focusing");
  await page.keyboard.press("Control+w");
  await expect(state).toHaveCount(0);
  // another window reset the timer meanwhile (no storage event reaches this one: nothing here was mounted)
  await page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem("kandinsky.pomodoro.v1") ?? "{}") as Record<string, unknown>;
    for (const k of Object.keys(all)) all[k] = { mode: "focus", running: false, remaining: null, endAt: null, completedSessions: 0 };
    localStorage.setItem("kandinsky.pomodoro.v1", JSON.stringify(all));
  });
  await openFile(page, "pomo-reopen.md");
  await expect(state).toHaveText("Ready");
  await trash(request, "notes/pomo-reopen.md");
});

test("settings blocks naming an earlier page id open the page that holds its options", async ({ page, request }) => {
  await request.put("/api/file", {
    headers: H,
    data: { path: "notes/old-ids.page", text: "title: Old ids\nrows:\n  - [{ view: settings, page: web }]\n  - [{ view: settings, page: drawing }]\n" },
  });
  await home(page);
  await openFile(page, "old-ids.page");
  const blocks = page.locator(".settings-block");
  await expect(blocks).toHaveCount(2);
  await expect(blocks.first()).not.toContainText("Loading settings");
  await expect(page.locator(".settings-block .view-error")).toHaveCount(0);
  await trash(request, "notes/old-ids.page");
});

test("the inbox files into the vault when no shared PDF folder is set, and sends each row's subfolder otherwise", async ({ page }) => {
  let roots = false;
  const organizeBodies: Record<string, unknown>[] = [];
  const item = {
    file: "draft.pdf", size: 2048, doi: null, arxiv: null, arxiv_version: null, isbn: null,
    title: "Synthetic Draft Paper", authors: ["Doe, Jane"], year: "2024",
    suggested_filename: "Doe2024 - Test.pdf", suggested_subfolder: "Quantum", existing_key: null,
  };
  await page.route("**/api/plugins/catalog-papers/helper", async (route) => {
    const body = route.request().postDataJSON() as { method?: string; params?: Record<string, unknown> } | null;
    if (body?.method === "scan_inbox") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          configured: true,
          inbox_dir: "Inbox",
          external_root: roots ? "../Library/Papers" : "",
          files_into_vault: !roots,
          rename_format: "{Author}{Year} - {Title}.pdf",
          items: [{ ...item, target_path: roots ? "../Library/Papers/Quantum/Doe2024 - Test.pdf" : "References/doe2024/Doe2024 - Test.pdf" }],
          subfolder_presets: ["Quantum"],
        }),
      });
      return;
    }
    if (body?.method === "organize_inbox") {
      organizeBodies.push(body.params ?? {});
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ dry_run: false, organized: [], skipped: [] }) });
      return;
    }
    await route.continue();
  });

  await home(page);
  await runCommandPalette(page, "References: triage PDF drop inbox");
  const pw = page.getByTestId("paper-workflows-modal");
  await expect(pw).toBeVisible();
  const row = pw.getByTestId("inbox-pdf-row");
  await expect(row).toHaveCount(1);
  await expect(row.locator(".dest-preview")).toHaveText("→ References/doe2024/Doe2024 - Test.pdf");
  await expect(pw.getByTestId("inbox-subfolder-input")).toBeDisabled();
  await expect(pw.getByTestId("inbox-subfolder-hint")).toBeVisible();
  await expect(pw).not.toContainText("../Papers");
  await pw.getByTestId("inbox-organize-btn").click();
  await expect.poll(() => organizeBodies.length).toBe(1);
  expect(organizeBodies[0].subfolder).toBeUndefined();
  expect(organizeBodies[0].items).toEqual([]);

  roots = true;
  await pw.getByTestId("inbox-rescan-btn").click();
  await expect(row.locator(".dest-preview")).toHaveText("→ ../Library/Papers/Quantum/Doe2024 - Test.pdf");
  await expect(pw.getByTestId("inbox-subfolder-input")).toBeEnabled();
  await pw.getByTestId("inbox-organize-btn").click();
  await expect.poll(() => organizeBodies.length).toBe(2);
  expect(organizeBodies[1].items).toEqual([{ file: "draft.pdf", subfolder: "Quantum" }]);
});
