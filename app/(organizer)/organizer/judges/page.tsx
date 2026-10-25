import {
  adminDb,
  currentEvent,
  loadJudges,
  loadStations,
  loadTeams,
  loadTracks,
} from "@/lib/admin/data";
import { preflight } from "@/lib/scheduler";
import { Flash, Section, button, input, table } from "../_ui/ui";
import { addJudge, deleteJudge, updateJudge } from "./actions";

export default async function JudgesPage({
  searchParams,
}: PageProps<"/organizer/judges">) {
  const params = await searchParams;
  const db = await adminDb();
  const event = await currentEvent(db);
  if (!event) return <p>No event exists yet.</p>;

  const [judges, teams, tracks, stations] = await Promise.all([
    loadJudges(db, event.id),
    loadTeams(db, event.id),
    loadTracks(db, event.id),
    loadStations(db, event.id),
  ]);
  const checkedIn = teams.filter((t) => t.checkedIn);
  // Live pre-flight: roster x the checked-in teams' demand, every render.
  const check = preflight(
    judges.map((j) => j.affiliation),
    checkedIn.map((t) => new Set(t.sponsors)),
  );
  const sponsors = [
    ...new Set(
      tracks.map((t) => t.sponsor).filter((s): s is string => s !== null),
    ),
  ];
  const stationOf = new Map(
    stations.flatMap((s) => s.judgeIds.map((id) => [id, s.label] as const)),
  );

  const affiliationSelect = (value: string | null) => {
    const options = [
      ...sponsors,
      ...(value && !sponsors.includes(value) ? [value] : []),
    ];
    return (
      <select name="affiliation" defaultValue={value ?? ""} className={input}>
        <option value="">Unaffiliated (alum / faculty)</option>
        {options.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    );
  };

  return (
    <main>
      <h1 className="mb-4 text-xl font-semibold">Judges — {event.name}</h1>
      <Flash params={params} />

      <Section title="Pre-flight capacity check">
        {checkedIn.length === 0 ? (
          <p className="text-sm">
            No teams are checked in yet, so there is no track demand to check
            against.
          </p>
        ) : (
          <>
            <p className="mb-2 text-sm">
              {check.nJudges} judges → {check.nPanels} stations × {check.nSlots}{" "}
              slots, against {check.nTeams} checked-in teams. A sponsor&apos;s
              judges can see at most judges × slots teams.
            </p>
            {check.warnings.length === 0 ? (
              <p className="mb-2 text-sm font-medium text-green-800">
                Every track can be fully covered with this roster.
              </p>
            ) : (
              <ul className="mb-2 space-y-1">
                {check.warnings.map((w) => (
                  <li
                    key={w.sponsor}
                    role="alert"
                    className="rounded border border-amber-600 px-3 py-2 text-sm"
                  >
                    ⚠️ {w.message}
                  </li>
                ))}
              </ul>
            )}
            {check.oddJudgeCount && (
              <p
                role="alert"
                className="mb-2 rounded border border-amber-600 px-3 py-2 text-sm"
              >
                ⚠️ {check.nJudges} judges is an odd number: stations are pairs,
                so one judge sits out.
              </p>
            )}
            <table className={table}>
              <thead>
                <tr>
                  <th>Track sponsor</th>
                  <th>Judges</th>
                  <th>Teams wanting it</th>
                  <th>Sightings (judges × {check.nSlots})</th>
                  <th>OK</th>
                </tr>
              </thead>
              <tbody>
                {check.rows.map((r) => (
                  <tr key={r.sponsor}>
                    <td>{r.sponsor}</td>
                    <td>{r.judges}</td>
                    <td>{r.teamsWanting}</td>
                    <td>{r.capacity}</td>
                    <td>{r.ok ? "yes" : "NO"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Section>

      <Section title={`Roster (${judges.length})`}>
        <table className={table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Affiliation</th>
              <th>Station</th>
              <th>Signed in</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {judges.map((j) => (
              <tr key={j.id}>
                <td colSpan={3}>
                  <form action={updateJudge} className="flex flex-wrap gap-2">
                    <input type="hidden" name="id" value={j.id} />
                    <input
                      name="fullName"
                      defaultValue={j.fullName}
                      aria-label="Name"
                      className={input}
                      required
                    />
                    <input
                      name="email"
                      type="email"
                      defaultValue={j.email}
                      aria-label="Email"
                      className={input}
                      required
                    />
                    {affiliationSelect(j.affiliation)}
                    <button className={button}>Save</button>
                  </form>
                </td>
                <td>{stationOf.get(j.id) ?? "—"}</td>
                <td>{j.userId ? "yes" : "not yet"}</td>
                <td>
                  <form action={deleteJudge}>
                    <input type="hidden" name="id" value={j.id} />
                    <button className={button}>Remove</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Add a judge">
        <form action={addJudge} className="flex flex-wrap gap-2">
          <input
            name="fullName"
            placeholder="Full name"
            className={input}
            required
          />
          <input
            name="email"
            type="email"
            placeholder="Email"
            className={input}
            required
          />
          {affiliationSelect(null)}
          <button className={button}>Add judge</button>
        </form>
      </Section>
    </main>
  );
}
