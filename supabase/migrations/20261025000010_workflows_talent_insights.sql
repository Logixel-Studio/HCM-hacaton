-- ═══════════════════════════════════════════════════════════════════════════
-- HCM Master Suite · 0010 · Server workflows, part 3
-- Recruitment, performance, learning, engagement, approvals inbox,
-- dashboards, analytics and platform administration.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Recruitment ────────────────────────────────────────────────────────────
create or replace function public.decide_requisition(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  perform public.require(public.is_hr_lead(), 'Requisitions are approved by HR leadership');
  select * into r from job_requisitions where id = p_id and tenant_id = public.current_tenant_id();
  perform public.require(r.id is not null, 'Requisition not found');
  perform public.require(r.status = 'pending_approval', 'This requisition is not waiting for approval');
  perform public.require(r.created_by is distinct from auth.uid() or public.is_tenant_admin(), 'You cannot approve your own requisition');
  update job_requisitions set status = case when p_approve then 'open' else 'rejected' end, approved_by = auth.uid(), approved_at = now() where id = p_id;
  perform public.notify_user(r.created_by, 'Requisition ' || case when p_approve then 'approved' else 'rejected' end, r.title || coalesce(' · ' || p_note, ''), '/recruitment');
end $$;

-- Simple, explainable keyword match: share of requirement keywords found in the profile.
create or replace function public.candidate_match(p_requirements text, p_profile text) returns jsonb
language sql immutable as $$
  with req as (select distinct lower(trim(x)) k from unnest(string_to_array(coalesce(p_requirements, ''), ',')) x where trim(x) <> ''),
  hit as (select k from req where position(k in lower(coalesce(p_profile, ''))) > 0)
  select jsonb_build_object(
    'score', case when (select count(*) from req) = 0 then null else round(100.0 * (select count(*) from hit) / (select count(*) from req))::int end,
    'matched', coalesce((select jsonb_agg(k) from hit), '[]'::jsonb),
    'missing', coalesce((select jsonb_agg(k) from req where k not in (select k from hit)), '[]'::jsonb))
$$;

-- Public careers page: open jobs for a company slug (no sign-in needed).
create or replace function public.careers_jobs(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'company', (select jsonb_build_object('tenant_id', t.id, 'name', t.name, 'logo_url', t.logo_url, 'brand_color', t.brand_color) from tenants t where t.slug = p_slug),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'department', d.name, 'location', b.city,
                                                         'employment_type', r.employment_type, 'description', r.description, 'requirements', r.requirements,
                                                         'posted_at', r.approved_at) order by r.approved_at desc)
                      from job_requisitions r join tenants t on t.id = r.tenant_id
                      left join departments d on d.id = r.department_id left join branches b on b.id = r.branch_id
                      where t.slug = p_slug and r.status = 'open' and r.is_public), '[]'::jsonb))
$$;

create or replace function public.apply_for_job(p_job uuid, p_full_name text, p_email text, p_phone text default null,
                                                p_experience numeric default null, p_summary text default null, p_cv_path text default null,
                                                p_expected_salary numeric default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare r record; v_match jsonb; v_id uuid;
begin
  select * into r from job_requisitions where id = p_job and status = 'open' and is_public;
  perform public.require(r.id is not null, 'This job is no longer open');
  perform public.require(length(trim(coalesce(p_full_name, ''))) >= 2, 'Your name is required');
  perform public.require(p_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$', 'Enter a valid email address');
  perform public.require(not exists (select 1 from candidates where requisition_id = p_job and lower(email) = lower(trim(p_email))), 'You have already applied for this job');
  v_match := public.candidate_match(r.requirements, coalesce(p_summary, ''));
  insert into candidates (tenant_id, requisition_id, full_name, email, phone, experience_years, summary, cv_path, expected_salary, source,
                          match_score, match_reasons, user_id)
  values (r.tenant_id, p_job, trim(p_full_name), lower(trim(p_email)), p_phone, p_experience, p_summary, p_cv_path, p_expected_salary, 'careers_site',
          (v_match->>'score')::int, 'Matched: ' || coalesce((select string_agg(x, ', ') from jsonb_array_elements_text(v_match->'matched') x), 'none'),
          auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Re-score a candidate (recruiter edits summary or requirements change).
create or replace function public.score_candidate(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_c record; v jsonb;
begin
  perform public.require(public.is_recruiting(), 'Only recruiters can score candidates');
  select c.*, r.requirements into v_c from candidates c join job_requisitions r on r.id = c.requisition_id where c.id = p_id and c.tenant_id = public.current_tenant_id();
  perform public.require(v_c.id is not null, 'Candidate not found');
  v := public.candidate_match(v_c.requirements, concat_ws(' ', v_c.summary, v_c.current_company));
  update candidates set match_score = (v->>'score')::int,
         match_reasons = 'Matched: ' || coalesce((select string_agg(x, ', ') from jsonb_array_elements_text(v->'matched') x), 'none')
                         || '. Missing: ' || coalesce((select string_agg(x, ', ') from jsonb_array_elements_text(v->'missing') x), 'none')
  where id = p_id;
  return v;
end $$;

create or replace function public.move_candidate(p_id uuid, p_stage text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_c record;
begin
  select c.*, r.hiring_manager_id into v_c from candidates c join job_requisitions r on r.id = c.requisition_id
  where c.id = p_id and c.tenant_id = public.current_tenant_id();
  perform public.require(v_c.id is not null, 'Candidate not found');
  perform public.require(public.is_recruiting() or public.is_self(v_c.hiring_manager_id), 'You cannot move this candidate');
  perform public.require(p_stage in ('applied', 'screening', 'assessment', 'interview', 'offer', 'rejected', 'withdrawn'), 'Use Hire to hire a candidate');
  perform public.require(v_c.stage <> 'hired', 'This candidate is already hired');
  update candidates set stage = p_stage, rejection_reason = case when p_stage = 'rejected' then p_reason else rejection_reason end where id = p_id;
end $$;

create or replace function public.make_offer(p_id uuid, p_amount numeric) returns text
language plpgsql security definer set search_path = public as $$
declare v_c record; v_band numeric;
begin
  perform public.require(public.is_recruiting(), 'Only recruiters can make offers');
  select c.*, g.band_max into v_c from candidates c join job_requisitions r on r.id = c.requisition_id left join grades g on g.id = r.grade_id
  where c.id = p_id and c.tenant_id = public.current_tenant_id();
  perform public.require(v_c.id is not null, 'Candidate not found');
  -- Offers above the grade band need HR leadership approval
  update candidates set stage = 'offer', offer_amount = p_amount,
         offer_status = case when v_c.band_max is not null and p_amount > v_c.band_max and not public.is_hr_lead() then 'pending_approval' else 'approved' end
  where id = p_id;
  return (select offer_status from candidates where id = p_id);
end $$;

create or replace function public.set_offer_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select * into c from candidates where id = p_id and tenant_id = public.current_tenant_id();
  perform public.require(c.id is not null, 'Candidate not found');
  perform public.require(p_status in ('approved', 'sent', 'accepted', 'declined'), 'Unknown offer status');
  perform public.require(p_status <> 'approved' or public.is_hr_lead(), 'Offer approval needs HR leadership');
  perform public.require(public.is_recruiting(), 'Only recruiters can update offers');
  update candidates set offer_status = p_status, stage = case when p_status = 'declined' then 'withdrawn' else stage end where id = p_id;
end $$;

create or replace function public.hire_candidate(p_id uuid, p_joining date, p_employee jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_c record; v_emp uuid; v_hired int;
begin
  perform public.require(public.is_recruiting() and public.is_hr_staff(), 'Only HR can hire');
  select c.*, r.title, r.department_id, r.branch_id, r.grade_id, r.hiring_manager_id, r.employment_type, r.positions into v_c
  from candidates c join job_requisitions r on r.id = c.requisition_id where c.id = p_id and c.tenant_id = public.current_tenant_id();
  perform public.require(v_c.id is not null, 'Candidate not found');
  perform public.require(v_c.stage = 'offer' and v_c.offer_status = 'accepted', 'The offer must be accepted before hiring');
  v_emp := public.hire_employee(jsonb_build_object(
    'full_name', v_c.full_name, 'work_email', null, 'personal_email', v_c.email, 'phone', v_c.phone, 'job_title', v_c.title,
    'department_id', v_c.department_id, 'branch_id', v_c.branch_id, 'grade_id', v_c.grade_id, 'manager_id', v_c.hiring_manager_id,
    'employment_type', case when v_c.employment_type = 'permanent' then 'probation' else v_c.employment_type end,
    'joining_date', p_joining, 'gross_salary', v_c.offer_amount) || coalesce(p_employee, '{}'::jsonb));
  update candidates set stage = 'hired', hired_employee_id = v_emp where id = p_id;
  select count(*) into v_hired from candidates where requisition_id = v_c.requisition_id and stage = 'hired';
  if v_hired >= v_c.positions then update job_requisitions set status = 'filled' where id = v_c.requisition_id; end if;
  return v_emp;
end $$;

-- ── Performance ────────────────────────────────────────────────────────────
create or replace function public.launch_review_cycle(p_cycle uuid) returns int
language plpgsql security definer set search_path = public as $$
declare cy record; n int;
begin
  perform public.require(public.is_hr_lead(), 'Only HR leadership can launch review cycles');
  select * into cy from review_cycles where id = p_cycle and tenant_id = public.current_tenant_id();
  perform public.require(cy.id is not null, 'Cycle not found');
  perform public.require(cy.status = 'draft', 'This cycle was already launched');
  insert into performance_reviews (tenant_id, cycle_id, employee_id, reviewer_id)
  select cy.tenant_id, cy.id, e.id, e.manager_id from employees e
  where e.tenant_id = cy.tenant_id and e.status in ('active', 'probation', 'notice') and e.joining_date <= cy.period_end
  on conflict (cycle_id, employee_id) do nothing;
  get diagnostics n = row_count;
  update review_cycles set status = 'active' where id = p_cycle;
  insert into notifications (tenant_id, user_id, title, body, link)
  select cy.tenant_id, e.user_id, 'Performance review: ' || cy.name, 'Please complete your self review', '/performance'
  from employees e join performance_reviews r on r.employee_id = e.id and r.cycle_id = cy.id where e.user_id is not null;
  return n;
end $$;

create or replace function public.submit_review(p_review uuid, p_rating int, p_comments text, p_potential text default null) returns text
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from performance_reviews where id = p_review and tenant_id = public.current_tenant_id() for update;
  perform public.require(r.id is not null, 'Review not found');
  perform public.require(p_rating between 1 and 5, 'Rating must be 1 to 5');
  if r.status = 'self_review' then
    perform public.require(public.is_self(r.employee_id), 'Waiting for the employee''s self review');
    update performance_reviews set self_rating = p_rating, self_comments = p_comments,
           status = case when reviewer_id is null then 'calibration' else 'manager_review' end where id = p_review;
    perform public.notify_user(public.employee_user(r.reviewer_id), 'Self review submitted', 'Please complete the manager review', '/performance');
  elsif r.status = 'manager_review' then
    perform public.require(public.is_my_report(r.employee_id) or (public.is_hr_lead() and not public.is_self(r.employee_id)), 'Only the manager can complete this review');
    update performance_reviews set manager_rating = p_rating, manager_comments = p_comments, potential = coalesce(p_potential, potential),
           status = 'calibration' where id = p_review;
  elsif r.status = 'calibration' then
    perform public.require(public.is_hr_lead() and not public.is_self(r.employee_id), 'Calibration is done by HR leadership');
    update performance_reviews set final_rating = p_rating, potential = coalesce(p_potential, potential), status = 'completed',
           manager_comments = coalesce(manager_comments, p_comments) where id = p_review;
    perform public.notify_user(public.employee_user(r.employee_id), 'Your review is complete', 'Final rating ' || p_rating || ' of 5', '/performance');
  else
    raise exception 'This review is already completed';
  end if;
  return (select status from performance_reviews where id = p_review);
end $$;

-- ── Learning ───────────────────────────────────────────────────────────────
create or replace function public.assign_course(p_course uuid, p_employees uuid[] default null, p_department uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare c record; n int;
begin
  perform public.require(public.is_hr_staff() or public.has_role(array['line_manager']::public.app_role[]), 'You cannot assign courses');
  select * into c from courses where id = p_course and tenant_id = public.current_tenant_id();
  perform public.require(c.id is not null, 'Course not found');
  insert into course_enrollments (tenant_id, course_id, employee_id, due_date)
  select c.tenant_id, c.id, e.id, case when c.due_days is not null then current_date + c.due_days end
  from employees e
  where e.tenant_id = c.tenant_id and e.status <> 'exited'
    and ((p_employees is not null and e.id = any (p_employees)) or (p_department is not null and e.department_id = p_department)
         or (p_employees is null and p_department is null))
    and (public.is_hr_staff() or public.is_my_report(e.id))
  on conflict (course_id, employee_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.update_course_progress(p_enrollment uuid, p_progress int, p_score int default null) returns void
language plpgsql security definer set search_path = public as $$
declare en record; c record;
begin
  select * into en from course_enrollments where id = p_enrollment and tenant_id = public.current_tenant_id();
  perform public.require(en.id is not null and public.is_self(en.employee_id), 'Enrollment not found');
  select * into c from courses where id = en.course_id;
  update course_enrollments set progress = greatest(progress, least(100, p_progress)), score = coalesce(p_score, score),
         status = case when p_progress >= 100 then 'completed' when p_progress > 0 then 'in_progress' else status end,
         completed_at = case when p_progress >= 100 then coalesce(completed_at, now()) end
  where id = p_enrollment;
  if p_progress >= 100 and c.certificate_valid_months is not null
     and not exists (select 1 from certifications where employee_id = en.employee_id and name = c.title and expires_on > current_date) then
    insert into certifications (tenant_id, employee_id, name, issuer, issued_on, expires_on)
    values (en.tenant_id, en.employee_id, c.title, (select name from tenants where id = en.tenant_id), current_date,
            (current_date + make_interval(months => c.certificate_valid_months))::date);
  end if;
end $$;

-- ── Engagement: anonymous surveys with a minimum group size ────────────────
create or replace function public.submit_survey(p_survey uuid, p_answers jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s record; v_key text;
begin
  select * into s from surveys where id = p_survey and tenant_id = public.current_tenant_id();
  perform public.require(s.id is not null and s.status = 'open', 'This survey is not open');
  perform public.require(s.closes_at is null or s.closes_at > now(), 'This survey has closed');
  perform public.require(public.current_employee_id() is not null, 'Only employees can respond');
  v_key := encode(sha256(convert_to(p_survey::text || ':' || auth.uid()::text || ':' || s.tenant_id::text, 'UTF8')), 'hex');
  perform public.require(not exists (select 1 from survey_responses where survey_id = p_survey and respondent_key = v_key), 'You have already responded');
  insert into survey_responses (tenant_id, survey_id, respondent_key, employee_id, answers)
  values (s.tenant_id, p_survey, v_key, case when s.is_anonymous then null else public.current_employee_id() end, p_answers);
end $$;

create or replace function public.has_responded(p_survey uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from survey_responses where survey_id = p_survey
                 and respondent_key = encode(sha256(convert_to(p_survey::text || ':' || auth.uid()::text || ':' || public.current_tenant_id()::text, 'UTF8')), 'hex'))
$$;

create or replace function public.survey_results(p_survey uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s record; n int; q jsonb; out jsonb := '[]'::jsonb; v_avg numeric; v_prom int; v_det int; v_cnt int; v_texts jsonb;
begin
  perform public.require(public.is_hr_lead() or public.is_auditor(), 'Only HR leadership can see survey results');
  select * into s from surveys where id = p_survey and tenant_id = public.current_tenant_id();
  perform public.require(s.id is not null, 'Survey not found');
  select count(*) into n from survey_responses where survey_id = p_survey;
  if s.is_anonymous and n < 5 then
    return jsonb_build_object('responses', n, 'hidden', true, 'message', 'Results appear after 5 responses to protect anonymity');
  end if;
  for q in select * from jsonb_array_elements(s.questions) loop
    if q->>'type' = 'text' then
      select coalesce(jsonb_agg(answers->>(q->>'id')), '[]'::jsonb) into v_texts from survey_responses
      where survey_id = p_survey and coalesce(answers->>(q->>'id'), '') <> '';
      out := out || jsonb_build_object('id', q->>'id', 'text', q->>'text', 'type', 'text', 'answers', v_texts);
    else
      select avg((answers->>(q->>'id'))::numeric), count(*) filter (where (answers->>(q->>'id'))::numeric >= 9),
             count(*) filter (where (answers->>(q->>'id'))::numeric <= 6), count(answers->>(q->>'id'))
        into v_avg, v_prom, v_det, v_cnt
      from survey_responses where survey_id = p_survey and answers ? (q->>'id');
      out := out || jsonb_build_object('id', q->>'id', 'text', q->>'text', 'type', q->>'type', 'average', round(v_avg, 2), 'count', v_cnt,
               'enps', case when q->>'type' = 'enps' and v_cnt > 0 then round(100.0 * (v_prom - v_det) / v_cnt) end);
    end if;
  end loop;
  return jsonb_build_object('responses', n, 'hidden', false, 'questions', out);
end $$;

-- ── Approvals inbox: everything waiting for me ─────────────────────────────
create or replace function public.my_approvals() returns table (
  kind text, id uuid, employee_id uuid, employee_name text, title text, detail text, amount numeric, created_at timestamptz, link text)
language sql stable security definer set search_path = public as $$
  select 'leave', r.id, e.id, e.full_name, t.name,
         to_char(r.start_date, 'DD Mon') || ' – ' || to_char(r.end_date, 'DD Mon') || ' · ' || r.days || ' d' || coalesce(' · ' || r.reason, ''),
         null::numeric, r.created_at, '/leave'
  from leave_requests r join employees e on e.id = r.employee_id join leave_types t on t.id = r.leave_type_id
  where r.tenant_id = public.current_tenant_id() and r.status = 'pending' and public.can_decide_for(r.employee_id)
    and (r.current_step = 'manager' or public.is_hr_staff())
  union all
  select 'regularization', r.id, e.id, e.full_name, 'Attendance correction',
         to_char(r.work_date, 'DD Mon') || ' · ' || coalesce(to_char(r.clock_in_time, 'HH24:MI'), '--') || ' to ' || coalesce(to_char(r.clock_out_time, 'HH24:MI'), '--') || ' · ' || r.reason,
         null, r.created_at, '/attendance'
  from regularization_requests r join employees e on e.id = r.employee_id
  where r.tenant_id = public.current_tenant_id() and r.status = 'pending' and public.can_decide_for(r.employee_id)
  union all
  select 'overtime', r.id, e.id, e.full_name, 'Overtime', to_char(r.work_date, 'DD Mon') || ' · ' || round(r.minutes / 60.0, 1) || ' h' || coalesce(' · ' || r.reason, ''),
         null, r.created_at, '/attendance'
  from overtime_requests r join employees e on e.id = r.employee_id
  where r.tenant_id = public.current_tenant_id() and r.status = 'pending' and public.can_decide_for(r.employee_id)
  union all
  select 'expense', c.id, e.id, e.full_name, 'Expense · ' || c.category, coalesce(c.description, '') || case when c.over_policy then ' · over policy' else '' end,
         c.amount, c.created_at, '/expenses'
  from expense_claims c join employees e on e.id = c.employee_id
  where c.tenant_id = public.current_tenant_id() and not public.is_self(c.employee_id)
    and ((c.status = 'pending' and (public.is_my_report(c.employee_id) or public.is_finance()))
      or (c.status = 'manager_approved' and public.is_finance()))
  union all
  select 'travel', t.id, e.id, e.full_name, 'Travel · ' || t.destination, t.purpose || ' · ' || to_char(t.start_date, 'DD Mon') || ' – ' || to_char(t.end_date, 'DD Mon'),
         t.estimated_cost, t.created_at, '/expenses'
  from travel_requests t join employees e on e.id = t.employee_id
  where t.tenant_id = public.current_tenant_id() and t.status = 'pending' and (public.can_decide_for(t.employee_id) or (public.is_finance() and not public.is_self(t.employee_id)))
  union all
  select 'loan', l.id, e.id, e.full_name, 'Loan · ' || replace(l.loan_type, '_', ' '), l.installments || ' installments' || coalesce(' · ' || l.reason, ''),
         l.principal, l.created_at, '/expenses'
  from loans l join employees e on e.id = l.employee_id
  where l.tenant_id = public.current_tenant_id() and l.status = 'pending' and (public.is_finance() or public.is_hr_lead()) and not public.is_self(l.employee_id)
  union all
  select 'requisition', r.id, null, null, 'Job requisition · ' || r.title, r.positions || ' position(s)', r.budget_monthly, r.created_at, '/recruitment'
  from job_requisitions r
  where r.tenant_id = public.current_tenant_id() and r.status = 'pending_approval' and public.is_hr_lead() and (r.created_by is distinct from auth.uid() or public.is_tenant_admin())
  union all
  select 'payroll', r.id, null, null, 'Payroll ' || r.period,
         replace(r.status, '_', ' ') || ' · ' || r.employee_count || ' employees', r.total_net, coalesce(r.prepared_at, r.created_at), '/payroll'
  from payroll_runs r
  where r.tenant_id = public.current_tenant_id()
    and ((r.status = 'calculated' and public.is_hr_lead()) or (r.status = 'hr_approved' and public.is_finance()) or (r.status = 'finance_approved' and public.can_run_payroll()))
  union all
  select 'offer', c.id, null, c.full_name, 'Offer above band', to_char(c.offer_amount, 'FM999,999,999'), c.offer_amount, c.updated_at, '/recruitment'
  from candidates c where c.tenant_id = public.current_tenant_id() and c.offer_status = 'pending_approval' and public.is_hr_lead()
  union all
  select 'settlement', f.id, e.id, e.full_name, 'Final settlement', replace(f.status, '_', ' '), f.net_payable, f.created_at, '/lifecycle'
  from final_settlements f join employees e on e.id = f.employee_id
  where f.tenant_id = public.current_tenant_id() and ((f.status = 'draft' and public.is_hr_lead()) or (f.status = 'hr_approved' and public.is_finance()))
  order by 8 desc
$$;

-- ── Dashboard (role-aware numbers in one call) ─────────────────────────────
create or replace function public.dashboard_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_emp uuid := public.current_employee_id();
  v_today date := public.tenant_now()::date;
  v jsonb := '{}'::jsonb;
  v_head int;
begin
  perform public.require(v_tenant is not null, 'No active company');
  -- Personal block for everyone with an employee record
  if v_emp is not null then
    v := v || jsonb_build_object('me', jsonb_build_object(
      'today', (select to_jsonb(a) - 'clock_in_lat' - 'clock_in_lng' - 'clock_out_lat' - 'clock_out_lng' from attendance_records a where a.employee_id = v_emp and a.work_date = v_today),
      'shift', (select jsonb_build_object('name', s.name, 'start', s.start_time, 'end', s.end_time) from shifts s where s.id = public.employee_shift_for(v_emp, v_today)),
      'leave', (select coalesce(jsonb_agg(jsonb_build_object('code', b.code, 'name', b.name, 'color', b.color, 'available', b.available, 'entitled', b.entitled)), '[]')
                from public.my_leave_balances(null) b where b.is_paid),
      'month_present', (select count(*) from attendance_records where employee_id = v_emp and work_date >= date_trunc('month', v_today) and clock_in_at is not null),
      'month_late', (select count(*) from attendance_records where employee_id = v_emp and work_date >= date_trunc('month', v_today) and status = 'late'),
      'last_payslip', (select jsonb_build_object('period', p.period, 'net_pay', p.net_pay, 'id', p.id) from payslips p
                       where p.employee_id = v_emp and p.is_published order by p.period desc limit 1),
      'open_tickets', (select count(*) from hr_tickets where employee_id = v_emp and status not in ('resolved', 'closed')),
      'pending_courses', (select count(*) from course_enrollments where employee_id = v_emp and status <> 'completed'),
      'reports', (select count(*) from employees where manager_id = v_emp and status <> 'exited')));
  end if;

  v := v || jsonb_build_object('approvals_waiting', (select count(*) from public.my_approvals()));

  -- Team block for line managers
  if exists (select 1 from employees where manager_id = v_emp and status <> 'exited') then
    v := v || jsonb_build_object('team', jsonb_build_object(
      'size', (select count(*) from employees e where e.tenant_id = v_tenant and e.status <> 'exited' and public.is_my_report(e.id)),
      'present', (select count(*) from attendance_records a join employees e on e.id = a.employee_id
                  where a.work_date = v_today and a.clock_in_at is not null and public.is_my_report(e.id)),
      'late', (select count(*) from attendance_records a where a.work_date = v_today and a.status = 'late' and public.is_my_report(a.employee_id)),
      'on_leave', (select count(*) from leave_requests l where l.status = 'approved' and v_today between l.start_date and l.end_date and public.is_my_report(l.employee_id))));
  end if;

  -- Company block for HR, leadership, finance and auditors
  if public.is_hr_staff() or public.is_finance() or public.is_auditor() or public.can_run_payroll() then
    select count(*) into v_head from employees where tenant_id = v_tenant and status <> 'exited';
    v := v || jsonb_build_object('company', jsonb_build_object(
      'headcount', v_head,
      'joiners_30d', (select count(*) from employees where tenant_id = v_tenant and joining_date > v_today - 30),
      'exits_12m', (select count(*) from employees where tenant_id = v_tenant and status = 'exited' and exit_date > v_today - 365),
      'attrition_12m_pct', round(100.0 * (select count(*) from employees where tenant_id = v_tenant and status = 'exited' and exit_date > v_today - 365)
                                  / greatest(v_head, 1), 1),
      'present_today', (select count(*) from attendance_records where tenant_id = v_tenant and work_date = v_today and clock_in_at is not null),
      'late_today', (select count(*) from attendance_records where tenant_id = v_tenant and work_date = v_today and status = 'late'),
      'on_leave_today', (select count(*) from leave_requests where tenant_id = v_tenant and status = 'approved' and v_today between start_date and end_date),
      'open_positions', (select coalesce(sum(positions), 0) from job_requisitions where tenant_id = v_tenant and status = 'open'),
      'candidates_active', (select count(*) from candidates where tenant_id = v_tenant and stage not in ('hired', 'rejected', 'withdrawn')),
      'probation_due_30d', (select count(*) from employees where tenant_id = v_tenant and status = 'probation' and probation_end_date between v_today and v_today + 30),
      'documents_expiring_30d', (select count(*) from employee_documents where tenant_id = v_tenant and expires_on between v_today and v_today + 30),
      'open_tickets', (select count(*) from hr_tickets where tenant_id = v_tenant and status not in ('resolved', 'closed')),
      'tickets_breaching_sla', (select count(*) from hr_tickets where tenant_id = v_tenant and status not in ('resolved', 'closed') and sla_due_at < now()),
      'by_department', (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(d.name, 'Unassigned'), 'count', x.c) order by x.c desc), '[]')
                        from (select department_id, count(*) c from employees where tenant_id = v_tenant and status <> 'exited' group by department_id) x
                        left join departments d on d.id = x.department_id),
      'attendance_7d', (select coalesce(jsonb_agg(jsonb_build_object('date', g.d::date,
                                 'present', (select count(*) from attendance_records a where a.tenant_id = v_tenant and a.work_date = g.d::date and a.clock_in_at is not null),
                                 'late', (select count(*) from attendance_records a where a.tenant_id = v_tenant and a.work_date = g.d::date and a.status = 'late')) order by g.d), '[]')
                        from generate_series(v_today - 6, v_today, interval '1 day') g(d)),
      'upcoming_birthdays', case when public.is_hr_staff() then
                        (select coalesce(jsonb_agg(jsonb_build_object('name', e.full_name, 'date', to_char(p.date_of_birth, 'DD Mon'))), '[]')
                         from employees e join employee_private p on p.employee_id = e.id
                         where e.tenant_id = v_tenant and e.status <> 'exited' and p.date_of_birth is not null
                           and to_char(p.date_of_birth, 'MMDD') between to_char(v_today, 'MMDD') and to_char(v_today + 14, 'MMDD')) end));
  end if;

  if public.can_view_pay() then
    v := v || jsonb_build_object('payroll', jsonb_build_object(
      'last_run', (select jsonb_build_object('id', r.id, 'period', r.period, 'status', r.status, 'total_net', r.total_net, 'total_gross', r.total_gross,
                                             'employer_cost', r.total_employer_cost, 'employees', r.employee_count)
                   from payroll_runs r where r.tenant_id = v_tenant and r.status <> 'cancelled' order by r.period desc limit 1),
      'trend', (select coalesce(jsonb_agg(jsonb_build_object('period', r.period, 'net', r.total_net, 'gross', r.total_gross, 'cost', r.total_employer_cost) order by r.period), '[]')
                from (select * from payroll_runs where tenant_id = v_tenant and status = 'finalized' and run_type = 'regular' order by period desc limit 6) r),
      'monthly_salary_bill', (select coalesce(sum(c.gross_salary), 0) from current_compensation c join employees e on e.id = c.employee_id
                              where e.tenant_id = v_tenant and e.status <> 'exited')));
  end if;
  return v;
end $$;

-- ── People analytics (brief M13) ───────────────────────────────────────────
create or replace function public.people_analytics(p_months int default 12) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_tenant uuid := public.current_tenant_id(); v jsonb;
begin
  perform public.require(public.is_hr_staff() or public.is_auditor() or public.is_finance(), 'Analytics is available to HR, finance and auditors');
  select jsonb_build_object(
    'headcount_trend', (select jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'),
                            'headcount', (select count(*) from employees e where e.tenant_id = v_tenant and e.joining_date <= (m + interval '1 month - 1 day')::date
                                          and (e.exit_date is null or e.exit_date > (m + interval '1 month - 1 day')::date)),
                            'joiners', (select count(*) from employees e where e.tenant_id = v_tenant and date_trunc('month', e.joining_date) = m),
                            'exits', (select count(*) from employees e where e.tenant_id = v_tenant and date_trunc('month', e.exit_date) = m)) order by m)
                        from generate_series(date_trunc('month', current_date) - make_interval(months => p_months - 1), date_trunc('month', current_date), interval '1 month') m),
    'by_employment_type', (select jsonb_agg(jsonb_build_object('type', employment_type, 'count', c)) from
                             (select employment_type, count(*) c from employees where tenant_id = v_tenant and status <> 'exited' group by 1) x),
    'by_gender', (select jsonb_agg(jsonb_build_object('gender', coalesce(gender, 'unspecified'), 'count', c)) from
                    (select gender, count(*) c from employees where tenant_id = v_tenant and status <> 'exited' group by 1) x),
    'by_branch', (select jsonb_agg(jsonb_build_object('branch', coalesce(b.name, 'Unassigned'), 'count', x.c)) from
                    (select branch_id, count(*) c from employees where tenant_id = v_tenant and status <> 'exited' group by 1) x left join branches b on b.id = x.branch_id),
    'tenure', (select jsonb_agg(jsonb_build_object('band', band, 'count', c) order by ord) from
                 (select case when yrs < 1 then '< 1 yr' when yrs < 3 then '1–3 yrs' when yrs < 5 then '3–5 yrs' else '5+ yrs' end band,
                         case when yrs < 1 then 1 when yrs < 3 then 2 when yrs < 5 then 3 else 4 end ord, count(*) c
                  from (select (current_date - joining_date) / 365.25 yrs from employees where tenant_id = v_tenant and status <> 'exited') t group by 1, 2) x),
    'leave_by_type', (select jsonb_agg(jsonb_build_object('type', t.name, 'color', t.color, 'days', coalesce(x.d, 0))) from leave_types t
                        left join (select leave_type_id, sum(days) d from leave_requests where tenant_id = v_tenant and status = 'approved'
                                   and start_date > current_date - make_interval(months => p_months) group by 1) x on x.leave_type_id = t.id
                        where t.tenant_id = v_tenant),
    'absenteeism_pct', (select round(100.0 * count(*) filter (where status in ('absent', 'missing_punch')) / greatest(count(*), 1), 1)
                        from attendance_records where tenant_id = v_tenant and work_date > current_date - 90),
    'late_pct', (select round(100.0 * count(*) filter (where status = 'late') / greatest(count(*) filter (where clock_in_at is not null), 1), 1)
                 from attendance_records where tenant_id = v_tenant and work_date > current_date - 90),
    'hiring_funnel', (select jsonb_agg(jsonb_build_object('stage', s, 'count', (select count(*) from candidates c where c.tenant_id = v_tenant and c.stage = s)) order by o)
                      from unnest(array['applied','screening','assessment','interview','offer','hired']) with ordinality u(s, o)),
    'source_of_hire', (select jsonb_agg(jsonb_build_object('source', source, 'count', c)) from
                         (select source, count(*) c from candidates where tenant_id = v_tenant and stage = 'hired' group by 1) x),
    'exit_reasons', (select jsonb_agg(jsonb_build_object('reason', r, 'count', c)) from
                       (select coalesce(exit_interview->>'reason', separation_type) r, count(*) c from separations where tenant_id = v_tenant group by 1) x),
    'performance_distribution', (select jsonb_agg(jsonb_build_object('rating', final_rating, 'count', c) order by final_rating) from
                                   (select final_rating, count(*) c from performance_reviews where tenant_id = v_tenant and final_rating is not null group by 1) x),
    'training_completion_pct', (select round(100.0 * count(*) filter (where status = 'completed') / greatest(count(*), 1), 1) from course_enrollments where tenant_id = v_tenant),
    'payroll_cost_by_department', case when public.can_view_pay() then
                                  (select jsonb_agg(jsonb_build_object('department', coalesce(d.name, 'Unassigned'), 'monthly_gross', x.g) order by x.g desc) from
                                     (select e.department_id, sum(c.gross_salary) g from current_compensation c join employees e on e.id = c.employee_id
                                      where e.tenant_id = v_tenant and e.status <> 'exited' group by 1) x left join departments d on d.id = x.department_id) end,
    -- Explainable flight-risk signal (brief M12/M13): rules, not a black box
    'flight_risk', case when public.is_hr_lead() then
                   (select coalesce(jsonb_agg(jsonb_build_object('employee_id', id, 'name', full_name, 'score', score, 'reasons', reasons) order by score desc), '[]') from (
                      select e.id, e.full_name,
                        (case when lr.final_rating <= 2 then 25 else 0 end
                         + case when (select count(*) from attendance_records a where a.employee_id = e.id and a.status = 'late' and a.work_date > current_date - 60) >= 6 then 20 else 0 end
                         + case when (select max(effective_from) from employee_compensation c where c.employee_id = e.id) < current_date - 540 then 25 else 0 end
                         + case when (select count(*) from leave_requests l where l.employee_id = e.id and l.status = 'approved' and l.days <= 1 and l.start_date > current_date - 60) >= 3 then 15 else 0 end
                         + case when (current_date - e.joining_date) between 300 and 800 then 15 else 0 end) score,
                        array_remove(array[
                          case when lr.final_rating <= 2 then 'Low last rating' end,
                          case when (select count(*) from attendance_records a where a.employee_id = e.id and a.status = 'late' and a.work_date > current_date - 60) >= 6 then 'Frequent late arrivals' end,
                          case when (select max(effective_from) from employee_compensation c where c.employee_id = e.id) < current_date - 540 then 'No raise in 18 months' end,
                          case when (select count(*) from leave_requests l where l.employee_id = e.id and l.status = 'approved' and l.days <= 1 and l.start_date > current_date - 60) >= 3 then 'Many single-day leaves' end,
                          case when (current_date - e.joining_date) between 300 and 800 then 'At 1–2 year tenure mark' end], null) reasons
                      from employees e
                      left join lateral (select final_rating from performance_reviews r where r.employee_id = e.id and r.final_rating is not null order by r.created_at desc limit 1) lr on true
                      where e.tenant_id = v_tenant and e.status in ('active', 'probation')) x where score >= 40) end
  ) into v;
  return v;
end $$;

-- ── Platform super admin (brief §2 role 1) ─────────────────────────────────
create or replace function public.platform_tenants() returns table (
  id uuid, name text, slug text, plan text, status text, seat_limit int, members bigint, employees bigint, created_at timestamptz, trial_ends_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.slug, t.plan, t.status, t.seat_limit,
         (select count(*) from memberships m where m.tenant_id = t.id and m.status = 'active'),
         (select count(*) from employees e where e.tenant_id = t.id and e.status <> 'exited'),
         t.created_at, t.trial_ends_at
  from tenants t where public.is_platform_admin() order by t.created_at desc
$$;

create or replace function public.platform_update_tenant(p_tenant uuid, p_plan text default null, p_status text default null, p_seat_limit int default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require(public.is_platform_admin(), 'Platform administrators only');
  update tenants set plan = coalesce(p_plan, plan), status = coalesce(p_status, status), seat_limit = coalesce(p_seat_limit, seat_limit) where id = p_tenant;
  insert into audit_log (tenant_id, actor_id, action, entity, entity_id, after_data)
  values (p_tenant, auth.uid(), 'platform_update', 'tenants', p_tenant::text, jsonb_build_object('plan', p_plan, 'status', p_status, 'seat_limit', p_seat_limit));
end $$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null) returns void
language sql security definer set search_path = public as $$
  update notifications set read_at = now() where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids))
$$;
