// HCM Master Suite · AI copilot (Supabase Edge Function, Deno)
// ─────────────────────────────────────────────────────────────────────────────
// Brief M12 rule: "the copilot can see and do exactly what the user can see and
// do, never more." Every tool below runs through a Supabase client created with
// the CALLER'S JWT, so Row-Level Security applies to each query. The function
// never uses the service-role key.
//
// Deploy:  supabase functions deploy copilot
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   (optional COPILOT_MODEL)
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MODEL = Deno.env.get("COPILOT_MODEL") ?? "claude-sonnet-5-5";

type Tool = { name: string; description: string; input_schema: Record<string, unknown>; run: (sb: SupabaseClient, input: Record<string, unknown>) => Promise<unknown> };

const must = async <T>(p: PromiseLike<{ data: T; error: { message: string } | null }>) => {
  const { data, error } = await p;
  if (error) return { error: error.message };
  return data;
};

const TOOLS: Tool[] = [
  { name: "dashboard", description: "Role-aware summary for the signed-in user: own attendance and leave, team presence (managers), company headcount/attendance/hiring (HR, finance), payroll totals (pay roles).",
    input_schema: { type: "object", properties: {} }, run: (sb) => must(sb.rpc("dashboard_summary")) },
  { name: "leave_balances", description: "Leave balances of the user, or of an employee the user may see (pass employee_id).",
    input_schema: { type: "object", properties: { employee_id: { type: "string" } } }, run: (sb, i) => must(sb.rpc("my_leave_balances", { p_employee: i.employee_id ?? null })) },
  { name: "pending_approvals", description: "Requests waiting for the user's decision (leave, attendance, expenses, payroll…).",
    input_schema: { type: "object", properties: {} }, run: (sb) => must(sb.rpc("my_approvals")) },
  { name: "search_employees", description: "Find employees by name, code or job title. Returns directory fields only.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    run: (sb, i) => must(sb.from("employees").select("id, employee_code, full_name, job_title, status, joining_date, manager_id, department:departments(name)").or(`full_name.ilike.%${i.query}%,employee_code.ilike.%${i.query}%,job_title.ilike.%${i.query}%`).limit(10)) },
  { name: "attendance_on", description: "Attendance records for a date (YYYY-MM-DD) that the user can see (own, team, or company for HR).",
    input_schema: { type: "object", properties: { date: { type: "string" } }, required: ["date"] },
    run: (sb, i) => must(sb.from("attendance_records").select("work_date, status, clock_in_at, clock_out_at, late_minutes, worked_minutes, employee:employees(full_name)").eq("work_date", i.date).limit(200)) },
  { name: "leave_requests", description: "Leave requests the user can see, optionally filtered by status and a date window.",
    input_schema: { type: "object", properties: { status: { type: "string", enum: ["pending", "approved", "rejected", "cancelled"] }, from: { type: "string" }, to: { type: "string" } } },
    run: (sb, i) => { let x = sb.from("leave_requests").select("start_date, end_date, days, status, reason, employee:employees(full_name), type:leave_types(name)").order("start_date", { ascending: false }).limit(100);
      if (i.status) x = x.eq("status", i.status as string); if (i.from) x = x.gte("end_date", i.from as string); if (i.to) x = x.lte("start_date", i.to as string); return must(x); } },
  { name: "payslips", description: "Published payslips of the user (or all payslips for pay roles). Optional period YYYY-MM.",
    input_schema: { type: "object", properties: { period: { type: "string" } } },
    run: (sb, i) => { let x = sb.from("payslips").select("period, gross_salary, total_earnings, income_tax, eobi, provident_fund, loan_deduction, total_deductions, net_pay, lines, employee:employees(full_name)").order("period", { ascending: false }).limit(24); if (i.period) x = x.eq("period", i.period as string); return must(x); } },
  { name: "payroll_runs", description: "Payroll runs with status and totals (pay roles only; others get nothing).",
    input_schema: { type: "object", properties: {} }, run: (sb) => must(sb.from("payroll_runs").select("period, run_type, status, employee_count, total_gross, total_tax, total_net, total_employer_cost, exceptions").order("period", { ascending: false }).limit(12)) },
  { name: "people_analytics", description: "Headcount trend, attrition, hiring funnel, leave, tenure, flight-risk signals (HR, finance, auditors).",
    input_schema: { type: "object", properties: {} }, run: (sb) => must(sb.rpc("people_analytics", { p_months: 12 })) },
  { name: "search_policies", description: "Search the company's HR knowledge base and leave policy. Use for any policy question.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    run: async (sb, i) => {
      const words = String(i.query).split(/\s+/).filter((w) => w.length > 3).slice(0, 4);
      const kb = await must(sb.from("kb_articles").select("title, body, category").eq("is_published", true).or(words.length ? words.map((w) => `title.ilike.%${w}%,body.ilike.%${w}%`).join(",") : "title.neq.").limit(6));
      const leave = await must(sb.from("leave_types").select("name, days_per_year, accrual, is_paid, max_consecutive_days, requires_document_after_days, min_service_days, encashable").eq("is_active", true));
      return { articles: kb, leave_policy: leave };
    } },
  { name: "apply_leave", description: "Submit a leave request for the user. Only call after the user clearly confirmed type and dates.",
    input_schema: { type: "object", properties: { leave_code: { type: "string", description: "e.g. AL, CL, SL" }, start_date: { type: "string" }, end_date: { type: "string" }, half_day: { type: "boolean" }, reason: { type: "string" } }, required: ["leave_code", "start_date", "end_date"] },
    run: async (sb, i) => {
      const { data: t } = await sb.from("leave_types").select("id").eq("code", String(i.leave_code).toUpperCase()).maybeSingle();
      if (!t) return { error: "Unknown leave type" };
      return must(sb.rpc("apply_leave", { p_type: t.id, p_start: i.start_date, p_end: i.end_date, p_half_day: !!i.half_day, p_reason: i.reason ?? null }));
    } },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const started = Date.now();
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Not signed in" }, 401);
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: ctx, error: ctxErr } = await sb.rpc("my_context");
    if (ctxErr || !ctx?.tenant) return json({ error: "No active company" }, 403);
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "ANTHROPIC_API_KEY is not set for the copilot function" }, 500);

    const { messages } = await req.json() as { messages: { role: "user" | "assistant"; content: string }[] };
    const history = messages.slice(-12);
    const today = new Date().toISOString().slice(0, 10);
    const system = `You are the HR copilot inside HCM Master Suite for ${ctx.tenant.name} (Pakistan, currency PKR, timezone ${ctx.tenant.timezone}).
The user is ${ctx.full_name ?? ctx.email}, role: ${ctx.role}${ctx.employee ? `, employee ${ctx.employee.full_name} (${ctx.employee.code})` : ""}. Today is ${today}.
Rules:
- Answer only from tool results and company policy articles. Never invent numbers, names or policies. If data is missing, say so.
- Tools run with the user's own permissions. If a tool returns nothing or an error, the user probably lacks access: say politely that this is outside their access.
- Never reveal salaries or personal data the tools did not return.
- Before any action (apply_leave), restate the details and only act after the user clearly confirms.
- Be concise and practical. Use short paragraphs or simple lists. Show PKR amounts with thousands separators.`;

    const tools = TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
    const convo: { role: string; content: unknown }[] = history.map((m) => ({ role: m.role, content: m.content }));
    const used: string[] = [];
    let answer = ""; let inTok = 0; let outTok = 0;

    for (let step = 0; step < 6; step++) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 1200, system, tools, messages: convo }),
      });
      if (!r.ok) return json({ error: `AI service error ${r.status}: ${(await r.text()).slice(0, 200)}` }, 502);
      const out = await r.json();
      inTok += out.usage?.input_tokens ?? 0; outTok += out.usage?.output_tokens ?? 0;
      convo.push({ role: "assistant", content: out.content });
      const calls = (out.content as { type: string; id: string; name: string; input: Record<string, unknown>; text?: string }[]).filter((c) => c.type === "tool_use");
      answer = (out.content as { type: string; text?: string }[]).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
      if (out.stop_reason !== "tool_use" || !calls.length) break;
      const results = [];
      for (const c of calls) {
        const tool = TOOLS.find((t) => t.name === c.name);
        used.push(c.name);
        let result: unknown;
        try { result = tool ? await tool.run(sb, c.input ?? {}) : { error: "Unknown tool" }; } catch (e) { result = { error: String(e) }; }
        results.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(result).slice(0, 30000) });
      }
      convo.push({ role: "user", content: results });
    }

    const { data: log } = await sb.from("ai_logs").insert({
      question: history.at(-1)?.content ?? "", tools_called: used, answer, model: MODEL, input_tokens: inTok, output_tokens: outTok, latency_ms: Date.now() - started,
    }).select("id").single();
    return json({ answer: answer || "I could not find an answer to that.", tools: Array.from(new Set(used)), log_id: log?.id ?? null });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
