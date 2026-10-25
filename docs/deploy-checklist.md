# Deploy checklist (Phase 1, Step 5)

Things that are correct locally but have to be set or confirmed on the hosted
Supabase project and on Vercel. Event-week operations (unpausing, backups)
live in [event-week-runbook.md](event-week-runbook.md).

## Supabase (hosted)

- [ ] **Preview and Production must never share a database.** A preview
      deploy writing to real event data is a bad failure mode generally and a
      disaster during event week. Production uses `gujdsezfxjwhpatzqqgj`;
      Preview needs its own project, with the Preview env vars pointed at it
      and 0001-0003 pushed to it too. **Not yet true:** both currently use
      the production project, because the free plan's two active projects
      are taken (the other is the unrelated `sgdsbrakxxoatbrviqho`).
- [ ] **The project is empty before the first `supabase db push`.** Check it
      yourself (`supabase migration list --linked` shows no remote
      migrations; `supabase inspect db table-stats --linked` shows no
      `public` tables) rather than taking anyone's word for it. Then
      `supabase db push` applies 0001-0003.
- [ ] **JWT signing keys are asymmetric (ES256 or RS256), not legacy HS256.**
      `getClaims()` verifies ES256/RS256 tokens locally against the cached
      JWKS. With HS256 it falls back to `getUser()`, a round trip to the auth
      server on every gated request: extra latency on every page load at the
      event, and a hard dependency on the auth server being reachable. Check
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

- [ ] **`SITE_URL` per environment.** Sign-in links are minted against it,
      never against the request Host header (lib/server-env.ts `siteUrl()`):
  - **Production:** set `SITE_URL` to the production origin. Missing it fails
    the request rather than guessing.
  - **Preview:** nothing to set. Each preview uses its own `VERCEL_URL`, and
    `SITE_URL` is ignored on previews on purpose, so a value scoped to "All
    Environments" can't make previews mint links into production.
  - No Supabase "Redirect URLs" entry is needed for either: the link points
    at our own `/auth/callback`, which verifies the `token_hash` server-side.
    Supabase's redirect allowlist only applies to links Supabase sends itself.
- [ ] **Vercel Deployment Protection.** Observed on this project: the
      production domain (`hackathon-judging-platform.vercel.app`) is public;
      every per-deployment URL (`hackathon-judging-platform-<hash>-...vercel.app`),
      previews included, redirects to Vercel login. So a sign-in link opened
      on a phone against a preview hits that wall first. Fine for us testing;
      turn it off or use a bypass if someone outside the team needs a preview.
      `vercel curl` created a "Protection Bypass for Automation" token on the
      project (used for scripted preview checks); rotate or revoke it in
      Project Settings, Deployment Protection, if it is no longer wanted.
- [ ] **Production branch is `main`.** A brand-new Vercel project promotes its
      first deployment to production whatever the branch: here PR #1's
      `phase-1` build became production. The next merge to `main` replaces it.
- [ ] `AUTH_LINK_SENDER=appsScript` for production once the Apps Script web
      app exists. The `console` and `mailpit` senders refuse to run in
      production; unset also fails. Until then, production renders `/login`
      and fails cleanly on send ("We couldn't send your sign-in link").
- [ ] **Exercise production with `AUTH_LINK_SENDER` unset, for real.** This
      guard is what stops sign-in links leaking into production logs, and
      locally `next start` always loads `.env.local`, which sets the sender.
      On a Vercel preview with the variable unset: request a link, confirm
      the form reports a failure, and confirm no link and no `[auth] ... link
      minted` line appears in the logs (the sender is resolved before
      minting).
- [ ] `APPS_SCRIPT_URL` and `APPS_SCRIPT_SECRET` set when the script exists
      (server-only, no `NEXT_PUBLIC_` prefix). The script compares `secret`
      from the JSON body and replies `{ "ok": true }`.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set (server-only). `grep -r service_role
app/` still returns nothing.

## Tests and scripts: local only

- [ ] **Never point `npm run seed`, `npm run test:smoke` or `npm run
test:rls` at hosted Supabase.** The seed writes 60 fake teams (it refuses
      a non-local URL without `--allow-remote`); the smoke test signs in real
      users through the service role and creates `smoke-*@example.test`
      accounts with judge and organizer roles; `test:rls` runs `supabase db
reset`. All three read `.env.local`, so keep hosted credentials out of
      it.

## Verify on the deployed URL

- [ ] `/login` renders on production and on a preview.
- [ ] Once Apps Script is live: a link requested on a laptop and opened on a
      phone lands on `/me` with the right role, and the `[auth] ... link
      minted for` log line shows the expected origin (production URL on
      production, the preview's own URL on a preview).
