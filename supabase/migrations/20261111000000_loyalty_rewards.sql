-- Loyalty rewards: customers earn points on their own paid drinks and spend 100 on a free drink.
--
-- 1. order_items.purchase_points: points the buyer earns for that drink (10 today; stored per drink so
--    changing the rate later never rewrites history). order_items.redeemed_points: points spent to
--    make that drink free (100), 0 otherwise.
-- 2. loyalty_balance(account): earned (paid orders), pending (not yet paid), redeemed, all excluding
--    cancelled orders, so cancelling an order returns its points and removes what it would have earned.
-- 3. create_coffee_order saves the two new columns and, when points are spent, checks the balance in
--    the same transaction, under a per-account lock, so two checkouts at once can't spend points twice.
-- 4. recipe_royalty_summary no longer counts cancelled orders as "pending".
-- Additive: two columns with defaults (existing rows get 0), one new function, two replaced functions.

alter table public.order_items
    add column if not exists purchase_points integer not null default 0,
    add column if not exists redeemed_points integer not null default 0;

alter table public.order_items drop constraint if exists order_items_purchase_points_check;
alter table public.order_items
    add constraint order_items_purchase_points_check check (purchase_points between 0 and 1000);
alter table public.order_items drop constraint if exists order_items_redeemed_points_check;
alter table public.order_items
    add constraint order_items_redeemed_points_check check (redeemed_points between 0 and 1000);

create or replace function public.loyalty_balance(p_account_id uuid)
returns table (earned_points bigint, pending_points bigint, redeemed_points bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    with earning as (
        -- Own purchases.
        select item.purchase_points as points, orders.cash_collected_at
        from public.order_items as item
        join public.orders as orders on orders.id = item.order_id
        where orders.account_id = p_account_id and orders.status <> 'Cancelled' and item.purchase_points > 0
        union all
        -- Royalties: other people ordering this customer's published recipes.
        select item.royalty_points, orders.cash_collected_at
        from public.order_items as item
        join public.orders as orders on orders.id = item.order_id
        where item.royalty_account_id = p_account_id and orders.status <> 'Cancelled' and item.royalty_points > 0
    )
    select
        coalesce((select sum(points) from earning where cash_collected_at is not null), 0)::bigint,
        coalesce((select sum(points) from earning where cash_collected_at is null), 0)::bigint,
        coalesce((
            select sum(item.redeemed_points)
            from public.order_items as item
            join public.orders as orders on orders.id = item.order_id
            where orders.account_id = p_account_id and orders.status <> 'Cancelled' and item.redeemed_points > 0
        ), 0)::bigint;
$$;

revoke all on function public.loyalty_balance(uuid) from public, anon, authenticated;
grant execute on function public.loyalty_balance(uuid) to service_role;

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
        -- One checkout per account at a time while points are being spent.
        perform pg_advisory_xact_lock(hashtextextended('loyalty:' || account::text, 0));
        select * into balance from public.loyalty_balance(account);
        if balance.earned_points - balance.redeemed_points < spending then
            raise exception 'loyalty:insufficient_points (has %, needs %)',
                balance.earned_points - balance.redeemed_points, spending;
        end if;
    end if;

    insert into public.orders (
        tracking_code, user_id, account_id, customer, fulfillment_method,
        delivery_address, delivery_coordinates, notes, pricing
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
        order_data -> 'pricing'
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

-- Same as 20261102000000_community_recipes.sql, but cancelled orders no longer count as pending.
create or replace function public.recipe_royalty_summary(p_account_id uuid)
returns table (earned_points bigint, pending_points bigint, earned_drinks bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    select
        coalesce(sum(item.royalty_points) filter (where orders.cash_collected_at is not null), 0),
        coalesce(sum(item.royalty_points) filter (where orders.cash_collected_at is null), 0),
        count(*) filter (where orders.cash_collected_at is not null)
    from public.order_items as item
    join public.orders as orders on orders.id = item.order_id
    where item.royalty_account_id = p_account_id
      and item.royalty_points > 0
      and orders.status <> 'Cancelled';
$$;

revoke all on function public.recipe_royalty_summary(uuid) from public, anon, authenticated;
grant execute on function public.recipe_royalty_summary(uuid) to service_role;
