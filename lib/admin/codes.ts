// The access-code pool for organizers (0015): how much is left, and which
// checked-in teams and people are missing a code. Pure functions plus one
// loader; read as the organizer (RLS: access_codes is organizer-only).

import type { CodeKind } from "../csv/codes-import.ts";

export type PoolCode = {
  kind: CodeKind;
  code: string;
  teamId: string | null;
  memberId: string | null;
  claimedEmail: string | null;
  claimed: boolean;
  awsTeamName: string | null;
  awsAccountId: string | null;
  state: string | null;
  participantCount: number | null;
  lastJoined: string | null;
};

export type CodeTeam = {
  id: string;
  name: string;
  joinCode: string;
  members: { id: string; email: string }[];
};

export type MissingCodes = {
  teamId: string;
  teamName: string;
  joinCode: string;
  workshop: boolean;
  /** Members with no Kiro code. */
  kiro: string[];
};

/** Checked-in, non-withdrawn teams missing either kind; worst first. */
export function missingCodes(
  teams: CodeTeam[],
  pool: PoolCode[],
): MissingCodes[] {
  const teamHas = new Set(
    pool.filter((c) => c.kind === "workshop" && c.teamId).map((c) => c.teamId),
  );
  const memberHas = new Set(
    pool.filter((c) => c.kind === "kiro" && c.memberId).map((c) => c.memberId),
  );
  // A team with nobody on it has no one to show a code to.
  return teams
    .filter((t) => t.members.length > 0)
    .map((t) => ({
      teamId: t.id,
      teamName: t.name,
      joinCode: t.joinCode,
      workshop: !teamHas.has(t.id),
      kiro: t.members.filter((m) => !memberHas.has(m.id)).map((m) => m.email),
    }))
    .filter((m) => m.workshop || m.kiro.length > 0)
    .sort(
      (a, b) =>
        Number(b.workshop) - Number(a.workshop) ||
        b.kiro.length - a.kiro.length ||
        a.teamName.localeCompare(b.teamName),
    );
}

export type PoolKind = { imported: number; claimed: number; free: number };

export type PoolSummary = {
  workshop: PoolKind;
  kiro: PoolKind;
  /** Said loudly on the dashboard. */
  alarms: string[];
  /** Quieter: the pool can't cover every team growing to the cap. */
  headroom: string | null;
};

/** Free codes at or below these and the dashboard says so. */
export const LOW_WORKSHOP = 5;
export const LOW_KIRO = 25;

export function poolSummary(
  pool: PoolCode[],
  teams: CodeTeam[],
  maxTeamSize: number,
): PoolSummary {
  const of = (kind: CodeKind): PoolKind => {
    const all = pool.filter((c) => c.kind === kind);
    const claimed = all.filter((c) => c.claimed).length;
    return { imported: all.length, claimed, free: all.length - claimed };
  };
  const workshop = of("workshop");
  const kiro = of("kiro");
  const alarms: string[] = [];
  const people = teams.reduce((n, t) => n + t.members.length, 0);
  // Every team that fills up to the cap: the most these teams could still need.
  const kiroCouldNeed = teams.reduce(
    (n, t) => n + Math.max(0, maxTeamSize - t.members.length),
    0,
  );
  if (workshop.imported === 0)
    alarms.push(
      "No workshop codes imported yet: every team checking in is missing one.",
    );
  else if (workshop.free === 0)
    alarms.push(
      "Workshop codes are all claimed: the next team to check in gets none.",
    );
  else if (workshop.free <= LOW_WORKSHOP)
    alarms.push(
      `Only ${workshop.free} workshop code${workshop.free === 1 ? "" : "s"} left.`,
    );
  if (kiro.imported === 0)
    alarms.push(
      "No Kiro codes imported yet: everyone checking in is missing one.",
    );
  else if (kiro.free === 0)
    alarms.push("Kiro codes are all claimed: the next person added gets none.");
  else if (kiro.free <= LOW_KIRO)
    alarms.push(
      `Only ${kiro.free} Kiro code${kiro.free === 1 ? "" : "s"} left (${people} people have one or are waiting).`,
    );
  const headroom =
    kiro.imported > 0 && kiro.free < kiroCouldNeed
      ? `${kiro.free} Kiro codes free; these teams could still add ${kiroCouldNeed} people if every one grew to ${maxTeamSize}.`
      : null;
  return { workshop, kiro, alarms, headroom };
}
