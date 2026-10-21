# Phase 1 — Foundation

**Goal:** a deployed Next.js app where a person can sign in with their email, the
database knows who they are and what they're allowed to see, and a test suite
proves the authorization rules hold.

**Non-goal:** anything a hackathon participant would recognize as a feature.
Check-in is Phase 2. Scheduling is Phase 3. Resist building them early.

---

## Why this phase exists

Every later phase writes data through the rules established here. If the
authorization model is wrong, Phase 5 (judges entering scores) either leaks data
between judges or gets rebuilt from scratch. The cost of getting it right is one
focused phase; the cost of getting it wrong is every phase after.

The migrations and the test suite in this repo are already written and verified
against Postgres 16 — all 25 acceptance assertions pass. **Phase 1 does not
design the schema. It applies it and builds the app around it.**

---

## What already exists in this repo

| File | Status |
|---|---|
| `supabase/migrations/0001_schema.sql` | Written, applies cleanly |
| `supabase/migrations/0002_policies.sql` | Written, applies cleanly |
| `supabase/tests/rls_test.sql` | Written, 25/25 passing |

Do not rewrite these. If something seems wrong, say so rather than editing
silently — they encode decisions made with reasoning that isn't obvious from
the SQL alone.

---

## The data model in one paragraph

An **event** has **tracks** (prize categories, each optionally tied to a
sponsor), **teams** (who have **members** and submit to **tracks**), **judges**
(each optionally affiliated with a sponsor), and **panels** (stations, staffed
by judges via `panel_judges`). A **schedule** is a versioned container holding
**slots** (time windows) and **assignments** (team × panel × slot). **Scores**
hang off assignments. Participants only ever see a schedule whose status is
`published`.

Three structural decisions worth knowing:

1. **Panels are separate from judges.** A panel is a station; the judges on it
   are a join table. Swapping a late judge touches one row and zero assignments.
2. **Schedules are versioned.** Regenerating creates a new draft. The published
   version doesn't move under people who already screenshotted their time.
3. **The scheduling invariants are database constraints.** A panel can't hold
   two teams in one slot; a team can't be in two places at once; a team can't
   present three times. Encoded as unique constraints and triggers, so a bug in
   the generator fails loudly at insert time instead of silently at 9:40am.

---

## Authorization model

Four roles, stored in `profiles.role`:

- **anon** — no account. Can call three RPCs only: `team_schedule_by_code`,
  `public_board`, `active_announcements`. Cannot read any table directly.
- **participant** — sees their own team, their own members, and their own
  assignments *once published*. Cannot see other teams, the judge roster, or
  draft schedules.
- **judge** — sees teams assigned to their own panel. Can write scores only for
  assignments at their own station, and only as themselves.
- **organizer** — sees and writes everything.

Every policy lookup goes through a `SECURITY DEFINER` helper
(`is_organizer()`, `my_team_ids()`, `my_panel_ids()`, …) because a policy that
queries its own table recurses and the request dies.

### The join code

Every team gets a code shaped `ABCD-1234`. Anyone with it can call
`team_schedule_by_code()` and get that team's published slots — read-only, one
team, no account. This exists because magic links fail for somebody at every
event (typo'd address, spam filter, no mail app on the phone), and "I can't see
when I'm presenting" at 9:30am is a worse outcome than a guessable code for data
that is currently projected on a wall.

### Bootstrapping the first organizer

`profiles.role` changes are blocked by a trigger unless the caller is already an
organizer **or** has no JWT at all. A trusted server-side caller (service role
key, Supabase SQL editor, a migration) has no JWT, so that's how the first
organizer is made:

```sql
update public.profiles set role = 'organizer' where email = 'you@scuacm.com';
```

This is not a hole — RLS restricts profile updates to the `authenticated` role,
so an anonymous web client never reaches the trigger.

---

## What to build in Phase 1

### 1. Repo scaffold
- Next.js (App Router) + TypeScript + Tailwind
- `@supabase/supabase-js` and `@supabase/ssr`
- ESLint + Prettier, `npm run typecheck` script
- `.env.example` listing every variable, with no real values

### 2. Supabase wiring
- Browser client, server client, and middleware for session refresh
- **The `service_role` key is server-only.** It must never appear in a file
  under `app/` that ships to the browser, never be prefixed `NEXT_PUBLIC_`, and
  never be committed. Verify this before finishing.

### 3. Auth flow
- `/login` — email field, sends a magic link
- `/auth/callback` — exchanges the code, redirects to `/me`
- `/me` — shows email, role, team (if any), judge record (if any)
- Sign out
- Middleware redirecting unauthenticated users away from protected routes

### 4. Role-aware shell
- Server-side helper `getSessionContext()` returning
  `{ user, profile, role, teamId | null, judgeId | null }`
- Route groups for `(participant)`, `(judge)`, `(organizer)` with a guard that
  404s rather than redirects when the role doesn't match (don't leak which
  routes exist)

### 5. Seed script
- `npm run seed` — builds a realistic fixture: 1 event, 2 tracks, 60 teams with
  random track selections, 16 judges (4 AWS / 3 A10 / 9 unaffiliated), 8 panels,
  one draft and one published schedule
- Must be idempotent (safe to re-run)
- This fixture is what Phases 2–4 develop against, so it needs to look like a
  real event, not three toy rows

### 6. Tests
- `npm run test:rls` runs `supabase/tests/rls_test.sql` against the local
  Supabase database and fails the build on any failed assertion
- A smoke test that the app builds and `/login` renders

---

## Acceptance criteria

Phase 1 is done when all of these are true:

1. `npx supabase start` + `npx supabase db reset` applies both migrations with
   no errors
2. `npm run test:rls` prints 25 PASS lines and exits 0
3. `npm run build` and `npm run typecheck` both pass with zero errors
4. A real email receives a magic link, signing in lands on `/me`, and `/me`
   shows the correct role
5. A second account sees only its own data — verified by signing in as two
   seeded users in two browsers
6. `grep -r "service_role" app/` returns nothing
7. `npm run seed` produces 60 teams and is safe to run twice
8. The app is deployed to Vercel and the deployed URL's `/login` works

---

## Explicitly out of scope

Do not build: the check-in form, the scheduling algorithm, the team schedule
view, the big-screen board, the admin console, score entry, the venue map.

Each has its own phase. Building them now means building them against an
unproven foundation.
