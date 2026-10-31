// The dry-run redirect: deliver every link to one of a few test inboxes
// instead of its real recipient, with the real recipient in the subject.
// Pure, so the guards are tested directly.
//
// Two independent guards, either one refuses:
//   - the Supabase URL is the PRODUCTION project (the links would sign
//     someone into real accounts)
//   - VERCEL_ENV is "production". Not NODE_ENV: Vercel previews run with
//     NODE_ENV=production too, and previews are where the dry run happens.

import { isProductionSupabase } from "../prod-guard.ts";
import type { LinkMessage } from "./relay.ts";

/** "a@x.com, b@y.com" -> ["a@x.com", "b@y.com"]; empty when unset. */
export function parseInboxes(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Why the redirect must not run here, or null if it may. */
export function redirectRefusal(env: {
  supabaseUrl: string | undefined;
  vercelEnv: string | undefined;
}): string | null {
  if (isProductionSupabase(env.supabaseUrl))
    return "the link redirect refuses to run against the production Supabase project";
  if (env.vercelEnv === "production")
    return "the link redirect refuses to run on the production deployment";
  return null;
}

/**
 * Sends message i to inboxes[i % n], so a batch spreads evenly; a single
 * message (index omitted) picks an inbox by its address, so repeat requests
 * for one person land in the same inbox. The real recipient goes in the
 * subject; the link itself is untouched (it signs in as the real recipient).
 */
export function redirectMessage(
  m: LinkMessage,
  inboxes: string[],
  index?: number,
): LinkMessage {
  if (inboxes.length === 0) throw new Error("no redirect inboxes");
  const i =
    index ?? [...m.email].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return {
    ...m,
    email: inboxes[i % inboxes.length],
    data: { ...m.data, subjectTag: `to ${m.email}` },
  };
}
