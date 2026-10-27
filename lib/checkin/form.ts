// The public check-in form: field names, limits, and validation. Pure, so it
// is tested directly and the page and the route handler agree on one shape.
//
// Every problem is reported at once, keyed by field, so the page can show
// each message next to its input. Imports are relative with .ts extensions
// so node --test runs it.

import { normalizeEmail } from "../auth/email.ts";

/** Including the captain. */
export const MAX_TEAM_SIZE = 6;
export const TEAMMATE_ROWS = MAX_TEAM_SIZE - 1;
const MAX_GITHUB = 5;

export type CheckInTrack = { id: string; name: string };

export type CheckIn = {
  teamName: string;
  captain: { name: string; email: string; phone: string | null };
  teammates: { name: string | null; email: string }[];
  devpostUrl: string | null;
  githubUrls: string[];
  trackIds: string[];
  hasGradStudent: boolean;
  allFreshmen: boolean;
  halfOrMoreNonMale: boolean;
  notes: string | null;
};

export type FieldErrors = Record<string, string>;

/** What a browser submits: one value per name, or several (checkboxes). */
export type FormFields = Record<string, string | string[] | undefined>;

export function fieldsFromFormData(form: FormData): FormFields {
  const out: FormFields = {};
  for (const key of new Set(form.keys())) {
    const all = form.getAll(key).map(String);
    out[key] = all.length > 1 || key === "track" ? all : all[0];
  }
  return out;
}

const one = (f: FormFields, k: string) => {
  const v = f[k];
  return (Array.isArray(v) ? v[0] : (v ?? "")).trim().replace(/\s+/g, " ");
};

export function parseCheckIn(
  f: FormFields,
  tracks: CheckInTrack[],
): { ok: true; value: CheckIn } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};

  // A field people can't see; bots fill it in. Reported like any error so a
  // bot learns nothing, and nothing is written.
  if (one(f, "website"))
    errors.form = "Something went wrong. Please try again.";

  const teamName = one(f, "teamName");
  if (!teamName) errors.teamName = "Enter your team's name.";
  else if (teamName.length > 60)
    errors.teamName = "Keep the team name under 60 characters.";

  const captainName = one(f, "captainName");
  if (!captainName) errors.captainName = "Enter your name.";
  else if (captainName.length > 100)
    errors.captainName = "That name is too long.";

  const rawCaptainEmail = one(f, "captainEmail");
  const captainEmail = normalizeEmail(rawCaptainEmail);
  if (!rawCaptainEmail) errors.captainEmail = "Enter your email address.";
  else if (!captainEmail)
    errors.captainEmail = "That doesn't look like an email address.";

  const phone = one(f, "phone");
  if (phone && !/^[+()\d][\d\s().+-]{6,24}$/.test(phone))
    errors.phone = "Enter a phone number, or leave it blank.";

  const seen = new Set(captainEmail ? [captainEmail] : []);
  const teammates: CheckIn["teammates"] = [];
  for (let i = 1; i <= TEAMMATE_ROWS; i++) {
    const name = one(f, `teammateName${i}`);
    const raw = one(f, `teammateEmail${i}`);
    if (!raw && !name) continue;
    const email = normalizeEmail(raw);
    if (!raw)
      errors[`teammateEmail${i}`] =
        `Add ${name}'s email, so we can invite them.`;
    else if (!email)
      errors[`teammateEmail${i}`] = "That doesn't look like an email address.";
    else if (seen.has(email))
      errors[`teammateEmail${i}`] =
        email === captainEmail
          ? "That's your own address."
          : "This address is listed twice.";
    else {
      seen.add(email);
      teammates.push({ name: name || null, email });
    }
    if (name.length > 100)
      errors[`teammateName${i}`] = "That name is too long.";
  }

  const devpost = one(f, "devpostUrl");
  let devpostUrl: string | null = null;
  if (devpost) {
    const u = url(devpost);
    if (!u || !/(^|\.)devpost\.com$/.test(u.hostname))
      errors.devpostUrl =
        "Paste your project's devpost.com link, or leave it blank.";
    else devpostUrl = u.toString();
  }

  const githubRaw = one(f, "githubUrls");
  const githubUrls: string[] = [];
  if (githubRaw) {
    const parts = githubRaw.split(/[\s,]+/).filter(Boolean);
    const bad = parts.filter((p) => {
      const u = url(p);
      return (
        !u ||
        u.hostname !== "github.com" ||
        u.pathname.split("/").filter(Boolean).length < 2
      );
    });
    if (bad.length)
      errors.githubUrls = `Use github.com/owner/repo links (not: ${bad.slice(0, 2).join(", ")}).`;
    else if (parts.length > MAX_GITHUB)
      errors.githubUrls = `At most ${MAX_GITHUB} repositories.`;
    else githubUrls.push(...parts.map((p) => url(p)!.toString()));
  }

  const picked = [f.track ?? []].flat();
  const known = new Set(tracks.map((t) => t.id));
  const trackIds = [...new Set(picked)].filter((id) => known.has(id));
  if (trackIds.length !== new Set(picked).size)
    errors.track =
      "One of those tracks doesn't exist any more. Reload the page.";

  const yesNo = (k: string) => {
    const v = one(f, k);
    if (v !== "yes" && v !== "no") errors[k] = "Choose yes or no.";
    return v === "yes";
  };
  const hasGradStudent = yesNo("hasGradStudent");
  const allFreshmen = yesNo("allFreshmen");
  const halfOrMoreNonMale = yesNo("halfOrMoreNonMale");

  const notes = one(f, "notes");
  if (notes.length > 1000) errors.notes = "Keep it under 1,000 characters.";

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      teamName,
      captain: {
        name: captainName,
        email: captainEmail!,
        phone: phone || null,
      },
      teammates,
      devpostUrl,
      githubUrls,
      trackIds,
      hasGradStudent,
      allFreshmen,
      halfOrMoreNonMale,
      notes: notes || null,
    },
  };
}

function url(raw: string): URL | null {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}
