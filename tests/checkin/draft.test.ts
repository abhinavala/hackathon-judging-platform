import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeDraft, encodeDraft } from "../../lib/checkin/draft.ts";

const FIELDS = {
  teamName: "Night Owls",
  captainName: "Riley Park",
  captainEmail: "riley.park@scu.example",
  teammateEmail1: "sam.ortiz@scu.example",
  track: ["t1", "t2"],
  hasGradStudent: "no",
  website: "http://spam.example",
};

test("a draft round-trips, without the bot trap", () => {
  const back = decodeDraft(encodeDraft(FIELDS)!);
  const { website: _w, ...rest } = FIELDS;
  void _w;
  assert.deepEqual(back, rest);
});

test("a draft too big for a cookie drops the long optional fields first", () => {
  const big = {
    ...FIELDS,
    notes: "x".repeat(3000),
    githubUrls: "y".repeat(800),
  };
  const enc = encodeDraft(big)!;
  assert.ok(enc.length <= 3500);
  const back = decodeDraft(enc)!;
  assert.equal(back.notes, undefined);
  assert.equal(back.teammateEmail1, "sam.ortiz@scu.example");
});

test("anything that isn't a draft decodes to null, and odd values are dropped", () => {
  assert.equal(decodeDraft(undefined), null);
  assert.equal(decodeDraft("not base64 json"), null);
  const odd = Buffer.from(
    JSON.stringify({ teamName: "A", n: 5, t: [1] }),
  ).toString("base64url");
  assert.deepEqual(decodeDraft(odd), { teamName: "A" });
});
