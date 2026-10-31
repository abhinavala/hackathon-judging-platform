-- =============================================================================
-- Phase 4 / 0007 : board_view(slug), everything the big-screen board needs in
-- one anonymous call.
--
-- public_board() (0002) has no slot end times, no published version, no time
-- zone and no event settings, and anonymous visitors can't read events. The
-- board leads with the current slot ("NOW 10:42-10:49 AM PST") and the next
-- one, works out which slot is current on the client (it ticks every second),
-- and says what to do when the schedule isn't published yet. Returns:
--
--   found          false for an unknown slug (nothing else is returned)
--   event          { name, slug, timezone, judging_starts_at, help_location }
--   published      { version, published_at } or null
--   stations       stations with at least one team in the published version,
--                  in sort order, each { label, location }
--   slots          the published version's slots, each { index, starts_at,
--                  ends_at }
--   cells          non-cancelled assignments, each { slot_index, station, team }
--   announcements  active ones, newest first, each { body, level, created_at }
--
-- Discloses what public_board() already does (team names, stations, times)
-- plus end times and the settings participants are shown anyway. Nothing
-- about members, judges or contact details.
-- =============================================================================

create or replace function public.board_view(p_event_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
  v_pub   public.schedules%rowtype;
begin
  select * into v_event from public.events where slug = p_event_slug;
  if not found then
    return jsonb_build_object('found', false);
  end if;

  select * into v_pub
    from public.schedules
   where event_id = v_event.id and status = 'published'
   order by version desc
   limit 1;

  return jsonb_build_object(
    'found', true,
    'event', jsonb_build_object(
      'name', v_event.name,
      'slug', v_event.slug,
      'timezone', v_event.timezone,
      'judging_starts_at', v_event.judging_starts_at,
      'help_location', v_event.help_location),
    'published', case when v_pub.id is null then null else jsonb_build_object(
      'version', v_pub.version,
      'published_at', v_pub.published_at) end,
    'stations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'label', p.label, 'location', p.location_text)
               order by p.sort_order, p.label)
        from public.panels p
       where exists (
         select 1 from public.assignments a
          where a.schedule_id = v_pub.id
            and a.panel_id = p.id
            and a.status <> 'cancelled')), '[]'::jsonb),
    'slots', coalesce((
      select jsonb_agg(jsonb_build_object(
               'index', sl.index,
               'starts_at', sl.starts_at,
               'ends_at', sl.ends_at) order by sl.index)
        from public.slots sl
       where sl.schedule_id = v_pub.id), '[]'::jsonb),
    'cells', coalesce((
      select jsonb_agg(jsonb_build_object(
               'slot_index', sl.index,
               'station', p.label,
               'team', t.name) order by sl.index, p.sort_order)
        from public.assignments a
        join public.slots  sl on sl.id = a.slot_id
        join public.panels p  on p.id = a.panel_id
        join public.teams  t  on t.id = a.team_id
       where a.schedule_id = v_pub.id
         and a.status <> 'cancelled'), '[]'::jsonb),
    'announcements', coalesce((
      select jsonb_agg(jsonb_build_object(
               'body', an.body, 'level', an.level, 'created_at', an.created_at)
               order by an.created_at desc)
        from public.announcements an
       where an.event_id = v_event.id and an.active), '[]'::jsonb)
  );
end $$;

revoke all on function public.board_view(text) from public;
grant execute on function public.board_view(text) to anon, authenticated;
