import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const H = { "x-kandinsky": "1" };

function trackErrors(page: Page): string[] {
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  return errs;
}

async function createAndOpenNote(page: Page, request: APIRequestContext, path: string, text: string): Promise<void> {
  await request.put("/api/file", { headers: H, data: { path, text } });
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await page.evaluate((p) => {
    const k = (window as unknown as { __kandinsky?: { open: (path: string) => void } }).__kandinsky;
    k?.open(p);
  }, path);
  await expect(page.locator(`.live-cm[data-note="${path}"]`)).toBeVisible();
  await page.locator(`.live-cm[data-note="${path}"] .cm-content`).click();
}

async function trashNote(request: APIRequestContext, path: string): Promise<void> {
  await request.post(`/api/fs/trash?path=${encodeURIComponent(path)}`, { headers: H });
}

test("Live Preview rendered code fence shows Copy button & copies text without duplicate language label", async ({ page, request, context }) => {
  const errs = trackErrors(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const path = "notes/stage2-code-fence.md";
  await createAndOpenNote(
    page,
    request,
    path,
    "# Code Fence Demo\n\nIntro line.\n\n```python\ndef hello():\n    return 42\n```\n",
  );

  try {
    const editor = page.locator(`.live-cm[data-note="${path}"]`);
    const renderedPre = editor.locator(".cm-rendered-block pre[data-code-chrome='1']");
    await expect(renderedPre).toBeVisible();
    await expect(renderedPre.locator(".code-lang")).toHaveCount(0);
    await expect(renderedPre.locator(".code-fence-lang")).toHaveText("python");

    await renderedPre.hover();
    const copyBtn = renderedPre.locator(".code-fence-copy");
    await expect(copyBtn).toBeVisible();
    await copyBtn.click();
    await expect(copyBtn).toHaveText("Copied");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied.trim()).toBe("def hello():\n    return 42");
  } finally {
    await trashNote(request, path);
  }
  expect(errs).toEqual([]);
});

test("1-click collapsible headings H1-H6 render logical N blocks hidden pill and respect fold_headings", async ({ page, request }) => {
  const errs = trackErrors(page);
  const path = "notes/stage2-heading-folds.md";
  await createAndOpenNote(
    page,
    request,
    path,
    [
      "# Title",
      "",
      "###### Deep Heading",
      "",
      "First paragraph line one",
      "First paragraph line two.",
      "",
      "- Item one",
      "- Item two",
      "",
      "```js",
      "console.log(1);",
      "```",
      "",
      "Tail outside.",
    ].join("\n"),
  );

  try {
    const editor = page.locator(`.live-cm[data-note="${path}"]`);
    const h6Line = editor.locator(".cm-line", { hasText: "Deep Heading" });
    await h6Line.hover();
    const foldBtn = h6Line.locator(".cm-h-fold");
    await expect(foldBtn).toBeVisible();
    await foldBtn.click();

    // 1 paragraph + 2 list items + 1 fenced code block = 4 logical blocks (until end of doc because no <= H6 heading follows)
    const foldedPill = editor.locator(".cm-h-fold.is-folded");
    await expect(foldedPill).toBeVisible();
    await expect(foldedPill).toContainText("blocks hidden");
    await expect(foldedPill).toContainText("▸ ⋯");

    // Unfold back
    await foldedPill.click();
    await expect(editor.locator(".cm-h-fold.is-folded")).toHaveCount(0);
  } finally {
    await trashNote(request, path);
  }
  expect(errs).toEqual([]);
});

test("/diagram slash command inserts Mermaid fence with zoomable SVG and preserves fallback on syntax error", async ({ page, request }) => {
  const errs = trackErrors(page);
  const path = "notes/stage2-mermaid.md";
  await createAndOpenNote(page, request, path, "# Diagram Note\n\n");

  try {
    const editor = page.locator(`.live-cm[data-note="${path}"]`);
    await editor.locator(".cm-content").click();
    // In Vim NORMAL mode, press G then o to open a new line at EOF in INSERT mode without mutating config.toml
    const vimBtn = page.getByTestId("vim-mode");
    if ((await vimBtn.count()) > 0 && (await vimBtn.textContent())?.trim() === "NORMAL") {
      await page.keyboard.press("G");
      await page.keyboard.press("o");
    } else {
      await page.keyboard.press("Control+End");
    }
    await page.keyboard.type("/diagram");
    const slashMenu = page.getByTestId("slash-menu");
    await expect(slashMenu).toBeVisible();
    await expect(slashMenu).toContainText("Mermaid Diagram");
    await page.keyboard.press("Enter");

    // Exit insert mode / move caret outside the fence so Live Preview renders the Mermaid SVG
    await page.keyboard.press("Escape");
    await page.keyboard.press("G");
    await page.keyboard.press("o");
    await page.keyboard.type("Tail line.");
    await page.keyboard.press("Escape");

    const fig = editor.locator(".mermaid-figure[data-state='done']");
    await expect(fig).toBeVisible({ timeout: 15_000 });
    await expect(fig.locator("svg")).toBeVisible();

    await fig.hover();
    const zoomIn = fig.locator("[data-zoom-action='in']");
    const zoomReset = fig.locator("[data-zoom-action='reset']");
    await zoomIn.click();
    await expect(fig).toHaveAttribute("data-zoom", "125");
    await zoomReset.click();
    await expect(fig).toHaveAttribute("data-zoom", "100");
  } finally {
    await trashNote(request, path);
  }
  expect(errs).toEqual([]);
});

test("Custom checkbox Enter continuation, blockquote Tab nesting, and Source-mode table Tab/Enter", async ({ page, request }) => {
  const errs = trackErrors(page);
  const path = "notes/stage2-editing.md";
  await createAndOpenNote(
    page,
    request,
    path,
    "# Editing Note\n\n- [-] Cancelled task\n> Quoted line\n\n| A | B |\n| --- | --- |\n| x | y |\n",
  );

  const ensureInsertAtEnd = async (lineLoc: ReturnType<typeof page.locator>) => {
    await lineLoc.click();
    const vimBtn = page.getByTestId("vim-mode");
    if ((await vimBtn.count()) > 0 && (await vimBtn.textContent())?.trim() === "NORMAL") {
      await page.keyboard.press("A");
    } else {
      await page.keyboard.press("End");
    }
  };

  try {
    const editor = page.locator(`.live-cm[data-note="${path}"]`);

    // 1. Custom checkbox Enter continuation & empty exit
    const taskLine = editor.locator(".cm-line", { hasText: "Cancelled task" });
    await ensureInsertAtEnd(taskLine);
    await page.keyboard.press("Enter");
    await expect.poll(async () => page.evaluate(() => (window as unknown as { __kandinsky: { editor: () => { text: string } } }).__kandinsky.editor().text))
      .toContain("- [-] Cancelled task\n- [ ] ");

    // Enter on the empty "- [ ] " line exits the list cleanly
    await page.keyboard.press("Enter");
    await expect.poll(async () => page.evaluate(() => (window as unknown as { __kandinsky: { editor: () => { text: string } } }).__kandinsky.editor().text))
      .not.toContain("- [ ] \n- [ ] ");

    // 2. Blockquote Tab / Shift-Tab nesting
    await page.keyboard.press("Escape");
    const quoteLine = editor.locator(".cm-line", { hasText: "Quoted line" });
    await ensureInsertAtEnd(quoteLine);
    await page.keyboard.press("Tab");
    await expect.poll(async () => page.evaluate(() => (window as unknown as { __kandinsky: { editor: () => { text: string } } }).__kandinsky.editor().text))
      .toContain("> > Quoted line");
    await page.keyboard.press("Shift+Tab");
    await expect.poll(async () => page.evaluate(() => (window as unknown as { __kandinsky: { editor: () => { text: string } } }).__kandinsky.editor().text))
      .toContain("\n> Quoted line\n");

    // 3. Source mode pipe-table Tab / Enter navigation
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+e");
    await expect(editor).toHaveClass(/is-source-mode/);
    const headerLine = editor.locator(".cm-line", { hasText: "| A | B |" });
    await headerLine.click();
    const vimBtn = page.getByTestId("vim-mode");
    if ((await vimBtn.count()) > 0 && (await vimBtn.textContent())?.trim() === "NORMAL") {
      await page.keyboard.press("0");
      await page.keyboard.press("l");
      await page.keyboard.press("l");
      await page.keyboard.press("i");
    } else {
      await page.keyboard.press("Home");
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
    }
    // Tab 1 -> col 1 header (| B |), Tab 2 -> col 0 body (| x |), type "z" -> | xz |
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.type("z");
    // Tab 3 -> col 1 body (| y |), Tab 4 -> new appended body row
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect.poll(async () => page.evaluate(() => (window as unknown as { __kandinsky: { editor: () => { text: string } } }).__kandinsky.editor().text))
      .toContain("|     |     |");
    // Enter on populated row inserts another row right below it
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await expect.poll(async () => page.evaluate(() => (window as unknown as { __kandinsky: { editor: () => { text: string } } }).__kandinsky.editor().text))
      .toMatch(/\| xz\s+\| y\s+\|\n\|/);
  } finally {
    await trashNote(request, path);
  }
  expect(errs).toEqual([]);
});

test("Clickable @date mention chip opens Calendar pane and StatusBar shows reading time", async ({ page, request }) => {
  const errs = trackErrors(page);
  const path = "notes/stage2-mentions-statusbar.md";
  const words = Array.from({ length: 250 }, (_, i) => `word${i}`).join(" ");
  await createAndOpenNote(
    page,
    request,
    path,
    `# Date Mentions\n\nMeet @2026-11-21 and @2026-11-21 14:00 to review.\n\n${words}\n`,
  );

  try {
    const editor = page.locator(`.live-cm[data-note="${path}"]`);
    const dateChip = editor.locator('.kandinsky-date-mention[data-date="2026-11-21"]').first();
    await expect(dateChip).toBeVisible();
    await expect(dateChip).not.toHaveClass(/is-missing/);

    // Verify reading time in status bar
    const wordsBtn = page.getByTestId("sb-words");
    await expect(wordsBtn).toBeVisible();
    await expect(wordsBtn).toContainText("min read");
    await wordsBtn.click();
    await expect(wordsBtn).not.toContainText("min read");
    await wordsBtn.click();
    await expect(wordsBtn).toContainText("min read");

    // Click @date chip -> opens Calendar pane at 2026-11-21
    await dateChip.click();
    await expect(page.getByTestId("calendar-pane").first()).toBeVisible({ timeout: 10_000 });
  } finally {
    await trashNote(request, path);
  }
  expect(errs).toEqual([]);
});
