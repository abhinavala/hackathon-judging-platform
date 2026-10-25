import { adminDb, currentEvent } from "@/lib/admin/data";
import { utcToZonedLocal } from "@/lib/admin/time";
import { HELP_FALLBACK, helpPlace } from "@/lib/event/copy";
import { clockWithZone, dayLabel } from "@/lib/team/view";
import { Flash, Section, button, input } from "../_ui/ui";
import { saveEventSettings } from "./actions";

// Reads the organizer's session; blocks on the server rather than
// prerendering (as the guard layout does).
export const instant = false;

// Event-level settings that participant-facing copy reads (migration 0006).
export default async function EventSettingsPage({
  searchParams,
}: PageProps<"/organizer/event">) {
  const params = await searchParams;
  const db = await adminDb();
  const event = await currentEvent(db);
  if (!event) return <p>No event exists yet.</p>;
  const tz = event.timezone;
  const start = event.judging_starts_at;

  return (
    <main>
      <h1 className="mb-4 text-xl font-semibold">Event — {event.name}</h1>
      <Flash params={params} />

      <form action={saveEventSettings}>
        <Section title="Judging start">
          <p className="mb-2 max-w-3xl text-sm">
            The time team pages announce before a schedule is published, and the
            default start when you generate. A schedule that starts at a
            different time gets a warning before you can publish it.
          </p>
          <label className="flex flex-col text-sm">
            Judging starts ({tz})
            <input
              name="judgingStartsAt"
              type="datetime-local"
              defaultValue={start ? utcToZonedLocal(start, tz) : ""}
              className={`${input} w-fit`}
            />
          </label>
        </Section>

        <Section title="Where to get help">
          <p className="mb-2 max-w-3xl text-sm">
            A place someone new to the building can find. It completes the
            sentence &ldquo;find an organizer at …&rdquo; on team pages, the
            board and the printed schedule. Blank means &ldquo;{HELP_FALLBACK}
            &rdquo;.
          </p>
          <label className="flex flex-col text-sm">
            Help location
            <input
              name="helpLocation"
              defaultValue={event.help_location ?? ""}
              maxLength={200}
              placeholder="the check-in table by the main entrance"
              className={`${input} w-full max-w-xl`}
            />
          </label>
        </Section>

        <Section title="What participants see now">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>
              Before publishing:{" "}
              <q>
                {start
                  ? `Judging starts at ${clockWithZone(start, tz)} on ${dayLabel(start, tz)}. Check back closer to then.`
                  : "Check back closer to judging."}
              </q>
            </li>
            <li>
              A team that isn&apos;t scheduled:{" "}
              <q>
                If you submitted your project, find an organizer at{" "}
                {helpPlace(event.help_location)} now.
              </q>
            </li>
          </ul>
        </Section>

        <button className={button}>Save</button>
      </form>
    </main>
  );
}
