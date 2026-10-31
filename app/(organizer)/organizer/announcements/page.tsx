import { adminDb, currentEvent } from "@/lib/admin/data";
import { clockWithZone, dayLabel } from "@/lib/team/view";
import { Flash, Section, button, input, table } from "../_ui/ui";
import { postAnnouncement, setAnnouncementActive } from "./actions";

// Reads the organizer's session; blocks on the server rather than
// prerendering (as the guard layout does).
export const instant = false;

const LEVEL_LABEL = {
  info: "Info (blue)",
  warning: "Warning (amber)",
  critical: "Critical (red)",
} as const;

// The banner on the board and on every team page.
export default async function AnnouncementsPage({
  searchParams,
}: PageProps<"/organizer/announcements">) {
  const params = await searchParams;
  const db = await adminDb();
  const event = await currentEvent(db);
  if (!event) return <p>No event exists yet.</p>;
  const { data, error } = await db
    .from("announcements")
    .select("id, body, level, active, created_at")
    .eq("event_id", event.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`announcements: ${error.message}`);
  const all = data ?? [];
  const active = all.filter((a) => a.active);
  const cleared = all.filter((a) => !a.active);
  const tz = event.timezone;
  const when = (t: string) => `${dayLabel(t, tz)}, ${clockWithZone(t, tz)}`;

  return (
    <main>
      <h1 className="mb-4 text-xl font-semibold">
        Announcements — {event.name}
      </h1>
      <Flash params={params} />
      <p className="mb-4 max-w-3xl text-sm">
        Active announcements show as a banner on the{" "}
        <a href={`/board/${event.slug}`} className="underline">
          board
        </a>{" "}
        and at the top of every team page, newest first. Both refresh on their
        own within 25 seconds.
      </p>

      <Section title="Post">
        <form action={postAnnouncement} className="space-y-2 text-sm">
          <label className="flex flex-col">
            Text (one or two short sentences)
            <input
              name="body"
              maxLength={200}
              required
              placeholder="Station 4 has moved to the Blue section, back wall."
              className={`${input} w-full max-w-2xl`}
            />
          </label>
          <label className="flex items-center gap-2">
            Level
            <select name="level" defaultValue="info" className={input}>
              {Object.entries(LEVEL_LABEL).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button className={button}>Post announcement</button>
        </form>
      </Section>

      <Section title={`Showing now (${active.length})`}>
        {active.length === 0 ? (
          <p className="text-sm">Nothing. The banner is empty.</p>
        ) : (
          <List rows={active} when={when} action="Clear" />
        )}
      </Section>

      {cleared.length > 0 && (
        <Section title={`Cleared (${cleared.length})`}>
          <List rows={cleared} when={when} action="Show again" />
        </Section>
      )}
    </main>
  );
}

function List({
  rows,
  when,
  action,
}: {
  rows: {
    id: string;
    body: string;
    level: keyof typeof LEVEL_LABEL;
    created_at: string;
  }[];
  when: (t: string) => string;
  action: "Clear" | "Show again";
}) {
  return (
    <table className={table}>
      <thead>
        <tr>
          <th>Text</th>
          <th>Level</th>
          <th>Posted</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((a) => (
          <tr key={a.id}>
            <td>{a.body}</td>
            <td>{a.level}</td>
            <td className="whitespace-nowrap">{when(a.created_at)}</td>
            <td>
              <form action={setAnnouncementActive}>
                <input type="hidden" name="id" value={a.id} />
                <input
                  type="hidden"
                  name="active"
                  value={action === "Clear" ? "false" : "true"}
                />
                <button className={button} aria-label={`${action}: ${a.body}`}>
                  {action}
                </button>
              </form>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
