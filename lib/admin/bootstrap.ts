// The event bootstrap's inputs: read from --flags or EVENT_* env vars,
// validated, and turned into the events row to insert. Pure, so it is tested
// directly; scripts/bootstrap-event.mts does the I/O.
//
// Imports are relative with .ts extensions (no "@/" alias) so the script and
// node --test can run it directly.

import { zonedLocalToUtc } from "./time.ts";

export type EventBootstrap = {
  slug: string;
  name: string;
  year: number;
  timezone: string;
  slot_minutes: number;
  /** ISO instant (UTC). */
  judging_starts_at: string;
  help_location: string;
};

/** flag name -> env var. Every value can come from either; a flag wins. */
export const FIELDS = {
  slug: "EVENT_SLUG",
  name: "EVENT_NAME",
  year: "EVENT_YEAR",
  timezone: "EVENT_TIMEZONE",
  "slot-minutes": "EVENT_SLOT_MINUTES",
  "judging-start": "EVENT_JUDGING_START",
  "help-location": "EVENT_HELP_LOCATION",
} as const;
type Field = keyof typeof FIELDS;

export const DEFAULT_TIMEZONE = "America/Los_Angeles";
export const DEFAULT_SLOT_MINUTES = 7;

export type ParsedArgs = {
  values: Partial<Record<Field, string>>;
  confirm: boolean;
  dryRun: boolean;
  projectRef: string | null;
  unknown: string[];
};

/** `--name value` and `--name=value`; --confirm and --dry-run are switches. */
export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    values: {},
    confirm: false,
    dryRun: false,
    projectRef: null,
    unknown: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--confirm") out.confirm = true;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      if (value === undefined || value.startsWith("--")) {
        out.unknown.push(`${arg} needs a value`);
        if (value !== undefined) i--;
      } else if (name === "project-ref") out.projectRef = value;
      else if (name in FIELDS) out.values[name as Field] = value;
      else out.unknown.push(`unknown option --${name}`);
    } else out.unknown.push(`unexpected argument "${arg}"`);
  }
  return out;
}

/**
 * Flags over env vars, validated. Returns the row, or every problem at once
 * so one run shows everything to fix.
 */
export function buildEvent(
  values: Partial<Record<Field, string>>,
  env: Record<string, string | undefined>,
): { event: EventBootstrap } | { errors: string[] } {
  const get = (f: Field) =>
    (values[f] ?? env[FIELDS[f]] ?? "").trim().replace(/\s+/g, " ");
  const errors: string[] = [];
  const need = (f: Field) => {
    const v = get(f);
    if (!v) errors.push(`--${f} (or ${FIELDS[f]}) is required`);
    return v;
  };

  const slug = need("slug");
  if (slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug))
    errors.push(
      `slug "${slug}" must be lowercase letters, digits and single dashes, e.g. aws-a10-2026`,
    );

  const name = need("name");

  const yearRaw = need("year");
  const year = Number(yearRaw);
  if (yearRaw && (!Number.isInteger(year) || year < 2000 || year > 2100))
    errors.push(`year "${yearRaw}" must be a four-digit year`);

  const timezone = get("timezone") || DEFAULT_TIMEZONE;
  let zoneOk = true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    zoneOk = false;
    errors.push(
      `timezone "${timezone}" isn't an IANA zone, e.g. America/Los_Angeles`,
    );
  }

  const slotRaw = get("slot-minutes");
  const slot_minutes = slotRaw ? Number(slotRaw) : DEFAULT_SLOT_MINUTES;
  if (!Number.isInteger(slot_minutes) || slot_minutes < 1 || slot_minutes > 60)
    errors.push(`slot length "${slotRaw}" must be 1-60 minutes`);

  // Wall-clock time in the event's zone ("2026-11-08T10:00"), the way an
  // organizer thinks of it; an explicit offset or Z is also accepted.
  const startRaw = need("judging-start");
  let judging_starts_at = "";
  if (startRaw) {
    const withZone = /(Z|[+-]\d{2}:?\d{2})$/.test(startRaw);
    try {
      const d = withZone
        ? new Date(startRaw)
        : zoneOk
          ? zonedLocalToUtc(startRaw.replace(" ", "T"), timezone)
          : new Date(NaN);
      if (Number.isNaN(d.getTime())) throw new Error("bad");
      judging_starts_at = d.toISOString();
    } catch {
      if (zoneOk)
        errors.push(
          `judging start "${startRaw}" must look like 2026-11-08T10:00 (in ${timezone})`,
        );
    }
    if (
      judging_starts_at &&
      Number.isInteger(year) &&
      Number(
        new Intl.DateTimeFormat("en-US", {
          timeZone: zoneOk ? timezone : "UTC",
          year: "numeric",
        }).format(new Date(judging_starts_at)),
      ) !== year
    )
      errors.push(`judging start ${startRaw} isn't in ${year}`);
  }

  const help_location = need("help-location");
  if (help_location.length > 200)
    errors.push("help location must be 200 characters or fewer");

  if (errors.length) return { errors };
  return {
    event: {
      slug,
      name,
      year,
      timezone,
      slot_minutes,
      judging_starts_at,
      help_location,
    },
  };
}

/** Local Supabase (the CLI's stack); anything else needs --confirm. */
export function isLocalUrl(url: string): boolean {
  const host = new URL(url).hostname;
  return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host);
}
