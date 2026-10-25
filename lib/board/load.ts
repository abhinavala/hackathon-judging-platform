import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/env";
import { fromRpc, type BoardView } from "@/lib/board/view";

// Anonymous on purpose: the board is public, through the board_view() RPC
// (migration 0007). No cookies, no session.
const anon = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** The view and when it was read (server clock, ms). */
export async function loadBoardView(
  slug: string,
): Promise<{ view: BoardView; fetchedAt: number }> {
  const { data, error } = await anon.rpc("board_view", { p_event_slug: slug });
  if (error) throw new Error(`board_view: ${error.message}`);
  return { view: fromRpc(data), fetchedAt: Date.now() };
}
