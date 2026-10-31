import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCheckIn, fieldsFromFormData } from "../../lib/checkin/form.ts";

const TRACKS = [
  { id: "t-aws", name: "Best Use of AWS" },
  { id: "t-a10", name: "A10 Networks Prize" },
];
const VALID = {
  teamName: "  Shelter   Link ",
  captainName: "Emily Delgado",
  captainEmail: " Emily.Delgado@SCU.edu ",
  phone: "(408) 555-0101",
  teammateName1: "Marcus Chen",
  teammateEmail1: "mchen@scu.edu",
  teammateName2: "",
  teammateEmail2: "priya@scu.edu",
  devpostUrl: "devpost.com/software/shelterlink",
  githubUrls: "https://github.com/acm/shelterlink, github.com/acm/api",
  track: ["t-aws"],
  hasGradStudent: "no",
  allFreshmen: "no",
  halfOrMoreNonMale: "yes",
  notes: "",
  website: "",
};

test("a complete form parses, tidied", () => {
  const r = parseCheckIn(VALID, TRACKS);
  assert.ok(r.ok);
  assert.deepEqual(r.value, {
    teamName: "Shelter Link",
    captain: {
      name: "Emily Delgado",
      email: "emily.delgado@scu.edu",
      phone: "(408) 555-0101",
    },
    teammates: [
      { name: "Marcus Chen", email: "mchen@scu.edu" },
      { name: null, email: "priya@scu.edu" },
    ],
    devpostUrl: "https://devpost.com/software/shelterlink",
    githubUrls: [
      "https://github.com/acm/shelterlink",
      "https://github.com/acm/api",
    ],
    trackIds: ["t-aws"],
    hasGradStudent: false,
    allFreshmen: false,
    halfOrMoreNonMale: true,
    notes: null,
  });
});

test("the minimum: team, captain, and the three eligibility answers", () => {
  const r = parseCheckIn(
    {
      teamName: "Solo",
      captainName: "Ada",
      captainEmail: "ada@scu.edu",
      hasGradStudent: "yes",
      allFreshmen: "no",
      halfOrMoreNonMale: "yes",
    },
    TRACKS,
  );
  assert.ok(r.ok);
  assert.deepEqual(r.value.teammates, []);
  assert.deepEqual(r.value.trackIds, []);
});

test("every problem is reported at once, by field", () => {
  const r = parseCheckIn(
    {
      captainEmail: "not-an-email",
      teammateName1: "Marcus",
      teammateEmail2: "EMILY@x.edu",
      teammateEmail3: "emily@x.edu",
      devpostUrl: "https://example.com/project",
      githubUrls: "github.com/onlyowner",
      track: ["t-gone"],
      hasGradStudent: "maybe",
    },
    TRACKS,
  );
  assert.ok(!r.ok);
  assert.deepEqual(Object.keys(r.errors).sort(), [
    "allFreshmen",
    "captainEmail",
    "captainName",
    "devpostUrl",
    "githubUrls",
    "halfOrMoreNonMale",
    "hasGradStudent",
    "teamName",
    "teammateEmail1",
    "teammateEmail3",
    "track",
  ]);
  assert.equal(
    r.errors.teammateEmail1,
    "Add Marcus's email, so we can invite them.",
  );
  assert.equal(r.errors.teammateEmail3, "This address is listed twice.");
});

test("the captain can't list themselves as a teammate", () => {
  const r = parseCheckIn(
    { ...VALID, teammateEmail1: "EMILY.delgado@scu.edu" },
    TRACKS,
  );
  assert.ok(!r.ok);
  assert.equal(r.errors.teammateEmail1, "That's your own address.");
});

test("the hidden field catches bots without saying why", () => {
  const r = parseCheckIn({ ...VALID, website: "http://spam" }, TRACKS);
  assert.ok(!r.ok);
  assert.deepEqual(r.errors, {
    form: "Something went wrong. Please try again.",
  });
});

test("FormData: tracks are always a list, other fields single", () => {
  const fd = new FormData();
  fd.append("teamName", "X");
  fd.append("track", "t-aws");
  const f = fieldsFromFormData(fd);
  assert.deepEqual(f.track, ["t-aws"]);
  assert.equal(f.teamName, "X");
});
