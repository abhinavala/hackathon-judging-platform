// Stage 3: spacing repair. Port of scheduler/scheduler.py (improve_spacing).
//
// A valid colouring may still hand a team slots 4 and 5. Two repair moves:
//
//   MOVE: shift a presentation into a slot that is empty at that panel.
//   SWAP: trade slots with the team currently sitting in the slot we want.
//
// PITFALL: SWAP is the important one. When a panel is saturated (8 panels,
// 15 teams in 15 slots) there are no empty slots at all, so MOVE can never
// fire and only SWAP can improve anything; adding it took the worst-case gap
// from 1 slot to 5. Both moves preserve validity by construction: a slot is
// only accepted if it does not collide with the team's other slot.
//
// ORDER-SENSITIVE: the output depends on the insertion order of colorOf, not
// just its contents. slotsOf is built by iterating colorOf, teams are visited
// in sortedBy(gap) order, and that sort is stable, so among equal gaps the
// insertion order decides who is repaired first and changes the result. Do
// not rebuild, sort or copy colorOf in a different order (here or upstream in
// edgeColor) without regenerating the goldens from the Python and expecting
// different schedules: tests/scheduler/python-parity.test.ts compares order.

import type { EdgeKey } from "./color.ts";
import { sortedBy } from "./python.ts";

export function improveSpacing(
  colorOf: Map<EdgeKey, number>,
  nColors: number,
  nPanels: number,
  target = Math.floor(nColors / 3),
  passes = 60,
): Map<EdgeKey, number> {
  const slotsOf = new Map<number, Map<number, number>>(); // team -> panel -> slot
  const occupant = new Map<number, Map<number, number>>(); // panel -> slot -> team
  const inner = <K, V>(m: Map<number, Map<K, V>>, k: number) => {
    let v = m.get(k);
    if (!v) m.set(k, (v = new Map()));
    return v;
  };
  for (const [key, c] of colorOf) {
    const t = Math.floor(key / nPanels);
    const p = key % nPanels;
    inner(slotsOf, t).set(p, c);
    inner(occupant, p).set(c, t);
  }

  const gap = (t: number) => {
    const [a, b] = slotsOf.get(t)!.values();
    return Math.abs(a - b);
  };
  const otherSlot = (t: number, p: number) => {
    for (const [q, c] of slotsOf.get(t)!) if (q !== p) return c;
    throw new Error(`team ${t} has no second presentation`);
  };

  for (let pass = 0; pass < passes; pass++) {
    let changed = false;
    for (const t of sortedBy([...slotsOf.keys()], (team) => [gap(team)])) {
      if (gap(t) >= target) continue;
      for (const p of [...slotsOf.get(t)!.keys()]) {
        const cur = slotsOf.get(t)!.get(p)!;
        const oth = otherSlot(t, p);
        let best: { cand: number; u: number | null } | null = null;
        let bestGain = 0;
        for (let cand = 0; cand < nColors; cand++) {
          if (cand === cur || cand === oth) continue;
          const gain = Math.abs(cand - oth) - Math.abs(cur - oth);
          if (gain <= bestGain) continue;
          const u = occupant.get(p)!.get(cand);
          if (u === undefined) {
            best = { cand, u: null }; // MOVE
            bestGain = gain;
          } else {
            const uOth = otherSlot(u, p); // SWAP
            if (cur === uOth) continue; // would double-book u
            // Only swap if u is not badly hurt.
            if (Math.abs(cur - uOth) >= Math.min(target, Math.abs(cand - uOth))) {
              best = { cand, u };
              bestGain = gain;
            }
          }
        }
        if (best) {
          const { cand, u } = best;
          const occ = occupant.get(p)!;
          if (u === null) {
            occ.delete(cur);
            slotsOf.get(t)!.set(p, cand);
            occ.set(cand, t);
          } else {
            occ.delete(cur);
            occ.delete(cand);
            slotsOf.get(t)!.set(p, cand);
            occ.set(cand, t);
            slotsOf.get(u)!.set(p, cur);
            occ.set(cur, u);
          }
          changed = true;
          break;
        }
      }
    }
    if (!changed) break;
  }

  const out = new Map<EdgeKey, number>();
  for (const [t, d] of slotsOf) for (const [p, c] of d) out.set(t * nPanels + p, c);
  return out;
}
