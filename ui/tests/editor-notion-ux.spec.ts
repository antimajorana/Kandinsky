import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const H = { "x-kandinsky": "1" };

const editorText = (page: Page) =>
  page.evaluate(() => (window as unknown as { __kandinsky: { editor(): { text: string } | null } }).__kandinsky.editor()?.text ?? "");

async function openFreshNote(
  page: Page,
  request: APIRequestContext,
  path: string,
  initialText: string,
  configPatch?: (cfg: Record<string, unknown>) => void,
) {
  await request.put("/api/file", { headers: H, data: { path, text: initialText } });
  await page.route("**/api/config", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const res = await route.fetch();
    const body = await res.json();
    body.config.vim = false;
    configPatch?.(body.config);
    await route.fulfill({ response: res, json: body });
  });
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await page.request.post("/api/cmd/open", { headers: H, data: { args: { path } } });
  const content = page.locator(".dv-active-group .cm-content");
  await expect(content).toBeVisible();
  await content.click();
  return content;
}

async function selectRange(page: Page, target: string) {
  const found = await page.evaluate((needle) => {
    const cm = document.querySelector(".dv-active-group .cm-editor") as HTMLElement | null;
    if (!cm) return false;
    // CodeMirror attaches the EditorView reference via cmView on .cm-content
    const content = cm.querySelector(".cm-content") as { cmView?: { view?: { state: { doc: { toString(): string } }; dispatch(tr: unknown): void; focus(): void } } } | null;
    const view = content?.cmView?.view;
    if (!view) return false;
    const doc = view.state.doc.toString();
    const idx = doc.indexOf(needle);
    if (idx < 0) return false;
    view.focus();
    view.dispatch({ selection: { anchor: idx, head: idx + needle.length } });
    return true;
  }, target);
  expect(found).toBe(true);
}

async function dispatchHtmlPaste(page: Page, html: string, plainText: string) {
  await page.evaluate(({ html: h, text }) => {
    const dt = new DataTransfer();
    dt.setData("text/html", h);
    dt.setData("text/plain", text);
    const el = document.querySelector(".dv-active-group .cm-content") ?? document.querySelector(".cm-content");
    el?.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
  }, { html, text: plainText });
}

test.describe("Notion-style editor UX", () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  });

  test("floating toolbar formats selection, turns block into H2, hides in code fence, and dismisses on Escape", async ({ page, request }) => {
    await openFreshNote(
      page,
      request,
      "notes/ux-floating.md",
      "alpha beta gamma\n\n```python\ncodeWord = 1\n```\n",
    );

    await selectRange(page, "beta");
    const toolbar = page.getByTestId("floating-toolbar");
    await expect(toolbar).toBeVisible();
    await expect(toolbar).toHaveAttribute("role", "toolbar");

    const boldBtn = toolbar.getByRole("button", { name: "Bold", exact: true });
    await boldBtn.click();
    await expect.poll(() => editorText(page)).toContain("alpha **beta** gamma");
    await expect(boldBtn).toHaveAttribute("aria-pressed", "true");

    const highlightBtn = toolbar.getByRole("button", { name: "Highlight", exact: true });
    await highlightBtn.click();
    await expect.poll(() => editorText(page)).toContain("alpha **==beta==** gamma");
    await expect(highlightBtn).toHaveAttribute("aria-pressed", "true");

    await toolbar.getByTestId("ft-turn-into").click();
    const menu = toolbar.getByTestId("ft-turn-into-menu");
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitemradio", { name: /Heading 2/ }).click();
    await expect.poll(() => editorText(page)).toContain("## alpha **==beta==** gamma");

    // Dismiss on Escape
    await page.keyboard.press("Escape");
    await expect(toolbar).toBeHidden();

    // Suppress inside fenced code block
    await selectRange(page, "codeWord");
    await expect(toolbar).toBeHidden();
  });

  test("floating toolbar stays hidden when editor.floating_toolbar is false", async ({ page, request }) => {
    await openFreshNote(
      page,
      request,
      "notes/ux-floating-off.md",
      "selectable prose here\n",
      (cfg) => {
        (cfg.editor as Record<string, unknown>).floating_toolbar = false;
      },
    );

    await selectRange(page, "prose");
    await expect(page.getByTestId("floating-toolbar")).toHaveCount(0);
  });

  test("slash menu provides basic blocks, Setext-safe divider, quote deduplication, and developer_mode gating", async ({ page, request }) => {
    await openFreshNote(
      page,
      request,
      "notes/ux-slash-dev-off.md",
      "",
      (cfg) => {
        cfg.developer_mode = false;
      },
    );

    const menu = page.getByTestId("slash-menu");

    // Verify core blocks appear and developerOnly items are hidden
    await page.keyboard.type("/");
    await expect(menu).toBeVisible();
    await expect(menu).toContainText("Bulleted list");
    await expect(menu).toContainText("Numbered list");
    await expect(menu).toContainText("Quote");
    await expect(menu).toContainText("Divider");

    await page.keyboard.type("derivation");
    await expect(menu).not.toContainText("Aligned Equations");
    for (let i = 0; i < "derivation".length; i++) await page.keyboard.press("Backspace");
    await page.keyboard.type("pomodoro");
    await expect(menu).not.toContainText("Pomodoro");

    // Clear line and test Divider on line 1 (no leading newline)
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("/divider");
    await expect(menu).toContainText("Divider");
    await page.keyboard.press("Enter");
    await expect.poll(() => editorText(page)).toBe("---\n\n");

    // Divider right below a non-empty paragraph must prepend \n so paragraph is not a Setext H2
    await page.keyboard.type("Paragraph above\n/divider");
    await expect(menu).toContainText("Divider");
    await page.keyboard.press("Enter");
    await expect.poll(() => editorText(page)).toContain("Paragraph above\n\n---\n\n");

    // Quote typed on an existing `> ` line must not produce `> > `
    await page.keyboard.type("> /quote");
    await expect(menu).toContainText("Quote");
    await page.keyboard.press("Enter");
    await expect.poll(() => editorText(page)).not.toContain("> > ");
    await expect.poll(() => editorText(page)).toContain("> ");
  });

  test("rich HTML paste converts Google Docs & tables, undoes with Ctrl+z, and preserves plain URL paste-link", async ({ page, request }) => {
    await openFreshNote(
      page,
      request,
      "notes/ux-paste.md",
      "Select word here.\n\n",
    );

    // 1. Plain URL paste over selected text preserves [word](url)
    await selectRange(page, "word");
    await page.evaluate(() => navigator.clipboard.writeText("https://example.com"));
    await page.keyboard.press("Control+v");
    await expect.poll(() => editorText(page)).toContain("Select [word](https://example.com) here.");

    // Move to end for rich HTML paste
    await page.keyboard.press("Control+End");
    const sampleHtml = [
      '<b style="font-weight:normal;" id="docs-internal-guid-1"><span style="font-weight:700">Bold</span> costs $100</b>',
      "<table><thead><tr><th>Name</th><th>Expr</th></tr></thead><tbody><tr><td>Row</td><td>a | b</td></tr></tbody></table>",
    ].join("");
    await dispatchHtmlPaste(page, sampleHtml, "Bold costs $100\nName\tExpr\nRow\ta | b");

    await expect.poll(() => editorText(page)).toContain("**Bold** costs \\$100");
    await expect.poll(() => editorText(page)).toContain("| Name | Expr |\n| --- | --- |\n| Row | a \\| b |");

    // Single Ctrl+Z undoes the entire rich paste cleanly
    await page.keyboard.press("Control+z");
    await expect.poll(() => editorText(page)).not.toContain("**Bold** costs \\$100");
  });
});
