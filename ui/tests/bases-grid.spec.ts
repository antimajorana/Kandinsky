import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { openFile } from "./open";

// A base's table and list read and move as one: the keyboard keeps its place through a cell's editor, and a date
// in the list reads as the table writes it.
const H = { "x-kandinsky": "1" };
const put = (r: APIRequestContext, path: string, text: string) => r.put("/api/file", { headers: H, data: { path, text } });
const text = (r: APIRequestContext, f: string) => r.get(`/api/file?path=${encodeURIComponent(f)}`, { headers: H }).then((x) => x.json()).then((j) => j.text as string);

async function openBase(page: Page, name: string) {
  await page.goto("/");
  await openFile(page, name);
  return page.locator(".base-pane");
}

test("a Base view saves a default template and uses its prompts when creating a row", async ({ page, request }, info) => {
  const base = "db/row-templates.base", template = "templates/row-brief.md";
  const note = "db/briefs/Build a prototype.md";
  try {
    expect((await put(request, base, 'filters: \'file.inFolder("db/briefs")\'\nviews:\n  - type: table\n    name: Active\n    filters: \'status == "Open"\'\n    order: [file.name, status, estimate]\n  - type: table\n    name: All briefs\n')).ok()).toBe(true);
    expect((await put(request, template, '---\ntemplate_title: Project brief\ncreate_in: elsewhere\nstatus: Closed\nestimate: {{prompt:Estimate | number}}\n---\n# {{title}}\n\n## Goals\n')).ok()).toBe(true);
    const pane = await openBase(page, "row-templates.base");
    const dialog = page.getByRole("dialog", { name: "New row" });
    await pane.getByRole("button", { name: "New", exact: true }).click();
    await expect(dialog.getByLabel("Title")).toBeFocused();
    await dialog.getByLabel("Title").fill("Build a prototype");
    await dialog.getByRole("button", { name: "Template", exact: true }).click();
    await dialog.getByRole("option", { name: /Project brief/ }).click();
    await dialog.getByRole("button", { name: "Set as view default" }).click();
    await expect(dialog.getByText("Default template for this view")).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect((await request.get(`/api/file?path=${encodeURIComponent(note)}`, { headers: H })).status()).toBe(404);
    expect(await text(request, base)).toContain("rowTemplate: row-brief");

    const reopened = await openBase(page, "row-templates.base");
    await reopened.getByRole("button", { name: "New", exact: true }).click();
    await dialog.getByLabel("Title").fill("Build a prototype");
    await expect(dialog.getByRole("button", { name: "Template", exact: true })).toHaveText("Project brief");
    await dialog.getByRole("spinbutton", { name: "Estimate" }).fill("2.5");
    for (const theme of ["light", "dark"]) {
      await page.evaluate((theme) => document.documentElement.setAttribute("data-theme", theme), theme);
      await page.screenshot({ path: info.outputPath(`new-base-row-${theme}.png`) });
    }
    await dialog.getByRole("button", { name: "Create row" }).click();
    await expect(page.locator(`.live-cm[data-note="${note}"]`)).toBeVisible();
    expect(await text(request, note)).toBe("---\nstatus: Open\nestimate: 2.5\n---\n# Build a prototype\n\n## Goals\n");

    await openFile(page, "row-templates.base");
    await reopened.locator(".view-switch").click();
    await page.getByRole("menuitem", { name: /^All briefs/ }).click();
    await reopened.getByRole("button", { name: "New", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Template", exact: true })).toHaveText("Blank note");
  } finally {
    for (const path of [base, template, note]) {
      await request.post(`/api/fs/trash?path=${encodeURIComponent(path)}`, { headers: H });
    }
  }
});

test("run a manual automation, create and update rows in another Base, and see the results in history", async ({ page, request }) => {
  const inbox = "db/manual-inbox.base", followups = "db/manual-followups.base";
  const note = "db/manual-inbox/Intake.md", created = "db/manual-followups/Review Intake.md", related = "db/manual-followups/Related.md";
  try {
    expect((await put(request, note, `---\nprojects: '[[${related}]]'\n---\n# Intake\n`)).ok()).toBe(true);
    expect((await put(request, related, "---\nstatus: Open\n---\n")).ok()).toBe(true);
    expect((await put(request, inbox, 'filters: \'file.inFolder("db/manual-inbox")\'\nviews: [{type: table, name: Inbox}]\n')).ok()).toBe(true);
    expect((await put(request, followups, 'filters: \'file.inFolder("db/manual-followups")\'\nviews: [{type: table, name: Open, filters: \'status == "Open"\'}]\n')).ok()).toBe(true);
    const pane = await openBase(page, "manual-inbox.base");
    await pane.getByTestId("base-automations-btn").click();
    const panel = page.getByTestId("base-automations-popover");
    await panel.getByLabel("Name", { exact: true }).fill("Schedule review");
    await panel.getByRole("button", { name: "Trigger", exact: true }).click();
    await panel.getByRole("option", { name: "Run manually", exact: true }).click();
    await panel.getByRole("button", { name: "Action 1 type" }).click();
    await panel.getByRole("option", { name: "Create row in a Base" }).click();
    await panel.getByLabel("Destination Base").fill(followups);
    await panel.getByLabel("View (optional)").fill("Open");
    await panel.getByLabel("New note title (optional)").fill("Review {{title}}");
    await panel.getByLabel("Link back property (optional)").fill("source");
    await panel.getByRole("button", { name: "Add action", exact: true }).click();
    await panel.getByRole("button", { name: "Action 2 type" }).click();
    await panel.getByRole("option", { name: "Update related rows in a Base" }).click();
    const update = panel.getByRole("group", { name: "Action 2" });
    await update.getByLabel("Destination Base").fill(followups);
    await update.getByLabel("Relation on this row").fill("projects");
    await update.getByLabel("Target property").fill("reviewed");
    await update.getByLabel("Property value").fill("true");
    await panel.getByRole("button", { name: "Add automation", exact: true }).click();
    await panel.getByRole("button", { name: "Run Schedule review" }).click();
    await expect(panel.getByRole("button", { name: "Row", exact: true })).toHaveText("Intake");
    await panel.getByRole("button", { name: "Run on row", exact: true }).click();
    await expect(panel.getByText("Schedule review · Completed")).toBeVisible();
    await expect(panel.getByRole("button", { name: created, exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: related, exact: true })).toBeVisible();
    expect(await text(request, related)).toContain("reviewed: true");
    const contents = await text(request, created);
    expect(contents).toContain("status: Open");
    expect(contents).toContain(`[[${note}]]`);
    await panel.getByRole("button", { name: created, exact: true }).click();
    await expect(page.locator(`.live-cm[data-note="${created}"]`)).toBeVisible();
  } finally {
    for (const path of [inbox, followups, note, created, related]) {
      await request.post(`/api/fs/trash?path=${encodeURIComponent(path)}`, { headers: H });
    }
  }
});

test("edit a legacy automation and run its reordered actions on a property change", async ({ page, request }) => {
  const base = "db/ordered-rule.base", note = "db/ordered-rule/a.md";
  const open = "---\nstatus: Open\n---\nBody.\n";
  try {
    expect((await put(request, note, open)).ok()).toBe(true);
    expect((await put(request, base, `filters: 'file.inFolder("db/ordered-rule")'
automations:
  - name: Complete
    trigger: {kind: property_changed, property: status, to: Done}
    action: {kind: set_property, property: phase, value: complete}
views:
  - type: table
`)).ok()).toBe(true);
    const pane = await openBase(page, "ordered-rule.base");
    await pane.getByTestId("base-automations-btn").click();
    const panel = page.getByTestId("base-automations-popover");
    await panel.getByRole("button", { name: "Edit Complete" }).click();
    await panel.getByRole("button", { name: "Add action", exact: true }).click();
    await panel.getByRole("button", { name: "Action 2 type" }).click();
    await panel.getByRole("option", { name: "Set property", exact: true }).click();
    await panel.getByRole("group", { name: "Action 2" }).getByLabel("Target property").fill("phase");
    await panel.getByRole("group", { name: "Action 2" }).getByLabel("Property value").fill("pending");
    await panel.getByRole("button", { name: "Move action 2 up" }).click();
    await panel.getByRole("button", { name: "Save automation" }).click();
    await expect(panel.getByText(/Set phase = pending · Set phase = complete/)).toBeVisible();
    expect((await put(request, note, open.replace("Open", "Done"))).ok()).toBe(true);
    await expect.poll(() => text(request, note)).toContain("phase: complete");
  } finally {
    for (const path of [base, note]) {
      await request.post(`/api/fs/trash?path=${encodeURIComponent(path)}`, { headers: H });
    }
  }
});

test("a cell edited from the keyboard gives the focus back to its cell, on Enter and on Escape", async ({ page, request }) => {
  await put(request, "db/kbd/a.md", "---\nstatus: todo\n---\n");
  await put(request, "db/kbd.base", 'filters:\n  and:\n    - file.inFolder("db/kbd")\nviews:\n  - type: table\n    name: T\n    order: [file.name, status]\n');
  const pane = await openBase(page, "kbd.base");
  const cell = pane.locator("tbody tr", { hasText: "a" }).locator("td").nth(1);
  await expect(cell).toHaveText("todo");
  await cell.focus();
  await page.keyboard.press("Enter");
  const input = pane.getByLabel("Edit Status");
  await expect(input).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(cell).toBeFocused();
  await expect(cell).toHaveCSS("outline-offset", "-2px"); // its ring inside the cell, not clipped by the row
  await page.keyboard.press("Enter");
  await input.fill("done");
  await page.keyboard.press("Enter");
  await expect.poll(() => text(request, "db/kbd/a.md")).toContain("status: done");
  await expect(cell).toHaveText("done");
  await expect(cell).toBeFocused();
});

test("a list cell's editor floats over its row: the row keeps its height", async ({ page, request }) => {
  await put(request, "db/chips/a.md", "---\ntags: [home, weekly, errands, someday]\n---\n");
  await put(request, "db/chips.base", 'filters:\n  and:\n    - file.inFolder("db/chips")\nviews:\n  - type: table\n    name: T\n    order: [file.name, tags]\n');
  const pane = await openBase(page, "chips.base");
  const row = pane.locator("tbody tr", { hasText: "a" });
  const before = (await row.boundingBox())!.height;
  await row.locator("td").nth(1).click();
  await expect(pane.getByLabel("Add to Tags")).toBeFocused();
  expect((await row.boundingBox())!.height).toBe(before);
  await page.keyboard.press("Escape");
});

test("a list view writes its date as the table does", async ({ page, request }) => {
  await put(request, "db/when/a.md", "---\ndate: 2025-02-03\n---\n");
  await put(request, "db/when.base", 'filters:\n  and:\n    - file.inFolder("db/when")\nviews:\n  - type: list\n    name: L\n    order: [file.name, date]\n');
  const pane = await openBase(page, "when.base");
  const when = pane.locator(".rows .when .date");
  await expect(when).toHaveAttribute("title", /^Monday, 3 February 2025 · /); // the whole date and how far (lib/dates.ts)
  await expect(when).toHaveText("3 Feb 2025"); // the reader's words, as in the table
});

test("a board card opens with Enter and moves a lane over with Alt+arrows, the focus going with it", async ({ page, request }) => {
  await put(request, "db/kb/a.md", "---\nstatus: todo\n---\n");
  await put(request, "db/kb/b.md", "---\nstatus: done\n---\n");
  await put(request, "db/kb.base", 'filters:\n  and:\n    - file.inFolder("db/kb")\nviews:\n  - type: board\n    name: B\n    groupBy:\n      property: status\n    order: [file.name]\n');
  const pane = await openBase(page, "kb.base");
  const lanes = pane.locator(".lane");
  await expect(lanes).toHaveCount(2);
  const names = await lanes.locator(".lane-name").allTextContents();
  const from = names.indexOf("todo"), other = names[1 - from];
  const card = pane.locator('.card[data-path="db/kb/a.md"]');
  await card.focus();
  await page.keyboard.press(from === 0 ? "Alt+ArrowRight" : "Alt+ArrowLeft");
  await expect.poll(() => text(request, "db/kb/a.md")).toContain(`status: ${other}`);
  // the lane by its name: status lanes sort To do before Done, and the lane the card left is empty and gone
  await expect(lanes.filter({ has: page.locator(".lane-name", { hasText: other }) }).locator('.card[data-path="db/kb/a.md"]')).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".dv-tab.dv-active-tab")).toContainText("a");
});

test("the filter popover's own view, empty, says the base's filters still apply", async ({ page }) => {
  const pane = await openBase(page, "all.base");
  await pane.getByRole("button", { name: "Filter" }).click();
  await expect(page.getByText("No filters of its own", { exact: false })).toBeVisible();
});

test("a formula is written, changed and removed from the Properties popover, its column following", async ({ page, request }) => {
  await put(request, "db/fx/a.md", "---\nprice: 7.5\nqty: 2\ntags: [physics, dmft]\n---\n");
  await put(request, "db/fx.base", 'filters:\n  and:\n    - file.inFolder("db/fx")\nformulas:\n  total: price * qty\nviews:\n  - type: table\n    name: T\n    order: [file.name, formula.total]\n');
  const pane = await openBase(page, "fx.base");
  const row = pane.locator("tbody tr", { hasText: "a" });
  await expect(row.locator("td").nth(1)).toHaveText("15");
  await pane.getByRole("button", { name: "Properties", exact: true }).click();
  const pop = page.getByRole("dialog", { name: "Properties" });
  await pop.getByRole("button", { name: "Edit the formula total" }).click();
  await pop.getByRole("textbox", { name: "Formula", exact: true }).fill("price * qty + 1");
  await pop.getByRole("button", { name: "Save" }).click();
  await expect(row.locator("td").nth(1)).toHaveText("16");
  await pop.getByRole("button", { name: "Add formula" }).click();
  await pop.getByRole("textbox", { name: "Formula name" }).fill("loud");
  await pop.getByRole("textbox", { name: "Formula", exact: true }).fill('tags.map(value.upper()).join("+")');
  await page.keyboard.press("Enter");
  await expect(row.locator("td").nth(2)).toHaveText("PHYSICS+DMFT");
  await expect.poll(() => text(request, "db/fx.base")).toContain("formula.loud");
  await pop.getByRole("button", { name: "Remove the formula loud" }).click();
  await expect.poll(() => text(request, "db/fx.base")).not.toContain("loud");
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
  await expect(pane.getByRole("button", { name: "Properties", exact: true })).toBeFocused(); // Esc gives the focus back
});
