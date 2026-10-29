import { cn } from "@/lib/utils";

/** Segmented pill tabs, as in Lead_CRM's Monthly / Annually toggle. */
export function Tabs<T extends string>({ tabs, value, onChange, className }: {
  tabs: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; className?: string;
}) {
  return (
    <div data-tour="tabs" className={cn("inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full bg-surface-muted p-1 no-scrollbar", className)}>
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button key={t.value} onClick={() => onChange(t.value)}
            className={cn("inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-all", active ? "bg-brand-600 text-white shadow-sm" : "text-ink-soft hover:text-ink")}>
            {t.label}
            {t.count != null && <span className={cn("rounded-full px-1.5 text-[11px]", active ? "bg-white/20" : "bg-surface text-ink-soft")}>{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
