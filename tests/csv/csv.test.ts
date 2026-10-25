import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCsv, parseCsv, spreadsheetSafe } from "../../lib/csv/csv.ts";

const tricky = [
  ["plain", "with, comma", 'with "quotes"', "multi\nline", ""],
  ["", "trailing space ", " leading", "ünïcødé 🚀", '","'],
];

test("format then parse is the identity, LF or CRLF", () => {
  const text = formatCsv(tricky);
  assert.deepEqual(parseCsv(text), tricky);
  assert.deepEqual(parseCsv(text.replace(/\r\n/g, "\n")), tricky);
});

test("parses what Google exports: BOM, CRLF, quoted fields, no trailing newline", () => {
  const text =
    '\ufeffTimestamp,Team Name\r\n"11/7/2026 9:14:02","Smith, Jones"\r\n11/7/2026 9:15:30,"The ""Quoted"" Team"';
  assert.deepEqual(parseCsv(text), [
    ["Timestamp", "Team Name"],
    ["11/7/2026 9:14:02", "Smith, Jones"],
    ["11/7/2026 9:15:30", 'The "Quoted" Team'],
  ]);
});

test("an unterminated quote is an error, not silently swallowed data", () => {
  assert.throws(() => parseCsv('a,"b\nc'), /quoted field/);
});

test("spreadsheetSafe neutralises formula injection", () => {
  assert.equal(
    spreadsheetSafe('=HYPERLINK("http://x")'),
    `'=HYPERLINK("http://x")`,
  );
  assert.equal(spreadsheetSafe("+1"), "'+1");
  assert.equal(spreadsheetSafe("@sum"), "'@sum");
  assert.equal(spreadsheetSafe("Team = Good"), "Team = Good");
});
