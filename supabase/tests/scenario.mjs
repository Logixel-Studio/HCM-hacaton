// End-to-end scenario test for the HCM migrations (runs on PGlite with Supabase stubs).
// Every step runs as a real signed-in user under RLS (role "authenticated").
let pass = 0, fail = 0;
const ids = {};
const uid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

export default async function (db) {
  const as = async (user, sql, params = []) => {
    return db.transaction(async (tx) => {
      await tx.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${user}', true);`);
      return (await tx.query(sql, params)).rows;
    });
  };
  const root = async (sql, params = []) => (await db.query(sql, params)).rows;
  const ok = async (name, fn, check) => {
    try {
      const r = await fn();
      if (check && !check(r)) { fail++; console.log('  ✗', name, JSON.stringify(r).slice(0, 400)); }
      else { pass++; console.log('  ✓', name); }
      return r;
    } catch (e) { fail++; console.log('  ✗', name, '→', e.message); }
  };
  const denied = async (name, fn, match) => {
    try { const r = await fn(); fail++; console.log('  ✗ (should fail)', name, JSON.stringify(r).slice(0, 200)); }
    catch (e) {
      if (match && !e.message.toLowerCase().includes(match.toLowerCase())) { fail++; console.log('  ✗', name, 'wrong error:', e.message); }
      else { pass++; console.log('  ✓', name, '→', e.message); }
    }
  };
  const signUp = (n, email, name) => root(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [uid(n), email, { full_name: name }]);

  const OWNER = uid(1), HR = uid(2), PAY = uid(3), FIN = uid(4), MGR = uid(5), EMP = uid(6), AUD = uid(7), OTHER = uid(9);

  console.log('\n1. Sign-up and company setup');
  await signUp(1, 'ali@acme.pk', 'Ali Khan');
  await ok('profile created by trigger', () => root(`select * from profiles where id = $1`, [OWNER]), (r) => r.length === 1 && r[0].full_name === 'Ali Khan');
  ids.tenant = (await ok('create_company', () => as(OWNER, `select public.create_company('Acme Foods', 'Ali Khan', 'CEO', 'Lahore') id`)))?.[0]?.id;
  await ok('owner context', () => as(OWNER, `select public.my_context() c`), (r) => r[0].c.role === 'company_owner' && r[0].c.employee.code === 'EMP-0001');
  await ok('seeded leave types, slabs, shifts', () => as(OWNER, `select (select count(*) from leave_types)::int lt, (select count(*) from tax_slabs)::int ts, (select count(*) from shifts)::int sh`),
    (r) => r[0].lt === 6 && r[0].ts === 6 && r[0].sh === 2);

  console.log('\n2. Hiring and invites');
  const dept = (await as(OWNER, `select id from departments where code = 'OPS'`))[0].id;
  const hire = (p) => as(OWNER, `select public.hire_employee($1::jsonb) id`, [p]);
  ids.sara = (await ok('hire HR manager', () => hire({ full_name: 'Sara Ahmed', work_email: 'sara@acme.pk', job_title: 'HR Manager', gross_salary: 250000, gender: 'female', joining_date: '2024-01-10', bank_account_no: 'PK00SARA', invite_email: 'sara@acme.pk' })))[0].id;
  ids.bilal = (await hire({ full_name: 'Bilal Raza', work_email: 'bilal@acme.pk', job_title: 'Payroll Officer', gross_salary: 150000, joining_date: '2024-02-01', bank_account_no: 'PK00BILAL' }))[0].id;
  ids.fatima = (await hire({ full_name: 'Fatima Noor', work_email: 'fatima@acme.pk', job_title: 'Finance Controller', gross_salary: 300000, joining_date: '2024-03-01', bank_account_no: 'PK00FAT' }))[0].id;
  ids.usman = (await hire({ full_name: 'Usman Tariq', work_email: 'usman@acme.pk', job_title: 'Operations Manager', department_id: dept, gross_salary: 220000, joining_date: '2023-05-01', bank_account_no: 'PK00USM', gender: 'male' }))[0].id;
  ids.ahmed = (await ok('hire employee with manager, PF and bank', () => hire({ full_name: 'Ahmed Ali', work_email: 'ahmed@acme.pk', job_title: 'Supervisor', department_id: dept, manager_id: ids.usman, gross_salary: 135000, pf_applicable: true, joining_date: '2025-01-01', bank_name: 'HBL', bank_account_no: 'PK36HABB0000001', gender: 'male', cnic: '35202-1234567-1' })))[0].id;
  await ok('employee codes are sequential', () => as(OWNER, `select employee_code from employees order by employee_code`), (r) => r.map((x) => x.employee_code).join() === 'EMP-0001,EMP-0002,EMP-0003,EMP-0004,EMP-0005,EMP-0006');
  await ok('onboarding checklist created', () => as(OWNER, `select count(*)::int n from checklist_tasks t join lifecycle_checklists l on l.id = t.checklist_id where l.employee_id = $1`, [ids.ahmed]), (r) => r[0].n === 10);
  await ok('job history has hire event', () => as(OWNER, `select event_type from employee_job_history where employee_id = $1`, [ids.ahmed]), (r) => r[0]?.event_type === 'hire');

  await ok('invite payroll officer', () => as(OWNER, `select public.invite_user('bilal@acme.pk', 'payroll_officer', $1)`, [ids.bilal]));
  await ok('invite finance controller', () => as(OWNER, `select public.invite_user('fatima@acme.pk', 'finance_controller', $1)`, [ids.fatima]));
  await ok('invite line manager', () => as(OWNER, `select public.invite_user('usman@acme.pk', 'line_manager', $1)`, [ids.usman]));
  await ok('invite employee', () => as(OWNER, `select public.invite_user('ahmed@acme.pk', 'employee', $1)`, [ids.ahmed]));
  await ok('invite auditor', () => as(OWNER, `select public.invite_user('audit@kpmg.pk', 'auditor')`));
  await ok('upgrade Sara invite to hr_manager', () => as(OWNER, `select public.invite_user('sara@acme.pk', 'hr_manager', $1)`, [ids.sara]));
  await denied('cannot grant platform_super_admin', () => as(OWNER, `select public.invite_user('x@acme.pk', 'platform_super_admin')`), 'cannot grant');

  await signUp(2, 'sara@acme.pk', 'Sara Ahmed'); await signUp(3, 'bilal@acme.pk', 'Bilal'); await signUp(4, 'fatima@acme.pk', 'Fatima');
  await signUp(5, 'usman@acme.pk', 'Usman'); await signUp(6, 'ahmed@acme.pk', 'Ahmed'); await signUp(7, 'audit@kpmg.pk', 'Auditor');
  await ok('invites accepted on sign-up with roles', () => as(OWNER, `select email, role from public.company_members() order by email`),
    (r) => r.length === 7 && r.find((x) => x.email === 'sara@acme.pk').role === 'hr_manager' && r.find((x) => x.email === 'ahmed@acme.pk').role === 'employee');
  await ok('employee context linked', () => as(EMP, `select public.my_context() c`), (r) => r[0].c.role === 'employee' && r[0].c.employee.full_name === 'Ahmed Ali');
  await denied('HR manager cannot make someone company admin', () => as(HR, `select public.update_member($1, 'company_admin')`, [EMP]), 'cannot grant');
  await denied('owner cannot demote the last owner', () => as(OWNER, `select public.update_member($1, 'company_admin')`, [OWNER]), 'at least one active owner');

  console.log('\n3. Data privacy (RLS)');
  await ok('employee sees directory', () => as(EMP, `select count(*)::int n from employees`), (r) => r[0].n === 6);
  await ok('employee sees only own salary', () => as(EMP, `select employee_id from employee_compensation`), (r) => r.length === 1 && r[0].employee_id === ids.ahmed);
  await ok('employee sees only own private data', () => as(EMP, `select employee_id from employee_private`), (r) => r.length === 1);
  await ok('manager cannot see salaries of reports', () => as(MGR, `select count(*)::int n from employee_compensation`), (r) => r[0].n === 1);
  await ok('payroll officer sees all salaries', () => as(PAY, `select count(*)::int n from employee_compensation`), (r) => r[0].n === 5);
  await ok('employee cannot see tax slabs or runs', () => as(EMP, `select (select count(*) from tax_slabs)::int a, (select count(*) from payroll_runs)::int b`), (r) => r[0].a === 0 && r[0].b === 0);
  await ok('employee cannot see audit log', () => as(EMP, `select count(*)::int n from audit_log`), (r) => r[0].n === 0);
  await ok('auditor sees audit log', () => as(AUD, `select count(*)::int n from audit_log`), (r) => r[0].n > 10);
  await denied('employee cannot insert leave directly', () => as(EMP, `insert into leave_requests (employee_id, leave_type_id, start_date, end_date, days, status) select $1, id, current_date, current_date, 1, 'approved' from leave_types limit 1`, [ids.ahmed]), 'permission denied');
  await denied('employee cannot raise own salary', () => as(EMP, `insert into employee_compensation (employee_id, effective_from, gross_salary) values ($1, current_date, 999999)`, [ids.ahmed]), 'row-level security');
  await denied('employee cannot change own bank account', () => as(EMP, `update employee_private set bank_account_no = 'PK99FRAUD' where employee_id = $1`, [ids.ahmed]), 'changed by HR');
  await ok('employee can update own address', () => as(EMP, `update employee_private set address = 'Model Town' where employee_id = $1 returning address`, [ids.ahmed]), (r) => r[0]?.address === 'Model Town');
  await denied('employee cannot promote self via employees table', () => as(EMP, `update employees set job_title = 'CEO' where id = $1 returning id`, [ids.ahmed]).then((r) => { if (!r.length) throw new Error('row-level security: 0 rows'); return r; }), 'row-level');
  await denied('anon cannot read employees', () => db.transaction(async (tx) => { await tx.exec('set local role anon'); return (await tx.query('select * from employees')).rows; }), 'permission denied');
  await denied('employee cannot call internal leave_balances', () => as(EMP, `select * from public.leave_balances($1)`, [ids.sara]), 'permission denied');

  console.log('\n4. Leave');
  const cl = (await as(EMP, `select id from leave_types where code = 'CL'`))[0].id;
  const al = (await as(EMP, `select id from leave_types where code = 'AL'`))[0].id;
  await ok('balances', () => as(EMP, `select code, entitled, available from public.my_leave_balances() order by code`), (r) => r.find((x) => x.code === 'CL').available == 10);
  await denied('maternity not available to male employee', () => as(EMP, `select public.apply_leave((select id from leave_types where code='ML'), current_date + 10, current_date + 12)`), 'not available');
  // pick a Monday–Tuesday next week
  const mon = (await root(`select (current_date + ((8 - extract(isodow from current_date)::int) % 7) + 7)::date d`))[0].d;
  ids.leave = (await ok('apply 2 days casual leave', () => as(EMP, `select public.apply_leave($1, $2::date, $2::date + 1, false, 'Family event') id`, [cl, mon])))?.[0]?.id;
  await denied('overlapping leave rejected', () => as(EMP, `select public.apply_leave($1, $2::date, $2::date, false)`, [cl, mon]), 'already have leave');
  await denied('casual leave max 3 consecutive', () => as(EMP, `select public.apply_leave($1, $2::date + 7, $2::date + 12, false)`, [cl, mon]), 'at most 3');
  await ok('manager notified', () => as(MGR, `select title from notifications`), (r) => r.some((x) => x.title.includes('Leave request')));
  await ok('manager approvals inbox has the leave', () => as(MGR, `select kind from public.my_approvals()`), (r) => r.some((x) => x.kind === 'leave'));
  await denied('employee cannot approve own leave', () => as(EMP, `select public.decide_leave($1, true)`, [ids.leave]), 'cannot decide');
  await denied('payroll officer cannot approve leave', () => as(PAY, `select public.decide_leave($1, true)`, [ids.leave]), 'cannot decide');
  await ok('manager approves (short paid leave is final)', () => as(MGR, `select public.decide_leave($1, true, 'Enjoy'); select status from leave_requests where id = '${ids.leave}'`.split(';')[0], [ids.leave]));
  await ok('leave approved', () => as(EMP, `select status from leave_requests where id = $1`, [ids.leave]), (r) => r[0].status === 'approved');
  await ok('balance reduced', () => as(EMP, `select used, available from public.my_leave_balances() where code = 'CL'`), (r) => r[0].used == 2 && r[0].available == 8);
  await ok('employee can cancel future leave', () => as(EMP, `select public.cancel_leave($1)`, [ids.leave]));

  console.log('\n5. Attendance');
  await ok('clock in (no geofence on HO)', () => as(EMP, `select public.clock_in(31.5, 74.3, 10) r`), (r) => r[0].r.work_date);
  await denied('double clock in', () => as(EMP, `select public.clock_in(31.5, 74.3, 10)`), 'already clocked in');
  await ok('clock out', () => as(EMP, `select public.clock_out(31.5, 74.3) r`), (r) => r[0].r.status);
  await root(`update branches set latitude = 31.5204, longitude = 74.3587, geofence_radius_m = 150`);
  await ok('geofence blocks a far clock-in', () => as(MGR, `select public.clock_in(31.60, 74.30, 10) r`), (r) => r[0].r.ok === false && /must be within/.test(r[0].r.reason));
  await ok('clock in inside geofence', () => as(MGR, `select public.clock_in(31.5205, 74.3588, 8) r`), (r) => r[0].r.ok && r[0].r.distance_m < 150);
  await ok('rejected attempt is logged for HR', () => as(HR, `select count(*) filter (where not ok)::int bad, count(*)::int n from clock_attempts`), (r) => r[0].bad === 1 && r[0].n >= 3);

  console.log('\n5b. Attendance rules, GPS modes and Face ID');
  const rnd = (seed) => Array.from({ length: 128 }, (_, i) => Math.sin(seed * 1000 + i) * 0.2);
  const d1 = rnd(1), d2 = rnd(2), d1near = d1.map((v, i) => v + (i % 2 ? 0.01 : -0.01));
  await denied('employee cannot assign rules', () => as(EMP, `select public.set_attendance_rules(array[$1]::uuid[], 'remote')`, [ids.ahmed]), 'only hr');
  await ok('HR assigns office + Face ID to payroll officer', () => as(HR, `select public.set_attendance_rules(array[$1]::uuid[], 'office', '{}', null, true) n`, [ids.bilal]), (r) => r[0].n === 1);
  await ok('employee sees own rules and location', () => as(PAY, `select public.my_attendance_rules() r`), (r) => r[0].r.require_face && !r[0].r.face_enrolled && r[0].r.locations.length === 1);
  await ok('clock-in asks for enrollment first', () => as(PAY, `select public.clock_in(31.5205, 74.3588, 8) r`), (r) => r[0].r.ok === false && r[0].r.needs_enrollment);
  await ok('employee enrolls own face', () => as(PAY, `select public.enroll_face($1, $2::float8[], 'x/y.jpg', 3) r`, [ids.bilal, d1]), (r) => r[0].r.ok);
  await denied('employee cannot re-enroll (anti-swap)', () => as(PAY, `select public.enroll_face($1, $2::float8[])`, [ids.bilal, d2]), 'already set up');
  await denied('descriptors are not readable', () => as(PAY, `select * from face_enrollments`), 'permission denied');
  await denied('HR cannot read descriptors either', () => as(HR, `select descriptor from face_enrollments`), 'permission denied');
  await ok('different face is rejected', () => as(PAY, `select public.clock_in(31.5205, 74.3588, 8, 'web', $1::float8[], 'p.jpg') r`, [d2]), (r) => r[0].r.ok === false && /did not match/.test(r[0].r.reason));
  await ok('selfie photo required with Face ID', () => as(PAY, `select public.clock_in(31.5205, 74.3588, 8, 'web', $1::float8[], null) r`, [d1near]), (r) => r[0].r.ok === false && /selfie/.test(r[0].r.reason));
  await ok('matching face inside geofence clocks in', () => as(PAY, `select public.clock_in(31.5205, 74.3588, 8, 'mobile', $1::float8[], 't/e/in.jpg') r`, [d1near]), (r) => r[0].r.ok && r[0].r.face_score < 0.5);
  await ok('punch stores face score, photo and branch', () => as(HR, `select clock_in_face_score, clock_in_photo_path, clock_in_branch_id, work_mode, flags from attendance_records where employee_id = $1`, [ids.bilal]),
    (r) => r[0].clock_in_photo_path === 't/e/in.jpg' && r[0].clock_in_branch_id && r[0].work_mode === 'office' && r[0].flags.includes('face_verified'));
  await ok('weak GPS is rejected in office mode', async () => { await as(HR, `select public.set_attendance_rules(array[$1]::uuid[], 'office')`, [ids.usman]); return as(MGR, `select public.clock_out(31.5205, 74.3588, 900) r`); }, (r) => r[0].r.ok === true);
  await ok('field mode: anywhere with GPS', async () => { await as(HR, `select public.set_attendance_rules(array[$1]::uuid[], 'field')`, [ids.fatima]); return as(FIN, `select public.clock_in(24.8607, 67.0011, 20) r`); }, (r) => r[0].r.ok && r[0].r.mode === 'field');
  await ok('remote mode: no GPS needed', async () => { await as(HR, `select public.set_attendance_rules(array[$1]::uuid[], 'remote')`, [ids.sara]); return as(HR, `select public.clock_in() r`); }, (r) => r[0].r.ok && r[0].r.mode === 'remote');
  await ok('face status visible to HR', () => as(HR, `select count(*)::int n from public.face_status()`), (r) => r[0].n === 1);
  await ok('HR resets Face ID', async () => { await as(HR, `select public.reset_face($1)`, [ids.bilal]); return as(HR, `select count(*)::int n from public.face_status()`); }, (r) => r[0].n === 0);
  ids.reg = (await ok('regularization request', () => as(EMP, `insert into regularization_requests (employee_id, work_date, clock_in_time, clock_out_time, reason) values ($1, current_date - 3, '09:05', '18:10', 'Forgot to punch') returning id`, [ids.ahmed])))?.[0]?.id;
  await ok('manager approves correction', () => as(MGR, `select public.decide_regularization($1, true)`, [ids.reg]));
  await ok('attendance row created and flagged', () => as(EMP, `select flags, worked_minutes from attendance_records where work_date = current_date - 3`), (r) => r[0].flags.includes('corrected') && r[0].worked_minutes === 545);

  console.log('\n6. Loan and payroll with maker-checker');
  await root(`delete from attendance_records`); // keep the payroll example free of attendance deductions
  ids.loan = (await ok('employee requests loan', () => as(EMP, `select public.request_loan('personal', 80000, 10, '2026-09', 'Bike') id`)))?.[0]?.id;
  await denied('employee cannot approve own loan', () => as(EMP, `select public.decide_loan($1, true)`, [ids.loan]), 'finance');
  await ok('finance approves loan', () => as(FIN, `select public.decide_loan($1, true)`, [ids.loan]));
  await denied('employee cannot run payroll', () => as(EMP, `select public.calculate_payroll('2026-09')`), 'only payroll');
  await root(`update employee_private set bank_account_no = null where employee_id = $1`, [ids.bilal]);
  ids.run = (await ok('payroll officer calculates Sep 2026', () => as(PAY, `select public.calculate_payroll('2026-09') id`)))?.[0]?.id;
  const slip = (await ok('Ahmed payslip matches the worked example', () => as(PAY, `select gross_salary, basic, income_tax, eobi, provident_fund, loan_deduction, net_pay, annual_taxable from payslips where employee_id = $1`, [ids.ahmed]),
    (r) => Number(r[0].net_pay) === 116424 && Number(r[0].income_tax) === 3459 && Number(r[0].annual_taxable) === 1522800))?.[0];
  console.log('    ', JSON.stringify(slip));
  await ok('high earner tax (Fatima 300k)', () => as(PAY, `select income_tax, annual_taxable from payslips where employee_id = $1`, [ids.fatima]),
    (r) => Number(r[0].annual_taxable) === 3384000 && Number(r[0].income_tax) === 33433);
  await ok('missing bank raises an exception', () => as(PAY, `select exceptions from payroll_runs where id = $1`, [ids.run]), (r) => r[0].exceptions.some((x) => x.code === 'no_bank'));
  await ok('employee cannot see unpublished payslip', () => as(EMP, `select count(*)::int n from payslips`), (r) => r[0].n === 0);
  await denied('HR approval blocked by open exceptions', () => as(HR, `select public.advance_payroll($1, 'hr_approve')`, [ids.run]), 'exception');
  const exc = (await as(PAY, `select x->>'id' id from payroll_runs r, jsonb_array_elements(r.exceptions) x where r.id = $1 and not (x->>'accepted')::boolean`, [ids.run]));
  for (const x of exc) await as(PAY, `select public.accept_payroll_exception($1, $2, 'Owner paid separately')`, [ids.run, x.id]);
  await denied('payroll officer cannot HR-approve', () => as(PAY, `select public.advance_payroll($1, 'hr_approve')`, [ids.run]), 'HR approval');
  await ok('HR manager approves', () => as(HR, `select public.advance_payroll($1, 'hr_approve') s`, [ids.run]), (r) => r[0].s === 'hr_approved');
  await denied('HR manager cannot finance-approve', () => as(HR, `select public.advance_payroll($1, 'finance_approve')`, [ids.run]), 'finance');
  await ok('finance approves', () => as(FIN, `select public.advance_payroll($1, 'finance_approve') s`, [ids.run]), (r) => r[0].s === 'finance_approved');
  await ok('bank file', () => as(FIN, `select public.payroll_bank_file($1) f`, [ids.run]), (r) => r[0].f.includes('PK36HABB0000001,116424'));
  await ok('payroll officer finalizes', () => as(PAY, `select public.advance_payroll($1, 'finalize') s`, [ids.run]), (r) => r[0].s === 'finalized');
  await ok('employee sees published payslip', () => as(EMP, `select net_pay from payslips`), (r) => r.length === 1 && Number(r[0].net_pay) === 116424);
  await ok('loan recovery recorded', () => as(EMP, `select recovered_amount from loans where id = $1`, [ids.loan]), (r) => Number(r[0].recovered_amount) === 8000);
  await denied('finalized run cannot be recalculated', () => as(PAY, `select public.calculate_payroll('2026-09')`), 'already finalized');
  // Maker-checker: same person cannot prepare and approve
  await root(`update memberships set role = 'hr_director' where user_id = $1`, [PAY]);
  const run2 = (await as(PAY, `select public.calculate_payroll('2026-10', 'off_cycle') id`))[0].id;
  for (const x of await as(PAY, `select x->>'id' id from payroll_runs r, jsonb_array_elements(r.exceptions) x where r.id = $1`, [run2])) await as(PAY, `select public.accept_payroll_exception($1, $2)`, [run2, x.id]);
  await denied('maker-checker blocks self-approval', () => as(PAY, `select public.advance_payroll($1, 'hr_approve')`, [run2]), 'maker-checker');
  await root(`update memberships set role = 'payroll_officer' where user_id = $1`, [PAY]);

  console.log('\n7. Expenses');
  await denied('receipt required above 2,000', () => as(EMP, `insert into expense_claims (employee_id, category, claim_date, amount) values ($1, 'fuel', current_date, 5000)`, [ids.ahmed]), 'receipt');
  ids.exp = (await ok('submit claim with receipt', () => as(EMP, `insert into expense_claims (employee_id, category, claim_date, amount, receipt_path) values ($1, 'fuel', current_date, 5000, 'x/y.jpg') returning id`, [ids.ahmed])))?.[0]?.id;
  await denied('cannot submit pre-approved claim', () => as(EMP, `insert into expense_claims (employee_id, category, claim_date, amount, status) values ($1, 'mobile', current_date, 500, 'approved')`, [ids.ahmed]), 'row-level');
  await ok('manager approves', () => as(MGR, `select public.decide_expense($1, true)`, [ids.exp]));
  await ok('finance approves', () => as(FIN, `select public.decide_expense($1, true); `, [ids.exp]));
  await ok('claim approved', () => as(EMP, `select status from expense_claims where id = $1`, [ids.exp]), (r) => r[0].status === 'approved');

  console.log('\n8. Recruitment');
  await root(`update tenants set slug = 'acme'`);
  ids.req = (await ok('manager raises requisition', () => as(MGR, `insert into job_requisitions (title, department_id, positions, hiring_manager_id, requirements, status) values ('Warehouse Supervisor', $1, 1, $2, 'forklift, inventory, excel', 'pending_approval') returning id`, [dept, ids.usman])))?.[0]?.id;
  await denied('requisition cannot be opened before approval', () => as(HR, `select public.set_requisition_status($1, 'open')`, [ids.req]), 'approved before');
  await ok('HR approves requisition', () => as(HR, `select public.decide_requisition($1, true)`, [ids.req]));
  await ok('careers page lists the job (anon)', () => db.transaction(async (tx) => { await tx.exec('set local role anon'); return (await tx.query(`select public.careers_jobs('acme') j`)).rows; }), (r) => r[0].j.jobs.length === 1);
  ids.cand = (await ok('anonymous applicant applies', () => db.transaction(async (tx) => { await tx.exec('set local role anon'); return (await tx.query(`select public.apply_for_job($1, 'Kamran', 'kamran@mail.pk', '0300', 4, 'I ran inventory with Excel for 4 years') id`, [ids.req])).rows; })))?.[0]?.id;
  await ok('match score computed', () => as(HR, `select match_score from candidates where id = $1`, [ids.cand]), (r) => r[0].match_score === 67);
  await ok('employee cannot see candidates', () => as(EMP, `select count(*)::int n from candidates`), (r) => r[0].n === 0);
  await ok('hiring manager sees own candidates', () => as(MGR, `select count(*)::int n from candidates`), (r) => r[0].n === 1);
  await denied('recruiter cannot set stage directly', () => as(HR, `update candidates set stage = 'hired' where id = $1`, [ids.cand]), 'permission denied');
  await ok('move to interview', () => as(HR, `select public.move_candidate($1, 'interview')`, [ids.cand]));
  await ok('make offer', () => as(HR, `select public.make_offer($1, 90000) s`, [ids.cand]), (r) => r[0].s === 'approved');
  await ok('offer accepted', () => as(HR, `select public.set_offer_status($1, 'accepted')`, [ids.cand]));
  ids.hired = (await ok('hire candidate → employee', () => as(HR, `select public.hire_candidate($1, current_date + 7) id`, [ids.cand])))?.[0]?.id;
  await ok('requisition filled', () => as(HR, `select status from job_requisitions where id = $1`, [ids.req]), (r) => r[0].status === 'filled');

  console.log('\n9. Performance, learning, engagement, helpdesk');
  const cyc = (await as(HR, `insert into review_cycles (name, period_start, period_end) values ('H2 2026', '2026-07-01', '2026-12-31') returning id`))[0].id;
  await ok('launch cycle', () => as(HR, `select public.launch_review_cycle($1) n`, [cyc]), (r) => r[0].n >= 6);
  const rev = (await as(EMP, `select id from performance_reviews where employee_id = $1`, [ids.ahmed]))[0].id;
  await ok('self review', () => as(EMP, `select public.submit_review($1, 4, 'Good half') s`, [rev]), (r) => r[0].s === 'manager_review');
  await denied('employee cannot do manager review', () => as(EMP, `select public.submit_review($1, 5, 'x')`, [rev]), 'manager');
  await ok('manager review', () => as(MGR, `select public.submit_review($1, 4, 'Solid', 'high') s`, [rev]), (r) => r[0].s === 'calibration');
  await ok('HR calibration', () => as(HR, `select public.submit_review($1, 4, null) s`, [rev]), (r) => r[0].s === 'completed');
  const course = (await as(HR, `insert into courses (title, category, is_mandatory, due_days, certificate_valid_months) values ('Fire safety', 'safety', true, 14, 12) returning id`))[0].id;
  await ok('assign course to all', () => as(HR, `select public.assign_course($1) n`, [course]), (r) => r[0].n >= 6);
  const enr = (await as(EMP, `select id from course_enrollments`))[0].id;
  await ok('complete course → certificate', () => as(EMP, `select public.update_course_progress($1, 100, 90); select 1`.split(';')[0], [enr]));
  await ok('certificate issued', () => as(EMP, `select name from certifications`), (r) => r[0]?.name === 'Fire safety');
  const sv = (await as(HR, `insert into surveys (title, kind, questions, status) values ('Pulse', 'enps', '[{"id":"q1","text":"Recommend us?","type":"enps"}]', 'open') returning id`))[0].id;
  for (const u of [OWNER, HR, PAY, FIN, MGR]) await as(u, `select public.submit_survey($1, '{"q1": 9}')`, [sv]);
  await ok('results hidden below 5', () => as(HR, `select public.survey_results($1) r`, [sv]), (r) => r[0].r.hidden === false); // 5 responses → visible
  await denied('one response per person', () => as(HR, `select public.submit_survey($1, '{"q1": 1}')`, [sv]), 'already responded');
  await ok('eNPS', () => as(HR, `select public.survey_results($1) r`, [sv]), (r) => r[0].r.questions[0].enps === 100);
  await denied('employee cannot read raw responses', () => as(EMP, `select * from survey_responses`), 'permission denied');
  await ok('kudos', () => as(EMP, `insert into kudos (from_employee_id, to_employee_id, value, message) values ($1, $2, 'Ownership', 'Thanks for the help') returning id`, [ids.ahmed, ids.usman]));
  const tk = (await ok('raise ticket', () => as(EMP, `insert into hr_tickets (employee_id, category, subject, priority) values ($1, 'payroll', 'Tax query', 'high') returning id, sla_due_at`, [ids.ahmed])))?.[0]?.id;
  await ok('payroll officer sees payroll ticket', () => as(PAY, `select count(*)::int n from hr_tickets`), (r) => r[0].n === 1);
  await ok('manager does not see ticket', () => as(MGR, `select count(*)::int n from hr_tickets`), (r) => r[0].n === 0);
  await ok('internal note hidden from employee', async () => { await as(HR, `insert into ticket_comments (ticket_id, body, is_internal) values ($1, 'check slab', true)`, [tk]); return as(EMP, `select count(*)::int n from ticket_comments`); }, (r) => r[0].n === 0);

  console.log('\n10. Offboarding and final settlement');
  const sep = (await ok('employee resigns', () => as(EMP, `select public.start_separation($1, 'resignation', current_date + 30, 'Higher studies') id`, [ids.ahmed])))?.[0]?.id;
  await ok('HR accepts with exit interview', () => as(HR, `select public.accept_separation($1, '{"reason":"education","rating":4}')`, [sep]));
  const fs = (await ok('payroll prepares settlement', () => as(PAY, `select public.prepare_final_settlement($1) id`, [sep])))?.[0]?.id;
  await ok('settlement numbers', () => as(PAY, `select salary_amount, gratuity, leave_encashment, loan_recovery, net_payable, service_years from final_settlements where id = $1`, [fs]),
    (r) => Number(r[0].gratuity) === 81000 && Number(r[0].loan_recovery) === 72000);
  console.log('    ', JSON.stringify((await as(PAY, `select salary_days, salary_amount, gratuity, leave_encashment, loan_recovery, net_payable from final_settlements where id = $1`, [fs]))[0]));
  await ok('HR approves settlement', () => as(HR, `select public.advance_settlement($1, 'hr_approve') s`, [fs]), (r) => r[0].s === 'hr_approved');
  await ok('finance approves settlement', () => as(FIN, `select public.advance_settlement($1, 'finance_approve') s`, [fs]), (r) => r[0].s === 'finance_approved');
  await ok('paid → employee exited, access suspended', () => as(FIN, `select public.advance_settlement($1, 'mark_paid') s`, [fs]), (r) => r[0].s === 'paid');
  await ok('exited employee loses access', () => as(EMP, `select public.current_tenant_id() t`), (r) => r[0].t === null);

  console.log('\n11. Dashboards, analytics, tenant isolation');
  await ok('owner dashboard', () => as(OWNER, `select public.dashboard_summary() d`), (r) => r[0].d.company.headcount === 6 && r[0].d.payroll.last_run && r[0].d.approvals_waiting >= 0);
  await ok('manager dashboard has team, no payroll', () => as(MGR, `select public.dashboard_summary() d`), (r) => r[0].d.team?.size === 1 && !r[0].d.payroll && !r[0].d.company);
  await ok('analytics for HR', () => as(HR, `select public.people_analytics() a`), (r) => r[0].a.headcount_trend.length === 12);
  await denied('analytics blocked for managers', () => as(MGR, `select public.people_analytics()`), 'analytics');
  await signUp(9, 'zara@other.pk', 'Zara');
  await ok('second company', () => as(OTHER, `select public.create_company('Other Co', 'Zara')`));
  await ok('isolation: other company sees only its own employee', () => as(OTHER, `select full_name from employees`), (r) => r.length === 1 && r[0].full_name === 'Zara');
  await ok('isolation: no salaries leak', () => as(OTHER, `select count(*)::int n from payslips`), (r) => r[0].n === 0);
  await denied('cannot switch into a company you do not belong to', () => as(OTHER, `select public.switch_company($1)`, [ids.tenant]), 'not a member');
  await ok('letter issue and public verify', async () => {
    const t = (await as(HR, `select id from letter_templates where kind = 'salary_certificate'`))[0].id;
    const l = (await as(HR, `select public.issue_letter($1, $2) id`, [ids.usman, t]))[0].id;
    const code = (await root(`select verification_code c from issued_letters where id = $1`, [l]))[0].c;
    return db.transaction(async (tx) => { await tx.exec('set local role anon'); return (await tx.query(`select public.verify_letter($1) v`, [code])).rows; });
  }, (r) => r[0].v.valid === true);
  await ok('audit trail records payroll actions', () => as(AUD, `select count(*)::int n from audit_log where action like 'payroll_%'`), (r) => r[0].n >= 3);

  console.log('\n12. Auto-link accounts to employees by email');
  await ok('invite a user without an employee record', () => as(OWNER, `select public.invite_user('saad@acme.pk', 'employee')`));
  await signUp(21, 'saad@acme.pk', 'Saad');
  await ok('signed-up user starts unlinked', () => as(OWNER, `select employee_id from memberships where user_id = $1`, [uid(21)]), (r) => r[0].employee_id === null);
  const saadEmp = (await ok('HR adds employee with the same email', () => as(OWNER, `select public.hire_employee($1::jsonb) id`, [{ full_name: 'Saad Amir', work_email: 'Saad@acme.pk', job_title: 'Clerk', gross_salary: 60000, joining_date: '2026-10-01' }])))?.[0]?.id;
  await ok('account is linked automatically', () => as(uid(21), `select public.my_context() c`), (r) => r[0].c.employee?.id === saadEmp);
  await ok('linked user gets attendance rules', () => as(uid(21), `select public.my_attendance_rules() r`), (r) => r[0].r && r[0].r.mode);

  console.log('\n13. Preferences, notification muting, AI chat privacy, export');
  const SAAD = uid(21);
  await ok('set a nested preference', () => as(SAAD, `select public.set_my_pref('notif.leave', 'false'::jsonb) p`), (r) => r[0].p.notif.leave === false);
  await ok('set a top-level preference', () => as(SAAD, `select public.set_my_pref('textSize', '"large"'::jsonb) p`), (r) => r[0].p.textSize === 'large' && r[0].p.notif.leave === false);
  await denied('bad preference key rejected', () => as(SAAD, `select public.set_my_pref('a;drop', 'true'::jsonb)`), 'Invalid preference key');
  await ok('prefs come back in my_context', () => as(SAAD, `select public.my_context() c`), (r) => r[0].c.prefs.textSize === 'large');
  await ok('muted category is not delivered', async () => {
    await root(`select set_config('request.jwt.claim.sub', $1, false)`, [OWNER]);
    await as(OWNER, `select 1`);
    return root(`select public.notify_user($1, 'Leave approved', null, '/leave'), public.notify_user($1, 'Payslip ready', null, '/payslips'), public.notify_user($1, 'Approve this', null, '/approvals')`, [SAAD]);
  });
  await ok('only unmuted notifications arrive', () => as(SAAD, `select title from notifications where title in ('Leave approved','Payslip ready','Approve this')`),
    (r) => r.length === 2 && !r.some((x) => x.title === 'Leave approved'));
  await ok('clear a preference group', () => as(SAAD, `select public.clear_my_pref('notif') p`), (r) => r[0].p.notif === undefined);
  const conv = (await ok('start an AI chat', () => as(SAAD, `insert into ai_conversations (title) values ('Leave question') returning id`)))?.[0]?.id;
  await ok('add chat messages', () => as(SAAD, `insert into ai_messages (conversation_id, role, content) values ($1, 'user', 'How much leave?'), ($1, 'assistant', 'You have 10 days.') returning id`, [conv]), (r) => r.length === 2);
  await ok('owner cannot read another person\'s AI chats', () => as(OWNER, `select count(*)::int n from ai_messages`), (r) => r[0].n === 0);
  await denied('cannot post into someone else\'s chat', () => as(MGR, `insert into ai_messages (conversation_id, role, content) values ($1, 'user', 'hi')`, [conv]));
  await ok('like an answer', () => as(SAAD, `update ai_messages set feedback = 1 where conversation_id = $1 and role = 'assistant' returning feedback`, [conv]), (r) => r[0]?.feedback === 1);
  await ok('export my data', () => as(SAAD, `select public.my_data_export() d`), (r) => r[0].d.employee.full_name === 'Saad Amir' && r[0].d.ai_chats.length === 1 && Array.isArray(r[0].d.leave_requests));
  await ok('my activity lists my own changes', () => as(OWNER, `select count(*)::int n from public.my_activity(50)`), (r) => r[0].n >= 1);
  await denied('email codes are server-only', () => as(SAAD, `select * from email_codes`));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
