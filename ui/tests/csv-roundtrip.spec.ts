import { test, expect } from "@playwright/test";
import { parseSheet, toNum } from "../src/lib/csv/parse";
import { compare, compile, stats } from "../src/lib/csv/filter";
import { rewriteRecord, writeSheet } from "../src/lib/csv/write";

// A table read and written back (lib/csv/parse.ts, write.ts): what an edited row must keep so the next read gives the
// same cells. Pure.

test("a quoted field keeps its own leading space where the file writes one after each delimiter", () => {
  const s = parseSheet('name, note\nAlice, "  indented"\nBob, plain\n', "a.csv");
  expect(s.layout.spaceAfter).toBe(true);
  expect(s.rows).toEqual([["Alice", "  indented"], ["Bob", "plain"]]);
});

test("an edited first cell that starts with the comment marker is quoted, so it reads back as a row", () => {
  const s = parseSheet("# made by a run\nx,y\n1,2\n", "r.csv");
  expect(s.layout.comment).toBe("#");
  s.rows[0] = ["#3", "4"];
  s.raw[0] = null;
  const back = parseSheet(writeSheet(s), "r.csv");
  expect(back.rows).toEqual([["#3", "4"]]);
  expect(back.comments.map((c) => c.text)).toEqual(["# made by a run"]);
});

test("blank records and mixed endings survive a cell edit, including newlines inside a quoted cell", () => {
  const text = '# a comment\r\nname,note\n \r\nAlice,"line one\nline two"\r\nBob,plain\rCarol,last\n\n';
  const sheet = parseSheet(text, "people.csv");
  expect(sheet.rows).toEqual([["Alice", "line one\nline two"], ["Bob", "plain"], ["Carol", "last"]]);
  expect(writeSheet(sheet)).toBe(text);

  sheet.rows[1][1] = "edited";
  sheet.raw[1] = rewriteRecord(sheet.raw[1]);
  expect(writeSheet(sheet)).toBe(text.replace("Bob,plain", "Bob,edited"));
});

test("blank lines before data do not replace a comment header", () => {
  const text = "# U  E\r\n\n  1  2\r  3  4\n  ";
  const sheet = parseSheet(text, "run.dat");
  expect(sheet.headerSource).toBe("comment");
  expect(sheet.header).toEqual(["U", "E"]);
  expect(sheet.rows).toEqual([["1", "2"], ["3", "4"]]);
  expect(writeSheet(sheet)).toBe(text);
});

test("a cell's number is the one it shows: Fortran exponents, inf and nan; a spread of large close values", () => {
  expect([toNum("1.5D3"), toNum(" -2d-1 "), toNum("-inf"), toNum("Infinity"), toNum("12abc")]).toEqual([1500, -0.2, -Infinity, Infinity, NaN]);
  expect(Number.isNaN(toNum("nan"))).toBe(true);
  expect(compile(">1000")!("1.5D3"), "a filter reads the exponent").toBe(true);
  expect(["2d0", "1d1", "inf", "3"].sort((a, b) => compare(a, b, true))).toEqual(["2d0", "3", "1d1", "inf"]);
  const s = stats(["1700000000.1", "1700000000.2", "1700000000.3"]).num!;
  expect(s.sd).toBeCloseTo(0.1, 6);
});
