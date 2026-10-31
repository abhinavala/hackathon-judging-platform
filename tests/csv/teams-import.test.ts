// Teams CSV import against the real export's structure:
// fixtures/google-form-responses.sample.csv (synthetic people, identical
// structure to the 2026 form export), plus a synthetic new-form export.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatCsv, parseCsv } from "../../lib/csv/csv.ts";
import {
  parseFormTimestamp,
  planTeamImport,
  readLinks,
  readTeamsCsv,
  splitPeople,
  type ExistingTeam,
  type TrackDef,
} from "../../lib/csv/teams-import.ts";

// The six real prize tracks; three share the prefix "Best Use of".
const TRACKS: TrackDef[] = [
  "Best Use of WebSpatial",
  "Future Unicorn Award",
  "Best Project Built w/ ElevenLabs",
  "Best Use of AMD Tech",
  "Best Use of Responsible AI",
  "Best in Play (Top Game)",
].map((name) => ({ name, sponsor: null }));

const SAMPLE = readFileSync(
  new URL("../../fixtures/google-form-responses.sample.csv", import.meta.url),
  "utf8",
);

const existing = (
  over: Partial<ExistingTeam> & { id: string; name: string },
): ExistingTeam => ({
  tracks: [],
  devpostUrl: null,
  githubUrls: [],
  memberEmails: [],
  contactPhone: null,
  hasGradStudent: null,
  allFreshmen: null,
  halfOrMoreNonMale: null,
  ...over,
});

// --- the real export's structure (old form) ---------------------------------

test("sample: multi-line headers parse; all 12 columns are recognised; old form", () => {
  const read = readTeamsCsv(SAMPLE, TRACKS);
  assert.deepEqual(read.errors, []);
  assert.equal(read.columns.shape, "old");
  assert.deepEqual(read.columns.ignored, []);
  assert.deepEqual(
    read.columns.mapped.map((m) => m.field),
    [
      "timestamp",
      "submitter",
      "submitterName",
      "phone",
      "teamSize",
      "teammateNames",
      "grad",
      "freshmen",
      "nonMale",
      "tracks",
      "github",
      "comments",
    ],
  );
  // The header shown is the question, not its help text.
  assert.equal(read.columns.mapped[3].header, "Your Phone Number");
});

test("sample: 9 responses -> 8 teams; the duplicate submitter keeps the later timestamp", () => {
  const read = readTeamsCsv(SAMPLE, TRACKS);
  assert.equal(read.teams.length, 8);
  const kj = read.teams.find((t) => t.submitter.email === "bbb@example.edu")!;
  assert.equal(kj.submittedAt, "2026-02-28T11:52:31");
  assert.deepEqual(kj.supersedes, [7]);
  assert.deepEqual(kj.githubUrls, [
    "https://github.com/example/beta-corrected",
  ]);
  assert.deepEqual(kj.tracks, [
    "Future Unicorn Award",
    "Best Use of AMD Tech",
    "Best Use of Responsible AI",
  ]);
  assert.ok(
    read.warnings.some((w) =>
      /Katherine Johnson submitted more than once: using line 16 \(2026-02-28 11:52:31\), replacing line 7/.test(
        w.message,
      ),
    ),
  );
});

test("duplicates are resolved by parsed timestamp, not row order", () => {
  // Put Katherine's corrected (11:52) response ABOVE the original (10:41).
  const lines = SAMPLE.split("\r\n");
  const original = lines.findIndex((l) =>
    l.startsWith("2/28/2026 10:41:20,bbb@"),
  );
  const corrected = lines.findIndex((l) =>
    l.startsWith("2/28/2026 11:52:31,bbb@"),
  );
  [lines[original], lines[corrected]] = [lines[corrected], lines[original]];
  const read = readTeamsCsv(lines.join("\r\n"), TRACKS);
  const kj = read.teams.find((t) => t.submitter.email === "bbb@example.edu")!;
  assert.equal(
    kj.submittedAt,
    "2026-02-28T11:52:31",
    "the later TIME wins even though it is the earlier row",
  );
  assert.deepEqual(kj.githubUrls, [
    "https://github.com/example/beta-corrected",
  ]);
  // And the 3/1 response that sits between 2/28 rows is read as 3/1.
  assert.equal(
    read.teams.find((t) => t.submitter.fullName === "Margaret Hamilton")!
      .submittedAt,
    "2026-03-01T00:41:47",
  );
});

test("sample: teammates split on commas, semicolons, periods and line breaks; self-listing removed", () => {
  const read = readTeamsCsv(SAMPLE, TRACKS);
  const by = (n: string) => read.teams.find((t) => t.submitter.fullName === n)!;
  assert.deepEqual(by("Ada Lovelace").teammateNames, [
    "Grace Hopper",
    "Alan Turing",
  ]);
  assert.deepEqual(by("Katherine Johnson").teammateNames, [
    "Mary Jackson",
    "Dorothy Vaughan",
  ]);
  assert.deepEqual(by("Alan Kay").teammateNames, [
    "Seymour Papert",
    "Cynthia Solomon",
  ]);
  assert.deepEqual(by("Barbara Liskov").teammateNames, [
    "Radia Perlman",
    "Frances Allen",
    "Shafi Goldwasser",
  ]);
  assert.equal(by("Barbara Liskov").listedThemselves, true);
  assert.ok(
    read.warnings.some(
      (w) =>
        w.message ===
        "Barbara Liskov: says 5 people but lists 4 (including the submitter).",
    ),
  );
  // Old form: teammates have no emails, so only the submitter is a member.
  assert.deepEqual(by("Ada Lovelace").memberEmails, ["aaa@example.edu"]);
});

test("sample: GitHub with and without https://, several per cell; empty prizes = grand prize only", () => {
  const read = readTeamsCsv(SAMPLE, TRACKS);
  const by = (n: string) => read.teams.find((t) => t.submitter.fullName === n)!;
  assert.deepEqual(by("Alan Kay").githubUrls, [
    "https://github.com/example/gamma",
  ]);
  assert.deepEqual(by("Edsger Dijkstra").githubUrls, [
    "https://github.com/example/eta-backend",
    "https://github.com/example/eta-frontend",
  ]);
  assert.deepEqual(by("Edsger Dijkstra").tracks, []);
  assert.deepEqual(by("Donald Knuth").tracks, []);
  assert.equal(
    by("Ada Lovelace").tracks.length,
    6,
    "all six, despite the shared 'Best Use of' prefix",
  );
  assert.equal(by("Alan Kay").comments, null, "'N/A' is no comment");
  assert.match(by("Vint Cerf").comments!, /^Do we get free credits/);
  assert.equal(by("Katherine Johnson").contactPhone, "+1 (925) 555-0102");
  assert.equal(by("Ada Lovelace").hasGradStudent, true);
  assert.equal(by("Katherine Johnson").halfOrMoreNonMale, true);
  assert.equal(
    read.warnings.filter((w) => /unrecognised prize/.test(w.message)).length,
    0,
  );
});

test("sample, LF-only and all-CRLF variants read the same", () => {
  // Physical line numbers are the same in every variant; compare the rest.
  const base = readTeamsCsv(SAMPLE, TRACKS).teams.map((t) => ({
    ...t,
    line: 0,
  }));
  const lf = SAMPLE.replace(/\r\n/g, "\n");
  const crlf = lf.replace(/\n/g, "\r\n");
  for (const variant of [lf, crlf]) {
    assert.deepEqual(
      readTeamsCsv(variant, TRACKS).teams.map((t) => ({ ...t, line: 0 })),
      base,
    );
  }
});

test("old form: no team names are invented; the plan asks the organizer", () => {
  const read = readTeamsCsv(SAMPLE, TRACKS);
  const plan = planTeamImport(read, []);
  assert.equal(plan.create.length, 0);
  assert.equal(plan.needsName.length, 8);
  assert.ok(plan.needsName.every((t) => t.name === null));
});

test("old form: names given by the organizer create teams; a submitter already on a team matches it", () => {
  const read = readTeamsCsv(SAMPLE, TRACKS);
  const names = new Map(
    read.teams
      .filter((t) => t.submitter.fullName !== "Ada Lovelace")
      .map((t) => [t.line, `Team of ${t.submitter.fullName}`]),
  );
  const plan = planTeamImport(
    read,
    [
      existing({
        id: "t-ada",
        name: "Analytical Engines",
        memberEmails: ["aaa@example.edu"],
      }),
    ],
    names,
  );
  assert.equal(plan.needsName.length, 0);
  assert.equal(plan.create.length, 7);
  assert.equal(plan.update.length, 1);
  assert.equal(plan.update[0].name, "Analytical Engines");
  assert.equal(plan.update[0].matchedBy, "member email");
  assert.equal(plan.update[0].changes.tracks?.added.length, 6);
});

test("two responses given the same name is a conflict, not a merge", () => {
  const read = readTeamsCsv(SAMPLE, TRACKS);
  const names = new Map(read.teams.map((t) => [t.line, "Same Name"]));
  const plan = planTeamImport(read, [], names);
  assert.equal(plan.create.length, 1);
  assert.equal(plan.conflicts.length, 7);
});

// --- pieces -----------------------------------------------------------------

test("timestamps: M/D/YYYY H:MM:SS without leading zeros", () => {
  assert.equal(parseFormTimestamp("3/1/2026 0:41:47"), "2026-03-01T00:41:47");
  assert.equal(parseFormTimestamp("11/7/2026 9:05:00"), "2026-11-07T09:05:00");
  assert.equal(parseFormTimestamp("2026-03-01 00:41:47"), null);
  assert.equal(parseFormTimestamp("13/1/2026 0:00:00"), null);
});

test("people: periods split only after a full word, so initials survive", () => {
  assert.deepEqual(
    splitPeople("John F. Kennedy, Mary Jackson. Dorothy Vaughan"),
    ["John F. Kennedy", "Mary Jackson", "Dorothy Vaughan"],
  );
  assert.deepEqual(splitPeople("  A Person ;B Person\n\nC Person  "), [
    "A Person",
    "B Person",
    "C Person",
  ]);
  assert.deepEqual(splitPeople("N/A"), []);
});

test("links: scheme added, trailing punctuation dropped, duplicates removed", () => {
  assert.deepEqual(
    readLinks(
      "github.com/a/b, https://github.com/a/b. www.github.com/c/d)",
      "github.com",
    ),
    ["https://github.com/a/b", "https://github.com/c/d"],
  );
  assert.deepEqual(readLinks("devpost.com/software/x", "devpost.com"), [
    "https://devpost.com/software/x",
  ]);
});

// --- the new form -------------------------------------------------------------

const NEW_HEADERS = [
  "Timestamp",
  "Email Address",
  "Full Name",
  "Team name",
  "Your Phone Number\nWe will contact you in case of any emergencies or issues",
  "Teammate emails\nSeparate them with commas",
  "Does your team have AT LEAST 1 graduate student?",
  "Does your team consist of ENTIRELY freshmen members?",
  "Does your team consist of HALF OR MORE non-male members?",
  "What prizes is your team competing in?\nSee the Prize Guide",
  "Devpost link",
  "The link to your PUBLIC Github repository(s)\nIf you have more than one, separate them by commas",
];

test("new form: team names, Devpost and teammate emails; duplicates keyed on team name", () => {
  const text = formatCsv([
    NEW_HEADERS,
    [
      "11/7/2026 9:40:00",
      "cap@example.edu",
      "Cap One",
      "Smith, Jones & Co",
      "555-0101",
      "a@example.edu; b@example.edu\ncap@example.edu",
      "No",
      "No",
      "Yes",
      "Best Use of AMD Tech",
      "devpost.com/software/sjc",
      "github.com/sjc/app",
    ],
    [
      "11/7/2026 9:12:00",
      "other@example.edu",
      "Other Person",
      "Smith, Jones & Co",
      "555-0199",
      "a@example.edu",
      "No",
      "No",
      "No",
      "",
      "",
      "",
    ],
    [
      "11/7/2026 9:30:00",
      "solo@example.edu",
      "Solo Dev",
      "Lone Wolf",
      "",
      "",
      "Yes",
      "No",
      "No",
      "",
      "",
      "",
    ],
  ]);
  const read = readTeamsCsv(text, TRACKS);
  assert.deepEqual(read.errors, []);
  assert.equal(read.columns.shape, "new");
  assert.equal(read.teams.length, 2);
  const sjc = read.teams.find((t) => t.name === "Smith, Jones & Co")!;
  assert.equal(
    sjc.submittedAt,
    "2026-11-07T09:40:00",
    "9:40 beats 9:12 regardless of order",
  );
  assert.deepEqual(sjc.memberEmails, [
    "cap@example.edu",
    "a@example.edu",
    "b@example.edu",
  ]);
  assert.equal(sjc.listedThemselves, true);
  assert.equal(sjc.devpostUrl, "https://devpost.com/software/sjc");
  assert.deepEqual(sjc.githubUrls, ["https://github.com/sjc/app"]);

  const plan = planTeamImport(read, [
    existing({
      id: "t1",
      name: "smith, jones & co",
      memberEmails: ["cap@example.edu", "gone@example.edu"],
      tracks: ["Best Use of WebSpatial"],
    }),
  ]);
  assert.equal(plan.create.map((t) => t.name).join(), "Lone Wolf");
  const u = plan.update[0];
  assert.equal(u.matchedBy, "name");
  assert.deepEqual(u.changes.tracks, {
    added: ["Best Use of AMD Tech"],
    removed: ["Best Use of WebSpatial"],
  });
  assert.deepEqual(
    u.changes.memberEmails,
    { added: ["a@example.edu", "b@example.edu"] },
    "members are added, never removed",
  );
  assert.deepEqual(u.changes.devpostUrl, {
    from: null,
    to: "https://devpost.com/software/sjc",
  });
});

test("fields the form doesn't ask about are never proposed as changes", () => {
  const minimal = readTeamsCsv(
    formatCsv([
      ["Team name", "Prizes"],
      ["Lone Wolf", "Best Use of AMD Tech"],
    ]),
    TRACKS,
  );
  const plan = planTeamImport(minimal, [
    existing({
      id: "t",
      name: "Lone Wolf",
      tracks: ["Best Use of AMD Tech"],
      devpostUrl: "https://devpost.com/software/keep",
      githubUrls: ["https://github.com/keep/me"],
      memberEmails: ["keep@example.edu"],
      contactPhone: "555",
      hasGradStudent: true,
    }),
  ]);
  assert.deepEqual(
    plan.unchanged.map((t) => t.id),
    ["t"],
  );
});

test("unusable files are explained, not half-imported", () => {
  assert.match(readTeamsCsv("", TRACKS).errors[0].message, /empty/);
  assert.match(
    readTeamsCsv('a,"b\nc', TRACKS).errors[0].message,
    /Not a readable CSV/,
  );
  const r = readTeamsCsv("Timestamp,Project\n1,Thing\n", TRACKS);
  assert.deepEqual(
    r.errors.map((e) => e.message),
    [
      "No prize/track selection column found.",
      "Neither a team name nor the submitter's email address is in the file.",
    ],
  );
  assert.deepEqual(r.columns.ignored, ["Project"]);
  // The parser is quote-first: nothing splits a header on its line breaks.
  assert.equal(parseCsv(SAMPLE)[0].length, 12);
});
