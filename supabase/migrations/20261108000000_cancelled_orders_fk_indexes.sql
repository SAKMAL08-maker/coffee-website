-- Cancelled orders and missing foreign-key indexes.
--
-- 1. Orders can be cancelled instead of deleted. A cancelled order keeps its record (for the
--    customer, the receipt and the audit trail) but no longer counts as a sale on the dashboard.
--    Permanent delete is now superadmin-only in the app.
-- 2. Indexes for the four foreign keys Supabase's advisor flags (lint 0001). Without them,
--    deleting a user or coffee makes Postgres scan the whole orders / order_items table.
-- Additive and safe to apply before the app code: the constraint only gains a value, and the
-- metrics function only skips a status no order has yet.

alter table public.orders
    drop constraint if exists orders_status_check;

alter table public.orders
    add constraint orders_status_check
    check (status in ('Received', 'Crafting', 'Out for Delivery', 'Arrived', 'Delivered', 'Ready for Pickup', 'Cancelled'));

create index if not exists orders_delivery_approved_by_idx on public.orders (delivery_approved_by);
create index if not exists orders_pickup_approved_by_idx on public.orders (pickup_approved_by);
create index if not exists orders_cash_collected_by_idx on public.orders (cash_collected_by);
create index if not exists order_items_source_coffee_id_idx on public.order_items (source_coffee_id);

-- Same function as 20261105000000_admin_order_metrics.sql, except cancelled orders are excluded.
create or replace function public.admin_order_metrics(
    p_since timestamptz,
    p_time_zone text default 'Asia/Manila'
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
    with ranged_orders as (
        select
            id,
            status,
            fulfillment_method,
            to_char(created_at at time zone p_time_zone, 'YYYY-MM-DD') as shop_day,
            coalesce((pricing ->> 'total_cents')::bigint, 0) as total_cents
        from public.orders
        where created_at >= p_since
            and status <> 'Cancelled'
    ),
    ranged_items as (
        select item.classification, item.configuration
        from public.order_items as item
        join ranged_orders on ranged_orders.id = item.order_id
    ),
    -- Every add-on in one list: syrups with pumps, toppings that are on, sweeteners.
    add_ons as (
        select syrup.key as add_on
        from ranged_items, jsonb_each(coalesce(ranged_items.configuration -> 'syrups', '{}'::jsonb)) as syrup
        where jsonb_typeof(syrup.value) = 'number' and (syrup.value)::numeric > 0
        union all
        select topping.key
        from ranged_items, jsonb_each(coalesce(ranged_items.configuration -> 'toppings', '{}'::jsonb)) as topping
        where topping.value = 'true'::jsonb
        union all
        select sweetener
        from ranged_items,
            jsonb_array_elements_text(
                case when jsonb_typeof(ranged_items.configuration -> 'sweeteners') = 'array'
                    then ranged_items.configuration -> 'sweeteners' else '[]'::jsonb end
            ) as sweetener
    )
    select jsonb_build_object(
        'orders', (select count(*) from ranged_orders),
        'drinks', (select count(*) from ranged_items),
        'revenueCents', (select coalesce(sum(total_cents), 0) from ranged_orders),
        'ordersByDay', (select coalesce(jsonb_object_agg(shop_day, n), '{}'::jsonb)
            from (select shop_day, count(*) as n from ranged_orders group by shop_day) as counts),
        'revenueByDay', (select coalesce(jsonb_object_agg(shop_day, n), '{}'::jsonb)
            from (select shop_day, sum(total_cents) as n from ranged_orders group by shop_day) as counts),
        'fulfillment', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
            from (select fulfillment_method as k, count(*) as n from ranged_orders group by 1) as counts where k is not null),
        'status', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
            from (select status as k, count(*) as n from ranged_orders group by 1) as counts where k is not null),
        'drinkType', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
            from (select coalesce(classification, 'Unclassified') as k, count(*) as n from ranged_items group by 1) as counts),
        'base', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
            from (select configuration ->> 'base' as k, count(*) as n from ranged_items group by 1) as counts where k is not null),
        'milk', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
            from (select configuration ->> 'milk' as k, count(*) as n from ranged_items group by 1) as counts where k is not null),
        'temperature', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
            from (select configuration ->> 'temperature' as k, count(*) as n from ranged_items group by 1) as counts where k is not null),
        'caffeineMode', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
            from (select configuration ->> 'caffeineMode' as k, count(*) as n from ranged_items group by 1) as counts where k is not null),
        'addOns', (select coalesce(jsonb_object_agg(add_on, n), '{}'::jsonb)
            from (select add_on, count(*) as n from add_ons group by add_on) as counts)
    );
$$;

revoke all on function public.admin_order_metrics(timestamptz, text) from public, anon, authenticated;
grant execute on function public.admin_order_metrics(timestamptz, text) to service_role;
