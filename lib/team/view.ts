// The team page's logic, pure so it is tested directly: what state a team
// is in at a given moment, and how times read on a phone. No React, no I/O.

export type TeamSlot = {
  index: number;
  startsAt: string;
  endsAt: string;
  station: string;
  location: string | null;
};

export type Announcement = {
  body: string;
  level: "info" | "warning" | "critical";
  createdAt: string;
};

export type TeamView =
  | { found: false }
  | {
      found: true;
      team: { name: string; tracks: string[] };
      event: {
        name: string;
        slug: string;
        timezone: string;
        /** The authoritative judging start (event setting), not a draft's. */
        judgingStartsAt: string | null;
        helpLocation: string | null;
      };
      published: { version: number; publishedAt: string | null } | null;
      slots: TeamSlot[];
      announcements: Announcement[];
    };

/** The JSON from the team_view() RPC (snake_case) -> TeamView. */
export function fromRpc(raw: unknown): TeamView {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.found !== true) return { found: false };
  const team = r.team as { name: string; tracks: string[] | null };
  const event = r.event as {
    name: string;
    slug: string;
    timezone: string;
    judging_starts_at?: string | null;
    help_location?: string | null;
  };
  const pub = r.published as {
    version: number;
    published_at: string | null;
  } | null;
  const slots = (r.slots as Record<string, unknown>[] | null) ?? [];
  const announcements =
    (r.announcements as Record<string, unknown>[] | null) ?? [];
  return {
    found: true,
    team: { name: team.name, tracks: team.tracks ?? [] },
    event: {
      name: event.name,
      slug: event.slug,
      timezone: event.timezone,
      judgingStartsAt: event.judging_starts_at ?? null,
      helpLocation: event.help_location ?? null,
    },
    published: pub
      ? { version: pub.version, publishedAt: pub.published_at }
      : null,
    slots: slots.map((s) => ({
      index: s.index as number,
      startsAt: s.starts_at as string,
      endsAt: s.ends_at as string,
      station: s.station as string,
      location: (s.location as string | null) ?? null,
    })),
    announcements: announcements.map((a) => ({
      body: a.body as string,
      level: a.level as Announcement["level"],
      createdAt: a.created_at as string,
    })),
  };
}

/** What the big text says right now. */
export type Hero =
  | { kind: "not-found" }
  | { kind: "unpublished"; judgingStartsAt: string | null }
  | { kind: "not-scheduled"; version: number }
  | {
      kind: "upcoming";
      slot: TeamSlot;
      minutes: number;
      which: "first" | "second";
    }
  | {
      kind: "now";
      slot: TeamSlot;
      minutesLeft: number;
      which: "first" | "second";
    }
  | { kind: "done" };

/** Minutes to show before a slot within which the page says "head there now". */
export const HEAD_THERE_MINUTES = 5;

export function heroFor(view: TeamView, now: number): Hero {
  if (!view.found) return { kind: "not-found" };
  if (!view.published)
    return { kind: "unpublished", judgingStartsAt: view.event.judgingStartsAt };
  if (view.slots.length === 0)
    return { kind: "not-scheduled", version: view.published.version };
  const slots = [...view.slots].sort(
    (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
  );
  for (const [i, slot] of slots.entries()) {
    const which = i === 0 ? "first" : "second";
    const start = Date.parse(slot.startsAt);
    const end = Date.parse(slot.endsAt);
    if (now < start)
      return {
        kind: "upcoming",
        slot,
        minutes: Math.ceil((start - now) / 60_000),
        which,
      };
    if (now < end)
      return {
        kind: "now",
        slot,
        minutesLeft: Math.ceil((end - now) / 60_000),
        which,
      };
  }
  return { kind: "done" };
}

/** Further out than this, the hero shows the day and time instead of a countdown. */
export const COUNTDOWN_HORIZON_MINUTES = 12 * 60;

/** "less than a minute", "1 minute", "23 minutes", "1 hour 5 minutes", "3 hours", "2 days". */
export function formatWait(minutes: number): string {
  if (minutes <= 0) return "less than a minute";
  if (minutes >= 24 * 60) {
    const d = Math.round(minutes / (24 * 60));
    return `${d} day${d === 1 ? "" : "s"}`;
  }
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = `${h} hour${h === 1 ? "" : "s"}`;
  return m ? `${hours} ${m} minute${m === 1 ? "" : "s"}` : hours;
}

/**
 * "10:42 AM PST": always in the EVENT's zone and labelled, because phones
 * have odd time-zone settings and an unlabelled time is a bug report.
 */
export function clockWithZone(
  instant: string | number | Date,
  timeZone: string,
): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(instant));
}

/** "10:42–10:49 AM PST" for a slot. */
export function slotRange(
  slot: Pick<TeamSlot, "startsAt" | "endsAt">,
  timeZone: string,
): string {
  const start = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(slot.startsAt));
  return `${start.replace(/\s?[AP]M$/, "")}–${clockWithZone(slot.endsAt, timeZone)}`;
}

/** "Sunday, November 8" in the event's zone. */
export function dayLabel(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(instant));
}

/**
 * Join codes as people type them -> ABCD-1234, or null if it can't be one.
 * Case, spaces and the dash are all optional.
 */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.toUpperCase().replace(/[\s-]/g, "");
  return /^[A-Z0-9]{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4)}` : null;
}

/** "just now", "1 minute ago", "12 minutes ago", "2 hours ago". */
export function ago(fetchedAt: number, now: number): string {
  const m = Math.floor((now - fetchedAt) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  return `${h} hour${h === 1 ? "" : "s"} ago`;
}
