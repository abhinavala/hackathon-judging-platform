import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/app/sign-out-button";

// Reads the session, so it blocks on the server instead of prerendering a
// static shell. Without this, Cache Components fails the build for reading
// cookies outside a <Suspense> boundary.
export const instant = false;

// Where signing in lands. It used to be a bare account readout, so nothing
// led an organizer to /organizer or a judge to /judge: you had to know the
// URL. It now starts with where to go for your role.
export default async function MePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  const supabase = await createClient();
  const [team, judge] = await Promise.all([
    ctx.teamId
      ? supabase
          .from("teams")
          .select("name, join_code")
          .eq("id", ctx.teamId)
          .single()
      : null,
    ctx.judgeId
      ? supabase
          .from("judges")
          .select("full_name, affiliation")
          .eq("id", ctx.judgeId)
          .single()
      : null,
  ]);

  return (
    <main className="mx-auto w-full max-w-xl p-8">
      <h1 className="mb-4 text-xl font-semibold">You&apos;re signed in</h1>
      <nav className="mb-8 flex flex-col gap-3 text-lg">
        {ctx.role === "organizer" && (
          <Link href="/organizer" className="font-semibold underline">
            Organizer screens: schedule, judges, stations, check-ins
          </Link>
        )}
        {ctx.judgeId && (
          <Link href="/judge" className="font-semibold underline">
            Your judging station
          </Link>
        )}
        {ctx.teamId && (
          <Link href="/team" className="font-semibold underline">
            Your team&apos;s judging times
          </Link>
        )}
        {ctx.role !== "organizer" && !ctx.judgeId && !ctx.teamId && (
          <p>
            You&apos;re not on a team or the judge list yet. If you should be,
            ask your captain to add your address, or find an organizer.
          </p>
        )}
      </nav>
      <h2 className="mb-2 text-sm font-semibold text-gray-600">Account</h2>
      <dl className="grid grid-cols-[8rem_1fr] gap-y-2">
        <dt>Email</dt>
        <dd data-testid="email">{ctx.user.email}</dd>
        <dt>Role</dt>
        <dd data-testid="role">{ctx.role}</dd>
        <dt>Team</dt>
        <dd>
          {team?.data ? `${team.data.name} (${team.data.join_code})` : "none"}
        </dd>
        <dt>Judge</dt>
        <dd>
          {judge?.data
            ? `${judge.data.full_name} (${judge.data.affiliation ?? "unaffiliated"})`
            : "none"}
        </dd>
      </dl>
      <div className="mt-6">
        <SignOutButton />
      </div>
    </main>
  );
}
