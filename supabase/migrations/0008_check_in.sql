-- =============================================================================
-- Phase 2 / 0008 : check_in_team(payload), the public check-in form's write.
--
-- The form is anonymous, but RLS is NOT loosened for it: the server validates
-- the form and calls this with the service role (granted to nobody else).
-- One call is one transaction, so a team never exists without its members
-- and tracks.
--
-- Two teammates checking in at the same moment would both pass
-- enforce_one_team_per_event(): a trigger can't see the other transaction's
-- uncommitted rows. So check-ins for an event are serialised with an advisory
-- lock, then checked up front, naming every address already on a team (the
-- trigger stays as the backstop). Check-in volume is one form per team, so
-- the lock costs nothing.
--
-- payload: { event_id, name, join_code, contact_email, contact_phone,
--            devpost_url, github_urls[], has_grad_student, all_freshmen,
--            half_or_more_non_male, notes, track_ids[],
--            members: [{ email, full_name, is_captain }] }
-- returns: { ok: true, team_id, join_code }
--        | { ok: false, error: 'already_on_a_team', emails: [...] }
--        | { ok: false, error: 'name_taken' }
--        | { ok: false, error: 'join_code_taken' }   (caller retries)
-- =============================================================================

create or replace function public.check_in_team(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event uuid := (p ->> 'event_id')::uuid;
  v_team  uuid;
  v_clash text[];
begin
  perform pg_advisory_xact_lock(hashtext('check_in_team:' || v_event::text));

  select array_agg(distinct lower(m ->> 'email') order by lower(m ->> 'email'))
    into v_clash
    from jsonb_array_elements(p -> 'members') m
    join public.team_members tm on lower(tm.email) = lower(m ->> 'email')
    join public.teams t on t.id = tm.team_id and t.event_id = v_event;
  if v_clash is not null then
    return jsonb_build_object('ok', false, 'error', 'already_on_a_team',
                              'emails', to_jsonb(v_clash));
  end if;

  if exists (select 1 from public.teams
              where event_id = v_event
                and lower(btrim(name)) = lower(btrim(p ->> 'name'))) then
    return jsonb_build_object('ok', false, 'error', 'name_taken');
  end if;
  if exists (select 1 from public.teams
              where event_id = v_event and join_code = p ->> 'join_code') then
    return jsonb_build_object('ok', false, 'error', 'join_code_taken');
  end if;

  insert into public.teams (
    event_id, name, join_code, contact_email, contact_phone, devpost_url,
    github_urls, has_grad_student, all_freshmen, half_or_more_non_male,
    notes, checked_in_at)
  values (
    v_event,
    btrim(p ->> 'name'),
    p ->> 'join_code',
    lower(p ->> 'contact_email'),
    nullif(p ->> 'contact_phone', ''),
    nullif(p ->> 'devpost_url', ''),
    coalesce(array(select jsonb_array_elements_text(p -> 'github_urls')), '{}'),
    (p ->> 'has_grad_student')::boolean,
    (p ->> 'all_freshmen')::boolean,
    (p ->> 'half_or_more_non_male')::boolean,
    nullif(p ->> 'notes', ''),
    now())
  returning id into v_team;

  insert into public.team_members (team_id, email, full_name, is_captain)
  select v_team, lower(m ->> 'email'), nullif(btrim(m ->> 'full_name'), ''),
         coalesce((m ->> 'is_captain')::boolean, false)
    from jsonb_array_elements(p -> 'members') m;

  insert into public.team_tracks (team_id, track_id)
  select v_team, tr.id
    from public.tracks tr
   where tr.event_id = v_event
     and tr.id::text in (select jsonb_array_elements_text(p -> 'track_ids'));

  return jsonb_build_object('ok', true, 'team_id', v_team,
                            'join_code', p ->> 'join_code');
end $$;

revoke all on function public.check_in_team(jsonb) from public;
revoke all on function public.check_in_team(jsonb) from anon, authenticated;
grant execute on function public.check_in_team(jsonb) to service_role;
