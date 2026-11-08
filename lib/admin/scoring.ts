import "server-only";
import { trackBadges } from "@/lib/event/track-badge";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Db = SupabaseClient<Database>;

export type ScoringData = {
  published: { id: string; version: number } | null;
  lockedAt: string | null;
  criteria: { id: string; key: string; label: string; sortOrder: number }[];
  /** Published, uncancelled assignments. */
  assignments: {
    id: string;
    teamId: string;
    stationId: string;
    startsAt: string;
  }[];
  teams: {
    id: string;
    name: string;
    devpostUrl: string | null;
    tracks: string[];
    /** Short badges: sponsor, or the name without one (lib/event/track-badge). */
    badges: string[];
  }[];
  stations: { id: string; label: string }[];
  seats: { stationId: string; judgeId: string }[];
  judges: { id: string; name: string; affiliation: string | null }[];
  scores: {
    id: string;
    assignmentId: string;
    judgeId: string;
    notes: string;
    items: { criterionId: string; value: number }[];
  }[];
};

/**
 * Everything the scoring screens need for the event's published round-1
 * schedule, read as the organizer (RLS: organizers read every score).
 */
export async function loadScoring(
  db: Db,
  eventId: string,
): Promise<ScoringData> {
  const must = <T>(
    r: { data: T | null; error: { message: string } | null },
    what: string,
  ): T => {
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
    return r.data as T;
  };
  const [event, published, criteria, stations, seats, judges] =
    await Promise.all([
      db.from("events").select("scores_locked_at").eq("id", eventId).single(),
      db
        .from("schedules")
        .select("id, version")
        .eq("event_id", eventId)
        .eq("status", "published")
        .eq("round", 1)
        .maybeSingle(),
      db
        .from("rubric_criteria")
        .select("id, key, label, sort_order")
        .eq("event_id", eventId)
        .order("sort_order"),
      db.from("panels").select("id, label").eq("event_id", eventId),
      db.from("panel_judges").select("panel_id, judge_id"),
      db
        .from("judges")
        .select("id, full_name, affiliation")
        .eq("event_id", eventId),
    ]);
  const pub = must(published, "schedules");
  const base = {
    published: pub,
    lockedAt: must(event, "events")?.scores_locked_at ?? null,
    criteria: must(criteria, "rubric").map((c) => ({
      id: c.id,
      key: c.key,
      label: c.label,
      sortOrder: c.sort_order,
    })),
    stations: must(stations, "panels"),
    seats: must(seats, "panel_judges").map((s) => ({
      stationId: s.panel_id,
      judgeId: s.judge_id,
    })),
    judges: must(judges, "judges").map((j) => ({
      id: j.id,
      name: j.full_name,
      affiliation: j.affiliation,
    })),
  };
  if (!pub) return { ...base, assignments: [], teams: [], scores: [] };

  const rows = must(
    await db
      .from("assignments")
      .select(
        "id, team_id, panel_id, slots(starts_at), teams(name, devpost_url, team_tracks(tracks(name, sponsor, sort_order)))",
      )
      .eq("schedule_id", pub.id)
      .neq("status", "cancelled"),
    "assignments",
  );
  const ids = rows.map((a) => a.id);
  const scores = ids.length
    ? must(
        await db
          .from("scores")
          .select(
            "id, assignment_id, judge_id, notes, score_items(criterion_id, value)",
          )
          .in("assignment_id", ids),
        "scores",
      )
    : [];
  const teams = new Map<string, ScoringData["teams"][number]>();
  for (const a of rows)
    if (a.teams && !teams.has(a.team_id))
      teams.set(a.team_id, {
        id: a.team_id,
        name: a.teams.name,
        devpostUrl: a.teams.devpost_url,
        tracks: a.teams.team_tracks
          .map((t) => t.tracks?.name ?? "")
          .filter(Boolean),
        badges: trackBadges(
          a.teams.team_tracks.flatMap((t) =>
            t.tracks
              ? [
                  {
                    name: t.tracks.name,
                    sponsor: t.tracks.sponsor,
                    sortOrder: t.tracks.sort_order,
                  },
                ]
              : [],
          ),
        ),
      });
  return {
    ...base,
    assignments: rows.map((a) => ({
      id: a.id,
      teamId: a.team_id,
      stationId: a.panel_id,
      startsAt: a.slots?.starts_at ?? "",
    })),
    teams: [...teams.values()],
    scores: scores.map((s) => ({
      id: s.id,
      assignmentId: s.assignment_id,
      judgeId: s.judge_id,
      notes: s.notes ?? "",
      items: s.score_items.map((i) => ({
        criterionId: i.criterion_id,
        value: i.value,
      })),
    })),
  };
}
