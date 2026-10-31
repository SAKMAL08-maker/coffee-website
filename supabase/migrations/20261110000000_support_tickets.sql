-- Support tickets: a customer opens a ticket (optionally about one of their orders) and chats
-- with the shop; any admin or the superadmin can answer from the admin page's Support tab.
-- Messages are plain text, written and read only through the server (row-level security on,
-- no policies, like the other tables). Message ids are increasing, so the chat polls for
-- "messages after id N" cheaply.
-- Additive: two new tables, and staff_profile_stats gains a supportReplies count.

create table if not exists public.support_tickets (
    id uuid primary key default gen_random_uuid(),
    customer_id uuid not null references public.coffee_users (id) on delete cascade,
    order_id uuid references public.orders (id) on delete set null,
    subject text not null check (char_length(subject) between 3 and 120),
    status text not null default 'open' check (status in ('open', 'closed')),
    assigned_to uuid references public.coffee_users (id) on delete set null,
    last_message_at timestamptz not null default now(),
    last_message_by_staff boolean not null default false,
    customer_read_at timestamptz,
    staff_read_at timestamptz,
    created_at timestamptz not null default now(),
    closed_at timestamptz
);

create table if not exists public.support_messages (
    id bigint generated always as identity primary key,
    ticket_id uuid not null references public.support_tickets (id) on delete cascade,
    author_id uuid references public.coffee_users (id) on delete set null,
    from_staff boolean not null,
    body text not null check (char_length(body) between 1 and 2000),
    created_at timestamptz not null default now()
);

create index if not exists support_tickets_customer_idx on public.support_tickets (customer_id, last_message_at desc);
create index if not exists support_tickets_status_idx on public.support_tickets (status, last_message_at desc);
create index if not exists support_tickets_assigned_to_idx on public.support_tickets (assigned_to);
create index if not exists support_tickets_order_idx on public.support_tickets (order_id);
create index if not exists support_messages_ticket_idx on public.support_messages (ticket_id, id);
create index if not exists support_messages_author_idx on public.support_messages (author_id, created_at desc);

alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;

-- Same as 20261109000000_profiles_order_events.sql, plus supportReplies.
create or replace function public.staff_profile_stats(p_account_id uuid, p_since timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
    select jsonb_build_object(
        'closed', jsonb_build_object(
            'allTime', (select count(*) from public.orders
                where delivery_approved_by = p_account_id or pickup_approved_by = p_account_id),
            'recent', (select count(*) from public.orders
                where (delivery_approved_by = p_account_id and delivery_approved_at >= p_since)
                   or (pickup_approved_by = p_account_id and pickup_approved_at >= p_since))
        ),
        'cash', jsonb_build_object(
            'allTime', (select count(*) from public.orders where cash_collected_by = p_account_id),
            'allTimeCents', (select coalesce(sum((pricing ->> 'total_cents')::bigint), 0) from public.orders
                where cash_collected_by = p_account_id),
            'recent', (select count(*) from public.orders
                where cash_collected_by = p_account_id and cash_collected_at >= p_since),
            'recentCents', (select coalesce(sum((pricing ->> 'total_cents')::bigint), 0) from public.orders
                where cash_collected_by = p_account_id and cash_collected_at >= p_since)
        ),
        'accepted', jsonb_build_object(
            'allTime', (select count(*) from public.order_events where actor_id = p_account_id and action = 'accepted'),
            'recent', (select count(*) from public.order_events
                where actor_id = p_account_id and action = 'accepted' and created_at >= p_since)
        ),
        'cancelled', jsonb_build_object(
            'allTime', (select count(*) from public.order_events where actor_id = p_account_id and action = 'cancelled'),
            'recent', (select count(*) from public.order_events
                where actor_id = p_account_id and action = 'cancelled' and created_at >= p_since)
        ),
        'supportReplies', jsonb_build_object(
            'allTime', (select count(*) from public.support_messages where author_id = p_account_id and from_staff),
            'recent', (select count(*) from public.support_messages
                where author_id = p_account_id and from_staff and created_at >= p_since)
        ),
        'trackingSince', (select min(created_at) from public.order_events)
    );
$$;

revoke all on function public.staff_profile_stats(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.staff_profile_stats(uuid, timestamptz) to service_role;
