// What a no-JavaScript check-in had typed when it came back with an error,
// carried in a short-lived cookie so the form can fill itself in again
// (without JavaScript the browser leaves the page, and a team of six would
// otherwise retype every address). A cookie rather than the redirect URL so
// names, emails and phone numbers stay out of URLs, history and logs. Pure.

import type { FormFields } from "./form.ts";

export const DRAFT_COOKIE = "checkin-draft";
export const DRAFT_MAX_AGE = 300; // seconds

// Under the 4 KB a browser keeps per cookie, with room for its attributes.
const MAX_LENGTH = 3500;

/** The fields worth keeping, as a cookie value; null if nothing fits. */
export function encodeDraft(fields: FormFields): string | null {
  const keep: FormFields = { ...fields };
  delete keep.website; // the bot trap is never echoed back
  for (const drop of [null, "notes", "githubUrls", "devpostUrl"]) {
    if (drop) delete keep[drop];
    const value = Buffer.from(JSON.stringify(keep)).toString("base64url");
    if (value.length <= MAX_LENGTH) return value;
  }
  return null;
}

/** The fields back, or null for anything that isn't a draft we wrote. */
export function decodeDraft(value: string | undefined): FormFields | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return null;
    const out: FormFields = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") out[k] = v;
      else if (Array.isArray(v) && v.every((x) => typeof x === "string"))
        out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}

// The addresses a check-in just invited, for the captain's own welcome screen
// only: a 10-minute cookie scoped to that team's page, so they reach the
// browser that submitted the form and never the URL (anyone with the join
// code can open /t/CODE, and it shows no addresses).
export const INVITED_COOKIE = "checkin-invited";
export const INVITED_MAX_AGE = 600; // seconds

export function encodeInvited(emails: string[]): string {
  return Buffer.from(JSON.stringify(emails.slice(0, 10))).toString("base64url");
}

export function decodeInvited(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string").slice(0, 10)
      : [];
  } catch {
    return [];
  }
}
