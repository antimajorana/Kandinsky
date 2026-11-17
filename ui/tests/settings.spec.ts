import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { openFile } from "./open";

// Settings as pages (docs/guides/SETTINGS.md): an overview of what Kandinsky can do, a page per area with
// features to try and options, search across pages, modified/reset, look options applied live,
// a page as a block in a .page file, and plugins switched off from Settings.
const H = { "x-kandinsky": "1" };
const cfg = async (request: APIRequestContext) => (await (await request.get("/api/config", { headers: H })).json()).config;
const nav = (page: Page) => page.getByRole("navigation", { name: "Settings pages" });

async function openSettings(page: Page) {
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await page.keyboard.press("Meta+,");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
}

test("the 7 streamlined settings categories render cleanly with Advanced folded", async ({ page }) => {
  await openSettings(page);
  for (const name of ["Appearance", "Editor & Writing", "Calendar & Daily Notes", "Files & Search", "References & PDF", "Keyboard Shortcuts", "Extensions"]) {
    await nav(page).getByRole("button", { name: new RegExp(`^${name.replace(/[&]/g, "\\$&")}`) }).click();
    await expect(page.locator("main article h2")).toContainText(name);
  }
  await nav(page).getByRole("button", { name: /^Extensions/ }).click();
  await page.getByTestId("settings-advanced").locator("summary").click();
  await expect(page.getByText("Where the terminal panel docks")).toBeVisible();
});

test("search spans pages and matches descriptions", async ({ page }) => {
  await openSettings(page);
  await page.getByPlaceholder("Search settings…").fill("in code files"); // words of line_numbers' description
  await expect(page.locator('.row[data-path="editor.line_numbers"]')).toBeVisible();
});

test("accent colour applies live and resets to the theme's", async ({ page, request }) => {
  await openSettings(page);
  await nav(page).getByRole("button", { name: "Appearance" }).click();
  const accent = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
  const before = await accent();
  const box = page.locator('[id="ui.accent"]');
  await box.fill("#ff5500");
  await box.press("Enter");
  await box.blur();
  await expect.poll(accent).toBe("#ff5500");
  await expect.poll(async () => (await cfg(request)).ui.accent).toBe("#ff5500");
  await page.locator('.row[data-path="ui.accent"]').getByRole("button", { name: /reset/ }).click();
  await expect.poll(accent).toBe(before);
  await expect.poll(async () => (await cfg(request)).ui.accent).toBe("");
});

test("colour schemes are swatches, by day and by night; an empty accent shows the scheme's", async ({ page, request }) => {
  await openSettings(page);
  await nav(page).getByRole("button", { name: "Appearance" }).click();
  const day = page.locator('[id="ui.palette"]');
  await expect(day.locator(".pal-sample")).not.toHaveCount(0);
  await day.getByRole("radio", { name: /sage/i }).click();
  await expect.poll(async () => (await cfg(request)).ui.palette).toBe("sage");
  // the night's list starts with "as by day"; each swatch is drawn dark
  const night = page.locator('[id="ui.palette_dark"]');
  await expect(night.getByRole("radio").first()).toContainText("as by day");
  await expect(night.locator('.pal-sample[data-theme="dark"]')).not.toHaveCount(0);
  // the accent's picker holds the colour in use, not a stand-in
  const used = await page.evaluate(() => { const s = document.createElement("span"); s.style.color = "var(--accent)"; document.body.append(s); const c = getComputedStyle(s).color; s.remove(); return c; });
  const shown = await page.locator('.row[data-path="ui.accent"] input[type="color"]').inputValue();
  const hex = used.match(/\d+/g)!.slice(0, 3).map((x) => Number(x).toString(16).padStart(2, "0")).join("");
  expect(shown).toBe(`#${hex}`);
  await page.locator('.row[data-path="ui.palette"]').getByRole("button", { name: /reset/ }).click();
});

test("the keyboard page lists every command with a rebindable shortcut", async ({ page }) => {
  await openSettings(page);
  await nav(page).getByRole("button", { name: /^Keyboard Shortcuts/ }).click();
  await page.getByLabel("Filter shortcuts").fill("command palette");
  await expect(page.getByRole("button", { name: "Shortcut for Command palette" })).toContainText("Super");
});

test("a settings page is a block in a .page file", async ({ page, request }) => {
  await request.put("/api/file", { headers: H, data: { path: "notes/tune.page", text: "title: Tune\nrows:\n  - [{ view: settings, page: terminal }]\n" } });
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await openFile(page, "tune.page");
  await page.locator(".settings-block").getByTestId("settings-advanced").locator("summary").click();
  await expect(page.locator(".settings-block").getByText("Where the terminal panel docks")).toBeVisible();
  await request.put("/api/file", { headers: H, data: { path: "notes/tune.page", text: "" } });
});

test("a plugin switched off in Settings saves plugins.off", async ({ page, request }) => {
  await request.put("/api/file", { headers: H, data: { path: ".kandinsky/plugins/offable/plugin.toml", text: 'title = "Offable"\nicon = "table"\n' } });
  await request.put("/api/file", { headers: H, data: { path: ".kandinsky/plugins/offable/view.js", text: "export default (host) => { host.textContent = 'offable'; };\n" } });
  await openSettings(page);
  await nav(page).getByRole("button", { name: /^Extensions/ }).click();
  const sw = page.getByRole("switch", { name: "Plugin Offable" });
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await sw.click();
  await expect.poll(async () => (await cfg(request)).plugins.off).toContain("offable");
  await sw.click();
  await expect.poll(async () => (await cfg(request)).plugins.off).not.toContain("offable");
  await request.post("/api/plugins/offable/remove", { headers: H });
});

// Found by clicking every button of every page: a choice detected twice (or "" both as Default and as
// a detected value) gave the list duplicate keys, and the control stopped answering. (The detected lists were the
// Terminal page's Claude installs; since the agent is a plugin's, they are the fonts of Appearance.)
test("the detected-choice lists open without an error", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openSettings(page);
  await nav(page).getByRole("button", { name: /^Appearance/ }).click();
  const art = page.locator('article[data-page="appearance"]');
  const lists = art.locator(".row", { hasText: /detected/ }).locator('button[aria-haspopup="listbox"]');
  await expect(lists.first()).toBeVisible({ timeout: 15000 }); // the detected choices arrive after the page
  for (let i = 0; i < await lists.count(); i++) {
    await lists.nth(i).click();
    await page.waitForTimeout(150);
    await page.keyboard.press("Escape");
  }
  expect(errors).toEqual([]);
});

test("the vim keys, formatting bar, formula preview, code bar and git gutter are on their pages", async ({ page }) => {
  await openSettings(page);
  await nav(page).getByRole("button", { name: /^Editor & Writing/ }).click();
  for (const name of [/Vim keys/i, /Format bar/i, /Math preview/i, /^Notes folder$/]) await expect(page.getByText(name).first()).toBeVisible();
  await nav(page).getByRole("button", { name: /^Extensions/ }).click();
  await page.getByTestId("settings-advanced").locator("summary").click();
  await expect(page.getByText(/Live editing|Terminal|LSP/i).first()).toBeVisible();
});

test("the options of the main features are on their pages, named so they read", async ({ page, request }) => {
  await openSettings(page);
  const labels: [RegExp, string[]][] = [
    [/^Editor & Writing/, ["Default template (a plain note starts from it)", "Notes folder"]],
    [/^Calendar & Daily Notes/, ["Daily log folder", "Daily log template"]],
  ];
  for (const [p, names] of labels) {
    await nav(page).getByRole("button", { name: p }).first().click();
    for (const n of names) await expect(page.locator("label", { hasText: new RegExp(`^${n.replace(/[()]/g, "\\$&")}$`) })).toBeVisible();
  }

  const before = await cfg(request);
  try {
    expect((await request.put("/api/config", { headers: H, data: { ...before, draw: { ...before.draw, page_format: "a5" } } })).ok()).toBeTruthy();
    await page.reload();
    await page.getByText("Finish the GW notes.").waitFor();
    await page.keyboard.press("Meta+Shift+D");
    await expect(page.getByPlaceholder("New drawing: its pages…")).toHaveCount(0);
    await page.getByTestId("palette").getByText("Blank", { exact: true }).click();
    await expect(page.locator(".excalidraw").first()).toBeVisible({ timeout: 20000 });
  } finally {
    await request.put("/api/config", { headers: H, data: before });
  }
});
