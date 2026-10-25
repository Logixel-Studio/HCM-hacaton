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
