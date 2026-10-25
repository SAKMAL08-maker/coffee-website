alter table public.orders
    add column if not exists pickup_approved_at timestamptz,
    add column if not exists pickup_approved_by uuid references public.coffee_users (id);

alter table public.orders
    drop constraint if exists orders_status_check;

alter table public.orders
    add constraint orders_status_check
    check (status in ('Received', 'Crafting', 'Out for Delivery', 'Arrived', 'Delivered', 'Ready for Pickup'));

alter table public.orders
    drop constraint if exists orders_pickup_approval_check;

alter table public.orders
    add constraint orders_pickup_approval_check
    check (
        (pickup_approved_at is null and pickup_approved_by is null and status <> 'Ready for Pickup')
        or (
            pickup_approved_at is not null
            and pickup_approved_by is not null
            and status = 'Ready for Pickup'
            and fulfillment_method = 'pickup'
        )
    );
