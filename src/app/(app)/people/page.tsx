"use client";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Download, Network, Plus, Users } from "lucide-react";
import { Avatar, Button, Card, Select, Tabs } from "@/components/ui";
import { EmptyState, ErrorState, Loading, PageHeader, SearchInput, StatusBadge } from "@/components/common";
import { EmployeeForm, STATUSES } from "@/components/people/employee-form";
import { byId, useBranches, useDepartments, useEmployees, type EmployeeLite } from "@/lib/lookups";
import { useMe } from "@/lib/auth";
import { can } from "@/lib/roles";
import { downloadText, toCsv } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

function OrgNode({ e, children, depth }: { e: EmployeeLite; children: Map<string, EmployeeLite[]>; depth: number }) {
  const router = useRouter();
  const kids = children.get(e.id) ?? [];
  const [open, setOpen] = useState(depth < 2);
  return (
    <li>
      <div className="flex items-center gap-2">
        {kids.length ? <button onClick={() => setOpen(!open)} className="cursor-pointer rounded-lg p-1 text-ink-soft hover:bg-surface-muted">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button> : <span className="w-6" />}
        <button onClick={() => router.push(`/people/${e.id}`)} className="flex min-w-0 cursor-pointer items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-2 text-left shadow-soft transition hover:border-brand-300">
          <Avatar name={e.full_name} size="sm" />
          <span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{e.full_name}</span><span className="block truncate text-xs text-ink-soft">{e.job_title ?? "—"}{kids.length ? ` · ${kids.length} report${kids.length > 1 ? "s" : ""}` : ""}</span></span>
        </button>
      </div>
      {open && kids.length > 0 && <ul className="ml-5 mt-2 space-y-2 border-l border-line pl-5">{kids.map((k) => <OrgNode key={k.id} e={k} children={children} depth={depth + 1} />)}</ul>}
    </li>
  );
}

export default function PeoplePage() {
  const router = useRouter();
  const params = useSearchParams();
  const { role } = useMe();
  const { data: emps = [], isLoading, error, refetch } = useEmployees();
  const { data: depts = [] } = useDepartments();
  const { data: branches = [] } = useBranches();
  const dmap = byId(depts), bmap = byId(branches);
  const [tab, setTab] = useState<"directory" | "org">("directory");
  const [term, setTerm] = useState("");
  const [dept, setDept] = useState("");
  const [status, setStatus] = useState(params.get("status") ?? "current");
  const [adding, setAdding] = useState(false);

  const rows = useMemo(() => emps.filter((e) =>
    (status === "current" ? e.status !== "exited" : status ? e.status === status : true) &&
    (!dept || e.department_id === dept) &&
    (!term || `${e.full_name} ${e.employee_code} ${e.job_title ?? ""} ${(e.skills ?? []).join(" ")}`.toLowerCase().includes(term.toLowerCase()))), [emps, status, dept, term]);

  const tree = useMemo(() => {
    const current = emps.filter((e) => e.status !== "exited");
    const ids = new Set(current.map((e) => e.id));
    const children = new Map<string, EmployeeLite[]>();
    current.forEach((e) => { if (e.manager_id && ids.has(e.manager_id)) children.set(e.manager_id, [...(children.get(e.manager_id) ?? []), e]); });
    return { roots: current.filter((e) => !e.manager_id || !ids.has(e.manager_id)), children };
  }, [emps]);

  const exportCsv = () => downloadText("employees.csv", toCsv(rows.map((e) => ({ code: e.employee_code, name: e.full_name, email: e.work_email, title: e.job_title,
    department: dmap.get(e.department_id ?? "")?.name, branch: bmap.get(e.branch_id ?? "")?.name, type: e.employment_type, status: e.status, joined: e.joining_date }))));

  return (
    <div>
      <PageHeader icon={Users} title="People" subtitle={`${emps.filter((e) => e.status !== "exited").length} current employees`}>
        {can.hrStaff(role) && <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4" />Export</Button>}
        {can.hrStaff(role) && <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add employee</Button>}
      </PageHeader>

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: "directory", label: "Directory" }, { value: "org", label: "Org chart" }]} />
        {tab === "directory" && (
          <div className="flex flex-1 flex-col gap-2 sm:flex-row">
            <SearchInput value={term} onChange={setTerm} placeholder="Search name, code, title or skill" className="flex-1" />
            <Select value={dept} onChange={(e) => setDept(e.target.value)} className="sm:w-48"><option value="">All departments</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-40"><option value="current">Current</option><option value="">Everyone</option>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
          </div>
        )}
      </div>

      {isLoading ? <Loading /> : error ? <ErrorState error={error} onRetry={refetch} /> : tab === "org" ? (
        <Card className="overflow-x-auto p-6"><ul className="space-y-2">{tree.roots.map((r) => <OrgNode key={r.id} e={r} children={tree.children} depth={0} />)}</ul></Card>
      ) : rows.length === 0 ? <Card><EmptyState icon={Users} title="No one matches" text="Try a different search or filter." /></Card> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((e) => (
            <Card key={e.id} onClick={() => router.push(`/people/${e.id}`)} className="cursor-pointer p-5 transition hover:-translate-y-0.5 hover:shadow-pop">
              <div className="flex items-start gap-4">
                <Avatar name={e.full_name} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{e.full_name}</p>
                  <p className="truncate text-sm text-ink-soft">{e.job_title ?? "—"}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={e.status} />
                    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-ink-soft">{e.employee_code}</span>
                  </div>
                </div>
              </div>
              <div className={cn("mt-4 grid grid-cols-2 gap-2 border-t border-line pt-3 text-xs")}>
                <div><p className="text-ink-soft">Department</p><p className="truncate font-medium text-ink">{dmap.get(e.department_id ?? "")?.name ?? "—"}</p></div>
                <div><p className="text-ink-soft">Joined</p><p className="font-medium text-ink">{fmtDate(e.joining_date)}</p></div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <EmployeeForm open={adding} onClose={() => setAdding(false)} />
      {tab === "org" && <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-soft"><Network className="h-3.5 w-3.5" />Reporting lines come from each employee&apos;s &quot;Reports to&quot; field.</p>}
    </div>
  );
}
