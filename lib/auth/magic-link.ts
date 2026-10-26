import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { EmailOtpType } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { SUPABASE_URL } from "@/lib/env";
import { serviceRoleKey, siteUrl } from "@/lib/server-env";
import { getLinkSender, type LinkTemplate } from "@/lib/auth/senders";
import type { LinkData } from "@/lib/auth/relay";
import { callbackLink } from "@/lib/auth/link-url";

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
function adminClient() {
  return createClient<Database>(SUPABASE_URL, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function mintSignInLink(email: string): Promise<string> {
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) throw error;

  const { hashed_token, verification_type } = data.properties;
  return callbackLink(siteUrl(), hashed_token, verification_type, email);
}

export async function sendSignInLink(
  email: string,
  template: LinkTemplate = "signin",
): Promise<void> {
  // Resolve the sender first: a misconfigured deployment should fail before
  // it mints a token (and creates an account for a new address).
  const sender = getLinkSender();
  const link = await mintSignInLink(email);
  // The origin only, never the token: confirms where links point per
  // environment (each Vercel preview should show its own URL).
  console.info(`[auth] ${template} link minted for ${new URL(link).origin}`);
  await sender.send({ email, link, template, data: await linkData(email) });
}

// The team name and join code the email templates show ("your team" and no
// code otherwise). Best effort: a failed lookup still sends the link.
async function linkData(email: string): Promise<LinkData> {
  try {
    const { data } = await adminClient()
      .from("team_members")
      .select("teams(name, join_code, created_at)")
      // Case-insensitive exact match: escape ilike's wildcards, or
      // "a_b@x" would also match "axb@x" and mail someone else's team code.
      .ilike("email", email.replace(/[\\%_]/g, "\\$&"));
    const team = (data ?? [])
      .map((r) => r.teams)
      .filter((t) => t !== null)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return team ? { teamName: team.name, joinCode: team.join_code } : {};
  } catch {
    return {};
  }
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
