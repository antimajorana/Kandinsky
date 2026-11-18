import { test, expect, type Page, type Route } from "@playwright/test";

// A save that brings a template and a base automation at once (panes/Editor.svelte applyTemplate): the automation's
// property is already on disk, so text typed while the save was in flight must not make the editor drop it.
const H = { "x-kandinsky": "1" };
const NOTE = "notes/fix-ta-film.md";
const TEMPLATE = "---\ntemplate_title: FixTA\napply_when:\n  - property: { kind: fixtamovie }\nkind: fixtamovie\ndirector:\n---\n";
const BASE = `filters: 'kind == "fixtamovie"'
automations:
  - name: Mark seen
    enabled: true
    trigger:
      kind: property_changed
      property: kind
      to: fixtamovie
    action:
      kind: set_property
      property: seen
      value: watched
views:
  - type: table
`;

const read = async (page: Page, path: string) => ((await (await page.request.get(`/api/file?path=${encodeURIComponent(path)}`, { headers: H })).json()) as { text: string }).text;

test("typing during a save that ran a template and an automation keeps the automation's property", async ({ page, request }) => {
  const made = [NOTE, "notes/fix-ta.base", "templates/fix-ta.md"];
  // an auto-applying template and an enabled automation: taken away even when the test fails, as other specs share the vault
  try {
    await request.put("/api/file", { headers: H, data: { path: "templates/fix-ta.md", text: TEMPLATE } });
    await request.put("/api/file", { headers: H, data: { path: "notes/fix-ta.base", text: BASE } });
    await request.put("/api/file", { headers: H, data: { path: NOTE, text: "---\nkind: idea\n---\nBody.\n" } });
    await page.route("**/api/config", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const res = await route.fetch(), body = await res.json();
      body.config.editor.properties = "panel";
      await route.fulfill({ response: res, json: body });
    });
    // the editor's first save of the note is answered only once the test has typed more
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let held!: () => void;
    const heldNow = new Promise<void>((r) => (held = r));
    let first = true;
    await page.route("**/api/file*", async (route: Route) => {
      const req = route.request();
      if (req.method() !== "PUT" || !first || !String(req.postData() ?? "").includes("fix-ta-film.md")) return route.continue();
      first = false;
      const res = await route.fetch();
      held();
      await released;
      await route.fulfill({ response: res });
    });
    await page.goto("/");
    await page.getByText("Finish the GW notes.").waitFor();
    await page.keyboard.press("Control+p");
    await page.keyboard.type("fix-ta-film");
    await expect(page.getByTestId("palette").getByText("fix-ta-film", { exact: true }).first()).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator(".cm-content")).toBeVisible();

    const field = page.getByTestId("properties-panel").getByLabel("kind: text");
    await field.fill("fixtamovie");
    await field.press("Enter");
    await heldNow;
    // on disk: the sent text plus the automation's property, without the template's
    await expect.poll(() => read(page, NOTE)).toContain("seen: watched");
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+End");
    if (await page.locator(".cm-fat-cursor").count()) await page.keyboard.press("A"); // vim is on in the tests' vault: append at the end, in insert mode
    await page.keyboard.type("More.");
    release();

    await expect.poll(() => read(page, NOTE), { timeout: 10000 }).toContain("More.");
    await expect.poll(() => read(page, NOTE), { timeout: 10000 }).toContain("director:");
    const text = await read(page, NOTE);
    expect(text).toContain("seen: watched");
    expect(text).toContain("kind: fixtamovie");
  } finally {
    await Promise.all(made.map((p) => request.post(`/api/fs/trash?path=${encodeURIComponent(p)}`, { headers: H }).catch(() => {})));
  }
});
