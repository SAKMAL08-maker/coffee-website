-- Phase 5: community recipes with royalties.
--
-- Requires 20261101000000_cash_payment_tracking.sql (royalties are "earned" once
-- an order's cash is collected).
--
-- Additive and backward compatible:
--   * New columns are nullable or have defaults; existing rows are untouched.
--   * create_coffee_order keeps its exact signature and grants. The new version
--     reads three optional item keys; callers that don't send them (the current
--     app) get null / 0, exactly as before.
--   * Safe to run twice.

-- 1. Publishing: a saved coffee becomes public when it has a slug.
alter table public.coffees
    add column if not exists public_slug text,
    add column if not exists published_at timestamptz;

alter table public.coffees
    drop constraint if exists coffees_public_slug_format_check;
alter table public.coffees
    add constraint coffees_public_slug_format_check
    check (public_slug is null or public_slug ~ '^[A-Za-z0-9]{10}$');

alter table public.coffees
    drop constraint if exists coffees_publication_check;
alter table public.coffees
    add constraint coffees_publication_check
    check ((public_slug is null) = (published_at is null));

-- Unique only among published recipes; doubles as the lookup index for /api/recipes/:slug.
create unique index if not exists coffees_public_slug_key
    on public.coffees (public_slug)
    where public_slug is not null;

-- 2. Attribution: each ordered drink remembers which recipe it came from and who
--    earns the royalty. Stored on the item (not looked up later) so deleting a
--    recipe or renaming an account never changes points already earned.
alter table public.order_items
    add column if not exists source_coffee_id uuid references public.coffees (id) on delete set null,
    add column if not exists royalty_account_id uuid references public.coffee_users (id) on delete set null,
    add column if not exists royalty_points integer not null default 0;

alter table public.order_items
    drop constraint if exists order_items_royalty_points_check;
alter table public.order_items
    add constraint order_items_royalty_points_check
    check (royalty_points >= 0);

create index if not exists order_items_royalty_account_idx
    on public.order_items (royalty_account_id)
    where royalty_account_id is not null;

-- 3. Order creation: same as 20261025000000_username_accounts.sql, plus the three
--    optional royalty columns. One transaction, so an order and its attribution
--    are saved together or not at all.
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
        order_id, name, configuration, classification, nutrition, price_cents,
        source_coffee_id, royalty_account_id, royalty_points
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
        coalesce((item ->> 'royalty_points')::integer, 0)
    from jsonb_array_elements(item_data) as item;

    return saved_order.id;
end;
$$;

revoke all on function public.create_coffee_order(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_coffee_order(jsonb, jsonb) to service_role;

-- 4. A creator's royalty totals, aggregated in the database (no rows shipped to Node).
--    "Earned" = the buyer's cash was collected; "pending" = ordered, not yet paid.
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
      and item.royalty_points > 0;
$$;

revoke all on function public.recipe_royalty_summary(uuid) from public, anon, authenticated;
grant execute on function public.recipe_royalty_summary(uuid) to service_role;
