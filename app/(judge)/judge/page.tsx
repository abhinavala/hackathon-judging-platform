import { connection } from "next/server";
import { requireRole } from "@/lib/session";
import { JUDGE_ROLES } from "@/lib/route-guards";
import { createClient } from "@/lib/supabase/server";
import { helpPlace } from "@/lib/event/copy";
import { clockWithZone, dayLabel } from "@/lib/team/view";
import { StationView, type JudgeStation } from "./station-view";

/** When this render happened, for the client's clock offset. */
function renderTime() {
  return Date.now();
}

// A judge's station: their teams on the PUBLISHED schedule, in time order,
// the current one highlighted. Read as the judge, so RLS decides what's
// visible: their own station only, published versions only.
export default async function JudgingPage() {
  const ctx = await requireRole(...JUDGE_ROLES);
  await connection();
  const db = await createClient();
  const serverNow = renderTime();

  const shell = (children: React.ReactNode) => (
    <main className="mx-auto w-full max-w-xl p-6">{children}</main>
  );
  if (!ctx.judgeId)
    return shell(
      <p className="text-lg">
        You&apos;re signed in as a judge but aren&apos;t on the judge list. Find
        an organizer at the help desk.
      </p>,
    );

  const { data: judge } = await db
    .from("judges")
    .select(
      "id, full_name, events(id, name, timezone, help_location, judging_starts_at)",
    )
    .eq("id", ctx.judgeId)
    .single();
  const event = judge?.events;
  if (!judge || !event)
    return shell(
      <p className="text-lg">Your judge record couldn&apos;t be loaded.</p>,
    );
  const help = helpPlace(event.help_location);

  const [{ data: seats }, { data: published }] = await Promise.all([
    db
      .from("panel_judges")
      .select("panel_id, panels(label, location_text, sort_order)")
      .eq("judge_id", judge.id),
    db
      .from("schedules")
      .select("id, version")
      .eq("event_id", event.id)
      .eq("status", "published")
      .maybeSingle(),
  ]);

  const greeting = (
    <p className="mb-4 text-sm text-gray-600">
      {judge.full_name} · {event.name}
    </p>
  );
  if (!seats?.length)
    return shell(
      <>
        {greeting}
        <p className="text-lg">
          You haven&apos;t been given a station yet. Find an organizer at {help}
          .
        </p>
      </>,
    );
  if (!published)
    return shell(
      <>
        {greeting}
        <p className="text-lg">
          The judging schedule isn&apos;t published yet.
          {event.judging_starts_at &&
            ` Judging starts at ${clockWithZone(event.judging_starts_at, event.timezone)} on ${dayLabel(event.judging_starts_at, event.timezone)}.`}{" "}
          Check back closer to then.
        </p>
      </>,
    );

  const { data: rows } = await db
    .from("assignments")
    .select("panel_id, status, teams(name), slots(starts_at, ends_at)")
    .eq("schedule_id", published.id)
    .in(
      "panel_id",
      seats.map((s) => s.panel_id),
    )
    .neq("status", "cancelled");

  const stations: JudgeStation[] = seats
    .sort((a, b) => (a.panels?.sort_order ?? 0) - (b.panels?.sort_order ?? 0))
    .map((s) => ({
      label: s.panels?.label ?? "Your station",
      location: s.panels?.location_text ?? null,
      teams: (rows ?? [])
        .filter((r) => r.panel_id === s.panel_id && r.teams && r.slots)
        .map((r) => ({
          team: r.teams!.name,
          startsAt: r.slots!.starts_at,
          endsAt: r.slots!.ends_at,
        })),
    }));

  return shell(
    <>
      {greeting}
      <StationView
        stations={stations}
        timeZone={event.timezone}
        version={published.version}
        serverNow={serverNow}
      />
      <p className="mt-2 text-sm text-gray-600">
        Something wrong? Find an organizer at {help}.
      </p>
    </>,
  );
}
