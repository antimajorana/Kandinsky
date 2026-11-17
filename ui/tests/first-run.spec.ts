import { test, expect } from "@playwright/test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WS } from "../playwright.config";

// A brand-new user's first start (docs/guides/FIRST-RUN.md): a core with an empty HOME — no vault list, no settings, no
// secrets, no KANDINSKY_* variables but the two that keep tests off the desktop — serving a folder that is not a vault yet.
const BASE = `${WS}-firstrun`;
const HOME = join(BASE, "home");
const VAULT = join(HOME, "Notes");
const PORT = 7743;
const KANDINSKY = process.env.KANDINSKY_SERVER_CMD ?? fileURLToPath(new URL(process.platform === "win32" ? "../../target/debug/kandinsky.exe" : "../../target/debug/kandinsky", import.meta.url));
const env = {
  PATH: process.env.PATH ?? "/usr/bin:/bin", HOME, USERPROFILE: HOME, LANG: "C.UTF-8",
  XDG_CONFIG_HOME: join(HOME, ".config"), XDG_DATA_HOME: join(HOME, ".local/share"), XDG_CACHE_HOME: join(HOME, ".cache"), XDG_STATE_HOME: join(HOME, ".local/state"),
  KANDINSKY_VAULTS: join(BASE, "vaults.toml"), KANDINSKY_SECRETS_DIR: join(BASE, "secrets"),
  KANDINSKY_SERVER_CONFIG: join(BASE, "server.toml"), KANDINSKY_SERVER_STATE: join(BASE, "server.json"),
  KANDINSKY_AGENTS_FILE: join(BASE, "agents.json"), KANDINSKY_TRUST_TEST_BINARIES: "1",
  KANDINSKY_NO_BROWSER: "1", KANDINSKY_VAULT_TRASH: "1",
};
let core: ChildProcess;

test.beforeAll(async () => {
  rmSync(BASE, { recursive: true, force: true });
  mkdirSync(VAULT, { recursive: true });
  core = spawn(KANDINSKY, ["serve", VAULT, "--port", String(PORT)], { env, stdio: "ignore" });
  await expect.poll(() => fetch(`http://127.0.0.1:${PORT}/api/workspace`, { headers: { "x-kandinsky": "1" } }).then((r) => r.ok, () => false), { timeout: 60_000 }).toBe(true);
});
test.afterAll(() => { core?.kill(); rmSync(BASE, { recursive: true, force: true }); });

test("a first start: the Today screen with nothing configured, no error, no vim, Settings and the plugins list readable", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await expect(page.getByText("Click to write your priorities for today…")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Nothing captured yet today.")).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.locator("body")).not.toContainText(/invalid date|\bundefined\b|\bNaN\b/i);
  await expect(page.locator(".toast[data-kind=error]")).toHaveCount(0);
  // the vault became one: its home page written once, nothing else of the user's touched
  expect(existsSync(join(VAULT, "Home.page"))).toBe(true);
  expect(existsSync(join(HOME, "Home.page"))).toBe(false);
  // a newcomer's keys type text: vim is off until asked for
  const config = await (await page.request.get(`http://127.0.0.1:${PORT}/api/config`, { headers: { "x-kandinsky": "1" } })).json();
  expect(config.config.vim).toBe(false);

  await page.keyboard.press("Meta+,");
  const nav = page.getByRole("navigation", { name: "Settings pages" });
  await expect(nav).toBeVisible();
  await nav.getByRole("button", { name: /^Extensions/ }).first().click();
  await expect(page.getByRole("heading", { name: /Installed & Core Plugins/ })).toBeVisible();
  await expect(page.locator(".toast[data-kind=error]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the vaults block offers a new vault and an existing folder, as the vault switcher does", async ({ page }) => {
  writeFileSync(join(VAULT, "Welcome.page"), "title: Welcome\nrows:\n  - [greeting]\n  - - view: vaults\n      title: Start with a vault\n");
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.keyboard.press("Control+p");
  await page.keyboard.type("Welcome");
  await page.getByRole("dialog", { name: "Command palette" }).getByRole("button", { name: "Welcome" }).click();
  const block = page.getByTestId("vaults-block");
  await expect(block.getByRole("button", { name: "New vault…" })).toBeEnabled();
  await expect(block.getByRole("button", { name: "Open a folder…" })).toBeEnabled();
  // a core with no screen has no folder dialog (404): the folder is typed instead
  await block.getByRole("button", { name: "New vault…" }).click();
  await expect(page.getByRole("dialog", { name: "Command palette" }).getByPlaceholder(/Where the new vault goes/)).toBeVisible();
});

test("`kandinsky serve` in a bare home folder names what to do instead of serving the whole home", () => {
  const r = spawnSync(KANDINSKY, ["serve", "--port", String(PORT + 1)], { cwd: HOME, env, encoding: "utf8", timeout: 20_000 });
  expect(r.status).not.toBe(0);
  expect(r.stderr).toContain("kandinsky serve ~/Notes");
  expect(existsSync(join(HOME, ".kandinsky"))).toBe(false);
});
