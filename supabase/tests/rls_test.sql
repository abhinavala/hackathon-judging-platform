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
  insert into public.scores (assignment_id, judge_id, notes)
  values ('60000000-0000-0000-0000-000000000011','d0000000-0000-0000-0000-000000000001','clear demo');
  perform test_assert(true, 'judge CAN score a team at their own station');

  -- may NOT score another panel's assignment
  begin
    insert into public.scores (assignment_id, judge_id)
    values ('60000000-0000-0000-0000-000000000012','d0000000-0000-0000-0000-000000000001');
    ok := false;
  exception when insufficient_privilege or others then ok := true;
  end;
  perform test_assert(ok, 'judge CANNOT score a team at another station');

  -- may NOT impersonate another judge
  begin
    insert into public.scores (assignment_id, judge_id)
    values ('60000000-0000-0000-0000-000000000011','d0000000-0000-0000-0000-000000000002');
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

-- =============================================================================
-- 7. MIGRATION 0003 REGRESSIONS
-- =============================================================================
do $$
declare n int;
begin
  -- FIX 1: judge must NOT see draft-only teams.
  -- Put Bravo at Station 1 in the DRAFT only; the AWS judge sits at Station 1.
  insert into public.assignments (schedule_id, team_id, panel_id, slot_id)
  values ('50000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002',
          'b0000000-0000-0000-0000-000000000001',
          (select id from public.slots where schedule_id='50000000-0000-0000-0000-000000000001' limit 1))
  on conflict do nothing;

  perform become('33333333-3333-3333-3333-333333333333');
  select count(*) into n from public.teams where name = 'Team Bravo';
  perform test_assert(n = 0, '0003: judge cannot see a team that is only in a DRAFT schedule');
  select count(*) into n from public.teams;
  perform test_assert(n = 1, '0003: judge still sees their own published team');
  reset role;
end $$;

do $$
declare v_uid uuid; v_role text; n int;
begin
  -- FIX 2: a judge added AFTER the person already has an account gets linked.
  insert into auth.users (id, email)
  values ('66666666-6666-6666-6666-666666666666','late.alum@scu.edu');

  insert into public.judges (event_id, email, full_name, affiliation)
  values ('e0000000-0000-0000-0000-000000000001','late.alum@scu.edu','Late Alum', null);

  select user_id into v_uid from public.judges where email = 'late.alum@scu.edu';
  perform test_assert(v_uid = '66666666-6666-6666-6666-666666666666',
                      '0003: judge added after signup is linked to the existing account');

  select role::text into v_role from public.profiles
   where user_id = '66666666-6666-6666-6666-666666666666';
  perform test_assert(v_role = 'judge',
                      '0003: that person is promoted to the judge role');

  -- and a teammate added after signup
  insert into auth.users (id, email)
  values ('77777777-7777-7777-7777-777777777777','late.member@scu.edu');
  insert into public.team_members (team_id, email)
  values ('a0000000-0000-0000-0000-000000000001','late.member@scu.edu');
  select count(*) into n from public.team_members
   where email='late.member@scu.edu' and user_id='77777777-7777-7777-7777-777777777777';
  perform test_assert(n = 1, '0003: teammate added after signup is linked');

  -- and they can now see their team
  perform become('77777777-7777-7777-7777-777777777777');
  select count(*) into n from public.teams;
  perform test_assert(n = 1, '0003: that teammate can now see their team');
  reset role;
end $$;
-- =============================================================================
-- 0010. ONLY THE CAPTAIN (OR AN ORGANIZER) CHANGES WHO IS ON A TEAM
-- =============================================================================
do $$
declare
  n  int;
  ok boolean;
  alpha constant uuid := 'a0000000-0000-0000-0000-000000000001';
  bravo constant uuid := 'a0000000-0000-0000-0000-000000000002';
begin
  -- A plain (non-captain) member of Team Alpha.
  insert into auth.users (id, email)
  values ('88888888-8888-8888-8888-888888888888', 'teammate.a@scu.edu');
  insert into public.team_members (team_id, email)
  values (alpha, 'teammate.a@scu.edu');

  perform become('88888888-8888-8888-8888-888888888888');
  begin
    insert into public.team_members (team_id, email) values (alpha, 'stranger@example.com');
    ok := false;
  exception when insufficient_privilege then ok := true;
  end;
  perform test_assert(ok, '0010: a teammate cannot add a member to their team');

  update public.team_members set email = 'hijack@example.com'
   where team_id = alpha and email = 'captain.a@scu.edu';
  get diagnostics n = row_count;
  perform test_assert(n = 0, '0010: a teammate cannot edit another member''s email');

  update public.team_members set is_captain = true
   where team_id = alpha and email = 'teammate.a@scu.edu';
  get diagnostics n = row_count;
  perform test_assert(n = 0, '0010: a teammate cannot make themselves captain');

  delete from public.team_members where team_id = alpha and email = 'late.member@scu.edu';
  get diagnostics n = row_count;
  perform test_assert(n = 0, '0010: a teammate cannot remove a member');
  reset role;

  select count(*) into n from public.team_members
   where team_id = alpha
     and ((email = 'captain.a@scu.edu' and is_captain)
       or email = 'late.member@scu.edu'
       or (email = 'teammate.a@scu.edu' and not is_captain));
  perform test_assert(n = 3, '0010: and the roster is exactly as it was');

  -- The captain can add, edit and remove members of their own team ...
  perform become('11111111-1111-1111-1111-111111111111');
  insert into public.team_members (team_id, email) values (alpha, 'added@scu.edu');
  update public.team_members set email = 'corrected@scu.edu'
   where team_id = alpha and email = 'added@scu.edu';
  get diagnostics n = row_count;
  ok := n = 1;
  delete from public.team_members where team_id = alpha and email = 'corrected@scu.edu';
  get diagnostics n = row_count;
  perform test_assert(ok and n = 1, '0010: the captain can add, edit and remove members');

  -- ... but not another team's.
  begin
    insert into public.team_members (team_id, email) values (bravo, 'smuggled@scu.edu');
    ok := false;
  exception when insufficient_privilege then ok := true;
  end;
  update public.team_members set email = 'hijack@example.com' where team_id = bravo;
  get diagnostics n = row_count;
  perform test_assert(ok and n = 0, '0010: a captain cannot change another team''s members');
  reset role;

  -- An organizer can change any team.
  perform become('55555555-5555-5555-5555-555555555555');
  insert into public.team_members (team_id, email) values (bravo, 'org.added@scu.edu');
  update public.team_members set full_name = 'Added by organizer'
   where team_id = bravo and email = 'org.added@scu.edu';
  get diagnostics n = row_count;
  ok := n = 1;
  delete from public.team_members where team_id = bravo and email = 'org.added@scu.edu';
  get diagnostics n = row_count;
  perform test_assert(ok and n = 1, '0010: an organizer can add, edit and remove members of any team');
  reset role;
end $$;

-- =============================================================================
-- 0011. TEAM DETAILS AND TRACKS ARE THE CAPTAIN'S; ONLY ORGANIZERS CREATE TEAMS
-- (teammate.a@scu.edu, 8888..., is a plain member of Team Alpha from 0010.)
-- =============================================================================
do $$
declare
  n  int;
  ok boolean;
  alpha constant uuid := 'a0000000-0000-0000-0000-000000000001';
  bravo constant uuid := 'a0000000-0000-0000-0000-000000000002';
  aws   constant uuid := 'c0000000-0000-0000-0000-000000000001';
  a10   constant uuid := 'c0000000-0000-0000-0000-000000000002';
begin
  -- ---- teams_update --------------------------------------------------------
  perform become('88888888-8888-8888-8888-888888888888');
  update public.teams set name = 'Renamed by a teammate' where id = alpha;
  get diagnostics n = row_count;
  perform test_assert(n = 0, '0011: a teammate cannot edit the team''s details');
  reset role;

  perform become('11111111-1111-1111-1111-111111111111');
  update public.teams set devpost_url = 'https://devpost.com/software/alpha' where id = alpha;
  get diagnostics n = row_count;
  perform test_assert(n = 1, '0011: the captain can edit their team''s details');
  update public.teams set name = 'Renamed by another captain' where id = bravo;
  get diagnostics n = row_count;
  perform test_assert(n = 0, '0011: a captain cannot edit another team''s details');
  reset role;

  perform become('55555555-5555-5555-5555-555555555555');
  update public.teams set notes = 'checked by organizer' where id = bravo;
  get diagnostics n = row_count;
  perform test_assert(n = 1, '0011: an organizer can edit any team''s details');
  reset role;

  select count(*) into n from public.teams
   where (id = alpha and name = 'Team Alpha') or (id = bravo and name = 'Team Bravo');
  perform test_assert(n = 2, '0011: and neither team''s name changed');

  -- ---- team_tracks (decides which sponsor judges a team needs) --------------
  perform become('88888888-8888-8888-8888-888888888888');
  begin
    insert into public.team_tracks (team_id, track_id) values (alpha, a10);
    ok := false;
  exception when insufficient_privilege then ok := true;
  end;
  delete from public.team_tracks where team_id = alpha and track_id = aws;
  get diagnostics n = row_count;
  perform test_assert(ok and n = 0, '0011: a teammate cannot add or remove the team''s tracks');
  reset role;

  perform become('11111111-1111-1111-1111-111111111111');
  insert into public.team_tracks (team_id, track_id) values (alpha, a10);
  delete from public.team_tracks where team_id = alpha and track_id = a10;
  get diagnostics n = row_count;
  ok := n = 1;
  begin
    insert into public.team_tracks (team_id, track_id) values (bravo, aws);
    perform test_assert(false, '0011: a captain cannot change another team''s tracks');
  exception when insufficient_privilege then null;
  end;
  perform test_assert(ok, '0011: the captain can add and remove their team''s tracks');
  delete from public.team_tracks where team_id = bravo;
  get diagnostics n = row_count;
  perform test_assert(n = 0, '0011: a captain cannot change another team''s tracks');
  reset role;

  perform become('55555555-5555-5555-5555-555555555555');
  insert into public.team_tracks (team_id, track_id) values (bravo, a10);
  delete from public.team_tracks where team_id = bravo and track_id = a10;
  get diagnostics n = row_count;
  perform test_assert(n = 1, '0011: an organizer can change any team''s tracks');
  reset role;

  select count(*) into n from public.team_tracks;
  perform test_assert(n = 1, '0011: and the tracks are exactly as they were');

  -- ---- teams_insert ---------------------------------------------------------
  perform become('11111111-1111-1111-1111-111111111111');
  begin
    insert into public.teams (event_id, name, join_code, created_by)
    values ('e0000000-0000-0000-0000-000000000001', 'Self-made', 'SELF-0001',
            '11111111-1111-1111-1111-111111111111');
    ok := false;
  exception when insufficient_privilege then ok := true;
  end;
  perform test_assert(ok, '0011: a participant cannot create a team, even naming themselves creator');
  reset role;

  perform become('55555555-5555-5555-5555-555555555555');
  insert into public.teams (event_id, name, join_code)
  values ('e0000000-0000-0000-0000-000000000001', 'Organizer-made', 'ORGM-0001');
  delete from public.teams where join_code = 'ORGM-0001';
  get diagnostics n = row_count;
  perform test_assert(n = 1, '0011: an organizer can create a team');
  reset role;
end $$;

-- ---- 0012: check-in email status -------------------------------------------
-- Written by the service role only; organizers read it; a captain can
-- neither read their own row nor clear their own failure.
do $$
declare
  n int; ok boolean;
  alpha constant uuid := 'a0000000-0000-0000-0000-000000000001';
begin
  insert into public.checkin_emails (team_id, status, failed, error)
  values (alpha, 'failed', array['typo@scu.edu'], 'SMTP did not accept');

  perform become('55555555-5555-5555-5555-555555555555');
  select count(*) into n from public.checkin_emails;
  perform test_assert(n = 1, '0012: an organizer can read check-in email status');
  update public.checkin_emails set status = 'sent', failed = '{}' where team_id = alpha;
  get diagnostics n = row_count;
  perform test_assert(n = 0, '0012: an organizer cannot rewrite it (only the service role writes)');
  reset role;

  perform become('11111111-1111-1111-1111-111111111111');
  select count(*) into n from public.checkin_emails;
  perform test_assert(n = 0, '0012: a captain cannot read their team''s email status');
  update public.checkin_emails set status = 'sent', failed = '{}' where team_id = alpha;
  get diagnostics n = row_count;
  perform test_assert(n = 0, '0012: a captain cannot clear their own failure');
  begin
    insert into public.checkin_emails (team_id, status) values
      ('a0000000-0000-0000-0000-000000000002', 'sent');
    ok := false;
  exception when insufficient_privilege then ok := true;
  end;
  perform test_assert(ok, '0012: a captain cannot insert a status row');
  reset role;

  perform become('33333333-3333-3333-3333-333333333333');
  select count(*) into n from public.checkin_emails;
  perform test_assert(n = 0, '0012: a judge cannot read it');
  reset role;

  perform become_anon();
  select count(*) into n from public.checkin_emails;
  perform test_assert(n = 0, '0012: anonymous visitors cannot read it');
  reset role;

  select status = 'failed' and failed = array['typo@scu.edu'] into ok
    from public.checkin_emails where team_id = alpha;
  perform test_assert(ok, '0012: and the row is exactly as the service role left it');
  delete from public.checkin_emails;
end $$;

-- ---- 0013: withdrawn_at is the organizers' --------------------------------
do $$
declare
  n int; ok boolean;
  alpha constant uuid := 'a0000000-0000-0000-0000-000000000001';
begin
  perform become('11111111-1111-1111-1111-111111111111');
  begin
    update public.teams set withdrawn_at = now() where id = alpha;
    ok := false;
  exception when insufficient_privilege then ok := true;
  end;
  perform test_assert(ok, '0013: a captain cannot withdraw their own team');
  update public.teams set devpost_url = 'https://devpost.com/software/alpha' where id = alpha;
  get diagnostics n = row_count;
  perform test_assert(n = 1, '0013: and can still edit the team''s details');
  reset role;

  perform become('55555555-5555-5555-5555-555555555555');
  update public.teams set withdrawn_at = now() where id = alpha;
  get diagnostics n = row_count;
  perform test_assert(n = 1, '0013: an organizer can withdraw a team');
  reset role;

  perform become('11111111-1111-1111-1111-111111111111');
  begin
    update public.teams set withdrawn_at = null where id = alpha;
    ok := false;
  exception when insufficient_privilege then ok := true;
  end;
  perform test_assert(ok, '0013: a captain cannot un-withdraw their team');
  reset role;

  update public.teams set withdrawn_at = null, devpost_url = null where id = alpha;
end $$;

-- ---- 0013: publish_schedule() withdraws and un-withdraws -------------------
do $$
declare
  ok boolean;
  alpha constant uuid := 'a0000000-0000-0000-0000-000000000001';
  bravo constant uuid := 'a0000000-0000-0000-0000-000000000002';
  v3    constant uuid := '50000000-0000-0000-0000-000000000003';
begin
  -- A late drop of Alpha that still seats Bravo, who was withdrawn earlier.
  update public.teams set withdrawn_at = now() where id = bravo;
  insert into public.schedules (id, event_id, version, status, round, stats)
  values (v3, 'e0000000-0000-0000-0000-000000000001', 3, 'draft', 1,
          jsonb_build_object('lateChange', jsonb_build_object('kind', 'drop', 'teamId', alpha)));
  insert into public.slots (id, schedule_id, index, starts_at, ends_at) values
    ('53000000-0000-0000-0000-000000000001', v3, 0, '2026-02-28 09:40-08', '2026-02-28 09:47-08');
  insert into public.assignments (schedule_id, team_id, panel_id, slot_id, status) values
    (v3, alpha, 'b0000000-0000-0000-0000-000000000001', '53000000-0000-0000-0000-000000000001', 'cancelled'),
    (v3, bravo, 'b0000000-0000-0000-0000-000000000002', '53000000-0000-0000-0000-000000000001', 'scheduled');

  perform become('55555555-5555-5555-5555-555555555555');
  perform public.publish_schedule(v3);
  reset role;

  select withdrawn_at is not null into ok from public.teams where id = alpha;
  perform test_assert(ok, '0013: publishing a late drop withdraws the dropped team');
  select withdrawn_at is null into ok from public.teams where id = bravo;
  perform test_assert(ok, '0013: publishing a version that seats a withdrawn team un-withdraws it');

  -- Put the fixture back as it was.
  delete from public.schedules where id = v3;
  update public.schedules set status = 'published'
   where id = '50000000-0000-0000-0000-000000000002';
  update public.teams set withdrawn_at = null where id in (alpha, bravo);
end $$;

-- ---- 0014: scoring -----------------------------------------------------------
-- The irreplaceable piece (docs/phase-5-spec.md). The AWS judge's score on
-- Alpha's published Station 1 assignment exists from section 3.
do $$
declare
  ok boolean; n int;
  ev     constant uuid := 'e0000000-0000-0000-0000-000000000001';
  aws    constant uuid := 'd0000000-0000-0000-0000-000000000001';
  score  uuid;
  impact uuid;
  tech   uuid;
begin
  perform public.seed_default_rubric(ev);
  select id into impact from public.rubric_criteria where event_id = ev and key = 'impact';
  select id into tech from public.rubric_criteria where event_id = ev and key = 'technical';
  select id into score from public.scores
   where assignment_id = '60000000-0000-0000-0000-000000000011' and judge_id = aws;

  perform become('33333333-3333-3333-3333-333333333333');   -- AWS judge, Station 1
  insert into public.score_items (score_id, criterion_id, value) values (score, impact, 4);
  update public.score_items set value = 5 where score_id = score and criterion_id = impact;
  get diagnostics n = row_count;
  perform test_assert(n = 1, '0014: a judge can score and revise their own team on the rubric');
  begin
    insert into public.score_items (score_id, criterion_id, value) values (score, tech, 6);
    ok := false;
  exception when others then ok := true;
  end;
  perform test_assert(ok, '0014: a value outside the criterion''s scale is refused');
  begin
    -- Alpha at Station 1 on the DRAFT schedule: the judge's own station.
    insert into public.scores (assignment_id, judge_id)
    values ('60000000-0000-0000-0000-000000000001', aws);
    ok := false;
  exception when others then ok := true;
  end;
  perform test_assert(ok, '0014: a judge cannot score an assignment on a draft schedule, even at their own station');
  reset role;

  perform become('44444444-4444-4444-4444-444444444444');   -- A10 judge, Station 2
  begin
    insert into public.score_items (score_id, criterion_id, value) values (score, tech, 1);
    ok := false;
  exception when others then ok := true;
  end;
  perform test_assert(ok, '0014: a judge cannot write values onto another judge''s score');
  select count(*) into n from public.score_items;
  perform test_assert(n = 0, '0014: a judge cannot read another judge''s values');
  reset role;

  -- THE ONE THAT MATTERS: a participant never reads scores, not even their
  -- own team's (Alpha's captain; Alpha has just been scored).
  perform become('11111111-1111-1111-1111-111111111111');
  select count(*) into n from public.scores;
  perform test_assert(n = 0, '0014: a participant cannot read any score, including their own team''s');
  select count(*) into n from public.score_items;
  perform test_assert(n = 0, '0014: a participant cannot read any score values');
  begin
    insert into public.rubric_criteria (event_id, key, label) values (ev, 'mine', 'Mine');
    ok := false;
  exception when insufficient_privilege then ok := true;
  end;
  perform test_assert(ok, '0014: a participant cannot change the rubric');
  reset role;

  perform become_anon();
  select count(*) into n from public.scores;
  perform test_assert(n = 0, '0014: anonymous visitors cannot read scores');
  reset role;

  -- Locked: the numbers used to pick winners can't move.
  update public.events set scores_locked_at = now() where id = ev;
  perform become('33333333-3333-3333-3333-333333333333');
  update public.score_items set value = 1 where score_id = score;
  get diagnostics n = row_count;
  perform test_assert(n = 0, '0014: once the event is locked, a judge cannot change a value');
  reset role;

  perform become('55555555-5555-5555-5555-555555555555');
  select count(*) into n from public.score_items where score_id = score and value = 5;
  perform test_assert(n = 1, '0014: an organizer reads every value, and the locked one is unchanged');
  reset role;

  update public.events set scores_locked_at = null where id = ev;
  delete from public.scores;
end $$;

-- ---- 0015: team cap, the code pool, Devpost by any member -------------------
do $$
declare
  ok boolean; n int; m int; j jsonb;
  ev    constant uuid := 'e0000000-0000-0000-0000-000000000001';
  alpha constant uuid := 'a0000000-0000-0000-0000-000000000001';
  bravo constant uuid := 'a0000000-0000-0000-0000-000000000002';
  cap_a constant uuid := '11111111-1111-1111-1111-111111111111';
  cap_b constant uuid := '22222222-2222-2222-2222-222222222222';
  mate  constant uuid := '88888888-8888-8888-8888-888888888801';
  org   constant uuid := '55555555-5555-5555-5555-555555555555';
  ws_alpha text; kiro_cap text; kiro_mate text;
begin
  update public.teams set checked_in_at = now() where id in (alpha, bravo);
  insert into auth.users (id, email) values (mate, 'mate.a@scu.edu');
  insert into public.team_members (team_id, email) values (alpha, 'mate.a@scu.edu');

  -- The pool arrives after check-in; topping it up fills the gaps.
  perform become(org);
  insert into public.access_codes (event_id, kind, code, join_url, aws_team_name, aws_account_id) values
    (ev, 'workshop', 'WSONE1', 'https://catalog.us-east-1.prod.workshops.aws/join?access-code=WSONE1', 'team-001', '111122223333'),
    (ev, 'workshop', 'WSTWO2', 'https://catalog.us-east-1.prod.workshops.aws/join?access-code=WSTWO2', 'team-002', '444455556666');
  insert into public.access_codes (event_id, kind, code, redemption_url, amount)
  select ev, 'kiro', 'KIRO-' || g, 'https://kiro.example/redeem/' || g, 1000
    from generate_series(1, 12) g;
  perform public.claim_missing_codes(ev);
  reset role;
  select count(*) into m from public.team_members where team_id in (alpha, bravo);
  select count(*) into n from public.access_codes where kind = 'workshop' and team_id in (alpha, bravo);
  select count(*) = m into ok from public.access_codes where kind = 'kiro' and member_id is not null;
  perform test_assert(n = 2 and ok,
    '0015: each checked-in team gets one workshop code and each member one Kiro code');
  select code into ws_alpha from public.access_codes where kind = 'workshop' and team_id = alpha;
  select ac.code into kiro_cap from public.access_codes ac
    join public.team_members tm on tm.id = ac.member_id where tm.email = 'captain.a@scu.edu';
  select ac.code into kiro_mate from public.access_codes ac
    join public.team_members tm on tm.id = ac.member_id where tm.email = 'mate.a@scu.edu';

  perform become(cap_a);
  j := public.my_access_codes();
  perform test_assert(j -> 'workshop' ->> 'code' = ws_alpha and j -> 'kiro' ->> 'code' = kiro_cap
                      and j -> 'workshop' ->> 'join_url' like '%' || ws_alpha
                      and j::text not like '%111122223333%' and j::text not like '%team-001%',
    '0015: a member sees their team''s workshop code and their own Kiro code, and none of AWS''s fields');
  select count(*) into n from public.access_codes;
  perform test_assert(n = 0, '0015: a participant cannot read the pool directly');
  reset role;

  perform become(mate);
  j := public.my_access_codes();
  perform test_assert(j -> 'workshop' ->> 'code' = ws_alpha and j -> 'kiro' ->> 'code' = kiro_mate
                      and kiro_mate <> kiro_cap,
    '0015: a teammate sees the same workshop code but only their own Kiro code');
  reset role;

  perform become(cap_b);
  j := public.my_access_codes();
  perform test_assert(j -> 'workshop' ->> 'code' <> ws_alpha and j::text not like '%' || kiro_cap || '"%',
    '0015: another team''s captain sees neither of Alpha''s codes');
  reset role;

  perform become_anon();
  begin
    select count(*) into n from public.access_codes;
    ok := n = 0;
  exception when others then ok := true;
  end;
  begin
    j := public.my_access_codes();
    ok := false;
  exception when others then null;
  end;
  perform test_assert(ok, '0015: an anonymous request reaches neither kind of code');
  j := public.team_view('ALFA-1234');
  perform test_assert(j ->> 'found' = 'true' and j::text not like '%' || ws_alpha || '%'
                      and j::text not like '%KIRO-%',
    '0015: the join-code page (/t/CODE) carries no code of either kind');
  reset role;

  perform become(org);
  begin
    update public.access_codes set claimed_at = null where code = ws_alpha;
    ok := false;
  exception when others then ok := true;
  end;
  begin
    update public.access_codes set member_id = (select id from public.team_members where email = 'mate.a@scu.edu')
     where code = kiro_cap;
    ok := false;
  exception when others then ok := ok;
  end;
  begin
    delete from public.access_codes where code = kiro_cap;
    ok := false;
  exception when others then ok := ok;
  end;
  perform test_assert(ok, '0015: a claimed code is never reassigned or deleted, even by an organizer');
  reset role;

  -- A teammate added later gets a Kiro code; the team keeps its one workshop code.
  perform become(cap_a);
  insert into public.team_members (team_id, email) values (alpha, 'late.a@scu.edu');
  reset role;
  select count(*) into n from public.access_codes ac
    join public.team_members tm on tm.id = ac.member_id
   where tm.email = 'late.a@scu.edu' and ac.kind = 'kiro';
  select count(*) into m from public.access_codes where kind = 'workshop' and team_id = alpha;
  perform test_assert(n = 1 and m = 1,
    '0015: a teammate added later claims a Kiro code and shares the team''s workshop code');

  -- Six is the cap: the captain fills the team, then a seventh is refused.
  perform become(cap_a);
  select count(*) into n from public.team_members where team_id = alpha;
  for i in n + 1 .. 6 loop
    insert into public.team_members (team_id, email) values (alpha, 'fill' || i || '@scu.edu');
  end loop;
  begin
    insert into public.team_members (team_id, email) values (alpha, 'seventh@scu.edu');
    ok := false;
  exception when others then ok := sqlerrm like 'team_full%';
  end;
  reset role;
  perform become(org);
  begin
    insert into public.team_members (team_id, email) values (alpha, 'seventh@scu.edu');
    ok := false;
  exception when others then ok := ok and sqlerrm like 'team_full%';
  end;
  reset role;
  select count(*) into n from public.team_members where team_id = alpha;
  perform test_assert(ok and n = 6,
    '0015: a seventh member is refused, for the captain and an organizer alike');

  select count(*) into m from public.teams;
  j := public.check_in_team(jsonb_build_object(
    'event_id', ev, 'name', 'Too Many', 'join_code', 'TOOB-1234',
    'contact_email', 'c1@scu.edu', 'has_grad_student', false,
    'all_freshmen', false, 'half_or_more_non_male', false,
    'members', (select jsonb_agg(jsonb_build_object('email', 'c' || g || '@scu.edu', 'is_captain', g = 1))
                  from generate_series(1, 7) g)));
  select count(*) into n from public.teams;
  perform test_assert(j ->> 'error' = 'team_too_big' and n = m,
    '0015: check-in refuses a team of seven and saves nothing');

  -- An empty pool never fails adding a person; they just have no code yet.
  perform become(org);
  delete from public.access_codes where kind = 'kiro' and claimed_at is null;
  reset role;
  perform become(cap_b);
  insert into public.team_members (team_id, email) values (bravo, 'nocode.b@scu.edu');
  reset role;
  select count(*) into n from public.team_members where email = 'nocode.b@scu.edu';
  select count(*) into m from public.access_codes ac
    join public.team_members tm on tm.id = ac.member_id where tm.email = 'nocode.b@scu.edu';
  perform test_assert(n = 1 and m = 0, '0015: with the pool empty, adding a person still succeeds');

  -- Devpost: any member, and nothing else about the team.
  perform become(mate);
  perform public.set_team_devpost(alpha, 'https://devpost.com/software/alpha');
  update public.teams set name = 'Renamed by a teammate' where id = alpha;
  get diagnostics n = row_count;
  reset role;
  select count(*) into m from public.teams
   where id = alpha and devpost_url = 'https://devpost.com/software/alpha' and name = 'Team Alpha';
  perform test_assert(m = 1 and n = 0,
    '0015: a non-captain member can set the Devpost link, and still cannot rename the team');
  perform become(cap_b);
  begin
    perform public.set_team_devpost(alpha, 'https://devpost.com/software/hijack');
    ok := false;
  exception when others then ok := true;
  end;
  reset role;
  perform become(mate);
  begin
    perform public.set_team_devpost(alpha, 'https://evil.example/devpost.com');
    ok := false;
  exception when others then ok := ok;
  end;
  reset role;
  perform become_anon();
  begin
    perform public.set_team_devpost(alpha, 'https://devpost.com/software/anon');
    ok := false;
  exception when others then ok := ok;
  end;
  reset role;
  select count(*) into m from public.teams
   where id = alpha and devpost_url = 'https://devpost.com/software/alpha';
  perform test_assert(ok and m = 1,
    '0015: another team, an anonymous visitor, or a non-Devpost link can''t set it');
end $$;

\echo ''
\echo '================= ALL PHASE 1 ACCEPTANCE TESTS PASSED ================='
