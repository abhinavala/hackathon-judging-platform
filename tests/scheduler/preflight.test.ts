// Pre-flight capacity check: roster-only, runs the moment judges are entered.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  coverageCapacity,
  preflight,
  PyRandom,
  slotsFor,
  solve,
  type Sponsor,
} from "../../lib/scheduler/index.ts";
import { goldens, makeTeams, roster } from "./helpers.ts";

const teams = (spec: [Sponsor[], number][]) =>
  spec.flatMap(([tracks, n]) => Array.from({ length: n }, () => new Set(tracks)));

test("coverageCapacity matches stage0.coverage_capacity row for row", () => {
  for (const c of goldens.capacity) {
    const rows = coverageCapacity(c.judges, c.teamTracks.map((t) => new Set(t)), c.nSlots);
    assert.deepEqual(
      rows.map((r) => ({
        sponsor: r.sponsor,
        judges: r.judges,
        teams_wanting: r.teamsWanting,
        capacity: r.capacity,
        ok: r.ok,
        min_judges: r.minJudges,
      })),
      c.rows,
    );
  }
});

test("the spec's example: 36 AWS teams, 2 AWS judges x 15 slots", () => {
  // 60 teams on 16 judges = 8 panels x 15 slots.
  const p = preflight(
    roster([["AWS", 2], ["A10", 3], ["none", 11]]),
    teams([[["AWS"], 36], [["A10"], 24]]),
  );
  assert.equal(p.nSlots, 15);
  assert.equal(p.warnings.length, 1);
  const [w] = p.warnings;
  assert.deepEqual(
    { sponsor: w.sponsor, capacity: w.capacity, uncoverable: w.uncoverable, add: w.judgesToAdd },
    { sponsor: "AWS", capacity: 30, uncoverable: 6, add: 1 },
  );
  assert.equal(
    w.message,
    "AWS: 36 teams want this track, but 2 AWS judges x 15 slots = 30 sightings. " +
      "6 teams cannot be covered. Add 1 AWS judge.",
  );
});

test("the real configuration needs nothing", () => {
  const p = preflight(
    roster([["AWS", 4], ["A10", 3], ["none", 9]]),
    teams([[["AWS", "A10"], 12], [["AWS"], 24], [["A10"], 12], [[], 12]]),
  );
  assert.deepEqual(p.warnings, []);
  assert.equal(p.oddJudgeCount, false);
});

test("the recommendation accounts for slots shrinking as panels are added", () => {
  // 60 teams, 1 GCP judge among 16 (8 panels x 15 slots), 45 GCP teams.
  // Naively ceil(45 / 15) = 3 GCP judges, i.e. add 2. But 18 judges make 9
  // panels and only 14 slots: 3 x 14 = 42 < 45. Adding 3 (19 judges, still
  // 9 panels x 14 slots) gives 4 x 14 = 56.
  const p = preflight(roster([["GCP", 1], ["none", 15]]), teams([[["GCP"], 45], [[], 15]]));
  const [w] = p.warnings;
  assert.equal(p.rows[0].minJudges - p.rows[0].judges, 2, "the naive answer");
  assert.equal(w.judgesToAdd, 3);
  assert.ok((1 + 2) * slotsFor(60, 18) < 45, "adding 2 really is not enough");
  assert.ok((1 + 3) * slotsFor(60, 19) >= 45);
});

test("an odd judge count is flagged (one judge sits out)", () => {
  assert.equal(preflight(roster([["AWS", 4], ["none", 11]]), teams([[["AWS"], 30]])).oddJudgeCount, true);
});

test("solve() never beats the bound: a flagged shortfall leaves at least that many uncovered", () => {
  const rng = new PyRandom(31337);
  let flagged = 0;
  for (let i = 0; i < 120; i++) {
    const sponsors = ["AWS", "A10", "GCP"].slice(0, 1 + rng.randbelow(3));
    const nTeams = 40 + rng.randbelow(31);
    const probs: [Sponsor, number][] = sponsors.map((s) => [s, 0.3 + 0.6 * rng.random()]);
    const teamTracks = makeTeams(nTeams, probs, i);
    const judges = roster([
      ...sponsors.map((s): [Sponsor, number] => [s, rng.randbelow(3)]),
      ["none", 12 + rng.randbelow(8)],
    ]);
    const p = preflight(judges, teamTracks);
    const r = solve({ teamTracks, judges, seed: i });
    // Only meaningful when the solver uses the slot count the check assumed.
    if (r.nSlots !== p.nSlots) continue;
    for (const w of p.warnings) {
      flagged++;
      const missing = r.stats.uncoveredTeams.filter((u) => u.missing.includes(w.sponsor)).length;
      assert.ok(missing >= w.uncoverable, `scenario ${i}: ${w.message} but only ${missing} uncovered`);
    }
  }
  assert.ok(flagged > 20, `exercised ${flagged} flagged sponsors`);
});
