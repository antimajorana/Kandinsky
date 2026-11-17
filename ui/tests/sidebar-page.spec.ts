import { test, expect, type Page } from "@playwright/test";
import { shownName } from "../src/lib/paths";

// The shell as files, second half (docs/guides/SHELL.md): bookmarks and pins live in `.kandinsky/bookmarks.yaml`,
// and the sidebar is a page of blocks (`.kandinsky/sidebar.page`) that can be rearranged like any page.
const FILES = { bookmarks: ".kandinsky/bookmarks.yaml", sidebar: ".kandinsky/sidebar.page" };
const side = (page: Page) => page.getByTestId("sidebar");
const fileText = (page: Page, path: string) => page.request.get(`/api/file?path=${path}`, { headers: { "x-kandinsky": "1" } }).then((r) => r.json()).then((j) => String(j.text ?? ""));
const put = (page: Page, path: string, text: string) => page.request.put("/api/file", { headers: { "x-kandinsky": "1" }, data: { path, text } });

async function run(page: Page, command: string) {
  await page.keyboard.press("Meta+e");
  const palette = page.getByTestId("palette");
  await expect(palette.getByRole("textbox")).toBeFocused();
  await page.keyboard.type(command);
  await palette.getByText(command, { exact: false }).first().click();
}
async function openFile(page: Page, q: string, name: string) {
  await page.keyboard.press("Control+p");
  const palette = page.getByTestId("palette");
  await expect(palette.getByRole("textbox")).toBeFocused();
  await page.keyboard.type(q);
  await expect(palette.getByText(shownName(name), { exact: true }).first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-editor.cm-focused")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await put(page, FILES.bookmarks, "# mine\npins: []\nbookmarks: []\n");
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
});

test("bookmarks: a tab and a saved search go to the bookmarks file and show in Favorites", async ({ page }) => {
  await openFile(page, "hubbard", "hubbard.md");

  // bookmark the tab: it appears in Favorites in NotionSidebar and in bookmarks.yaml
  await page.keyboard.press("Control+Alt+b");
  const palette = page.getByTestId("palette");
  await palette.getByText("Bookmark this tab").click();
  const fav = side(page).locator('section[aria-label="Favorites"]');
  await expect(fav.locator(".fav-row", { hasText: "hubbard" })).toBeVisible();
  await expect.poll(() => fileText(page, FILES.bookmarks)).toContain("hubbard.md");

  // a typed text is kept as a saved search
  await page.keyboard.press("Control+Alt+b");
  await expect(palette.getByRole("textbox")).toBeFocused();
  await page.keyboard.type("self-energy");
  await palette.getByText("Save the search").click();
  await expect(fav.locator(".fav-row", { hasText: "Search: self-energy" })).toBeVisible();
  const text = await fileText(page, FILES.bookmarks);
  expect(text).toContain("# mine");
  expect(text).toContain("search: self-energy");

  // edited as text: Favorites follows the file, and clicking Preferences opens Settings
  await put(page, FILES.bookmarks, "pins: []\nbookmarks:\n  - {command: ui.settings, title: Preferences}\n");
  await expect(fav.locator(".fav-row")).toHaveText(["Preferences"]);
  await fav.locator(".fav-row").click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});

test("unified NotionSidebar shows primary navigation and vault footer cleanly", async ({ page }) => {
  await expect(side(page).getByTestId("apps").getByRole("button", { name: "Home", exact: true })).toBeVisible();
  await expect(side(page).getByTestId("nav-calendar")).toBeVisible();
  await expect(side(page).getByTestId("sidebar-import")).toHaveCount(1);
  await expect(side(page).getByRole("button", { name: "Settings", exact: true })).toBeVisible();
});

test("a server older than /api/exists: the bookmarks file is still found and read, not taken for missing", async ({ page }) => {
  // the phone app shows its own interface on a server's vault, which may be older (vault-files.ts falls back to listings)
  await page.route("**/api/exists?**", (r) => r.fulfill({ status: 404, json: { error: "/api/exists" } }));
  await put(page, FILES.bookmarks, "pins: []\nbookmarks:\n  - {command: ui.settings, title: Preferences}\n");
  await page.reload();
  await expect(side(page).locator('section[aria-label="Favorites"] .fav-row')).toHaveText(["Preferences"]);
});
