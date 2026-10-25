"use client";
import { Printer } from "lucide-react";
import { Button, Dialog } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { money, periodLabel } from "@/lib/format";

export type Payslip = {
  id: string; employee_id: string; period: string; gross_salary: number; net_pay: number; total_earnings: number; total_deductions: number; income_tax: number;
  employer_eobi: number; employer_pf: number; annual_taxable: number; working_days: number; absent_days: number; unpaid_leave_days: number; late_days: number;
  bank_name: string | null; bank_account_no: string | null; overtime_hours: number; lines: { key: string; label: string; type: "earning" | "deduction"; amount: number; formula?: string }[];
};

/** Printable payslip with a formula behind every line (brief: explainable payroll). */
export function PayslipView({ slip, employee }: { slip: Payslip; employee: { full_name: string; employee_code: string; job_title?: string | null } }) {
  const { ctx } = useAuth();
  const earn = slip.lines.filter((l) => l.type === "earning");
  const ded = slip.lines.filter((l) => l.type === "deduction");
  const Row = ({ l }: { l: Payslip["lines"][number] }) => (
    <div className="flex items-start justify-between gap-3 py-2 text-sm">
      <div><p className="text-ink">{l.label}</p>{l.formula && <p className="text-[11px] text-ink-soft">{l.formula}</p>}</div>
      <p className="font-medium tabular text-ink">{money(l.amount)}</p>
    </div>
  );
  return (
    <div className="print-area rounded-3xl border border-line bg-surface p-6">
      <div className="flex items-start justify-between gap-4 border-b border-line pb-4">
        <div><p className="font-display text-lg font-bold text-ink">{ctx?.tenant?.name}</p><p className="text-sm text-ink-soft">Payslip · {periodLabel(slip.period)}</p></div>
        <div className="text-right text-sm"><p className="font-semibold text-ink">{employee.full_name}</p><p className="text-ink-soft">{employee.employee_code}{employee.job_title ? ` · ${employee.job_title}` : ""}</p></div>
      </div>
      <div className="grid gap-6 py-4 sm:grid-cols-2">
        <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-600">Earnings</p><div className="divide-y divide-line">{earn.map((l) => <Row key={l.key} l={l} />)}</div>
          <div className="mt-2 flex justify-between border-t border-line pt-2 text-sm font-semibold"><span>Total earnings</span><span className="tabular">{money(slip.total_earnings)}</span></div></div>
        <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-rose-600">Deductions</p><div className="divide-y divide-line">{ded.map((l) => <Row key={l.key} l={l} />)}</div>
          <div className="mt-2 flex justify-between border-t border-line pt-2 text-sm font-semibold"><span>Total deductions</span><span className="tabular">{money(slip.total_deductions)}</span></div></div>
      </div>
      <div className="brand-gradient flex items-center justify-between rounded-2xl px-5 py-4 text-white"><span className="text-sm">Net pay</span><span className="font-display text-2xl font-bold tabular">{money(slip.net_pay)}</span></div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-ink-soft sm:grid-cols-4">
        <p>Working days: <span className="text-ink">{slip.working_days}</span></p><p>Absent / unpaid: <span className="text-ink">{Number(slip.absent_days) + Number(slip.unpaid_leave_days)}</span></p>
        <p>Late days: <span className="text-ink">{slip.late_days}</span></p><p>Overtime: <span className="text-ink">{slip.overtime_hours} h</span></p>
        <p className="col-span-2">Paid to: <span className="text-ink">{slip.bank_name ?? "—"} {slip.bank_account_no ? "· " + slip.bank_account_no.replace(/.(?=.{4})/g, "•") : ""}</span></p>
        <p className="col-span-2">Employer contributions: <span className="text-ink">EOBI {money(slip.employer_eobi)} · PF {money(slip.employer_pf)}</span></p>
      </div>
      <p className="mt-4 text-[11px] text-ink-soft">Computer-generated payslip. Annual taxable income used: {money(slip.annual_taxable)}.</p>
    </div>
  );
}

export function PayslipDialog({ slip, employee, onClose }: { slip: Payslip | null; employee?: { full_name: string; employee_code: string; job_title?: string | null }; onClose: () => void }) {
  return (
    <Dialog open={!!slip} onClose={onClose} className="max-w-3xl">
      {slip && employee && (
        <>
          <PayslipView slip={slip} employee={employee} />
          <div className="no-print mt-4 flex justify-end"><Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4" />Print / save PDF</Button></div>
        </>
      )}
    </Dialog>
  );
}
