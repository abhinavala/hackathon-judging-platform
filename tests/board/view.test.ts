import { test } from "node:test";
import assert from "node:assert/strict";
import { boardMoment, fromRpc, type BoardView } from "../../lib/board/view.ts";

const LA = "America/Los_Angeles";
const at = (hhmm: string) => Date.parse(`2026-11-08T${hhmm}:00-08:00`);
const utc = (hhmm: string) =>
  new Date(Date.parse(`2026-11-08T${hhmm}:00-08:00`)).toISOString();

// Three 7-minute slots from 10:00 PST; two stations; one empty seat.
const RPC = {
  found: true,
  event: {
    name: "AWS x A10 Hack",
    slug: "aws-a10-2026",
    timezone: LA,
    judging_starts_at: utc("10:00"),
    help_location: "the check-in table",
  },
  published: { version: 3, published_at: utc("09:30") },
  stations: [
    { label: "Station 1", location: "Blue section" },
    { label: "Station 2", location: null },
  ],
  slots: [
    { index: 2, starts_at: utc("10:14"), ends_at: utc("10:21") },
    { index: 0, starts_at: utc("10:00"), ends_at: utc("10:07") },
    { index: 1, starts_at: utc("10:07"), ends_at: utc("10:14") },
  ],
  cells: [
    { slot_index: 0, station: "Station 1", team: "ShelterLink" },
    { slot_index: 0, station: "Station 2", team: "KeyJam" },
    { slot_index: 1, station: "Station 1", team: "Orbit" },
    { slot_index: 2, station: "Station 2", team: "ShelterLink" },
  ],
  announcements: [],
};
const view = fromRpc(RPC) as Extract<BoardView, { found: true }>;

const teams = (m: ReturnType<typeof boardMoment>) =>
  "row" in m ? m.row.cells.map((c) => c.team) : null;

test("fromRpc maps the RPC's JSON", () => {
  assert.equal(view.event.helpLocation, "the check-in table");
  assert.equal(view.published?.version, 3);
  assert.equal(view.cells.length, 4);
  assert.deepEqual(fromRpc(null), { found: false });
});

test("before judging, the first slot leads, with the one after it", () => {
  const m = boardMoment(view, at("09:48"));
  assert.equal(m.kind, "upcoming");
  if (m.kind !== "upcoming") return;
  assert.equal(m.first, true);
  assert.equal(m.minutes, 12);
  assert.deepEqual(teams(m), ["ShelterLink", "KeyJam"]);
  assert.deepEqual(
    m.after?.cells.map((c) => c.team),
    ["Orbit", null],
  );
});

test("during a slot it is NOW, in slot order regardless of input order", () => {
  const m = boardMoment(view, at("10:08"));
  assert.equal(m.kind, "now");
  if (m.kind !== "now") return;
  assert.equal(m.row.slot.index, 1);
  assert.equal(m.minutesLeft, 6);
  assert.deepEqual(teams(m), ["Orbit", null]); // the empty seat is null
  assert.equal(m.row.cells[0].location, "Blue section");
  assert.equal(m.next?.slot.index, 2);
});

test("the last slot has no next row; after it judging is done", () => {
  const last = boardMoment(view, at("10:20"));
  assert.equal(last.kind, "now");
  if (last.kind === "now") assert.equal(last.next, null);
  assert.deepEqual(boardMoment(view, at("10:21")), {
    kind: "done",
    version: 3,
  });
});

test("a gap between slots shows the next one as up next, not first", () => {
  const gapped = {
    ...view,
    slots: view.slots.map((s) =>
      s.index === 2
        ? { ...s, startsAt: utc("10:30"), endsAt: utc("10:37") }
        : s,
    ),
  };
  const m = boardMoment(gapped, at("10:20"));
  assert.equal(m.kind, "upcoming");
  if (m.kind === "upcoming") {
    assert.equal(m.first, false);
    assert.equal(m.minutes, 10);
  }
});

test("unpublished and unknown events are distinct, never blank", () => {
  assert.deepEqual(boardMoment({ found: false }, at("10:00")), {
    kind: "not-found",
  });
  assert.deepEqual(boardMoment({ ...view, published: null }, at("09:00")), {
    kind: "unpublished",
    judgingStartsAt: utc("10:00"),
  });
  assert.deepEqual(boardMoment({ ...view, slots: [] }, at("09:00")), {
    kind: "empty",
    version: 3,
  });
});
