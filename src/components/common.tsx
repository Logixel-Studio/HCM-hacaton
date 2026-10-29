"use client";
import { useState } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Inbox, Loader2, Search, type LucideIcon } from "lucide-react";
import { Badge, Button, Card, Dialog, Textarea, type Tone } from "@/components/ui";
import { cn } from "@/lib/utils";
import { title as titleCase } from "@/lib/format";

export function PageHeader({ title, subtitle, children, icon: Icon }: { title: React.ReactNode; subtitle?: React.ReactNode; children?: React.ReactNode; icon?: LucideIcon }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex items-center gap-3" data-tour="page-header">
        {Icon && <div className="brand-gradient hidden h-12 w-12 items-center justify-center rounded-2xl text-white shadow-sm sm:flex"><Icon className="h-6 w-6" /></div>}
        <div>
          <h1 className="font-display text-2xl font-bold text-ink sm:text-[28px]">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-ink-soft">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2" data-tour="page-actions">{children}</div>}
    </div>
  );
}

export function StatCard({ label, value, icon: Icon, trend, hint, accent = false, onClick }: {
  label: string; value: React.ReactNode; icon?: LucideIcon; trend?: number | null; hint?: React.ReactNode; accent?: boolean; onClick?: () => void;
}) {
  const up = trend == null || trend >= 0;
  return (
    <Card onClick={onClick} className={cn("p-5 transition hover:shadow-pop", onClick && "cursor-pointer", accent && "brand-gradient border-transparent text-white")}>
      <div className="flex items-center justify-between">
        <div className={cn("flex h-11 w-11 items-center justify-center rounded-2xl", accent ? "bg-white/15 text-white" : "bg-brand-50 text-brand-600")}>{Icon && <Icon className="h-5 w-5" />}</div>
        {trend != null && (
          <span className={cn("inline-flex items-center gap-0.5 rounded-full px-2 py-1 text-xs font-semibold", accent ? "bg-white/15 text-white" : up ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600")}>
            {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{Math.abs(trend)}%
          </span>
        )}
      </div>
      <p className={cn("mt-4 font-display text-2xl font-bold tracking-tight tabular", accent ? "text-white" : "text-ink")}>{value}</p>
      <p className={cn("mt-1 text-sm", accent ? "text-white/80" : "text-ink-soft")}>{label}</p>
      {hint && <p className={cn("mt-0.5 text-xs", accent ? "text-white/70" : "text-ink-soft/80")}>{hint}</p>}
    </Card>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, text, children }: { icon?: LucideIcon; title: string; text?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-muted text-ink-soft"><Icon className="h-6 w-6" /></div>
      <p className="mt-3 font-semibold text-ink">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-ink-soft">{text}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function Loading({ label = "Loading", className }: { label?: string; className?: string }) {
  return <div className={cn("flex items-center justify-center gap-2 py-12 text-sm text-ink-soft", className)}><Loader2 className="h-4 w-4 animate-spin" />{label}…</div>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-2xl bg-surface-muted", className)} />;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <AlertTriangle className="h-6 w-6 text-amber-500" />
      <p className="text-sm text-ink">{(error as Error)?.message || "Something went wrong"}</p>
      {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  approved: "green", active: "green", present: "green", completed: "green", finalized: "green", paid: "green", hired: "green", open: "brand",
  accepted: "green", reimbursed: "green", resolved: "green", closed: "neutral", filled: "green", on_track: "green", done: "green", published: "green",
  pending: "amber", pending_approval: "amber", calculated: "sky", hr_approved: "violet", finance_approved: "violet", draft: "neutral", submitted: "amber",
  manager_approved: "violet", in_progress: "sky", waiting: "amber", late: "amber", half_day: "amber", missing_punch: "amber", probation: "amber", notice: "amber",
  at_risk: "amber", on_hold: "amber", screening: "sky", assessment: "sky", interview: "violet", offer: "violet", applied: "neutral", scheduled: "sky",
  rejected: "rose", cancelled: "neutral", absent: "rose", suspended: "rose", exited: "neutral", withdrawn: "neutral", off_track: "rose", declined: "rose",
  urgent: "rose", high: "amber", normal: "sky", low: "neutral", self_review: "amber", manager_review: "violet", calibration: "sky", on_leave: "violet",
  holiday: "sky", weekly_off: "neutral", trial: "amber", critical: "rose", warning: "amber", info: "sky", assigned: "amber", available: "green", repair: "amber", lost: "rose", retired: "neutral",
};

export function StatusBadge({ status, label }: { status?: string | null; label?: string }) {
  if (!status) return <Badge>—</Badge>;
  return <Badge tone={STATUS_TONE[status] ?? "neutral"} dot>{label ?? titleCase(status)}</Badge>;
}

export function SearchInput({ value, onChange, placeholder = "Search", className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="h-10 w-full rounded-full border border-line bg-surface pl-10 pr-4 text-sm text-ink placeholder:text-ink-soft/70 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20" />
    </div>
  );
}

export type Column<T> = { key: string; label: React.ReactNode; render: (row: T) => React.ReactNode; className?: string; hideOnMobile?: boolean };

/** Responsive list: a table on desktop, stacked cards on phones. */
export function DataTable<T extends object>({ rows, columns, onRowClick, empty, rowKey }: {
  rows: T[]; columns: Column<T>[]; onRowClick?: (r: T) => void; empty?: React.ReactNode; rowKey?: (r: T, i: number) => string;
}) {
  if (!rows.length) return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;
  return (
    <>
      <div className="hidden overflow-x-auto md:block" data-tour="table">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-medium uppercase tracking-wide text-ink-soft">
              {columns.map((c) => <th key={c.key} className={cn("px-4 py-3 font-medium", c.className)}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={rowKey ? rowKey(r, i) : String((r as { id?: string | number }).id ?? i)} onClick={() => onRowClick?.(r)}
                className={cn("border-b border-line/70 last:border-0 transition", onRowClick && "cursor-pointer hover:bg-surface-muted/60")}>
                {columns.map((c) => <td key={c.key} className={cn("px-4 py-3 align-middle text-ink", c.className)}>{c.render(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-2 md:hidden">
        {rows.map((r, i) => (
          <div key={rowKey ? rowKey(r, i) : String((r as { id?: string | number }).id ?? i)} onClick={() => onRowClick?.(r)} className={cn("rounded-2xl border border-line p-4", onRowClick && "cursor-pointer active:bg-surface-muted")}>
            {columns.filter((c) => !c.hideOnMobile).map((c, ci) => (
              <div key={c.key} className={cn("flex items-center justify-between gap-3 py-0.5", ci === 0 && "pb-1.5")}>
                {ci > 0 && <span className="text-xs text-ink-soft">{c.label}</span>}
                <div className={cn("min-w-0 text-sm", ci === 0 ? "w-full" : "text-right")}>{c.render(r)}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

/** Approve / reject buttons with an optional note. */
export function DecisionButtons({ onDecide, loading, size = "sm", approveLabel = "Approve", rejectLabel = "Reject", requireRejectNote = false }: {
  onDecide: (approve: boolean, note: string | null) => void; loading?: boolean; size?: "sm" | "md"; approveLabel?: string; rejectLabel?: string; requireRejectNote?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <Button size={size} variant="outline" onClick={() => setOpen(true)} disabled={loading}>{rejectLabel}</Button>
      <Button size={size} onClick={() => onDecide(true, null)} loading={loading}>{approveLabel}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={rejectLabel} description="Add a short note so the person knows why.">
        <Textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason" />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="danger" disabled={requireRejectNote && note.trim().length < 3} onClick={() => { onDecide(false, note.trim() || null); setOpen(false); setNote(""); }}>{rejectLabel}</Button>
        </div>
      </Dialog>
    </div>
  );
}

export function KeyValue({ items, cols = 2 }: { items: [React.ReactNode, React.ReactNode][]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-4", cols === 2 && "sm:grid-cols-2", cols === 3 && "sm:grid-cols-3")}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs text-ink-soft">{k}</dt>
          <dd className="mt-0.5 truncate text-sm font-medium text-ink">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionCard({ title, subtitle, icon: Icon, action, children, className, bodyClassName }: {
  title: React.ReactNode; subtitle?: React.ReactNode; icon?: LucideIcon; action?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string;
}) {
  return (
    <Card className={cn("p-5", className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {Icon && <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-surface-muted text-ink-soft"><Icon className="h-5 w-5" /></div>}
          <div className="min-w-0"><h3 className="text-base font-semibold text-ink">{title}</h3>{subtitle && <p className="text-sm text-ink-soft">{subtitle}</p>}</div>
        </div>
        {action}
      </div>
      <div className={bodyClassName}>{children}</div>
    </Card>
  );
}

/** Read-only notice for auditors and other view-only roles. */
export function ReadOnlyNote({ children = "You have read-only access to this area." }: { children?: React.ReactNode }) {
  return <div className="mb-4 rounded-2xl border border-line bg-surface-muted px-4 py-3 text-sm text-ink-soft">{children}</div>;
}
