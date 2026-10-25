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
