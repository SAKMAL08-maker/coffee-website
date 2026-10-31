-- Profiles and per-admin statistics.
--
-- 1. coffee_users gets a short bio and a profile picture reference (the image itself is in
--    Backblaze B2 under avatars/, like receipts; only its object key is stored here).
-- 2. order_events records who moved an order and when (accepted, sent out, arrived, closed,
--    cancelled, cash collected). It powers each admin's own statistics and is an audit trail.
-- 3. Two read-only functions compute profile statistics inside Postgres, so the API returns a
--    few numbers instead of downloading a customer's or admin's whole order history.
-- Additive: new nullable columns, a new table and new functions. Nothing existing changes.

alter table public.coffee_users
    add column if not exists bio text,
    add column if not exists avatar_object_key text,
    add column if not exists avatar_updated_at timestamptz;

alter table public.coffee_users
    drop constraint if exists coffee_users_bio_length_check;
alter table public.coffee_users
    add constraint coffee_users_bio_length_check check (bio is null or char_length(bio) <= 280);

create table if not exists public.order_events (
    id bigint generated always as identity primary key,
    order_id uuid not null references public.orders (id) on delete cascade,
    actor_id uuid references public.coffee_users (id) on delete set null,
    action text not null
        check (action in ('accepted', 'sent_out', 'arrived', 'closed', 'cancelled', 'cash_collected')),
    created_at timestamptz not null default now()
);

create index if not exists order_events_actor_action_idx on public.order_events (actor_id, action, created_at desc);
create index if not exists order_events_order_idx on public.order_events (order_id, created_at);

-- Only the server (service role) reads and writes this table, like the other tables.
alter table public.order_events enable row level security;

-- A customer's own numbers. Cancelled orders don't count.
create or replace function public.customer_profile_stats(p_account_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
    with my_orders as (
        select id, created_at, fulfillment_method, coalesce((pricing ->> 'total_cents')::bigint, 0) as total_cents
        from public.orders
        where account_id = p_account_id and status <> 'Cancelled'
    ),
    my_items as (
        select item.name, item.classification, my_orders.created_at
        from public.order_items as item
        join my_orders on my_orders.id = item.order_id
    ),
    favorite as (
        select name, max(classification) as classification, count(*) as times, max(created_at) as last_at
        from my_items
        group by name
        order by times desc, last_at desc
        limit 1
    )
    select jsonb_build_object(
        'orders', (select count(*) from my_orders),
        'drinks', (select count(*) from my_items),
        'spentCents', (select coalesce(sum(total_cents), 0) from my_orders),
        'firstOrderAt', (select min(created_at) from my_orders),
        'lastOrderAt', (select max(created_at) from my_orders),
        'pickupOrders', (select count(*) from my_orders where fulfillment_method = 'pickup'),
        'deliveryOrders', (select count(*) from my_orders where fulfillment_method = 'delivery'),
        'favorite', (select jsonb_build_object('name', name, 'classification', classification, 'times', times) from favorite),
        'publishedRecipes', (select count(*) from public.coffees where account_id = p_account_id and published_at is not null)
    );
$$;

-- An admin's own work, all time and since p_since. Closed and cash use the existing
-- approved_by / cash_collected_by columns, so they include orders from before order_events.
create or replace function public.staff_profile_stats(p_account_id uuid, p_since timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
    select jsonb_build_object(
        'closed', jsonb_build_object(
            'allTime', (select count(*) from public.orders
                where delivery_approved_by = p_account_id or pickup_approved_by = p_account_id),
            'recent', (select count(*) from public.orders
                where (delivery_approved_by = p_account_id and delivery_approved_at >= p_since)
                   or (pickup_approved_by = p_account_id and pickup_approved_at >= p_since))
        ),
        'cash', jsonb_build_object(
            'allTime', (select count(*) from public.orders where cash_collected_by = p_account_id),
            'allTimeCents', (select coalesce(sum((pricing ->> 'total_cents')::bigint), 0) from public.orders
                where cash_collected_by = p_account_id),
            'recent', (select count(*) from public.orders
                where cash_collected_by = p_account_id and cash_collected_at >= p_since),
            'recentCents', (select coalesce(sum((pricing ->> 'total_cents')::bigint), 0) from public.orders
                where cash_collected_by = p_account_id and cash_collected_at >= p_since)
        ),
        'accepted', jsonb_build_object(
            'allTime', (select count(*) from public.order_events where actor_id = p_account_id and action = 'accepted'),
            'recent', (select count(*) from public.order_events
                where actor_id = p_account_id and action = 'accepted' and created_at >= p_since)
        ),
        'cancelled', jsonb_build_object(
            'allTime', (select count(*) from public.order_events where actor_id = p_account_id and action = 'cancelled'),
            'recent', (select count(*) from public.order_events
                where actor_id = p_account_id and action = 'cancelled' and created_at >= p_since)
        ),
        'trackingSince', (select min(created_at) from public.order_events)
    );
$$;

revoke all on function public.customer_profile_stats(uuid) from public, anon, authenticated;
grant execute on function public.customer_profile_stats(uuid) to service_role;
revoke all on function public.staff_profile_stats(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.staff_profile_stats(uuid, timestamptz) to service_role;
