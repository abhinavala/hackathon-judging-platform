// A judge's score for one team, as the phone holds it: values per criterion
// and notes, plus whether it still has to reach the server. Pure, so the
// merge rule is tested directly.

export type Criterion = {
  id: string;
  label: string;
  description: string | null;
  min: number;
  max: number;
};

export type ScoreDraft = {
  values: Record<string, number>;
  notes: string;
  /** Changed on this phone and not yet confirmed saved by the server. */
  pending: boolean;
  /** When this copy last changed (ms), to pick the newer of two. */
  changedAt: number;
};

export const emptyDraft = (): ScoreDraft => ({
  values: {},
  notes: "",
  pending: false,
  changedAt: 0,
});

/**
 * What to show when the page opens: the phone's copy if it has changes the
 * server never confirmed (Wi-Fi dropped mid-score), otherwise the server's.
 * A pending local copy is never thrown away for an older server one.
 */
export function initialDraft(
  server: ScoreDraft | null,
  local: ScoreDraft | null,
): ScoreDraft {
  if (local?.pending && (!server || local.changedAt >= server.changedAt))
    return local;
  return server ?? local ?? emptyDraft();
}

/** Every criterion has a value inside its scale. */
export function isComplete(draft: ScoreDraft, criteria: Criterion[]): boolean {
  return criteria.every((c) => {
    const v = draft.values[c.id];
    return Number.isInteger(v) && v >= c.min && v <= c.max;
  });
}

/** localStorage key: one per judge per assignment. */
export const draftKey = (judgeId: string, assignmentId: string) =>
  `score:${judgeId}:${assignmentId}`;

/** A stored draft, or null for anything that isn't one. */
export function parseDraft(raw: string | null): ScoreDraft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<ScoreDraft>;
    if (typeof d !== "object" || d === null) return null;
    const values: Record<string, number> = {};
    for (const [k, v] of Object.entries(d.values ?? {}))
      if (Number.isInteger(v)) values[k] = v as number;
    return {
      values,
      notes: typeof d.notes === "string" ? d.notes : "",
      pending: d.pending === true,
      changedAt: typeof d.changedAt === "number" ? d.changedAt : 0,
    };
  } catch {
    return null;
  }
}
