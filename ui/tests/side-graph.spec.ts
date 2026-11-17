import { test, expect, type Page } from "@playwright/test";

async function openNote(page: Page, name: string, shows: string) {
  await page.keyboard.press("Control+p");
  await page.keyboard.type(name);
  await expect(page.getByTestId("palette").getByText(name.replace(/\.md$/, ""), { exact: true }).first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-content").first()).toContainText(shows);
}

// Local follows the note in front of the reader, not the one open when it was ticked.
test("Graph: Local follows the active note; Enter in the filter opens the match", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await openNote(page, "hubbard.md", "Energy");
  await page.keyboard.press("Meta+Shift+G");
  const pane = page.locator(".graph-pane");
  await expect(pane.locator(".meta")).toHaveText(/[1-9]\d* nodes/);
  await pane.getByTestId("graph-local-toggle").click();
  await expect(pane.locator(".meta")).toHaveText("3 nodes · 2 links");

  const hops = pane.getByRole("group", { name: "Local hop depth" });
  await hops.getByRole("button", { name: "2 hops" }).click();
  await expect(hops.getByRole("button", { name: "2 hops" })).toHaveAttribute("aria-pressed", "true");
  await hops.getByRole("button", { name: "1 hop" }).click();
  await expect(pane.locator(".meta")).toHaveText("3 nodes · 2 links");

  await openNote(page, "related.md", "See the");
  await page.keyboard.press("Meta+Shift+G");
  await expect(pane.locator(".meta")).toHaveText("2 nodes · 1 link");

  await pane.getByRole("button", { name: "Graph settings" }).click();
  await pane.getByRole("button", { name: "Filters" }).click();
  await pane.getByLabel("Search files").fill("hubbard");
  await expect(pane.locator(".meta")).toHaveText("1 node · 0 links");
  await pane.getByLabel("Search files").fill("");
  await expect(pane.locator(".meta")).toHaveText("2 nodes · 1 link");
});

// Nothing drawn: the canvas says why instead of staying blank.
test("Graph: an empty drawing explains itself", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await page.route("**/api/graph*", (r) => r.fulfill({ json: { nodes: [], edges: [] } }));
  await page.keyboard.press("Meta+Shift+G");
  await expect(page.locator(".graph-pane .empty")).toContainText("No notes yet");
});
