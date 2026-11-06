import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCodesCsv, planCodes } from "../../lib/csv/codes-import.ts";

const NOW = Date.parse("2026-11-05T12:00:00Z");

const KIRO = `bonusCode,bonusName,bonusAmount,validFrom,validUntil,expirationDate,redemptionUrl
KIRO-AAA,Hackathon,1000,2026-11-01,2026-12-31,2026-12-31,https://kiro.example/r/AAA
KIRO-BBB,Hackathon,500,2026-11-01,2026-12-31,2026-12-31,https://kiro.example/r/BBB
KIRO-CCC,Hackathon,1000,2026-10-01,2026-10-31,2026-10-31,https://kiro.example/r/CCC
KIRO-AAA,Hackathon,1000,2026-11-01,2026-12-31,2026-12-31,https://kiro.example/r/AAA
`;

const WORKSHOP = `Team name,Team code,Participant count,Participant IDs,State,Deployment duration,AWS account ID,Join event URL,Last joined,Last account login,Last updated
team-001,ab12cd34,0,,Ready,2h,111122223333,https://catalog.us-east-1.prod.workshops.aws/join?access-code=ab12cd34,,,2026-11-05
team-002,ef56gh78,2,"p-1;p-2",Active,2h,444455556666,https://catalog.us-east-1.prod.workshops.aws/join?access-code=ef56gh78,2026-11-07,,2026-11-07
team-003,ij90kl12,0,,Ready,2h,777788889999,https://catalog.us-east-1.prod.workshops.aws/join,,,2026-11-05
`;

test("kiro: reads the file, warns on amount, expiry and duplicates", () => {
  const r = parseCodesCsv(KIRO, NOW);
  assert.ok(r.ok);
  assert.equal(r.kind, "kiro");
  assert.deepEqual(
    r.rows.map((x) => x.code),
    ["KIRO-AAA", "KIRO-BBB", "KIRO-CCC"],
  );
  assert.equal(r.rows[0].amount, 1000);
  assert.equal(r.rows[0].redemptionUrl, "https://kiro.example/r/AAA");
  assert.equal(r.rows[0].expiresAt, "2026-12-31T00:00:00.000Z");
  const w = r.warnings.join("\n");
  assert.match(w, /bonusAmount isn't 1000 on line 3/);
  assert.match(w, /1 code is already expired \(line 4\)/);
  assert.match(w, /appears again on line 5/);
});

test("workshop: never keeps Participant IDs, and says which columns go where", () => {
  const r = parseCodesCsv(WORKSHOP, NOW);
  assert.ok(r.ok);
  assert.equal(r.kind, "workshop");
  const ids = r.columns.find((c) => c.header === "Participant IDs");
  assert.match(ids!.use!, /NOT stored/);
  assert.ok(!JSON.stringify(r.rows).includes("p-1"));
  assert.equal(r.rows[1].participantCount, 2);
  assert.equal(r.rows[1].awsAccountId, "444455556666");
  assert.equal(r.rows[1].awsTeamName, "team-002");
  // The third row's URL doesn't embed its code: maybe the one-click link.
  assert.match(
    r.warnings.join("\n"),
    /doesn't contain the team's code on line 4/,
  );
});

test("a file that is neither, or misses a required column, reads nothing", () => {
  const neither = parseCodesCsv("name,email\na,b\n", NOW);
  assert.equal(neither.ok, false);
  const noUrl = parseCodesCsv("bonusCode,bonusAmount\nX,1000\n", NOW);
  assert.equal(noUrl.ok, false);
  assert.match(!noUrl.ok ? noUrl.error : "", /redemptionUrl/);
});

test("headers match loosely; unknown ones are listed as not stored", () => {
  const r = parseCodesCsv(
    "BonusCode, redemption_url ,Extra\nX,https://k.example/x,1\n",
    NOW,
  );
  assert.ok(r.ok);
  assert.equal(r.rows[0].redemptionUrl, "https://k.example/x");
  assert.match(r.warnings.join("\n"), /Not recognised, so not stored: Extra/);
});

test("re-importing updates, never duplicates; claimed codes are flagged", () => {
  const r = parseCodesCsv(WORKSHOP, NOW);
  assert.ok(r.ok);
  const plan = planCodes(r.rows, [
    { code: "ab12cd34", claimed: true },
    { code: "ef56gh78", claimed: false },
    { code: "zz", claimed: false },
  ]);
  assert.deepEqual(plan, {
    added: 1,
    updated: 1,
    updatedClaimed: 1,
    notInFile: 1,
  });
});
