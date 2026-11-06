// What a signed-in participant sees of the AWS credentials: their team's
// workshop code and their own Kiro code, from my_access_codes() (0015).
// Pure, so it is tested directly.

/**
 * Where everyone joins. NOT the event's one-click join link: AWS says that
 * one puts people on teams at random, which scatters a team. The team's own
 * Join event URL (from AWS's CSV) embeds its code and is the main action;
 * this is the fallback for typing the code.
 */
export const WORKSHOP_JOIN_URL =
  "https://catalog.us-east-1.prod.workshops.aws/join";
export const WORKSHOP_JOIN_HOST = "catalog.us-east-1.prod.workshops.aws/join";

export type MyCodes = {
  workshop: { code: string; joinUrl: string | null } | null;
  kiro: {
    code: string;
    redemptionUrl: string | null;
    amount: number | null;
    expiresAt: string | null;
    /** AWS's own wording, when it wasn't a readable date. */
    expiresText: string | null;
  } | null;
};

/** my_access_codes() JSON (snake_case, nullable) -> MyCodes. */
export function codesFromRpc(raw: unknown): MyCodes {
  const r = (raw ?? {}) as Record<string, Record<string, unknown> | null>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  const w = r.workshop;
  const k = r.kiro;
  return {
    workshop:
      w && str(w.code)
        ? { code: String(w.code), joinUrl: safeUrl(str(w.join_url)) }
        : null,
    kiro:
      k && str(k.code)
        ? {
            code: String(k.code),
            redemptionUrl: safeUrl(str(k.redemption_url)),
            amount: typeof k.amount === "number" ? k.amount : null,
            expiresAt: str(k.expires_at),
            expiresText: str(k.expires_text),
          }
        : null,
  };
}

/** Only http(s) links become tappable; anything else is not shown as one. */
export function safeUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:"
      ? u.toString()
      : null;
  } catch {
    return null;
  }
}

/** "November 30, 2026" in the event's zone, or AWS's own text. */
export function expiryLabel(
  kiro: NonNullable<MyCodes["kiro"]>,
  timeZone: string,
): string | null {
  if (kiro.expiresAt)
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(new Date(kiro.expiresAt));
  return kiro.expiresText;
}
