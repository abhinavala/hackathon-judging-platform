import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildEvent,
  isLocalUrl,
  parseArgs,
} from "../../lib/admin/bootstrap.ts";

const FULL = [
  "--slug",
  "aws-a10-2026",
  "--name=AWS x A10 Hack",
  "--year",
  "2026",
  "--judging-start",
  "2026-11-08T10:00",
  "--help-location",
  "the check-in table by the main entrance",
];

test("flags parse in both forms; switches and the project ref are separate", () => {
  const a = parseArgs([...FULL, "--confirm", "--project-ref", "abc"]);
  assert.equal(a.values.slug, "aws-a10-2026");
  assert.equal(a.values.name, "AWS x A10 Hack");
  assert.equal(a.confirm, true);
  assert.equal(a.dryRun, false);
  assert.equal(a.projectRef, "abc");
  assert.deepEqual(a.unknown, []);
  assert.deepEqual(parseArgs(["--colour", "red", "stray"]).unknown, [
    "unknown option --colour",
    'unexpected argument "stray"',
  ]);
  assert.deepEqual(parseArgs(["--slug", "--confirm"]).unknown, [
    "--slug needs a value",
  ]);
  assert.equal(parseArgs(["--slug", "--confirm"]).confirm, true);
});

test("a full set of flags builds the row, with defaults and the start in the event's zone", () => {
  const r = buildEvent(parseArgs(FULL).values, {});
  assert.ok("event" in r);
  assert.deepEqual(r.event, {
    slug: "aws-a10-2026",
    name: "AWS x A10 Hack",
    year: 2026,
    timezone: "America/Los_Angeles",
    slot_minutes: 7,
    judging_starts_at: "2026-11-08T18:00:00.000Z", // 10:00 PST
    help_location: "the check-in table by the main entrance",
  });
});

test("env vars fill in, and a flag beats its env var", () => {
  const r = buildEvent(
    { slug: "from-flag" },
    {
      EVENT_SLUG: "from-env",
      EVENT_NAME: "  Spring   Hack ",
      EVENT_YEAR: "2027",
      EVENT_TIMEZONE: "America/New_York",
      EVENT_SLOT_MINUTES: "8",
      EVENT_JUDGING_START: "2027-04-11T09:30",
      EVENT_HELP_LOCATION: "Room 101",
    },
  );
  assert.ok("event" in r);
  assert.equal(r.event.slug, "from-flag");
  assert.equal(r.event.name, "Spring Hack");
  assert.equal(r.event.slot_minutes, 8);
  assert.equal(r.event.judging_starts_at, "2027-04-11T13:30:00.000Z"); // EDT
});

test("every problem is reported at once", () => {
  const r = buildEvent(
    {
      slug: "AWS A10",
      year: "26",
      timezone: "Pacific Time",
      "slot-minutes": "90",
      "judging-start": "next sunday",
    },
    {},
  );
  assert.ok("errors" in r);
  assert.deepEqual(r.errors, [
    'slug "AWS A10" must be lowercase letters, digits and single dashes, e.g. aws-a10-2026',
    "--name (or EVENT_NAME) is required",
    'year "26" must be a four-digit year',
    'timezone "Pacific Time" isn\'t an IANA zone, e.g. America/Los_Angeles',
    'slot length "90" must be 1-60 minutes',
    "--help-location (or EVENT_HELP_LOCATION) is required",
  ]);
});

test("a malformed start or one in the wrong year is refused; an explicit offset is accepted", () => {
  const base = parseArgs(FULL).values;
  const bad = buildEvent({ ...base, "judging-start": "11/8 10am" }, {});
  assert.ok("errors" in bad);
  assert.match(bad.errors[0], /must look like 2026-11-08T10:00/);
  const wrongYear = buildEvent(
    { ...base, "judging-start": "2025-11-08T10:00" },
    {},
  );
  assert.ok("errors" in wrongYear);
  assert.deepEqual(wrongYear.errors, [
    "judging start 2025-11-08T10:00 isn't in 2026",
  ]);
  const offset = buildEvent(
    { ...base, "judging-start": "2026-11-08T10:00:00-08:00" },
    {},
  );
  assert.ok("event" in offset);
  assert.equal(offset.event.judging_starts_at, "2026-11-08T18:00:00.000Z");
});

test("only the local stack counts as local", () => {
  assert.equal(isLocalUrl("http://127.0.0.1:54321"), true);
  assert.equal(isLocalUrl("http://localhost:54321"), true);
  assert.equal(isLocalUrl("https://jgetndieacanzhrzmyiz.supabase.co"), false);
  assert.equal(isLocalUrl("https://localhost.example.com"), false);
});
