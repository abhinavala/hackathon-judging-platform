# Claude Code prompt — Phase 1

> Paste everything below the line into Claude Code, in an empty repo that
> already contains `docs/phase-1-spec.md`, `supabase/migrations/`, and
> `supabase/tests/`.

---

We're building a hackathon judging platform for SCU ACM. It replaces a
spreadsheet projected on a wall that tells ~60 teams which two time slots and
which station they present at. It needs to work for multiple hackathons across
future years, so it's a standalone app, not part of any one event's website.

This is **Phase 1 of 5: the foundation.** Nothing a participant would recognize
as a feature gets built in this phase. Later phases are check-in (2), schedule
generation (3), team and big-screen views (4), and judge scoring (5).

**Read `docs/phase-1-spec.md` first and follow it.** It's the contract for this
phase — scope, data model, authorization model, and acceptance criteria.

## Important: the database is already designed

`supabase/migrations/0001_schema.sql` and `0002_policies.sql` are written and
verified against Postgres 16. `supabase/tests/rls_test.sql` has 25 assertions
and they all pass. These encode decisions whose reasoning isn't obvious from
reading the SQL — the SECURITY DEFINER helpers exist to prevent RLS recursion,
the unique constraints on `assignments` are deliberate duplicates of what the
scheduling algorithm guarantees, and the role-change trigger's null-JWT branch
is how the first organizer gets bootstrapped.

**Apply them. Do not redesign them.** If you believe something is wrong or
missing, stop and tell me rather than editing — I'd rather discuss it than
discover a silent change three phases later.

If a later phase genuinely needs a schema change, that's a new migration file,
never an edit to an applied one.

## What to build

1. Next.js App Router + TypeScript + Tailwind scaffold, ESLint, Prettier,
   `typecheck` script
2. Supabase local dev (`npx supabase init`), both migrations applying on
   `db reset`
3. Supabase browser client, server client, and session-refresh middleware using
   `@supabase/ssr`
4. Magic-link auth: `/login`, `/auth/callback`, `/me`, sign out
5. A server-side `getSessionContext()` returning
   `{ user, profile, role, teamId, judgeId }`, and role-guarded route groups
   that return 404 (not a redirect) on role mismatch
6. `npm run seed` — idempotent, builds a realistic fixture: 1 event, 2 sponsor
   tracks (AWS, A10), 60 teams with random track selections, 16 judges
   (4 AWS / 3 A10 / 9 unaffiliated), 8 panels, one draft schedule and one
   published schedule
7. `npm run test:rls` — runs the SQL test suite against local Supabase, fails
   the build on any failed assertion

## Constraints

- **The `service_role` key is server-only.** Never `NEXT_PUBLIC_`, never
  imported into a client component, never committed. Check this before you
  finish — `grep -r service_role app/` must come back empty.
- Keep `/me` plain. It exists to prove auth and roles work, not to look good.
  Visual design starts in Phase 4.
- Prefer server components. Use a client component only where you need
  interactivity (the login form).
- No new dependencies beyond what's listed without telling me why.
- Commit in logical steps with real messages, not one giant commit.

## How to work through this

Go in this order, and **stop after each step to tell me what you did and what
you're about to do next**:

1. Scaffold + Supabase local running, migrations applied, `test:rls` green
2. Auth flow working end to end against local Supabase
3. Session context + role guards
4. Seed script
5. Deploy to Vercel, verify against the hosted Supabase project

Step 1 is the one that matters most. If the migrations don't apply cleanly or
the tests don't pass, don't proceed — tell me and we'll fix it together.

## When you're done

Walk me through the acceptance criteria in the spec one by one and show me the
actual output for each, rather than asserting they pass. If one doesn't, say so
plainly — I'd much rather know now than find out at the event.
