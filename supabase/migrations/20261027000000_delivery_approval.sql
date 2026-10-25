alter table public.orders
    add column if not exists delivery_reported_at timestamptz,
    add column if not exists delivery_approved_at timestamptz,
    add column if not exists delivery_approved_by uuid references public.coffee_users (id);

alter table public.orders
    drop constraint if exists orders_status_check;

alter table public.orders
    add constraint orders_status_check
    check (status in ('Received', 'Crafting', 'Out for Delivery', 'Arrived', 'Delivered'));

alter table public.orders
    drop constraint if exists orders_delivery_approval_check;

alter table public.orders
    add constraint orders_delivery_approval_check
    check (
        (delivery_approved_at is null and delivery_approved_by is null and status <> 'Delivered')
        or (delivery_approved_at is not null and delivery_approved_by is not null and status = 'Delivered')
    );

create index if not exists orders_delivery_reported_idx
    on public.orders (delivery_reported_at desc)
    where delivery_reported_at is not null;

create index if not exists orders_created_at_idx
    on public.orders (created_at desc);
