import { test, expect } from "@playwright/test";
import { openFile } from "./open";

const H = { "x-kandinsky": "1" };

test("bases: custom status meta-groups order board lanes, count done rollups, and group editors", async ({ page, request }) => {
  const put = (path: string, text: string) => request.put("/api/file", { headers: H, data: { path, text } });
  const get = (path: string) => request.get(`/api/file?path=${encodeURIComponent(path)}`, { headers: H }).then((r) => r.json()).then((j) => j.text as string);

  const origSpec = await get("templates/properties.yaml");
  const customSpec = origSpec.replace(
    "properties:\n",
    "properties:\n  stage: {kind: status, groups: {todo: [Triage], in_progress: [Building], done: [Released]}}\n",
  );

  await put("templates/properties.yaml", customSpec);
  await put("db/s2/s2-parent.md", "---\nkind: s2task\nstage: Building\n---\n");
  await put("db/s2/s2-a.md", "---\nkind: s2task\nstage: Released\nparent: '[[s2-parent]]'\n---\n");
  await put("db/s2/s2-b.md", "---\nkind: s2task\nstage: Building\n---\n");
  await put("db/s2/s2-c.md", "---\nkind: s2task\nstage: Triage\nparent: '[[s2-parent]]'\n---\n");
  await put(
    "db/s2-tasks.base",
    [
      "filters:",
      "  and:",
      '    - file.inFolder("db/s2")',
      '    - kind == "s2task"',
      "views:",
      "  - type: board",
      "    name: Board",
      '    groupBy: stage',
      "    order: [file.name, stage]",
      "  - type: table",
      "    name: Grouped",
      '    groupBy: stage',
      "    order: [file.name, stage]",
      "  - type: table",
      "    name: Rollup",
      "    subItemsBy: parent",
      "    order: [file.name, stage, parent]",
      "    sort:",
      "      - property: file.name",
      "        direction: ASC",
    ].join("\n") + "\n",
  );

  try {
    await page.goto("/");
    await page.getByText("Finish the GW notes.").waitFor();
    await openFile(page, "s2-tasks.base");
    const pane = page.locator(".base-pane");

    // Board lanes must follow lifecycle order To do -> In progress -> Done: Triage -> Building -> Released
    const lanes = pane.locator(".lane");
    await expect(lanes).toHaveCount(3);
    await expect(lanes.nth(0).locator(".lane-name")).toHaveText("Triage");
    await expect(lanes.nth(1).locator(".lane-name")).toHaveText("Building");
    await expect(lanes.nth(2).locator(".lane-name")).toHaveText("Released");
    await expect(lanes.nth(0).locator(".lane-pill")).toHaveClass(/tone-todo/);
    await expect(lanes.nth(1).locator(".lane-pill")).toHaveClass(/tone-progress/);
    await expect(lanes.nth(2).locator(".lane-pill")).toHaveClass(/tone-done/);

    // Rollup table view: sub-item rollup on s2-parent must count Released child (s2-a) as done -> 1/2
    await pane.locator(".view-switch").click();
    await page.getByRole("menuitem", { name: /^Rollup/ }).click();
    const parentRow = pane.locator("tbody tr", { hasText: "s2-parent" });
    await expect(parentRow.locator(".tree-rollup")).toHaveText("1/2");

    // Switch to Grouped table view: groups are ordered Triage -> Building -> Released, with meta-labels and done count
    await pane.locator(".view-switch").click();
    await page.getByRole("menuitem", { name: /^Grouped/ }).click();
    const groups = pane.locator("tr.group");
    await expect(groups).toHaveCount(3);
    await expect(groups.nth(0).locator(".g-meta")).toHaveText("To do");
    await expect(groups.nth(0).locator(".g-name")).toHaveText("Triage");
    await expect(groups.nth(0).locator(".g-n")).toHaveText("0/1");
    await expect(groups.nth(1).locator(".g-meta")).toHaveText("In progress");
    await expect(groups.nth(1).locator(".g-name")).toHaveText("Building");
    await expect(groups.nth(1).locator(".g-n")).toHaveText("0/2");
    await expect(groups.nth(2).locator(".g-meta")).toHaveText("Done");
    await expect(groups.nth(2).locator(".g-name")).toHaveText("Released");
    await expect(groups.nth(2).locator(".g-n")).toHaveText("1/1");

    // Click stage cell on s2-c to open CellEditor with grouped To do / In progress / Done options
    const rowC = pane.locator("tbody tr", { hasText: "s2-c" });
    await rowC.locator("td").nth(1).click();
    const editor = pane.locator(".cell-editor.status-pop");
    await expect(editor).toBeVisible();
    await expect(editor.locator(".status-group-head")).toHaveText(["To do", "In progress", "Done"]);
    await editor.getByRole("button", { name: "Released" }).click();
    await expect.poll(() => get("db/s2/s2-c.md")).toContain("stage: Released");

    // Verify PropertyField renders grouped status picker on note properties panel / drawer
    await openFile(page, "s2-b.md");
    const inlineProps = page.getByTestId("inline-properties");
    const host = (await inlineProps.count())
      ? inlineProps
      : await (async () => {
          await page.getByRole("button", { name: "Page actions" }).click();
          await page.getByRole("menuitem", { name: "Properties drawer" }).click();
          return page.getByTestId("properties-panel");
        })();
    await expect(host).toBeVisible();
    const stageTrigger = host.getByRole("button", { name: "stage: status" });
    await stageTrigger.click();
    const statusMenu = host.getByRole("listbox", { name: "stage: status" });
    await expect(statusMenu.locator(".status-sec-lbl")).toHaveText(["To do", "In progress", "Done"]);
    await statusMenu.getByRole("option", { name: "Released" }).click();
    await expect.poll(() => get("db/s2/s2-b.md")).toContain("stage: Released");
  } finally {
    await put("templates/properties.yaml", origSpec);
    for (const f of ["db/s2/s2-parent.md", "db/s2/s2-a.md", "db/s2/s2-b.md", "db/s2/s2-c.md", "db/s2-tasks.base"]) {
      await request.post(`/api/fs/trash?path=${encodeURIComponent(f)}`, { headers: H }).catch(() => {});
    }
  }
});

test("bases: guided formula builder inline typing autocomplete, function search, and sample row switcher", async ({ page, request }) => {
  const put = (path: string, text: string) => request.put("/api/file", { headers: H, data: { path, text } });
  const get = (path: string) => request.get(`/api/file?path=${encodeURIComponent(path)}`, { headers: H }).then((r) => r.json()).then((j) => j.text as string);

  await put("db/fx/alpha.md", "---\nkind: s2fx\npoints: 12\nweight: 2\n---\n");
  await put("db/fx/beta.md", "---\nkind: s2fx\npoints: 25\nweight: 4\n---\n");
  await put(
    "db/fx.base",
    [
      "filters:",
      '  - kind == "s2fx"',
      "views:",
      "  - type: table",
      "    name: Metrics",
      "    order: [file.name, points, weight]",
      "    sort:",
      "      - property: file.name",
      "        direction: ASC",
    ].join("\n") + "\n",
  );

  try {
    await page.goto("/");
    await page.getByText("Finish the GW notes.").waitFor();
    await openFile(page, "fx.base");
    const pane = page.locator(".base-pane");
    await expect(pane.locator("tbody tr")).toHaveCount(2);

    await pane.getByTestId("base-formulas-btn").click();
    const pop = page.getByTestId("formula-editor-popover");
    await expect(pop).toBeVisible();

    // Verify full expr.rs function search works beyond the old 8-item list
    const fnSearch = pop.getByRole("searchbox", { name: "Search functions" });
    await fnSearch.fill("title");
    await expect(pop.locator(".fn-item")).toContainText([".title()"]);
    await fnSearch.fill("");

    // Inline typing autocomplete inserts prop("points") and function completion via keyboard
    await pop.getByPlaceholder("score").fill("weighted");
    const textarea = pop.locator("#fx-expr-input");
    await textarea.click();
    await textarea.fill("");
    await textarea.pressSequentially('prop("poi');
    const ac = pop.getByTestId("formula-autocomplete");
    await expect(ac).toBeVisible();
    await expect(ac).toContainText('prop("points")');
    await textarea.press("Enter");
    await expect(textarea).toHaveValue('prop("points")');

    // Escape dismisses autocomplete without closing the formula popover
    await textarea.pressSequentially(" * wei");
    await expect(ac).toBeVisible();
    await textarea.press("Escape");
    await expect(ac).toHaveCount(0);
    await expect(pop).toBeVisible();

    // Complete expression and switch sample row between alpha and beta
    await textarea.fill('prop("points") * prop("weight")');
    await expect(pop.locator(".pv-list")).toContainText("24");
    await pop.getByRole("button", { name: "Sample note" }).click();
    await page.getByRole("option", { name: /beta/ }).click();
    await expect(pop.locator(".pv-list")).toContainText("100");

    await pop.getByRole("button", { name: "Save formula" }).click();
    await expect.poll(() => get("db/fx.base")).toContain('weighted: prop("points") * prop("weight")');
  } finally {
    for (const f of ["db/fx/alpha.md", "db/fx/beta.md", "db/fx.base"]) {
      await request.post(`/api/fs/trash?path=${encodeURIComponent(f)}`, { headers: H }).catch(() => {});
    }
  }
});
