import "server-only";
import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/supabase/service";

export type Member = {
  email: string;
  name: string | null;
  isCaptain: boolean;
  isMe: boolean;
  /** Has this person ever signed in? Only never-signed-in invites can change. */
  signedIn: boolean;
  userId: string | null;
};

export type MyTeam = {
  id: string;
  name: string;
  joinCode: string;
  members: Member[];
  iAmCaptain: boolean;
  captainName: string | null;
};

/**
 * The signed-in person's team, read through their own session (RLS scopes it
 * to teams they're on), plus whether each member has ever signed in. That
 * last part needs the service role: it lives on auth.users. Note that every
 * member HAS an account from check-in (minting their link created it), so
 * "has an account" can't mean "joined"; last_sign_in_at does.
 */
export async function loadMyTeam(
  teamId: string,
  myUserId: string,
): Promise<MyTeam | null> {
  const db = await createClient();
  const { data: team, error } = await db
    .from("teams")
    .select("id, name, join_code, team_members(email, full_name, is_captain, user_id)")
    .eq("id", teamId)
    .maybeSingle();
  if (error) throw new Error(`team: ${error.message}`);
  if (!team) return null;

  const admin = serviceClient();
  const members = await Promise.all(
    team.team_members.map(async (m) => {
      let signedIn = false;
      if (m.user_id) {
        const { data } = await admin.auth.admin.getUserById(m.user_id);
        signedIn = !!data.user?.last_sign_in_at;
      }
      return {
        email: m.email,
        name: m.full_name,
        isCaptain: m.is_captain,
        isMe: m.user_id === myUserId,
        signedIn,
        userId: m.user_id,
      };
    }),
  );
  members.sort(
    (a, b) =>
      Number(b.isCaptain) - Number(a.isCaptain) || a.email.localeCompare(b.email),
  );
  return {
    id: team.id,
    name: team.name,
    joinCode: team.join_code,
    members,
    iAmCaptain: members.some((m) => m.isMe && m.isCaptain),
    captainName: members.find((m) => m.isCaptain)?.name ?? null,
  };
}

/**
 * After a typo'd address is corrected: delete the account check-in created
 * for it, if nobody ever signed in to it and nothing else points at it. Its
 * sign-in link (still live for a few hours) then stops working, so whoever
 * owns the typo'd address can't use it.
 */
export async function deleteUnusedAccount(userId: string): Promise<void> {
  const admin = serviceClient();
  const { data } = await admin.auth.admin.getUserById(userId);
  if (!data.user || data.user.last_sign_in_at) return;
  const [{ count: memberships }, { count: judging }] = await Promise.all([
    admin.from("team_members").select("*", { count: "exact", head: true }).eq("user_id", userId),
    admin.from("judges").select("*", { count: "exact", head: true }).eq("user_id", userId),
  ]);
  if ((memberships ?? 0) > 0 || (judging ?? 0) > 0) return;
  await admin.auth.admin.deleteUser(userId);
}
