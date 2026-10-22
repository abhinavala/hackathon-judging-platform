-- =============================================================================
-- Phase 1 / 0003 : two corrections found during Phase 1 review.
--
-- Both were real. Neither is cosmetic.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- FIX 1 -- judges could see teams from DRAFT schedules.
--
-- my_judged_team_ids() is SECURITY DEFINER, so it bypasses RLS on assignments
-- and saw every schedule including drafts. A judge therefore got the full teams
-- row -- contact_email, contact_phone and all -- for any team provisionally
-- placed at their station, before anything was published.
--
-- Drafts are organizer-only by design. Everywhere else honours that; this
-- function did not. Cancelled assignments are excluded for the same reason:
-- a team pulled from a station should stop being visible to that panel.
-- -----------------------------------------------------------------------------
create or replace function public.my_judged_team_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select distinct a.team_id
    from public.assignments a
    join public.schedules s on s.id = a.schedule_id
   where s.status = 'published'
     and a.status <> 'cancelled'
     and a.panel_id in (
           select pj.panel_id from public.panel_judges pj
            where pj.judge_id in (select j.id from public.judges j
                                   where j.user_id = (select auth.uid())));
$$;

-- -----------------------------------------------------------------------------
-- FIX 2 -- people added to the roster AFTER they already had an account were
-- never linked.
--
-- handle_new_user() runs on signup only. The real sequence at an event is the
-- other way round: an ACM alum signs in on Friday, gets added to the judge
-- roster on Saturday morning, and then sees nothing -- no panel, no teams,
-- still role 'participant'. Same for a teammate added to a team after they
-- already signed in.
--
-- The fix is the mirror image: link on roster insert as well as on signup.
-- -----------------------------------------------------------------------------
create or replace function public.link_judge_to_existing_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  if new.user_id is null then
    select u.id into v_uid from auth.users u
     where lower(u.email) = lower(new.email) limit 1;
    new.user_id := v_uid;
  end if;

  if new.user_id is not null then
    update public.profiles
       set role = 'judge'
     where user_id = new.user_id and role = 'participant';
  end if;
  return new;
end $$;

drop trigger if exists judges_link_user on public.judges;
create trigger judges_link_user
  before insert or update of email, user_id on public.judges
  for each row execute function public.link_judge_to_existing_user();

create or replace function public.link_member_to_existing_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  if new.user_id is null then
    select u.id into v_uid from auth.users u
     where lower(u.email) = lower(new.email) limit 1;
    new.user_id := v_uid;
  end if;
  return new;
end $$;

drop trigger if exists team_members_link_user on public.team_members;
create trigger team_members_link_user
  before insert or update of email, user_id on public.team_members
  for each row execute function public.link_member_to_existing_user();

-- -----------------------------------------------------------------------------
-- Backfill anything already in the database.
-- -----------------------------------------------------------------------------
update public.judges j
   set user_id = u.id
  from auth.users u
 where j.user_id is null and lower(j.email) = lower(u.email);

update public.team_members tm
   set user_id = u.id
  from auth.users u
 where tm.user_id is null and lower(tm.email) = lower(u.email);

update public.profiles p
   set role = 'judge'
 where p.role = 'participant'
   and exists (select 1 from public.judges j where j.user_id = p.user_id);
