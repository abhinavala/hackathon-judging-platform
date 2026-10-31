// Stage 0: form the judge pairs. Port of scheduler/stage0v2.py.
//
// Generate-and-test, not a single rule: build ~70 candidate panel
// compositions (spread, mix, hybrid-1..6, 60 random restarts), and let the
// caller score each by actually running Stage 1. The two sensible rules point
// in opposite directions and which wins depends on the roster:
//
//   SPREAD (sponsor + unaffiliated) maximises the NUMBER of sponsor-bearing
//   panels, so AWS teams and A10 teams don't compete for the same seats. Best
//   when sponsor judges are scarce.
//
//   MIX (sponsor + different sponsor) lets one visit cover two tracks at once.
//   Necessary when teams submit to 3+ tracks: a team sees only 2 panels, and an
//   all-spread layout can never cover more than 2 sponsors for one team.
//
// Random restarts won most multi-sponsor cases in testing. Do not replace this
// with a heuristic.

import type { JudgeRoster, Pair, Sponsor } from "./types.ts";
import { compareStr, PyRandom } from "./python.ts";

type Label = Sponsor | null;
type Plan = [Label, Label][];
type Counts = Map<Label, number>;

const get = (c: Counts, s: Label) => c.get(s) ?? 0;
const coKey = (a: Sponsor, b: Sponsor) => `${a}\u0000${b}`;

/** Each sponsor judge paired with an unaffiliated judge where possible. */
function strategySpread(sponsors: Sponsor[], counts: Counts, nPanels: number): [Plan, Counts] {
  const plan: Plan = [];
  const c = new Map(counts);
  for (const s of sponsors) {
    while (get(c, s) > 0 && get(c, null) > 0 && plan.length < nPanels) {
      plan.push([s, null]);
      c.set(s, get(c, s) - 1);
      c.set(null, get(c, null) - 1);
    }
  }
  return [plan, c];
}

/** Sponsor judges paired with each other, most co-occurring first. */
function strategyMix(
  sponsors: Sponsor[],
  counts: Counts,
  nPanels: number,
  co: Map<string, number>,
): [Plan, Counts] {
  const plan: Plan = [];
  const c = new Map(counts);
  const combos: [Sponsor, Sponsor][] = [];
  for (let i = 0; i < sponsors.length; i++) {
    for (let j = i + 1; j < sponsors.length; j++) combos.push([sponsors[i], sponsors[j]]);
  }
  // sorted(..., key=-co[pair]): stable, so ties keep combination order.
  const order = combos
    .map((p, index) => ({ p, index, k: -(co.get(coKey(...sortPair(p))) ?? 0) }))
    .sort((x, y) => x.k - y.k || x.index - y.index)
    .map((d) => d.p);
  for (const [a, b] of order) {
    while (get(c, a) > 0 && get(c, b) > 0 && plan.length < nPanels) {
      plan.push([a, b]);
      c.set(a, get(c, a) - 1);
      c.set(b, get(c, b) - 1);
    }
  }
  return [plan, c];
}

/** nMixed co-occurring mixed panels, remaining sponsors spread. */
function strategyHybrid(
  sponsors: Sponsor[],
  counts: Counts,
  nPanels: number,
  co: Map<string, number>,
  nMixed: number,
): [Plan, Counts] {
  const [plan, c] = strategyMix(sponsors, counts, Math.min(nMixed, nPanels), co);
  const [rest, c2] = strategySpread(sponsors, c, nPanels - plan.length);
  return [[...plan, ...rest], c2];
}

/** Pair whatever judges remain, then pad. */
function finish(plan: Plan, c: Counts, nPanels: number): Plan {
  const out: Plan = [...plan];
  const leftovers: Label[] = [];
  for (const [s, k] of c) for (let i = 0; i < Math.max(0, k); i++) leftovers.push(s);
  // sort(key=lambda s: (s is None, str(s))), stable.
  const sortKey = (s: Label): [number, string] => [s === null ? 1 : 0, s ?? "None"];
  leftovers.sort((a, b) => {
    const [na, sa] = sortKey(a);
    const [nb, sb] = sortKey(b);
    return na - nb || compareStr(sa, sb);
  });
  while (leftovers.length >= 2 && out.length < nPanels) {
    const a = leftovers.shift()!;
    let j = leftovers.findIndex((t) => t !== a);
    if (j < 0) j = 0;
    const b = leftovers.splice(j, 1)[0];
    out.push([a, b]);
  }
  return out;
}

/** plan: (sponsorA, sponsorB) label pairs -> concrete judge indices, or null. */
function panelsFromPlan(judges: JudgeRoster, plan: Plan): Pair[] | null {
  const pool = new Map<Label, number[]>();
  const poolOf = (s: Label) => {
    let list = pool.get(s);
    if (!list) pool.set(s, (list = []));
    return list;
  };
  judges.forEach((s, i) => poolOf(s).push(i));
  const panels: Pair[] = [];
  for (const [a, b] of plan) {
    const pa = poolOf(a);
    const pb = poolOf(b);
    if (!pa.length || !pb.length || (a === b && pa.length < 2)) return null;
    const ia = pa.pop()!;
    const ib = pb.pop()!;
    panels.push([ia, ib]);
  }
  return panels;
}

function sortPair([a, b]: [Sponsor, Sponsor]): [Sponsor, Sponsor] {
  return compareStr(a, b) <= 0 ? [a, b] : [b, a];
}

/** All candidate panel compositions, named, each exactly nPanels long. */
export function candidatePlans(
  judges: JudgeRoster,
  teamTracks: Set<Sponsor>[],
  nPanels: number,
): [string, Pair[]][] {
  const counts: Counts = new Map();
  for (const s of judges) counts.set(s, get(counts, s) + 1);
  const sponsors = [...counts.keys()]
    .filter((s): s is Sponsor => s !== null)
    .sort(compareStr);
  const co = new Map<string, number>();
  for (const tr of teamTracks) {
    const sorted = [...tr].sort(compareStr);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const k = coKey(sorted[i], sorted[j]);
        co.set(k, (co.get(k) ?? 0) + 1);
      }
    }
  }

  const plans: [string, Plan][] = [];
  const spread = strategySpread(sponsors, counts, nPanels);
  const mix = strategyMix(sponsors, counts, nPanels, co);
  plans.push(["spread", finish(spread[0], spread[1], nPanels)]);
  plans.push(["mix", finish(mix[0], mix[1], nPanels)]);
  for (let k = 1; k < Math.min(nPanels, 7); k++) {
    const [p, c] = strategyHybrid(sponsors, counts, nPanels, co, k);
    plans.push([`hybrid-${k}`, finish(p, c, nPanels)]);
  }

  // A few random restarts as a safety net.
  const rng = new PyRandom(12345);
  const flat: Label[] = [];
  for (const [s, k] of counts) for (let i = 0; i < k; i++) flat.push(s);
  for (let r = 0; r < 60; r++) {
    const f = [...flat];
    rng.shuffle(f);
    const plan: Plan = [];
    for (let i = 0; i < Math.min(nPanels, Math.floor(f.length / 2)); i++) {
      plan.push([f[2 * i], f[2 * i + 1]]);
    }
    plans.push([`random-${r}`, plan]);
  }

  const out: [string, Pair[]][] = [];
  for (const [name, plan] of plans) {
    const panels = panelsFromPlan(judges, plan);
    if (panels && panels.length === nPanels) out.push([name, panels]);
  }
  return out;
}
