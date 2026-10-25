"use client";
import { useState } from "react";
import { FileText, Wallet } from "lucide-react";
import { Card } from "@/components/ui";
import { EmptyState, Loading, PageHeader } from "@/components/common";
import { Bars } from "@/components/charts";
import { PayslipView, type Payslip } from "@/components/payslip";
import { useRows } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { money, periodLabel } from "@/lib/format";
import { Button } from "@/components/ui";
import { Printer } from "lucide-react";
import { cn } from "@/lib/utils";

export default function MyPayslipsPage() {
  const { employeeId, ctx } = useMe();
  const { data: slips = [], isLoading } = useRows<Payslip[]>(["payslips", "mine"], (sb) => sb.from("payslips").select("*").eq("employee_id", employeeId!).eq("is_published", true).order("period", { ascending: false }), { enabled: !!employeeId });
  const [sel, setSel] = useState<string | null>(null);
  const current = slips.find((s) => s.id === sel) ?? slips[0];
  const ytd = slips.filter((s) => s.period.slice(0, 4) === new Date().getFullYear().toString());
  return (
    <div>
      <PageHeader icon={FileText} title="My payslips" subtitle="Every line shows how it was calculated." />
      {isLoading ? <Loading /> : !slips.length ? <Card><EmptyState icon={Wallet} title="No payslips yet" text="Your payslip appears here as soon as payroll is finalized." /></Card> : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="space-y-4">
            <Card className="p-4">
              <p className="text-xs text-ink-soft">Net pay this year</p>
              <p className="font-display text-2xl font-bold text-ink">{money(ytd.reduce((s, x) => s + Number(x.net_pay), 0))}</p>
              <p className="text-xs text-ink-soft">Tax deducted: {money(ytd.reduce((s, x) => s + Number(x.income_tax), 0))}</p>
              <div className="mt-3"><Bars height={120} data={[...slips].reverse().slice(-6).map((s) => ({ label: periodLabel(s.period).slice(0, 3), value: Number(s.net_pay) }))} money /></div>
            </Card>
            <Card className="p-2">
              {slips.map((s) => (
                <button key={s.id} onClick={() => setSel(s.id)} className={cn("flex w-full cursor-pointer items-center justify-between rounded-2xl px-3 py-2.5 text-left text-sm transition", current?.id === s.id ? "bg-brand-50 text-brand-700" : "text-ink hover:bg-surface-muted")}>
                  <span className="font-medium">{periodLabel(s.period)}</span><span className="tabular">{money(s.net_pay)}</span>
                </button>
              ))}
            </Card>
          </div>
          {current && (
            <div>
              <PayslipView slip={current} employee={{ full_name: ctx?.employee?.full_name ?? "", employee_code: ctx?.employee?.code ?? "", job_title: ctx?.employee?.job_title }} />
              <div className="mt-3 flex justify-end"><Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4" />Print / save PDF</Button></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
