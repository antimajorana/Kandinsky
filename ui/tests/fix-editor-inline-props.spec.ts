import { test, expect } from "@playwright/test";
import { openFile } from "./open";

// The inline property rows are one shared host inside a CodeMirror widget: a property edit must not rebuild the
// widget, which moved the host and took the focus out of the field being typed in.
const H = { "x-kandinsky": "1" };

test("adding tags in the inline properties keeps the tag field focused", async ({ page, request }) => {
  const path = "notes/fix-inline-tags.md";
  await request.put("/api/file", {
    headers: H,
    data: { path, text: "---\ntags: [alpha]\n---\n# Inline tags\n\nBody line.\n" },
  });
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await openFile(page, "fix-inline-tags.md");
  const row = page.getByTestId("inline-properties").locator('[data-prop-key="tags"]');
  await expect(row).toContainText("alpha");
  const input = row.getByPlaceholder("Add a tag…");
  await input.click();
  await page.keyboard.type("beta");
  await page.keyboard.press("Enter");
  await expect(row).toContainText("beta");
  await expect(input).toBeFocused();
  // the next tag goes straight in, without clicking the field again
  await page.keyboard.type("gamma");
  await page.keyboard.press("Enter");
  await expect(row).toContainText("gamma");
  await expect(input).toBeFocused();
  await request.post(`/api/fs/trash?path=${encodeURIComponent(path)}`, { headers: H }).catch(() => {});
});
