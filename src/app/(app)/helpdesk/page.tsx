"use client";
import { useMemo, useState } from "react";
import { BookOpen, Clock, LifeBuoy, Lock, Plus, Send, Star } from "lucide-react";
import { Avatar, Badge, Button, Card, Dialog, Drawer, Field, Input, Select, Tabs, Textarea } from "@/components/ui";
import { DataTable, EmptyState, PageHeader, SearchInput, StatusBadge } from "@/components/common";
import { byId, useEmployees } from "@/lib/lookups";
import { q, rpc, useAction, useRows } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { can } from "@/lib/roles";
import { ago, fmtDateTime, title } from "@/lib/format";
import { cn } from "@/lib/utils";

type Ticket = { id: string; ticket_no: string; employee_id: string; category: string; subject: string; description: string | null; priority: string; status: string; assigned_to: string | null; sla_due_at: string; resolution: string | null; resolved_at: string | null; satisfaction: number | null; created_at: string };
type Comment = { id: string; ticket_id: string; author_id: string; body: string; is_internal: boolean; created_at: string };
type Article = { id: string; title: string; body: string; category: string; is_published: boolean; updated_at: string };
const CATS = ["payroll", "leave", "attendance", "documents", "benefits", "policy", "it", "general"];

function TicketDrawer({ t, onClose }: { t: Ticket | null; onClose: () => void }) {
  const { role, employeeId, ctx } = useMe();
  const staff = can.hrStaff(role) || (t?.category === "payroll" && can.runPayroll(role));
  const { data: emps = [] } = useEmployees(); const E = byId(emps);
  const { data: comments = [] } = useRows<Comment[]>(["helpdesk", "comments", t?.id], (sb) => sb.from("ticket_comments").select("*").eq("ticket_id", t!.id).order("created_at"), { enabled: !!t });
  const [body, setBody] = useState(""); const [internal, setInternal] = useState(false); const [resolution, setResolution] = useState("");
  const post = useAction(() => q((sb) => sb.from("ticket_comments").insert({ ticket_id: t!.id, body, is_internal: internal })), { invalidate: ["helpdesk"], onDone: () => setBody("") });
  const update = useAction((patch: Partial<Ticket>) => q((sb) => sb.from("hr_tickets").update(patch).eq("id", t!.id)), { success: "Ticket updated", invalidate: ["helpdesk"] });
  const rate = useAction((n: number) => rpc("rate_ticket", { p_ticket: t!.id, p_rating: n }), { success: "Thanks for the rating", invalidate: ["helpdesk"], onDone: onClose });
  if (!t) return null;
  const breached = !["resolved", "closed"].includes(t.status) && new Date(t.sla_due_at) < new Date();
  return (
    <Drawer open={!!t} onClose={onClose} className="max-w-xl" title={<span>{t.ticket_no} · {t.subject}</span>}
      footer={!["closed"].includes(t.status) ? (
        <div className="w-full space-y-2">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a reply…" rows={2} />
          <div className="flex items-center justify-between">{staff ? <label className="flex items-center gap-2 text-xs text-ink-soft"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />Internal note</label> : <span />}<Button size="sm" onClick={() => post.mutate()} disabled={!body.trim()} loading={post.isPending}><Send className="h-4 w-4" />Send</Button></div>
        </div>
      ) : undefined}>
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2"><StatusBadge status={t.status} /><StatusBadge status={t.priority} /><Badge>{title(t.category)}</Badge>{breached && <Badge tone="rose">SLA breached</Badge>}</div>
        <div className="rounded-2xl bg-surface-muted p-4"><p className="text-xs text-ink-soft">{E.get(t.employee_id)?.full_name} · {fmtDateTime(t.created_at)}</p><p className="mt-2 whitespace-pre-wrap text-sm text-ink">{t.description ?? "—"}</p></div>
        <p className="flex items-center gap-1.5 text-xs text-ink-soft"><Clock className="h-3.5 w-3.5" />Respond by {fmtDateTime(t.sla_due_at)}</p>
        {staff && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Status"><Select value={t.status} onChange={(e) => update.mutate({ status: e.target.value })}>{["open", "in_progress", "waiting", "resolved", "closed"].map((s) => <option key={s} value={s}>{title(s)}</option>)}</Select></Field>
            <Field label="Assigned to"><Select value={t.assigned_to ?? ""} onChange={(e) => update.mutate({ assigned_to: e.target.value || null })}><option value="">Unassigned</option>{emps.filter((e) => e.status !== "exited").map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</Select></Field>
          </div>
        )}
        <ul className="space-y-3">{comments.map((c) => (
          <li key={c.id} className={cn("rounded-2xl p-3 text-sm", c.is_internal ? "border border-dashed border-amber-300 bg-amber-50" : c.author_id === ctx?.user_id ? "ml-8 bg-brand-50" : "mr-8 bg-surface-muted")}>
            <p className="whitespace-pre-wrap text-ink">{c.body}</p><p className="mt-1 flex items-center gap-1 text-[11px] text-ink-soft">{c.is_internal && <Lock className="h-3 w-3" />}{c.author_id === ctx?.user_id ? "You" : "HR"} · {ago(c.created_at)}</p>
          </li>
        ))}</ul>
        {staff && !["resolved", "closed"].includes(t.status) && (
          <div className="rounded-2xl border border-line p-4"><Field label="Resolution"><Textarea value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="How was it solved?" /></Field><Button size="sm" className="mt-2" disabled={!resolution.trim()} onClick={() => update.mutate({ status: "resolved", resolution })}>Resolve</Button></div>
        )}
        {t.resolution && <div className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-700"><p className="font-medium">Resolution</p><p className="mt-1">{t.resolution}</p></div>}
        {t.status === "resolved" && t.employee_id === employeeId && (
          <div className="text-center"><p className="text-sm text-ink">How did we do?</p><div className="mt-2 flex justify-center gap-1">{[1, 2, 3, 4, 5].map((n) => <button key={n} onClick={() => rate.mutate(n)} className="cursor-pointer"><Star className="h-7 w-7 text-amber-400 hover:fill-amber-400" /></button>)}</div></div>
        )}
      </div>
    </Drawer>
  );
}

export default function HelpdeskPage() {
  const { role, employeeId } = useMe();
  const staff = can.hrStaff(role) || can.runPayroll(role) || can.auditor(role);
  const { data: emps = [] } = useEmployees(); const E = byId(emps);
  const { data: tickets = [] } = useRows<Ticket[]>(["helpdesk", "tickets"], (sb) => sb.from("hr_tickets").select("*").order("created_at", { ascending: false }));
  const { data: kb = [] } = useRows<Article[]>(["helpdesk", "kb"], (sb) => sb.from("kb_articles").select("*").order("title"));
  const tabs = useMemo(() => [...(employeeId ? [{ value: "mine", label: "My tickets" }] : []), ...(staff ? [{ value: "queue", label: "HR queue" }] : []), { value: "kb", label: "Knowledge base" }], [employeeId, staff]);
  const [tab, setTab] = useState(tabs[0].value);
  const [sel, setSel] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false); const [art, setArt] = useState<Partial<Article> | null>(null);
  const [f, setF] = useState({ category: "general", subject: "", description: "", priority: "normal" });
  const [term, setTerm] = useState(""); const [status, setStatus] = useState("open_any");
  const create = useAction(() => q((sb) => sb.from("hr_tickets").insert({ ...f, employee_id: employeeId })), { success: "Ticket raised — HR will respond within the SLA", invalidate: ["helpdesk"], onDone: () => { setNewOpen(false); setF({ category: "general", subject: "", description: "", priority: "normal" }); } });
  const saveArt = useAction(() => art?.id ? q((sb) => sb.from("kb_articles").update({ title: art.title, body: art.body, category: art.category, is_published: art.is_published }).eq("id", art.id!)) : q((sb) => sb.from("kb_articles").insert({ title: art!.title, body: art!.body, category: art!.category ?? "policy" })), { success: "Article saved", invalidate: ["helpdesk"], onDone: () => setArt(null) });
  const suggestions = f.subject.length > 3 ? kb.filter((a) => a.title.toLowerCase().split(" ").some((w) => w.length > 3 && f.subject.toLowerCase().includes(w))).slice(0, 3) : [];
  const queue = tickets.filter((t) => status === "open_any" ? !["resolved", "closed"].includes(t.status) : !status || t.status === status);
  const cols = [
    { key: "n", label: "Ticket", render: (t: Ticket) => <div><p className="font-medium">{t.subject}</p><p className="text-xs text-ink-soft">{t.ticket_no} · {title(t.category)} · {ago(t.created_at)}</p></div> },
    ...(tab === "queue" ? [{ key: "e", label: "Employee", render: (t: Ticket) => <span className="flex items-center gap-2"><Avatar name={E.get(t.employee_id)?.full_name} size="xs" />{E.get(t.employee_id)?.full_name}</span> }] : []),
    { key: "p", label: "Priority", render: (t: Ticket) => <StatusBadge status={t.priority} /> },
    { key: "sla", label: "SLA", render: (t: Ticket) => ["resolved", "closed"].includes(t.status) ? <span className="text-xs text-ink-soft">Done</span> : new Date(t.sla_due_at) < new Date() ? <Badge tone="rose">Breached</Badge> : <span className="text-xs text-ink-soft">{fmtDateTime(t.sla_due_at)}</span> },
    { key: "s", label: "Status", render: (t: Ticket) => <StatusBadge status={t.status} /> },
  ];
  return (
    <div>
      <PageHeader icon={LifeBuoy} title="Helpdesk" subtitle="Ask HR anything — tickets with SLAs, internal notes and a searchable policy knowledge base.">
        {employeeId && <Button onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" />New ticket</Button>}
        {can.hrStaff(role) && tab === "kb" && <Button variant="outline" onClick={() => setArt({ category: "policy", is_published: true })}><BookOpen className="h-4 w-4" />New article</Button>}
      </PageHeader>
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={tabs} />
      {tab === "mine" && <Card className="p-4"><DataTable rows={tickets.filter((t) => t.employee_id === employeeId)} onRowClick={(t) => setSel(t.id)} columns={cols} empty={<EmptyState icon={LifeBuoy} title="No tickets" text="Payslip question? Document request? Raise a ticket." />} /></Card>}
      {tab === "queue" && <Card className="p-4"><div className="mb-3"><Tabs value={status} onChange={setStatus} tabs={[{ value: "open_any", label: "Open" }, { value: "resolved", label: "Resolved" }, { value: "closed", label: "Closed" }, { value: "", label: "All" }]} /></div><DataTable rows={queue} onRowClick={(t) => setSel(t.id)} columns={cols} empty={<EmptyState title="Queue is empty" />} /></Card>}
      {tab === "kb" && (
        <div className="space-y-4">
          <SearchInput value={term} onChange={setTerm} placeholder="Search policies and answers" className="max-w-lg" />
          <div className="grid gap-4 md:grid-cols-2">{kb.filter((a) => !term || (a.title + a.body).toLowerCase().includes(term.toLowerCase())).map((a) => (
            <Card key={a.id} className="p-5"><div className="flex items-center justify-between"><Badge tone="sky">{title(a.category)}</Badge>{!a.is_published && <Badge>Draft</Badge>}</div><p className="mt-3 font-semibold text-ink">{a.title}</p><p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">{a.body}</p>{can.hrStaff(role) && <button onClick={() => setArt(a)} className="mt-3 cursor-pointer text-sm font-medium text-brand-600">Edit</button>}</Card>
          ))}</div>
        </div>
      )}
      <TicketDrawer t={tickets.find((t) => t.id === sel) ?? null} onClose={() => setSel(null)} />
      <Dialog open={newOpen} onClose={() => setNewOpen(false)} title="New HR ticket">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3"><Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map((c) => <option key={c} value={c}>{title(c)}</option>)}</Select></Field><Field label="Priority"><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{["low", "normal", "high", "urgent"].map((c) => <option key={c} value={c}>{title(c)}</option>)}</Select></Field></div>
          <Field label="Subject"><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
          {suggestions.length > 0 && <div className="rounded-2xl bg-brand-50 p-3 text-sm"><p className="font-medium text-ink">These articles may answer it:</p><ul className="mt-1 list-disc pl-5 text-ink-soft">{suggestions.map((s) => <li key={s.id}>{s.title} — {s.body.slice(0, 90)}…</li>)}</ul></div>}
          <Field label="Details"><Textarea rows={4} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setNewOpen(false)}>Cancel</Button><Button onClick={() => create.mutate()} disabled={f.subject.trim().length < 3} loading={create.isPending}>Submit</Button></div>
        </div>
      </Dialog>
      <Dialog open={!!art} onClose={() => setArt(null)} title={art?.id ? "Edit article" : "New article"} className="max-w-xl">
        {art && <div className="space-y-4"><Field label="Title"><Input value={art.title ?? ""} onChange={(e) => setArt({ ...art, title: e.target.value })} /></Field>
          <Field label="Category"><Select value={art.category ?? "policy"} onChange={(e) => setArt({ ...art, category: e.target.value })}>{["policy", "payroll", "leave", "attendance", "benefits", "it", "general"].map((c) => <option key={c} value={c}>{title(c)}</option>)}</Select></Field>
          <Field label="Answer"><Textarea rows={8} value={art.body ?? ""} onChange={(e) => setArt({ ...art, body: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={art.is_published ?? true} onChange={(e) => setArt({ ...art, is_published: e.target.checked })} />Published (also used by the AI copilot)</label>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setArt(null)}>Cancel</Button><Button onClick={() => saveArt.mutate()} disabled={!art.title || !art.body} loading={saveArt.isPending}>Save</Button></div></div>}
      </Dialog>
    </div>
  );
}
