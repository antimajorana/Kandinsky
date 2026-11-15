// Which pane kind leaks: for each kind, open a few tabs of it, close them, and compare what the page holds
// (after a GC) with before — twice, reporting the second round: the first one also loads what stays on purpose
// (the kind's code, fonts, caches), a leak grows again every round.
//
//   KANDINSKY_URL=http://127.0.0.1:7743/ node scripts/dev/leak-kinds.mjs [--dist ui/dist] [--n 5] [--kinds md,pdf,…]
//
// Kinds: md, mail, pdf, excalidraw, base, page, and the commands settings, libraries, graph, git, search, terminal.
import { resolve } from "node:path";
import { launchKandinsky } from "./kandinsky-driver.mjs";

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : d; };
const n = Number(opt("--n", "5")), distArg = opt("--dist");
const FILES = { md: /^(?!mail\/|\.kandinsky\/).*\.md$/, mail: /^mail\/.*\.md$/, pdf: /\.pdf$/, excalidraw: /\.excalidraw$/, base: /\.base$/, page: /\.page$/ };
const COMMANDS = { settings: "ui.settings", libraries: "ui.libraries", graph: "ui.graph", git: "ui.git", search: "ui.search", terminal: "ui.terminal.new" };
const kinds = opt("--kinds", [...Object.keys(FILES), ...Object.keys(COMMANDS)].join(",")).split(",");

const kandinsky = await launchKandinsky({ url: process.env.KANDINSKY_URL, dist: distArg && resolve(distArg), tag: "leak" });
const { page, log } = kandinsky;
const files = await kandinsky.files();
const report = [];
async function round(kind, files) {
  const before = await kandinsky.snapshot(`${kind}: before`);
  if (FILES[kind]) {
    for (const f of files.filter((x) => FILES[kind].test(x)).slice(0, n)) { await kandinsky.switchTo(f); await page.waitForTimeout(900); }
  } else {
    await kandinsky.run(COMMANDS[kind]);
    await page.waitForTimeout(2500);
  }
  await kandinsky.closeAllButOne();
  await page.waitForTimeout(2000);
  const after = await kandinsky.snapshot(`${kind}: closed`);
  return { kind, nodes: after.nodes - before.nodes, listeners: after.listeners - before.listeners, intervals: after.intervals - before.intervals, heapMB: +(after.heapMB - before.heapMB).toFixed(1) };
}
await kandinsky.closeAllButOne();
for (const kind of kinds) { await round(kind, files); report.push(await round(kind, files)); }
log("left behind per kind, second round (after − before, all its tabs closed):");
for (const r of report) log(`  ${r.kind.padEnd(11)} nodes ${String(r.nodes).padStart(6)} · listeners ${String(r.listeners).padStart(5)} · intervals ${String(r.intervals).padStart(3)} · heap ${String(r.heapMB).padStart(6)} MB`);
log(`page errors: ${kandinsky.errs.length ? kandinsky.errs.slice(0, 5).join(" | ") : "none"}`);
await kandinsky.browser.close();
