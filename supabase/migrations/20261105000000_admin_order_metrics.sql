-- Scalability option A: the admin dashboard counts inside Postgres and returns
-- only the totals (a few hundred bytes), instead of the API downloading every
-- order and drink in the range and counting in Node.
-- Additive: a new read-only function. The app falls back to counting in Node
-- when this function doesn't exist, so apply order doesn't matter.
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
