-- =============================================================================
-- Phase 2 / 0009 : rate limits for the public check-in form and invite resends.
--
-- Fixed-window counters in Postgres: on Vercel each request may land on a
-- different instance, so an in-memory counter would limit nothing. Keys are
-- built by the server (lib/rate-limit.ts) from an HMAC of the client IP or of
-- an email address, never the raw value.
--
-- The table has RLS on and no policies: nobody but the service role can read
-- or write it, and rate_limit_hit() is granted to the service role alone.
-- =============================================================================

create table public.rate_limits (
  key          text        not null,
  window_start timestamptz not null,
  hits         int         not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security;

-- Counts one hit against `p_key` in the current `p_window_seconds` window and
-- says whether it is within `p_max`. Old windows are swept now and then.
create or replace function public.rate_limit_hit(
  p_key text, p_window_seconds int, p_max int)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_start timestamptz := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  insert into public.rate_limits as r (key, window_start, hits)
  values (p_key, v_start, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning hits into v_hits;

  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_max;
end $$;

revoke all on function public.rate_limit_hit(text, int, int) from public;
revoke all on function public.rate_limit_hit(text, int, int) from anon, authenticated;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;
