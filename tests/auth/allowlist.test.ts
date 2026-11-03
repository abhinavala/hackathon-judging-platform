import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allowlistRefusal,
  parseAllowlist,
  restrictTo,
  type Sender,
} from "../../lib/auth/allowlist.ts";
import type { LinkMessage } from "../../lib/auth/relay.ts";

const LIST = parseAllowlist(" Tester@Gmail.com , qa@scu.edu ");
const msg = (email: string): LinkMessage => ({
  email,
  link: "https://preview.example/auth/callback?token_hash=x",
  template: "invite",
});
function recording() {
  const sent: string[] = [];
  const sender: Sender = {
    async send(m) {
      sent.push(m.email);
    },
  };
  return { sent, sender };
}

test("a preview-configured sender refuses an address outside the allowlist, and sends nothing", async () => {
  const { sent, sender } = recording();
  const preview = restrictTo(sender, LIST);
  await assert.rejects(
    preview.send(msg("real.participant@scu.edu")),
    /only email the test inboxes in AUTH_LINK_ALLOWLIST: refused real.participant@scu.edu/,
  );
  assert.deepEqual(sent, []);
});

test("allowlisted inboxes, and their +aliases, are sent to", async () => {
  const { sent, sender } = recording();
  const preview = restrictTo(sender, LIST);
  await preview.send(msg("tester@gmail.com"));
  await preview.send(msg("Tester+mate1@gmail.com"));
  await preview.send(msg("qa@scu.edu"));
  assert.deepEqual(sent, [
    "tester@gmail.com",
    "Tester+mate1@gmail.com",
    "qa@scu.edu",
  ]);
  // A lookalike isn't an alias.
  assert.ok(allowlistRefusal("tester.x@gmail.com", LIST));
  assert.ok(allowlistRefusal("tester@gmail.co", LIST));
});

test("a batch sends the allowed and reports each refused address as failed", async () => {
  const { sent, sender } = recording();
  const out = await restrictTo(sender, LIST).batch!([
    msg("tester+captain@gmail.com"),
    msg("someone@example.com"),
    msg("qa@scu.edu"),
  ]);
  assert.deepEqual(sent, ["tester+captain@gmail.com", "qa@scu.edu"]);
  assert.equal(out.failed.length, 1);
  assert.equal(out.failed[0].email, "someone@example.com");
  assert.match(out.failed[0].error, /refused someone@example.com/);
});

test("with no allowlist, a preview refuses everything", async () => {
  const { sent, sender } = recording();
  await assert.rejects(
    restrictTo(sender, []).send(msg("tester@gmail.com")),
    /none is set/,
  );
  assert.deepEqual(sent, []);
});
