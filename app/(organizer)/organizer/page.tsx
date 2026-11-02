import Link from "next/link";
import {
  adminDb,
  currentEvent,
  loadCheckinEmails,
  loadJudges,
  loadSchedules,
  loadStations,
  loadTeams,
} from "@/lib/admin/data";
import { preflight } from "@/lib/scheduler";
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
  const [judges, stations, teams, schedules, emails] = await Promise.all([
    loadJudges(db, event.id),
    loadStations(db, event.id),
    loadTeams(db, event.id),
    loadSchedules(db, event.id),
    loadCheckinEmails(db, event.id),
  ]);
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
      <p className="text-sm">
        <Link href="/organizer/generate" className="underline">
          Generate a new draft
        </Link>
      </p>
    </main>
  );
}
