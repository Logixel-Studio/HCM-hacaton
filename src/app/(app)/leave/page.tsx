"use client";
import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Paperclip, Plus, PartyPopper } from "lucide-react";
import { Avatar, Button, Card, Dialog, Field, Input, Select, Tabs, Textarea, Progress } from "@/components/ui";
import { DataTable, DecisionButtons, EmptyState, Loading, PageHeader, SectionCard, StatusBadge } from "@/components/common";
import { byId, useEmployees, useLeaveTypes } from "@/lib/lookups";
import { q, rpc, uploadFile, useAction, useRows, useRpc } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { can } from "@/lib/roles";
import { addDays, fmtDate, fmtShort, today, toISODate, title } from "@/lib/format";
import { cn } from "@/lib/utils";

type Balance = { leave_type_id: string; code: string; name: string; color: string; is_paid: boolean; entitled: number; used: number; pending: number; available: number };
type Req = { id: string; employee_id: string; leave_type_id: string; start_date: string; end_date: string; days: number; is_half_day: boolean; reason: string | null; status: string; current_step: string; decision_note: string | null; created_at: string; document_path: string | null };

function ApplyDialog({ open, onClose, balances }: { open: boolean; onClose: () => void; balances: Balance[] }) {
  const { tenantId, employeeId } = useMe();
  const { data: types = [] } = useLeaveTypes();
  const [type, setType] = useState(""); const [start, setStart] = useState(today()); const [end, setEnd] = useState(today());
  const [half, setHalf] = useState(false); const [reason, setReason] = useState(""); const [file, setFile] = useState<File | null>(null);
  const t = types.find((x) => x.id === type); const bal = balances.find((b) => b.leave_type_id === type);
  const a = useAction(async () => {
    const doc = file && tenantId && employeeId ? await uploadFile("hr-documents", tenantId, employeeId, file) : null;
    return rpc("apply_leave", { p_type: type, p_start: start, p_end: half ? start : end, p_half_day: half, p_reason: reason || null, p_document: doc });
  }, { success: "Leave request sent for approval", invalidate: ["leave"], onDone: () => { setReason(""); setFile(null); onClose(); } });
  return (
    <Dialog open={open} onClose={onClose} title="Apply for leave" description="Weekly offs and public holidays are not counted.">
      <div className="space-y-4">
        <Field label="Leave type"><Select value={type} onChange={(e) => setType(e.target.value)}><option value="">Select</option>{types.filter((x) => x.is_active && balances.some((b) => b.leave_type_id === x.id)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
        {bal && <div className="rounded-2xl bg-surface-muted px-4 py-3 text-sm text-ink-soft">{bal.is_paid ? <>Available: <span className="font-semibold text-ink">{bal.available}</span> of {bal.entitled} days</> : "Unpaid leave is deducted from salary."}{t?.max_consecutive_days ? ` · max ${t.max_consecutive_days} days at a time` : ""}</div>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="From"><Input type="date" value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} /></Field>
          <Field label="To"><Input type="date" value={half ? start : end} min={start} disabled={half} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        {t?.allow_half_day && <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={half} onChange={(e) => setHalf(e.target.checked)} />Half day</label>}
        <Field label="Reason"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" /></Field>
        <Field label="Supporting document" hint={t?.requires_document_after_days != null ? `Required for more than ${t.requires_document_after_days} day(s)` : "Optional"}>
          <label className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line px-3 text-sm text-ink-soft hover:bg-surface-muted"><Paperclip className="h-4 w-4" />{file ? file.name : "Attach a file"}<input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        </Field>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => a.mutate()} loading={a.isPending} disabled={!type}>Submit request</Button></div>
      </div>
    </Dialog>
  );
}

function MyLeave() {
  const { employeeId } = useMe();
  const { data: balances = [], isLoading } = useRpc<Balance[]>(["leave", "balances"], "my_leave_balances");
  const { data: reqs = [] } = useRows<Req[]>(["leave", "mine"], (sb) => sb.from("leave_requests").select("*").eq("employee_id", employeeId!).order("start_date", { ascending: false }).limit(50));
  const { data: types = [] } = useLeaveTypes(); const T = byId(types);
  const { data: hol = [] } = useRows<{ id: string; name: string; holiday_date: string; is_tentative: boolean }[]>(["holidays", "upcoming"], (sb) => sb.from("holidays").select("*").gte("holiday_date", today()).order("holiday_date").limit(6));
  const [open, setOpen] = useState(false);
  const cancel = useAction((id: string) => rpc("cancel_leave", { p_id: id }), { success: "Leave cancelled", invalidate: ["leave"] });
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Apply leave</Button></div>
      {isLoading ? <Loading /> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {balances.map((b) => (
            <Card key={b.leave_type_id} className="p-5">
              <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-sm font-medium text-ink"><span className="h-2.5 w-2.5 rounded-full" style={{ background: b.color }} />{b.name}</span>{!b.is_paid && <span className="text-xs text-ink-soft">Unpaid</span>}</div>
              <p className="mt-3 font-display text-3xl font-bold text-ink">{b.is_paid ? b.available : b.used}<span className="text-base font-medium text-ink-soft"> {b.is_paid ? `/ ${b.entitled}` : "used"}</span></p>
              {b.is_paid && <Progress className="mt-3" value={b.entitled ? (b.available / b.entitled) * 100 : 0} color={b.color} />}
              <p className="mt-2 text-xs text-ink-soft">{b.used} used{b.pending ? ` · ${b.pending} pending` : ""}</p>
            </Card>
          ))}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard className="lg:col-span-2" icon={CalendarDays} title="My requests">
          <DataTable rows={reqs} columns={[
            { key: "t", label: "Type", render: (r) => <span className="flex items-center gap-2 font-medium"><span className="h-2 w-2 rounded-full" style={{ background: T.get(r.leave_type_id)?.color }} />{T.get(r.leave_type_id)?.name}</span> },
            { key: "d", label: "Dates", render: (r) => `${fmtShort(r.start_date)}${r.end_date !== r.start_date ? " – " + fmtShort(r.end_date) : ""}` },
            { key: "n", label: "Days", render: (r) => r.days },
            { key: "s", label: "Status", render: (r) => <span className="flex flex-col items-start gap-0.5"><StatusBadge status={r.status} label={r.status === "pending" ? `Waiting · ${r.current_step === "hr" ? "HR" : "manager"}` : undefined} />{r.decision_note && <span className="text-[11px] text-ink-soft">“{r.decision_note}”</span>}</span> },
            { key: "a", label: "", render: (r) => (r.status === "pending" || (r.status === "approved" && r.start_date > today())) ? <Button size="sm" variant="ghost" onClick={() => cancel.mutate(r.id)}>Cancel</Button> : null },
          ]} empty={<EmptyState icon={CalendarDays} title="No leave requests yet" />} />
        </SectionCard>
        <SectionCard icon={PartyPopper} title="Upcoming holidays">
          {hol.length === 0 ? <p className="text-sm text-ink-soft">No holidays added yet.</p> : <ul className="space-y-2">{hol.map((h) => <li key={h.id} className="flex items-center justify-between rounded-2xl bg-surface-muted px-4 py-2.5 text-sm"><span className="text-ink">{h.name}{h.is_tentative && <span className="text-xs text-ink-soft"> (tentative)</span>}</span><span className="text-ink-soft">{fmtShort(h.holiday_date)}</span></li>)}</ul>}
        </SectionCard>
      </div>
      <ApplyDialog open={open} onClose={() => setOpen(false)} balances={balances} />
    </div>
  );
}

function TeamCalendar() {
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const first = new Date(month + "-01T00:00:00");
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const days = Array.from({ length: last.getDate() }, (_, i) => addDays(first, i));
  const { data: emps = [] } = useEmployees(); const E = byId(emps);
  const { data: types = [] } = useLeaveTypes(); const T = byId(types);
  const { data: reqs = [] } = useRows<Req[]>(["leave", "calendar", month], (sb) => sb.from("leave_requests").select("*").in("status", ["approved", "pending"]).lte("start_date", toISODate(last)).gte("end_date", toISODate(first)));
  const people = Array.from(new Set(reqs.map((r) => r.employee_id))).map((id) => E.get(id)).filter(Boolean);
  const shift = (n: number) => { const d = new Date(first); d.setMonth(d.getMonth() + n); setMonth(toISODate(d).slice(0, 7)); };
  return (
    <Card className="p-4">
      <div className="mb-4 flex items-center gap-2">
        <button onClick={() => shift(-1)} className="cursor-pointer rounded-full p-2 hover:bg-surface-muted"><ChevronLeft className="h-4 w-4" /></button>
        <p className="w-40 text-center font-semibold text-ink">{first.toLocaleDateString("en-PK", { month: "long", year: "numeric" })}</p>
        <button onClick={() => shift(1)} className="cursor-pointer rounded-full p-2 hover:bg-surface-muted"><ChevronRight className="h-4 w-4" /></button>
      </div>
      {people.length === 0 ? <EmptyState icon={CalendarDays} title="No leave this month" /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-separate border-spacing-y-1 text-xs">
            <thead><tr><th className="w-44 px-2 text-left font-medium text-ink-soft">Employee</th>{days.map((d) => <th key={d.getDate()} className={cn("w-7 text-center font-medium", [0].includes(d.getDay()) ? "text-ink-soft/50" : "text-ink-soft")}>{d.getDate()}</th>)}</tr></thead>
            <tbody>
              {people.map((p) => (
                <tr key={p!.id}>
                  <td className="px-2 py-1"><span className="flex items-center gap-2"><Avatar name={p!.full_name} size="xs" /><span className="truncate text-sm text-ink">{p!.full_name}</span></span></td>
                  {days.map((d) => {
                    const iso = toISODate(d);
                    const r = reqs.find((x) => x.employee_id === p!.id && x.start_date <= iso && x.end_date >= iso);
                    return <td key={iso} className="px-0.5"><div title={r ? `${T.get(r.leave_type_id)?.name} · ${r.status}` : ""} className={cn("h-6 rounded-md", r ? "" : "bg-surface-muted/50", r?.status === "pending" && "opacity-50")} style={r ? { background: T.get(r.leave_type_id)?.color } : undefined} /></td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink-soft">{types.map((t) => <span key={t.id} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />{t.name}</span>)}<span>· faded = pending</span></div>
        </div>
      )}
    </Card>
  );
}

function AllRequests() {
  const [status, setStatus] = useState("pending");
  const { data: emps = [] } = useEmployees(); const E = byId(emps);
  const { data: types = [] } = useLeaveTypes(); const T = byId(types);
  const { data: reqs = [], isLoading } = useRows<Req[]>(["leave", "all", status], (sb) => { let x = sb.from("leave_requests").select("*").order("created_at", { ascending: false }).limit(200); if (status) x = x.eq("status", status); return x; });
  const decide = useAction(({ id, approve, note }: { id: string; approve: boolean; note: string | null }) => rpc("decide_leave", { p_id: id, p_approve: approve, p_note: note }), { success: "Decision saved", invalidate: ["leave"] });
  const { employeeId } = useMe();
  return (
    <Card className="p-4">
      <div className="mb-3"><Tabs value={status} onChange={setStatus} tabs={[{ value: "pending", label: "Pending" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }, { value: "", label: "All" }]} /></div>
      {isLoading ? <Loading /> : <DataTable rows={reqs} columns={[
        { key: "e", label: "Employee", render: (r) => <span className="flex items-center gap-2"><Avatar name={E.get(r.employee_id)?.full_name} size="sm" /><span className="font-medium">{E.get(r.employee_id)?.full_name}</span></span> },
        { key: "t", label: "Type", render: (r) => T.get(r.leave_type_id)?.name },
        { key: "d", label: "Dates", render: (r) => `${fmtShort(r.start_date)} – ${fmtShort(r.end_date)} · ${r.days} d` },
        { key: "r", label: "Reason", render: (r) => <span className="text-ink-soft">{r.reason ?? "—"}</span>, hideOnMobile: true },
        { key: "s", label: "Status", render: (r) => <StatusBadge status={r.status} label={r.status === "pending" ? `Waiting · ${r.current_step}` : undefined} /> },
        { key: "a", label: "", render: (r) => r.status === "pending" && r.employee_id !== employeeId ? <DecisionButtons requireRejectNote onDecide={(approve, note) => decide.mutate({ id: r.id, approve, note })} /> : null },
      ]} empty={<EmptyState title="No requests" />} />}
    </Card>
  );
}

function Allocations() {
  const { data: emps = [] } = useEmployees(); const E = byId(emps);
  const { data: types = [] } = useLeaveTypes(); const T = byId(types);
  const { data: rows = [] } = useRows<{ id: string; employee_id: string; leave_type_id: string; year: number; days: number; reason: string; created_at: string }[]>(["leave", "allocations"], (sb) => sb.from("leave_allocations").select("*").order("created_at", { ascending: false }).limit(100));
  const [f, setF] = useState({ employee_id: "", leave_type_id: "", days: "1", reason: "Carry forward", year: String(new Date().getFullYear()) });
  const add = useAction(() => q((sb) => sb.from("leave_allocations").insert({ ...f, days: Number(f.days), year: Number(f.year) })), { success: "Allocation added", invalidate: ["leave"] });
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <SectionCard title="Adjust a balance" subtitle="Grant extra days, carry forward or correct a balance (use a negative number to reduce).">
        <div className="space-y-3">
          <Field label="Employee"><Select value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })}><option value="">Select</option>{emps.filter((e) => e.status !== "exited").map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</Select></Field>
          <Field label="Leave type"><Select value={f.leave_type_id} onChange={(e) => setF({ ...f, leave_type_id: e.target.value })}><option value="">Select</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Days"><Input type="number" step="0.5" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /></Field><Field label="Year"><Input type="number" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} /></Field></div>
          <Field label="Reason"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
          <Button className="w-full" onClick={() => add.mutate()} loading={add.isPending} disabled={!f.employee_id || !f.leave_type_id}>Save</Button>
        </div>
      </SectionCard>
      <SectionCard className="lg:col-span-2" title="Recent adjustments">
        <DataTable rows={rows} columns={[
          { key: "e", label: "Employee", render: (r) => E.get(r.employee_id)?.full_name },
          { key: "t", label: "Type", render: (r) => T.get(r.leave_type_id)?.name },
          { key: "d", label: "Days", render: (r) => <span className={r.days < 0 ? "text-rose-600" : "text-emerald-600"}>{r.days > 0 ? "+" : ""}{r.days}</span> },
          { key: "y", label: "Year", render: (r) => r.year },
          { key: "r", label: "Reason", render: (r) => r.reason },
        ]} empty={<EmptyState title="No adjustments" />} />
      </SectionCard>
    </div>
  );
}

export default function LeavePage() {
  const { employeeId, role, ctx } = useMe();
  const tabs = useMemo(() => [
    ...(employeeId ? [{ value: "me", label: "My leave" }] : []),
    ...(ctx?.employee?.has_reports || can.hrStaff(role) ? [{ value: "calendar", label: "Leave calendar" }] : []),
    ...(can.hrStaff(role) ? [{ value: "all", label: "All requests" }, { value: "alloc", label: "Balances & adjustments" }] : []),
  ], [employeeId, role, ctx]);
  const [tab, setTab] = useState(tabs[0]?.value ?? "me");
  return (
    <div>
      <PageHeader icon={CalendarDays} title="Leave" subtitle={`Policy-driven balances, approvals and calendars${employeeId ? "" : ""}.`} />
      {tabs.length > 1 && <Tabs className="mb-4" value={tab} onChange={setTab} tabs={tabs} />}
      {tab === "me" && employeeId && <MyLeave />}
      {tab === "calendar" && <TeamCalendar />}
      {tab === "all" && <AllRequests />}
      {tab === "alloc" && <Allocations />}
    </div>
  );
}
