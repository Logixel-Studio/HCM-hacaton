import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolDef } from "./llm";

/*
 * Copilot tools. Every query runs through a Supabase client signed in AS THE CALLER, so Row-Level Security
 * decides what comes back: an owner or HR sees the company, a manager sees their team, an employee sees
 * only their own records. The AI can never see more than the person asking.
 */
type Run = (sb: SupabaseClient, a: Record<string, unknown>) => Promise<unknown>;
const res = async (p: PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
  const { data, error } = await p;
  return error ? { error: error.message.includes("permission") || error.message.includes("Only") ? "Not available for this user's role" : error.message } : data;
};
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Adds readable names (employee, department, branch, manager, leave type) to rows, without relying on embedded joins. */
async function named(sb: SupabaseClient, rowsIn: unknown): Promise<unknown> {
  if (!Array.isArray(rowsIn) || rowsIn.length === 0) return rowsIn;
  const rows = rowsIn as Record<string, unknown>[];
  const ids = (k: string) => [...new Set(rows.map((r) => r[k]).filter((x): x is string => typeof x === "string"))];
  const empIds = [...new Set([...ids("employee_id"), ...ids("manager_id"), ...ids("head_employee_id")])];
  const [emps, depts, brs, types] = await Promise.all([
    empIds.length ? sb.from("employees").select("id, full_name, employee_code").in("id", empIds) : Promise.resolve({ data: [] }),
    ids("department_id").length ? sb.from("departments").select("id, name").in("id", ids("department_id")) : Promise.resolve({ data: [] }),
    ids("branch_id").length ? sb.from("branches").select("id, name").in("id", ids("branch_id")) : Promise.resolve({ data: [] }),
    ids("leave_type_id").length ? sb.from("leave_types").select("id, name, code").in("id", ids("leave_type_id")) : Promise.resolve({ data: [] }),
  ]);
  const map = (d: unknown) => new Map(((d as { id: string }[] | null) ?? []).map((x) => [x.id, x as Record<string, unknown>]));
  const E = map(emps.data), D = map(depts.data), Br = map(brs.data), L = map(types.data);
  return rows.map((r) => {
    const o: Record<string, unknown> = { ...r };
    if (typeof r.employee_id === "string") { const e = E.get(r.employee_id); o.employee = e ? `${e.full_name} (${e.employee_code})` : undefined; delete o.employee_id; }
    if (typeof r.manager_id === "string") { o.manager = E.get(r.manager_id)?.full_name; delete o.manager_id; }
    if (typeof r.head_employee_id === "string") { o.head = E.get(r.head_employee_id)?.full_name; delete o.head_employee_id; }
    if (typeof r.department_id === "string") { o.department = D.get(r.department_id)?.name; delete o.department_id; }
    if (typeof r.branch_id === "string") { o.branch = Br.get(r.branch_id)?.name; delete o.branch_id; }
    if (typeof r.leave_type_id === "string") { const t = L.get(r.leave_type_id); o.leave_type = t ? `${t.name} (${t.code})` : undefined; delete o.leave_type_id; }
    return o;
  });
}
const resN = async (sb: SupabaseClient, p: PromiseLike<{ data: unknown; error: { message: string } | null }>) => { const r = await res(p); return Array.isArray(r) ? named(sb, r) : r; };
const like = (v: string) => v.replace(/[%,()]/g, " ").trim();

const T: { def: ToolDef; run: Run }[] = [
  {
    def: { type: "function", function: { name: "dashboard_summary", description: "Role-aware overview: the user's own attendance and leave, their team (managers), company headcount, attendance today, hiring and payroll totals (HR, finance, owners).", parameters: { type: "object", properties: {} } } },
    run: (sb) => res(sb.rpc("dashboard_summary")),
  },
  {
    def: { type: "function", function: { name: "pending_approvals", description: "Requests waiting for this user's decision: leave, attendance corrections, overtime, expenses, loans, payroll, offers.", parameters: { type: "object", properties: {} } } },
    run: (sb) => res(sb.rpc("my_approvals")),
  },
  {
    def: { type: "function", function: { name: "search_employees", description: "Find employees by name, employee code, job title or email. Use this first whenever a person is mentioned by name. Returns ids for employee_details.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
    run: (sb, a) => {
      const q = like(String(a.query ?? ""));
      const words = q.split(/\s+/).filter((w) => w.length > 1).slice(0, 3);
      const ors = [q, ...words].flatMap((w) => [`full_name.ilike.%${w}%`, `employee_code.ilike.%${w}%`, `job_title.ilike.%${w}%`, `work_email.ilike.%${w}%`]).join(",");
      return resN(sb, sb.from("employees").select("id, employee_code, full_name, job_title, status, employment_type, joining_date, work_email, department_id, branch_id, manager_id").or(ors).limit(15));
    },
  },
  {
    def: { type: "function", function: { name: "employee_details", description: "Everything this user may see about one employee: job, department, manager, contact, latest salary (pay roles and the person themself), private details (HR), leave balances, last 30 days attendance, recent leave, loans.", parameters: { type: "object", properties: { employee_id: { type: "string" } }, required: ["employee_id"] } } },
    run: async (sb, a) => {
      const id = String(a.employee_id ?? "");
      const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
      const [emp, comp, priv, bal, att, leave, loans] = await Promise.all([
        resN(sb, sb.from("employees").select("id, employee_code, full_name, job_title, status, employment_type, gender, joining_date, probation_end_date, confirmation_date, exit_date, work_email, phone, skills, department_id, branch_id, manager_id").eq("id", id).limit(1)),
        res(sb.from("employee_compensation").select("effective_from, gross_salary, currency, pf_applicable, eobi_applicable, reason").eq("employee_id", id).order("effective_from", { ascending: false }).limit(3)),
        res(sb.from("employee_private").select("date_of_birth, marital_status, personal_email, city, emergency_contact_name, emergency_contact_phone, blood_group").eq("employee_id", id).maybeSingle()),
        res(sb.rpc("my_leave_balances", { p_employee: id })),
        res(sb.from("attendance_records").select("work_date, status, clock_in_at, clock_out_at, late_minutes, worked_minutes").eq("employee_id", id).gte("work_date", since).order("work_date", { ascending: false })),
        resN(sb, sb.from("leave_requests").select("start_date, end_date, days, status, reason, leave_type_id").eq("employee_id", id).order("start_date", { ascending: false }).limit(10)),
        res(sb.from("loans").select("loan_type, principal, installments, installment_amount, recovered_amount, status").eq("employee_id", id).limit(5)),
      ]);
      const rows = Array.isArray(att) ? (att as { status: string; late_minutes: number }[]) : [];
      return {
        employee: (Array.isArray(emp) ? emp[0] : emp) ?? "Not visible to this user", salary_history: comp, private_details: priv ?? "Not visible to this user",
        leave_balances: bal, attendance_last_30_days: { days: rows.length, present: rows.filter((r) => r.status === "present" || r.status === "late").length, late: rows.filter((r) => r.status === "late").length, absent: rows.filter((r) => r.status === "absent").length, records: rows.slice(0, 31) },
        recent_leave: leave, loans,
      };
    },
  },
  {
    def: { type: "function", function: { name: "attendance", description: "Attendance records the user may see. Give one date, or a from/to range (YYYY-MM-DD), optionally one employee_id. Defaults to today.", parameters: { type: "object", properties: { date: { type: "string" }, from: { type: "string" }, to: { type: "string" }, employee_id: { type: "string" } } } } },
    run: (sb, a) => {
      const today = new Date().toISOString().slice(0, 10);
      let x = sb.from("attendance_records").select("employee_id, work_date, status, clock_in_at, clock_out_at, late_minutes, worked_minutes, overtime_minutes, work_mode, clock_in_distance_m").order("work_date", { ascending: false }).limit(300);
      if (str(a.employee_id)) x = x.eq("employee_id", a.employee_id as string);
      if (str(a.from) || str(a.to)) { if (str(a.from)) x = x.gte("work_date", a.from as string); if (str(a.to)) x = x.lte("work_date", a.to as string); }
      else x = x.eq("work_date", str(a.date) ?? today);
      return resN(sb, x);
    },
  },
  {
    def: { type: "function", function: { name: "leave_requests", description: "Leave requests the user may see, filtered by status (pending, approved, rejected, cancelled), date window and/or employee_id.", parameters: { type: "object", properties: { status: { type: "string" }, from: { type: "string" }, to: { type: "string" }, employee_id: { type: "string" } } } } },
    run: (sb, a) => {
      let x = sb.from("leave_requests").select("employee_id, leave_type_id, start_date, end_date, days, is_half_day, status, reason, current_step").order("start_date", { ascending: false }).limit(150);
      if (str(a.status)) x = x.eq("status", a.status as string);
      if (str(a.from)) x = x.gte("end_date", a.from as string);
      if (str(a.to)) x = x.lte("start_date", a.to as string);
      if (str(a.employee_id)) x = x.eq("employee_id", a.employee_id as string);
      return resN(sb, x);
    },
  },
  {
    def: { type: "function", function: { name: "leave_balances", description: "Leave balances (entitled, used, pending, available) of the user, or of an employee_id the user may see.", parameters: { type: "object", properties: { employee_id: { type: "string" } } } } },
    run: (sb, a) => res(sb.rpc("my_leave_balances", { p_employee: str(a.employee_id) })),
  },
  {
    def: { type: "function", function: { name: "payslips", description: "Published payslips the user may see (own payslips; all payslips for pay roles). Optional period YYYY-MM and employee_id.", parameters: { type: "object", properties: { period: { type: "string" }, employee_id: { type: "string" } } } } },
    run: (sb, a) => {
      let x = sb.from("payslips").select("employee_id, period, gross_salary, total_earnings, income_tax, eobi, provident_fund, loan_deduction, total_deductions, net_pay").order("period", { ascending: false }).limit(60);
      if (str(a.period)) x = x.eq("period", a.period as string);
      if (str(a.employee_id)) x = x.eq("employee_id", a.employee_id as string);
      return resN(sb, x);
    },
  },
  {
    def: { type: "function", function: { name: "payroll_runs", description: "Payroll runs with status and totals (pay roles only).", parameters: { type: "object", properties: {} } } },
    run: (sb) => res(sb.from("payroll_runs").select("period, run_type, status, employee_count, total_gross, total_tax, total_net, total_employer_cost, exceptions").order("period", { ascending: false }).limit(12)),
  },
  {
    def: { type: "function", function: { name: "people_analytics", description: "Headcount trend, attrition, hiring funnel, leave, tenure and flight-risk signals for the last 12 months (HR, finance, owners, auditors).", parameters: { type: "object", properties: {} } } },
    run: (sb) => res(sb.rpc("people_analytics", { p_months: 12 })),
  },
  {
    def: { type: "function", function: { name: "org_structure", description: "Departments (with head and headcount) and branches/offices of the company.", parameters: { type: "object", properties: {} } } },
    run: async (sb) => {
      const [d, b, e] = await Promise.all([
        resN(sb, sb.from("departments").select("id, name, code, head_employee_id")),
        res(sb.from("branches").select("name, city, address, geofence_radius_m, is_active")),
        res(sb.from("employees").select("department_id, status").neq("status", "exited")),
      ]);
      const counts: Record<string, number> = {};
      if (Array.isArray(e)) for (const r of e as { department_id: string | null }[]) counts[r.department_id ?? "none"] = (counts[r.department_id ?? "none"] ?? 0) + 1;
      return { departments: Array.isArray(d) ? (d as { id: string }[]).map((x) => ({ ...x, headcount: counts[x.id] ?? 0 })) : d, branches: b };
    },
  },
  {
    def: { type: "function", function: { name: "expenses_and_loans", description: "Expense claims and loans the user may see, optionally by status or employee_id.", parameters: { type: "object", properties: { status: { type: "string" }, employee_id: { type: "string" } } } } },
    run: async (sb, a) => {
      let x = sb.from("expense_claims").select("employee_id, claim_date, category, amount, vendor, status, over_policy").order("claim_date", { ascending: false }).limit(100);
      let y = sb.from("loans").select("employee_id, loan_type, principal, installments, installment_amount, recovered_amount, status").limit(50);
      if (str(a.status)) { x = x.eq("status", a.status as string); y = y.eq("status", a.status as string); }
      if (str(a.employee_id)) { x = x.eq("employee_id", a.employee_id as string); y = y.eq("employee_id", a.employee_id as string); }
      const [claims, loans] = await Promise.all([resN(sb, x), resN(sb, y)]);
      return { expense_claims: claims, loans };
    },
  },
  {
    def: { type: "function", function: { name: "recruitment", description: "Open job requisitions and candidates by stage (recruiters, HR, hiring managers).", parameters: { type: "object", properties: {} } } },
    run: async (sb) => {
      const [jobs, cands] = await Promise.all([
        resN(sb, sb.from("job_requisitions").select("id, title, positions, status, employment_type, created_at, department_id").order("created_at", { ascending: false }).limit(30)),
        res(sb.from("candidates").select("full_name, stage, match_score, experience_years, requisition_id, offer_status").order("created_at", { ascending: false }).limit(150)),
      ]);
      return { requisitions: jobs, candidates: cands };
    },
  },
  {
    def: { type: "function", function: { name: "holidays", description: "Upcoming public and company holidays.", parameters: { type: "object", properties: {} } } },
    run: (sb) => res(sb.from("holidays").select("name, holiday_date, is_tentative").gte("holiday_date", new Date().toISOString().slice(0, 10)).order("holiday_date").limit(20)),
  },
  {
    def: { type: "function", function: { name: "search_policies", description: "Search the company knowledge base and leave policy. Use for any HR policy question.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
    run: async (sb, a) => {
      const words = String(a.query ?? "").split(/\s+/).map(like).filter((w) => w.length > 3).slice(0, 4);
      const [kb, leave] = await Promise.all([
        res(sb.from("kb_articles").select("title, body, category").eq("is_published", true).or(words.length ? words.map((w) => `title.ilike.%${w}%,body.ilike.%${w}%`).join(",") : "title.neq.").limit(6)),
        res(sb.from("leave_types").select("name, code, days_per_year, accrual, is_paid, max_consecutive_days, requires_document_after_days, min_service_days, encashable").eq("is_active", true)),
      ]);
      return { articles: kb, leave_policy: leave };
    },
  },
  {
    def: { type: "function", function: { name: "apply_leave", description: "Submit a leave request for the signed-in user. Call ONLY after the user clearly confirmed leave type code, dates and reason in this chat.", parameters: { type: "object", properties: { leave_code: { type: "string", description: "e.g. AL, CL, SL" }, start_date: { type: "string" }, end_date: { type: "string" }, half_day: { type: "boolean" }, reason: { type: "string" } }, required: ["leave_code", "start_date", "end_date"] } } },
    run: async (sb, a) => {
      const { data: t } = await sb.from("leave_types").select("id").eq("code", String(a.leave_code ?? "").toUpperCase()).maybeSingle();
      if (!t) return { error: "Unknown leave type code" };
      return res(sb.rpc("apply_leave", { p_type: t.id, p_start: a.start_date, p_end: a.end_date, p_half_day: !!a.half_day, p_reason: a.reason ?? null }));
    },
  },
];

export const TOOL_DEFS = T.map((t) => t.def);
export const TOOL_LABEL: Record<string, string> = {
  dashboard_summary: "Reading your dashboard", pending_approvals: "Checking approvals", search_employees: "Searching people", employee_details: "Opening employee record",
  attendance: "Checking attendance", leave_requests: "Checking leave requests", leave_balances: "Checking leave balances", payslips: "Reading payslips",
  payroll_runs: "Reading payroll runs", people_analytics: "Running people analytics", org_structure: "Reading org structure", expenses_and_loans: "Checking expenses and loans",
  recruitment: "Checking recruitment", holidays: "Checking holidays", search_policies: "Searching policies", apply_leave: "Submitting leave request",
};

export async function runTool(sb: SupabaseClient, name: string, args: Record<string, unknown>): Promise<string> {
  const t = T.find((x) => x.def.function.name === name);
  if (!t) return JSON.stringify({ error: "Unknown tool" });
  const out = await t.run(sb, args);
  const empty = out == null || (Array.isArray(out) && out.length === 0);
  return JSON.stringify(empty ? { result: [], note: "No records visible to this user for this request (none exist, or the user's role cannot see them)." } : out);
}
