import { test, expect, type Page } from "@playwright/test";
import { openFile } from "./open";

// "Copy #^block reference" on a list item with children: the ID goes on the item's own first line, and is read back
// from there, so a second copy reuses it and a child's own ID is never taken for the parent's.
const H = { "x-kandinsky": "1" };

async function copyRef(page: Page, lineText: string) {
  const cm = page.locator(".live-cm");
  const line = cm.locator(".cm-line", { hasText: lineText }).first();
  await expect(line).toBeVisible();
  const box = (await line.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + box.height / 2);
  const handle = cm.locator(".cm-block-gutter.is-visible .cm-block-handle");
  await expect(handle).toBeVisible();
  await handle.click();
  await page.getByRole("menuitem", { name: "Copy #^block reference" }).click();
  await page.mouse.move(0, 0);
}

async function savedText(page: Page, request: import("@playwright/test").APIRequestContext, path: string, has: RegExp) {
  await page.locator(".live-cm .cm-line", { hasText: "Tail line." }).click(); // the editor has the keys for Ctrl+S
  await page.keyboard.press("Control+s");
  let text = "";
  await expect.poll(async () => {
    text = String((await (await request.get(`/api/file?path=${encodeURIComponent(path)}`, { headers: H })).json()).text ?? "");
    return text;
  }, { timeout: 10_000 }).toMatch(has);
  return text;
}

test("a list item with children gets one block ID on its own line, reused on the next copy", async ({ page, request }) => {
  const path = "notes/fix-block-id-list.md";
  await request.put("/api/file", {
    headers: H,
    data: { path, text: "# Block ids\n\n- Parent item\n  - child A\n  - child B\n\nTail line.\n" },
  });
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await openFile(page, "fix-block-id-list.md");
  await copyRef(page, "Parent item");
  await copyRef(page, "Parent item");
  const text = await savedText(page, request, path, /\^blk-/);
  expect(text.match(/\^blk-[A-Za-z0-9-]+/g)?.length).toBe(1);
  expect(text).toMatch(/^- Parent item \^blk-[A-Za-z0-9-]+$/m);
  expect(text).toContain("\n  - child B\n");
  await request.post(`/api/fs/trash?path=${encodeURIComponent(path)}`, { headers: H }).catch(() => {});
});

test("a parent list item does not take its last child's block ID", async ({ page, request }) => {
  const path = "notes/fix-block-id-child.md";
  await request.put("/api/file", {
    headers: H,
    data: { path, text: "# Block ids\n\n- Parent item\n  - child A\n  - child B ^cb\n\nTail line.\n" },
  });
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await openFile(page, "fix-block-id-child.md");
  await copyRef(page, "Parent item");
  const text = await savedText(page, request, path, /\^blk-/);
  expect(text).toMatch(/^- Parent item \^blk-[A-Za-z0-9-]+$/m);
  expect(text).toMatch(/^ {2}- child B \^cb$/m);
  await request.post(`/api/fs/trash?path=${encodeURIComponent(path)}`, { headers: H }).catch(() => {});
});

test("an ID at the end of a list item's continuation line is reused, not doubled", async ({ page, request, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const path = "notes/fix-block-id-wrapped.md";
  await request.put("/api/file", {
    headers: H,
    data: { path, text: "# Block ids\n\n- Parent text\n  continued here ^myid\n  - child A ^ca\n\nTail line.\n" },
  });
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await openFile(page, "fix-block-id-wrapped.md");
  await copyRef(page, "Parent text");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5_000 }).toMatch(/#\^myid\]\]$/);
  const doc = await page.locator(".live-cm .cm-content").textContent();
  expect(doc).not.toContain("^blk-");
  await request.post(`/api/fs/trash?path=${encodeURIComponent(path)}`, { headers: H }).catch(() => {});
});
