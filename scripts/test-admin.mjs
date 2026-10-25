// End-to-end test of the organizer screens against the seeded event:
// judges (with the live pre-flight check), stations, generate -> preview ->
// publish, what participants and judges then see, and the CSV export.
//
// Drives the real pages the way a browser without JavaScript would: GETs the
// page, finds the form, and POSTs its server-action fields. LOCAL ONLY: it
// resets the local database and reseeds it first, so every run starts from
// the same 60 teams and 16 judges.
//
//   npm run test:admin
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { admin, signIn } from "./lib/session.mjs";
import {
  applyImport,
  blockedReason,
  prepareImport,
} from "../lib/admin/import.ts";

const PORT = 3200;
const BASE = `http://127.0.0.1:${PORT}`;
let failures = 0;
const check = (ok, what, detail = "") => {
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${what}${ok || !detail ? "" : `  -- ${detail}`}`,
  );
  if (!ok) failures++;
};

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
}

// --- HTML forms -------------------------------------------------------------

const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
const attrs = (tag) =>
  Object.fromEntries(
    [...tag.matchAll(/([\w:$-]+)="([^"]*)"/g)].map((m) => [m[1], decode(m[2])]),
  );

/** The <form> whose HTML contains `marker`, as its tags. */
function findForm(html, marker) {
  const chunk = html
    .split("<form")
    .slice(1)
    .map((c) => c.slice(0, c.indexOf("</form>")))
    .find((c) => c.includes(marker));
  if (!chunk) throw new Error(`no form containing ${JSON.stringify(marker)}`);
  return chunk;
}

/**
 * FormData as a browser would submit the form with its defaults: hidden
 * fields (server-action id included), text/number/date inputs with their
 * value, checked checkboxes and radios, and each select's selected option.
 * `overrides` replace whatever the form had for those names.
 */
function formData(formHtml, overrides = {}, { keepChecked = true } = {}) {
  const fd = new FormData();
  for (const [tag] of formHtml.matchAll(/<input[^>]*>/g)) {
    const a = attrs(tag);
    if (!a.name || "disabled" in a) continue;
    if (a.type === "checkbox" || a.type === "radio") {
      if (keepChecked && "checked" in a) fd.append(a.name, a.value ?? "on");
    } else if (a.type !== "submit") {
      fd.append(a.name, a.value ?? "");
    }
  }
  for (const [, open, body] of formHtml.matchAll(
    /<select([^>]*)>([\s\S]*?)<\/select>/g,
  )) {
    const name = attrs(open).name;
    if (!name) continue;
    const options = [...body.matchAll(/<option([^>]*)>/g)].map(([, o]) =>
      attrs(o),
    );
    const chosen = options.find((o) => "selected" in o) ?? options[0];
    fd.append(name, chosen?.value ?? "");
  }
  for (const [k, v] of Object.entries(overrides)) {
    fd.delete(k);
    for (const x of [v].flat()) fd.append(k, x);
  }
  return fd;
}

async function get(path, cookie) {
  const res = await fetch(BASE + path, {
    headers: cookie ? { cookie } : {},
    redirect: "manual",
  });
  return {
    status: res.status,
    location: res.headers.get("location"),
    html: await res.text(),
  };
}

/** Submits the form containing `marker` on `path`; returns where it redirected. */
async function submit(path, cookie, marker, overrides, opts) {
  const page = await get(path, cookie);
  const fd = formData(findForm(page.html, marker), overrides, opts);
  const res = await fetch(BASE + path, {
    method: "POST",
    body: fd,
    headers: { cookie },
    redirect: "manual",
  });
  const location = res.headers.get("location");
  return {
    status: res.status,
    location,
    url: location ? new URL(location, BASE) : null,
  };
}

const flash = (url) =>
  url?.searchParams.get("error") ?? url?.searchParams.get("ok") ?? "";
const text = (html) =>
  decode(
    html
      .replace(/<!-- -->/g, "")
      .replace(/<script[\s\S]*?<\/script>/g, "")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ");

// `supabase db reset` restarts the containers; seeding before the REST API
// answers again fails intermittently.
async function apiReady() {
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/events?select=id&limit=1`;
  const headers = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY };
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(url, { headers })).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Supabase REST API did not come back after the reset");
}

// --- run --------------------------------------------------------------------

async function main() {
  console.log("Resetting and seeding the local database...");
  sh("npx", ["supabase", "db", "reset"]);
  await apiReady();
  sh("npm", ["run", "seed"]);
  console.log("Building...");
  sh("npx", ["next", "build"]);
  const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  try {
    for (let i = 0; i < 60; i++) {
      try {
        await fetch(`${BASE}/login`);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    await run();
  } finally {
    server.kill();
  }
}

async function run() {
  const db = admin();
  const { data: profile } = await db
    .from("profiles")
    .select("email")
    .eq("role", "organizer")
    .limit(1)
    .single();
  const org = await signIn(profile.email, "organizer");
  const participant = await signIn("emily.delgado@scu.example", "participant"); // captain of ShelterLink
  const judgeUser = await signIn("priya.raman@aws.example", "judge");

  // 1. Access.
  for (const p of [
    "/organizer",
    "/organizer/judges",
    "/organizer/panels",
    "/organizer/generate",
    "/organizer/schedules",
  ]) {
    check((await get(p, org.cookie)).status === 200, `organizer can open ${p}`);
  }
  check(
    (await get("/organizer/generate", participant.cookie)).status === 404,
    "a participant gets a real 404 from /organizer/generate",
  );
  check(
    (await get("/organizer/judges", judgeUser.cookie)).status === 404,
    "a judge gets a real 404 from /organizer/judges",
  );
  const anon = await get("/organizer/schedules");
  check(
    anon.status === 307 && anon.location?.endsWith("/login"),
    "anonymous visitors are sent to /login",
  );

  // 2. Live pre-flight on the judges page.
  let judges = text((await get("/organizer/judges", org.cookie)).html);
  check(
    judges.includes("Every track can be fully covered with this roster."),
    "pre-flight: the seeded roster covers every track",
  );
  check(
    judges.includes(
      "16 judges → 8 stations × 15 slots, against 60 checked-in teams",
    ),
    "pre-flight shows 16 judges, 8 stations x 15 slots, 60 teams",
  );
  const { data: awsJudges } = await db
    .from("judges")
    .select("id, full_name, email")
    .eq("affiliation", "AWS")
    .order("created_at");
  const setAffiliation = async (j, affiliation) =>
    submit("/organizer/judges", org.cookie, `value="${j.id}"`, {
      id: j.id,
      fullName: j.full_name,
      email: j.email,
      affiliation,
    });
  for (const j of awsJudges.slice(1)) await setAffiliation(j, "");
  judges = text((await get("/organizer/judges", org.cookie)).html);
  check(
    judges.includes(
      "AWS: 36 teams want this track, but 1 AWS judge x 15 slots = 15 sightings. 21 teams cannot be covered. Add 2 AWS judges.",
    ),
    "pre-flight goes live: demoting 3 of 4 AWS judges shows the exact warning",
    judges.match(/AWS: [^⚠]*?judges?\./)?.[0],
  );
  for (const j of awsJudges.slice(1)) await setAffiliation(j, "AWS");
  judges = text((await get("/organizer/judges", org.cookie)).html);
  check(
    judges.includes("Every track can be fully covered with this roster."),
    "restoring them clears the warning",
  );

  // 3. Judges and stations.
  let r = await submit("/organizer/judges", org.cookie, "Add judge", {
    fullName: "Test Judge",
    email: "test.judge@faculty.example",
    affiliation: "",
  });
  check(flash(r.url) === "Added Test Judge.", "add a judge", flash(r.url));
  const { data: added } = await db
    .from("judges")
    .select("id")
    .eq("email", "test.judge@faculty.example")
    .single();
  r = await submit(
    "/organizer/judges",
    org.cookie,
    `name="id" value="${added.id}"/><button`,
    {},
  );
  check(flash(r.url) === "Judge removed.", "remove that judge", flash(r.url));

  const { data: stations } = await db
    .from("panels")
    .select("id, label")
    .order("sort_order");
  const { data: pj } = await db
    .from("panel_judges")
    .select("panel_id, judge_id");
  const seatedAt2 = pj.find((x) => x.panel_id === stations[1].id).judge_id;
  const own1 = pj
    .filter((x) => x.panel_id === stations[0].id)
    .map((x) => x.judge_id);
  r = await submit(
    "/organizer/panels",
    org.cookie,
    `value="${stations[0].id}"`,
    {
      id: stations[0].id,
      label: stations[0].label,
      locationText: "",
      sortOrder: "1",
      judge: [own1[0], seatedAt2],
    },
  );
  check(
    /already sits at Station 2/.test(flash(r.url)),
    "a judge already seated elsewhere is refused",
    flash(r.url),
  );
  r = await submit(
    "/organizer/panels",
    org.cookie,
    `name="id" value="${stations[0].id}"/><button`,
    {},
  );
  check(
    /used by \d+ scheduled presentations and can't be removed/.test(
      flash(r.url),
    ),
    "deleting a station in use is refused",
    flash(r.url),
  );

  // 4. Generate -> preview.
  r = await submit("/organizer/generate", org.cookie, "Generate draft", {});
  check(
    r.status === 303 &&
      /\/organizer\/schedules\/[0-9a-f-]{36}$/.test(r.url?.pathname ?? ""),
    "generate redirects to the new draft",
    `${r.status} ${r.location}`,
  );
  const draftPath = r.url.pathname;
  const draftId = draftPath.split("/").pop();
  const { data: draft } = await db
    .from("schedules")
    .select("version, status, stats")
    .eq("id", draftId)
    .single();
  const { count: draftSlots } = await db
    .from("slots")
    .select("id", { count: "exact", head: true })
    .eq("schedule_id", draftId);
  const { count: draftRows } = await db
    .from("assignments")
    .select("id", { count: "exact", head: true })
    .eq("schedule_id", draftId);
  check(
    draft.version === 3 && draft.status === "draft",
    "it is draft v3",
    JSON.stringify(draft.version),
  );
  check(
    draftSlots === 15 && draftRows === 120,
    "15 slots and 120 presentations written",
    `${draftSlots} / ${draftRows}`,
  );
  check(
    draft.stats.panelJudges?.length === 8,
    "the draft carries its own pairings for 8 stations",
  );

  const preview = await get(draftPath, org.cookie);
  const pv = text(preview.html);
  check(pv.includes("v3 — draft"), "preview: header says v3 draft");
  check(
    pv.includes("60/60 teams fully covered") &&
      pv.includes("60/60 track-seats met"),
    "preview: 60/60 covered, 60/60 track-seats",
  );
  check(!pv.includes("Structural errors"), "preview: no structural errors");
  check(
    /Changes from the published v1: \d+ moved, 0 added, 0 removed/.test(pv),
    "preview: warns about changes from published v1",
  );
  check(
    pv.includes("Minimum gap") &&
      pv.includes("Overlap (teams shared") &&
      pv.includes("Capacity"),
    "preview: spacing, overlap and capacity sections",
  );
  const acks = [...preview.html.matchAll(/name="(ack:[\w-]+)"/g)].map(
    (m) => m[1],
  );
  check(
    acks.length >= 1 && acks.includes("ack:changes-vs-published"),
    `preview: every warning has its own acknowledgement (${acks.join(", ")})`,
  );

  // 5. Publish: refused without acknowledgements, then done with them.
  r = await submit(
    draftPath,
    org.cookie,
    'name="scheduleId"',
    {},
    { keepChecked: false },
  );
  check(
    /Acknowledge every warning before publishing/.test(flash(r.url)),
    "publishing without acknowledging warnings is refused (server-side)",
    flash(r.url),
  );
  let { data: statuses } = await db
    .from("schedules")
    .select("version, status")
    .order("version");
  check(
    JSON.stringify(statuses) ===
      JSON.stringify([
        { version: 1, status: "published" },
        { version: 2, status: "draft" },
        { version: 3, status: "draft" },
      ]),
    "and nothing changed",
  );
  r = await submit(
    draftPath,
    org.cookie,
    'name="scheduleId"',
    Object.fromEntries(acks.map((a) => [a, "on"])),
  );
  check(
    flash(r.url) === "Published v3. Participants now see this version.",
    "publish with every warning acknowledged",
    flash(r.url),
  );
  ({ data: statuses } = await db
    .from("schedules")
    .select("version, status")
    .order("version"));
  check(
    JSON.stringify(statuses) ===
      JSON.stringify([
        { version: 1, status: "archived" },
        { version: 2, status: "draft" },
        { version: 3, status: "published" },
      ]),
    "v3 published, v1 archived, v2 still a draft",
  );
  const { data: live } = await db
    .from("panel_judges")
    .select("panel_id, judge_id");
  const want = draft.stats.panelJudges
    .flatMap((p) => p.judgeIds.map((j) => `${p.panelId}|${j}`))
    .sort();
  check(
    JSON.stringify(live.map((x) => `${x.panel_id}|${x.judge_id}`).sort()) ===
      JSON.stringify(want),
    "the stations' judges are now the draft's pairings",
  );

  // 6. What participants and judges see now.
  const { data: seen } = await participant.client
    .from("assignments")
    .select("schedule_id");
  check(
    seen.length === 2 && seen.every((a) => a.schedule_id === draftId),
    "a participant sees exactly their 2 presentations, from v3",
  );
  const { data: team } = await db
    .from("teams")
    .select("join_code")
    .eq("name", "ShelterLink")
    .single();
  // As an anonymous visitor would: publishable key, no session.
  const anonDb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false } },
  );
  const { data: byCode } = await anonDb.rpc("team_schedule_by_code", {
    p_code: team.join_code.toLowerCase(),
  });
  check(
    byCode.length === 2,
    "an anonymous join-code lookup returns ShelterLink's 2 published v3 slots",
  );
  const { data: judgeTeams } = await judgeUser.client
    .from("teams")
    .select("id");
  const { data: priya } = await db
    .from("judges")
    .select("id")
    .eq("email", "priya.raman@aws.example")
    .single();
  const station = live.find((x) => x.judge_id === priya.id)?.panel_id;
  const { count: atStation } = await db
    .from("assignments")
    .select("id", { count: "exact", head: true })
    .eq("schedule_id", draftId)
    .eq("panel_id", station);
  check(
    judgeTeams.length === atStation,
    `a judge sees exactly the ${atStation} teams at their v3 station`,
    `${judgeTeams.length}`,
  );
  check(
    (await get("/judge", judgeUser.cookie)).status === 200,
    "and can open /judge",
  );

  // 7. CSV export.
  const csv = await get(`${draftPath}/export`, org.cookie);
  const lines = csv.html.trim().split(/\r?\n/);
  check(
    csv.status === 200 &&
      lines[0].startsWith("Station,Judges,10:00 AM,10:07 AM") &&
      lines[0].endsWith("11:38 AM"),
    "CSV: station x time header in event time",
  );
  check(lines.length === 9, "CSV: 8 station rows");
  const cells = lines
    .slice(1)
    .flatMap((l) => l.split(",").slice(2))
    .filter((c) => c.trim() !== "");
  check(
    cells.length >= 120,
    "CSV: all 120 presentations present",
    String(cells.length),
  );

  // 8. Keep current judges, leave one team out: a new draft, not published.
  const genPage = await get("/organizer/generate", org.cookie);
  const genForm = findForm(genPage.html, "Generate draft");
  const teamIds = [...genForm.matchAll(/<input[^>]*name="team"[^>]*>/g)].map(
    ([t]) => attrs(t).value,
  );
  r = await submit(
    "/organizer/generate",
    org.cookie,
    "Generate draft",
    { mode: "keep", team: teamIds.slice(1) },
    { keepChecked: false },
  );
  check(
    r.status === 303,
    "a keep-current-judges draft with one team left out generates",
    `${r.status} ${flash(r.url)}`,
  );
  const v4 = text((await get(r.url.pathname, org.cookie)).html);
  const { data: leftOut } = await db
    .from("teams")
    .select("name")
    .eq("id", teamIds[0])
    .single();
  check(
    v4.includes("1 checked-in team is not in this schedule") &&
      v4.includes(leftOut.name),
    `v4 names the team left out (${leftOut.name})`,
  );
  check(
    v4.includes("pairings: kept from stations"),
    "v4 kept the stations' judges",
  );
  ({ data: statuses } = await db
    .from("schedules")
    .select("version, status")
    .order("version"));
  check(
    statuses.find((s) => s.version === 3).status === "published" &&
      statuses.find((s) => s.version === 4).status === "draft",
    "v3 stays published; v4 is only a draft",
  );

  // 9. Teams CSV import, with the synthetic sample of the real export.
  const TRACKS = [
    "Best Use of WebSpatial",
    "Future Unicorn Award",
    "Best Project Built w/ ElevenLabs",
    "Best Use of AMD Tech",
    "Best Use of Responsible AI",
    "Best in Play (Top Game)",
  ];
  const { data: ev } = await db.from("events").select("id").single();
  // Tracks, through the tracks screen: the import depends on them matching
  // the form's checkbox labels exactly.
  for (const [i, name] of TRACKS.entries()) {
    r = await submit("/organizer/tracks", org.cookie, "Add track", {
      name,
      sponsor: "",
      judgedLive: "on",
      sortOrder: String(10 + i),
    });
    check(
      flash(r.url) === `Added "${name}".`,
      `tracks screen: add "${name}"`,
      flash(r.url),
    );
  }
  // judged_live = false: the scheduler and the pre-flight ignore that sponsor.
  const { data: awsTrack } = await db
    .from("tracks")
    .select("id, name, sort_order")
    .eq("sponsor", "AWS")
    .single();
  const awsRow = (html) =>
    text(html)
      .match(/AWS (\d+) (\d+) (\d+) (yes|NO)/)
      ?.slice(1, 3)
      .join("/");
  check(
    awsRow((await get("/organizer/judges", org.cookie)).html) === "4/36",
    "pre-flight counts 36 teams wanting AWS",
  );
  r = await submit(
    "/organizer/tracks",
    org.cookie,
    `value="${awsTrack.id}"`,
    {
      id: awsTrack.id,
      name: awsTrack.name,
      sponsor: "AWS",
      sortOrder: String(awsTrack.sort_order),
    },
    { keepChecked: false },
  );
  check(
    flash(r.url) === `Saved "${awsTrack.name}".`,
    "tracks screen: untick judged live on the AWS track",
  );
  const offline = awsRow((await get("/organizer/judges", org.cookie)).html);
  check(
    offline === "4/0",
    "an offline-judged track no longer counts as demand",
    offline,
  );
  await submit("/organizer/tracks", org.cookie, `value="${awsTrack.id}"`, {
    id: awsTrack.id,
    name: awsTrack.name,
    sponsor: "AWS",
    judgedLive: "on",
    sortOrder: String(awsTrack.sort_order),
  });
  check(
    awsRow((await get("/organizer/judges", org.cookie)).html) === "4/36",
    "re-ticking it restores the demand",
  );

  const sample = readFileSync(
    new URL("../fixtures/google-form-responses.sample.csv", import.meta.url),
    "utf8",
  );
  const { count: teamsBefore } = await db
    .from("teams")
    .select("id", { count: "exact", head: true });

  // The screen's server action is a thin wrapper over prepareImport /
  // applyImport (lib/admin/import.ts); drive those directly with the
  // ORGANIZER's own session, so RLS applies exactly as in the app. (A
  // no-JavaScript POST can't drive the client-side import form: in a
  // production build the action's result only reaches the page via React.)
  const page = (await get("/organizer/import", org.cookie)).html;
  check(
    text(page).includes("Best in Play (Top Game)"),
    "import page renders with the event's tracks",
  );
  const event = { id: ev.id, timezone: "America/Los_Angeles" };
  let prepared = await prepareImport(org.client, event, sample);
  const { read, plan } = prepared;
  check(
    read.columns.shape === "old" && read.columns.ignored.length === 0,
    "import: old form, all 12 questions read",
  );
  check(
    plan.needsName.length === 8 && plan.create.length === 0,
    "import: 8 teams need a name (none invented)",
  );
  check(
    read.warnings.some((w) =>
      /Katherine Johnson submitted more than once: using line 16 \(2026-02-28 11:52:31\), replacing line 7/.test(
        w.message,
      ),
    ),
    "import: the duplicate resolves to the later timestamp",
  );
  check(
    read.warnings.some(
      (w) =>
        w.message ===
        "Barbara Liskov: says 5 people but lists 4 (including the submitter).",
    ),
    "import: team-size mismatch reported",
  );
  let refused = "";
  try {
    await applyImport(org.client, event, prepared);
  } catch (e) {
    refused = e.message;
  }
  check(
    refused === "Give every team a name first (8 still need one).",
    "import: applying without names is refused",
    refused,
  );
  const { count: afterRefusal } = await db
    .from("teams")
    .select("id", { count: "exact", head: true });
  check(afterRefusal === teamsBefore, "and nothing was written");

  const names = Object.fromEntries(
    plan.needsName.map((t) => [t.line, `Imported Team L${t.line}`]),
  );
  prepared = await prepareImport(org.client, event, sample, names);
  check(
    prepared.plan.create.length === 8 && blockedReason(prepared) === null,
    "import: with names, the plan is 8 creations",
  );
  const result = await applyImport(org.client, event, prepared);
  check(
    result.created.length === 8 && result.failed.length === 0,
    "import: 8 teams created as the organizer",
    JSON.stringify(result.failed),
  );

  const { data: kj } = await db
    .from("teams")
    .select("id, github_urls, checked_in_at, contact_phone")
    .eq("name", "Imported Team L16")
    .single();
  check(
    kj.github_urls.join() === "https://github.com/example/beta-corrected",
    "import: Katherine's team has the corrected GitHub link",
  );
  check(
    new Date(kj.checked_in_at).toISOString() === "2026-02-28T19:52:31.000Z",
    "import: checked in at the form time (11:52:31 PST)",
    kj.checked_in_at,
  );
  const { count: kjTracks } = await db
    .from("team_tracks")
    .select("track_id", { count: "exact", head: true })
    .eq("team_id", kj.id);
  check(kjTracks === 3, "import: with its three tracks");
  const { data: captain } = await db
    .from("team_members")
    .select("email, full_name, is_captain")
    .eq("team_id", kj.id)
    .single();
  check(
    captain.email === "bbb@example.edu" &&
      captain.is_captain &&
      captain.full_name === "Katherine Johnson",
    "import: the submitter is the captain",
  );
  const { data: bl } = await db
    .from("teams")
    .select("notes")
    .eq("name", "Imported Team L9")
    .single();
  check(
    bl.notes?.includes("Radia Perlman, Frances Allen, Shafi Goldwasser"),
    "import: old-form teammate names kept in notes",
  );
  const gen = text((await get("/organizer/generate", org.cookie)).html);
  check(
    gen.includes("Imported Team L16"),
    "imported teams appear on the generate screen, checked in",
  );

  // Deleting a track teams selected asks first, then removes the selections.
  const { data: gameTrack } = await db
    .from("tracks")
    .select("id")
    .eq("name", "Best in Play (Top Game)")
    .single();
  const { count: picks } = await db
    .from("team_tracks")
    .select("team_id", { count: "exact", head: true })
    .eq("track_id", gameTrack.id);
  r = await submit(
    "/organizer/tracks",
    org.cookie,
    `name="id" value="${gameTrack.id}"/><button`,
    {},
  );
  check(
    r.url?.searchParams.get("confirmDelete") === gameTrack.id,
    `tracks screen: deleting a track ${picks} teams chose asks for confirmation first`,
  );
  const { count: stillThere } = await db
    .from("tracks")
    .select("id", { count: "exact", head: true })
    .eq("id", gameTrack.id);
  check(stillThere === 1, "and deletes nothing yet");
  const confirmPage = await get(
    `/organizer/tracks?confirmDelete=${gameTrack.id}`,
    org.cookie,
  );
  check(
    text(confirmPage.html).includes(
      `${picks} teams have selected “Best in Play (Top Game)”`,
    ),
    "the confirmation names the track and the team count",
  );
  r = await submit(
    `/organizer/tracks?confirmDelete=${gameTrack.id}`,
    org.cookie,
    'name="confirm" value="yes"',
    {},
  );
  check(
    flash(r.url) === `Track deleted and removed from ${picks} teams.`,
    "confirming deletes it",
    flash(r.url),
  );
  const { count: orphanPicks } = await db
    .from("team_tracks")
    .select("team_id", { count: "exact", head: true })
    .eq("track_id", gameTrack.id);
  check(orphanPicks === 0, "and those teams' selections are gone");

  prepared = await prepareImport(org.client, event, sample);
  check(
    prepared.plan.unchanged.length === 8 &&
      prepared.plan.create.length +
        prepared.plan.update.length +
        prepared.plan.needsName.length ===
        0,
    "re-importing the same file matches every team by submitter email and changes nothing",
  );

  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
}

main()
  .catch((e) => {
    console.error(e);
    failures++;
  })
  .finally(() => process.exit(failures ? 1 : 0));
