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
