// The stress harness: invariants that must hold for every input, over
// randomised scenarios shaped like real events (2-4 sponsors, 40-70 teams,
// 14-24 judges, random track demand).

import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { PyRandom, solve, type Sponsor } from "../../lib/scheduler/index.ts";
import { makeTeams, panelDegrees, roster, scheduleErrors } from "./helpers.ts";

const SPONSORS = ["AWS", "A10", "GCP", "MSFT"];
const SCENARIOS = 250;

function scenario(rng: PyRandom, index: number) {
  const k = 2 + rng.randbelow(3);
  const sponsors = SPONSORS.slice(0, k);
  const nTeams = 40 + rng.randbelow(31);
  const nJudges = 14 + rng.randbelow(11);
  const probs: [Sponsor, number][] = sponsors.map((s) => [s, 0.1 + 0.5 * rng.random()]);
  const counts = sponsors.map(() => 1 + rng.randbelow(4));
  const none = Math.max(0, nJudges - counts.reduce((a, b) => a + b, 0));
  return {
    teamTracks: makeTeams(nTeams, probs, index),
    judges: roster([...sponsors.map((s, i): [Sponsor, number] => [s, counts[i]]), ["none", none]]),
    seed: index,
  };
}

test(`track-aware: ${SCENARIOS} randomised scenarios, every invariant, each under 1s`, () => {
  const rng = new PyRandom(424242);
  const times: number[] = [];
  for (let i = 0; i < SCENARIOS; i++) {
    const input = scenario(rng, i);
    const timed = () => {
      const started = performance.now();
      const result = solve(input);
      return { result, ms: performance.now() - started };
    };
    const first = timed();
    const r = first.result;
    // The < 1 s budget is about the algorithm, not the machine: node --test
    // runs test files in parallel, and a CPU-starved run once took 1.9 s for
    // a scenario that normally takes ~100 ms. A slow first run is re-timed
    // twice and the fastest counts; a genuinely slow algorithm is slow
    // every time.
    let ms = first.ms;
    if (ms >= 1000) ms = Math.min(ms, timed().ms, timed().ms);
    times.push(ms);
    const label = `scenario ${i} (${input.teamTracks.length} teams, ${input.judges.length} judges)`;

    // every team exactly twice, at two distinct panels, in two distinct
    // slots; no panel holds two teams in one slot
    assert.deepEqual(scheduleErrors(r, input.teamTracks.length), [], label);
    // nSlots covers the busiest panel (derived, never assumed)
    const degree = panelDegrees(r);
    assert.ok(r.nSlots >= Math.max(...degree), `${label}: nSlots below max degree`);
    assert.deepEqual(r.stats.teamsPerPanel, [Math.min(...degree), Math.max(...degree)], label);
    // every presentation is accounted for
    assert.equal(r.slotOf.size, 2 * input.teamTracks.length, label);
    assert.ok(ms < 1000, `${label} took ${ms.toFixed(0)} ms`);
  }
  times.sort((a, b) => a - b);
  console.log(
    `    ${SCENARIOS} scenarios: median ${times[SCENARIOS >> 1].toFixed(0)} ms, ` +
      `slowest ${times[SCENARIOS - 1].toFixed(0)} ms`,
  );
});

// Panel balance (max - min <= 1) is guaranteed by the unconstrained pairing,
// not by the track-aware one: there the Python ranks coverage above balance,
// and over 600 randomised scenarios its spread ranged from 0 to 17 (the
// schedules all valid). So balance is asserted where the reference
// guarantees it: no tracks, any roster size.
test("no tracks: panel workloads differ by at most one", () => {
  const rng = new PyRandom(99);
  for (let i = 0; i < 100; i++) {
    const nTeams = 40 + rng.randbelow(31);
    const nJudges = 14 + rng.randbelow(11);
    const r = solve({
      teamTracks: Array.from({ length: nTeams }, () => new Set<Sponsor>()),
      judges: roster([["none", nJudges]]),
      seed: i,
    });
    const [lo, hi] = r.stats.teamsPerPanel;
    assert.ok(hi - lo <= 1, `${nTeams} teams, ${nJudges} judges: ${lo}-${hi}`);
    assert.deepEqual(scheduleErrors(r, nTeams), []);
  }
});

// Fixed panels: solve() with the panels a normal run chose reproduces that
// run (same Stage 1-3 code, one candidate instead of ~70).
test("fixed panels: re-solving with the winning composition reproduces the schedule", () => {
  const rng = new PyRandom(2026);
  for (let i = 0; i < 40; i++) {
    const input = scenario(rng, i);
    const auto = solve(input);
    const fixed = solve({ ...input, panels: auto.panels });
    assert.equal(fixed.stats.winningStrategy, "fixed");
    assert.deepEqual(fixed.assignments, auto.assignments, `scenario ${i}`);
    assert.deepEqual([...fixed.slotOf], [...auto.slotOf], `scenario ${i}`);
    assert.equal(fixed.nSlots, auto.nSlots);
  }
});

test("fixed panels: a judge on two panels, or a missing judge, is refused", () => {
  const judges = roster([["AWS", 2], ["none", 6]]);
  const teamTracks = Array.from({ length: 20 }, () => new Set<Sponsor>());
  assert.throws(() => solve({ teamTracks, judges, panels: [[0, 1], [1, 2]] }), /two panels/);
  assert.throws(() => solve({ teamTracks, judges, panels: [[0, 9], [2, 3]] }), /no judge 9/);
});
