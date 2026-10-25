// Teams CSV import, round-tripping a Google-Forms-shaped export.

import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCsv } from "../../lib/csv/csv.ts";
import {
  planTeamImport,
  readTeamsCsv,
  type ExistingTeam,
  type TrackDef,
} from "../../lib/csv/teams-import.ts";

const TRACKS: TrackDef[] = [
  { name: "Best Use of AWS", sponsor: "AWS" },
  { name: "A10 Networks Security Challenge", sponsor: "A10" },
  // A comma inside a track name: Google Forms joins checkbox answers with
  // ", ", so naive splitting would break this one.
  { name: "Hardware, IoT & Robotics", sponsor: null },
];

// Headers as a Google Form produces them: the question text.
const HEADERS = [
  "Timestamp",
  "Email Address",
  "Team name",
  "Which prize tracks are you submitting to?",
  "Devpost link",
  "GitHub repo link(s)",
  "Teammate emails (comma separated)",
  "Does your team include a graduate student?",
  "Is your team all freshmen?",
  "Is at least half of your team non-male? (diversity prize)",
];

type Source = {
  name: string;
  tracks: string[];
  devpost: string | null;
  github: string[];
  captain: string;
  mates: string[];
  grad: boolean;
  freshmen: boolean;
  nonMale: boolean;
};

const SOURCE: Source[] = [
  {
    name: "ShelterLink",
    tracks: ["Best Use of AWS"],
    devpost: "https://devpost.com/software/shelterlink",
    github: ["https://github.com/a/shelterlink"],
    captain: "emily.delgado@scu.example",
    mates: ["kai.wong@scu.example", "zara.ho@scu.example"],
    grad: false,
    freshmen: true,
    nonMale: true,
  },
  {
    name: "Smith, Jones & Co",
    tracks: ["Best Use of AWS", "A10 Networks Security Challenge"],
    devpost: "https://devpost.com/software/smith-jones",
    github: ["https://github.com/b/one", "https://github.com/b/two"],
    captain: "Omar.Haddad@SCU.example",
    mates: ["liam.park@scu.example"],
    grad: true,
    freshmen: false,
    nonMale: false,
  },
  {
    name: 'The "Quoted" Team',
    tracks: ["Hardware, IoT & Robotics", "A10 Networks Security Challenge"],
    devpost: null,
    github: [],
    captain: "ava.nair@scu.example",
    mates: [],
    grad: false,
    freshmen: false,
    nonMale: true,
  },
  {
    name: "Ünïcødé Rocket 🚀",
    tracks: [],
    devpost: "https://devpost.com/software/rocket",
    github: ["https://github.com/c/rocket"],
    captain: "hana.kim@scu.example",
    mates: [
      "mia.tran@scu.example",
      "noah.le@scu.example",
      "sara.shah@scu.example",
    ],
    grad: false,
    freshmen: false,
    nonMale: true,
  },
  {
    name: '=HYPERLINK("http://evil.example")',
    tracks: ["Best Use of AWS"],
    devpost: null,
    github: [],
    captain: "x@scu.example",
    mates: [],
    grad: false,
    freshmen: false,
    nonMale: false,
  },
];

function exportLike(rows: Source[], extra: string[][] = []): string {
  const yn = (b: boolean) => (b ? "Yes" : "No");
  return formatCsv([
    HEADERS,
    ...rows.map((t, i) => [
      `11/7/2026 9:${String(10 + i).padStart(2, "0")}:00`,
      t.captain,
      t.name,
      t.tracks.join(", ") || "None",
      t.devpost ?? "",
      t.github.join("\n"),
      t.mates.join(", "),
      yn(t.grad),
      yn(t.freshmen),
      yn(t.nonMale),
    ]),
    ...extra,
  ]);
}

const expected = (t: Source) => ({
  name: t.name,
  tracks: TRACKS.map((x) => x.name).filter((n) => t.tracks.includes(n)),
  devpostUrl: t.devpost,
  githubUrls: t.github,
  memberEmails: [t.captain.toLowerCase(), ...t.mates],
  hasGradStudent: t.grad,
  allFreshmen: t.freshmen,
  halfOrMoreNonMale: t.nonMale,
});

test("round-trips a Google Form export, field for field", () => {
  for (const variant of ["crlf", "lf", "bom"]) {
    let text = exportLike(SOURCE);
    if (variant === "lf") text = text.replace(/\r\n/g, "\n");
    if (variant === "bom") text = `\ufeff${text}`;
    const read = readTeamsCsv(text, TRACKS);
    assert.deepEqual(read.errors, [], variant);
    assert.deepEqual(read.warnings, [], variant);
    assert.deepEqual(
      read.teams.map((t) => ({
        name: t.name,
        tracks: t.tracks,
        devpostUrl: t.devpostUrl,
        githubUrls: t.githubUrls,
        memberEmails: t.memberEmails,
        hasGradStudent: t.hasGradStudent,
        allFreshmen: t.allFreshmen,
        halfOrMoreNonMale: t.halfOrMoreNonMale,
      })),
      SOURCE.map(expected),
      variant,
    );
  }
});

test("reports how every column was mapped", () => {
  const read = readTeamsCsv(exportLike(SOURCE), TRACKS);
  assert.deepEqual(
    read.columns.mapped.map((m) => m.field),
    [
      "timestamp",
      "submitter",
      "name",
      "tracks",
      "devpost",
      "github",
      "emails",
      "grad",
      "freshmen",
      "nonMale",
    ],
  );
  assert.deepEqual(read.columns.ignored, []);
});

test("a re-submitted form: the later row wins, and it is reported", () => {
  const fixed = {
    ...SOURCE[0],
    devpost: "https://devpost.com/software/shelterlink-v2",
  };
  const read = readTeamsCsv(exportLike([...SOURCE, fixed]), TRACKS);
  const shelter = read.teams.filter((t) => t.name === "ShelterLink");
  assert.equal(shelter.length, 1);
  assert.equal(shelter[0].devpostUrl, fixed.devpost);
  assert.match(
    read.warnings[0].message,
    /also appears on line 2; using this later row/,
  );
});

test("unrecognised track text is reported, not dropped silently; bare sponsor labels count", () => {
  const read = readTeamsCsv(
    exportLike([{ ...SOURCE[0], tracks: [] }]).replace(
      ",None,",
      ',"AWS, Quantum Stuff",',
    ),
    TRACKS,
  );
  assert.deepEqual(read.teams[0].tracks, ["Best Use of AWS"]);
  assert.deepEqual(
    read.warnings.map((w) => w.message),
    ['"ShelterLink": unrecognised track "Quantum Stuff" ignored.'],
  );
});

test("missing required columns are errors; renamed columns show as ignored", () => {
  const read = readTeamsCsv("Timestamp,Project\n1,Thing\n", TRACKS);
  assert.deepEqual(
    read.errors.map((e) => e.message),
    ["No team name column found.", "No track selection column found."],
  );
  assert.deepEqual(read.columns.ignored, ["Project"]);
});

test("the plan says what would happen before anything happens", () => {
  const read = readTeamsCsv(exportLike(SOURCE), TRACKS);
  const existing: ExistingTeam[] = [
    {
      // Same team, typed differently, nothing changed.
      id: "t-shelter",
      name: "  shelterlink ",
      tracks: ["Best Use of AWS"],
      devpostUrl: "https://devpost.com/software/shelterlink",
      githubUrls: ["https://github.com/a/shelterlink"],
      memberEmails: [
        "emily.delgado@scu.example",
        "kai.wong@scu.example",
        "zara.ho@scu.example",
      ],
      hasGradStudent: false,
      allFreshmen: true,
      halfOrMoreNonMale: true,
    },
    {
      // Changed: an extra track, a new Devpost link, one member swapped.
      id: "t-smith",
      name: "Smith, Jones & Co",
      tracks: ["Best Use of AWS"],
      devpostUrl: null,
      githubUrls: ["https://github.com/b/one", "https://github.com/b/two"],
      memberEmails: ["omar.haddad@scu.example", "old.member@scu.example"],
      hasGradStudent: true,
      allFreshmen: false,
      halfOrMoreNonMale: false,
    },
    {
      id: "t-gone",
      name: "Did Not Submit",
      tracks: [],
      devpostUrl: null,
      githubUrls: [],
      memberEmails: [],
      hasGradStudent: null,
      allFreshmen: null,
      halfOrMoreNonMale: null,
    },
  ];
  const plan = planTeamImport(read, existing);
  assert.deepEqual(plan.unchanged, [
    { id: "t-shelter", name: "  shelterlink " },
  ]);
  assert.deepEqual(plan.update, [
    {
      id: "t-smith",
      name: "Smith, Jones & Co",
      line: 3,
      changes: {
        tracks: { added: ["A10 Networks Security Challenge"], removed: [] },
        devpostUrl: {
          from: null,
          to: "https://devpost.com/software/smith-jones",
        },
        memberEmails: {
          added: ["liam.park@scu.example"],
          removed: ["old.member@scu.example"],
        },
      },
    },
  ]);
  assert.deepEqual(
    plan.create.map((t) => t.name),
    [
      'The "Quoted" Team',
      "Ünïcødé Rocket 🚀",
      '=HYPERLINK("http://evil.example")',
    ],
  );
  assert.deepEqual(plan.notInCsv, [{ id: "t-gone", name: "Did Not Submit" }]);
});

test("fields the form doesn't ask about are never proposed as changes", () => {
  const minimal = readTeamsCsv(
    formatCsv([
      ["Team name", "Tracks"],
      ["Smith, Jones & Co", "Best Use of AWS"],
    ]),
    TRACKS,
  );
  const plan = planTeamImport(minimal, [
    {
      id: "t-smith",
      name: "Smith, Jones & Co",
      tracks: ["Best Use of AWS"],
      devpostUrl: "https://devpost.com/software/keep-me",
      githubUrls: ["https://github.com/keep/me"],
      memberEmails: ["keep@scu.example"],
      hasGradStudent: true,
      allFreshmen: null,
      halfOrMoreNonMale: false,
    },
  ]);
  assert.deepEqual(
    plan.unchanged.map((t) => t.id),
    ["t-smith"],
  );
});
