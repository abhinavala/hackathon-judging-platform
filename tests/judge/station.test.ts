import { test } from "node:test";
import assert from "node:assert/strict";
import { stationRows, type StationTeam } from "../../lib/judge/station.ts";

const at = (hhmm: string) => `2026-11-08T${hhmm}:00-08:00`;
// Out of order on purpose, with a gap between the second and third.
const TEAMS: StationTeam[] = [
  { team: "Later", startsAt: at("10:21"), endsAt: at("10:28") },
  { team: "First", startsAt: at("10:00"), endsAt: at("10:07") },
  { team: "Second", startsAt: at("10:07"), endsAt: at("10:14") },
];
const states = (now: string) =>
  stationRows(TEAMS, Date.parse(at(now))).map((r) => `${r.team}:${r.state}`);

test("teams come in time order", () => {
  assert.deepEqual(
    stationRows(TEAMS, 0).map((r) => r.team),
    ["First", "Second", "Later"],
  );
});

test("before judging: the first team is next, nothing is now", () => {
  assert.deepEqual(states("09:50"), [
    "First:next",
    "Second:later",
    "Later:later",
  ]);
});

test("during a slot: that team is now, the following one next", () => {
  assert.deepEqual(states("10:03"), [
    "First:now",
    "Second:next",
    "Later:later",
  ]);
});

test("a slot ends exactly when the next starts", () => {
  assert.deepEqual(states("10:07"), ["First:done", "Second:now", "Later:next"]);
});

test("in a gap: no now, the next team is next", () => {
  assert.deepEqual(states("10:16"), [
    "First:done",
    "Second:done",
    "Later:next",
  ]);
});

test("after the last: everything done", () => {
  assert.deepEqual(states("10:30"), [
    "First:done",
    "Second:done",
    "Later:done",
  ]);
});
