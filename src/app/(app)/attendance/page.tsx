"use client";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarClock, ChevronLeft, ChevronRight, Clock, Download, Plus, Timer, Users } from "lucide-react";
import { Avatar, Button, Card, Dialog, Field, Input, Select, Tabs, Textarea } from "@/components/ui";
import { DataTable, EmptyState, Loading, PageHeader, SearchInput, SectionCard, StatusBadge } from "@/components/common";
import { ClockCard, type ShiftInfo, type TodayRecord } from "@/components/clock-card";
import { byId, useDepartments, useEmployees, useShifts, type EmployeeLite } from "@/lib/lookups";
import { downloadText, openFile, q, toCsv, useAction, useRows, useRpc } from "@/lib/api";
import { AttendanceRules } from "@/components/attendance-rules";
import { Badge } from "@/components/ui";
import { useMe } from "@/lib/auth";
import { can } from "@/lib/roles";
import { addDays, fmtDate, fmtShort, fmtTime, minutes, toISODate, today, title, DOW } from "@/lib/format";
import { cn } from "@/lib/utils";

type Rec = { id: string; employee_id: string; work_date: string; clock_in_at: string | null; clock_out_at: string | null; status: string; late_minutes: number; worked_minutes: number; overtime_minutes: number; flags: string[]; source: string; clock_in_distance_m: number | null; clock_in_photo_path: string | null; clock_in_face_score: number | null; work_mode: string | null; clock_out_distance_m: number | null };

const STATUS_BG: Record<string, string> = { present: "bg-emerald-500", late: "bg-amber-500", half_day: "bg-amber-400", absent: "bg-rose-500", on_leave: "bg-violet-500", holiday: "bg-sky-500", missing_punch: "bg-orange-500" };

function reportsOf(meId: string | null, emps: EmployeeLite[]) {
  if (!meId) return new Set<string>();
  const out = new Set<string>(); let frontier = [meId];
  for (let depth = 0; depth < 10 && frontier.length; depth++) {
    const next = emps.filter((e) => e.manager_id && frontier.includes(e.manager_id)).map((e) => e.id);
    next.forEach((n) => out.add(n)); frontier = next;
  }
  return out;
}

function MyAttendance({ employeeId }: { employeeId: string }) {
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const start = month + "-01";
  const end = toISODate(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
  const { data: summary } = useRpc<{ me?: { today: TodayRecord; shift: ShiftInfo } }>(["dashboard"], "dashboard_summary");
  const { data: recs = [] } = useRows<Rec[]>(["attendance", "mine", month], (sb) => sb.from("attendance_records").select("*").eq("employee_id", employeeId).gte("work_date", start).lte("work_date", end));
  const { data: holidays = [] } = useRows<{ holiday_date: string; name: string }[]>(["holidays", month], (sb) => sb.from("holidays").select("holiday_date, name").gte("holiday_date", start).lte("holiday_date", end));
  const { data: reqs = [] } = useRows<{ id: string; work_date: string; clock_in_time: string | null; clock_out_time: string | null; reason: string; status: string; kind: string }[]>(["attendance", "requests"], async (sb) => {
    const [a, b] = await Promise.all([
      sb.from("regularization_requests").select("id, work_date, clock_in_time, clock_out_time, reason, status").eq("employee_id", employeeId).order("created_at", { ascending: false }).limit(20),
      sb.from("overtime_requests").select("id, work_date, minutes, reason, status").eq("employee_id", employeeId).order("created_at", { ascending: false }).limit(20),
    ]);
    if (a.error || b.error) return { data: null, error: a.error || b.error };
    return { data: [...(a.data ?? []).map((x) => ({ ...x, kind: "Correction" })), ...(b.data ?? []).map((x) => ({ ...x, clock_in_time: null, clock_out_time: null, reason: `${Math.round(x.minutes / 6) / 10} h · ${x.reason ?? ""}`, kind: "Overtime" }))]
      .sort((x, y) => y.work_date.localeCompare(x.work_date)), error: null };
  });
  const [dlg, setDlg] = useState<null | "reg" | "ot">(null);
  const byDate = new Map(recs.map((r) => [r.work_date, r]));
  const hol = new Map(holidays.map((h) => [h.holiday_date, h.name]));
  const first = new Date(start + "T00:00:00");
  const days = Array.from({ length: Number(end.slice(8)) }, (_, i) => addDays(first, i));
  const lead = (first.getDay() + 6) % 7;
  const shiftMonth = (n: number) => { const d = new Date(first); d.setMonth(d.getMonth() + n); setMonth(toISODate(d).slice(0, 7)); };
  const totals = { present: recs.filter((r) => r.clock_in_at).length, late: recs.filter((r) => r.status === "late").length, worked: recs.reduce((s, r) => s + (r.worked_minutes || 0), 0), ot: recs.reduce((s, r) => s + (r.overtime_minutes || 0), 0) };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <ClockCard today={summary?.me?.today ?? null} shift={summary?.me?.shift ?? null} />
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button onClick={() => shiftMonth(-1)} className="cursor-pointer rounded-full p-2 hover:bg-surface-muted"><ChevronLeft className="h-4 w-4" /></button>
              <p className="w-36 text-center font-semibold text-ink">{first.toLocaleDateString("en-PK", { month: "long", year: "numeric" })}</p>
              <button onClick={() => shiftMonth(1)} className="cursor-pointer rounded-full p-2 hover:bg-surface-muted"><ChevronRight className="h-4 w-4" /></button>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setDlg("reg")}><Plus className="h-4 w-4" />Correction</Button>
              <Button size="sm" variant="outline" onClick={() => setDlg("ot")}><Timer className="h-4 w-4" />Overtime</Button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1.5 text-center text-xs">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="pb-1 font-medium text-ink-soft">{d}</div>)}
            {Array.from({ length: lead }).map((_, i) => <div key={"l" + i} />)}
            {days.map((d) => {
              const iso = toISODate(d); const r = byDate.get(iso); const h = hol.get(iso);
              return (
                <div key={iso} title={h ?? (r ? `${title(r.status)} · ${fmtTime(r.clock_in_at)}–${fmtTime(r.clock_out_at)}` : "")}
                  className={cn("flex aspect-square flex-col items-center justify-center rounded-xl border border-line text-ink", iso === today() && "ring-2 ring-brand-400")}>
                  <span className="text-sm font-medium">{d.getDate()}</span>
                  <span className={cn("mt-1 h-1.5 w-1.5 rounded-full", r ? STATUS_BG[r.status] ?? "bg-slate-400" : h ? "bg-sky-500" : "bg-transparent")} />
                </div>
              );
            })}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[["Days present", totals.present], ["Late", totals.late], ["Hours worked", minutes(totals.worked)], ["Overtime detected", minutes(totals.ot)]].map(([k, v]) => (
              <div key={String(k)} className="rounded-2xl bg-surface-muted p-3"><p className="text-xs text-ink-soft">{k}</p><p className="font-semibold text-ink">{v}</p></div>
            ))}
          </div>
        </Card>
      </div>
      <SectionCard icon={CalendarClock} title="My requests">
        <DataTable rows={reqs} columns={[
          { key: "k", label: "Type", render: (r) => <span className="font-medium">{r.kind}</span> },
          { key: "d", label: "Date", render: (r) => fmtDate(r.work_date) },
          { key: "t", label: "Details", render: (r) => r.kind === "Correction" ? `${r.clock_in_time?.slice(0, 5) ?? "--"} to ${r.clock_out_time?.slice(0, 5) ?? "--"} · ${r.reason}` : r.reason },
          { key: "s", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
        ]} empty={<EmptyState icon={Clock} title="No requests" text="Forgot to punch? Request a correction and your manager approves it." />} />
      </SectionCard>
      <RequestDialog kind={dlg} onClose={() => setDlg(null)} employeeId={employeeId} />
    </div>
  );
}

function RequestDialog({ kind, onClose, employeeId }: { kind: null | "reg" | "ot"; onClose: () => void; employeeId: string }) {
  const [date, setDate] = useState(today()); const [inT, setIn] = useState("09:00"); const [outT, setOut] = useState("18:00"); const [hours, setHours] = useState("2"); const [reason, setReason] = useState("");
  const a = useAction(() => kind === "reg"
    ? q((sb) => sb.from("regularization_requests").insert({ employee_id: employeeId, work_date: date, clock_in_time: inT || null, clock_out_time: outT || null, reason }))
    : q((sb) => sb.from("overtime_requests").insert({ employee_id: employeeId, work_date: date, minutes: Math.round(Number(hours) * 60), reason })),
    { success: "Request sent to your manager", invalidate: ["attendance"], onDone: () => { setReason(""); onClose(); } });
  return (
    <Dialog open={!!kind} onClose={onClose} title={kind === "reg" ? "Request attendance correction" : "Request overtime approval"} description="Only approved overtime is paid in payroll.">
      <div className="space-y-4">
        <Field label="Date"><Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        {kind === "reg" ? (
          <div className="grid grid-cols-2 gap-3"><Field label="Clock in"><Input type="time" value={inT} onChange={(e) => setIn(e.target.value)} /></Field><Field label="Clock out"><Input type="time" value={outT} onChange={(e) => setOut(e.target.value)} /></Field></div>
        ) : <Field label="Overtime hours"><Input type="number" step="0.5" min="0.5" max="16" value={hours} onChange={(e) => setHours(e.target.value)} /></Field>}
        <Field label="Reason"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === "reg" ? "Forgot to punch out" : "Month-end stock count"} /></Field>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => a.mutate()} loading={a.isPending} disabled={reason.trim().length < 3}>Submit</Button></div>
      </div>
    </Dialog>
  );
}

function Board({ scope }: { scope: "team" | "all" }) {
  const { employeeId, role } = useMe();
  const [date, setDate] = useState(today());
  const [term, setTerm] = useState("");
  const [dept, setDept] = useState("");
  const { data: emps = [] } = useEmployees();
  const { data: depts = [] } = useDepartments();
  const D = byId(depts);
  const { data: recs = [], isLoading } = useRows<Rec[]>(["attendance", "board", date], (sb) => sb.from("attendance_records").select("*").eq("work_date", date));
  const { data: leaves = [] } = useRows<{ employee_id: string }[]>(["leave", "on", date], (sb) => sb.from("leave_requests").select("employee_id").eq("status", "approved").lte("start_date", date).gte("end_date", date));
  const mine = useMemo(() => reportsOf(employeeId, emps), [employeeId, emps]);
  const list = emps.filter((e) => e.status !== "exited" && (scope === "all" || mine.has(e.id)) && (!dept || e.department_id === dept) && (!term || e.full_name.toLowerCase().includes(term.toLowerCase())));
  const R = new Map(recs.map((r) => [r.employee_id, r])); const L = new Set(leaves.map((l) => l.employee_id));
  const rows = list.map((e) => ({ id: e.id, e, r: R.get(e.id), leave: L.has(e.id) }));
  const count = (f: (x: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  const mark = useAction(({ emp, status }: { emp: string; status: string }) => q((sb) => sb.from("attendance_records").upsert({ employee_id: emp, work_date: date, status, source: "manual", flags: ["corrected"] }, { onConflict: "employee_id,work_date" })),
    { success: "Attendance updated", invalidate: ["attendance"] });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[["In scope", rows.length, "bg-surface-muted text-ink"], ["Present", count((x) => !!x.r?.clock_in_at), "bg-emerald-50 text-emerald-700"], ["Late", count((x) => x.r?.status === "late"), "bg-amber-50 text-amber-700"],
          ["On leave", count((x) => x.leave), "bg-violet-50 text-violet-700"], ["Not in", count((x) => !x.r?.clock_in_at && !x.leave), "bg-rose-50 text-rose-700"]].map(([k, v, c]) => (
          <div key={String(k)} className={cn("rounded-2xl p-4", String(c))}><p className="text-xs opacity-80">{k}</p><p className="font-display text-2xl font-bold">{v}</p></div>
        ))}
      </div>
      <Card className="p-4">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} className="sm:w-44" />
          <SearchInput value={term} onChange={setTerm} placeholder="Search employee" className="flex-1" />
          {scope === "all" && <Select value={dept} onChange={(e) => setDept(e.target.value)} className="sm:w-48"><option value="">All departments</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>}
          <Button variant="outline" onClick={() => downloadText(`attendance-${date}.csv`, toCsv(rows.map((x) => ({ code: x.e.employee_code, name: x.e.full_name, status: x.leave ? "on_leave" : x.r?.status ?? "not_in", in: fmtTime(x.r?.clock_in_at), out: fmtTime(x.r?.clock_out_at), worked_min: x.r?.worked_minutes ?? 0 }))))}><Download className="h-4 w-4" />CSV</Button>
        </div>
        {isLoading ? <Loading /> : (
          <DataTable rows={rows} columns={[
            { key: "n", label: "Employee", render: (x) => <div className="flex items-center gap-3"><Avatar name={x.e.full_name} size="sm" /><div><p className="font-medium">{x.e.full_name}</p><p className="text-xs text-ink-soft">{D.get(x.e.department_id ?? "")?.name ?? x.e.job_title}</p></div></div> },
            { key: "i", label: "In", render: (x) => fmtTime(x.r?.clock_in_at) },
            { key: "o", label: "Out", render: (x) => fmtTime(x.r?.clock_out_at) },
            { key: "w", label: "Worked", render: (x) => x.r ? minutes(x.r.worked_minutes) : "—" },
            { key: "v", label: "Verification", hideOnMobile: true, render: (x) => x.r?.clock_in_at ? (
              <span className="flex flex-wrap items-center gap-1 text-xs">
                <Badge tone={x.r.flags?.includes("outside_geofence") || x.r.flags?.includes("no_geofence") ? "amber" : "neutral"}>{x.r.work_mode === "field" ? "Field" : x.r.work_mode === "remote" ? "Remote" : x.r.clock_in_distance_m != null ? `${x.r.clock_in_distance_m} m` : x.r.source}</Badge>
                {x.r.clock_in_face_score != null && <Badge tone="green">Face {Math.round((1 - Number(x.r.clock_in_face_score)) * 100)}%</Badge>}
                {x.r.clock_in_photo_path && <button className="cursor-pointer font-medium text-brand-600" onClick={() => openFile("attendance-selfies", x.r!.clock_in_photo_path!)}>Selfie</button>}
              </span>) : null },
            { key: "s", label: "Status", render: (x) => x.leave ? <StatusBadge status="on_leave" /> : x.r ? <span className="flex items-center gap-1.5"><StatusBadge status={x.r.status} />{x.r.flags?.includes("corrected") && <span className="text-[11px] text-ink-soft">corrected</span>}</span> : <StatusBadge status="absent" label="Not in" /> },
            ...(can.hrStaff(role) ? [{ key: "a", label: "", render: (x: (typeof rows)[number]) => !x.r?.clock_in_at && !x.leave ? (
              <Select className="h-8 w-32 text-xs" value="" onChange={(e) => e.target.value && mark.mutate({ emp: x.e.id, status: e.target.value })}><option value="">Mark…</option><option value="absent">Absent</option><option value="present">Present</option><option value="half_day">Half day</option></Select>
            ) : null }] : []),
          ]} empty={<EmptyState icon={Users} title={scope === "team" ? "No reports found" : "No employees"} />} />
        )}
      </Card>
    </div>
  );
}

function Roster() {
  const { data: emps = [] } = useEmployees();
  const { data: shifts = [] } = useShifts();
  const { data: depts = [] } = useDepartments();
  const [dept, setDept] = useState("");
  const [weekStart, setWeekStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return toISODate(d); });
  const days = Array.from({ length: 7 }, (_, i) => toISODate(addDays(new Date(weekStart + "T00:00:00"), i)));
  const { data: entries = [] } = useRows<{ id: string; employee_id: string; work_date: string; shift_id: string | null }[]>(["roster", weekStart], (sb) => sb.from("roster_entries").select("*").gte("work_date", days[0]).lte("work_date", days[6]));
  const S = byId(shifts);
  const map = new Map(entries.map((e) => [e.employee_id + e.work_date, e]));
  const list = emps.filter((e) => e.status !== "exited" && (!dept || e.department_id === dept));
  const set = useAction(async ({ emp, date, value }: { emp: string; date: string; value: string }) => {
    if (value === "default") { const ex = map.get(emp + date); if (ex) await q((sb) => sb.from("roster_entries").delete().eq("id", ex.id)); return; }
    await q((sb) => sb.from("roster_entries").upsert({ employee_id: emp, work_date: date, shift_id: value === "off" ? null : value }, { onConflict: "employee_id,work_date" }));
  }, { invalidate: ["roster"] });

  return (
    <Card className="p-4">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex items-center gap-1">
          <button onClick={() => setWeekStart(toISODate(addDays(new Date(weekStart + "T00:00:00"), -7)))} className="cursor-pointer rounded-full p-2 hover:bg-surface-muted"><ChevronLeft className="h-4 w-4" /></button>
          <span className="w-44 text-center text-sm font-semibold text-ink">{fmtShort(days[0])} – {fmtShort(days[6])}</span>
          <button onClick={() => setWeekStart(toISODate(addDays(new Date(weekStart + "T00:00:00"), 7)))} className="cursor-pointer rounded-full p-2 hover:bg-surface-muted"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <Select value={dept} onChange={(e) => setDept(e.target.value)} className="sm:ml-auto sm:w-56"><option value="">All departments</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead><tr className="text-left text-xs text-ink-soft"><th className="px-2 py-2">Employee</th>{days.map((d) => <th key={d} className="px-1 py-2 text-center">{DOW[new Date(d + "T00:00:00").getDay()]} {Number(d.slice(8))}</th>)}</tr></thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id} className="border-t border-line">
                <td className="px-2 py-2"><p className="font-medium text-ink">{e.full_name}</p><p className="text-xs text-ink-soft">Default: {S.get(e.shift_id ?? "")?.name ?? "—"}</p></td>
                {days.map((d) => {
                  const ent = map.get(e.id + d); const v = ent ? ent.shift_id ?? "off" : "default";
                  const color = ent?.shift_id ? S.get(ent.shift_id)?.color : undefined;
                  return (
                    <td key={d} className="px-1 py-2">
                      <select value={v} onChange={(ev) => set.mutate({ emp: e.id, date: d, value: ev.target.value })} style={color ? { borderColor: color } : undefined}
                        className={cn("h-9 w-full cursor-pointer rounded-xl border bg-surface px-1.5 text-xs text-ink", v === "off" ? "border-rose-300 text-rose-600" : v === "default" ? "border-line text-ink-soft" : "border-2")}>
                        <option value="default">Default</option>
                        {shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        <option value="off">Day off</option>
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Attempts() {
  const { data: emps = [] } = useEmployees(); const E = byId(emps);
  const [only, setOnly] = useState("failed");
  const { data: rows = [] } = useRows<{ id: number; employee_id: string; kind: string; ok: boolean; reason: string | null; distance_m: number | null; accuracy_m: number | null; face_score: number | null; photo_path: string | null; created_at: string; latitude: number | null; longitude: number | null }[]>(
    ["attendance", "attempts", only], (sb) => { let x = sb.from("clock_attempts").select("*").order("created_at", { ascending: false }).limit(300); if (only === "failed") x = x.eq("ok", false); return x; });
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2"><Tabs value={only} onChange={setOnly} tabs={[{ value: "failed", label: "Rejected" }, { value: "all", label: "All attempts" }]} /><span className="text-xs text-ink-soft">Every punch attempt is logged, including rejected ones.</span></div>
      <DataTable rows={rows} rowKey={(r) => String(r.id)} columns={[
        { key: "t", label: "When", render: (r) => <span className="whitespace-nowrap text-ink-soft">{fmtShort(r.created_at)} {fmtTime(r.created_at)}</span> },
        { key: "e", label: "Employee", render: (r) => E.get(r.employee_id)?.full_name },
        { key: "k", label: "Punch", render: (r) => <Badge tone={r.ok ? "green" : "rose"}>{r.kind === "in" ? "Clock in" : "Clock out"} · {r.ok ? "accepted" : "rejected"}</Badge> },
        { key: "r", label: "Reason", render: (r) => <span className="text-xs text-ink-soft">{r.reason ?? "—"}</span> },
        { key: "d", label: "Location", hideOnMobile: true, render: (r) => r.latitude != null ? <a className="text-xs text-brand-600" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${r.latitude},${r.longitude}`}>{r.distance_m != null ? `${r.distance_m} m` : "Map"} · ±{Math.round(r.accuracy_m ?? 0)} m ↗</a> : "—" },
        { key: "f", label: "Face", render: (r) => r.face_score != null ? <span className="text-xs">{Math.round((1 - Number(r.face_score)) * 100)}%</span> : "—" },
        { key: "p", label: "", render: (r) => r.photo_path ? <button className="cursor-pointer text-xs font-medium text-brand-600" onClick={() => openFile("attendance-selfies", r.photo_path!)}>Selfie</button> : null },
      ]} empty={<EmptyState icon={Clock} title={only === "failed" ? "No rejected attempts" : "No attempts yet"} />} />
    </Card>
  );
}

export default function AttendancePage() {
  const { employeeId, role, ctx } = useMe();
  const params = useSearchParams();
  const hasTeam = !!ctx?.employee?.has_reports;
  const tabs = [
    ...(employeeId ? [{ value: "me", label: "My attendance" }] : []),
    ...(hasTeam ? [{ value: "team", label: "My team" }] : []),
    ...(can.hrStaff(role) ? [{ value: "all", label: "Attendance board" }, { value: "rules", label: "GPS & Face ID rules" }, { value: "attempts", label: "Punch log" }, { value: "roster", label: "Shift roster" }] : []),
  ];
  const [tab, setTab] = useState(params.get("view") && tabs.some((t) => t.value === params.get("view")) ? params.get("view")! : tabs[0]?.value ?? "me");
  return (
    <div>
      <PageHeader icon={Clock} title="Time & attendance" subtitle="Server-checked clock-ins with GPS geofence, selfie and Face ID, corrections and shift rosters." />
      {tabs.length > 1 && <Tabs className="mb-4" value={tab} onChange={setTab} tabs={tabs} />}
      {tab === "me" && employeeId && <MyAttendance employeeId={employeeId} />}
      {tab === "team" && <Board scope="team" />}
      {tab === "all" && <Board scope="all" />}
      {tab === "roster" && <Roster />}
      {tab === "rules" && <AttendanceRules />}
      {tab === "attempts" && <Attempts />}
    </div>
  );
}
