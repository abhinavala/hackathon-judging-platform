"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { ORGANIZER_ROLES } from "@/lib/route-guards";
import {
  adminDb,
  currentEvent,
  loadJudges,
  loadSchedules,
  loadStations,
  loadTeams,
  type PanelJudges,
  type ScheduleStats,
} from "@/lib/admin/data";
import { zonedLocalToUtc } from "@/lib/admin/time";
import type { Json } from "@/lib/database.types";
import { solve, type Pair, type SolveResult } from "@/lib/scheduler";
import { back } from "../_ui/redirect";

const PATH = "/organizer/generate";

/**
 * Runs the scheduler and writes the result as a DRAFT: never published here.
 * The draft carries its own station pairings (stats.panelJudges); they take
 * effect only when the draft is published (publish_schedule, migration 0004).
 */
export async function generateDraft(form: FormData) {
  const ctx = await requireRole(...ORGANIZER_ROLES);
  const db = await adminDb();
  const event = await currentEvent(db);
  if (!event) back(PATH, { error: "No event exists yet." });

  const teamIds = new Set(form.getAll("team").map(String));
  const slotMinutes = Number(form.get("slotMinutes"));
  const slotCountRaw = String(form.get("slotCount") ?? "").trim();
  const requestedSlots = slotCountRaw ? Number(slotCountRaw) : 0;
  const mode = form.get("mode") === "keep" ? "keep" : "auto";
  const seed = Number(form.get("seed"));
  let start: Date;
  try {
    start = zonedLocalToUtc(String(form.get("start") ?? ""), event.timezone);
  } catch {
    back(PATH, { error: "Enter a start time." });
  }
  if (!Number.isInteger(slotMinutes) || slotMinutes < 1 || slotMinutes > 60) {
    back(PATH, { error: "Slot length must be 1-60 minutes." });
  }
  if (
    slotCountRaw &&
    (!Number.isInteger(requestedSlots) || requestedSlots < 1)
  ) {
    back(PATH, { error: "Slot count must be a whole number." });
  }
  if (!Number.isSafeInteger(seed))
    back(PATH, { error: "Seed must be a whole number." });

  const [judges, allStations, allTeams, schedules] = await Promise.all([
    loadJudges(db, event.id),
    loadStations(db, event.id),
    loadTeams(db, event.id),
    loadSchedules(db, event.id),
  ]);
  // After publishing, the generator re-packs everyone; late changes don't.
  const live = schedules.find((s) => s.status === "published");
  if (live && form.get("regenerateAfterPublish") !== "on")
    back(PATH, {
      error: `v${live.version} is published: tick "Regenerate anyway", or use late changes on v${live.version}, which move nobody.`,
    });
  const teams = allTeams.filter((t) => teamIds.has(t.id));
  if (teams.length === 0) back(PATH, { error: "Pick at least one team." });

  // Stage 0 forms the pairings (auto), or the stations' current judges are
  // kept (only stations with exactly two judges take part).
  let panels: Pair[] | undefined;
  let stationForPanel = allStations;
  if (mode === "keep") {
    const partial = allStations.filter(
      (s) => s.judgeIds.length > 0 && s.judgeIds.length !== 2,
    );
    if (partial.length) {
      back(PATH, {
        error: `To keep current judges, every staffed station needs exactly two: fix ${partial.map((s) => s.label).join(", ")}.`,
      });
    }
    stationForPanel = allStations.filter((s) => s.judgeIds.length === 2);
    const index = new Map(judges.map((j, i) => [j.id, i]));
    panels = stationForPanel.map((s) => [
      index.get(s.judgeIds[0])!,
      index.get(s.judgeIds[1])!,
    ]);
    if (panels.length < 2)
      back(PATH, {
        error:
          "To keep current judges, at least two stations need two judges each.",
      });
  } else if (judges.length < 4) {
    back(PATH, { error: "At least 4 judges are needed (2 stations)." });
  }

  let result: SolveResult;
  try {
    result = solve({
      teamTracks: teams.map((t) => new Set(t.sponsors)),
      judges: judges.map((j) => j.affiliation),
      seed,
      panels,
    });
  } catch (e) {
    back(PATH, {
      error: `The scheduler could not run: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
  const nSlots = Math.max(result.nSlots, requestedSlots);
  if (requestedSlots && requestedSlots < result.nSlots) {
    back(PATH, {
      error: `These teams need at least ${result.nSlots} slots (you asked for ${requestedSlots}).`,
    });
  }

  // Automatic pairings may need more stations than exist: add them.
  if (mode === "auto" && stationForPanel.length < result.panels.length) {
    const missing = result.panels.length - stationForPanel.length;
    const top = Math.max(0, ...allStations.map((s) => s.sortOrder));
    const { error } = await db.from("panels").insert(
      Array.from({ length: missing }, (_, i) => ({
        event_id: event.id,
        label: `Station ${allStations.length + i + 1}`,
        sort_order: top + i + 1,
      })),
    );
    if (error)
      back(PATH, { error: `Could not add stations: ${error.message}` });
    stationForPanel = await loadStations(db, event.id);
  }

  const panelJudges: PanelJudges = result.panels.map(([a, b], p) => ({
    panelId: stationForPanel[p].id,
    judgeIds: [judges[a].id, judges[b].id],
  }));
  const stats: ScheduleStats = {
    seed,
    mode,
    slotMinutes,
    teamIds: teams.map((t) => t.id),
    panelJudges,
    solver: {
      winningStrategy: result.stats.winningStrategy,
      teamsFullyCovered: result.stats.teamsFullyCovered,
      trackSeatsMet: result.stats.trackSeatsMet,
      trackSeatsWanted: result.stats.trackSeatsWanted,
      teamsPerPanel: result.stats.teamsPerPanel,
      overlapRange: result.stats.overlapRange,
      gapRange: result.stats.gapRange,
      nSlots,
    },
  };

  const version = Math.max(0, ...schedules.map((s) => s.version)) + 1;
  const { data: created, error: scheduleError } = await db
    .from("schedules")
    .insert({
      event_id: event.id,
      version,
      round: 1,
      status: "draft",
      // ScheduleStats is plain JSON (strings, numbers, arrays, objects); its
      // open index signature just can't be proven so to the Json type.
      stats: stats as unknown as Json,
      generated_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (scheduleError || !created) {
    back(PATH, {
      error: `Could not create the draft: ${scheduleError?.message ?? "no row returned"}`,
    });
  }

  const fail = async (message: string): Promise<never> => {
    // A half-written draft is invisible to participants, but don't leave one.
    await db.from("schedules").delete().eq("id", created.id);
    back(PATH, { error: message });
  };

  const { data: slots, error: slotError } = await db
    .from("slots")
    .insert(
      Array.from({ length: nSlots }, (_, i) => ({
        schedule_id: created.id,
        index: i,
        starts_at: new Date(
          start.getTime() + i * slotMinutes * 60_000,
        ).toISOString(),
        ends_at: new Date(
          start.getTime() + (i + 1) * slotMinutes * 60_000,
        ).toISOString(),
      })),
    )
    .select("id, index");
  if (slotError || !slots)
    return fail(`Could not write slots: ${slotError?.message}`);
  const slotId = new Map(slots.map((s) => [s.index, s.id]));

  const rows = [...result.slotOf].map(([key, slot]) => {
    const [t, p] = key.split(":").map(Number);
    return {
      schedule_id: created.id,
      team_id: teams[t].id,
      panel_id: stationForPanel[p].id,
      slot_id: slotId.get(slot)!,
      round: 1,
    };
  });
  const { error: assignmentError } = await db.from("assignments").insert(rows);
  if (assignmentError)
    return fail(`Could not write assignments: ${assignmentError.message}`);

  revalidatePath("/organizer/schedules");
  redirect(`/organizer/schedules/${created.id}`);
}
