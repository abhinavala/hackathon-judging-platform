import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { readClaims } from "@/lib/supabase/claims";
import type { Role } from "@/lib/route-guards";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export type SessionContext = {
  // From the verified JWT claims, not a full auth User: getClaims() verifies
  // locally against JWKS, where getUser() would cost an auth-server round
  // trip on every request.
  user: { id: string; email: string | null };
  profile: Profile;
  role: Role;
  teamId: string | null;
  judgeId: string | null;
};

// Who is making this request, read through RLS as that user. Memoised per
// request with React cache(), so layouts and pages can all call it freely.
//
// teamId / judgeId: one person may have a team or judge record per event.
// Until events are selectable (later phases) we return the most recent one.
export const getSessionContext = cache(
  async (): Promise<SessionContext | null> => {
    // Marks this as request-time work. Without it, auth-js's token-expiry
    // checks call Date.now() during Cache Components' prerender pass, which
    // Next reports as an error on every request.
    await connection();
    const supabase = await createClient();

    // Verified claims only (see lib/supabase/claims.ts). Never getSession(),
    // which trusts the cookie as-is.
    const { claims } = await readClaims(supabase);
    if (!claims) return null;
    const userId = claims.sub;

    const [profileRes, teamRes, judgeRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
      supabase
        .from("team_members")
        .select("team_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("judges")
        .select("id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    for (const res of [profileRes, teamRes, judgeRes]) {
      if (res.error) throw res.error;
    }

    // The on_auth_user_created trigger creates the profile on signup, so a
    // missing row means the database is out of sync with auth. Fail loudly.
    const profile = profileRes.data;
    if (!profile) throw new Error(`No profile row for user ${userId}`);

    return {
      user: { id: userId, email: claims.email ?? null },
      profile,
      role: profile.role,
      teamId: teamRes.data?.team_id ?? null,
      judgeId: judgeRes.data?.id ?? null,
    };
  },
);

// Second-line guards for the route groups. The real gate is the proxy
// (lib/supabase/proxy.ts), which answers with a genuine HTTP 404 before any
// page code runs. These still 404 on a mismatch if a request ever got past
// it, but by then the response status is already 200, so only the content
// is withheld.
export async function requireRole(
  ...allowed: readonly Role[]
): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx || !allowed.includes(ctx.role)) notFound();
  return ctx;
}

// Any signed-in user, whatever their role. For routes whose data RLS already
// scopes to the viewer.
export async function requireSession(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) notFound();
  return ctx;
}
