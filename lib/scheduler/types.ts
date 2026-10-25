/** A sponsor track label, e.g. "AWS" or "A10". */
export type Sponsor = string;

/** One entry per judge: the sponsor they represent, or null (alum/faculty). */
export type JudgeRoster = (Sponsor | null)[];

/** Two indices: judges for a panel, panels for a team. */
export type Pair = [number, number];

export type SolveInput = {
  /** One entry per team: the sponsor tracks it submitted to. */
  teamTracks: Set<Sponsor>[];
  judges: JudgeRoster;
  seed?: number;
};

export type SolveStats = {
  teamsFullyCovered: number;
  trackSeatsMet: number;
  trackSeatsWanted: number;
  /** [min, max] presentations per panel. */
  teamsPerPanel: [number, number];
  /** [min, max] teams shared by a panel pair that shares any. */
  overlapRange: [number, number];
  /** [min, max] slots between a team's two presentations. */
  gapRange: [number, number];
  uncoveredTeams: { team: number; missing: Sponsor[] }[];
  winningStrategy: string;
};

export type SolveResult = {
  /** Judge index pairs, one per panel. */
  panels: Pair[];
  panelSponsors: Set<Sponsor>[];
  /** Per team, its two panels. */
  assignments: Pair[];
  /** `${team}:${panel}` -> slot index. */
  slotOf: Map<string, number>;
  nSlots: number;
  stats: SolveStats;
};
