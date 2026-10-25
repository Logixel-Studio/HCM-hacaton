"use client";
import { useEffect, useRef, useState } from "react";
import { Send, Sparkles, ThumbsDown, ThumbsUp, Wrench } from "lucide-react";
import { Drawer } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { can, type Role } from "@/lib/roles";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string; tools?: string[]; logId?: string; rated?: 1 | -1 };

function suggestions(role: Role | null, hasReports: boolean) {
  const base = ["How many casual leaves do I have left?", "What is the leave policy for sick leave?", "Show my last payslip"];
  if (can.viewPay(role)) return ["Summarise last month's payroll", "Who joined in the last 30 days?", "Which employees are flight risks?"];
  if (can.hrStaff(role)) return ["Who is late today?", "Which documents expire this month?", "How many open positions do we have?"];
  if (hasReports) return ["Who in my team is on leave today?", "What is waiting for my approval?", ...base.slice(0, 1)];
  return base;
}

/** AI copilot drawer. Calls the `copilot` Edge Function with the user's own session, so it can only see what the user can see. */
export function CopilotDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { ctx } = useAuth();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: question.trim() }];
    setMsgs(next); setText(""); setBusy(true);
    try {
      const { data, error } = await supabase().functions.invoke("copilot", { body: { messages: next.map(({ role, content }) => ({ role, content })) } });
      if (error) throw error;
      setMsgs([...next, { role: "assistant", content: data.answer, tools: data.tools, logId: data.log_id }]);
    } catch (e) {
      const m = (e as Error).message || "";
      setMsgs([...next, { role: "assistant", content: /not found|404|Failed to send/i.test(m)
        ? "The AI copilot is not deployed yet. Deploy the `copilot` Edge Function and set the ANTHROPIC_API_KEY secret (see README)."
        : "Sorry, I could not answer that right now. " + m }]);
    } finally { setBusy(false); }
  }

  async function rate(i: number, v: 1 | -1) {
    const m = msgs[i];
    if (!m.logId) return;
    await supabase().from("ai_logs").update({ feedback: v }).eq("id", m.logId);
    setMsgs((all) => all.map((x, j) => (j === i ? { ...x, rated: v } : x)));
  }

  return (
    <Drawer open={open} onClose={onClose} className="max-w-lg" title={<span className="flex items-center gap-2"><span className="brand-gradient flex h-8 w-8 items-center justify-center rounded-xl text-white"><Sparkles className="h-4 w-4" /></span>HR Copilot</span>}
      footer={
        <form className="flex w-full items-end gap-2" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder="Ask about leave, attendance, payroll, policies…"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(text); } }}
            className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-line bg-surface px-4 py-2.5 text-sm text-ink focus:border-brand-400 focus:outline-none" />
          <button type="submit" disabled={busy || !text.trim()} className="brand-gradient flex h-11 w-11 cursor-pointer items-center justify-center rounded-2xl text-white disabled:opacity-50" aria-label="Send"><Send className="h-4 w-4" /></button>
        </form>
      }>
      {msgs.length === 0 ? (
        <div>
          <div className="rounded-3xl bg-brand-50 p-5">
            <p className="font-semibold text-ink">Hi {ctx?.employee?.full_name?.split(" ")[0] ?? "there"} 👋</p>
            <p className="mt-1 text-sm text-ink-soft">I answer from your company&apos;s live data and policies. I can only see what your role can see, and every answer is logged for audit.</p>
          </div>
          <p className="mb-2 mt-6 text-xs font-medium uppercase tracking-wide text-ink-soft">Try asking</p>
          <div className="space-y-2">
            {suggestions(ctx?.role ?? null, !!ctx?.employee?.has_reports).map((s) => (
              <button key={s} onClick={() => ask(s)} className="w-full cursor-pointer rounded-2xl border border-line bg-surface px-4 py-3 text-left text-sm text-ink transition hover:border-brand-300 hover:bg-brand-50">{s}</button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {msgs.map((m, i) => (
            <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[88%] rounded-3xl px-4 py-3 text-sm leading-relaxed", m.role === "user" ? "brand-gradient text-white" : "border border-line bg-surface text-ink")}>
                <p className="whitespace-pre-wrap">{m.content}</p>
                {m.tools && m.tools.length > 0 && <p className="mt-2 flex items-center gap-1 text-[11px] text-ink-soft"><Wrench className="h-3 w-3" />Used: {m.tools.join(", ")}</p>}
                {m.role === "assistant" && m.logId && (
                  <div className="mt-2 flex gap-1">
                    <button onClick={() => rate(i, 1)} className={cn("cursor-pointer rounded-lg p-1 text-ink-soft hover:text-emerald-600", m.rated === 1 && "text-emerald-600")} aria-label="Helpful"><ThumbsUp className="h-3.5 w-3.5" /></button>
                    <button onClick={() => rate(i, -1)} className={cn("cursor-pointer rounded-lg p-1 text-ink-soft hover:text-rose-600", m.rated === -1 && "text-rose-600")} aria-label="Not helpful"><ThumbsDown className="h-3.5 w-3.5" /></button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy && <div className="flex gap-1 px-2">{[0, 1, 2].map((i) => <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-brand-400" style={{ animationDelay: `${i * 120}ms` }} />)}</div>}
          <div ref={end} />
        </div>
      )}
    </Drawer>
  );
}
