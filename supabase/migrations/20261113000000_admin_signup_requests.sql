-- Admin sign-up requests: anyone can ask for an admin account from the sign-up
-- form, and the account waits as 'pending_admin' until the superadmin approves it
-- (it becomes 'admin') or declines it (it is deleted). A pending account can't
-- sign in: the app refuses it, and its Supabase Auth email stays unconfirmed.
-- Additive: widens the role list only. Older app code never creates this role.

alter table public.coffee_users drop constraint if exists coffee_users_role_check;
alter table public.coffee_users
    add constraint coffee_users_role_check
    check (role in ('customer', 'staff', 'admin', 'superadmin', 'pending_admin'));
