-- =============================================================================
-- Phase 1 acceptance tests.
--
-- These are not "does it compile" tests. Each one asserts that a specific
-- attack or mistake is impossible. If any of these fail, Phase 1 is not done.
--
-- Run:  psql -f supabase/tests/rls_test.sql
-- Exits non-zero on the first failed assertion.
-- =============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function test_assert(cond boolean, what text)
returns void language plpgsql as $$
begin
  if cond then raise notice 'PASS  %', what;
  else raise exception 'FAIL  %', what; end if;
end $$;

-- Act as a given user id with the "authenticated" grant.
create or replace function become(p_uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute 'set local role authenticated';
end $$;

create or replace function become_anon()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
end $$;

-- =============================================================================
-- FIXTURE  (built as superuser, bypassing RLS)
-- =============================================================================
begin;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'captain.a@scu.edu'),
  ('22222222-2222-2222-2222-222222222222', 'captain.b@scu.edu'),
  ('33333333-3333-3333-3333-333333333333', 'judge.aws@aws.com'),
  ('44444444-4444-4444-4444-444444444444', 'judge.a10@a10.com'),
  ('55555555-5555-5555-5555-555555555555', 'organizer@scuacm.com');

update public.profiles set role = 'organizer'
 where user_id = '55555555-5555-5555-5555-555555555555';

insert into public.events (id, slug, name, year)
values ('e0000000-0000-0000-0000-000000000001', 'h4h-2026', 'Hack for Humanity 2026', 2026);

insert into public.tracks (id, event_id, name, sponsor) values
  ('c0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','Best Use of AWS','AWS'),
  ('c0000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000001','Best Use of A10','A10');

insert into public.teams (id, event_id, name, join_code, created_by) values
  ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','Team Alpha','ALFA-1234','11111111-1111-1111-1111-111111111111'),
  ('a0000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000001','Team Bravo','BRVO-5678','22222222-2222-2222-2222-222222222222');

insert into public.team_members (team_id, email, user_id, is_captain) values
  ('a0000000-0000-0000-0000-000000000001','captain.a@scu.edu','11111111-1111-1111-1111-111111111111',true),
  ('a0000000-0000-0000-0000-000000000002','captain.b@scu.edu','22222222-2222-2222-2222-222222222222',true);

insert into public.team_tracks (team_id, track_id) values
  ('a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001');

insert into public.judges (id, event_id, user_id, email, full_name, affiliation) values
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333','judge.aws@aws.com','AWS Judge','AWS'),
  ('d0000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000001','44444444-4444-4444-4444-444444444444','judge.a10@a10.com','A10 Judge','A10');

insert into public.panels (id, event_id, label, location_text) values
  ('b0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','Station 1','Blue section, back wall'),
  ('b0000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000001','Station 2','Blue section, by the windows');

insert into public.panel_judges (panel_id, judge_id) values
  ('b0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000002');

-- one DRAFT schedule and one PUBLISHED schedule
insert into public.schedules (id, event_id, version, status, round) values
  ('50000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001',1,'draft',1),
  ('50000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000001',2,'published',1);

insert into public.slots (id, schedule_id, index, starts_at, ends_at) values
  ('51000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',0,'2026-02-28 09:40-08','2026-02-28 09:47-08'),
  ('52000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002',0,'2026-02-28 09:40-08','2026-02-28 09:47-08'),
  ('52000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002',1,'2026-02-28 09:47-08','2026-02-28 09:54-08');

-- draft: Alpha at station 1
insert into public.assignments (id, schedule_id, team_id, panel_id, slot_id) values
  ('60000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000001');

-- published: Alpha -> station 1 slot 0 ; Bravo -> station 2 slot 0
insert into public.assignments (id, schedule_id, team_id, panel_id, slot_id) values
  ('60000000-0000-0000-0000-000000000011','50000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000012','50000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000002','52000000-0000-0000-0000-000000000001');

insert into public.announcements (event_id, body, level)
values ('e0000000-0000-0000-0000-000000000001','Judging is running 10 minutes behind','warning');

commit;

-- =============================================================================
-- 1. DATABASE INVARIANTS  (these must hold even for a buggy generator)
-- =============================================================================
do $$
declare ok boolean;
begin
  -- panel cannot hold two teams in the same slot
  begin
    insert into public.assignments (schedule_id, team_id, panel_id, slot_id)
    values ('50000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002',
            'b0000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001');
    ok := false;
  exception when unique_violation then ok := true;
  end;
  perform test_assert(ok, 'panel cannot be double-booked in one slot');

  -- team cannot be in two places at once
  begin
    insert into public.assignments (schedule_id, team_id, panel_id, slot_id)
    values ('50000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001',
            'b0000000-0000-0000-0000-000000000002','52000000-0000-0000-0000-000000000001');
    ok := false;
  exception when unique_violation then ok := true;
  end;
  perform test_assert(ok, 'team cannot be double-booked in one slot');

  -- a team presents at most twice
  insert into public.assignments (schedule_id, team_id, panel_id, slot_id)
  values ('50000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001',
          'b0000000-0000-0000-0000-000000000002','52000000-0000-0000-0000-000000000002');
  begin
    insert into public.slots (id, schedule_id, index, starts_at, ends_at)
    values ('52000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000002',2,
            '2026-02-28 09:54-08','2026-02-28 10:01-08');
    insert into public.assignments (schedule_id, team_id, panel_id, slot_id)
    values ('50000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001',
            'b0000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000003');
    ok := false;
  exception when check_violation then ok := true;
  end;
  perform test_assert(ok, 'team cannot be scheduled a third time');

  -- one person, one team per event
  begin
    insert into public.team_members (team_id, email, user_id)
    values ('a0000000-0000-0000-0000-000000000002','captain.a@scu.edu','11111111-1111-1111-1111-111111111111');
    ok := false;
  exception when unique_violation then ok := true;
  end;
  perform test_assert(ok, 'a person cannot join two teams in one event');
end $$;

-- =============================================================================
-- 2. PARTICIPANT ISOLATION
-- =============================================================================
do $$
declare n int;
begin
  perform become('11111111-1111-1111-1111-111111111111');

  select count(*) into n from public.teams;
  perform test_assert(n = 1, 'participant sees exactly one team (their own)');

  select count(*) into n from public.teams where name = 'Team Bravo';
  perform test_assert(n = 0, 'participant cannot see another team');

  select count(*) into n from public.assignments
   where schedule_id = '50000000-0000-0000-0000-000000000001';
  perform test_assert(n = 0, 'participant cannot see DRAFT assignments');

  select count(*) into n from public.assignments
   where schedule_id = '50000000-0000-0000-0000-000000000002';
  perform test_assert(n = 2, 'participant sees their own PUBLISHED assignments');

  select count(*) into n from public.assignments
   where team_id = 'a0000000-0000-0000-0000-000000000002';
  perform test_assert(n = 0, 'participant cannot see another team''s assignments');

  select count(*) into n from public.judges;
  perform test_assert(n = 0, 'participant cannot see the judge roster');

  reset role;
end $$;

-- =============================================================================
-- 3. JUDGE AUTHORISATION  (the reason we chose Postgres)
-- =============================================================================
do $$
declare ok boolean; n int;
begin
  perform become('33333333-3333-3333-3333-333333333333');   -- AWS judge, Station 1

  select count(*) into n from public.teams;
  perform test_assert(n = 1, 'judge sees only teams assigned to their panel');

  -- may score their own panel's assignment
  insert into public.scores (assignment_id, judge_id, criterion, value)
  values ('60000000-0000-0000-0000-000000000011','d0000000-0000-0000-0000-000000000001','impact',8);
  perform test_assert(true, 'judge CAN score a team at their own station');

  -- may NOT score another panel's assignment
  begin
    insert into public.scores (assignment_id, judge_id, criterion, value)
    values ('60000000-0000-0000-0000-000000000012','d0000000-0000-0000-0000-000000000001','impact',3);
    ok := false;
  exception when insufficient_privilege or others then ok := true;
  end;
  perform test_assert(ok, 'judge CANNOT score a team at another station');

  -- may NOT impersonate another judge
  begin
    insert into public.scores (assignment_id, judge_id, criterion, value)
    values ('60000000-0000-0000-0000-000000000011','d0000000-0000-0000-0000-000000000002','impact',1);
    ok := false;
  exception when insufficient_privilege or others then ok := true;
  end;
  perform test_assert(ok, 'judge CANNOT write a score as another judge');

  reset role;
end $$;

do $$
declare n int;
begin
  perform become('44444444-4444-4444-4444-444444444444');   -- A10 judge, Station 2
  select count(*) into n from public.scores;
  perform test_assert(n = 0, 'judge cannot read another judge''s scores');
  reset role;
end $$;

-- =============================================================================
-- 4. ROLE ESCALATION
-- =============================================================================
do $$
declare ok boolean;
begin
  perform become('11111111-1111-1111-1111-111111111111');
  begin
    update public.profiles set role = 'organizer'
     where user_id = '11111111-1111-1111-1111-111111111111';
    ok := false;
  exception when insufficient_privilege or others then ok := true;
  end;
  perform test_assert(ok, 'participant cannot promote themselves to organizer');
  reset role;
end $$;

-- =============================================================================
-- 5. ANONYMOUS ACCESS  (join code + big screen)
-- =============================================================================
do $$
declare n int;
begin
  perform become_anon();

  select count(*) into n from public.team_schedule_by_code('ALFA-1234');
  perform test_assert(n = 2, 'join code returns that team''s published slots');

  select count(*) into n from public.team_schedule_by_code('alfa-1234');
  perform test_assert(n = 2, 'join code is case-insensitive');

  select count(*) into n from public.team_schedule_by_code('NOPE-0000');
  perform test_assert(n = 0, 'a wrong join code returns nothing');

  select count(*) into n from public.public_board('h4h-2026');
  perform test_assert(n = 3, 'big-screen board shows the published schedule');

  select count(*) into n from public.active_announcements('h4h-2026');
  perform test_assert(n = 1, 'announcements are readable without auth');

  reset role;
end $$;

do $$
declare n int; blocked boolean;
begin
  perform become_anon();
  begin
    select count(*) into n from public.teams;
    blocked := (n = 0);
  exception when others then blocked := true;
  end;
  perform test_assert(blocked, 'anonymous cannot read the teams table directly');
  reset role;
end $$;

-- =============================================================================
-- 6. ORGANIZER
-- =============================================================================
do $$
declare n int;
begin
  perform become('55555555-5555-5555-5555-555555555555');
  select count(*) into n from public.teams;
  perform test_assert(n = 2, 'organizer sees every team');
  select count(*) into n from public.assignments;
  perform test_assert(n >= 3, 'organizer sees draft and published assignments');
  select count(*) into n from public.judges;
  perform test_assert(n = 2, 'organizer sees the judge roster');
  reset role;
end $$;

\echo ''
\echo '================= ALL PHASE 1 ACCEPTANCE TESTS PASSED ================='
