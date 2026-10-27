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
import { parseCsv } from "../lib/csv/csv.ts";

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
    "/organizer/event",
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

  // 4. Generate -> preview. v1 is published (seed), so regenerating needs
  // the explicit acknowledgement that everyone's times may change.
  r = await submit("/organizer/generate", org.cookie, "Generate draft", {});
  check(
    /v1 is published: tick "Regenerate anyway"/.test(flash(r.url)),
    "generate: after publishing, regenerating is refused without the acknowledgement",
    flash(r.url),
  );
  const genDefaults = await get("/organizer/generate", org.cookie);
  check(
    genDefaults.html.includes('name="slotCount" min="1" value="17"') ||
      /name="slotCount"[^>]*value="17"/.test(genDefaults.html),
    "generate: suggests 17 slots, two above the minimum of 15",
  );
  check(
    text(genDefaults.html).includes(
      "16 empty seats: room for up to 8 late teams at no added time",
    ),
    "generate: and says why (spare seats for late teams)",
  );
  // The checks below expect the minimum, 15 slots: ask for it explicitly.
  r = await submit("/organizer/generate", org.cookie, "Generate draft", {
    regenerateAfterPublish: "on",
    slotCount: "",
  });
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

  // The printed schedule renders the same grid as the CSV, cell for cell,
  // with the judges column off by default (the wall copy) and on with
  // ?judges=1 (the organizers' copy), mirroring the CSV's ?judges=0|1.
  const gridOf = (html) =>
    html
      .slice(html.indexOf("<table"), html.indexOf("</table>"))
      .split("<tr")
      .slice(1)
      .map((tr) =>
        [...tr.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(([, c]) =>
          decode(c.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "")),
        ),
      );
  const print = await get(`${draftPath}/print`, org.cookie);
  const csvNoJudges = await get(`${draftPath}/export?judges=0`, org.cookie);
  const printed = gridOf(print.html);
  check(
    print.status === 200 &&
      JSON.stringify(printed) === JSON.stringify(parseCsv(csvNoJudges.html)),
    "print view: the wall copy is the CSV's grid (judges off), cell for cell",
    `${printed.length} rows; first ${JSON.stringify(printed[0]?.slice(0, 4))}`,
  );
  const judgeNames = parseCsv(csv.html)
    .slice(1)
    .flatMap((r) => r[1].split(", "));
  check(
    printed[0][1] === "10:00 AM" &&
      judgeNames.length === 16 &&
      judgeNames.every((n) => !print.html.includes(n)) &&
      !text(print.html).includes("ORGANIZER COPY"),
    "print view: by default no judges column and no judge names anywhere",
  );
  const staffed = await get(`${draftPath}/print?judges=1`, org.cookie);
  check(
    JSON.stringify(gridOf(staffed.html)) ===
      JSON.stringify(parseCsv(csv.html)) &&
      text(staffed.html).includes("ORGANIZER COPY: lists the judges."),
    "print view: ?judges=1 is the CSV's default grid, labelled as the organizer copy",
  );
  check(
    text(print.html).includes("version 3, published") &&
      !text(print.html).includes("DRAFT"),
    "print view: the published version says so in its heading",
  );
  const { data: seededDraft } = await db
    .from("schedules")
    .select("id")
    .eq("status", "draft")
    .limit(1)
    .single();
  check(
    text(
      (await get(`/organizer/schedules/${seededDraft.id}/print`, org.cookie))
        .html,
    ).includes("DRAFT: not published"),
    "print view: a draft is marked as not published",
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
    {
      mode: "keep",
      team: teamIds.slice(1),
      regenerateAfterPublish: "on",
      slotCount: "",
    },
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
  // The screen posts to this JSON endpoint (a route handler, not a server
  // action: see app/(organizer)/organizer/import/run/route.ts).
  const runForm = () => {
    const fd = new FormData();
    fd.set("intent", "preview");
    fd.set("file", new Blob([sample], { type: "text/csv" }), "responses.csv");
    return fd;
  };
  const run = await fetch(`${BASE}/organizer/import/run`, {
    method: "POST",
    body: runForm(),
    headers: { cookie: org.cookie },
  });
  const runJson = await run.json();
  check(
    run.status === 200 &&
      runJson.read?.columns.shape === "old" &&
      runJson.plan?.needsName.length === 8,
    "import endpoint: an organizer's upload returns the plan as JSON",
  );
  const denied = await fetch(`${BASE}/organizer/import/run`, {
    method: "POST",
    body: runForm(),
    headers: { cookie: participant.cookie },
    redirect: "manual",
  });
  check(
    denied.status === 404,
    "import endpoint: a participant gets a real 404",
    String(denied.status),
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

  // 10. The team view (Phase 4), anonymously, against published v3.
  const { data: tv } = await db
    .from("teams")
    .select("id, name, join_code")
    .eq("name", "ShelterLink")
    .single();
  const code = tv.join_code;
  const visible = (html) =>
    text(html.replace(/<script[\s\S]*?<\/script>/g, ""));
  const loose = await get(`/t/${code.toLowerCase().replace("-", "")}`);
  check(
    loose.status === 307 && loose.location?.endsWith(`/t/${code}`),
    "team view: a loosely typed code redirects to /t/ABCD-1234",
    `${loose.status} ${loose.location}`,
  );
  let tvPage = await get(`/t/${code}`);
  let tvText = visible(tvPage.html);
  check(
    tvPage.status === 200 && tvText.includes("ShelterLink"),
    "team view: renders for an anonymous visitor (no sign-in)",
  );
  check(
    /Sunday, November 8/.test(tvText) && /PST/.test(tvText),
    "team view: far ahead it shows the day, with times labelled PST",
  );
  check(
    tvText.includes("Schedule v3"),
    "team view: names the published version (v3)",
  );
  check(
    /Main hall, table \d/.test(tvText),
    "team view: shows the station's location text",
  );
  const entry = await get(`/t/go?code=${code.toLowerCase().replace("-", "")}`);
  check(
    entry.status === 307 && entry.location?.endsWith(`/t/${code}`),
    "code entry: the form (GET /t/go) redirects to the team view",
    `${entry.status} ${entry.location}`,
  );
  const badEntry = await get("/t/go?code=nope");
  check(
    badEntry.status === 307 &&
      badEntry.location === "/t?code=nope&error=format",
    "code entry: a malformed code goes back to the form",
    `${badEntry.status} ${badEntry.location}`,
  );
  check(
    visible((await get(badEntry.location)).html).includes(
      "“nope” isn't a join code.",
    ),
    "code entry: and the form explains the format",
  );
  check(
    visible((await get("/t/ZZZZ-0000")).html).includes(
      "We don't recognise the code ZZZZ-0000.",
    ),
    "team view: an unknown code says so, with a way to retype it",
  );
  const dataRes = await fetch(`${BASE}/t/${code}/data`);
  const dataJson = await dataRes.json();
  check(
    dataRes.status === 200 &&
      dataJson.view.found === true &&
      typeof dataJson.serverNow === "number" &&
      dataJson.view.slots.length === 2,
    "team view: the polling endpoint returns the view and the server time",
  );

  const { data: v3 } = await db
    .from("schedules")
    .select("id")
    .eq("version", 3)
    .single();
  await db
    .from("assignments")
    .update({ status: "cancelled" })
    .eq("schedule_id", v3.id)
    .eq("team_id", tv.id);
  tvText = visible((await get(`/t/${code}`)).html);
  check(
    tvText.includes("Your team isn't in the judging schedule.") &&
      tvText.includes(
        "find an organizer at the check-in table by the main entrance now",
      ),
    "team view: a team not in the published schedule is told so, and where to go (event setting)",
  );
  await db
    .from("assignments")
    .update({ status: "scheduled" })
    .eq("schedule_id", v3.id)
    .eq("team_id", tv.id);

  await db.from("schedules").update({ status: "archived" }).eq("id", v3.id);
  tvText = visible((await get(`/t/${code}`)).html);
  check(
    tvText.includes("The judging schedule isn't published yet.") &&
      tvText.includes(
        "Judging starts at 10:00 AM PST on Sunday, November 8. Check back closer to then.",
      ),
    "team view: before publishing it says when judging starts (event setting)",
    tvText.slice(0, 200),
  );

  // The Event screen moves the announced start; the team page follows it,
  // not the schedules' first slots.
  r = await submit("/organizer/event", org.cookie, "judgingStartsAt", {
    judgingStartsAt: "2026-11-08T10:30",
    helpLocation: "  Room 101,   next to the elevators ",
  });
  check(
    flash(r.url).startsWith("Saved."),
    "event screen: saves the judging start and help location",
    flash(r.url),
  );
  const { data: evRow } = await db
    .from("events")
    .select("judging_starts_at, help_location")
    .single();
  check(
    Date.parse(evRow.judging_starts_at) ===
      Date.parse("2026-11-08T18:30:00Z") &&
      evRow.help_location === "Room 101, next to the elevators",
    "event screen: the start is read in the event's zone; spaces are tidied",
    JSON.stringify(evRow),
  );
  tvText = visible((await get(`/t/${code}`)).html);
  check(
    tvText.includes("Judging starts at 10:30 AM PST"),
    "team view: the announced start follows the event setting",
    tvText.slice(0, 200),
  );
  await db.from("schedules").update({ status: "published" }).eq("id", v3.id);
  check(
    (await get("/organizer/generate", org.cookie)).html.includes(
      'value="2026-11-08T10:30"',
    ),
    "generate: the start defaults to the event's judging start",
  );
  const { data: aDraft } = await db
    .from("schedules")
    .select("id")
    .eq("status", "draft")
    .order("version")
    .limit(1)
    .single();
  const draftPreview = await get(
    `/organizer/schedules/${aDraft.id}`,
    org.cookie,
  );
  check(
    text(draftPreview.html).includes(
      "Starts at 10:00 AM, not the event's judging start (10:30 AM)",
    ),
    "preview: a schedule starting at another time than the judging start is a warning",
  );
  r = await submit("/organizer/event", org.cookie, "judgingStartsAt", {
    judgingStartsAt: "",
    helpLocation: "",
  });
  check(
    !text(
      (await get(`/organizer/schedules/${aDraft.id}`, org.cookie)).html,
    ).includes("not the event's judging start") &&
      text((await get("/organizer", org.cookie)).html).includes(
        "Judging start not set",
      ),
    "event screen: blank clears the settings; the overview says they're unset",
  );
  await db
    .from("events")
    .update({
      judging_starts_at: "2026-11-08T10:00:00-08:00",
      help_location: "the check-in table by the main entrance",
    })
    .eq("id", ev.id);

  const mine = await get("/team", participant.cookie);
  check(
    mine.status === 307 && mine.location?.endsWith(`/t/${code}`),
    "/team sends a signed-in participant to their team's view",
    `${mine.status} ${mine.location}`,
  );

  // 11. The board, and the announcements that drive its banner.
  let board = visible((await get("/board/aws-a10-2026")).html);
  check(
    board.includes("First up") &&
      board.includes("10:00–10:07 AM PST") &&
      board.includes("After that") &&
      board.includes("the check-in table by the main entrance"),
    "board: before judging it leads with the first slot, then the one after, and where to get help",
    board.slice(0, 240),
  );
  check(
    !board.includes("11:38"),
    "board: it shows two slots, not the whole grid",
  );
  check(
    visible((await get("/board/nope")).html).includes(
      "No event called “nope”.",
    ),
    "board: an unknown event says so",
  );
  const boardData = await (
    await fetch(`${BASE}/board/aws-a10-2026/data`)
  ).json();
  check(
    boardData.view.found === true &&
      boardData.view.slots.length === 15 &&
      typeof boardData.serverNow === "number" &&
      !JSON.stringify(boardData).includes("@"),
    "board: the polling endpoint returns the schedule and server time, and no email addresses",
  );

  const msg = "Station 4 has moved to the Blue section, back wall.";
  r = await submit(
    "/organizer/announcements",
    org.cookie,
    "Post announcement",
    {
      body: `  ${msg}  `,
      level: "warning",
    },
  );
  check(
    flash(r.url).startsWith("Posted."),
    "announcements: post one",
    flash(r.url),
  );
  board = visible((await get("/board/aws-a10-2026")).html);
  check(board.includes(msg), "announcements: it shows on the board");
  check(
    visible((await get(`/t/${code}`)).html).includes(msg),
    "announcements: and on team pages",
  );
  r = await submit("/organizer/announcements", org.cookie, `Clear: ${msg}`);
  check(
    flash(r.url) === "Cleared." &&
      !visible((await get("/board/aws-a10-2026")).html).includes(msg),
    "announcements: clearing takes it off the board",
    flash(r.url),
  );
  r = await submit(
    "/organizer/announcements",
    org.cookie,
    "Post announcement",
    {
      body: "x".repeat(201),
    },
  );
  check(
    flash(r.url).startsWith("Keep it under 200 characters"),
    "announcements: an over-long one is refused",
    flash(r.url),
  );

  await db.from("schedules").update({ status: "archived" }).eq("id", v3.id);
  board = visible((await get("/board/aws-a10-2026")).html);
  check(
    board.includes("The judging schedule isn't published yet.") &&
      board.includes("Judging starts at 10:00 AM PST on Sunday, November 8."),
    "board: before publishing it says when judging starts",
    board.slice(0, 240),
  );
  await db.from("schedules").update({ status: "published" }).eq("id", v3.id);

  // 12. Late changes to the published version (Phase 3 Part 5): a late team
  // is seated without moving anyone, a dropped team's seats stay empty, and
  // both show in the version diff. The generator is never re-run.
  const seatsOf = async (scheduleId) => {
    const { data } = await db
      .from("assignments")
      .select("team_id, panel_id, status, slots(starts_at)")
      .eq("schedule_id", scheduleId);
    return new Map(
      data
        .filter((x) => x.status !== "cancelled")
        .map((x) => [`${x.team_id}|${x.slots.starts_at}`, x.panel_id]),
    );
  };
  const publishDraft = async (path) => {
    const page = await get(path, org.cookie);
    const acks = Object.fromEntries(
      [...page.html.matchAll(/name="(ack:[\w-]+)"/g)].map((m) => [m[1], "on"]),
    );
    return submit(path, org.cookie, "I&#x27;ve reviewed this", acks, {
      keepChecked: false,
    });
  };
  const { data: awsTrack12 } = await db
    .from("tracks")
    .select("id")
    .eq("sponsor", "AWS")
    .limit(1)
    .single();
  const { data: lateTeam } = await db
    .from("teams")
    .insert({
      event_id: ev.id,
      name: "Late Arrival",
      join_code: "LATE-0001",
      checked_in_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  await db
    .from("team_tracks")
    .insert({ team_id: lateTeam.id, track_id: awsTrack12.id });
  const v3Seats = await seatsOf(v3.id);
  const v3Path = `/organizer/schedules/${v3.id}`;
  check(
    text((await get(v3Path, org.cookie)).html).includes("Late changes"),
    "late changes: the published version offers them",
  );

  r = await submit(v3Path, org.cookie, "with this team", {
    teamId: lateTeam.id,
  });
  const insertPath = r.url?.pathname ?? "";
  const insertId = insertPath.split("/").pop();
  const { data: insertRow } = await db
    .from("schedules")
    .select("version, status, stats")
    .eq("id", insertId)
    .single();
  check(
    insertRow?.status === "draft" &&
      insertRow.stats.basedOn.version === 3 &&
      insertRow.stats.lateChange.kind === "insert",
    "late team: drafts the next version as a copy of v3, not a regeneration",
    JSON.stringify(insertRow?.stats?.basedOn),
  );
  let page12 = text((await get(insertPath, org.cookie)).html);
  check(
    page12.includes("Late change to v3: adds Late Arrival at") &&
      page12.includes("2 slots added at the end (the schedule was full)") &&
      page12.includes("0 moved, 1 added, 0 removed"),
    "late team: the draft says what it adds, and the diff shows 1 added, 0 moved",
    page12.slice(
      page12.indexOf("Late change"),
      page12.indexOf("Late change") + 200,
    ),
  );
  const insertSeats = await seatsOf(insertId);
  check(
    [...v3Seats].every(([k, panel]) => insertSeats.get(k) === panel) &&
      insertSeats.size === v3Seats.size + 2,
    "late team: every v3 team keeps its station and time; the late team gets two seats",
    `${v3Seats.size} -> ${insertSeats.size}`,
  );
  r = await publishDraft(insertPath);
  check(
    flash(r.url).startsWith("Published"),
    "late team: the draft publishes through the normal review",
    flash(r.url),
  );
  check(
    visible((await get("/t/LATE-0001")).html).includes(
      "Your first presentation is on",
    ),
    "late team: its team page now shows its times",
  );
  page12 = text((await get(insertPath, org.cookie)).html);
  check(
    page12.includes("Changes from v3 (the version this replaced)") &&
      page12.includes("Late Arrival — (not scheduled) added:"),
    "late team: once published, the version still shows its diff against v3",
  );

  // Drop a team from the new published version.
  r = await submit(insertPath, org.cookie, "without this team", {
    teamId: tv.id,
  });
  const dropPath = r.url?.pathname ?? "";
  const dropId = dropPath.split("/").pop();
  page12 = text((await get(dropPath, org.cookie)).html);
  check(
    page12.includes("drops ShelterLink; its seats stay empty") &&
      page12.includes("0 moved, 0 added, 1 removed") &&
      page12.includes("dropped (seats left empty)"),
    "drop: the draft names the team and the diff shows 1 removed, 0 moved",
  );
  const { data: dropRows } = await db
    .from("assignments")
    .select("status")
    .eq("schedule_id", dropId)
    .eq("team_id", tv.id);
  const dropSeats = await seatsOf(dropId);
  check(
    dropRows.length === 2 &&
      dropRows.every((x) => x.status === "cancelled") &&
      [...insertSeats]
        .filter(([k]) => !k.startsWith(tv.id))
        .every(([k, panel]) => dropSeats.get(k) === panel),
    "drop: its assignments are cancelled, nothing is re-packed, nobody else moves",
  );

  // A second late change drafted from the same version goes stale once the
  // first is published.
  const { data: secondLate } = await db
    .from("teams")
    .insert({ event_id: ev.id, name: "Later Still", join_code: "LATE-0002" })
    .select("id")
    .single();
  r = await submit(insertPath, org.cookie, "with this team", {
    teamId: secondLate.id,
  });
  const stalePath = r.url?.pathname ?? "";
  r = await publishDraft(dropPath);
  check(flash(r.url).startsWith("Published"), "drop: publishes", flash(r.url));
  check(
    visible((await get(`/t/${code}`)).html).includes(
      "Your team isn't in the judging schedule.",
    ),
    "drop: the dropped team's page says it isn't scheduled",
  );
  r = await publishDraft(stalePath);
  check(
    /structural errors/.test(flash(r.url)) &&
      text((await get(stalePath, org.cookie)).html).includes(
        "Publishing it would undo whatever changed since",
      ),
    "stale late change: a draft copied from an older version can't be published",
    flash(r.url),
  );
  r = await submit(stalePath, org.cookie, "Discard draft", {});
  check(
    /^Discarded draft v\d+\.$/.test(flash(r.url)),
    "a draft nobody will publish can be discarded",
    flash(r.url),
  );

  // The dropped team's seats are free again: the next late team uses them
  // instead of growing the schedule.
  r = await submit(dropPath, org.cookie, "with this team", {
    teamId: secondLate.id,
  });
  const { data: refill } = await db
    .from("schedules")
    .select("stats")
    .eq("id", r.url?.pathname.split("/").pop())
    .single();
  check(
    refill?.stats.lateChange.appendedSlots === 0,
    "a later late team takes the seats a dropped team left, without adding slots",
    JSON.stringify(refill?.stats.lateChange),
  );

  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
}

main()
  .catch((e) => {
    console.error(e);
    failures++;
  })
  .finally(() => process.exit(failures ? 1 : 0));
