import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

// Calm consumer default (developer_mode = false) vs Developer mode (developer_mode = true),
// plus error toast humanization / Copy details (R4) and structured template_rules / list editors (R5).
const H = { "x-kandinsky": "1" };
const cfg = async (request: APIRequestContext) => (await (await request.get("/api/config", { headers: H })).json()).config;
const nav = (page: Page) => page.getByRole("navigation", { name: "Settings pages" });
const side = (page: Page) => page.getByTestId("sidebar");

test("calm default (developer_mode = false) hides developer chrome and reveals it when toggled on", async ({ page, request }) => {
  const before = await cfg(request);
  try {
    await request.put("/api/file", {
      headers: H,
      data: {
        path: ".obsidian/plugins/better-word-count/manifest.json",
        text: JSON.stringify({ id: "better-word-count", name: "Better Word Count", version: "0.10.1" }),
      },
    });
    await request.put("/api/file", {
      headers: H,
      data: {
        path: ".obsidian/plugins/templater-obsidian/manifest.json",
        text: JSON.stringify({ id: "templater-obsidian", name: "Templater", version: "2.0.0" }),
      },
    });
    expect(
      (await request.put("/api/config", { headers: H, data: { ...before, developer_mode: false, vim: false, ui: { ...before.ui, palette: "plain" } } })).ok(),
    ).toBeTruthy();

    await page.goto("/");
    await page.getByText("Finish the GW notes.").waitFor();

    // 1. Calm NotionSidebar: strictly Search, Home, Pages, Trash, Settings (and Favorites when bookmarked)
    const sb = side(page);
    await expect(sb.getByRole("button", { name: "Search", exact: true })).toBeVisible();
    await expect(sb.getByTestId("apps").getByRole("button", { name: "Home", exact: true })).toBeVisible();
    await expect(sb.locator(".tree-head .sec-label")).toHaveText("Pages");
    await expect(sb.getByRole("button", { name: "Trash", exact: true })).toBeVisible();
    await expect(sb.getByRole("button", { name: "Settings", exact: true })).toBeVisible();

    await expect(sb.getByRole("button", { name: "Quick capture", exact: true })).toHaveCount(0);
    await expect(sb.getByTestId("nav-calendar")).toHaveCount(0);
    await expect(sb.getByRole("button", { name: "Notifications", exact: true })).toHaveCount(0);
    await expect(sb.getByRole("button", { name: "All pages", exact: true })).toHaveCount(0);
    await expect(sb.getByRole("button", { name: "Graph", exact: true })).toHaveCount(0);
    await expect(sb.getByTestId("sidebar-import")).toHaveCount(0);
    await expect(sb.getByRole("button", { name: "Plugins", exact: true })).toHaveCount(0);

    // 2. StatusBar: no Nootion Paper, no Σ Solver, no agy, no c_lint, no VIM chip when vim = false
    const status = page.locator("footer.status");
    await expect(status).not.toContainText(/nootion/i);
    await expect(status).not.toContainText(/solver/i);
    await expect(status).not.toContainText(/c_lint/i);
    await expect(status.getByTestId("agy-chip")).toHaveCount(0);
    await expect(status.getByTestId("vim-mode")).toHaveCount(0);

    // 3. Settings: 7 streamlined pages + Accounts; dev fields/panels hidden; 6 curated palettes
    await page.keyboard.press("Meta+,");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(nav(page).getByRole("button", { name: "Accounts" })).toBeVisible();
    for (const label of ["Appearance", "Editor & Writing", "Calendar & Daily Notes", "Files & Search", "References & PDF", "Keyboard Shortcuts", "Plugins"]) {
      await expect(nav(page).getByRole("button", { name: new RegExp(`^${label.replace(/[&]/g, "\\$&")}`) })).toBeVisible();
    }

    await nav(page).getByRole("button", { name: /^Appearance/ }).click();
    const dayPalettes = page.locator('[id="ui.palette"]');
    await expect(dayPalettes.getByRole("radio")).toHaveCount(6);
    await expect(dayPalettes.getByRole("radio", { name: /plain/i })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("button", { name: /More palettes/i })).toBeVisible();

    await nav(page).getByRole("button", { name: /^Editor & Writing/ }).click();
    await expect(page.locator('.row[data-path="vim"]')).toHaveCount(0);
    await expect(page.locator('.row[data-path="editor.code_bar"]')).toHaveCount(0);

    // 4. Settings → Plugins: no Solver/Antigravity promos, no dev buttons, read-only .obsidian summary
    await nav(page).getByRole("button", { name: /^Plugins/ }).click();
    await expect(page.getByText("Solver App", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Google Antigravity", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Install from path…" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New plugin" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New block" })).toHaveCount(0);

    await expect(page.getByTestId("browse-extensions-tab")).toContainText("Browse Plugins");
    await page.getByTestId("browse-extensions-tab").click();
    await expect(page.locator(".badge.perm, .badge.perm-safe").first()).toBeVisible();

    await page.getByRole("button", { name: /Your Obsidian Plugins/ }).click();
    await expect(page.getByTestId("obsidian-readonly-summary")).toContainText("Built into Kandinsky (1)");
    await expect(page.getByTestId("obsidian-readonly-summary")).toContainText(".obsidian/");
    await expect(page.getByRole("button", { name: /to Trash/i })).toHaveCount(0);

    // 5. Toggle Developer mode ON in Settings → Plugins and verify immediate reveal
    const devSwitch = page.getByRole("switch", { name: "Developer mode" });
    await expect(devSwitch).toHaveAttribute("aria-checked", "false");
    await devSwitch.click();
    await expect(devSwitch).toHaveAttribute("aria-checked", "true");

    await expect(status.getByTestId("agy-chip")).toBeVisible();
    await expect(sb.getByTestId("sidebar-import")).toBeVisible();
    await expect(sb.getByRole("button", { name: "Plugins", exact: true })).toBeVisible();

    await page.getByRole("button", { name: /Installed & Active/ }).click();
    await expect(page.getByRole("button", { name: "Install from path…" })).toBeVisible();
    await expect(page.getByRole("button", { name: "New plugin" })).toBeVisible();
    await expect(page.getByRole("button", { name: "New block" })).toBeVisible();

    await page.getByTestId("settings-advanced").locator("summary").click();
    await expect(page.getByText("Where the terminal panel docks")).toBeVisible();
    await expect(page.getByTestId("agents-panel")).toBeVisible();

    await nav(page).getByRole("button", { name: /^Editor & Writing/ }).click();
    await expect(page.locator('.row[data-path="vim"]')).toBeVisible();
  } finally {
    await request.put("/api/config", { headers: H, data: before });
    await request.post("/api/fs/trash?path=.obsidian", { headers: H }).catch(() => {});
  }
});

test("R4 error toast strips raw HTTP prefixes and offers Copy details; R5 renders visual template_rules and list editors", async ({ page, request }) => {
  const before = await cfg(request);
  try {
    await page.goto("/");
    await page.getByText("Finish the GW notes.").waitFor();

    // R5: visual notes.template_rules editor & string[] chip editor
    await page.keyboard.press("Meta+,");
    await nav(page).getByRole("button", { name: /^Editor & Writing/ }).click();
    const rulesEditor = page.getByTestId("template-rules-editor");
    await expect(rulesEditor).toBeVisible();
    await rulesEditor.getByRole("button", { name: "+ Add rule" }).click();
    await rulesEditor.getByLabel("Rule 1 folder").fill("labs");
    await rulesEditor.getByLabel("Rule 1 folder").press("Tab");
    await rulesEditor.getByLabel("Rule 1 template").fill("lab-note");
    await rulesEditor.getByLabel("Rule 1 template").press("Tab");
    await expect.poll(async () => (await cfg(request)).notes.template_rules).toEqual([{ folder: "labs", template: "lab-note" }]);

    await nav(page).getByRole("button", { name: /^Files & Search/ }).click();
    const ignoreEditor = page.getByTestId("list-editor-ignore");
    await expect(ignoreEditor).toBeVisible();
    await ignoreEditor.getByPlaceholder("Add item…").fill("scratch-tmp");
    await ignoreEditor.getByRole("button", { name: "Add" }).click();
    await expect.poll(async () => (await cfg(request)).ignore).toContain("scratch-tmp");
    await ignoreEditor.getByRole("button", { name: "Remove scratch-tmp" }).click();
    await expect.poll(async () => (await cfg(request)).ignore).not.toContain("scratch-tmp");

    // R4: intercept PUT /api/config to trigger an error toast with HTTP prefix and inspect Copy details
    await page.route("**/api/config", (route) => {
      if (route.request().method() === "PUT") {
        return route.fulfill({ status: 500, contentType: "text/plain", body: "Simulated save failure" });
      }
      return route.continue();
    });
    await ignoreEditor.getByPlaceholder("Add item…").fill("fail-item");
    await ignoreEditor.getByRole("button", { name: "Add" }).click();

    const errToast = page.locator('.toast[data-kind="error"]').last();
    await expect(errToast).toBeVisible();
    await expect(errToast.locator(".msg")).toHaveText("Simulated save failure");
    await expect(errToast.locator(".msg")).not.toContainText("PUT /api/config");
    const copyBtn = errToast.getByRole("button", { name: "Copy details" });
    await expect(copyBtn).toBeVisible();
    await copyBtn.click();
  } finally {
    await page.unroute("**/api/config");
    await request.put("/api/config", { headers: H, data: before });
  }
});
