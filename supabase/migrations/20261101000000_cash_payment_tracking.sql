-- Phase 4: record how an order is paid and when cash was collected.
--
-- Additive and backward compatible:
--   * payment_method has a default, so existing rows and the existing
--     create_coffee_order function (which doesn't mention it) get 'cash'.
--   * cash_collected_at / cash_collected_by are nullable; old code never reads them.
--   * Safe to run twice (if not exists / drop constraint if exists).

alter table public.orders
    add column if not exists payment_method text not null default 'cash',
    add column if not exists cash_collected_at timestamptz,
    add column if not exists cash_collected_by uuid references public.coffee_users (id);

-- Only cash exists today. Adding e.g. 'gcash' later means widening this list in a new migration.
alter table public.orders
    drop constraint if exists orders_payment_method_check;

alter table public.orders
    add constraint orders_payment_method_check
    check (payment_method in ('cash'));

-- "Collected" is all-or-nothing (who AND when), and only cash orders can be collected.
alter table public.orders
    drop constraint if exists orders_cash_collection_check;

alter table public.orders
    add constraint orders_cash_collection_check
    check (
        (cash_collected_at is null and cash_collected_by is null)
        or (
            cash_collected_at is not null
            and cash_collected_by is not null
            and payment_method = 'cash'
        )
    );

-- Admins will look for "cash still to collect"; a partial index keeps that lookup small.
create index if not exists orders_cash_uncollected_idx
    on public.orders (created_at desc)
    where payment_method = 'cash' and cash_collected_at is null;
