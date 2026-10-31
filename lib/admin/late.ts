// Late team insertion against a PUBLISHED schedule, without moving anyone
// already in it: teams have screenshotted their times, so the generator is
// never re-run after publishing. Pure, so it is tested directly.
//
// The late team needs two seats: two different stations, two different
// slots, both slots far enough in the future to get there. Every pair of
// stations is tried with every pair of free slots, O(D^2 x S^2) for D
// stations and S slots (8 x 8 x 15 x 15 = 14,400 checks: instant), and the
// best by, in order:
//
//   1. fewest appended slots: a full schedule (the usual case: 60 teams fill
//      8 x 15 seats exactly) grows by a slot at the end rather than moving
//      anyone. At most two are appended;
//   2. fewest of the team's tracks left uncovered by the two stations;
//   3. not tighter than MIN_GAP slots apart, if avoidable;
//   4. least-used pair: fewest teams already at the two stations combined,
//      then fewest teams the two already share;
//   5. earliest finish, then station order, so the result is deterministic.

import { MIN_GAP } from "./review.ts";

export type LateStation = { id: string; label: string; sponsors: string[] };
export type LateSlot = {
  id: string;
  index: number;
  startsAt: string;
  endsAt: string;
};
export type LateAssignment = {
  teamId: string;
  stationId: string;
  slotId: string;
};

export type LateInput = {
  stations: LateStation[];
  slots: LateSlot[];
  /** Active (non-cancelled) assignments of the published version. */
  assignments: LateAssignment[];
  /** The late team's sponsor tracks (e.g. ["AWS"]). */
  sponsors: string[];
  /** Now, in ms. Slots starting before now + notice are not offered. */
  now: number;
  /** Minutes of notice the team needs to get to a station. */
  noticeMinutes?: number;
};

/** A seat: an existing slot, or a slot appended after the last one. */
export type LateSeat = {
  stationId: string;
  label: string;
  slotIndex: number;
  startsAt: string;
  endsAt: string;
  /** null for an appended slot. */
  slotId: string | null;
};

export type LatePlacement = {
  seats: [LateSeat, LateSeat];
  appendedSlots: number;
  missing: string[];
  gap: number;
};

export const LATE_NOTICE_MINUTES = 10;

export function placeLateTeam(input: LateInput): LatePlacement | null {
  const { stations, assignments, sponsors } = input;
  const notice = (input.noticeMinutes ?? LATE_NOTICE_MINUTES) * 60_000;
  const slots = [...input.slots].sort((a, b) => a.index - b.index);
  if (stations.length < 2 || slots.length === 0) return null;

  // Two candidate slots after the last, same length as the last.
  const last = slots[slots.length - 1];
  const length = Date.parse(last.endsAt) - Date.parse(last.startsAt);
  const appended: LateSlot[] = [1, 2].map((k) => ({
    id: "",
    index: last.index + k,
    startsAt: new Date(Date.parse(last.startsAt) + k * length).toISOString(),
    endsAt: new Date(Date.parse(last.endsAt) + k * length).toISOString(),
  }));
  const candidates = [...slots, ...appended].filter(
    (s) => Date.parse(s.startsAt) >= input.now + notice,
  );

  const taken = new Set(assignments.map((a) => `${a.stationId}|${a.slotId}`));
  const load = new Map<string, number>();
  const teamsAt = new Map<string, Set<string>>();
  for (const a of assignments) {
    load.set(a.stationId, (load.get(a.stationId) ?? 0) + 1);
    if (!teamsAt.has(a.stationId)) teamsAt.set(a.stationId, new Set());
    teamsAt.get(a.stationId)!.add(a.teamId);
  }
  const free = (stationId: string, s: LateSlot) =>
    s.id === "" || !taken.has(`${stationId}|${s.id}`);

  let best: { key: number[]; placement: LatePlacement } | null = null;
  for (let i = 0; i < stations.length; i++) {
    for (let j = 0; j < stations.length; j++) {
      if (i === j) continue;
      const a = stations[i];
      const b = stations[j];
      const covered = new Set([...a.sponsors, ...b.sponsors]);
      const missing = sponsors.filter((s) => !covered.has(s));
      const shared = [...(teamsAt.get(a.id) ?? [])].filter((t) =>
        teamsAt.get(b.id)?.has(t),
      ).length;
      const pairLoad = (load.get(a.id) ?? 0) + (load.get(b.id) ?? 0);
      for (const sa of candidates) {
        if (!free(a.id, sa)) continue;
        for (const sb of candidates) {
          // Station a first: each unordered pair is tried in both orders.
          if (sb.index <= sa.index || !free(b.id, sb)) continue;
          const appendedSlots = new Set(
            [sa, sb].filter((s) => s.id === "").map((s) => s.index),
          ).size;
          // An appended second slot only after the first one is used.
          if (sb.id === "" && sb.index === last.index + 2 && sa.id !== "")
            continue;
          const gap = sb.index - sa.index;
          const key = [
            appendedSlots,
            missing.length,
            gap < MIN_GAP ? 1 : 0,
            pairLoad,
            shared,
            sb.index,
            i,
            j,
          ];
          if (!best || less(key, best.key)) {
            best = {
              key,
              placement: {
                seats: [seat(a, sa), seat(b, sb)],
                appendedSlots,
                missing,
                gap,
              },
            };
          }
        }
      }
    }
  }
  return best?.placement ?? null;
}

function seat(st: LateStation, s: LateSlot): LateSeat {
  return {
    stationId: st.id,
    label: st.label,
    slotIndex: s.index,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    slotId: s.id === "" ? null : s.id,
  };
}

function less(x: number[], y: number[]): boolean {
  for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return x[k] < y[k];
  return false;
}
