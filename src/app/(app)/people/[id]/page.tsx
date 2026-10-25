"use client";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Banknote, Briefcase, CalendarDays, FileText, History, Mail, MapPin, Pencil, Phone, Send, ShieldAlert, TrendingUp, UserCheck, UserMinus } from "lucide-react";
import { Avatar, Badge, Button, Card, Dialog, Field, Input, Select, Tabs, Textarea } from "@/components/ui";
import { DataTable, EmptyState, ErrorState, KeyValue, Loading, SectionCard, StatusBadge } from "@/components/common";
import { EmployeeForm } from "@/components/people/employee-form";
import { byId, useBranches, useDepartments, useEmployees, useGrades, useShifts } from "@/lib/lookups";
import { openFile, q, rpc, useAction, useRows, useRpc } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { can, GRANTABLE_ROLES, ROLE_INFO, type Role } from "@/lib/roles";
import { fmtDate, fmtTime, minutes, money, title, today } from "@/lib/format";

type Emp = Record<string, string | null> & { id: string; full_name: string; status: string; employee_code: string; skills: string[] };
type Private = Record<string, string | null>;
type Comp = { id: string; effective_from: string; gross_salary: number; reason: string | null; eobi_applicable: boolean; pf_applicable: boolean };
type Hist = { id: string; event_type: string; effective_date: string; details: Record<string, { from?: unknown; to?: unknown }>; notes: string | null };

export default function EmployeeProfile() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { role, employeeId } = useMe();
  const isSelf = employeeId === id;
  const hr = can.hrStaff(role);
  const { data: e, isLoading, error } = useRows<Emp | null>(["employee", id], (sb) => sb.from("employees").select("*").eq("id", id).maybeSingle());
  const { data: priv } = useRows<Private | null>(["employee", id, "private"], (sb) => sb.from("employee_private").select("*").eq("employee_id", id).maybeSingle());
  const { data: comp = [] } = useRows<Comp[]>(["employee", id, "comp"], (sb) => sb.from("employee_compensation").select("*").eq("employee_id", id).order("effective_from", { ascending: false }));
  const { data: hist = [] } = useRows<Hist[]>(["employee", id, "history"], (sb) => sb.from("employee_job_history").select("*").eq("employee_id", id).order("effective_date", { ascending: false }).order("created_at", { ascending: false }));
  const { data: docs = [] } = useRows<{ id: string; title: string; doc_type: string; file_path: string; expires_on: string | null; is_verified: boolean }[]>(["employee", id, "docs"], (sb) => sb.from("employee_documents").select("*").eq("employee_id", id).order("created_at", { ascending: false }));
  const { data: balances = [] } = useRpc<{ code: string; name: string; available: number; entitled: number; used: number; color: string }[]>(["employee", id, "leave"], "my_leave_balances", { p_employee: id });
  const { data: att = [] } = useRows<{ id: string; work_date: string; clock_in_at: string | null; clock_out_at: string | null; status: string; worked_minutes: number }[]>(["employee", id, "att"], (sb) => sb.from("attendance_records").select("id, work_date, clock_in_at, clock_out_at, status, worked_minutes").eq("employee_id", id).order("work_date", { ascending: false }).limit(31));
  const { data: depts = [] } = useDepartments(); const { data: branches = [] } = useBranches(); const { data: grades = [] } = useGrades(); const { data: shifts = [] } = useShifts(); const { data: emps = [] } = useEmployees();
  const D = byId(depts), B = byId(branches), G = byId(grades), S = byId(shifts), E = byId(emps);
  const [tab, setTab] = useState("overview");
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<null | "salary" | "letter" | "invite" | "separation" | "personal">(null);

  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} />;
  if (!e) return <EmptyState title="Employee not found" />;
  const current = comp.find((c) => c.effective_from <= today());
  const canSeePrivate = !!priv;

  const tabs = [
    { value: "overview", label: "Overview" },
    { value: "job", label: "Job & history" },
    ...(comp.length || can.viewPay(role) ? [{ value: "pay", label: "Pay" }] : []),
    ...(canSeePrivate ? [{ value: "personal", label: "Personal" }] : []),
    ...(isSelf || hr ? [{ value: "documents", label: "Documents" }] : []),
    ...(att.length || balances.length ? [{ value: "time", label: "Time & leave" }] : []),
  ];

  return (
    <div className="space-y-6">
      <button onClick={() => router.back()} className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-ink-soft hover:text-ink"><ArrowLeft className="h-4 w-4" />Back</button>

      <Card className="overflow-hidden">
        <div className="brand-glow h-28" />
        <div className="flex flex-col gap-4 px-6 pb-6 sm:flex-row sm:items-end">
          <Avatar name={e.full_name} size="lg" className="-mt-10 h-24 w-24 text-2xl ring-4 ring-surface" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><h1 className="font-display text-2xl font-bold text-ink">{e.full_name}</h1><StatusBadge status={e.status} /></div>
            <p className="text-ink-soft">{e.job_title ?? "—"} · {D.get(e.department_id ?? "")?.name ?? "No department"}</p>
            <div className="mt-2 flex flex-wrap gap-4 text-sm text-ink-soft">
              <span className="inline-flex items-center gap-1.5"><Briefcase className="h-4 w-4" />{e.employee_code}</span>
              {e.work_email && <span className="inline-flex items-center gap-1.5"><Mail className="h-4 w-4" />{e.work_email}</span>}
              {e.phone && <span className="inline-flex items-center gap-1.5"><Phone className="h-4 w-4" />{e.phone}</span>}
              {e.branch_id && <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" />{B.get(e.branch_id)?.name}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {hr && <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" />Edit</Button>}
            {can.writeCompSalary(role) && <Button variant="outline" size="sm" onClick={() => setDialog("salary")}><TrendingUp className="h-4 w-4" />Salary revision</Button>}
            {hr && <Button variant="outline" size="sm" onClick={() => setDialog("letter")}><FileText className="h-4 w-4" />Issue letter</Button>}
            {can.hrLead(role) && !e.user_id && <Button variant="outline" size="sm" onClick={() => setDialog("invite")}><Send className="h-4 w-4" />Invite to app</Button>}
            {hr && e.status === "probation" && <ConfirmProbation id={e.id} />}
            {(hr || isSelf) && !["exited", "notice"].includes(e.status) && <Button variant="outline" size="sm" onClick={() => setDialog("separation")}><UserMinus className="h-4 w-4" />{isSelf ? "Resign" : "Separation"}</Button>}
          </div>
        </div>
      </Card>

      <Tabs value={tab} onChange={setTab} tabs={tabs} />

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <SectionCard className="lg:col-span-2" icon={Briefcase} title="Employment">
            <KeyValue items={[
              ["Reports to", e.manager_id ? E.get(e.manager_id)?.full_name : "—"], ["Employment type", title(e.employment_type)],
              ["Joined", fmtDate(e.joining_date)], ["Probation ends", fmtDate(e.probation_end_date)],
              ["Grade", e.grade_id ? `${G.get(e.grade_id)?.code} · ${G.get(e.grade_id)?.name}` : "—"], ["Shift", S.get(e.shift_id ?? "")?.name ?? "—"],
              ["Direct reports", emps.filter((x) => x.manager_id === e.id && x.status !== "exited").length], ["Exit date", fmtDate(e.exit_date)],
            ]} />
          </SectionCard>
          <SectionCard icon={UserCheck} title="Skills">
            {e.skills?.length ? <div className="flex flex-wrap gap-2">{e.skills.map((s) => <Badge key={s} tone="brand">{s}</Badge>)}</div> : <p className="text-sm text-ink-soft">No skills listed.</p>}
            {(hr || isSelf) && <SkillsEditor id={e.id} skills={e.skills ?? []} />}
          </SectionCard>
        </div>
      )}

      {tab === "job" && (
        <SectionCard icon={History} title="Job history" subtitle="Every lifecycle event, effective-dated">
          {hist.length === 0 ? <EmptyState title="No history yet" /> : (
            <ol className="relative space-y-5 border-l border-line pl-6">
              {hist.map((h) => (
                <li key={h.id} className="relative">
                  <span className="absolute -left-[31px] top-1 h-3 w-3 rounded-full bg-brand-500 ring-4 ring-surface" />
                  <p className="text-sm font-semibold text-ink">{title(h.event_type)} <span className="font-normal text-ink-soft">· {fmtDate(h.effective_date)}</span></p>
                  <ul className="mt-1 text-sm text-ink-soft">
                    {Object.entries(h.details ?? {}).map(([k, v]) => {
                      const label = (x: unknown) => k === "department_id" ? D.get(String(x))?.name : k === "branch_id" ? B.get(String(x))?.name : k === "grade_id" ? G.get(String(x))?.code : k === "manager_id" ? E.get(String(x))?.full_name : k === "gross_salary" ? money(Number(x)) : String(x ?? "—");
                      return <li key={k}>{title(k.replace("_id", ""))}: {v.from !== undefined ? `${label(v.from) ?? "—"} → ` : ""}{label(v.to) ?? "—"}</li>;
                    })}
                  </ul>
                  {h.notes && <p className="mt-1 text-sm text-ink-soft">“{h.notes}”</p>}
                </li>
              ))}
            </ol>
          )}
        </SectionCard>
      )}

      {tab === "pay" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <SectionCard icon={Banknote} title="Current salary">
            {current ? (
              <div>
                <p className="font-display text-3xl font-bold text-ink">{money(current.gross_salary)}</p>
                <p className="text-sm text-ink-soft">gross per month since {fmtDate(current.effective_from)}</p>
                <div className="mt-3 flex gap-2">{current.eobi_applicable && <Badge tone="sky">EOBI</Badge>}{current.pf_applicable && <Badge tone="violet">Provident fund</Badge>}</div>
              </div>
            ) : <p className="text-sm text-ink-soft">No salary on record.</p>}
          </SectionCard>
          <SectionCard className="lg:col-span-2" icon={History} title="Salary history">
            <DataTable rows={comp} columns={[
              { key: "d", label: "Effective", render: (c) => fmtDate(c.effective_from) },
              { key: "g", label: "Gross", render: (c) => <span className="font-medium">{money(c.gross_salary)}</span> },
              { key: "r", label: "Reason", render: (c) => c.reason ?? "—" },
            ]} empty={<EmptyState title="No salary records" />} />
          </SectionCard>
        </div>
      )}

      {tab === "personal" && priv && (
        <SectionCard icon={ShieldAlert} title="Personal information" subtitle="Visible only to the employee, HR in scope and payroll" action={isSelf || hr ? <Button size="sm" variant="outline" onClick={() => setDialog("personal")}><Pencil className="h-4 w-4" />Edit</Button> : undefined}>
          <KeyValue cols={3} items={[
            ["CNIC", priv.cnic], ["CNIC expiry", fmtDate(priv.cnic_expiry)], ["Date of birth", fmtDate(priv.date_of_birth)],
            ["Marital status", title(priv.marital_status)], ["Personal email", priv.personal_email], ["Blood group", priv.blood_group],
            ["Address", priv.address], ["City", priv.city], ["Emergency contact", priv.emergency_contact_name ? `${priv.emergency_contact_name} · ${priv.emergency_contact_phone ?? ""}` : "—"],
            ["Bank", priv.bank_name], ["IBAN", priv.bank_account_no ? priv.bank_account_no.replace(/.(?=.{4})/g, "•") : "—"],
          ]} />
        </SectionCard>
      )}

      {tab === "documents" && (
        <SectionCard icon={FileText} title="Documents" action={<Button size="sm" variant="subtle" onClick={() => router.push("/documents")}>Upload in Documents</Button>}>
          <DataTable rows={docs} columns={[
            { key: "t", label: "Document", render: (d) => <button className="cursor-pointer font-medium text-brand-600" onClick={() => openFile("hr-documents", d.file_path)}>{d.title}</button> },
            { key: "k", label: "Type", render: (d) => title(d.doc_type) },
            { key: "x", label: "Expires", render: (d) => fmtDate(d.expires_on) },
            { key: "v", label: "Status", render: (d) => d.is_verified ? <Badge tone="green" dot>Verified</Badge> : <Badge tone="amber" dot>Pending</Badge> },
          ]} empty={<EmptyState title="No documents uploaded" />} />
        </SectionCard>
      )}

      {tab === "time" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <SectionCard icon={CalendarDays} title="Leave balance">
            <ul className="space-y-2">{balances.map((b) => <li key={b.code} className="flex justify-between text-sm"><span className="flex items-center gap-2 text-ink-soft"><span className="h-2.5 w-2.5 rounded-full" style={{ background: b.color }} />{b.name}</span><span className="font-medium text-ink">{b.available} / {b.entitled}</span></li>)}</ul>
          </SectionCard>
          <SectionCard className="lg:col-span-2" icon={UserCheck} title="Recent attendance">
            <DataTable rows={att} columns={[
              { key: "d", label: "Date", render: (a) => fmtDate(a.work_date) },
              { key: "i", label: "In", render: (a) => fmtTime(a.clock_in_at) },
              { key: "o", label: "Out", render: (a) => fmtTime(a.clock_out_at) },
              { key: "w", label: "Worked", render: (a) => minutes(a.worked_minutes) },
              { key: "s", label: "Status", render: (a) => <StatusBadge status={a.status} /> },
            ]} empty={<EmptyState title="No attendance yet" />} />
          </SectionCard>
        </div>
      )}

      <EmployeeForm open={editing} onClose={() => setEditing(false)} editing={e} />
      <SalaryDialog open={dialog === "salary"} onClose={() => setDialog(null)} employeeId={e.id} current={current} />
      <LetterDialog open={dialog === "letter"} onClose={() => setDialog(null)} employeeId={e.id} />
      <InviteDialog open={dialog === "invite"} onClose={() => setDialog(null)} employeeId={e.id} email={e.work_email ?? ""} />
      <SeparationDialog open={dialog === "separation"} onClose={() => setDialog(null)} employeeId={e.id} self={isSelf} />
      <PersonalDialog open={dialog === "personal"} onClose={() => setDialog(null)} employeeId={e.id} priv={priv ?? {}} hr={hr} />
    </div>
  );
}

function ConfirmProbation({ id }: { id: string }) {
  const a = useAction(() => q((sb) => sb.from("employees").update({ status: "active", confirmation_date: today() }).eq("id", id)), { success: "Employment confirmed", invalidate: ["employee", "employees"] });
  return <Button size="sm" onClick={() => a.mutate()} loading={a.isPending}><UserCheck className="h-4 w-4" />Confirm</Button>;
}

function SkillsEditor({ id, skills }: { id: string; skills: string[] }) {
  const [v, setV] = useState("");
  const a = useAction((list: string[]) => q((sb) => sb.from("employees").update({ skills: list }).eq("id", id)), { invalidate: ["employee", "employees"] });
  return (
    <form className="mt-3 flex gap-2" onSubmit={(ev) => { ev.preventDefault(); if (v.trim()) { a.mutate([...skills, ...v.split(",").map((s) => s.trim()).filter(Boolean)]); setV(""); } }}>
      <Input value={v} onChange={(ev) => setV(ev.target.value)} placeholder="Add skills, comma separated" className="h-9" />
      <Button size="sm" variant="subtle" type="submit">Add</Button>
    </form>
  );
}

function SalaryDialog({ open, onClose, employeeId, current }: { open: boolean; onClose: () => void; employeeId: string; current?: Comp }) {
  const [gross, setGross] = useState(""); const [from, setFrom] = useState(today()); const [reason, setReason] = useState("Annual increment");
  const [pf, setPf] = useState(current?.pf_applicable ?? false);
  const a = useAction(() => q((sb) => sb.from("employee_compensation").insert({ employee_id: employeeId, gross_salary: Number(gross), effective_from: from, reason, pf_applicable: pf, eobi_applicable: current?.eobi_applicable ?? true })),
    { success: "Salary revision saved", invalidate: ["employee"], onDone: onClose });
  const pct = current && gross ? ((Number(gross) - current.gross_salary) / current.gross_salary) * 100 : null;
  return (
    <Dialog open={open} onClose={onClose} title="Salary revision" description={current ? `Current gross ${money(current.gross_salary)}` : "Set the first salary"}>
      <div className="space-y-4">
        <Field label="New monthly gross (PKR)" hint={pct != null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% change` : undefined}><Input type="number" value={gross} onChange={(ev) => setGross(ev.target.value)} autoFocus /></Field>
        <Field label="Effective from"><Input type="date" value={from} onChange={(ev) => setFrom(ev.target.value)} /></Field>
        <Field label="Reason"><Select value={reason} onChange={(ev) => setReason(ev.target.value)}>{["Annual increment", "Promotion", "Market adjustment", "Confirmation", "Correction"].map((r) => <option key={r}>{r}</option>)}</Select></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pf} onChange={(ev) => setPf(ev.target.checked)} />Provident fund member</label>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => a.mutate()} loading={a.isPending} disabled={!Number(gross)}>Save</Button></div>
      </div>
    </Dialog>
  );
}

function LetterDialog({ open, onClose, employeeId }: { open: boolean; onClose: () => void; employeeId: string }) {
  const { data: templates = [] } = useRows<{ id: string; name: string }[]>(["letter_templates"], (sb) => sb.from("letter_templates").select("id, name").order("name"), { enabled: open });
  const [t, setT] = useState("");
  const a = useAction(() => rpc("issue_letter", { p_employee: employeeId, p_template: t }), { success: "Letter issued — find it in Documents", invalidate: ["letters"], onDone: onClose });
  return (
    <Dialog open={open} onClose={onClose} title="Issue HR letter" description="Merge fields fill in automatically. Each letter gets a verification code.">
      <Field label="Template"><Select value={t} onChange={(ev) => setT(ev.target.value)}><option value="">Select</option>{templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
      <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => a.mutate()} disabled={!t} loading={a.isPending}>Issue</Button></div>
    </Dialog>
  );
}

function InviteDialog({ open, onClose, employeeId, email }: { open: boolean; onClose: () => void; employeeId: string; email: string }) {
  const [em, setEm] = useState(email); const [r, setR] = useState<Role>("employee");
  const a = useAction(() => rpc<string>("invite_user", { p_email: em, p_role: r, p_employee: employeeId }), { success: (res) => res === "added" ? "User added to the company" : "Invitation saved — they join when they sign up with this email", invalidate: ["members"], onDone: onClose });
  return (
    <Dialog open={open} onClose={onClose} title="Invite to the app">
      <div className="space-y-4">
        <Field label="Email"><Input type="email" value={em} onChange={(ev) => setEm(ev.target.value)} /></Field>
        <Field label="Role"><Select value={r} onChange={(ev) => setR(ev.target.value as Role)}>{GRANTABLE_ROLES.map((x) => <option key={x} value={x}>{ROLE_INFO[x].label}</option>)}</Select></Field>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => a.mutate()} loading={a.isPending}>Send invite</Button></div>
      </div>
    </Dialog>
  );
}

function SeparationDialog({ open, onClose, employeeId, self }: { open: boolean; onClose: () => void; employeeId: string; self: boolean }) {
  const [type, setType] = useState("resignation");
  const [lwd, setLwd] = useState(() => { const x = new Date(); x.setDate(x.getDate() + 30); return x.toISOString().slice(0, 10); });
  const [reason, setReason] = useState("");
  const a = useAction(() => rpc("start_separation", { p_employee: employeeId, p_type: self ? "resignation" : type, p_last_day: lwd, p_reason: reason || null }),
    { success: self ? "Resignation submitted to HR and your manager" : "Separation started · offboarding checklist created", invalidate: ["employee", "employees", "lifecycle"], onDone: onClose });
  return (
    <Dialog open={open} onClose={onClose} title={self ? "Submit resignation" : "Start separation"} description="This starts the notice period and the offboarding checklist.">
      <div className="space-y-4">
        {!self && <Field label="Type"><Select value={type} onChange={(ev) => setType(ev.target.value)}>{["resignation", "termination", "retirement", "contract_end"].map((t) => <option key={t} value={t}>{title(t)}</option>)}</Select></Field>}
        <Field label="Last working day"><Input type="date" value={lwd} onChange={(ev) => setLwd(ev.target.value)} /></Field>
        <Field label="Reason"><Textarea value={reason} onChange={(ev) => setReason(ev.target.value)} /></Field>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" onClick={() => a.mutate()} loading={a.isPending}>Submit</Button></div>
      </div>
    </Dialog>
  );
}

function PersonalDialog({ open, onClose, employeeId, priv, hr }: { open: boolean; onClose: () => void; employeeId: string; priv: Private; hr: boolean }) {
  const fields: [string, string, string?][] = [["personal_email", "Personal email", "email"], ["address", "Address"], ["city", "City"], ["marital_status", "Marital status"],
    ["blood_group", "Blood group"], ["emergency_contact_name", "Emergency contact name"], ["emergency_contact_phone", "Emergency contact phone"],
    ...(hr ? [["cnic", "CNIC"], ["cnic_expiry", "CNIC expiry", "date"], ["date_of_birth", "Date of birth", "date"], ["bank_name", "Bank"], ["bank_account_no", "IBAN"]] as [string, string, string?][] : [])];
  const [f, setF] = useState<Private>({});
  const vals = { ...priv, ...f };
  const a = useAction(() => q((sb) => sb.from("employee_private").update(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v || null]))).eq("employee_id", employeeId)),
    { success: "Saved", invalidate: ["employee"], onDone: () => { setF({}); onClose(); } });
  return (
    <Dialog open={open} onClose={onClose} title="Edit personal information" description={hr ? undefined : "CNIC, date of birth and bank details are changed by HR."} className="max-w-2xl">
      <div className="grid gap-4 sm:grid-cols-2">{fields.map(([k, label, type]) => <Field key={k} label={label}><Input type={type ?? "text"} value={vals[k] ?? ""} onChange={(ev) => setF((x) => ({ ...x, [k]: ev.target.value }))} /></Field>)}</div>
      <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => a.mutate()} loading={a.isPending} disabled={!Object.keys(f).length}>Save</Button></div>
    </Dialog>
  );
}
