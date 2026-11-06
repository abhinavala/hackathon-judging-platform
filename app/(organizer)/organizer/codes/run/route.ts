import { requireRole } from "@/lib/session";
import { ORGANIZER_ROLES } from "@/lib/route-guards";
import { adminDb, currentEvent } from "@/lib/admin/data";
import { parseCodesCsv, planCodes, type CodeRow } from "@/lib/csv/codes-import";
import { emptyCodeImportState, type CodeImportState } from "../state";

const MAX_BYTES = 2_000_000;
const CHUNK = 500;

// Preview or import a pasted AWS CSV. Like the team import, a JSON route
// handler, and the CSV is re-read on every call: what is written never
// depends on a preview the browser sent back. Writes as the organizer (RLS).
export async function POST(request: Request): Promise<Response> {
  await requireRole(...ORGANIZER_ROLES);
  const db = await adminDb();
  const event = await currentEvent(db);
  const reply = (state: Partial<CodeImportState>) =>
    Response.json(
      { ...emptyCodeImportState, ...state } satisfies CodeImportState,
      { headers: { "cache-control": "no-store" } },
    );
  if (!event) return reply({ error: "No event exists yet." });

  const form = await request.formData();
  const csv = String(form.get("csv") ?? "");
  if (csv.length > MAX_BYTES)
    return reply({ error: "That's over 2 MB; is it the right file?" });
  const parsed = parseCodesCsv(csv, Date.now());
  if (!parsed.ok)
    return reply({ error: parsed.error, headers: parsed.headers });

  const { data: existing, error: exError } = await db
    .from("access_codes")
    .select("code, claimed_at")
    .eq("event_id", event.id)
    .eq("kind", parsed.kind)
    .limit(5000);
  if (exError)
    return reply({ error: `Couldn't read the pool: ${exError.message}` });
  const plan = planCodes(
    parsed.rows,
    (existing ?? []).map((e) => ({
      code: e.code,
      claimed: e.claimed_at !== null,
    })),
  );
  const preview: Partial<CodeImportState> = {
    kind: parsed.kind,
    columns: parsed.columns,
    total: parsed.rows.length,
    sample: parsed.rows.slice(0, 8).map((r) => sample(parsed.kind, r)),
    warnings: parsed.warnings,
    plan,
  };
  if (form.get("mode") !== "import") return reply(preview);

  const rows = parsed.rows.map((r) =>
    parsed.kind === "workshop"
      ? {
          event_id: event.id,
          kind: "workshop",
          code: r.code,
          join_url: r.joinUrl,
          aws_team_name: r.awsTeamName,
          aws_account_id: r.awsAccountId,
          aws_state: r.state,
          participant_count: r.participantCount,
          last_joined: r.lastJoined,
          details: r.details,
        }
      : {
          event_id: event.id,
          kind: "kiro",
          code: r.code,
          redemption_url: r.redemptionUrl,
          amount: r.amount,
          expires_at: r.expiresAt,
          expires_text: r.expiresText,
          details: r.details,
        },
  );
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db
      .from("access_codes")
      .upsert(rows.slice(i, i + CHUNK), { onConflict: "event_id,kind,code" });
    if (error)
      return reply({
        ...preview,
        error: `Stopped at row ${i + 1}: ${error.message}. Rows before it were imported; importing again is safe.`,
      });
  }
  const before = await claimedCount(db, event.id);
  const { error: claimError } = await db.rpc("claim_missing_codes", {
    p_event: event.id,
  });
  const after = await claimedCount(db, event.id);
  return reply({
    ...preview,
    done:
      `Imported: ${plan.added} new, ${plan.updated + plan.updatedClaimed} updated.` +
      (claimError
        ? ` Handing out codes to teams waiting for one failed: ${claimError.message}`
        : ` ${after - before} code${after - before === 1 ? "" : "s"} just went to teams and people who were waiting.`),
  });
}

async function claimedCount(
  db: Awaited<ReturnType<typeof adminDb>>,
  eventId: string,
) {
  const { count } = await db
    .from("access_codes")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .not("claimed_at", "is", null);
  return count ?? 0;
}

function sample(kind: "workshop" | "kiro", r: CodeRow) {
  return kind === "workshop"
    ? {
        line: r.line,
        code: r.code,
        link: r.joinUrl,
        info: [
          r.awsTeamName && `AWS name ${r.awsTeamName}`,
          r.awsAccountId && `account ${r.awsAccountId}`,
          r.state,
          r.participantCount !== null && `${r.participantCount} joined`,
        ]
          .filter(Boolean)
          .join(" · "),
      }
    : {
        line: r.line,
        code: r.code,
        link: r.redemptionUrl,
        info: [
          r.amount !== null ? `${r.amount} credits` : "amount unreadable",
          r.expiresAt
            ? `expires ${r.expiresAt.slice(0, 10)}`
            : r.expiresText && `expires "${r.expiresText}"`,
        ]
          .filter(Boolean)
          .join(" · "),
      };
}
