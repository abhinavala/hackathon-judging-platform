-- =============================================================================
-- Phase 3 / 0013 : withdrawn teams.
--
-- A dropped team stayed "checked in", so the next full regenerate seated it
-- again (found in the 1 Nov rehearsal: a team dropped in v5 was back on the
-- board in v8). Now:
--
--   teams.withdrawn_at   set when a late "drop" draft of that team is
--                        PUBLISHED (not when it is drafted: a discarded draft
--                        withdraws nobody), cleared when any version that
--                        seats the team is published (a late re-add, or an
--                        organizer deliberately re-including it in a
--                        regenerate).
--
-- Generate leaves withdrawn teams unticked by default and says why.
--
-- Captains may update their own team row (0011); they must not be able to
-- un-withdraw themselves, so only organizers (and the service role, and this
-- function) may change withdrawn_at.
-- =============================================================================

alter table public.teams add column withdrawn_at timestamptz;

create or replace function public.guard_withdrawn_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.withdrawn_at is distinct from old.withdrawn_at
     and current_user = 'authenticated'
     and not public.is_organizer() then
    raise exception 'not_organizer: only organizers can withdraw a team'
      using errcode = '42501';
  end if;
  return new;
end $$;

create trigger teams_guard_withdrawn_at
  before update of withdrawn_at on public.teams
  for each row execute function public.guard_withdrawn_at();

-- publish_schedule() as in 0004, plus the two withdrawn_at rules at the end,
-- in the same transaction as the publish.
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
  v_late   jsonb;
begin
  if not public.is_organizer() then
    raise exception 'not_organizer: only organizers can publish a schedule'
      using errcode = '42501';
  end if;

  select s.event_id, s.round, s.status, s.stats -> 'panelJudges', s.stats -> 'lateChange'
    into v_event, v_round, v_status, v_panels, v_late
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

  -- Seated in the version going live: not withdrawn.
  update public.teams t
     set withdrawn_at = null
   where t.event_id = v_event
     and t.withdrawn_at is not null
     and exists (
       select 1 from public.assignments a
        where a.schedule_id = p_schedule_id
          and a.team_id = t.id
          and a.status <> 'cancelled');

  -- A published late drop withdraws its team.
  if v_late ->> 'kind' = 'drop' then
    update public.teams
       set withdrawn_at = now()
     where id = (v_late ->> 'teamId')::uuid
       and event_id = v_event;
  end if;
end $$;
