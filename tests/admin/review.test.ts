import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alreadyAccepted,
  reviewSchedule,
  type ReviewInput,
  type ReviewWarning,
} from "../../lib/admin/review.ts";
import {
  clock,
  utcToZonedLocal,
  zonedLocalToUtc,
} from "../../lib/admin/time.ts";
import { solve, type Sponsor } from "../../lib/scheduler/index.ts";

const LA = "America/Los_Angeles";

/** A real solve() on the event's configuration, shaped as the screen loads it. */
function eventInput(): ReviewInput {
  const sponsorsOf: Sponsor[][] = [
    ...Array.from({ length: 12 }, () => ["AWS", "A10"]),
    ...Array.from({ length: 24 }, () => ["AWS"]),
    ...Array.from({ length: 12 }, () => ["A10"]),
    ...Array.from({ length: 12 }, () => []),
  ];
  const judges = [
    ...Array(4).fill("AWS"),
    ...Array(3).fill("A10"),
    ...Array(9).fill(null),
  ];
  const r = solve({
    teamTracks: sponsorsOf.map((s) => new Set(s)),
    judges,
    seed: 0,
  });
  const start = Date.parse("2026-11-08T18:00:00Z");
  return {
    teams: sponsorsOf.map((sponsors, i) => ({
      id: `t${i}`,
      name: `Team ${i + 1}`,
      sponsors,
    })),
    stations: r.panelSponsors.map((s, p) => ({
      id: `p${p}`,
      label: `Station ${p + 1}`,
      sponsors: [...s],
    })),
    slots: Array.from({ length: r.nSlots }, (_, i) => ({
      id: `s${i}`,
      index: i,
      startsAt: new Date(start + i * 7 * 60_000).toISOString(),
    })),
    assignments: [...r.slotOf].map(([k, slot]) => {
      const [t, p] = k.split(":");
      return { teamId: `t${t}`, stationId: `p${p}`, slotId: `s${slot}` };
    }),
  };
}

test("the real configuration: clean review, numbers match the solver", () => {
  const review = reviewSchedule(eventInput());
  assert.deepEqual(review.invalid, []);
  assert.equal(review.coverage.fullyCovered, 60);
  assert.equal(review.coverage.seatsMet, 60);
  assert.equal(review.coverage.seatsWanted, 60);
  assert.equal(review.spacing.minGap, 5);
  assert.deepEqual(
    review.capacity.perStation.map((p) => p.teams),
    Array(8).fill(15),
  );
  assert.equal(review.capacity.unfilled, 0);
  assert.ok(review.overlap.maxShared <= 5);
  assert.deepEqual(
    review.warnings.map((w) => w.id),
    [],
  );
});

test("uncovered teams are listed by name with what they miss", () => {
  const input = eventInput();
  input.stations = input.stations.map((s) => ({
    ...s,
    sponsors: s.sponsors.filter((x) => x !== "A10"),
  }));
  const review = reviewSchedule(input);
  const w = review.warnings.find((x) => x.id === "uncovered")!;
  assert.equal(review.coverage.uncovered.length, 24);
  assert.match(w.title, /24 teams not fully track-covered/);
  assert.ok(w.detail.includes("Team 1: no A10 judge"));
});

test("tight spacing, an empty seat and excluded teams are each flagged", () => {
  const input = eventInput();
  // Put Team 1's second presentation in the slot right after its first, at
  // the same station it already uses for that second presentation, evicting
  // whoever sat there (which leaves that team one presentation short, so
  // drop that team from the review entirely and count its seat as empty).
  const [first, second] = input.assignments
    .filter((a) => a.teamId === "t0")
    .sort((x, y) => Number(x.slotId.slice(1)) - Number(y.slotId.slice(1)));
  const next = `s${Number(first.slotId.slice(1)) + 1}`;
  const evicted = input.assignments.find(
    (a) => a.stationId === second.stationId && a.slotId === next,
  );
  if (evicted) {
    input.assignments = input.assignments.filter(
      (a) => a.teamId !== evicted.teamId,
    );
    input.teams = input.teams.filter((t) => t.id !== evicted.teamId);
  }
  second.slotId = next;
  input.excludedTeams = [{ id: "late", name: "Late Team" }];

  const review = reviewSchedule(input);
  const ids = review.warnings.map((w) => w.id);
  assert.deepEqual(review.invalid, []);
  assert.ok(
    review.spacing.tight.some((t) => t.name === "Team 1" && t.gap === 1),
  );
  assert.ok(ids.includes("tight-spacing"));
  assert.ok(ids.includes("unfilled-slots"));
  assert.ok(review.capacity.unfilled >= 1);
  assert.ok(ids.includes("excluded-teams"));
  assert.ok(
    review.warnings
      .find((w) => w.id === "excluded-teams")!
      .detail.includes("Late Team"),
  );
});

test("overlap above 5 shared teams is a warning", () => {
  const input: ReviewInput = {
    teams: Array.from({ length: 6 }, (_, i) => ({
      id: `t${i}`,
      name: `T${i}`,
      sponsors: [],
    })),
    stations: [
      { id: "a", label: "A", sponsors: [] },
      { id: "b", label: "B", sponsors: [] },
    ],
    slots: Array.from({ length: 12 }, (_, i) => ({
      id: `s${i}`,
      index: i,
      startsAt: `2026-11-08T18:${String(i).padStart(2, "0")}:00Z`,
    })),
    assignments: Array.from({ length: 6 }, (_, i) => [
      { teamId: `t${i}`, stationId: "a", slotId: `s${i}` },
      { teamId: `t${i}`, stationId: "b", slotId: `s${i + 6}` },
    ]).flat(),
  };
  const review = reviewSchedule(input);
  assert.deepEqual(review.overlap.heavy, [{ a: "A", b: "B", shared: 6 }]);
  assert.ok(review.warnings.some((w) => w.id === "heavy-overlap"));
});

test("diff against the published version names moved, added and removed teams", () => {
  const published = eventInput();
  const draft = eventInput();
  // Swap two teams' first presentations in the draft.
  const a = draft.assignments.find((x) => x.teamId === "t0")!;
  const b = draft.assignments.find(
    (x) =>
      x.teamId === "t1" && x.slotId !== a.slotId && x.stationId !== a.stationId,
  )!;
  [a.slotId, b.slotId] = [b.slotId, a.slotId];
  [a.stationId, b.stationId] = [b.stationId, a.stationId];
  draft.published = {
    version: 1,
    slots: published.slots,
    stations: published.stations,
    assignments: published.assignments.filter((x) => x.teamId !== "t59"),
  };
  const review = reviewSchedule(draft);
  assert.equal(review.diff!.againstVersion, 1);
  assert.deepEqual(review.diff!.moved.map((m) => m.name).sort(), [
    "Team 1",
    "Team 2",
  ]);
  assert.deepEqual(
    review.diff!.added.map((x) => x.name),
    ["Team 60"],
  );
  const w = review.warnings.find((x) => x.id === "changes-vs-published")!;
  assert.match(w.title, /v1: 2 moved, 1 added, 0 removed/);
});

test("a dropped team is named in the diff, with the seats it gave up", () => {
  const published = eventInput();
  const draft = eventInput();
  draft.teams = draft.teams.filter((t) => t.id !== "t5");
  draft.assignments = draft.assignments.filter((x) => x.teamId !== "t5");
  draft.published = {
    version: 3,
    slots: published.slots,
    stations: published.stations,
    assignments: published.assignments,
    teams: published.teams,
  };
  const review = reviewSchedule(draft);
  assert.deepEqual(review.invalid, []);
  assert.equal(review.diff!.removed.length, 1);
  assert.equal(review.diff!.removed[0].name, "Team 6");
  assert.equal(review.diff!.removed[0].from.length, 2);
  assert.deepEqual(review.diff!.moved, []);
  const w = review.warnings.find((x) => x.id === "changes-vs-published")!;
  assert.ok(w.detail.includes("Team 6: no longer scheduled"));
});

test("a draft older than the published version can't be published", () => {
  const old = reviewSchedule({ ...eventInput(), supersededBy: 4 });
  assert.equal(old.invalid.length, 1);
  assert.match(old.invalid[0], /older than the published v4/);
  assert.deepEqual(
    reviewSchedule({ ...eventInput(), supersededBy: null }).invalid,
    [],
  );
});

test("a late change drafted against an older version can't be published", () => {
  const input = eventInput();
  const pub = {
    version: 4,
    slots: input.slots,
    stations: input.stations,
    assignments: input.assignments,
  };
  const stale = reviewSchedule({ ...input, basedOnVersion: 3, published: pub });
  assert.equal(stale.invalid.length, 1);
  assert.match(stale.invalid[0], /made to v3, but v4 is published now/);
  assert.deepEqual(
    reviewSchedule({ ...input, basedOnVersion: 4, published: pub }).invalid,
    [],
  );
});

test("a schedule that doesn't start at the event's judging start is flagged", () => {
  const onTime = reviewSchedule({
    ...eventInput(),
    judgingStart: { startsAt: "2026-11-08T18:00:00Z", timezone: LA },
  });
  assert.equal(
    onTime.warnings.some((w) => w.id === "start-differs"),
    false,
  );
  const late = reviewSchedule({
    ...eventInput(),
    judgingStart: { startsAt: "2026-11-08T17:30:00Z", timezone: LA },
  });
  const w = late.warnings.find((x) => x.id === "start-differs");
  assert.ok(w);
  assert.equal(
    w.title,
    "Starts at 10:00 AM, not the event's judging start (9:30 AM)",
  );
  // No judging start set: nothing to compare against.
  assert.equal(
    reviewSchedule({ ...eventInput(), judgingStart: null }).warnings.some(
      (x) => x.id === "start-differs",
    ),
    false,
  );
});

test("structural errors are reported as invalid, not warnings", () => {
  const input = eventInput();
  input.assignments = input.assignments.filter(
    (a) =>
      a.teamId !== "t3" ||
      a.slotId === input.assignments.find((x) => x.teamId === "t3")!.slotId,
  );
  const review = reviewSchedule(input);
  assert.ok(
    review.invalid.some((m) => m.includes("Team 4 has 1 presentations")),
  );
});

test("zoned times: November 8 2026 10:00 in Los Angeles is 18:00 UTC (PST)", () => {
  assert.equal(
    zonedLocalToUtc("2026-11-08T10:00", LA).toISOString(),
    "2026-11-08T18:00:00.000Z",
  );
  assert.equal(utcToZonedLocal("2026-11-08T18:00:00Z", LA), "2026-11-08T10:00");
  assert.equal(clock("2026-11-08T18:07:00Z", LA), "10:07 AM");
  // Before the DST change (PDT, UTC-7) and the round trip across it.
  assert.equal(
    zonedLocalToUtc("2026-10-31T10:00", LA).toISOString(),
    "2026-10-31T17:00:00.000Z",
  );
  assert.equal(
    utcToZonedLocal(zonedLocalToUtc("2026-11-01T12:30", LA), LA),
    "2026-11-01T12:30",
  );
});

test("only warnings identical to the published version's are already accepted", () => {
  const w = (
    id: ReviewWarning["id"],
    title: string,
    ...detail: string[]
  ): ReviewWarning => ({
    id,
    title,
    detail,
  });
  const published = [
    w(
      "tight-spacing",
      "1 team with fewer than 3 slots between presentations",
      "Late Owls: 1 slot apart",
    ),
    w(
      "unfilled-slots",
      "14 empty seats across stations",
      "Judges will have idle slots.",
    ),
    w(
      "heavy-overlap",
      "1 station pair share more than 5 teams",
      "Station 1 and Station 7: 6 teams in common",
    ),
  ];
  const draft = [
    // unchanged: accepted
    w(
      "tight-spacing",
      "1 team with fewer than 3 slots between presentations",
      "Late Owls: 1 slot apart",
    ),
    // got worse (more idle seats): new
    w(
      "unfilled-slots",
      "16 empty seats across stations",
      "Judges will have idle slots.",
    ),
    // same title, but a detail line changed: new
    w(
      "heavy-overlap",
      "1 station pair share more than 5 teams",
      "Station 1 and Station 7: 7 teams in common",
    ),
    // not there before: new
    w(
      "changes-vs-published",
      "Changes from the published v3: 0 moved, 0 added, 1 removed",
    ),
  ];
  assert.deepEqual([...alreadyAccepted(draft, published)], ["tight-spacing"]);
  assert.deepEqual([...alreadyAccepted(draft, [])], []);
});
