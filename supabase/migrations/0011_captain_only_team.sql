-- =============================================================================
-- Phase 2 / 0011 : the rest of a team's details are the captain's (or an
-- organizer's) to change, and only organizers create teams through the API.
--
-- Same reasoning as 0010: a rule that holds only in the UI can be bypassed
-- with the person's own session.
--
--   teams_update       was: any member. Now: the captain or an organizer.
--   team_tracks_write  was: any member. Now: the captain or an organizer.
--                      The most consequential of the three: tracks decide
--                      which sponsor judges a team needs, so a teammate
--                      changing them would silently change judging coverage.
--   teams_insert       was: an organizer, or anyone naming themselves as
--                      created_by. Now: organizers only. No legitimate path
--                      needs more: check-in writes through check_in_team()
--                      as the service role (which RLS doesn't apply to), and
--                      the CSV import writes as the organizer.
--
-- Reads are unchanged. team_tracks_write was FOR ALL, so it also granted
-- SELECT to members; team_tracks_read already does, so splitting it into
-- insert/update/delete changes no read.
-- =============================================================================

drop policy teams_insert on public.teams;
create policy teams_insert on public.teams
  for insert to authenticated
  with check (public.is_organizer());

drop policy teams_update on public.teams;
create policy teams_update on public.teams
  for update to authenticated
  using (public.is_organizer() or id in (select public.my_captain_team_ids()))
  with check (public.is_organizer() or id in (select public.my_captain_team_ids()));

drop policy team_tracks_write on public.team_tracks;

create policy team_tracks_insert on public.team_tracks
  for insert to authenticated
  with check (
    public.is_organizer()
    or team_id in (select public.my_captain_team_ids())
  );

create policy team_tracks_update on public.team_tracks
  for update to authenticated
  using (
    public.is_organizer()
    or team_id in (select public.my_captain_team_ids())
  )
  with check (
    public.is_organizer()
    or team_id in (select public.my_captain_team_ids())
  );

create policy team_tracks_delete on public.team_tracks
  for delete to authenticated
  using (
    public.is_organizer()
    or team_id in (select public.my_captain_team_ids())
  );
