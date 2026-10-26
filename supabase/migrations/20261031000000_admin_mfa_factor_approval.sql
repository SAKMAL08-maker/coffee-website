alter table public.coffee_users
    add column if not exists admin_mfa_factor_id uuid,
    add column if not exists admin_mfa_pending_factor_id uuid,
    add column if not exists admin_mfa_setup_token_hash text,
    add column if not exists admin_mfa_setup_token_expires_at timestamptz;

alter table public.coffee_users
    drop constraint if exists coffee_users_admin_mfa_setup_state_check;

alter table public.coffee_users
    add constraint coffee_users_admin_mfa_setup_state_check
    check (
        (admin_mfa_setup_token_hash is null) = (admin_mfa_setup_token_expires_at is null)
        and (admin_mfa_setup_token_hash is null or admin_mfa_setup_token_hash ~ '^[a-f0-9]{64}$')
        and (admin_mfa_pending_factor_id is null or (
            admin_mfa_factor_id is null
            and admin_mfa_setup_token_hash is not null
        ))
        and (admin_mfa_factor_id is null or admin_mfa_pending_factor_id is null)
    );
