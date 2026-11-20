import { test, expect, type APIRequestContext } from "@playwright/test";
import { openFile } from "./open";

const H = { "x-kandinsky": "1" };

async function setOff(request: APIRequestContext, off: string[]) {
  const d = await (await request.get("/api/config", { headers: H })).json();
  d.config.plugins.off = off;
  expect((await request.put("/api/config", { headers: H, data: d.config })).ok()).toBeTruthy();
}

test.afterEach(async ({ request }) => {
  await setOff(request, []);
  await request.put("/api/file", { headers: H, data: { path: ".kandinsky/cache/layout.json", text: "null" } });
});

test("References table shows metadata columns, green PDF / red no-PDF badges, 1-click toolbar actions, Open folder, and persists sort/tags", async ({ page }) => {
  const sampleRefs = [
    {
      key: "anderson1972more",
      kind: "journalArticle",
      title: "More Is Different",
      authors: ["P. W. Anderson"],
      year: "1972",
      venue: "Science",
      publisher: "AAAS",
      doi: "10.1126/science.177.4047.393",
      dir: "refs/papers/anderson1972more",
      pdf: "refs/papers/anderson1972more/anderson1972more.pdf",
      collections: ["Philosophy"],
      tags: ["emergent"],
      has_notes: false,
      added: "2026-10-01 10:00:00",
    },
    {
      key: "altland2010condensed",
      kind: "book",
      title: "Condensed Matter Field Theory",
      authors: ["Alexander Altland", "Ben Simons"],
      year: "2010",
      venue: "Cambridge University Press",
      publisher: "Cambridge University Press",
      isbn: "9780521843096",
      dir: "refs/papers/altland2010condensed",
      pdf: null,
      collections: ["Textbooks"],
      tags: ["qft"],
      has_notes: false,
      added: "2026-10-02 10:00:00",
    },
  ];

  await page.route("**/api/plugins/catalog-papers/helper", async (route) => {
    const body = route.request().postDataJSON() as { method?: string } | null;
    if (body?.method === "list") {
      await route.fulfill({ json: sampleRefs });
      return;
    }
    if (body?.method === "edit") {
      await route.fulfill({ json: { ...sampleRefs[1], edition: "2nd ed.", series: "Physics Textbooks" } });
      return;
    }
    if (body?.method === "discover_zotero") {
      await route.fulfill({ json: { found: false } });
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await page.getByTestId("nav-library").click();

  const lib = page.locator(".library");
  await expect(lib.locator(".row")).toHaveCount(2);
  await expect(lib).not.toContainText(">>>>>>> theirs");

  // Table layout columns and PDF vs no-PDF badges
  await lib.getByRole("radio", { name: "Table" }).click();
  const table = lib.locator(".zot-table");
  await expect(table).toBeVisible();
  const headers = await table.locator("thead th .th-btn span:first-child").allTextContents();
  expect(headers).toEqual(["Title", "Creators", "Year", "Publication", "Publisher", "Citekey", "Added", "PDF"]);

  const withPdfRow = table.locator("tbody tr", { hasText: "More Is Different" });
  const withoutPdfRow = table.locator("tbody tr", { hasText: "Condensed Matter Field Theory" });
  await expect(withPdfRow.locator(".c-pdf .flag.green")).toHaveText("PDF");
  await expect(withPdfRow.locator(".c-pdf .flag.red")).toHaveCount(0);
  await expect(withoutPdfRow.locator(".c-pdf .flag.red")).toHaveText("no PDF");

  // 1-click toolbar buttons open PaperWorkflowsModal and ZoteroImportModal
  await lib.locator("header").getByRole("button", { name: "Add paper", exact: true }).click();
  await expect(page.getByTestId("paper-workflows-modal")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("paper-workflows-modal")).toHaveCount(0);

  await lib.locator("header").getByRole("button", { name: "Import from Zotero", exact: true }).click();
  await expect(page.getByTestId("zotero-import-modal")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("zotero-import-modal")).toHaveCount(0);

  // Item detail includes Open folder alongside Reveal in Explorer (for items with PDF)
  await withPdfRow.click();
  await lib.locator(".detail").getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("menuitem", { name: "Open folder" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Reveal in Explorer" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Edit form exposes extended fields (edition, series, URL, abstractNote)
  await withoutPdfRow.locator(".row-focus").click();
  await expect(lib.locator(".detail")).toContainText("Condensed Matter Field Theory");
  await lib.locator(".detail").getByRole("button", { name: "Edit", exact: true }).click();
  await expect(lib.getByLabel("Publisher", { exact: true })).toHaveValue("Cambridge University Press");
  await expect(lib.getByLabel("Edition", { exact: true })).toBeVisible();
  await expect(lib.getByLabel("Series", { exact: true })).toBeVisible();
  await expect(lib.getByLabel("URL", { exact: true })).toBeVisible();
  await expect(lib.getByLabel("Abstract", { exact: true })).toBeVisible();
  await lib.getByRole("button", { name: "Cancel" }).click();

  // Tags toggle & sort direction persist
  const tagsBtn = lib.locator(".side").getByRole("button", { name: /^Tags/ });
  await expect(tagsBtn).toHaveAttribute("aria-expanded", "false");
  await tagsBtn.click();
  await expect(tagsBtn).toHaveAttribute("aria-expanded", "true");
  await table.locator("thead th.col-title .th-btn").click();
  await expect(table.locator("thead th.col-title")).toHaveAttribute("aria-sort", "ascending");
  await table.locator("thead th.col-title .th-btn").click();
  await expect(table.locator("thead th.col-title")).toHaveAttribute("aria-sort", "descending");
});

test("Empty References state renders Add paper and Import from Zotero buttons", async ({ page }) => {
  await page.route("**/api/plugins/catalog-papers/helper", async (route) => {
    const body = route.request().postDataJSON() as { method?: string } | null;
    if (body?.method === "list") {
      await route.fulfill({ json: [] });
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await page.getByTestId("nav-library").click();

  const emptyActions = page.locator(".library .empty-actions");
  await expect(emptyActions.getByRole("button", { name: "Add paper" })).toBeVisible();
  await expect(emptyActions.getByRole("button", { name: "Import from Zotero" })).toBeVisible();
});

test("DropFileChoiceModal shows external folder copy when configured without hardcoding proprietary names", async ({ page, request }) => {
  await request.put("/api/file", { headers: H, data: { path: "notes/drop-target.md", text: "# Drop Target\n\nBody text.\n" } });
  await page.route("**/api/plugins", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const resp = await route.fetch();
    const list = await resp.json();
    const patched = Array.isArray(list)
      ? list.map((p: Record<string, unknown>) =>
          p.id === "catalog-papers"
            ? {
                ...p,
                settings: {
                  ...(typeof p.settings === "object" && p.settings ? p.settings : {}),
                  store_in_external: true,
                  external_pdf_roots: ["/tmp/external-papers"],
                },
              }
            : p,
        )
      : list;
    await route.fulfill({ status: resp.status(), json: patched });
  });

  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await openFile(page, "drop-target.md");
  await page.locator(".cm-content").first().waitFor();
  await page.locator(".cm-content").first().click();

  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["%PDF-1.4\n%%EOF\n"], "Quantum_Drop_Test.pdf", { type: "application/pdf" }));
    const target = document.querySelector(".cm-editor") ?? document.querySelector(".cm-content")!;
    target.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  });

  const modal = page.getByTestId("drop-file-choice-modal");
  await expect(modal).toBeVisible();
  const libChoice = modal.getByTestId("drop-choice-library");
  await expect(libChoice).toContainText("Add to Paper Library (external folder, no vault copy) & cite");
  await expect(libChoice).not.toContainText("kDrive");
  await page.keyboard.press("Escape");
  await request.post("/api/fs/trash?path=notes/drop-target.md", { headers: H }).catch(() => {});
});

test("Library launcher remains visible and offers 1-click Catalog enable when catalog plugin is off", async ({ page, request }) => {
  await setOff(request, ["catalog"]);

  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();

  const libBtn = page.getByTestId("nav-library");
  await expect(libBtn).toBeVisible();
  await libBtn.click();

  await expect(page.getByText("Catalog plugin is switched off")).toBeVisible();
  const enableBtn = page.getByRole("button", { name: /^Enable Catalog/ });
  await expect(enableBtn).toBeVisible();
  await enableBtn.click();

  await expect(page.locator(".libraries .library")).toBeVisible();
});

test("Pdf pane shows paper.arxiv badge when PDF filename lacks an arXiv id", async ({ page }) => {
  await page.route("**/api/plugins/catalog-papers/helper", async (route) => {
    const body = route.request().postDataJSON() as { method?: string } | null;
    if (body?.method === "list") {
      await route.fulfill({
        json: [
          {
            key: "kitaev2006anyons",
            kind: "journalArticle",
            title: "Anyons in an exactly solved model",
            authors: ["Alexei Kitaev"],
            year: "2006",
            arxiv: "cond-mat/0506438",
            dir: "refs/papers/kitaev2006anyons",
            pdf: "refs/hubbard1963/hubbard1963.pdf",
            collections: [],
            tags: [],
            has_notes: false,
          },
        ],
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  await page.getByText("Finish the GW notes.").waitFor();
  await page.getByTestId("nav-library").click();

  const lib = page.locator(".library");
  await lib.locator(".row", { hasText: "Anyons in an exactly solved model" }).click();
  await lib.locator(".detail").getByRole("button", { name: "Read", exact: true }).click();

  const pdfPane = page.locator(".pdf-pane").last();
  await expect(pdfPane).toBeVisible();
  await expect(pdfPane.locator(".arxiv-tag")).toHaveText("arXiv:cond-mat/0506438");
});
