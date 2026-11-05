// Ranking and export for deliberation (docs/phase-5-spec.md, items 4 and 5).
// Pure. The raw mean is the ranking; the per-judge normalised value sits
// beside it and never reorders it. Ties are left for people to resolve.

export type Criterion = { id: string; label: string };
export type ScoreRow = {
  teamId: string;
  judgeId: string;
  notes: string;
  items: { criterionId: string; value: number }[];
};

export type Ranked = {
  teamId: string;
  /** 1-based; teams with the same mean share a rank. */
  rank: number;
  tied: boolean;
  mean: number | null;
  /** How many complete scores the mean is based on. */
  n: number;
  /** Mean of each score's z-score within its judge; null when unknown. */
  normalised: number | null;
  notes: { judgeId: string; text: string }[];
};

const complete = (s: ScoreRow, criteria: Criterion[]) =>
  criteria.length > 0 &&
  criteria.every((c) => s.items.some((i) => i.criterionId === c.id));
const total = (s: ScoreRow) => s.items.reduce((n, i) => n + i.value, 0);
const round = (x: number) => Math.round(x * 100) / 100;

export function rank(
  teamIds: string[],
  scores: ScoreRow[],
  criteria: Criterion[],
): Ranked[] {
  const done = scores.filter((s) => complete(s, criteria));
  // Each judge's own spread, for the normalised column.
  const byJudge = new Map<string, number[]>();
  for (const s of done)
    byJudge.set(s.judgeId, [...(byJudge.get(s.judgeId) ?? []), total(s)]);
  const stats = new Map(
    [...byJudge].map(([j, xs]) => {
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      const sd = Math.sqrt(
        xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length,
      );
      return [j, { m, sd }];
    }),
  );
  const rows = teamIds.map((teamId) => {
    const mine = done.filter((s) => s.teamId === teamId);
    const mean = mine.length
      ? round(mine.reduce((n, s) => n + total(s), 0) / mine.length)
      : null;
    const zs = mine
      .map((s) => {
        const st = stats.get(s.judgeId)!;
        return st.sd > 0 ? (total(s) - st.m) / st.sd : null;
      })
      .filter((z): z is number => z !== null);
    return {
      teamId,
      mean,
      n: mine.length,
      normalised: zs.length
        ? round(zs.reduce((a, b) => a + b, 0) / zs.length)
        : null,
      notes: scores
        .filter((s) => s.teamId === teamId && s.notes.trim())
        .map((s) => ({ judgeId: s.judgeId, text: s.notes.trim() })),
    };
  });
  rows.sort((a, b) => (b.mean ?? -1) - (a.mean ?? -1));
  return rows.map((r) => {
    const firstSame = rows.findIndex((x) => x.mean === r.mean);
    const same = rows.filter((x) => x.mean === r.mean).length;
    return {
      ...r,
      rank: r.mean === null ? rows.length : firstSame + 1,
      tied: r.mean !== null && same > 1,
    };
  });
}

/** CSV rows: one per team per judge per criterion, with the judge's total and notes. */
export function exportRows(
  scores: ScoreRow[],
  criteria: Criterion[],
  name: { team: (id: string) => string; judge: (id: string) => string },
): string[][] {
  const header = [
    "Team",
    "Judge",
    "Criterion",
    "Value",
    "Judge's total",
    "Complete",
    "Notes",
  ];
  const out: string[][] = [header];
  const sorted = [...scores].sort(
    (a, b) =>
      name.team(a.teamId).localeCompare(name.team(b.teamId)) ||
      name.judge(a.judgeId).localeCompare(name.judge(b.judgeId)),
  );
  for (const s of sorted)
    for (const c of criteria) {
      const v = s.items.find((i) => i.criterionId === c.id)?.value;
      out.push([
        name.team(s.teamId),
        name.judge(s.judgeId),
        c.label,
        v === undefined ? "" : String(v),
        String(total(s)),
        complete(s, criteria) ? "yes" : "no",
        s.notes,
      ]);
    }
  return out;
}
