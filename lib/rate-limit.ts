import "server-only";
import { createHmac } from "node:crypto";
import { serviceRoleKey } from "@/lib/server-env";
import { serviceClient } from "@/lib/supabase/service";

// Rate limits, counted in Postgres (rate_limit_hit(), migration 0009) so they
// hold across serverless instances. Keys carry an HMAC of the IP or address,
// never the raw value.
//
// The per-IP limits are deliberately loose. At the venue, every captain is
// likely behind the same Wi-Fi, i.e. ONE public IP, and 60 of them may submit
// within a minute of the keynote ending. So the limits sit above a whole
// room's legitimate traffic and only stop a flood (a script submitting
// hundreds of fake teams to burn the day's email quota). The per-address
// limit is what stops anyone mailing one person over and over.

export type Limit = { name: string; windowSeconds: number; max: number };

export const LIMITS = {
  /** Check-in submissions per IP: a room of 60 captains, with retries, fits. */
  checkinPerMinute: { name: "checkin-ip-1m", windowSeconds: 60, max: 90 },
  checkinPerHour: { name: "checkin-ip-1h", windowSeconds: 3600, max: 400 },
  /** Invite resends and added teammates, per team. */
  invitesPerTeam: { name: "invite-team-1h", windowSeconds: 3600, max: 12 },
  /** Emails to any one address from resends. */
  invitesPerAddress: { name: "invite-addr-1h", windowSeconds: 3600, max: 3 },
} satisfies Record<string, Limit>;

function digest(value: string): string {
  // Keyed with a server-only secret: a plain hash of an IPv4 address is
  // reversible by trying all four billion.
  return createHmac("sha256", serviceRoleKey())
    .update(value)
    .digest("base64url")
    .slice(0, 22);
}

/**
 * Counts one attempt against each limit for `subject` and says whether all
 * of them allow it. Fails OPEN if the database can't answer: a check-in that
 * goes through beats a team locked out on the morning of the event.
 */
export async function allow(
  subject: string,
  ...limits: Limit[]
): Promise<boolean> {
  const db = serviceClient();
  const key = digest(subject);
  try {
    const results = await Promise.all(
      limits.map((l) =>
        db.rpc("rate_limit_hit", {
          p_key: `${l.name}:${key}`,
          p_window_seconds: l.windowSeconds,
          p_max: l.max,
        }),
      ),
    );
    const failed = results.find((r) => r.error);
    if (failed) throw new Error(failed.error!.message);
    return results.every((r) => r.data === true);
  } catch (e) {
    console.error(
      `[rate-limit] failing open: ${e instanceof Error ? e.message : e}`,
    );
    return true;
  }
}

/**
 * The client's IP as Vercel reports it (x-vercel-forwarded-for and x-real-ip
 * are set by Vercel's edge, not by the client), falling back to the first
 * x-forwarded-for hop locally.
 */
export function clientIp(headers: Headers): string {
  return (
    headers.get("x-vercel-forwarded-for")?.split(",")[0].trim() ||
    headers.get("x-real-ip")?.trim() ||
    headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    "unknown"
  );
}
