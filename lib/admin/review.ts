// Schedule review: everything the preview screen shows before an organizer
// publishes, computed from plain data. Pure, so it is tested directly and
// the publish action can recompute it server-side to check that every
// warning was acknowledged.
//
// Warnings advise; the organizer decides. Each has a stable id so the
// publish form can require an explicit acknowledgement of each one.

import { clock } from "./time.ts";

export type ReviewTeam = { id: string; name: string; sponsors: string[] };
export type ReviewStation = { id: string; label: string; sponsors: string[] };
export type ReviewSlot = { id: string; index: number; startsAt: string };
export type ReviewAssignment = {
  teamId: string;
  stationId: string;
  slotId: string;
};

export type ReviewInput = {
  teams: ReviewTeam[];
  stations: ReviewStation[];
  slots: ReviewSlot[];
  /** Active (non-cancelled) assignments. */
  assignments: ReviewAssignment[];
  /** Checked-in teams that this schedule leaves out. */
  excludedTeams?: { id: string; name: string }[];
  /** The currently published version, if this is a different one. */
  published?: {
    version: number;
    slots: ReviewSlot[];
    stations: { id: string; label: string }[];
    assignments: ReviewAssignment[];
    /** Names of the teams in it (for teams the new version dropped). */
    teams?: { id: string; name: string }[];
  } | null;
  /**
   * A late-change draft copies one published version. If another version
   * has been published since, publishing this would undo that change.
   */
  basedOnVersion?: number | null;
  /** The event's judging start (what unpublished team pages announce). */
  judgingStart?: { startsAt: string; timezone: string } | null;
};

export type WarningId =
  | "uncovered"
  | "tight-spacing"
  | "heavy-overlap"
  | "uneven-load"
  | "unfilled-slots"
  | "excluded-teams"
  | "changes-vs-published"
  | "start-differs";

export type ReviewWarning = { id: WarningId; title: string; detail: string[] };

export type Placement = {
  stationId: string;
  label: string;
  slotIndex: number;
  startsAt: string;
};

export type Review = {
  coverage: {
    teams: number;
    fullyCovered: number;
    seatsMet: number;
    seatsWanted: number;
    uncovered: { teamId: string; name: string; missing: string[] }[];
  };
  spacing: {
    /** Slots from a team's first presentation to its second. */
    minGap: number | null;
    distribution: { gap: number; teams: number }[];
    tight: { teamId: string; name: string; gap: number }[];
  };
  overlap: {
    /** matrix[i][j] = teams seen by both station i and station j (i != j). */
    matrix: number[][];
    maxShared: number;
    heavy: { a: string; b: string; shared: number }[];
  };
  capacity: {
    slots: number;
    seats: number;
    filled: number;
    unfilled: number;
    perStation: { stationId: string; label: string; teams: number }[];
  };
  invalid: string[];
  diff: {
    againstVersion: number;
    moved: { name: string; from: Placement[]; to: Placement[] }[];
    added: { name: string; to: Placement[] }[];
    removed: { name: string; from: Placement[] }[];
  } | null;
  warnings: ReviewWarning[];
};

/** Teams whose presentations are closer than this many slots get a warning. */
export const MIN_GAP = 3;
/** Station pairs sharing more than this many teams get a warning. */
export const MAX_SHARED = 5;

export function reviewSchedule(input: ReviewInput): Review {
  const { teams, stations, slots, assignments } = input;
  const slotIndex = new Map(slots.map((s) => [s.id, s.index]));
  const stationAt = new Map(stations.map((s, i) => [s.id, i]));
  const byTeam = new Map<string, ReviewAssignment[]>();
  for (const a of assignments)
    byTeam.set(a.teamId, [...(byTeam.get(a.teamId) ?? []), a]);

  // Structural problems (the database constraints should make these
  // impossible; shown as hard errors if they ever appear).
  const invalid: string[] = [];
  const seenSeat = new Set<string>();
  for (const a of assignments) {
    const seat = `${a.stationId}|${a.slotId}`;
    if (seenSeat.has(seat))
      invalid.push(`Two teams at one station in one slot (${seat}).`);
    seenSeat.add(seat);
  }
  for (const t of teams) {
    const mine = byTeam.get(t.id) ?? [];
    if (mine.length !== 2)
      invalid.push(`${t.name} has ${mine.length} presentations, not 2.`);
    else if (mine[0].stationId === mine[1].stationId)
      invalid.push(`${t.name} sees one station twice.`);
    else if (mine[0].slotId === mine[1].slotId)
      invalid.push(`${t.name} is in two places at once.`);
  }

  if (
    input.basedOnVersion != null &&
    input.basedOnVersion !== input.published?.version
  ) {
    invalid.push(
      `This late change was made to v${input.basedOnVersion}, but ${
        input.published ? `v${input.published.version}` : "no version"
      } is published now. Publishing it would undo whatever changed since; make the change again from the published version.`,
    );
  }

  // Coverage: a team's tracks against the sponsors on the stations it visits.
  const sponsorsAt = new Map(stations.map((s) => [s.id, new Set(s.sponsors)]));
  const uncovered: Review["coverage"]["uncovered"] = [];
  let seatsMet = 0;
  let seatsWanted = 0;
  for (const t of teams) {
    const seen = new Set(
      (byTeam.get(t.id) ?? []).flatMap((a) => [
        ...(sponsorsAt.get(a.stationId) ?? []),
      ]),
    );
    const missing = t.sponsors.filter((s) => !seen.has(s));
    seatsWanted += t.sponsors.length;
    seatsMet += t.sponsors.length - missing.length;
    if (missing.length) uncovered.push({ teamId: t.id, name: t.name, missing });
  }

  // Spacing.
  const gaps: { teamId: string; name: string; gap: number }[] = [];
  for (const t of teams) {
    const mine = byTeam.get(t.id) ?? [];
    if (mine.length === 2) {
      gaps.push({
        teamId: t.id,
        name: t.name,
        gap: Math.abs(
          slotIndex.get(mine[0].slotId)! - slotIndex.get(mine[1].slotId)!,
        ),
      });
    }
  }
  const histogram = new Map<number, number>();
  for (const g of gaps) histogram.set(g.gap, (histogram.get(g.gap) ?? 0) + 1);
  const tight = gaps
    .filter((g) => g.gap < MIN_GAP)
    .sort((a, b) => a.gap - b.gap || a.name.localeCompare(b.name));

  // Overlap: teams shared by each pair of stations.
  const matrix = stations.map(() => stations.map(() => 0));
  for (const mine of byTeam.values()) {
    if (mine.length !== 2) continue;
    const [i, j] = [
      stationAt.get(mine[0].stationId),
      stationAt.get(mine[1].stationId),
    ];
    if (i === undefined || j === undefined || i === j) continue;
    matrix[i][j]++;
    matrix[j][i]++;
  }
  const heavy: Review["overlap"]["heavy"] = [];
  let maxShared = 0;
  for (let i = 0; i < stations.length; i++) {
    for (let j = i + 1; j < stations.length; j++) {
      maxShared = Math.max(maxShared, matrix[i][j]);
      if (matrix[i][j] > MAX_SHARED) {
        heavy.push({
          a: stations[i].label,
          b: stations[j].label,
          shared: matrix[i][j],
        });
      }
    }
  }

  // Capacity.
  const perStation = stations.map((s) => ({
    stationId: s.id,
    label: s.label,
    teams: assignments.filter((a) => a.stationId === s.id).length,
  }));
  const usedStations = perStation.filter((p) => p.teams > 0);
  const seats = usedStations.length * slots.length;
  const capacity = {
    slots: slots.length,
    seats,
    filled: assignments.length,
    unfilled: seats - assignments.length,
    perStation,
  };

  const diff = input.published ? diffAgainst(input, input.published) : null;

  const warnings: ReviewWarning[] = [];
  if (uncovered.length) {
    warnings.push({
      id: "uncovered",
      title: `${uncovered.length} team${uncovered.length === 1 ? "" : "s"} not fully track-covered`,
      detail: uncovered.map(
        (u) => `${u.name}: no ${u.missing.join(", ")} judge`,
      ),
    });
  }
  if (tight.length) {
    warnings.push({
      id: "tight-spacing",
      title: `${tight.length} team${tight.length === 1 ? "" : "s"} with fewer than ${MIN_GAP} slots between presentations`,
      detail: tight.map(
        (t) => `${t.name}: ${t.gap} slot${t.gap === 1 ? "" : "s"} apart`,
      ),
    });
  }
  if (heavy.length) {
    warnings.push({
      id: "heavy-overlap",
      title: `${heavy.length} station pair${heavy.length === 1 ? "" : "s"} share more than ${MAX_SHARED} teams`,
      detail: heavy.map(
        (h) => `${h.a} and ${h.b}: ${h.shared} teams in common`,
      ),
    });
  }
  if (usedStations.length) {
    const loads = usedStations.map((p) => p.teams);
    if (Math.max(...loads) - Math.min(...loads) > 1) {
      warnings.push({
        id: "uneven-load",
        title: `Stations see between ${Math.min(...loads)} and ${Math.max(...loads)} teams`,
        detail: [
          "Uneven sponsor demand pulls teams toward the stations with those sponsors' judges.",
          ...usedStations.map((p) => `${p.label}: ${p.teams}`),
        ],
      });
    }
  }
  if (capacity.unfilled > 0) {
    warnings.push({
      id: "unfilled-slots",
      title: `${capacity.unfilled} empty seat${capacity.unfilled === 1 ? "" : "s"} across stations`,
      detail: [
        "Judges will have idle slots; expected when team counts don't divide evenly.",
      ],
    });
  }
  if (input.excludedTeams?.length) {
    warnings.push({
      id: "excluded-teams",
      title: `${input.excludedTeams.length} checked-in team${input.excludedTeams.length === 1 ? " is" : "s are"} not in this schedule`,
      detail: input.excludedTeams.map((t) => t.name),
    });
  }
  if (diff && (diff.moved.length || diff.added.length || diff.removed.length)) {
    warnings.push({
      id: "changes-vs-published",
      title: `Changes from the published v${diff.againstVersion}: ${diff.moved.length} moved, ${diff.added.length} added, ${diff.removed.length} removed`,
      detail: [
        "Teams may have screenshotted their v" +
          diff.againstVersion +
          " times.",
        ...diff.moved.map((m) => `${m.name}: ${fmt(m.from)} -> ${fmt(m.to)}`),
        ...diff.added.map((a) => `${a.name}: new, ${fmt(a.to)}`),
        ...diff.removed.map((r) => `${r.name}: no longer scheduled`),
      ],
    });
  }

  const first = [...slots].sort((a, b) => a.index - b.index)[0];
  const js = input.judgingStart;
  if (first && js && Date.parse(first.startsAt) !== Date.parse(js.startsAt)) {
    warnings.push({
      id: "start-differs",
      title: `Starts at ${clock(first.startsAt, js.timezone)}, not the event's judging start (${clock(js.startsAt, js.timezone)})`,
      detail: [
        `Team pages tell everyone judging starts at ${clock(js.startsAt, js.timezone)}.`,
        "Publish anyway and update the judging start on the Event screen, or regenerate at that time.",
      ],
    });
  }

  return {
    coverage: {
      teams: teams.length,
      fullyCovered: teams.length - uncovered.length,
      seatsMet,
      seatsWanted,
      uncovered,
    },
    spacing: {
      minGap: gaps.length ? Math.min(...gaps.map((g) => g.gap)) : null,
      distribution: [...histogram]
        .sort((a, b) => a[0] - b[0])
        .map(([gap, n]) => ({ gap, teams: n })),
      tight,
    },
    overlap: { matrix, maxShared, heavy },
    capacity,
    invalid,
    diff,
    warnings,
  };
}

function fmt(ps: Placement[]): string {
  return ps.map((p) => `${p.label} @ slot ${p.slotIndex + 1}`).join(", ");
}

function diffAgainst(
  input: ReviewInput,
  pub: NonNullable<ReviewInput["published"]>,
): Review["diff"] {
  const placements = (
    assignments: ReviewAssignment[],
    slots: ReviewSlot[],
    stations: { id: string; label: string }[],
  ) => {
    const slot = new Map(slots.map((s) => [s.id, s]));
    const label = new Map(stations.map((s) => [s.id, s.label]));
    const out = new Map<string, Placement[]>();
    for (const a of assignments) {
      const s = slot.get(a.slotId);
      if (!s) continue;
      out.set(a.teamId, [
        ...(out.get(a.teamId) ?? []),
        {
          stationId: a.stationId,
          label: label.get(a.stationId) ?? "?",
          slotIndex: s.index,
          startsAt: s.startsAt,
        },
      ]);
    }
    for (const list of out.values())
      list.sort((x, y) => x.slotIndex - y.slotIndex);
    return out;
  };
  const now = placements(input.assignments, input.slots, input.stations);
  const before = placements(pub.assignments, pub.slots, pub.stations);
  // Teams in either version: a dropped team isn't in input.teams.
  const name = new Map(
    [...(pub.teams ?? []), ...input.teams].map((t) => [t.id, t.name]),
  );
  const key = (ps: Placement[]) =>
    ps.map((p) => `${p.stationId}@${p.startsAt}`).join("|");
  const moved: NonNullable<Review["diff"]>["moved"] = [];
  const added: NonNullable<Review["diff"]>["added"] = [];
  const removed: NonNullable<Review["diff"]>["removed"] = [];
  for (const [teamId, to] of now) {
    const from = before.get(teamId);
    if (!from) added.push({ name: name.get(teamId) ?? teamId, to });
    else if (key(from) !== key(to))
      moved.push({ name: name.get(teamId) ?? teamId, from, to });
  }
  for (const [teamId, from] of before)
    if (!now.has(teamId))
      removed.push({ name: name.get(teamId) ?? teamId, from });
  return { againstVersion: pub.version, moved, added, removed };
}
