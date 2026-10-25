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
