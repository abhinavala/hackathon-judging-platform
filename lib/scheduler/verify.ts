// Port of scheduler/scheduler.py (verify). The same invariants the database
// enforces with unique constraints and the max-two trigger.

import type { EdgeKey } from "./color.ts";

export function verify(
  colorOf: Map<EdgeKey, number>,
  nTeams: number,
  nPanels: number,
): string[] {
  const errs: string[] = [];
  const byTeam = new Map<number, [number, number][]>();
  const byPanelSlot = new Map<string, number[]>();
  for (const [key, c] of colorOf) {
    const t = Math.floor(key / nPanels);
    const p = key % nPanels;
    byTeam.set(t, [...(byTeam.get(t) ?? []), [p, c]]);
    const ps = `${p}:${c}`;
    byPanelSlot.set(ps, [...(byPanelSlot.get(ps) ?? []), t]);
  }
  for (let t = 0; t < nTeams; t++) {
    const s = byTeam.get(t) ?? [];
    if (s.length !== 2) errs.push(`team ${t} has ${s.length} presentations`);
    else if (s[0][0] === s[1][0]) errs.push(`team ${t} sees the same panel twice`);
    else if (s[0][1] === s[1][1]) errs.push(`team ${t} double-booked at slot ${s[0][1]}`);
  }
  for (const [ps, ts] of byPanelSlot) {
    if (ts.length > 1) {
      const [p, c] = ps.split(":");
      errs.push(`panel ${p} slot ${c} has ${ts.length} teams`);
    }
  }
  return errs;
}
