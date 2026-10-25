"use client";
import { AlertTriangle, BarChart3, Download, GraduationCap, Percent, TimerOff, Users } from "lucide-react";
import { Avatar, Badge, Button } from "@/components/ui";
import { ErrorState, Loading, PageHeader, SectionCard, StatCard } from "@/components/common";
import { Bars, Donut, TrendArea } from "@/components/charts";
import { RequireAccess } from "@/components/guard";
import { downloadText, toCsv, useRpc } from "@/lib/api";
import { can } from "@/lib/roles";
import { periodLabel, title } from "@/lib/format";

type A = {
  headcount_trend: { month: string; headcount: number; joiners: number; exits: number }[];
  by_employment_type: { type: string; count: number }[] | null; by_gender: { gender: string; count: number }[] | null; by_branch: { branch: string; count: number }[] | null;
  tenure: { band: string; count: number }[] | null; leave_by_type: { type: string; color: string; days: number }[] | null;
  absenteeism_pct: number; late_pct: number; hiring_funnel: { stage: string; count: number }[]; source_of_hire: { source: string; count: number }[] | null;
  exit_reasons: { reason: string; count: number }[] | null; performance_distribution: { rating: number; count: number }[] | null; training_completion_pct: number;
  payroll_cost_by_department: { department: string; monthly_gross: number }[] | null; flight_risk: { employee_id: string; name: string; score: number; reasons: string[] }[] | null;
};

export default function AnalyticsPage() {
  const { data: a, isLoading, error } = useRpc<A>(["analytics"], "people_analytics", { p_months: 12 });
  return (
    <RequireAccess allow={(c) => can.analytics(c.role)}>
      <PageHeader icon={BarChart3} title="People analytics" subtitle="Every number is computed on the server from the same definitions, so dashboards, exports and AI answers agree.">
        {a && <Button variant="outline" onClick={() => downloadText("headcount-trend.csv", toCsv(a.headcount_trend))}><Download className="h-4 w-4" />Export</Button>}
      </PageHeader>
      {isLoading ? <Loading /> : error ? <ErrorState error={error} /> : a && (() => {
        const last = a.headcount_trend.at(-1); const exits = a.headcount_trend.reduce((s, m) => s + m.exits, 0); const avg = a.headcount_trend.reduce((s, m) => s + m.headcount, 0) / Math.max(1, a.headcount_trend.length);
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard icon={Users} label="Headcount" value={last?.headcount ?? 0} hint={`${a.headcount_trend.reduce((s, m) => s + m.joiners, 0)} hires in 12 months`} accent />
              <StatCard icon={TimerOff} label="Attrition (12 months)" value={`${((exits / Math.max(1, avg)) * 100).toFixed(1)}%`} hint="Exits ÷ average headcount" />
              <StatCard icon={Percent} label="Absenteeism · late % (90 days)" value={`${a.absenteeism_pct}% · ${a.late_pct}%`} />
              <StatCard icon={GraduationCap} label="Training completion" value={`${a.training_completion_pct}%`} />
            </div>
            <SectionCard icon={Users} title="Headcount, hires and exits">
              <TrendArea data={a.headcount_trend.map((m) => ({ label: periodLabel(m.month).slice(0, 3), headcount: m.headcount, joiners: m.joiners, exits: m.exits }))} series={[{ key: "headcount", label: "Headcount" }, { key: "joiners", label: "Hires" }, { key: "exits", label: "Exits" }]} height={280} />
            </SectionCard>
            <div className="grid gap-4 lg:grid-cols-3">
              <SectionCard title="Employment type"><Donut data={(a.by_employment_type ?? []).map((x) => ({ name: title(x.type), value: x.count }))} center={last?.headcount ?? 0} sub="people" /></SectionCard>
              <SectionCard title="Gender"><Donut data={(a.by_gender ?? []).map((x) => ({ name: title(x.gender), value: x.count }))} center={last?.headcount ?? 0} sub="people" /></SectionCard>
              <SectionCard title="Tenure"><Bars data={(a.tenure ?? []).map((x) => ({ label: x.band, value: x.count }))} highlight="max" height={200} /></SectionCard>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <SectionCard title="Hiring funnel"><Bars data={a.hiring_funnel.map((x) => ({ label: title(x.stage), value: x.count }))} highlight="all" horizontal height={240} /></SectionCard>
              <SectionCard title="Leave taken by type (12 months)"><Donut data={(a.leave_by_type ?? []).map((x) => ({ name: x.type, value: Number(x.days), color: x.color }))} center={(a.leave_by_type ?? []).reduce((s, x) => s + Number(x.days), 0)} sub="days" /></SectionCard>
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <SectionCard title="By location"><Bars data={(a.by_branch ?? []).map((x) => ({ label: x.branch, value: x.count }))} highlight="max" height={200} /></SectionCard>
              <SectionCard title="Exit reasons"><Donut data={(a.exit_reasons ?? []).map((x) => ({ name: title(x.reason), value: x.count }))} center={exits} sub="exits" /></SectionCard>
              <SectionCard title="Performance ratings"><Bars data={[1, 2, 3, 4, 5].map((r) => ({ label: `${r}★`, value: a.performance_distribution?.find((x) => x.rating === r)?.count ?? 0 }))} highlight="max" height={200} /></SectionCard>
            </div>
            {a.payroll_cost_by_department && <SectionCard title="Monthly gross salary by department"><Bars money data={a.payroll_cost_by_department.map((x) => ({ label: x.department, value: Number(x.monthly_gross) }))} highlight="max" horizontal height={Math.max(180, a.payroll_cost_by_department.length * 40)} /></SectionCard>}
            {a.flight_risk && (
              <SectionCard icon={AlertTriangle} title="Flight-risk signals" subtitle="Explainable rules — use them to start a stay conversation, never for automatic decisions.">
                {a.flight_risk.length === 0 ? <p className="text-sm text-ink-soft">No one crosses the risk threshold right now.</p> : (
                  <ul className="space-y-2">{a.flight_risk.map((r) => (
                    <li key={r.employee_id} className="flex flex-col gap-2 rounded-2xl border border-line p-3 sm:flex-row sm:items-center">
                      <span className="flex items-center gap-2 font-medium text-ink"><Avatar name={r.name} size="sm" />{r.name}</span>
                      <div className="flex flex-1 flex-wrap gap-1.5">{r.reasons.map((x) => <Badge key={x} tone="amber">{x}</Badge>)}</div>
                      <Badge tone={r.score >= 60 ? "rose" : "amber"}>Risk {r.score}</Badge>
                    </li>
                  ))}</ul>
                )}
              </SectionCard>
            )}
          </div>
        );
      })()}
    </RequireAccess>
  );
}
