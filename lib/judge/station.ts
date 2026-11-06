// A judge's station on the published schedule: their teams in time order,
// each marked done / now / next / later, so the current one can be
// highlighted. Pure, so it's tested directly.

export type StationTeam = {
  team: string;
  startsAt: string;
  endsAt: string;
  /** For the link to score entry (Phase 5). */
  assignmentId?: string;
  /** This judge's score so far: every criterion, some, or none. */
  scored?: "complete" | "partial" | null;
};

export type StationRow = StationTeam & {
  state: "done" | "now" | "next" | "later";
};

/**
 * In time order. "now" is the presentation under way; "next" is the first one
 * still to start (one only, so the eye has one place to go). Between slots,
 * or before the first, there is a "next" but no "now".
 */
export function stationRows(teams: StationTeam[], now: number): StationRow[] {
  const sorted = [...teams].sort(
    (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
  );
  let nextGiven = false;
  return sorted.map((t) => {
    const start = Date.parse(t.startsAt);
    const end = Date.parse(t.endsAt);
    let state: StationRow["state"];
    if (now >= end) state = "done";
    else if (now >= start) state = "now";
    else if (!nextGiven) {
      state = "next";
      nextGiven = true;
    } else state = "later";
    return { ...t, state };
  });
}
