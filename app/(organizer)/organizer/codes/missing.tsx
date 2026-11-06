import type { MissingCodes, PoolSummary } from "@/lib/admin/codes";
import { table } from "../_ui/ui";

/** Same shape as the overview's "Check-in emails not sent" table. */
export function MissingCodesTable({
  missing,
  summary,
}: {
  missing: MissingCodes[];
  summary: PoolSummary;
}) {
  const why = (kind: "workshop" | "kiro") => {
    const k = summary[kind];
    if (k.imported === 0) return "none imported yet";
    if (k.free === 0) return "pool used up";
    return "free codes exist: press Assign missing codes";
  };
  return (
    <table className={table} data-testid="missing-codes">
      <thead>
        <tr>
          <th>Team</th>
          <th>Join code</th>
          <th>Missing</th>
          <th>Why</th>
        </tr>
      </thead>
      <tbody>
        {missing.map((m) => (
          <tr key={m.teamId}>
            <td>{m.teamName}</td>
            <td className="font-mono">{m.joinCode}</td>
            <td>
              {[
                m.workshop && "workshop code (whole team)",
                m.kiro.length > 0 && `Kiro for ${m.kiro.join(", ")}`,
              ]
                .filter(Boolean)
                .join("; ")}
            </td>
            <td>
              {[
                m.workshop && `workshop: ${why("workshop")}`,
                m.kiro.length > 0 && `Kiro: ${why("kiro")}`,
              ]
                .filter(Boolean)
                .join("; ")}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function PoolAlarms({ summary }: { summary: PoolSummary }) {
  if (!summary.alarms.length) return null;
  return (
    <div
      role="alert"
      className="mb-4 rounded border-2 border-red-600 bg-red-50 px-3 py-2 font-semibold text-red-900"
      data-testid="pool-alarms"
    >
      {summary.alarms.map((a) => (
        <p key={a}>{a}</p>
      ))}
    </div>
  );
}
