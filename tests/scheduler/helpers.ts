import { readFileSync } from "node:fs";
import { PyRandom, type JudgeRoster, type SolveResult, type Sponsor } from "../../lib/scheduler/index.ts";

/** pipeline.make_teams: per team, each sponsor with probability p, drawn in order. */
export function makeTeams(n: number, probs: [Sponsor, number][], seed: number): Set<Sponsor>[] {
  const rng = new PyRandom(seed);
  return Array.from({ length: n }, () => {
    const s = new Set<Sponsor>();
    for (const [sponsor, p] of probs) if (rng.random() < p) s.add(sponsor);
    return s;
  });
}

/** pipeline.roster(AWS=4, A10=3, none=9): labels in argument order. */
export function roster(counts: [Sponsor | "none", number][]): JudgeRoster {
  return counts.flatMap(([s, k]) => Array<Sponsor | null>(k).fill(s === "none" ? null : s));
}

/**
 * Checks a schedule from scratch (deliberately not via verify()): every team
 * twice, at two distinct panels, in two distinct slots, no panel double-booked.
 */
export function scheduleErrors(r: SolveResult, nTeams: number): string[] {
  const errs: string[] = [];
  const perTeam = new Map<number, { panel: number; slot: number }[]>();
  const panelSlot = new Set<string>();
  for (const [key, slot] of r.slotOf) {
    const [team, panel] = key.split(":").map(Number);
    perTeam.set(team, [...(perTeam.get(team) ?? []), { panel, slot }]);
    const ps = `${panel}:${slot}`;
    if (panelSlot.has(ps)) errs.push(`panel ${panel} has two teams in slot ${slot}`);
    panelSlot.add(ps);
    if (slot < 0 || slot >= r.nSlots) errs.push(`slot ${slot} out of range`);
  }
  for (let t = 0; t < nTeams; t++) {
    const p = perTeam.get(t) ?? [];
    if (p.length !== 2) errs.push(`team ${t} has ${p.length} presentations`);
    else if (p[0].panel === p[1].panel) errs.push(`team ${t} sees one panel twice`);
    else if (p[0].slot === p[1].slot) errs.push(`team ${t} double-booked`);
  }
  return errs;
}

export function panelDegrees(r: SolveResult): number[] {
  const degree = new Array<number>(r.panels.length).fill(0);
  for (const [a, b] of r.assignments) {
    degree[a]++;
    degree[b]++;
  }
  return degree;
}

type Goldens = {
  numerics: {
    random: { seed: number; values: number[] }[];
    shuffle: { seed: number; result: number[] }[];
    round: [number, number][];
    sum: [number[], number][];
    makeTeams: { n: number; probs: [Sponsor, number][]; seed: number; teams: Sponsor[][] };
  };
  track: Record<
    string,
    {
      teamTracks: Sponsor[][];
      judges: JudgeRoster;
      winner: string;
      panels: [number, number][];
      assignment: [number, number][];
      nSlots: number;
      colorOf: number[];
      full: number;
      seats: number;
      wanted: number;
      degree: number[];
      errs: string[];
    }
  >;
  plain: Record<
    string,
    {
      pairing: [number, number][];
      nColors: number;
      colorOf: number[];
      errs: string[];
      spaced: number[] | null;
    }
  >;
  capacity: {
    teamTracks: Sponsor[][];
    judges: JudgeRoster;
    nSlots: number;
    rows: {
      sponsor: Sponsor;
      judges: number;
      teams_wanting: number;
      capacity: number;
      ok: boolean;
      min_judges: number;
    }[];
  }[];
  regression: Record<
    string,
    {
      teamTracks: Sponsor[][];
      judges: JudgeRoster;
      full: number;
      seats: number;
      wanted: number;
      nSlots: number;
      minGap: number;
      degree: [number, number];
      winner: string;
      valid: boolean;
    }
  >;
};

export const goldens: Goldens = JSON.parse(
  readFileSync(new URL("./goldens.json", import.meta.url), "utf8"),
);
