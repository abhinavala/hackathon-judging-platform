import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { ORGANIZER_ROLES } from "@/lib/route-guards";
import { adminDb, loadScheduleView } from "@/lib/admin/data";
import { scheduleToCsv } from "@/lib/csv/schedule-export";

// The printed fallback: stations down the side, times across. The proxy
// gates /organizer; route handlers aren't wrapped by layouts, so the role is
// checked here too.
export async function GET(
  _req: Request,
  { params }: RouteContext<"/organizer/schedules/[id]/export">,
) {
  await requireRole(...ORGANIZER_ROLES);
  const { id } = await params;
  const db = await adminDb();
  const view = await loadScheduleView(db, id);
  if (!view) notFound();
  const used = new Set(view.review.assignments.map((a) => a.stationId));
  const teamName = new Map(view.teams.map((t) => [t.id, t.name]));
  const csv = scheduleToCsv({
    stations: view.stations
      .filter((s) => used.has(s.id))
      .map((s) => ({
        id: s.id,
        label: s.label,
        judges: s.composition.map((j) => j.fullName),
      })),
    slots: view.slots,
    cells: view.review.assignments.map((a) => ({
      stationId: a.stationId,
      slotId: a.slotId,
      teamName: teamName.get(a.teamId) ?? "?",
    })),
    timeZone: view.event.timezone,
  });
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${view.event.slug}-v${view.schedule.version}.csv"`,
      "cache-control": "no-store",
    },
  });
}
