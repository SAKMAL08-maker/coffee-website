update public.coffee_users
set role = 'admin',
    updated_at = now()
where username_key = lower('REPLACE_WITH_EXISTING_USERNAME')
  and role <> 'admin'
returning id, username, role;
