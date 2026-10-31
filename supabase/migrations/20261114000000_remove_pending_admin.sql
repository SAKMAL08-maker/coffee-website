-- Admin accounts are no longer requested from the sign-up form: sign-up creates customers
-- only, and the superadmin makes a customer an admin from the Accounts list. This removes
-- the 'pending_admin' role that 20261113000000_admin_signup_requests.sql allowed.
-- Safe only when no account has that role (checked before applying: none).

alter table public.coffee_users drop constraint if exists coffee_users_role_check;
alter table public.coffee_users
    add constraint coffee_users_role_check check (role in ('customer', 'staff', 'admin', 'superadmin'));
