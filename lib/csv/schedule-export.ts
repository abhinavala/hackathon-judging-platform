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

export type TeamTimes = {
  team: string;
  /** In time order: when and where. */
  sessions: { time: string; station: string }[];
};

/**
 * The same assignments the grid shows, turned around: every team A to Z with
 * its presentations in time order. On the wall this is what a queue reads
 * (find your name, not your cell in a station x time matrix).
 */
export function teamIndex({
  stations,
  slots,
  cells,
  timeZone,
}: ScheduleExport): TeamTimes[] {
  const station = new Map(stations.map((s) => [s.id, s.label]));
  const slot = new Map(slots.map((s) => [s.id, s]));
  const byTeam = new Map<
    string,
    { index: number; time: string; station: string }[]
  >();
  for (const c of cells) {
    const sl = slot.get(c.slotId);
    const st = station.get(c.stationId);
    if (!sl || !st) continue;
    const list = byTeam.get(c.teamName) ?? [];
    list.push({
      index: sl.index,
      time: slotLabel(sl.startsAt, timeZone),
      station: st,
    });
    byTeam.set(c.teamName, list);
  }
  return [...byTeam]
    .sort(([a], [b]) => a.localeCompare(b, "en", { sensitivity: "base" }))
    .map(([team, list]) => ({
      team,
      sessions: list
        .sort((a, b) => a.index - b.index)
        .map(({ time, station }) => ({ time, station })),
    }));
}

export function scheduleToCsv(schedule: ScheduleExport): string {
  const { header, rows } = scheduleGrid(schedule);
  return formatCsv([header, ...rows.map((r) => r.map(spreadsheetSafe))]);
}
