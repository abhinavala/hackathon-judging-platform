import type { Database } from "@/lib/database.types";

export type Role = Database["public"]["Enums"]["user_role"];

// Which roles may open each role-scoped route group. The single source for
// both the real gate (lib/supabase/proxy.ts, which answers a mismatch with a
// genuine HTTP 404 before any page code runs) and the layout guards (a second
// line of defense).
//
// /team is deliberately absent: any signed-in user passes its guard, and what
// a person can see there is decided by RLS, not by role. Keeping it out also
// keeps the proxy's extra profile read to the ~25 judges and organizers
// rather than every participant.
//
// The role is read from profiles on each gated request, never from a JWT
// claim: claims go stale, and an alum added as a judge on Saturday morning
// (migration 0003) must get in without waiting for a token refresh.
export const JUDGE_ROLES = ["judge"] as const satisfies readonly Role[];
export const ORGANIZER_ROLES = ["organizer"] as const satisfies readonly Role[];

const ROLE_GATES: { prefix: string; roles: readonly Role[] }[] = [
  { prefix: "/judge", roles: JUDGE_ROLES },
  { prefix: "/organizer", roles: ORGANIZER_ROLES },
];

export function rolesRequiredFor(pathname: string): readonly Role[] | null {
  const gate = ROLE_GATES.find(
    ({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  return gate?.roles ?? null;
}
