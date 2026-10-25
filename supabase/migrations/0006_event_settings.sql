-- =============================================================================
-- Phase 4 / 0006 : event-level settings for participant-facing copy.
--
--   judging_starts_at  The authoritative judging start. "Not published yet:
--                      check back closer to X" reads this, not a draft's first
--                      slot: a draft can be regenerated at another time, and
--                      we'd have told people 10:00 then started at 10:30. The
--                      generate screen defaults to it, and the schedule review
--                      warns when a schedule starts at a different time.
--   help_location      Where to send someone with a problem, as a place a
--                      stranger to the building can find ("the check-in table
--                      by the main entrance"). Read into "find an organizer at
--                      <help_location>" on the team page, the board and the
--                      printed schedule. Null falls back to "the help desk".
--
-- Both nullable: an event row exists before anyone knows these.
--
-- team_view() (0005) is replaced to return them inside `event`, and its
-- `expected_start` (newest schedule's first slot) is dropped for the reason
-- above.
-- =============================================================================

alter table public.events
  add column judging_starts_at timestamptz,
  add column help_location text
    check (help_location is null or length(btrim(help_location)) between 1 and 200);

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

  return jsonb_build_object(
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
      'timezone', v_event.timezone,
      'judging_starts_at', v_event.judging_starts_at,
      'help_location', v_event.help_location),
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
    'announcements', coalesce((
      select jsonb_agg(jsonb_build_object(
               'body', an.body, 'level', an.level, 'created_at', an.created_at)
               order by an.created_at desc)
        from public.announcements an
       where an.event_id = v_team.event_id and an.active), '[]'::jsonb)
  );
end $$;

revoke all on function public.team_view(text) from public;
grant execute on function public.team_view(text) to anon, authenticated;
