// The dictionary's stems: the same words as the app's own parse, and a flagless word list read in one pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import "kandinsky-helper/testing";
import { cachedDicStems } from "./helper";
import { dicStems } from "../../../../ui/src/lib/editor/dictionaries";

test("stems as the app reads them: flags, spaces and names left out", () => {
  const dic = "7\nwalk/SDG\nrun\r\nété/S\nParis/M\nhello world\nwell-known\nnaïve\u00a0x\n";
  assert.deepEqual(cachedDicStems("mixed", dic), dicStems(dic));
  assert.deepEqual(cachedDicStems("mixed", dic), ["hello", "naïve", "run", "walk", "well-known", "été"]);
});

test("a long word list without flags is read line by line, not searched to its end for each word", () => {
  const n = 100_000;
  const words = Array.from({ length: n }, (_, i) => `w${i.toString(26).replace(/./g, (c) => String.fromCharCode(97 + parseInt(c, 26)))}x`);
  const dic = `${n}\n${words.join("\n")}\nlast/S\n`;
  const t = performance.now();
  const stems = cachedDicStems("flagless", dic);
  assert.ok(performance.now() - t < 2000, "linear in the file's size");
  assert.equal(stems.length, n + 1);
  assert.ok(stems.includes("last"));
});
