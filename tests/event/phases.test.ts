import { test } from "node:test";
import assert from "node:assert/strict";
import { minSec, phaseAt, phaseSummary } from "../../lib/event/phases.ts";

const S = "2026-11-08T18:00:00Z";
const E = "2026-11-08T18:07:00Z";
const at = (m: number, s = 0) => Date.parse(S) + m * 60_000 + s * 1000;

test("the three phases of a 7-minute slot, with seconds", () => {
  assert.equal(phaseAt(S, E, at(0))?.text, "Presenting · 4:00 left");
  assert.equal(phaseAt(S, E, at(0, 48))?.text, "Presenting · 3:12 left");
  assert.equal(phaseAt(S, E, at(4, 15))?.text, "Questions · 0:45 left");
  assert.equal(
    phaseAt(S, E, at(5, 30))?.text,
    "Switch over · 1:30 until next teams",
  );
  assert.equal(
    phaseAt(S, E, at(5, 30), false)?.text,
    "Wrapping up · 1:30 left",
  );
  assert.equal(phaseAt(S, E, at(6, 59))?.kind, "switch");
});

test("outside the slot there is no phase", () => {
  assert.equal(phaseAt(S, E, at(-1)), null);
  assert.equal(phaseAt(S, E, at(7)), null);
});

test("a longer slot keeps 4 + 1 and the switch-over takes the rest", () => {
  const E9 = "2026-11-08T18:09:00Z";
  assert.equal(
    phaseAt(S, E9, at(5))?.text,
    "Switch over · 4:00 until next teams",
  );
  assert.equal(
    phaseSummary(9),
    "4 min presenting, 1 min questions, 4 min switch over",
  );
});

test("minSec rounds up and pads", () => {
  assert.equal(minSec(192), "3:12");
  assert.equal(minSec(0.2), "0:01");
  assert.equal(minSec(-3), "0:00");
});
