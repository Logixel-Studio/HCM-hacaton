"use client";
import { Building2 } from "lucide-react";
import { Card, Select } from "@/components/ui";
import { DataTable, EmptyState, PageHeader, StatCard, StatusBadge } from "@/components/common";
import { RequireAccess } from "@/components/guard";
import { rpc, useAction, useRpc } from "@/lib/api";
import { fmtDate } from "@/lib/format";

type T = { id: string; name: string; slug: string; plan: string; status: string; seat_limit: number; members: number; employees: number; created_at: string; trial_ends_at: string | null };

export default function PlatformPage() {
  const { data: tenants = [] } = useRpc<T[]>(["platform"], "platform_tenants");
  const upd = useAction((a: { id: string; plan?: string; status?: string }) => rpc("platform_update_tenant", { p_tenant: a.id, p_plan: a.plan ?? null, p_status: a.status ?? null, p_seat_limit: null }), { success: "Tenant updated", invalidate: ["platform"] });
  return (
    <RequireAccess allow={(c) => c.isPlatformAdmin}>
      <PageHeader icon={Building2} title="Platform administration" subtitle="Tenants, plans and status. Tenant data is not visible from here (brief §21)." />
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Building2} label="Tenants" value={tenants.length} accent />
        <StatCard icon={Building2} label="Active" value={tenants.filter((t) => t.status === "active").length} />
        <StatCard icon={Building2} label="On trial" value={tenants.filter((t) => t.status === "trial").length} />
        <StatCard icon={Building2} label="Employees managed" value={tenants.reduce((s, t) => s + Number(t.employees), 0)} />
      </div>
      <Card className="p-4"><DataTable rows={tenants} columns={[
        { key: "n", label: "Company", render: (t) => <div><p className="font-medium">{t.name}</p><p className="text-xs text-ink-soft">{t.slug} · since {fmtDate(t.created_at)}</p></div> },
        { key: "u", label: "Users / employees", render: (t) => `${t.members} / ${t.employees}` },
        { key: "p", label: "Plan", render: (t) => <Select className="h-8 w-32 text-xs" value={t.plan} onChange={(e) => upd.mutate({ id: t.id, plan: e.target.value })}>{["starter", "growth", "enterprise"].map((p) => <option key={p}>{p}</option>)}</Select> },
        { key: "s", label: "Status", render: (t) => <div className="flex items-center gap-2"><StatusBadge status={t.status} /><Select className="h-8 w-32 text-xs" value={t.status} onChange={(e) => upd.mutate({ id: t.id, status: e.target.value })}>{["trial", "active", "suspended", "cancelled"].map((p) => <option key={p}>{p}</option>)}</Select></div> },
      ]} empty={<EmptyState title="No tenants" />} /></Card>
    </RequireAccess>
  );
}
