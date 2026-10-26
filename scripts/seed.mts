// npm run seed: builds the development fixture that Phases 2-4 develop
// against. It is meant to look like the real AWS x A10 Hack, not three toy
// rows: 60 teams with plausible project names and ~250 members, AWS and A10
// tracks with an overlapping mix, 16 judges on 8 panels, and a published plus
// a draft schedule that satisfy the same invariants the real scheduler
// guarantees.
//
// Idempotent: every row has a deterministic id derived from a stable key and
// is written with an upsert, and all randomness comes from a fixed-seed PRNG,
// so a second run changes nothing. If you change this file's output (team
// count, schedule shape) and a re-run trips a unique constraint, start clean:
// `npm run db:reset && npm run seed`.
//
// Writes with the service role (bypasses RLS). Refuses to run against
// anything but a local Supabase unless given --allow-remote (meant for the
// Preview project), and refuses production even then.
//
// Team members and judges are roster rows only, keyed by email: signing in
// with one of those addresses (the console sender prints the link) links the
// account through handle_new_user(). SEED_ORGANIZER_EMAIL, if set, gets an
// account and the organizer role.

import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";
import { isProductionSupabase } from "../lib/prod-guard.ts";

type Tables = Database["public"]["Tables"];
type Insert<T extends keyof Tables> = Tables[T]["Insert"];

// ---------------------------------------------------------------------------
// Event shape
// ---------------------------------------------------------------------------

const EVENT_SLUG = "aws-a10-2026";
const EVENT_NAME = "AWS x A10 Hack";
const EVENT_YEAR = 2026;
const TIMEZONE = "America/Los_Angeles";
const SLOT_MINUTES = 7;
// The event runs Saturday-Sunday, November 7-8, 2026 (PST: daylight saving
// ends November 1). Check-in is Saturday morning; judging is Sunday, 15
// seven-minute slots from JUDGING_STARTS_AT. The 10:00 start is a
// placeholder until the judging window is confirmed. Fixed dates keep the
// fixture identical across runs.
const CHECKIN_OPENS_AT = "2026-11-07T09:00:00-08:00";
const CHECKIN_CLOSES_AT = "2026-11-07T11:00:00-08:00";
const JUDGING_STARTS_AT = "2026-11-08T10:00:00-08:00";
// A placeholder too: the real place is set on /organizer/event.
const HELP_LOCATION = "the check-in table by the main entrance";

const AWS = "AWS";
const A10 = "A10";
type Sponsor = typeof AWS | typeof A10;

const TRACKS: { name: string; sponsor: Sponsor; sortOrder: number }[] = [
  { name: "Best Use of AWS", sponsor: AWS, sortOrder: 1 },
  { name: "A10 Networks Security Challenge", sponsor: A10, sortOrder: 2 },
];

// 60 teams: AWS 36 (60%), A10 24 (40%), 12 overlapping, 12 grand prize only.
const TRACK_MIX: { tracks: Sponsor[]; count: number }[] = [
  { tracks: [AWS], count: 24 },
  { tracks: [A10], count: 12 },
  { tracks: [AWS, A10], count: 12 },
  { tracks: [], count: 12 },
];

// ~250 participants: 26 teams of 5, 20 of 4, 10 of 3, 4 of 2.
const TEAM_SIZES: { size: number; count: number }[] = [
  { size: 5, count: 26 },
  { size: 4, count: 20 },
  { size: 3, count: 10 },
  { size: 2, count: 4 },
];

// prettier-ignore
const TEAM_NAMES = [
  "ShelterLink", "FoodBridge", "MedRoute", "ClearAir", "Wavelength",
  "Harvest Map", "SafeWalk", "TutorPair", "WaterWatch", "Kindred",
  "ReLeaf", "Lumen Reader", "CareCircle", "Fieldnote", "OpenPantry",
  "SignBridge", "HeatShield", "QuakeReady", "GreenCommute", "Second Shift",
  "MindHarbor", "Hearth", "Ripple", "VoteWise", "LocalLoop",
  "Refill", "Bloom Literacy", "ScanAid", "Firebreak", "TenantShield",
  "SeniorLink", "NeighborNet", "Driftwood", "MealMatch", "Beacon",
  "PocketClinic", "SmokeSignal", "Notebook Commons", "Restore", "TransitPal",
  "Groundwork", "CivicLens", "Polyglot Care", "SunShare", "Rootcause",
  "BikeSafe", "Mosaic", "Tidepool", "Anchor", "JobLadder",
  "Breathe Easy", "Plate Planner", "LastMile Meds", "EchoAssist", "Newcomer Compass",
  "SoilSense", "Unmute", "RideAlong", "ShareTable", "Doorstep",
];

// prettier-ignore
const FIRST_NAMES = [
  "Aarav", "Abigail", "Adebayo", "Aisha", "Alejandro", "Amelia", "Ananya", "Andre",
  "Anh", "Arjun", "Ava", "Benjamin", "Camila", "Carlos", "Chloe", "Chidi",
  "Daniela", "Darius", "Diego", "Elijah", "Emily", "Esther", "Ethan", "Farah",
  "Gabriel", "Hana", "Hiro", "Imani", "Isabella", "Ishaan", "Jasmine", "Javier",
  "Ji-woo", "Jordan", "Kai", "Kavya", "Leila", "Liam", "Lucas", "Maya",
  "Mateo", "Mia", "Minh", "Nadia", "Naomi", "Nikhil", "Noah", "Olivia",
  "Omar", "Priya", "Rafael", "Riya", "Rohan", "Samir", "Sara", "Sebastian",
  "Siddharth", "Sofia", "Tariq", "Valentina", "Wei", "Yara", "Yusuf", "Zara",
  "Zoe",
];

// prettier-ignore
const LAST_NAMES = [
  "Adeyemi", "Agarwal", "Alvarez", "Bui", "Castillo", "Chang", "Chen", "Cruz",
  "Das", "Delgado", "Diaz", "Edwards", "Fernandez", "Flores", "Garcia", "Gupta",
  "Haddad", "Ho", "Huang", "Iyer", "Jackson", "Kapoor", "Kim", "Kumar",
  "Le", "Lee", "Lin", "Lopez", "Martinez", "Mendoza", "Morales", "Nair",
  "Nguyen", "Okafor", "Ortiz", "Park", "Patel", "Pham", "Ramirez", "Rao",
  "Reddy", "Reyes", "Rivera", "Sanchez", "Shah", "Singh", "Tan", "Tran",
  "Vasquez", "Wang", "Williams", "Wong", "Wu", "Yamamoto", "Yang", "Zhang",
];

// 4 AWS, 3 A10, 9 unaffiliated (ACM alums and SCU faculty).
// prettier-ignore
const JUDGES: {
  key: string;
  name: string;
  email: string;
  sponsor: Sponsor | null;
}[] = [
  { key: "aws-1", name: "Priya Raman", email: "priya.raman@aws.example", sponsor: AWS },
  { key: "aws-2", name: "Marcus Chen", email: "marcus.chen@aws.example", sponsor: AWS },
  { key: "aws-3", name: "Elena Petrova", email: "elena.petrova@aws.example", sponsor: AWS },
  { key: "aws-4", name: "David Okafor", email: "david.okafor@aws.example", sponsor: AWS },
  { key: "a10-1", name: "Kenji Watanabe", email: "kenji.watanabe@a10.example", sponsor: A10 },
  { key: "a10-2", name: "Sofia Alvarez", email: "sofia.alvarez@a10.example", sponsor: A10 },
  { key: "a10-3", name: "Rahul Mehta", email: "rahul.mehta@a10.example", sponsor: A10 },
  { key: "u-1", name: "Grace Liu", email: "grace.liu@alumni.example", sponsor: null },
  { key: "u-2", name: "Thomas Nguyen", email: "thomas.nguyen@alumni.example", sponsor: null },
  { key: "u-3", name: "Amara Johnson", email: "amara.johnson@faculty.example", sponsor: null },
  { key: "u-4", name: "Daniel Reyes", email: "daniel.reyes@alumni.example", sponsor: null },
  { key: "u-5", name: "Hannah Schmidt", email: "hannah.schmidt@faculty.example", sponsor: null },
  { key: "u-6", name: "Omar Haddad", email: "omar.haddad@alumni.example", sponsor: null },
  { key: "u-7", name: "Lauren Brooks", email: "lauren.brooks@alumni.example", sponsor: null },
  { key: "u-8", name: "Vikram Iyer", email: "vikram.iyer@faculty.example", sponsor: null },
  { key: "u-9", name: "Mei Tanaka", email: "mei.tanaka@alumni.example", sponsor: null },
];

// Two judges per station, in the "hybrid" layout the real scheduler's
// stage0v2 considers: one AWS+A10 station so overlapping teams can cover
// both tracks in one visit, the remaining sponsor judges each paired with an
// unaffiliated judge, and two all-unaffiliated stations.
const PANELS: { label: string; judges: [string, string] }[] = [
  { label: "Station 1", judges: ["aws-1", "u-1"] },
  { label: "Station 2", judges: ["a10-1", "u-2"] },
  { label: "Station 3", judges: ["aws-2", "a10-2"] },
  { label: "Station 4", judges: ["aws-3", "u-3"] },
  { label: "Station 5", judges: ["u-4", "u-5"] },
  { label: "Station 6", judges: ["a10-3", "u-6"] },
  { label: "Station 7", judges: ["aws-4", "u-7"] },
  { label: "Station 8", judges: ["u-8", "u-9"] },
];

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

// A stable UUID (version 5 layout) for a seed key, so re-runs upsert the
// same rows instead of adding new ones.
function seedId(key: string): string {
  const h = createHash("sha1").update(`judging-seed:${key}`).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// mulberry32: small, fast, and identical on every run for a given seed.
function prng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function expand<S extends { count: number }, T>(
  spec: S[],
  pick: (s: S) => T,
): T[] {
  return spec.flatMap((s) => Array.from({ length: s.count }, () => pick(s)));
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

// ---------------------------------------------------------------------------
// Fixture: teams and members
// ---------------------------------------------------------------------------

type SeedTeam = {
  id: string;
  name: string;
  tracks: Sponsor[];
  joinCode: string;
  members: { email: string; fullName: string; isCaptain: boolean }[];
  row: Insert<"teams">;
};

function buildTeams(eventId: string, rand: () => number): SeedTeam[] {
  if (TEAM_NAMES.length !== 60 || new Set(TEAM_NAMES).size !== 60) {
    throw new Error("TEAM_NAMES must be 60 unique names");
  }
  const trackSets = shuffle(
    expand(TRACK_MIX, (m) => m.tracks),
    rand,
  );
  const sizes = shuffle(
    expand(TEAM_SIZES, (s) => s.size),
    rand,
  );

  // Unique names and emails across the whole event (one team per person).
  const usedNames = new Set<string>();
  const usedEmails = new Set<string>();
  const person = () => {
    for (;;) {
      const first = FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)];
      const last = LAST_NAMES[Math.floor(rand() * LAST_NAMES.length)];
      const fullName = `${first} ${last}`;
      if (usedNames.has(fullName)) continue;
      usedNames.add(fullName);
      const base = `${slugify(first).replace(/-/g, "")}.${slugify(last)}`;
      let email = `${base}@scu.example`;
      for (let n = 2; usedEmails.has(email); n++)
        email = `${base}${n}@scu.example`;
      usedEmails.add(email);
      return { fullName, email };
    }
  };

  const usedCodes = new Set<string>();
  const joinCode = () => {
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O: read aloud at a desk
    for (;;) {
      let code = "";
      for (let i = 0; i < 4; i++)
        code += letters[Math.floor(rand() * letters.length)];
      code += "-";
      for (let i = 0; i < 4; i++) code += Math.floor(rand() * 10);
      if (!usedCodes.has(code)) {
        usedCodes.add(code);
        return code;
      }
    }
  };

  const checkinSpan =
    new Date(CHECKIN_CLOSES_AT).getTime() -
    new Date(CHECKIN_OPENS_AT).getTime();

  return TEAM_NAMES.map((name, i) => {
    const id = seedId(`${EVENT_SLUG}/team/${name}`);
    const members = Array.from({ length: sizes[i] }, (_, m) => ({
      ...person(),
      isCaptain: m === 0,
    }));
    const slug = slugify(name);
    const code = joinCode();
    const captain = members[0];
    const checkedIn = new Date(
      new Date(CHECKIN_OPENS_AT).getTime() + Math.floor(rand() * checkinSpan),
    ).toISOString();
    return {
      id,
      name,
      tracks: trackSets[i],
      joinCode: code,
      members,
      row: {
        id,
        event_id: eventId,
        name,
        join_code: code,
        // Real-looking but suffixed, so they don't point at strangers' work.
        devpost_url: `https://devpost.com/software/${slug}-awsa10`,
        github_urls: [`https://github.com/${slug}-awsa10/${slug}`],
        contact_email: captain.email,
        // 555-01xx is reserved for fiction.
        contact_phone: `(408) 555-01${String(i % 100).padStart(2, "0")}`,
        has_grad_student: rand() < 0.15,
        all_freshmen: rand() < 0.15,
        half_or_more_non_male: rand() < 0.45,
        checked_in_at: checkedIn,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Schedule: track-aware panel pairs, then a proper edge colouring into slots
// ---------------------------------------------------------------------------

type Placement = { team: number; panel: number; slot: number };

type ScheduleResult = {
  nSlots: number;
  placements: Placement[];
  stats: Record<string, unknown>;
};

// Mirrors the shape of the real pipeline (scheduler/pipeline2.py) closely
// enough for a fixture, without porting it (that is Phase 3): each team gets
// two different panels chosen to cover its tracks, every panel gets exactly
// nSlots teams, and the team x panel graph is edge-coloured into nSlots slots
// (Koenig: a bipartite graph's edges colour with max-degree colours).
function buildSchedule(
  teams: SeedTeam[],
  panelSponsors: Set<Sponsor>[],
  rand: () => number,
): ScheduleResult {
  const nPanels = panelSponsors.length;
  const nSlots = Math.ceil((2 * teams.length) / nPanels);
  const capacity = Array.from({ length: nPanels }, () => nSlots);

  // 1. Choose each team's two panels. Most constrained teams first: both
  //    tracks, then the scarcer A10 track, then AWS, then grand prize only.
  const rank = (t: SeedTeam) =>
    t.tracks.length === 2
      ? 0
      : t.tracks.includes(A10)
        ? 1
        : t.tracks.length
          ? 2
          : 3;
  const order = shuffle(
    teams.map((_, i) => i),
    rand,
  ).sort((a, b) => rank(teams[a]) - rank(teams[b]));

  const pairs: [number, number][] = new Array(teams.length);
  const metBy = (t: number, p: number, q: number) =>
    teams[t].tracks.filter(
      (s) => panelSponsors[p].has(s) || panelSponsors[q].has(s),
    ).length;

  const pickPair = (t: number): [number, number] | null => {
    const wants = new Set(teams[t].tracks);
    let best: { key: number[]; pair: [number, number] } | null = null;
    for (let p = 0; p < nPanels; p++) {
      for (let q = p + 1; q < nPanels; q++) {
        if (!capacity[p] || !capacity[q]) continue;
        const covered = new Set([...panelSponsors[p], ...panelSponsors[q]]);
        const met = metBy(t, p, q);
        // Sponsor seats spent on a team that didn't ask for them.
        const wasted = [...covered].filter((s) => !wants.has(s)).length;
        const key = [
          met === wants.size ? 1 : 0,
          met,
          -wasted,
          capacity[p] + capacity[q],
          rand(),
        ];
        if (!best || compare(key, best.key) > 0) best = { key, pair: [p, q] };
      }
    }
    return best?.pair ?? null;
  };

  // Greedy can strand the last teams with seats left on only ONE panel (a
  // team needs two different ones). Remaining seats always equal twice the
  // remaining teams, so stuck means exactly one panel P has spare seats. Move
  // one placed team off some panel X onto P, picking the move that costs the
  // least track coverage; X then has a seat, and a pair exists again.
  const rebalance = (placed: number[]) => {
    const p = capacity.findIndex((c) => c > 0);
    let best: {
      key: number[];
      team: number;
      keep: number;
      drop: number;
    } | null = null;
    for (const u of placed) {
      const [x, y] = pairs[u];
      if (x === p || y === p) continue;
      for (const [keep, drop] of [
        [x, y],
        [y, x],
      ]) {
        const key = [metBy(u, keep, p) - metBy(u, x, y), rand()];
        if (!best || compare(key, best.key) > 0) {
          best = { key, team: u, keep, drop };
        }
      }
    }
    if (!best) throw new Error("seed: cannot rebalance panel capacity");
    pairs[best.team] = [best.keep, p];
    capacity[p]--;
    capacity[best.drop]++;
  };

  const placed: number[] = [];
  for (const t of order) {
    let pair = pickPair(t);
    if (!pair) {
      rebalance(placed);
      pair = pickPair(t);
    }
    if (!pair) throw new Error("seed: ran out of panel capacity");
    pairs[t] = pair;
    capacity[pair[0]]--;
    capacity[pair[1]]--;
    placed.push(t);
  }
  if (capacity.some((c) => c !== 0))
    throw new Error("seed: panels not filled exactly");

  // 2. Edge-colour team-panel edges into slots (alternating-path method).
  const teamSlot = teams.map(() => new Array<number>(nSlots).fill(-1));
  const panelSlot = panelSponsors.map(() => new Array<number>(nSlots).fill(-1));
  const edges = shuffle(
    pairs.flatMap(([p, q], t) => [
      [t, p],
      [t, q],
    ]),
    rand,
  );
  for (const [t, p] of edges) {
    const a = teamSlot[t].indexOf(-1); // free at the team
    const b = panelSlot[p].indexOf(-1); // free at the panel
    if (panelSlot[p][a] !== -1) {
      // Swap colours a/b along the path from p that starts with an a-edge;
      // afterwards a is free at p. Bipartite, so the path can't reach t.
      const path: { t: number; p: number; c: number }[] = [];
      let atPanel = true;
      let node = p;
      let c = a;
      for (;;) {
        const next = atPanel ? panelSlot[node][c] : teamSlot[node][c];
        if (next === -1) break;
        path.push(atPanel ? { t: next, p: node, c } : { t: node, p: next, c });
        node = next;
        atPanel = !atPanel;
        c = c === a ? b : a;
      }
      for (const e of path) {
        teamSlot[e.t][e.c] = -1;
        panelSlot[e.p][e.c] = -1;
      }
      for (const e of path) {
        const nc = e.c === a ? b : a;
        teamSlot[e.t][nc] = e.p;
        panelSlot[e.p][nc] = e.t;
      }
    }
    teamSlot[t][a] = p;
    panelSlot[p][a] = t;
  }

  // 3. Spacing: relabelling slots keeps the colouring valid, so hill-climb
  //    over slot permutations to push each team's two presentations apart.
  const teamColors = teamSlot.map((row) =>
    row.flatMap((p, c) => (p === -1 ? [] : [c])),
  );
  const score = (perm: number[]) => {
    const gaps = teamColors.map(([x, y]) => Math.abs(perm[x] - perm[y]));
    return [Math.min(...gaps), -gaps.filter((g) => g < 4).length];
  };
  let perm = Array.from({ length: nSlots }, (_, i) => i);
  let current = score(perm);
  for (let iter = 0; iter < 4000; iter++) {
    const i = Math.floor(rand() * nSlots);
    const j = Math.floor(rand() * nSlots);
    if (i === j) continue;
    const next = [...perm];
    [next[i], next[j]] = [next[j], next[i]];
    const s = score(next);
    if (compare(s, current) >= 0) {
      perm = next;
      current = s;
    }
  }

  const placements: Placement[] = [];
  teamSlot.forEach((row, t) =>
    row.forEach((p, c) => {
      if (p !== -1) placements.push({ team: t, panel: p, slot: perm[c] });
    }),
  );
  verify(placements, teams.length, nPanels, nSlots);

  const gaps = teamColors
    .map(([x, y]) => Math.abs(perm[x] - perm[y]))
    .sort((x, y) => x - y);
  const fullyCovered = pairs.filter(([p, q], t) =>
    teams[t].tracks.every(
      (s) => panelSponsors[p].has(s) || panelSponsors[q].has(s),
    ),
  ).length;
  const seatsWanted = teams.reduce((n, t) => n + t.tracks.length, 0);
  const seatsMet = pairs.reduce(
    (n, [p, q], t) =>
      n +
      teams[t].tracks.filter(
        (s) => panelSponsors[p].has(s) || panelSponsors[q].has(s),
      ).length,
    0,
  );
  return {
    nSlots,
    placements,
    stats: {
      generator: "seed",
      teams: teams.length,
      panels: nPanels,
      slots: nSlots,
      slot_minutes: SLOT_MINUTES,
      fully_covered: fullyCovered,
      track_seats_met: seatsMet,
      track_seats_wanted: seatsWanted,
      min_gap_slots: gaps[0],
      median_gap_slots: gaps[Math.floor(gaps.length / 2)],
    },
  };
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// The same invariants the database enforces, checked before writing so a
// mistake here reads as a seed bug, not a constraint violation.
function verify(
  placements: Placement[],
  nTeams: number,
  nPanels: number,
  nSlots: number,
) {
  const panelSlot = new Set<string>();
  const teamSlot = new Set<string>();
  const perTeam = new Map<number, Placement[]>();
  for (const pl of placements) {
    const ps = `${pl.panel}:${pl.slot}`;
    const ts = `${pl.team}:${pl.slot}`;
    if (panelSlot.has(ps))
      throw new Error(`seed: panel ${pl.panel} double-booked`);
    if (teamSlot.has(ts))
      throw new Error(`seed: team ${pl.team} in two places`);
    if (
      pl.slot < 0 ||
      pl.slot >= nSlots ||
      pl.panel < 0 ||
      pl.panel >= nPanels
    ) {
      throw new Error("seed: placement out of range");
    }
    panelSlot.add(ps);
    teamSlot.add(ts);
    perTeam.set(pl.team, [...(perTeam.get(pl.team) ?? []), pl]);
  }
  for (let t = 0; t < nTeams; t++) {
    const mine = perTeam.get(t) ?? [];
    if (mine.length !== 2 || mine[0].panel === mine[1].panel) {
      throw new Error(`seed: team ${t} must present twice at different panels`);
    }
  }
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (.env.local)",
    );
  }
  const host = new URL(url).hostname;
  // Preview exists to hold this fixture; production never does, flag or not.
  if (isProductionSupabase(url)) {
    throw new Error(
      `Refusing to seed ${host}: that is the PRODUCTION project. --allow-remote doesn't override this.`,
    );
  }
  if (
    !["127.0.0.1", "localhost"].includes(host) &&
    !process.argv.includes("--allow-remote")
  ) {
    throw new Error(
      `Refusing to seed ${host}: this writes 60 fake teams. Pass --allow-remote if you mean it.`,
    );
  }

  const db = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const upsert = async <T extends keyof Tables>(
    table: T,
    rows: Insert<T>[],
    onConflict = "id",
  ) => {
    const { error } = await db
      .from(table)
      // supabase-js can't narrow a row type through a generic table name.
      .upsert(rows as never, { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  };

  // Event: keep the existing id if the slug is already there.
  const { data: existing, error: lookupError } = await db
    .from("events")
    .select("id")
    .eq("slug", EVENT_SLUG)
    .maybeSingle();
  if (lookupError) throw lookupError;
  const eventId = existing?.id ?? seedId(`event/${EVENT_SLUG}`);
  await upsert("events", [
    {
      id: eventId,
      slug: EVENT_SLUG,
      name: EVENT_NAME,
      year: EVENT_YEAR,
      timezone: TIMEZONE,
      slot_minutes: SLOT_MINUTES,
      checkin_opens_at: CHECKIN_OPENS_AT,
      checkin_closes_at: CHECKIN_CLOSES_AT,
      judging_starts_at: JUDGING_STARTS_AT,
      help_location: HELP_LOCATION,
    },
  ]);

  const trackIds = new Map<Sponsor, string>();
  await upsert(
    "tracks",
    TRACKS.map((t) => {
      const id = seedId(`${EVENT_SLUG}/track/${t.name}`);
      trackIds.set(t.sponsor, id);
      return {
        id,
        event_id: eventId,
        name: t.name,
        sponsor: t.sponsor,
        judged_live: true,
        sort_order: t.sortOrder,
      };
    }),
  );

  const teams = buildTeams(eventId, prng(2026));
  await upsert(
    "teams",
    teams.map((t) => t.row),
  );
  await upsert(
    "team_members",
    teams.flatMap((t) =>
      t.members.map((m) => ({
        team_id: t.id,
        email: m.email,
        full_name: m.fullName,
        is_captain: m.isCaptain,
      })),
    ),
    "team_id,email",
  );
  await upsert(
    "team_tracks",
    teams.flatMap((t) =>
      t.tracks.map((s) => ({ team_id: t.id, track_id: trackIds.get(s)! })),
    ),
    "team_id,track_id",
  );

  const judgeIds = new Map(
    JUDGES.map((j) => [j.key, seedId(`${EVENT_SLUG}/judge/${j.email}`)]),
  );
  await upsert(
    "judges",
    JUDGES.map((j) => ({
      id: judgeIds.get(j.key)!,
      event_id: eventId,
      email: j.email,
      full_name: j.name,
      affiliation: j.sponsor,
    })),
  );

  const panelIds = PANELS.map((p) => seedId(`${EVENT_SLUG}/panel/${p.label}`));
  await upsert(
    "panels",
    PANELS.map((p, i) => ({
      id: panelIds[i],
      event_id: eventId,
      label: p.label,
      location_text: `Main hall, table ${i + 1}`,
      // Two rows of four, for the Phase 4 venue map.
      map_x: 15 + (i % 4) * 23,
      map_y: i < 4 ? 30 : 70,
      sort_order: i + 1,
    })),
  );
  await upsert(
    "panel_judges",
    PANELS.flatMap((p, i) =>
      p.judges.map((k) => ({
        panel_id: panelIds[i],
        judge_id: judgeIds.get(k)!,
      })),
    ),
    "panel_id,judge_id",
  );

  const sponsorOf = new Map(JUDGES.map((j) => [j.key, j.sponsor]));
  const panelSponsors = PANELS.map(
    (p) =>
      new Set(
        p.judges
          .map((k) => sponsorOf.get(k))
          .filter((s): s is Sponsor => s !== null),
      ),
  );

  // Version 1 is published; version 2 is a regenerated draft that differs,
  // as a re-run of the generator would. Times are minutes relative to the
  // start of judging, so moving JUDGING_STARTS_AT moves them too.
  const schedules = [
    {
      version: 1,
      status: "published" as const,
      rand: prng(101),
      generatedAt: -25,
      publishedAt: -20,
    },
    {
      version: 2,
      status: "draft" as const,
      rand: prng(202),
      generatedAt: -8,
      publishedAt: null,
    },
  ];
  const summary: string[] = [];
  for (const s of schedules) {
    const result = buildSchedule(teams, panelSponsors, s.rand);
    const scheduleId = seedId(`${EVENT_SLUG}/schedule/v${s.version}`);
    await upsert("schedules", [
      {
        id: scheduleId,
        event_id: eventId,
        version: s.version,
        round: 1,
        status: s.status,
        stats: result.stats as Insert<"schedules">["stats"],
        generated_at: addMinutes(JUDGING_STARTS_AT, s.generatedAt),
        published_at:
          s.publishedAt === null
            ? null
            : addMinutes(JUDGING_STARTS_AT, s.publishedAt),
      },
    ]);
    const slotIds = Array.from({ length: result.nSlots }, (_, i) =>
      seedId(`${EVENT_SLUG}/schedule/v${s.version}/slot/${i}`),
    );
    await upsert(
      "slots",
      slotIds.map((id, i) => ({
        id,
        schedule_id: scheduleId,
        index: i,
        starts_at: addMinutes(JUDGING_STARTS_AT, i * SLOT_MINUTES),
        ends_at: addMinutes(JUDGING_STARTS_AT, (i + 1) * SLOT_MINUTES),
      })),
    );
    await upsert(
      "assignments",
      result.placements.map((pl) => ({
        id: seedId(
          `${EVENT_SLUG}/schedule/v${s.version}/team/${teams[pl.team].name}/panel/${pl.panel}`,
        ),
        schedule_id: scheduleId,
        team_id: teams[pl.team].id,
        panel_id: panelIds[pl.panel],
        slot_id: slotIds[pl.slot],
        round: 1,
      })),
    );
    summary.push(
      `v${s.version} ${s.status}: ${result.placements.length} presentations in ${result.nSlots} slots, ` +
        `${result.stats.fully_covered}/${teams.length} teams fully track-covered, ` +
        `min gap ${result.stats.min_gap_slots} slots`,
    );
  }

  await upsert("announcements", [
    {
      id: seedId(`${EVENT_SLUG}/announcement/judging-starts`),
      event_id: eventId,
      body: "Judging starts at 10:00. Find your station on the board and be there 5 minutes early.",
      level: "info",
      active: true,
    },
  ]);

  const organizer = await ensureOrganizer(db);

  const members = teams.reduce((n, t) => n + t.members.length, 0);
  const count = (tracks: Sponsor[]) =>
    teams.filter((t) => tracks.every((s) => t.tracks.includes(s))).length;
  console.log(
    [
      `Seeded ${EVENT_NAME} (${EVENT_SLUG})`,
      `  ${teams.length} teams, ${members} members`,
      `  tracks: AWS ${count([AWS])}, A10 ${count([A10])}, both ${count([AWS, A10])}, ` +
        `neither ${teams.filter((t) => t.tracks.length === 0).length}`,
      `  ${JUDGES.length} judges on ${PANELS.length} panels`,
      ...summary.map((l) => `  ${l}`),
      `  organizer: ${organizer ?? "none (set SEED_ORGANIZER_EMAIL)"}`,
      `  sign in as a captain, e.g. ${teams[0].members[0].email} (team ${teams[0].name})`,
    ].join("\n"),
  );
}

// Creates the account if needed and makes it an organizer. The service role
// has no JWT, so the profile role-guard trigger allows the change.
async function ensureOrganizer(db: ReturnType<typeof createClient<Database>>) {
  const email = process.env.SEED_ORGANIZER_EMAIL?.trim().toLowerCase();
  if (!email) return null;
  const { data: profile, error } = await db
    .from("profiles")
    .select("user_id")
    .eq("email", email)
    .maybeSingle();
  if (error) throw error;
  let userId = profile?.user_id;
  if (!userId) {
    const { data, error: createError } = await db.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (createError) throw createError;
    userId = data.user.id;
  }
  const { error: roleError } = await db
    .from("profiles")
    .update({ role: "organizer" })
    .eq("user_id", userId);
  if (roleError) throw roleError;
  return email;
}

main().catch((err: unknown) => {
  console.error(
    `seed failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
