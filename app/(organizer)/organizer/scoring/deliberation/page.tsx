import Link from "next/link";
import { adminDb, currentEvent } from "@/lib/admin/data";
import { loadScoring } from "@/lib/admin/scoring";
import { rank } from "@/lib/admin/deliberation";
import { Section, table } from "../../_ui/ui";

// Reads the organizer's session; blocks on the server rather than
// prerendering (as the guard layout does).
export const instant = false;

// Deliberation (docs/phase-5-spec.md, item 4): ranked by the raw mean of
// complete scores, with how many scores each mean rests on. The per-judge
// normalised value is beside it, never the sort. Ties are for people.
export default async function DeliberationPage({
  searchParams,
}: PageProps<"/organizer/scoring/deliberation">) {
  const params = await searchParams;
  const track = typeof params.track === "string" ? params.track : "";
  const db = await adminDb();
  const event = await currentEvent(db);
  if (!event) return <p>No event exists yet.</p>;
  const data = await loadScoring(db, event.id);
  if (!data.published)
    return <p>Nothing is published yet, so there&apos;s nothing to rank.</p>;

  const assignment = new Map(data.assignments.map((a) => [a.id, a]));
  const judgeName = new Map(data.judges.map((j) => [j.id, j.name]));
  const team = new Map(data.teams.map((t) => [t.id, t]));
  const tracks = [...new Set(data.teams.flatMap((t) => t.tracks))].sort();
  const teamIds = data.teams
    .filter((t) => !track || t.tracks.includes(track))
    .map((t) => t.id);
  const ranked = rank(
    teamIds,
    data.scores
      .filter((s) => assignment.has(s.assignmentId))
      .map((s) => ({
        teamId: assignment.get(s.assignmentId)!.teamId,
        judgeId: s.judgeId,
        notes: s.notes,
        items: s.items,
      })),
    data.criteria,
  );
  const max = data.criteria.length * 5;

  return (
    <main>
      <h1 className="mb-1 text-xl font-semibold">Deliberation</h1>
      <p className="mb-3 max-w-3xl text-sm">
        Ranked by the mean of complete scores (out of {max}). The number of
        scores each mean rests on is beside it: a mean from one score is not the
        same as a mean from four. The normalised column adjusts for how harsh or
        generous each judge was; it never changes the order.{" "}
        <strong>Ties are decided by deliberation</strong>, not by this page.
        {data.lockedAt
          ? " Scoring is locked."
          : " Scoring is still open: numbers can change."}
      </p>
      <nav className="mb-4 flex flex-wrap gap-3 text-sm">
        <span>Track:</span>
        <Link
          href="/organizer/scoring/deliberation"
          className={track ? "underline" : "font-bold"}
        >
          All teams
        </Link>
        {tracks.map((t) => (
          <Link
            key={t}
            href={`/organizer/scoring/deliberation?track=${encodeURIComponent(t)}`}
            className={track === t ? "font-bold" : "underline"}
          >
            {t}
          </Link>
        ))}
      </nav>
      <Section
        title={
          track
            ? `${track} (${ranked.length} teams)`
            : `All teams (${ranked.length})`
        }
      >
        <table className={table}>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Team</th>
              <th>Mean</th>
              <th>Scores</th>
              <th>Normalised</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r) => {
              const t = team.get(r.teamId);
              return (
                <tr key={r.teamId}>
                  <td>
                    {r.mean === null ? "–" : r.rank}
                    {r.tied ? " (tie)" : ""}
                  </td>
                  <td>
                    <span className="font-semibold">{t?.name}</span>
                    {t?.devpostUrl && (
                      <>
                        {" "}
                        <a
                          href={t.devpostUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs underline"
                        >
                          Devpost
                        </a>
                      </>
                    )}
                    {t && t.tracks.length > 0 && (
                      <div className="text-xs text-gray-600">
                        {t.tracks.join(", ")}
                      </div>
                    )}
                  </td>
                  <td>{r.mean ?? "no complete scores"}</td>
                  <td>{r.n}</td>
                  <td>{r.normalised ?? "–"}</td>
                  <td>
                    {r.notes.length === 0 ? (
                      ""
                    ) : (
                      <details>
                        <summary className="cursor-pointer text-sm underline">
                          {r.notes.length} note{r.notes.length === 1 ? "" : "s"}
                        </summary>
                        <ul className="mt-1 space-y-1 text-sm">
                          {r.notes.map((n, i) => (
                            <li key={i}>
                              <strong>{judgeName.get(n.judgeId)}:</strong>{" "}
                              {n.text}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>
    </main>
  );
}
