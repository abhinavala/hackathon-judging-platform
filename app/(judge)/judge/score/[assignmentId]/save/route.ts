import { getSessionContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

// Saves one judge's score for one assignment: the notes, and a value per
// criterion. Written AS the judge, so RLS (0014) decides: their own score,
// a published and uncancelled assignment at their station, event unlocked.
// The phone retries until this answers ok.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  const { assignmentId } = await params;
  const ctx = await getSessionContext();
  if (!ctx?.judgeId)
    return Response.json(
      { ok: false, error: "You're not signed in as a judge." },
      { status: 401 },
    );
  const body = (await request.json().catch(() => null)) as {
    values?: Record<string, unknown>;
    notes?: unknown;
  } | null;
  if (!body)
    return Response.json({ ok: false, error: "Bad request." }, { status: 400 });

  const db = await createClient();
  const { data: score, error } = await db
    .from("scores")
    .upsert(
      {
        assignment_id: assignmentId,
        judge_id: ctx.judgeId,
        notes: typeof body.notes === "string" ? body.notes.slice(0, 4000) : "",
        submitted_at: new Date().toISOString(),
      },
      { onConflict: "assignment_id,judge_id" },
    )
    .select("id")
    .single();
  if (error || !score) return refusal(error?.message);

  const items = Object.entries(body.values ?? {})
    .filter(([, v]) => Number.isInteger(v))
    .map(([criterion_id, value]) => ({
      score_id: score.id,
      criterion_id,
      value: value as number,
    }));
  if (items.length) {
    const { error: itemError } = await db
      .from("score_items")
      .upsert(items, { onConflict: "score_id,criterion_id" });
    if (itemError) return refusal(itemError.message);
  }
  return Response.json(
    { ok: true, savedAt: Date.now() },
    { headers: { "cache-control": "no-store" } },
  );
}

/** A refusal the judge can act on, not a database message. */
function refusal(message = "") {
  const locked = /row-level security|violates/i.test(message);
  return Response.json(
    {
      ok: false,
      error: locked
        ? "This score can't be saved: scoring is closed, or this team isn't at your station on the published schedule."
        : /out_of_scale/.test(message)
          ? "A score is outside the scale."
          : "The server couldn't save this right now. It will keep trying.",
      retry: !locked,
    },
    { status: locked ? 403 : 500 },
  );
}
