import "server-only";
import { serviceClient } from "@/lib/supabase/service";

// What happened to a team's check-in emails (public.checkin_emails, 0012),
// so a failure in the background send is visible to organizers rather than
// to nobody. Service role only: no signed-in user may write it.

/** Before the response: if the background work dies, this is what stays. */
export async function startDelivery(teamId: string): Promise<void> {
  const { error } = await serviceClient()
    .from("checkin_emails")
    .upsert({ team_id: teamId, status: "sending", failed: [], error: null });
  if (error) throw new Error(`checkin_emails: ${error.message}`);
}

/** After the sends: every address that got nothing, and the first reason. */
export async function finishDelivery(
  teamId: string,
  failed: string[],
  error: string | null,
): Promise<void> {
  const { error: dbError } = await serviceClient()
    .from("checkin_emails")
    .update({
      status: failed.length ? "failed" : "sent",
      failed,
      error: failed.length ? error : null,
      updated_at: new Date().toISOString(),
    })
    .eq("team_id", teamId);
  if (dbError) throw new Error(`checkin_emails: ${dbError.message}`);
}

/**
 * A later successful send (the teammates page) or a corrected address
 * resolves those failures. Best effort: the send itself already happened.
 */
export async function clearDeliveryFailures(
  teamId: string,
  emails: string[],
): Promise<void> {
  const db = serviceClient();
  const { data } = await db
    .from("checkin_emails")
    .select("failed")
    .eq("team_id", teamId)
    .maybeSingle();
  if (!data || !data.failed.some((e) => emails.includes(e))) return;
  const failed = data.failed.filter((e) => !emails.includes(e));
  const { error } = await db
    .from("checkin_emails")
    .update({
      failed,
      status: failed.length ? "failed" : "sent",
      ...(failed.length ? {} : { error: null }),
      updated_at: new Date().toISOString(),
    })
    .eq("team_id", teamId);
  if (error)
    console.error(
      `[checkin] couldn't clear a delivery failure: ${error.message}`,
    );
}
