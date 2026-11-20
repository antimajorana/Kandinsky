import { test, expect, type Page } from "@playwright/test";

// Zen's split view: a tab outside the split is shown alone, the split row stays, a click on
// it brings the pair back side by side (lib/tabs.svelte.ts splitPair).
const H = { "x-kandinsky": "1" };

async function openNote(page: Page, name: string): Promise<void> {
  await page.keyboard.press("Control+p");
  await page.keyboard.type(name);
  await expect(page.getByTestId("palette").getByText(name, { exact: true }).first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-content").filter({ hasText: `Body of ${name}` }).first()).toBeVisible();
}

test("a tab outside the split shows alone; the split row brings the pair back", async ({ page, request }) => {
  for (const n of ["split-a", "split-b", "split-c"]) await request.put("/api/file", { headers: H, data: { path: `notes/${n}.md`, text: `# ${n}\n\nBody of ${n}\n` } });
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  for (const n of ["split-a", "split-b", "split-c"]) await openNote(page, n);
  const open = openTabs(page);
  const rowOf = (n: string) => open.locator(".pane-row", { hasText: n }).first();
  await rowOf("split-c").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Split right" }).click();
  await expect(pairRows(page)).toHaveCount(2);
  const visible = () => page.locator(".editor-pane").filter({ visible: true }).count();
  await expect.poll(visible).toBe(2);
  const pairText = (await pairRows(page).allInnerTexts()).join(" ");
  const pair = ["split-a", "split-b", "split-c"].filter((n) => pairText.includes(n));
  expect(pair).toHaveLength(2);
  const outside = ["split-a", "split-b"].find((n) => !pairText.includes(n))!;
  // a tab outside the pair: alone on screen, the pair's rows still listed
  await rowOf(outside).locator(".pane-main").click();
  await expect.poll(visible).toBe(1);
  await expect(page.locator(".cm-content").filter({ hasText: `Body of ${outside}` }).filter({ visible: true })).toHaveCount(1);
  // (a group shown alone is full-window: the sidebar keeps to its icon rail, one button per tab)
  const mini = (n: string) => page.getByTestId("sidebar").locator(`.pane-mini-btn[aria-label="${n}"]`);
  for (const n of pair) await expect(mini(n)).toHaveCount(1);
  // a click on a tab of the pair: both halves again
  await mini(pair[0]).click();
  await expect.poll(visible).toBe(2);
});

// The sidebar's Open section lists the open tabs; in a split the pair on screen is the
// active row (.pane-row.active) and the other half's shown row (.pane-row.split-shown).
const openTabs = (page: Page) => page.getByTestId("sidebar").getByTestId("open-tabs");
const splitGroups = (page: Page) => page.locator(".dv-groupview");
const pairRows = (page: Page) => openTabs(page).locator(".pane-row.active, .pane-row.split-shown");

// An × on each half closes that half and ends the split: the half's × in the open row, and the one in
// the corner of each half on screen, close that half's tab; the tabs behind it join the other half, one editor again.
async function splitThree(page: Page, names: string[]): Promise<void> {
  for (const n of names) await page.request.put("/api/file", { headers: H, data: { path: `notes/${n}.md`, text: `# ${n}\n\nBody of ${n}\n` } });
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  for (const n of names) await openNote(page, n);
  await openTabs(page).locator(".pane-row", { hasText: names[2] }).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Split right" }).click();
  await expect(splitGroups(page)).toHaveCount(2);
  await expect(pairRows(page)).toHaveCount(2);
}
const shown = (page: Page) => page.locator(".editor-pane").filter({ visible: true }).count();

test("a half's × in the split row closes that half and ends the split", async ({ page }) => {
  await splitThree(page, ["half-a", "half-b", "half-c"]);
  const open = openTabs(page);
  const half = open.locator(".pane-row", { hasText: "half-c" });
  await half.hover();
  await half.getByRole("button", { name: "Close half-c" }).click();
  await expect(splitGroups(page)).toHaveCount(1); // one editor again
  await expect(open.locator(".pane-row.split-shown")).toHaveCount(0);
  await expect.poll(() => shown(page)).toBe(1);
  await expect(open.locator(".pane-row", { hasText: "half-c" })).toHaveCount(0);
  await expect(open.locator(".pane-row", { hasText: "half-a" })).toHaveCount(1); // the other tabs kept
  await expect(open.locator(".pane-row", { hasText: "half-b" })).toHaveCount(1);
});

test("the × in a half's corner closes that half and ends the split", async ({ page }) => {
  await splitThree(page, ["corner-a", "corner-b", "corner-c"]);
  const closes = page.locator(".dv-groupview > .half-close");
  await expect(closes).toHaveCount(2);
  const right = page.locator(".dv-groupview", { has: page.locator(".cm-content", { hasText: "Body of corner-c" }) });
  await right.hover();
  await right.locator("> .half-close").click();
  await expect(splitGroups(page)).toHaveCount(1); // one editor again
  await expect(openTabs(page).locator(".pane-row.split-shown")).toHaveCount(0);
  await expect.poll(() => shown(page)).toBe(1);
  await expect(closes).toHaveCount(0);
  await expect(openTabs(page).locator(".pane-row", { hasText: "corner-a" })).toHaveCount(1); // the list is there…
  await expect(openTabs(page).locator(".pane-row", { hasText: "corner-c" })).toHaveCount(0); // …without the closed half
});

// The focus inside a split: a click in a half makes it the active tab (marked in the open list), the keys go there,
// and Ctrl+W closes that half — not the other.
test("a click in a half focuses it: its row is marked, typing and Ctrl+W go to it", async ({ page, request }) => {
  await splitThree(page, ["focus-a", "focus-b", "focus-c"]);
  const open = openTabs(page);
  const pair = (await pairRows(page).allInnerTexts()).map((t) => ["focus-a", "focus-b", "focus-c"].find((n) => t.includes(n))!);
  for (const name of [pair[1], pair[0], pair[1]]) {
    await page.locator(".cm-content", { hasText: `Body of ${name}` }).filter({ visible: true }).click();
    await expect(open.locator(".pane-row.active")).toHaveText(new RegExp(name));
  }
  const [other, focused] = pair;
  await page.keyboard.press("Escape");
  await page.keyboard.type("Go typed"); // vim (the test vault's editor): a new last line, insert mode
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await (await request.get(`/api/file?path=notes/${focused}.md`, { headers: H })).json()).text, { timeout: 15_000 }).toContain("typed");
  expect((await (await request.get(`/api/file?path=notes/${other}.md`, { headers: H })).json()).text).not.toContain("typed");
  await page.keyboard.press("Control+w");
  await expect(splitGroups(page)).toHaveCount(1);
  await expect(open.locator(".pane-row.split-shown")).toHaveCount(0);
  await expect(open.locator(".pane-row", { hasText: focused })).toHaveCount(0);
  await expect(open.locator(".pane-row", { hasText: other })).toHaveCount(1);
});
