import Link from "next/link";
import { requireSession } from "@/lib/session";
import { MAX_TEAM_SIZE } from "@/lib/checkin/form";
import { loadMyTeam } from "@/lib/team/members";
import { addTeammate, correctEmail, resendInvite } from "./actions";

export const instant = false;

const input = "w-full rounded border px-3 py-2 text-base";
const button = "rounded border px-3 py-2 font-medium hover:bg-black/5";

// Who's on the team, and (for the captain) fixing a mistyped teammate
// address, re-sending an invitation, or adding someone forgotten at
// check-in. Needs a session: this changes who can sign in as the team, so a
// join code is not enough. Plain forms, so it works without JavaScript.
export default async function TeamMembersPage({
  searchParams,
}: PageProps<"/team/members">) {
  const params = await searchParams;
  const ctx = await requireSession();
  const team = ctx.teamId ? await loadMyTeam(ctx.teamId, ctx.user.id) : null;
  const ok = typeof params.ok === "string" ? params.ok : null;
  const error = typeof params.error === "string" ? params.error : null;

  if (!team)
    return (
      <main className="mx-auto w-full max-w-lg p-5">
        <h1 className="mb-2 text-2xl font-semibold">
          You&apos;re not on a team yet
        </h1>
        <Link href="/checkin" className="underline">
          Check in your team
        </Link>
      </main>
    );

  return (
    <main className="mx-auto w-full max-w-lg p-5">
      <h1 className="mb-1 text-2xl font-semibold">{team.name}: teammates</h1>
      <p className="mb-4">
        Join code <strong className="font-mono">{team.joinCode}</strong> ·{" "}
        <Link href={`/t/${team.joinCode}`} className="underline">
          Your schedule
        </Link>
      </p>
      {(ok || error) && (
        <p
          role={error ? "alert" : "status"}
          className={`mb-4 rounded border-2 p-3 ${error ? "border-red-700" : "border-green-700"}`}
        >
          {error ?? ok}
        </p>
      )}
      {!team.iAmCaptain && (
        <p className="mb-4">
          Only your captain{team.captainName ? ` (${team.captainName})` : ""}{" "}
          can change teammates.
        </p>
      )}

      <ul className="mb-8 space-y-3">
        {team.members.map((m) => (
          <li key={m.email} className="rounded border p-3">
            <p className="font-semibold">
              {m.name ?? m.email}
              {m.isCaptain ? " · captain" : ""}
              {m.isMe ? " · you" : ""}
            </p>
            <p className="text-sm">{m.email}</p>
            <p className="text-sm">
              {m.signedIn ? "Signed in" : "Invited, hasn't signed in yet"}
            </p>
            {team.iAmCaptain && !m.isCaptain && !m.signedIn && (
              <div className="mt-3 space-y-3">
                <form action={correctEmail} className="space-y-2">
                  <input type="hidden" name="email" value={m.email} />
                  <label className="block text-sm font-medium">
                    Wrong address? Correct it:
                    <input
                      name="newEmail"
                      type="email"
                      required
                      defaultValue={m.email}
                      className={input}
                    />
                  </label>
                  <button className={button}>
                    Save and send a new invitation
                  </button>
                </form>
                <form action={resendInvite}>
                  <input type="hidden" name="email" value={m.email} />
                  <button className={button}>Resend the invitation</button>
                </form>
              </div>
            )}
          </li>
        ))}
      </ul>

      {team.iAmCaptain && team.members.length < MAX_TEAM_SIZE && (
        <form action={addTeammate} className="space-y-2 rounded border p-3">
          <h2 className="text-lg font-semibold">Add a teammate</h2>
          <label className="block text-sm font-medium">
            Name
            <input name="name" className={input} />
          </label>
          <label className="block text-sm font-medium">
            Email
            <input name="email" type="email" required className={input} />
          </label>
          <button className={button}>Add and invite</button>
          <p className="text-sm">
            Teams are at most {MAX_TEAM_SIZE} people; you have{" "}
            {team.members.length}.
          </p>
        </form>
      )}
    </main>
  );
}
