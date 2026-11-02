import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { headers } from "next/headers";
import { adminDb, loadScheduleView } from "@/lib/admin/data";
import { exportFromView } from "@/lib/admin/export";
import { scheduleGrid, teamIndex } from "@/lib/csv/schedule-export";
import { helpPlace } from "@/lib/event/copy";
import { clockWithZone, dayLabel } from "@/lib/team/view";
import { PrintButton } from "./print-button";

// Reads the organizer's session; blocks on the server rather than
// prerendering (as the guard layout does).
export const instant = false;

/** When this copy was rendered (the request has already opted out of prerendering). */
function printTime() {
  return Date.now();
}

// The paper on the wall, and the answer to total connectivity failure. Page 1
// is every team A to Z with its times and stations: what a queue reads.
// Page 2 is the same grid as the CSV export (scheduleGrid on exportFromView),
// so the printout and the spreadsheet always match; both pages come from one
// export, so they can't disagree. The wall copy leaves the
// judges out (participants need where, not who); ?judges=1 prints a staffed
// organizer copy, labelled so it doesn't end up on the wall.
export default async function PrintSchedulePage({
  params,
  searchParams,
}: PageProps<"/organizer/schedules/[id]/print">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const judges = query.judges === "1";
  const db = await adminDb();
  const view = await loadScheduleView(db, id);
  if (!view) notFound();
  await connection();
  const host = (await headers()).get("host") ?? "";
  const { event, schedule, stations, slots } = view;
  const tz = event.timezone;
  const exported = exportFromView(view, { judges });
  const grid = scheduleGrid(exported);
  const index = teamIndex(exported);
  const shown = new Set(grid.rows.map((r) => r[0]));
  const located = stations.filter((s) => shown.has(s.label) && s.locationText);
  const printedAt = printTime();
  const zone = clockWithZone(slots[0]?.startsAt ?? printedAt, tz)
    .split(" ")
    .pop();

  const title = (
    <div>
      <h1 className="text-2xl font-bold">{event.name}: judging schedule</h1>
      <p className="text-base">
        {slots[0] ? dayLabel(slots[0].startsAt, tz) : ""} · version{" "}
        {schedule.version}
        {schedule.status === "published" && schedule.published_at
          ? `, published ${clockWithZone(schedule.published_at, tz)}`
          : ""}{" "}
        · all times {zone}
      </p>
    </div>
  );
  const banners = (
    <>
      {judges && (
        <p className="mb-3 border-2 border-black p-2 text-lg font-bold">
          ORGANIZER COPY: lists the judges. Don&apos;t post this one.
        </p>
      )}

      {schedule.status !== "published" && (
        <p className="mb-3 border-2 border-black p-2 text-lg font-bold">
          {schedule.status === "draft"
            ? "DRAFT: not published. Teams have not been sent these times."
            : "ARCHIVED: replaced by a later published version. Do not post."}
        </p>
      )}
    </>
  );
  const where = located.length > 0 && (
    <p className="mt-2 text-sm">
      <strong>Where:</strong>{" "}
      {located.map((s) => `${s.label}: ${s.locationText}`).join(" · ")}
    </p>
  );
  const help = (
    <p className="mt-2 text-xs">
      Your team&apos;s own times: <strong>{host}/t</strong> with your join code.
      Problems? Find an organizer at{" "}
      <strong>{helpPlace(event.help_location)}</strong>. Printed{" "}
      {clockWithZone(printedAt, tz)}; if the board or your team page shows
      something different, they are newer than this paper.
    </p>
  );

  return (
    // White whatever the screen theme: this is a preview of a sheet of paper.
    <main className="rounded bg-white p-4 text-black print:p-0">
      <style>{`@page { size: letter landscape; margin: 0.4in; }
@media print { body { background: white; } }`}</style>

      <div className="mb-3 flex items-start justify-between gap-4">
        {title}
        <div className="flex items-center gap-3 text-sm print:hidden">
          <Link
            href={`/organizer/schedules/${id}/print${judges ? "" : "?judges=1"}`}
            className="underline"
          >
            {judges
              ? "Hide judges (wall copy)"
              : "Show judges (organizer copy)"}
          </Link>
          <PrintButton />
        </div>
      </div>
      {banners}
      <div className="mb-3 [&_p]:mt-1">
        {where}
        {help}
      </div>

      <section>
        <h2 className="mb-2 text-xl font-bold print:mb-1 print:text-lg">
          Find your team (A to Z): first and second presentation, time · station
        </h2>
        {/* One list flowing down the left column, then the right, then onto
            another sheet if needed: side-by-side tables would split
            confusingly across pages. ~9.5pt on paper, for reading from a step
            back in a queue. */}
        <div className="columns-2 gap-8 text-[16px] leading-snug print:text-[12.5px]">
          {index.map((t) => (
            <div
              key={t.team}
              className="grid break-inside-avoid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 border-b border-gray-400 py-[3px] print:py-[1.5px]"
            >
              <span className="font-bold">{t.team}</span>
              {[0, 1].map((i) => (
                <span key={i} className="whitespace-nowrap tabular-nums">
                  {t.sessions[i]
                    ? `${t.sessions[i].time} · ${t.sessions[i].station}`
                    : ""}
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8 break-before-page print:mt-0">
        <div className="mb-3">{title}</div>
        {banners}
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full border-collapse text-[11px] leading-tight print:text-[9px] [&_td]:border [&_td]:border-black [&_td]:px-1 [&_td]:py-1 [&_td]:align-top [&_th]:border [&_th]:border-black [&_th]:bg-gray-100 [&_th]:px-1 [&_th]:py-1 [&_th]:text-left">
            <thead>
              <tr>
                {grid.header.map((h, i) => (
                  <th key={i} className={i === 0 ? "" : "whitespace-nowrap"}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row) => (
                <tr key={row[0]} className="break-inside-avoid">
                  {row.map((cell, i) => (
                    <td
                      key={i}
                      className={i === 0 ? "font-bold whitespace-nowrap" : ""}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {where}
        {help}
      </section>
    </main>
  );
}
