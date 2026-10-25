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
