// Preview deployments can send email, but only to an explicit allowlist of
// test inboxes (AUTH_LINK_ALLOWLIST). Anything else is refused, loudly: the
// send throws, so the person is told it failed and the check-in's email
// status records the reason. A preview with no allowlist refuses everything.
// The safety is the list, not the absence of a sender. Pure.

import type { LinkMessage } from "./relay.ts";

type Outcome = { failed: { email: string; error: string }[] };
export type Sender = {
  send(m: LinkMessage): Promise<void>;
  batch?(ms: LinkMessage[]): Promise<Outcome>;
};

/** "a@x.com, b@y.com" -> normalised addresses; empty when unset. */
export function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** name+anything@domain counts as name@domain (Gmail-style aliases). */
function base(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 0) return e;
  return `${e.slice(0, at).split("+")[0]}${e.slice(at)}`;
}

/** Why this address may not be emailed from a preview, or null if it may. */
export function allowlistRefusal(
  email: string,
  allowlist: string[],
): string | null {
  if (allowlist.length === 0)
    return `Preview deployments only email the test inboxes in AUTH_LINK_ALLOWLIST, and none is set: refused ${email}`;
  return allowlist.some((a) => base(a) === base(email))
    ? null
    : `Preview deployments only email the test inboxes in AUTH_LINK_ALLOWLIST: refused ${email}`;
}

/** The sender, restricted to the allowlist. */
export function restrictTo(sender: Sender, allowlist: string[]): Sender {
  return {
    async send(m) {
      const refusal = allowlistRefusal(m.email, allowlist);
      if (refusal) throw new Error(refusal);
      await sender.send(m);
    },
    async batch(ms) {
      const failed: Outcome["failed"] = [];
      const allowed: LinkMessage[] = [];
      for (const m of ms) {
        const refusal = allowlistRefusal(m.email, allowlist);
        if (refusal) failed.push({ email: m.email, error: refusal });
        else allowed.push(m);
      }
      if (allowed.length) {
        if (sender.batch) failed.push(...(await sender.batch(allowed)).failed);
        else
          for (const m of allowed)
            await sender.send(m).catch((e: unknown) =>
              failed.push({
                email: m.email,
                error: e instanceof Error ? e.message : String(e),
              }),
            );
      }
      return { failed };
    },
  };
}
