alter table public.orders
    add column if not exists payment_method text not null default 'cash',
    add column if not exists cash_collected_at timestamptz,
    add column if not exists cash_collected_by uuid references public.coffee_users (id);

alter table public.orders
    drop constraint if exists orders_payment_method_check;

alter table public.orders
    add constraint orders_payment_method_check
    check (payment_method = 'cash');

alter table public.orders
    drop constraint if exists orders_cash_collection_state_check;

alter table public.orders
    add constraint orders_cash_collection_state_check
    check (
        (cash_collected_at is null and cash_collected_by is null)
        or (cash_collected_at is not null and cash_collected_by is not null)
    );
