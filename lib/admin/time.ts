// Wall-clock times in the event's time zone, without a date library.

/** Offset of `zone` from UTC at `instant`, in milliseconds (minute precision). */
function offsetMs(instant: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
  );
  return asUtc - Math.floor(instant.getTime() / 60_000) * 60_000;
}

/** "2026-11-08T10:00" read as a wall-clock time in `zone` -> the UTC instant. */
export function zonedLocalToUtc(local: string, zone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) throw new Error(`Expected YYYY-MM-DDTHH:MM, got "${local}"`);
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes settle the offset, including across a DST change.
  let guess = wall - offsetMs(new Date(wall), zone);
  guess = wall - offsetMs(new Date(guess), zone);
  return new Date(guess);
}

/** The UTC instant -> "2026-11-08T10:00" in `zone`, for a datetime-local input. */
export function utcToZonedLocal(instant: Date | string, zone: string): string {
  const t = new Date(instant);
  const shifted = new Date(t.getTime() + offsetMs(t, zone));
  return shifted.toISOString().slice(0, 16);
}

/** "10:07 AM" in `zone`. */
export function clock(instant: Date | string, zone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(instant));
}
