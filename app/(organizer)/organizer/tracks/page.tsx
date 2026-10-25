import {
  adminDb,
  currentEvent,
  loadJudges,
  loadTracks,
} from "@/lib/admin/data";
import { Flash, Section, button, input, table } from "../_ui/ui";
import { addTrack, deleteTrack, updateTrack } from "./actions";

export default async function TracksPage({
  searchParams,
}: PageProps<"/organizer/tracks">) {
  const params = await searchParams;
  const db = await adminDb();
  const event = await currentEvent(db);
  if (!event) return <p>No event exists yet.</p>;
  const [tracks, judges] = await Promise.all([
    loadTracks(db, event.id),
    loadJudges(db, event.id),
  ]);
  const ids = tracks.map((t) => t.id);
  const { data: links } = ids.length
    ? await db.from("team_tracks").select("track_id").in("track_id", ids)
    : { data: [] as { track_id: string }[] };
  const selected = (id: string) =>
    (links ?? []).filter((l) => l.track_id === id).length;
  const affiliations = [
    ...new Set(
      judges.map((j) => j.affiliation).filter((a): a is string => a !== null),
    ),
  ];
  const confirming =
    typeof params.confirmDelete === "string"
      ? tracks.find((t) => t.id === params.confirmDelete)
      : null;

  return (
    <main>
      <h1 className="mb-4 text-xl font-semibold">Tracks — {event.name}</h1>
      <Flash params={params} />
      <ul className="mb-4 max-w-3xl list-disc pl-6 text-sm">
        <li>
          <strong>
            Names must match the Google Form&apos;s prize checkbox labels
            exactly.
          </strong>{" "}
          The team import matches on them; a renamed track stops matching.
        </li>
        <li>
          <strong>Sponsor</strong> must match the affiliation of that
          sponsor&apos;s judges exactly (judges here:{" "}
          {affiliations.join(", ") || "none with an affiliation yet"}). Leave it
          blank for a non-sponsor track.
        </li>
        <li>
          <strong>Judged live</strong>: untick for a prize decided offline (from
          Devpost). The scheduler then doesn&apos;t try to put that
          sponsor&apos;s judge in front of those teams.
        </li>
      </ul>

      {confirming && (
        <div
          role="alert"
          className="mb-6 rounded border-2 border-red-600 p-3 text-sm"
        >
          <p className="mb-2 font-semibold">
            {selected(confirming.id)} team
            {selected(confirming.id) === 1 ? " has" : "s have"} selected &ldquo;
            {confirming.name}&rdquo;. Deleting it removes it from their
            selections.
          </p>
          <div className="flex gap-2">
            <form action={deleteTrack}>
              <input type="hidden" name="id" value={confirming.id} />
              <input type="hidden" name="confirm" value="yes" />
              <button className={button}>Delete anyway</button>
            </form>
            <a href="/organizer/tracks" className={button}>
              Cancel
            </a>
          </div>
        </div>
      )}

      <Section title={`Tracks (${tracks.length})`}>
        <table className={table}>
          <thead>
            <tr>
              <th>Name, sponsor, judged live, order</th>
              <th>Teams</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tracks.map((t) => (
              <tr key={t.id}>
                <td>
                  <form
                    action={updateTrack}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <input type="hidden" name="id" value={t.id} />
                    <input
                      name="name"
                      defaultValue={t.name}
                      aria-label="Name"
                      required
                      className={`${input} min-w-64`}
                    />
                    <input
                      name="sponsor"
                      defaultValue={t.sponsor ?? ""}
                      placeholder="no sponsor"
                      aria-label="Sponsor"
                      className={`${input} w-28`}
                    />
                    <label className="flex items-center gap-1 text-sm">
                      <input
                        type="checkbox"
                        name="judgedLive"
                        defaultChecked={t.judged_live}
                      />{" "}
                      judged live
                    </label>
                    <input
                      name="sortOrder"
                      type="number"
                      defaultValue={t.sort_order}
                      aria-label="Sort order"
                      className={`${input} w-16`}
                    />
                    <button className={button}>Save</button>
                  </form>
                </td>
                <td>{selected(t.id)}</td>
                <td>
                  <form action={deleteTrack}>
                    <input type="hidden" name="id" value={t.id} />
                    <button className={button}>Delete</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Add a track">
        <form action={addTrack} className="flex flex-wrap items-center gap-2">
          <input
            name="name"
            placeholder="Exactly as on the form"
            required
            className={`${input} min-w-64`}
          />
          <input
            name="sponsor"
            placeholder="Sponsor (optional)"
            className={`${input} w-40`}
          />
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" name="judgedLive" defaultChecked /> judged
            live
          </label>
          <input
            name="sortOrder"
            type="number"
            defaultValue={Math.max(0, ...tracks.map((t) => t.sort_order)) + 1}
            aria-label="Sort order"
            className={`${input} w-16`}
          />
          <button className={button}>Add track</button>
        </form>
      </Section>
    </main>
  );
}
