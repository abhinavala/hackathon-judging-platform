import Link from "next/link";
import {
  adminDb,
  currentEvent,
  loadJudges,
  loadSchedules,
  loadStations,
  loadTeams,
} from "@/lib/admin/data";
import { preflight } from "@/lib/scheduler";
import { Section, table } from "./_ui/ui";

// Plain overview: what the event has, and where to go next.
export default async function OrganizerPage() {
  const db = await adminDb();
  const event = await currentEvent(db);
  if (!event) return <p>No event exists yet.</p>;
  const [judges, stations, teams, schedules] = await Promise.all([
    loadJudges(db, event.id),
    loadStations(db, event.id),
    loadTeams(db, event.id),
    loadSchedules(db, event.id),
  ]);
  const checkedIn = teams.filter((t) => t.checkedIn);
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
              <th>Teams checked in</th>
              <td>
                {checkedIn.length} of {teams.length}
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
      <p className="text-sm">
        <Link href="/organizer/generate" className="underline">
          Generate a new draft
        </Link>
      </p>
    </main>
  );
}
