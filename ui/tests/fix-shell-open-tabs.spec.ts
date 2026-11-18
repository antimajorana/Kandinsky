import { test, expect } from "@playwright/test";
import { openFile, runCommand } from "./open";

// The Notion shell hides the editor zone's tab strip, so the sidebar's "Open" section is the mouse's way to see,
// switch and close open tabs; terminals keep their own strip, also with vertical tabs.
test("Open section lists the open tabs, marks the active one, switches and closes", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  const open = page.getByTestId("sidebar").getByTestId("open-tabs");

  await openFile(page, "hubbard.md");
  await expect(page.locator(".cm-content")).toContainText("Hubbard");
  await openFile(page, "Topic.md");
  const row = (name: string) => open.locator(".pane-row").filter({ has: page.locator(".pane-title", { hasText: name }) });
  await expect(row("hubbard")).toHaveCount(1);
  await expect(row("Topic")).toHaveCount(1);
  await expect(open.locator(".pane-row.active .pane-title")).toHaveText(/Topic/);

  // a click on the background tab brings it forward
  await row("hubbard").locator(".pane-main").click();
  await expect(open.locator(".pane-row.active .pane-title")).toHaveText(/hubbard/i);

  // the row's × closes that tab
  await row("Topic").hover();
  await row("Topic").getByRole("button", { name: /^Close / }).click();
  await expect(row("Topic")).toHaveCount(0);
});

test("with vertical tabs, a second terminal stays reachable through its own tab strip", async ({ page, request }) => {
  const h = { "x-kandinsky": "1" };
  const cfg = (await (await request.get("/api/config", { headers: h })).json()).config;
  await request.put("/api/config", { headers: h, data: { ...cfg, ui: { ...cfg.ui, tabs: "vertical" } } });
  try {
    await page.goto("/");
    await page.getByText("Finish the GW notes.").waitFor();
    await page.keyboard.press("Control+`");
    await expect(page.locator(".xterm").first()).toBeVisible();
    // F1 does not reach the palette from inside a terminal: focus Home first
    await page.getByTestId("sidebar").getByRole("button", { name: "Home", exact: true }).click();
    await runCommand(page, "New shell terminal", "New shell terminal");
    // terminals render in dockview's overlay (renderer "always"), not inside their group: find the group by its tab
    const group = page.locator(".dv-groupview", { has: page.locator(".dv-tab", { hasText: "Shell 2" }) }).first();
    const strip = group.locator(".dv-tabs-and-actions-container");
    await expect(strip).toBeVisible();
    await expect(strip.locator(".dv-tab", { hasText: /Shell/ })).toHaveCount(2);
    await strip.locator(".dv-tab", { hasText: /Shell/ }).first().click();
    await expect(strip.locator(".dv-tab.dv-active-tab", { hasText: /Shell/ })).toHaveCount(1);
  } finally {
    await request.put("/api/config", { headers: h, data: cfg });
  }
});
