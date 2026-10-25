"use client";
import { useEffect, useMemo, useState } from "react";
import { Building, Calculator, CalendarDays, Clock, FileText, LocateFixed, Network, Palette, Receipt, Settings as Gear } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, Field, Input, Select, Tabs } from "@/components/ui";
import { PageHeader, SectionCard } from "@/components/common";
import { CrudTable } from "@/components/crud";
import { AccentPicker, ThemeToggle } from "@/components/theme-controls";
import { RequireAccess } from "@/components/guard";
import { useBranches, useDepartments, useEmployees } from "@/lib/lookups";
import { q, useAction, useRows } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/roles";
import { money } from "@/lib/format";

function Company() {
  const { ctx, refresh } = useAuth();
  const [f, setF] = useState({ name: "", currency: "PKR", timezone: "Asia/Karachi", logo_url: "", brand_color: "#0284c7" });
  useEffect(() => { if (ctx?.tenant) setF({ name: ctx.tenant.name, currency: ctx.tenant.currency, timezone: ctx.tenant.timezone, logo_url: ctx.tenant.logo_url ?? "", brand_color: ctx.tenant.brand_color ?? "#0284c7" }); }, [ctx?.tenant]);
  const save = useAction(() => q((sb) => sb.from("tenants").update({ ...f, logo_url: f.logo_url || null }).eq("id", ctx!.tenant!.id)), { success: "Company updated", onDone: () => refresh() });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionCard icon={Building} title="Company profile">
        <div className="space-y-4">
          <Field label="Company name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} disabled={!can.tenantAdmin(ctx?.role)} /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Currency"><Input value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} disabled={!can.tenantAdmin(ctx?.role)} /></Field><Field label="Time zone"><Select value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} disabled={!can.tenantAdmin(ctx?.role)}>{["Asia/Karachi", "Asia/Dubai", "Asia/Riyadh", "Europe/London", "America/New_York"].map((t) => <option key={t}>{t}</option>)}</Select></Field></div>
          <Field label="Logo URL"><Input value={f.logo_url} onChange={(e) => setF({ ...f, logo_url: e.target.value })} placeholder="https://" disabled={!can.tenantAdmin(ctx?.role)} /></Field>
          <div className="rounded-2xl bg-surface-muted p-4 text-sm text-ink-soft">Plan: <span className="font-medium text-ink">{ctx?.tenant?.plan}</span> · status {ctx?.tenant?.status} · {ctx?.tenant?.seat_limit} seats · careers page <span className="font-medium text-ink">/careers?c={ctx?.tenant?.slug}</span></div>
          {can.tenantAdmin(ctx?.role) && <Button onClick={() => save.mutate()} loading={save.isPending}>Save</Button>}
        </div>
      </SectionCard>
      <SectionCard icon={Palette} title="Appearance" subtitle="Personal preference on this device">
        <div className="space-y-5"><div><p className="mb-2 text-sm font-medium text-ink">Theme</p><ThemeToggle /></div><div><p className="mb-2 text-sm font-medium text-ink">Accent colour</p><AccentPicker /></div></div>
      </SectionCard>
    </div>
  );
}

function Organization({ edit }: { edit: boolean }) {
  const { data: depts = [] } = useDepartments(); const { data: emps = [] } = useEmployees(); const { data: entities = [] } = useRows<{ id: string; name: string }[]>(["legal_entities"], (sb) => sb.from("legal_entities").select("id, name"));
  const { data: ccs = [] } = useRows<{ id: string; name: string; code: string }[]>(["cost_centers"], (sb) => sb.from("cost_centers").select("id, name, code"));
  const empOpts = emps.filter((e) => e.status !== "exited").map((e) => ({ value: e.id, label: e.full_name }));
  return (
    <div className="space-y-4">
      <CrudTable table="branches" title="Branches & geofences" order="name" canEdit={edit} emptyText="Add each office, factory or store. Set coordinates to enable geofenced clock-in."
        fields={[{ key: "name", label: "Name", required: true }, { key: "code", label: "Code" }, { key: "city", label: "City" }, { key: "address", label: "Address", list: false, full: true },
          { key: "latitude", label: "Latitude", type: "number", list: false }, { key: "longitude", label: "Longitude", type: "number", list: false },
          { key: "geofence_radius_m", label: "Geofence radius (m)", type: "number", default: 150, render: (v, r) => r.latitude ? `${v} m` : "Off" },
          { key: "legal_entity_id", label: "Legal entity", type: "select", options: entities.map((x) => ({ value: x.id, label: x.name })), list: false },
          { key: "is_active", label: "Active", type: "checkbox", default: true }]}
        extra={(row, set) => (
          <Button variant="outline" size="sm" className="mt-3" onClick={() => navigator.geolocation?.getCurrentPosition((p) => { set({ ...row, latitude: p.coords.latitude.toFixed(6), longitude: p.coords.longitude.toFixed(6) }); toast.success("Location captured"); }, () => toast.error("Location permission denied"), { enableHighAccuracy: true })}>
            <LocateFixed className="h-4 w-4" />Use my current location
          </Button>
        )} />
      <CrudTable table="departments" title="Departments" order="name" canEdit={edit}
        fields={[{ key: "name", label: "Name", required: true }, { key: "code", label: "Code" }, { key: "parent_id", label: "Parent", type: "select", options: depts.map((d) => ({ value: d.id, label: d.name })) },
          { key: "head_employee_id", label: "Head", type: "select", options: empOpts }, { key: "cost_center_id", label: "Cost centre", type: "select", options: ccs.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` })), list: false }]} />
      <CrudTable table="grades" title="Grades & salary bands" order="sort_order" canEdit={edit}
        fields={[{ key: "code", label: "Code", required: true }, { key: "name", label: "Name", required: true }, { key: "band_min", label: "Band min", type: "number", required: true, render: (v) => money(Number(v)) },
          { key: "band_mid", label: "Band mid", type: "number", required: true, render: (v) => money(Number(v)) }, { key: "band_max", label: "Band max", type: "number", required: true, render: (v) => money(Number(v)) }, { key: "sort_order", label: "Order", type: "number", default: 0 }]} />
      <div className="grid gap-4 lg:grid-cols-2">
        <CrudTable table="legal_entities" title="Legal entities" order="name" canEdit={edit} fields={[{ key: "name", label: "Name", required: true }, { key: "ntn", label: "NTN" }, { key: "registration_no", label: "Registration no.", list: false }, { key: "address", label: "Address", list: false, full: true }]} />
        <CrudTable table="cost_centers" title="Cost centres" order="code" canEdit={edit} fields={[{ key: "code", label: "Code", required: true }, { key: "name", label: "Name", required: true }, { key: "monthly_budget", label: "Monthly budget", type: "number", render: (v) => (v ? money(Number(v)) : "—") }]} />
      </div>
    </div>
  );
}

function Time({ edit }: { edit: boolean }) {
  const { data: branches = [] } = useBranches();
  return (
    <div className="space-y-4">
      <CrudTable table="shifts" title="Shifts" order="start_time" canEdit={edit}
        fields={[{ key: "name", label: "Name", required: true }, { key: "start_time", label: "Start", type: "time", required: true }, { key: "end_time", label: "End", type: "time", required: true },
          { key: "grace_minutes", label: "Grace (min)", type: "number", default: 15 }, { key: "break_minutes", label: "Break (min)", type: "number", default: 60, list: false }, { key: "half_day_minutes", label: "Half day below (min)", type: "number", default: 240, list: false },
          { key: "working_days", label: "Working days", type: "days" }, { key: "is_night", label: "Night shift", type: "checkbox" }, { key: "color", label: "Colour", type: "color", default: "#0ea5e9" }]} />
      <CrudTable table="holidays" title="Public holidays" order="holiday_date" canEdit={edit} emptyText="Add Pakistan public holidays; mark Eid dates as tentative until moon sighting."
        fields={[{ key: "name", label: "Name", required: true }, { key: "holiday_date", label: "Date", type: "date", required: true }, { key: "branch_id", label: "Branch (empty = all)", type: "select", options: branches.map((b) => ({ value: b.id, label: b.name })), render: (v) => branches.find((b) => b.id === v)?.name ?? "All branches" }, { key: "is_tentative", label: "Tentative", type: "checkbox" }]} />
    </div>
  );
}

function Leave({ edit }: { edit: boolean }) {
  return <CrudTable table="leave_types" title="Leave types" order="code" canEdit={edit}
    fields={[{ key: "code", label: "Code", required: true }, { key: "name", label: "Name", required: true }, { key: "days_per_year", label: "Days / year", type: "number", required: true },
      { key: "accrual", label: "Accrual", type: "select", options: [{ value: "annual", label: "Up-front each year" }, { value: "monthly", label: "Monthly" }], default: "annual" },
      { key: "is_paid", label: "Paid", type: "checkbox", default: true }, { key: "carry_forward_max", label: "Carry forward max", type: "number", default: 0, list: false },
      { key: "max_consecutive_days", label: "Max consecutive days", type: "number", list: false }, { key: "requires_document_after_days", label: "Document after (days)", type: "number", list: false },
      { key: "min_service_days", label: "Min service days", type: "number", default: 0, list: false }, { key: "gender_restriction", label: "Only for", type: "select", options: [{ value: "female", label: "Female" }, { value: "male", label: "Male" }], list: false },
      { key: "allow_half_day", label: "Half day allowed", type: "checkbox", default: true, list: false }, { key: "encashable", label: "Encashable at exit", type: "checkbox", list: false },
      { key: "count_weekly_offs", label: "Count weekly offs (sandwich)", type: "checkbox", list: false }, { key: "color", label: "Colour", type: "color", default: "#0ea5e9" }, { key: "is_active", label: "Active", type: "checkbox", default: true }]} />;
}

function Payroll({ edit }: { edit: boolean }) {
  const { ctx } = useAuth();
  const { data: s } = useRows<Record<string, unknown> | null>(["payroll_settings"], (sb) => sb.from("payroll_settings").select("*").maybeSingle());
  const [f, setF] = useState<Record<string, unknown>>({});
  const v = { ...(s ?? {}), ...f };
  const save = useAction(() => q((sb) => sb.from("payroll_settings").update(Object.fromEntries(Object.entries(f).map(([k, x]) => [k, typeof x === "string" && !isNaN(Number(x)) && k !== "fiscal_year" ? Number(x) : x]))).eq("tenant_id", ctx!.tenant!.id)), { success: "Payroll settings saved", invalidate: ["payroll_settings"], onDone: () => setF({}) });
  const num = (k: string, label: string, hint?: string, step = "1") => <Field label={label} hint={hint}><Input type="number" step={step} value={String(v[k] ?? "")} disabled={!edit} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>;
  return (
    <div className="space-y-4">
      <SectionCard icon={Calculator} title="Pay structure & statutory" subtitle="Used by every payroll calculation">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Fiscal year (tax slabs)"><Input value={String(v.fiscal_year ?? "")} disabled={!edit} onChange={(e) => setF({ ...f, fiscal_year: e.target.value })} /></Field>
          {num("basic_pct_of_gross", "Basic % of gross", "0.60 = 60%", "0.01")}{num("hra_pct_of_basic", "House rent % of basic", "0.45 = 45%", "0.01")}{num("medical_pct_of_basic", "Medical % of basic", "Tax-exempt up to 10%", "0.01")}
          {num("eobi_employee_amount", "EOBI employee (PKR)")}{num("eobi_employer_amount", "EOBI employer (PKR)")}{num("pf_rate", "Provident fund rate", "0.0833 = 8.33% of basic", "0.0001")}{num("overtime_multiplier", "Overtime multiplier", undefined, "0.1")}
          {num("working_days_per_month", "Working days / month")}{num("hours_per_day", "Hours / day", undefined, "0.5")}{num("lates_per_half_day", "Lates per ½ day deduction")}{num("pay_day", "Pay day (of next month)")}
        </div>
        <div className="mt-4 flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" disabled={!edit} checked={!!v.deduct_absent_days} onChange={(e) => setF({ ...f, deduct_absent_days: e.target.checked })} />Deduct absent days</label>
          <label className="flex items-center gap-2"><input type="checkbox" disabled={!edit} checked={!!v.enforce_maker_checker} onChange={(e) => setF({ ...f, enforce_maker_checker: e.target.checked })} />Enforce maker-checker (recommended)</label>
        </div>
        {edit && <Button className="mt-4" onClick={() => save.mutate()} disabled={!Object.keys(f).length} loading={save.isPending}>Save</Button>}
      </SectionCard>
      <CrudTable table="tax_slabs" title="Income tax slabs (annual)" order="income_from" canEdit={can.runPayroll(ctx?.role)}
        fields={[{ key: "fiscal_year", label: "Fiscal year", required: true, default: String(v.fiscal_year ?? "2025-26") }, { key: "income_from", label: "From", type: "number", required: true, render: (x) => money(Number(x)) },
          { key: "income_to", label: "To (empty = no limit)", type: "number", render: (x) => (x == null ? "and above" : money(Number(x))) }, { key: "fixed_tax", label: "Fixed tax", type: "number", default: 0, render: (x) => money(Number(x)) },
          { key: "rate", label: "Rate on excess", type: "number", hint: "0.11 = 11%", render: (x) => `${(Number(x) * 100).toFixed(1)}%` }]} />
    </div>
  );
}

export default function SettingsPage() {
  const { ctx } = useAuth();
  const role = ctx?.role;
  const tabs = useMemo(() => [
    { value: "company", label: "Company", icon: Gear },
    ...(can.hrStaff(role) ? [{ value: "org", label: "Organization" }, { value: "time", label: "Shifts & holidays" }, { value: "leave", label: "Leave policy" }] : []),
    ...(can.viewPay(role) ? [{ value: "payroll", label: "Payroll & tax" }] : []),
    ...(can.finance(role) || can.hrLead(role) ? [{ value: "expense", label: "Expense policy" }] : []),
    ...(can.hrStaff(role) ? [{ value: "letters", label: "Letter templates" }] : []),
  ], [role]);
  const [tab, setTab] = useState("company");
  return (
    <RequireAccess allow={(c) => can.hrStaff(c.role) || can.viewPay(c.role) || can.finance(c.role)}>
      <PageHeader icon={Gear} title="Settings" subtitle="Company setup and policies-as-data. Every change is written to the audit log." />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={tabs} />
      {tab === "company" && <Company />}
      {tab === "org" && <Organization edit={can.hrLead(role)} />}
      {tab === "time" && <Time edit={can.hrStaff(role)} />}
      {tab === "leave" && <Leave edit={can.hrLead(role)} />}
      {tab === "payroll" && <Payroll edit={can.tenantAdmin(role) || role === "hr_director" || role === "payroll_officer"} />}
      {tab === "expense" && <CrudTable table="expense_policies" title="Expense categories & limits" order="label" canEdit={can.finance(role) || can.hrLead(role)}
        fields={[{ key: "category", label: "Code", required: true }, { key: "label", label: "Label", required: true }, { key: "limit_amount", label: "Limit per claim", type: "number", render: (x) => (x ? money(Number(x)) : "No limit") }, { key: "requires_receipt", label: "Receipt required", type: "checkbox", default: true }]} />}
      {tab === "letters" && <CrudTable table="letter_templates" title="Letter templates" order="name" canEdit={can.hrLead(role)}
        fields={[{ key: "name", label: "Name", required: true }, { key: "kind", label: "Kind", type: "select", required: true, options: ["offer", "appointment", "confirmation", "increment", "experience", "salary_certificate", "noc", "warning", "termination", "relieving", "other"].map((k) => ({ value: k, label: k.replace("_", " ") })) },
          { key: "body", label: "Body", type: "textarea", required: true, list: false, hint: "Merge fields: {{employee_name}} {{employee_code}} {{job_title}} {{department}} {{company_name}} {{joining_date}} {{exit_date}} {{today}} {{gross_salary}}" }]} />}
    </RequireAccess>
  );
}
