import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { ORGANIZER_ROLES } from "@/lib/route-guards";
import { adminDb, loadScheduleView } from "@/lib/admin/data";
import { exportFromView } from "@/lib/admin/export";
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
  const csv = scheduleToCsv(exportFromView(view));
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${view.event.slug}-v${view.schedule.version}.csv"`,
      "cache-control": "no-store",
    },
  });
}
