import Link from "next/link";
import { adminDb, currentEvent, loadSchedules } from "@/lib/admin/data";
import { clock } from "@/lib/admin/time";
import { Flash, Section, table } from "../_ui/ui";

// Reads the organizer's session; blocks on the server rather than
// prerendering (as the guard layout does).
export const instant = false;

export default async function SchedulesPage({
  searchParams,
}: PageProps<"/organizer/schedules">) {
  const params = await searchParams;
  const db = await adminDb();
  const event = await currentEvent(db);
  if (!event) return <p>No event exists yet.</p>;
  const schedules = await loadSchedules(db, event.id);
  const live = schedules.find((s) => s.status === "published");
  const when = (iso: string | null) =>
    iso
      ? `${new Date(iso).toLocaleDateString("en-US", { timeZone: event.timezone, month: "short", day: "numeric" })} ${clock(iso, event.timezone)}`
      : "—";

  return (
    <main>
      <h1 className="mb-4 text-xl font-semibold">Schedules — {event.name}</h1>
      <Flash params={params} />
      <Section title="Versions">
        {schedules.length === 0 ? (
          <p className="text-sm">
            No schedules yet.{" "}
            <Link href="/organizer/generate" className="underline">
              Generate one
            </Link>
            .
          </p>
        ) : (
          <table className={table}>
            <thead>
              <tr>
                <th>Version</th>
                <th>Status</th>
                <th>Generated</th>
                <th>Published</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => {
                // Out of date: older than the live version, or a late change
                // copied from a version that's no longer the live one.
                const basedOn = (
                  s.stats as { basedOn?: { version: number } } | null
                )?.basedOn?.version;
                const superseded =
                  s.status === "draft" && live && s.version < live.version;
                const staleLate =
                  s.status === "draft" &&
                  live &&
                  !superseded &&
                  basedOn != null &&
                  basedOn !== live.version;
                return (
                  <tr key={s.id}>
                    <td>v{s.version}</td>
                    <td
                      className={
                        s.status === "published" ? "font-semibold" : ""
                      }
                    >
                      {superseded
                        ? `draft, superseded by v${live.version}`
                        : staleLate
                          ? `draft, out of date (made from v${basedOn}; v${live.version} is published)`
                          : s.status}
                    </td>
                    <td>{when(s.generated_at)}</td>
                    <td>{when(s.published_at)}</td>
                    <td>
                      <Link
                        href={`/organizer/schedules/${s.id}`}
                        className="underline"
                      >
                        {s.status === "draft" && !superseded && !staleLate
                          ? "Review and publish"
                          : "View"}
                      </Link>
                      {s.status === "published" && (
                        <>
                          {" · "}
                          <Link
                            href={`/organizer/schedules/${s.id}#late-changes`}
                            className="font-semibold underline"
                          >
                            Late team or dropped team
                          </Link>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>
    </main>
  );
}
