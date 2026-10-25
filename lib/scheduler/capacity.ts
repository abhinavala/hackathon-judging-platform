// Pre-flight capacity check. Port of scheduler/stage0.py (coverage_capacity),
// plus the recruiting target.
//
// A judge from sponsor S sits on exactly one panel and sees nSlots teams over
// the round, so S-judges collectively produce judges_from_S x nSlots
// sightings, and each team wanting S needs at least one of them. The bound
// depends on the roster and the demand alone, not on how anyone is paired,
// so it can run the moment judges are entered, days before the event: it
// turns a day-of discovery into a Thursday email.

import type { JudgeRoster, Sponsor } from "./types.ts";
import { compareStr } from "./python.ts";

export type CapacityRow = {
  sponsor: Sponsor;
  judges: number;
  teamsWanting: number;
  /** judges x nSlots: how many team-sightings these judges can give. */
  capacity: number;
  ok: boolean;
  /** ceil(teamsWanting / nSlots) at the current slot count. */
  minJudges: number;
};

/** coverage_capacity(judges, team_tracks, n_slots), row for row. */
export function coverageCapacity(
  judges: JudgeRoster,
  teamTracks: Set<Sponsor>[],
  nSlots: number,
): CapacityRow[] {
  const have = new Map<Sponsor, number>();
  for (const j of judges) if (j !== null) have.set(j, (have.get(j) ?? 0) + 1);
  const need = new Map<Sponsor, number>();
  for (const tr of teamTracks) for (const s of tr) need.set(s, (need.get(s) ?? 0) + 1);
  return [...new Set([...have.keys(), ...need.keys()])].sort(compareStr).map((sponsor) => {
    const judgesFrom = have.get(sponsor) ?? 0;
    const teamsWanting = need.get(sponsor) ?? 0;
    const capacity = judgesFrom * nSlots;
    return {
      sponsor,
      judges: judgesFrom,
      teamsWanting,
      capacity,
      ok: teamsWanting <= capacity,
      minJudges: nSlots ? Math.ceil(teamsWanting / nSlots) : 0,
    };
  });
}

/** Slots per panel for a roster: ceil(2T / D), D = floor(judges / 2). */
export function slotsFor(nTeams: number, nJudges: number): number {
  const nPanels = Math.floor(nJudges / 2);
  return nPanels > 0 ? Math.ceil((2 * nTeams) / nPanels) : 0;
}

export type PreflightWarning = {
  sponsor: Sponsor;
  teamsWanting: number;
  judges: number;
  nSlots: number;
  capacity: number;
  /** Teams wanting this track that no judge from it can see. */
  uncoverable: number;
  /** Smallest number of extra judges from this sponsor that clears it. */
  judgesToAdd: number;
  message: string;
};

export type Preflight = {
  nTeams: number;
  nJudges: number;
  nPanels: number;
  nSlots: number;
  rows: CapacityRow[];
  warnings: PreflightWarning[];
  /** With an odd count, one judge sits out (panels are pairs). */
  oddJudgeCount: boolean;
};

/**
 * Roster-only feasibility. teamTracks can be the checked-in teams or, before
 * check-in, the expected demand: it only needs each team's tracks.
 */
export function preflight(judges: JudgeRoster, teamTracks: Set<Sponsor>[]): Preflight {
  const nTeams = teamTracks.length;
  const nSlots = slotsFor(nTeams, judges.length);
  const rows = coverageCapacity(judges, teamTracks, nSlots);
  const warnings = rows
    .filter((r) => !r.ok)
    .map((r): PreflightWarning => {
      // Adding judges can add a panel, and a panel more means fewer slots
      // each, so recompute the slot count for every candidate roster size
      // rather than trusting minJudges.
      let add = 1;
      while ((r.judges + add) * slotsFor(nTeams, judges.length + add) < r.teamsWanting) add++;
      const uncoverable = r.teamsWanting - r.capacity;
      return {
        sponsor: r.sponsor,
        teamsWanting: r.teamsWanting,
        judges: r.judges,
        nSlots,
        capacity: r.capacity,
        uncoverable,
        judgesToAdd: add,
        message:
          `${r.sponsor}: ${r.teamsWanting} teams want this track, but ${r.judges} ` +
          `${r.sponsor} judge${r.judges === 1 ? "" : "s"} x ${nSlots} slots = ` +
          `${r.capacity} sightings. ${uncoverable} team${uncoverable === 1 ? "" : "s"} ` +
          `cannot be covered. Add ${add} ${r.sponsor} judge${add === 1 ? "" : "s"}.`,
      };
    });
  return {
    nTeams,
    nJudges: judges.length,
    nPanels: Math.floor(judges.length / 2),
    nSlots,
    rows,
    warnings,
    oddJudgeCount: judges.length % 2 === 1,
  };
}
