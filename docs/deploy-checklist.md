# Deploy checklist (Phase 1, Step 5)

Things that are correct locally but have to be set or confirmed on the hosted
Supabase project and on Vercel. Event-week operations (unpausing, backups)
live in [event-week-runbook.md](event-week-runbook.md).

## Supabase (hosted)

Both projects are ACM-owned (acm@scu.edu, org "SCU ACM"), us-west-1:

| Environment | Project ref | URL |
|---|---|---|
| Production | `jgetndieacanzhrzmyiz` | https://jgetndieacanzhrzmyiz.supabase.co |
| Preview | `tcauglluxdmqselpsqjl` | https://tcauglluxdmqselpsqjl.supabase.co |

They replace `gujdsezfxjwhpatzqqgj` entirely.

- [x] **Preview and Production must never share a database.** A preview
      deploy writing to real event data is a bad failure mode generally and a
      disaster during event week. Vercel's Production variables point at
      `jgetndieacanzhrzmyiz`, its Preview variables at `tcauglluxdmqselpsqjl`,
      and 0001-0003 are pushed to both (done and verified 2026-10-25: 14
      tables each, anon read [] and anon insert 401). If that ever stops being true, the
      freeze in event-week-runbook.md applies from November 5.
- [ ] **Never call anything that makes Supabase send email.** Supabase's
      built-in mailer is locked at **2 emails/hour** per project and cannot be
      raised without custom SMTP; with 250 people checking in at once, any
      call that uses it silently fails for almost everyone. Our flow never
      uses it: links are minted with `auth.admin.generateLink()` (sends
      nothing) and delivered by our own sender. These calls WOULD use the
      mailer and must not appear in app code:
      `signUp()`, `signInWithOtp()`, `resetPasswordForEmail()`,
      `auth.admin.inviteUserByEmail()`, `updateUser({ email })`,
      `reauthenticate()`. To invite someone, use
      `generateLink({ type: "invite" })` and deliver the link ourselves, never
      `inviteUserByEmail()`. (Audited 2026-10-25: none of the six present.)
- [ ] **Turn OFF "Allow new users to sign up" on both projects** (the
      project-wide switch; `[auth] enable_signup` locally). The publishable
      key ships in the browser, so with it on anyone can call `signUp()`.
      Tested locally on 2026-10-25 with it off: `auth.admin.generateLink()`
      still creates brand-new users and their links verify; existing users,
      `type: "invite"` links, the full `/login` -> console -> `token_hash` ->
      `/me` path, resend, and the role-gate smoke test all pass; public
      `signUp()` and `signInWithOtp()` for new addresses fail with
      `signup_disabled`. **Do NOT disable the Email provider instead**
      (`[auth.email] enable_signup` locally): that also blocks
      `signInWithOtp()` for existing users ("Email logins are disabled"),
      which would break the fallback-SMTP route.
- [ ] **Email OTP length is 8 digits** on both projects (Supabase's default),
      not 6. We send `token_hash` links, not typed codes, so nothing reads it
      today; any future code-entry UI must accept 8 digits. (Local
      `config.toml` still says 6.)
- [ ] **The project is empty before the first `supabase db push`.** Check it
      yourself (`supabase migration list --linked` shows no remote
      migrations; `supabase inspect db table-stats --linked` shows no
      `public` tables) rather than taking anyone's word for it. Then
      `supabase db push` applies 0001-0003.
- [x] **JWT signing keys are asymmetric (ES256 or RS256), not legacy HS256.**
      Both ACM projects: ES256.
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
- [x] **OTP expiry** 14400 s (4 hours) on both projects. Clicks happen within
      minutes at check-in and within hours for credential and schedule
      emails; a session persists by refresh token once created, so this only
      bounds time-to-first-click. Raise to 8 hours during the event if resends
      get annoying, no further (AWS credentials sit behind the session).
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

## Rendering: status codes under cacheComponents

- [ ] **Under `cacheComponents`, any page-level `redirect()` or `notFound()`
      must happen BEFORE render, or it arrives as a 200.** Once a page or
      layout starts streaming, the status is already committed: a redirect
      becomes a 200 with a client-side jump, a `notFound()` a "soft" 404
      (not-found content, status 200). Do redirects and gates in `proxy.ts`
      or in a route handler (`route.ts`), as `/organizer` and `/judge` role
      gates, `/team` and `/t/go` do. `scripts/smoke.mjs` and
      `scripts/test-admin.mjs` assert the real 307/404 codes; add a check
      when you add one. We hit this twice (role-gate 404s, then redirects)
      and chose to keep the rendering mode rather than change it near the
      event.

## Verify on the deployed URL

- [ ] `/login` renders on production and on a preview.
- [ ] Once Apps Script is live: a link requested on a laptop and opened on a
      phone lands on `/me` with the right role, and the `[auth] ... link
      minted for` log line shows the expected origin (production URL on
      production, the preview's own URL on a preview).
