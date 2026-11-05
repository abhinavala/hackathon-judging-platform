"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { ORGANIZER_ROLES } from "@/lib/route-guards";
import { adminDb, currentEvent } from "@/lib/admin/data";
import { back } from "../_ui/redirect";

const PATH = "/organizer/scoring";

/** Stops every judge write (0014's scores_locked_at), so the numbers used to pick winners can't move. */
export async function lockScoring() {
  await requireRole(...ORGANIZER_ROLES);
  const db = await adminDb();
  const event = await currentEvent(db);
  if (!event) back(PATH, { error: "No event exists yet." });
  const { error } = await db
    .from("events")
    .update({ scores_locked_at: new Date().toISOString() })
    .eq("id", event.id);
  if (error) back(PATH, { error: error.message });
  revalidatePath(PATH);
  back(PATH, {
    ok: "Scoring is locked. Judges can see their scores but not change them.",
  });
}

export async function unlockScoring() {
  await requireRole(...ORGANIZER_ROLES);
  const db = await adminDb();
  const event = await currentEvent(db);
  if (!event) back(PATH, { error: "No event exists yet." });
  const { error } = await db
    .from("events")
    .update({ scores_locked_at: null })
    .eq("id", event.id);
  if (error) back(PATH, { error: error.message });
  revalidatePath(PATH);
  back(PATH, { warn: "Scoring is unlocked: judges can change scores again." });
}
