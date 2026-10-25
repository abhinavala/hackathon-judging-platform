import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/env";
import { fromRpc, type TeamView } from "@/lib/team/view";

// Anonymous on purpose: the team view works for anyone holding the join code,
// through the team_view() RPC (migration 0005). No cookies, no session.
const anon = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** The view and when it was read (server clock, ms). */
export async function loadTeamView(
  code: string,
): Promise<{ view: TeamView; fetchedAt: number }> {
  const { data, error } = await anon.rpc("team_view", { p_code: code });
  if (error) throw new Error(`team_view: ${error.message}`);
  return { view: fromRpc(data), fetchedAt: Date.now() };
}
