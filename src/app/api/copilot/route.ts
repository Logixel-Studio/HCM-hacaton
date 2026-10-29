import { aiReady, providers, streamChat, type Msg } from "@/lib/server/llm";
import { bearer, userClient } from "@/lib/server/supabase";
import { TOOL_DEFS, TOOL_LABEL, runTool } from "@/lib/server/copilot-tools";

/*
 * AI copilot chat. Streams NDJSON lines: meta, model, tool, delta, done, error.
 * The person's own Supabase session is used for every lookup, so answers follow their role exactly:
 * owners and HR get company data, managers their team, employees only their own records.
 * Chats are stored per person (ai_conversations / ai_messages) and the recent history is sent with each turn,
 * so follow-up questions keep their context.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const enc = new TextEncoder();
const line = (o: object) => enc.encode(JSON.stringify(o) + "\n");
const fail = (v: string, status = 400) => new Response(JSON.stringify({ t: "error", v }) + "\n", { status, headers: { "content-type": "application/x-ndjson" } });

const ROLE_SCOPE: Record<string, string> = {
  company_owner: "the whole company, including every employee's records, salaries and payroll",
  company_admin: "the whole company, including salaries and payroll",
  hr_director: "every employee's HR records, salaries and payroll",
  hr_manager: "every employee's HR records, salaries and payroll in their scope",
  hr_executive: "employee HR records in their scope (not salaries)",
  payroll_officer: "salaries, payroll and payslips of all employees",
  finance_controller: "payroll totals, salaries, expenses and loans",
  recruiter: "recruitment: requisitions and candidates",
  hiring_manager: "their requisitions and candidates, plus their own records",
  line_manager: "their direct and indirect reports (attendance, leave, performance) plus their own records",
  employee: "only their own records",
  auditor: "read-only access to company records for audit",
  platform_super_admin: "platform administration",
};

type Ctx = { user_id: string; email: string; full_name: string | null; role: string | null; prefs?: Record<string, unknown>;
  tenant: { name: string; currency?: string; timezone?: string } | null; employee: { full_name: string; code: string; job_title: string | null } | null };

function systemPrompt(ctx: Ctx, base: string) {
  const prefs = (ctx.prefs ?? {}) as { ai?: { style?: string; lang?: string; memory?: string[] } };
  const style = prefs.ai?.style === "detailed" ? "Give complete, well-structured answers with short headings when useful." : "Be concise: lead with the answer, then the key numbers.";
  const lang = prefs.ai?.lang === "ur" ? "Reply in Urdu script." : prefs.ai?.lang === "roman" ? "Reply in Roman Urdu (Urdu written in English letters)." : prefs.ai?.lang === "en" ? "Reply in English." : "Reply in the same language the user writes in (English, Urdu or Roman Urdu).";
  const memory = (prefs.ai?.memory ?? []).filter(Boolean).slice(0, 20);
  const role = String(ctx.role ?? "employee");
  return `You are the AI copilot inside HCM Master Suite, an HR, attendance, leave and payroll platform, for the company "${ctx.tenant?.name}" (currency ${ctx.tenant?.currency ?? "PKR"}, time zone ${ctx.tenant?.timezone ?? "Asia/Karachi"}).
Today is ${new Date().toISOString().slice(0, 10)}.
You are talking to ${ctx.full_name ?? ctx.email} (${ctx.email}), role: ${role.replace(/_/g, " ")}${ctx.employee ? `, employee ${ctx.employee.full_name} (${ctx.employee.code}, ${ctx.employee.job_title ?? ""})` : ", no employee record"}.
This role can see: ${ROLE_SCOPE[role] ?? "data allowed by their role"}.

How data access works (important):
- Every tool runs with this user's own permissions; the database (row-level security) has already removed anything they are not allowed to see.
- So anything a tool returns IS allowed for this user. Share it fully and directly, including other employees' details when the tool returned them. Never refuse with "I can't share other people's data" when the data came back.
- If a tool returns nothing or "Not visible to this user", say plainly that this information is not available for their role (or that no record exists). Never guess, never invent names, numbers or policies.
- When a person is named, call search_employees first, then employee_details with the id. For "my" questions, use the user's own data.
- Use earlier messages in this chat for follow-ups ("and his leave?", "what about last month?").
- apply_leave is the only action. Restate type, dates and reason and wait for a clear "yes" in the chat before calling it.

Style: ${style} ${lang} Use Markdown (bold, short lists, small tables for comparisons). Show money with thousands separators and the currency. Dates like 25 Oct 2026.${memory.length ? `\nThings the user asked you to remember:\n- ${memory.join("\n- ")}` : ""}

Snapshot of the user's dashboard (role-filtered), useful when tools are unavailable:
${base}`;
}

export async function POST(req: Request) {
  const token = bearer(req);
  if (!token) return fail("Please sign in again.", 401);
  const sb = userClient(token);
  const { data: ctxData, error: ce } = await sb.rpc("my_context");
  const ctx = ctxData as Ctx | null;
  if (ce || !ctx?.user_id) return fail("Your session has expired. Sign in again.", 401);
  if (!ctx.tenant) return fail("Open a company first.", 403);

  const body = (await req.json().catch(() => ({}))) as { conversationId?: string; text?: string; regenerate?: boolean; editMessageId?: string };
  let convId = typeof body.conversationId === "string" ? body.conversationId : "";
  let text = String(body.text ?? "").trim().slice(0, 4000);

  const { count } = await sb.from("ai_messages").select("id", { count: "exact", head: true }).eq("role", "user").gte("created_at", new Date(Date.now() - 10 * 60e3).toISOString());
  if ((count ?? 0) > 40) return fail("You’ve sent a lot of messages. Take a short break and try again in a few minutes.", 429);

  if (convId) { const { data } = await sb.from("ai_conversations").select("id").eq("id", convId).maybeSingle(); if (!data) convId = ""; }
  if ((body.regenerate || body.editMessageId) && !convId) return fail("This chat no longer exists.");

  if (body.regenerate && convId) {
    const { data: last } = await sb.from("ai_messages").select("id, role, content").eq("conversation_id", convId).order("created_at", { ascending: false }).limit(2);
    const a = last?.[0], u = last?.[1];
    if (a?.role === "assistant") await sb.from("ai_messages").delete().eq("id", a.id);
    text = (a?.role === "user" ? a.content : u?.role === "user" ? u.content : text) as string;
  }
  let userMessageId: string | undefined;
  if (body.editMessageId && convId) {
    const { data: m } = await sb.from("ai_messages").select("id, created_at, role").eq("id", body.editMessageId).eq("conversation_id", convId).maybeSingle();
    if (!m || m.role !== "user") return fail("That message can’t be edited.");
    if (!text) return fail("Type a message first.");
    await sb.from("ai_messages").delete().eq("conversation_id", convId).gt("created_at", m.created_at);
    await sb.from("ai_messages").update({ content: text }).eq("id", m.id);
    userMessageId = m.id as string;
  }
  if (!text) return fail("Type a message first.");

  if (!convId) {
    const title = text.replace(/\s+/g, " ").slice(0, 60);
    const { data, error } = await sb.from("ai_conversations").insert({ title }).select("id").single();
    if (error || !data) return fail(/does not exist|schema cache/i.test(error?.message ?? "") ? "Run migration 0014 in Supabase to turn on AI chat history." : error?.message ?? "Could not start a chat", 500);
    convId = data.id as string;
  }
  if (!body.regenerate && !body.editMessageId) {
    const { data: um } = await sb.from("ai_messages").insert({ conversation_id: convId, role: "user", content: text }).select("id").single();
    userMessageId = um?.id as string | undefined;
  }
  await sb.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);

  const { data: hist } = await sb.from("ai_messages").select("role, content").eq("conversation_id", convId).order("created_at", { ascending: false }).limit(20);
  const history: Msg[] = (hist ?? []).reverse().map((m) => ({ role: m.role as "user" | "assistant", content: String(m.content).slice(0, 6000) }));
  const { data: dash } = await sb.rpc("dashboard_summary");
  const base = JSON.stringify(dash ?? {}).slice(0, 6000);
  const messages: Msg[] = [{ role: "system", content: systemPrompt(ctx, base) }, ...history];

  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort());
  const started = Date.now();

  const stream = new ReadableStream({
    async start(c) {
      let answer = "", model = "HCM copilot";
      const tools: string[] = [];
      const save = async () => {
        if (!answer.trim()) return null;
        const { data } = await sb.from("ai_messages").insert({ conversation_id: convId, role: "assistant", content: answer, model, meta: { tools } }).select("id").single();
        await sb.from("ai_logs").insert({ question: text, tools_called: tools, answer, model, latency_ms: Date.now() - started }).then(() => null, () => null);
        return (data?.id as string | undefined) ?? null;
      };
      try {
        c.enqueue(line({ t: "meta", conversationId: convId, userMessageId }));
        if (!aiReady()) {
          answer = "The AI copilot is not connected yet. An admin needs to add a free **GROQ_API_KEY** (and optionally **OPENROUTER_API_KEY** as a backup) in the hosting settings and redeploy. Until then, everything is still available from the menu on the left.";
          c.enqueue(line({ t: "model", v: model })); c.enqueue(line({ t: "delta", v: answer }));
        } else {
          for await (const ev of streamChat(messages, TOOL_DEFS, (n, a) => runTool(sb, n, a), ac.signal)) {
            if (ev.model) { model = ev.model; c.enqueue(line({ t: "model", v: model })); }
            if (ev.tool) { tools.push(ev.tool.name); c.enqueue(line({ t: "tool", v: TOOL_LABEL[ev.tool.name] ?? ev.tool.name })); }
            if (ev.text) { answer += ev.text; c.enqueue(line({ t: "delta", v: ev.text })); }
          }
        }
        const id = await save();
        c.enqueue(line({ t: "done", messageId: id }));
      } catch (e) {
        if (ac.signal.aborted) { await save(); return; }
        c.enqueue(line({ t: "error", v: (e as Error).message }));
      } finally { try { c.close(); } catch { /* already closed */ } }
    },
    cancel() { ac.abort(); },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}

/** Is AI connected, and which free models are used (for Settings → AI & Copilot). */
export async function GET() {
  return Response.json({ ai: aiReady(), providers: providers().map((p) => ({ name: p.name, models: p.models })) });
}
