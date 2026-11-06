import { requireRole } from "@/lib/session";
import { ORGANIZER_ROLES } from "@/lib/route-guards";
import { adminDb, currentEvent } from "@/lib/admin/data";
import { loadScoring } from "@/lib/admin/scoring";
import { exportRows } from "@/lib/admin/deliberation";
import { formatCsv, spreadsheetSafe } from "@/lib/csv/csv";

// Every score as a spreadsheet: one row per team per judge per criterion,
// with the judge's total and notes. Insurance against the deliberation view
// being wrong. Route handlers aren't wrapped by layouts: role checked here.
export async function GET() {
  await requireRole(...ORGANIZER_ROLES);
  const db = await adminDb();
  const event = await currentEvent(db);
  if (!event) return new Response("No event", { status: 404 });
  const data = await loadScoring(db, event.id);
  const assignment = new Map(data.assignments.map((a) => [a.id, a]));
  const teamName = new Map(data.teams.map((t) => [t.id, t.name]));
  const judgeName = new Map(data.judges.map((j) => [j.id, j.name]));
  const rows = exportRows(
    data.scores
      .filter((s) => assignment.has(s.assignmentId))
      .map((s) => ({
        teamId: assignment.get(s.assignmentId)!.teamId,
        judgeId: s.judgeId,
        notes: s.notes,
        items: s.items,
      })),
    data.criteria,
    {
      team: (id) => teamName.get(id) ?? "?",
      judge: (id) => judgeName.get(id) ?? "?",
    },
  );
  return new Response(formatCsv(rows.map((r) => r.map(spreadsheetSafe))), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${event.slug}-scores.csv"`,
      "cache-control": "no-store",
    },
  });
}
