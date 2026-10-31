-- Lets a verified admin approve another admin's authenticator setup from the
-- admin page, so the new admin scans a QR code without typing a setup key.
-- Additive: older app code ignores this column, and it only matters while a
-- setup authorization (hash + expiry) is active, so no new constraint is needed.
alter table public.coffee_users
    add column if not exists admin_mfa_setup_preapproved boolean not null default false;

comment on column public.coffee_users.admin_mfa_setup_preapproved is
    'True when an owner approved authenticator setup in the app; the setup then needs no typed key until admin_mfa_setup_token_expires_at.';
