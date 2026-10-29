"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp, Check, Copy, History, Maximize2, MessageSquarePlus, Minimize2, Pencil, Pin, PinOff, RefreshCw, Search, Sparkles,
  Square, ThumbsDown, ThumbsUp, Trash2, Wrench, X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { can, ROLE_INFO, type Role } from "@/lib/roles";
import { md } from "@/lib/md";
import { cn } from "@/lib/utils";

type Msg = { key: string; id?: string; role: "user" | "assistant"; content: string; model?: string | null; tools?: string[]; feedback?: number; streaming?: boolean; error?: boolean };
type Conv = { id: string; title: string; pinned: boolean; updated_at: string };

let seq = 0;
const k = () => `m${++seq}`;

function suggestions(role: Role | null, hasReports: boolean, hasEmployee: boolean): string[] {
  if (role === "company_owner" || role === "company_admin") return ["Give me a company snapshot for today", "Who is on leave this week?", "Summarise last month's payroll cost", "Which employees are flight risks?"];
  if (can.viewPay(role)) return ["Summarise the latest payroll run", "Which payslips have the highest tax?", "Show salary history of an employee", "Pending expense claims"];
  if (can.hrStaff(role)) return ["Who is late today?", "Pending leave requests", "Who joined in the last 30 days?", "How many open positions do we have?"];
  if (can.recruiting(role)) return ["Which candidates are in interview stage?", "Open requisitions and positions", "Top matches for our open jobs"];
  if (hasReports) return ["Who in my team is on leave today?", "What is waiting for my approval?", "Team attendance this week", "How many casual leaves do I have left?"];
  if (hasEmployee) return ["How many casual leaves do I have left?", "Show my last payslip", "What is the sick leave policy?", "My attendance this month"];
  return ["What can you help me with?", "Explain the leave policy", "Upcoming holidays"];
}

async function token() { const { data } = await supabase().auth.getSession(); return data.session?.access_token ?? ""; }
async function copyText(t: string) { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } }
function groupOf(c: Conv) {
  if (c.pinned) return "Pinned";
  const d = (Date.now() - new Date(c.updated_at).getTime()) / 864e5;
  return d < 1 ? "Today" : d < 2 ? "Yesterday" : d < 7 ? "Previous 7 days" : "Older";
}

/**
 * AI copilot: a full chat with history. Answers stream in; every lookup runs with the person's own permissions.
 * Features: context-aware follow-ups, copy, regenerate, like/dislike, edit and resend, stop, rename, pin, delete, search.
 */
export function CopilotDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { ctx, navCtx } = useAuth();
  const [view, setView] = useState<"chat" | "history">("chat");
  const [full, setFull] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [conv, setConv] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [convs, setConvs] = useState<Conv[] | null>(null);
  const [filter, setFilter] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [editing, setEditing] = useState<{ key: string; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [ai, setAi] = useState<boolean | null>(null);
  const body = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null), abort = useRef<AbortController | null>(null), stick = useRef(true);
  const firstName = (ctx?.employee?.full_name ?? ctx?.full_name ?? "").split(" ")[0];
  const sugg = useMemo(() => suggestions(ctx?.role ?? null, navCtx.hasReports, navCtx.hasEmployee), [ctx?.role, navCtx.hasReports, navCtx.hasEmployee]);

  useEffect(() => { if (open && view === "chat") setTimeout(() => input.current?.focus(), 80); }, [open, view]);
  useEffect(() => { if (stick.current) body.current?.scrollTo({ top: body.current.scrollHeight }); }, [msgs, status]);
  useEffect(() => { const t = input.current; if (t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 160) + "px"; } }, [text]);
  useEffect(() => {
    if (!open) return;
    const kd = (e: KeyboardEvent) => { if (e.key === "Escape" && !editing && !renaming) onClose(); };
    addEventListener("keydown", kd); return () => removeEventListener("keydown", kd);
  }, [open, onClose, editing, renaming]);
  useEffect(() => { if (open && ai === null) fetch("/api/copilot").then((r) => r.json()).then((j) => setAi(!!j.ai)).catch(() => setAi(false)); }, [open, ai]);

  const loadList = useCallback(async () => {
    const { data } = await supabase().from("ai_conversations").select("id, title, pinned, updated_at").order("pinned", { ascending: false }).order("updated_at", { ascending: false }).limit(100);
    setConvs((data as Conv[]) ?? []);
  }, []);
  useEffect(() => { if (open && view === "history") loadList(); }, [open, view, loadList]);

  async function openConv(id: string) {
    abort.current?.abort();
    setView("chat"); setConv(id); setMsgs([]); setStatus("Loading chat…");
    const { data } = await supabase().from("ai_messages").select("id, role, content, model, feedback, meta").eq("conversation_id", id).order("created_at").limit(300);
    setStatus(null);
    setMsgs(((data ?? []) as { id: string; role: "user" | "assistant"; content: string; model: string | null; feedback: number; meta: { tools?: string[] } }[])
      .map((m) => ({ key: k(), id: m.id, role: m.role, content: m.content, model: m.model, feedback: m.feedback, tools: m.meta?.tools })));
  }
  function newChat() { abort.current?.abort(); setConv(null); setMsgs([]); setView("chat"); setText(""); setEditing(null); setTimeout(() => input.current?.focus(), 60); }

  async function send(q: string, opts: { regenerate?: boolean; editKey?: string } = {}) {
    q = q.trim();
    if ((!q && !opts.regenerate) || busy) return;
    const aKey = k(); stick.current = true;
    const editMsg = opts.editKey ? msgs.find((m) => m.key === opts.editKey) : undefined;
    setMsgs((m) => {
      if (opts.regenerate) return [...m.slice(0, m.length - 1), { key: aKey, role: "assistant", content: "", streaming: true }];
      if (opts.editKey) { const i = m.findIndex((x) => x.key === opts.editKey); return [...m.slice(0, i), { ...m[i], content: q }, { key: aKey, role: "assistant", content: "", streaming: true }]; }
      return [...m, { key: k(), role: "user", content: q }, { key: aKey, role: "assistant", content: "", streaming: true }];
    });
    setText(""); setEditing(null); setBusy(true); setStatus("Thinking…");
    const ac = new AbortController(); abort.current = ac;
    const patch = (f: (m: Msg) => Msg) => setMsgs((ms) => ms.map((m) => (m.key === aKey ? f(m) : m)));
    try {
      const r = await fetch("/api/copilot", {
        method: "POST", signal: ac.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ conversationId: conv, text: q, regenerate: !!opts.regenerate, editMessageId: editMsg?.id }),
      });
      if (!r.body) throw new Error("No answer");
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const ln = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!ln.trim()) continue;
          const ev = JSON.parse(ln) as { t: string; v?: string; conversationId?: string; userMessageId?: string; messageId?: string | null };
          if (ev.t === "meta") {
            if (ev.conversationId) setConv(ev.conversationId);
            if (ev.userMessageId) setMsgs((ms) => { const idx = ms.findIndex((m) => m.key === aKey); return ms.map((m, j) => (j === idx - 1 && m.role === "user" ? { ...m, id: ev.userMessageId } : m)); });
          } else if (ev.t === "model") patch((m) => ({ ...m, model: ev.v }));
          else if (ev.t === "tool") { setStatus(`${ev.v}…`); patch((m) => ({ ...m, tools: [...(m.tools ?? []), ev.v ?? ""] })); }
          else if (ev.t === "delta") { setStatus(null); patch((m) => ({ ...m, content: m.content + (ev.v ?? "") })); }
          else if (ev.t === "done") patch((m) => ({ ...m, id: ev.messageId ?? m.id }));
          else if (ev.t === "error") patch((m) => ({ ...m, content: ev.v ?? "Something went wrong.", error: true }));
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") patch((m) => ({ ...m, content: m.content || "I couldn’t reach the copilot. Check your connection and try again.", error: true }));
    } finally {
      patch((m) => ({ ...m, streaming: false, content: m.content || (ac.signal.aborted ? "_Stopped._" : m.content) }));
      setBusy(false); setStatus(null); abort.current = null; setConvs(null);
    }
  }

  async function rate(m: Msg, v: 1 | -1) {
    if (!m.id) return;
    const next = m.feedback === v ? 0 : v;
    setMsgs((ms) => ms.map((x) => (x.key === m.key ? { ...x, feedback: next } : x)));
    const { error } = await supabase().from("ai_messages").update({ feedback: next }).eq("id", m.id);
    if (error) toast.error("Could not save your feedback");
    else if (next) toast.success(next === 1 ? "Thanks for the feedback" : "Thanks — this helps improve answers");
  }
  async function copy(m: Msg) { if (await copyText(m.content)) { setCopied(m.key); setTimeout(() => setCopied(null), 1500); } }
  async function del(id: string) { await supabase().from("ai_conversations").delete().eq("id", id); if (id === conv) newChat(); loadList(); }
  async function pin(c: Conv) { await supabase().from("ai_conversations").update({ pinned: !c.pinned }).eq("id", c.id); loadList(); }
  async function rename() {
    if (!renaming) return;
    await supabase().from("ai_conversations").update({ title: renaming.title.trim().slice(0, 80) || "Chat" }).eq("id", renaming.id);
    setRenaming(null); loadList();
  }

  const lastA = [...msgs].reverse().find((m) => m.role === "assistant");
  const shown = (convs ?? []).filter((c) => c.title.toLowerCase().includes(filter.toLowerCase()));
  const groups = ["Pinned", "Today", "Yesterday", "Previous 7 days", "Older"].map((g) => ({ g, items: shown.filter((c) => groupOf(c) === g) })).filter((x) => x.items.length);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex justify-end" data-copilot>
      <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px] animate-fade-up" onClick={onClose} />
      <section role="dialog" aria-modal="true" aria-label="AI copilot"
        className={cn("relative flex h-full w-full flex-col bg-canvas shadow-pop animate-slidein transition-[max-width] duration-300", full ? "max-w-none" : "sm:max-w-[520px]")}>
        <header className="flex items-center gap-1.5 border-b border-line bg-surface px-3 py-3">
          <button onClick={() => setView((v) => (v === "history" ? "chat" : "history"))} className={cn("cursor-pointer rounded-xl p-2 text-ink-soft transition hover:bg-surface-muted hover:text-ink", view === "history" && "bg-surface-muted text-ink")} aria-label="Chat history" title="Chat history"><History className="h-[18px] w-[18px]" /></button>
          <div className="ml-1 min-w-0 flex-1">
            <p className="flex items-center gap-1.5 font-display text-[15px] font-semibold text-ink"><Sparkles className="h-4 w-4 text-brand-500" />{view === "history" ? "Your chats" : "AI Copilot"}</p>
            <p className="truncate text-[11px] text-ink-soft">{ai === false ? "Not connected yet" : `Sees what ${ctx?.role ? ROLE_INFO[ctx.role].label : "you"} can see · ${ctx?.tenant?.name ?? ""}`}</p>
          </div>
          <button onClick={newChat} className="cursor-pointer rounded-xl p-2 text-ink-soft transition hover:bg-surface-muted hover:text-ink" aria-label="New chat" title="New chat"><MessageSquarePlus className="h-[18px] w-[18px]" /></button>
          <button onClick={() => setFull((f) => !f)} className="hidden cursor-pointer rounded-xl p-2 text-ink-soft transition hover:bg-surface-muted hover:text-ink sm:block" aria-label={full ? "Exit full screen" : "Full screen"} title={full ? "Exit full screen" : "Full screen"}>{full ? <Minimize2 className="h-[18px] w-[18px]" /> : <Maximize2 className="h-[18px] w-[18px]" />}</button>
          <button onClick={onClose} className="cursor-pointer rounded-xl p-2 text-ink-soft transition hover:bg-surface-muted hover:text-ink" aria-label="Close"><X className="h-[18px] w-[18px]" /></button>
        </header>

        {view === "history" ? (
          <div className="flex-1 overflow-y-auto p-3">
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search chats" className="h-10 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink focus:border-brand-400 focus:outline-none" />
            </div>
            <button onClick={newChat} className="brand-gradient mb-4 inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white"><MessageSquarePlus className="h-4 w-4" />New chat</button>
            {convs === null ? <p className="py-10 text-center text-sm text-ink-soft">Loading…</p>
              : groups.length === 0 ? <p className="py-10 text-center text-sm text-ink-soft">{filter ? "No chats match." : "No chats yet. Ask anything about your company."}</p>
              : groups.map(({ g, items }) => (
                <div key={g} className="mb-4">
                  <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-soft/80">{g}</p>
                  {items.map((c) => (
                    <div key={c.id} className={cn("group flex items-center gap-1 rounded-xl px-2 py-1.5 transition hover:bg-surface", c.id === conv && "bg-surface shadow-soft")}>
                      {renaming?.id === c.id ? (
                        <input autoFocus value={renaming.title} onChange={(e) => setRenaming({ ...renaming, title: e.target.value })} onBlur={rename}
                          onKeyDown={(e) => { if (e.key === "Enter") rename(); if (e.key === "Escape") setRenaming(null); }} className="h-8 flex-1 rounded-lg border border-brand-300 bg-surface px-2 text-sm text-ink focus:outline-none" />
                      ) : (
                        <button onClick={() => openConv(c.id)} className="min-w-0 flex-1 cursor-pointer truncate py-1 text-left text-sm text-ink">{c.title}</button>
                      )}
                      <span className="flex shrink-0 opacity-0 transition group-hover:opacity-100 max-sm:opacity-100">
                        <button onClick={() => pin(c)} className="cursor-pointer rounded-lg p-1.5 text-ink-soft hover:text-ink" aria-label={c.pinned ? "Unpin" : "Pin"} title={c.pinned ? "Unpin" : "Pin"}>{c.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}</button>
                        <button onClick={() => setRenaming({ id: c.id, title: c.title })} className="cursor-pointer rounded-lg p-1.5 text-ink-soft hover:text-ink" aria-label="Rename" title="Rename"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => del(c.id)} className="cursor-pointer rounded-lg p-1.5 text-ink-soft hover:text-rose-600" aria-label="Delete" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                      </span>
                    </div>
                  ))}
                </div>
              ))}
          </div>
        ) : (
          <div ref={body} className="flex-1 overflow-y-auto px-4 py-5" aria-live="polite" onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
            {msgs.length === 0 && !status ? (
              <div className={cn("mx-auto flex flex-col items-center pt-8 text-center", full && "max-w-2xl")}>
                <div className="relative">
                  <div className="brand-gradient absolute -inset-3 rounded-[28px] opacity-25 blur-xl" />
                  <div className="brand-gradient relative flex h-16 w-16 items-center justify-center rounded-3xl text-white shadow-lg"><Sparkles className="h-8 w-8" /></div>
                </div>
                <h3 className="mt-5 font-display text-xl font-bold text-ink">{firstName ? `Hi ${firstName}, how can I help?` : "How can I help?"}</h3>
                <p className="mt-1.5 max-w-sm text-sm text-ink-soft">Ask about people, attendance, leave, payroll or policies in English, Urdu or Roman Urdu. I only use data your role can see.</p>
                <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
                  {sugg.map((s) => (
                    <button key={s} onClick={() => send(s)} className="cursor-pointer rounded-2xl border border-line bg-surface px-4 py-3 text-left text-sm text-ink transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-soft">{s}</button>
                  ))}
                </div>
                {ai === false && <p className="mt-6 rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">AI answers turn on when an admin adds a free GROQ_API_KEY in the hosting settings.</p>}
              </div>
            ) : (
              <div className={cn("mx-auto space-y-5", full && "max-w-3xl")}>
                {msgs.map((m) => m.role === "user" ? (
                  <div key={m.key} className="group flex justify-end">
                    {editing?.key === m.key ? (
                      <div className="w-full max-w-[85%] rounded-2xl border border-brand-300 bg-surface p-2">
                        <textarea autoFocus value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} rows={3} className="w-full resize-none bg-transparent p-1 text-sm text-ink focus:outline-none" />
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setEditing(null)} className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-surface-muted">Cancel</button>
                          <button onClick={() => send(editing.text, { editKey: m.key })} disabled={!editing.text.trim() || busy} className="brand-gradient cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Save & send</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex max-w-[85%] items-start gap-1">
                        {!busy && m.id && <button onClick={() => setEditing({ key: m.key, text: m.content })} className="mt-1.5 cursor-pointer rounded-lg p-1.5 text-ink-soft opacity-0 transition hover:text-ink group-hover:opacity-100" aria-label="Edit message" title="Edit"><Pencil className="h-3.5 w-3.5" /></button>}
                        <div className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-sm text-white">{m.content}</div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div key={m.key} className="flex gap-3">
                    <span className="brand-gradient mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white"><Sparkles className="h-3.5 w-3.5" /></span>
                    <div className="min-w-0 flex-1">
                      {m.tools && m.tools.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1">{[...new Set(m.tools)].map((t) => <span key={t} className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-[10.5px] text-ink-soft"><Wrench className="h-3 w-3" />{t}</span>)}</div>
                      )}
                      {m.streaming && !m.content ? (
                        <div className="flex items-center gap-2 py-1.5 text-sm text-ink-soft">
                          <span className="flex gap-1">{[0, 1, 2].map((d) => <i key={d} className="typing-dot h-1.5 w-1.5 rounded-full bg-brand-500" style={{ animationDelay: `${d * 0.15}s` }} />)}</span>{status}
                        </div>
                      ) : (
                        <div className={cn("md", m.error && "text-rose-600")} dangerouslySetInnerHTML={{ __html: md(m.content) + (m.streaming ? '<span class="caret"></span>' : "") }} />
                      )}
                      {!m.streaming && m.content && (
                        <div className="mt-2 flex flex-wrap items-center gap-0.5 text-ink-soft">
                          <button onClick={() => copy(m)} className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs transition hover:bg-surface-muted hover:text-ink" aria-label="Copy">{copied === m.key ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}{copied === m.key ? "Copied" : "Copy"}</button>
                          {m === lastA && !busy && <button onClick={() => send("", { regenerate: true })} className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs transition hover:bg-surface-muted hover:text-ink" aria-label="Regenerate"><RefreshCw className="h-3.5 w-3.5" />Regenerate</button>}
                          {m.id && !m.error && <>
                            <button onClick={() => rate(m, 1)} className={cn("cursor-pointer rounded-lg p-1.5 transition hover:bg-surface-muted hover:text-ink", m.feedback === 1 && "text-emerald-600")} aria-label="Good answer" aria-pressed={m.feedback === 1}><ThumbsUp className="h-3.5 w-3.5" /></button>
                            <button onClick={() => rate(m, -1)} className={cn("cursor-pointer rounded-lg p-1.5 transition hover:bg-surface-muted hover:text-ink", m.feedback === -1 && "text-rose-600")} aria-label="Bad answer" aria-pressed={m.feedback === -1}><ThumbsDown className="h-3.5 w-3.5" /></button>
                          </>}
                          {m.model && <span className="ml-auto truncate text-[10.5px] text-ink-soft/70">{m.model}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {view === "chat" && (
          <div className="border-t border-line bg-surface px-3 pb-3 pt-3">
            <form onSubmit={(e) => { e.preventDefault(); send(text); }} className={cn("mx-auto flex items-end gap-2 rounded-2xl border border-line bg-canvas p-2 transition focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-500/10", full && "max-w-3xl")}>
              <textarea ref={input} rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask anything about your company…" aria-label="Message the AI copilot"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(text); } }}
                className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-ink placeholder:text-ink-soft/70 focus:outline-none" />
              {busy ? (
                <button type="button" onClick={() => abort.current?.abort()} className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-ink text-canvas" aria-label="Stop"><Square className="h-3.5 w-3.5 fill-current" /></button>
              ) : (
                <button type="submit" disabled={!text.trim()} className="brand-gradient flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-white transition disabled:cursor-not-allowed disabled:opacity-40" aria-label="Send"><ArrowUp className="h-[18px] w-[18px]" /></button>
              )}
            </form>
            <p className="mt-2 text-center text-[10.5px] text-ink-soft/80">Answers use your company data within your role and can make mistakes. Enter to send · Shift+Enter for a new line</p>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
