"use client";
import { useState } from "react";
import { AlertTriangle, KeyRound, Mail, Plus, ShieldCheck, Trash2, UserCog } from "lucide-react";
import { toast } from "sonner";
import { Avatar, Badge, Button, Card, Dialog, Field, Input, Select, Tabs, Textarea } from "@/components/ui";
import { DataTable, EmptyState, PageHeader, ReadOnlyNote, StatusBadge } from "@/components/common";
import { RequireAccess } from "@/components/guard";
import { useBranches, useDepartments, useEmployees } from "@/lib/lookups";
import { q, rpc, useAction, useRows, useRpc } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { can, GRANTABLE_ROLES, ROLE_INFO, type Role } from "@/lib/roles";
import { NAV } from "@/lib/nav";
import { inviteMessage, inviteUser, resendInvite } from "@/lib/invite";
import { ago, fmtDate } from "@/lib/format";

type Member = { user_id: string; email: string; full_name: string | null; role: Role; status: string; scope: { branch_ids?: string[]; department_ids?: string[] }; custom_role_id: string | null; employee_id: string | null; employee_name: string | null; access_expires_at: string | null; joined_at: string };
type Invite = { id: string; email: string; role: Role; status: string; created_at: string };
type CustomRole = { id: string; name: string; description: string | null; base_role: Role; permissions: Record<string, string[]> };

function MemberDialog({ m, onClose, customRoles, onResend }: { m: Member | null; onClose: () => void; customRoles: CustomRole[]; onResend: (email: string) => void }) {
  const { role: myRole } = useMe();
  const { data: emps = [] } = useEmployees(); const { data: branches = [] } = useBranches(); const { data: depts = [] } = useDepartments();
  const [f, setF] = useState<{ role: Role; status: string; branch_ids: string[]; department_ids: string[]; custom: string; employee: string; expires: string } | null>(null);
  const cur = f ?? (m ? { role: m.role, status: m.status, branch_ids: m.scope?.branch_ids ?? [], department_ids: m.scope?.department_ids ?? [], custom: m.custom_role_id ?? "", employee: m.employee_id ?? "", expires: m.access_expires_at?.slice(0, 10) ?? "" } : null);
  const save = useAction(() => {
    const scope: Record<string, string[]> = {}; if (cur!.branch_ids.length) scope.branch_ids = cur!.branch_ids; if (cur!.department_ids.length) scope.department_ids = cur!.department_ids;
    return rpc("update_member", { p_user: m!.user_id, p_role: cur!.role, p_status: cur!.status, p_scope: scope, p_custom_role: cur!.custom || "00000000-0000-0000-0000-000000000000", p_employee: cur!.employee || null, p_access_expires_at: cur!.expires ? new Date(cur!.expires + "T23:59:59").toISOString() : null });
  }, { success: "Access updated", invalidate: ["members"], onDone: () => { setF(null); onClose(); } });
  const remove = useAction(() => rpc("remove_member", { p_user: m!.user_id }), { success: "User removed", invalidate: ["members"], onDone: onClose });
  if (!m || !cur) return null;
  const toggle = (k: "branch_ids" | "department_ids", id: string) => setF({ ...cur, [k]: cur[k].includes(id) ? cur[k].filter((x) => x !== id) : [...cur[k], id] });
  return (
    <Dialog open={!!m} onClose={() => { setF(null); onClose(); }} title={m.full_name ?? m.email} description={m.email} className="max-w-xl">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Role"><Select value={cur.role} onChange={(e) => setF({ ...cur, role: e.target.value as Role })}>{GRANTABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_INFO[r].label}</option>)}</Select></Field>
          <Field label="Status"><Select value={cur.status} onChange={(e) => setF({ ...cur, status: e.target.value })}><option value="active">Active</option><option value="suspended">Suspended</option></Select></Field>
          <Field label="Custom role (narrows menus)"><Select value={cur.custom} onChange={(e) => setF({ ...cur, custom: e.target.value })}><option value="">None</option>{customRoles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Linked employee"><Select value={cur.employee} onChange={(e) => setF({ ...cur, employee: e.target.value })}><option value="">None</option>{emps.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</Select></Field>
          {cur.role === "auditor" && <Field label="Access expires" hint="Auditors get time-boxed access"><Input type="date" value={cur.expires} onChange={(e) => setF({ ...cur, expires: e.target.value })} /></Field>}
        </div>
        {["hr_manager", "hr_executive"].includes(cur.role) && (
          <div className="rounded-2xl bg-surface-muted p-4">
            <p className="text-sm font-medium text-ink">Scope (optional)</p><p className="mb-3 text-xs text-ink-soft">Limit this HR user to some branches or departments. Leave empty for the whole company.</p>
            <p className="mb-1 text-xs font-medium text-ink-soft">Branches</p><div className="mb-3 flex flex-wrap gap-1.5">{branches.map((b) => <button key={b.id} onClick={() => toggle("branch_ids", b.id)}><Badge tone={cur.branch_ids.includes(b.id) ? "brand" : "neutral"}>{b.name}</Badge></button>)}</div>
            <p className="mb-1 text-xs font-medium text-ink-soft">Departments</p><div className="flex flex-wrap gap-1.5">{depts.map((d) => <button key={d.id} onClick={() => toggle("department_ids", d.id)}><Badge tone={cur.department_ids.includes(d.id) ? "brand" : "neutral"}>{d.name}</Badge></button>)}</div>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <div className="flex gap-1">
            {can.tenantAdmin(myRole) && <Button variant="ghost" className="text-rose-600" onClick={() => remove.mutate()} loading={remove.isPending}><Trash2 className="h-4 w-4" />Remove</Button>}
            <Button variant="ghost" onClick={() => onResend(m.email)}><Mail className="h-4 w-4" />Email sign-in link</Button>
          </div>
          <div className="flex gap-2"><Button variant="ghost" onClick={() => { setF(null); onClose(); }}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending}>Save</Button></div>
        </div>
      </div>
    </Dialog>
  );
}

export default function UsersPage() {
  const { role } = useMe();
  const readOnly = can.auditor(role);
  const { data: members = [] } = useRpc<Member[]>(["members"], "company_members");
  const { data: invites = [] } = useRows<Invite[]>(["members", "invites"], (sb) => sb.from("user_invites").select("*").eq("status", "pending").order("created_at", { ascending: false }), { enabled: !readOnly });
  const { data: customRoles = [] } = useRows<CustomRole[]>(["members", "custom"], (sb) => sb.from("custom_roles").select("*").order("name"));
  const { data: emps = [] } = useEmployees();
  const [tab, setTab] = useState("members");
  const [sel, setSel] = useState<Member | null>(null);
  const [inv, setInv] = useState(false); const [form, setForm] = useState({ email: "", role: "employee" as Role, employee: "" });
  const [cr, setCr] = useState<Partial<CustomRole> | null>(null);
  const invite = useAction(() => inviteUser(form.email, form.role, form.employee || null, emps.find((e) => e.id === form.employee)?.full_name), { success: inviteMessage, invalidate: ["members"], onDone: () => { setInv(false); setForm({ email: "", role: "employee", employee: "" }); } });
  const resend = useAction((email: string) => resendInvite(email), { success: inviteMessage });
  const revoke = useAction((id: string) => q((sb) => sb.from("user_invites").update({ status: "revoked" }).eq("id", id)), { success: "Invite revoked", invalidate: ["members"] });
  const saveCr = useAction(() => cr?.id ? q((sb) => sb.from("custom_roles").update({ name: cr.name, description: cr.description, base_role: cr.base_role, permissions: cr.permissions }).eq("id", cr.id!)) : q((sb) => sb.from("custom_roles").insert({ name: cr!.name, description: cr!.description, base_role: cr!.base_role ?? "employee", permissions: cr!.permissions ?? {} })), { success: "Custom role saved", invalidate: ["members"], onDone: () => setCr(null) });
  const delCr = useAction((id: string) => q((sb) => sb.from("custom_roles").delete().eq("id", id)), { invalidate: ["members"] });

  return (
    <RequireAccess allow={(c) => can.hrLead(c.role) || can.auditor(c.role)}>
      <PageHeader icon={ShieldCheck} title="Users & roles" subtitle="Who can sign in, with which of the 14 roles, and in which scope.">
        {!readOnly && tab === "members" && <Button onClick={() => setInv(true)}><Mail className="h-4 w-4" />Invite user</Button>}
        {can.tenantAdmin(role) && tab === "custom" && <Button onClick={() => setCr({ base_role: "employee", permissions: {} })}><Plus className="h-4 w-4" />Custom role</Button>}
      </PageHeader>
      {readOnly && <ReadOnlyNote />}
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ value: "members", label: "Members", count: members.length }, ...(!readOnly ? [{ value: "invites", label: "Pending invites", count: invites.length }] : []), { value: "custom", label: "Custom roles" }, { value: "matrix", label: "Role guide" }]} />
      {tab === "members" && !readOnly && members.some((m) => !m.employee_id && !["auditor", "recruiter"].includes(m.role)) && (
        <div className="mb-4 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p><b>{members.filter((m) => !m.employee_id && !["auditor", "recruiter"].includes(m.role)).length} users are not linked to an employee record.</b> They cannot clock in, use GPS / Face ID, apply leave or get payslips. Add them in People with the <b>same work email</b> (they link automatically), or click the user and choose "Linked employee".</p>
        </div>
      )}
      {tab === "members" && <Card className="p-4"><DataTable rows={members} rowKey={(m) => m.user_id} onRowClick={readOnly ? undefined : setSel} columns={[
        { key: "u", label: "User", render: (m) => <span className="flex items-center gap-3"><Avatar name={m.full_name ?? m.email} size="sm" /><span><span className="block font-medium">{m.full_name ?? "—"}</span><span className="block text-xs text-ink-soft">{m.email}</span></span></span> },
        { key: "r", label: "Role", render: (m) => <span className="flex flex-wrap items-center gap-1"><Badge tone="brand">{ROLE_INFO[m.role].label}</Badge>{m.custom_role_id && <Badge tone="violet">{customRoles.find((c) => c.id === m.custom_role_id)?.name}</Badge>}{(m.scope?.branch_ids?.length || m.scope?.department_ids?.length) ? <Badge>Scoped</Badge> : null}</span> },
        { key: "e", label: "Employee", render: (m) => m.employee_name ?? <span className="font-medium text-amber-600">Not linked · fix</span>, hideOnMobile: true },
        { key: "s", label: "Status", render: (m) => <span className="flex flex-col items-start"><StatusBadge status={m.status} />{m.access_expires_at && <span className="text-[11px] text-ink-soft">until {fmtDate(m.access_expires_at)}</span>}</span> },
        { key: "j", label: "Joined", render: (m) => ago(m.joined_at), hideOnMobile: true },
      ]} /></Card>}
      {tab === "invites" && <Card className="p-4"><DataTable rows={invites} columns={[
        { key: "e", label: "Email", render: (i) => <span className="font-medium">{i.email}</span> },
        { key: "r", label: "Role", render: (i) => ROLE_INFO[i.role].label },
        { key: "d", label: "Invited", render: (i) => ago(i.created_at) },
        { key: "a", label: "", render: (i) => <div className="flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/signup`); toast.success("Sign-up link copied — they must use this same email"); }}>Copy sign-up link</Button><Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)}>Revoke</Button></div> },
      ]} empty={<EmptyState icon={Mail} title="No pending invites" />} /></Card>}
      {tab === "custom" && (
        <div className="grid gap-4 md:grid-cols-2">
          {customRoles.length === 0 && <Card className="md:col-span-2"><EmptyState icon={KeyRound} title="No custom roles" text="Clone a system role and hide modules it should not see (for example, a Plant HR role without engagement and learning)." /></Card>}
          {customRoles.map((c) => (
            <Card key={c.id} className="p-5"><div className="flex items-center justify-between"><p className="font-semibold text-ink">{c.name}</p><Badge tone="brand">Based on {ROLE_INFO[c.base_role].label}</Badge></div><p className="mt-1 text-sm text-ink-soft">{c.description}</p>
              <p className="mt-3 text-xs text-ink-soft">Hidden modules: {Object.entries(c.permissions).filter(([, v]) => v.includes("hidden")).map(([k]) => NAV.find((n) => n.href === k)?.label ?? k).join(", ") || "none"}</p>
              {can.tenantAdmin(role) && <div className="mt-3 flex gap-2"><Button size="sm" variant="outline" onClick={() => setCr(c)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => delCr.mutate(c.id)}>Delete</Button></div>}</Card>
          ))}
        </div>
      )}
      {tab === "matrix" && (
        <div className="grid gap-3 md:grid-cols-2">{(Object.keys(ROLE_INFO) as Role[]).map((r) => (
          <Card key={r} className="flex items-start gap-3 p-4"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><UserCog className="h-5 w-5" /></div><div><p className="font-semibold text-ink">{ROLE_INFO[r].label}</p><p className="text-sm text-ink-soft">{ROLE_INFO[r].description}</p></div></Card>
        ))}</div>
      )}
      <MemberDialog m={sel} onClose={() => setSel(null)} customRoles={customRoles} onResend={(e) => resend.mutate(e)} />
      <Dialog open={inv} onClose={() => setInv(false)} title="Invite a user" description="We email them an invitation link. If they already have an account they are added right away.">
        <div className="space-y-4">
          <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Role" hint={ROLE_INFO[form.role].description}><Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>{GRANTABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_INFO[r].label}</option>)}</Select></Field>
          <Field label="Link to employee record"><Select value={form.employee} onChange={(e) => setForm({ ...form, employee: e.target.value })}><option value="">None</option>{emps.filter((e) => !e.user_id && e.status !== "exited").map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</Select></Field>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setInv(false)}>Cancel</Button><Button onClick={() => invite.mutate()} loading={invite.isPending} disabled={!form.email.includes("@")}>Invite</Button></div>
        </div>
      </Dialog>
      <Dialog open={!!cr} onClose={() => setCr(null)} title={cr?.id ? "Edit custom role" : "New custom role"} className="max-w-xl">
        {cr && <div className="space-y-4">
          <Field label="Name"><Input value={cr.name ?? ""} onChange={(e) => setCr({ ...cr, name: e.target.value })} placeholder="Plant HR officer" /></Field>
          <Field label="Description"><Textarea value={cr.description ?? ""} onChange={(e) => setCr({ ...cr, description: e.target.value })} /></Field>
          <Field label="Based on system role" hint="Data access follows this role; the database enforces it."><Select value={cr.base_role} onChange={(e) => setCr({ ...cr, base_role: e.target.value as Role })}>{GRANTABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_INFO[r].label}</option>)}</Select></Field>
          <div><p className="mb-2 text-sm font-medium text-ink">Hide these modules</p><div className="flex flex-wrap gap-1.5">{NAV.filter((n) => n.href !== "/dashboard" && n.href !== "/platform").map((n) => { const hidden = cr.permissions?.[n.href]?.includes("hidden"); return (
            <button key={n.href} onClick={() => { const p = { ...(cr.permissions ?? {}) }; if (hidden) delete p[n.href]; else p[n.href] = ["hidden"]; setCr({ ...cr, permissions: p }); }}><Badge tone={hidden ? "rose" : "neutral"}>{n.label}</Badge></button>); })}</div></div>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setCr(null)}>Cancel</Button><Button onClick={() => saveCr.mutate()} disabled={!cr.name} loading={saveCr.isPending}>Save</Button></div>
        </div>}
      </Dialog>
    </RequireAccess>
  );
}
