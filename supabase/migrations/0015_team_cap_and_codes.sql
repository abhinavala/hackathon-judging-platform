-- =============================================================================
-- 0015 : AWS's rules for Saturday. A team is at most six people, and every
-- team gets a workshop access code and every person a Kiro credit code.
--
--   team size        AWS Workshop Studio caps a team at six and issues one
--                    code per team, never reassigned, so a seventh person
--                    can't be given access. The form and the server stop at
--                    six; this is the backstop for every path (check-in, a
--                    captain adding a teammate, an organizer at the help
--                    desk, the CSV import), serialised per team so two adds
--                    at once can't both take the sixth seat.
--   team_members.id  a stable id per member. The key (team_id, email)
--                    changes when a captain corrects a typo'd address; a
--                    Kiro code must stay with the person.
--   access_codes     the pool, both kinds in one table:
--                      workshop : one per team (the team's join URL + code)
--                      kiro     : one per person (redemption URL + code)
--                    Claimed under an advisory lock (as check_in_team() is
--                    since the one-team race), never by SELECT then INSERT,
--                    and NEVER reassigned: once claimed_at is set it stays
--                    set, even if the team or member is deleted, and a
--                    claimed code can't be deleted (a re-import would
--                    otherwise bring it back unclaimed).
--                    Claims happen in an AFTER INSERT trigger on
--                    team_members, so every way of adding a person claims.
--                    An empty pool claims nothing and never fails the
--                    insert: the check-in succeeds and the organizer
--                    dashboard lists what's missing.
--   my_access_codes()  the ONLY way a participant reads a code: their own
--                    team's workshop code and their own Kiro code, with
--                    only the fields they need (no AWS team name, account
--                    ID or participant IDs). The table itself is
--                    organizer-only; anonymous visitors reach neither.
--   set_team_devpost()  any member of a team may set its Devpost link, and
--                    nothing else: teams_update stays captain-only (0011).
--                    The captain often isn't the one who submits.
--
-- No AWS keys, secrets or CLI credentials are stored, ever: participants get
-- those from their own Workshop Studio dashboard after joining.
-- =============================================================================

-- ---- team size ----------------------------------------------------------------
create or replace function public.max_team_size()
returns int language sql immutable set search_path = '' as $$ select 6 $$;

create or replace function public.enforce_team_size()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_count int;
begin
  if tg_op = 'UPDATE' and new.team_id = old.team_id then
    return new;
  end if;
  -- Held to the end of the transaction: a second add to the same team waits,
  -- then counts this one.
  perform pg_advisory_xact_lock(hashtext('team_size:' || new.team_id::text));
  select count(*) into v_count
    from public.team_members where team_id = new.team_id;
  if v_count >= public.max_team_size() then
    raise exception 'team_full: teams are capped at % people by AWS Workshop Studio',
      public.max_team_size() using errcode = '23514';
  end if;
  return new;
end $$;

create trigger team_members_team_size
  before insert or update of team_id on public.team_members
  for each row execute function public.enforce_team_size();

-- check_in_team() (0008) again, refusing an oversized team up front with a
-- reason the form can show. Otherwise unchanged.
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
  if jsonb_array_length(coalesce(p -> 'members', '[]')) > public.max_team_size() then
    return jsonb_build_object('ok', false, 'error', 'team_too_big',
                              'max', public.max_team_size());
  end if;

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

-- ---- a stable id per member -------------------------------------------------------
alter table public.team_members add column id uuid not null default gen_random_uuid();
alter table public.team_members add constraint team_members_id_key unique (id);

-- ---- the pool --------------------------------------------------------------------
create table public.access_codes (
  id              uuid primary key default gen_random_uuid(),
  seq             bigint generated always as identity,
  event_id        uuid not null references public.events(id) on delete cascade,
  kind            text not null check (kind in ('workshop', 'kiro')),
  code            text not null check (btrim(code) <> ''),
  -- workshop: what the team taps, and what organizers need for support.
  join_url        text,
  aws_team_name   text,  -- AWS's label, for reconciling; never shown to teams
  aws_account_id  text,  -- organizers only
  aws_state       text,
  participant_count int,
  last_joined     text,
  -- kiro
  redemption_url  text,
  amount          int,
  expires_at      timestamptz,
  expires_text    text,  -- as AWS wrote it, if it wasn't a readable date
  -- everything else from the CSV row that is safe to keep (never
  -- Participant IDs), for reconciliation
  details         jsonb not null default '{}',
  -- the claim: set once, never moved to another team or person
  team_id         uuid references public.teams(id) on delete set null,
  member_id       uuid references public.team_members(id) on delete set null,
  claimed_email   text,
  claimed_at      timestamptz,
  imported_at     timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (event_id, kind, code),
  check (kind = 'kiro' or member_id is null)
);

create unique index access_codes_one_workshop_per_team
  on public.access_codes (team_id) where kind = 'workshop' and team_id is not null;
create unique index access_codes_one_kiro_per_member
  on public.access_codes (member_id) where kind = 'kiro' and member_id is not null;
create index access_codes_free
  on public.access_codes (event_id, kind, seq) where claimed_at is null;

alter table public.access_codes enable row level security;

-- Organizers only. Participants read through my_access_codes(); anonymous
-- visitors have no path at all.
create policy access_codes_organizer on public.access_codes
  for all to authenticated
  using (public.is_organizer()) with check (public.is_organizer());

-- Never reassigned. A claim may only be cleared by its team or member being
-- deleted (ON DELETE SET NULL); claimed_at itself never goes back to null,
-- and a claimed code can't be deleted.
create or replace function public.access_codes_keep_claims()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Deleting the whole event (it cascades here) takes its pool with it.
    if old.claimed_at is not null
       and exists (select 1 from public.events where id = old.event_id) then
      raise exception 'code_claimed: % code % is claimed and can''t be deleted',
        old.kind, old.code using errcode = '23514';
    end if;
    return old;
  end if;
  if old.claimed_at is not null and (
       new.claimed_at is distinct from old.claimed_at
    or (new.team_id is not null and new.team_id is distinct from old.team_id)
    or (new.member_id is not null and new.member_id is distinct from old.member_id)
    or new.code is distinct from old.code
    or new.kind is distinct from old.kind) then
    raise exception 'code_claimed: % code % is claimed and is never reassigned',
      old.kind, old.code using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger access_codes_keep_claims
  before update or delete on public.access_codes
  for each row execute function public.access_codes_keep_claims();

-- Claims what a member (and their team) is missing. Locks per event and
-- kind, then re-checks, then takes the oldest free code.
create or replace function public.claim_access_codes(p_member uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team  uuid;
  v_email text;
  v_event uuid;
begin
  select tm.team_id, tm.email, t.event_id into v_team, v_email, v_event
    from public.team_members tm join public.teams t on t.id = tm.team_id
   where tm.id = p_member;
  if v_team is null then return; end if;

  perform pg_advisory_xact_lock(hashtext('claim_code:workshop:' || v_event::text));
  if not exists (select 1 from public.access_codes
                  where kind = 'workshop' and team_id = v_team) then
    update public.access_codes set team_id = v_team, claimed_at = now()
     where id = (select id from public.access_codes
                  where event_id = v_event and kind = 'workshop'
                    and claimed_at is null
                  order by seq limit 1);
  end if;

  perform pg_advisory_xact_lock(hashtext('claim_code:kiro:' || v_event::text));
  if not exists (select 1 from public.access_codes
                  where kind = 'kiro' and member_id = p_member) then
    update public.access_codes
       set team_id = v_team, member_id = p_member,
           claimed_email = v_email, claimed_at = now()
     where id = (select id from public.access_codes
                  where event_id = v_event and kind = 'kiro'
                    and claimed_at is null
                  order by seq limit 1);
  end if;
end $$;
revoke all on function public.claim_access_codes(uuid) from public, anon, authenticated;

create or replace function public.team_members_claim_codes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.claim_access_codes(new.id);
  exception when others then
    -- A code is never worth a failed check-in: the dashboard shows the gap.
    raise warning 'claim_access_codes(%) failed: %', new.id, sqlerrm;
  end;
  return null;
end $$;

create trigger team_members_claim_codes
  after insert on public.team_members
  for each row execute function public.team_members_claim_codes();

-- After topping up the pool: give every checked-in, non-withdrawn team and
-- person what they're missing. Organizers only. Returns how many people it
-- looked at.
create or replace function public.claim_missing_codes(p_event uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare r record; n int := 0;
begin
  if not public.is_organizer() and (select auth.role()) <> 'service_role' then
    raise exception 'organizers only' using errcode = '42501';
  end if;
  for r in
    select tm.id from public.team_members tm
      join public.teams t on t.id = tm.team_id
     where t.event_id = p_event and t.checked_in_at is not null
       and t.withdrawn_at is null
     order by t.checked_in_at, tm.is_captain desc, tm.created_at
  loop
    perform public.claim_access_codes(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.claim_missing_codes(uuid) from public, anon;
grant execute on function public.claim_missing_codes(uuid) to authenticated, service_role;

-- What the signed-in person may see: their team's workshop code and their
-- own Kiro code. Nothing about anyone else, and none of AWS's own fields.
create or replace function public.my_access_codes()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'workshop', (
      select jsonb_build_object('code', ac.code, 'join_url', ac.join_url)
        from public.access_codes ac
        join public.team_members tm on tm.team_id = ac.team_id
       where tm.user_id = (select auth.uid()) and ac.kind = 'workshop'
       order by ac.claimed_at desc limit 1),
    'kiro', (
      select jsonb_build_object(
               'code', ac.code, 'redemption_url', ac.redemption_url,
               'amount', ac.amount, 'expires_at', ac.expires_at,
               'expires_text', ac.expires_text)
        from public.access_codes ac
        join public.team_members tm on tm.id = ac.member_id
       where tm.user_id = (select auth.uid()) and ac.kind = 'kiro'
       order by ac.claimed_at desc limit 1)
  )
  where (select auth.uid()) is not null;
$$;
revoke all on function public.my_access_codes() from public, anon;
grant execute on function public.my_access_codes() to authenticated;

-- ---- Devpost: any member ---------------------------------------------------------
create or replace function public.set_team_devpost(p_team uuid, p_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_url text := nullif(btrim(coalesce(p_url, '')), '');
begin
  if not (public.is_organizer()
          or p_team in (select public.my_team_ids())) then
    raise exception 'not_on_team: only the team''s members can change its Devpost link'
      using errcode = '42501';
  end if;
  if v_url is not null
     and v_url !~* '^https?://([a-z0-9-]+\.)*devpost\.com(/|$)' then
    raise exception 'not_devpost: that isn''t a devpost.com link'
      using errcode = '22023';
  end if;
  update public.teams set devpost_url = v_url where id = p_team;
end $$;
revoke all on function public.set_team_devpost(uuid, text) from public, anon;
grant execute on function public.set_team_devpost(uuid, text) to authenticated;
