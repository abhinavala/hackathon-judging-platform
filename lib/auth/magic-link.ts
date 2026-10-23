import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { EmailOtpType } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { SUPABASE_URL } from "@/lib/env";
import { serviceRoleKey, siteUrl } from "@/lib/server-env";
import { getLinkSender, type LinkTemplate } from "@/lib/auth/senders";

// Link types /auth/callback will verify. generateLink() reports "signup" for
// an address with no account yet (it creates one) and "magiclink" for an
// existing account.
export const VERIFIABLE_TYPES: readonly EmailOtpType[] = [
  "magiclink",
  "signup",
  "email",
];

// Mints a single-use sign-in link for `email` WITHOUT sending anything, using
// the service role. Creates the auth user if there isn't one, which fires
// handle_new_user() and links any judge / team_members rows by email.
//
// The link points at our /auth/callback with a token_hash, consumed there by
// verifyOtp(). That is what makes it work on a different device from the one
// that asked for it, and generateLink() is incompatible with the PKCE code
// exchange anyway (supabase/auth-js#767). Do not switch this to action_link.
export async function mintSignInLink(email: string): Promise<string> {
  const admin = createClient<Database>(SUPABASE_URL, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) throw error;

  const { hashed_token, verification_type } = data.properties;
  const url = new URL("/auth/callback", siteUrl());
  url.searchParams.set("token_hash", hashed_token);
  url.searchParams.set("type", verification_type);
  // Lets an expired link offer a one-click resend to the same address.
  url.searchParams.set("email", email);
  return url.toString();
}

export async function sendSignInLink(
  email: string,
  template: LinkTemplate = "sign-in",
): Promise<void> {
  const link = await mintSignInLink(email);
  await getLinkSender().send({ email, link, template });
}

// Light validation only; the auth server is the real judge of an address.
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }
  return email;
}
