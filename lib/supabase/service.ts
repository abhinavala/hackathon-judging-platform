import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { SUPABASE_URL } from "@/lib/env";
import { serviceRoleKey } from "@/lib/server-env";

/**
 * The service-role client: bypasses RLS. Server-only, for the few writes no
 * signed-in user can make: minting sign-in links, and the public check-in
 * form (which calls check_in_team(), granted to the service role alone).
 */
export function serviceClient() {
  return createClient<Database>(SUPABASE_URL, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
