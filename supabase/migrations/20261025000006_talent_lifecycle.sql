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
