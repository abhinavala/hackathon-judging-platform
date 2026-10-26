import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseInboxes,
  redirectMessage,
  redirectRefusal,
} from "../../lib/auth/redirect.ts";
import {
  isProductionSupabase,
  PRODUCTION_PROJECT_REF,
} from "../../lib/prod-guard.ts";
import { callbackLink } from "../../lib/auth/link-url.ts";

const PROD = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;
const PREVIEW = "https://tcauglluxdmqselpsqjl.supabase.co";

test("production is recognised by project ref only", () => {
  assert.equal(isProductionSupabase(PROD), true);
  assert.equal(isProductionSupabase(PREVIEW), false);
  assert.equal(isProductionSupabase("http://127.0.0.1:54321"), false);
  assert.equal(
    isProductionSupabase(`https://evil.example/${PRODUCTION_PROJECT_REF}`),
    false,
  );
  assert.equal(isProductionSupabase(undefined), false);
  assert.equal(isProductionSupabase("not a url"), false);
});

test("the redirect refuses production by project ref AND by deployment", () => {
  assert.match(
    redirectRefusal({ supabaseUrl: PROD, vercelEnv: "preview" })!,
    /production Supabase project/,
  );
  assert.match(
    redirectRefusal({ supabaseUrl: PREVIEW, vercelEnv: "production" })!,
    /production deployment/,
  );
  // Vercel previews run with NODE_ENV=production; only VERCEL_ENV counts.
  assert.equal(
    redirectRefusal({ supabaseUrl: PREVIEW, vercelEnv: "preview" }),
    null,
  );
  assert.equal(
    redirectRefusal({ supabaseUrl: PREVIEW, vercelEnv: undefined }),
    null,
  );
});

test("inboxes parse from a comma list", () => {
  assert.deepEqual(parseInboxes(" A@x.com, b@y.com ,,"), [
    "a@x.com",
    "b@y.com",
  ]);
  assert.deepEqual(parseInboxes(undefined), []);
});

test("a batch spreads evenly; the real recipient goes in the subject, the link is untouched", () => {
  const inboxes = ["a@x.com", "b@x.com", "c@x.com"];
  const out = Array.from({ length: 250 }, (_, i) =>
    redirectMessage(
      {
        email: `member${i}@scu.example`,
        link: `https://p.vercel.app/auth/callback?token_hash=t${i}`,
        template: "schedule",
        data: { teamName: "ShelterLink", joinCode: "ABCD-1234" },
      },
      inboxes,
      i,
    ),
  );
  const counts = inboxes.map((b) => out.filter((m) => m.email === b).length);
  assert.deepEqual(counts, [84, 83, 83]);
  assert.deepEqual(out[7], {
    email: "b@x.com",
    link: "https://p.vercel.app/auth/callback?token_hash=t7",
    template: "schedule",
    data: {
      teamName: "ShelterLink",
      joinCode: "ABCD-1234",
      subjectTag: "to member7@scu.example",
    },
  });
  // Without an index, one person always lands in the same inbox.
  const m = {
    email: "emily@scu.example",
    link: "x",
    template: "signin" as const,
  };
  assert.equal(
    redirectMessage(m, inboxes).email,
    redirectMessage(m, inboxes).email,
  );
  assert.throws(() => redirectMessage(m, []), /no redirect inboxes/);
});

test("the callback link carries token_hash, type and email on the given site", () => {
  const u = new URL(
    callbackLink("https://p.vercel.app", "abc", "magiclink", "a+b@x.com"),
  );
  assert.equal(u.origin + u.pathname, "https://p.vercel.app/auth/callback");
  assert.equal(u.searchParams.get("token_hash"), "abc");
  assert.equal(u.searchParams.get("type"), "magiclink");
  assert.equal(u.searchParams.get("email"), "a+b@x.com");
});
