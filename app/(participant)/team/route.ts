import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

// Signed-in participants see the same team view as the join-code link, so
// there is one view to maintain. A route handler, so this is a real 307
// (a page's redirect() would come after streaming started and be a 200).
// Layouts don't wrap route handlers; requireSession checks here.
export async function GET() {
  const ctx = await requireSession();
  let to = "/team/none";
  if (ctx.teamId) {
    const db = await createClient();
    const { data } = await db
      .from("teams")
      .select("join_code")
      .eq("id", ctx.teamId)
      .maybeSingle();
    if (data?.join_code) to = `/t/${data.join_code}`;
  }
  return new Response(null, { status: 307, headers: { Location: to } });
}
