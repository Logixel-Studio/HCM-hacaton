"use client";
import Link from "next/link";
import {
  AlertTriangle, Briefcase, CalendarDays, CalendarOff, Clock, FileWarning, GraduationCap, Inbox, LifeBuoy, Megaphone,
  TimerOff, UserCheck, UserPlus, Users, Wallet, Cake, ArrowRight,
} from "lucide-react";
import { Card, Progress } from "@/components/ui";
import { ErrorState, SectionCard, Skeleton, StatCard, StatusBadge } from "@/components/common";
import { Bars, Donut, TrendArea } from "@/components/charts";
import { ClockCard, type ShiftInfo, type TodayRecord } from "@/components/clock-card";
import { useAuth } from "@/lib/auth";
import { useRows, useRpc } from "@/lib/api";
import { ROLE_INFO } from "@/lib/roles";
import { ago, fmtShort, money, periodLabel } from "@/lib/format";
import { pkrCompact } from "@/lib/format";

type Summary = {
  approvals_waiting: number;
  me?: { today: TodayRecord; shift: ShiftInfo; leave: { code: string; name: string; color: string; available: number; entitled: number }[]; month_present: number; month_late: number;
    last_payslip: { period: string; net_pay: number; id: string } | null; open_tickets: number; pending_courses: number; reports: number };
  team?: { size: number; present: number; late: number; on_leave: number };
  company?: { headcount: number; joiners_30d: number; exits_12m: number; attrition_12m_pct: number; present_today: number; late_today: number; on_leave_today: number; open_positions: number;
    candidates_active: number; probation_due_30d: number; documents_expiring_30d: number; open_tickets: number; tickets_breaching_sla: number;
    by_department: { name: string; count: number }[]; attendance_7d: { date: string; present: number; late: number }[]; upcoming_birthdays: { name: string; date: string }[] | null };
  payroll?: { last_run: { id: string; period: string; status: string; total_net: number; total_gross: number; employer_cost: number; employees: number } | null;
    trend: { period: string; net: number; gross: number; cost: number }[]; monthly_salary_bill: number };
};

function greeting() { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; }

export default function DashboardPage() {
  const { ctx } = useAuth();
  const { data: s, isLoading, error, refetch } = useRpc<Summary>(["dashboard"], "dashboard_summary");
  const { data: news = [] } = useRows<{ id: string; title: string; body: string; published_at: string }[]>(["announcements", "latest"], (sb) =>
    sb.from("announcements").select("id, title, body, published_at").not("published_at", "is", null).order("published_at", { ascending: false }).limit(3));

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const first = (ctx?.employee?.full_name || ctx?.full_name || "").split(" ")[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm text-ink-soft">{ctx?.tenant?.name} · {ctx?.role ? ROLE_INFO[ctx.role].label : ""}</p>
          <h1 className="font-display text-2xl font-bold text-ink sm:text-3xl">{greeting()}{first ? `, ${first}` : ""}</h1>
        </div>
        {!!s?.approvals_waiting && (
          <Link href="/approvals" className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 transition hover:opacity-80">
            <Inbox className="h-4 w-4" />{s.approvals_waiting} waiting for your approval<ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>

      {isLoading || !s ? (
        <div className="grid gap-4 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-36" />)}</div>
      ) : (
        <>
          {s.me && (
            <div className="grid gap-4 lg:grid-cols-3">
              <ClockCard today={s.me.today} shift={s.me.shift} />
              <div className="grid grid-cols-2 gap-4 lg:col-span-2">
                <StatCard icon={UserCheck} label="Days present this month" value={s.me.month_present} hint={s.me.month_late ? `${s.me.month_late} late arrival(s)` : "No late arrivals"} />
                <StatCard icon={Wallet} label={s.me.last_payslip ? `Net pay · ${periodLabel(s.me.last_payslip.period)}` : "Last payslip"} value={s.me.last_payslip ? money(s.me.last_payslip.net_pay) : "—"} accent />
                <Card className="col-span-2 p-5">
                  <div className="mb-3 flex items-center justify-between"><p className="font-semibold text-ink">Leave balance</p><Link href="/leave" className="text-sm font-medium text-brand-600">Apply leave →</Link></div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {s.me.leave.slice(0, 4).map((l) => (
                      <div key={l.code}>
                        <div className="mb-1 flex justify-between text-sm"><span className="text-ink-soft">{l.name}</span><span className="font-semibold text-ink">{l.available} / {l.entitled}</span></div>
                        <Progress value={l.entitled ? (l.available / l.entitled) * 100 : 0} color={l.color} />
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs">
                    {s.me.pending_courses > 0 && <Link href="/learning" className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-3 py-1 text-violet-700"><GraduationCap className="h-3.5 w-3.5" />{s.me.pending_courses} course(s) to finish</Link>}
                    {s.me.open_tickets > 0 && <Link href="/helpdesk" className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-3 py-1 text-sky-700"><LifeBuoy className="h-3.5 w-3.5" />{s.me.open_tickets} open ticket(s)</Link>}
                  </div>
                </Card>
              </div>
            </div>
          )}

          {s.team && (
            <SectionCard icon={Users} title="My team today" subtitle={`${s.team.size} direct and indirect reports`} action={<Link href="/attendance?view=team" className="text-sm font-medium text-brand-600">Team board →</Link>}>
              <div className="grid gap-4 sm:grid-cols-4">
                <StatCard icon={UserCheck} label="Present" value={`${s.team.present}/${s.team.size}`} />
                <StatCard icon={Clock} label="Late" value={s.team.late} />
                <StatCard icon={CalendarOff} label="On leave" value={s.team.on_leave} />
                <StatCard icon={TimerOff} label="Not in yet" value={Math.max(0, s.team.size - s.team.present - s.team.on_leave)} />
              </div>
            </SectionCard>
          )}

          {s.company && (
            <>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatCard icon={Users} label="Headcount" value={s.company.headcount} hint={`${s.company.joiners_30d} joined in 30 days`} accent />
                <StatCard icon={UserCheck} label="Present today" value={s.company.present_today} hint={`${s.company.late_today} late · ${s.company.on_leave_today} on leave`} />
                <StatCard icon={Briefcase} label="Open positions" value={s.company.open_positions} hint={`${s.company.candidates_active} candidates in pipeline`} />
                <StatCard icon={TimerOff} label="Attrition (12 months)" value={`${s.company.attrition_12m_pct}%`} hint={`${s.company.exits_12m} exits`} />
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                <SectionCard className="lg:col-span-2" icon={CalendarDays} title="Attendance · last 7 days">
                  <TrendArea data={s.company.attendance_7d.map((d) => ({ label: fmtShort(d.date), present: d.present, late: d.late }))} series={[{ key: "present", label: "Present" }, { key: "late", label: "Late" }]} />
                </SectionCard>
                <SectionCard icon={Users} title="By department">
                  <Donut data={s.company.by_department.map((d) => ({ name: d.name, value: d.count }))} center={s.company.headcount} sub="employees" />
                </SectionCard>
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {[
                  { icon: UserPlus, label: "Probation ending in 30 days", value: s.company.probation_due_30d, href: "/people?status=probation" },
                  { icon: FileWarning, label: "Documents expiring in 30 days", value: s.company.documents_expiring_30d, href: "/documents?view=expiring" },
                  { icon: LifeBuoy, label: "Open helpdesk tickets", value: s.company.open_tickets, href: "/helpdesk" },
                  { icon: AlertTriangle, label: "Tickets past SLA", value: s.company.tickets_breaching_sla, href: "/helpdesk", warn: true },
                ].map((a) => (
                  <Link key={a.label} href={a.href}>
                    <Card className="flex items-center gap-4 p-4 transition hover:shadow-pop">
                      <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${a.warn && a.value ? "bg-rose-50 text-rose-600" : "bg-surface-muted text-ink-soft"}`}><a.icon className="h-5 w-5" /></div>
                      <div><p className="font-display text-xl font-bold text-ink">{a.value}</p><p className="text-xs text-ink-soft">{a.label}</p></div>
                    </Card>
                  </Link>
                ))}
              </div>
            </>
          )}

          {s.payroll && (
            <div className="grid gap-4 lg:grid-cols-3">
              <SectionCard icon={Wallet} title="Payroll" subtitle="Latest run" action={<Link href="/payroll" className="text-sm font-medium text-brand-600">Open →</Link>}>
                {s.payroll.last_run ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between"><span className="font-display text-lg font-semibold text-ink">{periodLabel(s.payroll.last_run.period)}</span><StatusBadge status={s.payroll.last_run.status} /></div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-2xl bg-surface-muted p-3"><p className="text-xs text-ink-soft">Net pay</p><p className="font-semibold text-ink">{pkrCompact(s.payroll.last_run.total_net)}</p></div>
                      <div className="rounded-2xl bg-surface-muted p-3"><p className="text-xs text-ink-soft">Employer cost</p><p className="font-semibold text-ink">{pkrCompact(s.payroll.last_run.employer_cost)}</p></div>
                    </div>
                    <p className="text-xs text-ink-soft">{s.payroll.last_run.employees} employees · monthly salary bill {pkrCompact(s.payroll.monthly_salary_bill)}</p>
                  </div>
                ) : <p className="text-sm text-ink-soft">No payroll run yet. Monthly salary bill: {money(s.payroll.monthly_salary_bill)}</p>}
              </SectionCard>
              <SectionCard className="lg:col-span-2" icon={Wallet} title="Payroll cost trend" subtitle="Finalized regular runs">
                {s.payroll.trend.length ? <Bars money data={s.payroll.trend.map((t) => ({ label: periodLabel(t.period), value: Number(t.cost) }))} /> : <p className="py-16 text-center text-sm text-ink-soft">The trend appears after your first finalized payroll.</p>}
              </SectionCard>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard icon={Megaphone} title="Announcements" action={<Link href="/engagement" className="text-sm font-medium text-brand-600">All →</Link>}>
              {news.length === 0 ? <p className="py-6 text-center text-sm text-ink-soft">No announcements yet.</p> : (
                <ul className="space-y-3">{news.map((n) => (
                  <li key={n.id} className="rounded-2xl bg-surface-muted p-4"><p className="font-medium text-ink">{n.title}</p><p className="mt-1 line-clamp-2 text-sm text-ink-soft">{n.body}</p><p className="mt-1 text-xs text-ink-soft">{ago(n.published_at)}</p></li>
                ))}</ul>
              )}
            </SectionCard>
            {s.company?.upcoming_birthdays && (
              <SectionCard icon={Cake} title="Upcoming birthdays" subtitle="Next 14 days">
                {s.company.upcoming_birthdays.length === 0 ? <p className="py-6 text-center text-sm text-ink-soft">No birthdays in the next two weeks.</p> : (
                  <ul className="space-y-2">{s.company.upcoming_birthdays.map((b) => <li key={b.name} className="flex justify-between rounded-2xl bg-surface-muted px-4 py-2.5 text-sm"><span className="text-ink">{b.name}</span><span className="text-ink-soft">{b.date}</span></li>)}</ul>
                )}
              </SectionCard>
            )}
          </div>
        </>
      )}
    </div>
  );
}
