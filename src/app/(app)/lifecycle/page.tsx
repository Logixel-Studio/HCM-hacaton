"use client";
import { useMemo, useState } from "react";
import { Calculator, CheckCircle2, Circle, ClipboardList, LogOut, Rocket, Workflow } from "lucide-react";
import { Avatar, Badge, Button, Card, Dialog, Field, Select, Tabs, Textarea, Progress } from "@/components/ui";
import { DataTable, EmptyState, PageHeader, SectionCard, StatusBadge } from "@/components/common";
import { byId, useEmployees } from "@/lib/lookups";
import { rpc, useAction, useRows } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { can } from "@/lib/roles";
import { fmtDate, money, title } from "@/lib/format";
import { cn } from "@/lib/utils";

type Checklist = { id: string; employee_id: string; kind: string; target_date: string | null; status: string; created_at: string };
type Task = { id: string; checklist_id: string; owner_group: string; title: string; sort_order: number; is_done: boolean; done_at: string | null };
type Separation = { id: string; employee_id: string; separation_type: string; notice_date: string; last_working_day: string; reason: string | null; status: string; exit_interview: Record<string, unknown>; rehire_eligible: boolean | null };
type Settlement = { id: string; employee_id: string; separation_id: string; last_working_day: string; service_years: number; salary_amount: number; leave_encashment: number; gratuity: number; loan_recovery: number; net_payable: number; status: string; breakdown: { label: string; amount: number; formula?: string }[] };

const OWNER_TONE: Record<string, "brand" | "violet" | "amber" | "green" | "sky" | "rose" | "neutral"> = { HR: "brand", IT: "violet", Admin: "amber", Manager: "green", Finance: "sky", Employee: "rose", Buddy: "neutral" };

function ChecklistCard({ list, tasks, name }: { list: Checklist; tasks: Task[]; name?: string }) {
  const done = tasks.filter((t) => t.is_done).length;
  const [open, setOpen] = useState(false);
  const toggle = useAction(({ id, v }: { id: string; v: boolean }) => rpc("set_checklist_task", { p_task: id, p_done: v }), { invalidate: ["lifecycle"] });
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3">
        {name && <Avatar name={name} />}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-ink">{name ?? (list.kind === "onboarding" ? "My onboarding" : "My offboarding")}</p>
          <p className="text-xs text-ink-soft">{title(list.kind)} · target {fmtDate(list.target_date)}</p>
        </div>
        <StatusBadge status={list.status} />
      </div>
      <div className="mt-3 flex items-center gap-3"><Progress className="flex-1" value={tasks.length ? (done / tasks.length) * 100 : 0} /><span className="text-xs font-medium text-ink-soft">{done}/{tasks.length}</span></div>
      <button onClick={() => setOpen(!open)} className="mt-3 cursor-pointer text-sm font-medium text-brand-600">{open ? "Hide tasks" : "Show tasks"}</button>
      {open && (
        <ul className="mt-3 space-y-1.5">
          {tasks.sort((a, b) => a.sort_order - b.sort_order).map((t) => (
            <li key={t.id}>
              <button onClick={() => toggle.mutate({ id: t.id, v: !t.is_done })} className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-muted">
                {t.is_done ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" /> : <Circle className="h-5 w-5 shrink-0 text-ink-soft" />}
                <span className={cn("flex-1 text-sm", t.is_done ? "text-ink-soft line-through" : "text-ink")}>{t.title}</span>
                <Badge tone={OWNER_TONE[t.owner_group]}>{t.owner_group}</Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Checklists({ kind, mineOnly }: { kind?: string; mineOnly?: boolean }) {
  const { employeeId } = useMe();
  const { data: emps = [] } = useEmployees(); const E = byId(emps);
  const { data: lists = [] } = useRows<Checklist[]>(["lifecycle", "lists", kind, mineOnly], (sb) => { let x = sb.from("lifecycle_checklists").select("*").order("created_at", { ascending: false }); if (kind) x = x.eq("kind", kind); if (mineOnly) x = x.eq("employee_id", employeeId!); return x; });
  const { data: tasks = [] } = useRows<Task[]>(["lifecycle", "tasks"], (sb) => sb.from("checklist_tasks").select("*"));
  const [show, setShow] = useState("in_progress");
  const rows = lists.filter((l) => !show || l.status === show);
  if (!lists.length) return <Card><EmptyState icon={ClipboardList} title={mineOnly ? "No checklist for you" : "No checklists yet"} text={mineOnly ? undefined : "Checklists are created automatically when you hire someone or start a separation."} /></Card>;
  return (
    <div className="space-y-3">
      {!mineOnly && <Tabs value={show} onChange={setShow} tabs={[{ value: "in_progress", label: "In progress" }, { value: "completed", label: "Completed" }, { value: "", label: "All" }]} />}
      <div className="grid gap-4 md:grid-cols-2">{rows.map((l) => <ChecklistCard key={l.id} list={l} tasks={tasks.filter((t) => t.checklist_id === l.id)} name={mineOnly ? undefined : E.get(l.employee_id)?.full_name} />)}</div>
    </div>
  );
}

function Separations() {
  const { role } = useMe();
  const { data: emps = [] } = useEmployees(); const E = byId(emps);
  const { data: seps = [] } = useRows<Separation[]>(["lifecycle", "seps"], (sb) => sb.from("separations").select("*").order("created_at", { ascending: false }));
  const [exit, setExit] = useState<Separation | null>(null);
  const [f, setF] = useState({ reason: "growth", rating: "3", comments: "", rehire: "yes" });
  const accept = useAction(() => rpc("accept_separation", { p_id: exit!.id, p_exit_interview: { reason: f.reason, rating: Number(f.rating), comments: f.comments }, p_rehire: f.rehire === "yes" }), { success: "Saved · offboarding checklist ready", invalidate: ["lifecycle"], onDone: () => setExit(null) });
  const prep = useAction((id: string) => rpc("prepare_final_settlement", { p_separation: id }), { success: "Final settlement prepared — see the Settlements tab", invalidate: ["lifecycle"] });
  return (
    <Card className="p-4">
      <DataTable rows={seps} columns={[
        { key: "e", label: "Employee", render: (s) => <span className="flex items-center gap-2"><Avatar name={E.get(s.employee_id)?.full_name} size="sm" />{E.get(s.employee_id)?.full_name}</span> },
        { key: "t", label: "Type", render: (s) => title(s.separation_type) },
        { key: "l", label: "Last day", render: (s) => fmtDate(s.last_working_day) },
        { key: "r", label: "Reason", render: (s) => <span className="text-ink-soft">{s.reason ?? "—"}</span>, hideOnMobile: true },
        { key: "s", label: "Status", render: (s) => <StatusBadge status={s.status} /> },
        { key: "a", label: "", render: (s) => (
          <div className="flex justify-end gap-1">
            {can.hrStaff(role) && s.status !== "completed" && <Button size="sm" variant="outline" onClick={() => setExit(s)}>{s.status === "submitted" ? "Accept" : "Exit interview"}</Button>}
            {(can.runPayroll(role) || can.hrLead(role)) && s.status === "accepted" && <Button size="sm" onClick={() => prep.mutate(s.id)} loading={prep.isPending}><Calculator className="h-4 w-4" />Settlement</Button>}
          </div>
        ) },
      ]} empty={<EmptyState icon={LogOut} title="No separations" />} />
      <Dialog open={!!exit} onClose={() => setExit(null)} title="Exit interview" description="Recorded anonymously in attrition analytics.">
        <div className="space-y-4">
          <Field label="Main reason for leaving"><Select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>{["growth", "compensation", "manager", "relocation", "education", "work_life_balance", "health", "other"].map((r) => <option key={r} value={r}>{title(r)}</option>)}</Select></Field>
          <Field label="Overall experience (1–5)"><Select value={f.rating} onChange={(e) => setF({ ...f, rating: e.target.value })}>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</Select></Field>
          <Field label="Comments"><Textarea value={f.comments} onChange={(e) => setF({ ...f, comments: e.target.value })} /></Field>
          <Field label="Eligible for rehire"><Select value={f.rehire} onChange={(e) => setF({ ...f, rehire: e.target.value })}><option value="yes">Yes</option><option value="no">No</option></Select></Field>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setExit(null)}>Cancel</Button><Button onClick={() => accept.mutate()} loading={accept.isPending}>Save</Button></div>
        </div>
      </Dialog>
    </Card>
  );
}

function Settlements() {
  const { role } = useMe();
  const { data: emps = [] } = useEmployees(); const E = byId(emps);
  const { data: rows = [] } = useRows<Settlement[]>(["lifecycle", "fs"], (sb) => sb.from("final_settlements").select("*").neq("status", "cancelled").order("created_at", { ascending: false }));
  const act = useAction(({ id, a }: { id: string; a: string }) => rpc<string>("advance_settlement", { p_id: id, p_action: a }), { success: (s) => `Settlement ${title(s)}`, invalidate: ["lifecycle", "employees"] });
  if (!rows.length) return <Card><EmptyState icon={Calculator} title="No final settlements" text="Prepare one from an accepted separation." /></Card>;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {rows.map((s) => (
        <Card key={s.id} className="p-5">
          <div className="flex items-center justify-between"><span className="flex items-center gap-2 font-semibold text-ink"><Avatar name={E.get(s.employee_id)?.full_name} size="sm" />{E.get(s.employee_id)?.full_name}</span><StatusBadge status={s.status} /></div>
          <p className="mt-1 text-xs text-ink-soft">Last day {fmtDate(s.last_working_day)} · {s.service_years} years of service</p>
          <ul className="mt-4 space-y-2">{s.breakdown.map((b) => <li key={b.label} className="flex justify-between gap-3 text-sm"><span><span className="text-ink">{b.label}</span>{b.formula && <span className="block text-[11px] text-ink-soft">{b.formula}</span>}</span><span className={cn("tabular font-medium", b.amount < 0 ? "text-rose-600" : "text-ink")}>{money(b.amount)}</span></li>)}</ul>
          <div className="mt-4 flex items-center justify-between rounded-2xl bg-brand-50 px-4 py-3"><span className="text-sm text-ink">Net payable</span><span className="font-display text-xl font-bold text-brand-700">{money(s.net_payable)}</span></div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            {s.status === "draft" && can.hrLead(role) && <Button size="sm" onClick={() => act.mutate({ id: s.id, a: "hr_approve" })}>HR approve</Button>}
            {s.status === "hr_approved" && can.finance(role) && <Button size="sm" onClick={() => act.mutate({ id: s.id, a: "finance_approve" })}>Finance approve</Button>}
            {s.status === "finance_approved" && (can.finance(role) || can.runPayroll(role)) && <Button size="sm" onClick={() => act.mutate({ id: s.id, a: "mark_paid" })}>Mark paid & close</Button>}
            {s.status !== "paid" && can.hrLead(role) && <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: s.id, a: "cancel" })}>Cancel</Button>}
          </div>
        </Card>
      ))}
    </div>
  );
}

export default function LifecyclePage() {
  const { role, employeeId } = useMe();
  const tabs = useMemo(() => [
    ...(employeeId ? [{ value: "mine", label: "My checklist" }] : []),
    ...(can.hrStaff(role) || can.finance(role) ? [{ value: "onboarding", label: "Onboarding" }, { value: "offboarding", label: "Offboarding" }] : []),
    ...(can.hrStaff(role) ? [{ value: "separations", label: "Separations" }] : []),
    ...(can.viewPay(role) || can.hrLead(role) ? [{ value: "settlements", label: "Final settlements" }] : []),
  ], [role, employeeId]);
  const [tab, setTab] = useState(tabs.find((t) => t.value === "onboarding")?.value ?? tabs[0]?.value ?? "mine");
  return (
    <div>
      <PageHeader icon={Workflow} title="Onboarding & offboarding" subtitle="Checklists with an owner for every task, exit interviews and final settlement with maker-checker." />
      {tabs.length > 1 && <Tabs className="mb-4" value={tab} onChange={setTab} tabs={tabs} />}
      {tab === "mine" && <Checklists mineOnly />}
      {tab === "onboarding" && <Checklists kind="onboarding" />}
      {tab === "offboarding" && <Checklists kind="offboarding" />}
      {tab === "separations" && <Separations />}
      {tab === "settlements" && <Settlements />}
      {tab === "mine" && <SectionCard className="mt-4" icon={Rocket} title="Tip">Tasks marked “Employee” are yours. HR, IT, Admin and your manager complete the rest.</SectionCard>}
    </div>
  );
}
