"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { ORGANIZER_ROLES } from "@/lib/route-guards";
import { adminDb, currentEvent } from "@/lib/admin/data";
import { normalizeEmail } from "@/lib/auth/magic-link";
import { back } from "../_ui/redirect";

const PATH = "/organizer/judges";

function readJudge(form: FormData) {
  const fullName = String(form.get("fullName") ?? "")
    .trim()
    .replace(/\s+/g, " ");
  const email = normalizeEmail(form.get("email"));
  const affiliation = String(form.get("affiliation") ?? "").trim() || null;
  return { fullName, email, affiliation };
}

// Writes go through the organizer's own session, so RLS re-checks the role.
export async function addJudge(form: FormData) {
  await requireRole(...ORGANIZER_ROLES);
  const db = await adminDb();
  const event = await currentEvent(db);
  if (!event) back(PATH, { error: "No event exists yet." });
  const j = readJudge(form);
  if (!j.fullName || !j.email)
    back(PATH, { error: "A judge needs a name and a valid email." });
  const { error } = await db.from("judges").insert({
    event_id: event.id,
    full_name: j.fullName,
    email: j.email,
    affiliation: j.affiliation,
  });
  if (error)
    back(PATH, {
      error:
        error.code === "23505"
          ? `${j.email} is already a judge.`
          : error.message,
    });
  revalidatePath(PATH);
  back(PATH, { ok: `Added ${j.fullName}.` });
}

export async function updateJudge(form: FormData) {
  await requireRole(...ORGANIZER_ROLES);
  const db = await adminDb();
  const id = String(form.get("id"));
  const j = readJudge(form);
  if (!j.fullName || !j.email)
    back(PATH, { error: "A judge needs a name and a valid email." });
  const { error } = await db
    .from("judges")
    .update({
      full_name: j.fullName,
      email: j.email,
      affiliation: j.affiliation,
    })
    .eq("id", id);
  if (error)
    back(PATH, {
      error:
        error.code === "23505"
          ? `${j.email} is already a judge.`
          : error.message,
    });
  revalidatePath(PATH);
  back(PATH, { ok: `Saved ${j.fullName}.` });
}

export async function deleteJudge(form: FormData) {
  await requireRole(...ORGANIZER_ROLES);
  const db = await adminDb();
  const id = String(form.get("id"));
  // Deleting a judge cascades to their scores; refuse once scoring has begun.
  const { count, error: countError } = await db
    .from("scores")
    .select("id", { count: "exact", head: true })
    .eq("judge_id", id);
  if (countError) back(PATH, { error: countError.message });
  if (count)
    back(PATH, {
      error: "This judge has entered scores and can't be removed.",
    });
  const { error } = await db.from("judges").delete().eq("id", id);
  if (error) back(PATH, { error: error.message });
  revalidatePath(PATH);
  back(PATH, { ok: "Judge removed." });
}
