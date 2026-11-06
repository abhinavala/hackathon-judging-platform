import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/app/sign-out-button";
import { helpPlace } from "@/lib/event/copy";
import { loadPublicEvent } from "@/lib/event/public";

// Reads the session, so it blocks on the server instead of prerendering a
// static shell. Without this, Cache Components fails the build for reading
// cookies outside a <Suspense> boundary.
export const instant = false;

// Where signing in lands, and where / sends anyone already signed in. One
// primary button for what the person is here to do, the rest beneath it.
export default async function MePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  const supabase = await createClient();
  const event = await loadPublicEvent().catch(() => null);
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

  // One obvious thing to tap, by what the person is here to do: judging
  // first (Sunday morning), then their team, then the organizer screens.
  // Anything else they have goes underneath, smaller.
  const actions = [
    ctx.judgeId && { href: "/judge", label: "Your judging station" },
    ctx.teamId && { href: "/team", label: "Your team" },
    ctx.role === "organizer" && {
      href: "/organizer",
      label: "Organizer screens",
    },
  ].filter((a): a is { href: string; label: string } => !!a);
  const [primary, ...others] = actions;
  // What the homepage offers, since a signed-in visitor now lands here
  // instead of there.
  const more = [
    event && { href: `/board/${event.slug}`, label: "The judging board" },
    { href: "/t", label: "Look up a team by join code" },
    { href: "/checkin", label: "Check in a team" },
  ].filter((a): a is { href: string; label: string } => !!a);

  return (
    <main className="mx-auto w-full max-w-md p-6">
      <p className="mb-1 text-sm">Signed in as {ctx.user.email}</p>
      <h1 className="mb-5 text-2xl font-semibold">
        {event?.name ?? "Hackathon judging"}
      </h1>
      {primary ? (
        <Link
          href={primary.href}
          data-testid="primary-action"
          className="mb-3 block rounded-lg border-2 border-black bg-black px-4 py-4 text-center text-xl font-semibold text-white dark:border-white dark:bg-white dark:text-black"
        >
          {primary.label}
        </Link>
      ) : (
        <div className="mb-4 rounded border-2 p-4" data-testid="no-role">
          <p className="mb-2 font-semibold">
            You&apos;re not on a team or the judge list yet.
          </p>
          <p>
            If you should be, ask your captain to add this address, or find an
            organizer at {helpPlace(event?.helpLocation)}. Judges: the address
            you sign in with has to be the one the organizers have for you.
          </p>
        </div>
      )}
      {others.map((a) => (
        <Link
          key={a.href}
          href={a.href}
          className="mb-3 block rounded-lg border-2 px-4 py-3 text-center text-lg font-semibold"
        >
          {a.label}
        </Link>
      ))}
      <nav className="mt-6 mb-8 flex flex-col gap-2">
        {more.map((a) => (
          <Link key={a.href} href={a.href} className="underline">
            {a.label}
          </Link>
        ))}
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
