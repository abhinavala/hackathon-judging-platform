// The port against the Python reference, output for output. goldens.json is
// produced by tests/scheduler/make_goldens.py running scheduler/*.py
// unmodified. "If the TypeScript disagrees with the Python, the TypeScript is
// wrong", with one documented exception: the Python's edge_color bug (see
// lib/scheduler/color.ts), where the Python's output is itself invalid.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assignPanelPairs,
  edgeColor,
  improveSpacing,
  PyRandom,
  pyRound,
  pySum,
  solve,
  verify,
} from "../../lib/scheduler/index.ts";
import { goldens, makeTeams } from "./helpers.ts";

const flatten = (m: Map<number, number>, nPanels: number) =>
  [...m].flatMap(([key, c]) => [Math.floor(key / nPanels), key % nPanels, c]);

test("PyRandom.random() matches CPython's random.Random", () => {
  for (const { seed, values } of goldens.numerics.random) {
    const r = new PyRandom(seed);
    assert.deepEqual(values.map(() => r.random()), values, `seed ${seed}`);
  }
});

test("PyRandom.shuffle() matches CPython's random.shuffle", () => {
  for (const { seed, result } of goldens.numerics.shuffle) {
    const xs = Array.from({ length: result.length }, (_, i) => i);
    new PyRandom(seed).shuffle(xs);
    assert.deepEqual(xs, result, `seed ${seed}`);
  }
});

test("pyRound(x, 3) matches CPython's round(), ties to even on the exact value", () => {
  for (const [x, expected] of goldens.numerics.round) {
    assert.equal(pyRound(x, 3), expected, `round(${x}, 3)`);
  }
});

test("pySum() matches CPython's compensated sum()", () => {
  for (const [values, expected] of goldens.numerics.sum) {
    assert.equal(pySum(values), expected, `sum(${JSON.stringify(values)})`);
  }
});

test("makeTeams matches pipeline.make_teams", () => {
  const { n, probs, seed, teams } = goldens.numerics.makeTeams;
  assert.deepEqual(makeTeams(n, probs, seed).map((s) => [...s].sort()), teams);
});

for (const [id, g] of Object.entries(goldens.track)) {
  test(`solve() reproduces the Python exactly: ${id}`, () => {
    const seed = Number(id.split("-")[1]);
    const r = solve({ teamTracks: g.teamTracks.map((t) => new Set(t)), judges: g.judges, seed });
    assert.equal(r.stats.winningStrategy, g.winner, "winning strategy");
    assert.deepEqual(r.panels, g.panels, "panels");
    assert.deepEqual(r.assignments, g.assignment, "team -> panel pairs");
    assert.equal(r.nSlots, g.nSlots, "slot count");
    const slots = [...r.slotOf].flatMap(([k, c]) => [...k.split(":").map(Number), c]);
    assert.deepEqual(slots, g.colorOf, "slot of every presentation");
    assert.equal(r.stats.teamsFullyCovered, g.full);
    assert.equal(r.stats.trackSeatsMet, g.seats);
    assert.equal(r.stats.trackSeatsWanted, g.wanted);
  });
}

for (const [id, g] of Object.entries(goldens.plain)) {
  const [, size, s] = id.split("-");
  const [T, D] = size.split("x").map(Number);
  const seed = Number(s.slice(1));
  test(`unconstrained pipeline vs Python: ${id}`, () => {
    const { assignment } = assignPanelPairs(T, D, seed);
    assert.deepEqual(assignment, g.pairing, "panel pairs");
    const edges: [number, number][] = assignment.flatMap(([a, b], t) => [
      [t, a],
      [t, b],
    ]);
    new PyRandom(seed).shuffle(edges);
    const colored = edgeColor(edges, T, D, g.nColors);
    assert.deepEqual(verify(colored, T, D), [], "the port's colouring is valid");
    if (g.errs.length === 0) {
      assert.deepEqual(flatten(colored, D), g.colorOf, "identical colouring");
      assert.deepEqual(flatten(improveSpacing(colored, g.nColors, D), D), g.spaced, "identical spacing");
    } else {
      // The documented exception: the Python double-books a panel here
      // (edge_color's path flip corrupts its bookkeeping). The port must
      // differ from it, and must be valid where it is not.
      assert.notDeepEqual(flatten(colored, D), g.colorOf);
      assert.ok(g.errs.length > 0, `Python errors: ${g.errs.join("; ")}`);
    }
  });
}
