alter table public.coffee_users
    add column if not exists supabase_auth_user_id uuid unique
        references auth.users (id) on delete set null;

create index if not exists coffee_users_supabase_auth_user_idx
    on public.coffee_users (supabase_auth_user_id)
    where supabase_auth_user_id is not null;
