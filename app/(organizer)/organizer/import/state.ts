import type { ImportPlan, ReadResult } from "@/lib/csv/teams-import";
import type { ImportResult } from "@/lib/admin/import";

// The import flow's state, shared by the server action and the client form.
// Kept out of actions.ts: a "use server" module may only export async
// functions.

export type ImportState = {
  /** The CSV text, carried between steps; never stored anywhere. */
  csv: string | null;
  fileName: string | null;
  error: string | null;
  read: ReadResult | null;
  plan: ImportPlan | null;
  /** Names the organizer has typed for old-form responses, by CSV line. */
  names: Record<number, string>;
  result: ImportResult | null;
};

export const emptyImportState: ImportState = {
  csv: null,
  fileName: null,
  error: null,
  read: null,
  plan: null,
  names: {},
  result: null,
};
