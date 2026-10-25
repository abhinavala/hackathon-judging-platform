# Hackathon Judging Platform

Replaces the projected spreadsheet that tells teams when and where to present.
Built standalone so it can be reused across events and years.

## Phases
1. **Foundation** — schema, auth, RLS, seed, tests  ← current
2. Check-in (replaces the Google Form)
3. Schedule generation (track-aware, exact algorithm)
4. Team view + big-screen board
5. Judge scoring

## Layout
```
docs/phase-1-spec.md        contract for the current phase
docs/prompts/phase-1.md     prompt to hand to Claude Code
supabase/migrations/        schema + RLS (verified, do not edit in place)
supabase/tests/rls_test.sql 31 authorization assertions
scheduler/                  the scheduling algorithm (ported in Phase 3)
```

## Running the security tests
```
npx supabase start
npx supabase db reset
npm run test:rls         # expect 31 PASS, exit 0
```
The suite needs an empty database, so it resets first. Outside CI, a passing
run then resets again and runs `npm run seed` to restore dev data (skipped with
a note until `scripts/seed.mts` exists). `CI=true` skips the re-seed.
