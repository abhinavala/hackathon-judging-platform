// Teams CSV import from the Google Form export (the check-in fallback).
// Pure: reads text, returns what it found and a plan; writes nothing.
//
// Two form shapes are supported:
//   - the OLD form (as exported in 2026): no team-name column; the submitter's
//     email and full name, phone, team size, teammates' NAMES, eligibility,
//     prizes, GitHub, comments;
//   - the NEW form, which adds a team name, a Devpost link and teammates'
//     EMAILS.
//
// What the real export does that a naive reader gets wrong:
//   - Header cells contain the question's help text after a line break, so
//     the header row spans several physical lines (parseCsvRecords handles
//     quoting first; columns are matched on each header's first line).
//   - Rows are not in time order (a 3/1 response sits between 2/28 rows), so
//     re-submissions are resolved by the PARSED timestamp, not by row order.
//   - Teammate lists use commas, semicolons, periods and line breaks, with or
//     without the submitter listed; everything parsed is reported.
//   - GitHub links come with and without https://, several to a cell.

import { parseCsvRecords } from "./csv.ts";

export type TrackDef = { name: string; sponsor: string | null };

export type ImportedTeam = {
  /** Physical CSV line this response starts on. */
  line: number;
  /** null for the old form: the organizer must resolve it (never invented). */
  name: string | null;
  submitter: { email: string | null; fullName: string | null };
  /** Lower-cased, de-duplicated; the submitter first. */
  memberEmails: string[];
  /** Old form: teammates by name, as parsed (submitter removed). */
  teammateNames: string[];
  /** The submitter listed themselves among their teammates. */
  listedThemselves: boolean;
  declaredSize: number | null;
  /** Track names, in the event's track order. */
  tracks: string[];
  devpostUrl: string | null;
  githubUrls: string[];
  contactPhone: string | null;
  hasGradStudent: boolean | null;
  allFreshmen: boolean | null;
  halfOrMoreNonMale: boolean | null;
  /** "YYYY-MM-DDTHH:MM:SS", wall-clock time as the form recorded it. */
  submittedAt: string | null;
  comments: string | null;
  /** Lines of earlier responses from the same team that this one replaces. */
  supersedes: number[];
};

export type Field =
  | "timestamp"
  | "submitter"
  | "submitterName"
  | "phone"
  | "teamSize"
  | "name"
  | "teammateEmails"
  | "teammateNames"
  | "grad"
  | "freshmen"
  | "nonMale"
  | "devpost"
  | "github"
  | "tracks"
  | "comments"
  | "emails";

// First match wins, tried against each header's FIRST line (the question),
// then against its full text (with help text). Specific rules come first:
// "Email Address" is what Google Forms collects from the submitter; the
// teammates question is checked before the generic email rule; eligibility
// questions before "track|prize" so a "(diversity prize)" aside can't turn
// one into a track column.
const COLUMN_RULES: [Field, RegExp][] = [
  ["timestamp", /^timestamp$/i],
  ["submitter", /^email address$/i],
  ["submitterName", /^(your )?full name$|^(your )?name$/i],
  ["phone", /phone/i],
  [
    "teamSize",
    /how many (people|members)|team size|number of (team )?members/i,
  ],
  ["teammateEmails", /teammates?.*e-?mails?|e-?mails?.*teammates?/i],
  ["teammateNames", /teammates?|team members|members of your team/i],
  ["name", /team\s*name|name of (your )?team|^team$/i],
  ["grad", /grad(uate)?\s*student/i],
  ["freshmen", /freshm[ae]n|first[-\s]?year/i],
  ["nonMale", /non[-\s]?male|women|gender/i],
  ["devpost", /devpost/i],
  ["github", /git\s*hub|repositor/i],
  ["tracks", /track|prize|categor/i],
  ["comments", /question|comment|anything else/i],
  ["emails", /e-?mail/i],
];

export type ColumnReport = {
  /** header: the question's first line; full help text is not repeated. */
  mapped: { header: string; field: Field }[];
  ignored: string[];
  /** "old" without a team-name column, "new" with one. */
  shape: "old" | "new";
};

export type ImportMessage = { line: number | null; message: string };

export type ReadResult = {
  teams: ImportedTeam[];
  columns: ColumnReport;
  errors: ImportMessage[];
  warnings: ImportMessage[];
};

const EMAIL = /[^\s,;:<>()"']+@[^\s,;:<>()"']+\.[^\s,;:<>()"'.]+/g;
const NOTHING = /^(none|n\/?a|no|nope|nothing|-+|\.)$/i;
const NO_TRACK = /^(none|n\/?a|no|grand prize( only)?|general|-)$/i;

/** How team names are compared: trimmed, spaces collapsed, case and width folded. */
export function teamKey(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

const personKey = teamKey;

function clean(s: string): string {
  return s.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function yesNo(cell: string): boolean | null {
  const v = cell.trim().toLowerCase();
  if (v === "") return null;
  if (/^(y|yes|true|1|x|✓|✔)\b/.test(v)) return true;
  if (/^(n|no|false|0)\b/.test(v)) return false;
  return null;
}

/** "2/28/2026 10:38:27" (M/D/YYYY H:MM:SS, no leading zeros) -> "2026-02-28T10:38:27". */
export function parseFormTimestamp(cell: string): string | null {
  const m =
    /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/.exec(
      cell,
    );
  if (!m) return null;
  const [, mo, d, y, h, mi, s] = m;
  const p = (x: string | undefined) => (x ?? "0").padStart(2, "0");
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +h > 23 || +mi > 59)
    return null;
  return `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:${p(s)}`;
}

/**
 * A teammates cell -> names. Line breaks, commas and semicolons always
 * separate; ". " separates when the word before it has two or more letters,
 * so "Mary Jackson. Dorothy Vaughan" splits but "John F. Kennedy" doesn't.
 */
export function splitPeople(cell: string): string[] {
  return cell
    .replace(/\r/g, "")
    .replace(/(\p{L}{2,})\.\s+(?=\p{Lu})/gu, "$1\n")
    .split(/[\n;,]+/)
    .map(clean)
    .filter((s) => s && !NOTHING.test(s));
}

/** Links on `host` (and other http links) from a cell, with or without a scheme. */
export function readLinks(cell: string, host: string): string[] {
  const out: string[] = [];
  const bareHost = new RegExp(
    `^(?:https?://)?(?:www\\.)?(${host.replace(/\./g, "\\.")}/\\S+)$`,
    "i",
  );
  for (const token of cell.split(/[\s,;]+/)) {
    const t = token.replace(/[).,;]+$/, "");
    if (!t) continue;
    const bare = bareHost.exec(t);
    if (bare) out.push(`https://${bare[1]}`);
    else if (/^https?:\/\/\S+$/i.test(t)) out.push(t);
  }
  return [...new Set(out)];
}

/**
 * Track cell -> track names. Google Forms joins checkbox answers with ", "
 * in one cell, and track names can contain commas or share prefixes ("Best
 * Use of ..."), so known names are matched longest first and removed;
 * whatever is left over is reported. An empty cell means grand prize only.
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
  const order = new Map(tracks.map((t, i) => [t.name, i]));
  return {
    names: found.sort((a, b) => order.get(a)! - order.get(b)!),
    unknown,
  };
}

export function readTeamsCsv(text: string, tracks: TrackDef[]): ReadResult {
  const errors: ImportMessage[] = [];
  const warnings: ImportMessage[] = [];
  const empty: ColumnReport = { mapped: [], ignored: [], shape: "old" };
  let records: { fields: string[]; line: number }[];
  try {
    records = parseCsvRecords(text).filter((r) =>
      r.fields.some((f) => f.trim() !== ""),
    );
  } catch (e) {
    const message = `Not a readable CSV: ${e instanceof Error ? e.message : String(e)}`;
    return {
      teams: [],
      columns: empty,
      errors: [{ line: null, message }],
      warnings,
    };
  }
  if (records.length === 0) {
    return {
      teams: [],
      columns: empty,
      errors: [{ line: null, message: "The file is empty." }],
      warnings,
    };
  }

  const [header, ...body] = records;
  const columns: ColumnReport = { mapped: [], ignored: [], shape: "old" };
  const fieldOf: (Field | null)[] = header.fields.map((raw) => {
    const question = clean(raw.split("\n")[0]);
    const rule =
      COLUMN_RULES.find(([, re]) => re.test(question)) ??
      COLUMN_RULES.find(([, re]) => re.test(clean(raw)));
    if (rule) columns.mapped.push({ header: question, field: rule[0] });
    else columns.ignored.push(question);
    return rule ? rule[0] : null;
  });
  const has = (f: Field) => fieldOf.includes(f);
  columns.shape = has("name") ? "new" : "old";
  if (!has("tracks")) {
    errors.push({
      line: header.line,
      message: "No prize/track selection column found.",
    });
  }
  if (!has("name") && !has("submitter")) {
    errors.push({
      line: header.line,
      message:
        "Neither a team name nor the submitter's email address is in the file.",
    });
  }
  if (errors.length) return { teams: [], columns, errors, warnings };

  const parsed: ImportedTeam[] = [];
  for (const { fields: cells, line } of body) {
    const all = (f: Field) =>
      fieldOf.flatMap((g, c) => (g === f ? [cells[c] ?? ""] : []));
    const first = (f: Field) => all(f)[0] ?? "";
    const emailsIn = (cellsOf: string[]) =>
      cellsOf.flatMap((c) => c.match(EMAIL) ?? []).map((e) => e.toLowerCase());

    const name = has("name") ? clean(first("name")) || null : null;
    const submitterEmail = emailsIn([first("submitter")])[0] ?? null;
    const submitterName = clean(first("submitterName")) || null;
    const label = name ?? submitterName ?? submitterEmail ?? `line ${line}`;
    if (has("name") && !name) {
      errors.push({ line, message: "Response has no team name; skipped." });
      continue;
    }
    if (!name && !submitterEmail) {
      errors.push({
        line,
        message:
          "Response has neither a team name nor a submitter email; skipped.",
      });
      continue;
    }

    const rawTimestamp = first("timestamp").trim();
    const submittedAt = rawTimestamp ? parseFormTimestamp(rawTimestamp) : null;
    if (rawTimestamp && !submittedAt) {
      warnings.push({
        line,
        message: `${label}: unreadable timestamp "${rawTimestamp}".`,
      });
    }

    const { names: trackNames, unknown } = readTracks(
      all("tracks").join(", "),
      tracks,
    );
    for (const u of unknown) {
      warnings.push({
        line,
        message: `${label}: unrecognised prize "${u}" ignored.`,
      });
    }

    // Teammates: names (old form) or emails (new form); drop the submitter.
    const mateEmails = emailsIn(all("teammateEmails"));
    let mateNames = all("teammateNames").flatMap(splitPeople);
    let listedThemselves = false;
    if (
      submitterName &&
      mateNames.some((n) => personKey(n) === personKey(submitterName))
    ) {
      listedThemselves = true;
      mateNames = mateNames.filter(
        (n) => personKey(n) !== personKey(submitterName),
      );
    }
    if (submitterEmail && mateEmails.includes(submitterEmail))
      listedThemselves = true;
    const memberEmails = [
      ...new Set([
        ...(submitterEmail ? [submitterEmail] : []),
        ...mateEmails,
        ...emailsIn(all("emails")),
      ]),
    ];
    const uniqueNames = [
      ...new Map(mateNames.map((n) => [personKey(n), n])).values(),
    ];

    const sizeCell = first("teamSize").trim();
    const declaredSize = /^\d+$/.test(sizeCell) ? Number(sizeCell) : null;
    if (sizeCell && declaredSize === null) {
      warnings.push({
        line,
        message: `${label}: team size "${sizeCell}" isn't a number.`,
      });
    }
    const counted = has("teammateEmails")
      ? memberEmails.length
      : has("teammateNames")
        ? 1 + uniqueNames.length
        : null;
    if (declaredSize !== null && counted !== null && declaredSize !== counted) {
      warnings.push({
        line,
        message: `${label}: says ${declaredSize} people but lists ${counted} (including the submitter).`,
      });
    }

    const comments = clean(first("comments"));
    parsed.push({
      line,
      name,
      submitter: { email: submitterEmail, fullName: submitterName },
      memberEmails,
      teammateNames: uniqueNames,
      listedThemselves,
      declaredSize,
      tracks: trackNames,
      devpostUrl: readLinks(first("devpost"), "devpost.com")[0] ?? null,
      githubUrls: [
        ...new Set(all("github").flatMap((c) => readLinks(c, "github.com"))),
      ],
      contactPhone: clean(first("phone")) || null,
      hasGradStudent: has("grad") ? yesNo(first("grad")) : null,
      allFreshmen: has("freshmen") ? yesNo(first("freshmen")) : null,
      halfOrMoreNonMale: has("nonMale") ? yesNo(first("nonMale")) : null,
      submittedAt,
      comments: comments && !NOTHING.test(comments) ? comments : null,
      supersedes: [],
    });
  }

  // Re-submissions: the same team (by name, or by submitter email on the old
  // form) keeps the response with the LATEST parsed timestamp. Row order is
  // no guide: the export is not sorted. Equal or unreadable timestamps fall
  // back to the later line.
  const keyOf = (t: ImportedTeam) =>
    t.name ? `name:${teamKey(t.name)}` : `email:${t.submitter.email}`;
  const isNewer = (a: ImportedTeam, b: ImportedTeam) =>
    a.submittedAt && b.submittedAt && a.submittedAt !== b.submittedAt
      ? a.submittedAt > b.submittedAt
      : a.line > b.line;
  const at = (t: ImportedTeam) =>
    `line ${t.line}${t.submittedAt ? ` (${t.submittedAt.replace("T", " ")})` : ""}`;
  const byKey = new Map<string, ImportedTeam>();
  for (const t of parsed) {
    const prev = byKey.get(keyOf(t));
    if (!prev) {
      byKey.set(keyOf(t), t);
      continue;
    }
    const [keep, drop] = isNewer(t, prev) ? [t, prev] : [prev, t];
    keep.supersedes = [...keep.supersedes, ...drop.supersedes, drop.line].sort(
      (a, b) => a - b,
    );
    byKey.set(keyOf(t), keep);
    const who = keep.name ?? keep.submitter.fullName ?? keep.submitter.email;
    warnings.push({
      line: keep.line,
      message: `${who} submitted more than once: using ${at(keep)}, replacing ${at(drop)}.`,
    });
  }

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
  contactPhone: string | null;
  hasGradStudent: boolean | null;
  allFreshmen: boolean | null;
  halfOrMoreNonMale: boolean | null;
};

type Change<T> = { from: T; to: T };

export type TeamChanges = {
  tracks?: { added: string[]; removed: string[] };
  devpostUrl?: Change<string | null>;
  githubUrls?: { added: string[]; removed: string[] };
  /** Members are only ever added by an import, never removed. */
  memberEmails?: { added: string[] };
  contactPhone?: Change<string | null>;
  hasGradStudent?: Change<boolean | null>;
  allFreshmen?: Change<boolean | null>;
  halfOrMoreNonMale?: Change<boolean | null>;
};

export type ImportPlan = {
  create: (ImportedTeam & { name: string })[];
  update: {
    id: string;
    name: string;
    line: number;
    matchedBy: "name" | "member email";
    team: ImportedTeam;
    changes: TeamChanges;
  }[];
  unchanged: { id: string; name: string; line: number }[];
  /** Old-form responses matching no existing team: a name must be given. */
  needsName: ImportedTeam[];
  /** Two responses resolved to the same name. */
  conflicts: ImportMessage[];
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
 * Matches responses to existing teams and reports what would be created and
 * what would change, field by field. A response with a team name matches by
 * name; an old-form response without one matches the existing team its
 * submitter already belongs to, or else waits in needsName until the
 * organizer supplies a name (`names`, keyed by CSV line). Only fields whose
 * column exists in the CSV are compared, so a form without a Devpost
 * question never proposes clearing Devpost links.
 */
export function planTeamImport(
  read: Pick<ReadResult, "teams" | "columns">,
  existing: ExistingTeam[],
  names: Map<number, string> = new Map(),
): ImportPlan {
  const present = new Set(read.columns.mapped.map((m) => m.field));
  const byName = new Map(existing.map((t) => [teamKey(t.name), t]));
  const byMember = new Map(
    existing.flatMap((t) =>
      t.memberEmails.map((e) => [e.toLowerCase(), t] as const),
    ),
  );
  const seen = new Set<string>();
  const claimed = new Map<string, number>();
  const plan: ImportPlan = {
    create: [],
    update: [],
    unchanged: [],
    needsName: [],
    conflicts: [],
    notInCsv: [],
  };

  for (const team of read.teams) {
    const given = names.get(team.line)?.trim();
    let match: ExistingTeam | undefined;
    let matchedBy: "name" | "member email" = "name";
    let name = team.name ?? (given ? clean(given) : null);
    if (name) {
      match = byName.get(teamKey(name));
    } else if (team.submitter.email && byMember.has(team.submitter.email)) {
      match = byMember.get(team.submitter.email)!;
      matchedBy = "member email";
      name = match.name;
    }
    if (!name) {
      plan.needsName.push(team);
      continue;
    }
    const k = teamKey(name);
    if (claimed.has(k)) {
      plan.conflicts.push({
        line: team.line,
        message: `"${name}" is also used for line ${claimed.get(k)}.`,
      });
      continue;
    }
    claimed.set(k, team.line);

    if (!match) {
      plan.create.push({ ...team, name });
      continue;
    }
    seen.add(match.id);
    const changes: TeamChanges = {};
    if (present.has("tracks")) {
      const d = setDiff(match.tracks, team.tracks);
      if (d) changes.tracks = d;
    }
    if (present.has("devpost") && match.devpostUrl !== team.devpostUrl) {
      changes.devpostUrl = { from: match.devpostUrl, to: team.devpostUrl };
    }
    if (present.has("github")) {
      const d = setDiff(match.githubUrls, team.githubUrls);
      if (d) changes.githubUrls = d;
    }
    const known = new Set(match.memberEmails.map((e) => e.toLowerCase()));
    const newMembers = team.memberEmails.filter((e) => !known.has(e));
    if (newMembers.length) changes.memberEmails = { added: newMembers };
    if (
      present.has("phone") &&
      team.contactPhone &&
      match.contactPhone !== team.contactPhone
    ) {
      changes.contactPhone = {
        from: match.contactPhone,
        to: team.contactPhone,
      };
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
        matchedBy,
        team,
        changes,
      });
    } else {
      plan.unchanged.push({ id: match.id, name: match.name, line: team.line });
    }
  }
  for (const t of existing)
    if (!seen.has(t.id)) plan.notInCsv.push({ id: t.id, name: t.name });
  return plan;
}
