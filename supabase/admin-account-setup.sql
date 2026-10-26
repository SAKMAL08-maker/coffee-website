-- Apply the admin Supabase Auth migration first.
-- Create and confirm the administrator's email/password account in
-- Supabase Dashboard > Authentication > Users, then link it here by email.
-- Admins sign in with this Supabase Auth password and must enroll in TOTP.
-- Replace both placeholders; verify the returned row is the intended account.
-- After linking, run scripts/admin-mfa-bootstrap.js as the project owner
-- to remove old factors and issue the one-time setup authorization.
update public.coffee_users as coffee_user
set role = 'admin',
    supabase_auth_user_id = (
        select auth_user.id
        from auth.users as auth_user
        where lower(auth_user.email) = lower('REPLACE_WITH_ADMIN_EMAIL')
    ),
    updated_at = now()
where coffee_user.username_key = lower('REPLACE_WITH_EXISTING_USERNAME')
  and exists (
      select 1
      from auth.users as auth_user
      where lower(auth_user.email) = lower('REPLACE_WITH_ADMIN_EMAIL')
  )
returning coffee_user.id, coffee_user.username, coffee_user.role, coffee_user.supabase_auth_user_id;
