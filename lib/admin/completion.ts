// Who hasn't scored what (docs/phase-5-spec.md, item 3). Pure: the
// published schedule's assignments, who sits at each station, and the
// scores so far, in; the problem lists out.

export type CompletionInput = {
  /** Published, uncancelled assignments. */
  assignments: { id: string; teamId: string; stationId: string }[];
  teams: { id: string; name: string }[];
  /** Judges seated at each station now. */
  seats: { stationId: string; judgeId: string }[];
  judges: { id: string; name: string }[];
  /** Each score row with how many criteria it has a value for. */
  scores: { assignmentId: string; judgeId: string; items: number }[];
  criteria: number;
};

export type TeamCompletion = {
  teamId: string;
  name: string;
  done: number;
  expected: number;
  /** Judges still to score this team (by name). */
  waitingOn: string[];
};
export type JudgeCompletion = {
  judgeId: string;
  name: string;
  done: number;
  expected: number;
};

/** A score counts once every criterion has a value. */
export function completion(input: CompletionInput): {
  teams: TeamCompletion[];
  judges: JudgeCompletion[];
} {
  const judgesAt = new Map<string, string[]>();
  for (const s of input.seats)
    judgesAt.set(s.stationId, [
      ...(judgesAt.get(s.stationId) ?? []),
      s.judgeId,
    ]);
  const judgeName = new Map(input.judges.map((j) => [j.id, j.name]));
  const done = new Set(
    input.scores
      .filter((s) => input.criteria > 0 && s.items >= input.criteria)
      .map((s) => `${s.assignmentId}|${s.judgeId}`),
  );

  const byTeam = new Map<string, TeamCompletion>();
  const byJudge = new Map<string, JudgeCompletion>();
  for (const a of input.assignments) {
    const team =
      byTeam.get(a.teamId) ??
      ({
        teamId: a.teamId,
        name: input.teams.find((t) => t.id === a.teamId)?.name ?? "?",
        done: 0,
        expected: 0,
        waitingOn: [],
      } as TeamCompletion);
    for (const judgeId of judgesAt.get(a.stationId) ?? []) {
      const ok = done.has(`${a.id}|${judgeId}`);
      team.expected++;
      if (ok) team.done++;
      else team.waitingOn.push(judgeName.get(judgeId) ?? "?");
      const judge =
        byJudge.get(judgeId) ??
        ({
          judgeId,
          name: judgeName.get(judgeId) ?? "?",
          done: 0,
          expected: 0,
        } as JudgeCompletion);
      judge.expected++;
      if (ok) judge.done++;
      byJudge.set(judgeId, judge);
    }
    byTeam.set(a.teamId, team);
  }
  // The problem list first: most missing, then by name.
  const missingFirst = <
    T extends { done: number; expected: number; name: string },
  >(
    a: T,
    b: T,
  ) =>
    b.expected - b.done - (a.expected - a.done) || a.name.localeCompare(b.name);
  return {
    teams: [...byTeam.values()].sort(missingFirst),
    judges: [...byJudge.values()].sort(missingFirst),
  };
}
