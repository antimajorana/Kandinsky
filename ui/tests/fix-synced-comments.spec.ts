import { test, expect } from "@playwright/test";
import { openFile } from "./open";

// A margin comment's jump (components/MarginComments.svelte) finds its quoted text where it is now: the offsets stored
// when it was made are stale once text is added above it.
const H = { "x-kandinsky": "1" };

test("jumping to a comment selects its quote after a paragraph was added above it", async ({ page, request }) => {
  const path = "notes/fix-synced-comments.md";
  const before = "# Comments\n\nFirst para.\n\nTarget sentence here.\n\nTail.\n";
  const quote = "Target sentence here.";
  await request.put("/api/file", { headers: H, data: { path, text: before } });
  const from = before.indexOf(quote);
  await request.post("/api/comments", {
    headers: H,
    data: { path, action: { kind: "add", from, to: from + quote.length, quote, anchor_line: 5, text: "check this", author: "alice" } },
  });
  await request.put("/api/file", {
    headers: H,
    data: { path, text: before.replace("# Comments\n\n", "# Comments\n\nA new paragraph that moves everything below it further down.\n\n") },
  });
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await openFile(page, "fix-synced-comments.md");
  await page.locator(".cm-line", { hasText: "Tail." }).click();
  await page.getByRole("button", { name: "Page actions" }).click();
  await page.getByRole("menuitem", { name: "Add comment on selection" }).click();
  const drawer = page.getByTestId("margin-comments");
  await expect(drawer.getByTestId("comment-thread")).toContainText("check this");
  await drawer.getByTestId("comment-thread").getByRole("button", { name: `“${quote}”` }).click();
  await expect.poll(() => page.evaluate(() => document.getSelection()?.toString() ?? "")).toBe(quote);
  await request.post(`/api/fs/trash?path=${encodeURIComponent(path)}`, { headers: H }).catch(() => {});
});
