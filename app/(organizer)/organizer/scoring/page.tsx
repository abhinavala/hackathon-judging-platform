import Link from "next/link";
import { adminDb, currentEvent } from "@/lib/admin/data";
import { completion } from "@/lib/admin/completion";
import { loadScoring } from "@/lib/admin/scoring";
import { Flash, Section, button, table } from "../_ui/ui";
import { lockScoring, unlockScoring } from "./actions";

// Reads the organizer's session; blocks on the server rather than
// prerendering (as the guard layout does).
export const instant = false;

// Who hasn't scored what (docs/phase-5-spec.md, item 3). The default view is
// the problem list: teams and judges with scores missing, most missing first.
export default async function ScoringPage({
  searchParams,
}: PageProps<"/organizer/scoring">) {
  const params = await searchParams;
  const db = await adminDb();
  const event = await currentEvent(db);
  if (!event) return <p>No event exists yet.</p>;
  const data = await loadScoring(db, event.id);
  const published = data.published;
  if (!published)
    return (
      <main>
        <h1 className="mb-4 text-xl font-semibold">Scoring</h1>
        <p>Nothing is published yet, so there&apos;s nothing to score.</p>
      </main>
    );

  const { teams, judges: byJudge } = completion({
    assignments: data.assignments,
    teams: data.teams,
    seats: data.seats,
    judges: data.judges,
    scores: data.scores.map((s) => ({
      assignmentId: s.assignmentId,
      judgeId: s.judgeId,
      items: s.items.length,
    })),
    criteria: data.criteria.length,
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
        {data.criteria.length} criteria are filled in.{" "}
        <Link href="/organizer/scoring/deliberation" className="underline">
          Deliberation
        </Link>{" "}
        ·{" "}
        <a href="/organizer/scoring/export" className="underline">
          Download every score (CSV)
        </a>
      </p>
      <Flash params={params} />
      <form
        action={data.lockedAt ? unlockScoring : lockScoring}
        className={`mb-6 rounded border-2 p-3 ${data.lockedAt ? "border-gray-500" : "border-amber-600"}`}
      >
        <p className="mb-2 font-semibold">
          {data.lockedAt
            ? "Scoring is locked: judges can see their scores but not change them."
            : "Scoring is open: judges can enter and change scores."}
        </p>
        <button className={button}>
          {data.lockedAt
            ? "Unlock scoring"
            : "Lock scoring (before deliberating)"}
        </button>
      </form>
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
