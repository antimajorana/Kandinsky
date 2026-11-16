import { test, expect, type Page } from "@playwright/test";
import { shownName } from "../src/lib/paths";

const H = { "x-kandinsky": "1" };
const put = (page: Page, path: string, text: string) =>
  page.request.put("/api/file", { headers: H, data: { path, text } });

async function openViaPalette(page: Page, q: string) {
  await page.keyboard.press("Control+p");
  const palette = page.getByTestId("palette");
  await expect(palette.getByRole("textbox")).toBeFocused();
  await page.keyboard.type(q);
  await expect(palette.getByText(shownName(q), { exact: true }).first()).toBeVisible();
  await page.keyboard.press("Enter");
}

async function runCommandPalette(page: Page, label: string) {
  await page.keyboard.press("F1");
  const palette = page.getByTestId("palette");
  await expect(palette.getByRole("textbox")).toBeFocused();
  await page.keyboard.type(label);
  await palette.getByText(label, { exact: false }).first().click();
}

test("notebook-preview (.ipynb & legacy .wln) and table-preview render read-only in dark and light themes", async ({ page }) => {
  const ipynb = JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { kernelspec: { language: "python", display_name: "Python 3" } },
    cells: [
      { cell_type: "markdown", metadata: {}, source: ["## Gap Sweep\n", "Summary of the synthetic model.\n"] },
      {
        cell_type: "code",
        execution_count: 1,
        metadata: { tags: ["headline"] },
        source: ["delta = 1.25e-4\n", "print(f'gap={delta:.2e}')\n"],
        outputs: [{ output_type: "stream", name: "stdout", text: ["gap=1.25e-04\n"] }],
      },
    ],
  });
  const wln = JSON.stringify({
    cells: [
      { id: "c1", type: "input", data: "(* @tag: check *)\nIntegrate[Sin[x]^2, {x, 0, Pi}]" },
      { id: "c2", type: "output", data: "\\frac{\\pi}{2}" },
    ],
  });
  await put(page, "research_test/check.ipynb", ipynb);
  await put(page, "research_test/check.wln", wln);
  await put(page, "research_test/rates.tsv", "U\tgamma\tlabel\n2.0\t1.23e-5\tweak\n6.0\t4.50e-3\tstrong\n");
  await put(
    page,
    "research_test/Previews.page",
    [
      "title: Previews",
      "rows:",
      "  - - type: notebook-preview",
      "      path: research_test/check.ipynb",
      "      tag: headline",
      "    - type: notebook-preview",
      "      path: research_test/check.wln",
      "  - - type: table-preview",
      "      path: research_test/rates.tsv",
      "      sci: true",
      "",
    ].join("\n"),
  );

  for (const scheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await page.getByText("Finish the GW notes.").waitFor();
    await openViaPalette(page, "Previews.page");

    const nbBlocks = page.getByTestId("notebook-preview-block");
    await expect(nbBlocks).toHaveCount(2);
    await expect(nbBlocks.first()).toContainText("gap=1.25e-04");
    await expect(nbBlocks.nth(1)).toContainText("Legacy · .wln");
    await expect(nbBlocks.nth(1)).toContainText("Integrate[Sin[x]^2");

    const tbl = page.getByTestId("table-preview-block");
    await expect(tbl).toBeVisible();
    await expect(tbl).toContainText("1.23 × 10⁻⁵");
  }
});

test("properties-audit widget and upstream staleness pills surface schema issues and upstream changes", async ({ page }) => {
  await put(
    page,
    "research_test/Conventions.md",
    "---\ndate: 2026-10-01 09:00\ntype: Concept\nstatus: stale\nupdated: 2026-10-20\n---\n# Conventions\nMetric sign (+,-,-,-).\n",
  );
  await put(
    page,
    "research_test/Theorem.md",
    "---\ntype: Talk\nstatus: active\nupdated: 2026-10-10\ndepends_on:\n  - \"[[Conventions]]\"\n---\n# Theorem\nUses [[Conventions]].\n",
  );
  await put(
    page,
    "research_test/Audit.page",
    [
      "title: Audit",
      "rows:",
      "  - [{type: properties-audit}]",
      "  - [{view: review, filters: 'file.inFolder(\"research_test\") && type == \"Talk\"'}]",
      "",
    ].join("\n"),
  );

  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await openViaPalette(page, "Audit.page");

  await expect(page.getByTestId("audit-summary-text")).toContainText("issue");
  await expect(page.getByTestId("review-upstream-pill")).toHaveText("Upstream stale");

  // Opening Theorem.md shows the clickable Upstream stale pill in the note header (checked in dark + light)
  await openViaPalette(page, "Theorem.md");
  const pill = page.getByTestId("upstream-health-pill").first();
  await expect(pill).toBeVisible();
  await expect(pill).toHaveText("Upstream stale");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(pill).toBeVisible();
});

test("Zotero migration wizard and References workflow modal open cleanly in dark and light themes", async ({ page }) => {
  for (const scheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await page.getByText("Finish the GW notes.").waitFor();

    await runCommandPalette(page, "References: import from Zotero");
    const zot = page.getByTestId("zotero-import-modal");
    await expect(zot).toBeVisible();
    await expect(zot.getByTestId("zotero-preview-btn")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(zot).toHaveCount(0);

    await runCommandPalette(page, "References: add, search INSPIRE");
    const pw = page.getByTestId("paper-workflows-modal");
    await expect(pw).toBeVisible();
    await expect(pw.getByTestId("paper-remote-source")).toContainText("INSPIRE-HEP");
    await pw.getByTestId("paper-tab-inbox").click();
    await expect(pw.getByTestId("paper-tab-inbox")).toHaveAttribute("aria-selected", "true");
    await pw.getByTestId("paper-tab-duplicates").click();
    await expect(pw.getByTestId("paper-tab-duplicates")).toHaveAttribute("aria-selected", "true");
    await pw.getByTestId("paper-tab-scan").click();
    await expect(pw.getByTestId("paper-tab-scan")).toHaveAttribute("aria-selected", "true");
    await expect(pw.getByTestId("scan-folders-panel")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(pw).toHaveCount(0);
  }
});

test("Scan folders workflow tab previews Paper + Book entries and applies sync", async ({ page }) => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  await page.route("**/api/plugins/catalog-papers/helper", async (route) => {
    const body = route.request().postDataJSON() as { method?: string; params?: Record<string, unknown> } | null;
    if (body?.method === "scan_external_roots") {
      const params = body.params ?? {};
      calls.push({ method: body.method, params });
      const dryRun = params.dry_run !== false;
      const action = dryRun ? "create" : "created";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          dry_run: dryRun,
          roots_scanned: ["../Library/Papers", "../Library/Books"],
          total_pdfs: 2,
          created: 2,
          updated: 0,
          moved: 0,
          unchanged: 0,
          enriched: 0,
          skipped: 0,
          errors: [],
          items: [
            {
              action,
              citekey: "hubbard1963electron",
              title: "Electron correlations in narrow energy bands",
              kind: "journalArticle",
              bibtex_type: "article",
              pdf_path: "../Library/Papers/CondensedMatter/Hubbard1963.pdf",
              pdf_ref: "../Library/Papers/CondensedMatter/Hubbard1963.pdf",
              collections: ["CondensedMatter"],
              source: "firstpage",
              error: null,
            },
            {
              action,
              citekey: "altland2023condensed",
              title: "Condensed Matter Field Theory",
              kind: "science_book",
              bibtex_type: "book",
              pdf_path: "../Library/Books/Textbooks/Altland2023.pdf",
              pdf_ref: "../Library/Books/Textbooks/Altland2023.pdf",
              collections: ["Textbooks"],
              source: "isbn",
              error: null,
            },
          ],
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();

  await runCommandPalette(page, "References: scan external folders");
  const pw = page.getByTestId("paper-workflows-modal");
  await expect(pw).toBeVisible();
  await expect(pw.getByTestId("paper-tab-scan")).toHaveAttribute("aria-selected", "true");
  await expect(pw.getByTestId("scan-folders-panel")).toBeVisible();

  await pw.getByTestId("scan-root-input").fill("../Library/Papers");
  await pw.getByTestId("scan-max-lookups").fill("0");
  await pw.getByTestId("scan-rate-limit").fill("100");

  // 1. Dry-run preview
  await pw.getByTestId("scan-preview-btn").click();
  const report = pw.getByTestId("scan-report");
  await expect(report).toBeVisible();
  await expect(report).toHaveAttribute("data-mode", "dry-run");
  await expect(pw.getByTestId("scan-status")).toContainText("Preview complete");
  await expect(pw.getByTestId("scan-count-total")).toHaveText("2");
  await expect(pw.getByTestId("scan-count-created")).toHaveText("2");
  await expect(pw.getByTestId("scan-count-errors")).toHaveText("0");

  const rows = pw.getByTestId("scan-item-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).getByTestId("scan-item-kind")).toContainText("Paper");
  await expect(rows.nth(0).getByTestId("scan-item-action")).toHaveText("create");
  await expect(rows.nth(0).getByTestId("scan-item-citekey")).toHaveText("hubbard1963electron");
  await expect(rows.nth(0).getByTestId("scan-item-collection")).toHaveText("CondensedMatter");
  await expect(rows.nth(0).getByTestId("scan-item-pdf")).toHaveText("../Library/Papers/CondensedMatter/Hubbard1963.pdf");

  await expect(rows.nth(1).getByTestId("scan-item-kind")).toContainText("Book");
  await expect(rows.nth(1).getByTestId("scan-item-action")).toHaveText("create");
  await expect(rows.nth(1).getByTestId("scan-item-citekey")).toHaveText("altland2023condensed");
  await expect(rows.nth(1).getByTestId("scan-item-collection")).toHaveText("Textbooks");
  await expect(rows.nth(1).getByTestId("scan-item-pdf")).toHaveText("../Library/Books/Textbooks/Altland2023.pdf");

  expect(calls[0]?.params).toEqual({ dry_run: true, root: "../Library/Papers", max_lookups: 0, rate_limit_ms: 100 });

  // 2. Apply sync (dry_run: false)
  await pw.getByTestId("scan-sync-btn").click();
  await expect(report).toHaveAttribute("data-mode", "applied");
  await expect(pw.getByTestId("scan-status")).toContainText("Sync complete");
  await expect(rows.nth(0).getByTestId("scan-item-action")).toHaveText("created");
  await expect(rows.nth(1).getByTestId("scan-item-action")).toHaveText("created");
  expect(calls[1]?.params).toEqual({ dry_run: false, root: "../Library/Papers", max_lookups: 0, rate_limit_ms: 100 });

  // 3. Clear report
  await pw.getByTestId("scan-clear-btn").click();
  await expect(report).toHaveCount(0);
});

test("Library references filters Books (book and science_book) separately from Papers", async ({ page }) => {
  await page.route("**/api/plugins/catalog-papers/helper", async (route) => {
    const body = route.request().postDataJSON() as { method?: string } | null;
    if (body?.method === "list") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            key: "anderson1972more",
            dir: "refs/papers/anderson1972more",
            title: "More Is Different",
            kind: "journalArticle",
            authors: ["Anderson, P. W."],
            year: "1972",
            venue: "Science",
            doi: "10.1126/science.177.4047.393",
            arxiv: null,
            url: null,
            abstract_text: null,
            collections: ["Philosophy"],
            tags: [],
            pdf: "../Library/Papers/Philosophy/Anderson1972.pdf",
            added: "2026-11-10 10:00:00",
            has_notes: false,
          },
          {
            key: "altland2023condensed",
            dir: "refs/papers/altland2023condensed",
            title: "Condensed Matter Field Theory",
            kind: "book",
            authors: ["Altland, Alexander", "Simons, Ben D."],
            year: "2023",
            venue: "Cambridge University Press",
            doi: null,
            arxiv: null,
            url: null,
            abstract_text: null,
            collections: ["Textbooks"],
            tags: [],
            pdf: "../Library/Books/Textbooks/Altland2023.pdf",
            added: "2026-11-11 10:00:00",
            has_notes: false,
          },
          {
            key: "sachdev2011quantum",
            dir: "refs/papers/sachdev2011quantum",
            title: "Quantum Phase Transitions",
            kind: "science_book",
            authors: ["Sachdev, Subir"],
            year: "2011",
            venue: "Cambridge University Press",
            doi: null,
            arxiv: null,
            url: null,
            abstract_text: null,
            collections: ["Textbooks"],
            tags: [],
            pdf: "../Library/Books/Textbooks/Sachdev2011.pdf",
            added: "2026-11-12 10:00:00",
            has_notes: false,
          },
        ]),
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await page.keyboard.press("Meta+Shift+L");

  const lib = page.locator(".library");
  await expect(lib.locator(".row")).toHaveCount(3);

  const typeBar = lib.getByRole("toolbar", { name: "Type" });
  await expect(typeBar).toBeVisible();
  await typeBar.getByRole("button", { name: /^Books\b/ }).click();
  await expect(typeBar.getByRole("button", { name: /^Books\b/ })).toHaveAttribute("aria-pressed", "true");
  await expect(lib.locator(".row")).toHaveCount(2);
  await expect(lib.locator(".row .t")).toHaveText(["Quantum Phase Transitions", "Condensed Matter Field Theory"]);
  await lib.locator(".row", { hasText: "Quantum Phase Transitions" }).click();
  await expect(lib.locator(".detail .kind")).toContainText("science book");

  await typeBar.getByRole("button", { name: /^Papers\b/ }).click();
  await expect(typeBar.getByRole("button", { name: /^Papers\b/ })).toHaveAttribute("aria-pressed", "true");
  await expect(lib.locator(".row")).toHaveCount(1);
  await expect(lib.locator(".row .t")).toHaveText(["More Is Different"]);

  await typeBar.getByRole("button", { name: /^All\b/ }).click();
  await expect(lib.locator(".row")).toHaveCount(3);

  await lib.getByRole("button", { name: "Scan external folders…" }).click();
  const pw = page.getByTestId("paper-workflows-modal");
  await expect(pw).toBeVisible();
  await expect(pw.getByTestId("paper-tab-scan")).toHaveAttribute("aria-selected", "true");
});
