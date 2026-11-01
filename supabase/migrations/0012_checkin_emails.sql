-- =============================================================================
-- Phase 2 / 0012 : what happened to each team's check-in emails.
--
-- Check-in now answers the captain as soon as the team is saved, and mints
-- and sends the receipt and invitations afterwards (waitUntil on Vercel). A
-- failure there used to be on the captain's screen; this table keeps it
-- visible to organizers instead:
--
--   status   sending : written before the response; if it never moves on,
--                      the background work was cut short
--            sent    : every address went out
--            failed  : at least one address got nothing (see failed)
--   failed   the addresses that got nothing; a successful resend from the
--            teammates page removes its address again
--
-- Its own table, not columns on teams, because captains may update their
-- team row (0011) and must not be able to clear their own failure. Only the
-- service role writes (there are no write policies); organizers read.
-- =============================================================================

create table public.checkin_emails (
  team_id    uuid primary key references public.teams(id) on delete cascade,
  status     text not null check (status in ('sending', 'sent', 'failed')),
  failed     text[] not null default '{}',
  error      text,
  updated_at timestamptz not null default now()
);

alter table public.checkin_emails enable row level security;

create policy checkin_emails_select on public.checkin_emails
  for select to authenticated using (public.is_organizer());
