alter table public.coffee_users
    add column if not exists caffeine_cutoff_time time;
