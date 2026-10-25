import { cn } from "@/lib/utils";

/** Product mark: a stylised "H" made of two people joined by a bar. */
export function Logo({ className, withText = true, light = false }: { className?: string; withText?: boolean; light?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl shadow-sm", light ? "bg-white/15 ring-1 ring-white/25" : "brand-gradient")}>
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <circle cx="6.5" cy="5" r="2" fill="currentColor" stroke="none" />
          <circle cx="17.5" cy="5" r="2" fill="currentColor" stroke="none" />
          <path d="M6.5 9.5v10M17.5 9.5v10M6.5 14.5h11" />
        </svg>
      </div>
      {withText && (
        <span className={cn("font-display text-lg font-bold tracking-tight", light ? "text-white" : "text-ink")}>
          HCM <span className={light ? "text-white/70" : "text-brand-600"}>Master Suite</span>
        </span>
      )}
    </div>
  );
}
