import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { openFile } from "./open";

// The native Calendar's edits keep what is on disk: a repeating event edited or dragged from a later occurrence keeps
// (or, when the user agrees, moves) the whole series; a multi-day event dragged by a later day moves by the days dragged.
const H = { "x-kandinsky": "1" };

type Ev = { id: string; occurrence_id: string; title: string; date: string; end_date: string };
const eventsIn = (request: APIRequestContext, from: string, to: string) =>
  request.get(`/api/calendar?from=${from}&to=${to}`, { headers: H }).then((r) => r.json()).then((j) => j.events as Ev[]);
const upsert = (request: APIRequestContext, data: Record<string, unknown>) =>
  request.post("/api/calendar/event", { headers: H, data: { all_day: true, color: "blue", location: "", links: [], ...data } }).then((r) => r.json() as Promise<Ev>);

/** A note holding the Calendar pane as a block, on `date`'s month. */
async function openCalendarOn(page: Page, request: APIRequestContext, note: string, date: string) {
  await request.put("/api/file", { headers: H, data: { path: `notes/${note}`, text: `# ${note}\n\n\`\`\`view\ntype: calendar-pane\nview: month\ndate: ${date}\n\`\`\`\n` } });
  await page.goto("/");
  await openFile(page, note);
  const cal = page.locator(".cm-content .kandinsky-pane-calendar");
  await expect(cal.locator(`.cell[data-date="${date}"]`)).toBeVisible();
  return cal;
}

test("retitling a later occurrence of a weekly event keeps the series where it was", async ({ page, request }) => {
  await upsert(request, { title: "Series colloquium", date: "2031-03-05", repeat: "weekly", storage: "inline" });
  const cal = await openCalendarOn(page, request, "fix-cal-series.md", "2031-03-12");
  await cal.locator('.cell[data-date="2031-03-19"] .pill', { hasText: "Series colloquium" }).click();
  const dlg = page.getByRole("dialog", { name: "Edit event" });
  await expect(dlg.getByTestId("cal-series-hint")).toBeVisible();
  await dlg.getByTestId("cal-event-title").fill("Series colloquium (room 3)");
  await dlg.getByTestId("cal-event-save").click();
  await expect(dlg).toBeHidden();
  await expect.poll(async () => (await eventsIn(request, "2031-03-01", "2031-03-31")).filter((e) => e.title === "Series colloquium (room 3)").map((e) => e.date))
    .toEqual(["2031-03-05", "2031-03-12", "2031-03-19", "2031-03-26"]);
});

test("dragging a later occurrence asks first, and moves the whole series only when agreed", async ({ page, request }) => {
  await upsert(request, { title: "Series seminar", date: "2031-06-04", repeat: "weekly", storage: "inline" });
  const cal = await openCalendarOn(page, request, "fix-cal-drag.md", "2031-06-11");
  const dates = async () => (await eventsIn(request, "2031-06-01", "2031-06-30")).filter((e) => e.title === "Series seminar").map((e) => e.date);
  const pill = () => cal.locator('.cell[data-date="2031-06-18"] .pill', { hasText: "Series seminar" });

  await pill().dragTo(cal.locator('.cell[data-date="2031-06-19"]'));
  const ask = page.getByRole("dialog", { name: "Move the whole series?" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(500);
  expect(await dates()).toEqual(["2031-06-04", "2031-06-11", "2031-06-18", "2031-06-25"]);

  await pill().dragTo(cal.locator('.cell[data-date="2031-06-19"]'));
  await page.getByRole("dialog", { name: "Move the whole series?" }).getByRole("button", { name: "Move all occurrences" }).click();
  await expect.poll(dates).toEqual(["2031-06-05", "2031-06-12", "2031-06-19", "2031-06-26"]);
});

test("a multi-day event dragged by its middle day moves by the days dragged", async ({ page, request }) => {
  await upsert(request, { title: "Workshop span", date: "2031-04-08", end_date: "2031-04-10", repeat: "none", storage: "inline" });
  const cal = await openCalendarOn(page, request, "fix-cal-span.md", "2031-04-09");
  await cal.locator('.cell[data-date="2031-04-09"] .pill', { hasText: "Workshop span" }).dragTo(cal.locator('.cell[data-date="2031-04-12"]'));
  await expect.poll(async () => (await eventsIn(request, "2031-04-01", "2031-04-30")).filter((e) => e.title === "Workshop span").map((e) => [e.date, e.end_date]))
    .toEqual([["2031-04-11", "2031-04-13"]]);
});

test("the Day workspace never overwrites a Daily Note changed on disk under unsaved edits", async ({ page, request }) => {
  const day = "2031-05-07";
  const path = `log/${day}.md`;
  const text = () => request.get(`/api/file?path=${encodeURIComponent(path)}`, { headers: H }).then((r) => r.json()).then((j) => j.text as string);
  await request.put("/api/file", { headers: H, data: { path: "notes/fix-cal-day.md", text: `# day\n\n\`\`\`view\ntype: calendar-pane\nview: day\ndate: ${day}\n\`\`\`\n` } });
  await page.goto("/");
  await openFile(page, "fix-cal-day.md");
  const ws = page.locator(".cm-content").getByTestId("day-workspace");
  await expect(ws).toBeVisible();
  await ws.locator(".cm-content").click();
  if (await page.locator(".cm-fat-cursor").count()) await page.keyboard.press("i"); // the tests' vault has vim on: insert mode first
  await page.keyboard.type("mine before");
  // written elsewhere (a capture, another tab) before the autosave: created under the workspace's draft
  await request.put("/api/file", { headers: H, data: { path, text: "# captured elsewhere\n" } });
  await expect(ws.getByTestId("day-note-conflict")).toBeVisible();
  await page.keyboard.type(" and after");
  await page.waitForTimeout(1200); // past the autosave delay: nothing may be written now
  expect(await text()).toBe("# captured elsewhere\n");
  await ws.getByRole("button", { name: "Load disk version" }).click();
  await expect(ws.getByTestId("day-note-conflict")).toBeHidden();
  await expect(ws.locator(".cm-content")).toContainText("captured elsewhere");
});

test("an automation's edit that meets text typed during the save raises the Day workspace's conflict bar", async ({ page, request }) => {
  const day = "2031-05-09";
  const path = `log/${day}.md`;
  await request.post(`/api/fs/trash?path=${encodeURIComponent(path)}`, { headers: H }).catch(() => {});
  const text = () => request.get(`/api/file?path=${encodeURIComponent(path)}`, { headers: H }).then((r) => r.json()).then((j) => String(j.text ?? ""));
  // the first save is answered as one an automation rewrote (its word "alpha" changed), once more has been typed into that word
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  let held!: () => void;
  const heldNow = new Promise<void>((r) => (held = r));
  let first = true;
  await page.route("**/api/file*", async (route) => {
    const req = route.request();
    const body = req.method() === "PUT" ? (req.postDataJSON() as { path?: string; text?: string } | null) : null;
    if (!first || body?.path !== path || !body.text?.includes("alpha beta")) return route.continue();
    first = false;
    const res = await route.fetch();
    const json = await res.json();
    held();
    await released;
    json.template = { template: "Fix rule (fix-dw.base)", added: ["word"], text: body.text.replace("alpha", "ALPHA"), automation: true };
    await route.fulfill({ response: res, json });
  });
  await request.put("/api/file", { headers: H, data: { path: "notes/fix-cal-day-auto.md", text: `# day\n\n\`\`\`view\ntype: calendar-pane\nview: day\ndate: ${day}\n\`\`\`\n` } });
  await page.goto("/");
  await openFile(page, "fix-cal-day-auto.md");
  const ws = page.locator(".cm-content").getByTestId("day-workspace");
  await expect(ws).toBeVisible();
  await ws.locator(".cm-content").click();
  if (await page.locator(".cm-fat-cursor").count()) await page.keyboard.press("i"); // the tests' vault has vim on: insert mode first
  await page.keyboard.type("alpha beta");
  await heldNow;
  const saved = await text();
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("zz"); // inside "alpha": "alzzpha beta"
  release();
  await expect(ws.getByTestId("day-note-conflict")).toBeVisible();
  await page.waitForTimeout(1200); // past the autosave delay: the typed text may not go over the automation's write
  expect(await text()).toBe(saved);
  expect(saved).toContain("alpha beta");
});
