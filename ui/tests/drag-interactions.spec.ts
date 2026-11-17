import { test, expect } from "@playwright/test";
import { openFile } from "./open";

const H = { "x-kandinsky": "1" };

function localYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

test("Calendar Month drag-reschedules events and Week bottom-edge drag resizes duration", async ({ page, request }) => {
  const now = new Date();
  const monday = new Date(now);
  const diffToMon = (now.getDay() + 6) % 7;
  monday.setDate(now.getDate() - diffToMon);
  const wed = new Date(monday);
  wed.setDate(monday.getDate() + 2);
  const thu = new Date(monday);
  thu.setDate(monday.getDate() + 3);
  const day1 = localYmd(wed);
  const day2 = localYmd(thu);

  const created = await request.post("/api/calendar/event", {
    headers: H,
    data: {
      storage: "page",
      title: "Drag Seminar",
      date: day1,
      start: "10:00",
      end: "11:00",
      all_day: false,
      color: "blue",
      location: "",
      repeat: "none",
      links: [],
    },
  });
  expect(created.ok()).toBeTruthy();

  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await page.getByTestId("nav-calendar").click();
  const pane = page.getByTestId("calendar-pane");
  await expect(pane).toBeVisible();

  const srcPill = pane.locator(`.cell[data-date="${day1}"] .pill`, { hasText: "Drag Seminar" });
  const dstCell = pane.locator(`.cell[data-date="${day2}"]`);
  await expect(srcPill).toBeVisible();
  await srcPill.dragTo(dstCell);

  await expect.poll(async () => {
    const r = await (await request.get(`/api/calendar?from=${day1}&to=${day2}`, { headers: H })).json();
    const ev = (r.events as { title: string; date: string }[]).find((e) => e.title === "Drag Seminar");
    return ev?.date ?? "";
  }, { timeout: 5000 }).toBe(day2);

  await pane.getByTestId("cal-mode-week").click();
  const card = pane.locator(".timed-card", { hasText: "Drag Seminar" });
  await expect(card).toBeVisible();
  const grip = card.locator(".resize-edge");
  await grip.scrollIntoViewIfNeeded();
  const box = (await grip.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + 44, { steps: 5 });
  await page.mouse.up();

  await expect.poll(async () => {
    const r = await (await request.get(`/api/calendar?from=${day1}&to=${day2}`, { headers: H })).json();
    const ev = (r.events as { title: string; end?: string }[]).find((e) => e.title === "Drag Seminar");
    return ev?.end ?? "";
  }, { timeout: 5000 }).toBe("12:00");
});

test("Editor ⋮⋮ pointer drag reorders math blocks cleanly preserving frontmatter and wikilinks", async ({ page, request }) => {
  const notePath = "notes/drag-math.md";
  const initial = [
    "---",
    "status: In progress",
    "tags:",
    "  - physics",
    "---",
    "# Drag Math",
    "",
    "$$",
    "\\mathcal{H} = -t \\sum_{\\langle i,j \\rangle} c_i^\\dagger c_j \\quad \\text{ref: } [[hubbard]]",
    "$$",
    "",
    "Concluding paragraph after equation.",
  ].join("\n") + "\n";

  await request.put("/api/file", { headers: H, data: { path: notePath, text: initial } });
  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await openFile(page, "drag-math.md");
  await expect(page.locator(".cm-content")).toContainText("Concluding paragraph after equation.");

  // Hover near the math block until the ⋮⋮ gutter handle appears
  const cm = page.locator(".live-cm");
  const mathBox = (await cm.locator(".cm-rendered-math, .katex-display, .cm-line", { hasText: "mathcal" }).first().boundingBox())!;
  await page.mouse.move(mathBox.x + 20, mathBox.y + mathBox.height / 2);

  const handle = cm.locator(".cm-block-gutter.is-visible .cm-block-handle");
  await expect(handle).toBeVisible();
  const hBox = (await handle.boundingBox())!;
  const tailLine = (await cm.locator(".cm-line", { hasText: "Concluding paragraph after equation." }).boundingBox())!;

  const hx = hBox.x + hBox.width / 2;
  const hy = hBox.y + hBox.height / 2;
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx, tailLine.y + tailLine.height + 10, { steps: 6 });
  await expect(cm.locator(".cm-block-drop-indicator")).toBeVisible();
  await page.mouse.up();

  await page.keyboard.press("Control+s");

  await expect.poll(async () => {
    const r = await (await request.get(`/api/file?path=${encodeURIComponent(notePath)}`, { headers: H })).json();
    return String(r.text ?? "");
  }, { timeout: 5000 }).toMatch(/Concluding paragraph after equation\.[\s\S]*\$\$/);

  const finalText = String((await (await request.get(`/api/file?path=${encodeURIComponent(notePath)}`, { headers: H })).json()).text ?? "");
  expect(finalText.startsWith("---\nstatus: In progress\ntags:\n  - physics\n---\n# Drag Math")).toBe(true);
  expect(finalText).toContain("\\mathcal{H} = -t \\sum_{\\langle i,j \\rangle} c_i^\\dagger c_j \\quad \\text{ref: } [[hubbard]]");
});

test(".base sub-items tree folds/rolls up and Timeline dependency cascade drags & undoes cleanly", async ({ page, request }) => {
  await request.put("/api/file", {
    headers: H,
    data: {
      path: "db/subtl/ParentEpic.md",
      text: "---\nstatus: In progress\nstart: 2026-11-10\nend: 2026-11-14\n---\n# ParentEpic\n",
    },
  });
  await request.put("/api/file", {
    headers: H,
    data: {
      path: "db/subtl/ChildDone.md",
      text: "---\nstatus: Done\nparent: \"[[ParentEpic]]\"\nblocked_by: \"[[ParentEpic]]\"\nstart: 2026-11-15\nend: 2026-11-18\n---\n# ChildDone\n",
    },
  });
  await request.put("/api/file", {
    headers: H,
    data: {
      path: "db/subtl/ChildOpen.md",
      text: "---\nstatus: Todo\nparent: \"[[ParentEpic]]\"\nstart: 2026-11-20\nend: 2026-11-22\n---\n# ChildOpen\n",
    },
  });
  await request.put("/api/file", {
    headers: H,
    data: {
      path: "db/SubTimeline.base",
      text: [
        "filters:",
        "  and:",
        '    - file.folder == "db/subtl"',
        "views:",
        "  - type: table",
        "    name: Tree",
        "    sub_items_by: parent",
        "    order: [file.name, status, parent, start, end]",
        "  - type: timeline",
        "    name: Roadmap",
        "    blocked_by: blocked_by",
        "    order: [file.name, start, end, blocked_by]",
      ].join("\n") + "\n",
    },
  });

  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await page.request.post("/api/cmd/open", { headers: H, data: { args: { path: "db/SubTimeline.base" } } });

  const base = page.locator(".kandinsky-pane-base");
  await expect(base.getByRole("cell", { name: /ParentEpic/ })).toBeVisible();
  await expect(base.locator(".tree-rollup")).toHaveText("1/2");
  await expect(base.getByRole("cell", { name: /ChildDone/ })).toBeVisible();
  await expect(base.getByRole("cell", { name: /ChildOpen/ })).toBeVisible();

  await base.locator('button[aria-label="Toggle sub-items"]').first().click();
  await expect(base.getByRole("cell", { name: /ChildDone/ })).toHaveCount(0);
  await expect(base.getByRole("cell", { name: /ChildOpen/ })).toHaveCount(0);
  await base.locator('button[aria-label="Toggle sub-items"]').first().click();
  await expect(base.getByRole("cell", { name: /ChildDone/ })).toBeVisible();

  // Switch to Roadmap timeline view
  await base.getByRole("button", { name: /Tree/ }).click();
  await page.getByRole("menuitem", { name: /Roadmap/ }).click();
  await base.getByRole("group", { name: "Timeline zoom" }).getByRole("button", { name: "Month" }).click();

  await expect(base.locator("svg.dep-svg path.dep-path")).toHaveCount(1);

  const canvasBox = (await base.locator(".tl-lane .canvas").first().boundingBox())!;
  const parentBar = base.locator("button.tl-item", { hasText: "ParentEpic" });
  const barBox = (await parentBar.boundingBox())!;
  const bx = barBox.x + barBox.width / 2;
  const by = barBox.y + barBox.height / 2;
  const shiftPx = Math.round((canvasBox.width * 5) / 30);

  await page.mouse.move(bx, by);
  await page.mouse.down();
  await page.mouse.move(bx + shiftPx, by, { steps: 6 });
  await page.mouse.up();

  await expect.poll(async () => {
    const r = await (await request.get("/api/file?path=db/subtl/ChildDone.md", { headers: H })).json();
    return String(r.text ?? "");
  }, { timeout: 5000 }).toContain("start: 2026-11-19");

  await base.getByRole("button", { name: "Undo cascade" }).click();
  await expect.poll(async () => {
    const r = await (await request.get("/api/file?path=db/subtl/ChildDone.md", { headers: H })).json();
    return String(r.text ?? "");
  }, { timeout: 5000 }).toContain("start: 2026-11-15");
});
