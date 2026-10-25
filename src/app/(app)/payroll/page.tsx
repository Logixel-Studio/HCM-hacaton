"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, Ban, Calculator, Check, CheckCircle2, Download, Landmark, Lock, Plus, RotateCcw, ShieldCheck, Wallet } from "lucide-react";
import { Avatar, Badge, Button, Card, Dialog, Field, Input, Select, Tabs, Textarea } from "@/components/ui";
import { DataTable, EmptyState, Loading, PageHeader, ReadOnlyNote, SectionCard, StatCard, StatusBadge } from "@/components/common";
import { PayslipDialog, type Payslip } from "@/components/payslip";
import { RequireAccess } from "@/components/guard";
import { byId, useEmployees } from "@/lib/lookups";
import { downloadText, q, rpc, toCsv, useAction, useRows } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { can } from "@/lib/roles";
import { fmtDateTime, money, periodLabel, thisPeriod, title } from "@/lib/format";
import { cn } from "@/lib/utils";

type Run = { id: string; period: string; run_type: string; status: string; employee_count: number; total_gross: number; total_deductions: number; total_tax: number; total_net: number; total_employer_cost: number;
  exceptions: { id: string; employee: string; code: string; severity: string; message: string; accepted: boolean; note?: string }[]; prepared_by: string | null; prepared_at: string | null;
  hr_approved_at: string | null; finance_approved_at: string | null; finalized_at: string | null; notes: string | null; pay_date: string | null };

const STEPS = [
  { key: "calculated", label: "Calculated", by: "Payroll" },
  { key: "hr_approved", label: "HR approved", by: "HR" },
  { key: "finance_approved", label: "Finance approved", by: "Finance" },
  { key: "finalized", label: "Finalized", by: "Payroll" },
];
const order = ["draft", "calculated", "hr_approved", "finance_approved", "finalized"];

function Stepper({ run }: { run: Run }) {
  const idx = order.indexOf(run.status);
  const at = [run.prepared_at, run.hr_approved_at, run.finance_approved_at, run.finalized_at];
  return (
    <div className="grid grid-cols-4 gap-2">
      {STEPS.map((s, i) => {
        const done = idx >= i + 1;
        return (
          <div key={s.key} className={cn("rounded-2xl border p-3", done ? "border-transparent bg-emerald-50" : idx === i ? "border-brand-300 bg-brand-50" : "border-line")}>
            <div className="flex items-center gap-2">
              <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold", done ? "bg-emerald-500 text-white" : "bg-surface-muted text-ink-soft")}>{done ? <Check className="h-3.5 w-3.5" /> : i + 1}</span>
              <span className="text-sm font-medium text-ink">{s.label}</span>
            </div>
            <p className="mt-1 text-[11px] text-ink-soft">{done && at[i] ? fmtDateTime(at[i]) : `By ${s.by}`}</p>
          </div>
        );
      })}
    </div>
  );
}

function RunDetail({ runId, onBack }: { runId: string; onBack: () => void }) {
  const { role, ctx } = useMe();
  const { data: run, isLoading } = useRows<Run>(["payroll", "run", runId], (sb) => sb.from("payroll_runs").select("*").eq("id", runId).single());
  const { data: slips = [] } = useRows<Payslip[]>(["payroll", "slips", runId], (sb) => sb.from("payslips").select("*").eq("run_id", runId));
  const { data: emps = [] } = useEmployees(); const E = byId(emps);
  const [slip, setSlip] = useState<Payslip | null>(null);
  const [reject, setReject] = useState(false); const [note, setNote] = useState("");
  const act = useAction((action: string) => rpc<string>("advance_payroll", { p_run: runId, p_action: action, p_note: action === "reject" ? note : null }), {
    success: (s) => `Payroll is now ${title(s)}`, invalidate: ["payroll"], onDone: () => { setReject(false); setNote(""); } });
  const accept = useAction((id: string) => rpc("accept_payroll_exception", { p_run: runId, p_exception_id: id, p_note: "Reviewed" }), { success: "Exception accepted", invalidate: ["payroll"] });
  const recalc = useAction(() => rpc("calculate_payroll", { p_period: run!.period, p_run_type: run!.run_type }), { success: "Recalculated", invalidate: ["payroll"] });
  const bank = useAction(() => rpc<string>("payroll_bank_file", { p_run: runId }), { onDone: (csv) => downloadText(`bank-transfer-${run?.period}.csv`, csv) });

  if (isLoading || !run) return <Loading />;
  const open = run.exceptions.filter((x) => !x.accepted);
  const mine = run.prepared_by === ctx?.user_id;
  const readOnly = can.auditor(role);

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-ink-soft hover:text-ink"><ArrowLeft className="h-4 w-4" />All runs</button>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div><h2 className="font-display text-2xl font-bold text-ink">{periodLabel(run.period)} {run.run_type === "off_cycle" && <Badge tone="violet">Off-cycle</Badge>}</h2><p className="text-sm text-ink-soft">{run.employee_count} employees · status <StatusBadge status={run.status} /></p></div>
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            {["draft", "calculated"].includes(run.status) && can.runPayroll(role) && <Button variant="outline" onClick={() => recalc.mutate()} loading={recalc.isPending}><RotateCcw className="h-4 w-4" />Recalculate</Button>}
            {run.status === "calculated" && can.hrLead(role) && <Button onClick={() => act.mutate("hr_approve")} loading={act.isPending} disabled={open.length > 0}><ShieldCheck className="h-4 w-4" />HR approve</Button>}
            {run.status === "hr_approved" && can.finance(role) && <Button onClick={() => act.mutate("finance_approve")} loading={act.isPending}><ShieldCheck className="h-4 w-4" />Finance approve</Button>}
            {["finance_approved", "finalized"].includes(run.status) && (can.runPayroll(role) || can.finance(role)) && <Button variant="outline" onClick={() => bank.mutate()} loading={bank.isPending}><Landmark className="h-4 w-4" />Bank file</Button>}
            {run.status === "finance_approved" && (can.runPayroll(role) || can.finance(role)) && <Button onClick={() => act.mutate("finalize")} loading={act.isPending}><Lock className="h-4 w-4" />Finalize & publish</Button>}
            {["calculated", "hr_approved", "finance_approved"].includes(run.status) && (can.hrLead(role) || can.finance(role) || can.runPayroll(role)) && <Button variant="ghost" onClick={() => setReject(true)}><Ban className="h-4 w-4" />Send back</Button>}
          </div>
        )}
      </div>
      {readOnly && <ReadOnlyNote>Auditor view: read-only access to this payroll run.</ReadOnlyNote>}
      <Stepper run={run} />
      {mine && run.status === "calculated" && <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700">Maker-checker: you calculated this run, so a different person must approve it (unless the company turned this off in payroll settings).</p>}
      {run.notes && <p className="rounded-2xl bg-surface-muted px-4 py-3 text-sm text-ink-soft">Note: {run.notes}</p>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Wallet} label="Total earnings" value={money(run.total_gross)} />
        <StatCard icon={Calculator} label="Income tax" value={money(run.total_tax)} />
        <StatCard icon={CheckCircle2} label="Net pay" value={money(run.total_net)} accent />
        <StatCard icon={Landmark} label="Employer cost" value={money(run.total_employer_cost)} hint="Earnings + employer EOBI & PF" />
      </div>

      {run.exceptions.length > 0 && (
        <SectionCard icon={AlertTriangle} title="Pre-payroll checks" subtitle={open.length ? `${open.length} need review before HR approval` : "All exceptions reviewed"}>
          <ul className="space-y-2">
            {run.exceptions.map((x) => (
              <li key={x.id} className="flex flex-col gap-2 rounded-2xl border border-line p-3 sm:flex-row sm:items-center">
                <StatusBadge status={x.severity} />
                <p className="flex-1 text-sm text-ink"><span className="font-medium">{x.employee}</span> — {x.message}</p>
                {x.accepted ? <Badge tone="green" dot>Reviewed</Badge> : run.status === "calculated" && (can.runPayroll(role) || can.hrLead(role)) ? <Button size="sm" variant="outline" onClick={() => accept.mutate(x.id)}>Mark reviewed</Button> : <Badge tone="amber">Open</Badge>}
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      <SectionCard title="Payslips" action={<Button size="sm" variant="ghost" onClick={() => downloadText(`payroll-${run.period}.csv`, toCsv(slips.map((s) => ({ code: E.get(s.employee_id)?.employee_code, name: E.get(s.employee_id)?.full_name, gross: s.gross_salary, earnings: s.total_earnings, tax: s.income_tax, deductions: s.total_deductions, net: s.net_pay }))))}><Download className="h-4 w-4" />Register CSV</Button>}>
        <DataTable rows={[...slips].sort((a, b) => (E.get(a.employee_id)?.full_name ?? "").localeCompare(E.get(b.employee_id)?.full_name ?? ""))} onRowClick={setSlip} columns={[
          { key: "e", label: "Employee", render: (s) => <span className="flex items-center gap-2"><Avatar name={E.get(s.employee_id)?.full_name} size="sm" /><span><span className="block font-medium">{E.get(s.employee_id)?.full_name}</span><span className="block text-xs text-ink-soft">{E.get(s.employee_id)?.employee_code}</span></span></span> },
          { key: "g", label: "Gross", render: (s) => money(s.gross_salary), className: "text-right" },
          { key: "t", label: "Tax", render: (s) => money(s.income_tax), className: "text-right" },
          { key: "d", label: "Deductions", render: (s) => money(s.total_deductions), className: "text-right" },
          { key: "n", label: "Net pay", render: (s) => <span className="font-semibold">{money(s.net_pay)}</span>, className: "text-right" },
        ]} />
      </SectionCard>
      <PayslipDialog slip={slip} employee={slip ? E.get(slip.employee_id) : undefined} onClose={() => setSlip(null)} />
      <Dialog open={reject} onClose={() => setReject(false)} title="Send payroll back" description="The run returns to draft so payroll can fix and recalculate.">
        <Textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="What needs fixing?" />
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setReject(false)}>Cancel</Button><Button variant="danger" disabled={note.trim().length < 3} loading={act.isPending} onClick={() => act.mutate("reject")}>Send back</Button></div>
      </Dialog>
    </div>
  );
}

function Runs({ onOpen }: { onOpen: (id: string) => void }) {
  const { role } = useMe();
  const { data: runs = [], isLoading } = useRows<Run[]>(["payroll", "runs"], (sb) => sb.from("payroll_runs").select("*").neq("status", "cancelled").order("period", { ascending: false }));
  const [period, setPeriod] = useState(thisPeriod()); const [type, setType] = useState("regular");
  const calc = useAction(() => rpc<string>("calculate_payroll", { p_period: period, p_run_type: type }), { success: "Payroll calculated — review the checks", invalidate: ["payroll"], onDone: (id) => onOpen(id) });
  return (
    <div className="space-y-4">
      {can.runPayroll(role) && (
        <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-end">
          <div className="flex-1"><p className="font-semibold text-ink">Run payroll</p><p className="text-sm text-ink-soft">Pulls salaries, attendance, approved overtime, unpaid leave, loans, adjustments and approved expenses.</p></div>
          <Field label="Period"><Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="sm:w-44" /></Field>
          <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value)} className="sm:w-36"><option value="regular">Regular</option><option value="off_cycle">Off-cycle</option></Select></Field>
          <Button onClick={() => calc.mutate()} loading={calc.isPending}><Calculator className="h-4 w-4" />Calculate</Button>
        </Card>
      )}
      <Card className="p-4">
        {isLoading ? <Loading /> : <DataTable rows={runs} onRowClick={(r) => onOpen(r.id)} columns={[
          { key: "p", label: "Period", render: (r) => <span className="font-semibold">{periodLabel(r.period)}{r.run_type === "off_cycle" ? " · off-cycle" : ""}</span> },
          { key: "s", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
          { key: "e", label: "Employees", render: (r) => r.employee_count },
          { key: "n", label: "Net pay", render: (r) => money(r.total_net), className: "text-right" },
          { key: "c", label: "Employer cost", render: (r) => money(r.total_employer_cost), className: "text-right", hideOnMobile: true },
          { key: "x", label: "Checks", render: (r) => { const o = r.exceptions.filter((x) => !x.accepted).length; return o ? <Badge tone="amber">{o} open</Badge> : <Badge tone="green">Clear</Badge>; } },
        ]} empty={<EmptyState icon={Wallet} title="No payroll runs yet" text="Pick a month and press Calculate to create the first run." />} />}
      </Card>
    </div>
  );
}

function Adjustments() {
  const { role } = useMe();
  const { data: emps = [] } = useEmployees(); const E = byId(emps);
  const [period, setPeriod] = useState(thisPeriod());
  const { data: rows = [] } = useRows<{ id: string; employee_id: string; kind: string; amount: number; taxable: boolean; note: string | null }[]>(["payroll", "adj", period], (sb) => sb.from("payroll_adjustments").select("*").eq("period", period).order("created_at", { ascending: false }));
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ employee_id: "", kind: "bonus", amount: "", taxable: true, note: "" });
  const add = useAction(() => q((sb) => sb.from("payroll_adjustments").insert({ ...f, period, amount: Number(f.amount) })), { success: "Adjustment added", invalidate: ["payroll"], onDone: () => setOpen(false) });
  const del = useAction((id: string) => q((sb) => sb.from("payroll_adjustments").delete().eq("id", id)), { invalidate: ["payroll"] });
  return (
    <Card className="p-4">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Period"><Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-44" /></Field>
        {can.runPayroll(role) && <Button className="ml-auto" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Add adjustment</Button>}
      </div>
      <DataTable rows={rows} columns={[
        { key: "e", label: "Employee", render: (r) => E.get(r.employee_id)?.full_name },
        { key: "k", label: "Type", render: (r) => <Badge tone={r.kind === "deduction" ? "rose" : "green"}>{title(r.kind)}</Badge> },
        { key: "a", label: "Amount", render: (r) => money(r.amount) },
        { key: "t", label: "Taxable", render: (r) => (r.taxable ? "Yes" : "No") },
        { key: "n", label: "Note", render: (r) => r.note ?? "—" },
        ...(can.runPayroll(role) ? [{ key: "x", label: "", render: (r: { id: string }) => <Button size="sm" variant="ghost" onClick={() => del.mutate(r.id)}>Remove</Button> }] : []),
      ]} empty={<EmptyState title="No adjustments for this period" text="Bonuses, commissions, arrears and one-off deductions go here before you calculate." />} />
      <Dialog open={open} onClose={() => setOpen(false)} title={`Adjustment · ${periodLabel(period)}`}>
        <div className="space-y-4">
          <Field label="Employee"><Select value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })}><option value="">Select</option>{emps.filter((e) => e.status !== "exited").map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{["bonus", "commission", "allowance", "arrears", "deduction"].map((k) => <option key={k} value={k}>{title(k)}</option>)}</Select></Field>
            <Field label="Amount (PKR)"><Input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          </div>
          {f.kind !== "deduction" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.taxable} onChange={(e) => setF({ ...f, taxable: e.target.checked })} />Taxable</label>}
          <Field label="Note"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => add.mutate()} loading={add.isPending} disabled={!f.employee_id || !Number(f.amount)}>Add</Button></div>
        </div>
      </Dialog>
    </Card>
  );
}

function Loans() {
  const { data: emps = [] } = useEmployees(); const E = byId(emps);
  const { data: loans = [] } = useRows<{ id: string; employee_id: string; loan_type: string; principal: number; installments: number; installment_amount: number; recovered_amount: number; start_period: string; status: string }[]>(["payroll", "loans"], (sb) => sb.from("loans").select("*").order("created_at", { ascending: false }));
  const outstanding = loans.filter((l) => l.status === "active").reduce((s, l) => s + Number(l.principal) - Number(l.recovered_amount), 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3"><StatCard icon={Landmark} label="Outstanding loans" value={money(outstanding)} accent /><StatCard icon={Wallet} label="Active loans" value={loans.filter((l) => l.status === "active").length} /><StatCard icon={AlertTriangle} label="Waiting for approval" value={loans.filter((l) => l.status === "pending").length} /></div>
      <Card className="p-4"><DataTable rows={loans} columns={[
        { key: "e", label: "Employee", render: (l) => E.get(l.employee_id)?.full_name },
        { key: "t", label: "Type", render: (l) => title(l.loan_type) },
        { key: "p", label: "Principal", render: (l) => money(l.principal) },
        { key: "i", label: "Installment", render: (l) => `${money(l.installment_amount)} × ${l.installments}` },
        { key: "r", label: "Recovered", render: (l) => <span className="tabular">{money(l.recovered_amount)} <span className="text-ink-soft">({Math.round((l.recovered_amount / l.principal) * 100)}%)</span></span> },
        { key: "s", label: "Status", render: (l) => <StatusBadge status={l.status} /> },
      ]} empty={<EmptyState title="No loans" />} /></Card>
    </div>
  );
}

export default function PayrollPage() {
  const router = useRouter();
  const params = useSearchParams();
  const run = params.get("run");
  const [tab, setTab] = useState("runs");
  return (
    <RequireAccess allow={(c) => can.viewPay(c.role)}>
      <PageHeader icon={Wallet} title="Payroll" subtitle="Rule-based Pakistan payroll with maker-checker approval and a formula behind every number." />
      {run ? <RunDetail runId={run} onBack={() => router.push("/payroll")} /> : (
        <>
          <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ value: "runs", label: "Payroll runs" }, { value: "adj", label: "Bonuses & deductions" }, { value: "loans", label: "Loans & advances" }]} />
          {tab === "runs" && <Runs onOpen={(id) => router.push(`/payroll?run=${id}`)} />}
          {tab === "adj" && <Adjustments />}
          {tab === "loans" && <Loans />}
        </>
      )}
    </RequireAccess>
  );
}
