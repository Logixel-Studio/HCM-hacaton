"use client";
import { useMemo, useState } from "react";
import { HandCoins, Paperclip, Plane, Plus, Receipt } from "lucide-react";
import { Avatar, Badge, Button, Card, Dialog, Field, Input, Select, Tabs, Textarea, Progress } from "@/components/ui";
import { DataTable, DecisionButtons, EmptyState, PageHeader, StatCard, StatusBadge } from "@/components/common";
import { byId, useEmployees } from "@/lib/lookups";
import { openFile, q, rpc, uploadFile, useAction, useRows } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { can } from "@/lib/roles";
import { fmtDate, fmtShort, money, thisPeriod, title, today } from "@/lib/format";

type Policy = { id: string; category: string; label: string; limit_amount: number | null; requires_receipt: boolean };
type Claim = { id: string; employee_id: string; category: string; claim_date: string; amount: number; vendor: string | null; description: string | null; receipt_path: string | null; status: string; over_policy: boolean; decision_note: string | null };
type Travel = { id: string; employee_id: string; destination: string; purpose: string; start_date: string; end_date: string; estimated_cost: number; advance_amount: number; status: string; decision_note: string | null };
type Loan = { id: string; employee_id: string; loan_type: string; principal: number; installments: number; installment_amount: number; recovered_amount: number; start_period: string; status: string; reason: string | null; decision_note: string | null };

function usePolicies() { return useRows<Policy[]>(["expense_policies"], (sb) => sb.from("expense_policies").select("*").order("label")); }

function ClaimDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { employeeId, tenantId } = useMe();
  const { data: pol = [] } = usePolicies();
  const [f, setF] = useState({ category: "", claim_date: today(), amount: "", vendor: "", description: "" });
  const [file, setFile] = useState<File | null>(null);
  const p = pol.find((x) => x.category === f.category);
  const a = useAction(async () => {
    const receipt = file ? await uploadFile("receipts", tenantId!, employeeId!, file) : null;
    return q((sb) => sb.from("expense_claims").insert({ employee_id: employeeId, category: f.category, claim_date: f.claim_date, amount: Number(f.amount), vendor: f.vendor || null, description: f.description || null, receipt_path: receipt }));
  }, { success: "Claim submitted", invalidate: ["expenses"], onDone: () => { setF({ category: "", claim_date: today(), amount: "", vendor: "", description: "" }); setFile(null); onClose(); } });
  return (
    <Dialog open={open} onClose={onClose} title="New expense claim">
      <div className="space-y-4">
        <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">Select</option>{pol.map((x) => <option key={x.id} value={x.category}>{x.label}</option>)}</Select></Field>
        {p && <p className="rounded-2xl bg-surface-muted px-4 py-2.5 text-xs text-ink-soft">Policy limit {p.limit_amount ? money(p.limit_amount) : "none"} per claim{p.requires_receipt ? " · receipt required above PKR 2,000" : ""}</p>}
        <div className="grid grid-cols-2 gap-3"><Field label="Date"><Input type="date" max={today()} value={f.claim_date} onChange={(e) => setF({ ...f, claim_date: e.target.value })} /></Field><Field label="Amount (PKR)"><Input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field></div>
        {p?.limit_amount && Number(f.amount) > p.limit_amount && <p className="text-xs text-amber-600">Above policy — this claim will need finance approval.</p>}
        <Field label="Vendor"><Input value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} placeholder="e.g. PSO Gulberg" /></Field>
        <Field label="Description"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <label className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line px-3 text-sm text-ink-soft hover:bg-surface-muted"><Paperclip className="h-4 w-4" />{file ? file.name : "Attach receipt (photo or PDF)"}<input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => a.mutate()} loading={a.isPending} disabled={!f.category || !Number(f.amount)}>Submit</Button></div>
      </div>
    </Dialog>
  );
}

function TravelDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { employeeId } = useMe();
  const [f, setF] = useState({ destination: "", purpose: "", start_date: today(), end_date: today(), estimated_cost: "", advance_amount: "" });
  const a = useAction(() => q((sb) => sb.from("travel_requests").insert({ ...f, employee_id: employeeId, estimated_cost: Number(f.estimated_cost || 0), advance_amount: Number(f.advance_amount || 0) })), { success: "Travel request sent", invalidate: ["expenses"], onDone: onClose });
  return (
    <Dialog open={open} onClose={onClose} title="New travel request">
      <div className="space-y-4">
        <Field label="Destination"><Input value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} placeholder="Karachi" /></Field>
        <Field label="Purpose"><Input value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} placeholder="Client visit" /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="From"><Input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field><Field label="To"><Input type="date" min={f.start_date} value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field></div>
        <div className="grid grid-cols-2 gap-3"><Field label="Estimated cost"><Input type="number" value={f.estimated_cost} onChange={(e) => setF({ ...f, estimated_cost: e.target.value })} /></Field><Field label="Advance needed"><Input type="number" value={f.advance_amount} onChange={(e) => setF({ ...f, advance_amount: e.target.value })} /></Field></div>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => a.mutate()} loading={a.isPending} disabled={!f.destination || !f.purpose}>Submit</Button></div>
      </div>
    </Dialog>
  );
}

function LoanDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ type: "salary_advance", principal: "", installments: "3", start: thisPeriod(), reason: "" });
  const inst = Number(f.principal) && Number(f.installments) ? Math.ceil(Number(f.principal) / Number(f.installments)) : 0;
  const a = useAction(() => rpc("request_loan", { p_type: f.type, p_principal: Number(f.principal), p_installments: Number(f.installments), p_start_period: f.start, p_reason: f.reason || null }), { success: "Loan request sent to finance", invalidate: ["expenses"], onDone: onClose });
  return (
    <Dialog open={open} onClose={onClose} title="Request a loan or advance" description="Installments are deducted automatically in payroll.">
      <div className="space-y-4">
        <Field label="Type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{["salary_advance", "personal", "emergency", "vehicle", "house"].map((t) => <option key={t} value={t}>{title(t)}</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Amount (PKR)"><Input type="number" value={f.principal} onChange={(e) => setF({ ...f, principal: e.target.value })} /></Field><Field label="Installments"><Input type="number" min="1" max="120" value={f.installments} onChange={(e) => setF({ ...f, installments: e.target.value })} /></Field></div>
        <Field label="First deduction month" hint={inst ? `${money(inst)} per month` : undefined}><Input type="month" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
        <Field label="Reason"><Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => a.mutate()} loading={a.isPending} disabled={!Number(f.principal)}>Request</Button></div>
      </div>
    </Dialog>
  );
}

function AllClaims() {
  const { employeeId } = useMe();
  const { data: emps = [] } = useEmployees(); const E = byId(emps);
  const [status, setStatus] = useState("manager_approved");
  const { data: claims = [] } = useRows<Claim[]>(["expenses", "all", status], (sb) => { let x = sb.from("expense_claims").select("*").order("created_at", { ascending: false }).limit(200); if (status) x = x.eq("status", status); return x; });
  const decide = useAction(({ id, approve, note }: { id: string; approve: boolean; note: string | null }) => rpc("decide_expense", { p_id: id, p_approve: approve, p_note: note }), { success: "Saved", invalidate: ["expenses"] });
  const total = claims.reduce((s, c) => s + Number(c.amount), 0);
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><Tabs value={status} onChange={setStatus} tabs={[{ value: "pending", label: "Pending" }, { value: "manager_approved", label: "Manager approved" }, { value: "approved", label: "Approved" }, { value: "reimbursed", label: "Reimbursed" }, { value: "", label: "All" }]} /><span className="text-sm text-ink-soft">Total {money(total)}</span></div>
      <DataTable rows={claims} columns={[
        { key: "e", label: "Employee", render: (c) => <span className="flex items-center gap-2"><Avatar name={E.get(c.employee_id)?.full_name} size="sm" />{E.get(c.employee_id)?.full_name}</span> },
        { key: "c", label: "Category", render: (c) => <span>{title(c.category)} {c.over_policy && <Badge tone="amber">Over policy</Badge>}</span> },
        { key: "d", label: "Date", render: (c) => fmtShort(c.claim_date) },
        { key: "a", label: "Amount", render: (c) => <span className="font-semibold">{money(c.amount)}</span> },
        { key: "r", label: "Receipt", render: (c) => c.receipt_path ? <button className="cursor-pointer text-brand-600" onClick={() => openFile("receipts", c.receipt_path!)}>View</button> : "—" },
        { key: "s", label: "Status", render: (c) => <StatusBadge status={c.status} /> },
        { key: "x", label: "", render: (c) => ["pending", "manager_approved"].includes(c.status) && c.employee_id !== employeeId ? <DecisionButtons requireRejectNote onDecide={(approve, note) => decide.mutate({ id: c.id, approve, note })} /> : null },
      ]} empty={<EmptyState icon={Receipt} title="No claims" />} />
    </Card>
  );
}

export default function ExpensesPage() {
  const { employeeId, role } = useMe();
  const tabs = useMemo(() => [
    ...(employeeId ? [{ value: "claims", label: "My claims" }, { value: "travel", label: "Travel" }, { value: "loans", label: "Loans & advances" }] : []),
    ...(can.finance(role) ? [{ value: "all", label: "All claims" }] : []),
  ], [employeeId, role]);
  const [tab, setTab] = useState(tabs[0]?.value ?? "claims");
  const [dlg, setDlg] = useState<null | "claim" | "travel" | "loan">(null);
  const { data: claims = [] } = useRows<Claim[]>(["expenses", "mine"], (sb) => sb.from("expense_claims").select("*").eq("employee_id", employeeId!).order("claim_date", { ascending: false }), { enabled: !!employeeId });
  const { data: trips = [] } = useRows<Travel[]>(["expenses", "travel"], (sb) => sb.from("travel_requests").select("*").eq("employee_id", employeeId!).order("start_date", { ascending: false }), { enabled: !!employeeId });
  const { data: loans = [] } = useRows<Loan[]>(["expenses", "loans"], (sb) => sb.from("loans").select("*").eq("employee_id", employeeId!).order("created_at", { ascending: false }), { enabled: !!employeeId });
  const cancel = useAction(({ table, id }: { table: string; id: string }) => q((sb) => sb.from(table).update({ status: "cancelled" }).eq("id", id)), { success: "Cancelled", invalidate: ["expenses"] });

  return (
    <div>
      <PageHeader icon={Receipt} title="Expenses, travel & loans" subtitle="Submit with a receipt photo; approved claims are reimbursed in the next payroll.">
        {tab === "claims" && <Button onClick={() => setDlg("claim")}><Plus className="h-4 w-4" />New claim</Button>}
        {tab === "travel" && <Button onClick={() => setDlg("travel")}><Plus className="h-4 w-4" />New trip</Button>}
        {tab === "loans" && <Button onClick={() => setDlg("loan")}><Plus className="h-4 w-4" />Request loan</Button>}
      </PageHeader>
      {tabs.length > 1 && <Tabs className="mb-4" value={tab} onChange={setTab} tabs={tabs} />}

      {tab === "claims" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <StatCard icon={Receipt} label="Waiting for approval" value={money(claims.filter((c) => ["pending", "manager_approved"].includes(c.status)).reduce((s, c) => s + Number(c.amount), 0))} />
            <StatCard icon={Receipt} label="Approved · next payroll" value={money(claims.filter((c) => c.status === "approved").reduce((s, c) => s + Number(c.amount), 0))} accent />
            <StatCard icon={Receipt} label="Reimbursed this year" value={money(claims.filter((c) => c.status === "reimbursed" && c.claim_date.startsWith(String(new Date().getFullYear()))).reduce((s, c) => s + Number(c.amount), 0))} />
          </div>
          <Card className="p-4"><DataTable rows={claims} columns={[
            { key: "c", label: "Category", render: (c) => <span className="font-medium">{title(c.category)} {c.over_policy && <Badge tone="amber">Over policy</Badge>}</span> },
            { key: "d", label: "Date", render: (c) => fmtDate(c.claim_date) },
            { key: "v", label: "Vendor", render: (c) => c.vendor ?? "—", hideOnMobile: true },
            { key: "a", label: "Amount", render: (c) => money(c.amount) },
            { key: "s", label: "Status", render: (c) => <span className="flex flex-col items-start"><StatusBadge status={c.status} />{c.decision_note && <span className="text-[11px] text-ink-soft">“{c.decision_note}”</span>}</span> },
            { key: "x", label: "", render: (c) => c.status === "pending" ? <Button size="sm" variant="ghost" onClick={() => cancel.mutate({ table: "expense_claims", id: c.id })}>Cancel</Button> : null },
          ]} empty={<EmptyState icon={Receipt} title="No claims yet" text="Fuel, meals, travel, mobile — submit with a photo of the receipt." />} /></Card>
        </div>
      )}
      {tab === "travel" && (
        <Card className="p-4"><DataTable rows={trips} columns={[
          { key: "d", label: "Destination", render: (t) => <span className="font-medium">{t.destination}</span> },
          { key: "p", label: "Purpose", render: (t) => t.purpose },
          { key: "w", label: "Dates", render: (t) => `${fmtShort(t.start_date)} – ${fmtShort(t.end_date)}` },
          { key: "c", label: "Estimate", render: (t) => money(t.estimated_cost) },
          { key: "s", label: "Status", render: (t) => <StatusBadge status={t.status} /> },
          { key: "x", label: "", render: (t) => t.status === "pending" ? <Button size="sm" variant="ghost" onClick={() => cancel.mutate({ table: "travel_requests", id: t.id })}>Cancel</Button> : null },
        ]} empty={<EmptyState icon={Plane} title="No trips" />} /></Card>
      )}
      {tab === "loans" && (
        <div className="grid gap-4 md:grid-cols-2">
          {loans.length === 0 && <Card className="md:col-span-2"><EmptyState icon={HandCoins} title="No loans" text="Need a salary advance? Request it here; finance approves and payroll deducts the installments." /></Card>}
          {loans.map((l) => (
            <Card key={l.id} className="p-5">
              <div className="flex items-center justify-between"><p className="font-semibold text-ink">{title(l.loan_type)}</p><StatusBadge status={l.status} /></div>
              <p className="mt-2 font-display text-2xl font-bold text-ink">{money(l.principal)}</p>
              <p className="text-sm text-ink-soft">{money(l.installment_amount)} × {l.installments} from {l.start_period}</p>
              <Progress className="mt-3" value={(Number(l.recovered_amount) / Number(l.principal)) * 100} />
              <p className="mt-1 text-xs text-ink-soft">{money(l.recovered_amount)} recovered · {money(Number(l.principal) - Number(l.recovered_amount))} remaining</p>
            </Card>
          ))}
        </div>
      )}
      {tab === "all" && <AllClaims />}
      <ClaimDialog open={dlg === "claim"} onClose={() => setDlg(null)} />
      <TravelDialog open={dlg === "travel"} onClose={() => setDlg(null)} />
      <LoanDialog open={dlg === "loan"} onClose={() => setDlg(null)} />
    </div>
  );
}
