"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { ORGANIZER_ROLES } from "@/lib/route-guards";
import { adminDb, currentEvent } from "@/lib/admin/data";
import { back } from "../_ui/redirect";

const PATH = "/organizer/announcements";
const LEVELS = ["info", "warning", "critical"] as const;
/** Long enough for two sentences; a banner longer than this won't be read. */
const MAX_LENGTH = 200;

export async function postAnnouncement(form: FormData) {
  const ctx = await requireRole(...ORGANIZER_ROLES);
  const db = await adminDb();
  const event = await currentEvent(db);
  if (!event) back(PATH, { error: "No event exists yet." });
  const body = String(form.get("body") ?? "")
    .trim()
    .replace(/\s+/g, " ");
  const level = LEVELS.find((l) => l === form.get("level")) ?? "info";
  if (!body) back(PATH, { error: "Write the announcement first." });
  if (body.length > MAX_LENGTH)
    back(PATH, {
      error: `Keep it under ${MAX_LENGTH} characters (it's ${body.length}): it has to be read from across a room.`,
    });
  const { error } = await db.from("announcements").insert({
    event_id: event.id,
    body,
    level,
    created_by: ctx.user.id,
  });
  if (error) back(PATH, { error: error.message });
  revalidatePath(PATH);
  back(PATH, {
    ok: "Posted. The board and team pages show it within 25 seconds.",
  });
}

/** Clear (active = false) or show again. Never deleted: the list is a log. */
export async function setAnnouncementActive(form: FormData) {
  await requireRole(...ORGANIZER_ROLES);
  const db = await adminDb();
  const id = String(form.get("id"));
  const active = form.get("active") === "true";
  const { error } = await db
    .from("announcements")
    .update({ active })
    .eq("id", id);
  if (error) back(PATH, { error: error.message });
  revalidatePath(PATH);
  back(PATH, { ok: active ? "Showing it again." : "Cleared." });
}
