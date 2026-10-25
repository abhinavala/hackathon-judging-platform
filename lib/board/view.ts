// The big-screen board's logic, pure so it is tested directly: which slot is
// on now, which is next, and what to say when there isn't one. No React,
// no I/O. Imports are relative with .ts extensions so node --test runs it.

import type { Announcement } from "../team/view.ts";

export type BoardSlot = { index: number; startsAt: string; endsAt: string };
export type BoardStation = { label: string; location: string | null };

export type BoardView =
  | { found: false }
  | {
      found: true;
      event: {
        name: string;
        slug: string;
        timezone: string;
        judgingStartsAt: string | null;
        helpLocation: string | null;
      };
      published: { version: number; publishedAt: string | null } | null;
      stations: BoardStation[];
      slots: BoardSlot[];
      cells: { slotIndex: number; station: string; team: string }[];
      announcements: Announcement[];
    };

/** The JSON from the board_view() RPC (snake_case) -> BoardView. */
export function fromRpc(raw: unknown): BoardView {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.found !== true) return { found: false };
  const e = r.event as Record<string, string | null>;
  const pub = r.published as {
    version: number;
    published_at: string | null;
  } | null;
  const list = (k: string) => (r[k] as Record<string, unknown>[] | null) ?? [];
  return {
    found: true,
    event: {
      name: e.name as string,
      slug: e.slug as string,
      timezone: e.timezone as string,
      judgingStartsAt: e.judging_starts_at ?? null,
      helpLocation: e.help_location ?? null,
    },
    published: pub
      ? { version: pub.version, publishedAt: pub.published_at }
      : null,
    stations: list("stations").map((s) => ({
      label: s.label as string,
      location: (s.location as string | null) ?? null,
    })),
    slots: list("slots").map((s) => ({
      index: s.index as number,
      startsAt: s.starts_at as string,
      endsAt: s.ends_at as string,
    })),
    cells: list("cells").map((c) => ({
      slotIndex: c.slot_index as number,
      station: c.station as string,
      team: c.team as string,
    })),
    announcements: list("announcements").map((a) => ({
      body: a.body as string,
      level: a.level as Announcement["level"],
      createdAt: a.created_at as string,
    })),
  };
}

/** One slot across every station: who is where. Empty seats are null. */
export type BoardRow = {
  slot: BoardSlot;
  cells: { station: string; location: string | null; team: string | null }[];
};

export type Moment =
  | { kind: "not-found" }
  | { kind: "unpublished"; judgingStartsAt: string | null }
  | { kind: "empty"; version: number }
  /** Before a slot: before judging (first = true) or in a gap between slots. */
  | {
      kind: "upcoming";
      row: BoardRow;
      after: BoardRow | null;
      minutes: number;
      first: boolean;
    }
  | {
      kind: "now";
      row: BoardRow;
      next: BoardRow | null;
      minutesLeft: number;
    }
  | { kind: "done"; version: number };

export function boardMoment(view: BoardView, now: number): Moment {
  if (!view.found) return { kind: "not-found" };
  if (!view.published)
    return { kind: "unpublished", judgingStartsAt: view.event.judgingStartsAt };
  const slots = [...view.slots].sort((a, b) => a.index - b.index);
  if (slots.length === 0)
    return { kind: "empty", version: view.published.version };

  const teamAt = new Map(
    view.cells.map((c) => [`${c.slotIndex}|${c.station}`, c.team]),
  );
  const row = (slot: BoardSlot | undefined): BoardRow | null =>
    slot
      ? {
          slot,
          cells: view.stations.map((s) => ({
            station: s.label,
            location: s.location,
            team: teamAt.get(`${slot.index}|${s.label}`) ?? null,
          })),
        }
      : null;

  for (const [i, slot] of slots.entries()) {
    const start = Date.parse(slot.startsAt);
    const end = Date.parse(slot.endsAt);
    if (now < start)
      return {
        kind: "upcoming",
        row: row(slot)!,
        after: row(slots[i + 1]),
        minutes: Math.ceil((start - now) / 60_000),
        first: i === 0,
      };
    if (now < end)
      return {
        kind: "now",
        row: row(slot)!,
        next: row(slots[i + 1]),
        minutesLeft: Math.ceil((end - now) / 60_000),
      };
  }
  return { kind: "done", version: view.published.version };
}
