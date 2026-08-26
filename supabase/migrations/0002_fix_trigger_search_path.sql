-- Fix: handle_new_user() fires as supabase_auth_admin during signup, whose
-- search_path doesn't include public, so unqualified "profiles" failed to
-- resolve and signup errored with "Database error saving new user".

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $$;

grant usage on schema public to supabase_auth_admin;
grant insert on public.profiles to supabase_auth_admin;
