import { test } from "node:test";
import assert from "node:assert/strict";
import {
  missingCodes,
  poolSummary,
  type PoolCode,
} from "../../lib/admin/codes.ts";

const code = (p: Partial<PoolCode>): PoolCode => ({
  kind: "kiro",
  code: "X",
  teamId: null,
  memberId: null,
  claimedEmail: null,
  claimed: false,
  awsTeamName: null,
  awsAccountId: null,
  state: null,
  participantCount: null,
  lastJoined: null,
  ...p,
});

const teams = [
  {
    id: "t1",
    name: "Alpha",
    joinCode: "AAAA-1111",
    members: [
      { id: "m1", email: "a@x" },
      { id: "m2", email: "b@x" },
    ],
  },
  {
    id: "t2",
    name: "Bravo",
    joinCode: "BBBB-2222",
    members: [{ id: "m3", email: "c@x" }],
  },
];

test("missingCodes lists the team without a workshop code first, and who lacks Kiro", () => {
  const pool = [
    code({ kind: "workshop", code: "W1", teamId: "t2", claimed: true }),
    code({ code: "K1", teamId: "t1", memberId: "m1", claimed: true }),
    code({ code: "K2", teamId: "t2", memberId: "m3", claimed: true }),
  ];
  assert.deepEqual(missingCodes(teams, pool), [
    {
      teamId: "t1",
      teamName: "Alpha",
      joinCode: "AAAA-1111",
      workshop: true,
      kiro: ["b@x"],
    },
  ]);
});

test("poolSummary is loud when empty or low", () => {
  assert.equal(poolSummary([], teams, 6).alarms.length, 2);
  const pool = [
    ...Array.from({ length: 10 }, (_, i) =>
      code({ kind: "workshop", code: `W${i}` }),
    ),
    ...Array.from({ length: 30 }, (_, i) =>
      code({ code: `K${i}`, claimed: i < 10 }),
    ),
  ];
  const s = poolSummary(pool, teams, 6);
  assert.deepEqual(s.kiro, { imported: 30, claimed: 10, free: 20 });
  assert.match(s.alarms.join(" "), /Only 20 Kiro codes left/);
});
