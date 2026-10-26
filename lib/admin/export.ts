import type { ScheduleView } from "@/lib/admin/data";
import type { ScheduleExport } from "@/lib/csv/schedule-export";

/**
 * One schedule version as the station x time export: the stations that have
 * teams, the slots, and the active assignments, plus a Judges column when
 * `judges` is set. The CSV download and the printed schedule both start
 * here, so with the same option they render the same grid.
 */
export function exportFromView(
  view: ScheduleView,
  { judges }: { judges: boolean },
): ScheduleExport {
  const used = new Set(view.review.assignments.map((a) => a.stationId));
  const teamName = new Map(view.teams.map((t) => [t.id, t.name]));
  return {
    stations: view.stations
      .filter((s) => used.has(s.id))
      .map((s) => ({
        id: s.id,
        label: s.label,
        ...(judges ? { judges: s.composition.map((j) => j.fullName) } : {}),
      })),
    slots: view.slots,
    cells: view.review.assignments.map((a) => ({
      stationId: a.stationId,
      slotId: a.slotId,
      teamName: teamName.get(a.teamId) ?? "?",
    })),
    timeZone: view.event.timezone,
  };
}
