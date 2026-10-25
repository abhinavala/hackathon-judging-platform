"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { ORGANIZER_ROLES } from "@/lib/route-guards";
import { adminDb, currentEvent } from "@/lib/admin/data";
import { zonedLocalToUtc } from "@/lib/admin/time";
import { back } from "../_ui/redirect";

const PATH = "/organizer/event";

/** Saves the settings participants see. Blank clears a field. */
export async function saveEventSettings(form: FormData) {
  await requireRole(...ORGANIZER_ROLES);
  const db = await adminDb();
  const event = await currentEvent(db);
  if (!event) back(PATH, { error: "No event exists yet." });

  const startRaw = String(form.get("judgingStartsAt") ?? "").trim();
  let judgingStartsAt: string | null = null;
  if (startRaw) {
    try {
      judgingStartsAt = zonedLocalToUtc(startRaw, event.timezone).toISOString();
    } catch {
      back(PATH, { error: "Enter the judging start as a date and time." });
    }
  }
  const helpLocation =
    String(form.get("helpLocation") ?? "")
      .trim()
      .replace(/\s+/g, " ") || null;
  if (helpLocation && helpLocation.length > 200)
    back(PATH, { error: "Keep the help location under 200 characters." });

  const { error } = await db
    .from("events")
    .update({ judging_starts_at: judgingStartsAt, help_location: helpLocation })
    .eq("id", event.id);
  if (error) back(PATH, { error: error.message });
  revalidatePath(PATH);
  back(PATH, { ok: "Saved. Team pages pick this up within 25 seconds." });
}
