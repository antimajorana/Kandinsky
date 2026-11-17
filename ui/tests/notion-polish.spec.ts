import { test, expect } from "@playwright/test";
import { openFile } from "./open";

const H = { "x-kandinsky": "1" };

test("live / widgets hide raw YAML with hover Configure, synced blocks edit live, and margin comments resolve", async ({ page, request }) => {
  await request.put("/api/file", {
    headers: H,
    data: {
      path: "notes/polish-src.md",
      text: "# Source Note\n\nShared specification paragraph. ^blk-shared\n\nTail stays.\n",
    },
  });
  await request.put("/api/file", {
    headers: H,
    data: {
      path: "notes/polish-host.md",
      text: [
        "---",
        "status: In progress",
        "priority: 2",
        "---",
        "# Host Note",
        "",
        "Intro paragraph for margin review.",
        "",
        "```view",
        "type: progress",
        "kind: goal",
        "label: Milestone",
        "current: 4",
        "target: 10",
        "```",
        "",
        "```view",
        "type: synced",
        'path: "notes/polish-src.md"',
        'block: "blk-shared"',
        "```",
        "",
        "End line.",
      ].join("\n"),
    },
  });

  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await openFile(page, "polish-host.md");

  // 1. Inline properties visible under hero, raw YAML hidden in Live Preview
  await expect(page.getByTestId("inline-properties")).toBeVisible();
  await expect(page.locator(".cm-content")).not.toContainText("priority: 2");

  // 2. Progress card renders live visually (Configure popover updates YAML cleanly)
  const cfgBtn = page.getByTestId("widget-configure-btn").first();
  await cfgBtn.click({ force: true });
  const cfgPop = page.getByTestId("widget-configure-popover");
  await expect(cfgPop).toBeVisible();
  await cfgPop.getByLabel("Label").fill("Updated Goal");
  await cfgPop.getByRole("button", { name: "Apply" }).click();
  await expect(page.locator(".cm-rendered-block").first()).toContainText("Updated Goal");

  // 3. Synced block live edit propagates to polish-src.md preserving surroundings
  const syncedCard = page.getByTestId("synced-block");
  await expect(syncedCard).toContainText("Shared specification paragraph.");
  await syncedCard.getByRole("button", { name: "Edit synced block" }).click();
  const syncedTa = syncedCard.locator("textarea");
  await expect(syncedTa).toHaveValue(/Shared specification paragraph/);
  await syncedTa.fill("Updated shared spec text.");
  await syncedTa.blur();
  await expect.poll(async () => {
    const r = await (await request.get("/api/file?path=notes/polish-src.md", { headers: H })).json();
    return String(r.text ?? "");
  }).toContain("Updated shared spec text.");

  // 4. Anchored margin comments create + resolve thread
  await page.locator(".cm-line", { hasText: "Intro paragraph" }).click();
  await page.getByRole("button", { name: "Page actions" }).click();
  await page.getByRole("menuitem", { name: "Add comment on selection" }).click();
  const drawer = page.getByTestId("margin-comments");
  await expect(drawer).toBeVisible();
  await drawer.locator("textarea").fill("Verify typo here");
  await drawer.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(drawer.getByTestId("comment-thread").first()).toContainText("Verify typo here");
  await drawer.getByTestId("comment-thread").first().getByRole("button", { name: "Resolve" }).click();
  await expect(drawer.getByTestId("comment-thread")).toHaveCount(0);
  await request.post(`/api/fs/trash?path=${encodeURIComponent("notes/polish-host.md")}`, { headers: H }).catch(() => {});
  await request.post(`/api/fs/trash?path=${encodeURIComponent("notes/polish-src.md")}`, { headers: H }).catch(() => {});
});
