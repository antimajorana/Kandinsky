import { test, expect, type Page } from "@playwright/test";
import { shownName } from "../src/lib/paths";
import { mkdirSync } from "node:fs";
import { verticalTabs } from "./vertical";

// Vertical tabs (docs/design/VERTICAL-TABS.md), driven the way a person would: Ctrl+P to open notes, the
// sidebar's Open section to find, pin, split, close and collapse, a reload to see it all come back —
// then once by keyboard only. Screenshots of each step go to KANDINSKY_SHOTS (looked at by hand).
// The Open section lists a single tab only with vertical tabs: this spec runs with the setting on.
verticalTabs(test);
const SHOTS = process.env.KANDINSKY_SHOTS ?? "test-results/vtabs";
mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png` });

const side = (page: Page) => page.getByTestId("sidebar");
const open = (page: Page) => side(page).getByTestId("open-tabs");
const row = (page: Page, text: string) => open(page).locator(".pane-row", { hasText: shownName(text) }); // a note reads without ".md"
const activeRow = (page: Page) => side(page).locator(".pane-row.active, .pin.active");
/** Home (Today) is an app at the top, not a row */
const homeOn = (page: Page) => side(page).getByTestId("apps").locator(".app.active[aria-label=Home]");

async function openFile(page: Page, q: string, name: string) {
  await page.keyboard.press("Control+p");
  const palette = page.getByTestId("palette");
  await expect(palette.getByRole("textbox")).toBeFocused();
  await page.keyboard.type(q);
  await expect(palette.getByText(shownName(name), { exact: true }).first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(row(page, name)).toBeVisible();
  await expect(page.locator(".cm-editor.cm-focused")).toBeVisible(); // the note takes the keys once loaded
}

// pins live in a file of the vault (shared by every test): each test starts without any
test.beforeEach(async ({ page, request }) => {
  await request.put("/api/file", { headers: { "x-kandinsky": "1" }, data: { path: ".kandinsky/bookmarks.yaml", text: "pins: []\nbookmarks: []\n" } });
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
});

test("vertical tabs: open, find, pin, middle-click close, split, collapse + hover, restored after reload", async ({ page }) => {
  // the sidebar lists every open tab; the strip above the pane is gone
  await expect(side(page)).toBeVisible();
  await expect(page.locator(".dv-tabs-and-actions-container").first()).toBeHidden();
  for (const [q, name] of [["hubbard", "hubbard.md"], ["journal", "journal.md"], ["run.py", "run.py"], ["FOCUS", "FOCUS.md"]]) await openFile(page, q, name);
  await expect(activeRow(page)).toHaveText(/FOCUS/);
  await shot(page, "01-open");

  // find a tab: `%` in the command palette filters open tabs, Enter opens
  await page.keyboard.press("Meta+e");
  await expect(page.getByTestId("palette").getByRole("textbox")).toBeFocused();
  await page.keyboard.type("%jour");
  await shot(page, "02-find");
  await page.keyboard.press("Enter");
  await expect(activeRow(page)).toHaveText(/journal/);
  await expect(page.locator(".cm-content").filter({ hasText: "Talked about" })).toBeVisible();
  await expect(open(page).locator(".pane-row")).toHaveCount(4); // Home is an app, not a row

  // pin from the context menu: it becomes a tile on top and leaves the list
  await row(page, "hubbard.md").click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Pin/ }).click();
  const pins = page.getByTestId("pins");
  await expect(pins.locator(".pin", { hasText: "hubbard" })).toBeVisible();
  await expect(row(page, "hubbard.md")).toHaveCount(0);
  await shot(page, "03-pinned");

  // middle-click closes
  await row(page, "journal.md").click({ button: "middle" });
  await expect(row(page, "journal.md")).toHaveCount(0);

  // split right from the menu: both halves show in Dockview and in the list
  await row(page, "FOCUS.md").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Split right" }).click();
  await expect(open(page).locator(".pane-row.active, .pane-row.split-shown")).toHaveCount(2);
  await expect(page.locator(".dv-groupview")).toHaveCount(2);
  await shot(page, "05-split");

  // collapse to icons; hovering shows the full list over the panes
  await page.getByTestId("sidebar-toggle").click();
  await page.mouse.move(900, 450);
  await expect.poll(() => side(page).evaluate((el) => el.getBoundingClientRect().width)).toBeLessThan(60);
  await expect(side(page).locator(".pane-title")).toHaveCount(0);
  await shot(page, "06-collapsed");
  await page.mouse.move(26, 450);
  await expect(side(page)).toHaveClass(/peek/);
  await expect(side(page).locator(".pane-title").first()).toBeVisible();
  await shot(page, "07-hover");
  await page.mouse.move(900, 450);
  await expect(side(page)).not.toHaveClass(/peek/);

  // reload: pin, order, split and the collapsed sidebar come back
  await page.waitForTimeout(800); // the layout save is debounced
  await page.reload();
  // the text shows twice once both splits have loaded: on Today, and in FOCUS.md in the other split
  await page.getByText("Finish the GW notes.").first().waitFor();
  await expect(side(page).locator(".pin")).toHaveCount(1);
  await page.keyboard.press("Meta+s"); // expand again
  await expect(pins.locator(".pin", { hasText: "hubbard" })).toBeVisible();
  await expect(page.locator(".dv-groupview")).toHaveCount(2);
  // Home is opened on every start (App.svelte): the left split shows it (an app, not a row), the right one FOCUS.md
  await expect(homeOn(page)).toHaveCount(1);
  await expect(row(page, "FOCUS.md")).toHaveClass(/split-shown/);
  await expect(open(page).locator(".pane-row.active, .pane-row.split-shown")).toHaveCount(1);
  await expect(row(page, "FOCUS.md")).toHaveCount(1);
  await expect(row(page, "run.py")).toHaveCount(1);
  await shot(page, "08-restored");

  // a pinned tab survives being closed: the tile stays and reopens it
  await pins.locator(".pin", { hasText: "hubbard" }).click();
  await expect(page.locator(".cm-content").filter({ hasText: "Hubbard" })).toBeVisible();
  await page.keyboard.press("Control+w");
  await expect(pins.locator(".pin.resting", { hasText: "hubbard" })).toBeVisible();
  await pins.locator(".pin", { hasText: "hubbard" }).click();
  await expect(pins.locator(".pin.active", { hasText: "hubbard" })).toBeVisible();
});

test("vertical tabs: every row keeps its place when the collapsed bar opens over the panes", async () => {
  test.skip(true, "the Notion sidebar's peek lays its header and rows out differently from its icon rail (the vault button and padding shift the rows ~19px), unlike the classic bar this checked");
});

test("vertical tabs: drag a row to reorder the list", async () => {
  test.skip(true, "the Notion sidebar's Open rows are not draggable: the classic bar's drag-to-reorder (and its top/bottom-half drop line) is retired");
});

test("vertical tabs by keyboard only: Ctrl+Tab, Ctrl+1..9, pin", async ({ page }) => {
  for (const [q, name] of [["hubbard", "hubbard.md"], ["journal", "journal.md"], ["run.py", "run.py"]]) await openFile(page, q, name);
  // order: hubbard.md, journal.md, run.py (active); Home is an app, not counted. Ctrl+Tab is the glance
  // (tab-glance.spec.ts): a quick press goes to the tab used before, Ctrl+Shift+Tab to the one used longest ago
  await page.keyboard.press("Control+Tab");
  await expect(activeRow(page)).toHaveText(/journal/);
  await page.keyboard.press("Control+Shift+Tab");
  await expect(homeOn(page)).toHaveCount(1);
  await page.keyboard.press("Control+1");
  await expect(activeRow(page)).toHaveText(/hubbard/);
  await page.keyboard.press("Control+9");
  await expect(activeRow(page)).toHaveText(/run\.py/);

  // pin the current tab: it moves to the tiles and counts first for Ctrl+1
  await page.keyboard.press("Control+Alt+p");
  await expect(page.getByTestId("pins").locator(".pin.active")).toHaveText(/run/);
  await page.keyboard.press("Control+2");
  await expect(activeRow(page)).toHaveText(/hubbard/);
  await page.keyboard.press("Control+1");
  await expect(activeRow(page)).toHaveText(/run/);
});

test("vertical tabs by keyboard only: the tab list with j/k/x/Enter/Esc", async () => {
  test.skip(true, "the tab list that Ctrl+Shift+A focused (j/k/x/Enter/Esc, / to filter, its peek when collapsed) belonged to the retired classic bar; the Notion sidebar finds a tab through the palette's % instead");
});

test("horizontal tabs (setting) keep the classic strips and the activity rail", async () => {
  test.skip(true, "the Notion shell is always on: the Activity rail and the dockview tab strips of the classic layout are retired, the sidebar stays with ui.tabs = horizontal");
});
