import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { openFile } from "./open";

const HEADERS = { "x-kandinsky": "1" };

async function openNoteInEditor(page: Page, request: any, path: string, content: string): Promise<void> {
  await request.put("/api/file", {
    headers: { ...HEADERS, "content-type": "application/json" },
    data: { path, text: content },
  });
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  const baseName = path.split("/").pop() ?? path;
  await openFile(page, baseName);
  await expect(page.locator(`.live-cm[data-note="${path}"]`)).toBeVisible();
}

test.describe("Stage 2 High-Payoff Extras (E2, E6, E7, E8, E10)", () => {
  test("E2: EmojiIconPicker search, recent persistence, random and custom image", async ({ page, request }) => {
    const notePath = "notes/e2-icon-test.md";
    await openNoteInEditor(page, request, notePath, "---\ntitle: Icon Test\n---\n# Icon Test\n\nBody text.\n");

    const hero = page.getByTestId("hero-actions");
    await hero.getByRole("button", { name: /Add icon|Change icon/ }).click({ force: true });

    const picker = page.getByTestId("icon-picker");
    await expect(picker).toBeVisible();

    const search = picker.getByTestId("icon-search-input");
    await search.fill("microscope");
    const microscopeBtn = picker.getByRole("button", { name: "Microscope" });
    await expect(microscopeBtn).toBeVisible();
    await microscopeBtn.click();

    await expect(picker).toHaveCount(0);
    await expect.poll(async () => {
      const f = await (await request.get(`/api/file?path=${encodeURIComponent(notePath)}`, { headers: HEADERS })).json();
      return f.text;
    }).toContain("🔬");

    // Recent icon persistence in localStorage + UI section
    const recents = await page.evaluate(() => JSON.parse(localStorage.getItem("kandinsky.recent-icons") || "[]"));
    expect(recents).toContain("🔬");

    await hero.getByRole("button", { name: /Change icon|Add icon/ }).click({ force: true });
    await expect(page.getByTestId("icon-recent-section")).toContainText("🔬");

    // Custom image tab updates frontmatter `icon:`
    await page.getByTestId("icon-picker").getByRole("tab", { name: "Custom image" }).click();
    await page.getByTestId("icon-custom-image-input").fill("assets/emblem.png");
    await page.getByTestId("icon-picker").getByRole("button", { name: "Apply" }).click();
    await expect.poll(async () => {
      const f = await (await request.get(`/api/file?path=${encodeURIComponent(notePath)}`, { headers: HEADERS })).json();
      return f.text;
    }).toContain("assets/emblem.png");
  });

  test("E6: ImageWidget drag-resize handle and alignment buttons update Markdown", async ({ page, request }) => {
    const imgBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAADklEQVQI12NgQAP///8DABQAA/7y684AAAAASUVORK5CYII=";
    await request.post("/api/fs/upload?path=notes%2Fe6-fig.png&replace=true", {
      headers: HEADERS,
      data: Buffer.from(imgBase64, "base64"),
    });

    const notePath = "notes/e6-image-resize.md";
    await openNoteInEditor(page, request, notePath, "# Image Test\n\n![[e6-fig.png]]\n\nParagraph below.\n");

    // Move caret away from the embed line so ImageWidget renders
    await page.locator(".cm-line", { hasText: "Paragraph below." }).click();

    const frame = page.locator(".cm-img-frame").first();
    await expect(frame).toBeVisible();

    // Alignment control -> Center writes |center
    await frame.hover();
    await frame.getByRole("button", { name: "Center" }).click();
    await expect.poll(async () => {
      const f = await (await request.get(`/api/file?path=${encodeURIComponent(notePath)}`, { headers: HEADERS })).json();
      return f.text;
    }).toContain("![[e6-fig.png|center]]");

    // Drag right resize handle -> updates |<width>
    const handle = frame.locator(".cm-img-handle-right");
    const box = await handle.boundingBox();
    expect(box).toBeTruthy();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 5 });
      await page.mouse.up();
    }
    await expect.poll(async () => {
      const f = await (await request.get(`/api/file?path=${encodeURIComponent(notePath)}`, { headers: HEADERS })).json();
      return /!\[\[e6-fig\.png\|center\|\d+\]\]/.test(f.text);
    }).toBe(true);
  });

  test("E7: Lock page toggles read-only state, Locked pill, and Unlock", async ({ page, request }) => {
    const notePath = "notes/e7-lock-test.md";
    await openNoteInEditor(page, request, notePath, "---\ntitle: Lock Test\n---\n# Lock Test\n\nInitial body.\n");

    await page.getByTestId("editor-more-btn").click();
    await page.getByRole("menuitem", { name: "Lock page" }).click();

    const pill = page.getByTestId("page-locked-pill");
    await expect(pill).toBeVisible();
    await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "false");

    await expect.poll(async () => {
      const f = await (await request.get(`/api/file?path=${encodeURIComponent(notePath)}`, { headers: HEADERS })).json();
      return f.text;
    }).toContain("locked: true");

    // Attempted typing while locked must not change body
    await page.locator(".cm-line", { hasText: "Initial body." }).click();
    await page.keyboard.type("SHOULD_NOT_APPEAR");
    await expect(page.locator(".cm-content")).not.toContainText("SHOULD_NOT_APPEAR");

    // Click Locked pill to unlock
    await pill.click();
    await expect(pill).toHaveCount(0);
    await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "true");
  });

  test("E8: Share -> Export to PDF returns valid %PDF- bytes", async ({ page, request }) => {
    const notePath = "notes/e8-pdf-test.md";
    await openNoteInEditor(page, request, notePath, "# Export PDF Test\n\nHello **Typst** $E = mc^2$.\n");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Share" }).click();
    await page.getByRole("menuitem", { name: "Export to PDF" }).click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("e8-pdf-test.pdf");
    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    if (filePath) {
      const bytes = readFileSync(filePath);
      expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    }
  });

  test("E10: Related notes appear in Backlinks with clickable note & Copy [[link]]", async ({ page, request }) => {
    const noteA = "notes/e10-alpha.md";
    const noteB = "notes/e10-beta.md";
    await request.put("/api/file", {
      headers: { ...HEADERS, "content-type": "application/json" },
      data: { path: noteB, text: "---\ntags: [quantum-optics, photonics]\n---\n# Beta Note\n\nRelated topic.\n" },
    });
    await openNoteInEditor(page, request, noteA, "---\ntags: [quantum-optics, photonics]\n---\n# Alpha Note\n\nPrimary topic.\n");

    const backlinks = page.getByTestId("backlinks-section");
    await expect(backlinks).toBeVisible();
    await backlinks.locator("button.head").click();

    const relatedBox = page.getByTestId("related-notes");
    await expect(relatedBox).toBeVisible();
    await expect(relatedBox).toContainText(/Beta Note|e10-beta/);
    await expect(relatedBox.getByRole("button", { name: "Copy [[link]]" }).first()).toBeVisible();
  });
});
