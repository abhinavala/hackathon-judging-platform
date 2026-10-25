import Link from "next/link";
import { notFound } from "next/navigation";
import { adminDb, loadScheduleView } from "@/lib/admin/data";
import { MAX_SHARED, MIN_GAP, reviewSchedule } from "@/lib/admin/review";
import { clock } from "@/lib/admin/time";
import { Flash, Section, button, table } from "../../_ui/ui";
import { publishSchedule } from "./actions";

// The last check between a bad schedule and 250 people being sent to the
// wrong place. Every warning from the spec is shown and must be explicitly
// acknowledged to publish; the organizer decides, the system advises.
export default async function SchedulePage({
  params,
  searchParams,
}: PageProps<"/organizer/schedules/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const db = await adminDb();
  const view = await loadScheduleView(db, id);
  if (!view) notFound();
  const { event, schedule, slots, stations, teams } = view;
  const review = reviewSchedule(view.review);
  const tz = event.timezone;
  const isDraft = schedule.status === "draft";
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const used = stations.filter(
    (s) =>
      review.capacity.perStation.find((p) => p.stationId === s.id)!.teams > 0,
  );
  const seat = new Map(
    view.review.assignments.map((a) => [
      `${a.stationId}|${a.slotId}`,
      a.teamId,
    ]),
  );
  const range = slots.length
    ? `${clock(slots[0].startsAt, tz)} – ${clock(slots.at(-1)!.endsAt, tz)}`
    : "no slots";

  return (
    <main>
      <h1 className="mb-1 text-xl font-semibold">
        v{schedule.version} — {schedule.status}
      </h1>
      <p className="mb-4 text-sm">
        {event.name} · {slots.length} slots · {range} ({tz}) · {teams.length}{" "}
        teams on {used.length} stations
        {schedule.stats?.mode
          ? ` · pairings: ${schedule.stats.mode === "keep" ? "kept from stations" : "formed automatically"}`
          : ""}
        {" · "}
        <a href={`/organizer/schedules/${id}/export`} className="underline">
          Download CSV (station × time)
        </a>
      </p>
      <Flash params={query} />

      {review.invalid.length > 0 && (
        <div
          role="alert"
          className="mb-6 rounded border-2 border-red-600 p-3 text-sm"
        >
          <p className="font-semibold">
            Structural errors: this schedule cannot be published.
          </p>
          <ul className="list-disc pl-6">
            {review.invalid.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      {isDraft ? (
        <form action={publishSchedule} className="mb-8 rounded border-2 p-4">
          <input type="hidden" name="scheduleId" value={schedule.id} />
          <h2 className="mb-2 text-lg font-semibold">
            Publish v{schedule.version}
            {view.published
              ? ` (replaces published v${view.published.version})`
              : ""}
          </h2>
          {review.warnings.length === 0 ? (
            <p className="mb-3 text-sm text-green-800">No warnings.</p>
          ) : (
            <ul className="mb-3 space-y-3">
              {review.warnings.map((w) => (
                <li
                  key={w.id}
                  className="rounded border border-amber-600 p-3 text-sm"
                >
                  <p className="font-semibold">⚠️ {w.title}</p>
                  <ul className="my-1 max-h-48 list-disc overflow-auto pl-6">
                    {w.detail.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                  <label className="mt-1 flex items-center gap-2 font-medium">
                    <input type="checkbox" name={`ack:${w.id}`} required />
                    I&apos;ve reviewed this. Publish anyway.
                  </label>
                </li>
              ))}
            </ul>
          )}
          <button className={button} disabled={review.invalid.length > 0}>
            Publish v{schedule.version}
          </button>
        </form>
      ) : (
        <p className="mb-6 text-sm">
          {schedule.status === "published"
            ? `Published ${schedule.published_at ? clock(schedule.published_at, tz) : ""}. This is what participants see.`
            : "Archived: replaced by a later published version."}
        </p>
      )}

      <Section title="Coverage">
        <p className="text-sm">
          {review.coverage.fullyCovered}/{review.coverage.teams} teams fully
          covered · {review.coverage.seatsMet}/{review.coverage.seatsWanted}{" "}
          track-seats met
        </p>
        {review.coverage.uncovered.length > 0 && (
          <table className={`${table} mt-2`}>
            <thead>
              <tr>
                <th>Uncovered team</th>
                <th>Missing a judge from</th>
              </tr>
            </thead>
            <tbody>
              {review.coverage.uncovered.map((u) => (
                <tr key={u.teamId}>
                  <td>{u.name}</td>
                  <td>{u.missing.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Spacing">
        <p className="text-sm">
          Minimum gap {review.spacing.minGap ?? "—"} slots (slots from a
          team&apos;s first presentation to its second; warned below {MIN_GAP}).
        </p>
        <table className={`${table} mt-2 w-auto`}>
          <thead>
            <tr>
              <th>Gap (slots)</th>
              {review.spacing.distribution.map((d) => (
                <th key={d.gap}>{d.gap}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Teams</td>
              {review.spacing.distribution.map((d) => (
                <td key={d.gap}>{d.teams}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </Section>

      <Section title="Overlap (teams shared by each pair of stations)">
        <p className="mb-2 text-sm">
          Highest: {review.overlap.maxShared} (warned above {MAX_SHARED}).
        </p>
        <div className="overflow-auto">
          <table className={`${table} w-auto`}>
            <thead>
              <tr>
                <th />
                {stations.map((s) => (
                  <th key={s.id}>{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stations.map((s, i) => (
                <tr key={s.id}>
                  <th>{s.label}</th>
                  {stations.map((o, j) => (
                    <td
                      key={o.id}
                      className={
                        review.overlap.matrix[i][j] > MAX_SHARED
                          ? "font-bold text-red-700"
                          : ""
                      }
                    >
                      {i === j ? "" : review.overlap.matrix[i][j]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Capacity">
        <p className="mb-2 text-sm">
          {review.capacity.filled} presentations in {review.capacity.seats}{" "}
          seats ({review.capacity.unfilled} empty).
        </p>
        <table className={`${table} w-auto`}>
          <thead>
            <tr>
              <th>Station</th>
              <th>Judges</th>
              <th>Teams</th>
            </tr>
          </thead>
          <tbody>
            {stations.map((s) => (
              <tr key={s.id}>
                <td>{s.label}</td>
                <td>
                  {s.composition
                    .map(
                      (j) =>
                        `${j.fullName} (${j.affiliation ?? "unaffiliated"})`,
                    )
                    .join(", ") || "—"}
                </td>
                <td>
                  {
                    review.capacity.perStation.find(
                      (p) => p.stationId === s.id,
                    )!.teams
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {review.diff && (
        <Section
          title={`Changes from published v${review.diff.againstVersion}`}
        >
          {review.diff.moved.length +
            review.diff.added.length +
            review.diff.removed.length ===
          0 ? (
            <p className="text-sm">No team&apos;s time or station changes.</p>
          ) : (
            <table className={`${table} w-auto`}>
              <thead>
                <tr>
                  <th>Team</th>
                  <th>v{review.diff.againstVersion}</th>
                  <th>v{schedule.version}</th>
                </tr>
              </thead>
              <tbody>
                {review.diff.moved.map((m) => (
                  <tr key={m.name}>
                    <td>{m.name}</td>
                    <td>
                      {m.from
                        .map((p) => `${p.label} ${clock(p.startsAt, tz)}`)
                        .join(", ")}
                    </td>
                    <td>
                      {m.to
                        .map((p) => `${p.label} ${clock(p.startsAt, tz)}`)
                        .join(", ")}
                    </td>
                  </tr>
                ))}
                {review.diff.added.map((n) => (
                  <tr key={n}>
                    <td>{n}</td>
                    <td>—</td>
                    <td>new</td>
                  </tr>
                ))}
                {review.diff.removed.map((n) => (
                  <tr key={n}>
                    <td>{n}</td>
                    <td>scheduled</td>
                    <td>removed</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      )}

      <Section title="Schedule (station × time)">
        <div className="overflow-auto">
          <table className={`${table} w-auto whitespace-nowrap`}>
            <thead>
              <tr>
                <th>Station</th>
                {slots.map((s) => (
                  <th key={s.id}>{clock(s.startsAt, tz)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {used.map((st) => (
                <tr key={st.id}>
                  <th>{st.label}</th>
                  {slots.map((sl) => {
                    const t = seat.get(`${st.id}|${sl.id}`);
                    return <td key={sl.id}>{t ? teamName.get(t) : ""}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <p className="text-sm">
        <Link href="/organizer/schedules" className="underline">
          All versions
        </Link>
      </p>
    </main>
  );
}
