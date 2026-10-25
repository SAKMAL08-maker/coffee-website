create table if not exists public.coffee_users (
    id uuid primary key default gen_random_uuid(),
    username text not null check (char_length(username) between 3 and 24),
    username_key text not null unique check (username_key ~ '^[a-z0-9_]{3,24}$'),
    password_hash text not null,
    role text not null default 'customer' check (role in ('customer', 'staff', 'admin')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.coffee_sessions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.coffee_users (id) on delete cascade,
    token_hash char(64) not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
);

create index if not exists coffee_sessions_user_idx
    on public.coffee_sessions (user_id);
create index if not exists coffee_sessions_expiry_idx
    on public.coffee_sessions (expires_at);

create table if not exists public.coffee_recovery_codes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.coffee_users (id) on delete cascade,
    code_hash char(64) not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
    used_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists coffee_recovery_user_idx
    on public.coffee_recovery_codes (user_id);

alter table public.coffees
    alter column user_id drop not null;
alter table public.coffees
    add column if not exists account_id uuid references public.coffee_users (id) on delete cascade;
create index if not exists coffees_account_created_idx
    on public.coffees (account_id, created_at desc);

alter table public.orders
    add column if not exists account_id uuid references public.coffee_users (id) on delete set null;
create index if not exists orders_account_created_idx
    on public.orders (account_id, created_at desc);

alter table public.coffee_users enable row level security;
alter table public.coffee_sessions enable row level security;
alter table public.coffee_recovery_codes enable row level security;

revoke all on public.coffee_users, public.coffee_sessions, public.coffee_recovery_codes
    from anon, authenticated;
grant all on public.coffee_users, public.coffee_sessions, public.coffee_recovery_codes
    to service_role;

create or replace function public.create_coffee_account(
    p_username text,
    p_password_hash text,
    p_recovery_code_hashes text[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
    created_user_id uuid;
    recovery_hash text;
begin
    if p_username !~ '^[a-z0-9_]{3,24}$'
        or p_password_hash !~ '^scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$'
        or coalesce(array_length(p_recovery_code_hashes, 1), 0) <> 10 then
        raise exception 'Account data is invalid.';
    end if;

    insert into public.coffee_users (username, username_key, password_hash)
    values (p_username, lower(p_username), p_password_hash)
    returning id into created_user_id;

    foreach recovery_hash in array p_recovery_code_hashes loop
        if recovery_hash !~ '^[a-f0-9]{64}$' then
            raise exception 'Recovery code data is invalid.';
        end if;
        insert into public.coffee_recovery_codes (user_id, code_hash)
        values (created_user_id, recovery_hash);
    end loop;

    return created_user_id;
end;
$$;

create or replace function public.reset_coffee_account_password(
    p_username_key text,
    p_recovery_code_hash text,
    p_password_hash text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
    recovery_user_id uuid;
begin
    if p_username_key !~ '^[a-z0-9_]{3,24}$'
        or p_recovery_code_hash !~ '^[a-f0-9]{64}$'
        or p_password_hash !~ '^scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$' then
        return false;
    end if;

    select user_id into recovery_user_id
    from public.coffee_recovery_codes
    where code_hash = p_recovery_code_hash and used_at is null
    for update;
    if not found then
        return false;
    end if;

    update public.coffee_users
    set password_hash = p_password_hash, updated_at = now()
    where id = recovery_user_id and username_key = p_username_key;
    if not found then
        return false;
    end if;

    update public.coffee_recovery_codes
    set used_at = now()
    where code_hash = p_recovery_code_hash and used_at is null;

    delete from public.coffee_sessions where user_id = recovery_user_id;
    return true;
end;
$$;

revoke all on function public.create_coffee_account(text, text, text[]) from public, anon, authenticated;
revoke all on function public.reset_coffee_account_password(text, text, text) from public, anon, authenticated;
grant execute on function public.create_coffee_account(text, text, text[]) to service_role;
grant execute on function public.reset_coffee_account_password(text, text, text) to service_role;

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
        tracking_code, user_id, account_id, customer, fulfillment_method,
        delivery_address, delivery_coordinates, notes, pricing
    )
    values (
        order_data ->> 'tracking_code',
        nullif(order_data ->> 'user_id', '')::uuid,
        nullif(order_data ->> 'account_id', '')::uuid,
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
