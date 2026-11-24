import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { openFile } from "./open";

// Synced blocks (components/widgets/SyncedBlockEmbed.svelte, lib/embeds.ts): a save ends once its text is written,
// a change elsewhere in the source note does not block the next save, a change to the block itself offers
// Reload / Keep mine, and `![[note#^label]]` of an equation stays the numbered note view.
const H = { "x-kandinsky": "1" };

const fileText = async (request: APIRequestContext, path: string) =>
  String((await (await request.get(`/api/file?path=${encodeURIComponent(path)}`, { headers: H })).json()).text ?? "");

async function host(request: APIRequestContext, page: Page, name: string, src: string, block: string) {
  await request.put("/api/file", {
    headers: H,
    data: { path: `notes/${name}.md`, text: ["# Host", "", "```view", "type: synced", `path: "${src}"`, `block: "${block}"`, "```", "", "End line.", ""].join("\n") },
  });
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await openFile(page, `${name}.md`);
  const card = page.getByTestId("synced-block");
  await expect(card).toContainText("Shared text.");
  return card;
}

const trash = (request: APIRequestContext, ...paths: string[]) =>
  Promise.all(paths.map((p) => request.post(`/api/fs/trash?path=${encodeURIComponent(p)}`, { headers: H }).catch(() => {})));

test("a synced block edited to end in a line break is saved once, not again and again", async ({ page, request }) => {
  const src = "notes/fix-synced-trail-src.md";
  await request.put("/api/file", { headers: H, data: { path: src, text: "# Source\n\nShared text. ^blk-trail\n\nTail.\n" } });
  const card = await host(request, page, "fix-synced-trail-host", src, "blk-trail");
  let posts = 0;
  page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/note/synced-block")) posts++; });
  await card.getByRole("button", { name: "Edit synced block" }).click();
  const ta = card.locator("textarea");
  await ta.fill("Changed text.\n");
  await ta.blur();
  await expect.poll(() => fileText(request, src)).toContain("Changed text. ^blk-trail");
  await expect(card.locator(".status")).toHaveText("In sync");
  await page.waitForTimeout(1500);
  expect(posts).toBeLessThanOrEqual(2);
  await trash(request, src, "notes/fix-synced-trail-host.md");
});

test("a change elsewhere in the source note does not make the next synced save fail", async ({ page, request }) => {
  const src = "notes/fix-synced-rebase-src.md";
  await request.put("/api/file", { headers: H, data: { path: src, text: "# Source\n\nShared text. ^blk-rebase\n\nTail.\n" } });
  const card = await host(request, page, "fix-synced-rebase-host", src, "blk-rebase");
  await request.put("/api/file", { headers: H, data: { path: src, text: "# Source\n\nShared text. ^blk-rebase\n\nTail edited elsewhere.\n" } });
  await card.getByRole("button", { name: "Edit synced block" }).click();
  const ta = card.locator("textarea");
  await ta.fill("Card edit.");
  await ta.blur();
  await expect.poll(() => fileText(request, src)).toContain("Card edit. ^blk-rebase");
  expect(await fileText(request, src)).toContain("Tail edited elsewhere.");
  await expect(card.locator(".status")).toHaveText("In sync");
  await trash(request, src, "notes/fix-synced-rebase-host.md");
});

test("synced list edits preserve frontmatter and keep the whole list item after reload", async ({ page, request }) => {
  const src = "notes/fix-synced-list-src.md";
  const name = "fix-synced-list-host";
  const frontmatter = "---\ntitle: Source metadata ^blk-list\n---\n";
  try {
    await request.put("/api/file", {
      headers: H,
      data: { path: src, text: `${frontmatter}- Shared text. ^blk-list\n  - Child\n- Neighbor\n` },
    });
    const card = await host(request, page, name, src, "blk-list");
    const editor = card.locator("textarea");
    const edit = () => card.getByRole("button", { name: "Edit synced block" }).click();
    await edit();
    await expect(editor).toHaveValue("- Shared text.\n  - Child");
    await editor.fill("- Edited\n  - Child v2");
    await editor.blur();
    await expect.poll(() => fileText(request, src)).toBe(`${frontmatter}- Edited ^blk-list\n  - Child v2\n- Neighbor\n`);
    await expect(card.locator(".status")).toHaveText("In sync");

    await page.reload();
    await page.getByText("Finish the GW notes.").waitFor();
    await openFile(page, `${name}.md`);
    await edit();
    await expect(editor).toHaveValue("- Edited\n  - Child v2");
    await editor.fill("- Final");
    await editor.blur();
    await expect.poll(() => fileText(request, src)).toBe(`${frontmatter}- Final ^blk-list\n- Neighbor\n`);
  } finally {
    await trash(request, src, `notes/${name}.md`);
  }
});

test("a synced block changed in its note while edited offers Reload and Keep mine", async ({ page, request }) => {
  const src = "notes/fix-synced-conflict-src.md";
  await request.put("/api/file", { headers: H, data: { path: src, text: "# Source\n\nShared text. ^blk-clash\n\nTail.\n" } });
  const card = await host(request, page, "fix-synced-conflict-host", src, "blk-clash");
  await card.getByRole("button", { name: "Edit synced block" }).click();
  const ta = card.locator("textarea");
  await expect(ta).toBeFocused();
  await request.put("/api/file", { headers: H, data: { path: src, text: "# Source\n\nTheirs. ^blk-clash\n\nTail.\n" } });
  await ta.fill("Mine.");
  await expect(card.getByRole("button", { name: "Keep mine" })).toBeVisible();
  await expect(card.locator(".status")).toHaveText("Conflict");
  expect(await fileText(request, src)).toContain("Theirs. ^blk-clash");
  await card.getByRole("button", { name: "Keep mine" }).click();
  await expect.poll(() => fileText(request, src)).toContain("Mine. ^blk-clash");
  await expect(card.getByRole("button", { name: "Keep mine" })).toHaveCount(0);
  await trash(request, src, "notes/fix-synced-conflict-host.md");
});

test("an equation label embed stays the numbered note view; a plain block id is a synced card", async ({ page, request }) => {
  await request.put("/api/file", {
    headers: H,
    data: { path: "notes/fix-synced-derivation.md", text: "# Derivation\n\n$$\nE = mc^2 \\label{eq-energy}\n$$\n\nPlain para. ^plain-blk\n" },
  });
  await request.put("/api/file", {
    headers: H,
    data: { path: "notes/fix-synced-embedder.md", text: "# Embedder\n\n![[fix-synced-derivation#^eq-energy]]\n\nbetween\n\n![[fix-synced-derivation#^plain-blk]]\n\nlast line\n" },
  });
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await openFile(page, "fix-synced-embedder.md");
  const embeds = page.locator(".cm-rendered-block .note-embed");
  await expect(embeds.nth(1).getByTestId("synced-block")).toContainText("Plain para.");
  await expect(embeds.first().locator(".katex").first()).toBeVisible();
  await expect(embeds.first()).toContainText("(1)");
  await expect(embeds.first().getByTestId("synced-block")).toHaveCount(0);
  await trash(request, "notes/fix-synced-derivation.md", "notes/fix-synced-embedder.md");
});

test("an equation label after `$$` in a CRLF note is still no synced card", async ({ page, request }) => {
  await request.put("/api/file", {
    headers: H,
    data: { path: "notes/fix-synced-crlf.md", text: "# Derivation\r\n\r\n$$\r\nE = mc^2\r\n$$ ^eq-crlf\r\n\r\nPlain para. ^plain-crlf\r\n" },
  });
  await request.put("/api/file", {
    headers: H,
    data: { path: "notes/fix-synced-crlf-embedder.md", text: "# Embedder\n\n![[fix-synced-crlf#^eq-crlf]]\n\nbetween\n\n![[fix-synced-crlf#^plain-crlf]]\n\nlast line\n" },
  });
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await openFile(page, "fix-synced-crlf-embedder.md");
  const embeds = page.locator(".cm-rendered-block .note-embed");
  await expect(embeds.nth(1).getByTestId("synced-block")).toContainText("Plain para.");
  await expect(embeds.first().locator(".katex").first()).toBeVisible();
  await expect(embeds.first().getByTestId("synced-block")).toHaveCount(0);
  await trash(request, "notes/fix-synced-crlf.md", "notes/fix-synced-crlf-embedder.md");
});

test("Reload in a conflict takes the block as it is now, after a second change in its note", async ({ page, request }) => {
  const src = "notes/fix-synced-reload-src.md";
  await request.put("/api/file", { headers: H, data: { path: src, text: "# Source\n\nShared text. ^blk-reload\n\nTail.\n" } });
  const card = await host(request, page, "fix-synced-reload-host", src, "blk-reload");
  await card.getByRole("button", { name: "Edit synced block" }).click();
  const ta = card.locator("textarea");
  await expect(ta).toBeFocused();
  await request.put("/api/file", { headers: H, data: { path: src, text: "# Source\n\nTheirs. ^blk-reload\n\nTail.\n" } });
  await ta.fill("Mine.");
  await expect(card.locator(".status")).toHaveText("Conflict");
  await request.put("/api/file", { headers: H, data: { path: src, text: "# Source\n\nTheirs again. ^blk-reload\n\nTail.\n" } });
  await card.getByRole("button", { name: "Reload", exact: true }).click(); // exact: the source link's name contains "reload" too
  await expect(card.getByRole("button", { name: "Keep mine" })).toHaveCount(0);
  await expect(card.locator("textarea")).toHaveValue("Theirs again.");
  await expect(card.locator(".status")).toHaveText("In sync");
  expect(await fileText(request, src)).toContain("Theirs again. ^blk-reload");
  await trash(request, src, "notes/fix-synced-reload-host.md");
});

test("Reload clicked while a change to the source is still being read is not lost", async ({ page, request }) => {
  const src = "notes/fix-synced-race-src.md";
  await request.put("/api/file", { headers: H, data: { path: src, text: "# Source\n\nShared text. ^blk-race\n\nTail.\n" } });
  const card = await host(request, page, "fix-synced-race-host", src, "blk-race");
  await card.getByRole("button", { name: "Edit synced block" }).click();
  const ta = card.locator("textarea");
  await expect(ta).toBeFocused();
  await request.put("/api/file", { headers: H, data: { path: src, text: "# Source\n\nTheirs. ^blk-race\n\nTail.\n" } });
  await ta.fill("Mine.");
  await expect(card.locator(".status")).toHaveText("Conflict");
  // every read of the source is slowed, so the refresh the next change starts is still reading when Reload reads too
  const isSrcRead = (u: string) => u.includes("/api/file?") && decodeURIComponent(u).includes("fix-synced-race-src.md");
  await page.route((u) => isSrcRead(u.toString()), async (route) => {
    if (route.request().method() === "GET") await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });
  const refresh = page.waitForRequest((r) => r.method() === "GET" && isSrcRead(r.url()));
  await request.put("/api/file", { headers: H, data: { path: src, text: "# Source\n\nTheirs again. ^blk-race\n\nTail.\n" } });
  await refresh;
  await card.getByRole("button", { name: "Reload" }).click();
  await expect(card.getByRole("button", { name: "Keep mine" })).toHaveCount(0);
  await expect(card.locator("textarea")).toHaveValue("Theirs again.");
  await expect(card.locator(".status")).toHaveText("In sync");
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await trash(request, src, "notes/fix-synced-race-host.md");
});
