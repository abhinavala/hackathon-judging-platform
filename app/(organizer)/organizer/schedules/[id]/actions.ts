"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { ORGANIZER_ROLES } from "@/lib/route-guards";
import { adminDb, loadScheduleView } from "@/lib/admin/data";
import { reviewSchedule } from "@/lib/admin/review";
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
  const missing = review.warnings.filter(
    (w) => form.get(`ack:${w.id}`) !== "on",
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
