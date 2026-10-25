import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ago,
  clockWithZone,
  dayLabel,
  formatWait,
  fromRpc,
  heroFor,
  normalizeCode,
  slotRange,
  type TeamView,
} from "../../lib/team/view.ts";

const LA = "America/Los_Angeles";
const at = (hhmm: string) => Date.parse(`2026-11-08T${hhmm}:00-08:00`);

// The shape team_view() returns (snake_case), for ShelterLink in the seed.
const RPC = {
  found: true,
  team: { name: "ShelterLink", tracks: [] },
  event: { name: "AWS x A10 Hack", slug: "aws-a10-2026", timezone: LA },
  published: { version: 3, published_at: "2026-11-08T17:40:00+00:00" },
  slots: [
    {
      index: 11,
      starts_at: "2026-11-08T19:17:00+00:00",
      ends_at: "2026-11-08T19:24:00+00:00",
      station: "Station 2",
      location: "Blue section, back wall",
    },
    {
      index: 8,
      starts_at: "2026-11-08T18:56:00+00:00",
      ends_at: "2026-11-08T19:03:00+00:00",
      station: "Station 6",
      location: null,
    },
  ],
  expected_start: "2026-11-08T18:00:00+00:00",
  announcements: [
    {
      body: "Judging starts at 10:00.",
      level: "info",
      created_at: "2026-11-08T17:00:00+00:00",
    },
  ],
};
const view = fromRpc(RPC) as Extract<TeamView, { found: true }>;

test("fromRpc maps the RPC's JSON", () => {
  assert.equal(view.found, true);
  assert.equal(view.published?.version, 3);
  assert.equal(view.slots[0].location, "Blue section, back wall");
  assert.equal(view.announcements[0].body, "Judging starts at 10:00.");
  assert.deepEqual(fromRpc({ found: false }), { found: false });
  assert.deepEqual(fromRpc(null), { found: false });
});

test("the hero walks through a team's morning, in slot order regardless of input order", () => {
  // Station 6 at 10:56-11:03, Station 2 at 11:17-11:24 (PST).
  assert.deepEqual(pick(heroFor(view, at("10:33"))), {
    kind: "upcoming",
    station: "Station 6",
    minutes: 23,
    which: "first",
  });
  assert.deepEqual(pick(heroFor(view, at("10:55"))), {
    kind: "upcoming",
    station: "Station 6",
    minutes: 1,
    which: "first",
  });
  assert.deepEqual(pick(heroFor(view, at("10:57"))), {
    kind: "now",
    station: "Station 6",
    minutesLeft: 6,
    which: "first",
  });
  assert.deepEqual(pick(heroFor(view, at("11:03"))), {
    kind: "upcoming",
    station: "Station 2",
    minutes: 14,
    which: "second",
  });
  assert.deepEqual(pick(heroFor(view, at("11:20"))), {
    kind: "now",
    station: "Station 2",
    minutesLeft: 4,
    which: "second",
  });
  assert.deepEqual(heroFor(view, at("11:24")), { kind: "done" });
});

test("the not-normal states are distinct, never blank", () => {
  assert.deepEqual(heroFor({ found: false }, at("10:00")), {
    kind: "not-found",
  });
  assert.deepEqual(
    heroFor({ ...view, published: null, slots: [] }, at("09:00")),
    {
      kind: "unpublished",
      expectedStart: "2026-11-08T18:00:00+00:00",
    },
  );
  assert.deepEqual(heroFor({ ...view, slots: [] }, at("10:00")), {
    kind: "not-scheduled",
    version: 3,
  });
});

test("waits read naturally", () => {
  assert.equal(formatWait(0), "less than a minute");
  assert.equal(formatWait(1), "1 minute");
  assert.equal(formatWait(23), "23 minutes");
  assert.equal(formatWait(60), "1 hour");
  assert.equal(formatWait(65), "1 hour 5 minutes");
  assert.equal(formatWait(181), "3 hours 1 minute");
  assert.equal(formatWait(24 * 60), "1 day");
  assert.equal(formatWait(14 * 24 * 60 - 30), "14 days");
});

test("times are in the event's zone and labelled, whatever the device's zone", () => {
  const original = process.env.TZ;
  process.env.TZ = "Asia/Tokyo"; // a phone set to the wrong zone
  try {
    assert.equal(clockWithZone("2026-11-08T18:42:00Z", LA), "10:42 AM PST");
    assert.equal(
      slotRange(
        { startsAt: "2026-11-08T18:42:00Z", endsAt: "2026-11-08T18:49:00Z" },
        LA,
      ),
      "10:42–10:49 AM PST",
    );
    assert.equal(dayLabel("2026-11-08T18:00:00Z", LA), "Sunday, November 8");
  } finally {
    process.env.TZ = original;
  }
});

test("join codes are accepted however they're typed", () => {
  assert.equal(normalizeCode("abcd1234"), "ABCD-1234");
  assert.equal(normalizeCode(" ab cd-12 34 "), "ABCD-1234");
  assert.equal(normalizeCode("ABCD-1234"), "ABCD-1234");
  assert.equal(normalizeCode("ABC-123"), null);
  assert.equal(normalizeCode("ABCD-12345"), null);
  assert.equal(normalizeCode(undefined), null);
});

test("staleness reads as minutes ago", () => {
  const now = at("10:40");
  assert.equal(ago(now - 20_000, now), "just now");
  assert.equal(ago(now - 60_000, now), "1 minute ago");
  assert.equal(ago(now - 12 * 60_000, now), "12 minutes ago");
  assert.equal(ago(now - 130 * 60_000, now), "2 hours ago");
});

function pick(h: ReturnType<typeof heroFor>) {
  if (h.kind === "upcoming")
    return {
      kind: h.kind,
      station: h.slot.station,
      minutes: h.minutes,
      which: h.which,
    };
  if (h.kind === "now")
    return {
      kind: h.kind,
      station: h.slot.station,
      minutesLeft: h.minutesLeft,
      which: h.which,
    };
  return h;
}
