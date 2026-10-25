// The full pipeline. Port of scheduler/pipeline2.py (solve, score_plan):
// search panel compositions (Stage 0), score each by running the track-aware
// assignment (Stage 1), keep the best, then colour into slots (Stage 2) and
// repair spacing (Stage 3).
//
// Pure: plain data in, plain data out, no I/O.

import type { Pair, SolveInput, SolveResult, Sponsor } from "./types.ts";
import { candidatePlans } from "./stage0.ts";
import { assignTeams, type Stage1Result } from "./stage1.ts";
import { edgeColor } from "./color.ts";
import { improveSpacing } from "./spacing.ts";
import { verify } from "./verify.ts";
import { compareKeys, PyRandom } from "./python.ts";

/** Track coverage of an assignment: (teams fully covered, track-seats met). */
function coverage(teamTracks: Set<Sponsor>[], panelSponsors: Set<Sponsor>[], assignment: Pair[]) {
  let full = 0;
  let seats = 0;
  assignment.forEach(([x, y], t) => {
    let met = 0;
    for (const s of teamTracks[t]) {
      if (panelSponsors[x].has(s) || panelSponsors[y].has(s)) met++;
    }
    seats += met;
    if (met === teamTracks[t].size) full++;
  });
  return { full, seats };
}

export function solve({ teamTracks, judges, seed = 0, panels: fixedPanels }: SolveInput): SolveResult {
  const nTeams = teamTracks.length;
  const nPanels = fixedPanels ? fixedPanels.length : Math.floor(judges.length / 2);
  if (nTeams === 0) throw new Error("solve: no teams");
  if (nPanels < 2) throw new Error("solve: need at least 4 judges (2 panels)");

  let best: {
    name: string;
    panels: Pair[];
    panelSponsors: Set<Sponsor>[];
    stage1: Stage1Result;
    full: number;
    seats: number;
  } | null = null;
  if (fixedPanels) {
    const seen = new Set<number>();
    for (const [a, b] of fixedPanels) {
      for (const j of [a, b]) {
        if (!Number.isInteger(j) || j < 0 || j >= judges.length) throw new Error(`solve: no judge ${j}`);
        if (seen.has(j)) throw new Error(`solve: judge ${j} is on two panels`);
        seen.add(j);
      }
    }
  }
  const plans: [string, Pair[]][] = fixedPanels
    ? [["fixed", fixedPanels]]
    : candidatePlans(judges, teamTracks, nPanels);
  for (const [name, panels] of plans) {
    const panelSponsors = panels.map(([a, b]) => {
      const s = new Set<Sponsor>();
      for (const j of [judges[a], judges[b]]) if (j !== null) s.add(j);
      return s;
    });
    const stage1 = assignTeams(teamTracks, panelSponsors, nPanels, seed);
    const { full, seats } = coverage(teamTracks, panelSponsors, stage1.assignment);
    if (!best || compareKeys([full, seats], [best.full, best.seats]) > 0) {
      best = { name, panels, panelSponsors, stage1, full, seats };
    }
  }
  if (!best) throw new Error("solve: no candidate panel composition fits this roster");
  const winner = best;

  const { assignment, degree, overlap } = winner.stage1;
  // PITFALL: derive the slot count from the degrees actually built, not from
  // ceil(2T/D). Track constraints can push a panel past the ideal; one extra
  // slot is the correct outcome, and assuming the ideal crashes the colourer.
  const nSlots = Math.max(Math.ceil((2 * nTeams) / nPanels), ...degree);

  const edges: [number, number][] = assignment.flatMap(([x, y], t) => [
    [t, x],
    [t, y],
  ]);
  new PyRandom(seed).shuffle(edges);
  const colorOf = improveSpacing(edgeColor(edges, nTeams, nPanels, nSlots), nSlots, nPanels);
  const errs = verify(colorOf, nTeams, nPanels);
  if (errs.length) throw new Error(`solve produced an invalid schedule: ${errs.join("; ")}`);

  const slotOf = new Map<string, number>();
  const slotsByTeam = new Map<number, number[]>();
  for (const [key, c] of colorOf) {
    const t = Math.floor(key / nPanels);
    const p = key % nPanels;
    slotOf.set(`${t}:${p}`, c);
    slotsByTeam.set(t, [...(slotsByTeam.get(t) ?? []), c]);
  }
  const gaps = [...slotsByTeam.values()].map(([a, b]) => Math.abs(a - b));

  const uncoveredTeams = assignment.flatMap(([x, y], team) => {
    const missing = [...teamTracks[team]].filter(
      (s) => !winner.panelSponsors[x].has(s) && !winner.panelSponsors[y].has(s),
    );
    return missing.length ? [{ team, missing }] : [];
  });

  return {
    panels: winner.panels,
    panelSponsors: winner.panelSponsors,
    assignments: assignment,
    slotOf,
    nSlots,
    stats: {
      teamsFullyCovered: winner.full,
      trackSeatsMet: winner.seats,
      trackSeatsWanted: teamTracks.reduce((n, tr) => n + tr.size, 0),
      teamsPerPanel: [Math.min(...degree), Math.max(...degree)],
      overlapRange: [Math.min(...overlap), Math.max(...overlap)],
      gapRange: [Math.min(...gaps), Math.max(...gaps)],
      uncoveredTeams,
      winningStrategy: winner.name,
    },
  };
}
