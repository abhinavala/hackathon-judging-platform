import Link from "next/link";
import { notFound } from "next/navigation";
import {
  adminDb,
  loadScheduleView,
  loadSchedules,
  loadTeams,
} from "@/lib/admin/data";
import { MAX_SHARED, MIN_GAP, reviewSchedule } from "@/lib/admin/review";
import { clock } from "@/lib/admin/time";
import { Flash, Section, button, input, table } from "../../_ui/ui";
import {
  addLateTeam,
  discardDraft,
  dropTeam,
  publishSchedule,
} from "./actions";

// Reads the organizer's session; blocks on the server rather than
// prerendering (as the guard layout does).
export const instant = false;

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
  const late = schedule.stats?.lateChange ?? null;
  const [allTeams, versions] =
    schedule.status === "published"
      ? await Promise.all([
          loadTeams(db, event.id),
          loadSchedules(db, event.id),
        ])
      : [[], []];
  const inThis = new Set(teams.map((t) => t.id));
  const unscheduled = allTeams
    .filter((t) => !inThis.has(t.id))
    .sort(
      (a, b) =>
        Number(b.checkedIn) - Number(a.checkedIn) ||
        a.name.localeCompare(b.name),
    );
  const nextVersion = Math.max(0, ...versions.map((v) => v.version)) + 1;
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
        {" · "}
        <a href={`/organizer/schedules/${id}/print`} className="underline">
          Printable schedule
        </a>
      </p>
      <Flash params={query} />

      {late && (
        <p className="mb-4 rounded border-2 border-sky-700 p-3 text-sm">
          <strong>Late change to v{schedule.stats?.basedOn?.version}:</strong>{" "}
          {late.kind === "insert"
            ? `adds ${late.teamName} at ${late.seats.map((x) => `${x.label} ${clock(x.startsAt, tz)}`).join(" and ")}${
                late.appendedSlots
                  ? `, in ${late.appendedSlots} slot${late.appendedSlots === 1 ? "" : "s"} added at the end (the schedule was full)`
                  : ""
              }${late.missing.length ? `. No ${late.missing.join(", ")} judge on either station.` : "."}`
            : `drops ${late.teamName}; its seats stay empty.`}{" "}
          Everyone else keeps their seats and times. Copied from the published
          version, not regenerated.
        </p>
      )}

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

      {schedule.status === "published" && (
        // First thing on the published version: a team turning up at 10:15
        // is why an organizer opens this page on the day.
        <div id="late-changes">
          <Section title="Late changes">
            <p className="mb-2 max-w-3xl text-sm">
              Teams have screenshotted these times, so nothing here re-runs the
              generator. Each change drafts v{nextVersion}: a copy of this
              version with only that change, for you to review and publish.
            </p>
            <div className="flex flex-wrap gap-8">
              <form action={addLateTeam} className="space-y-1 text-sm">
                <input type="hidden" name="scheduleId" value={schedule.id} />
                <label className="flex flex-col">
                  Add a late team (seats in free slots, or at the end)
                  <select name="teamId" required className={input}>
                    <option value="">Pick a team…</option>
                    {unscheduled.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.checkedIn ? "" : " (not checked in)"}
                      </option>
                    ))}
                  </select>
                </label>
                <button className={button}>
                  Draft v{nextVersion} with this team
                </button>
              </form>
              <form action={dropTeam} className="space-y-1 text-sm">
                <input type="hidden" name="scheduleId" value={schedule.id} />
                <label className="flex flex-col">
                  Drop a team (its seats stay empty; nobody moves)
                  <select name="teamId" required className={input}>
                    <option value="">Pick a team…</option>
                    {[...teams]
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </label>
                <button className={button}>
                  Draft v{nextVersion} without this team
                </button>
              </form>
            </div>
          </Section>
        </div>
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
          title={
            isDraft
              ? `Changes from published v${review.diff.againstVersion}`
              : `Changes from v${review.diff.againstVersion} (the version this replaced)`
          }
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
                {review.diff.added.map((a) => (
                  <tr key={a.name}>
                    <td>{a.name}</td>
                    <td>— (not scheduled)</td>
                    <td>
                      added:{" "}
                      {a.to
                        .map((p) => `${p.label} ${clock(p.startsAt, tz)}`)
                        .join(", ")}
                    </td>
                  </tr>
                ))}
                {review.diff.removed.map((r) => (
                  <tr key={r.name}>
                    <td>{r.name}</td>
                    <td>
                      {r.from
                        .map((p) => `${p.label} ${clock(p.startsAt, tz)}`)
                        .join(", ")}
                    </td>
                    <td>dropped (seats left empty)</td>
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

      {isDraft && (
        <form action={discardDraft} className="mb-4">
          <input type="hidden" name="scheduleId" value={schedule.id} />
          <button className={button}>Discard draft v{schedule.version}</button>
        </form>
      )}

      <p className="text-sm">
        <Link href="/organizer/schedules" className="underline">
          All versions
        </Link>
      </p>
    </main>
  );
}
