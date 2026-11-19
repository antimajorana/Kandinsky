import { test, expect } from "@playwright/test";

// The tree without repetition (docs/design/DESIGN-shared-notes.md): a paper's folder is its note,
// a mail's attachments folder, a PDF's ink and a `shown: false` note fold away; "Show hidden files" brings them back.
const H = { "x-kandinsky": "1" };
const put = (request: import("@playwright/test").APIRequestContext, path: string, text: string) => request.put("/api/file", { headers: H, data: { path, text } });

test("companions fold away, a folder with its own note opens it, the eye shows everything", async ({ page, request }) => {
  test.setTimeout(60_000);
  await put(request, "tc/k/k.md", "---\ncitekey: k\n---\n# The paper\n");
  await put(request, "tc/k/chap.pdf", "%PDF-1.4\n");
  await put(request, "tc/k/chap.pdf.excalidraw", "{}");
  await put(request, "tc/k/data.md", "---\nshown: false\n---\n# data\n");
  await put(request, "tc/mail.md", "# a mail\n");
  await put(request, "tc/mail files/a.txt", "attachment\n");
  try {
    await page.goto("/");
    await page.getByText("Finish the GW notes.").waitFor();
    await page.locator('.row[data-path="tc"]').click();
    await expect(page.locator('.row[data-path="tc/mail.md"]')).toBeVisible();
    await expect(page.locator('.row[data-path="tc/mail files"]')).toHaveCount(0);
    // the paper's folder: its name opens its note and unfolds the rest, without the note again
    await page.locator('.row[data-path="tc/k"]').click();
    await expect(page.locator(".cm-content").filter({ hasText: "The paper" })).toBeVisible();
    await expect(page.locator('.row[data-path="tc/k/chap.pdf"]')).toBeVisible();
    for (const hidden of ["tc/k/k.md", "tc/k/chap.pdf.excalidraw", "tc/k/data.md"]) await expect(page.locator(`.row[data-path="${hidden}"]`)).toHaveCount(0);
    // the eye: the sidebar tree header's own button, everything, then hidden again
    const eye = async () => {
      await page.getByTestId("sidebar").getByRole("button", { name: "Show hidden files" }).click();
    };
    await eye();
    for (const shown of ["tc/k/k.md", "tc/k/chap.pdf.excalidraw", "tc/k/data.md", "tc/mail files"]) await expect(page.locator(`.row[data-path="${shown}"]`)).toBeVisible();
    await eye();
    await expect(page.locator('.row[data-path="tc/mail files"]')).toHaveCount(0);
  } finally {
    await request.post("/api/fs/trash?path=tc", { headers: H });
  }
});
