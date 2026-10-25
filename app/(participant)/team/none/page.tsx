import Link from "next/link";
import { requireSession } from "@/lib/session";

export const instant = false;

// Where /team sends a signed-in person who isn't on a team. Never blank.
export default async function NotOnATeamPage() {
  const ctx = await requireSession();
  return (
    <main className="mx-auto w-full max-w-lg p-5">
      <h1 className="mb-2 text-2xl font-semibold">
        You&apos;re not on a team yet
      </h1>
      <p className="mb-3">
        Signed in as {ctx.user.email}, but this address isn&apos;t listed on any
        team for this event.
      </p>
      <p className="mb-3">
        If your team checked in with a different email for you, ask your captain
        to fix it, or find an organizer at the help desk.
      </p>
      <p>
        Have your team&apos;s join code?{" "}
        <Link href="/t" className="underline">
          Enter it here
        </Link>
        .
      </p>
    </main>
  );
}
