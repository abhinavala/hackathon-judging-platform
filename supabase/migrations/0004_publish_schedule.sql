-- =============================================================================
-- Phase 3 / 0004 : publish a draft schedule atomically.
--
-- Publishing does three things that must happen together or not at all:
--   1. the currently published schedule for the event and round is archived,
--   2. the draft becomes published (stamped published_at),
--   3. the stations' judges are set to the composition the draft was
--      generated with (stored in schedules.stats -> 'panelJudges').
--
-- Done as separate client calls, a failure between 1 and 2 would leave the
-- event with NO published schedule, so participants would see nothing. One
-- function call is one transaction.
--
-- Why the composition lives in the draft: panel_judges is shared by every
-- schedule version, so writing a new draft's pairings at generate time would
-- silently change who judges the schedule that is already published. The
-- draft carries its own pairings and they take effect on publish. Editing
-- panel_judges directly afterwards (a judge drops out) is still the
-- one-row-zero-assignments change the schema was designed for.
--
-- SECURITY INVOKER: it runs as the caller, so RLS applies to every statement
-- (only organizers can write schedules or panel_judges). The explicit
-- organizer check just gives a clear error instead of zero rows affected.
-- =============================================================================

create or replace function public.publish_schedule(p_schedule_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event  uuid;
  v_round  int;
  v_status public.schedule_status;
  v_panels jsonb;
begin
  if not public.is_organizer() then
    raise exception 'not_organizer: only organizers can publish a schedule'
      using errcode = '42501';
  end if;

  select s.event_id, s.round, s.status, s.stats -> 'panelJudges'
    into v_event, v_round, v_status, v_panels
    from public.schedules s
   where s.id = p_schedule_id
     for update;

  if not found then
    raise exception 'schedule_not_found: %', p_schedule_id using errcode = 'P0002';
  end if;
  if v_status <> 'draft' then
    raise exception 'not_a_draft: schedule % is %', p_schedule_id, v_status
      using errcode = '22023';
  end if;

  update public.schedules
     set status = 'archived'
   where event_id = v_event and round = v_round and status = 'published';

  update public.schedules
     set status = 'published', published_at = now()
   where id = p_schedule_id;

  if v_panels is not null and jsonb_typeof(v_panels) = 'array' then
    delete from public.panel_judges pj
     using public.panels p
     where pj.panel_id = p.id and p.event_id = v_event;

    insert into public.panel_judges (panel_id, judge_id)
    select (entry ->> 'panelId')::uuid, judge_id::uuid
      from jsonb_array_elements(v_panels) entry,
           jsonb_array_elements_text(entry -> 'judgeIds') judge_id;
  end if;
end $$;

revoke all on function public.publish_schedule(uuid) from public;
revoke all on function public.publish_schedule(uuid) from anon;
grant execute on function public.publish_schedule(uuid) to authenticated;
