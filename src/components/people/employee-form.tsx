"use client";
import { useEffect, useState } from "react";
import { Button, Drawer, Field, Input, Select } from "@/components/ui";
import { useBranches, useDepartments, useEmployees, useGrades, useShifts } from "@/lib/lookups";
import { rpc, q, useAction } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { can } from "@/lib/roles";
import { today } from "@/lib/format";

export const EMPLOYMENT_TYPES = ["permanent", "probation", "contract", "intern", "consultant", "daily_wager", "part_time"];
export const STATUSES = ["active", "probation", "notice", "suspended", "exited"];

type Form = Record<string, string | boolean>;
const empty: Form = { full_name: "", work_email: "", phone: "", gender: "", job_title: "", department_id: "", branch_id: "", grade_id: "", manager_id: "", shift_id: "",
  employment_type: "permanent", joining_date: today(), gross_salary: "", pf_applicable: false, eobi_applicable: true, cnic: "", date_of_birth: "", bank_name: "", bank_account_no: "", invite: true };

/** Add a new employee (hire_employee) or edit an existing one (direct update under RLS). */
export function EmployeeForm({ open, onClose, editing }: { open: boolean; onClose: () => void; editing?: Record<string, unknown> | null }) {
  const { role } = useMe();
  const { data: depts = [] } = useDepartments();
  const { data: branches = [] } = useBranches();
  const { data: grades = [] } = useGrades();
  const { data: shifts = [] } = useShifts();
  const { data: emps = [] } = useEmployees();
  const [f, setF] = useState<Form>(empty);
  const set = (k: string, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!open) return;
    if (editing) setF({ ...empty, ...Object.fromEntries(Object.entries(editing).map(([k, v]) => [k, v == null ? "" : (v as string)])) });
    else setF(empty);
  }, [open, editing]);

  const save = useAction(async () => {
    if (editing) {
      const patch = { full_name: f.full_name, work_email: f.work_email || null, phone: f.phone || null, gender: f.gender || null, job_title: f.job_title || null,
        department_id: f.department_id || null, branch_id: f.branch_id || null, grade_id: f.grade_id || null, manager_id: f.manager_id || null, shift_id: f.shift_id || null,
        employment_type: f.employment_type, status: f.status, probation_end_date: f.probation_end_date || null };
      await q((sb) => sb.from("employees").update(patch).eq("id", editing.id as string));
      return editing.id as string;
    }
    const payload: Record<string, unknown> = { ...f };
    if (!can.writeCompSalary(role)) delete payload.gross_salary;
    if (f.invite && f.work_email) payload.invite_email = f.work_email;
    return rpc<string>("hire_employee", { p: payload });
  }, { success: editing ? "Employee updated" : "Employee added · onboarding checklist created", invalidate: ["employees", "employee"], onDone: onClose });

  const text = (k: string, label: string, type = "text", ph?: string) => <Field label={label}><Input type={type} value={String(f[k] ?? "")} placeholder={ph} onChange={(e) => set(k, e.target.value)} /></Field>;
  const pick = (k: string, label: string, opts: { value: string; label: string }[], blank = "—") => (
    <Field label={label}><Select value={String(f[k] ?? "")} onChange={(e) => set(k, e.target.value)}><option value="">{blank}</option>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>
  );

  return (
    <Drawer open={open} onClose={onClose} title={editing ? "Edit employee" : "Add employee"} className="max-w-2xl"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={String(f.full_name).trim().length < 2}>{editing ? "Save changes" : "Add employee"}</Button></>}>
      <div className="space-y-6">
        <section>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-soft">Basic details</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {text("full_name", "Full name *")}
            {text("work_email", "Work email", "email", "name@company.com")}
            {text("phone", "Phone", "tel", "03xx-xxxxxxx")}
            {pick("gender", "Gender", [{ value: "female", label: "Female" }, { value: "male", label: "Male" }, { value: "other", label: "Other" }])}
          </div>
        </section>
        <section>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-soft">Job</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {text("job_title", "Job title")}
            {pick("department_id", "Department", depts.map((d) => ({ value: d.id, label: d.name })))}
            {pick("branch_id", "Branch / location", branches.map((d) => ({ value: d.id, label: d.name })), "Head office (default)")}
            {pick("manager_id", "Reports to", emps.filter((e) => e.id !== editing?.id && e.status !== "exited").map((d) => ({ value: d.id, label: `${d.full_name} · ${d.job_title ?? ""}` })))}
            {pick("grade_id", "Grade", grades.map((d) => ({ value: d.id, label: `${d.code} · ${d.name}` })))}
            {pick("shift_id", "Shift", shifts.map((d) => ({ value: d.id, label: d.name })), "Default shift")}
            {pick("employment_type", "Employment type", EMPLOYMENT_TYPES.map((t) => ({ value: t, label: t.replace("_", " ") })), "Select")}
            {editing ? pick("status", "Status", STATUSES.map((t) => ({ value: t, label: t })), "Select") : text("joining_date", "Joining date", "date")}
            {editing && text("probation_end_date", "Probation ends", "date")}
          </div>
        </section>
        {!editing && (
          <>
            {can.writeCompSalary(role) && (
              <section>
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-soft">Pay</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  {text("gross_salary", "Monthly gross salary (PKR)", "number", "e.g. 120000")}
                  <div className="flex flex-col justify-end gap-2 pb-1 text-sm text-ink">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={!!f.eobi_applicable} onChange={(e) => set("eobi_applicable", e.target.checked)} />EOBI applies</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={!!f.pf_applicable} onChange={(e) => set("pf_applicable", e.target.checked)} />Provident fund member</label>
                  </div>
                </div>
              </section>
            )}
            <section>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-soft">Personal & bank (private)</p>
              <div className="grid gap-4 sm:grid-cols-2">
                {text("cnic", "CNIC", "text", "35202-1234567-1")}
                {text("date_of_birth", "Date of birth", "date")}
                {text("bank_name", "Bank")}
                {text("bank_account_no", "IBAN", "text", "PK36HABB…")}
              </div>
            </section>
            <label className="flex items-center gap-2 rounded-2xl bg-surface-muted p-4 text-sm text-ink">
              <input type="checkbox" checked={!!f.invite} onChange={(e) => set("invite", e.target.checked)} />
              Invite to the app with the work email (Employee role)
            </label>
          </>
        )}
      </div>
    </Drawer>
  );
}
