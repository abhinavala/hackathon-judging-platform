// What a change to a station's judges does to the published schedule's
// track coverage there: the sponsors the station stops covering, and the
// teams at it that chose them. Pure, so it's tested directly.

export type StationTeam = { name: string; sponsors: string[] };

/** Sponsors covered before but not after, each with the teams it leaves out. */
export function coverageLost(
  teams: StationTeam[],
  before: string[],
  after: string[],
): { sponsor: string; teams: string[] }[] {
  const now = new Set(after);
  return [...new Set(before)]
    .filter((s) => !now.has(s))
    .map((sponsor) => ({
      sponsor,
      teams: teams
        .filter((t) => t.sponsors.includes(sponsor))
        .map((t) => t.name)
        .sort((a, b) => a.localeCompare(b)),
    }))
    .filter((l) => l.teams.length > 0);
}
