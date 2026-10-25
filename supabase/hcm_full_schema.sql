-- HCM Master Suite · full schema (all migrations in order). Run once in the Supabase SQL editor on a fresh project.

-- >>> 20261025000001_foundation.sql
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

-- >>> 20261025000002_organization_core_hr.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- HCM Master Suite · 0002 · Organization model and Core HR (brief M0.2, M1)
-- ───────────────────────────────────────────────────────────────────────────
-- Legal entities, branches (with geofence), departments, cost centres,
-- grades with salary bands, employees, sensitive personal data (separate
-- table = field-level security), effective-dated compensation and job
-- history, documents, assets and HR letters.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.legal_entities (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  ntn         text,                         -- national tax number
  registration_no text,
  address     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.branches (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  legal_entity_id    uuid references public.legal_entities(id) on delete set null,
  name               text not null,
  code               text,
  address            text,
  city               text,
  latitude           double precision,
  longitude          double precision,
  geofence_radius_m  integer not null default 150 check (geofence_radius_m between 20 and 5000),
  timezone           text not null default 'Asia/Karachi',
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, name)
);

create table if not exists public.cost_centers (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  code       text not null,
  name       text not null,
  monthly_budget numeric(14,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table if not exists public.departments (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  name            text not null,
  code            text,
  parent_id       uuid references public.departments(id) on delete set null,
  cost_center_id  uuid references public.cost_centers(id) on delete set null,
  head_employee_id uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, name)
);

create table if not exists public.grades (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  code       text not null,
  name       text not null,
  band_min   numeric(14,2) not null default 0,
  band_mid   numeric(14,2) not null default 0,
  band_max   numeric(14,2) not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code),
  check (band_min <= band_mid and band_mid <= band_max)
);

-- Shifts live here because employees reference a default shift.
create table if not exists public.shifts (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  name           text not null,
  start_time     time not null,
  end_time       time not null,
  grace_minutes  integer not null default 15,
  break_minutes  integer not null default 60,
  half_day_minutes integer not null default 240,  -- worked less than this = half day
  working_days   smallint[] not null default '{1,2,3,4,5,6}',  -- 0 = Sunday
  is_night       boolean not null default false,
  color          text default '#0ea5e9',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, name)
);

-- ── Employees: the system of record (directory-level fields only) ──────────
create table if not exists public.employees (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  employee_code      text not null,
  full_name          text not null,
  work_email         text,
  phone              text,
  photo_url          text,
  gender             text check (gender in ('female', 'male', 'other')),
  job_title          text,
  department_id      uuid references public.departments(id) on delete set null,
  branch_id          uuid references public.branches(id) on delete set null,
  legal_entity_id    uuid references public.legal_entities(id) on delete set null,
  grade_id           uuid references public.grades(id) on delete set null,
  cost_center_id     uuid references public.cost_centers(id) on delete set null,
  manager_id         uuid references public.employees(id) on delete set null,
  shift_id           uuid references public.shifts(id) on delete set null,
  employment_type    text not null default 'permanent'
                       check (employment_type in ('permanent', 'probation', 'contract', 'intern', 'consultant', 'daily_wager', 'part_time')),
  status             text not null default 'active'
                       check (status in ('active', 'probation', 'notice', 'suspended', 'exited')),
  joining_date       date not null default current_date,
  probation_end_date date,
  confirmation_date  date,
  exit_date          date,
  user_id            uuid references auth.users(id) on delete set null,
  skills             text[] not null default '{}',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, employee_code)
);
create index if not exists employees_tenant_idx on public.employees (tenant_id, status);
create index if not exists employees_manager_idx on public.employees (manager_id);
create unique index if not exists employees_email_uq on public.employees (tenant_id, lower(work_email)) where work_email is not null;

alter table public.departments drop constraint if exists departments_head_fk;
alter table public.departments add constraint departments_head_fk foreign key (head_employee_id) references public.employees(id) on delete set null;
alter table public.memberships drop constraint if exists memberships_employee_fk;
alter table public.memberships add constraint memberships_employee_fk foreign key (employee_id) references public.employees(id) on delete set null;
alter table public.user_invites drop constraint if exists user_invites_employee_fk;
alter table public.user_invites add constraint user_invites_employee_fk foreign key (employee_id) references public.employees(id) on delete cascade;

-- ── Sensitive personal data (field-level security by table) ────────────────
create table if not exists public.employee_private (
  employee_id     uuid primary key references public.employees(id) on delete cascade,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  cnic            text,
  cnic_expiry     date,
  date_of_birth   date,
  marital_status  text,
  personal_email  text,
  address         text,
  city            text,
  emergency_contact_name  text,
  emergency_contact_phone text,
  bank_name       text,
  bank_account_no text,               -- IBAN
  blood_group     text,
  updated_at      timestamptz not null default now()
);

-- ── Compensation: effective-dated, never overwritten ───────────────────────
create table if not exists public.employee_compensation (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  employee_id      uuid not null references public.employees(id) on delete cascade,
  effective_from   date not null,
  gross_salary     numeric(14,2) not null check (gross_salary >= 0),
  currency         text not null default 'PKR',
  eobi_applicable  boolean not null default true,
  pf_applicable    boolean not null default false,
  reason           text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  unique (employee_id, effective_from)
);

create or replace view public.current_compensation with (security_invoker = true) as
select distinct on (c.employee_id) c.*
from public.employee_compensation c
where c.effective_from <= current_date
order by c.employee_id, c.effective_from desc;

-- ── Job history: every lifecycle event, effective-dated ────────────────────
create table if not exists public.employee_job_history (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  employee_id    uuid not null references public.employees(id) on delete cascade,
  event_type     text not null check (event_type in ('hire', 'confirmation', 'probation_extension', 'promotion', 'transfer',
                   'manager_change', 'grade_change', 'salary_revision', 'status_change', 'suspension', 'resignation',
                   'termination', 'rehire')),
  effective_date date not null default current_date,
  details        jsonb not null default '{}'::jsonb,     -- {"field": {"from": .., "to": ..}}
  notes          text,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now()
);
create index if not exists job_history_employee_idx on public.employee_job_history (employee_id, effective_date desc);

-- Automatically records history when key job fields change.
create or replace function public.log_employee_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  d jsonb := '{}'::jsonb;
  ev text;
begin
  if tg_op = 'INSERT' then
    insert into employee_job_history (tenant_id, employee_id, event_type, effective_date, details)
    values (new.tenant_id, new.id, 'hire', new.joining_date,
            jsonb_build_object('job_title', jsonb_build_object('to', new.job_title)));
    return new;
  end if;
  if new.department_id is distinct from old.department_id then d := d || jsonb_build_object('department_id', jsonb_build_object('from', old.department_id, 'to', new.department_id)); end if;
  if new.branch_id     is distinct from old.branch_id     then d := d || jsonb_build_object('branch_id', jsonb_build_object('from', old.branch_id, 'to', new.branch_id)); end if;
  if new.grade_id      is distinct from old.grade_id      then d := d || jsonb_build_object('grade_id', jsonb_build_object('from', old.grade_id, 'to', new.grade_id)); end if;
  if new.manager_id    is distinct from old.manager_id    then d := d || jsonb_build_object('manager_id', jsonb_build_object('from', old.manager_id, 'to', new.manager_id)); end if;
  if new.job_title     is distinct from old.job_title     then d := d || jsonb_build_object('job_title', jsonb_build_object('from', old.job_title, 'to', new.job_title)); end if;
  if new.status        is distinct from old.status        then d := d || jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)); end if;
  if d = '{}'::jsonb then return new; end if;
  ev := case
    when d ? 'status' and new.status = 'exited' then 'termination'
    when d ? 'status' and new.status = 'suspended' then 'suspension'
    when d ? 'status' and old.status = 'probation' and new.status = 'active' then 'confirmation'
    when d ? 'grade_id' then 'grade_change'
    when d ? 'job_title' then 'promotion'
    when d ? 'department_id' or d ? 'branch_id' then 'transfer'
    when d ? 'manager_id' then 'manager_change'
    else 'status_change' end;
  insert into employee_job_history (tenant_id, employee_id, event_type, details)
  values (new.tenant_id, new.id, ev, d);
  return new;
end $$;
drop trigger if exists employee_history on public.employees;
create trigger employee_history after insert or update on public.employees
  for each row execute function public.log_employee_changes();

create or replace function public.log_compensation_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare prev numeric;
begin
  select gross_salary into prev from employee_compensation
  where employee_id = new.employee_id and effective_from < new.effective_from
  order by effective_from desc limit 1;
  if prev is not null then
    insert into employee_job_history (tenant_id, employee_id, event_type, effective_date, details, notes)
    values (new.tenant_id, new.employee_id, 'salary_revision', new.effective_from,
            jsonb_build_object('gross_salary', jsonb_build_object('from', prev, 'to', new.gross_salary)), new.reason);
  end if;
  return new;
end $$;
drop trigger if exists compensation_history on public.employee_compensation;
create trigger compensation_history after insert on public.employee_compensation
  for each row execute function public.log_compensation_change();

-- Next employee code per tenant: EMP-0001, EMP-0002 …
create or replace function public.next_employee_code() returns text
language sql stable security definer set search_path = public as $$
  select 'EMP-' || lpad((coalesce(max(nullif(regexp_replace(employee_code, '\D', '', 'g'), '')::int), 0) + 1)::text, 4, '0')
  from employees where tenant_id = public.current_tenant_id()
$$;

-- Line-manager scope: is this employee one of my direct or indirect reports?
create or replace function public.is_my_report(p_employee uuid) returns boolean
language sql stable security definer set search_path = public as $$
  with recursive chain as (
    select id, manager_id, 1 as depth from employees where id = p_employee
    union all
    select e.id, e.manager_id, c.depth + 1 from employees e join chain c on e.id = c.manager_id where c.depth < 10
  )
  select public.current_employee_id() is not null
     and exists (select 1 from chain where manager_id = public.current_employee_id())
$$;

create or replace function public.is_self(p_employee uuid) returns boolean
language sql stable as $$ select p_employee is not null and p_employee = public.current_employee_id() $$;

-- ABAC: HR managers may be scoped to branches or departments.
create or replace function public.in_my_scope(p_employee uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when m.scope is null or m.scope = '{}'::jsonb then true
    else exists (
      select 1 from employees e where e.id = p_employee and (
        (m.scope ? 'branch_ids' and e.branch_id::text in (select jsonb_array_elements_text(m.scope->'branch_ids'))) or
        (m.scope ? 'department_ids' and e.department_id::text in (select jsonb_array_elements_text(m.scope->'department_ids')))
      ))
  end
  from memberships m where m.user_id = auth.uid() and m.tenant_id = public.current_tenant_id()
$$;

-- ── Documents vault (files live in storage bucket "hr-documents") ──────────
create table if not exists public.employee_documents (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  doc_type    text not null check (doc_type in ('cnic', 'passport', 'contract', 'offer_letter', 'degree', 'experience_letter',
                'medical', 'certificate', 'policy_ack', 'payslip', 'other')),
  title       text not null,
  file_path   text not null,
  expires_on  date,
  is_verified boolean not null default false,
  uploaded_by uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists employee_documents_expiry_idx on public.employee_documents (tenant_id, expires_on);

-- ── Assets ─────────────────────────────────────────────────────────────────
create table if not exists public.assets (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  asset_tag      text not null,
  name           text not null,
  category       text not null default 'laptop' check (category in ('laptop', 'phone', 'sim', 'vehicle', 'id_card', 'tool', 'uniform', 'other')),
  serial_no      text,
  purchase_date  date,
  purchase_cost  numeric(14,2),
  warranty_until date,
  status         text not null default 'available' check (status in ('available', 'assigned', 'repair', 'lost', 'retired')),
  assigned_to    uuid references public.employees(id) on delete set null,
  assigned_at    timestamptz,
  condition_notes text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, asset_tag)
);

-- ── HR letters (templates with {{merge_fields}}) ───────────────────────────
create table if not exists public.letter_templates (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null,
  kind       text not null check (kind in ('offer', 'appointment', 'confirmation', 'increment', 'experience', 'salary_certificate',
               'noc', 'warning', 'termination', 'relieving', 'other')),
  body       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.issued_letters (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  employee_id       uuid not null references public.employees(id) on delete cascade,
  template_id       uuid references public.letter_templates(id) on delete set null,
  kind              text not null,
  body              text not null,
  verification_code text not null default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  issued_by         uuid default auth.uid(),
  issued_at         timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['legal_entities','branches','cost_centers','departments','grades','shifts','employees',
    'employee_private','employee_compensation','employee_job_history','employee_documents','assets','letter_templates','issued_letters']
  loop
    perform public.hcm_attach_triggers(('public.' || t)::regclass, t not in ('employee_job_history'));
  end loop;
end $$;

-- >>> 20261025000003_time_attendance.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- HCM Master Suite · 0003 · Time, attendance, shifts and rosters (brief M4)
-- ───────────────────────────────────────────────────────────────────────────
-- One attendance record per employee per day. Punches are server-stamped by
-- clock_in()/clock_out() (see 0008), which check the branch geofence and the
-- shift. Only approved overtime reaches payroll.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.holidays (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  name         text not null,
  holiday_date date not null,
  branch_id    uuid references public.branches(id) on delete cascade,   -- null = all branches
  is_tentative boolean not null default false,                         -- moon-sighting holidays
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists holidays_date_idx on public.holidays (tenant_id, holiday_date);

create table if not exists public.roster_entries (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date   date not null,
  shift_id    uuid references public.shifts(id) on delete cascade,      -- null = day off
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (employee_id, work_date)
);

create table if not exists public.attendance_records (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  employee_id      uuid not null references public.employees(id) on delete cascade,
  work_date        date not null,
  shift_id         uuid references public.shifts(id) on delete set null,
  clock_in_at      timestamptz,
  clock_out_at     timestamptz,
  clock_in_lat     double precision,
  clock_in_lng     double precision,
  clock_in_accuracy_m double precision,
  clock_in_distance_m integer,
  clock_out_lat    double precision,
  clock_out_lng    double precision,
  source           text not null default 'web' check (source in ('web', 'mobile', 'kiosk', 'biometric', 'qr', 'whatsapp', 'manual')),
  status           text not null default 'present'
                     check (status in ('present', 'late', 'half_day', 'absent', 'on_leave', 'holiday', 'weekly_off', 'missing_punch')),
  late_minutes     integer not null default 0,
  early_leave_minutes integer not null default 0,
  worked_minutes   integer not null default 0,
  overtime_minutes integer not null default 0,          -- detected; payroll uses approved overtime_requests
  flags            text[] not null default '{}',        -- outside_geofence, low_accuracy, corrected …
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (employee_id, work_date)
);
create index if not exists attendance_tenant_date_idx on public.attendance_records (tenant_id, work_date);

create table if not exists public.regularization_requests (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  employee_id   uuid not null references public.employees(id) on delete cascade,
  work_date     date not null,
  clock_in_time  time,
  clock_out_time time,
  reason        text not null,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by    uuid,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.overtime_requests (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  employee_id   uuid not null references public.employees(id) on delete cascade,
  work_date     date not null,
  minutes       integer not null check (minutes > 0 and minutes <= 960),
  reason        text,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by    uuid,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Distance between two points in metres (haversine).
create or replace function public.distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

do $$
declare t text;
begin
  foreach t in array array['holidays','roster_entries','attendance_records','regularization_requests','overtime_requests']
  loop
    perform public.hcm_attach_triggers(('public.' || t)::regclass, t <> 'attendance_records');
  end loop;
end $$;

-- >>> 20261025000004_leave.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- HCM Master Suite · 0004 · Leave and absence (brief M5)
-- ───────────────────────────────────────────────────────────────────────────
-- Leave types are policy-as-data. Balances are never stored: leave_balances()
-- computes entitlement (annual or monthly accrual, prorated for joiners)
-- plus allocations, minus approved and pending leave.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.leave_types (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  code                 text not null,
  name                 text not null,
  days_per_year        numeric(6,2) not null default 0,
  accrual              text not null default 'annual' check (accrual in ('annual', 'monthly')),
  carry_forward_max    numeric(6,2) not null default 0,
  is_paid              boolean not null default true,
  requires_document_after_days integer,
  max_consecutive_days integer,
  min_service_days     integer not null default 0,
  allow_half_day       boolean not null default true,
  encashable           boolean not null default false,
  gender_restriction   text check (gender_restriction in ('female', 'male')),
  count_weekly_offs    boolean not null default false,   -- sandwich rule
  color                text not null default '#0ea5e9',
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, code)
);

create table if not exists public.leave_allocations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  employee_id   uuid not null references public.employees(id) on delete cascade,
  leave_type_id uuid not null references public.leave_types(id) on delete cascade,
  year          integer not null,
  days          numeric(6,2) not null,                 -- positive grant or negative correction
  reason        text not null,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);
create index if not exists leave_allocations_idx on public.leave_allocations (employee_id, year);

create table if not exists public.leave_requests (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  employee_id    uuid not null references public.employees(id) on delete cascade,
  leave_type_id  uuid not null references public.leave_types(id) on delete restrict,
  start_date     date not null,
  end_date       date not null,
  is_half_day    boolean not null default false,
  days           numeric(6,2) not null check (days > 0),
  reason         text,
  document_path  text,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  current_step   text not null default 'manager' check (current_step in ('manager', 'hr', 'done')),
  decided_by     uuid,
  decided_at     timestamptz,
  decision_note  text,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists leave_requests_emp_idx on public.leave_requests (employee_id, start_date);
create index if not exists leave_requests_tenant_idx on public.leave_requests (tenant_id, status);

-- Working days between two dates for an employee (excludes weekly offs and holidays
-- unless the leave type counts them).
create or replace function public.leave_working_days(p_employee uuid, p_from date, p_to date, p_count_offs boolean default false)
returns numeric language sql stable security definer set search_path = public as $$
  with e as (select e.tenant_id, e.branch_id, coalesce(s.working_days, '{1,2,3,4,5,6}') as wd
             from employees e left join shifts s on s.id = e.shift_id where e.id = p_employee)
  select count(*)::numeric
  from generate_series(p_from, p_to, interval '1 day') g(d), e
  where p_count_offs or (
    extract(dow from g.d)::smallint = any (e.wd)
    and not exists (select 1 from holidays h where h.tenant_id = e.tenant_id and h.holiday_date = g.d::date
                    and (h.branch_id is null or h.branch_id = e.branch_id))
  )
$$;

-- Live balances for one employee and year.
create or replace function public.leave_balances(p_employee uuid, p_year integer default extract(year from current_date)::int)
returns table (leave_type_id uuid, code text, name text, color text, is_paid boolean,
               entitled numeric, used numeric, pending numeric, available numeric)
language sql stable security definer set search_path = public as $$
  with emp as (select * from employees where id = p_employee),
  months as (
    select t.id as type_id,
      case
        when t.accrual = 'monthly' then
          greatest(0, least(12, case when p_year < extract(year from current_date) then 12
                                     when p_year > extract(year from current_date) then 0
                                     else extract(month from current_date)::int end)
                      - case when extract(year from emp.joining_date) = p_year then extract(month from emp.joining_date)::int - 1 else 0 end)
        else case when extract(year from emp.joining_date) = p_year then 13 - extract(month from emp.joining_date)::int
                  when extract(year from emp.joining_date) > p_year then 0 else 12 end
      end as m
    from leave_types t, emp where t.tenant_id = emp.tenant_id
  )
  select t.id, t.code, t.name, t.color, t.is_paid,
    round(((t.days_per_year * mo.m / 12.0) * 2)::numeric) / 2
      + coalesce((select sum(a.days) from leave_allocations a where a.employee_id = p_employee and a.leave_type_id = t.id and a.year = p_year), 0) as entitled,
    coalesce((select sum(r.days) from leave_requests r where r.employee_id = p_employee and r.leave_type_id = t.id
              and r.status = 'approved' and extract(year from r.start_date) = p_year), 0) as used,
    coalesce((select sum(r.days) from leave_requests r where r.employee_id = p_employee and r.leave_type_id = t.id
              and r.status = 'pending' and extract(year from r.start_date) = p_year), 0) as pending,
    0::numeric as available
  from leave_types t
  join months mo on mo.type_id = t.id
  cross join emp
  where t.is_active
    and (t.gender_restriction is null or emp.gender is null or t.gender_restriction = emp.gender)
$$;

-- Wrapper that fills in "available" (kept separate so the CTE above stays readable).
create or replace function public.my_leave_balances(p_employee uuid default null, p_year integer default extract(year from current_date)::int)
returns table (leave_type_id uuid, code text, name text, color text, is_paid boolean,
               entitled numeric, used numeric, pending numeric, available numeric)
language sql stable security definer set search_path = public as $$
  select b.leave_type_id, b.code, b.name, b.color, b.is_paid, b.entitled, b.used, b.pending, b.entitled - b.used - b.pending
  from public.leave_balances(coalesce(p_employee, public.current_employee_id()), p_year) b
  where coalesce(p_employee, public.current_employee_id()) is not null
    and (p_employee is null or public.is_self(p_employee) or public.is_hr_staff() or public.is_my_report(p_employee))
    and (select tenant_id from employees where id = coalesce(p_employee, public.current_employee_id())) = public.current_tenant_id()
$$;

do $$
declare t text;
begin
  foreach t in array array['leave_types','leave_allocations','leave_requests']
  loop
    perform public.hcm_attach_triggers(('public.' || t)::regclass);
  end loop;
end $$;

-- >>> 20261025000005_payroll_money.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- HCM Master Suite · 0005 · Payroll, compliance, expenses, loans, travel
-- (brief M6, M7)
-- ───────────────────────────────────────────────────────────────────────────
-- Payroll is a rule-based calculation run on the server (see 0008):
-- calculate → review exceptions → HR approval → finance approval (a different
-- person: maker-checker) → finalize. Finalized payslips are locked; fixes go
-- into the next run as adjustments.
-- ═══════════════════════════════════════════════════════════════════════════

-- Pay structure and statutory settings (one row per tenant)
create table if not exists public.payroll_settings (
  tenant_id              uuid primary key references public.tenants(id) on delete cascade,
  fiscal_year            text not null default '2025-26',
  basic_pct_of_gross     numeric(6,4) not null default 0.60,
  hra_pct_of_basic       numeric(6,4) not null default 0.45,
  medical_pct_of_basic   numeric(6,4) not null default 0.10,   -- tax-exempt up to 10% of basic
  eobi_employee_amount   numeric(10,2) not null default 370,
  eobi_employer_amount   numeric(10,2) not null default 1850,
  pf_rate                numeric(6,4) not null default 0.0833,
  overtime_multiplier    numeric(5,2) not null default 2.0,
  working_days_per_month integer not null default 26,
  hours_per_day          numeric(4,1) not null default 8,
  lates_per_half_day     integer not null default 3,
  deduct_absent_days     boolean not null default true,
  enforce_maker_checker  boolean not null default true,
  pay_day                integer not null default 1 check (pay_day between 1 and 31),
  updated_at             timestamptz not null default now()
);

-- Income tax slabs per fiscal year: data, never code (they change every budget)
create table if not exists public.tax_slabs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  fiscal_year text not null,
  income_from numeric(16,2) not null,
  income_to   numeric(16,2),                 -- null = no upper limit
  fixed_tax   numeric(16,2) not null default 0,
  rate        numeric(6,4) not null default 0, -- 0.11 = 11% of income above income_from
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, fiscal_year, income_from)
);

-- Variable pay for a period (bonus, commission, one-off deductions)
create table if not exists public.payroll_adjustments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  period      text not null check (period ~ '^\d{4}-\d{2}$'),
  kind        text not null check (kind in ('bonus', 'commission', 'allowance', 'arrears', 'deduction')),
  amount      numeric(14,2) not null check (amount > 0),
  taxable     boolean not null default true,
  note        text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists payroll_adjustments_idx on public.payroll_adjustments (tenant_id, period);

create table if not exists public.payroll_runs (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  period              text not null check (period ~ '^\d{4}-\d{2}$'),
  run_type            text not null default 'regular' check (run_type in ('regular', 'off_cycle')),
  pay_date            date,
  status              text not null default 'draft'
                        check (status in ('draft', 'calculated', 'hr_approved', 'finance_approved', 'finalized', 'cancelled')),
  employee_count      integer not null default 0,
  total_gross         numeric(16,2) not null default 0,
  total_deductions    numeric(16,2) not null default 0,
  total_tax           numeric(16,2) not null default 0,
  total_net           numeric(16,2) not null default 0,
  total_employer_cost numeric(16,2) not null default 0,
  exceptions          jsonb not null default '[]'::jsonb,
  prepared_by         uuid, prepared_at timestamptz,
  hr_approved_by      uuid, hr_approved_at timestamptz,
  finance_approved_by uuid, finance_approved_at timestamptz,
  finalized_by        uuid, finalized_at timestamptz,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, period, run_type)
);

create table if not exists public.payslips (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  run_id             uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id        uuid not null references public.employees(id) on delete cascade,
  period             text not null,
  gross_salary       numeric(14,2) not null default 0,
  basic              numeric(14,2) not null default 0,
  house_rent         numeric(14,2) not null default 0,
  medical            numeric(14,2) not null default 0,
  utilities          numeric(14,2) not null default 0,
  overtime_hours     numeric(8,2)  not null default 0,
  overtime_pay       numeric(14,2) not null default 0,
  variable_pay       numeric(14,2) not null default 0,
  reimbursements     numeric(14,2) not null default 0,
  income_tax         numeric(14,2) not null default 0,
  eobi               numeric(14,2) not null default 0,
  provident_fund     numeric(14,2) not null default 0,
  loan_deduction     numeric(14,2) not null default 0,
  unpaid_deduction   numeric(14,2) not null default 0,
  late_deduction     numeric(14,2) not null default 0,
  other_deductions   numeric(14,2) not null default 0,
  total_earnings     numeric(14,2) not null default 0,
  total_deductions   numeric(14,2) not null default 0,
  net_pay            numeric(14,2) not null default 0,
  employer_eobi      numeric(14,2) not null default 0,
  employer_pf        numeric(14,2) not null default 0,
  annual_taxable     numeric(16,2) not null default 0,
  working_days       integer not null default 0,
  absent_days        numeric(6,2) not null default 0,
  unpaid_leave_days  numeric(6,2) not null default 0,
  late_days          integer not null default 0,
  bank_name          text,
  bank_account_no    text,
  lines              jsonb not null default '[]'::jsonb,   -- [{key,label,type,amount,formula}]
  is_published       boolean not null default false,
  created_at         timestamptz not null default now(),
  unique (run_id, employee_id)
);
create index if not exists payslips_employee_idx on public.payslips (employee_id, period);

-- ── Expense claims and travel (M7) ─────────────────────────────────────────
create table if not exists public.expense_policies (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  category     text not null,
  label        text not null,
  limit_amount numeric(14,2),             -- per claim; null = no limit
  requires_receipt boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, category)
);

create table if not exists public.expense_claims (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  employee_id    uuid not null references public.employees(id) on delete cascade,
  category       text not null,
  claim_date     date not null,
  amount         numeric(14,2) not null check (amount > 0),
  vendor         text,
  description    text,
  receipt_path   text,
  status         text not null default 'pending'
                   check (status in ('pending', 'manager_approved', 'approved', 'rejected', 'reimbursed', 'cancelled')),
  over_policy    boolean not null default false,
  decided_by     uuid,
  decided_at     timestamptz,
  decision_note  text,
  reimbursed_run_id uuid references public.payroll_runs(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.travel_requests (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  employee_id     uuid not null references public.employees(id) on delete cascade,
  destination     text not null,
  purpose         text not null,
  start_date      date not null,
  end_date        date not null,
  estimated_cost  numeric(14,2) not null default 0,
  advance_amount  numeric(14,2) not null default 0,
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'completed', 'cancelled')),
  decided_by      uuid,
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (end_date >= start_date)
);

-- ── Loans and advances ─────────────────────────────────────────────────────
create table if not exists public.loans (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  employee_id        uuid not null references public.employees(id) on delete cascade,
  loan_type          text not null default 'salary_advance'
                       check (loan_type in ('salary_advance', 'personal', 'vehicle', 'house', 'emergency')),
  principal          numeric(14,2) not null check (principal > 0),
  installments       integer not null check (installments between 1 and 120),
  installment_amount numeric(14,2) not null check (installment_amount > 0),
  start_period       text not null check (start_period ~ '^\d{4}-\d{2}$'),
  recovered_amount   numeric(14,2) not null default 0,
  status             text not null default 'pending' check (status in ('pending', 'active', 'closed', 'rejected', 'cancelled')),
  reason             text,
  decided_by         uuid,
  decided_at         timestamptz,
  decision_note      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.loan_recoveries (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  loan_id    uuid not null references public.loans(id) on delete cascade,
  run_id     uuid references public.payroll_runs(id) on delete set null,
  period     text not null,
  amount     numeric(14,2) not null,
  created_at timestamptz not null default now(),
  unique (loan_id, period)
);

-- Annual income tax for a tenant's fiscal year.
create or replace function public.annual_income_tax(p_tenant uuid, p_fiscal_year text, p_taxable numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((
    select s.fixed_tax + greatest(0, p_taxable - s.income_from) * s.rate
    from tax_slabs s
    where s.tenant_id = p_tenant and s.fiscal_year = p_fiscal_year
      and p_taxable > s.income_from and (s.income_to is null or p_taxable <= s.income_to)
    order by s.income_from desc limit 1
  ), 0)
$$;

do $$
declare t text;
begin
  foreach t in array array['tax_slabs','payroll_adjustments','payroll_runs','payslips','expense_policies','expense_claims',
    'travel_requests','loans','loan_recoveries']
  loop
    perform public.hcm_attach_triggers(('public.' || t)::regclass, t not in ('payslips', 'loan_recoveries'));
  end loop;
end $$;
drop trigger if exists touch_updated on public.payroll_settings;
create trigger touch_updated before update on public.payroll_settings for each row execute function public.touch_updated_at();
drop trigger if exists set_tenant on public.payroll_settings;
create trigger set_tenant before insert on public.payroll_settings for each row execute function public.set_tenant_id();
drop trigger if exists audit on public.payroll_settings;
create trigger audit after insert or update or delete on public.payroll_settings for each row execute function public.write_audit();

-- >>> 20261025000006_talent_lifecycle.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- HCM Master Suite · 0006 · Talent and lifecycle
-- Recruitment/ATS (M2), onboarding & offboarding (M3), performance (M8),
-- learning & skills (M9)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Recruitment ────────────────────────────────────────────────────────────
create table if not exists public.job_requisitions (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  title             text not null,
  department_id     uuid references public.departments(id) on delete set null,
  branch_id         uuid references public.branches(id) on delete set null,
  grade_id          uuid references public.grades(id) on delete set null,
  positions         integer not null default 1 check (positions > 0),
  employment_type   text not null default 'permanent',
  hiring_manager_id uuid references public.employees(id) on delete set null,
  budget_monthly    numeric(14,2),
  description       text,
  requirements      text,                 -- comma separated, used for match scoring
  status            text not null default 'pending_approval'
                      check (status in ('draft', 'pending_approval', 'open', 'on_hold', 'filled', 'closed', 'rejected')),
  approved_by       uuid,
  approved_at       timestamptz,
  is_public         boolean not null default true,   -- listed on the careers page
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.candidates (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  requisition_id   uuid not null references public.job_requisitions(id) on delete cascade,
  full_name        text not null,
  email            text,
  phone            text,
  current_company  text,
  experience_years numeric(4,1),
  expected_salary  numeric(14,2),
  source           text not null default 'careers_site'
                     check (source in ('careers_site', 'linkedin', 'job_board', 'referral', 'agency', 'walk_in', 'campus', 'other')),
  referred_by      uuid references public.employees(id) on delete set null,
  cv_path          text,
  summary          text,
  stage            text not null default 'applied'
                     check (stage in ('applied', 'screening', 'assessment', 'interview', 'offer', 'hired', 'rejected', 'withdrawn')),
  match_score      integer check (match_score between 0 and 100),
  match_reasons    text,
  offer_amount     numeric(14,2),
  offer_status     text not null default 'none' check (offer_status in ('none', 'pending_approval', 'approved', 'sent', 'accepted', 'declined')),
  rejection_reason text,
  user_id          uuid references auth.users(id) on delete set null,   -- candidate portal login
  hired_employee_id uuid references public.employees(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists candidates_req_idx on public.candidates (requisition_id, stage);

create table if not exists public.interviews (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  candidate_id    uuid not null references public.candidates(id) on delete cascade,
  interviewer_id  uuid not null references public.employees(id) on delete cascade,
  round           text not null default 'Interview',
  scheduled_at    timestamptz not null,
  mode            text not null default 'onsite' check (mode in ('onsite', 'video', 'phone')),
  location_or_link text,
  status          text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled', 'no_show')),
  rating          integer check (rating between 1 and 5),
  recommendation  text check (recommendation in ('strong_hire', 'hire', 'no_hire', 'strong_no_hire')),
  scorecard       jsonb not null default '{}'::jsonb,       -- {"Communication": 4, ...}
  feedback        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── Onboarding and offboarding checklists (owner per task) ─────────────────
create table if not exists public.lifecycle_checklists (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  kind        text not null check (kind in ('onboarding', 'offboarding')),
  target_date date,
  status      text not null default 'in_progress' check (status in ('in_progress', 'completed', 'cancelled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.checklist_tasks (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  checklist_id uuid not null references public.lifecycle_checklists(id) on delete cascade,
  owner_group  text not null check (owner_group in ('HR', 'IT', 'Admin', 'Manager', 'Finance', 'Employee', 'Buddy')),
  title        text not null,
  sort_order   integer not null default 0,
  is_done      boolean not null default false,
  done_by      uuid,
  done_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.separations (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  employee_id      uuid not null references public.employees(id) on delete cascade,
  separation_type  text not null check (separation_type in ('resignation', 'termination', 'retirement', 'contract_end')),
  notice_date      date not null default current_date,
  last_working_day date not null,
  reason           text,
  exit_interview   jsonb not null default '{}'::jsonb,   -- {"reason":"growth","rating":3,"comments":"..."}
  rehire_eligible  boolean,
  status           text not null default 'submitted' check (status in ('submitted', 'accepted', 'completed', 'withdrawn')),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.final_settlements (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  employee_id      uuid not null references public.employees(id) on delete cascade,
  separation_id    uuid references public.separations(id) on delete set null,
  last_working_day date not null,
  service_years    numeric(6,2) not null default 0,
  salary_days      integer not null default 0,
  salary_amount    numeric(14,2) not null default 0,
  leave_encashment numeric(14,2) not null default 0,
  gratuity         numeric(14,2) not null default 0,
  loan_recovery    numeric(14,2) not null default 0,
  other_deductions numeric(14,2) not null default 0,
  tax              numeric(14,2) not null default 0,
  net_payable      numeric(14,2) not null default 0,
  breakdown        jsonb not null default '[]'::jsonb,
  status           text not null default 'draft' check (status in ('draft', 'hr_approved', 'finance_approved', 'paid', 'cancelled')),
  prepared_by      uuid default auth.uid(),
  hr_approved_by   uuid, finance_approved_by uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ── Performance: goals, cycles, reviews, feedback ──────────────────────────
create table if not exists public.review_cycles (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  name         text not null,
  period_start date not null,
  period_end   date not null,
  status       text not null default 'draft' check (status in ('draft', 'active', 'calibration', 'closed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.goals (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  level         text not null default 'individual' check (level in ('company', 'department', 'individual')),
  employee_id   uuid references public.employees(id) on delete cascade,
  department_id uuid references public.departments(id) on delete cascade,
  parent_goal_id uuid references public.goals(id) on delete set null,
  cycle_id      uuid references public.review_cycles(id) on delete set null,
  title         text not null,
  description   text,
  key_results   jsonb not null default '[]'::jsonb,   -- [{"title","target","current","unit"}]
  weight        integer not null default 100 check (weight between 0 and 100),
  due_date      date,
  status        text not null default 'on_track' check (status in ('on_track', 'at_risk', 'off_track', 'done', 'dropped')),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (level <> 'individual' or employee_id is not null)
);

create table if not exists public.performance_reviews (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  cycle_id         uuid not null references public.review_cycles(id) on delete cascade,
  employee_id      uuid not null references public.employees(id) on delete cascade,
  reviewer_id      uuid references public.employees(id) on delete set null,
  self_rating      integer check (self_rating between 1 and 5),
  self_comments    text,
  manager_rating   integer check (manager_rating between 1 and 5),
  manager_comments text,
  final_rating     integer check (final_rating between 1 and 5),
  potential        text check (potential in ('low', 'medium', 'high')),
  status           text not null default 'self_review' check (status in ('self_review', 'manager_review', 'calibration', 'completed')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (cycle_id, employee_id)
);

create table if not exists public.feedback (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  from_employee_id uuid not null references public.employees(id) on delete cascade,
  to_employee_id   uuid not null references public.employees(id) on delete cascade,
  message          text not null,
  is_private       boolean not null default true,      -- private: only receiver, their manager and HR
  created_at       timestamptz not null default now()
);

-- ── Learning ───────────────────────────────────────────────────────────────
create table if not exists public.courses (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  title            text not null,
  description      text,
  category         text not null default 'general' check (category in ('compliance', 'safety', 'onboarding', 'technical', 'leadership', 'sales', 'general')),
  duration_minutes integer not null default 30,
  content_url      text,
  is_mandatory     boolean not null default false,
  due_days         integer,                  -- days after assignment
  certificate_valid_months integer,
  is_published     boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.course_enrollments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  course_id    uuid not null references public.courses(id) on delete cascade,
  employee_id  uuid not null references public.employees(id) on delete cascade,
  assigned_by  uuid default auth.uid(),
  due_date     date,
  status       text not null default 'assigned' check (status in ('assigned', 'in_progress', 'completed')),
  progress     integer not null default 0 check (progress between 0 and 100),
  score        integer,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (course_id, employee_id)
);

create table if not exists public.certifications (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  name        text not null,
  issuer      text,
  issued_on   date,
  expires_on  date,
  file_path   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['job_requisitions','candidates','interviews','lifecycle_checklists','checklist_tasks','separations',
    'final_settlements','review_cycles','goals','performance_reviews','feedback','courses','course_enrollments','certifications']
  loop
    perform public.hcm_attach_triggers(('public.' || t)::regclass);
  end loop;
end $$;

-- >>> 20261025000007_engagement_service_ai.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- HCM Master Suite · 0007 · Engagement (M10), helpdesk & knowledge base
-- (M11), AI copilot logs (M12)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.announcements (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  title         text not null,
  body          text not null,
  audience      jsonb not null default '{}'::jsonb,   -- {"branch_ids":[..],"department_ids":[..]}; empty = everyone
  requires_ack  boolean not null default false,
  published_at  timestamptz,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.announcement_acks (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  employee_id     uuid not null references public.employees(id) on delete cascade,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  primary key (announcement_id, employee_id)
);

create table if not exists public.kudos (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  from_employee_id uuid not null references public.employees(id) on delete cascade,
  to_employee_id   uuid not null references public.employees(id) on delete cascade,
  value            text not null,           -- company value, e.g. "Ownership"
  message          text not null,
  created_at       timestamptz not null default now(),
  check (from_employee_id <> to_employee_id)
);

-- Surveys: anonymous results are only released at 5+ responses (survey_results()).
create table if not exists public.surveys (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  title        text not null,
  kind         text not null default 'pulse' check (kind in ('pulse', 'engagement', 'enps', 'onboarding', 'exit', 'custom')),
  questions    jsonb not null default '[]'::jsonb,   -- [{"id","text","type":"scale|enps|text"}]
  is_anonymous boolean not null default true,
  status       text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  closes_at    timestamptz,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.survey_responses (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  survey_id       uuid not null references public.surveys(id) on delete cascade,
  respondent_key  text not null,          -- hash of survey + user: one response each, no identity stored
  employee_id     uuid references public.employees(id) on delete set null,   -- only when not anonymous
  answers         jsonb not null,
  created_at      timestamptz not null default now(),
  unique (survey_id, respondent_key)
);

-- ── Helpdesk & knowledge base ──────────────────────────────────────────────
create table if not exists public.kb_articles (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  title        text not null,
  body         text not null,
  category     text not null default 'policy' check (category in ('policy', 'payroll', 'leave', 'attendance', 'benefits', 'it', 'general')),
  is_published boolean not null default true,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create sequence if not exists public.ticket_no_seq;
create table if not exists public.hr_tickets (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  ticket_no    text not null default ('HD-' || nextval('public.ticket_no_seq')),
  employee_id  uuid not null references public.employees(id) on delete cascade,
  category     text not null default 'general' check (category in ('payroll', 'leave', 'attendance', 'documents', 'benefits', 'policy', 'it', 'general')),
  subject      text not null,
  description  text,
  priority     text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status       text not null default 'open' check (status in ('open', 'in_progress', 'waiting', 'resolved', 'closed')),
  assigned_to  uuid references public.employees(id) on delete set null,
  sla_due_at   timestamptz not null default (now() + interval '24 hours'),
  resolution   text,
  resolved_at  timestamptz,
  satisfaction integer check (satisfaction between 1 and 5),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.ticket_comments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  ticket_id   uuid not null references public.hr_tickets(id) on delete cascade,
  author_id   uuid not null default auth.uid(),
  body        text not null,
  is_internal boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ── AI logs (brief M12 guardrails: prompt, tools, scope, cost, feedback) ───
create table if not exists public.ai_logs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  user_id     uuid not null default auth.uid(),
  question    text not null,
  tools_called jsonb not null default '[]'::jsonb,
  answer      text,
  model       text,
  input_tokens  integer,
  output_tokens integer,
  latency_ms  integer,
  feedback    smallint check (feedback in (-1, 1)),
  created_at  timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['announcements','announcement_acks','kudos','surveys','survey_responses','kb_articles','hr_tickets',
    'ticket_comments','ai_logs']
  loop
    perform public.hcm_attach_triggers(('public.' || t)::regclass, t not in ('survey_responses', 'ai_logs', 'announcement_acks'));
  end loop;
end $$;

-- >>> 20261025000008_workflows_platform_people_time.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- HCM Master Suite · 0008 · Server workflows, part 1
-- Sign-up and company setup, users and roles, people, attendance, leave.
-- ───────────────────────────────────────────────────────────────────────────
-- Every function that changes data checks the caller's role itself, so the
-- browser can never skip a rule. All of them are SECURITY DEFINER with a fixed
-- search_path and raise readable errors that the app shows as toasts.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Small helpers ──────────────────────────────────────────────────────────
create or replace function public.require(p_ok boolean, p_message text) returns void
language plpgsql immutable as $$
begin
  if not coalesce(p_ok, false) then raise exception '%', p_message using errcode = 'P0001'; end if;
end $$;

create or replace function public.tenant_now() returns timestamp
language sql stable security definer set search_path = public as $$
  select now() at time zone coalesce((select timezone from tenants where id = public.current_tenant_id()), 'Asia/Karachi')
$$;

create or replace function public.employee_user(p_employee uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select user_id from employees where id = p_employee
$$;

create or replace function public.manager_user(p_employee uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select m.user_id from employees e join employees m on m.id = e.manager_id where e.id = p_employee
$$;

-- Notify every active member holding one of the given roles in the current tenant.
create or replace function public.notify_roles(p_roles public.app_role[], p_title text, p_body text, p_link text) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select user_id from memberships where tenant_id = public.current_tenant_id() and status = 'active' and role = any (p_roles) and user_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
  loop
    perform public.notify_user(r.user_id, p_title, p_body, p_link);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Sign-up: profile + pending invites
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv record; first_tenant uuid;
begin
  insert into profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  for inv in select * from user_invites where lower(email) = lower(new.email) and status = 'pending' order by created_at
  loop
    insert into memberships (tenant_id, user_id, role, employee_id)
    values (inv.tenant_id, new.id, inv.role, inv.employee_id)
    on conflict (tenant_id, user_id) do nothing;
    if inv.employee_id is not null then
      update employees set user_id = new.id where id = inv.employee_id and user_id is null;
    end if;
    update user_invites set status = 'accepted', accepted_at = now() where id = inv.id;
    first_tenant := coalesce(first_tenant, inv.tenant_id);
  end loop;

  if first_tenant is not null then
    update profiles set active_tenant_id = first_tenant where id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users who signed up before this schema existed get their profile now.
insert into public.profiles (id, email, full_name)
select u.id, u.email, coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1))
from auth.users u
where u.email is not null
on conflict (id) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Create a company (tenant) and seed sensible Pakistan defaults
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.create_company(
  p_name text, p_full_name text default null, p_job_title text default 'Founder', p_city text default 'Lahore',
  p_employee_count text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_tenant uuid;
  v_branch uuid;
  v_shift uuid;
  v_dept uuid;
  v_emp uuid;
  v_slug text;
begin
  perform public.require(v_user is not null, 'Please sign in first');
  perform public.require(length(trim(coalesce(p_name, ''))) >= 2, 'Company name is required');
  select email into v_email from auth.users where id = v_user;
  insert into profiles (id, email, full_name) values (v_user, v_email, p_full_name) on conflict (id) do nothing;
  if p_full_name is not null then update profiles set full_name = p_full_name where id = v_user; end if;

  v_slug := trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'));
  if exists (select 1 from tenants where slug = v_slug) then
    v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 5);
  end if;

  insert into tenants (name, slug, created_by) values (trim(p_name), v_slug, v_user) returning id into v_tenant;
  insert into memberships (tenant_id, user_id, role) values (v_tenant, v_user, 'company_owner');
  update profiles set active_tenant_id = v_tenant where id = v_user;

  -- Organization defaults
  insert into legal_entities (tenant_id, name) values (v_tenant, trim(p_name));
  insert into branches (tenant_id, name, code, city) values (v_tenant, 'Head Office', 'HO', p_city) returning id into v_branch;
  insert into shifts (tenant_id, name, start_time, end_time, grace_minutes, break_minutes, working_days, color)
  values (v_tenant, 'General (9 to 6)', '09:00', '18:00', 15, 60, '{1,2,3,4,5,6}', '#0ea5e9') returning id into v_shift;
  insert into shifts (tenant_id, name, start_time, end_time, grace_minutes, break_minutes, working_days, is_night, color)
  values (v_tenant, 'Night (10 to 7)', '22:00', '07:00', 15, 60, '{1,2,3,4,5,6}', true, '#6366f1');
  insert into departments (tenant_id, name, code) values
    (v_tenant, 'Management', 'MGT'), (v_tenant, 'Human Resources', 'HR'), (v_tenant, 'Finance', 'FIN'),
    (v_tenant, 'Operations', 'OPS'), (v_tenant, 'Sales', 'SAL'), (v_tenant, 'Technology', 'TEC');
  select id into v_dept from departments where tenant_id = v_tenant and code = 'MGT';
  insert into grades (tenant_id, code, name, band_min, band_mid, band_max, sort_order) values
    (v_tenant, 'G1', 'Staff', 37000, 50000, 70000, 1),
    (v_tenant, 'G2', 'Officer', 60000, 85000, 120000, 2),
    (v_tenant, 'G3', 'Senior Officer', 100000, 140000, 190000, 3),
    (v_tenant, 'G4', 'Manager', 170000, 240000, 320000, 4),
    (v_tenant, 'G5', 'Senior Manager', 280000, 400000, 550000, 5),
    (v_tenant, 'G6', 'Director', 500000, 750000, 1200000, 6);

  -- Leave policy (Pakistan common practice; every value is editable in Settings)
  insert into leave_types (tenant_id, code, name, days_per_year, accrual, carry_forward_max, is_paid, requires_document_after_days,
                           max_consecutive_days, min_service_days, allow_half_day, encashable, gender_restriction, color) values
    (v_tenant, 'AL', 'Annual leave', 14, 'monthly', 14, true, null, 14, 90, true, true, null, '#0ea5e9'),
    (v_tenant, 'CL', 'Casual leave', 10, 'annual', 0, true, null, 3, 0, true, false, null, '#8b5cf6'),
    (v_tenant, 'SL', 'Sick leave', 8, 'annual', 0, true, 2, null, 0, true, false, null, '#f59e0b'),
    (v_tenant, 'ML', 'Maternity leave', 90, 'annual', 0, true, 1, 90, 0, false, false, 'female', '#ec4899'),
    (v_tenant, 'PL', 'Paternity leave', 7, 'annual', 0, true, null, 7, 0, false, false, 'male', '#14b8a6'),
    (v_tenant, 'UL', 'Unpaid leave', 30, 'annual', 0, false, null, 30, 0, true, false, null, '#64748b');

  -- Payroll settings and FY2025-26 salaried-person slabs
  insert into payroll_settings (tenant_id) values (v_tenant);
  insert into tax_slabs (tenant_id, fiscal_year, income_from, income_to, fixed_tax, rate) values
    (v_tenant, '2025-26', 0, 600000, 0, 0),
    (v_tenant, '2025-26', 600000, 1200000, 0, 0.01),
    (v_tenant, '2025-26', 1200000, 2200000, 6000, 0.11),
    (v_tenant, '2025-26', 2200000, 3200000, 116000, 0.23),
    (v_tenant, '2025-26', 3200000, 4100000, 346000, 0.30),
    (v_tenant, '2025-26', 4100000, null, 616000, 0.35);

  insert into expense_policies (tenant_id, category, label, limit_amount, requires_receipt) values
    (v_tenant, 'fuel', 'Fuel and mileage', 25000, true),
    (v_tenant, 'meals', 'Meals and client entertainment', 8000, true),
    (v_tenant, 'travel', 'Travel and lodging', 60000, true),
    (v_tenant, 'mobile', 'Mobile and internet', 5000, false),
    (v_tenant, 'medical', 'Medical (OPD)', 15000, true),
    (v_tenant, 'other', 'Other', 10000, true);

  insert into letter_templates (tenant_id, name, kind, body) values
    (v_tenant, 'Offer letter', 'offer', E'Dear {{employee_name}},\n\nWe are pleased to offer you the position of {{job_title}} in {{department}} at {{company_name}}, starting {{joining_date}}, with a monthly gross salary of PKR {{gross_salary}}.\n\nPlease sign and return a copy to confirm your acceptance.\n\nRegards,\nHuman Resources\n{{company_name}}'),
    (v_tenant, 'Experience letter', 'experience', E'TO WHOM IT MAY CONCERN\n\nThis is to certify that {{employee_name}} ({{employee_code}}) worked with {{company_name}} as {{job_title}} from {{joining_date}} to {{exit_date}}.\n\nWe wish them every success.\n\nHuman Resources\n{{company_name}}\nDate: {{today}}'),
    (v_tenant, 'Salary certificate', 'salary_certificate', E'TO WHOM IT MAY CONCERN\n\nThis is to certify that {{employee_name}} ({{employee_code}}) is employed with {{company_name}} as {{job_title}} since {{joining_date}} and draws a monthly gross salary of PKR {{gross_salary}}.\n\nThis certificate is issued on request.\n\nHuman Resources\n{{company_name}}\nDate: {{today}}'),
    (v_tenant, 'Confirmation letter', 'confirmation', E'Dear {{employee_name}},\n\nWe are pleased to confirm your employment as {{job_title}} with effect from {{today}}.\n\nRegards,\nHuman Resources\n{{company_name}}'),
    (v_tenant, 'Warning letter', 'warning', E'Dear {{employee_name}},\n\nThis letter serves as a formal warning regarding: ____.\n\nRepeated violations may lead to further disciplinary action.\n\nHuman Resources\n{{company_name}}\nDate: {{today}}');

  insert into kb_articles (tenant_id, title, body, category) values
    (v_tenant, 'How do I apply for leave?', 'Open Leave, choose the leave type and dates, and submit. Your manager is notified and you can track the status on the same page.', 'leave'),
    (v_tenant, 'When is salary paid?', 'Salary is paid on the 1st of every month after payroll is approved by HR and Finance. Your payslip appears under Payslips.', 'payroll'),
    (v_tenant, 'I forgot to clock in', 'Open Attendance, pick the day and request a correction with the actual times. Your manager approves it.', 'attendance');

  -- The owner is also an employee so self-service works from day one
  insert into employees (tenant_id, employee_code, full_name, work_email, job_title, department_id, branch_id, shift_id, user_id, employment_type, status)
  values (v_tenant, 'EMP-0001', coalesce(p_full_name, split_part(v_email, '@', 1)), v_email, coalesce(p_job_title, 'Founder'),
          v_dept, v_branch, v_shift, v_user, 'permanent', 'active')
  returning id into v_emp;
  insert into employee_private (employee_id, tenant_id) values (v_emp, v_tenant);
  update memberships set employee_id = v_emp where tenant_id = v_tenant and user_id = v_user;
  update departments set head_employee_id = v_emp where id = v_dept;

  return v_tenant;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Session context, switching company, users and roles
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.my_context() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id', u.id,
    'email', coalesce(p.email, u.email),
    'full_name', coalesce(p.full_name, u.raw_user_meta_data->>'full_name'),
    'avatar_url', p.avatar_url,
    'theme', coalesce(p.theme, 'system'),
    'is_platform_admin', coalesce(p.is_platform_admin, false),
    'tenant', (select to_jsonb(t) - 'created_by' from tenants t where t.id = public.current_tenant_id()),
    'role', public.current_app_role(),
    'custom_role', (select jsonb_build_object('id', c.id, 'name', c.name, 'permissions', c.permissions)
                    from memberships m join custom_roles c on c.id = m.custom_role_id
                    where m.user_id = u.id and m.tenant_id = public.current_tenant_id()),
    'employee', (select jsonb_build_object('id', e.id, 'code', e.employee_code, 'full_name', e.full_name, 'job_title', e.job_title,
                        'photo_url', e.photo_url, 'department_id', e.department_id, 'branch_id', e.branch_id, 'manager_id', e.manager_id,
                        'has_reports', exists (select 1 from employees r where r.manager_id = e.id and r.status <> 'exited'))
                 from employees e where e.id = public.current_employee_id()),
    'companies', coalesce((select jsonb_agg(jsonb_build_object('tenant_id', t.id, 'name', t.name, 'role', m.role, 'logo_url', t.logo_url) order by t.name)
                           from memberships m join tenants t on t.id = m.tenant_id
                           where m.user_id = u.id and m.status = 'active'), '[]'::jsonb),
    'unread_notifications', (select count(*) from notifications n where n.user_id = u.id and n.read_at is null)
  )
  from auth.users u left join profiles p on p.id = u.id where u.id = auth.uid()
$$;

create or replace function public.switch_company(p_tenant uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require(exists (select 1 from memberships where user_id = auth.uid() and tenant_id = p_tenant and status = 'active'),
                         'You are not a member of that company');
  update profiles set active_tenant_id = p_tenant where id = auth.uid();
end $$;

-- Roles an inviter is allowed to grant.
create or replace function public.can_grant_role(p_role public.app_role) returns boolean
language sql stable as $$
  select case
    when p_role in ('platform_super_admin', 'candidate') then false
    when p_role = 'company_owner' then public.has_role(array['company_owner']::public.app_role[])
    when p_role in ('company_admin', 'hr_director', 'payroll_officer', 'finance_controller', 'auditor') then public.is_tenant_admin()
    else public.is_hr_lead()
  end
$$;

create or replace function public.invite_user(p_email text, p_role public.app_role, p_employee uuid default null) returns text
language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_tenant uuid := public.current_tenant_id(); v_seats int; v_used int;
begin
  perform public.require(public.is_hr_lead(), 'Only company admins and HR leads can invite users');
  perform public.require(public.can_grant_role(p_role), 'You cannot grant the ' || replace(p_role::text, '_', ' ') || ' role');
  perform public.require(p_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$', 'Enter a valid email address');
  if p_employee is not null then
    perform public.require(exists (select 1 from employees where id = p_employee and tenant_id = v_tenant), 'Employee not found');
  end if;
  select seat_limit into v_seats from tenants where id = v_tenant;
  select count(*) into v_used from memberships where tenant_id = v_tenant and status = 'active';
  perform public.require(v_used < v_seats, 'Seat limit reached (' || v_seats || '). Upgrade the plan to add more users');

  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is not null then
    perform public.require(not exists (select 1 from memberships where tenant_id = v_tenant and user_id = v_user), 'This user is already a member');
    insert into profiles (id, email) values (v_user, lower(trim(p_email))) on conflict (id) do nothing;
    insert into memberships (tenant_id, user_id, role, employee_id) values (v_tenant, v_user, p_role, p_employee);
    if p_employee is not null then update employees set user_id = v_user where id = p_employee; end if;
    update profiles set active_tenant_id = coalesce(active_tenant_id, v_tenant) where id = v_user;
    perform public.notify_user(v_user, 'You were added to ' || (select name from tenants where id = v_tenant), 'Switch company from the top bar to start.', '/dashboard');
    return 'added';
  end if;

  update user_invites set status = 'revoked' where tenant_id = v_tenant and lower(email) = lower(trim(p_email)) and status = 'pending';
  insert into user_invites (tenant_id, email, role, employee_id, invited_by) values (v_tenant, lower(trim(p_email)), p_role, p_employee, auth.uid());
  return 'invited';
end $$;

create or replace function public.update_member(p_user uuid, p_role public.app_role default null, p_status text default null,
                                                p_scope jsonb default null, p_custom_role uuid default null, p_employee uuid default null,
                                                p_access_expires_at timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.current_tenant_id(); cur record;
begin
  perform public.require(public.is_hr_lead(), 'Only company admins and HR leads can manage users');
  select * into cur from memberships where tenant_id = v_tenant and user_id = p_user;
  perform public.require(cur.id is not null, 'User not found in this company');
  perform public.require(public.can_grant_role(cur.role), 'You cannot change a ' || replace(cur.role::text, '_', ' '));
  if p_role is not null then
    perform public.require(public.can_grant_role(p_role), 'You cannot grant the ' || replace(p_role::text, '_', ' ') || ' role');
  end if;
  -- Never leave a company without an active owner
  if cur.role = 'company_owner' and (coalesce(p_role, cur.role) <> 'company_owner' or coalesce(p_status, cur.status) <> 'active') then
    perform public.require((select count(*) from memberships where tenant_id = v_tenant and role = 'company_owner' and status = 'active') > 1,
                           'A company must keep at least one active owner');
  end if;
  perform public.require(p_user <> auth.uid() or coalesce(p_status, 'active') = 'active', 'You cannot suspend yourself');
  update memberships set
    role = coalesce(p_role, role),
    status = coalesce(p_status, status),
    scope = coalesce(p_scope, scope),
    custom_role_id = case when p_custom_role is not null then nullif(p_custom_role, '00000000-0000-0000-0000-000000000000'::uuid) else custom_role_id end,
    employee_id = coalesce(p_employee, employee_id),
    access_expires_at = coalesce(p_access_expires_at, access_expires_at)
  where id = cur.id;
  if p_employee is not null then update employees set user_id = p_user where id = p_employee; end if;
end $$;

create or replace function public.remove_member(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.current_tenant_id(); v_role public.app_role;
begin
  perform public.require(public.is_tenant_admin(), 'Only company admins can remove users');
  perform public.require(p_user <> auth.uid(), 'You cannot remove yourself');
  select role into v_role from memberships where tenant_id = v_tenant and user_id = p_user;
  perform public.require(v_role is not null, 'User not found');
  perform public.require(v_role <> 'company_owner' or public.has_role(array['company_owner']::public.app_role[]), 'Only an owner can remove an owner');
  if v_role = 'company_owner' then
    perform public.require((select count(*) from memberships where tenant_id = v_tenant and role = 'company_owner' and status = 'active') > 1,
                           'A company must keep at least one active owner');
  end if;
  delete from memberships where tenant_id = v_tenant and user_id = p_user;
  update profiles set active_tenant_id = null where id = p_user and active_tenant_id = v_tenant;
end $$;

-- Directory of members for User Management (profiles are private otherwise).
create or replace function public.company_members() returns table (
  user_id uuid, email text, full_name text, avatar_url text, role public.app_role, status text, scope jsonb,
  custom_role_id uuid, employee_id uuid, employee_name text, access_expires_at timestamptz, joined_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, p.email, p.full_name, p.avatar_url, m.role, m.status, m.scope, m.custom_role_id, m.employee_id, e.full_name,
         m.access_expires_at, m.created_at
  from memberships m join profiles p on p.id = m.user_id left join employees e on e.id = m.employee_id
  where m.tenant_id = public.current_tenant_id() and (public.is_hr_lead() or public.is_auditor())
  order by m.created_at
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. People: hire in one step (employee + private + pay + onboarding)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.default_checklist_tasks(p_kind text)
returns table (owner_group text, title text, sort_order int)
language sql immutable as $$
  select v.owner_group, v.title, v.sort_order from (values
    ('onboarding', 'HR', 'Collect CNIC, degrees and experience letters', 1),
    ('onboarding', 'HR', 'Issue appointment letter and get contract signed', 2),
    ('onboarding', 'HR', 'Register for EOBI and add bank account (IBAN)', 3),
    ('onboarding', 'IT', 'Create email account and system access', 4),
    ('onboarding', 'IT', 'Issue laptop or phone', 5),
    ('onboarding', 'Admin', 'Prepare desk, ID card and access card', 6),
    ('onboarding', 'Manager', 'Plan the first week and set 30-60-90 day goals', 7),
    ('onboarding', 'Buddy', 'Welcome lunch and office tour', 8),
    ('onboarding', 'Employee', 'Complete your profile and emergency contact', 9),
    ('onboarding', 'Employee', 'Read and acknowledge the employee handbook', 10),
    ('offboarding', 'Manager', 'Plan knowledge transfer and handover', 1),
    ('offboarding', 'IT', 'Revoke email and system access on the last day', 2),
    ('offboarding', 'Admin', 'Collect ID card, access card and company assets', 3),
    ('offboarding', 'Finance', 'Clear loans, advances and expense claims', 4),
    ('offboarding', 'HR', 'Conduct exit interview', 5),
    ('offboarding', 'HR', 'Prepare final settlement', 6),
    ('offboarding', 'HR', 'Issue experience and relieving letters', 7)
  ) v(kind, owner_group, title, sort_order) where v.kind = p_kind
$$;

create or replace function public.start_checklist(p_employee uuid, p_kind text, p_target date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_tenant uuid;
begin
  select tenant_id into v_tenant from employees where id = p_employee;
  perform public.require(v_tenant = public.current_tenant_id(), 'Employee not found');
  perform public.require(public.is_hr_staff() or (p_kind = 'offboarding' and public.is_self(p_employee)), 'Only HR can start this checklist');
  select id into v_id from lifecycle_checklists where employee_id = p_employee and kind = p_kind and status = 'in_progress';
  if v_id is not null then return v_id; end if;
  insert into lifecycle_checklists (tenant_id, employee_id, kind, target_date) values (v_tenant, p_employee, p_kind, p_target) returning id into v_id;
  insert into checklist_tasks (tenant_id, checklist_id, owner_group, title, sort_order)
  select v_tenant, v_id, t.owner_group, t.title, t.sort_order from public.default_checklist_tasks(p_kind) t;
  return v_id;
end $$;

create or replace function public.set_checklist_task(p_task uuid, p_done boolean) returns void
language plpgsql security definer set search_path = public as $$
declare t record; v_emp uuid; v_list uuid;
begin
  select ct.*, lc.employee_id into t from checklist_tasks ct join lifecycle_checklists lc on lc.id = ct.checklist_id
  where ct.id = p_task and ct.tenant_id = public.current_tenant_id();
  perform public.require(t.id is not null, 'Task not found');
  perform public.require(
    public.is_hr_staff()
    or (t.owner_group = 'Employee' and public.is_self(t.employee_id))
    or (t.owner_group in ('Manager', 'Buddy') and public.is_my_report(t.employee_id))
    or (t.owner_group = 'Finance' and public.is_finance()),
    'This task belongs to ' || t.owner_group);
  update checklist_tasks set is_done = p_done, done_by = case when p_done then auth.uid() end, done_at = case when p_done then now() end where id = p_task;
  update lifecycle_checklists set status = case when not exists (select 1 from checklist_tasks where checklist_id = t.checklist_id and not is_done)
                                                then 'completed' else 'in_progress' end
  where id = t.checklist_id;
end $$;

create or replace function public.hire_employee(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.current_tenant_id(); v_emp uuid; v_code text; v_gross numeric;
begin
  perform public.require(public.is_hr_staff(), 'Only HR can add employees');
  perform public.require(length(trim(coalesce(p->>'full_name', ''))) >= 2, 'Full name is required');
  v_code := coalesce(nullif(trim(p->>'employee_code'), ''), public.next_employee_code());
  perform public.require(not exists (select 1 from employees where tenant_id = v_tenant and employee_code = v_code), 'Employee code ' || v_code || ' already exists');

  insert into employees (tenant_id, employee_code, full_name, work_email, phone, gender, job_title, department_id, branch_id, legal_entity_id,
                         grade_id, cost_center_id, manager_id, shift_id, employment_type, status, joining_date, probation_end_date)
  values (v_tenant, v_code, trim(p->>'full_name'), nullif(lower(trim(p->>'work_email')), ''), nullif(p->>'phone', ''), nullif(p->>'gender', ''),
          nullif(p->>'job_title', ''), nullif(p->>'department_id', '')::uuid,
          coalesce(nullif(p->>'branch_id', '')::uuid, (select id from branches where tenant_id = v_tenant and is_active order by created_at limit 1)), nullif(p->>'legal_entity_id', '')::uuid,
          nullif(p->>'grade_id', '')::uuid, nullif(p->>'cost_center_id', '')::uuid, nullif(p->>'manager_id', '')::uuid,
          coalesce(nullif(p->>'shift_id', '')::uuid, (select id from shifts where tenant_id = v_tenant and not is_night order by created_at limit 1)),
          coalesce(nullif(p->>'employment_type', ''), 'permanent'),
          case when coalesce(p->>'employment_type', '') = 'probation' then 'probation' else 'active' end,
          coalesce(nullif(p->>'joining_date', '')::date, current_date),
          case when coalesce(p->>'employment_type', '') = 'probation' then coalesce(nullif(p->>'joining_date', '')::date, current_date) + 90 end)
  returning id into v_emp;

  insert into employee_private (employee_id, tenant_id, cnic, date_of_birth, personal_email, address, city, bank_name, bank_account_no,
                                emergency_contact_name, emergency_contact_phone)
  values (v_emp, v_tenant, nullif(p->>'cnic', ''), nullif(p->>'date_of_birth', '')::date, nullif(p->>'personal_email', ''), nullif(p->>'address', ''),
          nullif(p->>'city', ''), nullif(p->>'bank_name', ''), nullif(p->>'bank_account_no', ''), nullif(p->>'emergency_contact_name', ''),
          nullif(p->>'emergency_contact_phone', ''));

  v_gross := nullif(p->>'gross_salary', '')::numeric;
  if v_gross is not null then
    perform public.require(public.can_view_pay(), 'You cannot set salaries');
    insert into employee_compensation (tenant_id, employee_id, effective_from, gross_salary, eobi_applicable, pf_applicable, reason)
    values (v_tenant, v_emp, coalesce(nullif(p->>'joining_date', '')::date, current_date), v_gross,
            coalesce((p->>'eobi_applicable')::boolean, true), coalesce((p->>'pf_applicable')::boolean, false), 'Joining salary');
  end if;

  if coalesce((p->>'start_onboarding')::boolean, true) then
    perform public.start_checklist(v_emp, 'onboarding', coalesce(nullif(p->>'joining_date', '')::date, current_date) + 7);
  end if;
  if nullif(p->>'invite_email', '') is not null then
    perform public.invite_user(p->>'invite_email', 'employee', v_emp);
  end if;
  return v_emp;
end $$;

-- Letters with merge fields; salary only when the issuer can view pay.
create or replace function public.issue_letter(p_employee uuid, p_template uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare e record; t record; v_body text; v_id uuid; v_gross numeric;
begin
  perform public.require(public.is_hr_staff(), 'Only HR can issue letters');
  select em.*, d.name as dept_name, tn.name as company_name into e
  from employees em left join departments d on d.id = em.department_id join tenants tn on tn.id = em.tenant_id
  where em.id = p_employee and em.tenant_id = public.current_tenant_id();
  perform public.require(e.id is not null, 'Employee not found');
  select * into t from letter_templates where id = p_template and tenant_id = e.tenant_id;
  perform public.require(t.id is not null, 'Template not found');
  select gross_salary into v_gross from employee_compensation where employee_id = p_employee and effective_from <= current_date order by effective_from desc limit 1;
  perform public.require(position('{{gross_salary}}' in t.body) = 0 or public.can_view_pay(), 'This letter shows salary; ask HR leadership or payroll to issue it');
  v_body := t.body;
  v_body := replace(v_body, '{{employee_name}}', e.full_name);
  v_body := replace(v_body, '{{employee_code}}', e.employee_code);
  v_body := replace(v_body, '{{job_title}}', coalesce(e.job_title, ''));
  v_body := replace(v_body, '{{department}}', coalesce(e.dept_name, ''));
  v_body := replace(v_body, '{{company_name}}', e.company_name);
  v_body := replace(v_body, '{{joining_date}}', to_char(e.joining_date, 'DD Mon YYYY'));
  v_body := replace(v_body, '{{exit_date}}', coalesce(to_char(e.exit_date, 'DD Mon YYYY'), 'present'));
  v_body := replace(v_body, '{{today}}', to_char(current_date, 'DD Mon YYYY'));
  v_body := replace(v_body, '{{gross_salary}}', coalesce(to_char(v_gross, 'FM999,999,999'), '-'));
  insert into issued_letters (tenant_id, employee_id, template_id, kind, body) values (e.tenant_id, p_employee, p_template, t.kind, v_body) returning id into v_id;
  perform public.notify_user(e.user_id, 'A new letter was issued to you', t.name, '/documents');
  return v_id;
end $$;

-- Public verification of a letter by its code (no personal details beyond name and type).
create or replace function public.verify_letter(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('valid', true, 'company', t.name, 'employee', e.full_name, 'kind', l.kind, 'issued_at', l.issued_at)
  from issued_letters l join employees e on e.id = l.employee_id join tenants t on t.id = l.tenant_id
  where l.verification_code = upper(trim(p_code))
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Attendance: server-stamped clock in/out with geofence
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.employee_shift_for(p_employee uuid, p_date date) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select r.shift_id from roster_entries r where r.employee_id = p_employee and r.work_date = p_date),
    case when exists (select 1 from roster_entries r where r.employee_id = p_employee and r.work_date = p_date and r.shift_id is null) then null
         else (select shift_id from employees where id = p_employee) end)
$$;

create or replace function public.clock_in(p_lat double precision default null, p_lng double precision default null,
                                           p_accuracy double precision default null, p_source text default 'web')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.current_employee_id();
  e record; b record; s record;
  v_local timestamp := public.tenant_now();
  v_date date;
  v_dist double precision;
  v_late int := 0;
  v_flags text[] := '{}';
  v_status text := 'present';
  v_id uuid;
begin
  perform public.require(v_emp is not null, 'Your user is not linked to an employee record. Ask HR to link it');
  select * into e from employees where id = v_emp;
  perform public.require(e.status not in ('exited', 'suspended'), 'Your employment is not active');
  v_date := v_local::date;
  select * into s from shifts where id = public.employee_shift_for(v_emp, v_date);
  -- A night shift that started yesterday: before shift end time on the next morning belongs to yesterday.
  if s.id is not null and s.is_night and v_local::time < s.end_time then v_date := v_date - 1; end if;

  perform public.require(not exists (select 1 from attendance_records where employee_id = v_emp and work_date = v_date and clock_in_at is not null),
                         'You have already clocked in today');

  select * into b from branches where id = e.branch_id;
  if b.id is not null and b.latitude is not null and b.longitude is not null then
    perform public.require(p_lat is not null and p_lng is not null, 'Location is required to clock in. Allow location access and try again');
    v_dist := public.distance_m(b.latitude, b.longitude, p_lat, p_lng);
    perform public.require(v_dist <= b.geofence_radius_m + least(coalesce(p_accuracy, 0), 100),
      format('You are %s m from %s. Clock in within %s m of the office', round(v_dist)::int, b.name, b.geofence_radius_m));
    if coalesce(p_accuracy, 0) > 100 then v_flags := v_flags || 'low_accuracy'; end if;
  end if;

  if s.id is not null then
    v_late := greatest(0, floor(extract(epoch from (v_local - (v_date + s.start_time))) / 60))::int;
    if v_late > s.grace_minutes then v_status := 'late'; else v_late := 0; end if;
  end if;

  insert into attendance_records (tenant_id, employee_id, work_date, shift_id, clock_in_at, clock_in_lat, clock_in_lng, clock_in_accuracy_m,
                                  clock_in_distance_m, source, status, late_minutes, flags)
  values (e.tenant_id, v_emp, v_date, s.id, now(), p_lat, p_lng, p_accuracy, round(v_dist)::int, coalesce(p_source, 'web'), v_status, v_late, v_flags)
  on conflict (employee_id, work_date) do update set
    clock_in_at = excluded.clock_in_at, clock_in_lat = excluded.clock_in_lat, clock_in_lng = excluded.clock_in_lng,
    clock_in_accuracy_m = excluded.clock_in_accuracy_m, clock_in_distance_m = excluded.clock_in_distance_m, source = excluded.source,
    status = excluded.status, late_minutes = excluded.late_minutes, flags = excluded.flags, shift_id = excluded.shift_id
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'status', v_status, 'late_minutes', v_late, 'distance_m', round(v_dist), 'work_date', v_date);
end $$;

create or replace function public.clock_out(p_lat double precision default null, p_lng double precision default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.current_employee_id();
  a record; s record;
  v_local timestamp := public.tenant_now();
  v_worked int; v_shift_minutes int; v_early int := 0; v_ot int := 0; v_status text;
begin
  perform public.require(v_emp is not null, 'Your user is not linked to an employee record');
  select * into a from attendance_records
  where employee_id = v_emp and clock_in_at is not null and clock_out_at is null and clock_in_at > now() - interval '20 hours'
  order by clock_in_at desc limit 1;
  perform public.require(a.id is not null, 'You have not clocked in yet');
  select * into s from shifts where id = a.shift_id;

  v_worked := floor(extract(epoch from (now() - a.clock_in_at)) / 60)::int;
  v_status := a.status;
  if s.id is not null then
    v_worked := greatest(0, v_worked - case when v_worked > 300 then s.break_minutes else 0 end);
    v_shift_minutes := (extract(epoch from (s.end_time - s.start_time)) / 60)::int;
    if v_shift_minutes <= 0 then v_shift_minutes := v_shift_minutes + 1440; end if;
    v_shift_minutes := v_shift_minutes - s.break_minutes;
    v_early := greatest(0, floor(extract(epoch from (((a.work_date + s.start_time) + make_interval(mins => v_shift_minutes + s.break_minutes)) - v_local)) / 60))::int;
    if v_worked - v_shift_minutes >= 30 then v_ot := v_worked - v_shift_minutes; end if;
    if v_worked < s.half_day_minutes then v_status := 'half_day'; end if;
  end if;

  update attendance_records set clock_out_at = now(), clock_out_lat = p_lat, clock_out_lng = p_lng,
    worked_minutes = v_worked, early_leave_minutes = v_early, overtime_minutes = v_ot, status = v_status
  where id = a.id;
  return jsonb_build_object('worked_minutes', v_worked, 'overtime_minutes', v_ot, 'early_leave_minutes', v_early, 'status', v_status);
end $$;

-- Who can decide requests for an employee: their manager chain or HR (never themselves).
create or replace function public.can_decide_for(p_employee uuid) returns boolean
language sql stable as $$
  select not public.is_self(p_employee) and (public.is_hr_staff() or public.is_my_report(p_employee))
$$;

create or replace function public.decide_regularization(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r record; tz text; v_in timestamptz; v_out timestamptz;
begin
  select * into r from regularization_requests where id = p_id and tenant_id = public.current_tenant_id();
  perform public.require(r.id is not null, 'Request not found');
  perform public.require(r.status = 'pending', 'This request was already decided');
  perform public.require(public.can_decide_for(r.employee_id), 'You cannot decide this request');
  update regularization_requests set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(), decision_note = p_note
  where id = p_id;
  if p_approve then
    select timezone into tz from tenants where id = r.tenant_id;
    v_in := case when r.clock_in_time is not null then (r.work_date + r.clock_in_time) at time zone tz end;
    v_out := case when r.clock_out_time is not null then (r.work_date + r.clock_out_time + case when r.clock_out_time < r.clock_in_time then interval '1 day' else interval '0' end) at time zone tz end;
    insert into attendance_records (tenant_id, employee_id, work_date, shift_id, clock_in_at, clock_out_at, source, status, worked_minutes, flags, notes)
    values (r.tenant_id, r.employee_id, r.work_date, public.employee_shift_for(r.employee_id, r.work_date), v_in, v_out, 'manual', 'present',
            coalesce(floor(extract(epoch from (v_out - v_in)) / 60)::int, 0), '{corrected}', r.reason)
    on conflict (employee_id, work_date) do update set
      clock_in_at = coalesce(excluded.clock_in_at, attendance_records.clock_in_at),
      clock_out_at = coalesce(excluded.clock_out_at, attendance_records.clock_out_at),
      status = 'present', late_minutes = 0,
      worked_minutes = coalesce(floor(extract(epoch from (coalesce(excluded.clock_out_at, attendance_records.clock_out_at) - coalesce(excluded.clock_in_at, attendance_records.clock_in_at))) / 60)::int, attendance_records.worked_minutes),
      flags = array(select distinct unnest(attendance_records.flags || '{corrected}'::text[])), notes = excluded.notes;
  end if;
  perform public.notify_user(public.employee_user(r.employee_id), 'Attendance correction ' || case when p_approve then 'approved' else 'rejected' end,
                             to_char(r.work_date, 'DD Mon') || coalesce(': ' || p_note, ''), '/attendance');
end $$;

create or replace function public.decide_overtime(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from overtime_requests where id = p_id and tenant_id = public.current_tenant_id();
  perform public.require(r.id is not null, 'Request not found');
  perform public.require(r.status = 'pending', 'This request was already decided');
  perform public.require(public.can_decide_for(r.employee_id), 'You cannot decide this request');
  update overtime_requests set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(), decision_note = p_note
  where id = p_id;
  perform public.notify_user(public.employee_user(r.employee_id), 'Overtime ' || case when p_approve then 'approved' else 'rejected' end,
                             round(r.minutes / 60.0, 1) || ' h on ' || to_char(r.work_date, 'DD Mon'), '/attendance');
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Leave: validate, route manager → HR, decide, cancel
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.apply_leave(p_type uuid, p_start date, p_end date, p_half_day boolean default false,
                                              p_reason text default null, p_document text default null, p_employee uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := coalesce(p_employee, public.current_employee_id());
  e record; t record; v_days numeric; v_avail numeric; v_id uuid; v_step text;
begin
  perform public.require(v_emp is not null, 'Your user is not linked to an employee record');
  perform public.require(p_employee is null or public.is_self(p_employee) or public.is_hr_staff(), 'You can only apply leave for yourself');
  select * into e from employees where id = v_emp and tenant_id = public.current_tenant_id();
  perform public.require(e.id is not null, 'Employee not found');
  select * into t from leave_types where id = p_type and tenant_id = e.tenant_id and is_active;
  perform public.require(t.id is not null, 'Leave type not found');
  perform public.require(p_end >= p_start, 'End date must be on or after the start date');
  perform public.require(p_start >= current_date - 30, 'Leave older than 30 days needs an HR correction');
  perform public.require(t.gender_restriction is null or e.gender = t.gender_restriction, t.name || ' is not available for this employee');
  perform public.require(current_date - e.joining_date >= t.min_service_days,
                         t.name || ' is available after ' || t.min_service_days || ' days of service');
  perform public.require(not p_half_day or (t.allow_half_day and p_start = p_end), 'Half day is allowed for a single day only');

  v_days := case when p_half_day then 0.5 else public.leave_working_days(v_emp, p_start, p_end, t.count_weekly_offs) end;
  perform public.require(v_days > 0, 'The selected dates are weekly offs or holidays');
  perform public.require(t.max_consecutive_days is null or v_days <= t.max_consecutive_days,
                         t.name || ' allows at most ' || t.max_consecutive_days || ' consecutive days');
  perform public.require(t.requires_document_after_days is null or v_days <= t.requires_document_after_days or p_document is not null,
                         'Attach a supporting document for ' || t.name || ' longer than ' || t.requires_document_after_days || ' days');
  perform public.require(not exists (select 1 from leave_requests r where r.employee_id = v_emp and r.status in ('pending', 'approved')
                                     and daterange(r.start_date, r.end_date, '[]') && daterange(p_start, p_end, '[]')),
                         'You already have leave on these dates');
  if t.is_paid then
    select b.available into v_avail from public.my_leave_balances(v_emp, extract(year from p_start)::int) b where b.leave_type_id = t.id;
    perform public.require(coalesce(v_avail, 0) >= v_days,
                           format('Not enough %s balance: %s available, %s requested', t.name, coalesce(v_avail, 0), v_days));
  end if;

  v_step := case when e.manager_id is null then 'hr' else 'manager' end;
  insert into leave_requests (tenant_id, employee_id, leave_type_id, start_date, end_date, is_half_day, days, reason, document_path, current_step)
  values (e.tenant_id, v_emp, t.id, p_start, p_end, coalesce(p_half_day, false), v_days, p_reason, p_document, v_step)
  returning id into v_id;

  if v_step = 'manager' then
    perform public.notify_user(public.manager_user(v_emp), 'Leave request from ' || e.full_name,
                               t.name || ': ' || to_char(p_start, 'DD Mon') || ' to ' || to_char(p_end, 'DD Mon') || ' (' || v_days || ' d)', '/approvals');
  else
    perform public.notify_roles(array['hr_manager', 'hr_director']::public.app_role[], 'Leave request from ' || e.full_name, t.name || ' · ' || v_days || ' d', '/approvals');
  end if;
  return v_id;
end $$;

create or replace function public.decide_leave(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r record; t record; v_final boolean;
begin
  select * into r from leave_requests where id = p_id and tenant_id = public.current_tenant_id() for update;
  perform public.require(r.id is not null, 'Leave request not found');
  perform public.require(r.status = 'pending', 'This request was already decided');
  perform public.require(public.can_decide_for(r.employee_id), 'You cannot decide this request');
  perform public.require(r.current_step = 'manager' or public.is_hr_staff(), 'This request is waiting for HR');
  select * into t from leave_types where id = r.leave_type_id;

  if not p_approve then
    update leave_requests set status = 'rejected', current_step = 'done', decided_by = auth.uid(), decided_at = now(), decision_note = p_note where id = p_id;
    perform public.notify_user(public.employee_user(r.employee_id), 'Leave rejected', t.name || coalesce(': ' || p_note, ''), '/leave');
    return;
  end if;

  -- Manager approval is final for short paid leave; long or unpaid leave also needs HR.
  v_final := public.is_hr_staff() or (r.days <= 3 and t.is_paid);
  if v_final then
    update leave_requests set status = 'approved', current_step = 'done', decided_by = auth.uid(), decided_at = now(), decision_note = p_note where id = p_id;
    perform public.notify_user(public.employee_user(r.employee_id), 'Leave approved',
                               t.name || ': ' || to_char(r.start_date, 'DD Mon') || ' to ' || to_char(r.end_date, 'DD Mon'), '/leave');
  else
    update leave_requests set current_step = 'hr', decision_note = p_note where id = p_id;
    perform public.notify_roles(array['hr_manager', 'hr_director', 'hr_executive']::public.app_role[], 'Leave needs HR approval',
                                t.name || ' · ' || r.days || ' d', '/approvals');
  end if;
end $$;

create or replace function public.cancel_leave(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from leave_requests where id = p_id and tenant_id = public.current_tenant_id();
  perform public.require(r.id is not null, 'Leave request not found');
  perform public.require(public.is_self(r.employee_id) or public.is_hr_staff(), 'You cannot cancel this request');
  perform public.require(r.status = 'pending' or (r.status = 'approved' and (r.start_date > current_date or public.is_hr_staff())),
                         'Only pending or future leave can be cancelled');
  update leave_requests set status = 'cancelled', current_step = 'done' where id = p_id;
end $$;

-- >>> 20261025000009_workflows_payroll_money.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- HCM Master Suite · 0009 · Server workflows, part 2
-- Payroll engine + maker-checker, expenses, travel, loans, final settlement.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Payroll calculation ────────────────────────────────────────────────────
-- Formulas (all settings are per tenant in payroll_settings):
--   basic = gross × basic%;  HRA = basic × hra%;  medical = basic × medical% (tax-exempt)
--   utilities = gross − basic − HRA − medical
--   daily rate = gross ÷ working days per month; hourly = daily ÷ hours per day
--   overtime = approved OT hours × hourly × multiplier
--   absent / unpaid leave deduction = days × daily rate
--   late deduction = floor(late days ÷ lates per half day) × ½ day
--   annual taxable = (gross − medical + OT + taxable variable − unpaid − late) × 12
--   income tax = slab tax on annual taxable ÷ 12
--   EOBI (not for daily wagers) and provident fund on basic
create or replace function public.calculate_payroll(p_period text, p_run_type text default 'regular') returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  st record; run record; e record;
  v_start date; v_end date; v_last date; v_days_in_month int;
  v_factor numeric; v_gross numeric; v_basic numeric; v_hra numeric; v_med numeric; v_util numeric;
  v_daily numeric; v_hourly numeric;
  v_ot_hours numeric; v_ot_pay numeric; v_var_taxable numeric; v_var_exempt numeric; v_other_ded numeric; v_reimb numeric;
  v_absent numeric; v_unpaid_leave numeric; v_lates int; v_unpaid_ded numeric; v_late_ded numeric;
  v_annual numeric; v_tax numeric; v_eobi numeric; v_eobi_er numeric; v_pf numeric; v_loan numeric;
  v_earn numeric; v_ded numeric; v_net numeric; v_prev_net numeric; v_att_count int;
  v_bank_name text; v_bank_acc text; v_band_max numeric;
  v_exceptions jsonb := '[]'::jsonb;
  v_lines jsonb;
begin
  perform public.require(public.can_run_payroll(), 'Only payroll officers and HR directors can run payroll');
  perform public.require(p_period ~ '^\d{4}-(0[1-9]|1[0-2])$', 'Period must look like 2026-10');
  select * into st from payroll_settings where tenant_id = v_tenant;
  perform public.require(st.tenant_id is not null, 'Payroll settings are missing');

  v_start := (p_period || '-01')::date;
  v_end := (v_start + interval '1 month - 1 day')::date;
  v_days_in_month := extract(day from v_end)::int;
  v_last := least(v_end, current_date);

  select * into run from payroll_runs where tenant_id = v_tenant and period = p_period and run_type = coalesce(p_run_type, 'regular');
  if run.id is null then
    insert into payroll_runs (tenant_id, period, run_type, pay_date)
    values (v_tenant, p_period, coalesce(p_run_type, 'regular'), (v_end + make_interval(days => st.pay_day))::date)
    returning * into run;
  else
    perform public.require(run.status in ('draft', 'calculated'), 'This run is already ' || replace(run.status, '_', ' ') || '. Reject it first to recalculate');
    delete from payslips where run_id = run.id;
    update expense_claims set reimbursed_run_id = null where reimbursed_run_id = run.id and status = 'approved';
  end if;

  for e in
    select em.*, c.gross_salary, c.eobi_applicable, c.pf_applicable, g.band_max, g.code as grade_code
    from employees em
    join lateral (select * from employee_compensation c where c.employee_id = em.id and c.effective_from <= v_end
                  order by c.effective_from desc limit 1) c on true
    left join grades g on g.id = em.grade_id
    where em.tenant_id = v_tenant
      and em.joining_date <= v_end
      and (em.status <> 'exited' or em.exit_date >= v_start)
    order by em.employee_code
  loop
    -- Proration for joiners and leavers inside the month
    v_factor := (least(v_end, coalesce(e.exit_date, v_end)) - greatest(v_start, e.joining_date) + 1)::numeric / v_days_in_month;
    v_factor := greatest(0, least(1, v_factor));
    v_gross := round(e.gross_salary * v_factor);
    v_basic := round(v_gross * st.basic_pct_of_gross);
    v_hra := round(v_basic * st.hra_pct_of_basic);
    v_med := round(v_basic * st.medical_pct_of_basic);
    v_util := v_gross - v_basic - v_hra - v_med;
    v_daily := e.gross_salary / st.working_days_per_month;
    v_hourly := v_daily / st.hours_per_day;

    select coalesce(sum(minutes), 0) / 60.0 into v_ot_hours from overtime_requests
    where employee_id = e.id and status = 'approved' and work_date between v_start and v_end;
    v_ot_pay := round(v_ot_hours * v_hourly * st.overtime_multiplier);

    select coalesce(sum(amount) filter (where kind <> 'deduction' and taxable), 0),
           coalesce(sum(amount) filter (where kind <> 'deduction' and not taxable), 0),
           coalesce(sum(amount) filter (where kind = 'deduction'), 0)
      into v_var_taxable, v_var_exempt, v_other_ded
    from payroll_adjustments where employee_id = e.id and period = p_period;

    select coalesce(sum(amount), 0) into v_reimb from expense_claims
    where employee_id = e.id and status = 'approved' and reimbursed_run_id is null;
    update expense_claims set reimbursed_run_id = run.id where employee_id = e.id and status = 'approved' and reimbursed_run_id is null;

    -- Attendance-based deductions (only when the employee actually uses attendance this month)
    select count(*) into v_att_count from attendance_records where employee_id = e.id and work_date between v_start and v_end;
    select count(*) filter (where status = 'late') into v_lates from attendance_records where employee_id = e.id and work_date between v_start and v_end;
    v_absent := 0;
    if v_att_count > 0 and st.deduct_absent_days then
      select count(*) into v_absent
      from generate_series(greatest(v_start, e.joining_date), least(v_last, coalesce(e.exit_date, v_last)), interval '1 day') g(d)
      where public.leave_working_days(e.id, g.d::date, g.d::date, false) = 1
        and not exists (select 1 from attendance_records a where a.employee_id = e.id and a.work_date = g.d::date and a.clock_in_at is not null)
        and not exists (select 1 from leave_requests l where l.employee_id = e.id and l.status = 'approved' and g.d::date between l.start_date and l.end_date);
    elsif v_att_count = 0 then
      v_exceptions := v_exceptions || jsonb_build_object('id', md5(e.id::text || 'no_attendance'), 'employee_id', e.id, 'employee', e.full_name,
                        'code', 'no_attendance', 'severity', 'info', 'message', 'No attendance recorded this month, so no absence deduction was made', 'accepted', true);
    end if;

    select coalesce(sum(case when l.is_half_day then 0.5
                             else public.leave_working_days(e.id, greatest(l.start_date, v_start), least(l.end_date, v_end), t.count_weekly_offs) end), 0)
      into v_unpaid_leave
    from leave_requests l join leave_types t on t.id = l.leave_type_id
    where l.employee_id = e.id and l.status = 'approved' and not t.is_paid and l.start_date <= v_end and l.end_date >= v_start;

    v_unpaid_ded := round((v_absent + v_unpaid_leave) * v_daily);
    v_late_ded := round(floor(v_lates::numeric / greatest(st.lates_per_half_day, 1)) * 0.5 * v_daily);

    v_annual := greatest(0, (v_gross - v_med + v_ot_pay + v_var_taxable - v_unpaid_ded - v_late_ded) * 12);
    v_tax := round(public.annual_income_tax(v_tenant, st.fiscal_year, v_annual) / 12);

    v_eobi := case when e.eobi_applicable and e.employment_type <> 'daily_wager' then st.eobi_employee_amount else 0 end;
    v_eobi_er := case when e.eobi_applicable and e.employment_type <> 'daily_wager' then st.eobi_employer_amount else 0 end;
    v_pf := case when e.pf_applicable then round(v_basic * st.pf_rate) else 0 end;

    select coalesce(sum(least(l.installment_amount, l.principal - l.recovered_amount)), 0) into v_loan
    from loans l where l.employee_id = e.id and l.status = 'active' and l.start_period <= p_period and l.recovered_amount < l.principal;

    v_earn := v_gross + v_ot_pay + v_var_taxable + v_var_exempt + v_reimb;
    v_ded := v_tax + v_eobi + v_pf + v_loan + v_unpaid_ded + v_late_ded + v_other_ded;
    v_net := v_earn - v_ded;

    select bank_name, bank_account_no into v_bank_name, v_bank_acc from employee_private where employee_id = e.id;

    v_lines := jsonb_build_array(
      jsonb_build_object('key', 'basic', 'label', 'Basic salary', 'type', 'earning', 'amount', v_basic, 'formula', (st.basic_pct_of_gross * 100)::int || '% of gross'),
      jsonb_build_object('key', 'hra', 'label', 'House rent allowance', 'type', 'earning', 'amount', v_hra, 'formula', (st.hra_pct_of_basic * 100)::int || '% of basic'),
      jsonb_build_object('key', 'medical', 'label', 'Medical allowance', 'type', 'earning', 'amount', v_med, 'formula', (st.medical_pct_of_basic * 100)::int || '% of basic, tax-exempt'),
      jsonb_build_object('key', 'utilities', 'label', 'Utilities allowance', 'type', 'earning', 'amount', v_util, 'formula', 'Balance of gross'));
    if v_ot_pay > 0 then v_lines := v_lines || jsonb_build_object('key', 'overtime', 'label', 'Overtime', 'type', 'earning', 'amount', v_ot_pay,
                                       'formula', round(v_ot_hours, 2) || ' h × ' || round(v_hourly) || ' × ' || st.overtime_multiplier); end if;
    if v_var_taxable + v_var_exempt > 0 then v_lines := v_lines || jsonb_build_object('key', 'variable', 'label', 'Bonus, commission and allowances', 'type', 'earning', 'amount', v_var_taxable + v_var_exempt); end if;
    if v_reimb > 0 then v_lines := v_lines || jsonb_build_object('key', 'reimbursement', 'label', 'Expense reimbursement', 'type', 'earning', 'amount', v_reimb, 'formula', 'Not taxable'); end if;
    v_lines := v_lines || jsonb_build_object('key', 'tax', 'label', 'Income tax', 'type', 'deduction', 'amount', v_tax,
                            'formula', 'Annual taxable ' || to_char(v_annual, 'FM999,999,999') || ' on FY' || st.fiscal_year || ' slabs ÷ 12');
    if v_eobi > 0 then v_lines := v_lines || jsonb_build_object('key', 'eobi', 'label', 'EOBI', 'type', 'deduction', 'amount', v_eobi); end if;
    if v_pf > 0 then v_lines := v_lines || jsonb_build_object('key', 'pf', 'label', 'Provident fund', 'type', 'deduction', 'amount', v_pf, 'formula', round(st.pf_rate * 100, 2) || '% of basic'); end if;
    if v_loan > 0 then v_lines := v_lines || jsonb_build_object('key', 'loan', 'label', 'Loan / advance recovery', 'type', 'deduction', 'amount', v_loan); end if;
    if v_unpaid_ded > 0 then v_lines := v_lines || jsonb_build_object('key', 'unpaid', 'label', 'Absent / unpaid leave', 'type', 'deduction', 'amount', v_unpaid_ded,
                                          'formula', (v_absent + v_unpaid_leave) || ' d × ' || round(v_daily)); end if;
    if v_late_ded > 0 then v_lines := v_lines || jsonb_build_object('key', 'late', 'label', 'Late arrivals', 'type', 'deduction', 'amount', v_late_ded,
                                        'formula', v_lates || ' lates → ' || floor(v_lates::numeric / st.lates_per_half_day) * 0.5 || ' d'); end if;
    if v_other_ded > 0 then v_lines := v_lines || jsonb_build_object('key', 'other', 'label', 'Other deductions', 'type', 'deduction', 'amount', v_other_ded); end if;

    insert into payslips (tenant_id, run_id, employee_id, period, gross_salary, basic, house_rent, medical, utilities, overtime_hours, overtime_pay,
                          variable_pay, reimbursements, income_tax, eobi, provident_fund, loan_deduction, unpaid_deduction, late_deduction, other_deductions,
                          total_earnings, total_deductions, net_pay, employer_eobi, employer_pf, annual_taxable, working_days, absent_days, unpaid_leave_days,
                          late_days, bank_name, bank_account_no, lines)
    values (v_tenant, run.id, e.id, p_period, v_gross, v_basic, v_hra, v_med, v_util, round(v_ot_hours, 2), v_ot_pay,
            v_var_taxable + v_var_exempt, v_reimb, v_tax, v_eobi, v_pf, v_loan, v_unpaid_ded, v_late_ded, v_other_ded,
            v_earn, v_ded, v_net, v_eobi_er, v_pf, v_annual, st.working_days_per_month, v_absent, v_unpaid_leave, v_lates,
            v_bank_name, v_bank_acc, v_lines);

    -- Exceptions for review (brief: payroll anomaly checks before approval)
    select p.net_pay into v_prev_net from payslips p join payroll_runs r on r.id = p.run_id
    where p.employee_id = e.id and r.status = 'finalized' and r.period < p_period order by r.period desc limit 1;
    if v_prev_net is not null and v_prev_net > 0 and abs(v_net - v_prev_net) / v_prev_net > 0.20 then
      v_exceptions := v_exceptions || jsonb_build_object('id', md5(e.id::text || 'net_change'), 'employee_id', e.id, 'employee', e.full_name, 'code', 'net_change',
                        'severity', 'warning', 'message', format('Net pay changed %s%% vs last month (%s → %s)', round((v_net - v_prev_net) / v_prev_net * 100),
                        to_char(v_prev_net, 'FM999,999,999'), to_char(v_net, 'FM999,999,999')), 'accepted', false);
    end if;
    if v_bank_acc is null then
      v_exceptions := v_exceptions || jsonb_build_object('id', md5(e.id::text || 'no_bank'), 'employee_id', e.id, 'employee', e.full_name, 'code', 'no_bank',
                        'severity', 'warning', 'message', 'Bank account (IBAN) is missing', 'accepted', false);
    end if;
    if v_net <= 0 then
      v_exceptions := v_exceptions || jsonb_build_object('id', md5(e.id::text || 'non_positive'), 'employee_id', e.id, 'employee', e.full_name, 'code', 'non_positive',
                        'severity', 'critical', 'message', 'Net pay is zero or negative', 'accepted', false);
    end if;
    if e.band_max is not null and e.gross_salary > e.band_max then
      v_exceptions := v_exceptions || jsonb_build_object('id', md5(e.id::text || 'above_band'), 'employee_id', e.id, 'employee', e.full_name, 'code', 'above_band',
                        'severity', 'info', 'message', format('Gross %s is above the %s band maximum %s', to_char(e.gross_salary, 'FM999,999,999'), e.grade_code,
                        to_char(e.band_max, 'FM999,999,999')), 'accepted', false);
    end if;
    if v_ot_hours > 50 then
      v_exceptions := v_exceptions || jsonb_build_object('id', md5(e.id::text || 'high_ot'), 'employee_id', e.id, 'employee', e.full_name, 'code', 'high_ot',
                        'severity', 'warning', 'message', format('%s overtime hours this month', round(v_ot_hours, 1)), 'accepted', false);
    end if;
  end loop;

  update payroll_runs r set
    status = 'calculated',
    employee_count = s.cnt, total_gross = s.earn, total_deductions = s.ded, total_tax = s.tax, total_net = s.net,
    total_employer_cost = s.earn + s.er, exceptions = v_exceptions,
    prepared_by = auth.uid(), prepared_at = now(),
    hr_approved_by = null, hr_approved_at = null, finance_approved_by = null, finance_approved_at = null
  from (select count(*) cnt, coalesce(sum(total_earnings), 0) earn, coalesce(sum(total_deductions), 0) ded, coalesce(sum(income_tax), 0) tax,
               coalesce(sum(net_pay), 0) net, coalesce(sum(employer_eobi + employer_pf), 0) er
        from payslips where run_id = run.id) s
  where r.id = run.id;

  return run.id;
end $$;

create or replace function public.accept_payroll_exception(p_run uuid, p_exception_id text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  perform public.require(public.can_run_payroll() or public.is_hr_lead(), 'You cannot review payroll exceptions');
  select * into r from payroll_runs where id = p_run and tenant_id = public.current_tenant_id();
  perform public.require(r.status = 'calculated', 'Exceptions can only be reviewed on a calculated run');
  update payroll_runs set exceptions = (
    select coalesce(jsonb_agg(case when x->>'id' = p_exception_id
                     then x || jsonb_build_object('accepted', true, 'accepted_by', auth.uid(), 'note', p_note) else x end), '[]'::jsonb)
    from jsonb_array_elements(r.exceptions) x)
  where id = p_run;
end $$;

-- Maker-checker: prepared → HR approval → finance approval → finalize.
create or replace function public.advance_payroll(p_run uuid, p_action text, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare r record; st record; v_me uuid := auth.uid(); v_open int; lr record;
begin
  select * into r from payroll_runs where id = p_run and tenant_id = public.current_tenant_id() for update;
  perform public.require(r.id is not null, 'Payroll run not found');
  select * into st from payroll_settings where tenant_id = r.tenant_id;

  if p_action = 'hr_approve' then
    perform public.require(public.is_hr_lead(), 'HR approval needs an HR director, HR manager or company admin');
    perform public.require(r.status = 'calculated', 'Only a calculated run can be HR-approved');
    select count(*) into v_open from jsonb_array_elements(r.exceptions) x where not coalesce((x->>'accepted')::boolean, false);
    perform public.require(v_open = 0, v_open || ' exception(s) still need review');
    perform public.require(not st.enforce_maker_checker or r.prepared_by is distinct from v_me, 'Maker-checker: the person who calculated payroll cannot approve it');
    update payroll_runs set status = 'hr_approved', hr_approved_by = v_me, hr_approved_at = now(), notes = coalesce(p_note, notes) where id = p_run;
    perform public.notify_roles(array['finance_controller']::public.app_role[], 'Payroll ' || r.period || ' needs finance approval',
                                'Net ' || to_char(r.total_net, 'FM999,999,999'), '/payroll');

  elsif p_action = 'finance_approve' then
    perform public.require(public.is_finance(), 'Finance approval needs a finance controller or company admin');
    perform public.require(r.status = 'hr_approved', 'Only an HR-approved run can be finance-approved');
    perform public.require(not st.enforce_maker_checker or (r.prepared_by is distinct from v_me and r.hr_approved_by is distinct from v_me),
                           'Maker-checker: finance approval must come from a different person');
    update payroll_runs set status = 'finance_approved', finance_approved_by = v_me, finance_approved_at = now(), notes = coalesce(p_note, notes) where id = p_run;
    perform public.notify_roles(array['payroll_officer']::public.app_role[], 'Payroll ' || r.period || ' approved by finance', 'Ready to finalize', '/payroll');

  elsif p_action = 'finalize' then
    perform public.require(public.can_run_payroll() or public.is_finance(), 'You cannot finalize payroll');
    perform public.require(r.status = 'finance_approved', 'Only a finance-approved run can be finalized');
    for lr in select l.id, least(l.installment_amount, l.principal - l.recovered_amount) amt
              from loans l join payslips p on p.employee_id = l.employee_id and p.run_id = p_run
              where l.status = 'active' and l.start_period <= r.period and l.recovered_amount < l.principal and p.loan_deduction > 0
    loop
      insert into loan_recoveries (tenant_id, loan_id, run_id, period, amount) values (r.tenant_id, lr.id, p_run, r.period, lr.amt)
      on conflict (loan_id, period) do nothing;
      update loans set recovered_amount = recovered_amount + lr.amt,
                       status = case when recovered_amount + lr.amt >= principal then 'closed' else status end
      where id = lr.id;
    end loop;
    update expense_claims set status = 'reimbursed' where reimbursed_run_id = p_run and status = 'approved';
    update payslips set is_published = true where run_id = p_run;
    update payroll_runs set status = 'finalized', finalized_by = v_me, finalized_at = now() where id = p_run;
    insert into notifications (tenant_id, user_id, title, body, link)
    select r.tenant_id, e.user_id, 'Your payslip for ' || r.period || ' is ready', 'Net pay ' || to_char(p.net_pay, 'FM999,999,999'), '/payslips'
    from payslips p join employees e on e.id = p.employee_id where p.run_id = p_run and e.user_id is not null;

  elsif p_action = 'reject' then
    perform public.require(public.is_hr_lead() or public.is_finance() or public.can_run_payroll(), 'You cannot reject payroll');
    perform public.require(r.status in ('calculated', 'hr_approved', 'finance_approved'), 'This run cannot be rejected');
    perform public.require(length(trim(coalesce(p_note, ''))) > 2, 'Give a reason for rejecting');
    update payroll_runs set status = 'draft', notes = p_note, hr_approved_by = null, hr_approved_at = null,
                            finance_approved_by = null, finance_approved_at = null where id = p_run;
    perform public.notify_user(r.prepared_by, 'Payroll ' || r.period || ' was sent back', p_note, '/payroll');

  elsif p_action = 'cancel' then
    perform public.require(public.can_run_payroll(), 'You cannot cancel payroll');
    perform public.require(r.status <> 'finalized', 'A finalized run cannot be cancelled; use an off-cycle adjustment');
    update expense_claims set reimbursed_run_id = null where reimbursed_run_id = p_run and status = 'approved';
    delete from payslips where run_id = p_run;
    update payroll_runs set status = 'cancelled' where id = p_run;
  else
    raise exception 'Unknown action %', p_action;
  end if;

  insert into audit_log (tenant_id, actor_id, actor_email, action, entity, entity_id, after_data)
  values (r.tenant_id, v_me, (select email from profiles where id = v_me), 'payroll_' || p_action, 'payroll_runs', p_run::text,
          jsonb_build_object('period', r.period, 'note', p_note));
  return (select status from payroll_runs where id = p_run);
end $$;

-- Bank transfer file (CSV text) for a finalized or finance-approved run.
create or replace function public.payroll_bank_file(p_run uuid) returns text
language plpgsql security definer set search_path = public as $$
declare r record; v text;
begin
  perform public.require(public.can_run_payroll() or public.is_finance(), 'You cannot export bank files');
  select * into r from payroll_runs where id = p_run and tenant_id = public.current_tenant_id();
  perform public.require(r.status in ('finance_approved', 'finalized'), 'The bank file is available after finance approval');
  select 'Employee Code,Employee Name,Bank,IBAN,Amount,Reference' || chr(10) ||
         coalesce(string_agg(format('%s,"%s","%s",%s,%s,SAL-%s', e.employee_code, replace(e.full_name, '"', ''), coalesce(p.bank_name, ''),
                                    coalesce(p.bank_account_no, 'MISSING'), p.net_pay::bigint, r.period), chr(10) order by e.employee_code), '')
    into v
  from payslips p join employees e on e.id = p.employee_id where p.run_id = p_run and p.net_pay > 0;
  insert into audit_log (tenant_id, actor_id, action, entity, entity_id) values (r.tenant_id, auth.uid(), 'export', 'payroll_bank_file', p_run::text);
  return v;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Expenses, travel and loans
-- ═══════════════════════════════════════════════════════════════════════════
-- Flag claims above the category limit on insert.
create or replace function public.expense_policy_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare pol record;
begin
  new.tenant_id := coalesce(new.tenant_id, public.current_tenant_id());
  select * into pol from expense_policies where tenant_id = new.tenant_id and category = new.category;
  new.over_policy := pol.limit_amount is not null and new.amount > pol.limit_amount;
  if tg_op = 'INSERT' and pol.requires_receipt and new.receipt_path is null and new.amount > 2000 then
    raise exception 'A receipt is required for % claims above 2,000', coalesce(pol.label, new.category);
  end if;
  return new;
end $$;
drop trigger if exists expense_policy on public.expense_claims;
create trigger expense_policy before insert or update of amount, category on public.expense_claims
  for each row execute function public.expense_policy_check();

create or replace function public.decide_expense(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c record; v_next text;
begin
  select * into c from expense_claims where id = p_id and tenant_id = public.current_tenant_id() for update;
  perform public.require(c.id is not null, 'Claim not found');
  perform public.require(c.status in ('pending', 'manager_approved'), 'This claim was already decided');
  perform public.require(not public.is_self(c.employee_id), 'You cannot approve your own claim');
  if not p_approve then
    perform public.require(public.can_decide_for(c.employee_id) or public.is_finance(), 'You cannot decide this claim');
    v_next := 'rejected';
  elsif c.status = 'pending' and public.is_my_report(c.employee_id) and not public.is_finance() then
    v_next := 'manager_approved';
  else
    perform public.require(public.is_finance() or public.is_hr_lead(), 'Finance approval is needed for this claim');
    perform public.require(not c.over_policy or public.is_finance(), 'Over-policy claims need finance approval');
    v_next := 'approved';
  end if;
  update expense_claims set status = v_next, decided_by = auth.uid(), decided_at = now(), decision_note = p_note where id = p_id;
  if v_next = 'manager_approved' then
    perform public.notify_roles(array['finance_controller']::public.app_role[], 'Expense claim awaiting finance',
                                c.category || ' · ' || to_char(c.amount, 'FM999,999,999'), '/approvals');
  end if;
  perform public.notify_user(public.employee_user(c.employee_id), 'Expense claim ' || replace(v_next, '_', ' '),
                             to_char(c.amount, 'FM999,999,999') || coalesce(' · ' || p_note, ''), '/expenses');
end $$;

create or replace function public.decide_travel(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  select * into t from travel_requests where id = p_id and tenant_id = public.current_tenant_id();
  perform public.require(t.id is not null, 'Travel request not found');
  perform public.require(t.status = 'pending', 'This request was already decided');
  perform public.require(public.can_decide_for(t.employee_id) or (public.is_finance() and not public.is_self(t.employee_id)), 'You cannot decide this request');
  update travel_requests set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(), decision_note = p_note
  where id = p_id;
  perform public.notify_user(public.employee_user(t.employee_id), 'Travel to ' || t.destination || ' ' || case when p_approve then 'approved' else 'rejected' end,
                             p_note, '/expenses');
end $$;

create or replace function public.request_loan(p_type text, p_principal numeric, p_installments int, p_start_period text, p_reason text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.current_employee_id(); v_gross numeric; v_id uuid;
begin
  perform public.require(v_emp is not null, 'Your user is not linked to an employee record');
  perform public.require(p_principal > 0 and p_installments between 1 and 120, 'Enter a valid amount and number of installments');
  perform public.require(not exists (select 1 from loans where employee_id = v_emp and status in ('pending', 'active') and loan_type = p_type),
                         'You already have an open ' || replace(p_type, '_', ' '));
  select gross_salary into v_gross from employee_compensation where employee_id = v_emp and effective_from <= current_date order by effective_from desc limit 1;
  perform public.require(v_gross is null or p_type <> 'salary_advance' or p_principal <= v_gross, 'A salary advance cannot exceed one month''s gross salary');
  insert into loans (tenant_id, employee_id, loan_type, principal, installments, installment_amount, start_period, reason)
  values (public.current_tenant_id(), v_emp, p_type, p_principal, p_installments, ceil(p_principal / p_installments), p_start_period, p_reason)
  returning id into v_id;
  perform public.notify_roles(array['finance_controller', 'payroll_officer']::public.app_role[], 'New loan request',
                              replace(p_type, '_', ' ') || ' · ' || to_char(p_principal, 'FM999,999,999'), '/approvals');
  return v_id;
end $$;

create or replace function public.decide_loan(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare l record;
begin
  select * into l from loans where id = p_id and tenant_id = public.current_tenant_id();
  perform public.require(l.id is not null, 'Loan not found');
  perform public.require(l.status = 'pending', 'This loan was already decided');
  perform public.require((public.is_finance() or public.is_hr_lead()) and not public.is_self(l.employee_id), 'Loans are approved by finance or HR leadership');
  update loans set status = case when p_approve then 'active' else 'rejected' end, decided_by = auth.uid(), decided_at = now(), decision_note = p_note where id = p_id;
  perform public.notify_user(public.employee_user(l.employee_id), 'Loan ' || case when p_approve then 'approved' else 'rejected' end,
                             to_char(l.principal, 'FM999,999,999') || ' in ' || l.installments || ' installments', '/expenses');
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Separation and final settlement
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.start_separation(p_employee uuid, p_type text, p_last_day date, p_reason text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare e record; v_id uuid;
begin
  select * into e from employees where id = p_employee and tenant_id = public.current_tenant_id();
  perform public.require(e.id is not null, 'Employee not found');
  perform public.require(public.is_hr_staff() or (public.is_self(p_employee) and p_type = 'resignation'), 'Only HR can start this separation');
  perform public.require(e.status <> 'exited', 'This employee has already exited');
  perform public.require(not exists (select 1 from separations where employee_id = p_employee and status in ('submitted', 'accepted')), 'A separation is already in progress');
  perform public.require(p_last_day >= current_date - 30, 'Last working day looks wrong');
  insert into separations (tenant_id, employee_id, separation_type, last_working_day, reason, status)
  values (e.tenant_id, p_employee, p_type, p_last_day, p_reason, case when public.is_hr_staff() and not public.is_self(p_employee) then 'accepted' else 'submitted' end)
  returning id into v_id;
  update employees set status = 'notice' where id = p_employee;
  if public.is_hr_staff() and not public.is_self(p_employee) then
    perform public.start_checklist(p_employee, 'offboarding', p_last_day);
  else
    perform public.notify_roles(array['hr_manager', 'hr_director']::public.app_role[], 'Resignation from ' || e.full_name,
                                'Last day ' || to_char(p_last_day, 'DD Mon YYYY'), '/lifecycle');
    perform public.notify_user(public.manager_user(p_employee), 'Resignation from ' || e.full_name, 'Last day ' || to_char(p_last_day, 'DD Mon YYYY'), '/lifecycle');
  end if;
  return v_id;
end $$;

create or replace function public.accept_separation(p_id uuid, p_exit_interview jsonb default null, p_rehire boolean default null) returns void
language plpgsql security definer set search_path = public as $$
declare s record;
begin
  perform public.require(public.is_hr_staff(), 'Only HR can accept a separation');
  select * into s from separations where id = p_id and tenant_id = public.current_tenant_id();
  perform public.require(s.id is not null, 'Separation not found');
  update separations set status = case when status = 'submitted' then 'accepted' else status end,
                         exit_interview = coalesce(p_exit_interview, exit_interview), rehire_eligible = coalesce(p_rehire, rehire_eligible)
  where id = p_id;
  perform public.start_checklist(s.employee_id, 'offboarding', s.last_working_day);
end $$;

-- Final settlement:
--   salary for days worked in the last month = gross ÷ 30 × days
--   leave encashment = basic ÷ 30 × unused encashable leave
--   gratuity (permanent staff, 1+ year) = last basic × completed years
--   minus outstanding loans
create or replace function public.prepare_final_settlement(p_separation uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare s record; e record; st record; v_gross numeric; v_basic numeric; v_years numeric; v_completed int; v_days int;
        v_salary numeric; v_unused numeric; v_encash numeric; v_grat numeric; v_loan numeric; v_net numeric; v_id uuid;
begin
  perform public.require(public.can_run_payroll() or public.is_hr_lead(), 'Only payroll or HR leadership can prepare settlements');
  select * into s from separations where id = p_separation and tenant_id = public.current_tenant_id();
  perform public.require(s.id is not null, 'Separation not found');
  perform public.require(s.status in ('accepted', 'completed'), 'Accept the separation first');
  select * into e from employees where id = s.employee_id;
  select * into st from payroll_settings where tenant_id = e.tenant_id;
  select gross_salary into v_gross from employee_compensation where employee_id = e.id and effective_from <= s.last_working_day order by effective_from desc limit 1;
  perform public.require(v_gross is not null, 'No salary on record for this employee');
  v_basic := round(v_gross * st.basic_pct_of_gross);
  v_years := round(((s.last_working_day - e.joining_date) / 365.25)::numeric, 2);
  v_completed := floor(v_years)::int;
  v_days := extract(day from s.last_working_day)::int;
  -- If this month's regular payroll is already finalized, salary for the month was paid.
  if exists (select 1 from payroll_runs r join payslips p on p.run_id = r.id
             where p.employee_id = e.id and r.status = 'finalized' and r.period = to_char(s.last_working_day, 'YYYY-MM')) then
    v_days := 0;
  end if;
  v_salary := round(v_gross / 30 * v_days);
  select coalesce(sum(greatest(b.entitled - b.used - b.pending, 0)), 0) into v_unused
  from public.leave_balances(e.id, extract(year from s.last_working_day)::int) b
  join leave_types t on t.id = b.leave_type_id where t.encashable;
  v_encash := round(v_basic / 30 * v_unused);
  v_grat := case when e.employment_type = 'permanent' and v_completed >= 1 then v_basic * v_completed else 0 end;
  select coalesce(sum(principal - recovered_amount), 0) into v_loan from loans where employee_id = e.id and status = 'active';
  v_net := v_salary + v_encash + v_grat - v_loan;

  delete from final_settlements where separation_id = p_separation and status = 'draft';
  insert into final_settlements (tenant_id, employee_id, separation_id, last_working_day, service_years, salary_days, salary_amount,
                                 leave_encashment, gratuity, loan_recovery, net_payable, breakdown)
  values (e.tenant_id, e.id, s.id, s.last_working_day, v_years, v_days, v_salary, v_encash, v_grat, v_loan, v_net,
          jsonb_build_array(
            jsonb_build_object('label', 'Salary for ' || v_days || ' days', 'amount', v_salary, 'formula', to_char(v_gross, 'FM999,999,999') || ' ÷ 30 × ' || v_days),
            jsonb_build_object('label', 'Leave encashment (' || v_unused || ' d)', 'amount', v_encash, 'formula', 'Basic ÷ 30 × unused days'),
            jsonb_build_object('label', 'Gratuity (' || v_completed || ' yr)', 'amount', v_grat, 'formula', 'Basic × completed years (permanent staff)'),
            jsonb_build_object('label', 'Outstanding loans', 'amount', -v_loan)))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.advance_settlement(p_id uuid, p_action text) returns text
language plpgsql security definer set search_path = public as $$
declare f record;
begin
  select * into f from final_settlements where id = p_id and tenant_id = public.current_tenant_id() for update;
  perform public.require(f.id is not null, 'Settlement not found');
  if p_action = 'hr_approve' then
    perform public.require(public.is_hr_lead() and f.status = 'draft', 'HR approval needs HR leadership on a draft settlement');
    perform public.require(f.prepared_by is distinct from auth.uid() or not (select enforce_maker_checker from payroll_settings where tenant_id = f.tenant_id),
                           'Maker-checker: a different person must approve');
    update final_settlements set status = 'hr_approved', hr_approved_by = auth.uid() where id = p_id;
  elsif p_action = 'finance_approve' then
    perform public.require(public.is_finance() and f.status = 'hr_approved', 'Finance approval needs a finance controller on an HR-approved settlement');
    update final_settlements set status = 'finance_approved', finance_approved_by = auth.uid() where id = p_id;
  elsif p_action = 'mark_paid' then
    perform public.require((public.is_finance() or public.can_run_payroll()) and f.status = 'finance_approved', 'Only a finance-approved settlement can be paid');
    update final_settlements set status = 'paid' where id = p_id;
    update loans set recovered_amount = principal, status = 'closed' where employee_id = f.employee_id and status = 'active';
    update employees set status = 'exited', exit_date = f.last_working_day where id = f.employee_id;
    update separations set status = 'completed' where id = f.separation_id;
    update memberships set status = 'suspended' where employee_id = f.employee_id and role in ('employee', 'line_manager', 'hiring_manager');
    update assets set status = 'available', assigned_to = null, assigned_at = null where assigned_to = f.employee_id and status = 'assigned';
  elsif p_action = 'cancel' then
    perform public.require(public.is_hr_lead() and f.status <> 'paid', 'Cannot cancel');
    update final_settlements set status = 'cancelled' where id = p_id;
  else
    raise exception 'Unknown action %', p_action;
  end if;
  return (select status from final_settlements where id = p_id);
end $$;

-- >>> 20261025000010_workflows_talent_insights.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- HCM Master Suite · 0010 · Server workflows, part 3
-- Recruitment, performance, learning, engagement, approvals inbox,
-- dashboards, analytics and platform administration.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Recruitment ────────────────────────────────────────────────────────────
create or replace function public.decide_requisition(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  perform public.require(public.is_hr_lead(), 'Requisitions are approved by HR leadership');
  select * into r from job_requisitions where id = p_id and tenant_id = public.current_tenant_id();
  perform public.require(r.id is not null, 'Requisition not found');
  perform public.require(r.status = 'pending_approval', 'This requisition is not waiting for approval');
  perform public.require(r.created_by is distinct from auth.uid() or public.is_tenant_admin(), 'You cannot approve your own requisition');
  update job_requisitions set status = case when p_approve then 'open' else 'rejected' end, approved_by = auth.uid(), approved_at = now() where id = p_id;
  perform public.notify_user(r.created_by, 'Requisition ' || case when p_approve then 'approved' else 'rejected' end, r.title || coalesce(' · ' || p_note, ''), '/recruitment');
end $$;

-- Simple, explainable keyword match: share of requirement keywords found in the profile.
create or replace function public.candidate_match(p_requirements text, p_profile text) returns jsonb
language sql immutable as $$
  with req as (select distinct lower(trim(x)) k from unnest(string_to_array(coalesce(p_requirements, ''), ',')) x where trim(x) <> ''),
  hit as (select k from req where position(k in lower(coalesce(p_profile, ''))) > 0)
  select jsonb_build_object(
    'score', case when (select count(*) from req) = 0 then null else round(100.0 * (select count(*) from hit) / (select count(*) from req))::int end,
    'matched', coalesce((select jsonb_agg(k) from hit), '[]'::jsonb),
    'missing', coalesce((select jsonb_agg(k) from req where k not in (select k from hit)), '[]'::jsonb))
$$;

-- Public careers page: open jobs for a company slug (no sign-in needed).
create or replace function public.careers_jobs(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'company', (select jsonb_build_object('tenant_id', t.id, 'name', t.name, 'logo_url', t.logo_url, 'brand_color', t.brand_color) from tenants t where t.slug = p_slug),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'department', d.name, 'location', b.city,
                                                         'employment_type', r.employment_type, 'description', r.description, 'requirements', r.requirements,
                                                         'posted_at', r.approved_at) order by r.approved_at desc)
                      from job_requisitions r join tenants t on t.id = r.tenant_id
                      left join departments d on d.id = r.department_id left join branches b on b.id = r.branch_id
                      where t.slug = p_slug and r.status = 'open' and r.is_public), '[]'::jsonb))
$$;

create or replace function public.apply_for_job(p_job uuid, p_full_name text, p_email text, p_phone text default null,
                                                p_experience numeric default null, p_summary text default null, p_cv_path text default null,
                                                p_expected_salary numeric default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare r record; v_match jsonb; v_id uuid;
begin
  select * into r from job_requisitions where id = p_job and status = 'open' and is_public;
  perform public.require(r.id is not null, 'This job is no longer open');
  perform public.require(length(trim(coalesce(p_full_name, ''))) >= 2, 'Your name is required');
  perform public.require(p_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$', 'Enter a valid email address');
  perform public.require(not exists (select 1 from candidates where requisition_id = p_job and lower(email) = lower(trim(p_email))), 'You have already applied for this job');
  v_match := public.candidate_match(r.requirements, coalesce(p_summary, ''));
  insert into candidates (tenant_id, requisition_id, full_name, email, phone, experience_years, summary, cv_path, expected_salary, source,
                          match_score, match_reasons, user_id)
  values (r.tenant_id, p_job, trim(p_full_name), lower(trim(p_email)), p_phone, p_experience, p_summary, p_cv_path, p_expected_salary, 'careers_site',
          (v_match->>'score')::int, 'Matched: ' || coalesce((select string_agg(x, ', ') from jsonb_array_elements_text(v_match->'matched') x), 'none'),
          auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Re-score a candidate (recruiter edits summary or requirements change).
create or replace function public.score_candidate(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_c record; v jsonb;
begin
  perform public.require(public.is_recruiting(), 'Only recruiters can score candidates');
  select c.*, r.requirements into v_c from candidates c join job_requisitions r on r.id = c.requisition_id where c.id = p_id and c.tenant_id = public.current_tenant_id();
  perform public.require(v_c.id is not null, 'Candidate not found');
  v := public.candidate_match(v_c.requirements, concat_ws(' ', v_c.summary, v_c.current_company));
  update candidates set match_score = (v->>'score')::int,
         match_reasons = 'Matched: ' || coalesce((select string_agg(x, ', ') from jsonb_array_elements_text(v->'matched') x), 'none')
                         || '. Missing: ' || coalesce((select string_agg(x, ', ') from jsonb_array_elements_text(v->'missing') x), 'none')
  where id = p_id;
  return v;
end $$;

create or replace function public.move_candidate(p_id uuid, p_stage text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_c record;
begin
  select c.*, r.hiring_manager_id into v_c from candidates c join job_requisitions r on r.id = c.requisition_id
  where c.id = p_id and c.tenant_id = public.current_tenant_id();
  perform public.require(v_c.id is not null, 'Candidate not found');
  perform public.require(public.is_recruiting() or public.is_self(v_c.hiring_manager_id), 'You cannot move this candidate');
  perform public.require(p_stage in ('applied', 'screening', 'assessment', 'interview', 'offer', 'rejected', 'withdrawn'), 'Use Hire to hire a candidate');
  perform public.require(v_c.stage <> 'hired', 'This candidate is already hired');
  update candidates set stage = p_stage, rejection_reason = case when p_stage = 'rejected' then p_reason else rejection_reason end where id = p_id;
end $$;

create or replace function public.make_offer(p_id uuid, p_amount numeric) returns text
language plpgsql security definer set search_path = public as $$
declare v_c record; v_band numeric;
begin
  perform public.require(public.is_recruiting(), 'Only recruiters can make offers');
  select c.*, g.band_max into v_c from candidates c join job_requisitions r on r.id = c.requisition_id left join grades g on g.id = r.grade_id
  where c.id = p_id and c.tenant_id = public.current_tenant_id();
  perform public.require(v_c.id is not null, 'Candidate not found');
  -- Offers above the grade band need HR leadership approval
  update candidates set stage = 'offer', offer_amount = p_amount,
         offer_status = case when v_c.band_max is not null and p_amount > v_c.band_max and not public.is_hr_lead() then 'pending_approval' else 'approved' end
  where id = p_id;
  return (select offer_status from candidates where id = p_id);
end $$;

create or replace function public.set_offer_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select * into c from candidates where id = p_id and tenant_id = public.current_tenant_id();
  perform public.require(c.id is not null, 'Candidate not found');
  perform public.require(p_status in ('approved', 'sent', 'accepted', 'declined'), 'Unknown offer status');
  perform public.require(p_status <> 'approved' or public.is_hr_lead(), 'Offer approval needs HR leadership');
  perform public.require(public.is_recruiting(), 'Only recruiters can update offers');
  update candidates set offer_status = p_status, stage = case when p_status = 'declined' then 'withdrawn' else stage end where id = p_id;
end $$;

create or replace function public.hire_candidate(p_id uuid, p_joining date, p_employee jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_c record; v_emp uuid; v_hired int;
begin
  perform public.require(public.is_recruiting() and public.is_hr_staff(), 'Only HR can hire');
  select c.*, r.title, r.department_id, r.branch_id, r.grade_id, r.hiring_manager_id, r.employment_type, r.positions into v_c
  from candidates c join job_requisitions r on r.id = c.requisition_id where c.id = p_id and c.tenant_id = public.current_tenant_id();
  perform public.require(v_c.id is not null, 'Candidate not found');
  perform public.require(v_c.stage = 'offer' and v_c.offer_status = 'accepted', 'The offer must be accepted before hiring');
  v_emp := public.hire_employee(jsonb_build_object(
    'full_name', v_c.full_name, 'work_email', null, 'personal_email', v_c.email, 'phone', v_c.phone, 'job_title', v_c.title,
    'department_id', v_c.department_id, 'branch_id', v_c.branch_id, 'grade_id', v_c.grade_id, 'manager_id', v_c.hiring_manager_id,
    'employment_type', case when v_c.employment_type = 'permanent' then 'probation' else v_c.employment_type end,
    'joining_date', p_joining, 'gross_salary', v_c.offer_amount) || coalesce(p_employee, '{}'::jsonb));
  update candidates set stage = 'hired', hired_employee_id = v_emp where id = p_id;
  select count(*) into v_hired from candidates where requisition_id = v_c.requisition_id and stage = 'hired';
  if v_hired >= v_c.positions then update job_requisitions set status = 'filled' where id = v_c.requisition_id; end if;
  return v_emp;
end $$;

-- ── Performance ────────────────────────────────────────────────────────────
create or replace function public.launch_review_cycle(p_cycle uuid) returns int
language plpgsql security definer set search_path = public as $$
declare cy record; n int;
begin
  perform public.require(public.is_hr_lead(), 'Only HR leadership can launch review cycles');
  select * into cy from review_cycles where id = p_cycle and tenant_id = public.current_tenant_id();
  perform public.require(cy.id is not null, 'Cycle not found');
  perform public.require(cy.status = 'draft', 'This cycle was already launched');
  insert into performance_reviews (tenant_id, cycle_id, employee_id, reviewer_id)
  select cy.tenant_id, cy.id, e.id, e.manager_id from employees e
  where e.tenant_id = cy.tenant_id and e.status in ('active', 'probation', 'notice') and e.joining_date <= cy.period_end
  on conflict (cycle_id, employee_id) do nothing;
  get diagnostics n = row_count;
  update review_cycles set status = 'active' where id = p_cycle;
  insert into notifications (tenant_id, user_id, title, body, link)
  select cy.tenant_id, e.user_id, 'Performance review: ' || cy.name, 'Please complete your self review', '/performance'
  from employees e join performance_reviews r on r.employee_id = e.id and r.cycle_id = cy.id where e.user_id is not null;
  return n;
end $$;

create or replace function public.submit_review(p_review uuid, p_rating int, p_comments text, p_potential text default null) returns text
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from performance_reviews where id = p_review and tenant_id = public.current_tenant_id() for update;
  perform public.require(r.id is not null, 'Review not found');
  perform public.require(p_rating between 1 and 5, 'Rating must be 1 to 5');
  if r.status = 'self_review' then
    perform public.require(public.is_self(r.employee_id), 'Waiting for the employee''s self review');
    update performance_reviews set self_rating = p_rating, self_comments = p_comments,
           status = case when reviewer_id is null then 'calibration' else 'manager_review' end where id = p_review;
    perform public.notify_user(public.employee_user(r.reviewer_id), 'Self review submitted', 'Please complete the manager review', '/performance');
  elsif r.status = 'manager_review' then
    perform public.require(public.is_my_report(r.employee_id) or (public.is_hr_lead() and not public.is_self(r.employee_id)), 'Only the manager can complete this review');
    update performance_reviews set manager_rating = p_rating, manager_comments = p_comments, potential = coalesce(p_potential, potential),
           status = 'calibration' where id = p_review;
  elsif r.status = 'calibration' then
    perform public.require(public.is_hr_lead() and not public.is_self(r.employee_id), 'Calibration is done by HR leadership');
    update performance_reviews set final_rating = p_rating, potential = coalesce(p_potential, potential), status = 'completed',
           manager_comments = coalesce(manager_comments, p_comments) where id = p_review;
    perform public.notify_user(public.employee_user(r.employee_id), 'Your review is complete', 'Final rating ' || p_rating || ' of 5', '/performance');
  else
    raise exception 'This review is already completed';
  end if;
  return (select status from performance_reviews where id = p_review);
end $$;

-- ── Learning ───────────────────────────────────────────────────────────────
create or replace function public.assign_course(p_course uuid, p_employees uuid[] default null, p_department uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare c record; n int;
begin
  perform public.require(public.is_hr_staff() or public.has_role(array['line_manager']::public.app_role[]), 'You cannot assign courses');
  select * into c from courses where id = p_course and tenant_id = public.current_tenant_id();
  perform public.require(c.id is not null, 'Course not found');
  insert into course_enrollments (tenant_id, course_id, employee_id, due_date)
  select c.tenant_id, c.id, e.id, case when c.due_days is not null then current_date + c.due_days end
  from employees e
  where e.tenant_id = c.tenant_id and e.status <> 'exited'
    and ((p_employees is not null and e.id = any (p_employees)) or (p_department is not null and e.department_id = p_department)
         or (p_employees is null and p_department is null))
    and (public.is_hr_staff() or public.is_my_report(e.id))
  on conflict (course_id, employee_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.update_course_progress(p_enrollment uuid, p_progress int, p_score int default null) returns void
language plpgsql security definer set search_path = public as $$
declare en record; c record;
begin
  select * into en from course_enrollments where id = p_enrollment and tenant_id = public.current_tenant_id();
  perform public.require(en.id is not null and public.is_self(en.employee_id), 'Enrollment not found');
  select * into c from courses where id = en.course_id;
  update course_enrollments set progress = greatest(progress, least(100, p_progress)), score = coalesce(p_score, score),
         status = case when p_progress >= 100 then 'completed' when p_progress > 0 then 'in_progress' else status end,
         completed_at = case when p_progress >= 100 then coalesce(completed_at, now()) end
  where id = p_enrollment;
  if p_progress >= 100 and c.certificate_valid_months is not null
     and not exists (select 1 from certifications where employee_id = en.employee_id and name = c.title and expires_on > current_date) then
    insert into certifications (tenant_id, employee_id, name, issuer, issued_on, expires_on)
    values (en.tenant_id, en.employee_id, c.title, (select name from tenants where id = en.tenant_id), current_date,
            (current_date + make_interval(months => c.certificate_valid_months))::date);
  end if;
end $$;

-- ── Engagement: anonymous surveys with a minimum group size ────────────────
create or replace function public.submit_survey(p_survey uuid, p_answers jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s record; v_key text;
begin
  select * into s from surveys where id = p_survey and tenant_id = public.current_tenant_id();
  perform public.require(s.id is not null and s.status = 'open', 'This survey is not open');
  perform public.require(s.closes_at is null or s.closes_at > now(), 'This survey has closed');
  perform public.require(public.current_employee_id() is not null, 'Only employees can respond');
  v_key := encode(sha256(convert_to(p_survey::text || ':' || auth.uid()::text || ':' || s.tenant_id::text, 'UTF8')), 'hex');
  perform public.require(not exists (select 1 from survey_responses where survey_id = p_survey and respondent_key = v_key), 'You have already responded');
  insert into survey_responses (tenant_id, survey_id, respondent_key, employee_id, answers)
  values (s.tenant_id, p_survey, v_key, case when s.is_anonymous then null else public.current_employee_id() end, p_answers);
end $$;

create or replace function public.has_responded(p_survey uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from survey_responses where survey_id = p_survey
                 and respondent_key = encode(sha256(convert_to(p_survey::text || ':' || auth.uid()::text || ':' || public.current_tenant_id()::text, 'UTF8')), 'hex'))
$$;

create or replace function public.survey_results(p_survey uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s record; n int; q jsonb; out jsonb := '[]'::jsonb; v_avg numeric; v_prom int; v_det int; v_cnt int; v_texts jsonb;
begin
  perform public.require(public.is_hr_lead() or public.is_auditor(), 'Only HR leadership can see survey results');
  select * into s from surveys where id = p_survey and tenant_id = public.current_tenant_id();
  perform public.require(s.id is not null, 'Survey not found');
  select count(*) into n from survey_responses where survey_id = p_survey;
  if s.is_anonymous and n < 5 then
    return jsonb_build_object('responses', n, 'hidden', true, 'message', 'Results appear after 5 responses to protect anonymity');
  end if;
  for q in select * from jsonb_array_elements(s.questions) loop
    if q->>'type' = 'text' then
      select coalesce(jsonb_agg(answers->>(q->>'id')), '[]'::jsonb) into v_texts from survey_responses
      where survey_id = p_survey and coalesce(answers->>(q->>'id'), '') <> '';
      out := out || jsonb_build_object('id', q->>'id', 'text', q->>'text', 'type', 'text', 'answers', v_texts);
    else
      select avg((answers->>(q->>'id'))::numeric), count(*) filter (where (answers->>(q->>'id'))::numeric >= 9),
             count(*) filter (where (answers->>(q->>'id'))::numeric <= 6), count(answers->>(q->>'id'))
        into v_avg, v_prom, v_det, v_cnt
      from survey_responses where survey_id = p_survey and answers ? (q->>'id');
      out := out || jsonb_build_object('id', q->>'id', 'text', q->>'text', 'type', q->>'type', 'average', round(v_avg, 2), 'count', v_cnt,
               'enps', case when q->>'type' = 'enps' and v_cnt > 0 then round(100.0 * (v_prom - v_det) / v_cnt) end);
    end if;
  end loop;
  return jsonb_build_object('responses', n, 'hidden', false, 'questions', out);
end $$;

-- ── Approvals inbox: everything waiting for me ─────────────────────────────
create or replace function public.my_approvals() returns table (
  kind text, id uuid, employee_id uuid, employee_name text, title text, detail text, amount numeric, created_at timestamptz, link text)
language sql stable security definer set search_path = public as $$
  select 'leave', r.id, e.id, e.full_name, t.name,
         to_char(r.start_date, 'DD Mon') || ' – ' || to_char(r.end_date, 'DD Mon') || ' · ' || r.days || ' d' || coalesce(' · ' || r.reason, ''),
         null::numeric, r.created_at, '/leave'
  from leave_requests r join employees e on e.id = r.employee_id join leave_types t on t.id = r.leave_type_id
  where r.tenant_id = public.current_tenant_id() and r.status = 'pending' and public.can_decide_for(r.employee_id)
    and (r.current_step = 'manager' or public.is_hr_staff())
  union all
  select 'regularization', r.id, e.id, e.full_name, 'Attendance correction',
         to_char(r.work_date, 'DD Mon') || ' · ' || coalesce(to_char(r.clock_in_time, 'HH24:MI'), '--') || ' to ' || coalesce(to_char(r.clock_out_time, 'HH24:MI'), '--') || ' · ' || r.reason,
         null, r.created_at, '/attendance'
  from regularization_requests r join employees e on e.id = r.employee_id
  where r.tenant_id = public.current_tenant_id() and r.status = 'pending' and public.can_decide_for(r.employee_id)
  union all
  select 'overtime', r.id, e.id, e.full_name, 'Overtime', to_char(r.work_date, 'DD Mon') || ' · ' || round(r.minutes / 60.0, 1) || ' h' || coalesce(' · ' || r.reason, ''),
         null, r.created_at, '/attendance'
  from overtime_requests r join employees e on e.id = r.employee_id
  where r.tenant_id = public.current_tenant_id() and r.status = 'pending' and public.can_decide_for(r.employee_id)
  union all
  select 'expense', c.id, e.id, e.full_name, 'Expense · ' || c.category, coalesce(c.description, '') || case when c.over_policy then ' · over policy' else '' end,
         c.amount, c.created_at, '/expenses'
  from expense_claims c join employees e on e.id = c.employee_id
  where c.tenant_id = public.current_tenant_id() and not public.is_self(c.employee_id)
    and ((c.status = 'pending' and (public.is_my_report(c.employee_id) or public.is_finance()))
      or (c.status = 'manager_approved' and public.is_finance()))
  union all
  select 'travel', t.id, e.id, e.full_name, 'Travel · ' || t.destination, t.purpose || ' · ' || to_char(t.start_date, 'DD Mon') || ' – ' || to_char(t.end_date, 'DD Mon'),
         t.estimated_cost, t.created_at, '/expenses'
  from travel_requests t join employees e on e.id = t.employee_id
  where t.tenant_id = public.current_tenant_id() and t.status = 'pending' and (public.can_decide_for(t.employee_id) or (public.is_finance() and not public.is_self(t.employee_id)))
  union all
  select 'loan', l.id, e.id, e.full_name, 'Loan · ' || replace(l.loan_type, '_', ' '), l.installments || ' installments' || coalesce(' · ' || l.reason, ''),
         l.principal, l.created_at, '/expenses'
  from loans l join employees e on e.id = l.employee_id
  where l.tenant_id = public.current_tenant_id() and l.status = 'pending' and (public.is_finance() or public.is_hr_lead()) and not public.is_self(l.employee_id)
  union all
  select 'requisition', r.id, null, null, 'Job requisition · ' || r.title, r.positions || ' position(s)', r.budget_monthly, r.created_at, '/recruitment'
  from job_requisitions r
  where r.tenant_id = public.current_tenant_id() and r.status = 'pending_approval' and public.is_hr_lead() and (r.created_by is distinct from auth.uid() or public.is_tenant_admin())
  union all
  select 'payroll', r.id, null, null, 'Payroll ' || r.period,
         replace(r.status, '_', ' ') || ' · ' || r.employee_count || ' employees', r.total_net, coalesce(r.prepared_at, r.created_at), '/payroll'
  from payroll_runs r
  where r.tenant_id = public.current_tenant_id()
    and ((r.status = 'calculated' and public.is_hr_lead()) or (r.status = 'hr_approved' and public.is_finance()) or (r.status = 'finance_approved' and public.can_run_payroll()))
  union all
  select 'offer', c.id, null, c.full_name, 'Offer above band', to_char(c.offer_amount, 'FM999,999,999'), c.offer_amount, c.updated_at, '/recruitment'
  from candidates c where c.tenant_id = public.current_tenant_id() and c.offer_status = 'pending_approval' and public.is_hr_lead()
  union all
  select 'settlement', f.id, e.id, e.full_name, 'Final settlement', replace(f.status, '_', ' '), f.net_payable, f.created_at, '/lifecycle'
  from final_settlements f join employees e on e.id = f.employee_id
  where f.tenant_id = public.current_tenant_id() and ((f.status = 'draft' and public.is_hr_lead()) or (f.status = 'hr_approved' and public.is_finance()))
  order by 8 desc
$$;

-- ── Dashboard (role-aware numbers in one call) ─────────────────────────────
create or replace function public.dashboard_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_emp uuid := public.current_employee_id();
  v_today date := public.tenant_now()::date;
  v jsonb := '{}'::jsonb;
  v_head int;
begin
  perform public.require(v_tenant is not null, 'No active company');
  -- Personal block for everyone with an employee record
  if v_emp is not null then
    v := v || jsonb_build_object('me', jsonb_build_object(
      'today', (select to_jsonb(a) - 'clock_in_lat' - 'clock_in_lng' - 'clock_out_lat' - 'clock_out_lng' from attendance_records a where a.employee_id = v_emp and a.work_date = v_today),
      'shift', (select jsonb_build_object('name', s.name, 'start', s.start_time, 'end', s.end_time) from shifts s where s.id = public.employee_shift_for(v_emp, v_today)),
      'leave', (select coalesce(jsonb_agg(jsonb_build_object('code', b.code, 'name', b.name, 'color', b.color, 'available', b.available, 'entitled', b.entitled)), '[]')
                from public.my_leave_balances(null) b where b.is_paid),
      'month_present', (select count(*) from attendance_records where employee_id = v_emp and work_date >= date_trunc('month', v_today) and clock_in_at is not null),
      'month_late', (select count(*) from attendance_records where employee_id = v_emp and work_date >= date_trunc('month', v_today) and status = 'late'),
      'last_payslip', (select jsonb_build_object('period', p.period, 'net_pay', p.net_pay, 'id', p.id) from payslips p
                       where p.employee_id = v_emp and p.is_published order by p.period desc limit 1),
      'open_tickets', (select count(*) from hr_tickets where employee_id = v_emp and status not in ('resolved', 'closed')),
      'pending_courses', (select count(*) from course_enrollments where employee_id = v_emp and status <> 'completed'),
      'reports', (select count(*) from employees where manager_id = v_emp and status <> 'exited')));
  end if;

  v := v || jsonb_build_object('approvals_waiting', (select count(*) from public.my_approvals()));

  -- Team block for line managers
  if exists (select 1 from employees where manager_id = v_emp and status <> 'exited') then
    v := v || jsonb_build_object('team', jsonb_build_object(
      'size', (select count(*) from employees e where e.tenant_id = v_tenant and e.status <> 'exited' and public.is_my_report(e.id)),
      'present', (select count(*) from attendance_records a join employees e on e.id = a.employee_id
                  where a.work_date = v_today and a.clock_in_at is not null and public.is_my_report(e.id)),
      'late', (select count(*) from attendance_records a where a.work_date = v_today and a.status = 'late' and public.is_my_report(a.employee_id)),
      'on_leave', (select count(*) from leave_requests l where l.status = 'approved' and v_today between l.start_date and l.end_date and public.is_my_report(l.employee_id))));
  end if;

  -- Company block for HR, leadership, finance and auditors
  if public.is_hr_staff() or public.is_finance() or public.is_auditor() or public.can_run_payroll() then
    select count(*) into v_head from employees where tenant_id = v_tenant and status <> 'exited';
    v := v || jsonb_build_object('company', jsonb_build_object(
      'headcount', v_head,
      'joiners_30d', (select count(*) from employees where tenant_id = v_tenant and joining_date > v_today - 30),
      'exits_12m', (select count(*) from employees where tenant_id = v_tenant and status = 'exited' and exit_date > v_today - 365),
      'attrition_12m_pct', round(100.0 * (select count(*) from employees where tenant_id = v_tenant and status = 'exited' and exit_date > v_today - 365)
                                  / greatest(v_head, 1), 1),
      'present_today', (select count(*) from attendance_records where tenant_id = v_tenant and work_date = v_today and clock_in_at is not null),
      'late_today', (select count(*) from attendance_records where tenant_id = v_tenant and work_date = v_today and status = 'late'),
      'on_leave_today', (select count(*) from leave_requests where tenant_id = v_tenant and status = 'approved' and v_today between start_date and end_date),
      'open_positions', (select coalesce(sum(positions), 0) from job_requisitions where tenant_id = v_tenant and status = 'open'),
      'candidates_active', (select count(*) from candidates where tenant_id = v_tenant and stage not in ('hired', 'rejected', 'withdrawn')),
      'probation_due_30d', (select count(*) from employees where tenant_id = v_tenant and status = 'probation' and probation_end_date between v_today and v_today + 30),
      'documents_expiring_30d', (select count(*) from employee_documents where tenant_id = v_tenant and expires_on between v_today and v_today + 30),
      'open_tickets', (select count(*) from hr_tickets where tenant_id = v_tenant and status not in ('resolved', 'closed')),
      'tickets_breaching_sla', (select count(*) from hr_tickets where tenant_id = v_tenant and status not in ('resolved', 'closed') and sla_due_at < now()),
      'by_department', (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(d.name, 'Unassigned'), 'count', x.c) order by x.c desc), '[]')
                        from (select department_id, count(*) c from employees where tenant_id = v_tenant and status <> 'exited' group by department_id) x
                        left join departments d on d.id = x.department_id),
      'attendance_7d', (select coalesce(jsonb_agg(jsonb_build_object('date', g.d::date,
                                 'present', (select count(*) from attendance_records a where a.tenant_id = v_tenant and a.work_date = g.d::date and a.clock_in_at is not null),
                                 'late', (select count(*) from attendance_records a where a.tenant_id = v_tenant and a.work_date = g.d::date and a.status = 'late')) order by g.d), '[]')
                        from generate_series(v_today - 6, v_today, interval '1 day') g(d)),
      'upcoming_birthdays', case when public.is_hr_staff() then
                        (select coalesce(jsonb_agg(jsonb_build_object('name', e.full_name, 'date', to_char(p.date_of_birth, 'DD Mon'))), '[]')
                         from employees e join employee_private p on p.employee_id = e.id
                         where e.tenant_id = v_tenant and e.status <> 'exited' and p.date_of_birth is not null
                           and to_char(p.date_of_birth, 'MMDD') between to_char(v_today, 'MMDD') and to_char(v_today + 14, 'MMDD')) end));
  end if;

  if public.can_view_pay() then
    v := v || jsonb_build_object('payroll', jsonb_build_object(
      'last_run', (select jsonb_build_object('id', r.id, 'period', r.period, 'status', r.status, 'total_net', r.total_net, 'total_gross', r.total_gross,
                                             'employer_cost', r.total_employer_cost, 'employees', r.employee_count)
                   from payroll_runs r where r.tenant_id = v_tenant and r.status <> 'cancelled' order by r.period desc limit 1),
      'trend', (select coalesce(jsonb_agg(jsonb_build_object('period', r.period, 'net', r.total_net, 'gross', r.total_gross, 'cost', r.total_employer_cost) order by r.period), '[]')
                from (select * from payroll_runs where tenant_id = v_tenant and status = 'finalized' and run_type = 'regular' order by period desc limit 6) r),
      'monthly_salary_bill', (select coalesce(sum(c.gross_salary), 0) from current_compensation c join employees e on e.id = c.employee_id
                              where e.tenant_id = v_tenant and e.status <> 'exited')));
  end if;
  return v;
end $$;

-- ── People analytics (brief M13) ───────────────────────────────────────────
create or replace function public.people_analytics(p_months int default 12) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_tenant uuid := public.current_tenant_id(); v jsonb;
begin
  perform public.require(public.is_hr_staff() or public.is_auditor() or public.is_finance(), 'Analytics is available to HR, finance and auditors');
  select jsonb_build_object(
    'headcount_trend', (select jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'),
                            'headcount', (select count(*) from employees e where e.tenant_id = v_tenant and e.joining_date <= (m + interval '1 month - 1 day')::date
                                          and (e.exit_date is null or e.exit_date > (m + interval '1 month - 1 day')::date)),
                            'joiners', (select count(*) from employees e where e.tenant_id = v_tenant and date_trunc('month', e.joining_date) = m),
                            'exits', (select count(*) from employees e where e.tenant_id = v_tenant and date_trunc('month', e.exit_date) = m)) order by m)
                        from generate_series(date_trunc('month', current_date) - make_interval(months => p_months - 1), date_trunc('month', current_date), interval '1 month') m),
    'by_employment_type', (select jsonb_agg(jsonb_build_object('type', employment_type, 'count', c)) from
                             (select employment_type, count(*) c from employees where tenant_id = v_tenant and status <> 'exited' group by 1) x),
    'by_gender', (select jsonb_agg(jsonb_build_object('gender', coalesce(gender, 'unspecified'), 'count', c)) from
                    (select gender, count(*) c from employees where tenant_id = v_tenant and status <> 'exited' group by 1) x),
    'by_branch', (select jsonb_agg(jsonb_build_object('branch', coalesce(b.name, 'Unassigned'), 'count', x.c)) from
                    (select branch_id, count(*) c from employees where tenant_id = v_tenant and status <> 'exited' group by 1) x left join branches b on b.id = x.branch_id),
    'tenure', (select jsonb_agg(jsonb_build_object('band', band, 'count', c) order by ord) from
                 (select case when yrs < 1 then '< 1 yr' when yrs < 3 then '1–3 yrs' when yrs < 5 then '3–5 yrs' else '5+ yrs' end band,
                         case when yrs < 1 then 1 when yrs < 3 then 2 when yrs < 5 then 3 else 4 end ord, count(*) c
                  from (select (current_date - joining_date) / 365.25 yrs from employees where tenant_id = v_tenant and status <> 'exited') t group by 1, 2) x),
    'leave_by_type', (select jsonb_agg(jsonb_build_object('type', t.name, 'color', t.color, 'days', coalesce(x.d, 0))) from leave_types t
                        left join (select leave_type_id, sum(days) d from leave_requests where tenant_id = v_tenant and status = 'approved'
                                   and start_date > current_date - make_interval(months => p_months) group by 1) x on x.leave_type_id = t.id
                        where t.tenant_id = v_tenant),
    'absenteeism_pct', (select round(100.0 * count(*) filter (where status in ('absent', 'missing_punch')) / greatest(count(*), 1), 1)
                        from attendance_records where tenant_id = v_tenant and work_date > current_date - 90),
    'late_pct', (select round(100.0 * count(*) filter (where status = 'late') / greatest(count(*) filter (where clock_in_at is not null), 1), 1)
                 from attendance_records where tenant_id = v_tenant and work_date > current_date - 90),
    'hiring_funnel', (select jsonb_agg(jsonb_build_object('stage', s, 'count', (select count(*) from candidates c where c.tenant_id = v_tenant and c.stage = s)) order by o)
                      from unnest(array['applied','screening','assessment','interview','offer','hired']) with ordinality u(s, o)),
    'source_of_hire', (select jsonb_agg(jsonb_build_object('source', source, 'count', c)) from
                         (select source, count(*) c from candidates where tenant_id = v_tenant and stage = 'hired' group by 1) x),
    'exit_reasons', (select jsonb_agg(jsonb_build_object('reason', r, 'count', c)) from
                       (select coalesce(exit_interview->>'reason', separation_type) r, count(*) c from separations where tenant_id = v_tenant group by 1) x),
    'performance_distribution', (select jsonb_agg(jsonb_build_object('rating', final_rating, 'count', c) order by final_rating) from
                                   (select final_rating, count(*) c from performance_reviews where tenant_id = v_tenant and final_rating is not null group by 1) x),
    'training_completion_pct', (select round(100.0 * count(*) filter (where status = 'completed') / greatest(count(*), 1), 1) from course_enrollments where tenant_id = v_tenant),
    'payroll_cost_by_department', case when public.can_view_pay() then
                                  (select jsonb_agg(jsonb_build_object('department', coalesce(d.name, 'Unassigned'), 'monthly_gross', x.g) order by x.g desc) from
                                     (select e.department_id, sum(c.gross_salary) g from current_compensation c join employees e on e.id = c.employee_id
                                      where e.tenant_id = v_tenant and e.status <> 'exited' group by 1) x left join departments d on d.id = x.department_id) end,
    -- Explainable flight-risk signal (brief M12/M13): rules, not a black box
    'flight_risk', case when public.is_hr_lead() then
                   (select coalesce(jsonb_agg(jsonb_build_object('employee_id', id, 'name', full_name, 'score', score, 'reasons', reasons) order by score desc), '[]') from (
                      select e.id, e.full_name,
                        (case when lr.final_rating <= 2 then 25 else 0 end
                         + case when (select count(*) from attendance_records a where a.employee_id = e.id and a.status = 'late' and a.work_date > current_date - 60) >= 6 then 20 else 0 end
                         + case when (select max(effective_from) from employee_compensation c where c.employee_id = e.id) < current_date - 540 then 25 else 0 end
                         + case when (select count(*) from leave_requests l where l.employee_id = e.id and l.status = 'approved' and l.days <= 1 and l.start_date > current_date - 60) >= 3 then 15 else 0 end
                         + case when (current_date - e.joining_date) between 300 and 800 then 15 else 0 end) score,
                        array_remove(array[
                          case when lr.final_rating <= 2 then 'Low last rating' end,
                          case when (select count(*) from attendance_records a where a.employee_id = e.id and a.status = 'late' and a.work_date > current_date - 60) >= 6 then 'Frequent late arrivals' end,
                          case when (select max(effective_from) from employee_compensation c where c.employee_id = e.id) < current_date - 540 then 'No raise in 18 months' end,
                          case when (select count(*) from leave_requests l where l.employee_id = e.id and l.status = 'approved' and l.days <= 1 and l.start_date > current_date - 60) >= 3 then 'Many single-day leaves' end,
                          case when (current_date - e.joining_date) between 300 and 800 then 'At 1–2 year tenure mark' end], null) reasons
                      from employees e
                      left join lateral (select final_rating from performance_reviews r where r.employee_id = e.id and r.final_rating is not null order by r.created_at desc limit 1) lr on true
                      where e.tenant_id = v_tenant and e.status in ('active', 'probation')) x where score >= 40) end
  ) into v;
  return v;
end $$;

-- ── Platform super admin (brief §2 role 1) ─────────────────────────────────
create or replace function public.platform_tenants() returns table (
  id uuid, name text, slug text, plan text, status text, seat_limit int, members bigint, employees bigint, created_at timestamptz, trial_ends_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.slug, t.plan, t.status, t.seat_limit,
         (select count(*) from memberships m where m.tenant_id = t.id and m.status = 'active'),
         (select count(*) from employees e where e.tenant_id = t.id and e.status <> 'exited'),
         t.created_at, t.trial_ends_at
  from tenants t where public.is_platform_admin() order by t.created_at desc
$$;

create or replace function public.platform_update_tenant(p_tenant uuid, p_plan text default null, p_status text default null, p_seat_limit int default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require(public.is_platform_admin(), 'Platform administrators only');
  update tenants set plan = coalesce(p_plan, plan), status = coalesce(p_status, status), seat_limit = coalesce(p_seat_limit, seat_limit) where id = p_tenant;
  insert into audit_log (tenant_id, actor_id, action, entity, entity_id, after_data)
  values (p_tenant, auth.uid(), 'platform_update', 'tenants', p_tenant::text, jsonb_build_object('plan', p_plan, 'status', p_status, 'seat_limit', p_seat_limit));
end $$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null) returns void
language sql security definer set search_path = public as $$
  update notifications set read_at = now() where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids))
$$;

-- >>> 20261025000011_row_level_security.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- HCM Master Suite · 0011 · Row-level security (brief §2, §21)
-- ───────────────────────────────────────────────────────────────────────────
-- Rules of thumb used below
--   • Every row is limited to the caller's active company (tenant).
--   • "sees_employee": self, their manager chain, HR staff (inside their
--     branch/department scope) and auditors.
--   • Salary data: only the employee and pay roles (can_view_pay).
--   • Status changes and approvals happen only through the workflow
--     functions in 0008–0010; tables allow direct writes only where safe.
--   • Auditors are read-only everywhere.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.sees_employee(p_employee uuid) returns boolean
language sql stable as $$
  select public.is_self(p_employee)
      or (public.is_hr_staff() and public.in_my_scope(p_employee))
      or public.is_auditor()
      or public.is_my_report(p_employee)
$$;

create or replace function public.in_tenant(p_tenant uuid) returns boolean
language sql stable as $$ select p_tenant is not null and p_tenant = public.current_tenant_id() $$;

-- ── Enable RLS everywhere (SECURITY DEFINER functions run as the owner and bypass it) ──
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Base privileges: nothing for anonymous visitors; signed-in users go through RLS.
revoke all on all tables in schema public from anon, public;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Drop any earlier policies so this file can be re-run
do $$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- ═══ Platform ═══════════════════════════════════════════════════════════════
create policy tenants_read on public.tenants for select to authenticated
  using (public.is_platform_admin() or exists (select 1 from public.memberships m where m.tenant_id = tenants.id and m.user_id = auth.uid()));
create policy tenants_update on public.tenants for update to authenticated
  using (public.in_tenant(id) and public.is_tenant_admin()) with check (public.in_tenant(id) and public.is_tenant_admin());
revoke insert, delete on public.tenants from authenticated;
revoke update on public.tenants from authenticated;
grant update (name, country, currency, timezone, week_start, logo_url, brand_color) on public.tenants to authenticated;

create policy profiles_read on public.profiles for select to authenticated using (id = auth.uid() or public.is_platform_admin());
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke insert, delete, update on public.profiles from authenticated;
grant update (full_name, avatar_url, phone, theme, locale) on public.profiles to authenticated;

create policy custom_roles_read on public.custom_roles for select to authenticated using (public.in_tenant(tenant_id));
create policy custom_roles_write on public.custom_roles for all to authenticated
  using (public.in_tenant(tenant_id) and public.is_tenant_admin()) with check (public.in_tenant(tenant_id) and public.is_tenant_admin());

create policy memberships_read on public.memberships for select to authenticated
  using (user_id = auth.uid() or (public.in_tenant(tenant_id) and (public.is_hr_lead() or public.is_auditor())));
revoke insert, update, delete on public.memberships from authenticated;

create policy invites_read on public.user_invites for select to authenticated using (public.in_tenant(tenant_id) and public.is_hr_lead());
create policy invites_revoke on public.user_invites for update to authenticated
  using (public.in_tenant(tenant_id) and public.is_hr_lead()) with check (public.in_tenant(tenant_id) and status in ('pending', 'revoked'));
revoke insert, delete on public.user_invites from authenticated;

create policy notifications_own on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated using (user_id = auth.uid());
revoke insert on public.notifications from authenticated;

create policy audit_read on public.audit_log for select to authenticated
  using (public.is_platform_admin() or (public.in_tenant(tenant_id) and (public.is_tenant_admin() or public.is_auditor() or public.has_role(array['hr_director']::public.app_role[]))));
revoke insert, update, delete on public.audit_log from authenticated;

-- ═══ Organization (everyone reads, HR leadership writes) ════════════════════
do $$
declare t text;
begin
  foreach t in array array['legal_entities','branches','departments','grades','shifts','holidays','leave_types','review_cycles']
  loop
    execute format('create policy %1$s_read on public.%1$I for select to authenticated using (public.in_tenant(tenant_id))', t);
    execute format('create policy %1$s_write on public.%1$I for all to authenticated using (public.in_tenant(tenant_id) and public.is_hr_lead()) with check (public.in_tenant(tenant_id) and public.is_hr_lead())', t);
  end loop;
end $$;
-- HR executives also maintain the holiday calendar and shifts
create policy holidays_hr_exec on public.holidays for all to authenticated
  using (public.in_tenant(tenant_id) and public.is_hr_staff()) with check (public.in_tenant(tenant_id) and public.is_hr_staff());
create policy shifts_hr_exec on public.shifts for all to authenticated
  using (public.in_tenant(tenant_id) and public.is_hr_staff()) with check (public.in_tenant(tenant_id) and public.is_hr_staff());

create policy cost_centers_read on public.cost_centers for select to authenticated
  using (public.in_tenant(tenant_id) and (public.is_hr_staff() or public.is_finance() or public.can_view_pay()));
create policy cost_centers_write on public.cost_centers for all to authenticated
  using (public.in_tenant(tenant_id) and (public.is_finance() or public.is_hr_lead())) with check (public.in_tenant(tenant_id) and (public.is_finance() or public.is_hr_lead()));

-- ═══ Core HR ════════════════════════════════════════════════════════════════
-- Directory fields are visible to everyone in the company (brief: employee directory, org chart).
create policy employees_read on public.employees for select to authenticated using (public.in_tenant(tenant_id));
create policy employees_insert on public.employees for insert to authenticated
  with check (public.in_tenant(tenant_id) and public.is_hr_staff());
create policy employees_update on public.employees for update to authenticated
  using (public.in_tenant(tenant_id) and public.is_hr_staff() and public.in_my_scope(id)) with check (public.in_tenant(tenant_id));
create policy employees_delete on public.employees for delete to authenticated
  using (public.in_tenant(tenant_id) and public.is_hr_lead());

create policy private_read on public.employee_private for select to authenticated
  using (public.in_tenant(tenant_id) and (public.is_self(employee_id) or (public.is_hr_staff() and public.in_my_scope(employee_id))
                                          or public.can_view_pay()));
create policy private_insert on public.employee_private for insert to authenticated
  with check (public.in_tenant(tenant_id) and public.is_hr_staff());
create policy private_update on public.employee_private for update to authenticated
  using (public.in_tenant(tenant_id) and (public.is_self(employee_id) or (public.is_hr_staff() and public.in_my_scope(employee_id))))
  with check (public.in_tenant(tenant_id));

-- Employees may edit their own contact details, but not identity or bank data.
create or replace function public.guard_private_self_edit() returns trigger
language plpgsql as $$
begin
  if public.is_self(new.employee_id) and not public.is_hr_staff() then
    if new.cnic is distinct from old.cnic or new.bank_account_no is distinct from old.bank_account_no
       or new.bank_name is distinct from old.bank_name or new.date_of_birth is distinct from old.date_of_birth then
      raise exception 'CNIC, date of birth and bank details are changed by HR. Raise a helpdesk ticket';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_private on public.employee_private;
create trigger guard_private before update on public.employee_private for each row execute function public.guard_private_self_edit();

create policy comp_read on public.employee_compensation for select to authenticated
  using (public.in_tenant(tenant_id) and (public.is_self(employee_id) or public.can_view_pay()));
create policy comp_insert on public.employee_compensation for insert to authenticated
  with check (public.in_tenant(tenant_id) and public.has_role(array['company_owner','company_admin','hr_director','hr_manager','payroll_officer']::public.app_role[]));
revoke update on public.employee_compensation from authenticated;
create policy comp_delete on public.employee_compensation for delete to authenticated
  using (public.in_tenant(tenant_id) and public.is_hr_lead() and effective_from > current_date);

create policy history_read on public.employee_job_history for select to authenticated
  using (public.in_tenant(tenant_id) and public.sees_employee(employee_id)
         and (event_type <> 'salary_revision' or public.is_self(employee_id) or public.can_view_pay()));
create policy history_insert on public.employee_job_history for insert to authenticated
  with check (public.in_tenant(tenant_id) and public.is_hr_staff() and event_type <> 'salary_revision');
revoke update, delete on public.employee_job_history from authenticated;

create policy documents_read on public.employee_documents for select to authenticated
  using (public.in_tenant(tenant_id) and (public.is_self(employee_id) or (public.is_hr_staff() and public.in_my_scope(employee_id)) or public.is_auditor()));
create policy documents_insert on public.employee_documents for insert to authenticated
  with check (public.in_tenant(tenant_id) and (public.is_self(employee_id) or public.is_hr_staff()) and (public.is_hr_staff() or not is_verified));
create policy documents_update on public.employee_documents for update to authenticated
  using (public.in_tenant(tenant_id) and public.is_hr_staff()) with check (public.in_tenant(tenant_id));
create policy documents_delete on public.employee_documents for delete to authenticated
  using (public.in_tenant(tenant_id) and (public.is_hr_staff() or (public.is_self(employee_id) and not is_verified)));

create policy assets_read on public.assets for select to authenticated
  using (public.in_tenant(tenant_id) and (public.is_hr_staff() or public.is_auditor() or public.is_finance() or public.is_self(assigned_to)));
create policy assets_write on public.assets for all to authenticated
  using (public.in_tenant(tenant_id) and public.is_hr_staff()) with check (public.in_tenant(tenant_id) and public.is_hr_staff());

create policy templates_read on public.letter_templates for select to authenticated using (public.in_tenant(tenant_id) and (public.is_hr_staff() or public.is_auditor()));
create policy templates_write on public.letter_templates for all to authenticated
  using (public.in_tenant(tenant_id) and public.is_hr_lead()) with check (public.in_tenant(tenant_id) and public.is_hr_lead());

create policy letters_read on public.issued_letters for select to authenticated
  using (public.in_tenant(tenant_id) and (public.is_self(employee_id) or public.is_hr_staff() or public.is_auditor()));
revoke insert, update, delete on public.issued_letters from authenticated;

-- ═══ Time and attendance ════════════════════════════════════════════════════
create policy attendance_read on public.attendance_records for select to authenticated
  using (public.in_tenant(tenant_id) and (public.sees_employee(employee_id) or public.can_run_payroll()));
create policy attendance_hr_write on public.attendance_records for all to authenticated
  using (public.in_tenant(tenant_id) and public.is_hr_staff() and public.in_my_scope(employee_id))
  with check (public.in_tenant(tenant_id) and public.is_hr_staff());

create policy roster_read on public.roster_entries for select to authenticated
  using (public.in_tenant(tenant_id) and public.sees_employee(employee_id));
create policy roster_write on public.roster_entries for all to authenticated
  using (public.in_tenant(tenant_id) and (public.is_hr_staff() or public.is_my_report(employee_id)))
  with check (public.in_tenant(tenant_id) and (public.is_hr_staff() or public.is_my_report(employee_id)));

do $$
declare t text;
begin
  foreach t in array array['regularization_requests','overtime_requests']
  loop
    execute format('create policy %1$s_read on public.%1$I for select to authenticated using (public.in_tenant(tenant_id) and (public.sees_employee(employee_id) or public.can_run_payroll()))', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check (public.in_tenant(tenant_id) and status = ''pending'' and decided_by is null and (public.is_self(employee_id) or public.is_hr_staff()))', t);
    execute format('create policy %1$s_cancel on public.%1$I for update to authenticated using (public.in_tenant(tenant_id) and public.is_self(employee_id) and status = ''pending'') with check (status in (''pending'', ''cancelled'') and decided_by is null)', t);
  end loop;
end $$;

-- ═══ Leave ══════════════════════════════════════════════════════════════════
create policy allocations_read on public.leave_allocations for select to authenticated
  using (public.in_tenant(tenant_id) and public.sees_employee(employee_id));
create policy allocations_write on public.leave_allocations for all to authenticated
  using (public.in_tenant(tenant_id) and public.is_hr_staff()) with check (public.in_tenant(tenant_id) and public.is_hr_staff());

create policy leave_read on public.leave_requests for select to authenticated
  using (public.in_tenant(tenant_id) and (public.sees_employee(employee_id) or public.can_run_payroll()));
revoke insert, update, delete on public.leave_requests from authenticated;   -- apply_leave / decide_leave / cancel_leave

-- ═══ Payroll and money ══════════════════════════════════════════════════════
create policy payroll_settings_read on public.payroll_settings for select to authenticated using (public.in_tenant(tenant_id) and public.can_view_pay());
create policy payroll_settings_write on public.payroll_settings for update to authenticated
  using (public.in_tenant(tenant_id) and (public.is_tenant_admin() or public.has_role(array['hr_director','payroll_officer']::public.app_role[])))
  with check (public.in_tenant(tenant_id));
revoke insert, delete on public.payroll_settings from authenticated;

create policy tax_slabs_read on public.tax_slabs for select to authenticated using (public.in_tenant(tenant_id) and public.can_view_pay());
create policy tax_slabs_write on public.tax_slabs for all to authenticated
  using (public.in_tenant(tenant_id) and public.can_run_payroll()) with check (public.in_tenant(tenant_id) and public.can_run_payroll());

create policy adjustments_read on public.payroll_adjustments for select to authenticated
  using (public.in_tenant(tenant_id) and (public.can_view_pay() or public.is_self(employee_id)));
create policy adjustments_write on public.payroll_adjustments for all to authenticated
  using (public.in_tenant(tenant_id) and public.can_run_payroll()
         and not exists (select 1 from public.payroll_runs r where r.tenant_id = payroll_adjustments.tenant_id and r.period = payroll_adjustments.period and r.status = 'finalized'))
  with check (public.in_tenant(tenant_id) and public.can_run_payroll()
         and not exists (select 1 from public.payroll_runs r where r.tenant_id = payroll_adjustments.tenant_id and r.period = payroll_adjustments.period and r.status = 'finalized'));

create policy runs_read on public.payroll_runs for select to authenticated using (public.in_tenant(tenant_id) and public.can_view_pay());
revoke insert, update, delete on public.payroll_runs from authenticated;

create policy payslips_read on public.payslips for select to authenticated
  using (public.in_tenant(tenant_id) and ((public.is_self(employee_id) and is_published) or public.can_view_pay()));
revoke insert, update, delete on public.payslips from authenticated;

create policy expense_policies_read on public.expense_policies for select to authenticated using (public.in_tenant(tenant_id));
create policy expense_policies_write on public.expense_policies for all to authenticated
  using (public.in_tenant(tenant_id) and (public.is_finance() or public.is_hr_lead())) with check (public.in_tenant(tenant_id) and (public.is_finance() or public.is_hr_lead()));

create policy expenses_read on public.expense_claims for select to authenticated
  using (public.in_tenant(tenant_id) and (public.sees_employee(employee_id) or public.is_finance() or public.can_run_payroll()));
create policy expenses_insert on public.expense_claims for insert to authenticated
  with check (public.in_tenant(tenant_id) and public.is_self(employee_id) and status = 'pending' and decided_by is null and reimbursed_run_id is null);
create policy expenses_cancel on public.expense_claims for update to authenticated
  using (public.in_tenant(tenant_id) and public.is_self(employee_id) and status = 'pending')
  with check (status in ('pending', 'cancelled') and decided_by is null and reimbursed_run_id is null);
create policy expenses_delete on public.expense_claims for delete to authenticated
  using (public.in_tenant(tenant_id) and public.is_self(employee_id) and status in ('pending', 'cancelled'));

create policy travel_read on public.travel_requests for select to authenticated
  using (public.in_tenant(tenant_id) and (public.sees_employee(employee_id) or public.is_finance()));
create policy travel_insert on public.travel_requests for insert to authenticated
  with check (public.in_tenant(tenant_id) and public.is_self(employee_id) and status = 'pending' and decided_by is null);
create policy travel_cancel on public.travel_requests for update to authenticated
  using (public.in_tenant(tenant_id) and public.is_self(employee_id) and status = 'pending') with check (status in ('pending', 'cancelled') and decided_by is null);

create policy loans_read on public.loans for select to authenticated
  using (public.in_tenant(tenant_id) and (public.is_self(employee_id) or public.can_view_pay() or public.is_hr_lead()));
revoke insert, update, delete on public.loans from authenticated;   -- request_loan / decide_loan

create policy loan_recoveries_read on public.loan_recoveries for select to authenticated
  using (public.in_tenant(tenant_id) and (public.can_view_pay() or exists (select 1 from public.loans l where l.id = loan_id and public.is_self(l.employee_id))));
revoke insert, update, delete on public.loan_recoveries from authenticated;

-- ═══ Recruitment ════════════════════════════════════════════════════════════
create policy requisitions_read on public.job_requisitions for select to authenticated
  using (public.in_tenant(tenant_id) and (public.is_recruiting() or public.is_auditor() or created_by = auth.uid()
                                          or public.is_self(hiring_manager_id) or status = 'open'));
create policy requisitions_insert on public.job_requisitions for insert to authenticated
  with check (public.in_tenant(tenant_id) and status in ('draft', 'pending_approval') and approved_by is null
              and (public.is_recruiting() or public.has_role(array['hiring_manager','line_manager']::public.app_role[])));
create policy requisitions_update on public.job_requisitions for update to authenticated
  using (public.in_tenant(tenant_id) and (public.is_recruiting() or (created_by = auth.uid() and status in ('draft', 'pending_approval'))))
  with check (public.in_tenant(tenant_id));
create policy requisitions_delete on public.job_requisitions for delete to authenticated
  using (public.in_tenant(tenant_id) and (public.is_hr_lead() or (created_by = auth.uid() and status = 'draft')));
revoke update on public.job_requisitions from authenticated;
grant update (title, department_id, branch_id, grade_id, positions, employment_type, hiring_manager_id, budget_monthly, description, requirements, is_public)
  on public.job_requisitions to authenticated;

create or replace function public.set_requisition_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from job_requisitions where id = p_id and tenant_id = public.current_tenant_id();
  perform public.require(r.id is not null, 'Requisition not found');
  perform public.require(p_status in ('draft', 'pending_approval', 'open', 'on_hold', 'filled', 'closed'), 'Unknown status');
  perform public.require(public.is_recruiting() or (r.created_by = auth.uid() and p_status in ('draft', 'pending_approval')), 'You cannot change this requisition');
  perform public.require(p_status <> 'open' or r.approved_by is not null, 'A requisition must be approved before it opens');
  update job_requisitions set status = p_status where id = p_id;
end $$;

-- Helpers avoid policy recursion between candidates and interviews
create or replace function public.is_hiring_manager_for(p_requisition uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from job_requisitions r where r.id = p_requisition and r.hiring_manager_id = public.current_employee_id())
$$;
create or replace function public.is_interviewer_for(p_candidate uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from interviews i where i.candidate_id = p_candidate and i.interviewer_id = public.current_employee_id())
$$;
create or replace function public.is_hiring_manager_for_candidate(p_candidate uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from candidates c join job_requisitions r on r.id = c.requisition_id
                 where c.id = p_candidate and r.hiring_manager_id = public.current_employee_id())
$$;

create policy candidates_read on public.candidates for select to authenticated
  using (public.in_tenant(tenant_id) and (public.is_recruiting() or public.is_auditor()
         or public.is_hiring_manager_for(requisition_id) or public.is_interviewer_for(id)));
create policy candidates_insert on public.candidates for insert to authenticated
  with check (public.in_tenant(tenant_id) and public.is_recruiting() and stage not in ('hired') and offer_status = 'none');
create policy candidates_update on public.candidates for update to authenticated
  using (public.in_tenant(tenant_id) and public.is_recruiting()) with check (public.in_tenant(tenant_id));
create policy candidates_delete on public.candidates for delete to authenticated
  using (public.in_tenant(tenant_id) and public.is_hr_lead());
revoke update on public.candidates from authenticated;
grant update (full_name, email, phone, current_company, experience_years, expected_salary, source, referred_by, cv_path, summary)
  on public.candidates to authenticated;

create policy interviews_read on public.interviews for select to authenticated
  using (public.in_tenant(tenant_id) and (public.is_recruiting() or public.is_self(interviewer_id) or public.is_auditor()
         or public.is_hiring_manager_for_candidate(candidate_id)));
create policy interviews_insert on public.interviews for insert to authenticated
  with check (public.in_tenant(tenant_id) and public.is_recruiting());
create policy interviews_update on public.interviews for update to authenticated
  using (public.in_tenant(tenant_id) and (public.is_recruiting() or public.is_self(interviewer_id))) with check (public.in_tenant(tenant_id));
create policy interviews_delete on public.interviews for delete to authenticated
  using (public.in_tenant(tenant_id) and public.is_recruiting());

-- Candidate portal: a signed-in applicant sees their own applications (no tenant membership needed).
create or replace function public.my_applications() returns table (id uuid, company text, job_title text, stage text, applied_at timestamptz,
  next_interview timestamptz, offer_status text)
language sql stable security definer set search_path = public as $$
  select c.id, t.name, r.title, c.stage, c.created_at,
         (select min(i.scheduled_at) from interviews i where i.candidate_id = c.id and i.status = 'scheduled' and i.scheduled_at > now()),
         case when c.offer_status in ('sent', 'accepted', 'declined') then c.offer_status end
  from candidates c join job_requisitions r on r.id = c.requisition_id join tenants t on t.id = c.tenant_id
  where c.user_id = auth.uid() or lower(c.email) = lower((select email from auth.users where id = auth.uid()))
  order by c.created_at desc
$$;

-- ═══ Lifecycle ══════════════════════════════════════════════════════════════
create policy checklists_read on public.lifecycle_checklists for select to authenticated
  using (public.in_tenant(tenant_id) and (public.sees_employee(employee_id) or public.is_finance()));
create policy checklists_hr on public.lifecycle_checklists for update to authenticated
  using (public.in_tenant(tenant_id) and public.is_hr_staff()) with check (public.in_tenant(tenant_id));
revoke insert, delete on public.lifecycle_checklists from authenticated;

create policy tasks_read on public.checklist_tasks for select to authenticated
  using (public.in_tenant(tenant_id) and exists (select 1 from public.lifecycle_checklists l where l.id = checklist_id
         and (public.sees_employee(l.employee_id) or public.is_finance())));
create policy tasks_hr_write on public.checklist_tasks for insert to authenticated
  with check (public.in_tenant(tenant_id) and public.is_hr_staff() and not is_done);
create policy tasks_hr_delete on public.checklist_tasks for delete to authenticated
  using (public.in_tenant(tenant_id) and public.is_hr_staff());
revoke update on public.checklist_tasks from authenticated;   -- set_checklist_task

create policy separations_read on public.separations for select to authenticated
  using (public.in_tenant(tenant_id) and public.sees_employee(employee_id));
create policy separations_hr on public.separations for update to authenticated
  using (public.in_tenant(tenant_id) and public.is_hr_staff()) with check (public.in_tenant(tenant_id));
revoke insert, delete on public.separations from authenticated;   -- start_separation

create policy settlements_read on public.final_settlements for select to authenticated
  using (public.in_tenant(tenant_id) and (public.is_self(employee_id) or public.can_view_pay() or public.is_hr_lead()));
revoke insert, update, delete on public.final_settlements from authenticated;

-- ═══ Performance ════════════════════════════════════════════════════════════
create policy goals_read on public.goals for select to authenticated
  using (public.in_tenant(tenant_id) and (level <> 'individual' or public.sees_employee(employee_id)));
create policy goals_insert on public.goals for insert to authenticated
  with check (public.in_tenant(tenant_id) and (
    (level = 'individual' and (public.is_self(employee_id) or public.is_my_report(employee_id) or public.is_hr_staff()))
    or (level <> 'individual' and (public.is_hr_lead() or public.has_role(array['line_manager']::public.app_role[])))));
create policy goals_update on public.goals for update to authenticated
  using (public.in_tenant(tenant_id) and (
    (level = 'individual' and (public.is_self(employee_id) or public.is_my_report(employee_id) or public.is_hr_staff()))
    or (level <> 'individual' and (public.is_hr_lead() or created_by = auth.uid()))))
  with check (public.in_tenant(tenant_id));
create policy goals_delete on public.goals for delete to authenticated
  using (public.in_tenant(tenant_id) and (created_by = auth.uid() or public.is_hr_lead()));

create policy reviews_read on public.performance_reviews for select to authenticated
  using (public.in_tenant(tenant_id) and (public.is_self(employee_id) or public.is_my_report(employee_id) or public.is_hr_lead() or public.is_auditor()));
revoke insert, update, delete on public.performance_reviews from authenticated;   -- launch_review_cycle / submit_review

create policy feedback_read on public.feedback for select to authenticated
  using (public.in_tenant(tenant_id) and (public.is_self(from_employee_id) or public.is_self(to_employee_id)
         or public.is_my_report(to_employee_id) or public.is_hr_lead() or not is_private));
create policy feedback_insert on public.feedback for insert to authenticated
  with check (public.in_tenant(tenant_id) and public.is_self(from_employee_id) and from_employee_id <> to_employee_id);
create policy feedback_delete on public.feedback for delete to authenticated
  using (public.in_tenant(tenant_id) and (public.is_self(from_employee_id) or public.is_hr_lead()));

-- ═══ Learning ═══════════════════════════════════════════════════════════════
create policy courses_read on public.courses for select to authenticated using (public.in_tenant(tenant_id) and (is_published or public.is_hr_staff()));
create policy courses_write on public.courses for all to authenticated
  using (public.in_tenant(tenant_id) and public.is_hr_staff()) with check (public.in_tenant(tenant_id) and public.is_hr_staff());

create policy enrollments_read on public.course_enrollments for select to authenticated
  using (public.in_tenant(tenant_id) and public.sees_employee(employee_id));
create policy enrollments_self_enroll on public.course_enrollments for insert to authenticated
  with check (public.in_tenant(tenant_id) and (public.is_self(employee_id) or public.is_hr_staff()) and status = 'assigned' and progress = 0);
create policy enrollments_delete on public.course_enrollments for delete to authenticated
  using (public.in_tenant(tenant_id) and public.is_hr_staff());
revoke update on public.course_enrollments from authenticated;

create policy certs_read on public.certifications for select to authenticated using (public.in_tenant(tenant_id) and public.sees_employee(employee_id));
create policy certs_write on public.certifications for all to authenticated
  using (public.in_tenant(tenant_id) and (public.is_self(employee_id) or public.is_hr_staff()))
  with check (public.in_tenant(tenant_id) and (public.is_self(employee_id) or public.is_hr_staff()));

-- ═══ Engagement ═════════════════════════════════════════════════════════════
create policy announcements_read on public.announcements for select to authenticated
  using (public.in_tenant(tenant_id) and ((published_at is not null and published_at <= now()) or public.is_hr_staff()));
create policy announcements_write on public.announcements for all to authenticated
  using (public.in_tenant(tenant_id) and public.is_hr_staff()) with check (public.in_tenant(tenant_id) and public.is_hr_staff());

create policy acks_read on public.announcement_acks for select to authenticated
  using (public.in_tenant(tenant_id) and (public.is_self(employee_id) or public.is_hr_staff()));
create policy acks_insert on public.announcement_acks for insert to authenticated
  with check (public.in_tenant(tenant_id) and public.is_self(employee_id));
revoke update, delete on public.announcement_acks from authenticated;

create policy kudos_read on public.kudos for select to authenticated using (public.in_tenant(tenant_id));
create policy kudos_insert on public.kudos for insert to authenticated with check (public.in_tenant(tenant_id) and public.is_self(from_employee_id));
create policy kudos_delete on public.kudos for delete to authenticated using (public.in_tenant(tenant_id) and (public.is_self(from_employee_id) or public.is_hr_staff()));
revoke update on public.kudos from authenticated;

create policy surveys_read on public.surveys for select to authenticated using (public.in_tenant(tenant_id) and (status <> 'draft' or public.is_hr_lead()));
create policy surveys_write on public.surveys for all to authenticated
  using (public.in_tenant(tenant_id) and public.is_hr_lead()) with check (public.in_tenant(tenant_id) and public.is_hr_lead());
revoke select, insert, update, delete on public.survey_responses from authenticated;   -- submit_survey / survey_results only

-- ═══ Helpdesk and knowledge base ════════════════════════════════════════════
create policy kb_read on public.kb_articles for select to authenticated using (public.in_tenant(tenant_id) and (is_published or public.is_hr_staff()));
create policy kb_write on public.kb_articles for all to authenticated
  using (public.in_tenant(tenant_id) and public.is_hr_staff()) with check (public.in_tenant(tenant_id) and public.is_hr_staff());

create or replace function public.sees_ticket(p_ticket uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from hr_tickets t where t.id = p_ticket and t.tenant_id = public.current_tenant_id() and (
    public.is_self(t.employee_id) or public.is_self(t.assigned_to) or public.is_hr_staff() or public.is_auditor()
    or (t.category = 'payroll' and public.can_run_payroll())))
$$;

create policy tickets_read on public.hr_tickets for select to authenticated
  using (public.in_tenant(tenant_id) and (public.is_self(employee_id) or public.is_self(assigned_to) or public.is_hr_staff() or public.is_auditor()
         or (category = 'payroll' and public.can_run_payroll())));
create policy tickets_insert on public.hr_tickets for insert to authenticated
  with check (public.in_tenant(tenant_id) and (public.is_self(employee_id) or public.is_hr_staff()) and status = 'open');
create policy tickets_update on public.hr_tickets for update to authenticated
  using (public.in_tenant(tenant_id) and (public.is_hr_staff() or public.is_self(assigned_to) or (category = 'payroll' and public.can_run_payroll())))
  with check (public.in_tenant(tenant_id));

create or replace function public.rate_ticket(p_ticket uuid, p_rating int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require(p_rating between 1 and 5, 'Rating must be 1 to 5');
  update hr_tickets set satisfaction = p_rating, status = 'closed'
  where id = p_ticket and public.is_self(employee_id) and status = 'resolved';
  perform public.require(found, 'You can rate your own resolved tickets');
end $$;

-- Ticket resolution timestamps and SLA by priority
create or replace function public.ticket_defaults() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.sla_due_at := now() + case new.priority when 'urgent' then interval '4 hours' when 'high' then interval '8 hours'
                                                when 'low' then interval '72 hours' else interval '24 hours' end;
  elsif new.status in ('resolved', 'closed') and old.status not in ('resolved', 'closed') then
    new.resolved_at := now();
  end if;
  return new;
end $$;
drop trigger if exists ticket_defaults on public.hr_tickets;
create trigger ticket_defaults before insert or update on public.hr_tickets for each row execute function public.ticket_defaults();

create policy comments_read on public.ticket_comments for select to authenticated
  using (public.in_tenant(tenant_id) and public.sees_ticket(ticket_id) and (not is_internal or public.is_hr_staff() or public.can_run_payroll()));
create policy comments_insert on public.ticket_comments for insert to authenticated
  with check (public.in_tenant(tenant_id) and public.sees_ticket(ticket_id) and author_id = auth.uid()
              and (not is_internal or public.is_hr_staff() or public.can_run_payroll()));
revoke update, delete on public.ticket_comments from authenticated;

create policy ai_logs_read on public.ai_logs for select to authenticated
  using (public.in_tenant(tenant_id) and (user_id = auth.uid() or public.is_tenant_admin() or public.is_auditor()));
create policy ai_logs_insert on public.ai_logs for insert to authenticated with check (public.in_tenant(tenant_id) and user_id = auth.uid());
create policy ai_logs_feedback on public.ai_logs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════════
-- Function privileges
-- ═══════════════════════════════════════════════════════════════════════════
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;

-- Internal helpers that must not be called directly from the browser
revoke execute on function public.leave_balances(uuid, integer) from authenticated;
revoke execute on function public.notify_user(uuid, text, text, text) from authenticated;
revoke execute on function public.notify_roles(public.app_role[], text, text, text) from authenticated;
revoke execute on function public.hcm_attach_triggers(regclass, boolean) from authenticated;
revoke execute on function public.annual_income_tax(uuid, text, numeric) from authenticated;
revoke execute on function public.employee_user(uuid) from authenticated;
revoke execute on function public.manager_user(uuid) from authenticated;
revoke execute on function public.handle_new_user() from authenticated;
revoke execute on function public.write_audit() from authenticated;

-- Public endpoints (careers page, letter verification)
grant execute on function public.careers_jobs(text) to anon;
grant execute on function public.apply_for_job(uuid, text, text, text, numeric, text, text, numeric) to anon;
grant execute on function public.verify_letter(text) to anon;
grant execute on function public.candidate_match(text, text) to anon;
grant execute on function public.require(boolean, text) to anon;

-- >>> 20261025000012_storage.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- HCM Master Suite · 0012 · File storage
-- ───────────────────────────────────────────────────────────────────────────
-- Buckets
--   hr-documents  private  {tenant_id}/{employee_id}/{file}  CNIC, contracts, leave proofs
--   receipts      private  {tenant_id}/{employee_id}/{file}  expense receipts
--   cvs           private  {tenant_id}/{requisition_id}/{file} candidate CVs (public upload)
--   avatars       public   {tenant_id}/{employee_id}.{ext}   profile photos and company logos
-- ═══════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit)
values ('hr-documents', 'hr-documents', false, 10485760),
       ('receipts', 'receipts', false, 5242880),
       ('cvs', 'cvs', false, 5242880),
       ('avatars', 'avatars', true, 2097152)
on conflict (id) do nothing;

create or replace function public.storage_employee_ok(p_name text, p_write boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select (storage.foldername(p_name))[1] = public.current_tenant_id()::text
     and (
       public.is_hr_staff()
       or public.is_self(nullif((storage.foldername(p_name))[2], '')::uuid)
       or (not p_write and (public.is_auditor() or public.can_view_pay()))
     )
$$;
grant execute on function public.storage_employee_ok(text, boolean) to authenticated;

drop policy if exists hcm_docs_read on storage.objects;
drop policy if exists hcm_docs_write on storage.objects;
drop policy if exists hcm_docs_delete on storage.objects;
drop policy if exists hcm_cvs_upload on storage.objects;
drop policy if exists hcm_cvs_read on storage.objects;
drop policy if exists hcm_avatars_read on storage.objects;
drop policy if exists hcm_avatars_write on storage.objects;

create policy hcm_docs_read on storage.objects for select to authenticated
  using (bucket_id in ('hr-documents', 'receipts') and public.storage_employee_ok(name, false));
create policy hcm_docs_write on storage.objects for insert to authenticated
  with check (bucket_id in ('hr-documents', 'receipts') and public.storage_employee_ok(name, true));
create policy hcm_docs_delete on storage.objects for delete to authenticated
  using (bucket_id in ('hr-documents', 'receipts') and (storage.foldername(name))[1] = public.current_tenant_id()::text and public.is_hr_staff());

-- Applicants upload CVs from the public careers page (only into an open job's folder).
create or replace function public.job_accepts_cv(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from job_requisitions r where r.status = 'open' and r.is_public
                 and r.tenant_id::text = (storage.foldername(p_name))[1] and r.id::text = (storage.foldername(p_name))[2])
$$;
grant execute on function public.job_accepts_cv(text) to anon, authenticated;

create policy hcm_cvs_upload on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'cvs' and public.job_accepts_cv(name));
create policy hcm_cvs_read on storage.objects for select to authenticated
  using (bucket_id = 'cvs' and (storage.foldername(name))[1] = public.current_tenant_id()::text and public.is_recruiting());

create policy hcm_avatars_read on storage.objects for select using (bucket_id = 'avatars');
create policy hcm_avatars_write on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = public.current_tenant_id()::text);

-- Tell the Supabase API (PostgREST) to load the new tables and functions right away.
notify pgrst, 'reload schema';

-- >>> 20261025000013_attendance_gps_face.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- HCM Master Suite · 0013 · Attendance rules, GPS geofence and Face ID
-- (brief M4: GPS geofence, selfie, face recognition, every punch stores source,
--  device, location, accuracy and confidence)
-- ───────────────────────────────────────────────────────────────────────────
-- • attendance_settings      company defaults (one row per company)
-- • employee_attendance_rules per-employee rule assigned by HR
--     mode office  → must be inside one of the allowed locations' geofence
--     mode field   → GPS required, any location (sales, drivers, technicians)
--     mode remote  → no location needed (work from home)
-- • face_enrollments         128-number face descriptor per employee (HR-only)
-- • clock_attempts           every punch attempt, including rejected ones
-- Face matching happens on the server: the browser sends the descriptor it
-- computed from the live camera and clock_in() compares it with the enrolled
-- one. Employees cannot read enrolled descriptors.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.attendance_settings (
  tenant_id            uuid primary key references public.tenants(id) on delete cascade,
  default_mode         text not null default 'office' check (default_mode in ('office', 'field', 'remote')),
  require_selfie       boolean not null default false,
  require_face         boolean not null default false,
  face_threshold       numeric(4,3) not null default 0.50 check (face_threshold between 0.30 and 0.80),  -- lower = stricter
  max_gps_accuracy_m   integer not null default 150 check (max_gps_accuracy_m between 20 and 2000),
  allow_self_enrollment boolean not null default true,
  geofence_on_clock_out boolean not null default false,          -- true = block clock-out outside geofence; false = only flag it
  updated_at           timestamptz not null default now()
);

create table if not exists public.employee_attendance_rules (
  employee_id        uuid primary key references public.employees(id) on delete cascade,
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  mode               text not null default 'office' check (mode in ('office', 'field', 'remote')),
  allowed_branch_ids uuid[] not null default '{}',               -- empty = employee's own branch
  require_selfie     boolean,                                    -- null = company default
  require_face       boolean,                                    -- null = company default
  notes              text,
  updated_by         uuid default auth.uid(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.face_enrollments (
  employee_id  uuid primary key references public.employees(id) on delete cascade,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  descriptor   double precision[] not null check (array_length(descriptor, 1) = 128),
  samples      integer not null default 1,
  photo_path   text,
  model        text not null default 'face-api-1.7/tiny+68+recognition',
  enrolled_by  uuid default auth.uid(),
  enrolled_at  timestamptz not null default now()
);

create table if not exists public.clock_attempts (
  id           bigint generated always as identity primary key,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  employee_id  uuid not null references public.employees(id) on delete cascade,
  kind         text not null check (kind in ('in', 'out')),
  ok           boolean not null,
  reason       text,
  latitude     double precision,
  longitude    double precision,
  accuracy_m   double precision,
  distance_m   integer,
  branch_id    uuid references public.branches(id) on delete set null,
  face_score   numeric(5,3),
  photo_path   text,
  user_agent   text,
  created_at   timestamptz not null default now()
);
create index if not exists clock_attempts_idx on public.clock_attempts (tenant_id, created_at desc);

alter table public.attendance_records add column if not exists clock_in_branch_id uuid references public.branches(id) on delete set null;
alter table public.attendance_records add column if not exists clock_in_photo_path text;
alter table public.attendance_records add column if not exists clock_in_face_score numeric(5,3);
alter table public.attendance_records add column if not exists clock_out_photo_path text;
alter table public.attendance_records add column if not exists clock_out_face_score numeric(5,3);
alter table public.attendance_records add column if not exists clock_out_distance_m integer;
alter table public.attendance_records add column if not exists clock_out_accuracy_m double precision;
alter table public.attendance_records add column if not exists work_mode text;

select public.hcm_attach_triggers('public.employee_attendance_rules');
select public.hcm_attach_triggers('public.face_enrollments');
select public.hcm_attach_triggers('public.clock_attempts', false);
drop trigger if exists touch_updated on public.attendance_settings;
create trigger touch_updated before update on public.attendance_settings for each row execute function public.touch_updated_at();
drop trigger if exists set_tenant on public.attendance_settings;
create trigger set_tenant before insert on public.attendance_settings for each row execute function public.set_tenant_id();
drop trigger if exists audit on public.attendance_settings;
create trigger audit after insert or update or delete on public.attendance_settings for each row execute function public.write_audit();

-- Every existing company gets default settings
insert into public.attendance_settings (tenant_id) select id from public.tenants on conflict do nothing;

-- New companies get them too
create or replace function public.seed_attendance_settings() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into attendance_settings (tenant_id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists seed_attendance_settings on public.tenants;
create trigger seed_attendance_settings after insert on public.tenants for each row execute function public.seed_attendance_settings();

-- ── Helpers ────────────────────────────────────────────────────────────────
create or replace function public.face_distance(a double precision[], b double precision[]) returns double precision
language sql immutable as $$
  select case when a is null or b is null or array_length(a, 1) is distinct from array_length(b, 1) then null
    else sqrt((select sum(power(x.v - y.v, 2)) from unnest(a) with ordinality x(v, i) join unnest(b) with ordinality y(v, i) using (i))) end
$$;

-- Effective rule for an employee (employee rule over company default).
create or replace function public.effective_attendance_rule(p_employee uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'mode', coalesce(r.mode, s.default_mode, 'office'),
    'require_selfie', coalesce(r.require_selfie, s.require_selfie, false) or coalesce(r.require_face, s.require_face, false),
    'require_face', coalesce(r.require_face, s.require_face, false),
    'branch_ids', case when coalesce(array_length(r.allowed_branch_ids, 1), 0) > 0 then to_jsonb(r.allowed_branch_ids)
                       when e.branch_id is not null then jsonb_build_array(e.branch_id) else '[]'::jsonb end,
    'face_threshold', coalesce(s.face_threshold, 0.5),
    'max_gps_accuracy_m', coalesce(s.max_gps_accuracy_m, 150),
    'geofence_on_clock_out', coalesce(s.geofence_on_clock_out, false),
    'allow_self_enrollment', coalesce(s.allow_self_enrollment, true))
  from employees e
  left join employee_attendance_rules r on r.employee_id = e.id
  left join attendance_settings s on s.tenant_id = e.tenant_id
  where e.id = p_employee
$$;

-- What the signed-in employee needs to know before clocking in.
create or replace function public.my_attendance_rules() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.current_employee_id() is null then null else
    public.effective_attendance_rule(public.current_employee_id()) || jsonb_build_object(
      'face_enrolled', exists (select 1 from face_enrollments f where f.employee_id = public.current_employee_id()),
      'locations', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'latitude', b.latitude, 'longitude', b.longitude, 'radius_m', b.geofence_radius_m))
                             from branches b
                             where b.id::text in (select jsonb_array_elements_text(public.effective_attendance_rule(public.current_employee_id())->'branch_ids'))), '[]'::jsonb))
  end
$$;

-- Assign rules to many employees at once (HR).
create or replace function public.set_attendance_rules(p_employees uuid[], p_mode text, p_branch_ids uuid[] default '{}',
                                                       p_require_selfie boolean default null, p_require_face boolean default null, p_notes text default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.require(public.is_hr_staff(), 'Only HR can assign attendance rules');
  perform public.require(p_mode in ('office', 'field', 'remote'), 'Mode must be office, field or remote');
  perform public.require(coalesce(array_length(p_employees, 1), 0) > 0, 'Select at least one employee');
  perform public.require(not exists (select 1 from unnest(coalesce(p_branch_ids, '{}')) b(id) where not exists (select 1 from branches x where x.id = b.id and x.tenant_id = public.current_tenant_id())),
                         'One of the locations does not belong to this company');
  insert into employee_attendance_rules (employee_id, tenant_id, mode, allowed_branch_ids, require_selfie, require_face, notes, updated_by)
  select e.id, e.tenant_id, p_mode, coalesce(p_branch_ids, '{}'), p_require_selfie, p_require_face, p_notes, auth.uid()
  from employees e where e.id = any (p_employees) and e.tenant_id = public.current_tenant_id() and public.in_my_scope(e.id)
  on conflict (employee_id) do update set mode = excluded.mode, allowed_branch_ids = excluded.allowed_branch_ids, require_selfie = excluded.require_selfie,
    require_face = excluded.require_face, notes = excluded.notes, updated_by = excluded.updated_by;
  get diagnostics n = row_count;
  return n;
end $$;

-- Face enrollment: the employee (first time, if allowed) or HR (any time).
create or replace function public.enroll_face(p_employee uuid, p_descriptor double precision[], p_photo_path text default null, p_samples int default 1)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e record; rule jsonb; v_existing boolean;
begin
  select * into e from employees where id = p_employee and tenant_id = public.current_tenant_id();
  perform public.require(e.id is not null, 'Employee not found');
  perform public.require(array_length(p_descriptor, 1) = 128, 'Face data is incomplete. Try again in better light');
  v_existing := exists (select 1 from face_enrollments where employee_id = p_employee);
  rule := public.effective_attendance_rule(p_employee);
  perform public.require(public.is_hr_staff() or (public.is_self(p_employee) and not v_existing and (rule->>'allow_self_enrollment')::boolean),
                         case when v_existing then 'Face ID is already set up. Ask HR to reset it' else 'Ask HR to set up your Face ID' end);
  insert into face_enrollments (employee_id, tenant_id, descriptor, photo_path, samples, enrolled_by)
  values (p_employee, e.tenant_id, p_descriptor, p_photo_path, p_samples, auth.uid())
  on conflict (employee_id) do update set descriptor = excluded.descriptor, photo_path = excluded.photo_path, samples = excluded.samples,
    enrolled_by = excluded.enrolled_by, enrolled_at = now();
  return jsonb_build_object('ok', true, 'employee', e.full_name);
end $$;

create or replace function public.reset_face(p_employee uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require(public.is_hr_staff(), 'Only HR can reset Face ID');
  delete from face_enrollments where employee_id = p_employee and tenant_id = public.current_tenant_id();
end $$;

-- Face ID status for many employees (HR screens) without exposing descriptors.
create or replace function public.face_status() returns table (employee_id uuid, enrolled_at timestamptz, photo_path text)
language sql stable security definer set search_path = public as $$
  select f.employee_id, f.enrolled_at, f.photo_path from face_enrollments f
  where f.tenant_id = public.current_tenant_id() and (public.is_hr_staff() or public.is_auditor())
$$;

-- ── Location + face checks shared by clock in and clock out ────────────────
create or replace function public.check_punch(p_employee uuid, p_kind text, p_lat double precision, p_lng double precision, p_accuracy double precision,
                                              p_descriptor double precision[], p_photo_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  rule jsonb := public.effective_attendance_rule(p_employee);
  v_mode text := rule->>'mode';
  b record;
  v_best_id uuid; v_best_name text; v_best_dist int; v_best_radius int; v_best_over double precision;
  v_dist double precision; v_score double precision; v_enrolled double precision[];
  v_flags text[] := '{}';
  v_strict boolean := p_kind = 'in' or (rule->>'geofence_on_clock_out')::boolean;
begin
  -- Location
  if v_mode in ('office', 'field') then
    if p_lat is null or p_lng is null then
      return jsonb_build_object('ok', false, 'reason', 'Location is required. Allow location access in your browser and try again');
    end if;
    if coalesce(p_accuracy, 0) > (rule->>'max_gps_accuracy_m')::int then
      if v_strict and v_mode = 'office' then
        return jsonb_build_object('ok', false, 'reason', format('GPS signal is weak (±%s m). Move near a window or outdoors and try again', round(p_accuracy)));
      end if;
      v_flags := array_append(v_flags, 'low_accuracy');
    end if;
  end if;

  if v_mode = 'office' then
    for b in select x.id, x.name, x.latitude, x.longitude, x.geofence_radius_m from branches x
             where x.id::text in (select jsonb_array_elements_text(rule->'branch_ids')) and x.latitude is not null and x.longitude is not null
    loop
      v_dist := public.distance_m(b.latitude, b.longitude, p_lat, p_lng);
      if v_best_id is null or v_dist - b.geofence_radius_m < v_best_over then
        v_best_id := b.id; v_best_name := b.name; v_best_dist := round(v_dist)::int; v_best_radius := b.geofence_radius_m; v_best_over := v_dist - b.geofence_radius_m;
      end if;
    end loop;
    if v_best_id is null then
      v_flags := array_append(v_flags, 'no_geofence');     -- no location has coordinates yet: allow, but flag for HR
    elsif v_best_dist > v_best_radius + least(coalesce(p_accuracy, 0), 100) then
      if v_strict then
        return jsonb_build_object('ok', false, 'reason', format('You are %s m from %s. You must be within %s m to clock %s', v_best_dist, v_best_name, v_best_radius, p_kind),
                                  'distance_m', v_best_dist, 'branch_id', v_best_id);
      end if;
      v_flags := array_append(v_flags, 'outside_geofence');
    end if;
  elsif v_mode = 'field' then
    v_flags := array_append(v_flags, 'field');
  else
    v_flags := array_append(v_flags, 'remote');
  end if;

  -- Selfie and face
  if (rule->>'require_face')::boolean then
    select descriptor into v_enrolled from face_enrollments where employee_id = p_employee;
    if v_enrolled is null then
      return jsonb_build_object('ok', false, 'reason', 'Face ID is not set up yet. Open Attendance and tap “Set up Face ID”', 'needs_enrollment', true);
    end if;
  end if;
  if (rule->>'require_selfie')::boolean and p_photo_path is null then
    return jsonb_build_object('ok', false, 'reason', 'A live selfie is required to clock ' || p_kind);
  end if;
  if (rule->>'require_face')::boolean then
    if p_descriptor is null or array_length(p_descriptor, 1) is distinct from 128 then
      return jsonb_build_object('ok', false, 'reason', 'Face scan is required to clock ' || p_kind);
    end if;
    v_score := public.face_distance(v_enrolled, p_descriptor);
    if v_score > (rule->>'face_threshold')::numeric then
      return jsonb_build_object('ok', false, 'reason', 'Face did not match. Remove glasses or mask, face the light and try again', 'face_score', round(v_score::numeric, 3));
    end if;
  end if;

  return jsonb_build_object('ok', true, 'mode', v_mode, 'flags', v_flags, 'distance_m', v_best_dist, 'branch_id', v_best_id, 'branch', v_best_name,
                            'face_score', round(v_score::numeric, 3));
end $$;

-- Replace the earlier clock functions (new parameters)
drop function if exists public.clock_in(double precision, double precision, double precision, text);
drop function if exists public.clock_out(double precision, double precision);

create or replace function public.clock_in(p_lat double precision default null, p_lng double precision default null,
                                           p_accuracy double precision default null, p_source text default 'web',
                                           p_face_descriptor double precision[] default null, p_photo_path text default null,
                                           p_user_agent text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.current_employee_id();
  e record; s record; chk jsonb;
  v_local timestamp := public.tenant_now();
  v_date date; v_late int := 0; v_status text := 'present'; v_id uuid;
begin
  perform public.require(v_emp is not null, 'Your user is not linked to an employee record. Ask HR to link it');
  select * into e from employees where id = v_emp;
  perform public.require(e.status not in ('exited', 'suspended'), 'Your employment is not active');
  v_date := v_local::date;
  select * into s from shifts where id = public.employee_shift_for(v_emp, v_date);
  if s.id is not null and s.is_night and v_local::time < s.end_time then v_date := v_date - 1; end if;
  perform public.require(not exists (select 1 from attendance_records where employee_id = v_emp and work_date = v_date and clock_in_at is not null),
                         'You have already clocked in today');

  chk := public.check_punch(v_emp, 'in', p_lat, p_lng, p_accuracy, p_face_descriptor, p_photo_path);
  insert into clock_attempts (tenant_id, employee_id, kind, ok, reason, latitude, longitude, accuracy_m, distance_m, branch_id, face_score, photo_path, user_agent)
  values (e.tenant_id, v_emp, 'in', (chk->>'ok')::boolean, chk->>'reason', p_lat, p_lng, p_accuracy, (chk->>'distance_m')::int,
          (chk->>'branch_id')::uuid, (chk->>'face_score')::numeric, p_photo_path, left(p_user_agent, 300));
  if not (chk->>'ok')::boolean then return chk; end if;

  if s.id is not null then
    v_late := greatest(0, floor(extract(epoch from (v_local - (v_date + s.start_time))) / 60))::int;
    if v_late > s.grace_minutes then v_status := 'late'; else v_late := 0; end if;
  end if;

  insert into attendance_records (tenant_id, employee_id, work_date, shift_id, clock_in_at, clock_in_lat, clock_in_lng, clock_in_accuracy_m,
                                  clock_in_distance_m, clock_in_branch_id, clock_in_photo_path, clock_in_face_score, work_mode, source, status, late_minutes, flags)
  values (e.tenant_id, v_emp, v_date, s.id, now(), p_lat, p_lng, p_accuracy, (chk->>'distance_m')::int, (chk->>'branch_id')::uuid, p_photo_path,
          (chk->>'face_score')::numeric, chk->>'mode', coalesce(p_source, 'web'), v_status, v_late,
          array(select jsonb_array_elements_text(chk->'flags')) || case when p_face_descriptor is not null then '{face_verified}'::text[] else '{}'::text[] end)
  on conflict (employee_id, work_date) do update set
    clock_in_at = excluded.clock_in_at, clock_in_lat = excluded.clock_in_lat, clock_in_lng = excluded.clock_in_lng, clock_in_accuracy_m = excluded.clock_in_accuracy_m,
    clock_in_distance_m = excluded.clock_in_distance_m, clock_in_branch_id = excluded.clock_in_branch_id, clock_in_photo_path = excluded.clock_in_photo_path,
    clock_in_face_score = excluded.clock_in_face_score, work_mode = excluded.work_mode, source = excluded.source, status = excluded.status,
    late_minutes = excluded.late_minutes, flags = excluded.flags, shift_id = excluded.shift_id
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'status', v_status, 'late_minutes', v_late, 'distance_m', (chk->>'distance_m')::int,
                            'branch', chk->>'branch', 'mode', chk->>'mode', 'face_score', (chk->>'face_score')::numeric, 'work_date', v_date);
end $$;

create or replace function public.clock_out(p_lat double precision default null, p_lng double precision default null,
                                            p_accuracy double precision default null, p_face_descriptor double precision[] default null,
                                            p_photo_path text default null, p_user_agent text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.current_employee_id();
  a record; s record; chk jsonb;
  v_local timestamp := public.tenant_now();
  v_worked int; v_shift_minutes int; v_early int := 0; v_ot int := 0; v_status text;
begin
  perform public.require(v_emp is not null, 'Your user is not linked to an employee record');
  select * into a from attendance_records
  where employee_id = v_emp and clock_in_at is not null and clock_out_at is null and clock_in_at > now() - interval '20 hours'
  order by clock_in_at desc limit 1;
  perform public.require(a.id is not null, 'You have not clocked in yet');

  chk := public.check_punch(v_emp, 'out', p_lat, p_lng, p_accuracy, p_face_descriptor, p_photo_path);
  insert into clock_attempts (tenant_id, employee_id, kind, ok, reason, latitude, longitude, accuracy_m, distance_m, branch_id, face_score, photo_path, user_agent)
  values (a.tenant_id, v_emp, 'out', (chk->>'ok')::boolean, chk->>'reason', p_lat, p_lng, p_accuracy, (chk->>'distance_m')::int,
          (chk->>'branch_id')::uuid, (chk->>'face_score')::numeric, p_photo_path, left(p_user_agent, 300));
  if not (chk->>'ok')::boolean then return chk; end if;

  select * into s from shifts where id = a.shift_id;
  v_worked := floor(extract(epoch from (now() - a.clock_in_at)) / 60)::int;
  v_status := a.status;
  if s.id is not null then
    v_worked := greatest(0, v_worked - case when v_worked > 300 then s.break_minutes else 0 end);
    v_shift_minutes := (extract(epoch from (s.end_time - s.start_time)) / 60)::int;
    if v_shift_minutes <= 0 then v_shift_minutes := v_shift_minutes + 1440; end if;
    v_shift_minutes := v_shift_minutes - s.break_minutes;
    v_early := greatest(0, floor(extract(epoch from (((a.work_date + s.start_time) + make_interval(mins => v_shift_minutes + s.break_minutes)) - v_local)) / 60))::int;
    if v_worked - v_shift_minutes >= 30 then v_ot := v_worked - v_shift_minutes; end if;
    if v_worked < s.half_day_minutes then v_status := 'half_day'; end if;
  end if;

  update attendance_records set clock_out_at = now(), clock_out_lat = p_lat, clock_out_lng = p_lng, clock_out_accuracy_m = p_accuracy,
    clock_out_distance_m = (chk->>'distance_m')::int, clock_out_photo_path = p_photo_path, clock_out_face_score = (chk->>'face_score')::numeric,
    worked_minutes = v_worked, early_leave_minutes = v_early, overtime_minutes = v_ot, status = v_status,
    flags = array(select distinct unnest(flags || array(select 'out_' || x from jsonb_array_elements_text(chk->'flags') x where x in ('outside_geofence', 'low_accuracy'))))
  where id = a.id;
  return jsonb_build_object('ok', true, 'worked_minutes', v_worked, 'overtime_minutes', v_ot, 'early_leave_minutes', v_early, 'status', v_status);
end $$;

-- ── Row-level security ─────────────────────────────────────────────────────
alter table public.attendance_settings enable row level security;
alter table public.employee_attendance_rules enable row level security;
alter table public.face_enrollments enable row level security;
alter table public.clock_attempts enable row level security;

drop policy if exists att_settings_read on public.attendance_settings;
drop policy if exists att_settings_write on public.attendance_settings;
create policy att_settings_read on public.attendance_settings for select to authenticated using (public.in_tenant(tenant_id));
create policy att_settings_write on public.attendance_settings for update to authenticated
  using (public.in_tenant(tenant_id) and public.is_hr_lead()) with check (public.in_tenant(tenant_id));

drop policy if exists att_rules_read on public.employee_attendance_rules;
create policy att_rules_read on public.employee_attendance_rules for select to authenticated
  using (public.in_tenant(tenant_id) and (public.is_self(employee_id) or public.is_hr_staff() or public.is_my_report(employee_id) or public.is_auditor()));

drop policy if exists attempts_read on public.clock_attempts;
create policy attempts_read on public.clock_attempts for select to authenticated
  using (public.in_tenant(tenant_id) and (public.is_self(employee_id) or public.is_hr_staff() or public.is_my_report(employee_id) or public.is_auditor()));

-- Descriptors are never readable through the API; status comes from face_status() / my_attendance_rules().
revoke all on public.face_enrollments from anon, authenticated;
revoke all on public.employee_attendance_rules, public.clock_attempts from anon;
revoke insert, update, delete on public.employee_attendance_rules, public.clock_attempts from authenticated;
revoke insert, delete on public.attendance_settings from anon, authenticated;
grant select on public.employee_attendance_rules, public.clock_attempts, public.attendance_settings to authenticated;
grant update on public.attendance_settings to authenticated;

revoke execute on function public.face_distance(double precision[], double precision[]) from public, anon;
revoke execute on function public.effective_attendance_rule(uuid) from public, anon, authenticated;
revoke execute on function public.check_punch(uuid, text, double precision, double precision, double precision, double precision[], text) from public, anon, authenticated;
revoke execute on function public.seed_attendance_settings() from public, anon, authenticated;
revoke execute on function public.my_attendance_rules() from public, anon;
revoke execute on function public.set_attendance_rules(uuid[], text, uuid[], boolean, boolean, text) from public, anon;
revoke execute on function public.enroll_face(uuid, double precision[], text, int) from public, anon;
revoke execute on function public.reset_face(uuid) from public, anon;
revoke execute on function public.face_status() from public, anon;
revoke execute on function public.clock_in(double precision, double precision, double precision, text, double precision[], text, text) from public, anon;
revoke execute on function public.clock_out(double precision, double precision, double precision, double precision[], text, text) from public, anon;
grant execute on function public.my_attendance_rules(), public.set_attendance_rules(uuid[], text, uuid[], boolean, boolean, text),
  public.enroll_face(uuid, double precision[], text, int), public.reset_face(uuid), public.face_status(),
  public.clock_in(double precision, double precision, double precision, text, double precision[], text, text),
  public.clock_out(double precision, double precision, double precision, double precision[], text, text) to authenticated;

-- ── Selfie storage: {tenant}/{employee}/{file} ─────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit) values ('attendance-selfies', 'attendance-selfies', false, 2097152) on conflict (id) do nothing;
drop policy if exists hcm_selfies_insert on storage.objects;
drop policy if exists hcm_selfies_read on storage.objects;
create policy hcm_selfies_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'attendance-selfies' and (storage.foldername(name))[1] = public.current_tenant_id()::text
              and ((storage.foldername(name))[2] = public.current_employee_id()::text or public.is_hr_staff()));
create policy hcm_selfies_read on storage.objects for select to authenticated
  using (bucket_id = 'attendance-selfies' and (storage.foldername(name))[1] = public.current_tenant_id()::text
         and ((storage.foldername(name))[2] = public.current_employee_id()::text or public.is_hr_staff() or public.is_auditor()
              or public.is_my_report(nullif((storage.foldername(name))[2], '')::uuid)));

notify pgrst, 'reload schema';
