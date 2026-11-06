import { test } from "node:test";
import assert from "node:assert/strict";
import { completion } from "../../lib/admin/completion.ts";

const input = {
  assignments: [
    { id: "a1", teamId: "t1", stationId: "s1" },
    { id: "a2", teamId: "t1", stationId: "s2" },
    { id: "a3", teamId: "t2", stationId: "s1" },
    { id: "a4", teamId: "t2", stationId: "s2" },
  ],
  teams: [
    { id: "t1", name: "Beacon" },
    { id: "t2", name: "Anchor" },
  ],
  seats: [
    { stationId: "s1", judgeId: "j1" },
    { stationId: "s1", judgeId: "j2" },
    { stationId: "s2", judgeId: "j3" },
    { stationId: "s2", judgeId: "j4" },
  ],
  judges: ["j1", "j2", "j3", "j4"].map((id) => ({
    id,
    name: id.toUpperCase(),
  })),
  scores: [
    { assignmentId: "a1", judgeId: "j1", items: 4 },
    { assignmentId: "a1", judgeId: "j2", items: 4 },
    { assignmentId: "a2", judgeId: "j3", items: 4 },
    { assignmentId: "a2", judgeId: "j4", items: 2 }, // partial: not done
    { assignmentId: "a3", judgeId: "j1", items: 4 },
  ],
  criteria: 4,
};

test("each team expects one score per judge at each of its stations, and counts only complete ones", () => {
  const { teams } = completion(input);
  const beacon = teams.find((t) => t.name === "Beacon")!;
  const anchor = teams.find((t) => t.name === "Anchor")!;
  assert.deepEqual(
    [beacon.done, beacon.expected, beacon.waitingOn],
    [3, 4, ["J4"]],
  );
  assert.deepEqual([anchor.done, anchor.expected], [1, 4]);
  assert.deepEqual(anchor.waitingOn.sort(), ["J2", "J3", "J4"]);
});

test("the problem list comes first: most missing at the top", () => {
  const { teams, judges } = completion(input);
  assert.deepEqual(
    teams.map((t) => t.name),
    ["Anchor", "Beacon"],
  );
  assert.deepEqual(
    judges.map((j) => `${j.name} ${j.done}/${j.expected}`),
    ["J4 0/2", "J2 1/2", "J3 1/2", "J1 2/2"],
  );
});

test("no rubric yet means nothing counts as done", () => {
  const { teams } = completion({ ...input, criteria: 0 });
  assert.ok(teams.every((t) => t.done === 0));
});
