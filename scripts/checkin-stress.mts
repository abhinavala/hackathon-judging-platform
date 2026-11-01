// npm run stress:checkin -- ... : the post-keynote rush, against a Preview
// deployment. Fires N team check-ins at once through the real form endpoint,
// plus K "two teammates submitted at the same moment" pairs (same members,
// different team name), then checks the database: every distinct team exists
// once with all its members, exactly one of each pair won, the losers left
// nothing behind, and nobody is on two teams. Emails go wherever the
// deployment sends them, so set AUTH_LINK_REDIRECT_TO on Preview first.
//
//   VERCEL_AUTOMATION_BYPASS_SECRET=... npm run stress:checkin -- \
//     --project-ref <preview ref> \
//     --url https://<preview deployment>.vercel.app \
//     --teams 60 --pairs 10 --confirm
//
// Options:
//   --size N        people per team, captain included (default 4)
//   --pace S        start one check-in every S seconds instead of all at
//                   once (real sends without a burst); use with --pairs 0
//   --open-checkin  if the event's check-in hasn't opened, open it for the
//                   run and put the old time back afterwards
//   --cleanup RUN   delete the teams a previous run created, and stop
//   --local         local Supabase (.env.local) and a local build instead of
//                   --project-ref; --url may then be http
//
// Guards: refuses the production project ref, and sends nothing without
// --confirm. The per-IP limit is 90 check-ins a minute, so teams + pairs
// must stay under it.

import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";
import { isProductionSupabase } from "../lib/prod-guard.ts";

function fail(message: string): never {
  console.error(`checkin-stress: ${message}`);
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
  const secret = keys.find((k) => k.type === "secret")?.api_key;
  const key =
    secret && /^[\x21-\x7e]+$/.test(secret)
      ? secret
      : keys.find((k) => k.name === "service_role")?.api_key;
  if (!key) fail("the project has no usable secret or service_role key");
  return key;
}

const ms = (n: number) => `${Math.round(n)} ms`;
const pct = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[
    Math.min(xs.length - 1, Math.floor(p * xs.length))
  ];

type Submission = {
  label: string;
  team: number;
  teamName: string;
  emails: string[];
  pair: boolean;
};
type Reply = {
  status: number;
  ms: number;
  ok: boolean;
  joinCode?: string;
  error?: string;
};

async function main() {
  const local = has("local");
  const ref = local
    ? "local"
    : (flag("project-ref") ?? fail("--project-ref is required"));
  const supabaseUrl = local
    ? (process.env.NEXT_PUBLIC_SUPABASE_URL ?? fail("no .env.local"))
    : `https://${ref}.supabase.co`;
  if (local && !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(supabaseUrl))
    fail("--local needs a local Supabase URL in .env.local");
  if (isProductionSupabase(supabaseUrl))
    fail("refusing the production project: this creates teams and accounts");
  const key = local
    ? (process.env.SUPABASE_SERVICE_ROLE_KEY ??
      fail("no service key in .env.local"))
    : secretKey(ref);
  const db = createClient<Database>(supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const cleanup = flag("cleanup");
  if (cleanup) {
    const { data, error } = await db
      .from("teams")
      .delete()
      .like("name", `Stress ${cleanup} %`)
      .select("id");
    if (error) fail(error.message);
    console.log(`Deleted ${data.length} teams from run ${cleanup}.`);
    return;
  }

  const base =
    flag("url") ?? fail("--url is required (the Preview deployment)");
  if (!local && new URL(base).protocol !== "https:")
    fail("--url must be https");
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const teams = Number(flag("teams") ?? 60);
  const pairs = Number(flag("pairs") ?? 10);
  const size = Number(flag("size") ?? 4);
  const paceMs = Number(flag("pace") ?? 0) * 1000;
  if (paceMs && pairs) fail("--pace is for real sends: use it with --pairs 0");
  if (teams + pairs > 90)
    fail("teams + pairs must stay under the 90-a-minute per-IP limit");
  if (pairs > teams) fail("--pairs can't exceed --teams");

  // The event the form checks into: the newest, as the app picks it.
  const { data: event } = await db
    .from("events")
    .select("id, name, checkin_opens_at")
    .order("year", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!event) fail(`no event on ${ref}`);
  const { data: tracks } = await db
    .from("tracks")
    .select("id")
    .eq("event_id", event.id);
  const notOpen =
    event.checkin_opens_at && Date.parse(event.checkin_opens_at) > Date.now();

  const run = Date.now().toString(36).slice(-5);
  const subs: Submission[] = [];
  for (let t = 0; t < teams; t++) {
    const emails = Array.from(
      { length: size },
      (_, m) => `stress-${run}-t${t}-m${m}@stress.example`,
    );
    subs.push({
      label: `team ${t}`,
      team: t,
      teamName: `Stress ${run} Team ${t}`,
      emails,
      pair: false,
    });
  }
  // The race: the same people, submitted again at the same moment by a
  // teammate who typed a different team name.
  for (let t = 0; t < pairs; t++)
    subs.push({
      ...subs[t],
      label: `team ${t} (twin)`,
      teamName: `Stress ${run} Team ${t} twin`,
      pair: true,
    });

  console.log(
    `Run ${run}: ${teams} teams of ${size} + ${pairs} simultaneous twins -> ${subs.length} requests at once to ${new URL(base).host}, event "${event.name}" on ${ref}.` +
      (notOpen ? ` Check-in opens ${event.checkin_opens_at}.` : ""),
  );
  if (notOpen && !has("open-checkin"))
    fail("check-in isn't open on this event yet; add --open-checkin");
  if (!has("confirm")) {
    console.log("Nothing sent. Add --confirm to run it.");
    return;
  }

  const restore = notOpen ? event.checkin_opens_at : undefined;
  if (notOpen) {
    const { error } = await db
      .from("events")
      .update({ checkin_opens_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", event.id);
    if (error) fail(`couldn't open check-in: ${error.message}`);
  }

  const submit = async (s: Submission): Promise<Reply> => {
    const form = new FormData();
    form.append("teamName", s.teamName);
    form.append("captainName", `Captain ${s.team}`);
    form.append("captainEmail", s.emails[0]);
    s.emails.slice(1).forEach((e, i) => {
      form.append(`teammateName${i + 1}`, `Member ${s.team}.${i + 1}`);
      form.append(`teammateEmail${i + 1}`, e);
    });
    for (const k of ["hasGradStudent", "allFreshmen", "halfOrMoreNonMale"])
      form.append(k, "no");
    if (tracks?.length) form.append("track", tracks[s.team % tracks.length].id);
    const start = performance.now();
    const res = await fetch(`${base}/checkin/submit`, {
      method: "POST",
      body: form,
      headers: {
        accept: "application/json",
        ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}),
      },
    });
    const elapsed = performance.now() - start;
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      redirect?: string;
      errors?: Record<string, string>;
    } | null;
    if (body?.ok && body.redirect) {
      return {
        status: res.status,
        ms: elapsed,
        ok: true,
        joinCode: new URL(body.redirect, base).pathname.split("/")[2],
      };
    }
    return {
      status: res.status,
      ms: elapsed,
      ok: false,
      error: body?.errors
        ? Object.values(body.errors)[0]
        : `HTTP ${res.status} (not JSON: protection bypass missing?)`,
    };
  };

  let replies: Reply[];
  const wallStart = performance.now();
  try {
    // Each twin goes out right beside its original, so the two reach the
    // database together: that overlap is the race, and requests 60 apart
    // in the queue would never produce it.
    const order = subs
      .map((_, i) => i)
      .sort((a, b) => (a % teams) - (b % teams) || a - b);
    replies = new Array(subs.length);
    await Promise.all(
      order.map(async (i, k) => {
        if (paceMs) await new Promise((r) => setTimeout(r, k * paceMs));
        replies[i] = await submit(subs[i]);
        if (paceMs)
          console.log(
            `  ${subs[i].label}: ${replies[i].status} in ${ms(replies[i].ms)}` +
              (replies[i].ok
                ? `, ${replies[i].joinCode}`
                : `, ${replies[i].error}`),
          );
      }),
    );
  } finally {
    if (restore !== undefined)
      await db
        .from("events")
        .update({ checkin_opens_at: restore })
        .eq("id", event.id);
  }
  const wall = performance.now() - wallStart;

  // What the database holds now.
  const { data: rows, error } = await db
    .from("teams")
    .select("name, team_members(email, is_captain)")
    .like("name", `Stress ${run} %`);
  if (error) fail(error.message);
  const byName = new Map(rows.map((r) => [r.name, r.team_members]));
  const problems: string[] = [];
  const memberTeams = new Map<string, number>();
  for (const r of rows)
    for (const m of r.team_members)
      memberTeams.set(m.email, (memberTeams.get(m.email) ?? 0) + 1);
  for (const [email, n] of memberTeams)
    if (n > 1) problems.push(`${email} is on ${n} teams`);

  for (let t = 0; t < teams; t++) {
    const s = subs[t];
    const twin = t < pairs ? subs[teams + t] : null;
    const present = [s, twin].filter(
      (x) => x && byName.has(x.teamName),
    ) as Submission[];
    const won = [replies[t], twin ? replies[teams + t] : null].filter(
      (r) => r?.ok,
    ).length;
    if (present.length !== 1)
      problems.push(`${s.label}: ${present.length} rows (expected exactly 1)`);
    if (won !== 1)
      problems.push(
        `${s.label}: ${won} submissions reported success (expected exactly 1)`,
      );
    for (const p of present) {
      const members = byName.get(p.teamName)!;
      if (members.length !== size)
        problems.push(
          `${p.label}: ${members.length} members (expected ${size})`,
        );
      if (members.filter((m) => m.is_captain).length !== 1)
        problems.push(`${p.label}: not exactly one captain`);
    }
  }
  if (rows.length !== teams)
    problems.push(`${rows.length} teams in the database (expected ${teams})`);

  const oks = replies.filter((r) => r.ok);
  const lost = replies.filter((r) => !r.ok);
  const otherErrors = lost.filter(
    (r) => !/already checked in|already on a team/.test(r.error ?? ""),
  );
  const lat = replies.map((r) => r.ms);
  // Emails go out after the answer: wait for every team's checkin_emails
  // row to leave "sending" (or give up after two minutes and say so).
  type Delivery = {
    status: string;
    failed: string[];
    error: string | null;
    updated_at: string;
    teams: { checked_in_at: string | null };
  };
  let deliveries: Delivery[] = [];
  const waitStart = Date.now();
  while (Date.now() - waitStart < 120_000) {
    const { data, error: dErr } = await db
      .from("checkin_emails")
      .select(
        "status, failed, error, updated_at, teams!inner(name, checked_in_at)",
      )
      .like("teams.name", `Stress ${run} %`);
    if (dErr) fail(dErr.message);
    deliveries = data as unknown as Delivery[];
    if (
      deliveries.length >= oks.length &&
      !deliveries.some((d) => d.status === "sending")
    )
      break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const stillSending = deliveries.filter((d) => d.status === "sending").length;
  const emailsFailed = deliveries.reduce((n, d) => n + d.failed.length, 0);
  const lag = deliveries
    .filter((d) => d.status !== "sending" && d.teams.checked_in_at)
    .map((d) => Date.parse(d.updated_at) - Date.parse(d.teams.checked_in_at!));
  const firstErrors = [
    ...new Set(deliveries.map((d) => d.error).filter(Boolean)),
  ];
  const statuses = new Map<number, number>();
  for (const r of replies)
    statuses.set(r.status, (statuses.get(r.status) ?? 0) + 1);

  console.log(`
Result (run ${run})
  wall time       ${ms(wall)} for ${subs.length} requests
  latency         p50 ${ms(pct(lat, 0.5))}, p95 ${ms(pct(lat, 0.95))}, max ${ms(Math.max(...lat))}
  statuses        ${[...statuses].map(([k, v]) => `${k}: ${v}`).join(", ")}
  checked in      ${oks.length} (expected ${teams}); refused as duplicates ${lost.length - otherErrors.length} (expected ${pairs})
  emails          ${deliveries.length} teams recorded: ${deliveries.filter((d) => d.status === "sent").length} all sent, ${deliveries.filter((d) => d.status === "failed").length} with failures, ${stillSending} still "sending"; ${emailsFailed} of ${oks.length * size} addresses not sent
  delivered after check-in  ${lag.length ? `p50 ${ms(pct(lag, 0.5))}, max ${ms(Math.max(...lag))}` : "n/a"}${firstErrors.length ? `\n  email errors    ${JSON.stringify(firstErrors.slice(0, 3))}` : ""}
  database        ${rows.length} teams, ${memberTeams.size} people`);
  if (otherErrors.length)
    console.log(
      `  other errors    ${JSON.stringify(otherErrors.slice(0, 5).map((r) => r.error))}`,
    );
  if (problems.length) {
    console.log(`  PROBLEMS\n    ${problems.slice(0, 20).join("\n    ")}`);
    process.exit(1);
  }
  console.log(
    `  integrity       OK\n\nClean up with: npm run stress:checkin -- ${local ? "--local" : `--project-ref ${ref}`} --cleanup ${run}`,
  );
  if (otherErrors.length || emailsFailed || stillSending) process.exit(1);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
