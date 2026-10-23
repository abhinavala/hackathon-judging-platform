import "server-only";

// Server-only settings. Never import this from a client component: the
// "server-only" import above turns that mistake into a build error.
//
// Read lazily (functions, not constants) so `next build` doesn't need the
// secrets present, and a missing value fails the request that needs it rather
// than the whole app.

const isProduction = process.env.NODE_ENV === "production";

// Bypasses RLS. Used only to mint sign-in links (and, from Phase 2, by the
// check-in server action).
export function serviceRoleKey(): string {
  return required("SUPABASE_SERVICE_ROLE_KEY");
}

// The origin sign-in links point at. Never taken from the request's Host
// header: a forged Host would otherwise put a working token_hash for someone
// else's account into a link on the attacker's domain.
//
// - Vercel preview: always this deployment's own URL (VERCEL_URL, set by
//   Vercel, not by the request). SITE_URL is ignored here on purpose, so a
//   value set for "All Environments" can't make previews mint links that
//   point at production.
// - Production: SITE_URL, required.
// - Local dev: SITE_URL, defaulting to http://127.0.0.1:3000.
//
// No Supabase redirect allowlist is involved for any of these: the link goes
// to our own /auth/callback, which verifies the token_hash server-side.
export function siteUrl(): string {
  if (process.env.VERCEL_ENV === "preview") {
    const host = process.env.VERCEL_URL;
    if (!host) throw new Error("VERCEL_URL is not set on this preview");
    return `https://${host}`;
  }
  const value = process.env.SITE_URL;
  if (value) return value.replace(/\/+$/, "");
  if (isProduction) throw new Error("Missing environment variable SITE_URL");
  return "http://127.0.0.1:3000";
}

export type LinkSenderName = "console" | "mailpit" | "appsScript";

export function linkSenderName(): LinkSenderName {
  const value = process.env.AUTH_LINK_SENDER ?? (isProduction ? "" : "console");
  if (value === "console" || value === "mailpit" || value === "appsScript") {
    return value;
  }
  throw new Error(
    `AUTH_LINK_SENDER must be console, mailpit or appsScript (got "${value}")`,
  );
}

export function mailpitUrl(): string {
  return process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
}

export function appsScriptUrl(): string {
  return required("APPS_SCRIPT_URL");
}

export function appsScriptSecret(): string {
  return required("APPS_SCRIPT_SECRET");
}

export { isProduction };

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}
