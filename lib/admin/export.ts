import type { ScheduleView } from "@/lib/admin/data";
import type { ScheduleExport } from "@/lib/csv/schedule-export";

/**
 * One schedule version as the station x time export: the stations that have
 * teams (with their judges), the slots, and the active assignments. The CSV
 * download and the printed schedule both start here.
 */
export function exportFromView(view: ScheduleView): ScheduleExport {
  const used = new Set(view.review.assignments.map((a) => a.stationId));
  const teamName = new Map(view.teams.map((t) => [t.id, t.name]));
  return {
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
  };
}
