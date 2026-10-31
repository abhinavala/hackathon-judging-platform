import { connection } from "next/server";
import { loadCheckInEvent } from "@/lib/checkin/submit";
import { helpPlace } from "@/lib/event/copy";
import { clockWithZone, dayLabel } from "@/lib/team/view";
import { CheckInForm } from "./checkin-form";

// Public: no sign-in. The form writes through /checkin/submit with the
// service role; nothing here reads a session. Blocks rather than
// prerendering, so the tracks and the check-in window are current.
export const instant = false;

/** Now, read outside render (see the print page). */
function requestTime() {
  return Date.now();
}

export default async function CheckInPage({
  searchParams,
}: PageProps<"/checkin">) {
  const params = await searchParams;
  await connection();
  const event = await loadCheckInEvent();
  const error = typeof params.error === "string" ? params.error : null;

  if (!event)
    return (
      <main className="mx-auto w-full max-w-xl p-5">
        <h1 className="text-2xl font-bold">Check-in isn&apos;t open yet</h1>
      </main>
    );

  const now = requestTime();
  const tz = event.timezone;
  const notYet = event.opensAt && now < Date.parse(event.opensAt);
  const closed = event.closesAt && now > Date.parse(event.closesAt);
  const help = helpPlace(event.helpLocation);

  return (
    <main className="mx-auto w-full max-w-xl p-5">
      <h1 className="mb-1 text-3xl font-bold">Check in your team</h1>
      <p className="mb-6 text-lg">{event.name}</p>

      {notYet ? (
        <p className="rounded border-2 p-4 text-lg">
          Check-in opens at <strong>{clockWithZone(event.opensAt!, tz)}</strong>{" "}
          on {dayLabel(event.opensAt!, tz)}.
        </p>
      ) : (
        <>
          <p className="mb-2">
            One person per team fills this in. You&apos;ll get your team&apos;s
            join code on the next screen straight away, and an email with a
            sign-in link; your teammates each get an invitation.
          </p>
          {closed && (
            <p className="mb-4 rounded border-2 border-amber-500 bg-amber-50 p-3 text-amber-950">
              Check-in closed at {clockWithZone(event.closesAt!, tz)}. You can
              still check in, but the judging schedule may already be set: after
              you submit, find an organizer at {help} so they can add you.
            </p>
          )}
          <p className="mb-6 text-sm">Problems? Find an organizer at {help}.</p>
          <CheckInForm tracks={event.tracks} initialError={error} />
        </>
      )}
    </main>
  );
}
