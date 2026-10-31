// Teams CSV import, the database half: plan a CSV against the event's
// existing teams, then apply the plan. Runs as whoever owns `db` (the
// organizer's session in the app, so RLS checks every write).
//
// Imports are relative with .ts extensions (no "@/" alias, no "server-only")
// so scripts/test-admin.mjs can drive it directly with an organizer client.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types.ts";
import {
  planTeamImport,
  readTeamsCsv,
  type ExistingTeam,
  type ImportedTeam,
  type ImportPlan,
  type ReadResult,
} from "../csv/teams-import.ts";
import { newJoinCode } from "./join-code.ts";
import { zonedLocalToUtc } from "./time.ts";

type Db = SupabaseClient<Database>;
export type ImportEvent = { id: string; timezone: string };

export type PreparedImport = {
  read: ReadResult;
  plan: ImportPlan;
  /** Track name -> id, for the apply step. */
  trackIds: Record<string, string>;
  joinCodes: string[];
};

export type ImportResult = {
  created: string[];
  updated: string[];
  failed: { name: string; reason: string }[];
};

async function existingTeams(db: Db, eventId: string) {
  const [teamsRes, tracksRes] = await Promise.all([
    db
      .from("teams")
      .select(
        "id, name, join_code, devpost_url, github_urls, contact_phone, has_grad_student, all_freshmen, half_or_more_non_male",
      )
      .eq("event_id", eventId),
    db
      .from("tracks")
      .select("id, name, sponsor, sort_order")
      .eq("event_id", eventId)
      .order("sort_order"),
  ]);
  if (teamsRes.error) throw new Error(`teams: ${teamsRes.error.message}`);
  if (tracksRes.error) throw new Error(`tracks: ${tracksRes.error.message}`);
  const teams = teamsRes.data;
  const ids = teams.map((t) => t.id);
  let links: { team_id: string; track_id: string }[] = [];
  let members: { team_id: string; email: string }[] = [];
  if (ids.length) {
    const [l, m] = await Promise.all([
      db.from("team_tracks").select("team_id, track_id").in("team_id", ids),
      db.from("team_members").select("team_id, email").in("team_id", ids),
    ]);
    if (l.error) throw new Error(`team_tracks: ${l.error.message}`);
    if (m.error) throw new Error(`team_members: ${m.error.message}`);
    links = l.data;
    members = m.data;
  }
  const trackName = new Map(tracksRes.data.map((t) => [t.id, t.name]));
  const existing: ExistingTeam[] = teams.map((t) => ({
    id: t.id,
    name: t.name,
    tracks: links
      .filter((l) => l.team_id === t.id)
      .map((l) => trackName.get(l.track_id)!),
    devpostUrl: t.devpost_url,
    githubUrls: t.github_urls,
    memberEmails: members
      .filter((m) => m.team_id === t.id)
      .map((m) => m.email.toLowerCase()),
    contactPhone: t.contact_phone,
    hasGradStudent: t.has_grad_student,
    allFreshmen: t.all_freshmen,
    halfOrMoreNonMale: t.half_or_more_non_male,
  }));
  return {
    tracks: tracksRes.data,
    existing,
    joinCodes: teams.map((t) => t.join_code),
  };
}

/** Reads the CSV and plans it against the event's current teams. Writes nothing. */
export async function prepareImport(
  db: Db,
  event: ImportEvent,
  csv: string,
  names: Record<number, string> = {},
): Promise<PreparedImport> {
  const { tracks, existing, joinCodes } = await existingTeams(db, event.id);
  const read = readTeamsCsv(
    csv,
    tracks.map((t) => ({ name: t.name, sponsor: t.sponsor })),
  );
  const plan = planTeamImport(
    read,
    existing,
    new Map(Object.entries(names).map(([k, v]) => [Number(k), v])),
  );
  return {
    read,
    plan,
    trackIds: Object.fromEntries(tracks.map((t) => [t.name, t.id])),
    joinCodes,
  };
}

/** Why a prepared import can't be applied yet, or null if it can. */
export function blockedReason({ read, plan }: PreparedImport): string | null {
  if (read.errors.length && read.teams.length === 0)
    return "Nothing to import: fix the errors above.";
  if (plan.needsName.length)
    return `Give every team a name first (${plan.needsName.length} still need one).`;
  if (plan.conflicts.length)
    return "Two responses have the same team name; change one.";
  if (plan.create.length + plan.update.length === 0)
    return "Nothing would change.";
  return null;
}

/**
 * Applies a prepared plan. Submitting the form counts as checking in, so new
 * teams get checked_in_at = the form timestamp (in the event's time zone).
 * Old-form teammate names (no emails, so they can't be members) and form
 * comments go into the team's notes. Members are only ever added.
 */
export async function applyImport(
  db: Db,
  event: ImportEvent,
  prepared: PreparedImport,
): Promise<ImportResult> {
  const blocked = blockedReason(prepared);
  if (blocked) throw new Error(blocked);
  const { plan } = prepared;
  const trackId = new Map(Object.entries(prepared.trackIds));
  const taken = new Set(prepared.joinCodes);
  const result: ImportResult = { created: [], updated: [], failed: [] };

  const checkedInAt = (t: ImportedTeam) => {
    if (!t.submittedAt) return new Date().toISOString();
    const at = zonedLocalToUtc(t.submittedAt.slice(0, 16), event.timezone);
    return new Date(
      at.getTime() + Number(t.submittedAt.slice(17, 19)) * 1000,
    ).toISOString();
  };
  const notes = (t: ImportedTeam) =>
    [
      t.teammateNames.length
        ? `Teammates (from the form, no emails): ${t.teammateNames.join(", ")}`
        : null,
      t.comments ? `Form comment: ${t.comments}` : null,
    ]
      .filter(Boolean)
      .join("\n") || null;
  const memberError = (email: string, message: string) =>
    message.includes("already_on_a_team")
      ? `${email} is already on another team`
      : `${email}: ${message}`;

  for (const t of plan.create) {
    const { data: team, error } = await db
      .from("teams")
      .insert({
        event_id: event.id,
        name: t.name,
        join_code: newJoinCode(taken),
        devpost_url: t.devpostUrl,
        github_urls: t.githubUrls,
        contact_email: t.submitter.email,
        contact_phone: t.contactPhone,
        has_grad_student: t.hasGradStudent,
        all_freshmen: t.allFreshmen,
        half_or_more_non_male: t.halfOrMoreNonMale,
        checked_in_at: checkedInAt(t),
        notes: notes(t),
      })
      .select("id")
      .single();
    if (error || !team) {
      result.failed.push({
        name: t.name,
        reason:
          error?.code === "23505"
            ? "a team with that name already exists"
            : (error?.message ?? "not created"),
      });
      continue;
    }
    const problems: string[] = [];
    if (t.tracks.length) {
      const { error: e } = await db.from("team_tracks").insert(
        t.tracks.map((n) => ({
          team_id: team.id,
          track_id: trackId.get(n)!,
        })),
      );
      if (e) problems.push(`tracks: ${e.message}`);
    }
    for (const email of t.memberEmails) {
      const captain = email === t.submitter.email;
      const { error: e } = await db.from("team_members").insert({
        team_id: team.id,
        email,
        full_name: captain ? t.submitter.fullName : null,
        is_captain: captain,
      });
      // enforce_one_team_per_event: report it for this team, keep going.
      if (e) problems.push(memberError(email, e.message));
    }
    result.created.push(t.name);
    if (problems.length)
      result.failed.push({
        name: t.name,
        reason: `created, but ${problems.join("; ")}`,
      });
  }

  for (const u of plan.update) {
    const c = u.changes;
    const problems: string[] = [];
    const fields: Database["public"]["Tables"]["teams"]["Update"] = {};
    if (c.devpostUrl) fields.devpost_url = c.devpostUrl.to;
    if (c.githubUrls) fields.github_urls = u.team.githubUrls;
    if (c.contactPhone) fields.contact_phone = c.contactPhone.to;
    if (c.hasGradStudent) fields.has_grad_student = c.hasGradStudent.to;
    if (c.allFreshmen) fields.all_freshmen = c.allFreshmen.to;
    if (c.halfOrMoreNonMale)
      fields.half_or_more_non_male = c.halfOrMoreNonMale.to;
    if (Object.keys(fields).length) {
      const { error } = await db.from("teams").update(fields).eq("id", u.id);
      if (error) problems.push(error.message);
    }
    if (c.tracks?.removed.length) {
      const ids = c.tracks.removed
        .map((n) => trackId.get(n))
        .filter((x): x is string => Boolean(x));
      const { error } = await db
        .from("team_tracks")
        .delete()
        .eq("team_id", u.id)
        .in("track_id", ids);
      if (error) problems.push(`tracks: ${error.message}`);
    }
    if (c.tracks?.added.length) {
      const { error } = await db.from("team_tracks").insert(
        c.tracks.added.map((n) => ({
          team_id: u.id,
          track_id: trackId.get(n)!,
        })),
      );
      if (error) problems.push(`tracks: ${error.message}`);
    }
    for (const email of c.memberEmails?.added ?? []) {
      const { error } = await db
        .from("team_members")
        .insert({ team_id: u.id, email, is_captain: false });
      if (error) problems.push(memberError(email, error.message));
    }
    if (problems.length)
      result.failed.push({ name: u.name, reason: problems.join("; ") });
    else result.updated.push(u.name);
  }
  return result;
}
