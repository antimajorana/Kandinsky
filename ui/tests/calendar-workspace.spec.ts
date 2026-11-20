import { test, expect } from "@playwright/test";

const H = { "x-kandinsky": "1" };

test("native Calendar navigates views, keeps future Daily Notes lazy, and promotes events to pages", async ({ page, request }) => {
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();

  // Open Calendar from the primary Notion sidebar nav directly under Home
  await page.getByTestId("nav-calendar").click();
  const pane = page.getByTestId("calendar-pane");
  await expect(pane).toBeVisible();

  // Switch between Week, Agenda, Day, and back to Month cleanly
  await pane.getByTestId("cal-mode-week").click();
  await pane.getByTestId("cal-mode-agenda").click();
  await pane.getByTestId("cal-mode-month").click();

  // Pick a cell in Month view that does not yet have a daily log -> opens Unified Day Workspace
  // (the day before the grid's last: the last one is calendar-stage2.spec.ts's, and the tests share one vault)
  const cells = pane.locator(".cell[data-date]");
  const cell = cells.nth((await cells.count()) - 2);
  const cellIso = (await cell.getAttribute("data-date"))!;
  expect(cellIso).toBeTruthy();
  // a retry starts as the first run did: without the log an earlier attempt typed (a first run checks browsing wrote none)
  if (test.info().retry > 0) await request.post(`/api/fs/trash?path=${encodeURIComponent(`log/${cellIso}.md`)}`, { headers: H }).catch(() => {});

  await cell.click();
  const ws = page.getByTestId("day-workspace");
  await expect(ws).toBeVisible();

  // Lazy Daily Note guarantee: browsing an empty date must NOT create an empty file on disk!
  const existsBefore = await (await request.get(`/api/exists?path=${encodeURIComponent(`log/${cellIso}.md`)}`, { headers: H })).json();
  expect(existsBefore).toBe(false);

  // Typing into the Day Workspace editor lazily creates & saves `log/<cellIso>.md`
  await ws.locator(".cm-content").click();
  await page.keyboard.type("Lazy daily note milestone");
  await expect.poll(async () => {
    return await (await request.get(`/api/exists?path=${encodeURIComponent(`log/${cellIso}.md`)}`, { headers: H })).json();
  }, { timeout: 5000 }).toBe(true);

  // Creating an event inline and promoting it to an event note page
  await ws.getByTestId("day-new-event").click();
  const dlg = page.getByRole("dialog", { name: "New event" });
  await dlg.getByTestId("cal-event-title").fill("Colloquium talk");
  await dlg.getByRole("button", { name: /Save|Create/i }).click();
  await expect(ws.getByText("Colloquium talk")).toBeVisible();

  await ws.getByText("Colloquium talk").click();
  const editDlg = page.getByRole("dialog", { name: "Edit event" });
  await editDlg.getByRole("button", { name: "Open as event page" }).click();
  await expect(page.locator(".cm-content").last()).toBeVisible();
});
