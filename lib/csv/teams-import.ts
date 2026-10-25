// Teams CSV import from the Google Form export (the check-in fallback).
// Pure: reads text, returns what it found and a plan; writes nothing.
//
// Required columns: team name, track selections. Optional: Devpost, GitHub,
// member emails, eligibility flags, timestamp. Columns are recognised by
// header text, and the result reports which header fed which field, so a
// renamed form question shows up as "ignored column", not silently lost data.

import { parseCsv } from "./csv.ts";

export type TrackDef = { name: string; sponsor: string | null };

export type ImportedTeam = {
  /** 1-based CSV line of the row this team came from (header is line 1). */
  line: number;
  name: string;
  /** Track names, as defined for the event. */
  tracks: string[];
  devpostUrl: string | null;
  githubUrls: string[];
  /** Lower-cased, de-duplicated; the submitter's address first if collected. */
  memberEmails: string[];
  hasGradStudent: boolean | null;
  allFreshmen: boolean | null;
  halfOrMoreNonMale: boolean | null;
  submittedAt: string | null;
};

type Field =
  | "timestamp"
  | "submitter"
  | "name"
  | "tracks"
  | "devpost"
  | "github"
  | "emails"
  | "grad"
  | "freshmen"
  | "nonMale";

// First match wins, so the specific patterns come first: "Email Address" is
// the address Google Forms collects from the submitter, and the eligibility
// questions are matched before "track|prize" so "(for the diversity prize)"
// in a question can't turn it into a track column.
const COLUMN_RULES: [Field, RegExp][] = [
  ["timestamp", /^timestamp$/i],
  ["submitter", /^email address$/i],
  ["name", /team\s*name|^name of (your )?team|^team$/i],
  ["grad", /grad(uate)?\s*student/i],
  ["freshmen", /freshm[ae]n|first[-\s]?year/i],
  ["nonMale", /non[-\s]?male|women|gender/i],
  ["devpost", /devpost/i],
  ["github", /git\s*hub|repo/i],
  ["tracks", /track|prize|categor/i],
  ["emails", /e-?mail/i],
];

export type ColumnReport = {
  mapped: { header: string; field: Field }[];
  ignored: string[];
};

export type ReadResult = {
  teams: ImportedTeam[];
  columns: ColumnReport;
  errors: { line: number | null; message: string }[];
  warnings: { line: number; message: string }[];
};

const EMAIL = /[^\s,;:<>()"']+@[^\s,;:<>()"']+\.[^\s,;:<>()"']+/g;
const URL_RE = /https?:\/\/[^\s,;<>"']+/g;
const NO_TRACK = /^(none|n\/?a|no|grand prize( only)?|general|-)$/i;

/** How team names are compared: trimmed, spaces collapsed, case and width folded. */
export function teamKey(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function cleanName(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function yesNo(cell: string): boolean | null {
  const v = cell.trim().toLowerCase();
  if (v === "") return null;
  if (/^(y|yes|true|1|x|✓|✔)\b/.test(v)) return true;
  if (/^(n|no|false|0)\b/.test(v)) return false;
  return null;
}

/**
 * Track cell -> track names. Google Forms joins checkbox answers with ", "
 * in one cell, and a track name may itself contain a comma, so known names
 * are matched longest first and removed; whatever is left over is reported.
 */
function readTracks(
  cell: string,
  tracks: TrackDef[],
): { names: string[]; unknown: string[] } {
  let rest = ` ${cell} `;
  const found: string[] = [];
  const byLength = [...tracks].sort((a, b) => b.name.length - a.name.length);
  for (const t of byLength) {
    const at = rest.toLowerCase().indexOf(t.name.toLowerCase());
    if (at >= 0) {
      found.push(t.name);
      rest = `${rest.slice(0, at)},${rest.slice(at + t.name.length)}`;
    }
  }
  const unknown: string[] = [];
  for (const token of rest.split(/[,;\n]/).map((s) => s.trim())) {
    if (!token || NO_TRACK.test(token)) continue;
    // A bare sponsor label ("AWS") also selects that sponsor's track.
    const bySponsor = tracks.find(
      (t) => t.sponsor?.toLowerCase() === token.toLowerCase(),
    );
    if (bySponsor && !found.includes(bySponsor.name))
      found.push(bySponsor.name);
    else if (!bySponsor) unknown.push(token);
  }
  // Report in the event's track order, not match order.
  const order = new Map(tracks.map((t, i) => [t.name, i]));
  return {
    names: found.sort((a, b) => order.get(a)! - order.get(b)!),
    unknown,
  };
}

export function readTeamsCsv(text: string, tracks: TrackDef[]): ReadResult {
  const errors: ReadResult["errors"] = [];
  const warnings: ReadResult["warnings"] = [];
  const rows = parseCsv(text).filter((r) => r.some((f) => f.trim() !== ""));
  if (rows.length === 0) {
    return {
      teams: [],
      columns: { mapped: [], ignored: [] },
      errors: [{ line: null, message: "The file is empty." }],
      warnings,
    };
  }

  const [header, ...body] = rows;
  const columns: ColumnReport = { mapped: [], ignored: [] };
  const fieldOf: (Field | null)[] = header.map((h) => {
    const rule = COLUMN_RULES.find(([, re]) => re.test(h.trim()));
    if (rule) columns.mapped.push({ header: h, field: rule[0] });
    else columns.ignored.push(h);
    return rule ? rule[0] : null;
  });
  const has = (f: Field) => fieldOf.includes(f);
  if (!has("name"))
    errors.push({ line: 1, message: "No team name column found." });
  if (!has("tracks"))
    errors.push({ line: 1, message: "No track selection column found." });
  if (errors.length) return { teams: [], columns, errors, warnings };

  const byKey = new Map<string, ImportedTeam>();
  body.forEach((cells, i) => {
    const line = i + 2;
    const all = (f: Field) =>
      fieldOf.flatMap((g, c) => (g === f ? [cells[c] ?? ""] : []));
    const first = (f: Field) => all(f)[0] ?? "";

    const name = cleanName(first("name"));
    if (!name) {
      errors.push({ line, message: "Row has no team name; skipped." });
      return;
    }
    const { names, unknown } = readTracks(all("tracks").join(", "), tracks);
    for (const u of unknown) {
      warnings.push({
        line,
        message: `"${name}": unrecognised track "${u}" ignored.`,
      });
    }
    const emails = [...all("submitter"), ...all("emails")]
      .flatMap((c) => c.match(EMAIL) ?? [])
      .map((e) => e.toLowerCase());
    const team: ImportedTeam = {
      line,
      name,
      tracks: names,
      devpostUrl: first("devpost").match(URL_RE)?.[0] ?? null,
      githubUrls: [
        ...new Set(all("github").flatMap((c) => c.match(URL_RE) ?? [])),
      ],
      memberEmails: [...new Set(emails)],
      hasGradStudent: has("grad") ? yesNo(first("grad")) : null,
      allFreshmen: has("freshmen") ? yesNo(first("freshmen")) : null,
      halfOrMoreNonMale: has("nonMale") ? yesNo(first("nonMale")) : null,
      submittedAt: first("timestamp").trim() || null,
    };

    // A team that submitted twice: the later row wins (forms are re-submitted
    // to fix a link), and the earlier one is reported.
    const key = teamKey(name);
    const earlier = byKey.get(key);
    if (earlier) {
      warnings.push({
        line,
        message: `"${name}" also appears on line ${earlier.line}; using this later row.`,
      });
    }
    byKey.set(key, team);
  });

  return {
    teams: [...byKey.values()].sort((a, b) => a.line - b.line),
    columns,
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Plan: what the import would do, against the teams already in the event.
// ---------------------------------------------------------------------------

export type ExistingTeam = {
  id: string;
  name: string;
  tracks: string[];
  devpostUrl: string | null;
  githubUrls: string[];
  memberEmails: string[];
  hasGradStudent: boolean | null;
  allFreshmen: boolean | null;
  halfOrMoreNonMale: boolean | null;
};

type Change<T> = { from: T; to: T };

export type TeamChanges = {
  tracks?: { added: string[]; removed: string[] };
  devpostUrl?: Change<string | null>;
  githubUrls?: { added: string[]; removed: string[] };
  memberEmails?: { added: string[]; removed: string[] };
  hasGradStudent?: Change<boolean | null>;
  allFreshmen?: Change<boolean | null>;
  halfOrMoreNonMale?: Change<boolean | null>;
};

export type ImportPlan = {
  create: ImportedTeam[];
  update: { id: string; name: string; line: number; changes: TeamChanges }[];
  unchanged: { id: string; name: string }[];
  /** Existing teams the CSV doesn't mention; the import leaves them alone. */
  notInCsv: { id: string; name: string }[];
};

function setDiff(from: string[], to: string[]) {
  const a = new Set(from);
  const b = new Set(to);
  const added = to.filter((x) => !a.has(x));
  const removed = from.filter((x) => !b.has(x));
  return added.length || removed.length ? { added, removed } : undefined;
}

/**
 * Matches imported teams to existing ones by name (teamKey) and reports what
 * would be created and what would change, field by field. Only fields whose
 * column exists in the CSV are compared, so a form without a Devpost
 * question never proposes clearing Devpost links.
 */
export function planTeamImport(
  read: Pick<ReadResult, "teams" | "columns">,
  existing: ExistingTeam[],
): ImportPlan {
  const present = new Set(read.columns.mapped.map((m) => m.field));
  const byKey = new Map(existing.map((t) => [teamKey(t.name), t]));
  const seen = new Set<string>();
  const plan: ImportPlan = {
    create: [],
    update: [],
    unchanged: [],
    notInCsv: [],
  };

  for (const team of read.teams) {
    const match = byKey.get(teamKey(team.name));
    if (!match) {
      plan.create.push(team);
      continue;
    }
    seen.add(match.id);
    const changes: TeamChanges = {};
    const tracks = setDiff(match.tracks, team.tracks);
    if (tracks) changes.tracks = tracks;
    if (present.has("devpost") && match.devpostUrl !== team.devpostUrl) {
      changes.devpostUrl = { from: match.devpostUrl, to: team.devpostUrl };
    }
    if (present.has("github")) {
      const d = setDiff(match.githubUrls, team.githubUrls);
      if (d) changes.githubUrls = d;
    }
    if (present.has("emails") || present.has("submitter")) {
      const d = setDiff(
        match.memberEmails.map((e) => e.toLowerCase()),
        team.memberEmails,
      );
      if (d) changes.memberEmails = d;
    }
    for (const [field, column] of [
      ["hasGradStudent", "grad"],
      ["allFreshmen", "freshmen"],
      ["halfOrMoreNonMale", "nonMale"],
    ] as const) {
      if (present.has(column) && match[field] !== team[field]) {
        changes[field] = { from: match[field], to: team[field] };
      }
    }
    if (Object.keys(changes).length) {
      plan.update.push({
        id: match.id,
        name: match.name,
        line: team.line,
        changes,
      });
    } else {
      plan.unchanged.push({ id: match.id, name: match.name });
    }
  }
  for (const t of existing)
    if (!seen.has(t.id)) plan.notInCsv.push({ id: t.id, name: t.name });
  return plan;
}
