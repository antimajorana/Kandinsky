import { test, expect, type APIRequestContext } from "@playwright/test";
import { openFile } from "./open";

// Calendar blocks written while the pane was named `calendar` still open the pane; its start view is `mode:` (a .page
// names a block's type with `view:`); Configure finds a ```view fence whose opener is indented a few spaces.
const H = { "x-kandinsky": "1" };
const fileText = async (request: APIRequestContext, path: string) =>
  String((await (await request.get(`/api/file?path=${encodeURIComponent(path)}`, { headers: H })).json()).text ?? "");

test("a `type: calendar` fence with a start view is the Calendar pane; one with `from:` stays the row view", async ({ page, request }) => {
  const note = "# Cal compat\n\n- [ ] compat task 📅 2026-10-12\n\n```view\ntype: calendar\nview: month\n```\n\n```view\ntype: calendar\nfrom: note\n```\n";
  await request.put("/api/file", { headers: H, data: { path: "notes/fix-cal-compat.md", text: note } });
  await page.goto("/");
  await openFile(page, "fix-cal-compat.md");
  const content = page.locator(".cm-content");
  await expect(content.locator(".kandinsky-pane-calendar").getByTestId("calendar-pane")).toHaveCount(1);
  await expect(content.locator(".kandinsky-view-calendar .pill", { hasText: "compat task" })).toHaveCount(1);
});

test("a page's Calendar block keeps its type with a start view, and a bare old `calendar` block is the pane", async ({ page, request }) => {
  const doc = "title: FixCalPage\nrows:\n  - - view: calendar-pane\n      mode: week\n  - - view: calendar\n";
  await request.put("/api/file", { headers: H, data: { path: "FixCalPage.page", text: doc } });
  await page.goto("/");
  await openFile(page, "FixCalPage.page");
  const pagePane = page.locator(".kandinsky-pane-page");
  await expect(pagePane.getByTestId("calendar-pane")).toHaveCount(2);
  await expect(pagePane).not.toContainText("No block or view called");
});

test("Configure applies to a fence indented two spaces", async ({ page, request }) => {
  const path = "notes/fix-cfg-indent.md";
  const note = "# Indented\n\n  ```view\n  type: progress\n  kind: goal\n  label: Indent goal\n  current: 1\n  target: 4\n  ```\n";
  await request.put("/api/file", { headers: H, data: { path, text: note } });
  await page.goto("/");
  await openFile(page, "fix-cfg-indent.md");
  const content = page.locator(".cm-content");
  await expect(content.getByText("Indent goal").first()).toBeVisible();
  await content.getByTestId("widget-configure-btn").first().click({ force: true });
  const pop = page.getByTestId("widget-configure-popover");
  await expect(pop).toBeVisible();
  await pop.getByLabel("Goal label").fill("Indent applied");
  await pop.getByRole("button", { name: "Apply" }).click();
  await expect(pop.locator(".err")).toHaveCount(0);
  await expect(content.locator(".cm-rendered-block").first()).toContainText("Indent applied");
  // the new YAML keeps the opener's indent: every content line, not only the fence lines
  await expect.poll(() => fileText(request, path)).toContain("  label: Indent applied\n  current: 1\n");
});

test("Configure on a fence inside a list item keeps the list and the rest of the note", async ({ page, request }) => {
  const path = "notes/fix-cfg-listitem.md";
  const note = "# Listed\n\n- step\n  ```view\n  type: progress\n  kind: goal\n  label: List goal\n  current: 1\n  target: 4\n  ```\n\nAfter the list.\n";
  await request.put("/api/file", { headers: H, data: { path, text: note } });
  await page.goto("/");
  await openFile(page, "fix-cfg-listitem.md");
  const content = page.locator(".cm-content");
  await expect(content.getByText("List goal").first()).toBeVisible();
  await content.getByTestId("widget-configure-btn").first().click({ force: true });
  const pop = page.getByTestId("widget-configure-popover");
  await expect(pop).toBeVisible();
  await pop.getByLabel("Goal label").fill("List applied");
  await pop.getByRole("button", { name: "Apply" }).click();
  await expect(pop.locator(".err")).toHaveCount(0);
  await expect.poll(() => fileText(request, path)).toContain("  label: List applied\n");
  const saved = await fileText(request, path);
  // no content line of the fence falls back to column 0, which would end the list item and its fence
  const fence = saved.slice(saved.indexOf("  ```view"), saved.indexOf("After the list."));
  for (const line of fence.split("\n").filter(Boolean)) expect(line).toMatch(/^ {2}/);
  expect(saved).toContain("  ```\n\nAfter the list.\n");
  await expect(content.getByText("List applied").first()).toBeVisible();
});
