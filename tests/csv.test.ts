import test from "node:test";
import assert from "node:assert/strict";
import { cell, toCsv, minutes } from "../lib/reports/csv.ts";

test("quotes commas, quotes and newlines", () => {
  assert.equal(cell('a,b'), '"a,b"'); assert.equal(cell('say "hi"'), '"say ""hi"""'); assert.equal(cell("a\nb"), '"a\nb"');
});
test("neutralises spreadsheet formulas", () => {
  for (const f of ["=1+1", "+cmd", "-2", "@SUM(A1)"]) assert.ok(cell(f).startsWith("'"), f);
  assert.equal(cell("Amina"), "Amina");
});
test("builds rows with a header and BOM", () => {
  const out = toCsv([{ n: "Wanjiru", s: "late" }], [{ key: "n", header: "Name" }, { key: "s", header: "Status" }]);
  assert.equal(out, "﻿Name,Status\r\nWanjiru,late\r\n");
});
test("null and undefined become empty cells; minutes rounds", () => {
  assert.equal(cell(null), ""); assert.equal(cell(undefined), ""); assert.equal(minutes(89), 1);
});
