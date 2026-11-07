"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { stationRows, type StationTeam } from "@/lib/judge/station";
import { slotRange } from "@/lib/team/view";
import { PhaseLine } from "./phase-line";

const TICK_MS = 15_000;
const REFRESH_MS = 30_000;

export type JudgeStation = {
  label: string;
  location: string | null;
  teams: StationTeam[];
};

/**
 * The judge's station, teams in time order, the current one highlighted.
 * Re-marks every 15 s against the server's clock (phones drift), and asks the
 * server again every 30 s so a published late change shows up.
 */
export function StationView({
  stations,
  timeZone,
  version,
  serverNow,
}: {
  stations: JudgeStation[];
  timeZone: string;
  version: number;
  serverNow: number;
}) {
  const router = useRouter();
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const offset = serverNow - Date.now();
    const tick = setInterval(() => setNow(Date.now() + offset), TICK_MS);
    return () => clearInterval(tick);
  }, [serverNow]);
  useEffect(() => {
    const refresh = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(refresh);
  }, [router]);

  return (
    <>
      {stations.map((s) => (
        <section key={s.label} className="mb-8">
          <h1 className="text-3xl font-extrabold">{s.label}</h1>
          {s.location && <p className="text-xl font-semibold">{s.location}</p>}
          <ScoredCount teams={s.teams} />
          <PhaseLine teams={s.teams} serverNow={serverNow} />
          <ol className="mt-4 space-y-2">
            {stationRows(s.teams, now).map((r) => (
              <li
                key={r.startsAt}
                className={
                  r.state === "now"
                    ? "rounded-lg border-4 border-green-700 p-3 text-xl"
                    : r.state === "next"
                      ? "rounded-lg border-2 border-black p-3 text-lg"
                      : r.state === "done"
                        ? "px-3 py-1 text-gray-500"
                        : "px-3 py-1"
                }
              >
                {r.state === "now" && (
                  <span className="mr-2 rounded bg-green-700 px-2 py-0.5 text-sm font-bold text-white">
                    NOW
                  </span>
                )}
                {r.state === "next" && (
                  <span className="mr-2 rounded bg-black px-2 py-0.5 text-sm font-bold text-white">
                    NEXT
                  </span>
                )}
                <span className="tabular-nums">{slotRange(r, timeZone)}</span>{" "}
                {r.assignmentId ? (
                  <Link
                    href={`/judge/score/${r.assignmentId}`}
                    className={`underline ${r.state === "done" ? "" : "font-bold"}`}
                  >
                    {r.team}
                  </Link>
                ) : (
                  <span className={r.state === "done" ? "" : "font-bold"}>
                    {r.team}
                  </span>
                )}
                {r.scored === "complete" && (
                  <span className="ml-2 font-semibold text-green-800">
                    ✓ scored
                  </span>
                )}
                {r.scored === "partial" && (
                  <span className="ml-2 font-semibold text-amber-800">
                    partly scored
                  </span>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
      <p className="text-sm text-gray-600">
        Tap a team to score it. Published schedule v{version}. This page keeps
        itself up to date.
      </p>
    </>
  );
}

/** "2 of 15 scored": a judge's own progress, so a skipped team stands out. */
function ScoredCount({ teams }: { teams: StationTeam[] }) {
  const done = teams.filter((t) => t.scored === "complete").length;
  const partly = teams.filter((t) => t.scored === "partial").length;
  return (
    <p className="text-base font-semibold" data-testid="scored-count">
      {done} of {teams.length} scored
      {partly ? ` · ${partly} partly` : ""}
    </p>
  );
}
