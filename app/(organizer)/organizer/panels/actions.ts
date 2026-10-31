"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { ORGANIZER_ROLES } from "@/lib/route-guards";
import {
  adminDb,
  currentEvent,
  loadJudges,
  loadStations,
} from "@/lib/admin/data";
import { back } from "../_ui/redirect";

const PATH = "/organizer/panels";

export async function addStation(form: FormData) {
  await requireRole(...ORGANIZER_ROLES);
  const db = await adminDb();
  const event = await currentEvent(db);
  if (!event) back(PATH, { error: "No event exists yet." });
  const label = String(form.get("label") ?? "").trim();
  if (!label) back(PATH, { error: "A station needs a label." });
  const stations = await loadStations(db, event.id);
  const { error } = await db.from("panels").insert({
    event_id: event.id,
    label,
    location_text: String(form.get("locationText") ?? "").trim() || null,
    sort_order: Math.max(0, ...stations.map((s) => s.sortOrder)) + 1,
  });
  if (error)
    back(PATH, {
      error:
        error.code === "23505" ? `"${label}" already exists.` : error.message,
    });
  revalidatePath(PATH);
  back(PATH, { ok: `Added ${label}.` });
}

/**
 * Saves a station's details and its judges. These are the LIVE pairings,
 * the ones the published schedule runs with: swapping a judge who dropped
 * out is one row here and zero assignments.
 */
export async function updateStation(form: FormData) {
  await requireRole(...ORGANIZER_ROLES);
  const db = await adminDb();
  const event = await currentEvent(db);
  if (!event) back(PATH, { error: "No event exists yet." });
  const id = String(form.get("id"));
  const label = String(form.get("label") ?? "").trim();
  if (!label) back(PATH, { error: "A station needs a label." });
  const sortOrder = Number(form.get("sortOrder"));
  const judgeIds = [
    ...new Set(form.getAll("judge").map(String).filter(Boolean)),
  ];

  const [stations, judges] = await Promise.all([
    loadStations(db, event.id),
    loadJudges(db, event.id),
  ]);
  const name = new Map(judges.map((j) => [j.id, j.fullName]));
  for (const jid of judgeIds) {
    const elsewhere = stations.find(
      (s) => s.id !== id && s.judgeIds.includes(jid),
    );
    if (elsewhere)
      back(PATH, {
        error: `${name.get(jid)} already sits at ${elsewhere.label}. Free that seat first.`,
      });
  }

  const { error } = await db
    .from("panels")
    .update({
      label,
      location_text: String(form.get("locationText") ?? "").trim() || null,
      sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
    })
    .eq("id", id);
  if (error)
    back(PATH, {
      error:
        error.code === "23505" ? `"${label}" already exists.` : error.message,
    });

  const current = stations.find((s) => s.id === id)?.judgeIds ?? [];
  const removed = current.filter((j) => !judgeIds.includes(j));
  const added = judgeIds.filter((j) => !current.includes(j));
  if (removed.length) {
    const { error: e } = await db
      .from("panel_judges")
      .delete()
      .eq("panel_id", id)
      .in("judge_id", removed);
    if (e) back(PATH, { error: e.message });
  }
  if (added.length) {
    const { error: e } = await db
      .from("panel_judges")
      .insert(added.map((judge_id) => ({ panel_id: id, judge_id })));
    if (e) back(PATH, { error: e.message });
  }
  revalidatePath(PATH);
  back(PATH, { ok: `Saved ${label}.` });
}

export async function deleteStation(form: FormData) {
  await requireRole(...ORGANIZER_ROLES);
  const db = await adminDb();
  const id = String(form.get("id"));
  // assignments.panel_id cascades on delete: removing a station any schedule
  // uses would silently delete those presentations, published ones included.
  const { count, error: countError } = await db
    .from("assignments")
    .select("id", { count: "exact", head: true })
    .eq("panel_id", id);
  if (countError) back(PATH, { error: countError.message });
  if (count)
    back(PATH, {
      error: `This station is used by ${count} scheduled presentations and can't be removed.`,
    });
  const { error } = await db.from("panels").delete().eq("id", id);
  if (error) back(PATH, { error: error.message });
  revalidatePath(PATH);
  back(PATH, { ok: "Station removed." });
}
