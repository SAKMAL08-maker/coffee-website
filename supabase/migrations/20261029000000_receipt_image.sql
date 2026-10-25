alter table public.orders
    add column if not exists receipt_image_object_key text;
