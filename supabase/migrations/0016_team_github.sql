-- =============================================================================
-- 0016 : any member of a team may set its GitHub repositories, and nothing
-- else, exactly like set_team_devpost() (0015). Check-in collects them; the
-- team page is where they're added or corrected later. teams_update stays
-- captain-only (0011).
-- =============================================================================

create or replace function public.set_team_github(p_team uuid, p_urls text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_urls text[] := coalesce(p_urls, '{}');
begin
  if not (public.is_organizer()
          or p_team in (select public.my_team_ids())) then
    raise exception 'not_on_team: only the team''s members can change its GitHub links'
      using errcode = '42501';
  end if;
  if cardinality(v_urls) > 5 then
    raise exception 'too_many: at most 5 repositories' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_urls) u
              where u !~* '^https?://github\.com/[^/]+/[^/]+') then
    raise exception 'not_github: use github.com/owner/repo links'
      using errcode = '22023';
  end if;
  update public.teams set github_urls = v_urls where id = p_team;
end $$;
revoke all on function public.set_team_github(uuid, text[]) from public, anon;
grant execute on function public.set_team_github(uuid, text[]) to authenticated;
