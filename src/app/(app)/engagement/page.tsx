"use client";
import { useMemo, useState } from "react";
import { BarChart3, CheckCircle2, Heart, Megaphone, Plus, Send, Trash2, Vote } from "lucide-react";
import { Avatar, Badge, Button, Card, Dialog, Field, Input, Select, Tabs, Textarea } from "@/components/ui";
import { EmptyState, PageHeader, StatusBadge } from "@/components/common";
import { byId, useEmployees } from "@/lib/lookups";
import { q, rpc, useAction, useRows, useRpc } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { can } from "@/lib/roles";
import { ago, title } from "@/lib/format";
import { cn } from "@/lib/utils";

type Ann = { id: string; title: string; body: string; requires_ack: boolean; published_at: string | null; created_at: string };
type Survey = { id: string; title: string; kind: string; questions: { id: string; text: string; type: "scale" | "enps" | "text" }[]; is_anonymous: boolean; status: string; closes_at: string | null };
const VALUES = ["Ownership", "Customer first", "Integrity", "Teamwork", "Excellence", "Innovation"];

function SurveyCard({ s }: { s: Survey }) {
  const { role } = useMe();
  const { data: responded } = useRpc<boolean>(["survey", s.id, "responded"], "has_responded", { p_survey: s.id });
  const [ans, setAns] = useState<Record<string, string | number>>({});
  const [results, setResults] = useState(false);
  const { data: res } = useRpc<{ responses: number; hidden: boolean; message?: string; questions?: { id: string; text: string; type: string; average?: number; enps?: number; count?: number; answers?: string[] }[] }>(["survey", s.id, "results"], "survey_results", { p_survey: s.id }, { enabled: results });
  const submit = useAction(() => rpc("submit_survey", { p_survey: s.id, p_answers: ans }), { success: "Thank you — your response is recorded", invalidate: ["survey"] });
  const setStatus = useAction((st: string) => q((sb) => sb.from("surveys").update({ status: st }).eq("id", s.id)), { invalidate: ["engagement"] });
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><Badge tone="violet">{title(s.kind)}</Badge>{s.is_anonymous && <Badge>Anonymous</Badge>}</div><StatusBadge status={s.status} /></div>
      <p className="mt-3 font-semibold text-ink">{s.title}</p>
      {s.status === "open" && !responded && !results && (
        <div className="mt-4 space-y-4">
          {s.questions.map((qq) => (
            <div key={qq.id}><p className="mb-2 text-sm text-ink">{qq.text}</p>
              {qq.type === "text" ? <Textarea value={String(ans[qq.id] ?? "")} onChange={(e) => setAns({ ...ans, [qq.id]: e.target.value })} /> : (
                <div className="flex flex-wrap gap-1.5">{Array.from({ length: qq.type === "enps" ? 11 : 5 }, (_, i) => qq.type === "enps" ? i : i + 1).map((n) => (
                  <button key={n} onClick={() => setAns({ ...ans, [qq.id]: n })} className={cn("h-9 w-9 cursor-pointer rounded-xl border text-sm font-medium transition", ans[qq.id] === n ? "brand-gradient border-transparent text-white" : "border-line text-ink hover:bg-surface-muted")}>{n}</button>
                ))}</div>
              )}
              {qq.type === "enps" && <p className="mt-1 text-[11px] text-ink-soft">0 = not at all likely · 10 = extremely likely</p>}
            </div>
          ))}
          <Button onClick={() => submit.mutate()} loading={submit.isPending} disabled={s.questions.some((qq) => qq.type !== "text" && ans[qq.id] == null)}><Send className="h-4 w-4" />Submit</Button>
        </div>
      )}
      {responded && <p className="mt-3 flex items-center gap-2 text-sm text-emerald-600"><CheckCircle2 className="h-4 w-4" />You responded</p>}
      {(can.hrLead(role) || can.auditor(role)) && (
        <div className="mt-4 border-t border-line pt-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="subtle" onClick={() => setResults(!results)}><BarChart3 className="h-4 w-4" />{results ? "Hide results" : "Results"}</Button>
            {can.hrLead(role) && s.status === "draft" && <Button size="sm" onClick={() => setStatus.mutate("open")}>Open survey</Button>}
            {can.hrLead(role) && s.status === "open" && <Button size="sm" variant="ghost" onClick={() => setStatus.mutate("closed")}>Close</Button>}
          </div>
          {results && res && (res.hidden ? <p className="mt-3 text-sm text-ink-soft">{res.responses} response(s). {res.message}</p> : (
            <div className="mt-3 space-y-3">
              <p className="text-xs text-ink-soft">{res.responses} responses</p>
              {res.questions?.map((qq) => (
                <div key={qq.id} className="rounded-2xl bg-surface-muted p-3">
                  <p className="text-sm text-ink">{qq.text}</p>
                  {qq.type === "text" ? <ul className="mt-2 space-y-1 text-xs text-ink-soft">{qq.answers?.map((a, i) => <li key={i}>“{a}”</li>)}</ul>
                    : <p className="mt-1 font-display text-xl font-bold text-ink">{qq.type === "enps" ? `eNPS ${qq.enps ?? "—"}` : `${qq.average ?? "—"} / 5`}<span className="ml-2 text-xs font-normal text-ink-soft">avg {qq.average}</span></p>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function EngagementPage() {
  const { role, employeeId } = useMe();
  const hr = can.hrStaff(role);
  const { data: emps = [] } = useEmployees(); const E = byId(emps);
  const { data: anns = [] } = useRows<Ann[]>(["engagement", "ann"], (sb) => sb.from("announcements").select("*").order("created_at", { ascending: false }));
  const { data: acks = [] } = useRows<{ announcement_id: string; employee_id: string }[]>(["engagement", "acks"], (sb) => sb.from("announcement_acks").select("announcement_id, employee_id"));
  const { data: kudos = [] } = useRows<{ id: string; from_employee_id: string; to_employee_id: string; value: string; message: string; created_at: string }[]>(["engagement", "kudos"], (sb) => sb.from("kudos").select("*").order("created_at", { ascending: false }).limit(60));
  const { data: surveys = [] } = useRows<Survey[]>(["engagement", "surveys"], (sb) => sb.from("surveys").select("*").order("created_at", { ascending: false }));
  const [tab, setTab] = useState("feed");
  const [annOpen, setAnnOpen] = useState(false); const [svOpen, setSvOpen] = useState(false);
  const [a, setA] = useState({ title: "", body: "", requires_ack: false });
  const [k, setK] = useState({ to: "", value: VALUES[0], message: "" });
  const [sv, setSv] = useState({ title: "Monthly pulse", kind: "pulse", is_anonymous: true, q: "How happy are you at work this month?\nI have the tools I need to do my job well.\nHow likely are you to recommend us as a place to work? (eNPS)\nWhat one thing should we improve?" });
  const postAnn = useAction(() => q((sb) => sb.from("announcements").insert({ ...a, published_at: new Date().toISOString() })), { success: "Announcement published", invalidate: ["engagement", "announcements"], onDone: () => { setAnnOpen(false); setA({ title: "", body: "", requires_ack: false }); } });
  const delAnn = useAction((id: string) => q((sb) => sb.from("announcements").delete().eq("id", id)), { invalidate: ["engagement"] });
  const ack = useAction((id: string) => q((sb) => sb.from("announcement_acks").insert({ announcement_id: id, employee_id: employeeId })), { success: "Acknowledged", invalidate: ["engagement"] });
  const giveKudos = useAction(() => q((sb) => sb.from("kudos").insert({ from_employee_id: employeeId, to_employee_id: k.to, value: k.value, message: k.message })), { success: "Kudos sent 🎉", invalidate: ["engagement"], onDone: () => setK({ ...k, to: "", message: "" }) });
  const makeSurvey = useAction(() => q((sb) => sb.from("surveys").insert({ title: sv.title, kind: sv.kind, is_anonymous: sv.is_anonymous, status: "open",
    questions: sv.q.split("\n").map((t) => t.trim()).filter(Boolean).map((t, i) => ({ id: "q" + (i + 1), text: t.replace(/\s*\(eNPS\)\s*$/i, ""), type: /enps|recommend/i.test(t) ? "enps" : /\?$/.test(t) && /what|how can|suggest|improve/i.test(t) ? "text" : "scale" })) })),
    { success: "Survey is live", invalidate: ["engagement"], onDone: () => setSvOpen(false) });
  const leaderboard = useMemo(() => { const m = new Map<string, number>(); kudos.forEach((x) => m.set(x.to_employee_id, (m.get(x.to_employee_id) ?? 0) + 1)); return [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5); }, [kudos]);

  return (
    <div>
      <PageHeader icon={Heart} title="Engagement" subtitle="Announcements, peer recognition and anonymous pulse surveys.">
        {hr && tab === "feed" && <Button onClick={() => setAnnOpen(true)}><Megaphone className="h-4 w-4" />Announce</Button>}
        {can.hrLead(role) && tab === "surveys" && <Button onClick={() => setSvOpen(true)}><Plus className="h-4 w-4" />New survey</Button>}
      </PageHeader>
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ value: "feed", label: "Announcements" }, { value: "kudos", label: "Kudos wall" }, { value: "surveys", label: "Surveys", count: surveys.filter((s) => s.status === "open").length }]} />
      {tab === "feed" && (anns.length ? <div className="space-y-4">{anns.map((n) => { const acked = acks.some((x) => x.announcement_id === n.id && x.employee_id === employeeId); const total = acks.filter((x) => x.announcement_id === n.id).length; return (
        <Card key={n.id} className="p-5">
          <div className="flex items-start justify-between gap-3"><div><p className="text-lg font-semibold text-ink">{n.title}</p><p className="text-xs text-ink-soft">{ago(n.published_at ?? n.created_at)}</p></div>{hr && <button onClick={() => delAnn.mutate(n.id)} className="cursor-pointer text-ink-soft hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>}</div>
          <p className="mt-3 whitespace-pre-wrap text-sm text-ink">{n.body}</p>
          {n.requires_ack && <div className="mt-4 flex items-center gap-3">{employeeId && (acked ? <Badge tone="green" dot>Acknowledged</Badge> : <Button size="sm" onClick={() => ack.mutate(n.id)}>I have read this</Button>)}{hr && <span className="text-xs text-ink-soft">{total}/{emps.filter((e) => e.status !== "exited").length} acknowledged</span>}</div>}
        </Card>); })}</div> : <Card><EmptyState icon={Megaphone} title="No announcements" /></Card>)}
      {tab === "kudos" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4">
            {employeeId && <Card className="space-y-3 p-5"><p className="font-semibold text-ink">Recognise a colleague</p>
              <Select value={k.to} onChange={(e) => setK({ ...k, to: e.target.value })}><option value="">Who?</option>{emps.filter((e) => e.id !== employeeId && e.status !== "exited").map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</Select>
              <div className="flex flex-wrap gap-1.5">{VALUES.map((v) => <button key={v} onClick={() => setK({ ...k, value: v })} className={cn("cursor-pointer rounded-full px-3 py-1 text-xs font-medium", k.value === v ? "brand-gradient text-white" : "bg-surface-muted text-ink-soft")}>{v}</button>)}</div>
              <Textarea value={k.message} onChange={(e) => setK({ ...k, message: e.target.value })} placeholder="Thanks for…" />
              <Button className="w-full" onClick={() => giveKudos.mutate()} disabled={!k.to || k.message.trim().length < 3} loading={giveKudos.isPending}><Heart className="h-4 w-4" />Send kudos</Button></Card>}
            <Card className="p-5"><p className="mb-3 font-semibold text-ink">Most recognised</p>{leaderboard.length ? <ul className="space-y-2">{leaderboard.map(([id, n], i) => <li key={id} className="flex items-center gap-3 text-sm"><span className="w-4 text-ink-soft">{i + 1}</span><Avatar name={E.get(id)?.full_name} size="sm" /><span className="flex-1 text-ink">{E.get(id)?.full_name}</span><Badge tone="rose">{n} ♥</Badge></li>)}</ul> : <p className="text-sm text-ink-soft">No kudos yet.</p>}</Card>
          </div>
          <div className="space-y-3 lg:col-span-2">{kudos.length ? kudos.map((x) => (
            <Card key={x.id} className="p-4"><div className="flex items-center gap-3"><Avatar name={E.get(x.from_employee_id)?.full_name} size="sm" /><p className="text-sm text-ink"><span className="font-medium">{E.get(x.from_employee_id)?.full_name}</span> → <span className="font-medium">{E.get(x.to_employee_id)?.full_name}</span></p><Badge tone="violet" className="ml-auto">{x.value}</Badge></div><p className="mt-2 text-sm text-ink">{x.message}</p><p className="mt-1 text-xs text-ink-soft">{ago(x.created_at)}</p></Card>
          )) : <Card><EmptyState icon={Heart} title="Be the first to say thanks" /></Card>}</div>
        </div>
      )}
      {tab === "surveys" && (surveys.length ? <div className="grid gap-4 md:grid-cols-2">{surveys.map((s) => <SurveyCard key={s.id} s={s} />)}</div> : <Card><EmptyState icon={Vote} title="No surveys" /></Card>)}
      <Dialog open={annOpen} onClose={() => setAnnOpen(false)} title="New announcement">
        <div className="space-y-4"><Field label="Title"><Input value={a.title} onChange={(e) => setA({ ...a, title: e.target.value })} /></Field><Field label="Message"><Textarea rows={6} value={a.body} onChange={(e) => setA({ ...a, body: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={a.requires_ack} onChange={(e) => setA({ ...a, requires_ack: e.target.checked })} />Require acknowledgement (policy updates)</label>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setAnnOpen(false)}>Cancel</Button><Button onClick={() => postAnn.mutate()} disabled={!a.title || !a.body} loading={postAnn.isPending}>Publish</Button></div></div>
      </Dialog>
      <Dialog open={svOpen} onClose={() => setSvOpen(false)} title="New survey" description="One question per line. Lines mentioning “recommend” become eNPS (0–10); “what…improve” lines become free text; others are 1–5 scales.">
        <div className="space-y-4"><Field label="Title"><Input value={sv.title} onChange={(e) => setSv({ ...sv, title: e.target.value })} /></Field>
          <Field label="Kind"><Select value={sv.kind} onChange={(e) => setSv({ ...sv, kind: e.target.value })}>{["pulse", "engagement", "enps", "onboarding", "exit", "custom"].map((x) => <option key={x} value={x}>{title(x)}</option>)}</Select></Field>
          <Field label="Questions"><Textarea rows={6} value={sv.q} onChange={(e) => setSv({ ...sv, q: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sv.is_anonymous} onChange={(e) => setSv({ ...sv, is_anonymous: e.target.checked })} />Anonymous (results shown after 5 responses)</label>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setSvOpen(false)}>Cancel</Button><Button onClick={() => makeSurvey.mutate()} loading={makeSurvey.isPending}>Launch</Button></div></div>
      </Dialog>
    </div>
  );
}
