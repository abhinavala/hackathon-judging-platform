"use client";

import { useEffect, useState } from "react";
import type { StationTeam } from "@/lib/judge/station";
import { minSec, phaseAt } from "@/lib/event/phases";

/**
 * Where this station is within the current slot, to the second, and whose
 * turn it is: "Presenting · VoteWise · 0:12 left". On the station page and
 * the score page. Its own one-second clock: it never touches the station
 * page's 15 s re-mark or 30 s refresh, and corrects for the phone's clock
 * the same way they do.
 */
export function PhaseLine({
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
        className="mt-3 rounded-lg bg-gray-100 px-3 py-2 text-lg font-bold text-gray-900 tabular-nums"
        data-testid="phase-line"
        suppressHydrationWarning
      >
        Next: {upcoming.team} in{" "}
        {minSec((Date.parse(upcoming.startsAt) - now) / 1000)}
      </p>
    );
  }
  const current = sorted[i];
  const next = sorted[i + 1] ?? null;
  const phase = phaseAt(current.startsAt, current.endsAt, now, next !== null);
  if (!phase) return null;
  const left = minSec(phase.secondsLeft);
  const text =
    phase.kind === "presenting"
      ? `Presenting · ${current.team} · ${left} left`
      : phase.kind === "questions"
        ? `Questions · ${current.team} · ${left} left`
        : next
          ? `Switch over · ${next.team} next · ${left}`
          : `Wrapping up · ${current.team} · ${left} left`;
  return (
    <p
      role="status"
      data-testid="phase-line"
      className={`mt-3 rounded-lg px-3 py-2 text-xl font-extrabold tabular-nums ${
        phase.kind === "switch"
          ? "bg-amber-400 text-black"
          : "bg-green-700 text-white"
      }`}
      suppressHydrationWarning
    >
      {text}
    </p>
  );
}
