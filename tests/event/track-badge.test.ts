import { test } from "node:test";
import assert from "node:assert/strict";
import { trackBadges } from "../../lib/event/track-badge.ts";

test("sponsor as the badge, in track order; the name when there's no sponsor", () => {
  assert.deepEqual(
    trackBadges([
      {
        name: "A10 Track: Agentic Identity and Harness Engineering",
        sponsor: "A10",
        sortOrder: 2,
      },
      {
        name: "AWS-Powered AI for Scalable Solutions",
        sponsor: "AWS",
        sortOrder: 1,
      },
    ]),
    ["AWS", "A10"],
  );
  assert.deepEqual(
    trackBadges([{ name: "Best Social Impact", sponsor: null, sortOrder: 3 }]),
    ["Best Social Impact"],
  );
  assert.deepEqual(trackBadges([{ name: "X", sponsor: "  ", sortOrder: 1 }]), [
    "X",
  ]);
  assert.deepEqual(trackBadges([]), []);
});
