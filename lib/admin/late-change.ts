import type { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/database.types";
import type { LateChange, ScheduleStats } from "@/lib/admin/data";
import type { LatePlacement } from "@/lib/admin/late";

type Db = Awaited<ReturnType<typeof createClient>>;

export type LateChangeRequest =
  | {
      kind: "insert";
      teamId: string;
      teamName: string;
      placement: LatePlacement;
    }
  | { kind: "drop"; teamId: string; teamName: string };

/**
 * A late change never edits the published version and never re-runs the
 * generator. It writes the NEXT version as a draft copy of the published one
 * (same slots, same seats, same times) with only the change applied:
 *
 *   insert: the team's two seats are added (plus up to two slots appended
 *           after the last, if the schedule was full)
 *   drop:   the team's assignments are copied as `cancelled`; nothing is
 *           re-packed into their seats
 *
 * The organizer then reviews and publishes it like any draft, so the change
 * shows in the version diff, every warning is acknowledged, and the version
 * number teams see goes up. Cancelled rows of earlier versions aren't carried
 * forward (each version records its own cancellations), so their seats are
 * free for a later insertion. No panelJudges in stats: publishing keeps the
 * stations' current judges. Runs as the organizer (RLS checks every write).
 * Returns the draft's id.
 */
export async function draftLateChange(
  db: Db,
  publishedId: string,
  change: LateChangeRequest,
  userId: string,
): Promise<string> {
  const { data: pub, error: pubError } = await db
    .from("schedules")
    .select("*")
    .eq("id", publishedId)
    .single();
  if (pubError || !pub) throw new Error(`schedule: ${pubError?.message}`);
  if (pub.status !== "published")
    throw new Error(
      `v${pub.version} is ${pub.status}; late changes start from the published version`,
    );

  const [slotsRes, assignmentsRes, versionsRes] = await Promise.all([
    db
      .from("slots")
      .select("id, index, starts_at, ends_at")
      .eq("schedule_id", pub.id)
      .order("index"),
    db
      .from("assignments")
      .select("team_id, panel_id, slot_id, round, status")
      .eq("schedule_id", pub.id)
      .neq("status", "cancelled"),
    db.from("schedules").select("version").eq("event_id", pub.event_id),
  ]);
  for (const r of [slotsRes, assignmentsRes, versionsRes])
    if (r.error) throw new Error(r.error.message);
  const slots = slotsRes.data!;
  const assignments = assignmentsRes.data!;
  const version = Math.max(0, ...versionsRes.data!.map((s) => s.version)) + 1;

  const already = assignments.some((a) => a.team_id === change.teamId);
  if (change.kind === "insert" && already)
    throw new Error(`${change.teamName} is already in v${pub.version}`);
  if (change.kind === "drop" && !already)
    throw new Error(`${change.teamName} isn't in v${pub.version}`);

  const old = (pub.stats ?? {}) as ScheduleStats;
  const kept = assignments.filter(
    (a) => change.kind === "insert" || a.team_id !== change.teamId,
  );
  const lateChange: LateChange =
    change.kind === "insert"
      ? {
          kind: "insert",
          teamId: change.teamId,
          teamName: change.teamName,
          seats: change.placement.seats.map((s) => ({
            label: s.label,
            startsAt: s.startsAt,
          })),
          appendedSlots: change.placement.appendedSlots,
          missing: change.placement.missing,
        }
      : { kind: "drop", teamId: change.teamId, teamName: change.teamName };
  const stats: ScheduleStats = {
    mode: old.mode,
    slotMinutes: old.slotMinutes,
    seed: old.seed,
    teamIds: [
      ...new Set([
        ...kept.map((a) => a.team_id),
        ...(change.kind === "insert" ? [change.teamId] : []),
      ]),
    ],
    basedOn: { id: pub.id, version: pub.version },
    lateChange,
  };

  const { data: draft, error: draftError } = await db
    .from("schedules")
    .insert({
      event_id: pub.event_id,
      version,
      round: pub.round,
      status: "draft",
      // ScheduleStats is plain JSON; see generate/actions.ts.
      stats: stats as unknown as Json,
      generated_by: userId,
    })
    .select("id")
    .single();
  if (draftError || !draft)
    throw new Error(`Could not create v${version}: ${draftError?.message}`);

  try {
    const appended =
      change.kind === "insert"
        ? change.placement.seats
            .filter((s) => s.slotId === null)
            .map((s) => ({
              index: s.slotIndex,
              starts_at: s.startsAt,
              ends_at: s.endsAt,
            }))
        : [];
    const { data: newSlots, error: slotError } = await db
      .from("slots")
      .insert(
        [
          ...slots.map((s) => ({
            index: s.index,
            starts_at: s.starts_at,
            ends_at: s.ends_at,
          })),
          ...appended,
        ].map((s) => ({ ...s, schedule_id: draft.id })),
      )
      .select("id, index");
    if (slotError || !newSlots) throw new Error(`slots: ${slotError?.message}`);
    const byIndex = new Map(newSlots.map((s) => [s.index, s.id]));
    const oldIndex = new Map(slots.map((s) => [s.id, s.index]));
    const copy = (slotId: string) => byIndex.get(oldIndex.get(slotId)!)!;

    const rows = [
      ...kept.map((a) => ({
        team_id: a.team_id,
        panel_id: a.panel_id,
        slot_id: copy(a.slot_id),
        round: a.round,
        status: a.status,
      })),
      ...(change.kind === "drop"
        ? assignments
            .filter((a) => a.team_id === change.teamId)
            .map((a) => ({
              team_id: a.team_id,
              panel_id: a.panel_id,
              slot_id: copy(a.slot_id),
              round: a.round,
              status: "cancelled" as const,
            }))
        : change.placement.seats.map((s) => ({
            team_id: change.teamId,
            panel_id: s.stationId,
            slot_id: byIndex.get(s.slotIndex)!,
            round: pub.round,
            status: "scheduled" as const,
          }))),
    ].map((r) => ({ ...r, schedule_id: draft.id }));
    const { error: assignmentError } = await db
      .from("assignments")
      .insert(rows);
    if (assignmentError)
      throw new Error(`assignments: ${assignmentError.message}`);
  } catch (e) {
    // A half-written draft is invisible to participants, but don't leave one.
    await db.from("schedules").delete().eq("id", draft.id);
    throw e;
  }
  return draft.id;
}
