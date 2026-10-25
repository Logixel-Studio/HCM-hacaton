import { cn, initials } from "@/lib/utils";

const palette = ["bg-brand-100 text-brand-700", "bg-sky-100 text-sky-700", "bg-violet-100 text-violet-700", "bg-amber-100 text-amber-700", "bg-rose-100 text-rose-700", "bg-teal-100 text-teal-700"];
function colorFor(name = "") {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return palette[Math.abs(h) % palette.length];
}
const sizes = { xs: "h-6 w-6 text-[10px]", sm: "h-8 w-8 text-xs", md: "h-10 w-10 text-sm", lg: "h-14 w-14 text-base" };

export function Avatar({ name = "", size = "md", className }: { name?: string; size?: keyof typeof sizes; className?: string }) {
  return (
    <div title={name} className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold", sizes[size], colorFor(name), className)}>
      {initials(name) || "?"}
    </div>
  );
}

export function Person({ name, sub, size = "sm" }: { name: string; sub?: string; size?: keyof typeof sizes }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={name} size={size} />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink">{name}</p>
        {sub && <p className="truncate text-xs text-ink-soft">{sub}</p>}
      </div>
    </div>
  );
}
