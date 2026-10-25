"use client";
import { useMemo, useState } from "react";
import { MessageSquareHeart, Plus, Rocket, Star, Target, Trash2 } from "lucide-react";
import { Avatar, Badge, Button, Card, Dialog, Field, Input, Select, Tabs, Textarea, Progress } from "@/components/ui";
import { DataTable, EmptyState, PageHeader, StatusBadge } from "@/components/common";
import { byId, useDepartments, useEmployees } from "@/lib/lookups";
import { q, rpc, useAction, useRows } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { can } from "@/lib/roles";
import { ago, fmtDate, title } from "@/lib/format";
import { cn } from "@/lib/utils";

type KR = { title: string; target: number; current: number; unit?: string };
type Goal = { id: string; level: string; employee_id: string | null; department_id: string | null; title: string; description: string | null; key_results: KR[]; weight: number; due_date: string | null; status: string; cycle_id: string | null };
type Review = { id: string; cycle_id: string; employee_id: string; reviewer_id: string | null; self_rating: number | null; self_comments: string | null; manager_rating: number | null; manager_comments: string | null; final_rating: number | null; potential: string | null; status: string };
type Cycle = { id: string; name: string; period_start: string; period_end: string; status: string };

const progressOf = (g: Goal) => g.key_results.length ? Math.round(g.key_results.reduce((s, k) => s + Math.min(1, k.target ? k.current / k.target : 0), 0) / g.key_results.length * 100) : g.status === "done" ? 100 : 0;

function Stars({ value, onChange }: { value: number; onChange?: (n: number) => void }) {
  return <div className="flex gap-0.5">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" disabled={!onChange} onClick={() => onChange?.(n)} className={onChange ? "cursor-pointer" : ""}><Star className={cn("h-5 w-5", n <= value ? "fill-amber-400 text-amber-400" : "text-ink-soft/40")} /></button>)}</div>;
}

function GoalDialog({ open, onClose, forEmployee }: { open: boolean; onClose: () => void; forEmployee: string | null }) {
  const { role } = useMe();
  const { data: emps = [] } = useEmployees(); const { data: depts = [] } = useDepartments();
  const [f, setF] = useState({ level: "individual", employee_id: forEmployee ?? "", department_id: "", title: "", description: "", due_date: "", weight: "100" });
  const [krs, setKrs] = useState<KR[]>([{ title: "", target: 100, current: 0, unit: "%" }]);
  const a = useAction(() => q((sb) => sb.from("goals").insert({ ...f, employee_id: f.level === "individual" ? f.employee_id || forEmployee : null, department_id: f.level === "department" ? f.department_id : null, due_date: f.due_date || null, weight: Number(f.weight), key_results: krs.filter((k) => k.title.trim()) })),
    { success: "Goal created", invalidate: ["goals"], onDone: onClose });
  return (
    <Dialog open={open} onClose={onClose} title="New goal" description="Use measurable key results (OKRs)." className="max-w-2xl">
      <div className="space-y-4">
        {(can.hrLead(role) || role === "line_manager") && <Field label="Level"><Select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}><option value="individual">Individual</option><option value="department">Department</option><option value="company">Company</option></Select></Field>}
        {f.level === "individual" && <Field label="Owner"><Select value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })}>{emps.filter((e) => e.status !== "exited").map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</Select></Field>}
        {f.level === "department" && <Field label="Department"><Select value={f.department_id} onChange={(e) => setF({ ...f, department_id: e.target.value })}><option value="">Select</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>}
        <Field label="Objective"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Cut stock-outs in Lahore warehouse" /></Field>
        <Field label="Description"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Due date"><Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field><Field label="Weight %"><Input type="number" value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} /></Field></div>
        <div>
          <p className="mb-2 text-sm font-medium text-ink">Key results</p>
          {krs.map((k, i) => (
            <div key={i} className="mb-2 grid grid-cols-[1fr_90px_70px_36px] gap-2">
              <Input placeholder="Key result" value={k.title} onChange={(e) => setKrs(krs.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
              <Input type="number" placeholder="Target" value={k.target} onChange={(e) => setKrs(krs.map((x, j) => (j === i ? { ...x, target: Number(e.target.value) } : x)))} />
              <Input placeholder="Unit" value={k.unit} onChange={(e) => setKrs(krs.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} />
              <button onClick={() => setKrs(krs.filter((_, j) => j !== i))} className="cursor-pointer text-ink-soft hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setKrs([...krs, { title: "", target: 100, current: 0, unit: "%" }])}><Plus className="h-4 w-4" />Key result</Button>
        </div>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => a.mutate()} loading={a.isPending} disabled={f.title.trim().length < 3}>Create</Button></div>
      </div>
    </Dialog>
  );
}

function GoalCard({ g, owner, editable }: { g: Goal; owner?: string; editable: boolean }) {
  const [krs, setKrs] = useState<KR[]>(g.key_results);
  const save = useAction((patch: Partial<Goal>) => q((sb) => sb.from("goals").update(patch).eq("id", g.id)), { success: "Goal updated", invalidate: ["goals"] });
  const pct = progressOf({ ...g, key_results: krs });
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><div className="flex items-center gap-2"><Badge tone={g.level === "company" ? "violet" : g.level === "department" ? "sky" : "brand"}>{title(g.level)}</Badge>{owner && <span className="text-xs text-ink-soft">{owner}</span>}</div>
          <p className="mt-2 font-semibold text-ink">{g.title}</p>{g.description && <p className="text-sm text-ink-soft">{g.description}</p>}</div>
        {editable ? <Select value={g.status} onChange={(e) => save.mutate({ status: e.target.value })} className="h-8 w-32 text-xs">{["on_track", "at_risk", "off_track", "done", "dropped"].map((s) => <option key={s} value={s}>{title(s)}</option>)}</Select> : <StatusBadge status={g.status} />}
      </div>
      <div className="mt-4 flex items-center gap-3"><Progress className="flex-1" value={pct} /><span className="text-sm font-semibold text-ink">{pct}%</span></div>
      <ul className="mt-3 space-y-2">
        {krs.map((k, i) => (
          <li key={i} className="flex items-center gap-3 text-sm">
            <span className="flex-1 text-ink-soft">{k.title}</span>
            {editable ? <Input type="number" className="h-8 w-20" value={k.current} onChange={(e) => setKrs(krs.map((x, j) => (j === i ? { ...x, current: Number(e.target.value) } : x)))} onBlur={() => save.mutate({ key_results: krs })} /> : <span className="font-medium text-ink">{k.current}</span>}
            <span className="w-20 text-xs text-ink-soft">of {k.target} {k.unit}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink-soft">Due {fmtDate(g.due_date)} · weight {g.weight}%</p>
    </Card>
  );
}

function ReviewCard({ r, name, mode }: { r: Review; name?: string; mode: "self" | "manager" | "calibration" | "view" }) {
  const [rating, setRating] = useState(mode === "calibration" ? r.manager_rating ?? 3 : 3);
  const [text, setText] = useState(""); const [potential, setPotential] = useState(r.potential ?? "medium");
  const submit = useAction(() => rpc<string>("submit_review", { p_review: r.id, p_rating: rating, p_comments: text || null, p_potential: mode === "self" ? null : potential }), { success: "Review submitted", invalidate: ["reviews"] });
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">{name ? <span className="flex items-center gap-2 font-semibold text-ink"><Avatar name={name} size="sm" />{name}</span> : <span className="font-semibold text-ink">My review</span>}<StatusBadge status={r.status} /></div>
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        <div className="rounded-2xl bg-surface-muted p-3"><p className="text-xs text-ink-soft">Self</p><Stars value={r.self_rating ?? 0} />{r.self_comments && <p className="mt-1 text-xs text-ink-soft">“{r.self_comments}”</p>}</div>
        <div className="rounded-2xl bg-surface-muted p-3"><p className="text-xs text-ink-soft">Manager</p><Stars value={r.manager_rating ?? 0} />{r.manager_comments && <p className="mt-1 text-xs text-ink-soft">“{r.manager_comments}”</p>}</div>
        <div className="rounded-2xl bg-surface-muted p-3"><p className="text-xs text-ink-soft">Final</p><Stars value={r.final_rating ?? 0} />{r.potential && <p className="mt-1 text-xs text-ink-soft">Potential: {r.potential}</p>}</div>
      </div>
      {mode !== "view" && (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          <p className="text-sm font-medium text-ink">{mode === "self" ? "Your self review" : mode === "manager" ? "Manager review" : "Calibrated final rating"}</p>
          <Stars value={rating} onChange={setRating} />
          {mode !== "calibration" && <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === "self" ? "What went well, what you would improve" : "Strengths, development areas, examples"} />}
          {mode !== "self" && <Field label="Potential"><Select value={potential} onChange={(e) => setPotential(e.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></Select></Field>}
          <Button onClick={() => submit.mutate()} loading={submit.isPending}>Submit</Button>
        </div>
      )}
    </Card>
  );
}

export default function PerformancePage() {
  const { role, employeeId, ctx } = useMe();
  const { data: emps = [] } = useEmployees(); const E = byId(emps);
  const { data: goals = [] } = useRows<Goal[]>(["goals"], (sb) => sb.from("goals").select("*").order("created_at", { ascending: false }));
  const { data: reviews = [] } = useRows<Review[]>(["reviews"], (sb) => sb.from("performance_reviews").select("*").order("created_at", { ascending: false }));
  const { data: cycles = [] } = useRows<Cycle[]>(["reviews", "cycles"], (sb) => sb.from("review_cycles").select("*").order("period_start", { ascending: false }));
  const { data: feedback = [] } = useRows<{ id: string; from_employee_id: string; to_employee_id: string; message: string; is_private: boolean; created_at: string }[]>(["feedback"], (sb) => sb.from("feedback").select("*").order("created_at", { ascending: false }).limit(50));
  const hasTeam = !!ctx?.employee?.has_reports;
  const tabs = useMemo(() => [
    ...(employeeId ? [{ value: "goals", label: "My goals" }] : []),
    { value: "company", label: "Company & team goals" },
    { value: "reviews", label: "Reviews" },
    ...(can.hrLead(role) ? [{ value: "cycles", label: "Review cycles" }] : []),
    ...(employeeId ? [{ value: "feedback", label: "Feedback" }] : []),
  ], [employeeId, role]);
  const [tab, setTab] = useState(tabs[0].value);
  const [goalOpen, setGoalOpen] = useState(false);
  const [cyc, setCyc] = useState({ name: "", period_start: "", period_end: "" });
  const [fb, setFb] = useState({ to: "", message: "", is_private: true });
  const addCycle = useAction(() => q((sb) => sb.from("review_cycles").insert(cyc)), { success: "Cycle created", invalidate: ["reviews"] });
  const launch = useAction((id: string) => rpc<number>("launch_review_cycle", { p_cycle: id }), { success: (n) => `Launched for ${n} employees`, invalidate: ["reviews"] });
  const closeCycle = useAction((id: string) => q((sb) => sb.from("review_cycles").update({ status: "closed" }).eq("id", id)), { success: "Cycle closed", invalidate: ["reviews"] });
  const sendFb = useAction(() => q((sb) => sb.from("feedback").insert({ from_employee_id: employeeId, to_employee_id: fb.to, message: fb.message, is_private: fb.is_private })), { success: "Feedback sent", invalidate: ["feedback"], onDone: () => setFb({ to: "", message: "", is_private: true }) });

  const mine = goals.filter((g) => g.level === "individual" && g.employee_id === employeeId);
  const others = goals.filter((g) => !(g.level === "individual" && g.employee_id === employeeId));
  const myReviews = reviews.filter((r) => r.employee_id === employeeId);
  const teamReviews = reviews.filter((r) => r.employee_id !== employeeId);

  return (
    <div>
      <PageHeader icon={Target} title="Performance" subtitle="OKRs, review cycles with self, manager and calibration steps, and continuous feedback.">
        {(tab === "goals" || tab === "company") && <Button onClick={() => setGoalOpen(true)}><Plus className="h-4 w-4" />New goal</Button>}
      </PageHeader>
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={tabs} />
      {tab === "goals" && (mine.length ? <div className="grid gap-4 md:grid-cols-2">{mine.map((g) => <GoalCard key={g.id} g={g} editable />)}</div> : <Card><EmptyState icon={Target} title="No goals yet" text="Set two to four measurable objectives for this period." /></Card>)}
      {tab === "company" && (others.length ? <div className="grid gap-4 md:grid-cols-2">{others.map((g) => <GoalCard key={g.id} g={g} owner={g.employee_id ? E.get(g.employee_id)?.full_name : undefined} editable={can.hrLead(role) || (hasTeam && g.level === "individual")} />)}</div> : <Card><EmptyState icon={Target} title="No shared goals" /></Card>)}
      {tab === "reviews" && (
        <div className="space-y-6">
          {myReviews.length > 0 && <div className="grid gap-4 md:grid-cols-2">{myReviews.map((r) => <ReviewCard key={r.id} r={r} mode={r.status === "self_review" ? "self" : "view"} />)}</div>}
          {teamReviews.length > 0 && (
            <div><p className="mb-3 text-sm font-semibold text-ink">{can.hrLead(role) ? "All reviews" : "My team"}</p>
              <div className="grid gap-4 md:grid-cols-2">{teamReviews.map((r) => <ReviewCard key={r.id} r={r} name={E.get(r.employee_id)?.full_name} mode={r.status === "manager_review" && (E.get(r.employee_id)?.manager_id === employeeId || can.hrLead(role)) ? "manager" : r.status === "calibration" && can.hrLead(role) ? "calibration" : "view"} />)}</div></div>
          )}
          {!reviews.length && <Card><EmptyState icon={Star} title="No reviews yet" text="Reviews appear when HR launches a review cycle." /></Card>}
        </div>
      )}
      {tab === "cycles" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="space-y-3 p-5"><p className="font-semibold text-ink">New review cycle</p>
            <Field label="Name"><Input value={cyc.name} onChange={(e) => setCyc({ ...cyc, name: e.target.value })} placeholder="H2 2026 review" /></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="From"><Input type="date" value={cyc.period_start} onChange={(e) => setCyc({ ...cyc, period_start: e.target.value })} /></Field><Field label="To"><Input type="date" value={cyc.period_end} onChange={(e) => setCyc({ ...cyc, period_end: e.target.value })} /></Field></div>
            <Button className="w-full" onClick={() => addCycle.mutate()} disabled={!cyc.name || !cyc.period_start || !cyc.period_end} loading={addCycle.isPending}>Create</Button></Card>
          <Card className="p-4 lg:col-span-2"><DataTable rows={cycles} columns={[
            { key: "n", label: "Cycle", render: (c) => <span className="font-medium">{c.name}</span> },
            { key: "p", label: "Period", render: (c) => `${fmtDate(c.period_start)} – ${fmtDate(c.period_end)}` },
            { key: "r", label: "Completed", render: (c) => { const rs = reviews.filter((r) => r.cycle_id === c.id); return `${rs.filter((r) => r.status === "completed").length}/${rs.length}`; } },
            { key: "s", label: "Status", render: (c) => <StatusBadge status={c.status} /> },
            { key: "a", label: "", render: (c) => c.status === "draft" ? <Button size="sm" onClick={() => launch.mutate(c.id)}><Rocket className="h-4 w-4" />Launch</Button> : c.status !== "closed" ? <Button size="sm" variant="ghost" onClick={() => closeCycle.mutate(c.id)}>Close</Button> : null },
          ]} empty={<EmptyState title="No cycles" />} /></Card>
        </div>
      )}
      {tab === "feedback" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="space-y-3 p-5"><p className="flex items-center gap-2 font-semibold text-ink"><MessageSquareHeart className="h-5 w-5 text-brand-600" />Give feedback</p>
            <Field label="To"><Select value={fb.to} onChange={(e) => setFb({ ...fb, to: e.target.value })}><option value="">Select colleague</option>{emps.filter((e) => e.id !== employeeId && e.status !== "exited").map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</Select></Field>
            <Textarea rows={4} value={fb.message} onChange={(e) => setFb({ ...fb, message: e.target.value })} placeholder="Be specific: what they did and the impact." />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={fb.is_private} onChange={(e) => setFb({ ...fb, is_private: e.target.checked })} />Private (only them, their manager and HR)</label>
            <Button className="w-full" onClick={() => sendFb.mutate()} disabled={!fb.to || fb.message.trim().length < 5} loading={sendFb.isPending}>Send</Button></Card>
          <Card className="p-5 lg:col-span-2"><p className="mb-3 font-semibold text-ink">Feedback</p>
            {feedback.length === 0 ? <EmptyState icon={MessageSquareHeart} title="No feedback yet" /> : <ul className="space-y-3">{feedback.map((f) => (
              <li key={f.id} className="rounded-2xl bg-surface-muted p-4"><p className="text-sm text-ink">{f.message}</p><p className="mt-1 text-xs text-ink-soft">{E.get(f.from_employee_id)?.full_name} → {E.get(f.to_employee_id)?.full_name} · {ago(f.created_at)}{f.is_private ? " · private" : ""}</p></li>
            ))}</ul>}
          </Card>
        </div>
      )}
      <GoalDialog open={goalOpen} onClose={() => setGoalOpen(false)} forEmployee={employeeId} />
    </div>
  );
}
