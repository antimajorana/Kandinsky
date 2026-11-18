import { test, expect } from "@playwright/test";

// A plugin may run a program with a very long command line (a whole script after `-e`). The approval dialog must keep
// its buttons inside the window and scroll the details instead, or the prompt cannot be answered.
test("the approval dialog keeps its buttons in the window under a very long command line", async ({ page }) => {
  const pending = [{
    id: "bin-1", plugin: "long-args", command: "/usr/bin/node", sha256: "0".repeat(64), reason: "External helper execution",
    args: ["-e", "const a = 1; ".repeat(1500)],
  }];
  let decided: unknown = null;
  await page.route("**/api/security/binaries", (r) => r.fulfill({ json: { pending: decided ? [] : pending, trusted: [] } }));
  await page.route("**/api/security/binaries/decide", async (r) => { decided = r.request().postDataJSON(); await r.fulfill({ status: 204 }); });

  await page.goto("/");
  const modal = page.getByTestId("binary-trust-modal");
  await expect(modal).toBeVisible();
  const view = page.viewportSize()!;
  for (const id of ["binary-deny", "binary-allow-once", "binary-always-allow"]) {
    const box = (await page.getByTestId(id).boundingBox())!;
    expect(box.y, `${id} starts inside the window`).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, `${id} ends inside the window`).toBeLessThanOrEqual(view.height);
  }
  // the long text is still all there, scrolled inside the details
  const details = modal.locator(".trust-details");
  expect(await details.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

  await page.getByTestId("binary-always-allow").click();
  await expect(modal).toBeHidden();
  expect(decided).toEqual({ id: "bin-1", choice: "always_allow" });
});
