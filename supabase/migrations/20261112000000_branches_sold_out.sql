-- Branches and sold-out switches.
--
-- 1. branches: each Coffee Lab location. One branch, "Coffee Lab Main", is created, and every
--    existing order is assigned to it, so history stays complete when a second branch opens.
-- 2. orders.branch_id: the branch that makes the order. Nullable so a server still running the
--    previous code can keep taking orders while this deploys; the new code always sets it.
-- 3. menu_sold_out: one row per (branch, option) that is sold out right now, e.g. ("main", "milk:oat").
--    No row = available. Admins switch options on and off; checkout refuses sold-out drinks.
-- 4. create_coffee_order saves branch_id (otherwise identical to 20261111000000_loyalty_rewards.sql).
-- Additive apart from the one-time backfill of orders.branch_id.

create table if not exists public.branches (
    id uuid primary key default gen_random_uuid(),
    slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 40),
    name text not null check (char_length(name) between 2 and 80),
    address text check (address is null or char_length(address) <= 200),
    phone text check (phone is null or char_length(phone) <= 32),
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

insert into public.branches (slug, name)
values ('main', 'Coffee Lab Main')
on conflict (slug) do nothing;

alter table public.orders
    add column if not exists branch_id uuid references public.branches (id) on delete restrict;

update public.orders
set branch_id = (select id from public.branches where slug = 'main')
where branch_id is null;

create index if not exists orders_branch_created_idx on public.orders (branch_id, created_at desc);

create table if not exists public.menu_sold_out (
    branch_id uuid not null references public.branches (id) on delete cascade,
    option_key text not null check (option_key ~ '^[a-z]+:[A-Za-z]+$' and char_length(option_key) <= 40),
    marked_by uuid references public.coffee_users (id) on delete set null,
    marked_at timestamptz not null default now(),
    primary key (branch_id, option_key)
);

create index if not exists menu_sold_out_marked_by_idx on public.menu_sold_out (marked_by);

alter table public.branches enable row level security;
alter table public.menu_sold_out enable row level security;

create or replace function public.create_coffee_order(
    order_data jsonb,
    item_data jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
    saved_order public.orders;
    account uuid := nullif(order_data ->> 'account_id', '')::uuid;
    spending bigint;
    balance record;
begin
    select coalesce(sum((item ->> 'redeemed_points')::integer), 0)
    into spending
    from jsonb_array_elements(item_data) as item;

    if spending > 0 then
        if account is null then
            raise exception 'loyalty:insufficient_points (sign in to use points)';
        end if;
        perform pg_advisory_xact_lock(hashtextextended('loyalty:' || account::text, 0));
        select * into balance from public.loyalty_balance(account);
        if balance.earned_points - balance.redeemed_points < spending then
            raise exception 'loyalty:insufficient_points (has %, needs %)',
                balance.earned_points - balance.redeemed_points, spending;
        end if;
    end if;

    insert into public.orders (
        tracking_code, user_id, account_id, customer, fulfillment_method,
        delivery_address, delivery_coordinates, notes, pricing, branch_id
    )
    values (
        order_data ->> 'tracking_code',
        nullif(order_data ->> 'user_id', '')::uuid,
        account,
        order_data -> 'customer',
        order_data ->> 'fulfillment_method',
        order_data ->> 'delivery_address',
        order_data -> 'delivery_coordinates',
        order_data ->> 'notes',
        order_data -> 'pricing',
        nullif(order_data ->> 'branch_id', '')::uuid
    )
    returning * into saved_order;

    insert into public.order_items (
        order_id, name, configuration, classification, nutrition, price_cents,
        source_coffee_id, royalty_account_id, royalty_points, purchase_points, redeemed_points
    )
    select
        saved_order.id,
        item ->> 'name',
        item -> 'configuration',
        item ->> 'classification',
        item -> 'nutrition',
        (item ->> 'price_cents')::integer,
        nullif(item ->> 'source_coffee_id', '')::uuid,
        nullif(item ->> 'royalty_account_id', '')::uuid,
        coalesce((item ->> 'royalty_points')::integer, 0),
        coalesce((item ->> 'purchase_points')::integer, 0),
        coalesce((item ->> 'redeemed_points')::integer, 0)
    from jsonb_array_elements(item_data) as item;

    return saved_order.id;
end;
$$;

revoke all on function public.create_coffee_order(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_coffee_order(jsonb, jsonb) to service_role;
