"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { ORGANIZER_ROLES } from "@/lib/route-guards";
import {
  adminDb,
  loadJudges,
  loadScheduleView,
  loadStations,
  loadTeams,
} from "@/lib/admin/data";
import { placeLateTeam } from "@/lib/admin/late";
import { draftLateChange } from "@/lib/admin/late-change";
import { alreadyAccepted, reviewSchedule } from "@/lib/admin/review";
import { back } from "../../_ui/redirect";

/**
 * Publishes a draft, never automatically. The review is recomputed here, on
 * the server, and every current warning must have been acknowledged on the
 * form: a stale page or a hand-built request can't skip one. Structural
 * errors block publishing outright.
 */
export async function publishSchedule(form: FormData) {
  await requireRole(...ORGANIZER_ROLES);
  const db = await adminDb();
  const id = String(form.get("scheduleId"));
  const path = `/organizer/schedules/${id}`;
  const view = await loadScheduleView(db, id);
  if (!view)
    back("/organizer/schedules", { error: "That schedule no longer exists." });
  if (view.schedule.status !== "draft")
    back(path, {
      error: `v${view.schedule.version} is ${view.schedule.status}, not a draft.`,
    });

  const review = reviewSchedule(view.review);
  if (review.invalid.length)
    back(path, {
      error: "This schedule has structural errors and can't be published.",
    });
  // Warnings unchanged from the published version a late change copies were
  // accepted when it was published; everything else needs a tick.
  const carried = alreadyAccepted(
    review.warnings,
    view.accepted?.warnings ?? [],
  );
  const missing = review.warnings.filter(
    (w) => !carried.has(w.id) && form.get(`ack:${w.id}`) !== "on",
  );
  if (missing.length) {
    back(path, {
      error: `Acknowledge every warning before publishing. Not acknowledged: ${missing.map((w) => w.title).join("; ")}.`,
    });
  }

  const { error } = await db.rpc("publish_schedule", { p_schedule_id: id });
  if (error)
    back(path, { error: `Publish failed, nothing changed: ${error.message}` });
  revalidatePath("/organizer/schedules");
  revalidatePath(path);
  back(path, {
    ok: `Published v${view.schedule.version}. Participants now see this version.`,
  });
}

/** Now, read in an action (not render), for the late-insertion cutoff. */
function now() {
  return Date.now();
}

/**
 * A late team: seats it in the published version's free seats (appending at
 * most two slots if it's full) and writes the result as the next version's
 * draft, for review and publishing. Never re-runs the generator.
 */
export async function addLateTeam(form: FormData) {
  const ctx = await requireRole(...ORGANIZER_ROLES);
  const db = await adminDb();
  const id = String(form.get("scheduleId"));
  const path = `/organizer/schedules/${id}`;
  const teamId = String(form.get("teamId") ?? "");
  const view = await loadScheduleView(db, id);
  if (!view || view.schedule.status !== "published")
    back(path, { error: "Late changes start from the published version." });
  const [teams, judges, stations] = await Promise.all([
    loadTeams(db, view.event.id),
    loadJudges(db, view.event.id),
    loadStations(db, view.event.id),
  ]);
  const team = teams.find((t) => t.id === teamId);
  if (!team) back(path, { error: "Pick a team to add." });

  // The stations as they are staffed right now (a judge may have been
  // swapped since publishing), restricted to those this version uses.
  const used = new Set(view.review.assignments.map((a) => a.stationId));
  const affiliation = new Map(judges.map((j) => [j.id, j.affiliation]));
  const placement = placeLateTeam({
    stations: stations
      .filter((s) => used.has(s.id))
      .map((s) => ({
        id: s.id,
        label: s.label,
        sponsors: [
          ...new Set(
            s.judgeIds
              .map((j) => affiliation.get(j))
              .filter((a): a is string => !!a),
          ),
        ],
      })),
    slots: view.slots,
    assignments: view.review.assignments,
    sponsors: team.sponsors,
    now: now(),
  });
  if (!placement)
    back(path, { error: `No seats could be found for ${team.name}.` });

  let draftId: string;
  try {
    draftId = await draftLateChange(
      db,
      id,
      { kind: "insert", teamId: team.id, teamName: team.name, placement },
      ctx.user.id,
    );
  } catch (e) {
    back(path, { error: e instanceof Error ? e.message : String(e) });
  }
  revalidatePath("/organizer/schedules");
  redirect(`/organizer/schedules/${draftId}`);
}

/** A team that has left: the next version's draft cancels its seats. */
export async function dropTeam(form: FormData) {
  const ctx = await requireRole(...ORGANIZER_ROLES);
  const db = await adminDb();
  const id = String(form.get("scheduleId"));
  const path = `/organizer/schedules/${id}`;
  const teamId = String(form.get("teamId") ?? "");
  const view = await loadScheduleView(db, id);
  if (!view || view.schedule.status !== "published")
    back(path, { error: "Late changes start from the published version." });
  const team = view.teams.find((t) => t.id === teamId);
  if (!team) back(path, { error: "Pick a team in this version to drop." });

  let draftId: string;
  try {
    draftId = await draftLateChange(
      db,
      id,
      { kind: "drop", teamId: team.id, teamName: team.name },
      ctx.user.id,
    );
  } catch (e) {
    back(path, { error: e instanceof Error ? e.message : String(e) });
  }
  revalidatePath("/organizer/schedules");
  redirect(`/organizer/schedules/${draftId}`);
}

/** Deletes a draft nobody will publish. Published and archived versions stay. */
export async function discardDraft(form: FormData) {
  await requireRole(...ORGANIZER_ROLES);
  const db = await adminDb();
  const id = String(form.get("scheduleId"));
  const { data, error } = await db
    .from("schedules")
    .delete()
    .eq("id", id)
    .eq("status", "draft")
    .select("version");
  if (error || !data?.length)
    back(`/organizer/schedules/${id}`, {
      error: `Not discarded: ${error?.message ?? "only drafts can be discarded"}.`,
    });
  revalidatePath("/organizer/schedules");
  back("/organizer/schedules", { ok: `Discarded draft v${data[0].version}.` });
}
