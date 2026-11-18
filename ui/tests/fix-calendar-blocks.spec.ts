import { test, expect } from "@playwright/test";
import { openFile } from "./open";

// Blocks keep their meaning and stay reachable: `type: calendar` is the row view of dated tasks and
// `calendar-pane` the full Calendar; the page's Add-block picker reaches every block type and closes on Escape;
// the editor's Configure bar sits only on its own top-level ```view fences.
const H = { "x-kandinsky": "1" };

test("type: calendar stays the row view, calendar-pane embeds the Calendar pane", async ({ page, request }) => {
  const note = "# Cal kinds\n\n- [ ] row task 📅 2026-10-12\n\n```view\ntype: calendar\n```\n\n```view\ntype: calendar-pane\nview: month\ndate: 2026-10-12\n```\n";
  await request.put("/api/file", { headers: H, data: { path: "notes/fix-cal-kinds.md", text: note } });
  await page.goto("/");
  await openFile(page, "fix-cal-kinds.md");
  const content = page.locator(".cm-content");
  await expect(content.locator(".kandinsky-view-calendar .pill", { hasText: "row task" })).toHaveCount(1);
  await expect(content.locator(".kandinsky-pane-calendar")).toHaveCount(1);
  await expect(content.locator(".kandinsky-pane-calendar").getByTestId("calendar-pane")).toBeVisible();
});

test("the page picker offers every block through More blocks, and Escape closes it", async ({ page, request }) => {
  await request.put("/api/file", { headers: H, data: { path: "FixPick.page", text: "title: FixPick\nrows:\n  - [greeting]\n" } });
  const text = () => request.get("/api/file?path=FixPick.page", { headers: H }).then((r) => r.json()).then((j) => j.text as string);
  await page.goto("/");
  await openFile(page, "FixPick.page");
  const pagePane = page.locator(".kandinsky-pane-page");
  await expect(pagePane.locator('[data-block="greeting"]')).toBeVisible();

  await pagePane.getByRole("button", { name: "Add block" }).click();
  const picker = page.getByTestId("page-block-picker");
  await expect(picker).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();

  await pagePane.getByRole("button", { name: "Add block" }).click();
  await picker.getByTestId("page-block-more").click();
  await expect(picker).toBeHidden();
  const palette = page.getByTestId("palette");
  await expect(palette).toBeVisible();
  // the full list: content blocks, the Library and the row views are back
  await expect(palette).toContainText("Library");
  await expect(palette).toContainText("Calendar of tasks");
  await page.keyboard.type("Text");
  await expect(palette.locator(".item.sel")).toContainText("Text");
  await page.keyboard.press("Enter");
  await expect.poll(text).toContain("Write here.");
});

test("Configure appears on the note's own view fence, not on blocks inside an embedded note", async ({ page, request }) => {
  await request.put("/api/file", { headers: H, data: { path: "notes/fix-cfg-dash.md", text: "# Dash\n\n```view\ntype: progress\nkind: goal\nlabel: Nested goal\ncurrent: 1\ntarget: 4\n```\n" } });
  const host = "# Cfg host\n\n```view\ntype: note\npath: notes/fix-cfg-dash.md\n```\n\nBetween.\n\n![[fix-cfg-dash]]\n";
  await request.put("/api/file", { headers: H, data: { path: "notes/fix-cfg-host.md", text: host } });
  await page.goto("/");
  await openFile(page, "fix-cfg-host.md");
  const content = page.locator(".cm-content");
  await expect(content.getByText("Nested goal").first()).toBeVisible();
  // one bar: the host's own `type: note` fence; the nested progress blocks and the ![[…]] embed get none
  await expect(content.getByTestId("widget-configure-btn")).toHaveCount(1);
});
