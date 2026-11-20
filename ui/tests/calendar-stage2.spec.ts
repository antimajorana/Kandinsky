import { test, expect } from "@playwright/test";

const H = { "x-kandinsky": "1" };

function todayIsoLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

test("click-a-day stays lazy until typing, anchored + Add event writes plain markdown, task ticks work across views, and ICS export works", async ({ page, request }) => {
  const today = todayIsoLocal();

  // Seed a due task for today in a dedicated note so Calendar renders a checkbox across Month/Week/Agenda/Day.
  const taskNotePath = "notes/cal-stage2-task.md";
  await request.put("/api/file", {
    headers: H,
    data: {
      path: taskNotePath,
      text: `# Stage 2 Tasks\n\n- [ ] Stage2 Calendar Task 📅 ${today}\n`,
    },
  });

  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await page.getByTestId("nav-calendar").click();

  const pane = page.getByTestId("calendar-pane");
  await expect(pane).toBeVisible();

  // Verify task checkbox appears in Month view and ticking it updates the note on disk to [x].
  const monthTick = pane.getByRole("checkbox", { name: "Done: Stage2 Calendar Task" }).first();
  await expect(monthTick).toBeVisible();
  await monthTick.click();

  await expect.poll(async () => {
    const fileRes = await request.get(`/api/file?path=${encodeURIComponent(taskNotePath)}`, { headers: H });
    const doc = await fileRes.json();
    return String(doc.text ?? "");
  }, { timeout: 5000 }).toContain("- [x] Stage2 Calendar Task");

  // Seed another task for today and verify checkbox exists in Week & Agenda views as well.
  const weekTaskNote = "notes/cal-stage2-week-task.md";
  await request.put("/api/file", {
    headers: H,
    data: {
      path: weekTaskNote,
      text: `# Week Task\n\n- [ ] Stage2 Week Checkbox 📅 ${today}\n`,
    },
  });

  await pane.getByTestId("cal-mode-week").click();
  await expect(pane.getByRole("checkbox", { name: "Done: Stage2 Week Checkbox" }).first()).toBeVisible();

  await pane.getByTestId("cal-mode-agenda").click();
  await expect(pane.getByRole("checkbox", { name: "Done: Stage2 Week Checkbox" }).first()).toBeVisible();

  // Go back to Month view and pick an empty future day cell -> DayWorkspace opens lazily without creating a file.
  await pane.getByTestId("cal-mode-month").click();
  const lastCell = pane.locator(".cell[data-date]").last();
  const emptyDay = (await lastCell.getAttribute("data-date"))!;
  expect(emptyDay).toBeTruthy();

  await lastCell.click();
  const ws = page.getByTestId("day-workspace");
  await expect(ws).toBeVisible();

  const logPath = `log/${emptyDay}.md`;
  const existsBefore = await (await request.get(`/api/exists?path=${encodeURIComponent(logPath)}`, { headers: H })).json();
  expect(existsBefore).toBe(false);

  // Anchored "+ Add event" popover opens near the button without covering the whole screen in a heavy scrim.
  const addBtn = ws.getByTestId("day-new-event");
  await expect(addBtn).toContainText("Add event");
  await addBtn.click();

  const dlg = page.getByRole("dialog", { name: "New event" });
  await expect(dlg).toBeVisible();
  await expect(dlg).toHaveClass(/anchored/);

  await dlg.getByTestId("cal-event-title").fill("Stage2 Anchored Meeting");
  await dlg.getByTestId("cal-event-save").click();
  await expect(ws.getByText("Stage2 Anchored Meeting")).toBeVisible();

  // Verify the event was persisted as plain Markdown frontmatter on disk.
  const savedLog = await (await request.get(`/api/file?path=${encodeURIComponent(logPath)}`, { headers: H })).json();
  expect(String(savedLog.text)).toContain("Stage2 Anchored Meeting");

  // Verify ICS export endpoint respects ?bases= and emits valid VCALENDAR with the created event.
  const icsRes = await request.get("/api/calendar/ics/export?bases=", { headers: H });
  expect(icsRes.status()).toBe(200);
  const icsText = await icsRes.text();
  expect(icsText).toContain("BEGIN:VCALENDAR");
  expect(icsText).toContain("SUMMARY:Stage2 Anchored Meeting");

  // Verify PDF export endpoint works for a Markdown note.
  const pdfRes = await request.post("/api/note/export-pdf", {
    headers: H,
    data: { path: taskNotePath },
  });
  expect(pdfRes.status()).toBe(200);
  expect(pdfRes.headers()["content-type"]).toBe("application/pdf");
  const pdfBuf = await pdfRes.body();
  expect(pdfBuf.subarray(0, 5).toString("ascii")).toBe("%PDF-");

  // Verify backlinks endpoint returns related notes array.
  const blRes = await request.get(`/api/backlinks?path=${encodeURIComponent("notes/hubbard.md")}`, { headers: H });
  expect(blRes.status()).toBe(200);
  const blJson = await blRes.json();
  expect(Array.isArray(blJson.related)).toBe(true);
});
