// The two CSVs AWS sends, read into the access-code pool (0015). Pure, so it
// is tested directly; the organizer sees exactly this as a preview before
// anything is written, so a wrong column mapping is visible, not loaded.
//
//   Kiro credits:  bonusCode, bonusName, bonusAmount, validFrom, validUntil,
//                  expirationDate, redemptionUrl            (one per person)
//   Workshop:      Team name, Team code, Participant count, Participant IDs,
//                  State, Deployment duration, AWS account ID, Join event
//                  URL, Last joined, Last account login, Last updated
//                                                            (one per team)
//
// Participant IDs are never stored. The workshop file is re-exported on
// Saturday to see which teams nobody has joined yet, so importing the same
// codes again updates them; it never adds a second copy.

import { parseCsvRecords } from "./csv.ts";

export type CodeKind = "workshop" | "kiro";

export const KIRO_CREDITS = 1000;

type Field =
  | "code"
  | "joinUrl"
  | "awsTeamName"
  | "awsAccountId"
  | "state"
  | "participantCount"
  | "lastJoined"
  | "redemptionUrl"
  | "amount"
  | "expires"
  | "detail"
  | "never";

type Spec = { header: string; field: Field; required?: boolean; note: string };

const KIRO: Spec[] = [
  {
    header: "bonusCode",
    field: "code",
    required: true,
    note: "the code, shown to that person",
  },
  { header: "bonusName", field: "detail", note: "kept for reconciling" },
  {
    header: "bonusAmount",
    field: "amount",
    note: `credits; expected ${KIRO_CREDITS}`,
  },
  { header: "validFrom", field: "detail", note: "kept for reconciling" },
  {
    header: "validUntil",
    field: "detail",
    note: "checked: warns if already past",
  },
  { header: "expirationDate", field: "expires", note: "shown to that person" },
  {
    header: "redemptionUrl",
    field: "redemptionUrl",
    required: true,
    note: "the link that person taps to redeem",
  },
];

const WORKSHOP: Spec[] = [
  {
    header: "Team name",
    field: "awsTeamName",
    note: "AWS's label: organizers only, never shown to a team",
  },
  {
    header: "Team code",
    field: "code",
    required: true,
    note: "the fallback code, shown to the team",
  },
  {
    header: "Participant count",
    field: "participantCount",
    note: "who has joined (organizers)",
  },
  {
    header: "Participant IDs",
    field: "never",
    note: "NOT stored, never shown",
  },
  { header: "State", field: "state", note: "organizers only" },
  {
    header: "Deployment duration",
    field: "detail",
    note: "kept for reconciling",
  },
  {
    header: "AWS account ID",
    field: "awsAccountId",
    note: "organizers only, for support",
  },
  {
    header: "Join event URL",
    field: "joinUrl",
    required: true,
    note: "the team's own join link: the main button",
  },
  { header: "Last joined", field: "lastJoined", note: "organizers only" },
  {
    header: "Last account login",
    field: "detail",
    note: "kept for reconciling",
  },
  { header: "Last updated", field: "detail", note: "kept for reconciling" },
];

export type CodeRow = {
  line: number;
  code: string;
  joinUrl: string | null;
  awsTeamName: string | null;
  awsAccountId: string | null;
  state: string | null;
  participantCount: number | null;
  lastJoined: string | null;
  redemptionUrl: string | null;
  amount: number | null;
  /** ISO, when expirationDate was a readable date. */
  expiresAt: string | null;
  /** As written, when it wasn't. */
  expiresText: string | null;
  details: Record<string, string>;
};

export type ColumnUse = {
  header: string;
  /** Where it goes, in words; null = not recognised, not stored. */
  use: string | null;
};

export type ParsedCodes =
  | {
      ok: true;
      kind: CodeKind;
      columns: ColumnUse[];
      rows: CodeRow[];
      /** Worth reading before importing; none of them stop it. */
      warnings: string[];
    }
  | { ok: false; error: string; headers: string[] };

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

const lines = (ns: number[]) =>
  `line${ns.length === 1 ? "" : "s"} ${ns.slice(0, 6).join(", ")}${ns.length > 6 ? ` and ${ns.length - 6} more` : ""}`;

/** Reads either file; which one it is comes from the header row. */
export function parseCodesCsv(text: string, now: number): ParsedCodes {
  let records: { fields: string[]; line: number }[];
  try {
    records = parseCsvRecords(text);
  } catch (e) {
    return {
      ok: false,
      error: `That isn't readable CSV: ${e instanceof Error ? e.message : e}.`,
      headers: [],
    };
  }
  records = records.filter((r) => r.fields.some((f) => f.trim()));
  if (records.length === 0)
    return { ok: false, error: "Paste the CSV first.", headers: [] };
  const headers = records[0].fields.map((h) => h.trim());
  const have = new Map(headers.map((h, i) => [norm(h), i]));
  const isKiro = have.has("bonuscode");
  const isWorkshop = have.has("teamcode");
  if (isKiro === isWorkshop)
    return {
      ok: false,
      error: isKiro
        ? "This has both bonusCode and Team code columns: paste one file at a time."
        : "This isn't either AWS file: a Kiro file has a bonusCode column, a workshop file a Team code column.",
      headers,
    };
  const kind: CodeKind = isKiro ? "kiro" : "workshop";
  const specs = isKiro ? KIRO : WORKSHOP;

  const missingRequired = specs.filter(
    (s) => s.required && !have.has(norm(s.header)),
  );
  if (missingRequired.length)
    return {
      ok: false,
      error: `The ${kind === "kiro" ? "Kiro" : "workshop"} file needs ${missingRequired.map((s) => `"${s.header}"`).join(" and ")}, and this one has no such column. Nothing was read.`,
      headers,
    };

  const known = new Map(specs.map((s) => [norm(s.header), s]));
  const columns: ColumnUse[] = headers.map((h) => {
    const s = known.get(norm(h));
    return { header: h, use: s ? s.note : null };
  });
  const warnings: string[] = [];
  const absent = specs.filter((s) => !have.has(norm(s.header)));
  if (absent.length)
    warnings.push(
      `Not in this file: ${absent.map((s) => s.header).join(", ")}.`,
    );
  const unknown = columns.filter((c) => c.use === null && c.header);
  if (unknown.length)
    warnings.push(
      `Not recognised, so not stored: ${unknown.map((c) => c.header).join(", ")}.`,
    );

  const cell = (r: string[], header: string) => {
    const i = have.get(norm(header));
    const v = i === undefined ? "" : (r[i] ?? "").trim();
    return v || null;
  };

  const rows: CodeRow[] = [];
  const seen = new Map<string, number>();
  const blank: number[] = [];
  const dupes: number[] = [];
  const badAmount: number[] = [];
  const expired: number[] = [];
  const unreadableDate: number[] = [];
  const badUrl: number[] = [];
  const urlWithoutCode: number[] = [];
  const notWorkshopsHost: number[] = [];

  for (const { fields: r, line } of records.slice(1)) {
    const code = cell(r, kind === "kiro" ? "bonusCode" : "Team code");
    if (!code) {
      blank.push(line);
      continue;
    }
    if (seen.has(code)) {
      dupes.push(line);
      continue;
    }
    seen.set(code, line);
    const details: Record<string, string> = {};
    for (const s of specs)
      if (s.field === "detail") {
        const v = cell(r, s.header);
        if (v) details[s.header] = v;
      }
    const row: CodeRow = {
      line,
      code,
      joinUrl: null,
      awsTeamName: null,
      awsAccountId: null,
      state: null,
      participantCount: null,
      lastJoined: null,
      redemptionUrl: null,
      amount: null,
      expiresAt: null,
      expiresText: null,
      details,
    };
    if (kind === "kiro") {
      const amount = cell(r, "bonusAmount");
      row.amount =
        amount !== null && /^\d+(\.0+)?$/.test(amount.replace(/,/g, ""))
          ? Number(amount.replace(/,/g, ""))
          : null;
      if (row.amount !== KIRO_CREDITS) badAmount.push(line);
      row.redemptionUrl = cell(r, "redemptionUrl");
      if (!isHttp(row.redemptionUrl)) badUrl.push(line);
      const exp = cell(r, "expirationDate");
      if (exp) {
        const t = readDate(exp);
        if (t === null) {
          row.expiresText = exp;
          unreadableDate.push(line);
        } else {
          row.expiresAt = new Date(t).toISOString();
          details.expirationDate = exp;
        }
      }
      const until = readDate(cell(r, "validUntil") ?? "");
      const expT = row.expiresAt ? Date.parse(row.expiresAt) : null;
      if ((expT !== null && expT < now) || (until !== null && until < now))
        expired.push(line);
    } else {
      row.joinUrl = cell(r, "Join event URL");
      row.awsTeamName = cell(r, "Team name");
      row.awsAccountId = cell(r, "AWS account ID");
      row.state = cell(r, "State");
      const n = cell(r, "Participant count");
      row.participantCount = n !== null && /^\d+$/.test(n) ? Number(n) : null;
      row.lastJoined = cell(r, "Last joined");
      if (!isHttp(row.joinUrl)) badUrl.push(line);
      else {
        if (!row.joinUrl!.includes(code)) urlWithoutCode.push(line);
        if (!/(^|\.)workshops\.aws$/.test(new URL(row.joinUrl!).hostname))
          notWorkshopsHost.push(line);
      }
    }
    rows.push(row);
  }

  if (rows.length === 0)
    return {
      ok: false,
      error: "The file has a header row but no codes.",
      headers,
    };
  if (blank.length) warnings.push(`No code on ${lines(blank)}: skipped.`);
  if (dupes.length)
    warnings.push(
      `The same code appears again on ${lines(dupes)}: kept the first.`,
    );
  if (badAmount.length)
    warnings.push(
      `bonusAmount isn't ${KIRO_CREDITS} on ${lines(badAmount)}. Check with AWS before handing these out.`,
    );
  if (expired.length)
    warnings.push(
      `${expired.length} code${expired.length === 1 ? " is" : "s are"} already expired (${lines(expired)}).`,
    );
  if (unreadableDate.length)
    warnings.push(
      `expirationDate isn't a date this can read on ${lines(unreadableDate)}: shown to people as written.`,
    );
  if (badUrl.length)
    warnings.push(
      `${kind === "kiro" ? "redemptionUrl" : "Join event URL"} isn't a web link on ${lines(badUrl)}: ${kind === "kiro" ? "those people only get the code" : "those teams only get the code"}.`,
    );
  if (urlWithoutCode.length)
    warnings.push(
      `The Join event URL doesn't contain the team's code on ${lines(urlWithoutCode)}. A team's own link embeds its code; one that doesn't may be the event-wide one-click link, which puts people on random teams. Check with AWS before importing.`,
    );
  if (notWorkshopsHost.length)
    warnings.push(
      `The Join event URL isn't on workshops.aws on ${lines(notWorkshopsHost)}.`,
    );

  return { ok: true, kind, columns, rows, warnings };
}

function isHttp(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** ISO, "2026-11-30 23:59:59", "11/30/2026" ... -> ms, or null. */
function readDate(raw: string): number | null {
  const v = raw.trim();
  if (!v) return null;
  const t = Date.parse(
    /^\d{4}-\d{2}-\d{2} \d/.test(v) ? v.replace(" ", "T") : v,
  );
  return Number.isNaN(t) ? null : t;
}

export type ExistingCode = { code: string; claimed: boolean };

export type CodePlan = {
  added: number;
  updated: number;
  /** Already claimed: their details update, the claim never moves. */
  updatedClaimed: number;
  /** In the pool but not in this file (left as they are). */
  notInFile: number;
};

/** What importing this file would do to the pool of the same kind. */
export function planCodes(rows: CodeRow[], existing: ExistingCode[]): CodePlan {
  const pool = new Map(existing.map((e) => [e.code, e]));
  let added = 0;
  let updated = 0;
  let updatedClaimed = 0;
  const inFile = new Set<string>();
  for (const r of rows) {
    inFile.add(r.code);
    const e = pool.get(r.code);
    if (!e) added++;
    else if (e.claimed) updatedClaimed++;
    else updated++;
  }
  return {
    added,
    updated,
    updatedClaimed,
    notInFile: existing.filter((e) => !inFile.has(e.code)).length,
  };
}
