#!/usr/bin/env node
// The README's screenshots, from a demo vault made here from fixtures (never a real vault), in both themes.
//
//   node scripts/dev/readme-shots.mjs [--bin target/debug/kandinsky] [--out docs/img/readme]
//
// Builds the vault in the temp folder, serves it with `kandinsky serve` (locked, its own vault list and secret store),
// captures the workspace and the new-row form in Chromium, then encodes them as WebP with cwebp or ImageMagick.
// Everything it starts or writes outside <out> is removed at the end.
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const { chromium } = createRequire(join(root, "ui/package.json"))("playwright");
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const bin = resolve(arg("--bin", join(root, "target/debug/kandinsky")));
const out = resolve(arg("--out", join(root, "docs/img/readme")));
const say = (m) => console.log(`[shots] ${m}`);

const recipe = (method, ratio, minutes, rating, body) =>
  `---\ntype: Recipe\nmethod: ${method}\nratio: "${ratio}"\nminutes: ${minutes}\nrating: ${rating}\ntopics: ["[[Coffee]]"]\n---\n${body}`;
const FILES = {
  ".kandinsky/config.toml": `log_dir = "log"\nvim = false\n\n[ui]\nrestore_layout = false\n\n[editor]\nproperties = "inline"\n`,
  "notes/Coffee.md": `---\ntype: Topic\ntags: [kitchen, reading]\naliases: [coffee brewing]\n---\n# Coffee\n\nNotes on brewing at home: what changes the cup, and the recipes that worked. See [[Extraction]] for the numbers and [[Grinders]] for the gear.\n\n> [!tip] Start here\n> Fix the ratio first, then change one thing at a time: grind, water, time.\n\n## Recipes\n\n![[recipes.base]]\n`,
  "notes/Extraction.md": `---\ntype: Concept\ntopics: ["[[Coffee]]"]\n---\n# Extraction\n\nHow much of the coffee ends up in the cup. The **extraction yield** is the dissolved mass over the dry dose:\n\n$$\nE = \\frac{\\mathrm{TDS} \\cdot m_\\text{beverage}}{m_\\text{dose}}\n$$\n\nA yield of $18$–$22\\,\\%$ tastes balanced; below it the cup is sour, above it bitter.\n\n| Brew | Dose | Water | Yield |\n|---|---|---|---|\n| V60 | 15 g | 250 g | 20 % |\n| Espresso | 18 g | 36 g | 19 % |\n\nRelated: [[Coffee]], [[Grinders]].\n`,
  "notes/Grinders.md": `---\ntype: Concept\ntopics: ["[[Coffee]]"]\n---\n# Grinders\n\nBurrs, not blades: an even grind extracts evenly.\n`,
  "notes/recipes/V60.md": recipe("pour-over", "1:16", 3.5, 5, "# V60\n\n15 g, 250 g of water at 94 °C, a 45 s bloom.\n"),
  "notes/recipes/Espresso.md": recipe("espresso", "1:2", 0.5, 4, "# Espresso\n\n18 g in, 36 g out, 28 s.\n"),
  "notes/recipes/AeroPress.md": recipe("immersion", "1:14", 2, 4, "# AeroPress\n\nInverted, 17 g, two minutes, a slow press.\n"),
  "notes/recipes/French press.md": recipe("immersion", "1:15", 4, 3, "# French press\n\nCoarse, four minutes, skim before plunging.\n"),
  "notes/recipes/recipes.base": `filters:\n  and:\n    - type == "Recipe"\nviews:\n  - type: table\n    name: By rating\n    rowTemplate: brew-log\n    order: [file.name, method, ratio, rating]\n    sort:\n      - property: rating\n        direction: DESC\n`,
  "templates/brew-log.md": "---\ntemplate_title: Brew log\ndose: {{prompt:Dose (g) | number}}\nwater: {{prompt:Water (g) | number}}\n---\n# {{title}}\n\n## Tasting notes\n\n{{cursor}}\n",
  "log/2026-10-23.md": "# 2026-10-23\n\n- 08:10 Tried the V60 with a longer bloom: sweeter.\n",
  "FOCUS.md": "# Focus\n\nWrite up the brewing notes.\n",
};

const tmp = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "kandinsky-demo-"));
const vault = join(tmp, "Demo");
for (const [p, text] of Object.entries(FILES)) {
  mkdirSync(dirname(join(vault, p)), { recursive: true });
  writeFileSync(join(vault, p), text);
}
say(`demo vault: ${vault} (${Object.keys(FILES).length} files)`);

const PORT = 7741, KEY = `kandinsky_demo${Date.now().toString(16)}`, url = `http://127.0.0.1:${PORT}/`;
const env = { ...process.env, KANDINSKY_VAULTS: join(tmp, "vaults.toml"), KANDINSKY_SECRETS_DIR: join(tmp, "secrets"), KANDINSKY_SERVER_CONFIG: join(tmp, "server.toml"), KANDINSKY_SERVER_STATE: join(tmp, "server.json"), KANDINSKY_AGENTS_FILE: join(tmp, "agents.json"), KANDINSKY_APP: "true", KANDINSKY_LOCAL_LOCK: "1", KANDINSKY_LOCAL_KEY: KEY, KANDINSKY_NO_BROWSER: "1", KANDINSKY_VAULT_TRASH: "1", KANDINSKY_NO_NOTIFY: "1" };
delete env.KANDINSKY_UI_DIR;
const core = spawn(bin, ["serve", vault, "--port", String(PORT)], { env, stdio: ["ignore", "inherit", "inherit"] });
say(`core: ${bin} (pid ${core.pid}) on ${url}`);

async function capture(page, name, theme, clip) {
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.evaluate(() => document.fonts.ready);
  const png = join(tmp, `${name}-${theme}.png`);
  const webp = join(out, `${name}-${theme}.webp`);
  await page.screenshot({ path: png, animations: "disabled", clip });
  try {
    execFileSync("cwebp", ["-quiet", "-q", "82", png, "-o", webp]);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    execFileSync("magick", [png, "-quality", "82", webp]);
  }
  say(`${theme}: ${webp}`);
}

let browser;
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(url)).status < 500) break; } catch { /* not up yet */ }
    if (i > 120) throw new Error("the core did not answer in 60 s");
    await new Promise((r) => setTimeout(r, 500));
  }
  mkdirSync(out, { recursive: true });
  browser = await chromium.launch({ executablePath: process.env.KANDINSKY_PW_CHROME });
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 }, colorScheme: theme, extraHTTPHeaders: { authorization: `Bearer ${KEY}` } });
    await ctx.addCookies([{ name: "kandinsky_local", value: KEY, url }]);
    const page = await ctx.newPage();
    await page.goto(url);
    await page.getByText("Write up the brewing notes.").first().waitFor({ timeout: 30_000 });
    const tree = page.getByTestId("sidebar").locator(".tree-scroll");
    await tree.getByText("notes", { exact: true }).click();
    await tree.getByText("Coffee", { exact: true }).click();
    await page.locator(".cm-content").getByText(/Notes on brewing at home/).waitFor();
    await page.locator(".cm-content").getByText("V60", { exact: true }).first().waitFor();
    const favorite = page.getByRole("button", { name: "Add to Favorites" });
    if (await favorite.count()) {
      await favorite.click();
      await page.getByTestId("sidebar").getByRole("region", { name: "Favorites" }).getByText("Coffee").waitFor();
      await page.locator(".toast").filter({ hasText: "Bookmarked" }).getByRole("button", { name: "Close" }).click();
    }
    await capture(page, "workspace", theme);
    await page.keyboard.press("F1");
    const palette = page.getByTestId("palette");
    await palette.getByRole("textbox").fill("Bases");
    await palette.getByText(/^Bases: open one/).click();
    await palette.getByText("recipes", { exact: true }).click();
    await page.locator(".base-pane").getByRole("button", { name: "New", exact: true }).click();
    const row = page.getByRole("dialog", { name: "New row" });
    await row.getByRole("button", { name: "Template", exact: true }).getByText("Brew log", { exact: true }).waitFor();
    await row.getByRole("textbox", { name: "Title", exact: true }).fill("Morning V60");
    await row.getByRole("spinbutton", { name: "Dose (g)", exact: true }).fill("15");
    await row.getByRole("spinbutton", { name: "Water (g)", exact: true }).fill("250");
    await capture(page, "base-template", theme, { x: 252, y: 0, width: 1188, height: 610 });
    await ctx.close();
  }
} finally {
  await browser?.close();
  core.kill("SIGTERM");
  rmSync(tmp, { recursive: true, force: true });
  say("core stopped, demo vault removed");
}
