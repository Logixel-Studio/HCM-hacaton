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
