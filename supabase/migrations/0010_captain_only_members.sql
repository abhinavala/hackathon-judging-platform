-- =============================================================================
-- Phase 2 / 0010 : only a team's captain (or an organizer) can change who is
-- on the team.
--
-- team_members_write (0002) let ANY member insert, update or delete any row
-- of their team, and the teammates page enforced "captain only" in app code
-- alone. Changing the roster decides who can sign in as the team (and, from
-- Phase 5, who can see its AWS credentials), so it has to hold at the
-- database, not just in the UI: a teammate calling the API directly with
-- their own session must be refused.
--
-- Reads are unchanged (team_members_read). The old policy was FOR ALL, so it
-- also granted SELECT to a team's creator (teams.created_by); nothing uses
-- that path any more (check-in writes as the service role and leaves
-- created_by null), and the creator-only branch goes with it.
--
-- my_captain_team_ids() is SECURITY DEFINER like my_team_ids(), so the
-- policy on team_members never queries team_members under its own RLS.
-- =============================================================================

create or replace function public.my_captain_team_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select tm.team_id from public.team_members tm
   where tm.user_id = (select auth.uid()) and tm.is_captain;
$$;

drop policy team_members_write on public.team_members;

create policy team_members_insert on public.team_members
  for insert to authenticated
  with check (
    public.is_organizer()
    or team_id in (select public.my_captain_team_ids())
  );

-- USING checks the row as it was, WITH CHECK the row as it becomes, so a
-- captain can't move a member into a team they don't captain either.
create policy team_members_update on public.team_members
  for update to authenticated
  using (
    public.is_organizer()
    or team_id in (select public.my_captain_team_ids())
  )
  with check (
    public.is_organizer()
    or team_id in (select public.my_captain_team_ids())
  );

create policy team_members_delete on public.team_members
  for delete to authenticated
  using (
    public.is_organizer()
    or team_id in (select public.my_captain_team_ids())
  );
