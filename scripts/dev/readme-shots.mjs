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

const sockCase = (status, lastSeen, color, body) =>
  `---\ntype: Sock case\nstatus: ${status}\nlast_seen: ${lastSeen}\ncolor: ${color}\ntopics: ["[[Missing Socks]]"]\n---\n${body}`;
const FILES = {
  ".kandinsky/config.toml": `log_dir = "log"\nvim = false\n\n[ui]\nrestore_layout = false\n\n[editor]\nproperties = "inline"\n`,
  "notes/Missing Socks.md": `---\ntype: Topic\ntags: [laundry, mysteries]\naliases: [sock casebook]\n---\n# Missing Socks\n\nFour socks went into the wash. Three came back. See [[Striped Sock]] for the open case. [[The Dryer]] has declined to comment.\n\n> [!tip] Lead to follow\n> Check inside the fitted sheet. It has a history.\n\n## Case notes\n\n![[sock-cases.base]]\n`,
  "notes/The Dryer.md": "# The Dryer\n\nThe only statement on record was a beep.\n",
  "notes/cases/Striped Sock.md": sockCase("Missing", "Laundry basket", "Yellow", "# Striped Sock\n\nLast seen before the spin cycle.\n"),
  "notes/cases/Blue Sock.md": sockCase("Found", "Inside the duvet", "Blue", "# Blue Sock\n\nRecovered from the far corner of the duvet cover.\n"),
  "notes/cases/Hiking Sock.md": sockCase("Found", "Behind the dryer", "Charcoal", "# Hiking Sock\n\nFound during a search for spare change.\n"),
  "notes/cases/Polka-Dot Sock.md": sockCase("Found", "Inside another sock", "Red", "# Polka-Dot Sock\n\nThe other sock was a size larger.\n"),
  "notes/cases/sock-cases.base": `filters:\n  and:\n    - type == "Sock case"\nproperties:\n  note.last_seen:\n    displayName: Last seen\nviews:\n  - type: table\n    name: By status\n    rowTemplate: sock-report\n    order: [file.name, status, note.last_seen, color]\n    sort:\n      - property: status\n        direction: DESC\n`,
  "templates/sock-report.md": "---\ntemplate_title: Sock report\nstatus: Missing\ncolor: {{prompt:Color}}\nlast_seen: {{prompt:Last seen}}\n---\n# {{title}}\n\n## Search notes\n\n{{cursor}}\n",
  "FOCUS.md": "# Focus\n\nCheck the fitted sheet.\n",
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
    await page.getByText("Check the fitted sheet.").first().waitFor({ timeout: 30_000 });
    const tree = page.getByTestId("sidebar").locator(".tree-scroll");
    await tree.getByText("notes", { exact: true }).click();
    await tree.getByText("Missing Socks", { exact: true }).click();
    await page.locator(".cm-content").getByText(/Four socks went into the wash/).waitFor();
    await page.locator(".cm-content .file-embed .base").getByText("Striped Sock", { exact: true }).waitFor();
    const favorite = page.getByRole("button", { name: "Add to Favorites" });
    if (await favorite.count()) {
      await favorite.click();
      await page.getByTestId("sidebar").getByRole("region", { name: "Favorites" }).getByText("Missing Socks", { exact: true }).waitFor();
      await page.locator(".toast").filter({ hasText: "Bookmarked" }).getByRole("button", { name: "Close" }).click();
    }
    await capture(page, "workspace", theme);
    await page.keyboard.press("F1");
    const palette = page.getByTestId("palette");
    await palette.getByRole("textbox").fill("Bases");
    await palette.getByText(/^Bases: open one/).click();
    await palette.getByText("sock-cases", { exact: true }).click();
    await page.locator(".base-pane").getByRole("button", { name: "New", exact: true }).click();
    const row = page.getByRole("dialog", { name: "New row" });
    await row.getByRole("button", { name: "Template", exact: true }).getByText("Sock report", { exact: true }).waitFor();
    await row.getByRole("textbox", { name: "Title", exact: true }).fill("Green Sock");
    await row.getByRole("textbox", { name: "Color", exact: true }).fill("Moss green");
    await row.getByRole("textbox", { name: "Last seen", exact: true }).fill("By the laundry basket");
    await capture(page, "base-template", theme, { x: 252, y: 0, width: 1188, height: 610 });
    await ctx.close();
  }
} finally {
  await browser?.close();
  core.kill("SIGTERM");
  rmSync(tmp, { recursive: true, force: true });
  say("core stopped, demo vault removed");
}
