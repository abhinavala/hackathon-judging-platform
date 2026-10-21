-- =============================================================================
-- Phase 1 / 0001 : schema
--
-- Design notes that matter later:
--
--  * PANELS ARE FIRST-CLASS, separate from judges. A panel is a station; the
--    judges sitting on it are a join table. Swapping a late judge touches one
--    row in panel_judges and zero assignments.
--
--  * TRACKS ARE RELATIONAL, not a text column. A team submits to N tracks and
--    the scheduler reads that to choose panels. A text blob could not be
--    joined against judge affiliation.
--
--  * SCHEDULES ARE VERSIONED. Participants only ever read a schedule whose
--    status is 'published'. Regenerating produces a new draft version; the
--    published one does not move under people who already screenshotted it.
--
--  * THE TWO SCHEDULING INVARIANTS ARE DATABASE CONSTRAINTS, not app logic.
--    A panel cannot hold two teams in one slot; a team cannot be in two places
--    at once. Even a buggy generator cannot write a conflicting schedule.
-- =============================================================================

create extension if not exists pgcrypto;

create type user_role            as enum ('participant', 'judge', 'organizer');
create type assignment_status    as enum ('scheduled', 'cancelled', 'completed');
create type schedule_status      as enum ('draft', 'published', 'archived');
create type announcement_level   as enum ('info', 'warning', 'critical');

-- -----------------------------------------------------------------------------
-- events
-- -----------------------------------------------------------------------------
create table public.events (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null unique,
  name               text not null,
  year               int  not null,
  timezone           text not null default 'America/Los_Angeles',
  slot_minutes       int  not null default 7 check (slot_minutes between 1 and 60),
  checkin_opens_at   timestamptz,
  checkin_closes_at  timestamptz,
  created_at         timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- profiles : one row per authenticated user, created by trigger on signup.
-- Role lives here and is read through SECURITY DEFINER helpers so that RLS
-- policies never query a table that is itself protected by the policy.
-- -----------------------------------------------------------------------------
create table public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  full_name  text,
  role       user_role not null default 'participant',
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- tracks : prize categories. sponsor is null for non-sponsor tracks.
-- judged_live = false means decided offline from Devpost, so the scheduler
-- ignores it when choosing panels.
-- -----------------------------------------------------------------------------
create table public.tracks (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  name         text not null,
  sponsor      text,
  judged_live  boolean not null default true,
  sort_order   int not null default 0,
  unique (event_id, name)
);

-- -----------------------------------------------------------------------------
-- teams
-- -----------------------------------------------------------------------------
create table public.teams (
  id                    uuid primary key default gen_random_uuid(),
  event_id              uuid not null references public.events(id) on delete cascade,
  name                  text not null,
  join_code             text not null,
  devpost_url           text,
  github_urls           text[] not null default '{}',
  contact_email         text,
  contact_phone         text,
  -- prize eligibility flags, carried over from the old check-in form
  has_grad_student      boolean,
  all_freshmen          boolean,
  half_or_more_non_male boolean,
  notes                 text,
  checked_in_at         timestamptz,
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  unique (event_id, name),
  unique (event_id, join_code),
  constraint join_code_shape check (join_code ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}$')
);

create index teams_event_idx on public.teams (event_id);

-- -----------------------------------------------------------------------------
-- team_members : keyed by email so members can be listed at check-in before
-- they have ever signed in. user_id is backfilled on their first login.
-- -----------------------------------------------------------------------------
create table public.team_members (
  team_id    uuid not null references public.teams(id) on delete cascade,
  email      text not null,
  user_id    uuid references auth.users(id) on delete set null,
  full_name  text,
  is_captain boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (team_id, email)
);

create index team_members_user_idx  on public.team_members (user_id);
create index team_members_email_idx on public.team_members (lower(email));

create table public.team_tracks (
  team_id  uuid not null references public.teams(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  primary key (team_id, track_id)
);

-- -----------------------------------------------------------------------------
-- judges : affiliation is the sponsor they represent, or null for an
-- unaffiliated judge (alum / professor). The scheduler reads this directly.
-- -----------------------------------------------------------------------------
create table public.judges (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  email       text not null,
  full_name   text not null,
  affiliation text,
  created_at  timestamptz not null default now(),
  unique (event_id, email)
);

create index judges_user_idx on public.judges (user_id);

create table public.panels (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events(id) on delete cascade,
  label         text not null,
  location_text text,
  map_x         numeric,
  map_y         numeric,
  sort_order    int not null default 0,
  unique (event_id, label)
);

create table public.panel_judges (
  panel_id uuid not null references public.panels(id) on delete cascade,
  judge_id uuid not null references public.judges(id) on delete cascade,
  primary key (panel_id, judge_id)
);

-- -----------------------------------------------------------------------------
-- schedules / slots / assignments
-- -----------------------------------------------------------------------------
create table public.schedules (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  version      int not null,
  round        int not null default 1,
  status       schedule_status not null default 'draft',
  stats        jsonb,
  generated_at timestamptz not null default now(),
  published_at timestamptz,
  generated_by uuid references auth.users(id) on delete set null,
  unique (event_id, version)
);

-- At most one published schedule per event per round.
create unique index schedules_one_published
  on public.schedules (event_id, round)
  where status = 'published';

create table public.slots (
  id          uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  index       int not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  unique (schedule_id, index),
  check (ends_at > starts_at)
);

create table public.assignments (
  id          uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  team_id     uuid not null references public.teams(id)     on delete cascade,
  panel_id    uuid not null references public.panels(id)    on delete cascade,
  slot_id     uuid not null references public.slots(id)     on delete cascade,
  round       int not null default 1,
  status      assignment_status not null default 'scheduled',
  created_at  timestamptz not null default now(),

  -- THE TWO SCHEDULING INVARIANTS, enforced by the database.
  -- These are exactly the conditions the edge-colouring guarantees; encoding
  -- them here means a bug in the generator surfaces as a failed insert rather
  -- than as two teams standing at the same table.
  unique (schedule_id, panel_id, slot_id),
  unique (schedule_id, team_id,  slot_id)
);

create index assignments_team_idx     on public.assignments (team_id);
create index assignments_panel_idx    on public.assignments (panel_id);
create index assignments_schedule_idx on public.assignments (schedule_id);

-- -----------------------------------------------------------------------------
-- scores : not used until Phase 5, but created now so the authorisation model
-- can be written and TESTED in Phase 1. Getting this policy right is the whole
-- reason we chose Postgres.
-- -----------------------------------------------------------------------------
create table public.scores (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  judge_id      uuid not null references public.judges(id) on delete cascade,
  criterion     text not null,
  value         numeric,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (assignment_id, judge_id, criterion)
);

create table public.announcements (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  body       text not null,
  level      announcement_level not null default 'info',
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

-- =============================================================================
-- Triggers
-- =============================================================================

-- A person may belong to only one team per event.
create or replace function public.enforce_one_team_per_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_event uuid;
  v_clash int;
begin
  select event_id into v_event from public.teams where id = new.team_id;
  select count(*) into v_clash
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
   where t.event_id = v_event
     and lower(tm.email) = lower(new.email)
     and tm.team_id <> new.team_id;
  if v_clash > 0 then
    raise exception 'already_on_a_team: % is already on another team for this event', new.email
      using errcode = 'unique_violation';
  end if;
  return new;
end $$;

create trigger team_members_one_per_event
  before insert or update on public.team_members
  for each row execute function public.enforce_one_team_per_event();

-- A team presents at most twice per schedule.
create or replace function public.enforce_max_two_presentations()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  select count(*) into v_count
    from public.assignments
   where schedule_id = new.schedule_id
     and team_id = new.team_id
     and status <> 'cancelled'
     and id <> new.id;
  if v_count >= 2 then
    raise exception 'too_many_presentations: team % already has 2 slots in this schedule', new.team_id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger assignments_max_two
  before insert or update on public.assignments
  for each row execute function public.enforce_max_two_presentations();

-- Create a profile on signup, and link any pre-registered team/judge rows.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (user_id) do nothing;

  update public.team_members
     set user_id = new.id
   where user_id is null and lower(email) = lower(new.email);

  update public.judges
     set user_id = new.id
   where user_id is null and lower(email) = lower(new.email);

  -- Anyone pre-registered as a judge is promoted out of the default role.
  if exists (select 1 from public.judges where user_id = new.id) then
    update public.profiles set role = 'judge'
     where user_id = new.id and role = 'participant';
  end if;

  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger scores_touch
  before update on public.scores
  for each row execute function public.touch_updated_at();
