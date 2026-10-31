import {
  adminDb,
  currentEvent,
  loadJudges,
  loadStations,
} from "@/lib/admin/data";
import { Flash, Section, button, input, table } from "../_ui/ui";
import { addStation, deleteStation, updateStation } from "./actions";

// Reads the organizer's session; blocks on the server rather than
// prerendering (as the guard layout does).
export const instant = false;

export default async function StationsPage({
  searchParams,
}: PageProps<"/organizer/panels">) {
  const params = await searchParams;
  const db = await adminDb();
  const event = await currentEvent(db);
  if (!event) return <p>No event exists yet.</p>;
  const [stations, judges] = await Promise.all([
    loadStations(db, event.id),
    loadJudges(db, event.id),
  ]);
  const seated = new Set(stations.flatMap((s) => s.judgeIds));
  const unseated = judges.filter((j) => !seated.has(j.id));
  const label = (id: string) => {
    const j = judges.find((x) => x.id === id);
    return j ? `${j.fullName} (${j.affiliation ?? "unaffiliated"})` : id;
  };

  const judgeSelect = (value: string | undefined, seat: number) => (
    <select
      name="judge"
      defaultValue={value ?? ""}
      aria-label={`Judge ${seat}`}
      className={input}
    >
      <option value="">— empty —</option>
      {judges.map((j) => (
        <option key={j.id} value={j.id}>
          {label(j.id)}
        </option>
      ))}
    </select>
  );

  return (
    <main>
      <h1 className="mb-4 text-xl font-semibold">Stations — {event.name}</h1>
      <Flash params={params} />
      <p className="mb-4 max-w-3xl text-sm">
        These are the live judge pairings, the ones the published schedule runs
        with. Swapping a judge here changes who sees that station&apos;s teams
        and moves no team. Generating a new draft proposes its own pairings;
        they take effect only when that draft is published.
      </p>

      <Section title={`Stations (${stations.length})`}>
        <table className={table}>
          <thead>
            <tr>
              <th>Station, location, order, judges</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {stations.map((s) => (
              <tr key={s.id}>
                <td>
                  <form
                    action={updateStation}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <input type="hidden" name="id" value={s.id} />
                    <input
                      name="label"
                      defaultValue={s.label}
                      aria-label="Label"
                      className={input}
                      required
                    />
                    <input
                      name="locationText"
                      defaultValue={s.locationText ?? ""}
                      placeholder="Location"
                      aria-label="Location"
                      className={input}
                    />
                    <input
                      name="sortOrder"
                      type="number"
                      defaultValue={s.sortOrder}
                      aria-label="Sort order"
                      className={`${input} w-16`}
                    />
                    {judgeSelect(s.judgeIds[0], 1)}
                    {judgeSelect(s.judgeIds[1], 2)}
                    <button className={button}>Save</button>
                  </form>
                </td>
                <td>
                  <form action={deleteStation}>
                    <input type="hidden" name="id" value={s.id} />
                    <button className={button}>Remove</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {stations.some((s) => s.judgeIds.length !== 2) && (
          <p className="mt-2 text-sm">
            Stations without exactly two judges:{" "}
            {stations
              .filter((s) => s.judgeIds.length !== 2)
              .map((s) => s.label)
              .join(", ")}
            .
          </p>
        )}
      </Section>

      <Section title={`Judges without a station (${unseated.length})`}>
        {unseated.length === 0 ? (
          <p className="text-sm">Every judge is seated.</p>
        ) : (
          <ul className="list-disc pl-6 text-sm">
            {unseated.map((j) => (
              <li key={j.id}>{label(j.id)}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Add a station">
        <form action={addStation} className="flex flex-wrap gap-2">
          <input
            name="label"
            placeholder="Station 9"
            className={input}
            required
          />
          <input name="locationText" placeholder="Location" className={input} />
          <button className={button}>Add station</button>
        </form>
      </Section>
    </main>
  );
}
