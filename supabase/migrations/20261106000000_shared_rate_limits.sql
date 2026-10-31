-- Scalability option C: rate-limit counters shared by every server instance.
-- Today each Node process counts in its own memory, so running two instances
-- on Render would double every limit (e.g. 16 login attempts instead of 8).
-- Additive: a new table and functions. The app only uses them when
-- RATE_LIMIT_STORE=postgres is set, so applying this changes nothing by itself.
create table if not exists public.rate_limit_hits (
    key text primary key check (char_length(key) <= 300),
    hits integer not null check (hits >= 0),
    reset_at timestamptz not null
);

create index if not exists rate_limit_hits_reset_idx on public.rate_limit_hits (reset_at);

-- Server-only, like the other Coffee Lab tables: RLS on, no policies.
alter table public.rate_limit_hits enable row level security;
revoke all on public.rate_limit_hits from anon, authenticated;
grant all on public.rate_limit_hits to service_role;

-- Counts one hit atomically: starts a new window when the old one has ended.
create or replace function public.rate_limit_hit(p_key text, p_window_ms integer)
returns table (total_hits integer, reset_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
begin
    if p_window_ms is null or p_window_ms <= 0 then
        raise exception 'Window must be positive.';
    end if;

    return query
    insert into public.rate_limit_hits as current (key, hits, reset_at)
    values (p_key, 1, now() + make_interval(secs => p_window_ms / 1000.0))
    on conflict (key) do update
        set hits = case when current.reset_at <= now() then 1 else current.hits + 1 end,
            reset_at = case
                when current.reset_at <= now() then now() + make_interval(secs => p_window_ms / 1000.0)
                else current.reset_at
            end
    returning current.hits, current.reset_at;

    -- Keep the table small: about 1 in 100 hits clears windows that ended over an hour ago.
    if random() < 0.01 then
        delete from public.rate_limit_hits where public.rate_limit_hits.reset_at < now() - interval '1 hour';
    end if;
end;
$$;

-- Used by express-rate-limit's skipSuccessfulRequests / skipFailedRequests options.
create or replace function public.rate_limit_decrement(p_key text)
returns void
language sql
security invoker
set search_path = ''
as $$
    update public.rate_limit_hits set hits = greatest(hits - 1, 0) where key = p_key;
$$;

create or replace function public.rate_limit_reset(p_key text)
returns void
language sql
security invoker
set search_path = ''
as $$
    delete from public.rate_limit_hits where key = p_key;
$$;

revoke all on function public.rate_limit_hit(text, integer) from public, anon, authenticated;
revoke all on function public.rate_limit_decrement(text) from public, anon, authenticated;
revoke all on function public.rate_limit_reset(text) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer) to service_role;
grant execute on function public.rate_limit_decrement(text) to service_role;
grant execute on function public.rate_limit_reset(text) to service_role;
