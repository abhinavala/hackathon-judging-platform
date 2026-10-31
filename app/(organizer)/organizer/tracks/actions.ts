"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { ORGANIZER_ROLES } from "@/lib/route-guards";
import { adminDb, currentEvent } from "@/lib/admin/data";
import { back } from "../_ui/redirect";

const PATH = "/organizer/tracks";

function readTrack(form: FormData) {
  const name = String(form.get("name") ?? "")
    .trim()
    .replace(/\s+/g, " ");
  const sponsor = String(form.get("sponsor") ?? "").trim() || null;
  const sortOrder = Number(form.get("sortOrder"));
  return {
    name,
    sponsor,
    judged_live: form.get("judgedLive") === "on",
    sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
  };
}

export async function addTrack(form: FormData) {
  await requireRole(...ORGANIZER_ROLES);
  const db = await adminDb();
  const event = await currentEvent(db);
  if (!event) back(PATH, { error: "No event exists yet." });
  const t = readTrack(form);
  if (!t.name) back(PATH, { error: "A track needs a name." });
  const { error } = await db
    .from("tracks")
    .insert({ event_id: event.id, ...t });
  if (error)
    back(PATH, {
      error:
        error.code === "23505" ? `"${t.name}" already exists.` : error.message,
    });
  revalidatePath(PATH);
  back(PATH, { ok: `Added "${t.name}".` });
}

export async function updateTrack(form: FormData) {
  await requireRole(...ORGANIZER_ROLES);
  const db = await adminDb();
  const id = String(form.get("id"));
  const t = readTrack(form);
  if (!t.name) back(PATH, { error: "A track needs a name." });
  const { error } = await db.from("tracks").update(t).eq("id", id);
  if (error)
    back(PATH, {
      error:
        error.code === "23505" ? `"${t.name}" already exists.` : error.message,
    });
  revalidatePath(PATH);
  back(PATH, { ok: `Saved "${t.name}".` });
}

/**
 * Deleting a track removes it from every team that selected it (team_tracks
 * cascades). If any team has, the first press only asks for confirmation.
 */
export async function deleteTrack(form: FormData) {
  await requireRole(...ORGANIZER_ROLES);
  const db = await adminDb();
  const id = String(form.get("id"));
  const { count, error: countError } = await db
    .from("team_tracks")
    .select("team_id", { count: "exact", head: true })
    .eq("track_id", id);
  if (countError) back(PATH, { error: countError.message });
  if (count && form.get("confirm") !== "yes") {
    redirect(`${PATH}?${new URLSearchParams({ confirmDelete: id })}`);
  }
  const { error } = await db.from("tracks").delete().eq("id", id);
  if (error) back(PATH, { error: error.message });
  revalidatePath(PATH);
  back(PATH, {
    ok: count
      ? `Track deleted and removed from ${count} team${count === 1 ? "" : "s"}.`
      : "Track deleted.",
  });
}
