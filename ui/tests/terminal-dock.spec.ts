import { test, expect, type Page } from "@playwright/test";

// The terminal's show / hide and dock buttons were the classic left bar's Terminal heading; in the Notion sidebar the
// panel is shown / hidden with its key (Super+J) and moved by the palette's command, as the side tools are opened.
const command = async (page: Page, title: string) => {
  await page.keyboard.press("Meta+e");
  await page.keyboard.type(title);
  await page.getByTestId("palette").getByText(title).first().click();
};
const MOVE = "Move terminal panel (bottom ↔ right)";
const SEARCH = "Search in workspace"; // the side panel's tool that is a pane of the dock (Files is the sidebar's tree now)

// The terminal: its key shows / hides the panel (the shells keep running); one command docks it right or bottom.
test("terminal: key shows/hides, hidden state is live, dock right and back", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  const term = page.locator(".xterm").first();
  await page.keyboard.press("Meta+j");
  await expect(term).toBeVisible();
  await page.keyboard.press("Meta+j"); // visible → hide
  await expect(term).toBeHidden();
  await page.keyboard.press("Meta+j");
  await expect(term).toBeVisible();
  await command(page, MOVE);
  await expect.poll(async () => (await term.boundingBox())!.height).toBeGreaterThan(500); // full height = right
  await command(page, MOVE);
  await expect.poll(async () => (await term.boundingBox())!.height).toBeLessThan(500);
});

// each order in a test of its own: a fresh window (a reload would bring the first order's tabs back)
for (const order of [["Meta+j", "search"], ["search", "Meta+j"]]) {
  test(`the terminal spans the bottom, under the side panel, whichever was opened first (${order.join(" then ")})`, async ({ page }) => {
    const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
    await page.goto("/");
    await page.getByText("Finish the GW notes.").waitFor();
    for (const key of order) {
      if (key === "search") await command(page, SEARCH); else await page.keyboard.press(key);
      await page.waitForTimeout(500);
    }
    await expect(page.locator(".side-pane").first()).toBeVisible();
    await expect(page.locator(".xterm").first()).toBeVisible();
    const files = await box(".side-pane"), term = await box(".xterm");
    expect(term.x, "the terminal starts under the side panel, at the dock's left").toBeLessThan(files.x + files.width - 20);
    expect(files.y + files.height, "the side panel ends above the terminal").toBeLessThanOrEqual(term.y + 2);
  });
}

// "if i close the main editor tab and then open it the whole layout gets a bit crazy": with no
// editor left, the next one goes back between the two tool panels, which keep their sizes
test("closing the last editor tab and opening one keeps the layout", async ({ page }) => {
  const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await command(page, SEARCH);
  await page.waitForTimeout(500);
  await page.keyboard.press("Meta+j");
  await page.waitForTimeout(500);
  // the panel's own height (the lowest group): the .xterm inside it snaps to whole text rows, which half a pixel of rounding can change by one row
  const panelHeight = () => page.evaluate(() => Math.max(...[...document.querySelectorAll(".dv-groupview")].map((g) => g.getBoundingClientRect()).sort((a, b) => b.y - a.y).slice(0, 1).map((r) => r.height)));
  const before = { files: await box(".side-pane"), term: { height: await panelHeight() } };
  await page.getByText("Finish the GW notes.").click();
  await page.keyboard.press("Control+w");
  await expect(page.locator(".dv-tab", { hasText: "Today" })).toHaveCount(0);
  await page.keyboard.press("Meta+e");
  await page.keyboard.type("Home (your home");
  await page.getByTestId("palette").getByText("Home (your home document)").first().waitFor();
  await page.keyboard.press("Enter");
  await page.getByText("Finish the GW notes.").waitFor();
  await page.waitForTimeout(400);
  const files = await box(".side-pane"), term = await box(".xterm"), today = await box(".kandinsky-pane-page");
  expect(Math.abs(files.width - before.files.width), "the side panel keeps its width").toBeLessThan(12);
  expect(Math.abs((await panelHeight()) - before.term.height), "the terminal keeps its height").toBeLessThan(12);
  expect(today.x, "the editor is right of the side panel").toBeGreaterThanOrEqual(files.x + files.width - 2);
  expect(today.y + today.height, "the editor is above the terminal").toBeLessThanOrEqual(term.y + 2);
  expect(term.x, "the terminal still spans the window").toBeLessThan(files.x + files.width - 20);
  // docking right and back keeps the shape too
  await command(page, MOVE);
  await expect.poll(async () => (await box(".xterm")).height).toBeGreaterThan(500);
  await command(page, MOVE);
  await expect.poll(async () => (await box(".xterm")).x).toBeLessThan(files.x + files.width - 20);
});

// A new shell (or a plugin's, as SSH opens one) while the terminal panel is hidden shows the panel with it, as asking
// again for an open terminal does: it used to be added to the hidden panel and stay out of sight.
test("a new terminal opened while the panel is hidden brings the panel back", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await page.keyboard.press("Meta+j");
  await expect(page.locator(".xterm").first()).toBeVisible();
  await page.keyboard.press("Meta+j"); // hidden, its shell still running
  await expect(page.locator(".xterm").first()).toBeHidden();
  await page.keyboard.press("F1");
  await page.keyboard.type("New shell terminal");
  await page.getByTestId("palette").getByText("New shell terminal").first().click();
  await expect(page.locator(".xterm").last()).toBeVisible();
  await expect(page.locator(".xterm")).toHaveCount(2);
});
