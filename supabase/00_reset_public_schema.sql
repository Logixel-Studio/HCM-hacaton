-- ═══════════════════════════════════════════════════════════════════════════
-- HCM Master Suite · OPTIONAL reset for a project that has old tables
-- ───────────────────────────────────────────────────────────────────────────
-- WARNING: deletes EVERY table, view and function in the public schema
-- (all app data). Auth users and Storage files are kept.
-- Use it only on a new / test project, then run hcm_full_schema.sql.
-- ═══════════════════════════════════════════════════════════════════════════
drop trigger if exists on_auth_user_created on auth.users;

drop schema if exists public cascade;
create schema public;

grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, service_role;
alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;

-- Old storage policies that pointed at dropped functions
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;
