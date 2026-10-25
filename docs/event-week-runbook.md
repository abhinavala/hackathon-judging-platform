# Event-week runbook

Operational steps for the week of the AWS x A10 Hack (Saturday-Sunday,
November 7-8, 2026). Deploy-time settings are in
[deploy-checklist.md](deploy-checklist.md).

## Preview deploy freeze from Thursday, November 5

Preview deployments must never write to real event data. If Preview has its
own Supabase project (deploy-checklist.md), this section is a no-op. If it
does not, previews share the production database, which only matters once
production holds real data, so: **no preview deploys from Thursday,
November 5 until after the event.** It costs nothing and covers us if the
second project isn't ready.

- [ ] **By November 5,** if Preview still points at the production project,
      remove the Preview-scoped Supabase variables in Vercel
      (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
      `SUPABASE_SERVICE_ROLE_KEY`). A preview without them cannot reach any
      database at all, which is the hard guarantee.
- [ ] Optionally also stop previews building: Project Settings, Git,
      Ignored Build Step, command
      `[ "$VERCEL_ENV" != "production" ]` (exit 0 skips the build). Merges to
      `main` still deploy to production.
- [ ] Undo both after the event (or once Preview has its own project).

## Keep the Supabase project awake

Free-tier projects **pause after about a week without activity**, and a
paused project serves nothing: no sign-in, no schedule, no board.

- [ ] **A week before (by Saturday, October 31):** open the project in the
      Supabase dashboard. If it shows as paused, restore it; restoring can
      take several minutes.
- [ ] **Friday, November 6:** check again, and load the production `/login`
      and an organizer page to confirm the app reaches the database.
- [ ] **Saturday morning before check-in:** check once more. Do not rely on
      Friday's check alone.

## Back up the database (pg_dump)

Free-tier projects have **no downloadable backups**, so take our own. Get the
connection string from the dashboard (Connect, session pooler) and keep the
password out of shell history and out of the repo.

```sh
# schema + data, plain SQL, restorable with psql
pg_dump "$SUPABASE_DB_URL" --no-owner --no-privileges \
  --schema=public --schema=auth \
  -f "backup-$(date +%Y%m%d-%H%M).sql"
```

`npx supabase db dump --linked -f schema.sql` and `--data-only -f data.sql`
work too if `pg_dump` isn't installed locally.

- [ ] **Before the event (Friday, November 6):** take a dump and confirm it
      restores into a local database (`psql` into the local Supabase on port
      54322).
- [ ] **After check-in closes (Saturday):** dump. This captures every team,
      member and track selection, the data that is hardest to re-collect.
- [ ] **After the schedule is published (Sunday, before judging):** dump.
- [ ] **After judging:** dump, so scores survive anything that happens next.
- [ ] Store dumps outside the laptop that took them (they contain participant
      emails and phone numbers; keep them private).
