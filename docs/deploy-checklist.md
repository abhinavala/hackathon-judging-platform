# Deploy checklist (Phase 1, Step 5)

Things that are correct locally but have to be set or confirmed on the hosted
Supabase project and on Vercel.

## Supabase (hosted)

- [ ] **JWT signing keys are asymmetric (ES256 or RS256), not legacy HS256.**
      `getClaims()` verifies ES256/RS256 tokens locally against the cached
      JWKS. With HS256 it falls back to `getUser()`, a round trip to the auth
      server on every request: extra latency on every page load at the event,
      and a hard dependency on the auth server being reachable. Check
      `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` returns an
      `ES256` or `RS256` key.
- [ ] **Postgres major version** matches local (`supabase/config.toml`
      `major_version`). Migrations were verified on 16; local runs 17. Pin
      local to whatever hosted runs.
- [ ] **Do not `supabase config push`** the local `[auth.rate_limit]
      email_sent = 1000`. Production doesn't send through Supabase's mailer.
- [ ] **OTP expiry** raised to a few hours for the event (default 1h, max 24h,
      via the Management API). See docs/auth-and-checkin-flow.md.
- [ ] **Fallback SMTP provider** configured, so Apps Script failing isn't a
      code change at 9:30am (docs/auth-and-checkin-flow.md).

## Vercel environment

- [ ] `SITE_URL` set to the production origin. Sign-in links are built from
      it, never from the request Host header.
- [ ] `AUTH_LINK_SENDER=appsScript`. The `console` and `mailpit` senders
      refuse to run in production; unset also fails.
- [ ] **Exercise production with `AUTH_LINK_SENDER` unset, for real, before
      deploying.** This guard is what stops sign-in links leaking into
      production logs, and it has been read but not run: locally `next start`
      loads `.env.local`, which sets the sender. Run a production build with
      no `.env.local` sender (e.g. a Vercel preview with the variable unset),
      request a link, and confirm the form reports a failure and no link
      appears in the logs.
- [ ] `APPS_SCRIPT_URL` and `APPS_SCRIPT_SECRET` set (server-only, no
      `NEXT_PUBLIC_` prefix). The script compares `secret` from the JSON body
      and replies `{ "ok": true }`.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set (server-only). `grep -r service_role
      app/` still returns nothing.

## Tests

- [ ] **Do not point `npm run test:smoke` at hosted Supabase.** It signs in
      real users through the service role and creates
      `smoke-*@example.test` accounts with judge and organizer roles. Local
      Supabase only.
- [ ] Likewise `npm run test:rls`, which runs `supabase db reset`.

## Verify on the deployed URL

- [ ] `/login` renders; a link requested on a laptop and opened on a phone
      lands on `/me` with the right role.
