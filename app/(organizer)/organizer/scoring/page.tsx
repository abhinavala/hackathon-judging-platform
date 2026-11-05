import { adminDb, currentEvent } from "@/lib/admin/data";
import { completion } from "@/lib/admin/completion";
import { Section, table } from "../_ui/ui";

// Reads the organizer's session; blocks on the server rather than
// prerendering (as the guard layout does).
export const instant = false;

// Who hasn't scored what (docs/phase-5-spec.md, item 3). The default view is
// the problem list: teams and judges with scores missing, most missing first.
export default async function ScoringPage() {
  const db = await adminDb();
  const event = await currentEvent(db);
  if (!event) return <p>No event exists yet.</p>;

  const { data: published } = await db
    .from("schedules")
    .select("id, version")
    .eq("event_id", event.id)
    .eq("status", "published")
    .eq("round", 1)
    .maybeSingle();
  if (!published)
    return (
      <main>
        <h1 className="mb-4 text-xl font-semibold">Scoring</h1>
        <p>Nothing is published yet, so there&apos;s nothing to score.</p>
      </main>
    );

  const [{ data: assignments }, { data: seats }, { data: judges }, rubric] =
    await Promise.all([
      db
        .from("assignments")
        .select("id, team_id, panel_id, teams(name)")
        .eq("schedule_id", published.id)
        .neq("status", "cancelled"),
      db.from("panel_judges").select("panel_id, judge_id"),
      db.from("judges").select("id, full_name").eq("event_id", event.id),
      db
        .from("rubric_criteria")
        .select("id", { count: "exact", head: true })
        .eq("event_id", event.id),
    ]);
  const ids = (assignments ?? []).map((a) => a.id);
  const { data: scores } = ids.length
    ? await db
        .from("scores")
        .select("assignment_id, judge_id, score_items(id)")
        .in("assignment_id", ids)
    : { data: [] };

  const { teams, judges: byJudge } = completion({
    assignments: (assignments ?? []).map((a) => ({
      id: a.id,
      teamId: a.team_id,
      stationId: a.panel_id,
    })),
    teams: (assignments ?? []).map((a) => ({
      id: a.team_id,
      name: a.teams?.name ?? "?",
    })),
    seats: (seats ?? []).map((s) => ({
      stationId: s.panel_id,
      judgeId: s.judge_id,
    })),
    judges: (judges ?? []).map((j) => ({ id: j.id, name: j.full_name })),
    scores: (scores ?? []).map((s) => ({
      assignmentId: s.assignment_id,
      judgeId: s.judge_id,
      items: s.score_items.length,
    })),
    criteria: rubric.count ?? 0,
  });
  const done = teams.reduce((n, t) => n + t.done, 0);
  const expected = teams.reduce((n, t) => n + t.expected, 0);
  const missingTeams = teams.filter((t) => t.done < t.expected);
  const missingJudges = byJudge.filter((j) => j.done < j.expected);

  return (
    <main>
      <h1 className="mb-1 text-xl font-semibold">Scoring</h1>
      <p className="mb-4 text-sm">
        Published v{published.version}. A score counts once all{" "}
        {rubric.count ?? 0} criteria are filled in.
      </p>
      <p className="mb-6 text-2xl font-bold">
        {done} of {expected} scores in
        {missingTeams.length === 0 && expected > 0
          ? ": every team is fully scored."
          : `: ${missingTeams.length} team${missingTeams.length === 1 ? "" : "s"} still missing scores.`}
      </p>

      <Section title={`Teams missing scores (${missingTeams.length})`}>
        {missingTeams.length === 0 ? (
          <p className="text-sm">None.</p>
        ) : (
          <table className={table}>
            <thead>
              <tr>
                <th>Team</th>
                <th>Scores</th>
                <th>Waiting on</th>
              </tr>
            </thead>
            <tbody>
              {missingTeams.map((t) => (
                <tr key={t.teamId}>
                  <td className="font-semibold">{t.name}</td>
                  <td>
                    {t.done} of {t.expected}
                  </td>
                  <td>{t.waitingOn.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title={`Judges with teams left (${missingJudges.length})`}>
        {missingJudges.length === 0 ? (
          <p className="text-sm">None.</p>
        ) : (
          <table className={table}>
            <thead>
              <tr>
                <th>Judge</th>
                <th>Teams scored</th>
              </tr>
            </thead>
            <tbody>
              {missingJudges.map((j) => (
                <tr key={j.judgeId}>
                  <td className="font-semibold">{j.name}</td>
                  <td>
                    {j.done} of {j.expected}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section
        title={`Fully scored (${teams.length - missingTeams.length} teams, ${byJudge.length - missingJudges.length} judges)`}
      >
        <p className="text-sm">
          {teams
            .filter((t) => t.done >= t.expected)
            .map((t) => t.name)
            .join(", ") || "None yet."}
        </p>
      </Section>
    </main>
  );
}
