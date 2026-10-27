// The Apps Script mail relay's wire format (apps-script/Code.gs). Pure: no
// env, no "server-only", so the app's sender and scripts share it.
//
// The secret travels in the JSON body: doPost() can't read headers. The relay
// answers { ok: true, ... } only when every message went out.

export type LinkTemplate =
  "signin" | "checkin" | "invite" | "schedule" | "credentials";

/** What the templates read; missing fields fall back to "your team" etc. */
export type LinkData = {
  teamName?: string;
  inviterName?: string;
  joinCode?: string;
  /** Check-in receipt: how many teammates were invited. */
  invitedCount?: number;
  /** Prefixed to the subject as "[...]". Used only by the redirect. */
  subjectTag?: string;
};

export type LinkMessage = {
  email: string;
  link: string;
  template: LinkTemplate;
  data?: LinkData;
};

export type RelayReply = {
  ok: boolean;
  pong?: boolean;
  sent?: number;
  failed?: { email: string | null; error: string }[];
  quotaRemaining?: number;
  requested?: number;
  relayVersion?: number;
  error?: string;
};

/** POSTs `payload` (plus the secret) to the relay and returns its JSON reply. */
export async function callRelay(
  url: string,
  secret: string,
  payload: { action: "ping" } | LinkMessage | { messages: LinkMessage[] },
  timeoutMs: number,
): Promise<RelayReply> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, secret }),
    // Apps Script answers a POST with a redirect to the script's output.
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Apps Script relay: HTTP ${res.status}`);
  const body: unknown = await res.json().catch(() => null);
  if (typeof body !== "object" || body === null || !("ok" in body))
    throw new Error(
      `Apps Script relay: unexpected reply ${JSON.stringify(body)}`,
    );
  return body as RelayReply;
}
