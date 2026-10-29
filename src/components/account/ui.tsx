"use client";
import Link from "next/link";
import { ArrowLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { Fragment, useState } from "react";
import { toast } from "sonner";
import { usePrefs } from "@/lib/prefs";
import { cn } from "@/lib/utils";

/** One row in a settings list: icon, title, subtitle, optional badge, chevron. */
export function SettingsLink({ href, icon: Icon, title, sub, badge, tone = "brand", tour }: { href: string; icon: LucideIcon; title: string; sub: string; badge?: string | null; tone?: "brand" | "amber" | "rose" | "emerald" | "violet" | "slate"; tour?: string }) {
  const tones = { brand: "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300", amber: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300", rose: "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300", emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300", violet: "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300", slate: "bg-surface-muted text-ink-soft" };
  return (
    <Link href={href} data-tour={tour} className="group flex items-center gap-3.5 px-4 py-3.5 transition hover:bg-surface-muted/60">
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", tones[tone])}><Icon className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">{title}</span><span className="block truncate text-xs text-ink-soft">{sub}</span></span>
      {badge && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">{badge}</span>}
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-soft transition group-hover:translate-x-0.5" />
    </Link>
  );
}

export function SettingsGroup({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div>
      {title && <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-soft/80">{title}</p>}
      <div className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface shadow-[var(--shadow-card)]">{children}</div>
    </div>
  );
}

/** Screen header with a back button to the Settings hub. */
export function SettingsHeader({ title, sub, back = "/account" }: { title: string; sub?: string; back?: string }) {
  return (
    <div className="mb-6 flex items-center gap-3">
      <Link href={back} className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface text-ink-soft transition hover:text-ink" aria-label="Back"><ArrowLeft className="h-[18px] w-[18px]" /></Link>
      <div><h1 className="font-display text-2xl font-bold text-ink">{title}</h1>{sub && <p className="text-sm text-ink-soft">{sub}</p>}</div>
    </div>
  );
}

export function Panel({ title, sub, children, id, action }: { title: string; sub?: string; children: React.ReactNode; id?: string; action?: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-3xl border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
      <div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="font-display text-base font-semibold text-ink">{title}</h2>{sub && <p className="mt-0.5 text-sm text-ink-soft">{sub}</p>}</div>{action}</div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50", checked ? "bg-brand-600" : "bg-line dark:bg-white/15")}>
      <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow transition", checked ? "translate-x-[22px]" : "translate-x-0.5")} />
    </button>
  );
}

/** A switch that saves a preference the moment it is flipped. */
export function PrefSwitch({ k, label, sub, value, disabled, onAfter }: { k: string; label: string; sub?: string; value: boolean; disabled?: boolean; onAfter?: (v: boolean) => void }) {
  const { setPref } = usePrefs();
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0"><p className="text-sm font-medium text-ink">{label}</p>{sub && <p className="text-xs text-ink-soft">{sub}</p>}</div>
      <Toggle label={label} checked={value} disabled={disabled || busy} onChange={async (v) => { setBusy(true); try { await setPref(k, v); onAfter?.(v); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } }} />
    </div>
  );
}

/** Segmented choice that saves on change. */
export function PrefSegment<T extends string>({ k, label, value, options, onAfter }: { k: string; label: string; value: T; options: [T, string][]; onAfter?: (v: T) => void }) {
  const { setPref } = usePrefs();
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-ink">{label}</p>
      <div className="inline-flex max-w-full flex-wrap gap-1 rounded-2xl bg-surface-muted p-1" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} onClick={async () => { try { await setPref(k, v); onAfter?.(v); } catch (e) { toast.error((e as Error).message); } }}
            className={cn("cursor-pointer rounded-xl px-3.5 py-1.5 text-sm font-medium transition", value === v ? "bg-surface text-ink shadow-soft" : "text-ink-soft hover:text-ink")}>{l}</button>
        ))}
      </div>
    </div>
  );
}

export function PrefSelect({ k, label, value, options, hint }: { k: string; label: string; value: string; options: [string, string][]; hint?: string }) {
  const { setPref } = usePrefs();
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      <select value={value} onChange={async (e) => { try { await setPref(k, e.target.value); } catch (err) { toast.error((err as Error).message); } }}
        className="h-11 w-full rounded-2xl border border-line bg-surface px-3 text-sm text-ink focus:border-brand-400 focus:outline-none">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {hint && <span className="mt-1 block text-xs text-ink-soft">{hint}</span>}
    </label>
  );
}

export function KV({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(120px,auto)_1fr] gap-x-4 gap-y-2.5 text-sm">
      {rows.map(([k, v]) => <Fragment key={k}><dt className="text-ink-soft">{k}</dt><dd className="min-w-0 truncate font-medium text-ink">{v}</dd></Fragment>)}
    </dl>
  );
}
