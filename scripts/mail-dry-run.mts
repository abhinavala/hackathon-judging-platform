// npm run mail:dry-run -- ... : the full-scale email rehearsal. Mints a real
// sign-in link for EVERY team member of an event on the Preview project,
// redirects each one to a test inbox (real recipient in the subject), and
// sends them all to the Apps Script relay as ONE batch, timing it. The point
// is two numbers: whether ~250 sends finish inside Apps Script's execution
// limit, and how much daily quota is left afterwards.
//
//   APPS_SCRIPT_URL=... APPS_SCRIPT_SECRET=... npm run mail:dry-run -- \
//     --project-ref <preview ref> \
//     --site-url https://<preview deployment>.vercel.app \
//     --inboxes a@x.com,b@y.com,c@z.com \
//     --confirm
//
// Options:
//   --ping          only check the relay (deployment, secret, version, quota);
//                   needs neither --project-ref nor --confirm
//   --event SLUG    default aws-a10-2026
//   --template T    default schedule (signin | invite | schedule | credentials)
//   --limit N       send to the first N members only
//   --inboxes       or AUTH_LINK_REDIRECT_TO
//
// Guards: refuses the PRODUCTION project ref (the links would sign people
// into real accounts), sends nothing without --confirm, and never prints a
// link (each one is a live sign-in for a Preview account). The secret key
// comes from the Supabase CLI and is never printed.

import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";
import { callbackLink } from "../lib/auth/link-url.ts";
import {
  callRelay,
  type LinkMessage,
  type LinkTemplate,
} from "../lib/auth/relay.ts";
import {
  parseInboxes,
  redirectMessage,
  redirectRefusal,
} from "../lib/auth/redirect.ts";

/** Apps Script stops a web-app execution at 6 minutes; wait a bit longer. */
const BATCH_TIMEOUT_MS = 7 * 60_000;
const MINT_CONCURRENCY = 8;
const TEMPLATES: LinkTemplate[] = [
  "signin",
  "invite",
  "schedule",
  "credentials",
];

function fail(message: string): never {
  console.error(`mail-dry-run: ${message}`);
  process.exit(1);
}

function flag(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const i = argv.findIndex(
    (a) => a === `--${name}` || a.startsWith(`--${name}=`),
  );
  if (i === -1) return undefined;
  const a = argv[i];
  return a.includes("=") ? a.slice(a.indexOf("=") + 1) : argv[i + 1];
}
const has = (name: string) => process.argv.slice(2).includes(`--${name}`);

function secretKey(ref: string): string {
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
      "couldn't read the project's keys (run \"npx supabase login\" first?)",
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

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

async function main() {
  const relayUrl = process.env.APPS_SCRIPT_URL;
  const relaySecret = process.env.APPS_SCRIPT_SECRET;
  if (!relayUrl || !relaySecret)
    fail("set APPS_SCRIPT_URL and APPS_SCRIPT_SECRET in the environment");

  const ping = async () => {
    const reply = await callRelay(
      relayUrl,
      relaySecret,
      { action: "ping" },
      30_000,
    );
    if (!reply.ok || !reply.pong)
      fail(`relay ping failed: ${JSON.stringify(reply)}`);
    return reply;
  };
  const before = await ping();
  console.log(
    `Relay OK: version ${before.relayVersion ?? "1 (no subject tags: redeploy Code.gs)"}, ${before.quotaRemaining} sends left today.`,
  );
  if (has("ping")) return;
  if (!before.relayVersion || before.relayVersion < 2)
    fail(
      "the deployed relay predates subject tags; redeploy apps-script/Code.gs first",
    );

  const ref = flag("project-ref") ?? fail("--project-ref is required");
  const supabaseUrl = `https://${ref}.supabase.co`;
  const refusal = redirectRefusal({ supabaseUrl, vercelEnv: undefined });
  if (refusal) fail(refusal);
  const siteUrl =
    flag("site-url") ?? fail("--site-url is required (the Preview deployment)");
  if (new URL(siteUrl).protocol !== "https:")
    fail("--site-url must be https: the point is a link a phone can open");
  const inboxes = parseInboxes(
    flag("inboxes") ?? process.env.AUTH_LINK_REDIRECT_TO,
  );
  if (inboxes.length === 0)
    fail("--inboxes (or AUTH_LINK_REDIRECT_TO) is required");
  const template = (flag("template") ?? "schedule") as LinkTemplate;
  if (!TEMPLATES.includes(template))
    fail(`--template must be one of ${TEMPLATES.join(", ")}`);
  const slug = flag("event") ?? "aws-a10-2026";
  const limit = flag("limit") ? Number(flag("limit")) : Infinity;

  const db = createClient<Database>(supabaseUrl, secretKey(ref), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: event } = await db
    .from("events")
    .select("id, name")
    .eq("slug", slug)
    .maybeSingle();
  if (!event) fail(`no event "${slug}" on ${ref}`);
  const { data: rows, error } = await db
    .from("team_members")
    .select("email, teams!inner(name, join_code, event_id)")
    .eq("teams.event_id", event.id)
    .order("email");
  if (error) fail(error.message);
  const members = (rows ?? []).slice(0, limit);
  const teams = new Set(members.map((m) => m.teams.join_code));
  console.log(
    `${members.length} members of ${teams.size} teams in "${event.name}" on ${ref} -> ${inboxes.length} inboxes, template "${template}", links to ${new URL(siteUrl).host}.`,
  );
  if (!has("confirm")) {
    console.log("Nothing minted or sent. Add --confirm to run it.");
    return;
  }

  // Mint every link first, so the send below is timed on its own.
  const mintStart = Date.now();
  const messages: LinkMessage[] = new Array(members.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: MINT_CONCURRENCY }, async () => {
      while (next < members.length) {
        const i = next++;
        const m = members[i];
        const { data, error } = await db.auth.admin.generateLink({
          type: "magiclink",
          email: m.email,
        });
        if (error)
          fail(`couldn't mint a link for member ${i + 1}: ${error.message}`);
        messages[i] = redirectMessage(
          {
            email: m.email,
            link: callbackLink(
              siteUrl,
              data.properties.hashed_token,
              data.properties.verification_type,
              m.email,
            ),
            template,
            data: { teamName: m.teams.name, joinCode: m.teams.join_code },
          },
          inboxes,
          i,
        );
      }
    }),
  );
  const mintMs = Date.now() - mintStart;
  console.log(
    `Minted ${messages.length} links in ${seconds(mintMs)}. Sending one batch...`,
  );

  const sendStart = Date.now();
  let reply;
  try {
    reply = await callRelay(
      relayUrl,
      relaySecret,
      { messages },
      BATCH_TIMEOUT_MS,
    );
  } catch (e) {
    const after = await ping().catch(() => null);
    fail(
      `the batch didn't return after ${seconds(Date.now() - sendStart)}: ${e instanceof Error ? e.message : e}. ` +
        `Quota now ${after?.quotaRemaining ?? "unknown"} (was ${before.quotaRemaining}), so about ${
          after ? before.quotaRemaining! - after.quotaRemaining! : "?"
        } went out.`,
    );
  }
  const sendMs = Date.now() - sendStart;
  const after = await ping();

  const perInbox = new Map<string, number>();
  for (const m of messages)
    perInbox.set(m.email, (perInbox.get(m.email) ?? 0) + 1);
  console.log(`
Result
  sent            ${reply.sent ?? 0} of ${messages.length}${reply.ok ? "" : "  (NOT all: see failures)"}
  send wall time  ${seconds(sendMs)}  (${(sendMs / Math.max(1, messages.length)).toFixed(0)} ms per message; Apps Script limit 360 s)
  mint time       ${seconds(mintMs)}
  quota           ${before.quotaRemaining} before -> ${after.quotaRemaining} after
  inboxes         ${[...perInbox].map(([k, v]) => `${k}: ${v}`).join(", ")}`);
  if (reply.failed?.length)
    console.log(
      `  failures        ${JSON.stringify(reply.failed.slice(0, 10))}`,
    );
  if (reply.error) console.log(`  relay error     ${reply.error}`);
  if (!reply.ok) process.exit(1);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
