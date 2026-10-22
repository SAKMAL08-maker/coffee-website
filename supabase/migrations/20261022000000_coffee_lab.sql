create extension if not exists pgcrypto;

create table if not exists public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    name text not null check (char_length(name) between 1 and 80),
    role text not null default 'customer' check (role in ('customer', 'staff')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create or replace function public.create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (id, name)
    values (
        new.id,
        left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), 'Coffee customer'), 80)
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

revoke all on function public.create_profile_for_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_coffee_profile on auth.users;
create trigger on_auth_user_created_coffee_profile
    after insert on auth.users
    for each row execute procedure public.create_profile_for_auth_user();

create table if not exists public.coffees (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    name text not null check (char_length(name) between 1 and 48),
    configuration jsonb not null,
    classification text not null check (char_length(classification) <= 40),
    nutrition jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists coffees_user_created_idx
    on public.coffees (user_id, created_at desc);

create table if not exists public.orders (
    id uuid primary key default gen_random_uuid(),
    tracking_code text not null unique,
    user_id uuid references auth.users (id) on delete set null,
    customer jsonb not null,
    fulfillment_method text not null check (fulfillment_method in ('delivery', 'pickup')),
    delivery_address text,
    delivery_coordinates jsonb,
    notes text,
    pricing jsonb not null,
    status text not null default 'Received'
        check (status in ('Received', 'Crafting', 'Out for Delivery', 'Arrived')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint delivery_requires_address
        check (fulfillment_method <> 'delivery' or nullif(trim(delivery_address), '') is not null)
);

create index if not exists orders_user_created_idx
    on public.orders (user_id, created_at desc);

create table if not exists public.order_items (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.orders (id) on delete cascade,
    name text not null check (char_length(name) between 1 and 80),
    configuration jsonb not null,
    classification text not null check (char_length(classification) <= 40),
    nutrition jsonb not null,
    price_cents integer not null check (price_cents >= 0),
    created_at timestamptz not null default now()
);

create index if not exists order_items_order_idx
    on public.order_items (order_id);

alter table public.profiles enable row level security;
alter table public.coffees enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Database writes go through the server, which validates Supabase Auth tokens,
-- calculates checkout totals, and uses the service role key only on the server.
revoke all on public.profiles, public.coffees, public.orders, public.order_items
    from anon, authenticated;
grant all on public.profiles, public.coffees, public.orders, public.order_items
    to service_role;
grant usage on schema public to service_role;

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
begin
    insert into public.orders (
        tracking_code, user_id, customer, fulfillment_method,
        delivery_address, delivery_coordinates, notes, pricing
    )
    values (
        order_data ->> 'tracking_code',
        nullif(order_data ->> 'user_id', '')::uuid,
        order_data -> 'customer',
        order_data ->> 'fulfillment_method',
        order_data ->> 'delivery_address',
        order_data -> 'delivery_coordinates',
        order_data ->> 'notes',
        order_data -> 'pricing'
    )
    returning * into saved_order;

    insert into public.order_items (
        order_id, name, configuration, classification, nutrition, price_cents
    )
    select
        saved_order.id,
        item ->> 'name',
        item -> 'configuration',
        item ->> 'classification',
        item -> 'nutrition',
        (item ->> 'price_cents')::integer
    from jsonb_array_elements(item_data) as item;

    return saved_order.id;
end;
$$;

revoke all on function public.create_coffee_order(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_coffee_order(jsonb, jsonb) to service_role;
