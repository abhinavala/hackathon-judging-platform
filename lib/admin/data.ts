import "server-only";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  reviewSchedule,
  type ReviewInput,
  type ReviewWarning,
} from "@/lib/admin/review";
import type { CodeTeam, PoolCode } from "@/lib/admin/codes";

// Reads for the organizer screens. Everything goes through the organizer's
// own session (RLS: organizers see everything), never the service role.

type Db = SupabaseClient<Database>;

export type EventRow = Database["public"]["Tables"]["events"]["Row"];

/** Draft station composition, stored on the schedule until it is published. */
export type PanelJudges = { panelId: string; judgeIds: string[] }[];

/** What a late-change draft did to the version it copies (lib/admin/late-change.ts). */
export type LateChange =
  | {
      kind: "insert";
      teamId: string;
      teamName: string;
      seats: { label: string; startsAt: string }[];
      appendedSlots: number;
      missing: string[];
    }
  | { kind: "drop"; teamId: string; teamName: string };

export type ScheduleStats = {
  seed?: number;
  mode?: "auto" | "keep";
  slotMinutes?: number;
  teamIds?: string[];
  panelJudges?: PanelJudges;
  /** Late changes: the published version this draft copies. */
  basedOn?: { id: string; version: number };
  lateChange?: LateChange;
  solver?: Record<string, unknown>;
  [key: string]: unknown;
};

/**
 * The organizer's Supabase client, acting as the signed-in organizer (RLS
 * applies). connection() first marks the work as request-time: without it,
 * auth-js's token-expiry checks call Date.now() during Cache Components'
 * prerender pass, which Next reports as an error on every request.
 */
export async function adminDb() {
  await connection();
  return createClient();
}

function must<T>(
  res: { data: T | null; error: { message: string } | null },
  what: string,
): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}

/** The event being administered: the most recent one. */
export async function currentEvent(db: Db): Promise<EventRow | null> {
  const res = await db
    .from("events")
    .select("*")
    .order("year", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return must(res, "events");
}

export type Judge = {
  id: string;
  fullName: string;
  email: string;
  affiliation: string | null;
  userId: string | null;
};
export type Station = {
  id: string;
  label: string;
  locationText: string | null;
  sortOrder: number;
  judgeIds: string[];
};
export type Team = {
  id: string;
  name: string;
  checkedIn: boolean;
  /** Dropped by a published late change: left out of a new generate unless
   *  an organizer ticks it back in (0013). */
  withdrawn: boolean;
  /** Track names. */
  tracks: string[];
  /** Sponsors of the team's tracks (what judges can cover). */
  sponsors: string[];
};

export async function loadJudges(db: Db, eventId: string): Promise<Judge[]> {
  const rows = must(
    await db
      .from("judges")
      .select("id, full_name, email, affiliation, user_id")
      .eq("event_id", eventId)
      .order("created_at")
      .order("id"),
    "judges",
  );
  return rows.map((j) => ({
    id: j.id,
    fullName: j.full_name,
    email: j.email,
    affiliation: j.affiliation,
    userId: j.user_id,
  }));
}

export async function loadStations(
  db: Db,
  eventId: string,
): Promise<Station[]> {
  const panels = must(
    await db
      .from("panels")
      .select("id, label, location_text, sort_order")
      .eq("event_id", eventId)
      .order("sort_order")
      .order("label"),
    "panels",
  );
  const ids = panels.map((p) => p.id);
  const pj = ids.length
    ? must(
        await db
          .from("panel_judges")
          .select("panel_id, judge_id")
          .in("panel_id", ids),
        "panel_judges",
      )
    : [];
  return panels.map((p) => ({
    id: p.id,
    label: p.label,
    locationText: p.location_text,
    sortOrder: p.sort_order,
    judgeIds: pj.filter((r) => r.panel_id === p.id).map((r) => r.judge_id),
  }));
}

export async function loadTracks(db: Db, eventId: string) {
  return must(
    await db
      .from("tracks")
      .select("id, name, sponsor, judged_live, sort_order")
      .eq("event_id", eventId)
      .order("sort_order")
      .order("name"),
    "tracks",
  );
}

/** A send still "sending" after this long was cut short. */
const EMAILS_STUCK_MS = 3 * 60_000;

export type CheckinEmails = {
  teamName: string;
  joinCode: string;
  status: "sending" | "sent" | "failed";
  /** "sending" for longer than a send takes: the background work died. */
  stuck: boolean;
  failed: string[];
  error: string | null;
  updatedAt: string;
};

/**
 * What happened to each team's check-in emails (checkin_emails, 0012). They
 * go out after the captain is answered, so this is the only place a failure
 * there shows up.
 */
export async function loadCheckinEmails(
  db: Db,
  eventId: string,
): Promise<CheckinEmails[]> {
  const rows = must(
    await db
      .from("checkin_emails")
      .select(
        "status, failed, error, updated_at, teams!inner(name, join_code, event_id)",
      )
      .eq("teams.event_id", eventId),
    "checkin_emails",
  );
  const now = Date.now();
  return rows
    .map((r) => ({
      teamName: r.teams.name,
      joinCode: r.teams.join_code,
      status: r.status as CheckinEmails["status"],
      stuck:
        r.status === "sending" &&
        now - Date.parse(r.updated_at) > EMAILS_STUCK_MS,
      failed: r.failed,
      error: r.error,
      updatedAt: r.updated_at,
    }))
    .sort((a, b) => a.teamName.localeCompare(b.teamName));
}

export async function loadTeams(db: Db, eventId: string): Promise<Team[]> {
  const [teams, tracks] = await Promise.all([
    db
      .from("teams")
      .select("id, name, checked_in_at, withdrawn_at")
      .eq("event_id", eventId)
      .order("name"),
    loadTracks(db, eventId),
  ]);
  const teamRows = must(teams, "teams");
  const trackById = new Map(tracks.map((t) => [t.id, t]));
  const ids = teamRows.map((t) => t.id);
  const links = ids.length
    ? must(
        await db
          .from("team_tracks")
          .select("team_id, track_id")
          .in("team_id", ids),
        "team_tracks",
      )
    : [];
  return teamRows.map((t) => {
    const mine = links
      .filter((l) => l.team_id === t.id)
      .map((l) => trackById.get(l.track_id)!);
    return {
      id: t.id,
      name: t.name,
      checkedIn: t.checked_in_at !== null,
      withdrawn: t.withdrawn_at !== null,
      tracks: mine.map((x) => x.name),
      // Only live-judged tracks need a sponsor's judge in the room: a track
      // decided offline (judged_live = false) is ignored by the scheduler
      // and the pre-flight check, as the schema intends.
      sponsors: [
        ...new Set(
          mine
            .filter((x) => x.judged_live)
            .map((x) => x.sponsor)
            .filter((s): s is string => s !== null),
        ),
      ],
    };
  });
}

export type ScheduleRow = Database["public"]["Tables"]["schedules"]["Row"] & {
  stats: ScheduleStats | null;
};

export async function loadSchedules(
  db: Db,
  eventId: string,
): Promise<ScheduleRow[]> {
  return must(
    await db
      .from("schedules")
      .select("*")
      .eq("event_id", eventId)
      .order("version", { ascending: false }),
    "schedules",
  ) as ScheduleRow[];
}

async function scheduleContents(db: Db, scheduleId: string) {
  const [slots, assignments] = await Promise.all([
    db
      .from("slots")
      .select("id, index, starts_at, ends_at")
      .eq("schedule_id", scheduleId)
      .order("index"),
    db
      .from("assignments")
      .select("team_id, panel_id, slot_id, status")
      .eq("schedule_id", scheduleId)
      .neq("status", "cancelled"),
  ]);
  return {
    slots: must(slots, "slots").map((s) => ({
      id: s.id,
      index: s.index,
      startsAt: s.starts_at,
      endsAt: s.ends_at,
    })),
    assignments: must(assignments, "assignments").map((a) => ({
      teamId: a.team_id,
      stationId: a.panel_id,
      slotId: a.slot_id,
    })),
  };
}

export type ScheduleView = {
  event: EventRow;
  schedule: ScheduleRow;
  slots: { id: string; index: number; startsAt: string; endsAt: string }[];
  stations: (Station & { composition: Judge[]; sponsors: string[] })[];
  teams: Team[];
  published: ScheduleRow | null;
  review: ReviewInput;
  /**
   * For a late-change draft: the warnings of the published version it
   * copies, which were accepted when that version was published (see
   * alreadyAccepted() in lib/admin/review.ts). Null for any other schedule.
   */
  accepted: { version: number; warnings: ReviewWarning[] } | null;
};

/**
 * Everything the preview screen needs for one schedule version. The
 * station composition is the schedule's own (stats.panelJudges, set at
 * generate time) when present, otherwise the live panel_judges, which is
 * what a seeded or already-published schedule runs with.
 */
export async function loadScheduleView(
  db: Db,
  scheduleId: string,
  { withAccepted = true }: { withAccepted?: boolean } = {},
): Promise<ScheduleView | null> {
  const schedule = must(
    await db.from("schedules").select("*").eq("id", scheduleId).maybeSingle(),
    "schedule",
  ) as ScheduleRow | null;
  if (!schedule) return null;
  const eventRes = await db
    .from("events")
    .select("*")
    .eq("id", schedule.event_id)
    .maybeSingle();
  if (eventRes.error) throw new Error(`event: ${eventRes.error.message}`);
  const event = eventRes.data;
  if (!event) return null;

  const [judges, stations, teams, contents, schedules] = await Promise.all([
    loadJudges(db, event.id),
    loadStations(db, event.id),
    loadTeams(db, event.id),
    scheduleContents(db, schedule.id),
    loadSchedules(db, event.id),
  ]);
  const judgeById = new Map(judges.map((j) => [j.id, j]));
  const draftPairs = new Map(
    (schedule.stats?.panelJudges ?? []).map((p) => [p.panelId, p.judgeIds]),
  );
  // A draft is judged by the pairings it proposes (they take effect only on
  // publish). The PUBLISHED version is judged by who sits at each station
  // now: a judge swapped after publishing changes its coverage, and showing
  // the figure from publish time ("64/64 track-seats met") would be
  // confidently wrong. Archived versions keep their own pairings, as history.
  const useDraft = schedule.status !== "published" && draftPairs.size > 0;
  const withComposition = stations.map((s) => {
    const composition = (useDraft ? (draftPairs.get(s.id) ?? []) : s.judgeIds)
      .map((id) => judgeById.get(id))
      .filter((j): j is Judge => j !== undefined);
    return {
      ...s,
      composition,
      sponsors: [
        ...new Set(
          composition
            .map((j) => j.affiliation)
            .filter((a): a is string => a !== null),
        ),
      ],
    };
  });

  const scheduled = new Set(contents.assignments.map((a) => a.teamId));
  const included = teams.filter((t) => scheduled.has(t.id));
  const published =
    schedules.find((s) => s.status === "published" && s.id !== schedule.id) ??
    null;
  // What the diff compares against: for a draft, what participants see now;
  // for a published or archived version, the version it replaced (the
  // newest earlier one that was published), so a late change stays visible
  // on the version that made it.
  const compareTo =
    schedule.status === "draft"
      ? published
      : (schedules
          .filter(
            (s) => s.status === "archived" && s.version < schedule.version,
          )
          .sort((a, b) => b.version - a.version)[0] ?? null);
  const publishedContents = compareTo
    ? await scheduleContents(db, compareTo.id)
    : null;

  let accepted: ScheduleView["accepted"] = null;
  if (
    withAccepted &&
    schedule.status === "draft" &&
    schedule.stats?.basedOn &&
    published
  ) {
    const pubView = await loadScheduleView(db, published.id, {
      withAccepted: false,
    });
    if (pubView)
      accepted = {
        version: published.version,
        warnings: reviewSchedule(pubView.review).warnings,
      };
  }

  return {
    accepted,
    event,
    schedule,
    slots: contents.slots,
    stations: withComposition,
    teams: included,
    published,
    review: {
      teams: included.map((t) => ({
        id: t.id,
        name: t.name,
        sponsors: t.sponsors,
      })),
      stations: withComposition.map((s) => ({
        id: s.id,
        label: s.label,
        sponsors: s.sponsors,
      })),
      slots: contents.slots,
      assignments: contents.assignments,
      judgingStart: event.judging_starts_at
        ? { startsAt: event.judging_starts_at, timezone: event.timezone }
        : null,
      excludedTeams: teams
        .filter((t) => t.checkedIn && !t.withdrawn && !scheduled.has(t.id))
        .map((t) => ({ id: t.id, name: t.name })),
      basedOnVersion: schedule.stats?.basedOn?.version ?? null,
      supersededBy:
        schedule.status === "draft" &&
        published &&
        schedule.version < published.version
          ? published.version
          : null,
      published:
        compareTo && publishedContents
          ? {
              version: compareTo.version,
              slots: publishedContents.slots,
              stations: stations.map((s) => ({ id: s.id, label: s.label })),
              assignments: publishedContents.assignments,
              teams: teams.map((t) => ({ id: t.id, name: t.name })),
            }
          : null,
    },
  };
}

/** The access-code pool (0015). Organizer-only by RLS. */
export async function loadCodePool(
  db: Db,
  eventId: string,
): Promise<PoolCode[]> {
  const rows = must(
    await db
      .from("access_codes")
      .select(
        "kind, code, team_id, member_id, claimed_email, claimed_at, aws_team_name, aws_account_id, aws_state, participant_count, last_joined",
      )
      .eq("event_id", eventId)
      .order("seq")
      .limit(5000),
    "access_codes",
  );
  return rows.map((r) => ({
    kind: r.kind as PoolCode["kind"],
    code: r.code,
    teamId: r.team_id,
    memberId: r.member_id,
    claimedEmail: r.claimed_email,
    claimed: r.claimed_at !== null,
    awsTeamName: r.aws_team_name,
    awsAccountId: r.aws_account_id,
    state: r.aws_state,
    participantCount: r.participant_count,
    lastJoined: r.last_joined,
  }));
}

export type ActiveTeam = CodeTeam & {
  devpostUrl: string | null;
  captainEmail: string | null;
  contactPhone: string | null;
};

/** Checked-in, non-withdrawn teams with their members: who codes are for. */
export async function loadActiveTeams(
  db: Db,
  eventId: string,
): Promise<ActiveTeam[]> {
  const rows = must(
    await db
      .from("teams")
      .select(
        "id, name, join_code, devpost_url, contact_phone, team_members(id, email, is_captain)",
      )
      .eq("event_id", eventId)
      .not("checked_in_at", "is", null)
      .is("withdrawn_at", null)
      .order("name"),
    "teams",
  );
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    joinCode: t.join_code,
    devpostUrl: t.devpost_url,
    contactPhone: t.contact_phone,
    captainEmail: t.team_members.find((m) => m.is_captain)?.email ?? null,
    members: t.team_members.map((m) => ({ id: m.id, email: m.email })),
  }));
}
