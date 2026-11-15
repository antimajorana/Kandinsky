#!/usr/bin/env node
// Every bundled plugin's helper started by a core with nothing of a desktop around it — no DISPLAY, Wayland, D-Bus or
// session, PATH=/usr/bin:/bin — as on a server (docs/guides/PLUGIN-MATURITY.md, criterion 8). A throwaway vault holds
// all of plugins/*/*; each helper is asked a method it does not have, and "no method … (has: …)" proves it started.
//   node scripts/dev/helpers-headless.mjs [path/to/kandinsky]     (default target/release/kandinsky; exits 1 if one did not start)
// Compiled helpers need their binary in plugins/*/*/bin (plugin-pack.mjs); one missing is reported as not started.
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "../..");
const kandinsky = resolve(process.argv[2] ?? join(repo, "target/release/kandinsky"));
const port = 7700 + Math.floor(Math.random() * 90);
const dir = mkdtempSync(join(tmpdir(), "kandinsky-headless-"));
const vault = join(dir, "vault");
mkdirSync(join(vault, ".kandinsky/plugins"), { recursive: true });
mkdirSync(join(dir, "home"));
writeFileSync(join(vault, "note.md"), "# note\n");
const skip = new Set(["node_modules", "target", "engine", "__pycache__"]);
for (const group of readdirSync(join(repo, "plugins"), { withFileTypes: true }).filter((d) => d.isDirectory())) {
  for (const p of readdirSync(join(repo, "plugins", group.name), { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const from = join(repo, "plugins", group.name, p.name);
    cpSync(from, join(vault, ".kandinsky/plugins", p.name), { recursive: true, filter: (src) => !skip.has(basename(src)) });
  }
}

console.log(`[headless] the core: ${kandinsky} on ${vault}, an empty environment`);
const env = { HOME: join(dir, "home"), PATH: "/usr/bin:/bin", LANG: "C.UTF-8", KANDINSKY_NO_BROWSER: "1", KANDINSKY_VAULT_TRASH: "1", KANDINSKY_NO_NOTIFY: "1" };
const core = spawn(kandinsky, ["serve", "--port", String(port), vault], { env, stdio: ["ignore", "ignore", "pipe"] });
let log = "";
core.stderr.on("data", (b) => (log += b));
const api = (path, body) =>
  fetch(`http://127.0.0.1:${port}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "x-kandinsky": "1", "content-type": "application/json" },
    body: body && JSON.stringify(body),
  }).then((r) => r.json());

let failed = 0;
try {
  for (let i = 0; ; i++) {
    try { await api("/api/version"); break; } catch { if (i > 60) throw new Error(`the core did not answer:\n${log}`); }
    await new Promise((r) => setTimeout(r, 500));
  }
  const plugins = (await api("/api/plugins")).filter((p) => p.has_helper);
  console.log(`[headless] ${plugins.length} plugins with a helper, each asked for a method it does not have`);
  for (const p of plugins) {
    const said = JSON.stringify(await api(`/api/plugins/${p.id}/helper`, { method: "__headless", params: {}, timeout_secs: 30 }));
    const ok = /no method/.test(said);
    if (!ok) failed++;
    console.log(`${ok ? "started " : "FAILED  "} ${p.id.padEnd(24)} ${said.slice(0, 140)}`);
  }
} finally {
  core.kill();
  rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? `[headless] ${failed} helper(s) did not start` : "[headless] every helper started");
process.exit(failed ? 1 : 0);
