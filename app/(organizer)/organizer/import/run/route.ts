import { requireRole } from "@/lib/session";
import { ORGANIZER_ROLES } from "@/lib/route-guards";
import { adminDb, currentEvent } from "@/lib/admin/data";
import { applyImport, blockedReason, prepareImport } from "@/lib/admin/import";
import { emptyImportState, type ImportState } from "../state";

const MAX_BYTES = 1_000_000;

// The import flow's endpoint: read an uploaded file, re-check with names
// filled in, or import. A JSON route handler rather than a server action:
// an action that RETURNS state makes Next re-render the page in the same
// response, and with the session cookie refreshed during the action that
// re-render hits a Next.js invariant (500). A route handler re-renders
// nothing. The CSV is re-read and re-planned on every call, so what is
// written never depends on a preview the browser sent back.
export async function POST(request: Request): Promise<Response> {
  await requireRole(...ORGANIZER_ROLES);
  const db = await adminDb();
  const event = await currentEvent(db);
  const reply = (state: Partial<ImportState>) =>
    Response.json({ ...emptyImportState, ...state } satisfies ImportState, {
      headers: { "cache-control": "no-store" },
    });
  if (!event) return reply({ error: "No event exists yet." });

  const form = await request.formData();
  let csv: string | null = null;
  let fileName: string | null =
    typeof form.get("fileName") === "string"
      ? String(form.get("fileName"))
      : null;
  const file = form.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES)
      return reply({
        error: "That file is over 1 MB; is it the right export?",
      });
    csv = await file.text();
    fileName = file.name;
  } else if (typeof form.get("csv") === "string" && form.get("csv")) {
    csv = String(form.get("csv"));
  }
  if (!csv)
    return reply({ error: "Choose the CSV exported from the Google Form." });

  const names: Record<number, string> = {};
  for (const [k, v] of form.entries()) {
    const m = /^name:(\d+)$/.exec(k);
    if (m && typeof v === "string" && v.trim()) names[Number(m[1])] = v.trim();
  }

  const prepared = await prepareImport(db, event, csv, names);
  const state: Partial<ImportState> = {
    csv,
    fileName,
    read: prepared.read,
    plan: prepared.plan,
    names,
  };
  if (form.get("intent") !== "apply") return reply(state);
  const blocked = blockedReason(prepared);
  if (blocked) return reply({ ...state, error: blocked });
  return reply({ result: await applyImport(db, event, prepared) });
}
