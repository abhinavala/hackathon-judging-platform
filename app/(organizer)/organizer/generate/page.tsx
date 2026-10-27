import {
  adminDb,
  currentEvent,
  loadJudges,
  loadSchedules,
  loadStations,
  loadTeams,
} from "@/lib/admin/data";
import { utcToZonedLocal } from "@/lib/admin/time";
import { preflight } from "@/lib/scheduler";
import { Flash, Section, button, input, table } from "../_ui/ui";
import { generateDraft } from "./actions";

// Reads the organizer's session; blocks on the server rather than
// prerendering (as the guard layout does).
export const instant = false;

export default async function GeneratePage({
  searchParams,
}: PageProps<"/organizer/generate">) {
  const params = await searchParams;
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
  const nextVersion = Math.max(0, ...schedules.map((s) => s.version)) + 1;
  const staffed = stations.filter((s) => s.judgeIds.length === 2).length;

  // Default start: the event's judging start (what team pages announce);
  // failing that the published schedule's first slot, then 10:00 the day
  // after check-in closes.
  const published = schedules.find((s) => s.status === "published");
  let defaultStart = event.judging_starts_at
    ? utcToZonedLocal(event.judging_starts_at, event.timezone)
    : "";
  if (!defaultStart && published) {
    const { data } = await db
      .from("slots")
      .select("starts_at")
      .eq("schedule_id", published.id)
      .order("index")
      .limit(1)
      .maybeSingle();
    if (data) defaultStart = utcToZonedLocal(data.starts_at, event.timezone);
  }
  if (!defaultStart && event.checkin_closes_at) {
    const closes = utcToZonedLocal(
      event.checkin_closes_at,
      event.timezone,
    ).slice(0, 10);
    const next = new Date(`${closes}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    defaultStart = `${next.toISOString().slice(0, 10)}T10:00`;
  }

  return (
    <main>
      <h1 className="mb-4 text-xl font-semibold">
        Generate a draft schedule — {event.name}
      </h1>
      <Flash params={params} />
      <p className="mb-4 max-w-3xl text-sm">
        Generating writes a <strong>draft</strong> (v{nextVersion}). Nothing
        changes for participants until you review it and publish it.
      </p>

      <Section title="Pre-flight">
        <p className="text-sm">
          {judges.length} judges, {checkedIn.length} checked-in teams →{" "}
          {check.nPanels} stations × {check.nSlots} slots.{" "}
          {check.warnings.length === 0
            ? "Every track can be fully covered."
            : `${check.warnings.length} track${check.warnings.length === 1 ? "" : "s"} cannot be fully covered (see Judges).`}
        </p>
      </Section>

      <form action={generateDraft}>
        <Section title="Timing">
          <div className="flex flex-wrap items-end gap-4 text-sm">
            <label className="flex flex-col">
              First slot starts ({event.timezone})
              <input
                name="start"
                type="datetime-local"
                defaultValue={defaultStart}
                required
                className={input}
              />
            </label>
            <label className="flex flex-col">
              Slot length (minutes)
              <input
                name="slotMinutes"
                type="number"
                min={1}
                max={60}
                defaultValue={event.slot_minutes}
                className={`${input} w-24`}
              />
            </label>
            <label className="flex flex-col">
              Slot count (blank = the minimum the scheduler needs)
              <input
                name="slotCount"
                type="number"
                min={1}
                className={`${input} w-24`}
              />
            </label>
          </div>
        </Section>

        <Section title="Stations">
          <div className="space-y-1 text-sm">
            <label className="flex gap-2">
              <input type="radio" name="mode" value="auto" defaultChecked />
              Form judge pairings automatically from the roster (track-aware)
            </label>
            <label className="flex gap-2">
              <input
                type="radio"
                name="mode"
                value="keep"
                disabled={staffed < 2}
              />
              Keep the stations&apos; current judges ({staffed} station
              {staffed === 1 ? "" : "s"} with two judges)
            </label>
            <label className="mt-2 flex items-center gap-2">
              Seed
              <input
                name="seed"
                type="number"
                defaultValue={nextVersion}
                className={`${input} w-24`}
              />
              <span className="text-xs">
                Same inputs and seed give the same schedule.
              </span>
            </label>
          </div>
        </Section>

        <Section
          title={`Teams (${checkedIn.length} of ${teams.length} checked in, checked by default)`}
        >
          <table className={table}>
            <thead>
              <tr>
                <th>Include</th>
                <th>Team</th>
                <th>Tracks</th>
                <th>Checked in</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr key={t.id}>
                  <td>
                    <input
                      type="checkbox"
                      name="team"
                      value={t.id}
                      defaultChecked={t.checkedIn}
                      aria-label={`Include ${t.name}`}
                    />
                  </td>
                  <td>{t.name}</td>
                  <td>{t.tracks.join(", ") || "grand prize only"}</td>
                  <td>{t.checkedIn ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        {published && (
          <div
            role="alert"
            className="mb-4 max-w-3xl rounded border-2 border-red-600 p-3 text-sm"
          >
            <p className="font-semibold">
              v{published.version} is published. Teams have screenshotted their
              times.
            </p>
            <p className="my-1">
              Regenerating re-packs everyone: most teams would get new times and
              stations. For a team that arrived late or left, use{" "}
              <a
                href={`/organizer/schedules/${published.id}`}
                className="underline"
              >
                late changes on v{published.version}
              </a>{" "}
              instead; they move nobody.
            </p>
            <label className="flex items-center gap-2 font-medium">
              <input type="checkbox" name="regenerateAfterPublish" required />
              Regenerate anyway: I accept that everyone&apos;s times may change.
            </label>
          </div>
        )}

        <button className={button}>Generate draft v{nextVersion}</button>
      </form>
    </main>
  );
}
