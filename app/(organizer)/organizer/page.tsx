import Link from "next/link";
import {
  adminDb,
  currentEvent,
  loadActiveTeams,
  loadCheckinEmails,
  loadCodePool,
  loadJudges,
  loadSchedules,
  loadStations,
  loadTeams,
} from "@/lib/admin/data";
import { preflight } from "@/lib/scheduler";
import { missingCodes, poolSummary } from "@/lib/admin/codes";
import { MAX_TEAM_SIZE } from "@/lib/checkin/form";
import { MissingCodesTable, PoolAlarms } from "./codes/missing";
import { clockWithZone, dayLabel } from "@/lib/team/view";
import { Section, table } from "./_ui/ui";

// Reads the organizer's session; blocks on the server rather than
// prerendering (as the guard layout does).
export const instant = false;

// Plain overview: what the event has, and where to go next.
export default async function OrganizerPage() {
  const db = await adminDb();
  const event = await currentEvent(db);
  if (!event) return <p>No event exists yet.</p>;
  const [judges, stations, teams, schedules, emails, pool, active] =
    await Promise.all([
      loadJudges(db, event.id),
      loadStations(db, event.id),
      loadTeams(db, event.id),
      loadSchedules(db, event.id),
      loadCheckinEmails(db, event.id),
      loadCodePool(db, event.id),
      loadActiveTeams(db, event.id),
    ]);
  const codes = poolSummary(pool, active, MAX_TEAM_SIZE);
  const codesMissing = missingCodes(active, pool);
  const noDevpost = active.filter((t) => !t.devpostUrl);
  const noGithub = active.filter((t) => t.githubUrls.length === 0);
  const emailProblems = emails.filter((e) => e.status === "failed" || e.stuck);
  const emailsSent = emails.filter((e) => e.status === "sent").length;
  const emailsSending = emails.filter(
    (e) => e.status === "sending" && !e.stuck,
  ).length;
  const checkedIn = teams.filter((t) => t.checkedIn && !t.withdrawn);
  const check = preflight(
    judges.map((j) => j.affiliation),
    checkedIn.map((t) => new Set(t.sponsors)),
  );
  const published = schedules.find((s) => s.status === "published");
  const drafts = schedules.filter((s) => s.status === "draft");

  return (
    <main>
      <h1 className="mb-4 text-xl font-semibold">{event.name}</h1>
      <PoolAlarms summary={codes} />
      <Section title="At a glance">
        <table className={`${table} w-auto`}>
          <tbody>
            <tr>
              <th>Judging start</th>
              <td>
                <Link href="/organizer/event" className="underline">
                  {event.judging_starts_at
                    ? `${dayLabel(event.judging_starts_at, event.timezone)}, ${clockWithZone(event.judging_starts_at, event.timezone)}`
                    : "not set"}
                </Link>
                {!event.judging_starts_at &&
                  " — team pages can't say when to check back"}
              </td>
            </tr>
            <tr>
              <th>Help location</th>
              <td>
                <Link href="/organizer/event" className="underline">
                  {event.help_location ?? "not set"}
                </Link>
                {!event.help_location &&
                  " — participants are told \u201cthe help desk\u201d"}
              </td>
            </tr>
            <tr>
              <th>Teams checked in</th>
              <td>
                {checkedIn.length} of {teams.length}
                {teams.some((t) => t.withdrawn) &&
                  ` (${teams.filter((t) => t.withdrawn).length} withdrawn)`}
              </td>
            </tr>
            <tr>
              <th>Check-in emails</th>
              <td>
                {emails.length === 0
                  ? "none yet"
                  : `${emailsSent} team(s) all sent` +
                    (emailsSending ? `, ${emailsSending} sending now` : "") +
                    (emailProblems.length
                      ? `, ${emailProblems.length} with emails not sent (below)`
                      : "")}
              </td>
            </tr>
            <tr>
              <th>AWS codes</th>
              <td>
                <Link href="/organizer/codes" className="underline">
                  {codes.workshop.free} workshop, {codes.kiro.free} Kiro free
                </Link>
                {codesMissing.length > 0 &&
                  ` — ${codesMissing.length} team(s) missing codes (below)`}
              </td>
            </tr>
            <tr>
              <th>Devpost links</th>
              <td>
                {active.length - noDevpost.length} of {active.length} teams
                {noDevpost.length > 0 && " — the rest are listed below"}
              </td>
            </tr>
            <tr>
              <th>GitHub links</th>
              <td>
                {active.length - noGithub.length} of {active.length} teams
                {noGithub.length > 0 && " — the rest are listed below"}
              </td>
            </tr>
            <tr>
              <th>Judges</th>
              <td>
                <Link href="/organizer/judges" className="underline">
                  {judges.length}
                </Link>
                {check.warnings.length > 0 &&
                  ` — ${check.warnings.length} track(s) under-staffed`}
              </td>
            </tr>
            <tr>
              <th>Stations</th>
              <td>
                <Link href="/organizer/panels" className="underline">
                  {stations.length}
                </Link>
              </td>
            </tr>
            <tr>
              <th>Published schedule</th>
              <td>
                {published ? (
                  <Link
                    href={`/organizer/schedules/${published.id}`}
                    className="underline"
                  >
                    v{published.version}
                  </Link>
                ) : (
                  "none"
                )}
              </td>
            </tr>
            <tr>
              <th>Drafts awaiting review</th>
              <td>
                {drafts.length === 0
                  ? "none"
                  : drafts.map((d) => (
                      <Link
                        key={d.id}
                        href={`/organizer/schedules/${d.id}`}
                        className="mr-2 underline"
                      >
                        v{d.version}
                      </Link>
                    ))}
              </td>
            </tr>
          </tbody>
        </table>
      </Section>
      {emailProblems.length > 0 && (
        <Section title="Check-in emails not sent">
          <p className="mb-2 text-sm">
            These people have no sign-in link. Their team&apos;s join code works
            without one: read it out, or the captain can fix the address and
            resend on their teammates page.
          </p>
          <table className={table}>
            <thead>
              <tr>
                <th>Team</th>
                <th>Join code</th>
                <th>Not sent to</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {emailProblems.map((e) => (
                <tr key={e.joinCode}>
                  <td>{e.teamName}</td>
                  <td className="font-mono">{e.joinCode}</td>
                  <td>{e.stuck ? "possibly everyone" : e.failed.join(", ")}</td>
                  <td>
                    {e.stuck
                      ? `still "sending" since ${clockWithZone(e.updatedAt, event.timezone)}: the send was cut short`
                      : (e.error ?? "")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
      {codesMissing.length > 0 && (
        <Section title="Teams missing AWS codes">
          <p className="mb-2 text-sm">
            Their check-in worked; they just have no code to show yet.{" "}
            <Link href="/organizer/codes" className="underline">
              Import more or assign what&apos;s free
            </Link>
            .
          </p>
          <MissingCodesTable missing={codesMissing} summary={codes} />
        </Section>
      )}
      {noDevpost.length > 0 && (
        <Section title={`Teams without a Devpost link (${noDevpost.length})`}>
          <p className="mb-2 text-sm">
            Any member can add it on their team page (/team), before judging or
            after. Judges see &ldquo;no link provided&rdquo; until then.
          </p>
          <details>
            <summary className="cursor-pointer text-sm">Who to chase</summary>
            <table className={`${table} mt-2`} data-testid="no-devpost">
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Join code</th>
                  <th>Captain</th>
                  <th>Phone</th>
                </tr>
              </thead>
              <tbody>
                {noDevpost.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td className="font-mono">{t.joinCode}</td>
                    <td>{t.captainEmail ?? ""}</td>
                    <td>{t.contactPhone ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </Section>
      )}
      {noGithub.length > 0 && (
        <Section title={`Teams without a GitHub link (${noGithub.length})`}>
          <p className="mb-2 text-sm">
            Any member can add them on their team page (/team). Kept for our
            records; judges don&apos;t see them.
          </p>
          <details>
            <summary className="cursor-pointer text-sm">Who to chase</summary>
            <table className={`${table} mt-2`} data-testid="no-github">
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Join code</th>
                  <th>Captain</th>
                  <th>Phone</th>
                </tr>
              </thead>
              <tbody>
                {noGithub.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td className="font-mono">{t.joinCode}</td>
                    <td>{t.captainEmail ?? ""}</td>
                    <td>{t.contactPhone ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </Section>
      )}
      <p className="text-sm">
        <Link href="/organizer/generate" className="underline">
          Generate a new draft
        </Link>
      </p>
    </main>
  );
}
