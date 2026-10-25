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
