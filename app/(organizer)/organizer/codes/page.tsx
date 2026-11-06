import Link from "next/link";
import {
  adminDb,
  currentEvent,
  loadActiveTeams,
  loadCodePool,
} from "@/lib/admin/data";
import { missingCodes, poolSummary } from "@/lib/admin/codes";
import { MAX_TEAM_SIZE } from "@/lib/checkin/form";
import { button, Flash, Section, table } from "../_ui/ui";
import { assignMissingCodes } from "./actions";
import { CodesImport } from "./codes-import";
import { MissingCodesTable, PoolAlarms } from "./missing";

export const instant = false;

// AWS codes: what's left in the pool, who is missing one, the import, and
// the workshop codes with AWS's own details for support. Participants see
// their codes on /team only; never on /t/CODE.
export default async function CodesPage({
  searchParams,
}: PageProps<"/organizer/codes">) {
  const params = await searchParams;
  const db = await adminDb();
  const event = await currentEvent(db);
  if (!event) return <p>No event exists yet.</p>;
  const [pool, teams] = await Promise.all([
    loadCodePool(db, event.id),
    loadActiveTeams(db, event.id),
  ]);
  const summary = poolSummary(pool, teams, MAX_TEAM_SIZE);
  const missing = missingCodes(teams, pool);
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const workshop = pool
    .filter((c) => c.kind === "workshop")
    .sort(
      (a, b) =>
        Number(b.claimed) - Number(a.claimed) ||
        (teamName.get(a.teamId ?? "") ?? "").localeCompare(
          teamName.get(b.teamId ?? "") ?? "",
        ),
    );
  const kiro = pool.filter((c) => c.kind === "kiro" && c.claimed);

  return (
    <main>
      <h1 className="mb-4 text-xl font-semibold">AWS codes</h1>
      <Flash params={params} />
      <PoolAlarms summary={summary} />
      <Section title="The pool">
        <table className={`${table} w-auto`}>
          <thead>
            <tr>
              <th></th>
              <th>Imported</th>
              <th>Handed out</th>
              <th>Free</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>Workshop (one per team)</th>
              <td>{summary.workshop.imported}</td>
              <td>{summary.workshop.claimed}</td>
              <td>{summary.workshop.free}</td>
            </tr>
            <tr>
              <th>Kiro (one per person)</th>
              <td>{summary.kiro.imported}</td>
              <td>{summary.kiro.claimed}</td>
              <td>{summary.kiro.free}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-sm">
          {teams.length} teams checked in,{" "}
          {teams.reduce((n, t) => n + t.members.length, 0)} people. Codes are
          handed out at check-in and when a teammate is added, and never move to
          anyone else.
          {summary.headroom ? ` ${summary.headroom}` : ""}
        </p>
      </Section>

      <Section title={`Teams missing codes (${missing.length})`}>
        {missing.length === 0 ? (
          <p>Every checked-in team and person has their codes.</p>
        ) : (
          <>
            <MissingCodesTable missing={missing} summary={summary} />
            <form action={assignMissingCodes} className="mt-2">
              <button className={button}>Assign missing codes</button>{" "}
              <span className="text-sm">
                from what&apos;s free (importing does this too)
              </span>
            </form>
          </>
        )}
      </Section>

      <Section title="Import from AWS">
        <p className="mb-2 text-sm">
          Nothing is written until you press Import after the preview. Importing
          the same file again updates those codes (on Saturday, re-export the
          workshop file to see who has joined); it never adds a second copy.
        </p>
        <CodesImport />
      </Section>

      <Section title="Workshop codes (for support)">
        {workshop.length === 0 ? (
          <p>None imported yet.</p>
        ) : (
          <table className={table} data-testid="workshop-codes">
            <thead>
              <tr>
                <th>Code</th>
                <th>Our team</th>
                <th>AWS team name</th>
                <th>AWS account ID</th>
                <th>State</th>
                <th>Joined</th>
                <th>Last joined</th>
              </tr>
            </thead>
            <tbody>
              {workshop.map((c) => (
                <tr key={c.code}>
                  <td className="font-mono">{c.code}</td>
                  <td>
                    {c.claimed
                      ? (teamName.get(c.teamId ?? "") ?? "(team removed)")
                      : "free"}
                  </td>
                  <td>{c.awsTeamName ?? ""}</td>
                  <td className="font-mono">{c.awsAccountId ?? ""}</td>
                  <td>{c.state ?? ""}</td>
                  <td>{c.participantCount ?? ""}</td>
                  <td>{c.lastJoined ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title={`Kiro codes handed out (${kiro.length})`}>
        <details>
          <summary className="cursor-pointer text-sm">
            Show who has which
          </summary>
          <table className={`${table} mt-2`}>
            <thead>
              <tr>
                <th>Code</th>
                <th>Person</th>
                <th>Team</th>
              </tr>
            </thead>
            <tbody>
              {kiro.map((c) => (
                <tr key={c.code}>
                  <td className="font-mono">{c.code}</td>
                  <td>{c.claimedEmail}</td>
                  <td>{teamName.get(c.teamId ?? "") ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </Section>
      <p className="text-sm">
        <Link href="/organizer" className="underline">
          Back to the overview
        </Link>
      </p>
    </main>
  );
}
