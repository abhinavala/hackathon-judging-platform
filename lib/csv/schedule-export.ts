// Schedule CSV export in the spreadsheet's layout: stations down the side,
// time columns across. It is the printed fallback and the format organizers
// already read. Pure.

import { formatCsv, spreadsheetSafe } from "./csv.ts";

export type ExportStation = { id: string; label: string; judges?: string[] };
export type ExportSlot = { id: string; index: number; startsAt: string | Date };
export type ExportCell = {
  stationId: string;
  slotId: string;
  teamName: string;
};

export type ScheduleExport = {
  stations: ExportStation[];
  slots: ExportSlot[];
  /** Active assignments only; cancelled ones leave their cell empty. */
  cells: ExportCell[];
  /** IANA zone for the time headers, e.g. "America/Los_Angeles". */
  timeZone: string;
};

/** "10:07 AM" in the event's time zone. */
export function slotLabel(startsAt: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(startsAt));
}

/**
 * The station x time grid as plain strings: the header row, then one row per
 * station. The CSV export and the printed schedule both render THIS, so the
 * paper on the wall and the spreadsheet can't drift apart.
 */
export function scheduleGrid({
  stations,
  slots,
  cells,
  timeZone,
}: ScheduleExport): { header: string[]; rows: string[][] } {
  const orderedSlots = [...slots].sort((a, b) => a.index - b.index);
  const withJudges = stations.some((s) => s.judges?.length);
  const at = new Map<string, string>();
  for (const c of cells) {
    const key = `${c.stationId}|${c.slotId}`;
    if (at.has(key))
      throw new Error(`Two teams at one station in one slot: ${key}`);
    at.set(key, c.teamName);
  }

  const header = [
    "Station",
    ...(withJudges ? ["Judges"] : []),
    ...orderedSlots.map((s) => slotLabel(s.startsAt, timeZone)),
  ];
  const rows = stations.map((st) => [
    st.label,
    ...(withJudges ? [(st.judges ?? []).join(", ")] : []),
    ...orderedSlots.map((sl) => at.get(`${st.id}|${sl.id}`) ?? ""),
  ]);
  return { header, rows };
}

export function scheduleToCsv(schedule: ScheduleExport): string {
  const { header, rows } = scheduleGrid(schedule);
  return formatCsv([header, ...rows.map((r) => r.map(spreadsheetSafe))]);
}
