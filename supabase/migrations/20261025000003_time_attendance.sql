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
