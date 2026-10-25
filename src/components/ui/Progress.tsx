import { cn } from "@/lib/utils";

export function Progress({ value, className, bar = "bg-brand-500", color }: { value: number; className?: string; bar?: string; color?: string }) {
  return (
    <div className={cn("h-2.5 overflow-hidden rounded-full bg-surface-muted", className)}>
      <div className={cn("h-full rounded-full transition-all", !color && bar)} style={{ width: `${Math.max(2, Math.min(100, value))}%`, background: color }} />
    </div>
  );
}
