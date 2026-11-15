# Word stats (example of a helper)

A plugin with a helper: JavaScript the core runs for the plugin (QuickJS), started at the first call and kept running,
so it can remember what it computed. Use a helper when the page is not the place: work that should not wait for a
window, a cache shared by every window, the core's native primitives (`kandinsky.html`, `kandinsky.csv`, `kandinsky.zip`…), the
programs the manifest names (`kandinsky.exec`). Copy the folder into a vault's `.kandinsky/plugins/` and run "Word stats: count".

## What it adds

- **A status cell** "words: …"; a click counts again.
- **The command** "Word stats: count the words of all notes".
- **The helper** (`helper.js`): the method `count` reads the vault's notes, keeps each note's count (the reason to be a
  long-lived helper), forgets the ones the page says were saved, and sends `progress` events while it works, which the
  page shows with `kandinsky.helper.on`.
- A saved note triggers a new count (cheap: only that note is read again).

## What it shows a plugin author

`[helper] js` and `idle` in the manifest, `kandinsky.methods`, `kandinsky.event`, `kandinsky.files` / `kandinsky.read` in the helper,
`kandinsky.helper.call` and `kandinsky.helper.on` in the page. docs/guides/PLUGIN-API.md, "JavaScript helpers", has the details;
a bigger helper is written in TypeScript (`helper/helper.ts`, built and tested by `scripts/dev/plugin-ui.mjs`, as Print's).
What a script cannot do — read files outside the vault, link a native library — is a compiled helper (`[helper] run`,
as Claude's and Syncthing's, in Rust).

## Settings

None.

## Needs

Nothing: the helper runs inside Kandinsky.

## Platforms

Linux works; the phone runs it too (`phone = true`); the others are untested.
