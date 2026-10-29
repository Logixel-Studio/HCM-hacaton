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

-- ── Auto-link sign-in accounts to employee records by email ───────────────
-- A user invited from "Users & roles" without an employee gets linked as soon as HR adds an
-- employee with the same work email (and the other way round), so attendance and Face ID apply.
create or replace function public.link_member_by_email(p_tenant uuid, p_employee uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if p_email is null then return; end if;
  select m.user_id into v_user from memberships m join auth.users u on u.id = m.user_id
  where m.tenant_id = p_tenant and m.employee_id is null and lower(u.email) = lower(trim(p_email))
    and not exists (select 1 from employees e where e.tenant_id = p_tenant and e.user_id = m.user_id)
  limit 1;
  if v_user is null then return; end if;
  update memberships set employee_id = p_employee where tenant_id = p_tenant and user_id = v_user and employee_id is null;
  update employees set user_id = v_user where id = p_employee and user_id is null;
end $$;

create or replace function public.employees_autolink() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is null and new.work_email is not null then
    perform public.link_member_by_email(new.tenant_id, new.id, new.work_email);
  end if;
  return null;
end $$;
drop trigger if exists employees_autolink on public.employees;
create trigger employees_autolink after insert or update of work_email on public.employees
  for each row execute function public.employees_autolink();

create or replace function public.memberships_autolink() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_emp uuid;
begin
  if new.employee_id is null then
    select e.id into v_emp from employees e join auth.users u on lower(u.email) = lower(e.work_email)
    where u.id = new.user_id and e.tenant_id = new.tenant_id and e.user_id is null limit 1;
    if v_emp is not null then
      update memberships set employee_id = v_emp where id = new.id;
      update employees set user_id = new.user_id where id = v_emp;
    end if;
  end if;
  return null;
end $$;
drop trigger if exists memberships_autolink on public.memberships;
create trigger memberships_autolink after insert on public.memberships
  for each row execute function public.memberships_autolink();

revoke execute on function public.link_member_by_email(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.employees_autolink() from public, anon, authenticated;
revoke execute on function public.memberships_autolink() from public, anon, authenticated;

-- Link existing ones once (for companies that invited users before adding their employee records).
do $$ declare r record; begin
  for r in select id, tenant_id, work_email from employees where user_id is null and work_email is not null loop
    perform public.link_member_by_email(r.tenant_id, r.id, r.work_email);
  end loop;
end $$;

notify pgrst, 'reload schema';
