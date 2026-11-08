import { test } from "node:test";
import assert from "node:assert/strict";
import {
  exportRows,
  rank,
  judgeLabel,
  byJudge,
} from "../../lib/admin/deliberation.ts";

const C = ["a", "b", "c", "d"].map((id) => ({ id, label: id.toUpperCase() }));
const s = (teamId: string, judgeId: string, vals: number[], notes = "") => ({
  teamId,
  judgeId,
  notes,
  items: vals.map((value, i) => ({ criterionId: C[i].id, value })),
});
const scores = [
  s("t1", "harsh", [3, 3, 3, 3], "solid"),
  s("t1", "kind", [5, 5, 5, 5]),
  s("t2", "harsh", [2, 2, 2, 2]),
  s("t2", "kind", [5, 5, 5, 4]),
  s("t3", "kind", [4, 4, 4, 4]),
  s("t3", "harsh", [4, 4, 4]), // partial: doesn't count
];

test("ranked by the raw mean of complete scores, with how many it's based on", () => {
  const r = rank(["t1", "t2", "t3"], scores, C);
  assert.deepEqual(
    r.map((x) => [x.teamId, x.mean, x.n]),
    [
      ["t1", 16, 2],
      ["t3", 16, 1],
      ["t2", 13.5, 2],
    ],
  );
});

test("equal means are a tie, not a made-up order", () => {
  const r = rank(["t1", "t2", "t3"], scores, C);
  assert.deepEqual(
    r.slice(0, 2).map((x) => [x.rank, x.tied]),
    [
      [1, true],
      [1, true],
    ],
  );
  assert.equal(r[2].rank, 3);
});

test("the normalised column is beside the ranking and doesn't reorder it", () => {
  const r = rank(["t1", "t2", "t3"], scores, C);
  // t1 is the harsh judge's best team: normalised above zero.
  assert.ok(r.find((x) => x.teamId === "t1")!.normalised! > 0);
  // The order is still by raw mean.
  assert.deepEqual(
    r.map((x) => x.teamId),
    ["t1", "t3", "t2"],
  );
});

test("a team with no complete score has no mean and sinks", () => {
  const r = rank(["t1", "t4"], scores, C);
  assert.deepEqual([r[1].teamId, r[1].mean, r[1].n], ["t4", null, 0]);
});

test("notes are kept per judge", () => {
  const r = rank(["t1"], scores, C);
  assert.deepEqual(r[0].notes, [{ judgeId: "harsh", text: "solid" }]);
});

test("export: one row per team per judge per criterion, with totals and completeness", () => {
  const rows = exportRows(scores, C, { team: (x) => x, judge: (x) => x });
  assert.deepEqual(rows[0], [
    "Team",
    "Judge",
    "Criterion",
    "Value",
    "Judge's total",
    "Complete",
    "Notes",
  ]);
  assert.equal(rows.length, 1 + scores.length * C.length);
  assert.deepEqual(rows[1], ["t1", "harsh", "A", "3", "12", "yes", "solid"]);
  const partial = rows.filter((r) => r[0] === "t3" && r[1] === "harsh");
  assert.deepEqual(
    partial.map((r) => r[3]),
    ["4", "4", "4", ""],
  );
  assert.ok(partial.every((r) => r[5] === "no"));
});

test("judgeLabel names the affiliation, or just the name when there is none", () => {
  assert.equal(judgeLabel("Marcus Chen", "AWS"), "Marcus Chen (AWS)");
  assert.equal(judgeLabel("Grace Liu", null), "Grace Liu");
  assert.equal(judgeLabel("Grace Liu", "  "), "Grace Liu");
});

test("byJudge lists every judge with a score, and marks the incomplete ones", () => {
  const crit = [
    { id: "c1", label: "A" },
    { id: "c2", label: "B" },
    { id: "c3", label: "C" },
  ];
  const lines = byJudge(
    "t1",
    [
      {
        teamId: "t1",
        judgeId: "j1",
        notes: "",
        items: [
          { criterionId: "c1", value: 4 },
          { criterionId: "c2", value: 5 },
          { criterionId: "c3", value: 3 },
        ],
      },
      {
        teamId: "t1",
        judgeId: "j2",
        notes: "",
        items: [
          { criterionId: "c1", value: 2 },
          { criterionId: "c2", value: 2 },
        ],
      },
      { teamId: "t2", judgeId: "j1", notes: "", items: [] },
    ],
    crit,
  );
  assert.deepEqual(lines, [
    { judgeId: "j1", total: 12, filled: 3, complete: true },
    { judgeId: "j2", total: 4, filled: 2, complete: false },
  ]);
});

test("exportRows: extra columns go after the standard seven, which are unchanged", () => {
  const crit = [{ id: "c1", label: "Impact" }];
  const name = { team: () => "T", judge: () => "J" };
  const plain = exportRows(
    [
      {
        teamId: "t",
        judgeId: "j",
        notes: "n",
        items: [{ criterionId: "c1", value: 3 }],
      },
    ],
    crit,
    name,
  );
  const extra = exportRows(
    [
      {
        teamId: "t",
        judgeId: "j",
        notes: "n",
        items: [{ criterionId: "c1", value: 3 }],
        extra: ["AWS", "Station 3"],
      },
    ],
    crit,
    name,
    ["Judge affiliation", "Station"],
  );
  assert.deepEqual(extra[0].slice(0, 7), plain[0]);
  assert.deepEqual(extra[0].slice(7), ["Judge affiliation", "Station"]);
  assert.deepEqual(extra[1], [...plain[1], "AWS", "Station 3"]);
});
