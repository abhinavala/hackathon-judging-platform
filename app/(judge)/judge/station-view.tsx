"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { stationRows, type StationTeam } from "@/lib/judge/station";
import { slotRange } from "@/lib/team/view";
import { minSec, phaseAt } from "@/lib/event/phases";

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

/**
 * Where this station is within the current slot, to the second: presenting,
 * questions, or switching over. Its own one-second clock, separate from the
 * 15 s re-mark and the 30 s refresh above, which it doesn't touch; it reads
 * the same teams and corrects for the phone's clock the same way.
 */
function PhaseLine({
  teams,
  serverNow,
}: {
  teams: StationTeam[];
  serverNow: number;
}) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const offset = serverNow - Date.now();
    const tick = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(tick);
  }, [serverNow]);
  const sorted = [...teams].sort(
    (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
  );
  const i = sorted.findIndex(
    (t) => now >= Date.parse(t.startsAt) && now < Date.parse(t.endsAt),
  );
  const upcoming = sorted.find((t) => Date.parse(t.startsAt) > now);
  if (i < 0) {
    // Judging hasn't reached this station yet, or an empty seat this slot.
    if (!upcoming || Date.parse(upcoming.startsAt) - now > 30 * 60_000)
      return null;
    return (
      <p
        className="mt-3 rounded-lg bg-gray-100 px-3 py-2 text-lg font-bold tabular-nums text-gray-900"
        suppressHydrationWarning
      >
        Next team in {minSec((Date.parse(upcoming.startsAt) - now) / 1000)}
      </p>
    );
  }
  const phase = phaseAt(
    sorted[i].startsAt,
    sorted[i].endsAt,
    now,
    i + 1 < sorted.length,
  );
  if (!phase) return null;
  return (
    <p
      role="status"
      className={`mt-3 rounded-lg px-3 py-2 text-xl font-extrabold tabular-nums ${
        phase.kind === "switch"
          ? "bg-amber-400 text-black"
          : "bg-green-700 text-white"
      }`}
      suppressHydrationWarning
    >
      {phase.text}
    </p>
  );
}
