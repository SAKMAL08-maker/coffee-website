-- Superadmin: one owner account that signs in with a password plus three
-- security questions (no authenticator), can do everything an admin can, and
-- manages accounts (demote admins, delete accounts). Three wrong attempts lock it;
-- the owner unlocks it in Supabase → Table editor → superadmin_security → locked.
-- Additive: widens the role list and adds one table and two functions. Older app
-- code never creates or reads a superadmin, so it keeps working unchanged.

alter table public.coffee_users drop constraint if exists coffee_users_role_check;
alter table public.coffee_users
    add constraint coffee_users_role_check check (role in ('customer', 'staff', 'admin', 'superadmin'));

-- At most one superadmin.
create unique index if not exists coffee_users_single_superadmin_idx
    on public.coffee_users ((true)) where role = 'superadmin';

create table if not exists public.superadmin_security (
    account_id uuid primary key references public.coffee_users (id) on delete cascade,
    birthday_hash text not null,
    favorite_dog_hash text not null,
    favorite_color_hash text not null,
    failed_attempts integer not null default 0 check (failed_attempts >= 0),
    locked boolean not null default false,
    locked_at timestamptz,
    last_login_at timestamptz,
    updated_at timestamptz not null default now()
);

comment on table public.superadmin_security is
    'Superadmin security questions (scrypt hashes) and lockout. Set locked = false to unlock; that also resets failed_attempts.';
comment on column public.superadmin_security.locked is
    'true = superadmin sign-in is blocked (set automatically after 3 failed attempts). Edit to false to unlock, or true to lock by hand.';

alter table public.superadmin_security enable row level security;
revoke all on public.superadmin_security from anon, authenticated;
grant all on public.superadmin_security to service_role;

-- Unlocking by hand (locked -> false) clears the failure count; locking stamps the time.
create or replace function public.superadmin_security_lock_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.locked is distinct from old.locked then
        if new.locked then
            new.locked_at := now();
        else
            new.failed_attempts := 0;
            new.locked_at := null;
        end if;
    end if;
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists superadmin_security_lock_change on public.superadmin_security;
create trigger superadmin_security_lock_change
    before update on public.superadmin_security
    for each row execute function public.superadmin_security_lock_change();

-- Records one failed attempt atomically; the third locks the account.
create or replace function public.superadmin_record_failure(p_account_id uuid)
returns table (failed_attempts integer, locked boolean)
language sql
security invoker
set search_path = ''
as $$
    update public.superadmin_security as security
    set failed_attempts = security.failed_attempts + 1,
        locked = security.locked or security.failed_attempts + 1 >= 3
    where security.account_id = p_account_id
    returning security.failed_attempts, security.locked;
$$;

-- A successful sign-in resets the count (only while unlocked).
create or replace function public.superadmin_record_success(p_account_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
    update public.superadmin_security
    set failed_attempts = 0, last_login_at = now()
    where account_id = p_account_id and not locked;
$$;

revoke all on function public.superadmin_record_failure(uuid) from public, anon, authenticated;
revoke all on function public.superadmin_record_success(uuid) from public, anon, authenticated;
grant execute on function public.superadmin_record_failure(uuid) to service_role;
grant execute on function public.superadmin_record_success(uuid) to service_role;
