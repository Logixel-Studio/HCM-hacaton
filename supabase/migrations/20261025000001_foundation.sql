-- ═══════════════════════════════════════════════════════════════════════════
-- HCM Master Suite · 0001 · Platform foundation (brief §2, §3 M0.1)
-- ───────────────────────────────────────────────────────────────────────────
-- Multi-tenancy, the 14 system roles, memberships, invites, custom roles,
-- notifications and an immutable audit log. Every business table in later
-- migrations carries tenant_id and is protected by row-level security that
-- uses the helper functions defined here.
-- ═══════════════════════════════════════════════════════════════════════════

-- No extensions needed: gen_random_uuid() and sha256() are built into Postgres 13+.

-- ── Preflight: stop early if an older, different app's tables are in the way ──
-- (A Supabase starter "profiles" table is fine: it is upgraded below.)
do $$
declare clash text;
begin
  if to_regclass('public.tenants') is null then
    select string_agg(table_name, ', ' order by table_name) into clash
    from information_schema.tables
    where table_schema = 'public' and table_name = any (array['ai_logs', 'announcement_acks', 'announcements', 'assets', 'attendance_records', 'audit_log', 'branches', 'candidates', 'certifications', 'checklist_tasks', 'cost_centers', 'course_enrollments', 'courses', 'custom_roles', 'departments', 'employee_compensation', 'employee_documents', 'employee_job_history', 'employee_private', 'employees', 'expense_claims', 'expense_policies', 'feedback', 'final_settlements', 'goals', 'grades', 'holidays', 'hr_tickets', 'interviews', 'issued_letters', 'job_requisitions', 'kb_articles', 'kudos', 'leave_allocations', 'leave_requests', 'leave_types', 'legal_entities', 'letter_templates', 'lifecycle_checklists', 'loan_recoveries', 'loans', 'memberships', 'notifications', 'overtime_requests', 'payroll_adjustments', 'payroll_runs', 'payroll_settings', 'payslips', 'performance_reviews', 'regularization_requests', 'review_cycles', 'roster_entries', 'separations', 'shifts', 'survey_responses', 'surveys', 'tax_slabs', 'ticket_comments', 'travel_requests', 'user_invites']);
    if clash is not null then
      raise exception 'Old tables from another schema already exist in public: %. Run supabase/00_reset_public_schema.sql first (fresh projects only), then run this file again.', clash;
    end if;
  end if;
end $$;


-- ── Roles (brief §2: 14 system roles) ──────────────────────────────────────
do $$ begin
  create type public.app_role as enum (
    'platform_super_admin', 'company_owner', 'company_admin', 'hr_director', 'hr_manager',
    'hr_executive', 'payroll_officer', 'finance_controller', 'recruiter', 'hiring_manager',
    'line_manager', 'employee', 'candidate', 'auditor'
  );
exception when duplicate_object then null; end $$;

-- ── Tenants ────────────────────────────────────────────────────────────────
create table if not exists public.tenants (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) > 1),
  slug          text unique,
  plan          text not null default 'starter' check (plan in ('starter', 'growth', 'enterprise')),
  status        text not null default 'trial' check (status in ('trial', 'active', 'suspended', 'cancelled')),
  country       text not null default 'PK',
  currency      text not null default 'PKR',
  timezone      text not null default 'Asia/Karachi',
  week_start    smallint not null default 1,
  logo_url      text,
  brand_color   text default '#0284c7',
  seat_limit    integer not null default 50,
  trial_ends_at timestamptz default (now() + interval '14 days'),
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── Profiles (one per auth user) ───────────────────────────────────────────
create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  email             text not null,
  full_name         text,
  avatar_url        text,
  phone             text,
  active_tenant_id  uuid references public.tenants(id) on delete set null,
  is_platform_admin boolean not null default false,
  theme             text not null default 'system' check (theme in ('light', 'dark', 'system')),
  locale            text not null default 'en',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
-- If a profiles table already existed (for example Supabase's starter template),
-- add any missing columns instead of failing.
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists active_tenant_id uuid references public.tenants(id) on delete set null;
alter table public.profiles add column if not exists is_platform_admin boolean not null default false;
alter table public.profiles add column if not exists theme text not null default 'system';
alter table public.profiles add column if not exists locale text not null default 'en';
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
update public.profiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;
delete from public.profiles where email is null;            -- orphan rows with no auth user
alter table public.profiles alter column email set not null;
-- Starter-template columns we do not use must not block inserts
do $$
declare c record;
begin
  for c in select column_name from information_schema.columns
           where table_schema = 'public' and table_name = 'profiles' and is_nullable = 'NO' and column_default is null
             and column_name not in ('id', 'email')
  loop
    execute format('alter table public.profiles alter column %I drop not null', c.column_name);
  end loop;
end $$;
-- Deleting a user in Supabase Auth must also delete the profile
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.profiles'::regclass and contype = 'f'
             and confrelid = 'auth.users'::regclass loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
  alter table public.profiles add constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade;
end $$;
create index if not exists profiles_email_idx on public.profiles (lower(email));

-- ── Custom roles (brief §2: unlimited custom roles) ────────────────────────
-- A custom role inherits a system role's data access and narrows the modules
-- and actions visible in the app: {"payroll": ["view","approve"], ...}
create table if not exists public.custom_roles (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  description text,
  base_role   public.app_role not null,
  permissions jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, name)
);

-- ── Memberships: user ↔ tenant ↔ role (+ ABAC scope) ───────────────────────
-- employee_id is linked after the employees table exists (0002).
create table if not exists public.memberships (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  role           public.app_role not null default 'employee',
  custom_role_id uuid references public.custom_roles(id) on delete set null,
  employee_id    uuid,
  -- Attribute scope, e.g. {"branch_ids": [...], "department_ids": [...]}; empty = whole tenant
  scope          jsonb not null default '{}'::jsonb,
  status         text not null default 'active' check (status in ('active', 'suspended')),
  access_expires_at timestamptz,            -- time-boxed access (auditors, support)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index if not exists memberships_user_idx on public.memberships (user_id);

-- ── Invites: admin invites an email; the user joins on sign-up ─────────────
create table if not exists public.user_invites (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  email       text not null,
  role        public.app_role not null default 'employee',
  employee_id uuid,
  invited_by  uuid references auth.users(id) on delete set null,
  status      text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  created_at  timestamptz not null default now(),
  accepted_at timestamptz
);
create unique index if not exists user_invites_pending_uq on public.user_invites (tenant_id, lower(email)) where status = 'pending';

-- ── Notifications ──────────────────────────────────────────────────────────
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, read_at, created_at desc);

-- ── Immutable audit log (brief M15) ────────────────────────────────────────
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  tenant_id   uuid references public.tenants(id) on delete cascade,
  actor_id    uuid,
  actor_email text,
  action      text not null,          -- insert | update | delete | approve | login | export | ai
  entity      text not null,          -- table or domain object
  entity_id   text,
  before_data jsonb,
  after_data  jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_log_tenant_idx on public.audit_log (tenant_id, created_at desc);

create or replace function public.audit_log_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;
drop trigger if exists audit_log_no_update on public.audit_log;
create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();

-- ═══════════════════════════════════════════════════════════════════════════
-- Access helpers. SECURITY DEFINER so RLS policies can call them without
-- recursion; each one only ever looks at the signed-in user's own rows.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.current_tenant_id() returns uuid
language sql stable security definer set search_path = public as $$
  select m.tenant_id
  from profiles p
  join memberships m on m.tenant_id = p.active_tenant_id and m.user_id = p.id
  where p.id = auth.uid()
    and m.status = 'active'
    and (m.access_expires_at is null or m.access_expires_at > now())
  limit 1
$$;

create or replace function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select m.role from memberships m
  where m.user_id = auth.uid() and m.tenant_id = public.current_tenant_id()
  limit 1
$$;

create or replace function public.current_employee_id() returns uuid
language sql stable security definer set search_path = public as $$
  select m.employee_id from memberships m
  where m.user_id = auth.uid() and m.tenant_id = public.current_tenant_id()
  limit 1
$$;

create or replace function public.has_role(roles public.app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() = any (roles), false)
$$;

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_platform_admin from profiles where id = auth.uid()), false)
$$;

-- Role groups used across policies (brief §21 "Feature access by role")
create or replace function public.is_tenant_admin() returns boolean
language sql stable as $$ select public.has_role(array['company_owner','company_admin']::public.app_role[]) $$;

create or replace function public.is_hr_lead() returns boolean
language sql stable as $$ select public.has_role(array['company_owner','company_admin','hr_director','hr_manager']::public.app_role[]) $$;

create or replace function public.is_hr_staff() returns boolean
language sql stable as $$ select public.has_role(array['company_owner','company_admin','hr_director','hr_manager','hr_executive']::public.app_role[]) $$;

create or replace function public.can_view_pay() returns boolean
language sql stable as $$ select public.has_role(array['company_owner','company_admin','hr_director','hr_manager','payroll_officer','finance_controller','auditor']::public.app_role[]) $$;

create or replace function public.can_run_payroll() returns boolean
language sql stable as $$ select public.has_role(array['company_owner','company_admin','hr_director','payroll_officer']::public.app_role[]) $$;

create or replace function public.is_finance() returns boolean
language sql stable as $$ select public.has_role(array['company_owner','company_admin','finance_controller']::public.app_role[]) $$;

create or replace function public.is_recruiting() returns boolean
language sql stable as $$ select public.has_role(array['company_owner','company_admin','hr_director','hr_manager','recruiter']::public.app_role[]) $$;

create or replace function public.is_auditor() returns boolean
language sql stable as $$ select public.has_role(array['auditor']::public.app_role[]) $$;

-- ── Shared triggers ────────────────────────────────────────────────────────
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Fills tenant_id from the session so the client never chooses the tenant.
create or replace function public.set_tenant_id() returns trigger
language plpgsql as $$
begin
  if new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;
  if new.tenant_id is null then
    raise exception 'No active company for this user';
  end if;
  return new;
end $$;

-- Writes every change to audit_log with before/after values.
create or replace function public.write_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_id text;
begin
  v_tenant := coalesce((case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end), public.current_tenant_id());
  v_id := (case when tg_op = 'DELETE' then to_jsonb(old)->>'id' else to_jsonb(new)->>'id' end);
  insert into audit_log (tenant_id, actor_id, actor_email, action, entity, entity_id, before_data, after_data)
  values (
    v_tenant, auth.uid(), (select email from profiles where id = auth.uid()),
    lower(tg_op), tg_table_name, v_id,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

-- Attaches the standard triggers to a tenant table.
create or replace function public.hcm_attach_triggers(p_table regclass, p_audit boolean default true) returns void
language plpgsql as $$
declare t text := p_table::text;
begin
  execute format('drop trigger if exists set_tenant on %s', t);
  execute format('create trigger set_tenant before insert on %s for each row execute function public.set_tenant_id()', t);
  execute format('drop trigger if exists touch_updated on %s', t);
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = replace(t, 'public.', '') and column_name = 'updated_at') then
    execute format('create trigger touch_updated before update on %s for each row execute function public.touch_updated_at()', t);
  end if;
  execute format('drop trigger if exists audit on %s', t);
  if p_audit then
    execute format('create trigger audit after insert or update or delete on %s for each row execute function public.write_audit()', t);
  end if;
end $$;

select public.hcm_attach_triggers('public.custom_roles');
select public.hcm_attach_triggers('public.memberships');
select public.hcm_attach_triggers('public.user_invites');
select public.hcm_attach_triggers('public.notifications', false);

drop trigger if exists touch_updated on public.tenants;
create trigger touch_updated before update on public.tenants for each row execute function public.touch_updated_at();
drop trigger if exists touch_updated on public.profiles;
create trigger touch_updated before update on public.profiles for each row execute function public.touch_updated_at();

-- Internal helper: notify a user (used by workflow functions).
create or replace function public.notify_user(p_user uuid, p_title text, p_body text, p_link text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return; end if;
  insert into notifications (tenant_id, user_id, title, body, link)
  values (public.current_tenant_id(), p_user, p_title, p_body, p_link);
end $$;
