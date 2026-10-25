import Link from "next/link";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-3xl border border-line bg-surface shadow-[var(--shadow-card)]", className)} {...props} />;
}

/** Card heading: leading icon tile, title + subtitle, and a trailing round ↗ link or custom action. */
export function SectionHeading({ icon: Icon, title, subtitle, href, action, className }: {
  icon?: LucideIcon; title: React.ReactNode; subtitle?: React.ReactNode; href?: string; action?: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-surface-muted text-ink-soft">
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          {subtitle && <p className="text-sm text-ink-soft">{subtitle}</p>}
        </div>
      </div>
      {action ??
        (href ? (
          <Link href={href} aria-label="Open" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink-soft transition hover:bg-surface-muted hover:text-ink active:scale-95">
            <ArrowUpRight className="h-[18px] w-[18px]" />
          </Link>
        ) : null)}
    </div>
  );
}
