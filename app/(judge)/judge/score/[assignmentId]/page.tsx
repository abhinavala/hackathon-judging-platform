import Link from "next/link";
import { connection } from "next/server";
import { requireRole } from "@/lib/session";
import { JUDGE_ROLES } from "@/lib/route-guards";
import { createClient } from "@/lib/supabase/server";
import { slotRange } from "@/lib/team/view";
import type { Criterion, ScoreDraft } from "@/lib/judge/score-draft";
import { ScoreForm } from "./score-form";

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
      "id, status, teams(name, devpost_url), slots(starts_at, ends_at), schedules(status, event_id)",
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
  const [{ data: event }, { data: rubric }, { data: score }] =
    await Promise.all([
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
    ]);

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
      <h1 className="mt-4 text-3xl font-extrabold">{a.teams.name}</h1>
      <p className="text-lg">
        {slotRange(
          { startsAt: a.slots.starts_at, endsAt: a.slots.ends_at },
          event?.timezone ?? "America/Los_Angeles",
        )}
      </p>
      {a.teams.devpost_url && (
        <p className="mt-1">
          <a
            href={a.teams.devpost_url}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Their Devpost page
          </a>
        </p>
      )}
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
