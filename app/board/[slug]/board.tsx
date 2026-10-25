"use client";

import { useCallback, useEffect, useState } from "react";
import { boardMoment, type BoardRow, type BoardView } from "@/lib/board/view";
import { HELP_FALLBACK, helpPlace } from "@/lib/event/copy";
import {
  ago,
  clockWithZone,
  COUNTDOWN_HORIZON_MINUTES,
  dayLabel,
  formatWait,
  slotRange,
} from "@/lib/team/view";

const REFRESH_MS = 20_000;
/** Older than this and the board says, prominently, how old its data is. */
const STALE_MS = 60_000;

type Loaded = { view: BoardView; fetchedAt: number };

/**
 * The big screen. Leads with the slot that is on now, large enough to read
 * from the back of the room, and a smaller row for the slot after it. The
 * full station x time grid is the printed schedule's job, not this one's.
 * Polls every 20 s, moves between slots on its own clock (corrected to the
 * server's), and says how old its data is if the server stops answering.
 */
export function BoardClient({
  slug,
  host,
  initial,
  fetchedAt: initialFetchedAt,
}: {
  slug: string;
  host: string;
  initial: BoardView | null;
  fetchedAt: number | null;
}) {
  const [data, setData] = useState<Loaded | null>(
    initial && initialFetchedAt !== null
      ? { view: initial, fetchedAt: initialFetchedAt }
      : null,
  );
  const [offset, setOffset] = useState(0); // server clock minus this laptop's
  const [now, setNow] = useState(initialFetchedAt ?? 0);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/board/${encodeURIComponent(slug)}/data`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { view: BoardView; serverNow: number };
      setOffset(body.serverNow - Date.now());
      setData({ view: body.view, fetchedAt: body.serverNow });
    } catch {
      // Keep showing the last good data; the stale banner says how old.
    }
  }, [slug]);

  useEffect(() => {
    const poll = setInterval(refresh, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [refresh]);

  const serverNow = now + offset;

  if (!data) {
    return (
      <Screen>
        <Centered>
          <p className="text-[length:calc(var(--u)*4)] font-bold">
            Can&apos;t load the schedule right now.
          </p>
          <p className="mt-[calc(var(--u)*1)] text-[length:calc(var(--u)*2)]">
            Retrying every 20 seconds. Teams: find an organizer at{" "}
            {HELP_FALLBACK}.
          </p>
        </Centered>
      </Screen>
    );
  }

  const { view, fetchedAt } = data;
  const stale = serverNow - fetchedAt > STALE_MS;
  const moment = boardMoment(view, serverNow);
  const tz = view.found ? view.event.timezone : "America/Los_Angeles";
  const help = helpPlace(view.found ? view.event.helpLocation : null);

  return (
    <Screen>
      <header className="flex items-baseline justify-between gap-[calc(var(--u)*2)] px-[calc(var(--u)*2.5)] pt-[calc(var(--u)*1.5)]">
        <p className="text-[length:calc(var(--u)*1.8)] font-semibold text-slate-300">
          {view.found ? view.event.name : "Judging"} · Judging schedule
        </p>
        <p
          className="text-[length:calc(var(--u)*2.4)] font-bold tabular-nums"
          suppressHydrationWarning
        >
          {clockWithZone(serverNow, tz)}
        </p>
      </header>

      <div className="space-y-[calc(var(--u)*0.6)] px-[calc(var(--u)*2.5)] pt-[calc(var(--u)*1)]">
        {stale && (
          <p
            role="alert"
            className="rounded-[calc(var(--u)*0.5)] bg-amber-400 px-[calc(var(--u)*1.2)] py-[calc(var(--u)*0.6)] text-[length:calc(var(--u)*1.6)] font-bold text-black"
            suppressHydrationWarning
          >
            Last updated {ago(fetchedAt, serverNow)}: the board can&apos;t reach
            the server. Times shown may be out of date.
          </p>
        )}
        {view.found &&
          view.announcements.map((a) => (
            <p
              key={a.createdAt + a.body}
              role={a.level === "info" ? "status" : "alert"}
              className={`rounded-[calc(var(--u)*0.5)] px-[calc(var(--u)*1.2)] py-[calc(var(--u)*0.6)] text-[length:calc(var(--u)*1.8)] font-semibold ${
                a.level === "critical"
                  ? "bg-red-600 text-white"
                  : a.level === "warning"
                    ? "bg-amber-400 text-black"
                    : "bg-sky-800 text-white"
              }`}
            >
              {a.body}
            </p>
          ))}
      </div>

      <main className="flex min-h-0 flex-1 flex-col px-[calc(var(--u)*2.5)] py-[calc(var(--u)*1.2)]">
        {moment.kind === "not-found" && (
          <Centered>
            <p className="text-[length:calc(var(--u)*4)] font-bold">
              No event called &ldquo;{slug}&rdquo;.
            </p>
            <p className="mt-[calc(var(--u)*1)] text-[length:calc(var(--u)*2)] text-slate-300">
              Check the address on this screen.
            </p>
          </Centered>
        )}

        {moment.kind === "unpublished" && (
          <Centered>
            <p className="text-[length:calc(var(--u)*4.5)] leading-tight font-extrabold">
              The judging schedule isn&apos;t published yet.
            </p>
            {moment.judgingStartsAt && (
              <p className="mt-[calc(var(--u)*1.5)] text-[length:calc(var(--u)*3)]">
                Judging starts at{" "}
                <strong>{clockWithZone(moment.judgingStartsAt, tz)}</strong> on{" "}
                {dayLabel(moment.judgingStartsAt, tz)}.
              </p>
            )}
            <p className="mt-[calc(var(--u)*1)] text-[length:calc(var(--u)*2)] text-slate-300">
              This screen updates by itself when it is.
            </p>
          </Centered>
        )}

        {moment.kind === "empty" && (
          <Centered>
            <p className="text-[length:calc(var(--u)*4)] font-bold">
              No presentations are scheduled.
            </p>
          </Centered>
        )}

        {moment.kind === "done" && (
          <Centered>
            <p className="text-[length:calc(var(--u)*5)] font-extrabold">
              Judging is complete.
            </p>
            <p className="mt-[calc(var(--u)*1)] text-[length:calc(var(--u)*2.4)] text-slate-300">
              Thank you, teams and judges! Watch for announcements about
              results.
            </p>
          </Centered>
        )}

        {moment.kind === "now" && (
          <>
            <SlotHeading
              label="Now"
              range={slotRange(moment.row.slot, tz)}
              note={`${formatWait(moment.minutesLeft)} left`}
              live
            />
            <BigRow row={moment.row} />
            {moment.next && <NextRow label="Next" row={moment.next} tz={tz} />}
          </>
        )}

        {moment.kind === "upcoming" && (
          <>
            <SlotHeading
              label={moment.first ? "First up" : "Next up"}
              range={slotRange(moment.row.slot, tz)}
              note={
                moment.minutes > COUNTDOWN_HORIZON_MINUTES
                  ? dayLabel(moment.row.slot.startsAt, tz)
                  : `starts in ${formatWait(moment.minutes)}`
              }
            />
            <BigRow row={moment.row} />
            {moment.after && (
              <NextRow label="After that" row={moment.after} tz={tz} />
            )}
          </>
        )}
      </main>

      <footer className="flex flex-wrap justify-between gap-x-[calc(var(--u)*2)] border-t border-slate-700 px-[calc(var(--u)*2.5)] py-[calc(var(--u)*1)] text-[length:calc(var(--u)*1.5)] text-slate-300">
        <p>
          Your team&apos;s own times: <strong>{host}/t</strong> with your join
          code
        </p>
        <p>
          Not on the board? Find an organizer at{" "}
          <strong className="text-white">{help}</strong>.
        </p>
        {view.found && view.published && (
          <p>
            Schedule v{view.published.version} · times {tzName(serverNow, tz)}
          </p>
        )}
      </footer>
    </Screen>
  );
}

function tzName(now: number, tz: string) {
  return clockWithZone(now, tz).split(" ").pop();
}

function SlotHeading({
  label,
  range,
  note,
  live = false,
}: {
  label: string;
  range: string;
  note: string;
  live?: boolean;
}) {
  return (
    <div className="mb-[calc(var(--u)*1.2)] flex flex-wrap items-baseline gap-x-[calc(var(--u)*2)]">
      <span
        className={`rounded-[calc(var(--u)*0.6)] px-[calc(var(--u)*1.2)] text-[length:calc(var(--u)*4.2)] font-black tracking-wide uppercase ${
          live ? "bg-green-500 text-black" : "bg-white text-slate-950"
        }`}
      >
        {label}
      </span>
      <span className="text-[length:calc(var(--u)*5.5)] leading-none font-extrabold tabular-nums">
        {range}
      </span>
      <span
        className="text-[length:calc(var(--u)*2.6)] font-semibold text-slate-300"
        suppressHydrationWarning
      >
        {note}
      </span>
    </div>
  );
}

/** Station cards for the slot that matters now, readable from the back. */
function BigRow({ row }: { row: BoardRow }) {
  return (
    <ul
      className="grid min-h-0 flex-1 gap-[calc(var(--u)*1)]"
      style={{
        gridTemplateColumns: `repeat(${columns(row.cells.length)}, minmax(0, 1fr))`,
      }}
    >
      {row.cells.map((c) => (
        <li
          key={c.station}
          className={`flex min-h-0 flex-col justify-center overflow-hidden rounded-[calc(var(--u)*0.8)] px-[calc(var(--u)*1.2)] py-[calc(var(--u)*1)] ${
            c.team ? "bg-slate-800" : "bg-slate-900 text-slate-500"
          }`}
        >
          <p className="text-[length:calc(var(--u)*1.7)] font-bold tracking-wide text-sky-300 uppercase">
            {c.station}
          </p>
          <p className="text-[length:calc(var(--u)*2.9)] leading-tight font-extrabold break-words">
            {c.team ?? "—"}
          </p>
          {c.location && (
            <p className="mt-[calc(var(--u)*0.3)] text-[length:calc(var(--u)*1.3)] text-slate-300">
              {c.location}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The slot after: smaller, one line per station. */
function NextRow({
  label,
  row,
  tz,
}: {
  label: string;
  row: BoardRow;
  tz: string;
}) {
  return (
    <section className="mt-[calc(var(--u)*1.4)]">
      <h2 className="mb-[calc(var(--u)*0.6)] text-[length:calc(var(--u)*2.2)] font-bold">
        <span className="uppercase">{label}</span>{" "}
        <span className="tabular-nums">{slotRange(row.slot, tz)}</span>
      </h2>
      <ul
        className="grid gap-x-[calc(var(--u)*1.5)] gap-y-[calc(var(--u)*0.3)] text-[length:calc(var(--u)*1.6)]"
        style={{
          gridTemplateColumns: `repeat(${columns(row.cells.length)}, minmax(0, 1fr))`,
        }}
      >
        {row.cells.map((c) => (
          <li key={c.station} className="truncate">
            <span className="text-sky-300">{c.station}</span>{" "}
            <span className="font-semibold">{c.team ?? "—"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 8 stations -> 4 x 2; 10 -> 5 x 2; 12 -> 6 x 2. */
function columns(n: number) {
  if (n <= 4) return Math.max(n, 1);
  if (n <= 8) return 4;
  if (n <= 10) return 5;
  return 6;
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex h-screen flex-col overflow-hidden bg-slate-950 text-white"
      // One unit for every size on the board: 1% of the width, unless the
      // screen is short for its width (a browser window, a wide projector),
      // when height decides. Everything fits above the fold at any aspect,
      // with room for team names that wrap to two lines.
      style={{ "--u": "min(1vw, 1.5vh)" } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-[calc(var(--u)*4)] text-center">
      {children}
    </div>
  );
}
