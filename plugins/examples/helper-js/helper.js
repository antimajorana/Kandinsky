// The helper of the "Word stats" example: JavaScript the core runs for the plugin (QuickJS, [helper] js), kept alive
// between calls, so what it computed can be kept — here the word count of each note, forgotten when the note is saved.
// `kandinsky.methods` registers what the page may call; `kandinsky.event` sends an event while a call runs; `kandinsky.files` and
// `kandinsky.read` read the vault. A thrown error is the call's error in the page. docs/guides/PLUGIN-API.md, "JavaScript helpers".

const cache = new Map(); // path → words: the reason to be a long-lived helper

async function count(params) {
  const dir = String(params.dir ?? "").replace(/^\.?\/*/, "");
  for (const p of params.changed ?? []) cache.delete(p);
  const notes = (await kandinsky.files()).filter((f) => f.endsWith(".md") && f.startsWith(dir) && !f.split("/").some((part) => part.startsWith(".")));
  let total = 0, files = 0;
  for (const path of notes) {
    if (!cache.has(path)) cache.set(path, (await kandinsky.read(path)).split(/\s+/).filter(Boolean).length);
    total += cache.get(path);
    files += 1;
    if (files % 200 === 0) kandinsky.event("progress", { files }); // the page shows it while the call still runs
  }
  return { words: total, files, cached: cache.size };
}

kandinsky.methods({ count });
