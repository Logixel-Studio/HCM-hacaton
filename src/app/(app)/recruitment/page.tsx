"use client";
import { useMemo, useState } from "react";
import { Briefcase, CalendarPlus, Copy, ExternalLink, Plus, Sparkles, Star, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Avatar, Badge, Button, Card, Dialog, Drawer, Field, Input, Select, Tabs, Textarea } from "@/components/ui";
import { DataTable, EmptyState, KeyValue, Loading, PageHeader, StatusBadge } from "@/components/common";
import { byId, useBranches, useDepartments, useEmployees, useGrades } from "@/lib/lookups";
import { openFile, q, rpc, useAction, useRows } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { can } from "@/lib/roles";
import { ago, fmtDateTime, money, title, today } from "@/lib/format";
import { cn } from "@/lib/utils";

type Req = { id: string; title: string; department_id: string | null; branch_id: string | null; grade_id: string | null; positions: number; employment_type: string; hiring_manager_id: string | null; budget_monthly: number | null; description: string | null; requirements: string | null; status: string; is_public: boolean; created_by: string; created_at: string };
type Cand = { id: string; requisition_id: string; full_name: string; email: string | null; phone: string | null; current_company: string | null; experience_years: number | null; expected_salary: number | null; source: string; cv_path: string | null; summary: string | null; stage: string; match_score: number | null; match_reasons: string | null; offer_amount: number | null; offer_status: string; created_at: string };
type Interview = { id: string; candidate_id: string; interviewer_id: string; round: string; scheduled_at: string; mode: string; location_or_link: string | null; status: string; rating: number | null; recommendation: string | null; feedback: string | null };

const STAGES = ["applied", "screening", "assessment", "interview", "offer", "hired"];

function ReqDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { role, employeeId } = useMe();
  const { data: depts = [] } = useDepartments(); const { data: branches = [] } = useBranches(); const { data: grades = [] } = useGrades(); const { data: emps = [] } = useEmployees();
  const [f, setF] = useState({ title: "", department_id: "", branch_id: "", grade_id: "", positions: "1", employment_type: "permanent", hiring_manager_id: employeeId ?? "", budget_monthly: "", description: "", requirements: "" });
  const G = byId(grades);
  const a = useAction(() => q((sb) => sb.from("job_requisitions").insert({ ...f, positions: Number(f.positions), budget_monthly: f.budget_monthly ? Number(f.budget_monthly) : null,
    department_id: f.department_id || null, branch_id: f.branch_id || null, grade_id: f.grade_id || null, hiring_manager_id: f.hiring_manager_id || null, status: "pending_approval" })),
    { success: "Requisition sent for HR approval", invalidate: ["recruitment"], onDone: onClose });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={open} onClose={onClose} title="New job requisition" description="HR leadership approves it before it opens." className="max-w-2xl">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Job title" className="sm:col-span-2"><Input value={f.title} onChange={set("title")} placeholder="Warehouse Supervisor" /></Field>
        <Field label="Department"><Select value={f.department_id} onChange={set("department_id")}><option value="">—</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
        <Field label="Location"><Select value={f.branch_id} onChange={set("branch_id")}><option value="">—</option>{branches.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
        <Field label="Grade" hint={f.grade_id ? `Band ${money(G.get(f.grade_id)?.band_min)} – ${money(G.get(f.grade_id)?.band_max)}` : undefined}><Select value={f.grade_id} onChange={set("grade_id")}><option value="">—</option>{grades.map((d) => <option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}</Select></Field>
        <Field label="Positions"><Input type="number" min="1" value={f.positions} onChange={set("positions")} /></Field>
        <Field label="Hiring manager"><Select value={f.hiring_manager_id} onChange={set("hiring_manager_id")}><option value="">—</option>{emps.filter((e) => e.status !== "exited").map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</Select></Field>
        <Field label="Monthly budget per hire"><Input type="number" value={f.budget_monthly} onChange={set("budget_monthly")} /></Field>
        <Field label="Requirements" hint="Comma separated — used for candidate match scoring" className="sm:col-span-2"><Input value={f.requirements} onChange={set("requirements")} placeholder="forklift, inventory, excel, team lead" /></Field>
        <Field label="Job description" className="sm:col-span-2"><Textarea rows={4} value={f.description} onChange={set("description")} /></Field>
      </div>
      <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => a.mutate()} loading={a.isPending} disabled={f.title.trim().length < 2 || (!can.recruiting(role) && !f.hiring_manager_id)}>Submit</Button></div>
    </Dialog>
  );
}

function CandidateDrawer({ cand, req, onClose }: { cand: Cand | null; req?: Req; onClose: () => void }) {
  const { role, employeeId } = useMe();
  const rec = can.recruiting(role);
  const { data: emps = [] } = useEmployees(); const E = byId(emps);
  const { data: interviews = [] } = useRows<Interview[]>(["recruitment", "interviews", cand?.id], (sb) => sb.from("interviews").select("*").eq("candidate_id", cand!.id).order("scheduled_at"), { enabled: !!cand });
  const [sched, setSched] = useState({ interviewer_id: "", round: "Technical interview", scheduled_at: "", mode: "onsite", location_or_link: "" });
  const [offer, setOffer] = useState(""); const [joining, setJoining] = useState(today());
  const [score, setScore] = useState<{ id: string; rating: string; recommendation: string; feedback: string } | null>(null);
  const move = useAction((stage: string) => rpc("move_candidate", { p_id: cand!.id, p_stage: stage, p_reason: stage === "rejected" ? "Not a fit" : null }), { success: "Stage updated", invalidate: ["recruitment"], });
  const addInterview = useAction(() => q((sb) => sb.from("interviews").insert({ ...sched, candidate_id: cand!.id, scheduled_at: new Date(sched.scheduled_at).toISOString() })), { success: "Interview scheduled", invalidate: ["recruitment"] });
  const saveScore = useAction(() => q((sb) => sb.from("interviews").update({ rating: Number(score!.rating), recommendation: score!.recommendation, feedback: score!.feedback, status: "completed" }).eq("id", score!.id)), { success: "Scorecard saved", invalidate: ["recruitment"], onDone: () => setScore(null) });
  const makeOffer = useAction(() => rpc<string>("make_offer", { p_id: cand!.id, p_amount: Number(offer) }), { success: (s) => s === "approved" ? "Offer approved" : "Offer is above the grade band — sent to HR leadership", invalidate: ["recruitment"] });
  const offerStatus = useAction((s: string) => rpc("set_offer_status", { p_id: cand!.id, p_status: s }), { success: "Offer updated", invalidate: ["recruitment"] });
  const hire = useAction(() => rpc("hire_candidate", { p_id: cand!.id, p_joining: joining }), { success: "Hired! Employee record and onboarding checklist created", invalidate: ["recruitment", "employees"], onDone: onClose });
  const rescore = useAction(() => rpc("score_candidate", { p_id: cand!.id }), { success: "Match score updated", invalidate: ["recruitment"] });
  if (!cand) return null;
  return (
    <Drawer open={!!cand} onClose={onClose} className="max-w-xl" title={<span className="flex items-center gap-3"><Avatar name={cand.full_name} />{cand.full_name}</span>}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2"><StatusBadge status={cand.stage} />{cand.offer_status !== "none" && <Badge tone="violet">Offer: {title(cand.offer_status)}</Badge>}<Badge>{title(cand.source)}</Badge></div>
        <KeyValue items={[["Email", cand.email], ["Phone", cand.phone], ["Current company", cand.current_company], ["Experience", cand.experience_years != null ? `${cand.experience_years} yrs` : "—"], ["Expected salary", money(cand.expected_salary)], ["Applied", ago(cand.created_at)]]} />
        <div className="rounded-2xl bg-brand-50 p-4">
          <div className="flex items-center justify-between"><p className="flex items-center gap-2 text-sm font-semibold text-ink"><Sparkles className="h-4 w-4 text-brand-600" />Match score</p><span className="font-display text-2xl font-bold text-brand-700">{cand.match_score ?? "—"}{cand.match_score != null && "%"}</span></div>
          <p className="mt-1 text-xs text-ink-soft">{cand.match_reasons ?? "Add requirements to the requisition to score candidates."}</p>
          {rec && <button onClick={() => rescore.mutate()} className="mt-2 cursor-pointer text-xs font-medium text-brand-600">Re-score</button>}
        </div>
        {cand.summary && <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">Summary</p><p className="whitespace-pre-wrap text-sm text-ink">{cand.summary}</p></div>}
        {cand.cv_path && <Button variant="outline" size="sm" onClick={() => openFile("cvs", cand.cv_path!)}><ExternalLink className="h-4 w-4" />Open CV</Button>}

        {rec && cand.stage !== "hired" && (
          <div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">Move to stage</p>
            <div className="flex flex-wrap gap-2">{["screening", "assessment", "interview", "offer"].filter((s) => s !== cand.stage).map((s) => <Button key={s} size="sm" variant="secondary" onClick={() => move.mutate(s)}>{title(s)}</Button>)}<Button size="sm" variant="ghost" className="text-rose-600" onClick={() => move.mutate("rejected")}>Reject</Button></div>
          </div>
        )}

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">Interviews</p>
          {interviews.length === 0 && <p className="text-sm text-ink-soft">No interviews yet.</p>}
          <ul className="space-y-2">{interviews.map((i) => (
            <li key={i.id} className="rounded-2xl border border-line p-3 text-sm">
              <div className="flex items-center justify-between"><p className="font-medium text-ink">{i.round} · {E.get(i.interviewer_id)?.full_name}</p><StatusBadge status={i.status} /></div>
              <p className="text-xs text-ink-soft">{fmtDateTime(i.scheduled_at)} · {title(i.mode)}{i.location_or_link ? ` · ${i.location_or_link}` : ""}</p>
              {i.rating && <p className="mt-1 flex items-center gap-1 text-xs text-ink">{Array.from({ length: 5 }).map((_, k) => <Star key={k} className={cn("h-3.5 w-3.5", k < i.rating! ? "fill-amber-400 text-amber-400" : "text-ink-soft/40")} />)} · {title(i.recommendation)}</p>}
              {i.feedback && <p className="mt-1 text-xs text-ink-soft">“{i.feedback}”</p>}
              {i.status === "scheduled" && (i.interviewer_id === employeeId || rec) && <Button size="sm" variant="subtle" className="mt-2" onClick={() => setScore({ id: i.id, rating: "4", recommendation: "hire", feedback: "" })}>Submit scorecard</Button>}
            </li>
          ))}</ul>
          {rec && cand.stage !== "hired" && (
            <div className="mt-3 grid gap-2 rounded-2xl bg-surface-muted p-3 sm:grid-cols-2">
              <Select value={sched.interviewer_id} onChange={(e) => setSched({ ...sched, interviewer_id: e.target.value })}><option value="">Interviewer</option>{emps.filter((e) => e.status !== "exited").map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</Select>
              <Input value={sched.round} onChange={(e) => setSched({ ...sched, round: e.target.value })} />
              <Input type="datetime-local" value={sched.scheduled_at} onChange={(e) => setSched({ ...sched, scheduled_at: e.target.value })} />
              <Select value={sched.mode} onChange={(e) => setSched({ ...sched, mode: e.target.value })}><option value="onsite">Onsite</option><option value="video">Video</option><option value="phone">Phone</option></Select>
              <Input className="sm:col-span-2" placeholder="Room or meeting link" value={sched.location_or_link} onChange={(e) => setSched({ ...sched, location_or_link: e.target.value })} />
              <Button size="sm" className="sm:col-span-2" onClick={() => addInterview.mutate()} disabled={!sched.interviewer_id || !sched.scheduled_at} loading={addInterview.isPending}><CalendarPlus className="h-4 w-4" />Schedule interview</Button>
            </div>
          )}
        </div>

        {rec && cand.stage !== "hired" && (
          <div className="rounded-2xl border border-line p-4">
            <p className="mb-2 text-sm font-semibold text-ink">Offer</p>
            {cand.offer_status === "none" || cand.offer_status === "declined" ? (
              <div className="flex gap-2"><Input type="number" placeholder={req?.budget_monthly ? `Budget ${req.budget_monthly}` : "Monthly gross"} value={offer} onChange={(e) => setOffer(e.target.value)} /><Button onClick={() => makeOffer.mutate()} disabled={!Number(offer)} loading={makeOffer.isPending}>Make offer</Button></div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-ink-soft">{money(cand.offer_amount)} · {title(cand.offer_status)}</p>
                <div className="flex flex-wrap gap-2">
                  {cand.offer_status === "approved" && <Button size="sm" variant="secondary" onClick={() => offerStatus.mutate("sent")}>Mark sent</Button>}
                  {["approved", "sent"].includes(cand.offer_status) && <><Button size="sm" onClick={() => offerStatus.mutate("accepted")}>Accepted</Button><Button size="sm" variant="ghost" onClick={() => offerStatus.mutate("declined")}>Declined</Button></>}
                </div>
                {cand.offer_status === "accepted" && can.hrStaff(role) && (
                  <div className="flex items-end gap-2"><Field label="Joining date" className="flex-1"><Input type="date" value={joining} onChange={(e) => setJoining(e.target.value)} /></Field><Button onClick={() => hire.mutate()} loading={hire.isPending}><UserPlus className="h-4 w-4" />Hire</Button></div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <Dialog open={!!score} onClose={() => setScore(null)} title="Interview scorecard">
        {score && (
          <div className="space-y-4">
            <Field label="Overall rating"><div className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => <button key={n} onClick={() => setScore({ ...score, rating: String(n) })} className="cursor-pointer"><Star className={cn("h-7 w-7", n <= Number(score.rating) ? "fill-amber-400 text-amber-400" : "text-ink-soft/40")} /></button>)}</div></Field>
            <Field label="Recommendation"><Select value={score.recommendation} onChange={(e) => setScore({ ...score, recommendation: e.target.value })}>{["strong_hire", "hire", "no_hire", "strong_no_hire"].map((r) => <option key={r} value={r}>{title(r)}</option>)}</Select></Field>
            <Field label="Feedback"><Textarea rows={4} value={score.feedback} onChange={(e) => setScore({ ...score, feedback: e.target.value })} /></Field>
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setScore(null)}>Cancel</Button><Button onClick={() => saveScore.mutate()} loading={saveScore.isPending}>Submit</Button></div>
          </div>
        )}
      </Dialog>
    </Drawer>
  );
}

function AddCandidate({ open, onClose, reqId }: { open: boolean; onClose: () => void; reqId: string }) {
  const [f, setF] = useState({ full_name: "", email: "", phone: "", current_company: "", experience_years: "", expected_salary: "", source: "linkedin", summary: "" });
  const a = useAction(async () => {
    const rows = await q<{ id: string }[]>((sb) => sb.from("candidates").insert({ ...f, requisition_id: reqId, experience_years: f.experience_years ? Number(f.experience_years) : null, expected_salary: f.expected_salary ? Number(f.expected_salary) : null }).select("id"));
    await rpc("score_candidate", { p_id: rows[0].id });
  }, { success: "Candidate added and scored", invalidate: ["recruitment"], onDone: onClose });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={open} onClose={onClose} title="Add candidate" className="max-w-2xl">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name"><Input value={f.full_name} onChange={set("full_name")} /></Field>
        <Field label="Source"><Select value={f.source} onChange={set("source")}>{["linkedin", "job_board", "referral", "agency", "walk_in", "campus", "other"].map((s) => <option key={s} value={s}>{title(s)}</option>)}</Select></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={set("phone")} /></Field>
        <Field label="Current company"><Input value={f.current_company} onChange={set("current_company")} /></Field>
        <Field label="Experience (years)"><Input type="number" value={f.experience_years} onChange={set("experience_years")} /></Field>
        <Field label="Expected salary"><Input type="number" value={f.expected_salary} onChange={set("expected_salary")} /></Field>
        <Field label="Profile summary / skills" className="sm:col-span-2"><Textarea rows={4} value={f.summary} onChange={set("summary")} placeholder="Paste the CV summary — it is matched against the requirements." /></Field>
      </div>
      <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => a.mutate()} loading={a.isPending} disabled={f.full_name.trim().length < 2}>Add</Button></div>
    </Dialog>
  );
}

export default function RecruitmentPage() {
  const { role, ctx } = useMe();
  const rec = can.recruiting(role);
  const { data: reqs = [], isLoading } = useRows<Req[]>(["recruitment", "reqs"], (sb) => sb.from("job_requisitions").select("*").order("created_at", { ascending: false }));
  const { data: cands = [] } = useRows<Cand[]>(["recruitment", "cands"], (sb) => sb.from("candidates").select("*").order("match_score", { ascending: false, nullsFirst: false }));
  const { data: depts = [] } = useDepartments(); const D = byId(depts);
  const { data: emps = [] } = useEmployees(); const E = byId(emps);
  const [tab, setTab] = useState("pipeline");
  const [reqOpen, setReqOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [selReq, setSelReq] = useState<string>("");
  const [selCand, setSelCand] = useState<string | null>(null);
  const activeReq = selReq || reqs.find((r) => r.status === "open")?.id || reqs[0]?.id || "";
  const pipeline = cands.filter((c) => c.requisition_id === activeReq);
  const R = byId(reqs);
  const setStatus = useAction(({ id, s }: { id: string; s: string }) => rpc("set_requisition_status", { p_id: id, p_status: s }), { success: "Updated", invalidate: ["recruitment"] });
  const decide = useAction(({ id, ok }: { id: string; ok: boolean }) => rpc("decide_requisition", { p_id: id, p_approve: ok }), { success: "Saved", invalidate: ["recruitment"] });
  const careersUrl = typeof window !== "undefined" && ctx?.tenant?.slug ? `${window.location.origin}/careers?c=${ctx.tenant.slug}` : "";
  const counts = useMemo(() => Object.fromEntries(STAGES.map((s) => [s, pipeline.filter((c) => c.stage === s).length])), [pipeline]);

  return (
    <div>
      <PageHeader icon={Briefcase} title="Recruitment" subtitle="Requisitions, a public careers page, explainable match scores, scorecards and offers.">
        {rec && careersUrl && <Button variant="outline" onClick={() => { navigator.clipboard.writeText(careersUrl); toast.success("Careers page link copied"); }}><Copy className="h-4 w-4" />Careers link</Button>}
        <Button onClick={() => setReqOpen(true)}><Plus className="h-4 w-4" />New requisition</Button>
      </PageHeader>
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ value: "pipeline", label: "Pipeline" }, { value: "reqs", label: "Requisitions", count: reqs.length }]} />
      {isLoading ? <Loading /> : tab === "reqs" ? (
        <Card className="p-4"><DataTable rows={reqs} columns={[
          { key: "t", label: "Role", render: (r) => <div><p className="font-medium">{r.title}</p><p className="text-xs text-ink-soft">{D.get(r.department_id ?? "")?.name ?? "—"} · {r.positions} position(s)</p></div> },
          { key: "h", label: "Hiring manager", render: (r) => E.get(r.hiring_manager_id ?? "")?.full_name ?? "—", hideOnMobile: true },
          { key: "c", label: "Candidates", render: (r) => cands.filter((c) => c.requisition_id === r.id).length },
          { key: "s", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
          { key: "a", label: "", render: (r) => (
            <div className="flex justify-end gap-1">
              {r.status === "pending_approval" && can.hrLead(role) && <><Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: r.id, ok: false })}>Reject</Button><Button size="sm" onClick={() => decide.mutate({ id: r.id, ok: true })}>Approve</Button></>}
              {rec && r.status === "open" && <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: r.id, s: "on_hold" })}>Hold</Button>}
              {rec && r.status === "on_hold" && <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: r.id, s: "open" })}>Reopen</Button>}
              {rec && ["open", "on_hold"].includes(r.status) && <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: r.id, s: "closed" })}>Close</Button>}
            </div>
          ) },
        ]} empty={<EmptyState icon={Briefcase} title="No requisitions yet" text="Raise one to start hiring." />} /></Card>
      ) : reqs.length === 0 ? <Card><EmptyState icon={Briefcase} title="No open roles" text="Create a requisition; once approved it appears on your careers page." /></Card> : (
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select value={activeReq} onChange={(e) => setSelReq(e.target.value)} className="sm:w-80">{reqs.map((r) => <option key={r.id} value={r.id}>{r.title} · {title(r.status)}</option>)}</Select>
            {R.get(activeReq) && <StatusBadge status={R.get(activeReq)!.status} />}
            {rec && <Button variant="outline" className="sm:ml-auto" onClick={() => setAddOpen(true)}><UserPlus className="h-4 w-4" />Add candidate</Button>}
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {STAGES.map((s) => (
              <div key={s} className="w-64 shrink-0 rounded-3xl bg-surface-muted p-3">
                <p className="mb-2 flex items-center justify-between px-1 text-sm font-semibold text-ink">{title(s)}<span className="rounded-full bg-surface px-2 text-xs text-ink-soft">{counts[s]}</span></p>
                <div className="space-y-2">
                  {pipeline.filter((c) => c.stage === s).map((c) => (
                    <button key={c.id} onClick={() => setSelCand(c.id)} className="w-full cursor-pointer rounded-2xl border border-line bg-surface p-3 text-left shadow-soft transition hover:border-brand-300">
                      <div className="flex items-center gap-2"><Avatar name={c.full_name} size="sm" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-ink">{c.full_name}</p><p className="truncate text-xs text-ink-soft">{c.current_company ?? title(c.source)}</p></div>
                        {c.match_score != null && <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", c.match_score >= 70 ? "bg-emerald-50 text-emerald-700" : c.match_score >= 40 ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700")}>{c.match_score}%</span>}</div>
                      {c.offer_status !== "none" && <p className="mt-2 text-[11px] text-violet-600">Offer {title(c.offer_status)}</p>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {pipeline.some((c) => ["rejected", "withdrawn"].includes(c.stage)) && <p className="text-xs text-ink-soft">{pipeline.filter((c) => ["rejected", "withdrawn"].includes(c.stage)).length} rejected or withdrawn candidate(s) hidden.</p>}
        </div>
      )}
      <ReqDialog open={reqOpen} onClose={() => setReqOpen(false)} />
      {activeReq && <AddCandidate open={addOpen} onClose={() => setAddOpen(false)} reqId={activeReq} />}
      <CandidateDrawer cand={cands.find((c) => c.id === selCand) ?? null} req={R.get(cands.find((c) => c.id === selCand)?.requisition_id ?? "")} onClose={() => setSelCand(null)} />
    </div>
  );
}
