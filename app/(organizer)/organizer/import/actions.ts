"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { ORGANIZER_ROLES } from "@/lib/route-guards";
import { adminDb, currentEvent } from "@/lib/admin/data";
import { applyImport, blockedReason, prepareImport } from "@/lib/admin/import";
import { emptyImportState, type ImportState } from "./state";

const MAX_BYTES = 1_000_000;

/**
 * One action for every step: read an uploaded file, re-check with names
 * filled in, or import. The CSV is re-read and re-planned against the
 * database on EVERY step, including the import itself, so what is written
 * never depends on a preview the browser sent back. The logic lives in
 * lib/admin/import.ts, which scripts/test-admin.mjs drives directly.
 */
export async function importTeams(
  prev: ImportState,
  form: FormData,
): Promise<ImportState> {
  await requireRole(...ORGANIZER_ROLES);
  const db = await adminDb();
  const event = await currentEvent(db);
  if (!event) return { ...emptyImportState, error: "No event exists yet." };

  let csv = prev.csv;
  let fileName = prev.fileName;
  const file = form.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) {
      return {
        ...emptyImportState,
        error: "That file is over 1 MB; is it the right export?",
      };
    }
    csv = await file.text();
    fileName = file.name;
  } else if (typeof form.get("csv") === "string" && form.get("csv")) {
    csv = String(form.get("csv"));
  }
  if (!csv)
    return {
      ...emptyImportState,
      error: "Choose the CSV exported from the Google Form.",
    };

  const names: Record<number, string> = {};
  for (const [k, v] of form.entries()) {
    const m = /^name:(\d+)$/.exec(k);
    if (m && typeof v === "string" && v.trim()) names[Number(m[1])] = v.trim();
  }

  const prepared = await prepareImport(db, event, csv, names);
  const state: ImportState = {
    csv,
    fileName,
    error: null,
    read: prepared.read,
    plan: prepared.plan,
    names,
    result: null,
  };
  if (form.get("intent") !== "apply") return state;
  const blocked = blockedReason(prepared);
  if (blocked) return { ...state, error: blocked };

  const result = await applyImport(db, event, prepared);
  revalidatePath("/organizer");
  revalidatePath("/organizer/generate");
  return { ...emptyImportState, result };
}
