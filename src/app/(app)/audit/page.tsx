"use client";
import { useState } from "react";
import { Download, ScrollText } from "lucide-react";
import { Badge, Button, Card, Dialog, Input, Select } from "@/components/ui";
import { DataTable, EmptyState, Loading, PageHeader, SearchInput } from "@/components/common";
import { RequireAccess } from "@/components/guard";
import { downloadText, toCsv, useRows } from "@/lib/api";
import { can } from "@/lib/roles";
import { fmtDateTime, title } from "@/lib/format";

type Log = { id: number; actor_email: string | null; action: string; entity: string; entity_id: string | null; before_data: Record<string, unknown> | null; after_data: Record<string, unknown> | null; created_at: string };
const HIDDEN = new Set(["updated_at", "created_at", "tenant_id"]);

export default function AuditPage() {
  const [entity, setEntity] = useState(""); const [action, setAction] = useState(""); const [term, setTerm] = useState(""); const [from, setFrom] = useState("");
  const [sel, setSel] = useState<Log | null>(null);
  const { data: logs = [], isLoading } = useRows<Log[]>(["audit", entity, action, from], (sb) => { let x = sb.from("audit_log").select("*").order("created_at", { ascending: false }).limit(500); if (entity) x = x.eq("entity", entity); if (action) x = x.ilike("action", `${action}%`); if (from) x = x.gte("created_at", from); return x; });
  const rows = logs.filter((l) => !term || `${l.actor_email} ${l.entity} ${l.entity_id}`.toLowerCase().includes(term.toLowerCase()));
  const changes = (l: Log) => { const b = l.before_data ?? {}, a = l.after_data ?? {}; return Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).filter((k) => !HIDDEN.has(k) && JSON.stringify(b[k]) !== JSON.stringify(a[k])); };
  return (
    <RequireAccess allow={(c) => can.tenantAdmin(c.role) || can.auditor(c.role) || c.role === "hr_director"}>
      <PageHeader icon={ScrollText} title="Audit log" subtitle="Append-only record of every change: who, what, when, before and after.">
        <Button variant="outline" onClick={() => downloadText("audit-log.csv", toCsv(rows.map((l) => ({ when: l.created_at, who: l.actor_email, action: l.action, entity: l.entity, id: l.entity_id, fields: changes(l).join(" ") }))))}><Download className="h-4 w-4" />Export</Button>
      </PageHeader>
      <Card className="p-4">
        <div className="mb-4 flex flex-col gap-2 lg:flex-row">
          <SearchInput value={term} onChange={setTerm} placeholder="Search by user or record" className="flex-1" />
          <Select value={entity} onChange={(e) => setEntity(e.target.value)} className="lg:w-52"><option value="">All records</option>{["employees", "employee_compensation", "employee_private", "payroll_runs", "payroll_settings", "tax_slabs", "leave_requests", "memberships", "user_invites", "expense_claims", "loans", "candidates", "assets"].map((x) => <option key={x} value={x}>{title(x)}</option>)}</Select>
          <Select value={action} onChange={(e) => setAction(e.target.value)} className="lg:w-40"><option value="">All actions</option><option value="insert">Create</option><option value="update">Update</option><option value="delete">Delete</option><option value="payroll">Payroll actions</option><option value="export">Exports</option></Select>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="lg:w-44" />
        </div>
        {isLoading ? <Loading /> : <DataTable rows={rows} rowKey={(l) => String(l.id)} onRowClick={setSel} columns={[
          { key: "w", label: "When", render: (l) => <span className="whitespace-nowrap text-ink-soft">{fmtDateTime(l.created_at)}</span> },
          { key: "u", label: "User", render: (l) => l.actor_email ?? "system" },
          { key: "a", label: "Action", render: (l) => <Badge tone={l.action === "delete" ? "rose" : l.action === "insert" ? "green" : l.action.startsWith("payroll") ? "violet" : "sky"}>{title(l.action)}</Badge> },
          { key: "e", label: "Record", render: (l) => title(l.entity) },
          { key: "c", label: "Fields", render: (l) => <span className="text-xs text-ink-soft">{l.action === "update" ? changes(l).slice(0, 4).join(", ") : "—"}</span>, hideOnMobile: true },
        ]} empty={<EmptyState icon={ScrollText} title="No entries" />} />}
      </Card>
      <Dialog open={!!sel} onClose={() => setSel(null)} title={sel ? `${title(sel.action)} · ${title(sel.entity)}` : ""} description={sel ? `${sel.actor_email ?? "system"} · ${fmtDateTime(sel.created_at)}` : ""} className="max-w-2xl">
        {sel && (
          <div className="space-y-2">
            {(sel.action === "update" ? changes(sel) : Object.keys(sel.after_data ?? sel.before_data ?? {}).filter((k) => !HIDDEN.has(k))).map((k) => (
              <div key={k} className="grid grid-cols-[140px_1fr] gap-3 rounded-xl bg-surface-muted px-3 py-2 text-xs">
                <span className="font-medium text-ink">{k}</span>
                <span className="break-all text-ink-soft">{sel.action === "update" ? <><span className="text-rose-600 line-through">{JSON.stringify(sel.before_data?.[k])}</span> → <span className="text-emerald-600">{JSON.stringify(sel.after_data?.[k])}</span></> : JSON.stringify((sel.after_data ?? sel.before_data)?.[k])}</span>
              </div>
            ))}
          </div>
        )}
      </Dialog>
    </RequireAccess>
  );
}
