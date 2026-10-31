// Stage 1: decide WHICH two panels judge each team. Port of
// scheduler/pipeline.py (assign_teams) and, for the unconstrained case,
// scheduler/scheduler.py (assign_panel_pairs).
//
// Model: panels are vertices, teams are edges joining the two panels that
// judge them. We want every team's tracks covered, every panel's degree
// (workload) near-equal, and every panel pair used near-equally so no two
// panels see the same set of teams.

import type { Pair, Sponsor } from "./types.ts";
import { minBy, pairsOf, PyRandom, pyRound, pySum, sortedBy } from "./python.ts";

export type Stage1Result = {
  assignment: Pair[];
  /** Presentations per panel. */
  degree: number[];
  /** Teams per panel pair, for pairs that have any (Counter(assignment)). */
  overlap: number[];
};

const countMatching = (want: Set<Sponsor>, cover: Set<Sponsor>) => {
  let n = 0;
  for (const s of want) if (cover.has(s)) n++;
  return n;
};

/**
 * Give every team two panels covering as many of its tracks as possible,
 * while keeping panel workloads equal and panel-pair overlap low.
 */
export function assignTeams(
  teamTracks: Set<Sponsor>[],
  panelSponsors: Set<Sponsor>[],
  nPanels: number,
  seed = 0,
  repairRounds = 200,
): Stage1Result {
  const nTeams = teamTracks.length;
  // PITFALL: the hard degree cap ceil(2T/D) is load-bearing. Without it the
  // last few teams find every remaining panel pair touches a full panel.
  const cap = Math.ceil((2 * nTeams) / nPanels);
  const rng = new PyRandom(seed);
  const pairs = pairsOf(nPanels);
  const cover = pairs.map(([a, b]) => new Set([...panelSponsors[a], ...panelSponsors[b]]));

  const mult = new Array<number>(pairs.length).fill(0);
  const degree = new Array<number>(nPanels).fill(0);
  const assignment = new Array<number>(nTeams).fill(-1); // index into pairs

  // SCARCITY. A sponsor seen by few panels is a scarce resource: every time a
  // team that does NOT want that sponsor is seated on one of its panels, a
  // sighting is burned. Teams needing a scarce sponsor go first, and teams
  // that do not need it are steered away from those panels.
  const demand = new Map<Sponsor, number>();
  for (const tr of teamTracks) for (const s of tr) demand.set(s, (demand.get(s) ?? 0) + 1);
  const panelsWith = new Map<Sponsor, number>();
  for (let pi = 0; pi < nPanels; pi++) {
    for (const s of panelSponsors[pi]) panelsWith.set(s, (panelsWith.get(s) ?? 0) + 1);
  }
  const nSlots = cap;
  const scarcity = new Map<Sponsor, number>();
  for (const [s, n] of demand) {
    scarcity.set(s, n / Math.max((panelsWith.get(s) ?? 0) * nSlots, 1));
  }
  // Python's scarcity.get(s, 0) for a sponsor nobody wants is the int 0,
  // which adds nothing to the float sum; skipping it is equivalent.
  const scarcityOf = (sponsors: Iterable<Sponsor>) => {
    const values: number[] = [];
    for (const s of sponsors) {
      const v = scarcity.get(s);
      if (v !== undefined) values.push(v);
    }
    return values;
  };

  /** How much scarce capacity seating team t on pair pi burns. */
  const waste = (t: number, pi: number) => {
    const unwanted: Sponsor[] = [];
    for (const s of cover[pi]) if (!teamTracks[t].has(s)) unwanted.push(s);
    return pySum(scarcityOf(unwanted));
  };

  // Hardest teams first: most tracks, then scarcest tracks.
  const hardness = (t: number) => [-teamTracks[t].size, -pySum(scarcityOf(teamTracks[t]))];
  const teamIds = Array.from({ length: nTeams }, (_, t) => t);

  for (const t of sortedBy(teamIds, hardness)) {
    const want = teamTracks[t];
    const pairIds = pairs.map((_, pi) => pi);
    let room = pairIds.filter((pi) => degree[pairs[pi][0]] < cap && degree[pairs[pi][1]] < cap);
    if (room.length === 0) {
      // Capacity is exactly 2T when D*cap == 2T, so the last few teams can
      // find every legal pair exhausted. Relax the cap by one rather than
      // failing; the slot count is derived from the real degrees later.
      for (let slack = 1; room.length === 0; slack++) {
        room = pairIds.filter(
          (pi) => degree[pairs[pi][0]] < cap + slack && degree[pairs[pi][1]] < cap + slack,
        );
      }
    }
    const bestCov = Math.max(...room.map((pi) => countMatching(want, cover[pi])));
    const legal = room.filter((pi) => countMatching(want, cover[pi]) === bestCov);
    const pick = minBy(legal, (pi) => [
      pyRound(waste(t, pi), 3),
      mult[pi],
      degree[pairs[pi][0]] + degree[pairs[pi][1]],
      rng.random(),
    ]);
    mult[pick]++;
    degree[pairs[pick][0]]++;
    degree[pairs[pick][1]]++;
    assignment[t] = pick;
  }

  // Repair: try to lift still-uncovered teams by swapping with a team that
  // does not need the panel pair it is sitting on.
  const isMissing = (t: number) => {
    for (const s of teamTracks[t]) if (!cover[assignment[t]].has(s)) return true;
    return false;
  };
  for (let round = 0; round < repairRounds; round++) {
    const stuck = teamIds.filter(isMissing);
    if (stuck.length === 0) break;
    let improved = false;
    for (const t of stuck) {
      const want = teamTracks[t];
      const cur = countMatching(want, cover[assignment[t]]);
      for (let u = 0; u < nTeams; u++) {
        if (u === t) continue;
        const pu = assignment[u];
        if (countMatching(want, cover[pu]) <= cur) continue;
        // Swapping must not make u worse.
        const wu = teamTracks[u];
        if (countMatching(wu, cover[assignment[t]]) < countMatching(wu, cover[pu])) continue;
        assignment[u] = assignment[t];
        assignment[t] = pu;
        improved = true;
        break;
      }
      if (improved) break;
    }
    if (!improved) break;
  }

  return summarize(assignment.map((pi) => pairs[pi]), nPanels);
}

/**
 * The unconstrained Stage 1 (no tracks): least-used panel pair, tie-broken by
 * least-loaded panels, under the same hard cap. solve() does not use it; it
 * reproduces scheduler.py's run() for the parity tests.
 */
export function assignPanelPairs(nTeams: number, nPanels: number, seed = 0): Stage1Result {
  const rng = new PyRandom(seed);
  const pairs = pairsOf(nPanels);
  const mult = new Array<number>(pairs.length).fill(0);
  const degree = new Array<number>(nPanels).fill(0);
  const cap = Math.ceil((2 * nTeams) / nPanels);
  const assignment: Pair[] = [];
  const pairIds = pairs.map((_, pi) => pi);
  for (let t = 0; t < nTeams; t++) {
    const legal = pairIds.filter((pi) => degree[pairs[pi][0]] < cap && degree[pairs[pi][1]] < cap);
    const best = minBy(legal, (pi) => [
      mult[pi],
      degree[pairs[pi][0]] + degree[pairs[pi][1]],
      rng.random(),
    ]);
    mult[best]++;
    degree[pairs[best][0]]++;
    degree[pairs[best][1]]++;
    assignment.push(pairs[best]);
  }
  return summarize(assignment, nPanels);
}

function summarize(assignment: Pair[], nPanels: number): Stage1Result {
  const degree = new Array<number>(nPanels).fill(0);
  const counts = new Map<string, number>();
  for (const [a, b] of assignment) {
    degree[a]++;
    degree[b]++;
    const k = `${a}:${b}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return { assignment, degree, overlap: [...counts.values()] };
}
