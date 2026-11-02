import Link from "next/link";
import { connection } from "next/server";
import { helpPlace } from "@/lib/event/copy";
import { loadPublicEvent, type PublicEvent } from "@/lib/event/public";
import { CodeEntryForm } from "./t/code-form";

// Reads the event (name, board slug, help place) per request; blocks rather
// than prerendering, like /checkin.
export const instant = false;

// The URL a lost person types. One job: get them to their judging times with
// their team's join code. Then check-in and the board, and where to find a
// person. Nothing else.
export default async function Home() {
  await connection();
  // If the database can't be reached, the code box still works (it only
  // needs /t/go); the links and the help place fall back.
  const event: PublicEvent | null = await loadPublicEvent().catch(() => null);

  return (
    <main className="mx-auto w-full max-w-md p-6">
      <p className="text-lg">{event?.name ?? "Hackathon judging"}</p>
      <h1 className="mt-1 mb-6 text-3xl font-bold">Find your judging times</h1>
      <CodeEntryForm large />
      <p className="mt-3 text-sm">
        Your team&apos;s join code looks like ABCD-1234. It was on screen when
        your team checked in, and it&apos;s in your email.
      </p>

      <nav className="mt-10 flex flex-col gap-3 text-lg">
        <Link href="/checkin" className="underline">
          Check in your team
        </Link>
        {event && (
          <Link href={`/board/${event.slug}`} className="underline">
            The judging board
          </Link>
        )}
      </nav>

      <p className="mt-10">
        Lost, or no code? Find an organizer at{" "}
        <strong>{helpPlace(event?.helpLocation)}</strong>.
      </p>
    </main>
  );
}
