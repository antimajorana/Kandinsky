#!/usr/bin/env node
// The release tag, annotated with the version's notes from docs/CHANGELOG.md (publish/README.md, "A release"):
//   node scripts/dev/release-tag.mjs <x.y.z> [--windows] [--force] [--print]
// The tag goes on the public commit and includes the changelog's section for that version.
// --windows: publish the Windows installer independently of the all-platform draft.
// --force: replace a local tag of that name (a tag already pushed then needs `git push --force github vX`).
// --print: only show the message, tagging nothing.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith("--"));
const force = args.includes("--force");
const print = args.includes("--print");
const windows = args.includes("--windows");
const say = (line) => console.log(`[tag] ${line}`);
const fail = (why) => { console.error(`[tag] ${why}`); process.exit(1); };
const git = (...a) => execFileSync("git", a, { cwd: repo, encoding: "utf8" }).trim();

if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) fail("usage: release-tag.mjs <x.y.z> [--windows] [--force] [--print]");

/** The changelog's section for `v`: the lines under `## [v]` up to the next `## ` heading, trimmed. */
function notes(v) {
  const lines = readFileSync(join(repo, "docs/CHANGELOG.md"), "utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith(`## [${v}]`));
  if (start < 0) fail(`docs/CHANGELOG.md has no "## [${v}]" section`);
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  const body = lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
  if (!body) fail(`the "## [${v}]" section of docs/CHANGELOG.md is empty`);
  return body;
}

const message = `Kandinsky ${version}\n\n${notes(version)}\n${windows ? "\nRelease-Target: windows\n" : ""}`;
if (print) { process.stdout.write(message); process.exit(0); }

const ref = existsSync(join(repo, "publish")) ? "public" : "HEAD";
const committedVersion = git("show", `${ref}:Cargo.toml`).match(/^\[workspace\.package\][^[]*?^version = "([^"]+)"/m)?.[1];
if (committedVersion !== version) fail(`${ref}'s Cargo.toml says ${committedVersion ?? "no version"}, expected ${version}`);

const tag = `v${version}`;
const exists = git("tag", "-l", tag) === tag;
if (exists && !force) fail(`${tag} exists; --force replaces it`);

const dir = mkdtempSync(join(tmpdir(), "kandinsky-tag-"));
try {
  const file = join(dir, "message");
  writeFileSync(file, message);
  // verbatim: the default cleanup would drop the changelog's "### Added" lines as comments
  git("tag", "-a", ...(force ? ["-f"] : []), "--cleanup=verbatim", "-F", file, tag, ref);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
say(`${exists ? "replaced" : "made"} ${tag} on ${ref} (${git("rev-parse", "--short", ref)})`);
