-- =============================================================================
-- Phase 5 / 0014 : judge scoring (docs/phase-5-spec.md, item 1).
--
--   rubric_criteria  the rubric as data: per event, key, label, one line of
--                    guidance, scale, order. Changing it is one SQL statement;
--                    the scoring screen reads this table and hardcodes nothing.
--   scores           reshaped: ONE row per judge per assignment (notes,
--                    submitted_at), unique on (assignment_id, judge_id). It
--                    was one row per criterion; the table is empty on every
--                    database (checked 5 Nov 2026), so nothing is migrated.
--   score_items      the values: one per score per criterion, checked against
--                    the criterion's scale.
--   events.scores_locked_at
--                    once set, no judge can write a score or item (item 5's
--                    lock, in place now so freeze day needs no migration).
--
-- Authorization, all explicit (0001's scores_insert relied on judges simply
-- not being able to SEE draft assignments):
--   a judge writes only their own score, only for an assignment that is on
--   the PUBLISHED schedule, not cancelled, at a station they sit on, while
--   the event is unlocked. Organizers read and correct everything.
--   Participants and anonymous visitors read NOTHING: no policy grants them
--   any row of scores, score_items or rubric scale data beyond the labels.
-- =============================================================================

-- ---- the rubric --------------------------------------------------------------
create table public.rubric_criteria (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  key         text not null,
  label       text not null,
  description text,
  scale_min   int not null default 1,
  scale_max   int not null default 5,
  sort_order  int not null default 0,
  unique (event_id, key),
  check (scale_min < scale_max)
);

alter table public.rubric_criteria enable row level security;

-- Labels and guidance aren't secret: a judge needs them to score.
create policy rubric_read on public.rubric_criteria
  for select to authenticated using (true);
create policy rubric_write on public.rubric_criteria
  for all to authenticated
  using (public.is_organizer()) with check (public.is_organizer());

-- This year's rubric, for one event. Idempotent; the seed and the bootstrap
-- script call it for a new event, and this migration for existing ones.
create or replace function public.seed_default_rubric(p_event uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.rubric_criteria
    (event_id, key, label, description, scale_min, scale_max, sort_order)
  values
    (p_event, 'impact', 'Impact',
     'Does it solve a real problem for real people?', 1, 5, 1),
    (p_event, 'technical', 'Technical execution',
     'Does it work, and how well is it built?', 1, 5, 2),
    (p_event, 'innovation', 'Innovation',
     'Is the idea or the approach new?', 1, 5, 3),
    (p_event, 'presentation', 'Presentation',
     'Was the demo clear and well told in the time?', 1, 5, 4)
  on conflict (event_id, key) do nothing;
$$;
revoke all on function public.seed_default_rubric(uuid) from public, anon, authenticated;
grant execute on function public.seed_default_rubric(uuid) to service_role;

select public.seed_default_rubric(id) from public.events;

-- ---- the lock ----------------------------------------------------------------
alter table public.events add column scores_locked_at timestamptz;

-- ---- scores: one row per judge per assignment --------------------------------
drop policy scores_read on public.scores;
drop policy scores_insert on public.scores;
drop policy scores_update on public.scores;
drop policy scores_organizer on public.scores;

alter table public.scores drop constraint scores_assignment_id_judge_id_criterion_key;
alter table public.scores drop column criterion;
alter table public.scores drop column value;
alter table public.scores add column submitted_at timestamptz;
alter table public.scores add constraint scores_one_per_judge unique (assignment_id, judge_id);

-- May the signed-in judge score this assignment right now? Written out in
-- full rather than relying on what RLS lets them see.
create or replace function public.can_score(p_assignment uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.assignments a
      join public.schedules s on s.id = a.schedule_id
      join public.events e on e.id = s.event_id
     where a.id = p_assignment
       and s.status = 'published'
       and a.status <> 'cancelled'
       and e.scores_locked_at is null
       and a.panel_id in (select public.my_panel_ids())
  );
$$;

create policy scores_read on public.scores
  for select to authenticated
  using (public.is_organizer() or judge_id in (select public.my_judge_ids()));

create policy scores_insert on public.scores
  for insert to authenticated
  with check (
    public.is_organizer()
    or (judge_id in (select public.my_judge_ids())
        and public.can_score(assignment_id))
  );

create policy scores_update on public.scores
  for update to authenticated
  using (public.is_organizer() or judge_id in (select public.my_judge_ids()))
  with check (
    public.is_organizer()
    or (judge_id in (select public.my_judge_ids())
        and public.can_score(assignment_id))
  );

create policy scores_delete on public.scores
  for delete to authenticated using (public.is_organizer());

-- ---- score_items -------------------------------------------------------------
create table public.score_items (
  id           uuid primary key default gen_random_uuid(),
  score_id     uuid not null references public.scores(id) on delete cascade,
  criterion_id uuid not null references public.rubric_criteria(id) on delete restrict,
  value        int not null,
  unique (score_id, criterion_id)
);

alter table public.score_items enable row level security;

-- The value must be on its criterion's scale, and the criterion must belong
-- to the event the score's assignment is in.
create or replace function public.check_score_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_min int; v_max int; v_ok boolean;
begin
  select c.scale_min, c.scale_max,
         c.event_id = (select s.event_id
                         from public.scores sc
                         join public.assignments a on a.id = sc.assignment_id
                         join public.schedules s on s.id = a.schedule_id
                        where sc.id = new.score_id)
    into v_min, v_max, v_ok
    from public.rubric_criteria c
   where c.id = new.criterion_id;
  if not coalesce(v_ok, false) then
    raise exception 'criterion_mismatch: that criterion is not in this event''s rubric'
      using errcode = '23514';
  end if;
  if new.value < v_min or new.value > v_max then
    raise exception 'out_of_scale: % is outside %..%', new.value, v_min, v_max
      using errcode = '23514';
  end if;
  return new;
end $$;

create trigger score_items_check
  before insert or update on public.score_items
  for each row execute function public.check_score_item();

-- A judge writes items only onto their own, currently scoreable score.
create or replace function public.my_writable_score(p_score uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.scores sc
     where sc.id = p_score
       and sc.judge_id in (select public.my_judge_ids())
       and public.can_score(sc.assignment_id)
  );
$$;

create policy score_items_read on public.score_items
  for select to authenticated
  using (
    public.is_organizer()
    or score_id in (select sc.id from public.scores sc
                     where sc.judge_id in (select public.my_judge_ids()))
  );

create policy score_items_write on public.score_items
  for all to authenticated
  using (public.is_organizer() or public.my_writable_score(score_id))
  with check (public.is_organizer() or public.my_writable_score(score_id));
