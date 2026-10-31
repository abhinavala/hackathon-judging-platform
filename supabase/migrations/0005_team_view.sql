-- =============================================================================
-- Phase 4 / 0005 : team_view(code), everything the team page needs in one
-- anonymous call.
--
-- team_schedule_by_code() returns rows only for a team that is scheduled in
-- a published version, so "unknown code", "not published yet" and "not in
-- the schedule" all look like an empty result. The page must tell those
-- apart (and never show a blank page), and also needs the published
-- version, the event's time zone and active announcements. This returns one
-- JSON object:
--
--   found          false for an unknown code (nothing else is returned)
--   team           { name, tracks }
--   event          { name, slug, timezone }
--   published      { version, published_at } or null when nothing is published
--   slots          this team's non-cancelled slots in the published version,
--                  each { index, starts_at, ends_at, station, location }
--   expected_start first slot of the newest schedule of any status (a draft
--                  included), so "not published yet" can say when to check
--                  back. Reveals a time only.
--   announcements  active ones, newest first, each { body, level, created_at }
--
-- Like the other anonymous RPCs: SECURITY DEFINER with an empty search_path,
-- and nothing about members or contact details.
-- =============================================================================

create or replace function public.team_view(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_team    public.teams%rowtype;
  v_event   public.events%rowtype;
  v_pub     public.schedules%rowtype;
  v_result  jsonb;
begin
  select * into v_team
    from public.teams
   where upper(join_code) = upper(trim(p_code));
  if not found then
    return jsonb_build_object('found', false);
  end if;

  select * into v_event from public.events where id = v_team.event_id;

  select * into v_pub
    from public.schedules
   where event_id = v_team.event_id and status = 'published'
   order by version desc
   limit 1;

  v_result := jsonb_build_object(
    'found', true,
    'team', jsonb_build_object(
      'name', v_team.name,
      'tracks', coalesce((
        select jsonb_agg(tr.name order by tr.sort_order, tr.name)
          from public.team_tracks tt
          join public.tracks tr on tr.id = tt.track_id
         where tt.team_id = v_team.id), '[]'::jsonb)),
    'event', jsonb_build_object(
      'name', v_event.name,
      'slug', v_event.slug,
      'timezone', v_event.timezone),
    'published', case when v_pub.id is null then null else jsonb_build_object(
      'version', v_pub.version,
      'published_at', v_pub.published_at) end,
    'slots', coalesce((
      select jsonb_agg(jsonb_build_object(
               'index', sl.index,
               'starts_at', sl.starts_at,
               'ends_at', sl.ends_at,
               'station', p.label,
               'location', p.location_text) order by sl.starts_at)
        from public.assignments a
        join public.slots sl on sl.id = a.slot_id
        join public.panels p on p.id = a.panel_id
       where a.schedule_id = v_pub.id
         and a.team_id = v_team.id
         and a.status <> 'cancelled'), '[]'::jsonb),
    'expected_start', (
      select min(sl.starts_at)
        from public.slots sl
       where sl.schedule_id = (
         select s.id from public.schedules s
          where s.event_id = v_team.event_id and s.status <> 'archived'
          order by s.version desc
          limit 1)),
    'announcements', coalesce((
      select jsonb_agg(jsonb_build_object(
               'body', an.body, 'level', an.level, 'created_at', an.created_at)
               order by an.created_at desc)
        from public.announcements an
       where an.event_id = v_team.event_id and an.active), '[]'::jsonb)
  );
  return v_result;
end $$;

revoke all on function public.team_view(text) from public;
grant execute on function public.team_view(text) to anon, authenticated;
