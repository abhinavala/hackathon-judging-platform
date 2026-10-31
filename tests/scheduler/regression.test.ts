// Fixed-seed regression on the real configuration: 60 teams, 4 AWS + 3 A10 +
// 9 unaffiliated judges (8 panels, 15 slots).
//
// The spec's "54/54 track-seats" comes from a probabilistic draw
// (make_teams(60, {AWS: 0.6, A10: 0.4}, seed=1) gives 54 seats). The explicit
// counts the spec names (AWS 36, A10 24, 12 wanting both, 12 neither, which
// is also the seeded event) give 60 seats. Both are asserted, each against
// the Python's actual output and the spec's targets.

import { test } from "node:test";
import assert from "node:assert/strict";
import { solve } from "../../lib/scheduler/index.ts";
import { goldens, panelDegrees, scheduleErrors } from "./helpers.ts";

for (const [name, g] of Object.entries(goldens.regression)) {
  test(`real configuration (${name}) matches the Python`, () => {
    const teamTracks = g.teamTracks.map((t) => new Set(t));
    const r = solve({ teamTracks, judges: g.judges, seed: 0 });
    const degree = panelDegrees(r);

    assert.deepEqual(scheduleErrors(r, 60), []);
    assert.equal(r.stats.teamsFullyCovered, g.full);
    assert.equal(r.stats.trackSeatsMet, g.seats);
    assert.equal(r.stats.trackSeatsWanted, g.wanted);
    assert.equal(r.nSlots, g.nSlots);
    assert.equal(r.stats.gapRange[0], g.minGap);
    assert.deepEqual([Math.min(...degree), Math.max(...degree)], g.degree);
    assert.equal(r.stats.winningStrategy, g.winner);

    // and the spec's targets
    assert.equal(r.stats.teamsFullyCovered, 60, "60/60 teams fully covered");
    assert.equal(r.stats.trackSeatsMet, r.stats.trackSeatsWanted, "every track-seat met");
    assert.equal(r.nSlots, 15, "15 slots");
    assert.ok(r.stats.gapRange[0] >= 4, `minimum gap ${r.stats.gapRange[0]} >= 4`);
    assert.deepEqual(r.stats.uncoveredTeams, []);
  });
}

test("the probabilistic configuration is the spec's 54/54", () => {
  const g = goldens.regression["make-teams-seed-1"];
  assert.equal(g.seats, 54);
  assert.equal(g.wanted, 54);
});
