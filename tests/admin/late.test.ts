import { test } from "node:test";
import assert from "node:assert/strict";
import {
  placeLateTeam,
  type LateAssignment,
  type LateInput,
} from "../../lib/admin/late.ts";

const T0 = Date.parse("2026-11-08T18:00:00Z"); // 10:00 PST
const slot = (i: number) => ({
  id: `s${i}`,
  index: i,
  startsAt: new Date(T0 + i * 7 * 60_000).toISOString(),
  endsAt: new Date(T0 + (i + 1) * 7 * 60_000).toISOString(),
});
const stations = [
  { id: "p0", label: "Station 1", sponsors: ["AWS"] },
  { id: "p1", label: "Station 2", sponsors: [] },
  { id: "p2", label: "Station 3", sponsors: ["A10"] },
  { id: "p3", label: "Station 4", sponsors: [] },
];

/** Every seat filled except `open` ("p1|s3", ...). */
function filled(nSlots: number, open: string[] = []): LateAssignment[] {
  const out: LateAssignment[] = [];
  let team = 0;
  for (let s = 0; s < nSlots; s++)
    for (const st of stations)
      if (!open.includes(`${st.id}|s${s}`))
        out.push({ teamId: `t${team++}`, stationId: st.id, slotId: `s${s}` });
  return out;
}
const base = (over: Partial<LateInput>): LateInput => ({
  stations,
  slots: Array.from({ length: 6 }, (_, i) => slot(i)),
  assignments: [],
  sponsors: [],
  now: T0 - 60 * 60_000,
  ...over,
});
const where = (p: ReturnType<typeof placeLateTeam>) =>
  p?.seats.map((s) => `${s.stationId}@${s.slotIndex}${s.slotId ? "" : "+"}`);

test("a full schedule grows by two slots at the end; nobody moves", () => {
  const p = placeLateTeam(base({ assignments: filled(6) }));
  assert.ok(p);
  assert.equal(p.appendedSlots, 2);
  assert.deepEqual(
    p.seats.map((s) => [s.slotIndex, s.slotId]),
    [
      [6, null],
      [7, null],
    ],
  );
  assert.equal(
    p.seats[1].startsAt,
    new Date(T0 + 7 * 7 * 60_000).toISOString(),
  );
});

test("one free seat plus one appended slot beats two appended", () => {
  const p = placeLateTeam(base({ assignments: filled(6, ["p1|s2"]) }));
  assert.deepEqual(where(p), ["p1@2", "p0@6+"]);
  assert.equal(p?.appendedSlots, 1);
});

test("free seats: the team's tracks are covered and the spacing kept", () => {
  // Free: p1 and p3 everywhere in slots 0-5, p0 at slot 1, p2 at slot 4.
  const open = [
    ...["p1", "p3"].flatMap((p) => [0, 1, 2, 3, 4, 5].map((s) => `${p}|s${s}`)),
    "p0|s1",
    "p2|s4",
  ];
  const p = placeLateTeam(
    base({ assignments: filled(6, open), sponsors: ["AWS", "A10"] }),
  );
  assert.deepEqual(where(p), ["p0@1", "p2@4"]); // the only AWS + A10 pair
  assert.deepEqual(p?.missing, []);
  assert.equal(p?.gap, 3);
});

test("without tracks it takes the least-used pair", () => {
  const open = [
    ...["p1", "p3"].flatMap((p) => [0, 1, 2, 3, 4, 5].map((s) => `${p}|s${s}`)),
    "p0|s1",
    "p2|s4",
  ];
  const p = placeLateTeam(base({ assignments: filled(6, open) }));
  assert.deepEqual(
    p?.seats.map((s) => s.stationId).sort(),
    ["p1", "p3"], // both empty stations
  );
  assert.ok(p!.gap >= 3);
});

test("slots that have started, or start within the notice, are never offered", () => {
  // It is 10:20; with 10 minutes' notice the first usable slot starts 10:35.
  const p = placeLateTeam(
    base({ now: T0 + 20 * 60_000, sponsors: ["AWS", "A10"] }),
  );
  assert.ok(p);
  for (const s of p.seats)
    assert.ok(Date.parse(s.startsAt) >= T0 + 30 * 60_000);
  assert.equal(p.seats[0].slotIndex, 5);
});

test("property: any random schedule gets two free, distinct, future seats", () => {
  let state = 42;
  const rand = () => (state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  for (let run = 0; run < 300; run++) {
    const nSlots = 3 + Math.floor(rand() * 13);
    const slots = Array.from({ length: nSlots }, (_, i) => slot(i));
    const assignments = filled(nSlots).filter(() => rand() < 0.85);
    const now = T0 + Math.floor(rand() * nSlots * 7) * 60_000 - 30 * 60_000;
    const sponsors = rand() < 0.5 ? ["AWS"] : [];
    const p = placeLateTeam({ stations, slots, assignments, sponsors, now });
    assert.ok(p, `run ${run}`);
    const [a, b] = p.seats;
    assert.notEqual(a.stationId, b.stationId);
    assert.notEqual(a.slotIndex, b.slotIndex);
    for (const s of p.seats) {
      assert.ok(Date.parse(s.startsAt) >= now + 10 * 60_000, `run ${run} past`);
      if (s.slotId)
        assert.ok(
          !assignments.some(
            (x) => x.stationId === s.stationId && x.slotId === s.slotId,
          ),
          `run ${run} seat taken`,
        );
      else assert.ok(s.slotIndex >= nSlots);
    }
    // An appended slot is never left as a hole.
    if (b.slotId === null && b.slotIndex === nSlots + 1)
      assert.equal(a.slotIndex, nSlots);
  }
});
