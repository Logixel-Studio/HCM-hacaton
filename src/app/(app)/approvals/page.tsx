"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, CheckCheck, Clock, FileCheck2, Inbox, Receipt, Timer, Wallet, Briefcase, Plane, HandCoins, BadgeCheck, LogOut as Exit } from "lucide-react";
import { Avatar, Button, Card, Tabs } from "@/components/ui";
import { DecisionButtons, EmptyState, ErrorState, Loading, PageHeader } from "@/components/common";
import { rpc, useAction, useRpc } from "@/lib/api";
import { ago, money } from "@/lib/format";

type Item = { kind: string; id: string; employee_id: string | null; employee_name: string | null; title: string; detail: string | null; amount: number | null; created_at: string; link: string };

const KIND: Record<string, { label: string; icon: typeof Inbox; fn?: string }> = {
  leave: { label: "Leave", icon: CalendarDays, fn: "decide_leave" },
  regularization: { label: "Attendance", icon: Clock, fn: "decide_regularization" },
  overtime: { label: "Overtime", icon: Timer, fn: "decide_overtime" },
  expense: { label: "Expenses", icon: Receipt, fn: "decide_expense" },
  travel: { label: "Travel", icon: Plane, fn: "decide_travel" },
  loan: { label: "Loans", icon: HandCoins, fn: "decide_loan" },
  requisition: { label: "Hiring", icon: Briefcase, fn: "decide_requisition" },
  offer: { label: "Offers", icon: BadgeCheck },
  payroll: { label: "Payroll", icon: Wallet },
  settlement: { label: "Settlements", icon: Exit },
};

export default function ApprovalsPage() {
  const { data = [], isLoading, error, refetch } = useRpc<Item[]>(["approvals", "list"], "my_approvals");
  const [tab, setTab] = useState("all");
  const kinds = useMemo(() => Array.from(new Set(data.map((d) => d.kind))), [data]);
  const rows = tab === "all" ? data : data.filter((d) => d.kind === tab);

  const decide = useAction(async ({ item, approve, note }: { item: Item; approve: boolean; note: string | null }) => {
    if (item.kind === "offer") return rpc("set_offer_status", { p_id: item.id, p_status: approve ? "approved" : "declined" });
    return rpc(KIND[item.kind].fn!, { p_id: item.id, p_approve: approve, p_note: note });
  }, { success: "Done", invalidate: ["approvals", "leave", "attendance", "expenses", "recruitment"] });

  const bulk = useAction(async (items: Item[]) => { for (const it of items) await rpc(KIND[it.kind].fn!, { p_id: it.id, p_approve: true, p_note: null }); return items.length; },
    { success: (n) => `${n} request(s) approved`, invalidate: ["approvals", "leave", "attendance"] });
  const bulkable = rows.filter((r) => ["leave", "regularization", "overtime"].includes(r.kind));

  return (
    <div>
      <PageHeader icon={Inbox} title="Approvals" subtitle="Everything waiting for your decision, across every module.">
        {bulkable.length > 1 && <Button variant="outline" onClick={() => bulk.mutate(bulkable)} loading={bulk.isPending}><CheckCheck className="h-4 w-4" />Approve all {bulkable.length} time & leave</Button>}
      </PageHeader>
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ value: "all", label: "All", count: data.length }, ...kinds.map((k) => ({ value: k, label: KIND[k]?.label ?? k, count: data.filter((d) => d.kind === k).length }))]} />
      <Card className="p-2 sm:p-3">
        {isLoading ? <Loading /> : error ? <ErrorState error={error} onRetry={refetch} /> : rows.length === 0 ? (
          <EmptyState icon={FileCheck2} title="Inbox zero" text="Nothing is waiting for you. New requests from your team will appear here." />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((it) => {
              const K = KIND[it.kind] ?? { label: it.kind, icon: Inbox };
              return (
                <li key={it.kind + it.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {it.employee_name ? <Avatar name={it.employee_name} /> : <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-600"><K.icon className="h-5 w-5" /></div>}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{it.employee_name ? `${it.employee_name} · ` : ""}{it.title}</p>
                      <p className="truncate text-xs text-ink-soft">{it.detail}{it.amount != null ? ` · ${money(it.amount)}` : ""} · {ago(it.created_at)}</p>
                    </div>
                  </div>
                  {K.fn || it.kind === "offer" ? (
                    <DecisionButtons onDecide={(approve, note) => decide.mutate({ item: it, approve, note })} loading={decide.isPending && decide.variables?.item.id === it.id} requireRejectNote={it.kind !== "offer"} />
                  ) : (
                    <Link href={it.link}><Button size="sm" variant="subtle">Review</Button></Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
