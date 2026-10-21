-- =============================================================================
-- Phase 1 / 0002 : helper functions, RLS policies, public RPCs
--
-- RULE: a policy must never run a query against a table that is itself guarded
-- by that policy -- Postgres recurses and the request dies. Every lookup a
-- policy needs is therefore wrapped in a SECURITY DEFINER function, which runs
-- with the definer's rights and bypasses RLS on the tables it touches.
--
-- Every function sets an empty search_path. Without it a caller can prepend a
-- schema they control and hijack an unqualified name inside the function body.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Identity helpers
-- -----------------------------------------------------------------------------
create or replace function public.is_organizer()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
     where p.user_id = (select auth.uid()) and p.role = 'organizer'
  );
$$;

create or replace function public.my_team_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select tm.team_id from public.team_members tm
   where tm.user_id = (select auth.uid());
$$;

create or replace function public.my_judge_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select j.id from public.judges j
   where j.user_id = (select auth.uid());
$$;

-- Panels this user sits on. The join through panel_judges is what makes
-- "judges grade only their own teams" expressible as data rather than UI code.
create or replace function public.my_panel_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select pj.panel_id from public.panel_judges pj
   where pj.judge_id in (select j.id from public.judges j
                          where j.user_id = (select auth.uid()));
$$;

-- Teams this user is scheduled to judge.
create or replace function public.my_judged_team_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select distinct a.team_id
    from public.assignments a
   where a.panel_id in (select pj.panel_id from public.panel_judges pj
                         where pj.judge_id in (select j.id from public.judges j
                                                where j.user_id = (select auth.uid())));
$$;

create or replace function public.is_schedule_published(p_schedule uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.schedules s
                  where s.id = p_schedule and s.status = 'published');
$$;

-- -----------------------------------------------------------------------------
-- Role escalation guard. Without this, the "update own profile" policy would
-- let any participant set their own role to organizer.
-- -----------------------------------------------------------------------------
-- NOTE on bootstrapping: a trusted server-side caller (the service_role key,
-- the SQL editor, a migration) carries no JWT, so auth.uid() is null. That case
-- is allowed, which is how the FIRST organizer ever gets created. It is not a
-- hole: RLS already restricts profile updates to the `authenticated` role, so
-- an anonymous web client never reaches this trigger.
create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role is distinct from old.role
     and (select auth.uid()) is not null
     and not public.is_organizer() then
    raise exception 'forbidden: only an organizer may change a role'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.guard_profile_role();

-- =============================================================================
-- Enable RLS everywhere. Default deny; every access path below is explicit.
-- =============================================================================
alter table public.events        enable row level security;
alter table public.profiles      enable row level security;
alter table public.tracks        enable row level security;
alter table public.teams         enable row level security;
alter table public.team_members  enable row level security;
alter table public.team_tracks   enable row level security;
alter table public.judges        enable row level security;
alter table public.panels        enable row level security;
alter table public.panel_judges  enable row level security;
alter table public.schedules     enable row level security;
alter table public.slots         enable row level security;
alter table public.assignments   enable row level security;
alter table public.scores        enable row level security;
alter table public.announcements enable row level security;

-- -----------------------------------------------------------------------------
-- events, tracks, panels : public reference data, readable by anyone signed in.
-- -----------------------------------------------------------------------------
create policy events_read on public.events
  for select to authenticated using (true);
create policy events_write on public.events
  for all to authenticated using (public.is_organizer()) with check (public.is_organizer());

create policy tracks_read on public.tracks
  for select to authenticated using (true);
create policy tracks_write on public.tracks
  for all to authenticated using (public.is_organizer()) with check (public.is_organizer());

create policy panels_read on public.panels
  for select to authenticated using (true);
create policy panels_write on public.panels
  for all to authenticated using (public.is_organizer()) with check (public.is_organizer());

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
create policy profiles_read_self on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_organizer());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()) or public.is_organizer())
  with check (user_id = (select auth.uid()) or public.is_organizer());

-- -----------------------------------------------------------------------------
-- teams : a participant sees their own team; a judge sees teams they are
-- scheduled to judge; an organizer sees everything.
-- -----------------------------------------------------------------------------
create policy teams_read on public.teams
  for select to authenticated
  using (
    public.is_organizer()
    or id in (select public.my_team_ids())
    or id in (select public.my_judged_team_ids())
  );

create policy teams_insert on public.teams
  for insert to authenticated
  with check (
    public.is_organizer()
    or created_by = (select auth.uid())
  );

create policy teams_update on public.teams
  for update to authenticated
  using (public.is_organizer() or id in (select public.my_team_ids()))
  with check (public.is_organizer() or id in (select public.my_team_ids()));

create policy teams_delete on public.teams
  for delete to authenticated using (public.is_organizer());

-- -----------------------------------------------------------------------------
-- team_members / team_tracks
-- -----------------------------------------------------------------------------
create policy team_members_read on public.team_members
  for select to authenticated
  using (
    public.is_organizer()
    or team_id in (select public.my_team_ids())
    or user_id = (select auth.uid())
  );

create policy team_members_write on public.team_members
  for all to authenticated
  using (
    public.is_organizer()
    or team_id in (select public.my_team_ids())
    or exists (select 1 from public.teams t
                where t.id = team_id and t.created_by = (select auth.uid()))
  )
  with check (
    public.is_organizer()
    or team_id in (select public.my_team_ids())
    or exists (select 1 from public.teams t
                where t.id = team_id and t.created_by = (select auth.uid()))
  );

create policy team_tracks_read on public.team_tracks
  for select to authenticated
  using (
    public.is_organizer()
    or team_id in (select public.my_team_ids())
    or team_id in (select public.my_judged_team_ids())
  );

create policy team_tracks_write on public.team_tracks
  for all to authenticated
  using (public.is_organizer() or team_id in (select public.my_team_ids()))
  with check (public.is_organizer() or team_id in (select public.my_team_ids()));

-- -----------------------------------------------------------------------------
-- judges / panel_judges : a judge sees themselves and their own panel roster.
-- Participants never see the judge list.
-- -----------------------------------------------------------------------------
create policy judges_read on public.judges
  for select to authenticated
  using (public.is_organizer() or user_id = (select auth.uid()));

create policy judges_write on public.judges
  for all to authenticated
  using (public.is_organizer()) with check (public.is_organizer());

create policy panel_judges_read on public.panel_judges
  for select to authenticated
  using (public.is_organizer() or panel_id in (select public.my_panel_ids()));

create policy panel_judges_write on public.panel_judges
  for all to authenticated
  using (public.is_organizer()) with check (public.is_organizer());

-- -----------------------------------------------------------------------------
-- schedules / slots : drafts are organizer-only. This is what stops a team
-- from refreshing their way into a schedule that has not been published.
-- -----------------------------------------------------------------------------
create policy schedules_read on public.schedules
  for select to authenticated
  using (public.is_organizer() or status = 'published');

create policy schedules_write on public.schedules
  for all to authenticated
  using (public.is_organizer()) with check (public.is_organizer());

create policy slots_read on public.slots
  for select to authenticated
  using (public.is_organizer() or public.is_schedule_published(schedule_id));

create policy slots_write on public.slots
  for all to authenticated
  using (public.is_organizer()) with check (public.is_organizer());

-- -----------------------------------------------------------------------------
-- assignments : the core read path.
-- -----------------------------------------------------------------------------
create policy assignments_read on public.assignments
  for select to authenticated
  using (
    public.is_organizer()
    or (public.is_schedule_published(schedule_id)
        and (team_id in (select public.my_team_ids())
             or panel_id in (select public.my_panel_ids())))
  );

create policy assignments_write on public.assignments
  for all to authenticated
  using (public.is_organizer()) with check (public.is_organizer());

-- -----------------------------------------------------------------------------
-- scores : THE policy this whole stack was chosen for.
--
-- Two independent conditions, and both are necessary:
--   1. the assignment must belong to a panel this user actually sits on
--   2. the row must be written AS this user, not on another judge's behalf
-- Drop either one and a judge can write scores that are not theirs.
-- -----------------------------------------------------------------------------
create policy scores_read on public.scores
  for select to authenticated
  using (public.is_organizer() or judge_id in (select public.my_judge_ids()));

create policy scores_insert on public.scores
  for insert to authenticated
  with check (
    judge_id in (select public.my_judge_ids())
    and exists (
      select 1 from public.assignments a
       where a.id = assignment_id
         and a.panel_id in (select public.my_panel_ids())
    )
  );

create policy scores_update on public.scores
  for update to authenticated
  using (judge_id in (select public.my_judge_ids()))
  with check (
    judge_id in (select public.my_judge_ids())
    and exists (
      select 1 from public.assignments a
       where a.id = assignment_id
         and a.panel_id in (select public.my_panel_ids())
    )
  );

create policy scores_organizer on public.scores
  for all to authenticated
  using (public.is_organizer()) with check (public.is_organizer());

-- -----------------------------------------------------------------------------
-- announcements
-- -----------------------------------------------------------------------------
create policy announcements_read on public.announcements
  for select to authenticated using (active or public.is_organizer());

create policy announcements_write on public.announcements
  for all to authenticated
  using (public.is_organizer()) with check (public.is_organizer());

-- =============================================================================
-- Public RPCs : the join-code escape hatch.
--
-- Magic links fail for somebody at every event -- typo'd address, spam filter,
-- no mail app on the phone. The join code is the fallback: read-only, one
-- team, published schedule only. This data is currently projected on a wall,
-- so a guessable code is not a meaningful exposure; being unable to see your
-- own slot time at 9:30am is.
-- =============================================================================
create or replace function public.team_schedule_by_code(p_code text)
returns table (
  team_name     text,
  track_names   text[],
  slot_index    int,
  starts_at     timestamptz,
  ends_at       timestamptz,
  panel_label   text,
  location_text text
)
language sql stable security definer set search_path = '' as $$
  select t.name,
         coalesce(array_agg(distinct tr.name) filter (where tr.name is not null), '{}'),
         sl.index, sl.starts_at, sl.ends_at, p.label, p.location_text
    from public.teams t
    join public.assignments a on a.team_id = t.id and a.status <> 'cancelled'
    join public.schedules  s  on s.id = a.schedule_id and s.status = 'published'
    join public.slots      sl on sl.id = a.slot_id
    join public.panels     p  on p.id = a.panel_id
    left join public.team_tracks tt on tt.team_id = t.id
    left join public.tracks tr on tr.id = tt.track_id
   where upper(t.join_code) = upper(trim(p_code))
   group by t.name, sl.index, sl.starts_at, sl.ends_at, p.label, p.location_text
   order by sl.starts_at;
$$;

revoke all on function public.team_schedule_by_code(text) from public;
grant execute on function public.team_schedule_by_code(text) to anon, authenticated;

-- The big-screen board: whole published schedule, no auth, read-only.
create or replace function public.public_board(p_event_slug text)
returns table (
  panel_label   text,
  location_text text,
  slot_index    int,
  starts_at     timestamptz,
  team_name     text
)
language sql stable security definer set search_path = '' as $$
  select p.label, p.location_text, sl.index, sl.starts_at, t.name
    from public.events e
    join public.schedules  s  on s.event_id = e.id and s.status = 'published'
    join public.assignments a on a.schedule_id = s.id and a.status <> 'cancelled'
    join public.slots      sl on sl.id = a.slot_id
    join public.panels     p  on p.id = a.panel_id
    join public.teams      t  on t.id = a.team_id
   where e.slug = p_event_slug
   order by p.sort_order, sl.index;
$$;

revoke all on function public.public_board(text) from public;
grant execute on function public.public_board(text) to anon, authenticated;

create or replace function public.active_announcements(p_event_slug text)
returns table (body text, level announcement_level, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.body, a.level, a.created_at
    from public.announcements a
    join public.events e on e.id = a.event_id
   where e.slug = p_event_slug and a.active
   order by a.created_at desc;
$$;

revoke all on function public.active_announcements(text) from public;
grant execute on function public.active_announcements(text) to anon, authenticated;
