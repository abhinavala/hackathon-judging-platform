"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { normalizeEmail } from "@/lib/auth/email";
import { mintSignInLink } from "@/lib/auth/magic-link";
import { getLinkSender, sendAll } from "@/lib/auth/senders";
import { MAX_TEAM_SIZE } from "@/lib/checkin/form";
import { allow, LIMITS } from "@/lib/rate-limit";
import {
  deleteUnusedAccount,
  loadMyTeam,
  type MyTeam,
} from "@/lib/team/members";

const PATH = "/team/members";

function back(message: { ok: string } | { error: string }): never {
  const [k, v] =
    "ok" in message ? ["ok", message.ok] : ["error", message.error];
  redirect(`${PATH}?${new URLSearchParams({ [k]: v })}`);
}

/** The signed-in captain's team, or back with why not. */
async function captainsTeam(): Promise<MyTeam> {
  const ctx = await requireSession();
  if (!ctx.teamId) back({ error: "You're not on a team." });
  const team = await loadMyTeam(ctx.teamId, ctx.user.id);
  if (!team) back({ error: "Your team couldn't be loaded." });
  // RLS lets any member write team_members; changing who is on the team is
  // the captain's call, so it's checked here.
  if (!team.iAmCaptain)
    back({ error: "Only your team's captain can change teammates." });
  return team;
}

/** Rate-limited invite to one address; says what happened. */
async function invite(team: MyTeam, email: string): Promise<string> {
  const ok =
    (await allow(`invite-team:${team.id}`, LIMITS.invitesPerTeam)) &&
    (await allow(`invite-addr:${email}`, LIMITS.invitesPerAddress));
  if (!ok)
    return "Not emailed: too many invitations in the last hour. Share your join code with them instead.";
  try {
    const link = await mintSignInLink(email);
    const { failed } = await sendAll(getLinkSender(), [
      {
        email,
        link,
        template: "invite",
        data: {
          teamName: team.name,
          joinCode: team.joinCode,
          inviterName: team.captainName ?? undefined,
        },
      },
    ]);
    if (failed.length) throw new Error(failed[0].error);
    return `Invitation emailed to ${email}.`;
  } catch (e) {
    console.error(
      `[team] invite failed: ${e instanceof Error ? e.message : e}`,
    );
    return `The invitation to ${email} couldn't be sent right now. Share your join code (${team.joinCode}) with them.`;
  }
}

function invitable(team: MyTeam, email: string) {
  const m = team.members.find((x) => x.email === email);
  if (!m) back({ error: "That address isn't on your team." });
  if (m.isCaptain) back({ error: "That's you." });
  if (m.signedIn)
    back({
      error: `${email} has already signed in, so there's nothing to fix.`,
    });
  return m;
}

/** Fixes a mistyped teammate address and invites the corrected one. */
export async function correctEmail(form: FormData) {
  const team = await captainsTeam();
  const old = String(form.get("email") ?? "");
  const member = invitable(team, old);
  const next = normalizeEmail(form.get("newEmail"));
  if (!next) back({ error: "That doesn't look like an email address." });
  if (next === old) back({ error: "That's the same address." });
  if (team.members.some((m) => m.email === next))
    back({ error: `${next} is already on your team.` });

  const db = await createClient();
  const { error } = await db
    .from("team_members")
    .update({ email: next, user_id: null })
    .eq("team_id", team.id)
    .eq("email", old);
  if (error)
    back({
      error: /already_on_a_team/.test(error.message)
        ? `${next} is already on another team that has checked in.`
        : `Not changed: ${error.message}`,
    });
  // The typo'd address's account and live link go away.
  if (member.userId) await deleteUnusedAccount(member.userId);
  const sent = await invite(team, next);
  revalidatePath(PATH);
  back({ ok: `Changed ${old} to ${next}. ${sent}` });
}

/** Sends a teammate who hasn't signed in a fresh invitation. */
export async function resendInvite(form: FormData) {
  const team = await captainsTeam();
  const email = String(form.get("email") ?? "");
  invitable(team, email);
  back({ ok: await invite(team, email) });
}

/** Adds someone the captain forgot at check-in, up to the team size. */
export async function addTeammate(form: FormData) {
  const team = await captainsTeam();
  if (team.members.length >= MAX_TEAM_SIZE)
    back({ error: `Teams are at most ${MAX_TEAM_SIZE} people.` });
  const email = normalizeEmail(form.get("email"));
  if (!email) back({ error: "That doesn't look like an email address." });
  if (team.members.some((m) => m.email === email))
    back({ error: `${email} is already on your team.` });
  const name =
    String(form.get("name") ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 100) || null;

  const db = await createClient();
  const { error } = await db
    .from("team_members")
    .insert({ team_id: team.id, email, full_name: name });
  if (error)
    back({
      error: /already_on_a_team/.test(error.message)
        ? `${email} is already on another team that has checked in.`
        : `Not added: ${error.message}`,
    });
  const sent = await invite(team, email);
  revalidatePath(PATH);
  back({ ok: `Added ${email}. ${sent}` });
}
