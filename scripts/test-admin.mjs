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
  // You can click your way to your screens: signing in lands on /me, which
  // links each role to its pages. /admin, the address people guess, goes to
  // /organizer whether or not you're signed in.
  {
    const meOrg = (await get("/me", org.cookie)).html;
    const meJudge = (await get("/me", judgeUser.cookie)).html;
    const meTeam = (await get("/me", participant.cookie)).html;
    const adminAnon = await get("/admin");
    const adminOrg = await get("/admin", org.cookie);
    check(
      meOrg.includes('href="/organizer"') &&
        meJudge.includes('href="/judge"') &&
        !meJudge.includes('href="/organizer"') &&
        meTeam.includes('href="/team"') &&
        !meTeam.includes('href="/organizer"') &&
        adminAnon.status === 307 &&
        adminAnon.location === "/organizer" &&
        adminOrg.status === 307 &&
        adminOrg.location === "/organizer",
      "navigation: /me links each role to its screens; /admin goes to /organizer, signed in or not",
      `${adminAnon.status} ${adminAnon.location}`,
    );
    {
      const primary = (html) =>
        text(
          /data-testid="primary-action"[^>]*>([^<]*)</.exec(html)?.[1] ?? "",
        );
      const nobody = await signIn("nobody16@scu.example", "participant");
      const meNobody = text((await get("/me", nobody.cookie)).html);
      const home = await get("/", judgeUser.cookie);
      check(
        primary(meJudge) === "Your judging station" &&
          primary(meTeam) === "Your team" &&
          primary(meOrg) === "Organizer screens" &&
          meNobody.includes("not on a team or the judge list yet") &&
          meNobody.includes(
            "If nobody has checked your team in yet, check in here",
          ) &&
          meNobody.includes("Look up a team by join code") &&
          home.status === 307 &&
          home.location?.endsWith("/me") &&
          (await get("/")).status === 200,
        "landing: signed in, / goes to /me, whose one button is the judge's station, the participant's team or the organizer screens; no role says so; anonymous / is unchanged",
        `${primary(meJudge)} | ${primary(meTeam)} | ${primary(meOrg)} | ${home.status} ${home.location}`,
      );
    }
  }

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
  // A real publish form, kept for forging publishes of drafts whose pages
  // (rightly) no longer offer one: the server must refuse those too.
  const publishFormHtml = findForm(
    (await get(draftPath, org.cookie)).html,
    "I&#x27;ve reviewed this",
  );
  const forgePublish = async (path) => {
    const res = await fetch(BASE + path, {
      method: "POST",
      body: formData(publishFormHtml, { scheduleId: path.split("/").pop() }),
      headers: { cookie: org.cookie },
      redirect: "manual",
    });
    const loc = res.headers.get("location");
    return { url: loc ? new URL(loc, BASE) : null };
  };
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
  {
    const page = await get("/judge", judgeUser.cookie);
    // The rendered markup without React's payload, tags kept so a team
    // name is matched as a whole element (">Name<").
    const shown = page.html.replace(/<script[\s\S]*?<\/script>/g, "");
    const { data: mine } = await db
      .from("assignments")
      .select("teams(name), slots(starts_at)")
      .eq("schedule_id", draftId)
      .eq("panel_id", station)
      .neq("status", "cancelled");
    const names = mine
      .sort((a, b) => a.slots.starts_at.localeCompare(b.slots.starts_at))
      .map((a) => a.teams.name);
    const { data: everyone } = await db.from("teams").select("name");
    const others = everyone
      .map((t) => t.name)
      .filter((n) => !names.includes(n) && shown.includes(`>${n}<`));
    const order = names.map((n) => shown.indexOf(`>${n}<`));
    check(
      page.status === 200 &&
        names.length > 0 &&
        order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])) &&
        others.length === 0,
      `the judge's page lists their ${names.length} station teams in time order, and no one else's`,
      JSON.stringify({ missing: names.filter((n, k) => order[k] < 0), others }),
    );
  }

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

  // A track nobody chose is asked about too (set up on check-in morning,
  // next to Save), and the button doesn't look like Save.
  {
    const { data: spare } = await db
      .from("tracks")
      .insert({ event_id: ev.id, name: "Misclick Test", sort_order: 99 })
      .select("id")
      .single();
    const page = (await get("/organizer/tracks", org.cookie)).html;
    const first = await submit(
      "/organizer/tracks",
      org.cookie,
      `name="id" value="${spare.id}"/><button`,
      {},
    );
    const { count: kept } = await db
      .from("tracks")
      .select("id", { count: "exact", head: true })
      .eq("id", spare.id);
    const ask = text(
      (await get(`/organizer/tracks?confirmDelete=${spare.id}`, org.cookie))
        .html,
    );
    const done = await submit(
      `/organizer/tracks?confirmDelete=${spare.id}`,
      org.cookie,
      'name="confirm" value="yes"',
      {},
    );
    check(
      first.url?.searchParams.get("confirmDelete") === spare.id &&
        kept === 1 &&
        ask.includes("Delete “Misclick Test”? No team has selected it yet.") &&
        flash(done.url) === "Track deleted." &&
        /border-red-700[^"]*"[^>]*>Delete…/.test(page),
      "tracks screen: even a track no team chose asks before deleting, and Delete is red, not Save-styled",
      `${first.url} ${kept} ${flash(done.url)}`,
    );
  }

  {
    const overview = (await get("/organizer", org.cookie)).html;
    const eventPage = text((await get("/organizer/event", org.cookie)).html);
    check(
      /href="\/board\/aws-a10-2026"[^>]*target="_blank"/.test(overview) &&
        eventPage.includes(
          "presenting 4 min, questions 1 min, switch over 2 min",
        ) &&
        eventPage.includes("Switch over · 1:30 until next teams"),
      "organizer nav links the board; the Event page shows the slot's phases (4 / 1 / 2) and what the board will say",
    );
  }

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
  // A fresh draft starting at 10:00 (the old drafts are out of date now,
  // and an out-of-date draft shows no publish form, so no warnings).
  r = await submit(
    "/organizer/generate",
    org.cookie,
    "regenerateAfterPublish",
    {
      start: "2026-11-08T10:00",
      regenerateAfterPublish: "on",
    },
  );
  const aDraft = { id: r.url?.pathname.split("/").pop() };
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
  await db.from("schedules").delete().eq("id", aDraft.id);

  // The check-in window is on the same screen now.
  {
    const { data: before } = await db
      .from("events")
      .select("id, checkin_opens_at, checkin_closes_at")
      .single();
    r = await submit("/organizer/event", org.cookie, "checkinOpensAt", {
      checkinOpensAt: "2099-01-02T08:45",
      checkinClosesAt: "2099-01-02T08:00",
    });
    check(
      flash(r.url) === "Check-in has to close after it opens.",
      "event screen: a check-in window that closes before it opens is refused",
      flash(r.url),
    );
    r = await submit("/organizer/event", org.cookie, "checkinOpensAt", {
      checkinOpensAt: "2099-01-02T08:45",
      checkinClosesAt: "2099-01-02T11:00",
    });
    const { data: win } = await db
      .from("events")
      .select("checkin_opens_at, checkin_closes_at")
      .single();
    const form = visible((await get("/checkin")).html);
    check(
      flash(r.url).startsWith("Saved.") &&
        Date.parse(win.checkin_opens_at) ===
          Date.parse("2099-01-02T16:45:00Z") &&
        form.includes("Check-in opens at 8:45 AM PST"),
      "event screen: sets when check-in opens (event zone); the form says so",
      JSON.stringify(win),
    );
    r = await submit("/organizer/event", org.cookie, "checkinOpensAt", {
      checkinOpensAt: "",
      checkinClosesAt: "",
    });
    check(
      visible((await get("/checkin")).html).includes(
        "One person per team fills this in",
      ),
      "event screen: blank opens check-in with no limit",
    );
    await db
      .from("events")
      .update({
        checkin_opens_at: before.checkin_opens_at,
        checkin_closes_at: before.checkin_closes_at,
      })
      .eq("id", before.id);
  }
  await db
    .from("events")
    .update({
      judging_starts_at: "2026-11-08T10:00:00-08:00",
      help_location: "the check-in table by the main entrance",
    })
    .eq("id", ev.id);

  const mine = visible((await get("/team", participant.cookie)).html);
  check(
    mine.includes("Judging") &&
      mine.includes("Live schedule and countdown") &&
      mine.includes(code),
    "/team is the signed-in team page: judging times, the live schedule link, the join code",
    mine.slice(0, 200),
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

  // The seed's v2 draft predates the published late change: it's marked
  // superseded and can't be published (it would undo the change).
  const { data: seedDraft } = await db
    .from("schedules")
    .select("id")
    .eq("version", 2)
    .single();
  const list12 = text((await get("/organizer/schedules", org.cookie)).html);
  const seedPage = (
    await get(`/organizer/schedules/${seedDraft.id}`, org.cookie)
  ).html;
  r = await forgePublish(`/organizer/schedules/${seedDraft.id}`);
  check(
    !seedPage.includes("I&#x27;ve reviewed this") &&
      text(seedPage).includes("This draft can't be published") &&
      list12.includes("draft, superseded by v") &&
      list12.includes("Late team or dropped team") &&
      /out of date/.test(flash(r.url)),
    "superseded draft: marked superseded, no publish form, and a forged publish is refused",
    flash(r.url),
  );
  const pub12 = (await get(insertPath, org.cookie)).html;
  check(
    pub12.indexOf('id="late-changes"') > 0 &&
      pub12.indexOf('id="late-changes"') < pub12.indexOf(">Coverage<"),
    "late changes: on the published version they come first, above the review",
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
  const withdrawnAt = async () =>
    (await db.from("teams").select("withdrawn_at").eq("id", tv.id).single())
      .data.withdrawn_at;
  check(
    (await withdrawnAt()) === null,
    "drop: drafting a drop withdraws nobody (a discarded draft must not)",
  );

  // Warnings identical to the published version's are already accepted and
  // shown without a tick box; changed or new ones still need one.
  const dropHtml = (await get(dropPath, org.cookie)).html;
  check(
    /name="ack:[\w-]+"/.test(dropHtml) &&
      !/<input[^>]*name="ack:[^"]*"[^>]*required/.test(dropHtml),
    "publish: the warning ticks are not browser-required fields (Publish explains instead)",
  );
  const dropAcks = [...dropHtml.matchAll(/name="(ack:[\w-]+)"/g)].map(
    (m) => m[1],
  );
  check(
    text(dropHtml).includes("Already accepted in v") &&
      !dropAcks.includes("ack:tight-spacing") &&
      !dropAcks.includes("ack:unfilled-slots") &&
      dropAcks.includes("ack:changes-vs-published"),
    "drop: the unchanged spacing warning is shown as already accepted; changed and new ones need a tick",
    dropAcks.join(", "),
  );
  r = await submit(
    dropPath,
    org.cookie,
    "I&#x27;ve reviewed this",
    Object.fromEntries(
      dropAcks
        .filter((a) => a !== "ack:changes-vs-published")
        .map((a) => [a, "on"]),
    ),
    { keepChecked: false },
  );
  check(
    /Not acknowledged: Changes from the published/.test(flash(r.url)),
    "drop: publishing without ticking a CHANGED warning is refused, server-side",
    flash(r.url),
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
  check(
    (await withdrawnAt()) !== null,
    "drop: publishing it marks the team withdrawn (0013)",
  );
  {
    const gen = (await get("/organizer/generate", org.cookie)).html;
    const box =
      new RegExp(`<input[^>]*value="${tv.id}"[^>]*>`).exec(gen)?.[0] ?? "";
    check(
      box !== "" &&
        !/checked/.test(box) &&
        text(gen).includes("withdrawn: dropped after publishing"),
      "drop: Generate lists a withdrawn team unticked, and says why",
      box,
    );
  }
  // The stale draft's page has no publish form at all, only the reason. A
  // forged publish (the real form from another draft, this draft's id) is
  // still refused by the server.
  const staleHtml = (await get(stalePath, org.cookie)).html;
  {
    const forged = formData(findForm(dropHtml, "I&#x27;ve reviewed this"), {
      scheduleId: stalePath.split("/").pop(),
    });
    const res = await fetch(BASE + stalePath, {
      method: "POST",
      body: forged,
      headers: { cookie: org.cookie },
      redirect: "manual",
    });
    const loc = res.headers.get("location");
    r = { url: loc ? new URL(loc, BASE) : null };
  }
  check(
    !staleHtml.includes("I&#x27;ve reviewed this") &&
      text(staleHtml).includes("This draft can't be published") &&
      /out of date/.test(flash(r.url)) &&
      text((await get(stalePath, org.cookie)).html).includes(
        "Publishing it would undo whatever changed since",
      ) &&
      text((await get("/organizer/schedules", org.cookie)).html).includes(
        "draft, out of date (made from v",
      ),
    "stale late change: no publish form, just the reason; a forged publish is refused; the list says it's out of date",
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

  // 13. Web check-in (Phase 2): public, written by the service role through
  // check_in_team(), join code on screen at once.
  const { data: awsTrack13 } = await db
    .from("tracks")
    .select("id, name")
    .eq("sponsor", "AWS")
    .limit(1)
    .single();
  const checkinForm = (over = {}) => {
    const fd = new FormData();
    const base = {
      teamName: "Night Owls",
      captainName: "Riley Park",
      captainEmail: "riley.park@scu.example",
      teammateName1: "Sam Ortiz",
      teammateEmail1: "sam.ortiz@scu.example",
      teammateEmail2: "jo.lee@scu.example",
      devpostUrl: "https://devpost.com/software/night-owls",
      githubUrls: "github.com/owls/app",
      hasGradStudent: "no",
      allFreshmen: "yes",
      halfOrMoreNonMale: "yes",
      website: "",
      ...over,
    };
    for (const [k, v] of Object.entries(base))
      for (const x of [v].flat()) fd.append(k, x);
    if (!("track" in over)) fd.append("track", awsTrack13.id);
    return fd;
  };
  const postCheckin = (fd, json) =>
    fetch(`${BASE}/checkin/submit`, {
      method: "POST",
      body: fd,
      redirect: "manual",
      headers: json ? { accept: "application/json" } : {},
    });

  let ci = visible((await get("/checkin")).html);
  check(
    (await get("/checkin")).status === 200 &&
      ci.includes("Check-in opens at 9:00 AM") &&
      !ci.includes("Team name"),
    "check-in: before it opens, the page says when, and shows no form",
  );
  let res13 = await postCheckin(checkinForm(), true);
  check(
    res13.status === 422 &&
      (await res13.json()).errors.form.startsWith("Check-in opens at"),
    "check-in: and a submission before it opens is refused",
  );
  const { data: window13 } = await db
    .from("events")
    .select("checkin_opens_at, checkin_closes_at")
    .eq("id", ev.id)
    .single();
  await db
    .from("events")
    .update({
      checkin_opens_at: new Date(Date.now() - 3600_000).toISOString(),
      checkin_closes_at: new Date(Date.now() + 3600_000).toISOString(),
    })
    .eq("id", ev.id);
  ci = visible((await get("/checkin")).html);
  check(
    ci.includes("Check in your team") &&
      ci.includes(awsTrack13.name) &&
      ci.includes("Teammate 5: email") &&
      !ci.includes("Teammate 6"),
    "check-in: the public form lists the event's tracks and up to 5 teammates (6 people)",
  );

  const { count: teamsBefore13 } = await db
    .from("teams")
    .select("*", { count: "exact", head: true });
  res13 = await postCheckin(
    checkinForm({ teamName: "", captainEmail: "nope", hasGradStudent: "" }),
    true,
  );
  let body13 = await res13.json();
  check(
    res13.status === 422 &&
      body13.errors.teamName &&
      body13.errors.captainEmail &&
      body13.errors.hasGradStudent,
    "check-in: field errors come back together, by field (JavaScript path)",
    JSON.stringify(body13.errors),
  );
  res13 = await postCheckin(checkinForm({ teamName: "" }), false);
  check(
    res13.status === 303 &&
      res13.headers.get("location").startsWith("/checkin?error=") &&
      visible((await get(res13.headers.get("location"))).html).includes(
        "Enter your team",
      ),
    "check-in: without JavaScript, an error returns to the form with the message",
    res13.headers.get("location"),
  );
  res13 = await postCheckin(
    checkinForm({ website: "http://spam.example" }),
    true,
  );
  check(
    res13.status === 422,
    "check-in: the hidden bot field refuses the submission",
  );
  const { count: teamsAfterErrors } = await db
    .from("teams")
    .select("*", { count: "exact", head: true });
  check(
    teamsAfterErrors === teamsBefore13,
    "check-in: and nothing was written",
  );

  // The real thing, without JavaScript.
  res13 = await postCheckin(checkinForm(), false);
  const welcome = res13.headers.get("location") ?? "";
  const newCode = /^\/t\/([A-Z0-9]{4}-[A-Z0-9]{4})\?/.exec(welcome)?.[1];
  check(
    res13.status === 303 && !!newCode && welcome.includes("welcome=1"),
    "check-in: success redirects straight to the team page by join code",
    welcome,
  );
  const welcomePage = visible((await get(welcome)).html);
  check(
    welcomePage.includes("You're checked in.") &&
      welcomePage.includes(newCode) &&
      welcomePage.includes("Screenshot this."),
    "check-in: the join code is on screen at once",
  );
  check(
    welcomePage.includes("We're emailing you a receipt and a sign-in link") &&
      welcomePage.includes("/t/" + newCode) &&
      !welcomePage.includes("riley.park"),
    "check-in: answers before sending, says where the code works, and shows no address",
  );
  {
    // The captain's own browser got a cookie naming who was invited; the
    // same link opened anywhere else shows no addresses. The address of the
    // team page appears once.
    const invitedCookie = res13.headers
      .getSetCookie()
      .find((c) => c.startsWith("checkin-invited="))
      ?.split(";")[0];
    const mine = visible((await get(welcome, invitedCookie)).html);
    const theirs = visible((await get(welcome)).html);
    check(
      mine.includes("sam.ortiz@scu.example") &&
        mine.includes("jo.lee@scu.example") &&
        mine.includes("Fix it on your teammates page") &&
        !theirs.includes("sam.ortiz@scu.example") &&
        mine.split(`/t/${newCode}`).length === 2,
      "check-in: the captain's screen lists who was invited (not shown without their cookie), and the page's URL appears once",
      String(mine.split(`/t/${newCode}`).length - 1),
    );
  }
  // The emails go out after the answer (waitUntil). Here the sender refuses
  // under next start, so the outcome must be recorded as failed, for every
  // address, and shown to organizers: never lost silently.
  let delivery = null;
  for (let i = 0; i < 40; i++) {
    const { data } = await db
      .from("checkin_emails")
      .select("status, failed, error, teams!inner(join_code)")
      .eq("teams.join_code", newCode)
      .maybeSingle();
    delivery = data;
    if (data && data.status !== "sending") break;
    await new Promise((r) => setTimeout(r, 250));
  }
  check(
    delivery?.status === "failed" &&
      delivery.failed.includes("riley.park@scu.example") &&
      delivery.failed.length === 3 &&
      /disabled in production/.test(delivery.error ?? ""),
    "check-in: a background send failure is recorded per address with the reason",
    JSON.stringify(delivery),
  );
  const orgHome = text((await get("/organizer", org.cookie)).html);
  check(
    orgHome.includes("Check-in emails not sent") &&
      orgHome.includes(newCode) &&
      orgHome.includes("riley.park@scu.example"),
    "check-in: and organizers see it on the dashboard, with the join code",
  );
  const { data: owls } = await db
    .from("teams")
    .select(
      "id, name, checked_in_at, contact_email, devpost_url, github_urls, all_freshmen, team_members(email, is_captain, user_id, full_name), team_tracks(track_id)",
    )
    .eq("join_code", newCode)
    .single();
  check(
    owls?.name === "Night Owls" &&
      owls.checked_in_at &&
      owls.contact_email === "riley.park@scu.example" &&
      owls.devpost_url === "https://devpost.com/software/night-owls" &&
      owls.github_urls[0] === "https://github.com/owls/app" &&
      owls.all_freshmen === true &&
      owls.team_members.length === 3 &&
      owls.team_members.filter((m) => m.is_captain).map((m) => m.email)[0] ===
        "riley.park@scu.example" &&
      owls.team_tracks.length === 1,
    "check-in: team, members, captain, tracks and links are all written",
    JSON.stringify(owls),
  );
  check(
    owls?.team_members.every((m) => m.user_id),
    "check-in: a link was minted per person, creating their accounts and linking them to the team",
  );

  // Double check-in, by a teammate.
  res13 = await postCheckin(
    checkinForm({
      teamName: "Owls Again",
      captainName: "Sam Ortiz",
      captainEmail: "SAM.ORTIZ@scu.example",
      teammateName1: "",
      teammateEmail1: "new.person@scu.example",
      teammateEmail2: "",
    }),
    true,
  );
  body13 = await res13.json();
  check(
    res13.status === 422 &&
      body13.errors.form.startsWith(
        "Someone on your team has already checked in (sam.ortiz@scu.example is already on a checked-in team)",
      ) &&
      body13.errors.captainEmail,
    "check-in: a second check-in by a teammate says someone on your team has already checked in",
    JSON.stringify(body13.errors),
  );
  res13 = await postCheckin(
    checkinForm({
      teamName: "night owls",
      captainEmail: "someone.else@scu.example",
      teammateEmail1: "",
      teammateEmail2: "",
      teammateName1: "",
    }),
    true,
  );
  body13 = await res13.json();
  check(
    res13.status === 422 &&
      /A team called "night owls" has already checked in/.test(
        body13.errors.teamName,
      ),
    "check-in: a team name already checked in (any case) is refused, by field",
  );

  // Two teammates submitting at the same moment: exactly one succeeds.
  const race = await Promise.all(
    ["Race A", "Race B"].map((name, i) =>
      postCheckin(
        checkinForm({
          teamName: name,
          captainName: `Racer ${i}`,
          captainEmail: `racer${i}@scu.example`,
          teammateName1: "",
          teammateEmail1: "shared.teammate@scu.example",
          teammateEmail2: "",
        }),
        true,
      ),
    ),
  );
  check(
    race
      .map((r) => r.status)
      .sort()
      .join() === "200,422",
    "check-in: two teammates at the same moment, one check-in wins (no double team)",
    race.map((r) => r.status).join(),
  );

  // The write path is the service role's alone.
  const { error: anonCall } = await createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  ).rpc("check_in_team", { p: { event_id: ev.id } });
  check(
    /permission denied/.test(anonCall?.message ?? ""),
    "check-in: check_in_team can't be called anonymously (RLS isn't loosened; only the service role writes)",
    anonCall?.message,
  );
  await db.from("events").update(window13).eq("id", ev.id);

  // 14. Rate limits on the public form, and the captain's teammates page.
  await db
    .from("events")
    .update({ checkin_opens_at: new Date(Date.now() - 3600_000).toISOString() })
    .eq("id", ev.id);
  const flood = async (ip, n) => {
    const statuses = [];
    for (let i = 0; i < n; i++) {
      const r = await fetch(`${BASE}/checkin/submit`, {
        method: "POST",
        // The bot field: refused without writing, but still counted.
        body: checkinForm({ website: "x" }),
        headers: { accept: "application/json", "x-forwarded-for": ip },
      });
      statuses.push(r.status);
      if (r.status === 429) break;
    }
    return statuses;
  };
  // 90 a minute per IP. A minute boundary mid-loop resets the count, so allow
  // up to two windows' worth before expecting the 429.
  const flooded = await flood("203.0.113.7", 185);
  check(
    flooded.at(-1) === 429 && flooded.slice(0, 90).every((x) => x === 422),
    "rate limit: a flood from one IP is cut off (90 a minute), real traffic up to that passes",
    `${flooded.length} requests, last ${flooded.at(-1)}`,
  );
  check(
    (await flood("203.0.113.8", 1))[0] === 422,
    "rate limit: another network is unaffected",
  );

  check(
    (await get("/team/members")).status === 307,
    "teammates page: needs a session (anonymous visitors go to sign-in)",
  );
  const riley = await signIn("riley.park@scu.example", "participant");
  let tm = visible((await get("/team/members", riley.cookie)).html);
  check(
    tm.includes("Night Owls: teammates") &&
      tm.includes("sam.ortiz@scu.example") &&
      tm.includes("Invited, hasn't signed in yet") &&
      tm.includes("Resend the invitation"),
    "teammates page: the captain sees everyone, who hasn't signed in, and the fixes",
  );
  const { data: joBefore } = await db
    .from("team_members")
    .select("user_id")
    .eq("email", "jo.lee@scu.example")
    .single();
  r = await submit(
    "/team/members",
    riley.cookie,
    'value="jo.lee@scu.example"/><label',
    { newEmail: "Jo.Leigh@scu.example" },
  );
  check(
    flash(r.url).startsWith(
      "Changed jo.lee@scu.example to jo.leigh@scu.example.",
    ),
    "teammates page: the captain corrects a typo'd address",
    flash(r.url),
  );
  const { data: joAfter } = await db
    .from("team_members")
    .select("email, user_id")
    .eq("team_id", owls.id)
    .eq("email", "jo.leigh@scu.example")
    .single();
  const { data: oldJo } = await db.auth.admin.getUserById(joBefore.user_id);
  check(
    joAfter?.user_id && joAfter.user_id !== joBefore.user_id && !oldJo.user,
    "teammates page: the corrected address gets its own account; the typo's unused account (and live link) is deleted",
  );
  const resend = () =>
    submit(
      "/team/members",
      riley.cookie,
      'value="sam.ortiz@scu.example"/><button',
      {},
    );
  r = await resend();
  check(
    /sam\.ortiz@scu\.example/.test(flash(r.url)),
    "teammates page: the captain resends an invitation",
    flash(r.url),
  );
  await resend();
  await resend();
  r = await resend();
  check(
    flash(r.url).startsWith(
      "Not emailed: too many invitations in the last hour",
    ),
    "teammates page: one address can't be emailed more than 3 times an hour",
    flash(r.url),
  );

  // An address that already has an account (signed in before, no team).
  const loner = await signIn("loner@scu.example", "participant");
  r = await submit("/team/members", riley.cookie, "Add and invite", {
    name: "Lou Ner",
    email: "loner@scu.example",
  });
  const { data: lonerRow } = await db
    .from("team_members")
    .select("user_id")
    .eq("team_id", owls.id)
    .eq("email", "loner@scu.example")
    .single();
  check(
    flash(r.url).startsWith("Added loner@scu.example.") &&
      lonerRow?.user_id === loner.userId,
    "teammates page: adding someone who already has an account links that account to the team",
    flash(r.url),
  );
  for (const n of [1, 2]) {
    r = await submit("/team/members", riley.cookie, "Add and invite", {
      email: `extra${n}@scu.example`,
    });
  }
  tm = visible((await get("/team/members", riley.cookie)).html);
  check(
    !tm.includes("Add a teammate") && tm.includes("Night Owls: teammates"),
    "teammates page: at 6 people there's no more adding",
  );
  const sam = await signIn("sam.ortiz@scu.example", "participant");
  tm = visible((await get("/team/members", sam.cookie)).html);
  check(
    tm.includes("Only your captain (Riley Park) can change teammates.") &&
      !tm.includes("Resend the invitation"),
    "teammates page: a teammate sees the list, read-only",
  );
  const crafted = new FormData();
  for (const [k, v] of Object.entries(
    Object.fromEntries(
      formData(
        findForm(
          (await get("/team/members", riley.cookie)).html,
          'value="extra1@scu.example"/><button',
        ),
      ),
    ),
  ))
    crafted.append(k, v);
  const asSam = await fetch(`${BASE}/team/members`, {
    method: "POST",
    body: crafted,
    headers: { cookie: sam.cookie },
    redirect: "manual",
  });
  check(
    new URL(asSam.headers.get("location") ?? "/", BASE).searchParams.get(
      "error",
    ) === "Only your team's captain can change teammates.",
    "teammates page: a teammate posting the captain's form directly is refused",
    asSam.headers.get("location"),
  );
  // And going around the app entirely: the same teammate's session, straight
  // at the database API.
  // The team is full (six) by now, and 0015's cap would refuse the insert
  // first; make room so this exercises RLS, then put the member back.
  const { data: spare } = await db
    .from("team_members")
    .select("email, full_name")
    .eq("team_id", owls.id)
    .like("email", "extra%")
    .limit(1)
    .single();
  await db
    .from("team_members")
    .delete()
    .eq("team_id", owls.id)
    .eq("email", spare.email);
  const { error: bypassAdd } = await sam.client
    .from("team_members")
    .insert({ team_id: owls.id, email: "smuggled@scu.example" });
  await db.from("team_members").insert({ team_id: owls.id, ...spare });
  const { data: bypassEdit } = await sam.client
    .from("team_members")
    .update({ email: "hijacked@scu.example" })
    .eq("team_id", owls.id)
    .eq("email", "riley.park@scu.example")
    .select();
  check(
    /row-level security/.test(bypassAdd?.message ?? "") &&
      bypassEdit?.length === 0,
    "teammates: a teammate calling the database API directly can't add or edit members (0010)",
    bypassAdd?.message,
  );
  const { data: a10Track } = await db
    .from("tracks")
    .select("id")
    .eq("sponsor", "A10")
    .limit(1)
    .single();
  const { error: bypassTrack } = await sam.client
    .from("team_tracks")
    .insert({ team_id: owls.id, track_id: a10Track.id });
  const { data: bypassDrop } = await sam.client
    .from("team_tracks")
    .delete()
    .eq("team_id", owls.id)
    .select();
  const { data: bypassRename } = await sam.client
    .from("teams")
    .update({ name: "Renamed by Sam" })
    .eq("id", owls.id)
    .select();
  const { error: bypassCreate } = await sam.client.from("teams").insert({
    event_id: ev.id,
    name: "Sam's own team",
    join_code: "SAMS-0001",
    created_by: sam.userId,
  });
  const { data: owlsAfter } = await db
    .from("teams")
    .select("name, team_tracks(track_id)")
    .eq("id", owls.id)
    .single();
  check(
    /row-level security/.test(bypassTrack?.message ?? "") &&
      bypassDrop?.length === 0 &&
      bypassRename?.length === 0 &&
      /row-level security/.test(bypassCreate?.message ?? "") &&
      owlsAfter.name === "Night Owls" &&
      owlsAfter.team_tracks.length === 1,
    "teammates: through the API a teammate can't change tracks or details, or create a team (0011)",
  );

  // Coverage on the published version follows who sits at each station now:
  // removing a sponsor's judge after publishing must show up, not leave the
  // figure from publish time standing.
  {
    const { data: live } = await db
      .from("schedules")
      .select("id")
      .eq("status", "published")
      .single();
    const { data: seats } = await db
      .from("panel_judges")
      .select("panel_id, judge_id, judges(affiliation)");
    const { data: rows } = await db
      .from("assignments")
      .select("panel_id, teams(team_tracks(tracks(sponsor)))")
      .eq("schedule_id", live.id)
      .neq("status", "cancelled");
    const seat = seats.find(
      (x) =>
        x.judges.affiliation &&
        rows.some(
          (r) =>
            r.panel_id === x.panel_id &&
            r.teams.team_tracks.some(
              (t) => t.tracks.sponsor === x.judges.affiliation,
            ),
        ),
    );
    const covered = async () =>
      Number(
        /(\d+)\/\d+ teams fully/.exec(
          text((await get(`/organizer/schedules/${live.id}`, org.cookie)).html),
        )?.[1],
      );
    // As after a full generate: the version carries the pairings it was
    // published with (stats.panelJudges), matching the seating at the time.
    const { data: liveRow } = await db
      .from("schedules")
      .select("stats")
      .eq("id", live.id)
      .single();
    const byPanel = new Map();
    for (const x of seats)
      byPanel.set(x.panel_id, [...(byPanel.get(x.panel_id) ?? []), x.judge_id]);
    await db
      .from("schedules")
      .update({
        stats: {
          ...(liveRow.stats ?? {}),
          panelJudges: [...byPanel].map(([panelId, judgeIds]) => ({
            panelId,
            judgeIds,
          })),
        },
      })
      .eq("id", live.id);
    const before = await covered();
    await db
      .from("panel_judges")
      .delete()
      .eq("panel_id", seat.panel_id)
      .eq("judge_id", seat.judge_id);
    const after = await covered();
    await db
      .from("panel_judges")
      .insert({ panel_id: seat.panel_id, judge_id: seat.judge_id });
    await db
      .from("schedules")
      .update({ stats: liveRow.stats })
      .eq("id", live.id);
    check(
      after < before && (await covered()) === before,
      "published coverage is recomputed from the current seating, not frozen at publish",
      `${before} -> ${after}`,
    );
  }

  // Saving a station that drops a sponsor's judge warns, naming the sponsor
  // and the teams here that chose it; an unchanged save doesn't.
  {
    const { data: live } = await db
      .from("schedules")
      .select("id")
      .eq("status", "published")
      .single();
    const { data: seats } = await db
      .from("panel_judges")
      .select("panel_id, judge_id, judges(affiliation)");
    const { data: rows } = await db
      .from("assignments")
      .select("panel_id, teams(team_tracks(tracks(sponsor, judged_live)))")
      .eq("schedule_id", live.id)
      .neq("status", "cancelled");
    const seat = seats.find(
      (x) =>
        x.judges.affiliation &&
        !seats.some(
          (y) =>
            y.panel_id === x.panel_id &&
            y.judge_id !== x.judge_id &&
            y.judges.affiliation === x.judges.affiliation,
        ) &&
        rows.some(
          (r) =>
            r.panel_id === x.panel_id &&
            r.teams.team_tracks.some(
              (t) =>
                t.tracks.judged_live &&
                t.tracks.sponsor === x.judges.affiliation,
            ),
        ),
    );
    const other = seats.find(
      (y) => y.panel_id === seat.panel_id && y.judge_id !== seat.judge_id,
    );
    const marker = `value="${seat.panel_id}"`;
    r = await submit("/organizer/panels", org.cookie, marker, {
      judge: [other?.judge_id ?? "", ""],
    });
    const warned = r.url?.searchParams.get("warn") ?? "";
    await db
      .from("panel_judges")
      .insert({ panel_id: seat.panel_id, judge_id: seat.judge_id });
    r = await submit("/organizer/panels", org.cookie, marker, {});
    check(
      warned.includes(`no ${seat.judges.affiliation} judge sits here now`) &&
        /^Saved /.test(flash(r.url)),
      "stations: dropping a sponsor's judge warns, naming the sponsor and its teams; an unchanged save doesn't",
      warned || flash(r.url),
    );
  }

  // Phase 5: score entry. A judge saves their own published team's score;
  // another station's team is refused; a participant can't reach it.
  {
    const { data: live } = await db
      .from("schedules")
      .select("id, event_id")
      .eq("status", "published")
      .single();
    const { data: priyaJudge } = await db
      .from("judges")
      .select("id")
      .eq("email", "priya.raman@aws.example")
      .single();
    const { data: seat } = await db
      .from("panel_judges")
      .select("panel_id")
      .eq("judge_id", priyaJudge.id)
      .single();
    const { data: rows } = await db
      .from("assignments")
      .select("id, panel_id")
      .eq("schedule_id", live.id)
      .neq("status", "cancelled");
    const mine = rows.find((x) => x.panel_id === seat.panel_id);
    const theirs = rows.find((x) => x.panel_id !== seat.panel_id);
    const { data: rubric } = await db
      .from("rubric_criteria")
      .select("id")
      .eq("event_id", live.event_id);
    const values = Object.fromEntries(
      rubric.map((c, i) => [c.id, (i % 5) + 1]),
    );
    const save = (id, cookie) =>
      fetch(`${BASE}/judge/score/${id}/save`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ values, notes: "admin check" }),
        redirect: "manual",
      });
    const ok = await save(mine.id, judgeUser.cookie);
    const { data: stored } = await db
      .from("scores")
      .select("notes, score_items(value)")
      .eq("assignment_id", mine.id)
      .eq("judge_id", priyaJudge.id)
      .single();
    const refused = await save(theirs.id, judgeUser.cookie);
    const asParticipant = await save(mine.id, participant.cookie);
    const page = await get(`/judge/score/${mine.id}`, judgeUser.cookie);
    check(
      ok.status === 200 &&
        stored?.notes === "admin check" &&
        stored.score_items.length === rubric.length &&
        rubric.length === 4 &&
        refused.status === 403 &&
        asParticipant.status === 404 &&
        page.status === 200 &&
        visible(page.html).includes("Technical execution"),
      "scoring: a judge saves their own team's score on the 4-criterion rubric; another station is refused; a participant can't reach it",
      `${ok.status} ${refused.status} ${asParticipant.status} ${rubric.length}`,
    );
    // The organizer's completion view counts it, and lists the team as
    // still waiting on its other judges.
    {
      const { data: t } = await db
        .from("assignments")
        .select("teams(name)")
        .eq("id", mine.id)
        .single();
      const view = visible((await get("/organizer/scoring", org.cookie)).html);
      const row = view.slice(view.indexOf("Teams missing scores"));
      check(
        /\b1 of \d+ scores in/.test(view) &&
          row.includes(t.teams.name) &&
          view.includes("Judges with teams left") &&
          (await get("/organizer/scoring", judgeUser.cookie)).status === 404,
        "scoring: the organizer's completion view counts the new score and lists what's still missing; judges can't open it",
        view.slice(0, 200),
      );
    }
    // Deliberation ranks it, the CSV carries it, and the lock stops judges.
    {
      const { data: t } = await db
        .from("assignments")
        .select("teams(name)")
        .eq("id", mine.id)
        .single();
      const delib = visible(
        (await get("/organizer/scoring/deliberation", org.cookie)).html,
      );
      const csvRes = await get("/organizer/scoring/export", org.cookie);
      const csvRows = csvRes.html
        .trim()
        .split("\n")
        .filter((l) => l.includes(t.teams.name));
      r = await submit("/organizer/scoring", org.cookie, "Lock scoring", {});
      const lockedSave = await save(mine.id, judgeUser.cookie);
      const lockedPage = visible(
        (await get(`/judge/score/${mine.id}`, judgeUser.cookie)).html,
      );
      r = await submit("/organizer/scoring", org.cookie, "Unlock scoring", {});
      const reopened = await save(mine.id, judgeUser.cookie);
      check(
        delib.includes(t.teams.name) &&
          delib.includes("Ties are decided by deliberation") &&
          csvRes.status === 200 &&
          csvRows.length === 4 &&
          lockedSave.status === 403 &&
          lockedPage.includes("Scoring is closed") &&
          reopened.status === 200 &&
          (await get("/organizer/scoring/deliberation", judgeUser.cookie))
            .status === 404 &&
          (await get("/organizer/scoring/export", judgeUser.cookie)).status ===
            404,
        "scoring: deliberation ranks the team, the CSV has its 4 rows, the lock refuses judges and unlocking reopens; judges can't see either",
        `${csvRows.length} ${lockedSave.status} ${reopened.status}`,
      );
    }
    await db.from("scores").delete().eq("assignment_id", mine.id);
  }

  // 16. AWS's rules (0015): six per team, the code pool, the team page,
  // Devpost by any member. Check-in is still open from section 14.
  {
    const seven = {
      teamName: "Seven Up",
      captainEmail: "seven1@scu.example",
      teammateName1: "",
      teammateEmail1: "seven2@scu.example",
      teammateEmail2: "seven3@scu.example",
      teammateEmail3: "seven4@scu.example",
      teammateEmail4: "seven5@scu.example",
      teammateEmail5: "seven6@scu.example",
      teammateEmail6: "seven7@scu.example",
    };
    let res = await postCheckin(checkinForm(seven), true);
    let body = await res.json();
    const { data: sevenRows } = await db
      .from("teams")
      .select("id")
      .eq("name", "Seven Up");
    check(
      res.status === 422 &&
        /capped at 6 people .*by AWS Workshop Studio/.test(body.errors?.form) &&
        sevenRows.length === 0,
      "cap: a seventh person at check-in is refused with AWS's reason, and nothing is saved",
      JSON.stringify(body.errors),
    );
    const form16 = visible((await get("/checkin")).html);
    check(
      form16.includes(
        "Teams are capped at 6 people (you plus 5) by AWS Workshop Studio",
      ),
      "cap: the check-in form says why teams stop at six",
    );

    // Before any codes exist: check-in still works, and the dashboard says what's missing.
    res = await postCheckin(
      checkinForm({
        teamName: "Pool Empty",
        captainEmail: "pe1@scu.example",
        teammateName1: "",
        teammateEmail1: "pe2@scu.example",
        teammateEmail2: "",
        devpostUrl: "",
      }),
      true,
    );
    let overview = visible((await get("/organizer", org.cookie)).html);
    const missingAt = overview.indexOf("Teams missing AWS codes");
    check(
      res.status === 200 &&
        overview.includes("No workshop codes imported yet") &&
        missingAt > 0 &&
        overview.slice(missingAt).includes("Pool Empty") &&
        overview.slice(missingAt).includes("none imported yet"),
      "codes: with the pool empty, check-in succeeds and the dashboard lists the team and why",
      `${res.status} ${overview.slice(Math.max(0, missingAt), missingAt + 200)}`,
    );
    check(
      overview.includes("Teams without a Devpost link") &&
        visible(
          (await get("/organizer", org.cookie)).html.slice(
            (await get("/organizer", org.cookie)).html.indexOf("no-devpost"),
          ),
        ).includes("Pool Empty"),
      "devpost: the dashboard lists the teams without a link, to chase",
    );

    // Import: a preview first, nothing written; then the import.
    const { data: active } = await db
      .from("teams")
      .select("id, join_code, team_members(id, email, is_captain)")
      .not("checked_in_at", "is", null)
      .is("withdrawn_at", null);
    const people = active.reduce((n, t) => n + t.team_members.length, 0);
    const nW = active.length + 3;
    const wsCsv = (joined) =>
      "Team name,Team code,Participant count,Participant IDs,State,Deployment duration,AWS account ID,Join event URL,Last joined,Last account login,Last updated\n" +
      Array.from({ length: nW }, (_, i) => {
        const c = `ws${String(i).padStart(4, "0")}x`;
        return `team-${i},${c},${joined},"pid-${i}-a;pid-${i}-b",Ready,2h,${100000000000 + i},https://catalog.us-east-1.prod.workshops.aws/join?access-code=${c},,,2026-11-05`;
      }).join("\n");
    const kiroCsv =
      "bonusCode,bonusName,bonusAmount,validFrom,validUntil,expirationDate,redemptionUrl\n" +
      Array.from(
        { length: people + 10 },
        (_, i) =>
          `KIRO${String(i).padStart(5, "0")},Hack,1000,2026-11-01,2026-12-31,2026-12-31,https://kiro.example/redeem/K${i}`,
      ).join("\n");
    const runCodes = async (csv, mode) => {
      const fd = new FormData();
      fd.set("csv", csv);
      fd.set("mode", mode);
      const r = await fetch(`${BASE}/organizer/codes/run`, {
        method: "POST",
        body: fd,
        headers: { cookie: org.cookie },
      });
      return r.json();
    };
    const preview = await runCodes(wsCsv(0), "preview");
    const { count: afterPreview } = await db
      .from("access_codes")
      .select("*", { count: "exact", head: true });
    check(
      preview.kind === "workshop" &&
        preview.plan.added === nW &&
        preview.columns
          .find((c) => c.header === "Participant IDs")
          ?.use.includes("NOT stored") &&
        !JSON.stringify(preview).includes("pid-") &&
        afterPreview === 0,
      "codes: the preview shows each column's use and the counts, writes nothing, and never carries Participant IDs",
      JSON.stringify(preview).slice(0, 300),
    );
    const kiroPreview = await runCodes(
      kiroCsv.replace(
        ",1000,2026-11-01,2026-12-31,2026-12-31,",
        ",500,2026-11-01,2026-12-31,2020-01-01,",
      ),
      "preview",
    );
    check(
      kiroPreview.kind === "kiro" &&
        kiroPreview.warnings.some((w) =>
          w.includes("bonusAmount isn't 1000 on line 2"),
        ) &&
        kiroPreview.warnings.some((w) => w.includes("already expired")),
      "codes: the Kiro preview warns when bonusAmount isn't 1000 or a code has expired",
      JSON.stringify(kiroPreview.warnings),
    );
    const w1 = await runCodes(wsCsv(0), "import");
    const k1 = await runCodes(kiroCsv, "import");
    const { data: pool } = await db
      .from("access_codes")
      .select("kind, code, team_id, member_id, details");
    const wsOf = new Map(
      pool
        .filter((c) => c.kind === "workshop" && c.team_id)
        .map((c) => [c.team_id, c.code]),
    );
    const kiroOf = new Map(
      pool
        .filter((c) => c.kind === "kiro" && c.member_id)
        .map((c) => [c.member_id, c.code]),
    );
    check(
      w1.done &&
        k1.done &&
        active.every((t) => wsOf.has(t.id) || t.team_members.length === 0) &&
        active.every((t) => t.team_members.every((m) => kiroOf.has(m.id))) &&
        !JSON.stringify(pool).includes("pid-"),
      "codes: importing hands every waiting team its workshop code and every person a Kiro code",
      `${w1.done ?? w1.error} | ${k1.done ?? k1.error}`,
    );
    const w2 = await runCodes(wsCsv(3), "import");
    const { data: again } = await db
      .from("access_codes")
      .select("participant_count")
      .eq("kind", "workshop");
    check(
      w2.done &&
        again.length === nW &&
        again.every((c) => c.participant_count === 3),
      "codes: re-importing the workshop file updates the live columns and adds no second copy",
      `${again.length} ${w2.done ?? w2.error}`,
    );

    // The team page: the team's workshop code, the person's own Kiro code.
    // Any active team of two or more (ShelterLink was withdrawn in 12).
    const shelter = active.find(
      (t) =>
        t.team_members.length >= 2 && t.team_members.some((m) => m.is_captain),
    );
    const emily = shelter.team_members.find((m) => m.is_captain);
    const mateRow = shelter.team_members.find((m) => !m.is_captain);
    const captain16 = await signIn(emily.email, "participant");
    const mate = await signIn(mateRow.email, "participant");
    const mineHtml = (await get("/team", captain16.cookie)).html;
    const mateHtml = (await get("/team", mate.cookie)).html;
    const mine16 = visible(mineHtml);
    check(
      mine16.includes(wsOf.get(shelter.id)) &&
        mineHtml.includes(
          `https://catalog.us-east-1.prod.workshops.aws/join?access-code=${wsOf.get(shelter.id)}`,
        ) &&
        mine16.includes("catalog.us-east-1.prod.workshops.aws/join") &&
        mine16.includes("Join with your SCU email address (@scu.edu)") &&
        mine16.includes(kiroOf.get(emily.id)) &&
        mine16.includes("Expires December") &&
        !mine16.includes(kiroOf.get(mateRow.id)) &&
        !mine16.includes("team-") &&
        !mine16.includes("1000000000"),
      "team page: the workshop link and code, SCU-email warning, the person's own Kiro code; no teammate's code, no AWS team name or account",
    );
    check(
      visible(mateHtml).includes(wsOf.get(shelter.id)) &&
        visible(mateHtml).includes(kiroOf.get(mateRow.id)) &&
        !visible(mateHtml).includes(kiroOf.get(emily.id)),
      "team page: a teammate sees the same workshop code and only their own Kiro code",
    );
    const anonT =
      (await get(`/t/${shelter.join_code}`)).html +
      (await get(`/t/${shelter.join_code}/data`)).html;
    check(
      !anonT.includes(wsOf.get(shelter.id)) &&
        !anonT.includes(kiroOf.get(emily.id)) &&
        !anonT.includes("KIRO"),
      "team page: /t/CODE and its data, without signing in, carry neither code",
    );

    // A late teammate gets their own Kiro code and the team's workshop code.
    const { data: pe } = await db
      .from("teams")
      .select("id")
      .eq("name", "Pool Empty")
      .single();
    const peCaptain = await signIn("pe1@scu.example", "participant");
    r = await submit("/team/members", peCaptain.cookie, "Add and invite", {
      name: "Late Comer",
      email: "late16@scu.example",
    });
    const { data: late } = await db
      .from("team_members")
      .select("id")
      .eq("email", "late16@scu.example")
      .single();
    const { data: lateCodes } = await db
      .from("access_codes")
      .select("kind, code")
      .or(`member_id.eq.${late?.id},and(kind.eq.workshop,team_id.eq.${pe.id})`);
    const lateUser = await signIn("late16@scu.example", "participant");
    const latePage = visible((await get("/team", lateUser.cookie)).html);
    check(
      lateCodes?.length === 2 &&
        lateCodes.every((c) => latePage.includes(c.code)),
      "late teammate: added by the captain, they get a Kiro code and see the team's workshop code",
      `${flash(r.url)} ${JSON.stringify(lateCodes)}`,
    );
    for (let i = 4; i <= 6; i++)
      await submit("/team/members", peCaptain.cookie, "Add and invite", {
        name: "",
        email: `fill16-${i}@scu.example`,
      });
    tm = visible((await get("/team/members", peCaptain.cookie)).html);
    const { count: peCount } = await db
      .from("team_members")
      .select("id", { count: "exact", head: true })
      .eq("team_id", pe.id);
    check(
      peCount === 6 &&
        tm.includes("Your team has 6, the most allowed") &&
        tm.includes("by AWS Workshop Studio") &&
        !tm.includes("Add and invite"),
      "cap: at six the captain is told why there's no way to add a seventh",
      `${peCount}`,
    );
    const { data: owls16 } = await db
      .from("teams")
      .select("id")
      .eq("name", "Night Owls")
      .single();

    // Devpost: any member, after check-in.
    r = await submit("/team", sam.cookie, 'name="devpostUrl"', {
      devpostUrl: "devpost.com/software/owls-final",
    });
    const { data: owlsDev } = await db
      .from("teams")
      .select("devpost_url")
      .eq("id", owls16.id)
      .single();
    const bad = await submit("/team", sam.cookie, 'name="devpostUrl"', {
      devpostUrl: "https://github.com/owls/app",
    });
    check(
      flash(r.url).startsWith("Saved.") &&
        owlsDev.devpost_url === "https://devpost.com/software/owls-final" &&
        flash(bad.url).includes("devpost.com link"),
      "devpost: a non-captain teammate sets the link after check-in; a non-Devpost link is refused",
      `${flash(r.url)} | ${flash(bad.url)}`,
    );
  }

  {
    const station = text((await get("/judge", judgeUser.cookie)).html);
    check(
      /\b\d+ of \d+ scored\b/.test(station),
      "judge view: the station header counts how many of the judge's teams they've scored",
      station.slice(0, 200),
    );
  }

  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
}

main()
  .catch((e) => {
    console.error(e);
    failures++;
  })
  .finally(() => process.exit(failures ? 1 : 0));
