alter table public.orders
    add column if not exists receipt_status text not null default 'pending'
        check (receipt_status in ('pending', 'available', 'failed', 'unavailable')),
    add column if not exists receipt_object_key text,
    add column if not exists receipt_generated_at timestamptz;

alter table public.orders
    add constraint orders_receipt_key_status_check
    check (
        (receipt_status = 'available' and receipt_object_key is not null and receipt_generated_at is not null)
        or (receipt_status <> 'available' and receipt_object_key is null and receipt_generated_at is null)
    );

create index if not exists orders_receipt_status_idx
    on public.orders (receipt_status)
    where receipt_status in ('pending', 'failed');
