import { test } from "node:test";
import assert from "node:assert/strict";
import { HELP_FALLBACK, helpPlace } from "../../lib/event/copy.ts";

test("the help location is the organizers' text, or a fallback, never blank", () => {
  assert.equal(
    helpPlace("the check-in table by the main entrance"),
    "the check-in table by the main entrance",
  );
  assert.equal(helpPlace("  Room 101  "), "Room 101");
  assert.equal(helpPlace(null), HELP_FALLBACK);
  assert.equal(helpPlace(undefined), HELP_FALLBACK);
  assert.equal(helpPlace("   "), HELP_FALLBACK);
});
