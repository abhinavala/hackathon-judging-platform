// npm run bootstrap:event -- --slug ... : creates the ONE events row a fresh
// database needs before the organizer screens work. Stations, judges, tracks
// and teams all have screens; this only creates the event.
//
// Every value is a flag or an env var (a flag wins):
//
//   --slug            EVENT_SLUG            aws-a10-2026 (the board's URL)
//   --name            EVENT_NAME            "AWS x A10 Hack"
//   --year            EVENT_YEAR            2026
//   --timezone        EVENT_TIMEZONE        default America/Los_Angeles
//   --slot-minutes    EVENT_SLOT_MINUTES    default 7
//   --judging-start   EVENT_JUDGING_START   2026-11-08T10:00, in the event's zone
//   --help-location   EVENT_HELP_LOCATION   "the check-in table by the main entrance"
//
// Target database:
//   default           NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//                     (.env.local, i.e. local Supabase)
//   --project-ref REF a hosted project: the URL is derived and the secret key
//                     is fetched from the Supabase CLI (you must be logged
//                     in to it), never printed or written anywhere
//
// Safety: refuses if an event with that slug already exists (it never
// updates; edit settings on /organizer/event), and refuses any non-local
// database without --confirm. --dry-run validates and checks the slug
// without writing.

import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";
import { buildEvent, isLocalUrl, parseArgs } from "../lib/admin/bootstrap.ts";

function fail(message: string): never {
  console.error(`bootstrap-event: ${message}`);
  process.exit(1);
}

/** The project's secret key, straight from the Supabase CLI. */
function hostedKey(ref: string): string {
  if (!/^[a-z0-9]{20}$/.test(ref))
    fail(`"${ref}" doesn't look like a project ref`);
  const res = spawnSync(
    "npx",
    [
      "supabase",
      "projects",
      "api-keys",
      "--project-ref",
      ref,
      "--reveal",
      "-o",
      "json",
    ],
    { encoding: "utf8" },
  );
  if (res.status !== 0)
    fail(
      `couldn't read the project's keys from the Supabase CLI (run "npx supabase login" first?)`,
    );
  const keys = JSON.parse(res.stdout) as {
    name: string;
    type: string;
    api_key: string;
  }[];
  // The secret key (the one Vercel holds); the CLI masks it without
  // --reveal, so a masked value is refused rather than sent. Falls back to
  // the legacy service_role key.
  const secret = keys.find((k) => k.type === "secret")?.api_key;
  const key =
    secret && /^[\x21-\x7e]+$/.test(secret)
      ? secret
      : keys.find((k) => k.name === "service_role")?.api_key;
  if (!key) fail("the project has no usable secret or service_role key");
  return key;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.unknown.length) fail(args.unknown.join("; "));
  const built = buildEvent(args.values, process.env);
  if ("errors" in built)
    fail(`fix these and run again:\n  - ${built.errors.join("\n  - ")}`);
  const { event } = built;

  const url = args.projectRef
    ? `https://${args.projectRef}.supabase.co`
    : process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url)
    fail(
      "no database: set NEXT_PUBLIC_SUPABASE_URL (.env.local) or pass --project-ref",
    );
  const local = isLocalUrl(url);
  const host = new URL(url).hostname;
  if (!local && !args.confirm)
    fail(
      `${host} is not a local database. Re-run with --confirm to create the event there.`,
    );
  const key = args.projectRef
    ? hostedKey(args.projectRef)
    : process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) fail("SUPABASE_SERVICE_ROLE_KEY is not set (.env.local)");

  const db = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: existing, error: lookupError } = await db
    .from("events")
    .select("id, name")
    .eq("slug", event.slug)
    .maybeSingle();
  if (lookupError)
    fail(`couldn't check for an existing event: ${lookupError.message}`);
  if (existing)
    fail(
      `an event with slug "${event.slug}" already exists ("${existing.name}"). Nothing changed. Edit its settings on /organizer/event.`,
    );

  const when = new Intl.DateTimeFormat("en-US", {
    timeZone: event.timezone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date(event.judging_starts_at));
  const summary = [
    `  database        ${host}${local ? " (local)" : ""}`,
    `  slug            ${event.slug}`,
    `  name            ${event.name}`,
    `  year            ${event.year}`,
    `  timezone        ${event.timezone}`,
    `  slot length     ${event.slot_minutes} minutes`,
    `  judging starts  ${when} (${event.judging_starts_at})`,
    `  help location   ${event.help_location}`,
  ].join("\n");

  if (args.dryRun) {
    console.log(`Dry run, nothing written. Would create:\n${summary}`);
    return;
  }
  const { error } = await db.from("events").insert(event);
  if (error)
    fail(
      error.code === "23505"
        ? `an event with slug "${event.slug}" was created meanwhile. Nothing changed.`
        : `insert failed: ${error.message}`,
    );
  console.log(`Created the event:\n${summary}`);
  console.log(
    "\nNext, on the organizer screens: Tracks, Stations (with locations), Judges, then Import teams.",
  );
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
