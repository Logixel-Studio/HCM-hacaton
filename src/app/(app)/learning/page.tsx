"use client";
import { useMemo, useState } from "react";
import { Award, BookOpen, GraduationCap, Plus, PlayCircle, Users } from "lucide-react";
import { Avatar, Badge, Button, Card, Dialog, Field, Input, Select, Tabs, Textarea, Progress } from "@/components/ui";
import { DataTable, EmptyState, PageHeader, StatusBadge } from "@/components/common";
import { byId, useDepartments, useEmployees } from "@/lib/lookups";
import { q, rpc, useAction, useRows } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { can } from "@/lib/roles";
import { fmtDate, title, today } from "@/lib/format";

type Course = { id: string; title: string; description: string | null; category: string; duration_minutes: number; content_url: string | null; is_mandatory: boolean; due_days: number | null; certificate_valid_months: number | null; is_published: boolean };
type Enr = { id: string; course_id: string; employee_id: string; due_date: string | null; status: string; progress: number; score: number | null; completed_at: string | null };
type Cert = { id: string; employee_id: string; name: string; issuer: string | null; issued_on: string | null; expires_on: string | null };

export default function LearningPage() {
  const { role, employeeId } = useMe();
  const hr = can.hrStaff(role);
  const { data: courses = [] } = useRows<Course[]>(["learning", "courses"], (sb) => sb.from("courses").select("*").order("title"));
  const { data: enr = [] } = useRows<Enr[]>(["learning", "enr"], (sb) => sb.from("course_enrollments").select("*"));
  const { data: certs = [] } = useRows<Cert[]>(["learning", "certs"], (sb) => sb.from("certifications").select("*").order("expires_on"));
  const { data: emps = [] } = useEmployees(); const E = byId(emps); const C = byId(courses);
  const { data: depts = [] } = useDepartments();
  const tabs = useMemo(() => [...(employeeId ? [{ value: "mine", label: "My learning" }] : []), { value: "catalog", label: "Catalog" }, ...(hr ? [{ value: "tracking", label: "Compliance tracking" }] : []), { value: "certs", label: "Certifications" }], [employeeId, hr]);
  const [tab, setTab] = useState(tabs[0].value);
  const [newOpen, setNewOpen] = useState(false); const [assign, setAssign] = useState<Course | null>(null);
  const [f, setF] = useState({ title: "", description: "", category: "compliance", duration_minutes: "30", content_url: "", is_mandatory: false, due_days: "14", certificate_valid_months: "" });
  const [target, setTarget] = useState({ mode: "all", department: "", employee: "" });
  const [cert, setCert] = useState({ name: "", issuer: "", issued_on: today(), expires_on: "" });
  const create = useAction(() => q((sb) => sb.from("courses").insert({ ...f, duration_minutes: Number(f.duration_minutes), due_days: f.due_days ? Number(f.due_days) : null, certificate_valid_months: f.certificate_valid_months ? Number(f.certificate_valid_months) : null, content_url: f.content_url || null })), { success: "Course created", invalidate: ["learning"], onDone: () => setNewOpen(false) });
  const doAssign = useAction(() => rpc<number>("assign_course", { p_course: assign!.id, p_employees: target.mode === "one" ? [target.employee] : null, p_department: target.mode === "dept" ? target.department : null }), { success: (n) => `Assigned to ${n} employee(s)`, invalidate: ["learning"], onDone: () => setAssign(null) });
  const progress = useAction(({ id, p }: { id: string; p: number }) => rpc("update_course_progress", { p_enrollment: id, p_progress: p, p_score: p >= 100 ? 100 : null }), { success: "Progress saved", invalidate: ["learning"] });
  const enroll = useAction((courseId: string) => q((sb) => sb.from("course_enrollments").insert({ course_id: courseId, employee_id: employeeId })), { success: "Enrolled", invalidate: ["learning"] });
  const addCert = useAction(() => q((sb) => sb.from("certifications").insert({ ...cert, employee_id: employeeId, expires_on: cert.expires_on || null })), { success: "Certification added", invalidate: ["learning"] });
  const mine = enr.filter((e) => e.employee_id === employeeId);

  return (
    <div>
      <PageHeader icon={GraduationCap} title="Learning" subtitle="Mandatory compliance training, a course catalog and certifications with expiry tracking.">
        {hr && <Button onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" />New course</Button>}
      </PageHeader>
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={tabs} />
      {tab === "mine" && (mine.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{mine.map((e) => { const c = C.get(e.course_id); if (!c) return null; return (
          <Card key={e.id} className="flex flex-col p-5">
            <div className="flex items-center justify-between"><Badge tone={c.is_mandatory ? "rose" : "brand"}>{c.is_mandatory ? "Mandatory" : title(c.category)}</Badge><StatusBadge status={e.status} /></div>
            <p className="mt-3 font-semibold text-ink">{c.title}</p><p className="line-clamp-2 text-sm text-ink-soft">{c.description}</p>
            <div className="mt-auto pt-4"><Progress value={e.progress} /><p className="mt-1 text-xs text-ink-soft">{e.progress}% · {c.duration_minutes} min{e.due_date ? ` · due ${fmtDate(e.due_date)}` : ""}</p>
              {e.status !== "completed" && <div className="mt-3 flex gap-2">{c.content_url && <a href={c.content_url} target="_blank" rel="noreferrer" onClick={() => e.progress < 50 && progress.mutate({ id: e.id, p: 50 })}><Button size="sm" variant="outline"><PlayCircle className="h-4 w-4" />Open</Button></a>}<Button size="sm" onClick={() => progress.mutate({ id: e.id, p: 100 })}>Mark complete</Button></div>}</div>
          </Card>); })}</div>
      ) : <Card><EmptyState icon={BookOpen} title="Nothing assigned" text="Browse the catalog to enrol yourself." /></Card>)}
      {tab === "catalog" && (courses.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{courses.map((c) => { const done = enr.filter((e) => e.course_id === c.id); const me = done.find((e) => e.employee_id === employeeId); return (
          <Card key={c.id} className="flex flex-col p-5">
            <div className="flex items-center gap-2"><Badge tone={c.is_mandatory ? "rose" : "brand"}>{title(c.category)}</Badge>{!c.is_published && <Badge>Draft</Badge>}</div>
            <p className="mt-3 font-semibold text-ink">{c.title}</p><p className="line-clamp-3 text-sm text-ink-soft">{c.description}</p>
            <p className="mt-3 text-xs text-ink-soft">{c.duration_minutes} min{c.certificate_valid_months ? ` · certificate valid ${c.certificate_valid_months} months` : ""} · {done.filter((e) => e.status === "completed").length}/{done.length} completed</p>
            <div className="mt-auto flex gap-2 pt-4">{employeeId && !me && <Button size="sm" variant="outline" onClick={() => enroll.mutate(c.id)}>Enrol</Button>}{(hr || role === "line_manager") && <Button size="sm" onClick={() => setAssign(c)}><Users className="h-4 w-4" />Assign</Button>}</div>
          </Card>); })}</div>
      ) : <Card><EmptyState icon={BookOpen} title="No courses yet" text={hr ? "Create your first course — fire safety, code of conduct, harassment policy…" : undefined} /></Card>)}
      {tab === "tracking" && (
        <Card className="p-4"><DataTable rows={enr.filter((e) => C.get(e.course_id)?.is_mandatory || e.status !== "completed")} columns={[
          { key: "e", label: "Employee", render: (e) => <span className="flex items-center gap-2"><Avatar name={E.get(e.employee_id)?.full_name} size="sm" />{E.get(e.employee_id)?.full_name}</span> },
          { key: "c", label: "Course", render: (e) => C.get(e.course_id)?.title },
          { key: "d", label: "Due", render: (e) => <span className={e.due_date && e.due_date < today() && e.status !== "completed" ? "text-rose-600" : ""}>{fmtDate(e.due_date)}</span> },
          { key: "p", label: "Progress", render: (e) => `${e.progress}%` },
          { key: "s", label: "Status", render: (e) => <StatusBadge status={e.status} /> },
        ]} empty={<EmptyState title="Nothing to track" />} /></Card>
      )}
      {tab === "certs" && (
        <div className="grid gap-4 lg:grid-cols-3">
          {employeeId && <Card className="space-y-3 p-5"><p className="flex items-center gap-2 font-semibold text-ink"><Award className="h-5 w-5 text-brand-600" />Add a certification</p>
            <Field label="Name"><Input value={cert.name} onChange={(e) => setCert({ ...cert, name: e.target.value })} placeholder="First aid" /></Field>
            <Field label="Issuer"><Input value={cert.issuer} onChange={(e) => setCert({ ...cert, issuer: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="Issued"><Input type="date" value={cert.issued_on} onChange={(e) => setCert({ ...cert, issued_on: e.target.value })} /></Field><Field label="Expires"><Input type="date" value={cert.expires_on} onChange={(e) => setCert({ ...cert, expires_on: e.target.value })} /></Field></div>
            <Button className="w-full" onClick={() => addCert.mutate()} disabled={!cert.name} loading={addCert.isPending}>Add</Button></Card>}
          <Card className="p-4 lg:col-span-2"><DataTable rows={certs} columns={[
            { key: "e", label: "Employee", render: (c) => E.get(c.employee_id)?.full_name },
            { key: "n", label: "Certification", render: (c) => <span className="font-medium">{c.name}</span> },
            { key: "i", label: "Issuer", render: (c) => c.issuer ?? "—" },
            { key: "x", label: "Expires", render: (c) => c.expires_on ? <span className={c.expires_on < today() ? "text-rose-600" : ""}>{fmtDate(c.expires_on)}</span> : "No expiry" },
          ]} empty={<EmptyState icon={Award} title="No certifications" />} /></Card>
        </div>
      )}
      <Dialog open={newOpen} onClose={() => setNewOpen(false)} title="New course" className="max-w-xl">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" className="sm:col-span-2"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{["compliance", "safety", "onboarding", "technical", "leadership", "sales", "general"].map((c) => <option key={c} value={c}>{title(c)}</option>)}</Select></Field>
          <Field label="Duration (min)"><Input type="number" value={f.duration_minutes} onChange={(e) => setF({ ...f, duration_minutes: e.target.value })} /></Field>
          <Field label="Content link (video, PDF, slides)" className="sm:col-span-2"><Input value={f.content_url} onChange={(e) => setF({ ...f, content_url: e.target.value })} placeholder="https://" /></Field>
          <Field label="Due within (days)"><Input type="number" value={f.due_days} onChange={(e) => setF({ ...f, due_days: e.target.value })} /></Field>
          <Field label="Certificate valid (months)"><Input type="number" value={f.certificate_valid_months} onChange={(e) => setF({ ...f, certificate_valid_months: e.target.value })} placeholder="Optional" /></Field>
          <Field label="Description" className="sm:col-span-2"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.is_mandatory} onChange={(e) => setF({ ...f, is_mandatory: e.target.checked })} />Mandatory (compliance)</label>
        </div>
        <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setNewOpen(false)}>Cancel</Button><Button onClick={() => create.mutate()} disabled={!f.title} loading={create.isPending}>Create</Button></div>
      </Dialog>
      <Dialog open={!!assign} onClose={() => setAssign(null)} title={`Assign “${assign?.title}”`}>
        <div className="space-y-4">
          <Field label="Assign to"><Select value={target.mode} onChange={(e) => setTarget({ ...target, mode: e.target.value })}><option value="all">{hr ? "Everyone" : "My whole team"}</option><option value="dept">A department</option><option value="one">One employee</option></Select></Field>
          {target.mode === "dept" && <Field label="Department"><Select value={target.department} onChange={(e) => setTarget({ ...target, department: e.target.value })}><option value="">Select</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>}
          {target.mode === "one" && <Field label="Employee"><Select value={target.employee} onChange={(e) => setTarget({ ...target, employee: e.target.value })}><option value="">Select</option>{emps.filter((e) => e.status !== "exited").map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</Select></Field>}
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setAssign(null)}>Cancel</Button><Button onClick={() => doAssign.mutate()} loading={doAssign.isPending}>Assign</Button></div>
        </div>
      </Dialog>
    </div>
  );
}
