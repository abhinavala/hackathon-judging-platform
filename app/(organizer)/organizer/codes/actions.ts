"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { ORGANIZER_ROLES } from "@/lib/route-guards";
import { adminDb, currentEvent } from "@/lib/admin/data";
import { back } from "../_ui/redirect";

const PATH = "/organizer/codes";

/** Gives every checked-in team and person whatever code they're missing, from what's free. */
export async function assignMissingCodes() {
  await requireRole(...ORGANIZER_ROLES);
  const db = await adminDb();
  const event = await currentEvent(db);
  if (!event) back(PATH, { error: "No event exists yet." });
  const { error } = await db.rpc("claim_missing_codes", { p_event: event.id });
  if (error) back(PATH, { error: error.message });
  revalidatePath(PATH);
  revalidatePath("/organizer");
  back(PATH, {
    ok: "Done: anyone still listed below is waiting on an empty pool.",
  });
}
