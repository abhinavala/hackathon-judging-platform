import { test } from "node:test";
import assert from "node:assert/strict";
import { coverageLost } from "../../lib/admin/coverage.ts";

const TEAMS = [
  { name: "Mosaic", sponsors: ["AWS"] },
  { name: "Beacon", sponsors: ["AWS", "A10"] },
  { name: "Unmute", sponsors: [] },
  { name: "Anchor", sponsors: ["A10"] },
];

test("swapping an AWS judge for an alum loses AWS for the AWS teams there", () => {
  assert.deepEqual(coverageLost(TEAMS, ["AWS", "A10"], ["A10"]), [
    { sponsor: "AWS", teams: ["Beacon", "Mosaic"] },
  ]);
});

test("like for like, or a sponsor nobody here chose, loses nothing", () => {
  assert.deepEqual(coverageLost(TEAMS, ["AWS"], ["AWS"]), []);
  assert.deepEqual(
    coverageLost([{ name: "X", sponsors: [] }], ["AWS"], []),
    [],
  );
});

test("adding a sponsor never warns", () => {
  assert.deepEqual(coverageLost(TEAMS, [], ["AWS"]), []);
});
