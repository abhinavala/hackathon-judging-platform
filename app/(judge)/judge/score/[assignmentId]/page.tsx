import Link from "next/link";
import { connection } from "next/server";
import { requireRole } from "@/lib/session";
import { JUDGE_ROLES } from "@/lib/route-guards";
import { createClient } from "@/lib/supabase/server";
import { slotRange } from "@/lib/team/view";
import type { Criterion, ScoreDraft } from "@/lib/judge/score-draft";
import type { StationTeam } from "@/lib/judge/station";
import { trackBadges } from "@/lib/event/track-badge";
import { PhaseLine } from "../../phase-line";
import { ScoreForm } from "./score-form";

/** When this render happened, for the phase line's clock offset. */
function renderTime() {
  return Date.now();
}

// Score entry for one team (docs/phase-5-spec.md, item 2). Read as the
// judge: RLS shows only their own station's published assignments and their
// own score, so a team that isn't theirs simply isn't found.
export default async function ScorePage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const ctx = await requireRole(...JUDGE_ROLES);
  await connection();
  const { assignmentId } = await params;
  const db = await createClient();
  const shell = (children: React.ReactNode) => (
    <main className="mx-auto w-full max-w-xl p-4">{children}</main>
  );
  const back = (
    <Link href="/judge" className="text-lg underline">
      ← Your station
    </Link>
  );

  const { data: a } = await db
    .from("assignments")
    .select(
      "id, status, schedule_id, panel_id, teams(name, devpost_url, team_tracks(tracks(name, sponsor, sort_order))), slots(starts_at, ends_at), schedules(status, event_id)",
    )
    .eq("id", assignmentId)
    .maybeSingle();
  if (!a || !a.teams || !a.slots || a.schedules?.status !== "published")
    return shell(
      <>
        {back}
        <p className="mt-6 text-lg">
          That team isn&apos;t at your station on the published schedule.
        </p>
      </>,
    );

  const eventId = a.schedules.event_id;
  const serverNow = renderTime();
  const [
    { data: event },
    { data: rubric },
    { data: score },
    { data: station },
  ] = await Promise.all([
    db
      .from("events")
      .select("timezone, scores_locked_at")
      .eq("id", eventId)
      .single(),
    db
      .from("rubric_criteria")
      .select("id, label, description, scale_min, scale_max, sort_order")
      .eq("event_id", eventId)
      .order("sort_order"),
    db
      .from("scores")
      .select("notes, updated_at, score_items(criterion_id, value)")
      .eq("assignment_id", assignmentId)
      .eq("judge_id", ctx.judgeId!)
      .maybeSingle(),
    // This station's teams, for the phase line: who's on now, and the clock.
    db
      .from("assignments")
      .select("teams(name), slots(starts_at, ends_at)")
      .eq("schedule_id", a.schedule_id)
      .eq("panel_id", a.panel_id)
      .neq("status", "cancelled"),
  ]);
  const stationTeams: StationTeam[] = (station ?? [])
    .filter((r) => r.teams && r.slots)
    .map((r) => ({
      team: r.teams!.name,
      startsAt: r.slots!.starts_at,
      endsAt: r.slots!.ends_at,
    }));

  const tracks = trackBadges(
    (a.teams.team_tracks ?? []).flatMap((x) =>
      x.tracks
        ? [
            {
              name: x.tracks.name,
              sponsor: x.tracks.sponsor,
              sortOrder: x.tracks.sort_order,
            },
          ]
        : [],
    ),
  );
  const criteria: Criterion[] = (rubric ?? []).map((c) => ({
    id: c.id,
    label: c.label,
    description: c.description,
    min: c.scale_min,
    max: c.scale_max,
  }));
  const saved: ScoreDraft | null = score
    ? {
        values: Object.fromEntries(
          score.score_items.map((i) => [i.criterion_id, i.value]),
        ),
        notes: score.notes ?? "",
        pending: false,
        changedAt: Date.parse(score.updated_at),
      }
    : null;

  return shell(
    <>
      {back}
      <PhaseLine teams={stationTeams} serverNow={serverNow} />
      <h1 className="mt-4 text-3xl font-extrabold">{a.teams.name}</h1>
      {/* The tracks this team entered: what "Sponsor alignment" is scored
          against. Read as the judge (team_tracks_read covers teams they judge). */}
      <ul className="mt-2 flex flex-wrap gap-2" data-testid="team-tracks">
        {tracks.length > 0 ? (
          tracks.map((t) => (
            <li
              key={t}
              className="rounded-full border-2 border-sky-700 bg-sky-50 px-3 py-1 text-sm font-semibold text-sky-900 dark:border-sky-400 dark:bg-sky-950 dark:text-sky-100"
            >
              {t}
            </li>
          ))
        ) : (
          <li className="text-sm font-semibold">No sponsor track entered</li>
        )}
      </ul>
      <p className="text-lg">
        {slotRange(
          { startsAt: a.slots.starts_at, endsAt: a.slots.ends_at },
          event?.timezone ?? "America/Los_Angeles",
        )}
      </p>
      <p className="mt-1" data-testid="devpost">
        {a.teams.devpost_url ? (
          <a
            href={a.teams.devpost_url}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Their Devpost page
          </a>
        ) : (
          "Devpost: no link provided."
        )}
      </p>
      <ScoreForm
        assignmentId={assignmentId}
        judgeId={ctx.judgeId!}
        criteria={criteria}
        saved={saved}
        locked={!!event?.scores_locked_at || a.status === "cancelled"}
      />
    </>,
  );
}
