"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import {
  ago,
  clockWithZone,
  COUNTDOWN_HORIZON_MINUTES,
  dayLabel,
  formatWait,
  HEAD_THERE_MINUTES,
  heroFor,
  slotRange,
  type TeamSlot,
  type TeamView,
} from "@/lib/team/view";
import { HELP_FALLBACK, helpPlace } from "@/lib/event/copy";

const REFRESH_MS = 25_000;
/** Older than this and the page says, prominently, how old its data is. */
const STALE_MS = 60_000;

type Saved = { view: TeamView; fetchedAt: number };

const storageKey = (code: string) => `team-view:${code}`;

function save(code: string, s: Saved) {
  try {
    localStorage.setItem(storageKey(code), JSON.stringify(s));
  } catch {
    // Private mode or full storage: the page still works, just without the
    // offline copy.
  }
}

// The copy saved on this phone is an external store: nothing on the server,
// the saved JSON in the browser (so hydration matches, then it appears).
const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};

/**
 * The team page. Server-rendered with fresh data; then refreshes every 25 s
 * (and when the phone wakes), keeps the last good copy on the phone, and
 * says how old it is when the server can't be reached. Never shows old
 * times as if they were current, and never renders blank.
 */
export function TeamViewClient({
  code,
  initial,
  fetchedAt: initialFetchedAt,
}: {
  code: string;
  initial: TeamView | null;
  fetchedAt: number | null;
}) {
  const [live, setLive] = useState<Saved | null>(
    initial && initialFetchedAt !== null
      ? { view: initial, fetchedAt: initialFetchedAt }
      : null,
  );
  const [offset, setOffset] = useState(0); // server clock minus this phone's
  const [now, setNow] = useState(initialFetchedAt ?? 0);
  const [failing, setFailing] = useState(initial === null);

  const savedRaw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(storageKey(code));
      } catch {
        return null;
      }
    },
    () => null,
  );
  const saved = useMemo<Saved | null>(() => {
    try {
      return savedRaw ? (JSON.parse(savedRaw) as Saved) : null;
    } catch {
      return null;
    }
  }, [savedRaw]);
  const data = live ?? saved;

  useEffect(() => {
    if (live) save(code, live);
  }, [code, live]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/t/${code}/data`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { view: TeamView; serverNow: number };
      setOffset(body.serverNow - Date.now());
      setLive({ view: body.view, fetchedAt: body.serverNow });
      setFailing(false);
    } catch {
      setFailing(true);
    }
  }, [code]);

  useEffect(() => {
    const poll = setInterval(refresh, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const wake = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [refresh]);

  const serverNow = now + offset;

  if (!data) {
    return (
      <Shell>
        <p className="text-3xl font-bold">
          We can&apos;t load your schedule right now.
        </p>
        <p className="mt-3 text-lg">
          {failing
            ? "We can't reach the server, and there's no saved copy on this phone yet. "
            : ""}
          Try again in a moment, or find an organizer at {HELP_FALLBACK}.
        </p>
        <RetryButton onClick={refresh} />
      </Shell>
    );
  }

  const { view, fetchedAt } = data;
  const stale = serverNow - fetchedAt > STALE_MS;
  const hero = heroFor(view, serverNow);
  const tz = view.found ? view.event.timezone : "America/Los_Angeles";
  const help = helpPlace(view.found ? view.event.helpLocation : null);

  return (
    <Shell>
      {stale && (
        <div
          role="alert"
          className="mb-4 rounded border-2 border-amber-500 bg-amber-50 p-3 text-amber-950"
        >
          <p className="font-bold">Last updated {ago(fetchedAt, serverNow)}.</p>
          <p>
            We can&apos;t reach the server right now, so these times are from
            then. If anything changed since, this page doesn&apos;t know yet.
          </p>
        </div>
      )}
      {view.found &&
        view.announcements.map((a) => (
          <p
            key={a.createdAt + a.body}
            role={a.level === "info" ? "status" : "alert"}
            className={`mb-4 rounded p-3 text-lg font-medium ${
              a.level === "critical"
                ? "bg-red-700 text-white"
                : a.level === "warning"
                  ? "bg-amber-400 text-black"
                  : "bg-blue-100 text-blue-950"
            }`}
          >
            {a.body}
          </p>
        ))}

      <section aria-live="polite" className="mb-8">
        {hero.kind === "not-found" && (
          <>
            <p className="text-3xl font-bold">
              We don&apos;t recognise the code {code}.
            </p>
            <p className="mt-3 text-lg">
              Check it against your confirmation email, or ask an organizer at{" "}
              {help}.
            </p>
            <Link
              href="/t"
              className="mt-4 inline-block rounded border px-4 py-3 text-lg font-medium"
            >
              Type the code again
            </Link>
          </>
        )}

        {hero.kind === "unpublished" && (
          <>
            <p className="text-3xl leading-tight font-bold">
              The judging schedule isn&apos;t published yet.
            </p>
            <p className="mt-3 text-xl">
              {hero.judgingStartsAt
                ? `Judging starts at ${clockWithZone(hero.judgingStartsAt, tz)} on ${dayLabel(hero.judgingStartsAt, tz)}. Check back closer to then.`
                : "Check back closer to judging."}{" "}
              This page updates by itself.
            </p>
          </>
        )}

        {hero.kind === "not-scheduled" && (
          <>
            <p className="text-3xl leading-tight font-bold">
              Your team isn&apos;t in the judging schedule.
            </p>
            <p className="mt-3 text-xl">
              If you submitted your project, find an organizer at {help} now.
              They can add you.
            </p>
            <p className="mt-2 text-base">
              (Published schedule v{hero.version}.)
            </p>
          </>
        )}

        {hero.kind === "upcoming" &&
          hero.minutes > COUNTDOWN_HORIZON_MINUTES && (
            <>
              <p className="text-2xl">Your {hero.which} presentation is on</p>
              <p className="text-5xl leading-none font-extrabold">
                {dayLabel(hero.slot.startsAt, tz)}
              </p>
              <Where slot={hero.slot} />
              <p className="mt-2 text-xl">{slotRange(hero.slot, tz)}</p>
              <p className="mt-2 text-base" suppressHydrationWarning>
                That&apos;s in {formatWait(hero.minutes)}. On the day, this page
                counts down to the minute.
              </p>
            </>
          )}

        {hero.kind === "upcoming" &&
          hero.minutes <= COUNTDOWN_HORIZON_MINUTES && (
            <>
              <p className="text-2xl" suppressHydrationWarning>
                {hero.minutes <= HEAD_THERE_MINUTES
                  ? "Head there now. Your "
                  : "Your "}
                {hero.which} presentation is in
              </p>
              <p
                className="text-6xl leading-none font-extrabold"
                suppressHydrationWarning
              >
                {formatWait(hero.minutes)}
              </p>
              <Where slot={hero.slot} />
              <p className="mt-2 text-xl">{slotRange(hero.slot, tz)}</p>
            </>
          )}

        {hero.kind === "now" && (
          <>
            <p className="text-6xl leading-none font-extrabold text-green-700">
              You&apos;re on now
            </p>
            <Where slot={hero.slot} />
            <p className="mt-2 text-xl" suppressHydrationWarning>
              Until {clockWithZone(hero.slot.endsAt, tz)} (
              {formatWait(hero.minutesLeft)} left)
            </p>
          </>
        )}

        {hero.kind === "done" && (
          <>
            <p className="text-4xl leading-tight font-extrabold">
              You&apos;re done presenting.
            </p>
            <p className="mt-3 text-xl">
              Thanks! Watch for announcements about results.
            </p>
          </>
        )}
      </section>

      {view.found && view.slots.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 text-lg font-semibold">Your presentations</h2>
          <ol className="space-y-3">
            {[...view.slots]
              .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
              .map((s, i) => {
                const done = serverNow >= Date.parse(s.endsAt);
                return (
                  <li
                    key={s.index}
                    className={`rounded border p-3 ${done ? "opacity-60" : ""}`}
                    suppressHydrationWarning
                  >
                    <p className="font-semibold">
                      {i === 0 ? "First" : "Second"}: {slotRange(s, tz)}
                      {done ? " · done" : ""}
                    </p>
                    <p>
                      {s.station}
                      {s.location ? ` — ${s.location}` : ""}
                    </p>
                  </li>
                );
              })}
          </ol>
        </section>
      )}

      {view.found && (
        <footer className="space-y-1 text-sm">
          <p>
            <strong>{view.team.name}</strong> · {view.event.name}
            {view.team.tracks.length ? ` · ${view.team.tracks.join(", ")}` : ""}
          </p>
          {view.published && (
            <p>
              Schedule v{view.published.version}
              {view.published.publishedAt
                ? `, published ${clockWithZone(view.published.publishedAt, tz)}`
                : ""}
              . If someone shows you a different version, this one is current.
            </p>
          )}
          <p suppressHydrationWarning>
            Join code {code} · updated {ago(fetchedAt, serverNow)} · all times{" "}
            {clockWithZone(serverNow, tz).split(" ").pop()}
          </p>
        </footer>
      )}
    </Shell>
  );
}

/** Location outranks the station number: nobody has walked the room yet. */
function Where({ slot }: { slot: TeamSlot }) {
  return slot.location ? (
    <div className="mt-6">
      <p className="text-2xl font-semibold">{slot.station}</p>
      <p className="text-4xl leading-tight font-extrabold">{slot.location}</p>
    </div>
  ) : (
    <p className="mt-6 text-5xl font-extrabold">{slot.station}</p>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-lg p-5">{children}</main>;
}

function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-4 rounded border px-4 py-3 text-lg font-medium"
    >
      Try again
    </button>
  );
}
